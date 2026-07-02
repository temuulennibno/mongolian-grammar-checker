import { build } from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser', // honors hunspell-asm's "browser" field (inlined wasm)
  // Prefer the CommonJS "main" build over "module". hunspell-asm's ESM build
  // does `import * as nanoid; nanoid()`, which crashes once bundled (nanoid 2.x
  // is CJS-only). The CJS build uses `require('nanoid')` -> callable function.
  // "browser" stays first so the node->browser glue remap (inlined wasm) wins.
  mainFields: ['browser', 'main'],
  target: 'chrome110',
  legalComments: 'none',
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/sw.js'],
  outfile: 'dist/sw.js',
});

await build({
  ...common,
  entryPoints: ['src/content.js'],
  outfile: 'dist/content.js',
});

await build({
  ...common,
  entryPoints: ['popup/popup.js'],
  outfile: 'dist/popup.js',
});

console.log('Build complete → dist/sw.js, dist/content.js, dist/popup.js');
