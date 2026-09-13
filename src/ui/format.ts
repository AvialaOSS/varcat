/** Report formatters — zh-CN, shared by the React panel. */

export const formatTemplatePlan = (payload: any) => {
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

export const formatApplied = (payload: any, unboundNote: string) => {
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

export const formatFullPlan = (payload: any) => {
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

export const formatReport = (payload: any) => {
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

export const copyText = (text: string) => {
  const area = document.createElement('textarea');
  area.value = text;
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
};
