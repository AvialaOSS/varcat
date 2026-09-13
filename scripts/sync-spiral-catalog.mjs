/**
 * Derives `paradigm/spiral-catalog.json` from a Spiral (developer-kit) checkout.
 *
 * The catalog is a *manifest*, never values: component display names, the design
 * side grouping, the component slug used as a Figma variable group, and the
 * private CSS custom properties the component already declares. Token values stay
 * in Figma; this script deliberately reads no color.
 *
 *   node scripts/sync-spiral-catalog.mjs --spiral /path/to/developer-kit
 *   node scripts/sync-spiral-catalog.mjs --check      # fail if the file is stale
 *
 * Primary source is the Storybook `title: "{group}/{Component}"` in
 * `packages/ui/src/components/*.stories.tsx` — the only listing that carries the
 * design side grouping. `Foundation/Icons` is dropped: icons are not a component.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'paradigm', 'spiral-catalog.json');

const DEFAULT_SPIRAL_ROOTS = [
  '/agent/repos/spiral-2',
  path.resolve(root, '..', 'spiral-2'),
  path.resolve(root, '..', 'developer-kit'),
  path.resolve(root, '..', 'spiral')
];

/** Storybook entries that are not components. */
const NOT_A_COMPONENT = new Set(['Foundation/Icons']);

const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const resolveSpiralRoot = () => {
  const explicit = option('spiral') ?? process.env.SPIRAL_ROOT;
  const candidates = explicit ? [explicit] : DEFAULT_SPIRAL_ROOTS;
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'packages', 'ui', 'src', 'components'))) return candidate;
  }
  throw new Error(
    `no Spiral checkout found. Pass --spiral <path> or set SPIRAL_ROOT. Tried:\n  ${candidates.join('\n  ')}`
  );
};

/** `NumberInput` → `numberInput`; the paradigm slot rule is camelCase. */
const toSlug = (displayName) => displayName[0].toLowerCase() + displayName.slice(1);

const readStoryTitles = (componentsDir) => {
  const titles = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.stories.tsx')) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(/title:\s*["']([A-Za-z ]+)\/([A-Za-z]+)["']/g)) {
        titles.add(`${match[1]}/${match[2]}`);
      }
    }
  };
  walk(componentsDir);
  return [...titles].sort();
};

/**
 * `--button-primary-bg-hover` → `button`. Groups the semantic effect CSS by the
 * component prefix so a template author can see which private tokens exist.
 */
const readCssProperties = (semanticDir) => {
  const byPrefix = new Map();
  if (!fs.existsSync(semanticDir)) return byPrefix;
  for (const name of fs.readdirSync(semanticDir).sort()) {
    if (!name.endsWith('.css')) continue;
    const source = fs.readFileSync(path.join(semanticDir, name), 'utf8');
    for (const match of source.matchAll(/^\s*(--[a-z][a-zA-Z0-9-]*)\s*:/gm)) {
      const property = match[1];
      const prefix = property.slice(2).split('-')[0];
      const bucket = byPrefix.get(prefix) ?? new Set();
      bucket.add(property);
      byPrefix.set(prefix, bucket);
    }
  }
  return byPrefix;
};

/**
 * Kebab CSS prefixes vs camelCase slugs: `--number-input-*` would bucket under
 * `number`. Only the single-word head is reliable, so multi-word slugs get an
 * explicit alias here.
 */
const CSS_PREFIX_ALIASES = {
  numberInput: ['number'],
  colorPicker: ['color'],
  datePicker: ['datepicker', 'date'],
  timePicker: ['time'],
  scrollPicker: ['scroll'],
  formField: ['form'],
  hoverPopover: ['hover'],
  responsiveTooltip: ['responsive'],
  input: ['input', 'basic']
};

const run = () => {
  const spiralRoot = resolveSpiralRoot();
  const componentsDir = path.join(spiralRoot, 'packages', 'ui', 'src', 'components');
  const semanticDir = path.join(spiralRoot, 'packages', 'tokens', 'src', 'semantic');

  const titles = readStoryTitles(componentsDir).filter((title) => !NOT_A_COMPONENT.has(title));
  const cssByPrefix = readCssProperties(semanticDir);

  const groups = new Map();
  const components = titles.map((title) => {
    const [group, displayName] = title.split('/');
    const slug = toSlug(displayName);
    const prefixes = CSS_PREFIX_ALIASES[slug] ?? [slug.toLowerCase()];
    const cssProperties = [
      ...new Set(prefixes.flatMap((prefix) => [...(cssByPrefix.get(prefix) ?? [])]))
    ].sort();
    const bucket = groups.get(group) ?? [];
    bucket.push(displayName);
    groups.set(group, bucket);
    return {
      displayName,
      slug,
      group,
      source: `packages/ui/src/components/${displayName
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}.tsx`,
      cssPropertyCount: cssProperties.length,
      cssProperties
    };
  });

  const catalog = {
    source: 'Spiral developer-kit — packages/ui/src/components/*.stories.tsx',
    note: 'Manifest only. Values are never synced: the source of truth for a variable value is Figma, not npm.',
    generatedBy: 'scripts/sync-spiral-catalog.mjs',
    componentCount: components.length,
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, members]) => ({ name, components: members.sort() })),
    components
  };

  return `${JSON.stringify(catalog, null, 2)}\n`;
};

const next = run();

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== next) {
    process.stderr.write(
      'paradigm/spiral-catalog.json is stale. Run: npm run spiral:catalog\n'
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('paradigm/spiral-catalog.json is up to date\n');
  }
} else {
  fs.writeFileSync(outFile, next, 'utf8');
  const catalog = JSON.parse(next);
  process.stdout.write(
    `wrote paradigm/spiral-catalog.json — ${catalog.componentCount} components across ${catalog.groups.length} groups\n`
  );
}
