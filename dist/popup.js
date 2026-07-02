(() => {
  // src/tokenize.js
  var MN_WORD = /[А-Яа-яЁёӨөҮү]+/g;
  var ADJACENT = /[A-Za-z0-9_@./\\-]/;
  function isRealWord(text, start, end, word) {
    if (word.length < 2) return false;
    const before = start > 0 ? text[start - 1] : "";
    const after = end < text.length ? text[end] : "";
    return !ADJACENT.test(before) && !ADJACENT.test(after);
  }
  function tokenize(text) {
    const tokens = [];
    const seen = /* @__PURE__ */ new Set();
    let m;
    MN_WORD.lastIndex = 0;
    while ((m = MN_WORD.exec(text)) !== null) {
      const word = m[0];
      const start = m.index;
      const end = start + word.length;
      if (!isRealWord(text, start, end, word)) continue;
      tokens.push({ start, end, word });
      seen.add(word);
    }
    return { tokens, seen };
  }

  // src/checks.js
  var HOMOGLYPH = {
    a: "\u0430",
    c: "\u0441",
    e: "\u0435",
    o: "\u043E",
    p: "\u0440",
    x: "\u0445",
    y: "\u0443",
    A: "\u0410",
    B: "\u0412",
    C: "\u0421",
    E: "\u0415",
    H: "\u041D",
    K: "\u041A",
    M: "\u041C",
    O: "\u041E",
    P: "\u0420",
    T: "\u0422",
    X: "\u0425",
    Y: "\u0423"
  };
  var CYRILLIC = /[А-Яа-яЁёӨөҮү]/;
  var LETTER_RUN = /[A-Za-zА-Яа-яЁёӨөҮү]+/g;
  function toCyrillic(word) {
    let out = "";
    for (const ch of word) out += HOMOGLYPH[ch] || ch;
    return out;
  }
  function detectHomoglyphs(text) {
    const out = [];
    LETTER_RUN.lastIndex = 0;
    let m;
    while ((m = LETTER_RUN.exec(text)) !== null) {
      const word = m[0];
      if (word.length < 2) continue;
      let hasCyrillic = false;
      let hasLatin = false;
      let allLatinAreHomoglyph = true;
      for (const ch of word) {
        if (CYRILLIC.test(ch)) {
          hasCyrillic = true;
        } else {
          hasLatin = true;
          if (!(ch in HOMOGLYPH)) {
            allLatinAreHomoglyph = false;
            break;
          }
        }
      }
      if (hasCyrillic && hasLatin && allLatinAreHomoglyph) {
        out.push({
          start: m.index,
          end: m.index + word.length,
          word,
          kind: "homoglyph",
          suggestions: [toCyrillic(word)]
        });
      }
    }
    return out;
  }
  function detectRepeats(text) {
    const words = [];
    MN_WORD.lastIndex = 0;
    let m;
    while ((m = MN_WORD.exec(text)) !== null) {
      words.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
    }
    const out = [];
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      const cur = words[i];
      if (cur.word.length < 2) continue;
      if (prev.word.toLowerCase() !== cur.word.toLowerCase()) continue;
      const between = text.slice(prev.end, cur.start);
      if (!/^\s+$/.test(between)) continue;
      out.push({
        start: prev.end,
        end: cur.end,
        word: text.slice(prev.end, cur.end),
        // whitespace + duplicate
        display: cur.word,
        kind: "repeat",
        suggestions: [{ label: `\u0414\u0430\u0432\u0445\u0430\u0440\u0434\u0441\u0430\u043D \xAB${cur.word}\xBB-\u0433 \u0443\u0441\u0442\u0433\u0430\u0445`, value: "" }]
      });
    }
    return out;
  }
  function detectExtras(text) {
    return [...detectHomoglyphs(text), ...detectRepeats(text)].sort((a, b) => a.start - b.start);
  }

  // popup/popup.js
  var DEBOUNCE_MS = 300;
  function mergeFlags(spell, extra) {
    const kept = spell.filter((s) => !extra.some((e) => s.start < e.end && e.start < s.end));
    return [...kept, ...extra].sort((a, b) => a.start - b.start);
  }
  function normSuggestion(s) {
    return typeof s === "string" ? { label: s, value: s } : s;
  }
  var KIND_META = {
    spell: { note: "\u0410\u043B\u0434\u0430\u0430\u0442\u0430\u0439 \u0431\u0438\u0447\u043B\u044D\u0433", cls: "mn-kind-spell" },
    homoglyph: { note: "\u041B\u0430\u0442\u0438\u043D \u04AF\u0441\u044D\u0433 \u0445\u043E\u043B\u0438\u043B\u0434\u0441\u043E\u043D", cls: "mn-kind-warn" },
    repeat: { note: "\u0414\u0430\u0432\u0445\u0430\u0440\u0434\u0441\u0430\u043D \u04AF\u0433", cls: "mn-kind-warn" }
  };
  var input = document.getElementById("input");
  var mirror = document.getElementById("mirror");
  var mirrorInner = document.getElementById("mirrorInner");
  var statusEl = document.getElementById("status");
  var summaryEl = document.getElementById("summary");
  var clearBtn = document.getElementById("clear");
  var tip = document.getElementById("tip");
  var tgGlobal = document.getElementById("tgGlobal");
  var tgSite = document.getElementById("tgSite");
  var siteLabel = document.getElementById("siteLabel");
  var ignoreBtn = document.getElementById("ignoreBtn");
  var ignorePanel = document.getElementById("ignorePanel");
  var misspelled = [];
  var timer = null;
  var ignoreSet = /* @__PURE__ */ new Set();
  var currentHost = "";
  async function loadSettings() {
    const data = await chrome.storage.local.get(["mnEnabled", "mnDisabledHosts", "mnIgnore"]);
    tgGlobal.checked = data.mnEnabled !== false;
    ignoreSet.clear();
    for (const w of data.mnIgnore || []) ignoreSet.add(w);
    updateIgnoreCount();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && /^https?:/.test(tab.url)) currentHost = new URL(tab.url).hostname;
    } catch {
    }
    if (currentHost) {
      siteLabel.textContent = currentHost;
      tgSite.checked = !(data.mnDisabledHosts || {})[currentHost];
      tgSite.disabled = false;
    } else {
      siteLabel.textContent = "\u042D\u043D\u044D \u0441\u0430\u0439\u0442";
      tgSite.checked = false;
      tgSite.disabled = true;
    }
  }
  function updateIgnoreCount() {
    ignoreBtn.textContent = `\u041C\u0438\u043D\u0438\u0439 \u0442\u043E\u043B\u044C (${ignoreSet.size})`;
  }
  tgGlobal.addEventListener("change", () => {
    chrome.storage.local.set({ mnEnabled: tgGlobal.checked });
  });
  tgSite.addEventListener("change", async () => {
    if (!currentHost) return;
    const { mnDisabledHosts } = await chrome.storage.local.get("mnDisabledHosts");
    const hosts = mnDisabledHosts || {};
    if (tgSite.checked) delete hosts[currentHost];
    else hosts[currentHost] = true;
    await chrome.storage.local.set({ mnDisabledHosts: hosts });
  });
  ignoreBtn.addEventListener("click", () => {
    ignorePanel.hidden = !ignorePanel.hidden;
    if (!ignorePanel.hidden) renderIgnorePanel();
  });
  async function saveIgnore() {
    await chrome.storage.local.set({ mnIgnore: [...ignoreSet] });
    updateIgnoreCount();
  }
  async function addIgnoreWord(word) {
    if (ignoreSet.has(word)) return;
    ignoreSet.add(word);
    await saveIgnore();
    schedule();
  }
  function renderIgnorePanel() {
    ignorePanel.textContent = "";
    if (ignoreSet.size === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "\u0425\u043E\u043E\u0441\u043E\u043D \u0431\u0430\u0439\u043D\u0430";
      ignorePanel.appendChild(empty);
      return;
    }
    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "clear-all";
    clearAll.textContent = "\u0411\u04AF\u0433\u0434\u0438\u0439\u0433 \u0430\u0440\u0438\u043B\u0433\u0430\u0445";
    clearAll.addEventListener("click", async () => {
      ignoreSet.clear();
      await saveIgnore();
      renderIgnorePanel();
      schedule();
    });
    ignorePanel.appendChild(clearAll);
    const chips = document.createElement("div");
    chips.className = "ignore-chips";
    for (const w of [...ignoreSet].sort((a, b) => a.localeCompare(b))) {
      const chip = document.createElement("span");
      chip.className = "chip";
      const label = document.createElement("span");
      label.textContent = w;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "\u2715";
      rm.title = "\u0423\u0441\u0442\u0433\u0430\u0445";
      rm.addEventListener("click", async () => {
        ignoreSet.delete(w);
        await saveIgnore();
        renderIgnorePanel();
        schedule();
      });
      chip.appendChild(label);
      chip.appendChild(rm);
      chips.appendChild(chip);
    }
    ignorePanel.appendChild(chips);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("mnIgnore" in changes) {
      ignoreSet.clear();
      for (const w of changes.mnIgnore.newValue || []) ignoreSet.add(w);
      updateIgnoreCount();
      if (!ignorePanel.hidden) renderIgnorePanel();
      schedule();
    }
    if ("mnEnabled" in changes) tgGlobal.checked = changes.mnEnabled.newValue !== false;
    if ("mnDisabledHosts" in changes && currentHost) {
      tgSite.checked = !(changes.mnDisabledHosts.newValue || {})[currentHost];
    }
  });
  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false });
      });
    });
  }
  async function warmup() {
    const res = await send({ type: "ping" });
    if (!res.ok) return setStatus("error", "\u0410\u043B\u0434\u0430\u0430 \u0433\u0430\u0440\u043B\u0430\u0430");
    const probe = await send({ type: "check", words: ["\u043C\u043E\u043D\u0433\u043E\u043B"] });
    if (probe.ok) setStatus("ready", "\u0411\u044D\u043B\u044D\u043D");
    else setStatus("error", "\u0410\u043B\u0434\u0430\u0430 \u0433\u0430\u0440\u043B\u0430\u0430");
  }
  function setStatus(kind, text) {
    statusEl.className = "status " + kind;
    statusEl.textContent = text;
  }
  input.addEventListener("input", schedule);
  input.addEventListener("scroll", syncScroll);
  input.addEventListener("click", handleClick);
  clearBtn.addEventListener("click", () => {
    input.value = "";
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
    const { tokens, seen } = tokenize(text);
    let spell = [];
    if (seen.size) {
      const res = await send({ type: "check", words: [...seen] });
      const wrong = new Set(res.ok ? res.wrong : []);
      spell = tokens.filter((t) => wrong.has(t.word) && !ignoreSet.has(t.word)).map((t) => ({ start: t.start, end: t.end, word: t.word, kind: "spell" }));
    }
    misspelled = mergeFlags(spell, detectExtras(text));
    render(text);
    const n = misspelled.length;
    summaryEl.textContent = n === 0 ? `\u0410\u043B\u0434\u0430\u0430 \u043E\u043B\u0434\u0441\u043E\u043D\u0433\u04AF\u0439 \xB7 ${tokens.length} \u04AF\u0433` : `${n} \u0430\u043B\u0434\u0430\u0430\u0442\u0430\u0439 \u04AF\u0433 \xB7 \u043D\u0438\u0439\u0442 ${tokens.length}`;
  }
  function render(text) {
    mirrorInner.textContent = "";
    let cursor = 0;
    for (const t of misspelled) {
      if (t.start > cursor) {
        mirrorInner.appendChild(document.createTextNode(text.slice(cursor, t.start)));
      }
      const span = document.createElement("span");
      span.className = t.kind && t.kind !== "spell" ? "mn-bad mn-bad--warn" : "mn-bad";
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
    tip.textContent = "\u2026";
    tip.style.left = Math.min(x, window.innerWidth - 200) + "px";
    tip.style.top = Math.min(y + 12, window.innerHeight - 200) + "px";
    let suggestions;
    if (token.suggestions) {
      suggestions = token.suggestions.map(normSuggestion);
    } else {
      const res = await send({ type: "suggest", word: token.word });
      suggestions = (res.ok ? res.suggestions : []).map(normSuggestion);
    }
    tip.textContent = "";
    const meta = KIND_META[token.kind] || KIND_META.spell;
    const head = document.createElement("div");
    head.className = "tip-head " + meta.cls;
    head.textContent = token.display || token.word;
    tip.appendChild(head);
    const note = document.createElement("div");
    note.className = "tip-note";
    note.textContent = meta.note;
    tip.appendChild(note);
    if (!suggestions.length) {
      const none = document.createElement("div");
      none.className = "tip-none";
      none.textContent = "\u0421\u0430\u043D\u0430\u043B \u0430\u043B\u0433\u0430";
      tip.appendChild(none);
    }
    for (const s of suggestions) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tip-item";
      item.textContent = s.label;
      item.addEventListener("click", () => applyFix(token, s.value));
      tip.appendChild(item);
    }
    if (!token.kind || token.kind === "spell") {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "tip-add";
      add.textContent = "\uFF0B \u0422\u043E\u043B\u0438\u043D\u0434 \u043D\u044D\u043C\u044D\u0445";
      add.addEventListener("click", () => {
        hideTip();
        addIgnoreWord(token.word);
      });
      tip.appendChild(add);
    }
  }
  function hideTip() {
    tip.hidden = true;
    tip.textContent = "";
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
  document.addEventListener("mousedown", (e) => {
    if (!tip.hidden && !tip.contains(e.target) && e.target !== input) hideTip();
  });
  chrome.storage.session.get("lastSelectionCheck").then((data) => {
    const last = data?.lastSelectionCheck;
    if (last?.text && !input.value) {
      input.value = last.text;
      schedule();
    }
    chrome.action?.setBadgeText?.({ text: "" });
  });
  loadSettings();
  warmup();
  input.focus();
})();
