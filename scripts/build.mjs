/**
 * Bundles the plugin. `dist/ui.html` inlines Spiral CSS + the UI bundle;
 * `dist/code.js` receives the HTML as the `UI_HTML` define.
 */
import { build } from 'esbuild';
import * as fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

await fs.mkdir(distDir, { recursive: true });

const spiralStylesPath = require.resolve('@aviala-design/spiral/styles.css');

const shared = {
  bundle: true,
  sourcemap: true,
  target: ['es2017'],
  logLevel: 'info',
  jsx: 'automatic'
};

const buildOnce = async () => {
  const spiralCss = await fs.readFile(spiralStylesPath, 'utf8');

  const uiResult = await build({
    ...shared,
    // Figma plugin UI is a data: iframe — sourceMappingURL fetch is CSP-blocked.
    sourcemap: false,
    entryPoints: [path.join(srcDir, 'ui', 'main.tsx')],
    outfile: path.join(distDir, 'ui.js'),
    format: 'iife',
    platform: 'browser',
    write: false,
    loader: {
      '.css': 'empty'
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });

  const uiJs = uiResult.outputFiles.find((file) => file.path.endsWith('ui.js'))?.text ?? '';
  await fs.writeFile(path.join(distDir, 'ui.js'), uiJs, 'utf8');

  // Must use function replacers — String.replace treats `$&` / `$1` in the
  // replacement as backrefs, and React's production bundle contains `$&/`
  // which would otherwise inject `</script>` into the HTML and dump the
  // rest of the bundle as visible page text.
  const inlineCss = spiralCss.replace(/<\/style/gi, '<\\/style');
  const inlineJs = uiJs
    .replace(/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+/g, '')
    .replace(/\/\*[#@]\s*sourceMappingURL\s*=\s*\S+\s*\*\//g, '')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');

  const template = await fs.readFile(path.join(srcDir, 'ui', 'ui.html'), 'utf8');
  const uiHtml = template
    .replace('/* __SPIRAL_CSS__ */', () => inlineCss)
    .replace('<script src="ui.js"></script>', () => `<script>${inlineJs}</script>`);
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
