import { loadModule } from 'hunspell-asm';
window.runTest = async () => {
  try {
    const t0 = performance.now();
    const factory = await loadModule();
    const [aff, dic] = await Promise.all([
      fetch('mn_MN.aff').then(r => r.arrayBuffer()),
      fetch('mn_MN.dic').then(r => r.arrayBuffer()),
    ]);
    const a = factory.mountBuffer(new Uint8Array(aff), 'mn_MN.aff');
    const d = factory.mountBuffer(new Uint8Array(dic), 'mn_MN.dic');
    const h = factory.create(a, d);
    const tests = ['Монгол','улс','компьютер','аaкдф','байнга','сайхан'];
    console.log('MN_TEST build_ms=' + Math.round(performance.now() - t0));
    for (const w of tests) {
      const ok = h.spell(w);
      console.log('MN_TEST ' + (ok ? 'OK  ' : 'BAD ') + w + (ok ? '' : ' -> ' + h.suggest(w).slice(0,3).join(', ')));
    }
    console.log('MN_TEST COMPLETE');
    document.title = 'MN_DONE';
  } catch (e) {
    console.log('MN_TEST ERROR ' + (e && e.stack || e));
    document.title = 'MN_ERROR';
  }
};
window.runTest();
