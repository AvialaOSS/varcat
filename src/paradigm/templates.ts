/**
 * Template layer. A template is an opt-in slice of the paradigm; a selection is
 * a template plus the axis values the user ticked. Expanding a selection yields
 * `unbound` plan entries: path and type only, no value for any mode.
 *
 * Pure, like the rest of `src/paradigm`: no Figma API and no IO, so the UI, the
 * dry-run CLI and vitest all read the same expansion.
 *
 * Adding a component template means adding the JSON file, registering it in
 * `paradigm/templates/index.json` and adding the static import below — esbuild
 * bundles the JSON, so a glob is not an option.
 */
import registryJson from '../../paradigm/templates/index.json';
import spiralCatalogJson from '../../paradigm/spiral-catalog.json';
import layerPalette from '../../paradigm/templates/layer/palette.json';
import layerSemantic from '../../paradigm/templates/layer/semantic.json';
import layerScaleStatic from '../../paradigm/templates/layer/scale-static.json';
import layerScaleDensity from '../../paradigm/templates/layer/scale-density.json';
import layerScaleContrast from '../../paradigm/templates/layer/scale-contrast.json';
import layerEffect from '../../paradigm/templates/layer/effect.json';
import layerEffectSwitch from '../../paradigm/templates/layer/effect-switch.json';
import componentButton from '../../paradigm/templates/component/button.json';
import componentInput from '../../paradigm/templates/component/input.json';
import componentSwitch from '../../paradigm/templates/component/switch.json';
import componentSegmentator from '../../paradigm/templates/component/segmentator.json';
import componentTab from '../../paradigm/templates/component/tab.json';
import componentBadge from '../../paradigm/templates/component/badge.json';
import componentTag from '../../paradigm/templates/component/tag.json';
import componentAlert from '../../paradigm/templates/component/alert.json';

import { expandNamespace, type PlanEntry } from './expand';
import { validateStructure, type Issue, type ValidationResult } from './validate';
import { getNamespace, type NamespaceKey, type ValueType } from './vocabulary';

export type TemplateAxis = {
  slot: string;
  label: string;
  labelZh?: string;
  note?: string;
  values: string[];
  default: string[];
};

export type TemplateExtra = {
  path: string;
  valueType: ValueType;
  note?: string;
};

/** `{ role: ['gloss'], state: ['disabled'] }` — a combo matching every listed slot is dropped. */
export type ExcludeRule = { why?: string } & Record<string, string[] | string | undefined>;

export type LayerTemplate = {
  id: string;
  kind: 'layer';
  namespace: NamespaceKey;
  collection: string;
  modes: string[];
  valueType: ValueType;
  shape: string;
  label: string;
  labelZh?: string;
  summary?: string;
  summaryZh?: string;
  /** Fixed size: a layer template has no axes to tick. */
  count: number;
};

export type ComponentTemplate = {
  id: string;
  kind: 'component';
  /** Provenance in the Spiral developer-kit. Manifest only, never values. */
  spiral: {
    displayName: string;
    group: string;
    source: string;
    variantProp?: string | null;
    cssReference?: string;
  };
  namespace: NamespaceKey;
  collection: string;
  modes: string[];
  group: string;
  shape: string;
  valueType: ValueType;
  axes: TemplateAxis[];
  exclude: ExcludeRule[];
  extras: TemplateExtra[];
  note?: string;
  /** True for the catalog-derived placeholder templates (generic axes). */
  stub: boolean;
};

export type Template = LayerTemplate | ComponentTemplate;

export type TemplateSelection = {
  id: string;
  /** slot → ticked values. Omitted slots fall back to the axis default. */
  axes?: Record<string, string[]>;
  includeExtras?: boolean;
};

export type SpiralCatalog = {
  source: string;
  componentCount: number;
  groups: Array<{ name: string; components: string[] }>;
  components: Array<{
    displayName: string;
    slug: string;
    group: string;
    source: string;
    cssPropertyCount: number;
    cssProperties: string[];
  }>;
};

export const spiralCatalog = spiralCatalogJson as SpiralCatalog;

export const templateRegistry = registryJson as {
  version: string;
  unboundNote: string;
  thresholds: { warn: number; confirm: number };
  templates: Array<{ id: string; file: string; kind: 'layer' | 'component'; default: boolean }>;
};

const LAYER_DATA: Record<string, any> = {
  'layer.palette': layerPalette,
  'layer.semantic': layerSemantic,
  'layer.scaleStatic': layerScaleStatic,
  'layer.scaleDensity': layerScaleDensity,
  'layer.scaleContrast': layerScaleContrast,
  'layer.effect': layerEffect,
  'layer.effectSwitch': layerEffectSwitch
};

const COMPONENT_DATA: Record<string, any> = {
  'spiral.button': componentButton,
  'spiral.input': componentInput,
  'spiral.switch': componentSwitch,
  'spiral.segmentator': componentSegmentator,
  'spiral.tab': componentTab,
  'spiral.badge': componentBadge,
  'spiral.tag': componentTag,
  'spiral.alert': componentAlert
};

/**
 * Generic axes for a catalog component that has no curated template yet. The
 * words are the four parts and four states every Spiral component shares, so a
 * stub never invents an appearance word Spiral does not use.
 */
const STUB_AXES: TemplateAxis[] = [
  {
    slot: 'role',
    label: 'Part',
    labelZh: '部位',
    values: ['background', 'foreground', 'border', 'icon'],
    default: ['background', 'foreground']
  },
  {
    slot: 'state',
    label: 'State',
    labelZh: '状态',
    values: ['rest', 'hover', 'active', 'disabled'],
    default: ['rest', 'hover']
  }
];

const layerTemplate = (data: any): LayerTemplate => {
  const namespace = getNamespace(data.namespace as NamespaceKey);
  return {
    id: data.id,
    kind: 'layer',
    namespace: data.namespace,
    collection: namespace.collection,
    modes: namespace.modes,
    valueType: namespace.valueType,
    shape: namespace.shape,
    label: data.label,
    labelZh: data.labelZh,
    summary: data.summary,
    summaryZh: data.summaryZh,
    count: expandNamespace(data.namespace as NamespaceKey).length
  };
};

const componentTemplate = (data: any): ComponentTemplate => ({
  id: data.id,
  kind: 'component',
  spiral: data.spiral,
  namespace: 'component',
  collection: data.collection ?? 'component',
  modes: data.modes ?? getNamespace('component').modes,
  group: data.group,
  shape: data.shape,
  valueType: (data.valueType ?? 'COLOR') as ValueType,
  axes: data.axes as TemplateAxis[],
  exclude: (data.exclude ?? []) as ExcludeRule[],
  extras: (data.extras ?? []) as TemplateExtra[],
  note: data.note,
  stub: false
});

const stubTemplate = (entry: SpiralCatalog['components'][number]): ComponentTemplate => ({
  id: `spiral.${entry.slug}`,
  kind: 'component',
  spiral: {
    displayName: entry.displayName,
    group: entry.group,
    source: entry.source,
    variantProp: null
  },
  namespace: 'component',
  collection: 'component',
  modes: getNamespace('component').modes,
  group: entry.slug,
  shape: '{role}-{state}',
  valueType: 'COLOR',
  axes: STUB_AXES,
  exclude: [],
  extras: [],
  note: '占位轴来自 Spiral 目录。该组件尚未整理外观轴。',
  stub: true
});

const CURATED: Template[] = templateRegistry.templates.map((row) =>
  row.kind === 'layer' ? layerTemplate(LAYER_DATA[row.id]) : componentTemplate(COMPONENT_DATA[row.id])
);

const CURATED_IDS = new Set(CURATED.map((template) => template.id));

const STUBS: ComponentTemplate[] = spiralCatalog.components
  .filter((entry) => !CURATED_IDS.has(`spiral.${entry.slug}`))
  .map(stubTemplate);

/** Every selectable template: seven layers, the curated components, then the catalog stubs. */
export const templates: Template[] = [...CURATED, ...STUBS];

const BY_ID = new Map(templates.map((template) => [template.id, template]));

export const getTemplate = (id: string): Template => {
  const template = BY_ID.get(id);
  if (!template) throw new Error(`unknown template "${id}"`);
  return template;
};

export const isComponentTemplate = (template: Template): template is ComponentTemplate =>
  template.kind === 'component';

export const SHAPE_SLOT_PATTERN = /\{([a-zA-Z]+)\}/g;

/** `{variant}-{role}-{state}` → `['variant', 'role', 'state']`. */
export const shapeSlots = (shape: string): string[] =>
  [...shape.matchAll(SHAPE_SLOT_PATTERN)].map((match) => match[1]);

export const defaultAxes = (template: ComponentTemplate): Record<string, string[]> =>
  template.axes.reduce<Record<string, string[]>>((acc, axis) => {
    acc[axis.slot] = [...axis.default];
    return acc;
  }, {});

/** Nothing is selected by default — that is the point of the redesign. */
export const defaultSelection = (): TemplateSelection[] => [];

const asList = (value: string[] | string | undefined): string[] =>
  Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

/** Ticked values for one axis, intersected with the closed axis vocabulary. */
const resolveAxis = (axis: TemplateAxis, requested?: string[]): string[] => {
  if (!requested) return [...axis.default];
  const picked = axis.values.filter((value) => requested.includes(value));
  return picked;
};

export type ComboResult = {
  /** Group-qualified paths, in template axis order. */
  paths: string[];
  /** Combos dropped by an `exclude` rule, with the rule's reason. */
  excluded: Array<{ path: string; why: string }>;
};

export const expandCombos = (
  template: ComponentTemplate,
  axes?: Record<string, string[]>
): ComboResult => {
  const slots = shapeSlots(template.shape);
  const lists = slots.map((slot) => {
    const axis = template.axes.find((candidate) => candidate.slot === slot);
    if (!axis) throw new Error(`template ${template.id} shape uses slot "${slot}" with no axis`);
    return { slot, values: resolveAxis(axis, axes?.[slot]) };
  });

  const paths: string[] = [];
  const excluded: Array<{ path: string; why: string }> = [];

  const walk = (index: number, combo: Record<string, string>) => {
    if (index === lists.length) {
      const leaf = slots.reduce(
        (shape, slot) => shape.replace(`{${slot}}`, combo[slot]),
        template.shape
      );
      const path = `${template.group}/${leaf}`;
      const rule = template.exclude.find((candidate) => {
        const ruleSlots = Object.keys(candidate).filter((key) => key !== 'why');
        return (
          ruleSlots.length > 0 &&
          ruleSlots.every((slot) => asList(candidate[slot]).includes(combo[slot]))
        );
      });
      if (rule) excluded.push({ path, why: rule.why ?? 'excluded by the template' });
      else paths.push(path);
      return;
    }
    for (const value of lists[index].values) {
      walk(index + 1, { ...combo, [lists[index].slot]: value });
    }
  };

  walk(0, {});
  return { paths, excluded };
};

/** Cheap size preview for the axis panel: no entries built, no validation run. */
export const countSelection = (selection: TemplateSelection): number => {
  const template = getTemplate(selection.id);
  if (!isComponentTemplate(template)) return template.count;
  const combos = expandCombos(template, selection.axes).paths.length;
  return combos + (selection.includeExtras ? template.extras.length : 0);
};

export const countSelections = (selections: TemplateSelection[]): number =>
  selections.reduce((total, selection) => total + countSelection(selection), 0);

export type UnboundOptions = {
  /** Stamped into `Variable.description`; pass it explicitly to keep tests stable. */
  stamp?: string;
  /** Keep the shells out of the published team library until they carry a value. */
  hiddenFromPublishing?: boolean;
};

const monthStamp = () => new Date().toISOString().slice(0, 7);

const unboundNote = (templateId: string, stamp: string) =>
  `${templateRegistry.unboundNote} · ${templateId} · ${stamp}`;

/**
 * One selection → unbound plan entries. `values` and `aliases` are deliberately
 * absent: Apply must not call `setValueForMode` for these.
 */
export const expandSelection = (
  selection: TemplateSelection,
  options: UnboundOptions = {}
): PlanEntry[] => {
  const template = getTemplate(selection.id);
  const stamp = options.stamp ?? monthStamp();
  const note = unboundNote(template.id, stamp);
  const hiddenFromPublishing = options.hiddenFromPublishing === true;

  if (!isComponentTemplate(template)) {
    return expandNamespace(template.namespace).map((entry) => ({
      namespace: entry.namespace,
      collection: entry.collection,
      path: entry.path,
      valueType: entry.valueType,
      kind: 'unbound' as const,
      templateId: template.id,
      note,
      hiddenFromPublishing
    }));
  }

  const entries: PlanEntry[] = expandCombos(template, selection.axes).paths.map((path) => ({
    namespace: template.namespace,
    collection: template.collection,
    path,
    valueType: template.valueType,
    kind: 'unbound' as const,
    templateId: template.id,
    note,
    hiddenFromPublishing
  }));

  if (selection.includeExtras) {
    for (const extra of template.extras) {
      entries.push({
        namespace: template.namespace,
        collection: template.collection,
        path: extra.path,
        valueType: extra.valueType,
        kind: 'unbound',
        templateId: template.id,
        note,
        hiddenFromPublishing
      });
    }
  }

  return entries;
};

const issue = (code: Issue['code'], message: string, extra?: Partial<Issue>): Issue => ({
  code,
  message,
  ...extra
});

/**
 * Paradigm check for a template-owned path. Rules 1–5 and 7 come from
 * `validateStructure`; the closed vocabulary narrows from the global slot lists
 * to this template's axes, which is what §4 of the redesign asks for.
 */
export const validateTemplatePath = (path: string, template: Template): ValidationResult => {
  const issues = validateStructure(path);
  if (!isComponentTemplate(template)) {
    return { path, valid: issues.length === 0, namespace: template.namespace, issues };
  }

  const [group, leaf, ...rest] = path.split('/');
  if (group !== template.group) {
    issues.push(
      issue('notInTemplate', `group "${group}" is not the ${template.id} group "${template.group}"`, {
        value: group
      })
    );
  }

  const isExtra = template.extras.some((extra) => extra.path === path);
  if (!isExtra && rest.length === 0 && leaf) {
    const slots = shapeSlots(template.shape);
    const parts = leaf.split('-');
    if (parts.length !== slots.length) {
      issues.push(
        issue(
          'slotCount',
          `${template.id} expects the shape ${template.group}/${template.shape} (${slots.length} leaf slot${slots.length === 1 ? '' : 's'})`
        )
      );
    } else {
      slots.forEach((slot, index) => {
        const axis = template.axes.find((candidate) => candidate.slot === slot);
        if (axis && !axis.values.includes(parts[index])) {
          issues.push(
            issue('notInTemplate', `"${parts[index]}" is not in the ${slot} axis of ${template.id}`, {
              slot,
              value: parts[index]
            })
          );
        }
      });
    }
  }

  return {
    path,
    valid: issues.length === 0,
    namespace: template.namespace,
    issues
  };
};

export type TemplatePlan = {
  entries: PlanEntry[];
  /** template id → entry count */
  counts: Record<string, number>;
  total: number;
  invalid: ValidationResult[];
  /** Combos the templates dropped, for the dry-run report. */
  excluded: Array<{ templateId: string; path: string; why: string }>;
};

export const expandTemplatePlan = (
  selections: TemplateSelection[],
  options: UnboundOptions = {}
): TemplatePlan => {
  const entries: PlanEntry[] = [];
  const counts: Record<string, number> = {};
  const invalid: ValidationResult[] = [];
  const excluded: TemplatePlan['excluded'] = [];
  const seen = new Set<string>();

  for (const selection of selections) {
    const template = getTemplate(selection.id);
    const expanded = expandSelection(selection, options);
    counts[selection.id] = expanded.length;

    if (isComponentTemplate(template)) {
      for (const row of expandCombos(template, selection.axes).excluded) {
        excluded.push({ templateId: template.id, path: row.path, why: row.why });
      }
    }

    for (const entry of expanded) {
      const key = `${entry.collection}/${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = validateTemplatePath(entry.path, template);
      if (!result.valid) invalid.push(result);
      entries.push(entry);
    }
  }

  return { entries, counts, total: entries.length, invalid, excluded };
};

/** Template list payload for the UI: no entries, just what a row needs to render. */
export const templateSummaries = () =>
  templates.map((template) =>
    isComponentTemplate(template)
      ? {
          id: template.id,
          kind: 'component' as const,
          label: template.spiral.displayName,
          group: template.spiral.group,
          collection: template.collection,
          modes: template.modes,
          shape: `${template.group}/${template.shape}`,
          stub: template.stub,
          note: template.note,
          variantProp: template.spiral.variantProp ?? null,
          extras: template.extras.length,
          defaultCount: countSelection({ id: template.id }),
          maxCount: expandCombos(
            template,
            template.axes.reduce<Record<string, string[]>>((acc, axis) => {
              acc[axis.slot] = axis.values;
              return acc;
            }, {})
          ).paths.length,
          axes: template.axes
        }
      : {
          id: template.id,
          kind: 'layer' as const,
          label: template.label,
          labelZh: template.labelZh,
          group: 'Foundation layer',
          collection: template.collection,
          modes: template.modes,
          shape: template.shape,
          summary: template.summary,
          summaryZh: template.summaryZh,
          defaultCount: template.count,
          maxCount: template.count
        }
  );
