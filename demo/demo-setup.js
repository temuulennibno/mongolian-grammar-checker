// Demo shim: runs the SAME spell-check engine the extension's service worker
// uses, but inside the page, and exposes a minimal `chrome.*` API so the real,
// unmodified content script (content.js) works without an extension installed.

import { loadModule } from 'hunspell-asm';

let hun = null;
let ready = null;

async function init() {
  if (ready) return ready;
  ready = (async () => {
    const factory = await loadModule();
    const [aff, dic] = await Promise.all([
      fetch('mn_MN.aff').then((r) => r.arrayBuffer()),
      fetch('mn_MN.dic').then((r) => r.arrayBuffer()),
    ]);
    hun = factory.create(
      factory.mountBuffer(new Uint8Array(aff), 'mn_MN.aff'),
      factory.mountBuffer(new Uint8Array(dic), 'mn_MN.dic')
    );
    window.dispatchEvent(new Event('mn-ready'));
  })();
  return ready;
}

async function handle(message) {
  await init();
  if (message.type === 'check') {
    return { ok: true, wrong: (message.words || []).filter((w) => !hun.spell(w)) };
  }
  if (message.type === 'suggest') {
    return { ok: true, suggestions: hun.suggest(message.word).slice(0, 8) };
  }
  return { ok: true };
}

// Minimal chrome.* shim covering exactly what content.js touches.
window.chrome = {
  runtime: {
    connect() {
      const listeners = [];
      return {
        name: 'mn-spell',
        onMessage: { addListener: (f) => listeners.push(f) },
        onDisconnect: { addListener() {} },
        postMessage: async (m) => {
          const res = await handle(m);
          listeners.forEach((l) => l({ id: m.id, ...res }));
        },
      };
    },
    getURL: (p) => p,
    onMessage: { addListener() {} },
    onConnect: { addListener() {} },
  },
  storage: { session: { get: async () => ({}) } },
  action: { setBadgeText() {} },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
};

init();
