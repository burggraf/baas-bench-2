import { build } from 'esbuild';

await build({
  entryPoints: ['src/k6/conformance.js'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['k6', 'k6/*'],
  sourcemap: true,
});
