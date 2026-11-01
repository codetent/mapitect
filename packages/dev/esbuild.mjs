import * as esbuild from 'esbuild';

const ctx = await esbuild.context({
  entryPoints: ['harness.ts'],
  outfile: 'dist/harness.js', // and dist/harness.css
  bundle: true,
  sourcemap: true,
  platform: 'browser',
  format: 'iife',
  logLevel: 'info',
});

if (process.argv.includes('--watch')) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
