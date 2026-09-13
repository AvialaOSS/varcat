import { applyPlan } from './figma/apply';
import { expandPlan, type Plan } from './paradigm/expand';
import { validateVariablePath, type ValidationResult } from './paradigm/validate';
import { getNamespace, NAMESPACE_KEYS, vocabulary, type NamespaceKey } from './paradigm/vocabulary';
import { buildPaletteRamps, DEFAULT_SEEDS, type PaletteFamily } from './palette/ramp';

declare const UI_HTML: string;

type SeedMap = Partial<Record<PaletteFamily, string>>;

type UiMessage =
  | { type: 'init' }
  | { type: 'dryRun'; namespaces: NamespaceKey[]; seeds?: SeedMap; allEffects?: boolean }
  | { type: 'apply'; namespaces: NamespaceKey[]; seeds?: SeedMap; allEffects?: boolean }
  | { type: 'validate' }
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

const sanitizeNamespaces = (raw: unknown): NamespaceKey[] => {
  const requested = Array.isArray(raw) ? raw.map(String) : [];
  const selected = NAMESPACE_KEYS.filter((key) => requested.includes(key));
  return selected.length > 0 ? selected : [...NAMESPACE_KEYS];
};

const buildPlan = (message: {
  namespaces: NamespaceKey[];
  seeds?: SeedMap;
  allEffects?: boolean;
}): Plan =>
  expandPlan({
    namespaces: message.namespaces,
    palette: buildPaletteRamps({ seeds: sanitizeSeeds(message.seeds) }),
    allEffects: message.allEffects === true
  });

const planPayload = (plan: Plan, namespaces: NamespaceKey[]) => ({
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
      issues: result.issues.map((issue) => issue.message)
    };
  });

  const violations = rows.filter((row) => !row.valid);
  return {
    total: rows.length,
    validCount: rows.length - violations.length,
    invalidCount: violations.length,
    violations: violations.slice(0, 200),
    paradigmCollections: [...namespaceByCollection.keys()].filter((name) =>
      collections.some((collection) => collection.name === name)
    )
  };
};

const main = async () => {
  figma.showUI(UI_HTML, { width: 460, height: 720, themeColors: true });

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

      if (message.type === 'dryRun') {
        const namespaces = sanitizeNamespaces(message.namespaces);
        const plan = buildPlan({ ...message, namespaces });
        figma.ui.postMessage({ type: 'plan', ...planPayload(plan, namespaces) });
        return;
      }

      if (message.type === 'apply') {
        const namespaces = sanitizeNamespaces(message.namespaces);
        const plan = buildPlan({ ...message, namespaces });
        if (plan.invalid.length > 0) {
          figma.ui.postMessage({
            type: 'error',
            message: `Plan rejected: ${plan.invalid.length} path(s) violate the paradigm`,
            invalid: plan.invalid.map((result) => result.path)
          });
          return;
        }
        const summary = await applyPlan(plan);
        figma.ui.postMessage({ type: 'applied', total: plan.total, summary });
        figma.notify(`VarCat: ${summary.created} created, ${summary.updated} updated`);
        return;
      }

      if (message.type === 'validate') {
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
