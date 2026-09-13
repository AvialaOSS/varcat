/**
 * Runs src/cli/dry-run.ts without a TypeScript runtime: bundle to
 * dist/dry-run.mjs with esbuild, then import it. Arguments pass straight
 * through, e.g. `node scripts/dry-run.mjs --json`.
 */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist', 'dry-run.mjs');

await fs.mkdir(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'cli', 'dry-run.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node18'],
  logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);" }
});

await import(`file://${outfile}`);
