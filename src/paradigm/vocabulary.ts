import vocabularyJson from '../../paradigm/vocabulary.json';
import semanticAliasesJson from '../../paradigm/aliases/semantic-to-palette.json';
import componentMatrixJson from '../../paradigm/matrices/component.json';
import scaleDensityJson from '../../paradigm/scales/density.json';
import scaleContrastJson from '../../paradigm/scales/contrast.json';
import scaleStaticJson from '../../paradigm/scales/static.json';
import effectJson from '../../paradigm/effects/effect.json';
import effectSwitchJson from '../../paradigm/effects/effect-switch.json';

export type NamespaceKey =
  | 'palette'
  | 'semantic'
  | 'scaleDensity'
  | 'scaleContrast'
  | 'scaleStatic'
  | 'component'
  | 'effect'
  | 'effectSwitch';

export type ValueType = 'COLOR' | 'FLOAT' | 'STRING';
export type ValueKind = 'literal' | 'alias';

export type MatrixConstraint = {
  key: string;
  constrains: string;
  allow: Record<string, string[]>;
};

/** A namespace with `sameShapeAs` already merged in. */
export type Namespace = {
  key: NamespaceKey;
  collection: string;
  modes: string[];
  valueType: ValueType;
  valueKind: ValueKind;
  shape: string;
  groupSlot: string;
  leafSlots: string[];
  slots: Record<string, string[]>;
  matrix: MatrixConstraint[];
  aliasTarget?: NamespaceKey;
  whitelist?: string;
  enabled?: string[];
};

export type Vocabulary = {
  version: string;
  charset: string;
  rules: Array<{ id: string; title: string; detail: string }>;
  pluralSafeSlots: string[];
  /** Retired component type → its Spiral replacement, or null when there is none. */
  retiredTypes: Record<string, string | null>;
  namespaces: Record<NamespaceKey, Namespace>;
};

export type SemanticAliasTable = {
  target: string;
  count: number;
  aliases: Record<string, Record<string, string>>;
};

export type ComponentMatrixEntry = {
  path: string;
  type: string;
  component: string;
  level: string;
  role: string;
  state: string;
  alias: string;
};

export type ComponentMatrix = {
  target: string;
  count: number;
  types: string[];
  entries: ComponentMatrixEntry[];
};

export type ScaleTable = {
  collection: string;
  mode: string;
  values: Record<string, Record<string, number>>;
};

export type EffectTable = {
  collection: string;
  modes: string[];
  values: Record<string, Record<string, string>>;
};

const raw = vocabularyJson as any;

const resolveNamespace = (key: NamespaceKey): Namespace => {
  const entry = raw.namespaces[key];
  const base = entry.sameShapeAs ? raw.namespaces[entry.sameShapeAs] : undefined;
  return {
    key,
    collection: entry.collection,
    modes: entry.modes ?? base?.modes ?? [],
    valueType: entry.valueType ?? base?.valueType,
    valueKind: entry.valueKind ?? base?.valueKind,
    shape: entry.shape ?? base?.shape,
    groupSlot: entry.groupSlot ?? base?.groupSlot,
    leafSlots: entry.leafSlots ?? base?.leafSlots ?? [],
    slots: entry.slots ?? base?.slots ?? {},
    matrix: (entry.matrix ?? base?.matrix ?? []) as MatrixConstraint[],
    aliasTarget: entry.aliasTarget ?? base?.aliasTarget,
    whitelist: entry.whitelist ?? base?.whitelist,
    enabled: entry.enabled ?? base?.enabled
  };
};

export const NAMESPACE_KEYS: NamespaceKey[] = Object.keys(raw.namespaces) as NamespaceKey[];

export const vocabulary: Vocabulary = {
  version: raw.version,
  charset: raw.charset,
  rules: raw.rules,
  pluralSafeSlots: raw.pluralSafeSlots,
  retiredTypes: raw.retiredTypes ?? {},
  namespaces: NAMESPACE_KEYS.reduce((acc, key) => {
    acc[key] = resolveNamespace(key);
    return acc;
  }, {} as Record<NamespaceKey, Namespace>)
};

export const retiredTypes: Record<string, string | null> = vocabulary.retiredTypes;

export const semanticAliases = semanticAliasesJson as SemanticAliasTable;
export const componentMatrix = componentMatrixJson as ComponentMatrix;

export const scaleTables: Record<'scaleDensity' | 'scaleContrast' | 'scaleStatic', ScaleTable> = {
  scaleDensity: scaleDensityJson as ScaleTable,
  scaleContrast: scaleContrastJson as ScaleTable,
  scaleStatic: scaleStaticJson as ScaleTable
};

export const effectTables: Record<'effect' | 'effectSwitch', EffectTable> = {
  effect: effectJson as EffectTable,
  effectSwitch: effectSwitchJson as EffectTable
};

export const getNamespace = (key: NamespaceKey): Namespace => vocabulary.namespaces[key];
