/**
 * VarCat plugin panel — composed from `@aviala-design/spiral` React components.
 * Messaging and four-step template/dry-run/apply behavior match the prior vanilla UI.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  CheckboxInput,
  Fieldset,
  Input,
  Label,
  Pagehead,
  Progress,
  Scroll,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Steps,
  StepsItem,
  Switch,
  Tag,
  Typography
} from '@aviala-design/spiral';
import { copyText, formatApplied, formatFullPlan, formatReport, formatTemplatePlan } from './format';
import type {
  AxisSelection,
  DryRunPath,
  ModeBudgetRow,
  NamespaceSummary,
  TemplateSummary
} from './types';

const GROUP_ZH: Record<string, string> = {
  'Foundation layer': '基础层',
  'Basic Input': '基础输入',
  'Information Collect': '信息采集',
  'Information Display': '信息展示',
  'Response And Feedback': '响应与反馈',
  'Structure Navigation': '结构导航',
  'System Composition': '系统构成'
};

const STEP_LABELS = ['选模板', '配组件', '预览', '应用'] as const;

const groupLabel = (group: string) => GROUP_ZH[group] ?? group;
const displayLabel = (template: TemplateSummary) => template.labelZh || template.label;

const post = (message: unknown) => parent.postMessage({ pluginMessage: message }, '*');

const defaultSelection = (template: TemplateSummary): AxisSelection => ({
  axes: (template.axes ?? []).reduce<Record<string, string[]>>((acc, axis) => {
    acc[axis.slot] = [...axis.default];
    return acc;
  }, {}),
  includeExtras: false
});

const countTemplate = (template: TemplateSummary, selection: AxisSelection): number => {
  if (template.kind === 'layer') return template.defaultCount;
  const combos = (template.axes ?? []).reduce(
    (product, axis) => product * (selection.axes[axis.slot]?.length ?? 0),
    1
  );
  return combos + (selection.includeExtras ? (template.extras ?? 0) : 0);
};

export function App() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [thresholds, setThresholds] = useState({ warn: 200, confirm: 500 });
  const [unboundNote, setUnboundNote] = useState('VarCat: 待填');
  const [selected, setSelected] = useState<Map<string, AxisSelection>>(() => new Map());
  const [dryRunPaths, setDryRunPaths] = useState<DryRunPath[]>([]);
  const [unfilledList, setUnfilledList] = useState('');
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [pathFilter, setPathFilter] = useState('');
  const [output, setOutput] = useState('就绪。默认未选任何模板。');
  const [outputError, setOutputError] = useState(false);
  const [axisWarning, setAxisWarning] = useState<{ type: 'warning' | 'error'; title: string } | null>(
    null
  );
  const [modeBanner, setModeBanner] = useState<{ type: 'info' | 'error'; title: string } | null>(null);
  const [hiddenFromPublishing, setHiddenFromPublishing] = useState(true);
  const [applyDisabled, setApplyDisabled] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 1, text: '空闲。' });
  const [namespaces, setNamespaces] = useState<NamespaceSummary[]>([]);
  const [nsChecked, setNsChecked] = useState<Record<string, boolean>>({});
  const [seeds, setSeeds] = useState<Record<string, string>>({});
  const [allEffects, setAllEffects] = useState(false);

  const byId = useCallback(
    (id: string) => templates.find((template) => template.id === id)!,
    [templates]
  );

  const totalCount = useMemo(() => {
    let total = 0;
    for (const [id, selection] of selected) {
      const template = templates.find((row) => row.id === id);
      if (template) total += countTemplate(template, selection);
    }
    return total;
  }, [selected, templates]);

  const selectionPayload = () =>
    [...selected.entries()].map(([id, selection]) => ({
      id,
      axes: selection.axes,
      includeExtras: selection.includeExtras
    }));

  const write = (text: string, isError = false) => {
    setOutput(text);
    setOutputError(isError);
  };

  const refreshAxisWarning = useCallback(
    (total: number) => {
      if (total > thresholds.confirm) {
        setAxisWarning({
          type: 'error',
          title: `${total} 个变量。超过 ${thresholds.confirm} 时应用会二次确认 — 全交叉积通常不是你要的。`
        });
        return;
      }
      if (total > thresholds.warn) {
        setAxisWarning({
          type: 'warning',
          title: `${total} 个变量。超过 ${thresholds.warn} 会变慢，列表也更难审阅。`
        });
        return;
      }
      setAxisWarning(null);
    },
    [thresholds]
  );

  useEffect(() => {
    refreshAxisWarning(totalCount);
  }, [totalCount, refreshAxisWarning]);

  useEffect(() => {
    if (step > 2) return;
    write(
      selected.size === 0
        ? '未选模板（默认）。应用已禁用。'
        : `已选 ${selected.size} 个模板 · 将创建 ${totalCount} 个空壳变量。`
    );
  }, [selected, totalCount, step]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data?.pluginMessage;
      if (!message) return;

      if (message.type === 'init') {
        setTemplates(message.templates);
        setThresholds(message.thresholds);
        setUnboundNote(message.unboundNote);
        setNamespaces(message.namespaces);
        setNsChecked({});
        setSeeds(message.seeds);
        setSelected(new Map());
        setDryRunPaths([]);
        setStep(1);
        write('就绪。默认未选任何模板。');
        setApplyDisabled(true);
        return;
      }
      if (message.type === 'templatePlan') {
        setDryRunPaths(message.paths);
        const budget = message.modeBudget as ModeBudgetRow[];
        const short = budget.filter((row) => row.exists && row.has.length < row.needs.length);
        const multi = budget.filter((row) => row.needs.length > 1);
        if (short.length > 0) {
          setModeBanner({
            type: 'error',
            title: `模式不足：${short
              .map((row) => `${row.collection} 现有 ${row.has.length}/${row.needs.length}`)
              .join('，')}。若 Figma 套餐只允许一个变量模式，多出的模式无法创建，集合会缺一半。`
          });
        } else if (multi.length > 0) {
          setModeBanner({
            type: 'info',
            title: `${multi.length} 个集合需要 ${multi[0].needs.join(' + ')} 模式。单模式套餐会丢掉第二个 — 请核对结果摘要。`
          });
        } else {
          setModeBanner(null);
        }
        write(formatTemplatePlan(message));
        setApplyDisabled(message.invalid.length > 0 || message.total === 0);
        return;
      }
      if (message.type === 'progress') {
        setProgress({
          done: message.done,
          total: message.total || 1,
          text: `${message.done} / ${message.total} — ${message.collection}`
        });
        return;
      }
      if (message.type === 'templateApplied') {
        setUnfilledList(message.unfilledList ?? '');
        setProgress({
          done: message.total || 1,
          total: message.total || 1,
          text: `完成 — 空壳 ${message.summary.unbound.length} 个。`
        });
        write(formatApplied(message, unboundNote));
        return;
      }
      if (message.type === 'plan') {
        write(formatFullPlan(message));
        return;
      }
      if (message.type === 'applied') {
        write(
          `已应用 ${message.total} 个变量：新建 ${message.summary.created}，更新 ${message.summary.updated}。`
        );
        return;
      }
      if (message.type === 'report') {
        write(formatReport(message));
        return;
      }
      if (message.type === 'error') {
        write(`错误：${message.message}`, true);
      }
    };

    window.addEventListener('message', onMessage);
    post({ type: 'init' });
    return () => window.removeEventListener('message', onMessage);
  }, [unboundNote]);

  const groups = useMemo(() => {
    const map = new Map<string, TemplateSummary[]>();
    const filter = search.trim().toLowerCase();
    for (const template of templates) {
      if (groupFilter !== 'all' && template.group !== groupFilter) continue;
      const haystack =
        `${displayLabel(template)} ${template.label} ${template.id} ${template.shape} ${groupLabel(template.group)}`.toLowerCase();
      if (filter && !haystack.includes(filter)) continue;
      const bucket = map.get(template.group) ?? [];
      bucket.push(template);
      map.set(template.group, bucket);
    }
    return map;
  }, [templates, search, groupFilter]);

  const groupOptions = useMemo(
    () => [...new Set(templates.map((template) => template.group))],
    [templates]
  );

  const pathText = useMemo(() => {
    const filter = pathFilter.trim().toLowerCase();
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
    return lines.join('\n').trimEnd() || '没有匹配的路径。';
  }, [dryRunPaths, pathFilter]);

  const headerStatus =
    selected.size === 0
      ? '未选模板（默认）。应用已禁用。'
      : `已选 ${selected.size} 个模板 · 将创建 ${totalCount} 个空壳变量。`;

  const toggleTemplate = (template: TemplateSummary, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(template.id, defaultSelection(template));
      else next.delete(template.id);
      return next;
    });
  };

  const updateSelection = (id: string, mutate: (selection: AxisSelection) => AxisSelection) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (!current) return prev;
      next.set(id, mutate({ axes: { ...current.axes }, includeExtras: current.includeExtras }));
      return next;
    });
  };

  const stepState = (index: number) => {
    if (index + 1 < step) return 'done' as const;
    if (index + 1 === step) return 'inProgress' as const;
    if (selected.size === 0 && index > 0) return 'waiting' as const;
    return 'default' as const;
  };

  return (
    <div className="vc-shell">
      <Stack gap="content" direction="column">
        <Pagehead
          title="VarCat"
          description="按 Spiral 命名创建 Figma Variables 空壳：选模板、勾选轴，应用后只写入路径与类型，数值留给你填。不是 ColorCat（色阶生成器）。"
          actions={
            <Badge style="theme" level="caption" primary>
              Spiral
            </Badge>
          }
        />

        <Steps direction="horizontal">
          {STEP_LABELS.map((label, index) => (
            <StepsItem
              key={label}
              index={index + 1}
              state={stepState(index)}
              title={`${index + 1} · ${label}`}
              onClick={() => {
                if (index === 0) setStep(1);
                else if (selected.size > 0 && index + 1 <= Math.max(step, 2)) setStep(index + 1);
              }}
              style={{ cursor: index === 0 || selected.size > 0 ? 'pointer' : 'default' }}
            />
          ))}
        </Steps>

        {step === 1 && (
          <Stack gap="component" direction="column">
            <div className="vc-row">
              <div className="grow">
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="筛选模板（按钮、标签页、色阶…）"
                  fullWidth
                  size="regular"
                />
              </div>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger aria-label="分组筛选" placeholder="全部分组">
                  <SelectValue placeholder="全部分组" />
                </SelectTrigger>
                <SelectContent portalled={false}>
                  <SelectItem value="all">全部分组</SelectItem>
                  {groupOptions.map((group) => (
                    <SelectItem key={group} value={group}>
                      {groupLabel(group)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                mode="outline"
                size="small"
                onClick={() => {
                  setSelected(new Map());
                  setDryRunPaths([]);
                  setApplyDisabled(true);
                }}
              >
                清空
              </Button>
            </div>

            {groups.size === 0 ? (
              <Typography level="caption">{search ? '没有匹配的模板。' : '暂无模板。'}</Typography>
            ) : (
              [...groups.entries()].map(([group, rows]) => {
                const picked = rows.filter((row) => selected.has(row.id)).length;
                return (
                  <details
                    key={group}
                    className="vc-group"
                    open={!!search || groupFilter !== 'all' || group === 'Foundation layer'}
                  >
                    <summary>
                      {groupLabel(group)}
                      <span className="vc-group-count">
                        {picked > 0 ? `${picked}/${rows.length} 已选` : `${rows.length}`}
                      </span>
                    </summary>
                    {rows.map((template) => (
                      <div key={template.id} className="vc-template-row">
                        <Checkbox
                          checked={selected.has(template.id)}
                          onCheckedChange={(value) => toggleTemplate(template, value === true)}
                          aria-label={displayLabel(template)}
                        />
                        <Stack gap="inside" direction="column" style={{ flex: 1, minWidth: 0 }}>
                          <Typography level="text">{displayLabel(template)}</Typography>
                          <Typography level="caption" className="vc-mono">
                            {template.shape}
                          </Typography>
                        </Stack>
                        {template.stub ? (
                          <Tag level="caption" title={template.note ?? ''}>
                            占位轴
                          </Tag>
                        ) : null}
                        <span className="vc-meta">
                          {template.kind === 'layer'
                            ? `${template.defaultCount} 个变量`
                            : `默认 ${template.defaultCount} / 最多 ${template.maxCount}`}
                        </span>
                      </div>
                    ))}
                  </details>
                );
              })
            )}

            <Button mode="primary" disabled={selected.size === 0} onClick={() => setStep(2)}>
              下一步：配组件 →
            </Button>
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="component" direction="column">
            {selected.size === 0 ? (
              <Typography level="caption">请先在上一步选择模板。</Typography>
            ) : (
              [...selected.keys()].map((id) => {
                const template = byId(id);
                const selection = selected.get(id)!;
                const count = countTemplate(template, selection);
                const combos = (template.axes ?? [])
                  .map((axis) => selection.axes[axis.slot]?.length ?? 0)
                  .join(' × ');

                return (
                  <div key={id} className="vc-panel">
                    <Stack gap="component" direction="column">
                      <Typography level="subtitle" as="h3">
                        {displayLabel(template)}
                      </Typography>
                      <Typography level="caption" className="vc-mono">
                        {template.shape}
                      </Typography>

                      {template.kind === 'layer' ? (
                        <Typography level="caption">
                          {template.summaryZh || template.summary || ''} 固定 {template.defaultCount}{' '}
                          条路径 — 无需勾选轴。
                        </Typography>
                      ) : (
                        <>
                          {template.variantProp ? (
                            <Typography level="caption">
                              外观轴来自 Spiral「{template.variantProp}」属性。
                            </Typography>
                          ) : null}
                          {template.note ? (
                            <Typography level="caption">{template.note}</Typography>
                          ) : null}

                          {(template.axes ?? []).map((axis) => (
                            <Stack key={axis.slot} gap="inside" direction="column">
                              <Typography level="caption" title={axis.note}>
                                {axis.labelZh || axis.label}
                              </Typography>
                              <div className="vc-chips">
                                {axis.values.map((value) => {
                                  const on = (selection.axes[axis.slot] ?? []).includes(value);
                                  return (
                                    <Button
                                      key={value}
                                      mode={on ? 'primary' : 'outline'}
                                      size="small"
                                      compact
                                      onClick={() =>
                                        updateSelection(id, (current) => {
                                          const list = current.axes[axis.slot] ?? [];
                                          current.axes[axis.slot] = list.includes(value)
                                            ? list.filter((candidate) => candidate !== value)
                                            : axis.values.filter(
                                                (candidate) =>
                                                  list.includes(candidate) || candidate === value
                                              );
                                          return current;
                                        })
                                      }
                                    >
                                      {value}
                                    </Button>
                                  );
                                })}
                              </div>
                            </Stack>
                          ))}

                          {(template.extras ?? 0) > 0 ? (
                            <div className="vc-row">
                              <Switch
                                checked={selection.includeExtras}
                                onCheckedChange={(checked) =>
                                  updateSelection(id, (current) => {
                                    current.includeExtras = checked;
                                    return current;
                                  })
                                }
                                size="small"
                              />
                              <Label>包含 {template.extras} 个单点 token（FLOAT）</Label>
                            </div>
                          ) : null}

                          <div className="vc-row">
                            <Button
                              mode="outline"
                              size="small"
                              onClick={() =>
                                updateSelection(id, (current) => {
                                  for (const axis of template.axes ?? []) {
                                    current.axes[axis.slot] = [...axis.values];
                                  }
                                  return current;
                                })
                              }
                            >
                              全选
                            </Button>
                            <Button
                              mode="outline"
                              size="small"
                              onClick={() =>
                                updateSelection(id, (current) => {
                                  for (const axis of template.axes ?? []) {
                                    current.axes[axis.slot] = [];
                                  }
                                  return current;
                                })
                              }
                            >
                              清空
                            </Button>
                            <Button
                              mode="outline"
                              size="small"
                              onClick={() =>
                                setSelected((prev) => {
                                  const next = new Map(prev);
                                  next.set(id, defaultSelection(template));
                                  return next;
                                })
                              }
                            >
                              重置
                            </Button>
                            <Typography level="caption" content="number" className="vc-meta">
                              {combos} = {count}
                            </Typography>
                          </div>
                        </>
                      )}
                    </Stack>
                  </div>
                );
              })
            )}

            {axisWarning ? (
              <Alert type={axisWarning.type} size="small" appearance="light" title={axisWarning.title} />
            ) : null}

            <div className="vc-row">
              <Button mode="outline" onClick={() => setStep(1)}>
                ← 选模板
              </Button>
              <Button
                mode="primary"
                onClick={() => {
                  write('正在展开…');
                  setStep(3);
                  post({
                    type: 'templateDryRun',
                    selections: selectionPayload(),
                    hiddenFromPublishing
                  });
                }}
              >
                下一步：预览 →
              </Button>
            </div>
          </Stack>
        )}

        {step === 3 && (
          <Stack gap="component" direction="column">
            {modeBanner ? (
              <Alert
                type={modeBanner.type === 'error' ? 'error' : 'info'}
                size="small"
                appearance="light"
                title={modeBanner.title}
              />
            ) : null}
            <div className="vc-row">
              <div className="grow">
                <Input
                  type="search"
                  value={pathFilter}
                  onChange={(event) => setPathFilter(event.target.value)}
                  placeholder="筛选路径"
                  fullWidth
                />
              </div>
              <Button
                mode="outline"
                size="small"
                onClick={() =>
                  copyText(dryRunPaths.map((row) => `${row.collection}/${row.path}`).join('\n'))
                }
              >
                复制
              </Button>
            </div>
            <Scroll size="small" style={{ maxHeight: 300 }}>
              <pre className="vc-mono vc-output">{pathText || '尚未预览。请先干跑。'}</pre>
            </Scroll>
            <div className="vc-row">
              <Button mode="outline" onClick={() => setStep(2)}>
                ← 配组件
              </Button>
              <Button
                mode="primary"
                disabled={selected.size === 0 || dryRunPaths.length === 0 || applyDisabled}
                onClick={() => {
                  if (
                    totalCount > thresholds.confirm &&
                    !confirm(`一次创建 ${totalCount} 个变量。确认全部创建？`)
                  ) {
                    return;
                  }
                  write('正在应用…');
                  setStep(4);
                  setProgress({ done: 0, total: 1, text: '空闲。' });
                  post({
                    type: 'templateApply',
                    selections: selectionPayload(),
                    hiddenFromPublishing
                  });
                }}
              >
                应用空壳
              </Button>
            </div>
          </Stack>
        )}

        {step === 4 && (
          <Stack gap="component" direction="column">
            <Progress
              value={Math.round((progress.done / Math.max(progress.total, 1)) * 100)}
              showLabel
              label={progress.text}
            />
            <Typography level="caption">{progress.text}</Typography>
            <div className="vc-row">
              <Button mode="outline" onClick={() => setStep(3)}>
                ← 预览
              </Button>
              <Button mode="outline" size="small" onClick={() => copyText(unfilledList)}>
                复制待填列表
              </Button>
            </div>
          </Stack>
        )}

        <div className="vc-row">
          <Switch
            checked={hiddenFromPublishing}
            onCheckedChange={setHiddenFromPublishing}
            size="small"
            id="hiddenFromPublishing"
          />
          <Label htmlFor="hiddenFromPublishing">未填空壳不发布到团队库</Label>
        </div>

        <Typography level="caption">{headerStatus}</Typography>
        <Scroll size="small" style={{ maxHeight: 300 }}>
          <pre className={`vc-mono vc-output${outputError ? ' error' : ''}`}>{output}</pre>
        </Scroll>

        <details className="vc-advanced">
          <summary>高级：完整范式（含预设值）</summary>
          <Stack gap="component" direction="column" style={{ marginTop: 8 }}>
            <Typography level="caption">
              原一键生成器。会为全部八个集合写入真实数值，也是种子色阶的唯一入口。模板流程通常不需要。
            </Typography>

            <Fieldset title="命名空间">
              <Stack gap="inside" direction="column">
                {namespaces.map((namespace) => (
                  <CheckboxInput
                    key={namespace.key}
                    title={namespace.key}
                    description={`${namespace.shape} · ${namespace.valueKind} · ${namespace.modes.join('/')}`}
                    checked={!!nsChecked[namespace.key]}
                    onCheckedChange={(value) =>
                      setNsChecked((prev) => ({ ...prev, [namespace.key]: value === true }))
                    }
                  />
                ))}
                <div className="vc-row">
                  <Switch checked={allEffects} onCheckedChange={setAllEffects} size="small" />
                  <Label>展开全部合法特效路径（默认仅启用白名单）</Label>
                </div>
              </Stack>
            </Fieldset>

            <Fieldset title="色阶种子">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 8
                }}
              >
                {Object.entries(seeds).map(([family, value]) => (
                  <Stack key={family} gap="inside" direction="column">
                    <Label htmlFor={`seed-${family}`}>{family}</Label>
                    <Input
                      id={`seed-${family}`}
                      value={value}
                      onChange={(event) =>
                        setSeeds((prev) => ({ ...prev, [family]: event.target.value }))
                      }
                      fullWidth
                    />
                  </Stack>
                ))}
              </div>
            </Fieldset>

            <div className="vc-row">
              <Button
                mode="outline"
                onClick={() => {
                  write('正在展开完整范式…');
                  post({
                    type: 'fullDryRun',
                    namespaces: Object.keys(nsChecked).filter((key) => nsChecked[key]),
                    seeds: Object.fromEntries(
                      Object.entries(seeds).filter(([, value]) => value.trim())
                    ),
                    allEffects
                  });
                }}
              >
                干跑完整范式
              </Button>
              <Button
                mode="primary"
                onClick={() => {
                  const keys = Object.keys(nsChecked).filter((key) => nsChecked[key]);
                  if (keys.length === 0) {
                    write('高级区未选命名空间。', true);
                    return;
                  }
                  if (!confirm(`为以下命名空间写入含预设值的完整范式：${keys.join(', ')}？`)) {
                    return;
                  }
                  write('正在应用完整范式…');
                  post({
                    type: 'fullApply',
                    namespaces: keys,
                    seeds: Object.fromEntries(
                      Object.entries(seeds).filter(([, value]) => value.trim())
                    ),
                    allEffects
                  });
                }}
              >
                生成完整范式（含预设值）
              </Button>
            </div>
            <Button
              mode="outline"
              onClick={() => {
                write('正在读取本地变量…');
                post({ type: 'validateFile' });
              }}
            >
              检查整个文件
            </Button>
          </Stack>
        </details>
      </Stack>
    </div>
  );
}
