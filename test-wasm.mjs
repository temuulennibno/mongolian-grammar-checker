import { loadModule } from 'hunspell-asm';
import fs from 'fs';
const t0 = Date.now();
const hunspellFactory = await loadModule();
const aff = hunspellFactory.mountBuffer(fs.readFileSync('dict/mn_MN.aff'), 'mn.aff');
const dic = hunspellFactory.mountBuffer(fs.readFileSync('dict/mn_MN.dic'), 'mn.dic');
const hunspell = hunspellFactory.create(aff, dic);
console.log('build ms:', Date.now()-t0, 'mem MB:', Math.round(process.memoryUsage().rss/1e6));
const tests = ['Монгол','улс','байна','сайн','хүн','хүүхэд','компьютер','аaкдф','сайхан','хотод','сурагч','байнга'];
for (const w of tests) {
  const t = Date.now();
  const ok = hunspell.spell(w);
  const sug = ok ? [] : hunspell.suggest(w).slice(0,5);
  console.log(`${ok?'OK ':'BAD'} ${w}  (${Date.now()-t}ms)`, sug.length?('-> '+sug.join(', ')):'');
}
