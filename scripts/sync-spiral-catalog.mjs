/**
 * Derives `paradigm/spiral-catalog.json` and Spiral-derived component templates
 * from a Spiral (developer-kit) checkout.
 *
 * The catalog is a *manifest*, never values: component display names, the design
 * side grouping, the component slug used as a Figma variable group, private CSS
 * custom properties, and — when Spiral declares them — appearance variant maps
 * from `cva({ variants })` / exported `DisplayNameMode|Style|…` unions.
 *
 *   node scripts/sync-spiral-catalog.mjs --spiral /path/to/developer-kit
 *   node scripts/sync-spiral-catalog.mjs --check      # fail if outputs are stale
 *
 * Primary listing is Storybook `title: "{group}/{Component}"` in
 * `packages/ui/src/components/*.stories.tsx`. `Foundation/Icons` is dropped.
 * Hand-curated templates under paradigm/templates/component/*.json win over
 * auto-generated axes (richer roles / exclude / extras).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  extractCvaVariants,
  extractExportedUnions,
  pickAppearance
} from './lib/spiral-variants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outCatalog = path.join(root, 'paradigm', 'spiral-catalog.json');
const outGenerated = path.join(root, 'paradigm', 'templates', 'from-spiral.json');
const curatedDir = path.join(root, 'paradigm', 'templates', 'component');
const registryFile = path.join(root, 'paradigm', 'templates', 'index.json');

const DEFAULT_SPIRAL_ROOTS = [
  '/agent/repos/spiral-2',
  path.resolve(root, '..', 'spiral-2'),
  path.resolve(root, '..', 'developer-kit'),
  path.resolve(root, '..', 'spiral')
];

/** Storybook entries that are not components. */
const NOT_A_COMPONENT = new Set(['Foundation/Icons']);

/** Shared part × state axes for Spiral-derived (non-stub) templates. */
const SHARED_ROLE = ['background', 'foreground', 'border', 'icon'];
const SHARED_STATE = ['rest', 'hover', 'active', 'disabled'];

const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const resolveSpiralRoot = () => {
  const explicit = option('spiral') ?? process.env.SPIRAL_ROOT;
  const candidates = explicit ? [explicit] : DEFAULT_SPIRAL_ROOTS;
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'packages', 'ui', 'src', 'components'))) {
      return candidate;
    }
  }
  throw new Error(
    `no Spiral checkout found. Pass --spiral <path> or set SPIRAL_ROOT. Tried:\n  ${candidates.join('\n  ')}`
  );
};

/** `NumberInput` → `numberInput`; the paradigm slot rule is camelCase. */
const toSlug = (displayName) => displayName[0].toLowerCase() + displayName.slice(1);

const toKebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const readStoryEntries = (componentsDir) => {
  /** @type {Array<{ group: string, displayName: string, storyPath: string }>} */
  const entries = [];
  const seen = new Set();
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
        const key = `${match[1]}/${match[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ group: match[1], displayName: match[2], storyPath: full });
      }
    }
  };
  walk(componentsDir);
  return entries.sort((a, b) =>
    `${a.group}/${a.displayName}`.localeCompare(`${b.group}/${b.displayName}`)
  );
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

/** Story displayName → source basename when it differs from kebab(displayName). */
const SOURCE_BASENAME_ALIASES = {
  Radio: 'radio-group'
};

const resolveComponentSource = (spiralRoot, storyPath, displayName) => {
  const componentsDir = path.join(spiralRoot, 'packages', 'ui', 'src', 'components');
  const kebab = SOURCE_BASENAME_ALIASES[displayName] ?? toKebab(displayName);
  const storyDir = path.dirname(storyPath);
  const candidates = [
    path.join(storyDir, `${kebab}.tsx`),
    path.join(storyDir, path.basename(storyPath).replace('.stories.tsx', '.tsx')),
    path.join(componentsDir, `${kebab}.tsx`),
    path.join(componentsDir, kebab, `${kebab}.tsx`)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

/** Context / sibling type files next to a folder component — not flat neighbors. */
const collectTypeSources = (srcPath) => {
  const texts = [fs.readFileSync(srcPath, 'utf8')];
  const dir = path.dirname(srcPath);
  // Flat files live in packages/ui/src/components/*.tsx — do not merge siblings.
  // Folder components (date-picker/date-picker.tsx) may keep types in *-context.tsx.
  if (path.basename(dir) !== 'components') {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(tsx?)$/.test(name)) continue;
      if (name.includes('.stories') || name.includes('.test')) continue;
      const full = path.join(dir, name);
      if (full === srcPath) continue;
      texts.push(fs.readFileSync(full, 'utf8'));
    }
  }
  return texts;
};

const readGitSha = (spiralRoot) => {
  try {
    return execSync('git rev-parse HEAD', { cwd: spiralRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const curatedSlugs = () => {
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  return new Set(
    registry.templates
      .filter((row) => row.kind === 'component')
      .map((row) => row.id.replace(/^spiral\./, ''))
  );
};

const buildGeneratedTemplate = (entry) => {
  const { displayName, slug, group, source, appearance } = entry;
  return {
    id: `spiral.${slug}`,
    kind: 'component',
    spiral: {
      displayName,
      group,
      source,
      variantProp: appearance.prop,
      appearanceVia: appearance.via
    },
    collection: 'component',
    modes: ['light', 'dark'],
    group: slug,
    shape: '{variant}-{role}-{state}',
    valueType: 'COLOR',
    axes: [
      {
        slot: 'variant',
        label: 'Appearance',
        labelZh: '外观',
        note: `Spiral ${displayName} «${appearance.prop}» (${appearance.via}), verbatim.`,
        values: appearance.values,
        default: appearance.values.slice(0, Math.min(2, appearance.values.length))
      },
      {
        slot: 'role',
        label: 'Part',
        labelZh: '部位',
        values: [...SHARED_ROLE],
        default: ['background', 'foreground']
      },
      {
        slot: 'state',
        label: 'State',
        labelZh: '状态',
        values: [...SHARED_STATE],
        default: ['rest', 'hover']
      }
    ],
    exclude: [],
    extras: [],
    note: 'Axes generated from Spiral source. Hand-curate for richer roles / exclude / extras.'
  };
};

const run = () => {
  const spiralRoot = resolveSpiralRoot();
  const componentsDir = path.join(spiralRoot, 'packages', 'ui', 'src', 'components');
  const semanticDir = path.join(spiralRoot, 'packages', 'tokens', 'src', 'semantic');
  const spiralSha = readGitSha(spiralRoot);

  const stories = readStoryEntries(componentsDir).filter(
    (entry) => !NOT_A_COMPONENT.has(`${entry.group}/${entry.displayName}`)
  );
  const cssByPrefix = readCssProperties(semanticDir);
  const curated = curatedSlugs();

  const groups = new Map();
  const components = stories.map((story) => {
    const { group, displayName } = story;
    const slug = toSlug(displayName);
    const prefixes = CSS_PREFIX_ALIASES[slug] ?? [slug.toLowerCase()];
    const cssProperties = [
      ...new Set(prefixes.flatMap((prefix) => [...(cssByPrefix.get(prefix) ?? [])]))
    ].sort();

    const srcPath = resolveComponentSource(spiralRoot, story.storyPath, displayName);
    const relSource = srcPath
      ? path.relative(spiralRoot, srcPath).replace(/\\/g, '/')
      : `packages/ui/src/components/${toKebab(displayName)}.tsx`;

    let appearance = null;
    let cvaKeys = [];
    if (srcPath) {
      const primary = fs.readFileSync(srcPath, 'utf8');
      const cvaVariants = extractCvaVariants(primary);
      if (cvaVariants) cvaKeys = Object.keys(cvaVariants);
      const unions = collectTypeSources(srcPath).flatMap(extractExportedUnions);
      appearance = pickAppearance(displayName, { cvaVariants, unions });
    }

    const bucket = groups.get(group) ?? [];
    bucket.push(displayName);
    groups.set(group, bucket);

    return {
      displayName,
      slug,
      group,
      source: relSource,
      cssPropertyCount: cssProperties.length,
      cssProperties,
      cvaKeys,
      appearance: appearance
        ? { prop: appearance.prop, values: appearance.values, via: appearance.via }
        : null,
      curated: curated.has(slug)
    };
  });

  const withAppearance = components.filter((c) => c.appearance);
  const stubs = components.filter((c) => !c.appearance && !c.curated);

  const catalog = {
    source: 'Spiral developer-kit — packages/ui/src/components/*.stories.tsx + cva/exported variant types',
    note: 'Manifest only. Values are never synced: the source of truth for a variable value is Figma, not npm.',
    generatedBy: 'scripts/sync-spiral-catalog.mjs',
    spiralCommit: spiralSha,
    componentCount: components.length,
    appearanceCount: withAppearance.length,
    stubCount: stubs.length,
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, members]) => ({ name, components: members.sort() })),
    components
  };

  /** Auto templates for catalog components that have Spiral appearance and are not curated. */
  const generated = {
    generatedBy: 'scripts/sync-spiral-catalog.mjs',
    spiralCommit: spiralSha,
    note: 'Spiral-derived appearance axes. Curated files in component/*.json override these.',
    templates: Object.fromEntries(
      components
        .filter((entry) => entry.appearance && !entry.curated)
        .map((entry) => [`spiral.${entry.slug}`, buildGeneratedTemplate(entry)])
    )
  };

  // Also drop per-slug JSON copies for review (never overwrite curated).
  const autoDir = path.join(curatedDir, 'auto');
  fs.mkdirSync(autoDir, { recursive: true });
  for (const name of fs.readdirSync(autoDir)) {
    if (name.endsWith('.json')) fs.unlinkSync(path.join(autoDir, name));
  }
  for (const [id, template] of Object.entries(generated.templates)) {
    const slug = id.replace(/^spiral\./, '');
    fs.writeFileSync(
      path.join(autoDir, `${slug}.json`),
      `${JSON.stringify(template, null, 2)}\n`,
      'utf8'
    );
  }

  return {
    catalogText: `${JSON.stringify(catalog, null, 2)}\n`,
    generatedText: `${JSON.stringify(generated, null, 2)}\n`,
    catalog,
    generated
  };
};

const { catalogText, generatedText, catalog, generated } = run();

const catalogStale =
  (fs.existsSync(outCatalog) ? fs.readFileSync(outCatalog, 'utf8') : '') !== catalogText;
const generatedStale =
  (fs.existsSync(outGenerated) ? fs.readFileSync(outGenerated, 'utf8') : '') !== generatedText;

if (process.argv.includes('--check')) {
  if (catalogStale || generatedStale) {
    process.stderr.write(
      'Spiral catalog / from-spiral templates are stale. Run: npm run spiral:catalog\n'
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('paradigm/spiral-catalog.json and from-spiral.json are up to date\n');
  }
} else {
  fs.writeFileSync(outCatalog, catalogText, 'utf8');
  fs.writeFileSync(outGenerated, generatedText, 'utf8');
  process.stdout.write(
    `wrote paradigm/spiral-catalog.json — ${catalog.componentCount} components, ${catalog.appearanceCount} with Spiral appearance, ${catalog.stubCount} stubs\n`
  );
  process.stdout.write(
    `wrote paradigm/templates/from-spiral.json — ${Object.keys(generated.templates).length} auto templates (+ component/auto/*.json)\n`
  );
}
