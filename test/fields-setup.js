import { loadModule } from 'hunspell-asm';
let hun = null, ready = null;
async function init() {
  if (ready) return ready;
  ready = (async () => {
    const f = await loadModule();
    const [a, d] = await Promise.all([
      fetch('mn_MN.aff').then(r => r.arrayBuffer()),
      fetch('mn_MN.dic').then(r => r.arrayBuffer()),
    ]);
    hun = f.create(f.mountBuffer(new Uint8Array(a), 'mn_MN.aff'), f.mountBuffer(new Uint8Array(d), 'mn_MN.dic'));
    console.log('MN_ENGINE ready');
  })();
  return ready;
}
async function handle(msg) {
  await init();
  if (msg.type === 'check') return { ok: true, wrong: (msg.words || []).filter(w => !hun.spell(w)) };
  if (msg.type === 'suggest') return { ok: true, suggestions: hun.suggest(msg.word).slice(0, 8) };
  return { ok: true };
}
window.chrome = {
  runtime: {
    connect() {
      const ls = [];
      return {
        name: 'mn-spell',
        onMessage: { addListener: f => ls.push(f) },
        onDisconnect: { addListener() {} },
        postMessage: async m => { const r = await handle(m); ls.forEach(l => l({ id: m.id, ...r })); },
      };
    },
    getURL: p => p, onMessage: { addListener() {} }, onConnect: { addListener() {} },
  },
  storage: { session: { get: async () => ({}) } },
  action: { setBadgeText() {} },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
};
init();
