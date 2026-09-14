/**
 * Dev-only: writes `dist/preview.html` — the built panel plus the
 * `scripts/preview/harness.ts` stand-in for the Figma main thread — so the UI
 * can be opened in a normal browser. Run `npm run build` first; this never
 * touches `dist/ui.html` or `dist/code.js`.
 */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');

const uiHtml = await fs.readFile(path.join(distDir, 'ui.html'), 'utf8');

const harness = await build({
  entryPoints: [path.join(root, 'scripts', 'preview', 'harness.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  sourcemap: false,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' }
});

const harnessJs = harness.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// Must run before the panel bundle: the panel posts `init` on mount, so the
// harness has to already be listening.
const preview = uiHtml.replace(
  '<div id="root"></div>',
  () => `<script>${harnessJs}</script>\n    <div id="root"></div>`
);

await fs.writeFile(path.join(distDir, 'preview.html'), preview, 'utf8');
process.stdout.write('dist/preview.html\n');
