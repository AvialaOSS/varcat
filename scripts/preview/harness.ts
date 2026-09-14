/**
 * Dev-only stand-in for the Figma plugin main thread.
 *
 * `scripts/preview-ui.mjs` bundles this into `dist/preview.html` so the real
 * panel opens in a normal browser: `parent.postMessage` lands back on `window`
 * and this listener answers with the same payloads `src/code.ts` sends.
 */
import { DEFAULT_SEEDS } from '../../src/palette/ramp';
import {
  expandTemplatePlan,
  spiralCatalog,
  templateRegistry,
  type TemplateSelection
} from '../../src/paradigm/templates';
import {
  emptyVocabOverlay,
  isVocabOverlay,
  resolveTemplate,
  templateSummariesWithOverlay,
  type VocabOverlay
} from '../../src/paradigm/vocab-overlay';
import { getNamespace, NAMESPACE_KEYS, vocabulary } from '../../src/paradigm/vocabulary';

/**
 * `init` names both a request and a response, so replies carry a marker: with
 * `parent === window` the harness would otherwise answer itself forever.
 */
const FROM_HARNESS = '__varcatPreviewReply';

let vocabOverlay: VocabOverlay = emptyVocabOverlay();

const reply = (message: Record<string, unknown>) => {
  window.postMessage({ pluginMessage: { ...message, [FROM_HARNESS]: true } }, '*');
};

const initPayload = () => ({
  type: 'init',
  version: vocabulary.version,
  templateVersion: templateRegistry.version,
  thresholds: templateRegistry.thresholds,
  unboundNote: templateRegistry.unboundNote,
  templates: templateSummariesWithOverlay(vocabOverlay),
  vocabOverlay,
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

const planPayload = (selections: TemplateSelection[]) => {
  const plan = expandTemplatePlan(selections, {
    hiddenFromPublishing: true,
    resolve: (id) => resolveTemplate(id, vocabOverlay)
  });
  const collections = [...new Set(plan.entries.map((entry) => entry.collection))];
  return {
    type: 'templatePlan',
    total: plan.total,
    counts: plan.counts,
    excluded: plan.excluded,
    invalid: plan.invalid.map((result) => ({
      path: result.path,
      issues: result.issues.map((issue) => issue.message)
    })),
    modeBudget: collections.map((name) => {
      const namespace = getNamespace(
        plan.entries.find((entry) => entry.collection === name)!.namespace
      );
      return { collection: name, needs: namespace.modes, has: namespace.modes, exists: true };
    }),
    paths: plan.entries.map((entry, index) => ({
      collection: entry.collection,
      path: entry.path,
      valueType: entry.valueType,
      status: index % 7 === 0 ? ('existing' as const) : ('new' as const)
    }))
  };
};

const appliedPayload = (selections: TemplateSelection[]) => {
  const plan = planPayload(selections);
  const unbound = plan.paths
    .filter((row) => row.status === 'new')
    .map((row) => `${row.collection}/${row.path}`);
  return {
    type: 'templateApplied',
    total: plan.total,
    summary: {
      created: unbound.length,
      updated: 0,
      unbound,
      existing: plan.paths.filter((row) => row.status === 'existing'),
      collections: [...new Set(plan.paths.map((row) => row.collection))].map((name) => ({
        name,
        created: true,
        missingModes: []
      })),
      modeLimit: [],
      skipped: []
    },
    unfilledList: unbound.slice(0, 40).join('\n')
  };
};

/** Messages the panel sends out — they must never reach the panel's own listener. */
const REQUESTS = new Set([
  'init',
  'templateDryRun',
  'templateApply',
  'fullDryRun',
  'fullApply',
  'validateFile',
  'resize',
  'vocabOverlaySave'
]);

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data?.pluginMessage;
  if (!message || message[FROM_HARNESS] || !REQUESTS.has(message.type)) return;

  // `parent === window` here, so the panel would otherwise hear its own request.
  // This listener is registered first, so stopping propagation hides it.
  event.stopImmediatePropagation();

  if (message.type === 'init') {
    reply(initPayload());
    return;
  }
  if (message.type === 'vocabOverlaySave') {
    vocabOverlay = isVocabOverlay(message.overlay) ? message.overlay : emptyVocabOverlay();
    reply({
      type: 'vocabOverlaySaved',
      overlay: vocabOverlay,
      templates: templateSummariesWithOverlay(vocabOverlay)
    });
    return;
  }
  if (message.type === 'templateDryRun') {
    reply(planPayload(message.selections ?? []));
    return;
  }
  if (message.type === 'templateApply') {
    const applied = appliedPayload(message.selections ?? []);
    reply({
      type: 'progress',
      done: applied.total,
      total: applied.total,
      collection: 'Spiral/Component'
    });
    reply(applied);
  }
});
