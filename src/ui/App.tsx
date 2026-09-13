/**
 * VarCat plugin panel — composed from `@aviala-design/spiral` React components.
 *
 * Laid out as a fixed shell: Pagehead, step rail, one scrolling body, one
 * action footer. The plugin iframe is ~400px wide, so the primary action stays
 * in the same place on every step instead of drifting below a growing list, and
 * the raw report / advanced generator live on their own screens rather than
 * stacking under the wizard.
 *
 * Messaging and the four-step template → axes → dry-run → apply behaviour match
 * the vanilla UI this replaced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHead,
  Checkbox,
  CheckboxInput,
  Fieldset,
  Input,
  Label,
  List,
  ListGroup,
  ListItem,
  ListTitle,
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
  Axis,
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

/** Short enough that four steps fit the narrow iframe without wrapping. */
const STEPS = [
  { label: '模板', lede: '按 Spiral 命名建变量空壳 — 只建路径，不填值。' },
  { label: '配轴', lede: '勾选每个外观轴要展开的取值。' },
  { label: '预览', lede: '干跑结果 — 应用前核对路径。' },
  { label: '应用', lede: '路径与类型已写入，数值留给你填。' }
] as const;

/** Rows over this are dropped from the preview list to keep the panel responsive. */
const PATH_LIST_LIMIT = 300;

const groupLabel = (group: string) => GROUP_ZH[group] ?? group;
const displayLabel = (template: TemplateSummary) => template.labelZh || template.label;
const axisLabel = (axis: Axis) => axis.labelZh || axis.label;

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

type PlanStats = { created: number; existing: number; invalid: number; excluded: number };

type AppliedSummary = {
  total: number;
  unbound: number;
  existing: number;
  collections: Array<{ name: string; created: boolean; missingModes: string[] }>;
  modeLimit: string[];
};

type Banner = { type: 'info' | 'warning' | 'error'; title: string; description?: string };

type View = 'wizard' | 'log' | 'advanced';

/**
 * Alert with the panel's defaults. `size="small"` drops the description line
 * and `dismissible` defaults to true, so both are tied to the content.
 */
function Notice({
  type,
  title,
  description,
  onDismiss
}: {
  type: 'info' | 'warning' | 'error' | 'success' | 'neutral';
  title: string;
  description?: string;
  onDismiss?: () => void;
}) {
  return (
    <Alert
      type={type}
      size={description ? 'default' : 'small'}
      appearance="light"
      title={title}
      description={description}
      dismissible={!!onDismiss}
      onDismiss={onDismiss}
    />
  );
}

export function App() {
  const [view, setView] = useState<View>('wizard');
  const [step, setStep] = useState(1);

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [thresholds, setThresholds] = useState({ warn: 200, confirm: 500 });
  const [selected, setSelected] = useState<Map<string, AxisSelection>>(() => new Map());
  const [dryRunPaths, setDryRunPaths] = useState<DryRunPath[]>([]);
  const [planStats, setPlanStats] = useState<PlanStats | null>(null);
  const [applied, setApplied] = useState<AppliedSummary | null>(null);
  const [unfilledList, setUnfilledList] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, collection: '' });
  const [applyDisabled, setApplyDisabled] = useState(true);

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [pathFilter, setPathFilter] = useState('');
  const [hiddenFromPublishing, setHiddenFromPublishing] = useState(true);

  const [modeBanner, setModeBanner] = useState<Banner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('还没有运行任何操作。');

  const [namespaces, setNamespaces] = useState<NamespaceSummary[]>([]);
  const [nsChecked, setNsChecked] = useState<Record<string, boolean>>({});
  const [seeds, setSeeds] = useState<Record<string, string>>({});
  const [allEffects, setAllEffects] = useState(false);

  // Read inside the message handler; keeping it out of state stops `init` from
  // re-subscribing (and re-posting `init`) every time the registry answers.
  const unboundNote = useRef('VarCat: 待填');

  const totalCount = useMemo(() => {
    let total = 0;
    for (const [id, selection] of selected) {
      const template = templates.find((row) => row.id === id);
      if (template) total += countTemplate(template, selection);
    }
    return total;
  }, [selected, templates]);

  const selectionPayload = useCallback(
    () =>
      [...selected.entries()].map(([id, selection]) => ({
        id,
        axes: selection.axes,
        includeExtras: selection.includeExtras
      })),
    [selected]
  );

  /**
   * Editing the selection invalidates the dry-run: its path list no longer
   * describes what Apply would write, so drop it and re-lock the preview step.
   */
  const selectionKey = useMemo(() => JSON.stringify(selectionPayload()), [selectionPayload]);
  useEffect(() => {
    setDryRunPaths([]);
    setPlanStats(null);
    setApplied(null);
    setApplyDisabled(true);
  }, [selectionKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data?.pluginMessage;
      if (!message) return;

      if (message.type === 'init') {
        setTemplates(message.templates);
        setThresholds(message.thresholds);
        unboundNote.current = message.unboundNote;
        setNamespaces(message.namespaces);
        setNsChecked({});
        setSeeds(message.seeds);
        setSelected(new Map());
        setDryRunPaths([]);
        setPlanStats(null);
        setApplied(null);
        setStep(1);
        setError(null);
        setApplyDisabled(true);
        setLog('还没有运行任何操作。');
        return;
      }

      if (message.type === 'templatePlan') {
        const created = message.paths.filter((row: DryRunPath) => row.status === 'new').length;
        setDryRunPaths(message.paths);
        setPlanStats({
          created,
          existing: message.paths.length - created,
          invalid: message.invalid.length,
          excluded: message.excluded.length
        });

        const budget = message.modeBudget as ModeBudgetRow[];
        const short = budget.filter((row) => row.exists && row.has.length < row.needs.length);
        const multi = budget.filter((row) => row.needs.length > 1);
        if (short.length > 0) {
          setModeBanner({
            type: 'error',
            title: '模式不足，集合会缺一半',
            description: `${short
              .map((row) => `${row.collection} 现有 ${row.has.length}/${row.needs.length}`)
              .join('，')}。若 Figma 套餐只允许一个变量模式，多出的模式无法创建。`
          });
        } else if (multi.length > 0) {
          setModeBanner({
            type: 'info',
            title: `${multi.length} 个集合需要 ${multi[0].needs.join(' + ')} 模式`,
            description: '单模式套餐会丢掉第二个 — 请核对结果摘要。'
          });
        } else {
          setModeBanner(null);
        }

        setError(null);
        setLog(formatTemplatePlan(message));
        setApplyDisabled(message.invalid.length > 0 || message.total === 0);
        return;
      }

      if (message.type === 'progress') {
        setProgress({
          done: message.done,
          total: message.total || 0,
          collection: message.collection
        });
        return;
      }

      if (message.type === 'templateApplied') {
        setUnfilledList(message.unfilledList ?? '');
        setApplied({
          total: message.total,
          unbound: message.summary.unbound.length,
          existing: message.summary.existing.length,
          collections: message.summary.collections,
          modeLimit: message.summary.modeLimit
        });
        setProgress({ done: message.total, total: message.total, collection: '' });
        setLog(formatApplied(message, unboundNote.current));
        return;
      }

      if (message.type === 'plan') {
        setLog(formatFullPlan(message));
        setView('log');
        return;
      }

      if (message.type === 'applied') {
        setLog(
          `已应用 ${message.total} 个变量：新建 ${message.summary.created}，更新 ${message.summary.updated}。`
        );
        setView('log');
        return;
      }

      if (message.type === 'report') {
        setLog(formatReport(message));
        setView('log');
        return;
      }

      if (message.type === 'error') {
        setError(message.message);
        setLog(`错误：${message.message}`);
      }
    };

    window.addEventListener('message', onMessage);
    post({ type: 'init' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const groupOptions = useMemo(
    () => [...new Set(templates.map((template) => template.group))],
    [templates]
  );

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

  const picked = useMemo(
    () =>
      [...selected.keys()]
        .map((id) => templates.find((template) => template.id === id))
        .filter((template): template is TemplateSummary => !!template),
    [selected, templates]
  );

  const pathGroups = useMemo(() => {
    const filter = pathFilter.trim().toLowerCase();
    const map = new Map<string, DryRunPath[]>();
    for (const row of dryRunPaths) {
      if (filter && !`${row.collection}/${row.path}`.toLowerCase().includes(filter)) continue;
      const bucket = map.get(row.collection) ?? [];
      bucket.push(row);
      map.set(row.collection, bucket);
    }
    return map;
  }, [dryRunPaths, pathFilter]);

  const shownPathCount = useMemo(
    () => [...pathGroups.values()].reduce((sum, rows) => sum + rows.length, 0),
    [pathGroups]
  );

  const budgetBanner = useMemo<Banner | null>(() => {
    if (totalCount > thresholds.confirm) {
      return {
        type: 'error',
        title: `${totalCount} 个变量 — 超过 ${thresholds.confirm}`,
        description: '应用前会二次确认。全交叉积通常不是你要的结果。'
      };
    }
    if (totalCount > thresholds.warn) {
      return {
        type: 'warning',
        title: `${totalCount} 个变量 — 超过 ${thresholds.warn}`,
        description: '写入会变慢，列表也更难审阅。'
      };
    }
    return null;
  }, [totalCount, thresholds]);

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
      const current = prev.get(id);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(id, mutate({ axes: { ...current.axes }, includeExtras: current.includeExtras }));
      return next;
    });
  };

  const clearAll = () => {
    setSelected(new Map());
    setDryRunPaths([]);
    setPlanStats(null);
    setApplyDisabled(true);
  };

  const runDryRun = () => {
    setStep(3);
    setError(null);
    post({ type: 'templateDryRun', selections: selectionPayload(), hiddenFromPublishing });
  };

  const runApply = () => {
    if (totalCount > thresholds.confirm && !confirm(`一次创建 ${totalCount} 个变量。确认全部创建？`)) {
      return;
    }
    setStep(4);
    setError(null);
    setApplied(null);
    setProgress({ done: 0, total: totalCount, collection: '' });
    post({ type: 'templateApply', selections: selectionPayload(), hiddenFromPublishing });
  };

  /** Step 3 needs a dry-run; step 4 is only reachable by applying. */
  const maxStep = selected.size === 0 ? 1 : dryRunPaths.length > 0 ? 3 : 2;

  /**
   * `waiting` is the tinted "queued" pill and `default` the plain one, so a step
   * you can already open gets the tint and a locked one stays neutral.
   */
  const stepState = (index: number) => {
    const number = index + 1;
    if (number < step) return 'done' as const;
    if (number === step) return 'inProgress' as const;
    return number <= maxStep ? ('waiting' as const) : ('default' as const);
  };

  const gotoStep = (number: number) => {
    if (number === step || number > Math.max(maxStep, step)) return;
    setStep(number);
  };

  const headTitle = view === 'advanced' ? '高级：完整范式' : view === 'log' ? '运行日志' : 'VarCat';
  const headLede =
    view === 'advanced'
      ? '为整个命名空间写入含预设值的范式。'
      : view === 'log'
        ? '最近一次干跑 / 应用 / 检查的完整输出。'
        : STEPS[step - 1].lede;

  return (
    <div className="vc-shell">
      <Pagehead
        back={
          view === 'wizard' ? undefined : (
            <Button mode="noBackground" size="small" onClick={() => setView('wizard')}>
              返回
            </Button>
          )
        }
        title={headTitle}
        description={headLede}
        actions={
          view === 'wizard' ? (
            <Badge style="theme" level="caption" primary>
              空壳
            </Badge>
          ) : undefined
        }
      />

      {view === 'wizard' ? (
        <div className="vc-rail">
          <Steps direction="horizontal">
            {STEPS.map((entry, index) => {
              const reachable = index + 1 <= Math.max(maxStep, step);
              return (
                <StepsItem
                  key={entry.label}
                  className="vc-step"
                  index={index + 1}
                  state={stepState(index)}
                  title={entry.label}
                  role="button"
                  tabIndex={reachable ? 0 : -1}
                  aria-disabled={!reachable}
                  aria-current={index + 1 === step ? 'step' : undefined}
                  data-clickable={reachable}
                  onClick={() => gotoStep(index + 1)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    gotoStep(index + 1);
                  }}
                />
              );
            })}
          </Steps>
        </div>
      ) : null}

      <Scroll className="vc-body" size="small">
        <div className="vc-body-inner">
          <Stack gap="content" direction="column">
            {error ? (
              <Notice
                type="error"
                title="操作失败"
                description={error}
                onDismiss={() => setError(null)}
              />
            ) : null}

            {view === 'log' ? (
              <Stack gap="component" direction="column">
                <div className="vc-row">
                  <Button mode="outline" size="small" onClick={() => copyText(log)}>
                    复制全文
                  </Button>
                  <Typography level="caption" className="vc-push" content="number">
                    {log.split('\n').length} 行
                  </Typography>
                </div>
                <ListGroup>
                  <pre className="vc-mono vc-log">{log}</pre>
                </ListGroup>
              </Stack>
            ) : null}

            {view === 'advanced' ? (
              <AdvancedPanel
                namespaces={namespaces}
                nsChecked={nsChecked}
                setNsChecked={setNsChecked}
                seeds={seeds}
                setSeeds={setSeeds}
                allEffects={allEffects}
                setAllEffects={setAllEffects}
                onError={setError}
              />
            ) : null}

            {view === 'wizard' && step === 1 ? (
              <Stack gap="content" direction="column">
                <Stack gap="component" direction="column">
                  <Input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索模板或路径形状"
                    fullWidth
                  />
                  <div className="vc-row">
                    <Select value={groupFilter} onValueChange={setGroupFilter}>
                      <SelectTrigger className="vc-grow" aria-label="分组筛选">
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
                      size="regular"
                      disabled={selected.size === 0}
                      onClick={clearAll}
                    >
                      清空
                    </Button>
                  </div>
                </Stack>

                {groups.size === 0 ? (
                  <Notice
                    type="neutral"
                    title={templates.length === 0 ? '正在读取模板…' : '没有匹配的模板'}
                    description={
                      templates.length === 0 ? undefined : '换个关键词，或把分组切回「全部分组」。'
                    }
                  />
                ) : (
                  [...groups.entries()].map(([group, rows]) => (
                    <List key={group}>
                      <ListTitle>
                        <div className="vc-row vc-row--tight">
                          <Typography level="text">{groupLabel(group)}</Typography>
                          <Typography level="caption" className="vc-push" content="number">
                            {rows.filter((row) => selected.has(row.id)).length} / {rows.length}
                          </Typography>
                        </div>
                      </ListTitle>
                      <ListGroup>
                        {rows.map((template) => (
                          <TemplateRow
                            key={template.id}
                            template={template}
                            checked={selected.has(template.id)}
                            onToggle={toggleTemplate}
                          />
                        ))}
                      </ListGroup>
                    </List>
                  ))
                )}
              </Stack>
            ) : null}

            {view === 'wizard' && step === 2 ? (
              <AxisStep
                picked={picked}
                selected={selected}
                banner={budgetBanner}
                onUpdate={updateSelection}
                onReset={(template) =>
                  setSelected((prev) => new Map(prev).set(template.id, defaultSelection(template)))
                }
              />
            ) : null}

            {view === 'wizard' && step === 3 ? (
              <PreviewStep
                banner={modeBanner}
                stats={planStats}
                filter={pathFilter}
                onFilter={setPathFilter}
                pathGroups={pathGroups}
                shown={shownPathCount}
                total={dryRunPaths.length}
                hiddenFromPublishing={hiddenFromPublishing}
                onHiddenChange={setHiddenFromPublishing}
                onCopy={() =>
                  copyText(dryRunPaths.map((row) => `${row.collection}/${row.path}`).join('\n'))
                }
              />
            ) : null}

            {view === 'wizard' && step === 4 ? (
              <ApplyStep applied={applied} progress={progress} note={unboundNote.current} />
            ) : null}
          </Stack>
        </div>
      </Scroll>

      <div className="vc-foot">
        <Stack gap="component" direction="column">
          <div className="vc-row vc-row--tight">
            {view === 'wizard' ? (
              <Typography level="caption">
                {selected.size === 0
                  ? '未选模板 — 应用已禁用'
                  : `已选 ${selected.size} 个模板 · ${totalCount} 个空壳变量`}
              </Typography>
            ) : null}
            <Button
              mode="noBackground"
              size="tiny"
              className="vc-push"
              onClick={() => setView(view === 'log' ? 'wizard' : 'log')}
            >
              日志
            </Button>
            <Button
              mode="noBackground"
              size="tiny"
              onClick={() => setView(view === 'advanced' ? 'wizard' : 'advanced')}
            >
              高级
            </Button>
          </div>

          {view === 'wizard' ? (
            <div className="vc-row">
              {step > 1 ? (
                <Button mode="outline" size="regular" onClick={() => gotoStep(step - 1)}>
                  上一步
                </Button>
              ) : null}
              <Button
                mode="primary"
                size="regular"
                className="vc-grow"
                disabled={
                  step === 1
                    ? selected.size === 0
                    : step === 2
                      ? totalCount === 0
                      : step === 3
                        ? dryRunPaths.length === 0 || applyDisabled
                        : !unfilledList
                }
                onClick={
                  step === 1
                    ? () => setStep(2)
                    : step === 2
                      ? runDryRun
                      : step === 3
                        ? runApply
                        : () => copyText(unfilledList)
                }
              >
                {step === 1
                  ? '下一步：配轴'
                  : step === 2
                    ? `预览 ${totalCount} 条路径`
                    : step === 3
                      ? '应用空壳'
                      : '复制待填清单'}
              </Button>
            </div>
          ) : null}
        </Stack>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  checked,
  onToggle
}: {
  template: TemplateSummary;
  checked: boolean;
  onToggle: (template: TemplateSummary, checked: boolean) => void;
}) {
  const size =
    template.kind === 'layer'
      ? `${template.defaultCount}`
      : `${template.defaultCount}–${template.maxCount}`;

  return (
    <ListItem
      leading="default"
      selected={checked}
      onClick={() => onToggle(template, !checked)}
      icon={
        <Checkbox
          checked={checked}
          aria-label={displayLabel(template)}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(value) => onToggle(template, value === true)}
        />
      }
      title={
        <span className="vc-row vc-row--tight">
          <span className="vc-truncate">{displayLabel(template)}</span>
          {template.stub ? (
            <Tag level="caption" title={template.note ?? '占位轴：仅共享部件 × 状态词'}>
              占位
            </Tag>
          ) : null}
        </span>
      }
      subtitle={<span className="vc-mono">{template.shape}</span>}
      trailing={
        <Typography level="caption" content="number">
          {size}
        </Typography>
      }
    />
  );
}

function AxisStep({
  picked,
  selected,
  banner,
  onUpdate,
  onReset
}: {
  picked: TemplateSummary[];
  selected: Map<string, AxisSelection>;
  banner: Banner | null;
  onUpdate: (id: string, mutate: (selection: AxisSelection) => AxisSelection) => void;
  onReset: (template: TemplateSummary) => void;
}) {
  const layers = picked.filter((template) => template.kind === 'layer');
  const components = picked.filter((template) => template.kind === 'component');

  if (picked.length === 0) {
    return <Notice type="neutral" title="还没有选模板" description="回到「模板」勾选至少一个。" />;
  }

  return (
    <Stack gap="content" direction="column">
      {layers.length > 0 ? (
        <List>
          <ListTitle>
            <Typography level="text">固定路径 · 无需配轴</Typography>
          </ListTitle>
          <ListGroup>
            {layers.map((template) => (
              <ListItem
                key={template.id}
                leading="none"
                title={displayLabel(template)}
                subtitle={<span className="vc-mono">{template.shape}</span>}
                trailing={
                  <Typography level="caption" content="number">
                    {template.defaultCount}
                  </Typography>
                }
              />
            ))}
          </ListGroup>
        </List>
      ) : null}

      {components.map((template) => {
        const selection = selected.get(template.id)!;
        const count = countTemplate(template, selection);
        const combos = (template.axes ?? [])
          .map((axis) => selection.axes[axis.slot]?.length ?? 0)
          .join(' × ');

        return (
          <Card key={template.id}>
            <CardHead
              icon={false}
              title={displayLabel(template)}
              description={<span className="vc-mono">{template.shape}</span>}
              trailing={
                <Badge style="theme" level="caption" primary={count > 0}>
                  {count}
                </Badge>
              }
            />
            {/* CardBody lays its children out as one centred row, so the
                controls go in a single column child. */}
            <CardBody>
              <Stack gap="component" direction="column" className="vc-grow">
                {template.variantProp ? (
                  <Typography level="caption">
                    外观轴取自 Spiral「{template.variantProp}」属性。
                  </Typography>
                ) : null}
                {template.note ? <Typography level="caption">{template.note}</Typography> : null}

                {(template.axes ?? []).map((axis) => {
                  const on = selection.axes[axis.slot] ?? [];
                  return (
                    <Stack key={axis.slot} gap="inside" direction="column">
                      <div className="vc-row vc-row--tight">
                        <Typography level="caption" title={axis.note}>
                          {axisLabel(axis)}
                        </Typography>
                        <Typography level="caption" className="vc-push" content="number">
                          {on.length} / {axis.values.length}
                        </Typography>
                      </div>
                      <div className="vc-row vc-row--tight">
                        {axis.values.map((value) => {
                          const active = on.includes(value);
                          return (
                            <Button
                              key={value}
                              mode={active ? 'second' : 'outline'}
                              size="tiny"
                              allRound
                              aria-pressed={active}
                              onClick={() =>
                                onUpdate(template.id, (current) => {
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
                  );
                })}

                {(template.extras ?? 0) > 0 ? (
                  <div className="vc-row">
                    <Switch
                      id={`extras-${template.id}`}
                      checked={selection.includeExtras}
                      size="small"
                      onCheckedChange={(checked) =>
                        onUpdate(template.id, (current) => {
                          current.includeExtras = checked;
                          return current;
                        })
                      }
                    />
                    <Label htmlFor={`extras-${template.id}`}>
                      另含 {template.extras} 个单点 token
                    </Label>
                  </div>
                ) : null}

                <div className="vc-row vc-row--tight">
                  <Button
                    mode="noBackground"
                    size="tiny"
                    onClick={() =>
                      onUpdate(template.id, (current) => {
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
                    mode="noBackground"
                    size="tiny"
                    onClick={() =>
                      onUpdate(template.id, (current) => {
                        for (const axis of template.axes ?? []) {
                          current.axes[axis.slot] = [];
                        }
                        return current;
                      })
                    }
                  >
                    清空
                  </Button>
                  <Button mode="noBackground" size="tiny" onClick={() => onReset(template)}>
                    默认
                  </Button>
                  <Typography level="caption" className="vc-push" content="number">
                    {combos} = {count}
                  </Typography>
                </div>
              </Stack>
            </CardBody>
          </Card>
        );
      })}

      {banner ? (
        <Notice type={banner.type} title={banner.title} description={banner.description} />
      ) : null}
    </Stack>
  );
}

function PreviewStep({
  banner,
  stats,
  filter,
  onFilter,
  pathGroups,
  shown,
  total,
  hiddenFromPublishing,
  onHiddenChange,
  onCopy
}: {
  banner: Banner | null;
  stats: PlanStats | null;
  filter: string;
  onFilter: (value: string) => void;
  pathGroups: Map<string, DryRunPath[]>;
  shown: number;
  total: number;
  hiddenFromPublishing: boolean;
  onHiddenChange: (value: boolean) => void;
  onCopy: () => void;
}) {
  let budget = PATH_LIST_LIMIT;

  return (
    <Stack gap="content" direction="column">
      {banner ? (
        <Notice type={banner.type} title={banner.title} description={banner.description} />
      ) : null}

      {stats ? (
        <div className="vc-row vc-row--tight">
          <Badge style="theme" level="caption" primary>
            新建 {stats.created}
          </Badge>
          <Badge style="normal" level="caption">
            已存在 {stats.existing}
          </Badge>
          <Badge style={stats.invalid > 0 ? 'fail' : 'normal'} level="caption">
            违规 {stats.invalid}
          </Badge>
          {stats.excluded > 0 ? (
            <Badge style="normal" level="caption">
              规则排除 {stats.excluded}
            </Badge>
          ) : null}
        </div>
      ) : (
        <Typography level="caption">正在展开…</Typography>
      )}

      <div className="vc-row">
        <div className="vc-grow">
          <Input
            type="search"
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="筛选路径"
            fullWidth
          />
        </div>
        <Button mode="outline" size="regular" disabled={total === 0} onClick={onCopy}>
          复制
        </Button>
      </div>

      {total === 0 ? null : shown === 0 ? (
        <Notice type="neutral" title="没有匹配的路径" />
      ) : (
        <ListGroup>
          <div className="vc-paths">
            {[...pathGroups.entries()].map(([collection, rows]) => {
              const slice = rows.slice(0, Math.max(budget, 0));
              budget -= slice.length;
              return (
                <div key={collection}>
                  <div className="vc-path">
                    <Typography level="caption">{collection}</Typography>
                    <Typography level="caption" className="vc-push" content="number">
                      {rows.length}
                    </Typography>
                  </div>
                  {slice.map((row) => (
                    <div className="vc-path" key={`${collection}/${row.path}`}>
                      <span className="vc-path__mark" data-status={row.status}>
                        {row.status === 'new' ? '+' : '·'}
                      </span>
                      <span className="vc-mono vc-truncate">{row.path}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {shown > PATH_LIST_LIMIT ? (
              <div className="vc-path">
                <Typography level="caption">
                  另有 {shown - PATH_LIST_LIMIT} 条未列出 — 用「复制」导出全部。
                </Typography>
              </div>
            ) : null}
          </div>
        </ListGroup>
      )}

      <List>
        <ListGroup>
          <ListItem
            leading="none"
            itemType="switch"
            title="未填空壳不发布到团队库"
            subtitle="填好值后可在 Figma 里自行取消。"
            switchProps={{ checked: hiddenFromPublishing, onCheckedChange: onHiddenChange }}
          />
        </ListGroup>
      </List>
    </Stack>
  );
}

function ApplyStep({
  applied,
  progress,
  note
}: {
  applied: AppliedSummary | null;
  progress: { done: number; total: number; collection: string };
  note: string;
}) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Stack gap="content" direction="column">
      {applied ? (
        <Notice
          type="success"
          title={`已应用 ${applied.total} 条 — 新建空壳 ${applied.unbound}`}
          description={`已存在未改动 ${applied.existing} 条。每个空壳只写入路径与类型，描述标记为「${note}」。`}
        />
      ) : (
        <Stack gap="inside" direction="column">
          <Progress value={percent} showLabel />
          <Typography level="caption">
            {progress.collection ? `正在写入 ${progress.collection}…` : '正在应用…'}
          </Typography>
        </Stack>
      )}

      {applied && applied.modeLimit.length > 0 ? (
        <Notice
          type="warning"
          title={`${applied.modeLimit.length} 个模式无法创建`}
          description={`${applied.modeLimit.join('、')}。当前文件的 Figma 套餐限制了变量模式数。`}
        />
      ) : null}

      {applied ? (
        <List>
          <ListTitle>
            <Typography level="text">集合</Typography>
          </ListTitle>
          <ListGroup>
            {applied.collections.map((collection) => (
              <ListItem
                key={collection.name}
                leading="none"
                title={collection.name}
                subtitle={
                  collection.missingModes.length > 0
                    ? `缺失模式：${collection.missingModes.join('/')}`
                    : undefined
                }
                trailing={
                  <Badge style={collection.created ? 'success' : 'normal'} level="caption">
                    {collection.created ? '新建' : '复用'}
                  </Badge>
                }
              />
            ))}
          </ListGroup>
        </List>
      ) : null}
    </Stack>
  );
}

function AdvancedPanel({
  namespaces,
  nsChecked,
  setNsChecked,
  seeds,
  setSeeds,
  allEffects,
  setAllEffects,
  onError
}: {
  namespaces: NamespaceSummary[];
  nsChecked: Record<string, boolean>;
  setNsChecked: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  seeds: Record<string, string>;
  setSeeds: (update: (prev: Record<string, string>) => Record<string, string>) => void;
  allEffects: boolean;
  setAllEffects: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  const chosen = Object.keys(nsChecked).filter((key) => nsChecked[key]);
  const seedPayload = () => Object.fromEntries(Object.entries(seeds).filter(([, value]) => value.trim()));

  return (
    <Stack gap="content" direction="column">
      <Notice
        type="warning"
        title="这里会写入真实数值"
        description="原一键生成器：为整个命名空间写入预设值，也是种子色阶的唯一入口。模板流程通常不需要。"
      />

      {/* Same Card shape as the axis step, so both screens read as one panel. */}
      <Card>
        <CardHead
          icon={false}
          title="命名空间"
          description="勾选要展开的集合。"
          trailing={
            <Badge style="theme" level="caption" primary={chosen.length > 0}>
              {chosen.length}
            </Badge>
          }
        />
        <CardBody>
          <Fieldset className="vc-grow">
            <Stack gap="component" direction="column">
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
                <Switch
                  id="all-effects"
                  checked={allEffects}
                  size="small"
                  onCheckedChange={setAllEffects}
                />
                <Label htmlFor="all-effects">展开全部合法特效路径</Label>
              </div>
            </Stack>
          </Fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHead icon={false} title="色阶种子" description="留空则用内置默认色。" />
        <CardBody>
          <div className="vc-grid vc-grow">
            {Object.entries(seeds).map(([family, value]) => (
              <Stack key={family} gap="inside" direction="column">
                <Label htmlFor={`seed-${family}`}>{family}</Label>
                <Input
                  id={`seed-${family}`}
                  value={value}
                  fullWidth
                  onChange={(event) =>
                    setSeeds((prev) => ({ ...prev, [family]: event.target.value }))
                  }
                />
              </Stack>
            ))}
          </div>
        </CardBody>
      </Card>

      <Stack gap="component" direction="column">
        <div className="vc-row">
          <Button
            mode="outline"
            size="regular"
            className="vc-grow"
            onClick={() =>
              post({
                type: 'fullDryRun',
                namespaces: chosen,
                seeds: seedPayload(),
                allEffects
              })
            }
          >
            干跑
          </Button>
          <Button
            mode="destructive"
            size="regular"
            className="vc-grow"
            onClick={() => {
              if (chosen.length === 0) {
                onError('高级区未选命名空间。');
                return;
              }
              if (!confirm(`为以下命名空间写入含预设值的完整范式：${chosen.join(', ')}？`)) return;
              post({ type: 'fullApply', namespaces: chosen, seeds: seedPayload(), allEffects });
            }}
          >
            写入完整范式
          </Button>
        </div>
        <Button
          mode="outline"
          size="regular"
          onClick={() => post({ type: 'validateFile' })}
        >
          检查整个文件
        </Button>
      </Stack>
    </Stack>
  );
}
