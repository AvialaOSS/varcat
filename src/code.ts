import { applyPlan, formatUnboundList } from './figma/apply';
import { buildVariableIndex, lookupVariable } from './figma/upsert';
import { expandPlan, type Plan } from './paradigm/expand';
import {
  expandTemplatePlan,
  getTemplate,
  isComponentTemplate,
  spiralCatalog,
  templateRegistry,
  templateSummaries,
  templates,
  type TemplateSelection
} from './paradigm/templates';
import { validateVariablePath, type ValidationResult } from './paradigm/validate';
import { getNamespace, NAMESPACE_KEYS, vocabulary, type NamespaceKey } from './paradigm/vocabulary';
import { buildPaletteRamps, DEFAULT_SEEDS, type PaletteFamily } from './palette/ramp';

declare const UI_HTML: string;

type SeedMap = Partial<Record<PaletteFamily, string>>;

type UiMessage =
  | { type: 'init' }
  | { type: 'templateDryRun'; selections: TemplateSelection[]; hiddenFromPublishing?: boolean }
  | { type: 'templateApply'; selections: TemplateSelection[]; hiddenFromPublishing?: boolean }
  | { type: 'fullDryRun'; namespaces: NamespaceKey[]; seeds?: SeedMap; allEffects?: boolean }
  | { type: 'fullApply'; namespaces: NamespaceKey[]; seeds?: SeedMap; allEffects?: boolean }
  | { type: 'validateFile' }
  | { type: 'resize'; width: number; height: number };

const SEED_PATTERN = /^#?[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

const sanitizeSeeds = (raw?: SeedMap): SeedMap => {
  const seeds: SeedMap = {};
  for (const family of Object.keys(DEFAULT_SEEDS) as PaletteFamily[]) {
    const value = raw?.[family];
    if (typeof value === 'string' && SEED_PATTERN.test(value.trim())) {
      seeds[family] = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    }
  }
  return seeds;
};

/**
 * No empty-selection fallback. An empty selection used to expand to all eight
 * namespaces, so unchecking everything wrote 757 variables; now it writes none.
 */
const sanitizeNamespaces = (raw: unknown): NamespaceKey[] => {
  const requested = Array.isArray(raw) ? raw.map(String) : [];
  return NAMESPACE_KEYS.filter((key) => requested.includes(key));
};

const sanitizeSelections = (raw: unknown): TemplateSelection[] => {
  if (!Array.isArray(raw)) return [];
  const known = new Set(templates.map((template) => template.id));
  const out: TemplateSelection[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const id = String((row as any).id ?? '');
    if (!known.has(id)) continue;
    const template = getTemplate(id);
    const axes: Record<string, string[]> = {};
    if (isComponentTemplate(template) && (row as any).axes) {
      for (const axis of template.axes) {
        const requested = (row as any).axes[axis.slot];
        if (Array.isArray(requested)) {
          axes[axis.slot] = axis.values.filter((value) => requested.includes(value));
        }
      }
    }
    out.push({
      id,
      axes: Object.keys(axes).length > 0 ? axes : undefined,
      includeExtras: (row as any).includeExtras === true
    });
  }
  return out;
};

const buildFullPlan = (message: {
  namespaces: NamespaceKey[];
  seeds?: SeedMap;
  allEffects?: boolean;
}): Plan =>
  expandPlan({
    namespaces: message.namespaces,
    palette: buildPaletteRamps({ seeds: sanitizeSeeds(message.seeds) }),
    allEffects: message.allEffects === true
  });

/**
 * Every collection the plan touches, with the modes it needs and the modes the
 * file can actually host. Five of the eight collections need two modes, and a
 * Figma plan capped at one silently drops half the tree, so this is checked and
 * surfaced before Apply rather than noted in parentheses afterwards.
 */
const modeBudget = async (collections: Array<{ name: string; modes: string[] }>) => {
  const existing = await figma.variables.getLocalVariableCollectionsAsync();
  const byName = new Map(existing.map((collection) => [collection.name, collection]));
  return collections.map((row) => {
    const found = byName.get(row.name);
    return {
      collection: row.name,
      needs: row.modes,
      has: found ? found.modes.map((mode) => mode.name) : [],
      exists: !!found
    };
  });
};

/** Full path list for the dry-run, annotated new / existing against the file. */
const annotatePaths = async (
  entries: Array<{ collection: string; path: string; valueType: string }>
) => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const idByName = new Map(collections.map((collection) => [collection.name, collection.id]));
  const index = await buildVariableIndex();
  return entries.map((entry) => {
    const collectionId = idByName.get(entry.collection);
    const found = collectionId ? lookupVariable(index, collectionId, entry.path) : null;
    return {
      collection: entry.collection,
      path: entry.path,
      valueType: entry.valueType,
      status: found ? ('existing' as const) : ('new' as const)
    };
  });
};

const fullPlanPayload = (plan: Plan, namespaces: NamespaceKey[]) => ({
  total: plan.total,
  counts: plan.counts,
  collections: namespaces.map((key) => {
    const namespace = getNamespace(key);
    return {
      key,
      collection: namespace.collection,
      modes: namespace.modes,
      valueKind: namespace.valueKind,
      count: plan.counts[key] ?? 0
    };
  }),
  sample: plan.entries.slice(0, 24).map((entry) => `${entry.collection}: ${entry.path}`),
  invalid: plan.invalid.map((result) => ({
    path: result.path,
    issues: result.issues.map((issue) => issue.message)
  }))
});

/** Every local variable, checked against the paradigm. */
const validateFile = async () => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const byId = new Map(collections.map((collection) => [collection.id, collection.name]));
  const namespaceByCollection = new Map<string, NamespaceKey>(
    NAMESPACE_KEYS.map((key) => [getNamespace(key).collection, key])
  );
  const variables = await figma.variables.getLocalVariablesAsync();

  const rows = variables.map((variable) => {
    const collectionName = byId.get(variable.variableCollectionId) ?? '';
    const namespace = namespaceByCollection.get(collectionName);
    const result: ValidationResult = validateVariablePath(variable.name, { namespace });
    return {
      collection: collectionName,
      path: variable.name,
      namespace: result.namespace ?? null,
      valid: result.valid,
      issues: result.issues.map((issue) => issue.message),
      retired: result.issues.some((issue) => issue.code === 'retiredType'),
      unfilled: (variable.description ?? '').indexOf(templateRegistry.unboundNote) === 0
    };
  });

  const violations = rows.filter((row) => !row.valid);
  return {
    total: rows.length,
    validCount: rows.length - violations.length,
    invalidCount: violations.length,
    unfilledCount: rows.filter((row) => row.unfilled).length,
    violations: violations.slice(0, 200),
    paradigmCollections: [...namespaceByCollection.keys()].filter((name) =>
      collections.some((collection) => collection.name === name)
    )
  };
};

const main = async () => {
  figma.showUI(UI_HTML, { width: 520, height: 760, themeColors: true });

  const stored = (await figma.clientStorage.getAsync('varcat.ui.size')) as
    | { w: number; h: number }
    | undefined;
  if (stored?.w && stored?.h) {
    figma.ui.resize(
      Math.max(380, Math.min(1200, Math.floor(stored.w))),
      Math.max(480, Math.min(1200, Math.floor(stored.h)))
    );
  }

  const sendInit = () => {
    figma.ui.postMessage({
      type: 'init',
      version: vocabulary.version,
      templateVersion: templateRegistry.version,
      thresholds: templateRegistry.thresholds,
      unboundNote: templateRegistry.unboundNote,
      templates: templateSummaries(),
      catalog: {
        source: spiralCatalog.source,
        componentCount: spiralCatalog.componentCount,
        groups: spiralCatalog.groups.map((group) => group.name)
      },
      seeds: DEFAULT_SEEDS,
      namespaces: NAMESPACE_KEYS.map((key) => {
        const namespace = getNamespace(key);
        return {
          key,
          collection: namespace.collection,
          modes: namespace.modes,
          valueKind: namespace.valueKind,
          shape: namespace.shape
        };
      })
    });
  };

  figma.ui.onmessage = async (message: UiMessage) => {
    try {
      if (message.type === 'init') {
        sendInit();
        return;
      }

      if (message.type === 'resize') {
        const width = Math.max(380, Math.min(1200, Math.floor(message.width)));
        const height = Math.max(480, Math.min(1200, Math.floor(message.height)));
        figma.ui.resize(width, height);
        await figma.clientStorage.setAsync('varcat.ui.size', { w: width, h: height });
        return;
      }

      if (message.type === 'templateDryRun' || message.type === 'templateApply') {
        const selections = sanitizeSelections(message.selections);
        if (selections.length === 0) {
          figma.ui.postMessage({
            type: 'error',
            message: 'Nothing selected. Pick at least one template — VarCat never writes on an empty selection.'
          });
          return;
        }

        const plan = expandTemplatePlan(selections, {
          hiddenFromPublishing: message.hiddenFromPublishing === true
        });

        const collections = [...new Set(plan.entries.map((entry) => entry.collection))].map(
          (name) => ({
            name,
            modes: getNamespace(
              plan.entries.find((entry) => entry.collection === name)!.namespace
            ).modes
          })
        );

        if (message.type === 'templateDryRun') {
          figma.ui.postMessage({
            type: 'templatePlan',
            total: plan.total,
            counts: plan.counts,
            excluded: plan.excluded,
            invalid: plan.invalid.map((result) => ({
              path: result.path,
              issues: result.issues.map((issue) => issue.message)
            })),
            modeBudget: await modeBudget(collections),
            paths: await annotatePaths(plan.entries)
          });
          return;
        }

        if (plan.invalid.length > 0) {
          figma.ui.postMessage({
            type: 'error',
            message: `Plan rejected: ${plan.invalid.length} path(s) violate the paradigm`,
            invalid: plan.invalid.map((result) => result.path)
          });
          return;
        }

        const summary = await applyPlan(plan, {
          onProgress: (progress) => figma.ui.postMessage({ type: 'progress', ...progress })
        });
        figma.ui.postMessage({
          type: 'templateApplied',
          total: plan.total,
          summary,
          unfilledList: formatUnboundList(summary.unbound)
        });
        figma.notify(
          `VarCat: ${summary.unbound.length} empty shell(s) created, ${summary.existing.length} left as-is`
        );
        return;
      }

      if (message.type === 'fullDryRun' || message.type === 'fullApply') {
        const namespaces = sanitizeNamespaces(message.namespaces);
        if (namespaces.length === 0) {
          figma.ui.postMessage({
            type: 'error',
            message: 'No namespace selected. Nothing to expand.'
          });
          return;
        }
        const plan = buildFullPlan({ ...message, namespaces });

        if (message.type === 'fullDryRun') {
          figma.ui.postMessage({ type: 'plan', ...fullPlanPayload(plan, namespaces) });
          return;
        }

        if (plan.invalid.length > 0) {
          figma.ui.postMessage({
            type: 'error',
            message: `Plan rejected: ${plan.invalid.length} path(s) violate the paradigm`,
            invalid: plan.invalid.map((result) => result.path)
          });
          return;
        }
        const summary = await applyPlan(plan, {
          onProgress: (progress) => figma.ui.postMessage({ type: 'progress', ...progress })
        });
        figma.ui.postMessage({ type: 'applied', total: plan.total, summary });
        figma.notify(`VarCat: ${summary.created} created, ${summary.updated} updated`);
        return;
      }

      if (message.type === 'validateFile') {
        figma.ui.postMessage({ type: 'report', ...(await validateFile()) });
        return;
      }
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  sendInit();
};

void main();
