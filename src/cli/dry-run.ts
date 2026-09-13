/**
 * Headless dry-run. Expands the same plan the plugin would apply and prints the
 * counts plus, with --json, the full path inventory. Useful as review evidence
 * when a Figma desktop session is not available.
 *
 *   node scripts/dry-run.mjs
 *   node scripts/dry-run.mjs --json > inventory.json
 *   node scripts/dry-run.mjs --namespaces palette,semantic --paths
 */
import { expandPlan, inventory } from '../paradigm/expand';
import { buildPaletteRamps } from '../palette/ramp';
import { getNamespace, NAMESPACE_KEYS, vocabulary, type NamespaceKey } from '../paradigm/vocabulary';

type Args = { namespaces: NamespaceKey[]; json: boolean; paths: boolean; allEffects: boolean };

const parseArgs = (argv: string[]): Args => {
  const flag = (name: string) => argv.includes(`--${name}`);
  const option = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const requested = option('namespaces')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const namespaces = requested?.length
    ? NAMESPACE_KEYS.filter((key) => requested.includes(key))
    : [...NAMESPACE_KEYS];
  return {
    namespaces,
    json: flag('json'),
    paths: flag('paths'),
    allEffects: flag('all-effects')
  };
};

const run = (argv: string[]): { text: string; violations: number } => {
  const args = parseArgs(argv);
  const plan = expandPlan({
    namespaces: args.namespaces,
    palette: buildPaletteRamps(),
    allEffects: args.allEffects
  });

  if (args.json) {
    const json = JSON.stringify(
      {
        vocabularyVersion: vocabulary.version,
        total: plan.total,
        counts: plan.counts,
        invalid: plan.invalid.map((result) => ({
          path: result.path,
          issues: result.issues.map((issue) => issue.message)
        })),
        collections: args.namespaces.map((key) => {
          const namespace = getNamespace(key);
          return {
            namespace: key,
            collection: namespace.collection,
            modes: namespace.modes,
            valueType: namespace.valueType,
            valueKind: namespace.valueKind,
            shape: namespace.shape,
            count: plan.counts[key] ?? 0
          };
        }),
        paths: inventory(plan)
      },
      null,
      2
    );
    return { text: `${json}\n`, violations: plan.invalid.length };
  }

  const lines = [`VarCat dry-run — vocabulary ${vocabulary.version}`, ''];
  for (const key of args.namespaces) {
    const namespace = getNamespace(key);
    lines.push(
      `${String(plan.counts[key] ?? 0).padStart(4)}  ${namespace.collection.padEnd(14)} ${namespace.shape.padEnd(46)} modes=${namespace.modes.join('/')} ${namespace.valueKind}`
    );
  }
  lines.push('', `total: ${plan.total} variables`, `paradigm violations: ${plan.invalid.length}`);

  if (args.paths) {
    lines.push('');
    for (const [key, paths] of Object.entries(inventory(plan))) {
      lines.push(`# ${key} (${paths.length})`);
      lines.push(...paths.map((path) => `  ${getNamespace(key as NamespaceKey).collection}/${path}`));
      lines.push('');
    }
  }

  for (const result of plan.invalid) {
    lines.push(`VIOLATION ${result.path}: ${result.issues.map((i) => i.message).join('; ')}`);
  }

  return { text: `${lines.join('\n')}\n`, violations: plan.invalid.length };
};

const result = run(process.argv.slice(2));
process.stdout.write(result.text);
if (result.violations > 0) process.exitCode = 1;
