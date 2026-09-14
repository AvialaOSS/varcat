/**
 * Applies a plan to the current Figma file.
 *
 * Two kinds of write live here. A `literal` or `alias` entry gets a value per
 * mode; an `unbound` entry gets the variable and nothing else — `setValueForMode`
 * is never called for it, so the variable keeps Figma's own initial value and
 * counts as an empty shell rather than a skip.
 *
 * Namespaces are written in dependency order (palette → semantic → component) so
 * an alias always finds its target. Targets that were not part of this run are
 * looked up in the file; if they are missing the entry is skipped and reported
 * instead of silently written as a literal.
 */
import { formatAliasRef, type Plan, type PlanEntry } from '../paradigm/expand';
import { getNamespace, type NamespaceKey } from '../paradigm/vocabulary';
import { ensureCollection } from './collections';
import {
  buildVariableIndex,
  lookupVariable,
  markUnbound,
  setAlias,
  setLiteral,
  upsertVariable,
  type VariableIndex
} from './upsert';

export const APPLY_ORDER: NamespaceKey[] = [
  'palette',
  'semantic',
  'scaleStatic',
  'scaleDensity',
  'scaleContrast',
  'component',
  'effect',
  'effectSwitch'
];

export type UnboundRow = {
  collection: string;
  path: string;
  valueType: string;
  templateId?: string;
};

export type ApplySummary = {
  created: number;
  updated: number;
  /** Empty shells created by this run: no value was written for any mode. */
  unbound: UnboundRow[];
  /** Unbound paths that already existed; their values were left alone. */
  existing: Array<{ collection: string; path: string }>;
  skipped: Array<{ path: string; reason: string }>;
  collections: Array<{ name: string; created: boolean; missingModes: string[] }>;
  /** Flattened `collection: mode` pairs the Figma plan refused. Loud on purpose. */
  modeLimit: string[];
};

export type ApplyProgress = {
  done: number;
  total: number;
  collection: string;
};

export type ApplyOptions = {
  /** Called after every batch so the UI can move a progress bar. */
  onProgress?: (progress: ApplyProgress) => void;
  /** Entries per batch before yielding to the event loop. */
  batchSize?: number;
};

const DEFAULT_BATCH_SIZE = 25;

export const sortByApplyOrder = (entries: PlanEntry[]): PlanEntry[] =>
  [...entries].sort(
    (a, b) => APPLY_ORDER.indexOf(a.namespace) - APPLY_ORDER.indexOf(b.namespace)
  );

const groupByNamespace = (entries: PlanEntry[]) => {
  const map = new Map<NamespaceKey, PlanEntry[]>();
  for (const entry of sortByApplyOrder(entries)) {
    const bucket = map.get(entry.namespace) ?? [];
    bucket.push(entry);
    map.set(entry.namespace, bucket);
  }
  return map;
};

/** Lets Figma paint between batches; a long run must not look like a hang. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Only `entries` is read, so a paradigm plan and a template plan both fit. */
export type ApplyablePlan = Pick<Plan, 'entries'>;

export const applyPlan = async (
  plan: ApplyablePlan,
  options: ApplyOptions = {}
): Promise<ApplySummary> => {
  const summary: ApplySummary = {
    created: 0,
    updated: 0,
    unbound: [],
    existing: [],
    skipped: [],
    collections: [],
    modeLimit: []
  };
  /** `${namespace}/${path}` → Variable, for alias resolution inside this run. */
  const written = new Map<string, Variable>();
  const index: VariableIndex = await buildVariableIndex();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const total = plan.entries.length;
  let done = 0;

  for (const [key, entries] of groupByNamespace(plan.entries)) {
    const namespace = getNamespace(key);
    const collectionName = entries[0]?.collection ?? namespace.collection;
    const ensured = await ensureCollection(collectionName, namespace.modes);
    summary.collections.push({
      name: collectionName,
      created: ensured.created,
      missingModes: ensured.missingModes
    });
    for (const mode of ensured.missingModes) summary.modeLimit.push(`${collectionName}: ${mode}`);

    for (const entry of entries) {
      const { variable, created } = await upsertVariable(
        ensured.collection,
        entry.path,
        entry.valueType,
        index
      );
      written.set(`${key}/${entry.path}`, variable);
      if (created) summary.created += 1;
      else summary.updated += 1;

      done += 1;
      if (done % batchSize === 0) {
        options.onProgress?.({ done, total, collection: collectionName });
        await yieldToUi();
      }

      if (entry.kind === 'unbound') {
        // The whole point of the empty shell: no setValueForMode, ever.
        if (created) {
          markUnbound(variable, entry.note, entry.hiddenFromPublishing === true);
          summary.unbound.push({
            collection: collectionName,
            path: entry.path,
            valueType: entry.valueType,
            templateId: entry.templateId
          });
        } else {
          summary.existing.push({ collection: collectionName, path: entry.path });
        }
        continue;
      }

      for (const mode of namespace.modes) {
        const modeId = ensured.modeIds[mode];
        if (!modeId) continue;

        if (entry.kind === 'literal') {
          const value = entry.values?.[mode];
          if (value === undefined) {
            summary.skipped.push({
              path: entry.path,
              reason: `no literal value for mode "${mode}"`
            });
            continue;
          }
          setLiteral(variable, modeId, entry.valueType, value);
          continue;
        }

        const ref = entry.aliases?.[mode];
        if (!ref) {
          summary.skipped.push({ path: entry.path, reason: `no alias target for mode "${mode}"` });
          continue;
        }

        const refKey = formatAliasRef(ref);
        let target = written.get(refKey) ?? null;
        if (!target) {
          const targetNamespace = getNamespace(ref.namespace);
          const targetCollection = await ensureCollection(
            targetNamespace.collection,
            targetNamespace.modes
          );
          target = lookupVariable(index, targetCollection.collection.id, ref.path);
          if (target) written.set(refKey, target);
        }
        if (!target) {
          summary.skipped.push({
            path: entry.path,
            reason: `alias target ${refKey} does not exist yet; apply ${ref.namespace} first`
          });
          continue;
        }
        setAlias(variable, modeId, target);
      }
    }
  }

  options.onProgress?.({ done, total, collection: 'done' });
  return summary;
};

/**
 * Groups an unbound list by collection for the "still to fill" export. Plain
 * text on purpose: it is meant to be copied out of the plugin log.
 */
export const formatUnboundList = (unbound: UnboundRow[]): string => {
  const byCollection = new Map<string, string[]>();
  for (const row of unbound) {
    const bucket = byCollection.get(row.collection) ?? [];
    bucket.push(row.path);
    byCollection.set(row.collection, bucket);
  }
  const lines: string[] = [];
  for (const [collection, paths] of [...byCollection.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`# ${collection} (${paths.length} unfilled)`);
    lines.push(...paths.sort().map((path) => `  ${path}`));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
};
