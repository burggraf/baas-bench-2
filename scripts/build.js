import { build } from 'esbuild';

await build({
  entryPoints: ['src/k6/conformance.js', 'src/k6/social.js', 'src/k6/auth.js', 'src/k6/calibration.js'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['k6', 'k6/*'],
  sourcemap: true,
});

// Avoid initializing the unused PocketBase SDK in every TrailBase VU.
await build({
  entryPoints: { 'social-trailbase': 'src/k6/social.js' },
  outdir: 'dist', bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['k6', 'k6/*'], sourcemap: true,
  define: { '__ENV.BENCH_BACKEND': '"trailbase"' },
});
