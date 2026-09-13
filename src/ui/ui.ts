type NamespaceInfo = {
  key: string;
  collection: string;
  modes: string[];
  valueKind: string;
  shape: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const output = $<HTMLPreElement>('output');
const namespaceList = $<HTMLUListElement>('namespaces');
const seedGrid = $<HTMLDivElement>('seeds');
const allEffects = $<HTMLInputElement>('allEffects');

const post = (message: unknown) => parent.postMessage({ pluginMessage: message }, '*');

const write = (text: string, isError = false) => {
  output.textContent = text;
  output.classList.toggle('error', isError);
};

const selectedNamespaces = () =>
  [...namespaceList.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    .filter((input) => input.checked)
    .map((input) => input.value);

const seedValues = () =>
  [...seedGrid.querySelectorAll<HTMLInputElement>('input[type=text]')].reduce<
    Record<string, string>
  >((acc, input) => {
    if (input.value.trim()) acc[input.name] = input.value.trim();
    return acc;
  }, {});

const renderNamespaces = (namespaces: NamespaceInfo[]) => {
  namespaceList.innerHTML = '';
  for (const namespace of namespaces) {
    const item = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = namespace.key;
    checkbox.checked = true;
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
    namespaceList.append(item);
  }
};

const renderSeeds = (seeds: Record<string, string>) => {
  seedGrid.innerHTML = '';
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
    seedGrid.append(label);
  }
};

const formatPlan = (payload: any) => {
  const lines = [`Dry-run: ${payload.total} variable(s) across ${payload.collections.length} collection(s)`, ''];
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

const formatApplied = (payload: any) => {
  const lines = [
    `Applied ${payload.total} variable(s): ${payload.summary.created} created, ${payload.summary.updated} updated`,
    ''
  ];
  for (const collection of payload.summary.collections) {
    const missing = collection.missingModes.length
      ? `, missing modes: ${collection.missingModes.join('/')} (Figma plan limit)`
      : '';
    lines.push(`  ${collection.collection ?? collection.name}${collection.created ? ' (created)' : ' (reused)'}${missing}`);
  }
  if (payload.summary.skipped.length) {
    lines.push('', `Skipped ${payload.summary.skipped.length}:`);
    for (const item of payload.summary.skipped.slice(0, 10)) {
      lines.push(`  ${item.path} — ${item.reason}`);
    }
  }
  return lines.join('\n');
};

const formatReport = (payload: any) => {
  const lines = [
    `Validate: ${payload.total} local variable(s), ${payload.validCount} legal, ${payload.invalidCount} violating`,
    `Paradigm collections present: ${payload.paradigmCollections.join(', ') || 'none'}`
  ];
  if (payload.violations.length) {
    lines.push('', 'Violations:');
    for (const row of payload.violations) {
      lines.push(`  [${row.collection}] ${row.path}`);
      for (const issue of row.issues) lines.push(`      ${issue}`);
    }
  }
  return lines.join('\n');
};

$<HTMLButtonElement>('dryRun').addEventListener('click', () => {
  write('Expanding…');
  post({
    type: 'dryRun',
    namespaces: selectedNamespaces(),
    seeds: seedValues(),
    allEffects: allEffects.checked
  });
});

$<HTMLButtonElement>('apply').addEventListener('click', () => {
  write('Applying…');
  post({
    type: 'apply',
    namespaces: selectedNamespaces(),
    seeds: seedValues(),
    allEffects: allEffects.checked
  });
});

$<HTMLButtonElement>('validate').addEventListener('click', () => {
  write('Reading local variables…');
  post({ type: 'validate' });
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data?.pluginMessage;
  if (!message) return;

  if (message.type === 'init') {
    renderNamespaces(message.namespaces);
    renderSeeds(message.seeds);
    write(`Vocabulary ${message.version}. Dry-run first, then Apply.`);
    return;
  }
  if (message.type === 'plan') {
    write(formatPlan(message));
    return;
  }
  if (message.type === 'applied') {
    write(formatApplied(message));
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
