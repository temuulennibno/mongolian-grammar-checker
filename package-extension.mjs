// Produces an upload-ready zip of ONLY the files Chrome needs at runtime
// (no node_modules, no build scripts, no demo/test). Output: web-store.zip
import { execFileSync } from 'child_process';
import { existsSync, rmSync, readFileSync } from 'fs';

const OUT = 'web-store.zip';

// Every path the manifest references, plus the dictionary and icons.
const INCLUDE = [
  'manifest.json',
  'dist/sw.js',
  'dist/content.js',
  'dist/popup.js',
  'src/content.css',
  'popup/popup.html',
  'popup/popup.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'dict/mn_MN.aff',
  'dict/mn_MN.dic',
  'dict/supplement.txt',
  'dict/LICENSE',
];

const missing = INCLUDE.filter((p) => !existsSync(p));
if (missing.length) {
  console.error('Missing files (run `npm run prepare-dist` first):\n  ' + missing.join('\n  '));
  process.exit(1);
}

if (existsSync(OUT)) rmSync(OUT);
execFileSync('zip', ['-X', OUT, ...INCLUDE], { stdio: 'inherit' });

const version = JSON.parse(readFileSync('manifest.json', 'utf8')).version;
console.log(`\n✅ Built ${OUT} (manifest version ${version}). Upload this to the Chrome Web Store.`);
