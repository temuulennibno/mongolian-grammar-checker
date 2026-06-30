(() => {
  // src/content.js
  (() => {
    const MN_WORD = /[А-Яа-яЁёӨөҮү]+/g;
    const DEBOUNCE_MS = 300;
    let port = null;
    let msgId = 0;
    const pending = /* @__PURE__ */ new Map();
    function connect() {
      port = chrome.runtime.connect({ name: "mn-spell" });
      port.onMessage.addListener((msg) => {
        const resolve = pending.get(msg.id);
        if (resolve) {
          pending.delete(msg.id);
          resolve(msg);
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        for (const [, resolve] of pending) resolve({ ok: false, error: "disconnected" });
        pending.clear();
      });
      send({ type: "ping" }).catch(() => {
      });
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
      const res = await send({ type: "check", words });
      return res.ok ? res.wrong : [];
    }
    async function getSuggestions(word) {
      const res = await send({ type: "suggest", word });
      return res.ok ? res.suggestions : [];
    }
    const ADJACENT = /[A-Za-z0-9_@./\\-]/;
    function tokenize(text) {
      const tokens = [];
      const seen = /* @__PURE__ */ new Set();
      let m;
      MN_WORD.lastIndex = 0;
      while ((m = MN_WORD.exec(text)) !== null) {
        const word = m[0];
        const start = m.index;
        const end = start + word.length;
        if (word.length < 2) continue;
        const before = start > 0 ? text[start - 1] : "";
        const after = end < text.length ? text[end] : "";
        if (ADJACENT.test(before) || ADJACENT.test(after)) continue;
        tokens.push({ start, end, word });
        seen.add(word);
      }
      return { tokens, seen };
    }
    let tipEl = null;
    let tipCloser = null;
    function hideTip() {
      if (tipEl) {
        tipEl.remove();
        tipEl = null;
      }
      if (tipCloser) {
        document.removeEventListener("mousedown", tipCloser, true);
        tipCloser = null;
      }
    }
    async function showTip(word, x, y, onPick) {
      hideTip();
      const tip = document.createElement("div");
      tip.className = "mn-spell-tip";
      tip.textContent = "\u2026";
      tip.style.left = Math.min(x, window.innerWidth - 230) + "px";
      tip.style.top = Math.min(y + 14, window.innerHeight - 60) + "px";
      document.body.appendChild(tip);
      tipEl = tip;
      tipCloser = (e) => {
        if (tipEl && !tipEl.contains(e.target)) hideTip();
      };
      setTimeout(() => document.addEventListener("mousedown", tipCloser, true), 0);
      const suggestions = await getSuggestions(word);
      if (tipEl !== tip) return;
      tip.textContent = "";
      const head = document.createElement("div");
      head.className = "mn-spell-tip-head";
      head.textContent = word;
      tip.appendChild(head);
      if (!suggestions.length) {
        const none = document.createElement("div");
        none.className = "mn-spell-tip-none";
        none.textContent = "\u0421\u0430\u043D\u0430\u043B \u0430\u043B\u0433\u0430";
        tip.appendChild(none);
        return;
      }
      for (const s of suggestions) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "mn-spell-tip-item";
        item.textContent = s;
        item.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          hideTip();
          onPick(s);
        });
        tip.appendChild(item);
      }
    }
    const controllers = /* @__PURE__ */ new WeakMap();
    function classify(el) {
      if (!el || el.closest(".mn-spell-tip")) return null;
      if (el.tagName === "TEXTAREA") {
        return el.readOnly || el.disabled ? null : "textarea";
      }
      if (el.tagName === "INPUT") {
        const t = (el.type || "text").toLowerCase();
        if (!["text", "search"].includes(t)) return null;
        return el.readOnly || el.disabled ? null : "input";
      }
      if (el.isContentEditable) return "editable";
      return null;
    }
    function editingHost(el) {
      let host = el;
      while (host.parentElement && host.parentElement.isContentEditable) {
        host = host.parentElement;
      }
      return host;
    }
    function setNativeValue(el, value) {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    const COPIED = [
      "boxSizing",
      "width",
      "height",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "fontVariant",
      "lineHeight",
      "letterSpacing",
      "wordSpacing",
      "textIndent",
      "textTransform",
      "textAlign",
      "direction"
    ];
    class MirrorController {
      constructor(el) {
        this.el = el;
        this.misspelled = [];
        this.timer = null;
        this.mirror = document.createElement("div");
        this.mirror.className = "mn-spell-mirror";
        this.inner = document.createElement("div");
        this.inner.className = "mn-spell-mirror-inner";
        this.mirror.appendChild(this.inner);
        document.body.appendChild(this.mirror);
        this.onInput = () => this.scheduleCheck();
        this.onScroll = () => this.syncScroll();
        this.onClick = (e) => this.handleClick(e);
        this.onReposition = () => this.reposition();
        el.addEventListener("input", this.onInput);
        el.addEventListener("scroll", this.onScroll);
        el.addEventListener("click", this.onClick);
        window.addEventListener("scroll", this.onReposition, true);
        window.addEventListener("resize", this.onReposition);
        this.ro = new ResizeObserver(() => this.onReposition());
        this.ro.observe(el);
        this.scheduleCheck();
      }
      destroy() {
        clearTimeout(this.timer);
        this.el.removeEventListener("input", this.onInput);
        this.el.removeEventListener("scroll", this.onScroll);
        this.el.removeEventListener("click", this.onClick);
        window.removeEventListener("scroll", this.onReposition, true);
        window.removeEventListener("resize", this.onReposition);
        this.ro.disconnect();
        this.mirror.remove();
        controllers.delete(this.el);
      }
      reposition() {
        const el = this.el;
        if (!el.isConnected) return this.destroy();
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          this.mirror.style.display = "none";
          return;
        }
        const cs = getComputedStyle(el);
        const m = this.mirror;
        m.style.display = "";
        m.style.top = rect.top + "px";
        m.style.left = rect.left + "px";
        m.style.width = rect.width + "px";
        m.style.height = rect.height + "px";
        const inner = this.inner;
        for (const prop of COPIED) inner.style[prop] = cs[prop];
        inner.style.borderStyle = "solid";
        inner.style.borderColor = "transparent";
        inner.style.width = rect.width + "px";
        inner.style.height = rect.height + "px";
        const multiline = el.tagName === "TEXTAREA";
        inner.style.whiteSpace = multiline ? "pre-wrap" : "pre";
        inner.style.overflowWrap = multiline ? "break-word" : "normal";
        this.syncScroll();
      }
      syncScroll() {
        this.inner.style.transform = `translate(${-this.el.scrollLeft}px, ${-this.el.scrollTop}px)`;
      }
      scheduleCheck() {
        clearTimeout(this.timer);
        hideTip();
        this.timer = setTimeout(() => this.runCheck(), DEBOUNCE_MS);
      }
      async runCheck() {
        const text = this.el.value;
        const { tokens, seen } = tokenize(text);
        if (seen.size === 0) {
          this.misspelled = [];
          this.render("");
          return;
        }
        const wrong = new Set(await checkWords([...seen]));
        this.misspelled = tokens.filter((t) => wrong.has(t.word));
        this.render(text);
      }
      render(text) {
        this.reposition();
        const inner = this.inner;
        inner.textContent = "";
        if (!this.misspelled.length) return;
        let cursor = 0;
        for (const t of this.misspelled) {
          if (t.start > cursor) {
            inner.appendChild(document.createTextNode(text.slice(cursor, t.start)));
          }
          const span = document.createElement("span");
          span.className = "mn-spell-bad";
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
        if (hit) showTip(hit.word, e.clientX, e.clientY, (s) => this.applyFix(hit, s));
        else hideTip();
      }
      applyFix(token, replacement) {
        const el = this.el;
        const value = el.value;
        if (value.slice(token.start, token.end) !== token.word) return this.scheduleCheck();
        const next = value.slice(0, token.start) + replacement + value.slice(token.end);
        setNativeValue(el, next);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        const caret = token.start + replacement.length;
        el.setSelectionRange(caret, caret);
        el.focus();
        this.scheduleCheck();
      }
    }
    class EditableController {
      constructor(host) {
        this.host = host;
        this.misspelled = [];
        this.timer = null;
        this.layer = document.createElement("div");
        this.layer.className = "mn-spell-layer";
        document.body.appendChild(this.layer);
        this.onInput = () => this.scheduleCheck();
        this.onClick = (e) => this.handleClick(e);
        this.onReposition = () => this.draw();
        host.addEventListener("input", this.onInput);
        host.addEventListener("click", this.onClick);
        window.addEventListener("scroll", this.onReposition, true);
        window.addEventListener("resize", this.onReposition);
        this.ro = new ResizeObserver(() => this.onReposition());
        this.ro.observe(host);
        this.scheduleCheck();
      }
      destroy() {
        clearTimeout(this.timer);
        this.host.removeEventListener("input", this.onInput);
        this.host.removeEventListener("click", this.onClick);
        window.removeEventListener("scroll", this.onReposition, true);
        window.removeEventListener("resize", this.onReposition);
        this.ro.disconnect();
        this.layer.remove();
        controllers.delete(this.host);
      }
      // Build the flat text plus a map of text-node segments for offset->Range.
      buildTextMap() {
        const segments = [];
        let text = "";
        const walker = document.createTreeWalker(this.host, NodeFilter.SHOW_TEXT, {
          acceptNode: (node2) => {
            const p = node2.parentElement;
            if (!p || p.closest(".mn-spell-layer, .mn-spell-tip")) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let node;
        while (node = walker.nextNode()) {
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
        if (seen.size === 0) {
          this.misspelled = [];
          this.draw();
          return;
        }
        const wrong = new Set(await checkWords([...seen]));
        this.misspelled = [];
        for (const t of tokens) {
          if (!wrong.has(t.word)) continue;
          const range = this.rangeFor(segments, t.start, t.end);
          if (range) this.misspelled.push({ word: t.word, range });
        }
        this.draw();
      }
      draw() {
        const layer = this.layer;
        layer.textContent = "";
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
            const u = document.createElement("div");
            u.className = "mn-spell-underline";
            u.style.left = r.left + "px";
            u.style.top = r.top + "px";
            u.style.width = r.width + "px";
            u.style.height = r.height + "px";
            layer.appendChild(u);
          }
        }
      }
      handleClick(e) {
        const { segments } = this.buildTextMap();
        const PAD = 3;
        for (const m of this.misspelled) {
          for (const r of m.rects || []) {
            if (e.clientX >= r.left - PAD && e.clientX <= r.right + PAD && e.clientY >= r.top - PAD && e.clientY <= r.bottom + PAD) {
              const token = this.tokenForWord(segments, m);
              if (token) {
                showTip(m.word, e.clientX, e.clientY, (s) => this.applyFix(segments, token, s));
                return;
              }
            }
          }
        }
        hideTip();
      }
      // Find the flat-text token matching a misspelled item, preferring the one
      // whose range starts at the same place (handles repeated words correctly).
      tokenForWord(segments, item) {
        const { text } = this.buildTextMap();
        const { tokens } = tokenize(text);
        const candidates = tokens.filter((t) => t.word === item.word);
        if (!candidates.length) return null;
        for (const t of candidates) {
          const range = this.rangeFor(segments, t.start, t.end);
          if (range && range.compareBoundaryPoints(Range.START_TO_START, item.range) === 0) {
            return t;
          }
        }
        return candidates[0];
      }
      applyFix(segments, token, replacement) {
        const range = this.rangeFor(segments, token.start, token.end);
        if (!range || range.toString() !== token.word) return this.scheduleCheck();
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        this.host.normalize();
        this.host.dispatchEvent(new InputEvent("input", { bubbles: true }));
        this.host.focus();
        this.scheduleCheck();
      }
    }
    function attach(el) {
      const kind = classify(el);
      if (!kind) return;
      if (kind === "editable") {
        const host = editingHost(el);
        if (controllers.has(host)) return;
        controllers.set(host, new EditableController(host));
      } else {
        if (controllers.has(el)) return;
        controllers.set(el, new MirrorController(el));
      }
    }
    document.addEventListener("focusin", (e) => attach(e.target));
    if (document.activeElement) attach(document.activeElement);
  })();
})();
