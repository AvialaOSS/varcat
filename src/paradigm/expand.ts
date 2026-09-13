/**
 * Expands the closed vocabulary into a write plan. Pure: no Figma API calls, so
 * the Dry-run CLI, the plugin and the tests all read the same expansion.
 */
import type { PaletteRamps } from '../palette/ramp';
import { validateInNamespace, type ValidationResult } from './validate';
import {
  componentMatrix,
  effectTables,
  getNamespace,
  NAMESPACE_KEYS,
  scaleTables,
  semanticAliases,
  type NamespaceKey,
  type ValueType
} from './vocabulary';

export type AliasRef = { namespace: NamespaceKey; path: string };

export type PlanEntry = {
  namespace: NamespaceKey;
  collection: string;
  path: string;
  valueType: ValueType;
  kind: 'literal' | 'alias';
  /** mode name → hex (COLOR) or number (FLOAT). Literal entries only. */
  values?: Record<string, string | number>;
  /** mode name → alias target. Alias entries only. */
  aliases?: Record<string, AliasRef>;
};

export type Plan = {
  entries: PlanEntry[];
  counts: Partial<Record<NamespaceKey, number>>;
  total: number;
  invalid: ValidationResult[];
};

export type ExpandOptions = {
  namespaces?: NamespaceKey[];
  palette?: PaletteRamps;
  /** Expand every legal effect path instead of only the enabled whitelist. */
  allEffects?: boolean;
};

const ALIAS_NAMESPACES = new Set<string>(NAMESPACE_KEYS);

export const parseAliasRef = (ref: string): AliasRef => {
  const [head, ...rest] = ref.split('/');
  if (!ALIAS_NAMESPACES.has(head) || rest.length === 0) {
    throw new Error(`alias "${ref}" must start with a namespace key and a path`);
  }
  return { namespace: head as NamespaceKey, path: rest.join('/') };
};

export const formatAliasRef = (ref: AliasRef): string => `${ref.namespace}/${ref.path}`;

const stepIndex = (step: string) => Number.parseInt(step.replace(/^s/, ''), 10) - 1;

const expandPalette = (ramps?: PaletteRamps): PlanEntry[] => {
  const namespace = getNamespace('palette');
  const allow = namespace.matrix.find((m) => m.key === 'family' && m.constrains === 'step')?.allow ?? {};
  const entries: PlanEntry[] = [];

  for (const family of namespace.slots.family) {
    for (const step of allow[family] ?? namespace.slots.step) {
      const ramp = ramps?.[family];
      const index = stepIndex(step);
      entries.push({
        namespace: 'palette',
        collection: namespace.collection,
        path: `${family}/${step}`,
        valueType: 'COLOR',
        kind: 'literal',
        values: ramp
          ? { light: ramp.light[index] ?? '#000000', dark: ramp.dark[index] ?? '#000000' }
          : {}
      });
    }
  }

  return entries;
};

const expandSemantic = (): PlanEntry[] => {
  const namespace = getNamespace('semantic');
  return Object.entries(semanticAliases.aliases).map(([path, byMode]) => ({
    namespace: 'semantic' as NamespaceKey,
    collection: namespace.collection,
    path,
    valueType: 'COLOR' as ValueType,
    kind: 'alias' as const,
    aliases: namespace.modes.reduce<Record<string, AliasRef>>((acc, mode) => {
      acc[mode] = parseAliasRef(byMode[mode]);
      return acc;
    }, {})
  }));
};

const expandScale = (key: 'scaleDensity' | 'scaleContrast' | 'scaleStatic'): PlanEntry[] => {
  const namespace = getNamespace(key);
  const table = scaleTables[key];
  const mode = namespace.modes[0];
  const entries: PlanEntry[] = [];

  for (const [category, steps] of Object.entries(table.values)) {
    for (const [step, value] of Object.entries(steps)) {
      entries.push({
        namespace: key,
        collection: namespace.collection,
        path: `${category}/${step}`,
        valueType: namespace.valueType,
        kind: 'literal',
        values: { [mode]: value }
      });
    }
  }

  return entries;
};

const expandComponent = (): PlanEntry[] => {
  const namespace = getNamespace('component');
  return componentMatrix.entries.map((entry) => ({
    namespace: 'component' as NamespaceKey,
    collection: namespace.collection,
    path: entry.path,
    valueType: 'COLOR' as ValueType,
    kind: 'alias' as const,
    aliases: namespace.modes.reduce<Record<string, AliasRef>>((acc, mode) => {
      acc[mode] = parseAliasRef(entry.alias);
      return acc;
    }, {})
  }));
};

const expandEffect = (key: 'effect' | 'effectSwitch', allEffects: boolean): PlanEntry[] => {
  const namespace = getNamespace(key);
  const table = effectTables[key];
  const enabled = namespace.enabled ?? Object.keys(table.values);
  const paths = allEffects
    ? (() => {
        const allow =
          namespace.matrix.find((m) => m.key === 'name' && m.constrains === 'position')?.allow ?? {};
        const out: string[] = [];
        for (const name of namespace.slots.name) {
          for (const position of allow[name] ?? namespace.slots.position) {
            out.push(`effect/${name}-${position}`);
          }
        }
        return out;
      })()
    : enabled;

  return paths.map((path) => ({
    namespace: key,
    collection: namespace.collection,
    path,
    valueType: 'COLOR' as ValueType,
    kind: 'literal' as const,
    values: namespace.modes.reduce<Record<string, string | number>>((acc, mode) => {
      const value = table.values[path]?.[mode];
      if (value) acc[mode] = value;
      return acc;
    }, {})
  }));
};

export const expandNamespace = (key: NamespaceKey, options: ExpandOptions = {}): PlanEntry[] => {
  switch (key) {
    case 'palette':
      return expandPalette(options.palette);
    case 'semantic':
      return expandSemantic();
    case 'scaleDensity':
    case 'scaleContrast':
    case 'scaleStatic':
      return expandScale(key);
    case 'component':
      return expandComponent();
    case 'effect':
    case 'effectSwitch':
      return expandEffect(key, options.allEffects === true);
    default:
      throw new Error(`unknown namespace ${key}`);
  }
};

/**
 * Expands the requested namespaces and re-validates every produced path against
 * the paradigm, so a bad data file fails the plan instead of the Figma file.
 */
export const expandPlan = (options: ExpandOptions = {}): Plan => {
  const keys = options.namespaces ?? NAMESPACE_KEYS;
  const entries: PlanEntry[] = [];
  const counts: Partial<Record<NamespaceKey, number>> = {};
  const invalid: ValidationResult[] = [];

  for (const key of keys) {
    const expanded = expandNamespace(key, options);
    counts[key] = expanded.length;
    for (const entry of expanded) {
      const result = validateInNamespace(entry.path, key);
      if (!result.valid) invalid.push(result);
      entries.push(entry);
    }
  }

  return { entries, counts, total: entries.length, invalid };
};

/** Path-only inventory, used by the dry-run CLI and the expansion snapshot test. */
export const inventory = (plan: Plan): Record<string, string[]> =>
  plan.entries.reduce<Record<string, string[]>>((acc, entry) => {
    const bucket = (acc[entry.namespace] ??= []);
    bucket.push(entry.path);
    return acc;
  }, {});
