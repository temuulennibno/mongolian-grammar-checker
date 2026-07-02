// Assembles the self-contained demo/ folder: bundles the engine+shim, and
// copies the real content script, styles and dictionary alongside it so the
// folder can be served statically with no extension install.
import { build } from 'esbuild';
import { copyFileSync, existsSync } from 'fs';

if (!existsSync('dist/content.js')) {
  console.error('dist/content.js missing. Run `npm run build` first.');
  process.exit(1);
}

await build({
  entryPoints: ['demo/demo-setup.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  mainFields: ['browser', 'main'], // CJS path avoids the nanoid namespace bug
  target: 'chrome110',
  legalComments: 'none',
  outfile: 'demo/demo-setup.bundle.js',
});

copyFileSync('dist/content.js', 'demo/content.js');
copyFileSync('src/content.css', 'demo/content.css');
copyFileSync('dict/mn_MN.aff', 'demo/mn_MN.aff');
copyFileSync('dict/mn_MN.dic', 'demo/mn_MN.dic');
copyFileSync('dict/supplement.txt', 'demo/supplement.txt');

console.log('Demo ready in demo/. Serve it, e.g.:');
console.log('  npx serve demo   (or)   python3 -m http.server -d demo 8000');
