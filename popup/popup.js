// Popup quick-checker. Talks to the service-worker engine via one-shot
// messages and mirrors the textarea to draw wavy underlines under misspellings.

const MN_WORD = /[А-Яа-яЁёӨөҮү]+/g;
const DEBOUNCE_MS = 300;

const input = document.getElementById('input');
const mirror = document.getElementById('mirror');
const mirrorInner = document.getElementById('mirrorInner');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const clearBtn = document.getElementById('clear');
const tip = document.getElementById('tip');

let misspelled = [];
let timer = null;

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false });
    });
  });
}

async function warmup() {
  const res = await send({ type: 'ping' });
  if (!res.ok) return setStatus('error', 'Алдаа гарлаа');
  // ping just kicks off loading; confirm readiness with a trivial check.
  const probe = await send({ type: 'check', words: ['монгол'] });
  if (probe.ok) setStatus('ready', 'Бэлэн');
  else setStatus('error', 'Алдаа гарлаа');
}

function setStatus(kind, text) {
  statusEl.className = 'status ' + kind;
  statusEl.textContent = text;
}

input.addEventListener('input', schedule);
input.addEventListener('scroll', syncScroll);
input.addEventListener('click', handleClick);
clearBtn.addEventListener('click', () => {
  input.value = '';
  schedule();
  input.focus();
});

function schedule() {
  clearTimeout(timer);
  hideTip();
  timer = setTimeout(runCheck, DEBOUNCE_MS);
}

function syncScroll() {
  mirrorInner.style.transform = `translateY(${-input.scrollTop}px)`;
}

async function runCheck() {
  const text = input.value;
  const tokens = [];
  const seen = new Set();
  let m;
  MN_WORD.lastIndex = 0;
  while ((m = MN_WORD.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
    seen.add(m[0]);
  }

  if (seen.size === 0) {
    misspelled = [];
    render(text);
    summaryEl.textContent = ' ';
    return;
  }

  const res = await send({ type: 'check', words: [...seen] });
  const wrong = new Set(res.ok ? res.wrong : []);
  misspelled = tokens.filter((t) => wrong.has(t.word));
  render(text);

  const n = misspelled.length;
  summaryEl.textContent = n === 0
    ? `Алдаа олдсонгүй · ${tokens.length} үг`
    : `${n} алдаатай үг · нийт ${tokens.length}`;
}

function render(text) {
  mirrorInner.textContent = '';
  let cursor = 0;
  for (const t of misspelled) {
    if (t.start > cursor) {
      mirrorInner.appendChild(document.createTextNode(text.slice(cursor, t.start)));
    }
    const span = document.createElement('span');
    span.className = 'mn-bad';
    span.textContent = text.slice(t.start, t.end);
    mirrorInner.appendChild(span);
    cursor = t.end;
  }
  if (cursor < text.length) {
    mirrorInner.appendChild(document.createTextNode(text.slice(cursor)));
  }
  syncScroll();
}

function handleClick(e) {
  const pos = input.selectionStart;
  const hit = misspelled.find((t) => pos >= t.start && pos <= t.end);
  if (hit) showTip(hit, e.clientX, e.clientY);
  else hideTip();
}

async function showTip(token, x, y) {
  hideTip();
  tip.hidden = false;
  tip.textContent = '…';
  tip.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  tip.style.top = Math.min(y + 12, window.innerHeight - 200) + 'px';

  const res = await send({ type: 'suggest', word: token.word });
  const suggestions = res.ok ? res.suggestions : [];
  tip.textContent = '';

  const head = document.createElement('div');
  head.className = 'tip-head';
  head.textContent = token.word;
  tip.appendChild(head);

  if (!suggestions.length) {
    const none = document.createElement('div');
    none.className = 'tip-none';
    none.textContent = 'Санал алга';
    tip.appendChild(none);
    return;
  }

  for (const s of suggestions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tip-item';
    item.textContent = s;
    item.addEventListener('click', () => applyFix(token, s));
    tip.appendChild(item);
  }
}

function hideTip() {
  tip.hidden = true;
  tip.textContent = '';
}

function applyFix(token, replacement) {
  const value = input.value;
  if (value.slice(token.start, token.end) !== token.word) {
    hideTip();
    schedule();
    return;
  }
  input.value = value.slice(0, token.start) + replacement + value.slice(token.end);
  const caret = token.start + replacement.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  hideTip();
  schedule();
}

document.addEventListener('mousedown', (e) => {
  if (!tip.hidden && !tip.contains(e.target) && e.target !== input) hideTip();
});

// Restore any text checked via the right-click context menu.
chrome.storage.session.get('lastSelectionCheck').then((data) => {
  const last = data?.lastSelectionCheck;
  if (last?.text && !input.value) {
    input.value = last.text;
    schedule();
  }
  chrome.action?.setBadgeText?.({ text: '' });
});

warmup();
input.focus();
