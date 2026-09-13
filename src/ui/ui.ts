/**
 * Four-step UI: pick templates → configure axes → dry-run the full path list →
 * Apply. Zero framework by design; the only state is `selected`, a map from
 * template id to the ticked axis values.
 */
type Axis = {
  slot: string;
  label: string;
  labelZh?: string;
  note?: string;
  values: string[];
  default: string[];
};

type TemplateSummary = {
  id: string;
  kind: 'layer' | 'component';
  label: string;
  labelZh?: string;
  group: string;
  collection: string;
  modes: string[];
  shape: string;
  summary?: string;
  stub?: boolean;
  note?: string;
  variantProp?: string | null;
  extras?: number;
  defaultCount: number;
  maxCount: number;
  axes?: Axis[];
};

type AxisSelection = { axes: Record<string, string[]>; includeExtras: boolean };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const output = $<HTMLPreElement>('output');
const pathsPane = $<HTMLPreElement>('paths');
const stepBar = $<HTMLOListElement>('stepBar');

const post = (message: unknown) => parent.postMessage({ pluginMessage: message }, '*');

const write = (text: string, isError = false) => {
  output.textContent = text;
  output.classList.toggle('error', isError);
};

let templates: TemplateSummary[] = [];
let thresholds = { warn: 200, confirm: 500 };
let unboundNote = 'VarCat: 待填';
const selected = new Map<string, AxisSelection>();
let dryRunPaths: Array<{ collection: string; path: string; status: 'new' | 'existing' }> = [];
let unfilledList = '';
let step = 1;

const byId = (id: string) => templates.find((template) => template.id === id)!;

const defaultSelection = (template: TemplateSummary): AxisSelection => ({
  axes: (template.axes ?? []).reduce<Record<string, string[]>>((acc, axis) => {
    acc[axis.slot] = [...axis.default];
    return acc;
  }, {}),
  includeExtras: false
});

/** Mirrors `countSelection` in src/paradigm/templates.ts, minus the exclude rules. */
const countTemplate = (template: TemplateSummary): number => {
  if (template.kind === 'layer') return template.defaultCount;
  const selection = selected.get(template.id) ?? defaultSelection(template);
  const combos = (template.axes ?? []).reduce(
    (product, axis) => product * (selection.axes[axis.slot]?.length ?? 0),
    1
  );
  return combos + (selection.includeExtras ? (template.extras ?? 0) : 0);
};

const totalCount = () =>
  [...selected.keys()].reduce((total, id) => total + countTemplate(byId(id)), 0);

const selectionPayload = () =>
  [...selected.entries()].map(([id, selection]) => ({
    id,
    axes: selection.axes,
    includeExtras: selection.includeExtras
  }));

const setStep = (next: number) => {
  step = next;
  for (const item of [...stepBar.children] as HTMLLIElement[]) {
    const value = Number(item.dataset.step);
    item.classList.toggle('current', value === step);
    item.classList.toggle('locked', value > 1 && selected.size === 0);
  }
  for (const index of [1, 2, 3, 4]) {
    $(`step${index}`).classList.toggle('current', index === step);
  }
};

/* ---------------------------------------------------------------- step 1 */

const renderTemplates = () => {
  const host = $<HTMLDivElement>('templateGroups');
  const filter = $<HTMLInputElement>('search').value.trim().toLowerCase();
  host.innerHTML = '';

  const groups = new Map<string, TemplateSummary[]>();
  for (const template of templates) {
    if (
      filter &&
      !`${template.label} ${template.id} ${template.shape}`.toLowerCase().includes(filter)
    ) {
      continue;
    }
    const bucket = groups.get(template.group) ?? [];
    bucket.push(template);
    groups.set(template.group, bucket);
  }

  for (const [group, rows] of groups) {
    const details = document.createElement('details');
    details.className = 'group';
    details.open = !!filter || group === 'Foundation layer';

    const summary = document.createElement('summary');
    const picked = rows.filter((row) => selected.has(row.id)).length;
    summary.textContent = group;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = picked > 0 ? `${picked}/${rows.length} selected` : `${rows.length}`;
    summary.append(count);
    details.append(summary);

    const list = document.createElement('ul');
    list.className = 'rows';
    for (const template of rows) {
      const item = document.createElement('li');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `t-${template.id}`;
      checkbox.checked = selected.has(template.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.set(template.id, defaultSelection(template));
        else selected.delete(template.id);
        renderTemplates();
        refreshHeader();
      });

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = template.label;

      const shape = document.createElement('code');
      shape.textContent = template.shape;

      item.append(checkbox, label, shape);

      if (template.stub) {
        const badge = document.createElement('span');
        badge.className = 'stub';
        badge.textContent = 'stub axes';
        badge.title = template.note ?? '';
        item.append(badge);
      }

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent =
        template.kind === 'layer'
          ? `${template.defaultCount} vars`
          : `+${template.defaultCount} of ${template.maxCount}`;
      item.append(meta);

      list.append(item);
    }
    details.append(list);
    host.append(details);
  }
};

const refreshHeader = () => {
  const total = totalCount();
  $<HTMLButtonElement>('toAxes').disabled = selected.size === 0;
  $<HTMLButtonElement>('apply').disabled = selected.size === 0 || dryRunPaths.length === 0;
  write(
    selected.size === 0
      ? 'Nothing is selected — that is the default. Apply is disabled.'
      : `${selected.size} template(s) selected · ${total} variable(s) will be created as empty shells.`
  );
  setStep(step);
};

/* ---------------------------------------------------------------- step 2 */

const renderAxisPanels = () => {
  const host = $<HTMLDivElement>('axisPanels');
  host.innerHTML = '';

  for (const id of selected.keys()) {
    const template = byId(id);
    const selection = selected.get(id)!;

    const panel = document.createElement('div');
    panel.className = 'axisPanel';

    const heading = document.createElement('h3');
    heading.textContent = template.label;
    panel.append(heading);

    const shape = document.createElement('code');
    shape.textContent = template.shape;
    panel.append(shape);

    if (template.kind === 'layer') {
      const fixed = document.createElement('p');
      fixed.className = 'hint';
      fixed.textContent = `${template.summary ?? ''} Fixed at ${template.defaultCount} paths — no axes to tick.`;
      panel.append(fixed);
      host.append(panel);
      continue;
    }

    if (template.variantProp) {
      const provenance = document.createElement('p');
      provenance.className = 'hint';
      provenance.textContent = `Appearance axis comes from the Spiral "${template.variantProp}" prop.`;
      panel.append(provenance);
    }
    if (template.note) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = template.note;
      panel.append(note);
    }

    const tally = document.createElement('span');
    tally.className = 'tally';

    const retally = () => {
      const combos = (template.axes ?? [])
        .map((axis) => selection.axes[axis.slot]?.length ?? 0)
        .join(' × ');
      const count = countTemplate(template);
      tally.textContent = `${combos} = ${count}`;
      tally.className = `tally${count > thresholds.confirm ? ' danger' : count > thresholds.warn ? ' warn' : ''}`;
      refreshAxisWarning();
    };

    for (const axis of template.axes ?? []) {
      const block = document.createElement('div');
      block.className = 'axis';

      const label = document.createElement('span');
      label.className = 'axisLabel';
      label.textContent = axis.labelZh ? `${axis.label} · ${axis.labelZh}` : axis.label;
      if (axis.note) label.title = axis.note;
      block.append(label);

      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const value of axis.values) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = value;
        const sync = () =>
          chip.classList.toggle('on', (selection.axes[axis.slot] ?? []).includes(value));
        sync();
        chip.addEventListener('click', () => {
          const current = selection.axes[axis.slot] ?? [];
          selection.axes[axis.slot] = current.includes(value)
            ? current.filter((candidate) => candidate !== value)
            : axis.values.filter((candidate) => current.includes(candidate) || candidate === value);
          sync();
          retally();
          refreshHeader();
        });
        chips.append(chip);
      }
      block.append(chips);
      panel.append(block);
    }

    if ((template.extras ?? 0) > 0) {
      const extras = document.createElement('label');
      extras.className = 'toggle';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selection.includeExtras;
      box.addEventListener('change', () => {
        selection.includeExtras = box.checked;
        retally();
        refreshHeader();
      });
      extras.append(box, document.createTextNode(`Include ${template.extras} single-point tokens (FLOAT)`));
      panel.append(extras);
    }

    const foot = document.createElement('div');
    foot.className = 'panelFoot';
    const button = (text: string, action: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = text;
      element.addEventListener('click', () => {
        action();
        renderAxisPanels();
        refreshHeader();
      });
      return element;
    };
    foot.append(
      button('Select all', () => {
        for (const axis of template.axes ?? []) selection.axes[axis.slot] = [...axis.values];
      }),
      button('Clear', () => {
        for (const axis of template.axes ?? []) selection.axes[axis.slot] = [];
      }),
      button('Reset', () => {
        selected.set(template.id, defaultSelection(template));
      }),
      tally
    );
    panel.append(foot);
    host.append(panel);
    retally();
  }
};

const refreshAxisWarning = () => {
  const banner = $<HTMLDivElement>('axisWarning');
  const total = totalCount();
  if (total > thresholds.confirm) {
    banner.className = 'banner danger';
    banner.textContent = `${total} variables. Above ${thresholds.confirm} Apply asks for a second confirmation — a full cross product is rarely what you want.`;
    return;
  }
  if (total > thresholds.warn) {
    banner.className = 'banner warn';
    banner.textContent = `${total} variables. Above ${thresholds.warn} the run gets slow and the list gets hard to review.`;
    return;
  }
  banner.className = 'banner hidden';
};

/* ---------------------------------------------------------------- step 3 */

const renderPaths = () => {
  const filter = $<HTMLInputElement>('pathFilter').value.trim().toLowerCase();
  const rows = dryRunPaths.filter(
    (row) => !filter || `${row.collection}/${row.path}`.toLowerCase().includes(filter)
  );
  const byCollection = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byCollection.get(row.collection) ?? [];
    bucket.push(row);
    byCollection.set(row.collection, bucket);
  }
  const lines: string[] = [];
  for (const [collection, bucket] of byCollection) {
    lines.push(`# ${collection} (${bucket.length})`);
    for (const row of bucket) {
      lines.push(`  ${row.status === 'new' ? '+' : '·'} ${row.path}`);
    }
    lines.push('');
  }
  pathsPane.textContent = lines.join('\n').trimEnd() || 'No path matches the filter.';
};

const copy = (text: string) => {
  const area = document.createElement('textarea');
  area.value = text;
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
};

/* ------------------------------------------------------------- advanced */

const renderNamespaces = (namespaces: Array<{ key: string; shape: string; valueKind: string; modes: string[] }>) => {
  const list = $<HTMLUListElement>('namespaces');
  list.innerHTML = '';
  for (const namespace of namespaces) {
    const item = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = namespace.key;
    checkbox.checked = false;
    checkbox.id = `ns-${namespace.key}`;

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = namespace.key;

    const shape = document.createElement('code');
    shape.textContent = namespace.shape;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${namespace.valueKind} · ${namespace.modes.join('/')}`;

    item.append(checkbox, label, shape, meta);
    list.append(item);
  }
};

const renderSeeds = (seeds: Record<string, string>) => {
  const grid = $<HTMLDivElement>('seeds');
  grid.innerHTML = '';
  for (const [family, value] of Object.entries(seeds)) {
    const label = document.createElement('label');
    label.className = 'seed';
    const text = document.createElement('span');
    text.textContent = family;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = family;
    input.value = value;
    label.append(text, input);
    grid.append(label);
  }
};

const selectedNamespaces = () =>
  [...$<HTMLUListElement>('namespaces').querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    .filter((input) => input.checked)
    .map((input) => input.value);

const seedValues = () =>
  [...$<HTMLDivElement>('seeds').querySelectorAll<HTMLInputElement>('input[type=text]')].reduce<
    Record<string, string>
  >((acc, input) => {
    if (input.value.trim()) acc[input.name] = input.value.trim();
    return acc;
  }, {});

/* -------------------------------------------------------------- reports */

const formatTemplatePlan = (payload: any) => {
  const created = payload.paths.filter((row: any) => row.status === 'new').length;
  const existing = payload.paths.length - created;
  const lines = [
    `Dry-run: ${created} to create · ${existing} already there · ${payload.invalid.length} paradigm violation(s)`
  ];
  for (const [id, count] of Object.entries(payload.counts)) {
    lines.push(`  ${id}: ${count}`);
  }
  if (payload.excluded.length) {
    lines.push('', `Excluded by template rules: ${payload.excluded.length}`);
    for (const row of payload.excluded.slice(0, 6)) lines.push(`  ${row.path} — ${row.why}`);
    if (payload.excluded.length > 6) lines.push(`  … ${payload.excluded.length - 6} more`);
  }
  if (payload.invalid.length) {
    lines.push('', 'Violations (Apply is disabled until these are gone):');
    for (const row of payload.invalid.slice(0, 10)) {
      lines.push(`  ${row.path} — ${row.issues.join('; ')}`);
    }
  }
  return lines.join('\n');
};

const renderModeBanner = (budget: Array<{ collection: string; needs: string[]; has: string[]; exists: boolean }>) => {
  const banner = $<HTMLDivElement>('modeBanner');
  const short = budget.filter((row) => row.exists && row.has.length < row.needs.length);
  const multi = budget.filter((row) => row.needs.length > 1);
  if (short.length > 0) {
    banner.className = 'banner danger';
    banner.textContent = `Mode shortfall: ${short
      .map((row) => `${row.collection} has ${row.has.length}/${row.needs.length}`)
      .join(', ')}. On a Figma plan capped at one variable mode the extra modes cannot be created, and half of each collection will not exist.`;
    return;
  }
  if (multi.length > 0) {
    banner.className = 'banner';
    banner.textContent = `${multi.length} collection(s) need ${multi[0].needs.join(' + ')} modes. A Figma plan capped at one mode will drop the second one — check the result summary.`;
    return;
  }
  banner.className = 'banner hidden';
};

const formatApplied = (payload: any) => {
  const summary = payload.summary;
  const lines = [
    `Applied ${payload.total} entry(s): ${summary.unbound.length} empty shell(s) created, ${summary.existing.length} already existed and were left untouched.`,
    '',
    `Every shell was created with a path and a type only — setValueForMode was never called, so each mode holds Figma's own initial value (COLOR → opaque black, FLOAT → 0, STRING → empty, BOOLEAN → false). They are marked "${unboundNote}" in the variable description.`,
    ''
  ];
  for (const collection of summary.collections) {
    const missing = collection.missingModes.length
      ? `, missing modes: ${collection.missingModes.join('/')}`
      : '';
    lines.push(`  ${collection.name}${collection.created ? ' (created)' : ' (reused)'}${missing}`);
  }
  if (summary.modeLimit.length) {
    lines.push(
      '',
      `MODE LIMIT — ${summary.modeLimit.length} mode(s) could not be created: ${summary.modeLimit.join(', ')}.`,
      'This file\'s Figma plan caps variable modes. Those variables exist in the modes that were created only.'
    );
  }
  if (summary.skipped.length) {
    lines.push('', `Skipped ${summary.skipped.length}:`);
    for (const item of summary.skipped.slice(0, 10)) lines.push(`  ${item.path} — ${item.reason}`);
  }
  if (payload.unfilledList) {
    lines.push('', 'Still to fill:', payload.unfilledList);
  }
  return lines.join('\n');
};

const formatFullPlan = (payload: any) => {
  const lines = [
    `Dry-run: ${payload.total} variable(s) across ${payload.collections.length} collection(s)`,
    ''
  ];
  for (const collection of payload.collections) {
    lines.push(
      `${String(collection.count).padStart(4)}  ${collection.collection}  [${collection.modes.join('/')}, ${collection.valueKind}]`
    );
  }
  if (payload.invalid?.length) {
    lines.push('', `Paradigm violations in the plan: ${payload.invalid.length}`);
    for (const item of payload.invalid.slice(0, 10)) {
      lines.push(`  ${item.path} — ${item.issues.join('; ')}`);
    }
  }
  lines.push('', 'First paths:', ...payload.sample.map((line: string) => `  ${line}`));
  return lines.join('\n');
};

const formatReport = (payload: any) => {
  const lines = [
    `Check: ${payload.total} local variable(s), ${payload.validCount} legal, ${payload.invalidCount} violating, ${payload.unfilledCount} still marked unfilled`,
    `Paradigm collections present: ${payload.paradigmCollections.join(', ') || 'none'}`
  ];
  if (payload.violations.length) {
    lines.push('', 'Violations:');
    for (const row of payload.violations) {
      lines.push(`  [${row.collection}] ${row.path}${row.retired ? '  (retired type)' : ''}`);
      for (const issue of row.issues) lines.push(`      ${issue}`);
    }
  }
  return lines.join('\n');
};

/* ------------------------------------------------------------- wiring */

$<HTMLInputElement>('search').addEventListener('input', renderTemplates);
$<HTMLInputElement>('pathFilter').addEventListener('input', renderPaths);

$<HTMLButtonElement>('clearAll').addEventListener('click', () => {
  selected.clear();
  dryRunPaths = [];
  renderTemplates();
  refreshHeader();
});

$<HTMLButtonElement>('toAxes').addEventListener('click', () => {
  renderAxisPanels();
  setStep(2);
});

$<HTMLButtonElement>('backTo1').addEventListener('click', () => {
  renderTemplates();
  setStep(1);
});

$<HTMLButtonElement>('toDryRun').addEventListener('click', () => {
  write('Expanding…');
  setStep(3);
  post({
    type: 'templateDryRun',
    selections: selectionPayload(),
    hiddenFromPublishing: $<HTMLInputElement>('hiddenFromPublishing').checked
  });
});

$<HTMLButtonElement>('backTo2').addEventListener('click', () => {
  renderAxisPanels();
  setStep(2);
});

$<HTMLButtonElement>('backTo3').addEventListener('click', () => setStep(3));

$<HTMLButtonElement>('copyPaths').addEventListener('click', () => {
  copy(dryRunPaths.map((row) => `${row.collection}/${row.path}`).join('\n'));
});

$<HTMLButtonElement>('copyUnfilled').addEventListener('click', () => copy(unfilledList));

$<HTMLButtonElement>('apply').addEventListener('click', () => {
  const total = totalCount();
  if (
    total > thresholds.confirm &&
    !confirm(`${total} variables in one run. Create them all?`)
  ) {
    return;
  }
  write('Applying…');
  setStep(4);
  $<HTMLProgressElement>('progress').value = 0;
  post({
    type: 'templateApply',
    selections: selectionPayload(),
    hiddenFromPublishing: $<HTMLInputElement>('hiddenFromPublishing').checked
  });
});

$<HTMLButtonElement>('fullDryRun').addEventListener('click', () => {
  write('Expanding the complete paradigm…');
  post({
    type: 'fullDryRun',
    namespaces: selectedNamespaces(),
    seeds: seedValues(),
    allEffects: $<HTMLInputElement>('allEffects').checked
  });
});

$<HTMLButtonElement>('fullApply').addEventListener('click', () => {
  const namespaces = selectedNamespaces();
  if (namespaces.length === 0) {
    write('No namespace selected in the advanced section.', true);
    return;
  }
  if (!confirm(`Write the complete paradigm with preset values for: ${namespaces.join(', ')}?`)) {
    return;
  }
  write('Applying the complete paradigm…');
  post({
    type: 'fullApply',
    namespaces,
    seeds: seedValues(),
    allEffects: $<HTMLInputElement>('allEffects').checked
  });
});

$<HTMLButtonElement>('validateFile').addEventListener('click', () => {
  write('Reading local variables…');
  post({ type: 'validateFile' });
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data?.pluginMessage;
  if (!message) return;

  if (message.type === 'init') {
    templates = message.templates;
    thresholds = message.thresholds;
    unboundNote = message.unboundNote;
    renderTemplates();
    renderNamespaces(message.namespaces);
    renderSeeds(message.seeds);
    refreshHeader();
    setStep(1);
    return;
  }
  if (message.type === 'templatePlan') {
    dryRunPaths = message.paths;
    renderModeBanner(message.modeBudget);
    renderPaths();
    write(formatTemplatePlan(message));
    $<HTMLButtonElement>('apply').disabled = message.invalid.length > 0 || message.total === 0;
    return;
  }
  if (message.type === 'progress') {
    const bar = $<HTMLProgressElement>('progress');
    bar.max = message.total || 1;
    bar.value = message.done;
    $('progressText').textContent = `${message.done} / ${message.total} — ${message.collection}`;
    return;
  }
  if (message.type === 'templateApplied') {
    unfilledList = message.unfilledList ?? '';
    $<HTMLProgressElement>('progress').value = $<HTMLProgressElement>('progress').max;
    $('progressText').textContent = `Done — ${message.summary.unbound.length} empty shell(s).`;
    write(formatApplied(message));
    return;
  }
  if (message.type === 'plan') {
    write(formatFullPlan(message));
    return;
  }
  if (message.type === 'applied') {
    write(
      `Applied ${message.total} variable(s): ${message.summary.created} created, ${message.summary.updated} updated.`
    );
    return;
  }
  if (message.type === 'report') {
    write(formatReport(message));
    return;
  }
  if (message.type === 'error') {
    write(`Error: ${message.message}`, true);
  }
});

post({ type: 'init' });
