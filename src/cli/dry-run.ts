/**
 * Headless dry-run. Expands the same plan the plugin would apply and prints the
 * counts plus, with --json, the full path inventory. Useful as review evidence
 * when a Figma desktop session is not available.
 *
 * Template mode (the default flow — empty shells, no values):
 *
 *   node scripts/dry-run.mjs --template spiral.button
 *   node scripts/dry-run.mjs --template spiral.button --axes-all --extras --paths
 *   node scripts/dry-run.mjs --template list
 *
 * Advanced mode (the complete paradigm, with preset values):
 *
 *   node scripts/dry-run.mjs --namespaces palette,semantic --paths
 *   node scripts/dry-run.mjs --json > inventory.json
 */
import { expandPlan, inventory } from '../paradigm/expand';
import { buildPaletteRamps } from '../palette/ramp';
import {
  expandTemplatePlan,
  getTemplate,
  isComponentTemplate,
  templates,
  type TemplateSelection
} from '../paradigm/templates';
import { getNamespace, NAMESPACE_KEYS, vocabulary, type NamespaceKey } from '../paradigm/vocabulary';

type Args = {
  namespaces: NamespaceKey[];
  json: boolean;
  paths: boolean;
  allEffects: boolean;
  templateIds: string[];
  axesAll: boolean;
  extras: boolean;
};

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
  const templateIds =
    option('template')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  return {
    namespaces,
    json: flag('json'),
    paths: flag('paths'),
    allEffects: flag('all-effects'),
    templateIds,
    axesAll: flag('axes-all'),
    extras: flag('extras')
  };
};

const listTemplates = () => {
  const lines = [`VarCat templates — ${templates.length} selectable`, ''];
  for (const template of templates) {
    if (isComponentTemplate(template)) {
      const axes = template.axes
        .map((axis) => `${axis.slot}(${axis.values.length})`)
        .join(' × ');
      lines.push(
        `${template.id.padEnd(28)} ${template.stub ? 'stub    ' : 'curated '} ${`${template.group}/${template.shape}`.padEnd(38)} ${axes}${template.extras.length ? ` +${template.extras.length} extras` : ''}`
      );
    } else {
      lines.push(
        `${template.id.padEnd(28)} layer    ${template.shape.padEnd(38)} ${template.count} paths`
      );
    }
  }
  return lines.join('\n');
};

const templateSelections = (args: Args): TemplateSelection[] =>
  args.templateIds.map((id) => {
    const template = getTemplate(id);
    const axes =
      args.axesAll && isComponentTemplate(template)
        ? template.axes.reduce<Record<string, string[]>>((acc, axis) => {
            acc[axis.slot] = [...axis.values];
            return acc;
          }, {})
        : undefined;
    return { id, axes, includeExtras: args.extras };
  });

const runTemplates = (args: Args): { text: string; violations: number } => {
  const plan = expandTemplatePlan(templateSelections(args), { stamp: 'dry-run' });

  if (args.json) {
    const json = JSON.stringify(
      {
        templateVersion: vocabulary.version,
        mode: 'template',
        total: plan.total,
        counts: plan.counts,
        excluded: plan.excluded,
        invalid: plan.invalid.map((result) => ({
          path: result.path,
          issues: result.issues.map((issue) => issue.message)
        })),
        entries: plan.entries.map((entry) => ({
          collection: entry.collection,
          path: entry.path,
          valueType: entry.valueType,
          kind: entry.kind,
          templateId: entry.templateId
        }))
      },
      null,
      2
    );
    return { text: `${json}\n`, violations: plan.invalid.length };
  }

  const lines = [`VarCat template dry-run — empty shells, no values written`, ''];
  for (const [id, count] of Object.entries(plan.counts)) {
    lines.push(`${String(count).padStart(4)}  ${id}`);
  }
  lines.push(
    '',
    `total: ${plan.total} unbound variable(s)`,
    `excluded by template rules: ${plan.excluded.length}`,
    `paradigm violations: ${plan.invalid.length}`
  );

  if (args.paths) {
    lines.push('');
    for (const entry of plan.entries) {
      lines.push(`  ${entry.collection}/${entry.path}  [${entry.valueType}]`);
    }
  }

  for (const result of plan.invalid) {
    lines.push(`VIOLATION ${result.path}: ${result.issues.map((i) => i.message).join('; ')}`);
  }

  return { text: `${lines.join('\n')}\n`, violations: plan.invalid.length };
};

const run = (argv: string[]): { text: string; violations: number } => {
  const args = parseArgs(argv);

  if (args.templateIds.length === 1 && args.templateIds[0] === 'list') {
    return { text: `${listTemplates()}\n`, violations: 0 };
  }
  if (args.templateIds.length > 0) return runTemplates(args);

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
