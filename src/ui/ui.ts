/**
 * Four-step UI: pick templates → configure axes → dry-run the full path list →
 * Apply. Zero framework by design; the only state is `selected`, a map from
 * template id to the ticked axis values.
 *
 * User-facing copy is zh-CN; Spiral product chrome (brand, density, tokens)
 * lives in ui.html.
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
  summaryZh?: string;
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

/** Spiral Storybook group names → concise zh-CN for the panel. */
const GROUP_ZH: Record<string, string> = {
  'Foundation layer': '基础层',
  'Basic Input': '基础输入',
  'Information Collect': '信息采集',
  'Information Display': '信息展示',
  'Response And Feedback': '响应与反馈',
  'Structure Navigation': '结构导航',
  'System Composition': '系统构成'
};

const groupLabel = (group: string) => GROUP_ZH[group] ?? group;

const displayLabel = (template: TemplateSummary) => template.labelZh || template.label;

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
    const haystack =
      `${displayLabel(template)} ${template.label} ${template.id} ${template.shape} ${groupLabel(template.group)}`.toLowerCase();
    if (filter && !haystack.includes(filter)) continue;
    const bucket = groups.get(template.group) ?? [];
    bucket.push(template);
    groups.set(template.group, bucket);
  }

  if (groups.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = filter ? '没有匹配的模板。' : '暂无模板。';
    host.append(empty);
    return;
  }

  for (const [group, rows] of groups) {
    const details = document.createElement('details');
    details.className = 'group';
    details.open = !!filter || group === 'Foundation layer';

    const summary = document.createElement('summary');
    const picked = rows.filter((row) => selected.has(row.id)).length;
    summary.textContent = groupLabel(group);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = picked > 0 ? `${picked}/${rows.length} 已选` : `${rows.length}`;
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
      label.textContent = displayLabel(template);

      const shape = document.createElement('code');
      shape.textContent = template.shape;

      item.append(checkbox, label, shape);

      if (template.stub) {
        const badge = document.createElement('span');
        badge.className = 'stub';
        badge.textContent = '占位轴';
        badge.title = template.note ?? '';
        item.append(badge);
      }

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent =
        template.kind === 'layer'
          ? `${template.defaultCount} 个变量`
          : `默认 ${template.defaultCount} / 最多 ${template.maxCount}`;
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
      ? '未选模板（默认）。应用已禁用。'
      : `已选 ${selected.size} 个模板 · 将创建 ${total} 个空壳变量。`
  );
  setStep(step);
};

/* ---------------------------------------------------------------- step 2 */

const renderAxisPanels = () => {
  const host = $<HTMLDivElement>('axisPanels');
  host.innerHTML = '';

  if (selected.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '请先在上一步选择模板。';
    host.append(empty);
    return;
  }

  for (const id of selected.keys()) {
    const template = byId(id);
    const selection = selected.get(id)!;

    const panel = document.createElement('div');
    panel.className = 'axisPanel';

    const heading = document.createElement('h3');
    heading.textContent = displayLabel(template);
    panel.append(heading);

    const shape = document.createElement('code');
    shape.textContent = template.shape;
    panel.append(shape);

    if (template.kind === 'layer') {
      const fixed = document.createElement('p');
      fixed.className = 'hint';
      const summaryText = template.summaryZh || template.summary || '';
      fixed.textContent = `${summaryText} 固定 ${template.defaultCount} 条路径 — 无需勾选轴。`;
      panel.append(fixed);
      host.append(panel);
      continue;
    }

    if (template.variantProp) {
      const provenance = document.createElement('p');
      provenance.className = 'hint';
      provenance.textContent = `外观轴来自 Spiral「${template.variantProp}」属性。`;
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
      label.textContent = axis.labelZh || axis.label;
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
      extras.append(box, document.createTextNode(`包含 ${template.extras} 个单点 token（FLOAT）`));
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
      button('全选', () => {
        for (const axis of template.axes ?? []) selection.axes[axis.slot] = [...axis.values];
      }),
      button('清空', () => {
        for (const axis of template.axes ?? []) selection.axes[axis.slot] = [];
      }),
      button('重置', () => {
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
    banner.textContent = `${total} 个变量。超过 ${thresholds.confirm} 时应用会二次确认 — 全交叉积通常不是你要的。`;
    return;
  }
  if (total > thresholds.warn) {
    banner.className = 'banner warn';
    banner.textContent = `${total} 个变量。超过 ${thresholds.warn} 会变慢，列表也更难审阅。`;
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
    lines.push(`# ${collection}（${bucket.length}）`);
    for (const row of bucket) {
      lines.push(`  ${row.status === 'new' ? '+' : '·'} ${row.path}`);
    }
    lines.push('');
  }
  pathsPane.textContent = lines.join('\n').trimEnd() || '没有匹配的路径。';
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
    `干跑：新建 ${created} · 已存在 ${existing} · 范式违规 ${payload.invalid.length}`
  ];
  for (const [id, count] of Object.entries(payload.counts)) {
    lines.push(`  ${id}: ${count}`);
  }
  if (payload.excluded.length) {
    lines.push('', `模板规则排除：${payload.excluded.length}`);
    for (const row of payload.excluded.slice(0, 6)) lines.push(`  ${row.path} — ${row.why}`);
    if (payload.excluded.length > 6) lines.push(`  … 另有 ${payload.excluded.length - 6} 条`);
  }
  if (payload.invalid.length) {
    lines.push('', '违规（清除前无法应用）：');
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
    banner.textContent = `模式不足：${short
      .map((row) => `${row.collection} 现有 ${row.has.length}/${row.needs.length}`)
      .join('，')}。若 Figma 套餐只允许一个变量模式，多出的模式无法创建，集合会缺一半。`;
    return;
  }
  if (multi.length > 0) {
    banner.className = 'banner';
    banner.textContent = `${multi.length} 个集合需要 ${multi[0].needs.join(' + ')} 模式。单模式套餐会丢掉第二个 — 请核对结果摘要。`;
    return;
  }
  banner.className = 'banner hidden';
};

const formatApplied = (payload: any) => {
  const summary = payload.summary;
  const lines = [
    `已应用 ${payload.total} 条：新建空壳 ${summary.unbound.length}，已存在未改动 ${summary.existing.length}。`,
    '',
    `每个空壳只写入路径与类型 — 从未调用 setValueForMode，各模式保留 Figma 初值（COLOR→不透明黑，FLOAT→0，STRING→空，BOOLEAN→false）。描述中标记为「${unboundNote}」。`,
    ''
  ];
  for (const collection of summary.collections) {
    const missing = collection.missingModes.length
      ? `，缺失模式：${collection.missingModes.join('/')}`
      : '';
    lines.push(`  ${collection.name}${collection.created ? '（新建）' : '（复用）'}${missing}`);
  }
  if (summary.modeLimit.length) {
    lines.push(
      '',
      `模式上限 — ${summary.modeLimit.length} 个模式无法创建：${summary.modeLimit.join(', ')}。`,
      '当前文件的 Figma 套餐限制了变量模式数。这些变量只存在于已创建的模式中。'
    );
  }
  if (summary.skipped.length) {
    lines.push('', `跳过 ${summary.skipped.length}：`);
    for (const item of summary.skipped.slice(0, 10)) lines.push(`  ${item.path} — ${item.reason}`);
  }
  if (payload.unfilledList) {
    lines.push('', '仍待填写：', payload.unfilledList);
  }
  return lines.join('\n');
};

const formatFullPlan = (payload: any) => {
  const lines = [
    `干跑：${payload.total} 个变量，跨 ${payload.collections.length} 个集合`,
    ''
  ];
  for (const collection of payload.collections) {
    lines.push(
      `${String(collection.count).padStart(4)}  ${collection.collection}  [${collection.modes.join('/')}, ${collection.valueKind}]`
    );
  }
  if (payload.invalid?.length) {
    lines.push('', `计划中的范式违规：${payload.invalid.length}`);
    for (const item of payload.invalid.slice(0, 10)) {
      lines.push(`  ${item.path} — ${item.issues.join('; ')}`);
    }
  }
  lines.push('', '路径示例：', ...payload.sample.map((line: string) => `  ${line}`));
  return lines.join('\n');
};

const formatReport = (payload: any) => {
  const lines = [
    `检查：本地变量 ${payload.total}，合法 ${payload.validCount}，违规 ${payload.invalidCount}，仍标记待填 ${payload.unfilledCount}`,
    `已有范式集合：${payload.paradigmCollections.join(', ') || '无'}`
  ];
  if (payload.violations.length) {
    lines.push('', '违规：');
    for (const row of payload.violations) {
      lines.push(`  [${row.collection}] ${row.path}${row.retired ? '  （已退役类型）' : ''}`);
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
  write('正在展开…');
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
  if (total > thresholds.confirm && !confirm(`一次创建 ${total} 个变量。确认全部创建？`)) {
    return;
  }
  write('正在应用…');
  setStep(4);
  $<HTMLProgressElement>('progress').value = 0;
  post({
    type: 'templateApply',
    selections: selectionPayload(),
    hiddenFromPublishing: $<HTMLInputElement>('hiddenFromPublishing').checked
  });
});

$<HTMLButtonElement>('fullDryRun').addEventListener('click', () => {
  write('正在展开完整范式…');
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
    write('高级区未选命名空间。', true);
    return;
  }
  if (!confirm(`为以下命名空间写入含预设值的完整范式：${namespaces.join(', ')}？`)) {
    return;
  }
  write('正在应用完整范式…');
  post({
    type: 'fullApply',
    namespaces,
    seeds: seedValues(),
    allEffects: $<HTMLInputElement>('allEffects').checked
  });
});

$<HTMLButtonElement>('validateFile').addEventListener('click', () => {
  write('正在读取本地变量…');
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
    $('progressText').textContent = `完成 — 空壳 ${message.summary.unbound.length} 个。`;
    write(formatApplied(message));
    return;
  }
  if (message.type === 'plan') {
    write(formatFullPlan(message));
    return;
  }
  if (message.type === 'applied') {
    write(`已应用 ${message.total} 个变量：新建 ${message.summary.created}，更新 ${message.summary.updated}。`);
    return;
  }
  if (message.type === 'report') {
    write(formatReport(message));
    return;
  }
  if (message.type === 'error') {
    write(`错误：${message.message}`, true);
  }
});

post({ type: 'init' });
