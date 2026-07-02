// Content script: live Mongolian spell-checking for text fields on any page.
// Supports two kinds of editor:
//
//   * <textarea> and text <input>  -> a transparent "mirror" overlay aligned
//     on top of the field draws underlines under misspelled words.
//   * contenteditable elements      -> each misspelled word is located with a
//     DOM Range; getClientRects() gives its on-screen rectangles and we draw
//     underline overlays at those positions.
//
// In both cases the user's own content is never modified until they apply a
// suggestion.

import { tokenize } from './tokenize.js';
import { detectExtras } from './checks.js';

(() => {
  const DEBOUNCE_MS = 300;

  // ---- settings (global on/off, per-site off, personal dictionary) ---------
  const HOST = location.hostname;
  let enabledGlobal = true;
  let siteDisabled = false;
  const ignoreSet = new Set();

  function isActive() {
    return enabledGlobal && !siteDisabled;
  }

  async function loadSettings() {
    let data = {};
    try {
      data = await chrome.storage.local.get(['mnEnabled', 'mnDisabledHosts', 'mnIgnore']);
    } catch { /* storage unavailable (e.g. restricted frame) */ }
    enabledGlobal = data.mnEnabled !== false; // default on
    siteDisabled = !!(data.mnDisabledHosts || {})[HOST];
    ignoreSet.clear();
    for (const w of (data.mnIgnore || [])) ignoreSet.add(w);
  }

  async function addIgnoreWord(word) {
    try {
      const data = await chrome.storage.local.get('mnIgnore');
      const list = data.mnIgnore || [];
      if (!list.includes(word)) {
        list.push(word);
        await chrome.storage.local.set({ mnIgnore: list });
      }
    } catch { /* ignore */ }
  }

  // ---- service worker port (keeps the engine warm while editing) ----------
  let port = null;
  let msgId = 0;
  const pending = new Map();

  function connect() {
    port = chrome.runtime.connect({ name: 'mn-spell' });
    port.onMessage.addListener((msg) => {
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const [, resolve] of pending) resolve({ ok: false, error: 'disconnected' });
      pending.clear();
    });
    send({ type: 'ping' }).catch(() => {});
  }

  function send(message) {
    if (!port) connect();
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, resolve);
      try {
        port.postMessage({ id, ...message });
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  }

  async function checkWords(words) {
    const res = await send({ type: 'check', words });
    return res.ok ? res.wrong : [];
  }

  async function getSuggestions(word) {
    const res = await send({ type: 'suggest', word });
    return res.ok ? res.suggestions : [];
  }

  // ---- shared suggestion tooltip ------------------------------------------
  let tipEl = null;
  let tipCloser = null;

  function hideTip() {
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
    if (tipCloser) {
      document.removeEventListener('mousedown', tipCloser, true);
      tipCloser = null;
    }
  }

  // Normalize a suggestion (plain string or {label, value}) to {label, value}.
  function normSuggestion(s) {
    return typeof s === 'string' ? { label: s, value: s } : s;
  }

  // Short caption + accent class shown in the tooltip per flag kind.
  const KIND_META = {
    spell: { note: 'Алдаатай бичлэг', cls: 'mn-kind-spell' },
    homoglyph: { note: 'Латин үсэг холилдсон', cls: 'mn-kind-warn' },
    repeat: { note: 'Давхардсан үг', cls: 'mn-kind-warn' },
  };

  // Show suggestions for a flagged item. `item` has { word, display?, kind,
  // suggestions? }. Spelling flags fetch suggestions from the engine lazily;
  // homoglyph/repeat flags carry their own preset suggestions.
  async function showTip(item, x, y, onPick, onIgnore) {
    hideTip();
    const tip = document.createElement('div');
    tip.className = 'mn-spell-tip';
    tip.textContent = '…';
    tip.style.left = Math.min(x, window.innerWidth - 230) + 'px';
    tip.style.top = Math.min(y + 14, window.innerHeight - 60) + 'px';
    document.body.appendChild(tip);
    tipEl = tip;

    tipCloser = (e) => {
      if (tipEl && !tipEl.contains(e.target)) hideTip();
    };
    setTimeout(() => document.addEventListener('mousedown', tipCloser, true), 0);

    let suggestions;
    if (item.suggestions) {
      suggestions = item.suggestions.map(normSuggestion);
    } else {
      suggestions = (await getSuggestions(item.word)).map(normSuggestion);
      if (tipEl !== tip) return; // superseded while awaiting
    }
    tip.textContent = '';

    const meta = KIND_META[item.kind] || KIND_META.spell;
    const head = document.createElement('div');
    head.className = 'mn-spell-tip-head ' + meta.cls;
    head.textContent = item.display || item.word;
    tip.appendChild(head);

    const note = document.createElement('div');
    note.className = 'mn-spell-tip-note';
    note.textContent = meta.note;
    tip.appendChild(note);

    if (!suggestions.length) {
      const none = document.createElement('div');
      none.className = 'mn-spell-tip-none';
      none.textContent = 'Санал алга';
      tip.appendChild(none);
    }
    for (const s of suggestions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mn-spell-tip-item';
      btn.textContent = s.label;
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        hideTip();
        onPick(s.value);
      });
      tip.appendChild(btn);
    }

    // "Add to my dictionary" only makes sense for genuine spelling flags.
    if (!item.kind || item.kind === 'spell') {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'mn-spell-tip-add';
      add.textContent = '＋ Толинд нэмэх';
      add.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        hideTip();
        addIgnoreWord(item.word);
        if (onIgnore) onIgnore();
      });
      tip.appendChild(add);
    }
  }

  // ---- field classification ------------------------------------------------
  const controllers = new WeakMap();
  const liveControllers = new Set(); // iterable view for bulk re-check / teardown

  function rerunAll() {
    for (const c of liveControllers) c.scheduleCheck();
  }

  function destroyAll() {
    for (const c of [...liveControllers]) c.destroy();
  }

  function classify(el) {
    if (!el || el.closest('.mn-spell-tip')) return null;
    if (el.tagName === 'TEXTAREA') {
      return el.readOnly || el.disabled ? null : 'textarea';
    }
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (!['text', 'search'].includes(t)) return null;
      return el.readOnly || el.disabled ? null : 'input';
    }
    if (el.isContentEditable) return 'editable';
    return null;
  }

  // Combine spelling flags with the extra (homoglyph/repeat) flags, dropping any
  // spelling flag that overlaps an extra one (the extra flag covers the whole
  // word and carries a better suggestion), then order by position.
  function mergeFlags(spell, extra) {
    const kept = spell.filter(
      (s) => !extra.some((e) => s.start < e.end && e.start < s.end)
    );
    return [...kept, ...extra].sort((a, b) => a.start - b.start);
  }

  // For contenteditable, attach to the editing host (topmost editable ancestor).
  function editingHost(el) {
    let host = el;
    while (host.parentElement && host.parentElement.isContentEditable) {
      host = host.parentElement;
    }
    return host;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  // =========================================================================
  // Mirror overlay controller for <textarea> / <input>
  // =========================================================================
  const COPIED = [
    'boxSizing', 'width', 'height',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent',
    'textTransform', 'textAlign', 'direction',
  ];

  class MirrorController {
    constructor(el) {
      this.el = el;
      this.misspelled = [];
      this.timer = null;

      this.mirror = document.createElement('div');
      this.mirror.className = 'mn-spell-mirror';
      this.inner = document.createElement('div');
      this.inner.className = 'mn-spell-mirror-inner';
      this.mirror.appendChild(this.inner);
      document.body.appendChild(this.mirror);

      this.onInput = () => this.scheduleCheck();
      this.onScroll = () => this.syncScroll();
      this.onClick = (e) => this.handleClick(e);
      this.onReposition = () => this.reposition();

      el.addEventListener('input', this.onInput);
      el.addEventListener('scroll', this.onScroll);
      el.addEventListener('click', this.onClick);
      window.addEventListener('scroll', this.onReposition, true);
      window.addEventListener('resize', this.onReposition);
      this.ro = new ResizeObserver(() => this.onReposition());
      this.ro.observe(el);

      liveControllers.add(this);
      this.scheduleCheck();
    }

    destroy() {
      clearTimeout(this.timer);
      this.el.removeEventListener('input', this.onInput);
      this.el.removeEventListener('scroll', this.onScroll);
      this.el.removeEventListener('click', this.onClick);
      window.removeEventListener('scroll', this.onReposition, true);
      window.removeEventListener('resize', this.onReposition);
      this.ro.disconnect();
      this.mirror.remove();
      controllers.delete(this.el);
      liveControllers.delete(this);
    }

    reposition() {
      const el = this.el;
      if (!el.isConnected) return this.destroy();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        this.mirror.style.display = 'none';
        return;
      }
      const cs = getComputedStyle(el);
      const m = this.mirror;
      m.style.display = '';
      m.style.top = rect.top + 'px';
      m.style.left = rect.left + 'px';
      m.style.width = rect.width + 'px';
      m.style.height = rect.height + 'px';

      const inner = this.inner;
      for (const prop of COPIED) inner.style[prop] = cs[prop];
      inner.style.borderStyle = 'solid';
      inner.style.borderColor = 'transparent';
      inner.style.width = rect.width + 'px';
      inner.style.height = rect.height + 'px';

      const multiline = el.tagName === 'TEXTAREA';
      inner.style.whiteSpace = multiline ? 'pre-wrap' : 'pre';
      inner.style.overflowWrap = multiline ? 'break-word' : 'normal';
      this.syncScroll();
    }

    syncScroll() {
      this.inner.style.transform =
        `translate(${-this.el.scrollLeft}px, ${-this.el.scrollTop}px)`;
    }

    scheduleCheck() {
      clearTimeout(this.timer);
      hideTip();
      this.timer = setTimeout(() => this.runCheck(), DEBOUNCE_MS);
    }

    async runCheck() {
      const text = this.el.value;
      const { tokens, seen } = tokenize(text);
      let spell = [];
      if (seen.size) {
        const wrong = new Set(await checkWords([...seen]));
        spell = tokens
          .filter((t) => wrong.has(t.word) && !ignoreSet.has(t.word))
          .map((t) => ({ start: t.start, end: t.end, word: t.word, kind: 'spell' }));
      }
      this.misspelled = mergeFlags(spell, detectExtras(text));
      this.render(text);
    }

    render(text) {
      this.reposition();
      const inner = this.inner;
      inner.textContent = '';
      if (!this.misspelled.length) return;
      let cursor = 0;
      for (const t of this.misspelled) {
        if (t.start > cursor) {
          inner.appendChild(document.createTextNode(text.slice(cursor, t.start)));
        }
        const span = document.createElement('span');
        span.className = t.kind && t.kind !== 'spell' ? 'mn-spell-bad mn-spell-bad--warn' : 'mn-spell-bad';
        span.textContent = text.slice(t.start, t.end);
        inner.appendChild(span);
        cursor = t.end;
      }
      if (cursor < text.length) {
        inner.appendChild(document.createTextNode(text.slice(cursor)));
      }
      this.syncScroll();
    }

    handleClick(e) {
      const pos = this.el.selectionStart;
      const hit = this.misspelled.find((t) => pos >= t.start && pos <= t.end);
      if (hit) {
        showTip(hit, e.clientX, e.clientY,
          (s) => this.applyFix(hit, s),
          () => this.scheduleCheck());
      } else {
        hideTip();
      }
    }

    applyFix(token, replacement) {
      const el = this.el;
      const value = el.value;
      if (value.slice(token.start, token.end) !== token.word) return this.scheduleCheck();
      const next = value.slice(0, token.start) + replacement + value.slice(token.end);
      setNativeValue(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const caret = token.start + replacement.length;
      el.setSelectionRange(caret, caret);
      el.focus();
      this.scheduleCheck();
    }
  }

  // =========================================================================
  // Range/rect controller for contenteditable
  // =========================================================================
  class EditableController {
    constructor(host) {
      this.host = host;
      this.misspelled = []; // [{word, range, kind, ...}]
      this.timer = null;

      this.layer = document.createElement('div');
      this.layer.className = 'mn-spell-layer';
      document.body.appendChild(this.layer);

      this.onInput = () => this.scheduleCheck();
      this.onClick = (e) => this.handleClick(e);
      this.onReposition = () => this.draw();

      host.addEventListener('input', this.onInput);
      host.addEventListener('click', this.onClick);
      window.addEventListener('scroll', this.onReposition, true);
      window.addEventListener('resize', this.onReposition);
      this.ro = new ResizeObserver(() => this.onReposition());
      this.ro.observe(host);

      // Rich editors often change text without firing 'input' (paste handlers,
      // framework re-renders); watch the subtree so highlights stay in sync.
      this.mo = new MutationObserver(() => this.scheduleCheck());
      this.mo.observe(host, { childList: true, characterData: true, subtree: true });

      liveControllers.add(this);
      this.scheduleCheck();
    }

    destroy() {
      clearTimeout(this.timer);
      this.host.removeEventListener('input', this.onInput);
      this.host.removeEventListener('click', this.onClick);
      window.removeEventListener('scroll', this.onReposition, true);
      window.removeEventListener('resize', this.onReposition);
      this.ro.disconnect();
      this.mo.disconnect();
      this.layer.remove();
      controllers.delete(this.host);
      liveControllers.delete(this);
    }

    // Build the flat text plus a map of text-node segments for offset->Range.
    buildTextMap() {
      const segments = [];
      let text = '';
      const walker = document.createTreeWalker(this.host, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // Skip text inside non-editable islands and our own overlays.
          const p = node.parentElement;
          if (!p || p.closest('.mn-spell-layer, .mn-spell-tip')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node;
      while ((node = walker.nextNode())) {
        const value = node.nodeValue;
        segments.push({ node, start: text.length, end: text.length + value.length });
        text += value;
      }
      return { text, segments };
    }

    // Map a flat index to {node, offset} within the segment list.
    locate(segments, index) {
      for (const seg of segments) {
        if (index >= seg.start && index <= seg.end) {
          return { node: seg.node, offset: index - seg.start };
        }
      }
      return null;
    }

    rangeFor(segments, start, end) {
      const a = this.locate(segments, start);
      const b = this.locate(segments, end);
      if (!a || !b) return null;
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      return range;
    }

    scheduleCheck() {
      clearTimeout(this.timer);
      hideTip();
      this.timer = setTimeout(() => this.runCheck(), DEBOUNCE_MS);
    }

    async runCheck() {
      if (!this.host.isConnected) return this.destroy();
      const { text, segments } = this.buildTextMap();
      const { tokens, seen } = tokenize(text);

      const extras = detectExtras(text)
        .map((h) => ({ ...h, range: this.rangeFor(segments, h.start, h.end) }))
        .filter((h) => h.range);

      const spell = [];
      if (seen.size) {
        const wrong = new Set(await checkWords([...seen]));
        for (const t of tokens) {
          if (!wrong.has(t.word) || ignoreSet.has(t.word)) continue;
          if (extras.some((e) => t.start < e.end && e.start < t.end)) continue;
          const range = this.rangeFor(segments, t.start, t.end);
          if (range) spell.push({ start: t.start, end: t.end, word: t.word, kind: 'spell', range });
        }
      }

      this.misspelled = [...spell, ...extras].sort((a, b) => a.start - b.start);
      this.draw();
    }

    draw() {
      const layer = this.layer;
      layer.textContent = '';
      if (!this.misspelled.length) return;
      for (const item of this.misspelled) {
        let rects;
        try {
          rects = item.range.getClientRects();
        } catch {
          continue;
        }
        item.rects = [];
        for (const r of rects) {
          if (r.width === 0 || r.height === 0) continue;
          item.rects.push(r);
          const u = document.createElement('div');
          u.className = item.kind && item.kind !== 'spell'
            ? 'mn-spell-underline mn-spell-underline--warn'
            : 'mn-spell-underline';
          u.style.left = r.left + 'px';
          u.style.top = r.top + 'px';
          u.style.width = r.width + 'px';
          u.style.height = r.height + 'px';
          layer.appendChild(u);
        }
      }
    }

    handleClick(e) {
      // Hit-test the click against each flagged word's rectangles, so clicking
      // anywhere on the underlined word opens its suggestions (a tiny margin
      // makes the target easier to hit).
      const PAD = 3;
      for (const m of this.misspelled) {
        for (const r of (m.rects || [])) {
          if (
            e.clientX >= r.left - PAD && e.clientX <= r.right + PAD &&
            e.clientY >= r.top - PAD && e.clientY <= r.bottom + PAD
          ) {
            showTip(m, e.clientX, e.clientY,
              (s) => this.applyFix(m, s),
              () => this.scheduleCheck());
            return;
          }
        }
      }

      hideTip();
    }

    applyFix(item, replacement) {
      const range = item.range;
      let ok = false;
      try {
        ok = range && range.toString() === item.word;
      } catch { ok = false; }
      if (!ok) return this.scheduleCheck();
      range.deleteContents();
      if (replacement) range.insertNode(document.createTextNode(replacement));
      this.host.normalize();
      // Notify frameworks (many rich editors listen for input).
      this.host.dispatchEvent(new InputEvent('input', { bubbles: true }));
      this.host.focus();
      this.scheduleCheck();
    }
  }

  // ---- attach / lifecycle --------------------------------------------------
  function attach(el) {
    const kind = classify(el);
    if (!kind) return;
    if (kind === 'editable') {
      const host = editingHost(el);
      if (controllers.has(host)) return;
      controllers.set(host, new EditableController(host));
    } else {
      if (controllers.has(el)) return;
      controllers.set(el, new MirrorController(el));
    }
  }

  // Keep working on single-page apps: fields get swapped in/out without a page
  // reload, so watch the DOM and (re)attach the focused editor, dropping any
  // controllers whose element has been removed.
  let observeTimer = null;
  function startObserver() {
    const mo = new MutationObserver(() => {
      clearTimeout(observeTimer);
      observeTimer = setTimeout(() => {
        for (const c of [...liveControllers]) {
          const node = c.el || c.host;
          if (!node || !node.isConnected) c.destroy();
        }
        if (isActive() && document.activeElement) attach(document.activeElement);
      }, 400);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function boot() {
    await loadSettings();
    document.addEventListener('focusin', (e) => {
      if (isActive()) attach(e.target);
    });
    if (isActive() && document.activeElement) attach(document.activeElement);
    startObserver();
  }

  // React to popup toggles / dictionary edits without needing a page reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('mnEnabled' in changes) enabledGlobal = changes.mnEnabled.newValue !== false;
    if ('mnDisabledHosts' in changes) {
      siteDisabled = !!(changes.mnDisabledHosts.newValue || {})[HOST];
    }
    if ('mnIgnore' in changes) {
      ignoreSet.clear();
      for (const w of (changes.mnIgnore.newValue || [])) ignoreSet.add(w);
    }
    if (isActive()) {
      if (document.activeElement) attach(document.activeElement);
      rerunAll();
    } else {
      destroyAll();
    }
  });

  boot();
})();
