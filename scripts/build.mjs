/**
 * Bundles the plugin. `dist/ui.html` inlines the UI bundle and `dist/code.js`
 * receives it as the `UI_HTML` define, so the manifest only needs two files.
 */
import { build } from 'esbuild';
import * as fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

await fs.mkdir(distDir, { recursive: true });

const shared = { bundle: true, sourcemap: true, target: ['es2017'], logLevel: 'info' };

const buildOnce = async () => {
  const uiResult = await build({
    ...shared,
    entryPoints: [path.join(srcDir, 'ui', 'ui.ts')],
    outfile: path.join(distDir, 'ui.js'),
    format: 'iife',
    platform: 'browser',
    write: false
  });

  const uiJs = uiResult.outputFiles.find((file) => file.path.endsWith('ui.js'))?.text ?? '';
  await fs.writeFile(path.join(distDir, 'ui.js'), uiJs, 'utf8');

  const template = await fs.readFile(path.join(srcDir, 'ui', 'ui.html'), 'utf8');
  const uiHtml = template.replace('<script src="ui.js"></script>', `<script>${uiJs}</script>`);
  await fs.writeFile(path.join(distDir, 'ui.html'), uiHtml, 'utf8');

  await build({
    ...shared,
    entryPoints: [path.join(srcDir, 'code.ts')],
    outfile: path.join(distDir, 'code.js'),
    format: 'iife',
    platform: 'browser',
    define: { UI_HTML: JSON.stringify(uiHtml) }
  });
};

await buildOnce();

if (!watch) process.exit(0);

let timer = null;
let busy = false;

fsSync.watch(srcDir, { recursive: true }, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (busy) return;
    busy = true;
    try {
      await buildOnce();
    } catch (error) {
      process.stderr.write(`${error}\n`);
    } finally {
      busy = false;
    }
  }, 80);
});

process.stdout.write('watching...\n');
