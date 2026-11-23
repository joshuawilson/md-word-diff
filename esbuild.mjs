import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/vscode/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
});

await esbuild.build({
  entryPoints: ['media/webview.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
});
