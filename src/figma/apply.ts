/**
 * Applies a paradigm plan to the current Figma file.
 *
 * Namespaces are written in dependency order (palette → semantic → component)
 * so an alias always finds its target. Targets that were not part of this run
 * are looked up in the file; if they are missing the entry is skipped and
 * reported instead of silently written as a literal.
 */
import { formatAliasRef, type Plan, type PlanEntry } from '../paradigm/expand';
import { getNamespace, type NamespaceKey } from '../paradigm/vocabulary';
import { ensureCollection } from './collections';
import { findVariable, setAlias, setLiteral, upsertVariable } from './upsert';

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

export type ApplySummary = {
  created: number;
  updated: number;
  skipped: Array<{ path: string; reason: string }>;
  collections: Array<{ name: string; created: boolean; missingModes: string[] }>;
};

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

export const applyPlan = async (plan: Plan): Promise<ApplySummary> => {
  const summary: ApplySummary = { created: 0, updated: 0, skipped: [], collections: [] };
  /** `${namespace}/${path}` → Variable, for alias resolution inside this run. */
  const written = new Map<string, Variable>();

  for (const [key, entries] of groupByNamespace(plan.entries)) {
    const namespace = getNamespace(key);
    const ensured = await ensureCollection(namespace.collection, namespace.modes);
    summary.collections.push({
      name: namespace.collection,
      created: ensured.created,
      missingModes: ensured.missingModes
    });

    for (const entry of entries) {
      const { variable, created } = await upsertVariable(
        ensured.collection,
        entry.path,
        entry.valueType
      );
      written.set(`${key}/${entry.path}`, variable);
      if (created) summary.created += 1;
      else summary.updated += 1;

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
          target = await findVariable(targetCollection.collection, ref.path, entry.valueType);
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

  return summary;
};
