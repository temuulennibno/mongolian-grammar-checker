import { build } from 'esbuild';
await build({
  entryPoints: ['test/standalone.js'],
  bundle: true, format: 'iife', platform: 'browser',
  mainFields: ['browser','main'], target: 'chrome110',
  outfile: 'test/standalone.bundle.js', legalComments: 'none',
});
console.log('test bundle built');
