import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPlan, formatUnboundList } from '../src/figma/apply';
import { expandPlan } from '../src/paradigm/expand';
import { expandTemplatePlan } from '../src/paradigm/templates';
import { buildPaletteRamps } from '../src/palette/ramp';
import { installFakeFigma, uninstallFakeFigma, type FakeFigma } from './helpers/fake-figma';

let figma: FakeFigma;

beforeEach(() => {
  figma = installFakeFigma();
});

afterEach(() => {
  uninstallFakeFigma();
});

const buttonPlan = () =>
  expandTemplatePlan([{ id: 'spiral.button', includeExtras: true }], {
    stamp: '2026-09',
    hiddenFromPublishing: true
  });

describe('applying unbound entries', () => {
  it('creates the variables and never writes a value', async () => {
    const plan = buttonPlan();
    const summary = await applyPlan(plan);

    expect(summary.created).toBe(plan.entries.length);
    expect(summary.unbound).toHaveLength(plan.entries.length);
    expect(summary.existing).toEqual([]);
    // The whole contract of decision 1A.
    expect(figma.writes).toEqual([]);
    expect(figma.state.variables).toHaveLength(plan.entries.length);
  });

  it('does not report an empty shell as skipped', async () => {
    const summary = await applyPlan(buttonPlan());
    expect(summary.skipped).toEqual([]);
  });

  it('creates the collection with both paradigm modes', async () => {
    await applyPlan(buttonPlan());
    const collection = figma.state.collections.find((row) => row.name === 'component');
    expect(collection?.modes.map((mode) => mode.name)).toEqual(['light', 'dark']);
  });

  it('keeps the declared type per entry, including the FLOAT extras', async () => {
    await applyPlan(buttonPlan());
    const byName = new Map(figma.state.variables.map((row) => [row.name, row]));
    expect(byName.get('button/primary-background-rest')?.resolvedType).toBe('COLOR');
    expect(byName.get('button/disabled-opacity')?.resolvedType).toBe('FLOAT');
  });

  it('marks the shells so an unfilled variable stays findable', async () => {
    await applyPlan(buttonPlan());
    for (const variable of figma.state.variables) {
      expect(variable.description).toBe('VarCat: 待填 · spiral.button · 2026-09');
      expect(variable.hiddenFromPublishing).toBe(true);
      expect(variable.valuesByMode).toEqual({});
    }
  });

  it('leaves an already-filled variable alone on a re-run', async () => {
    await applyPlan(buttonPlan());
    const target = figma.state.variables.find(
      (row) => row.name === 'button/primary-background-rest'
    )!;
    const modeId = figma.state.collections[0].modes[0].modeId;
    target.setValueForMode(modeId, { r: 1, g: 0, b: 0, a: 1 });
    target.description = 'hand tuned';
    const writesAfterUserEdit = figma.writes.length;

    const second = await applyPlan(buttonPlan());

    expect(second.created).toBe(0);
    expect(second.unbound).toEqual([]);
    expect(second.existing).toHaveLength(35);
    expect(figma.writes).toHaveLength(writesAfterUserEdit);
    expect(target.description).toBe('hand tuned');
    expect(target.valuesByMode[modeId]).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(figma.state.variables).toHaveLength(35);
  });

  it('groups the unfilled list by collection', async () => {
    const summary = await applyPlan(buttonPlan());
    const text = formatUnboundList(summary.unbound);
    expect(text.split('\n')[0]).toBe('# component (35 unfilled)');
    expect(text).toContain('  button/primary-background-rest');
    expect(text.split('\n').filter((line) => line.startsWith('  '))).toHaveLength(35);
  });

  it('reports the mode shortfall loudly when the plan caps modes at one', async () => {
    uninstallFakeFigma();
    figma = installFakeFigma({ modeLimit: 1 });
    const summary = await applyPlan(buttonPlan());
    expect(summary.modeLimit).toEqual(['component: dark']);
    // The shells still exist in the mode that was created.
    expect(summary.unbound).toHaveLength(35);
  });

  it('reports progress instead of blocking silently', async () => {
    const seen: number[] = [];
    await applyPlan(buttonPlan(), {
      batchSize: 10,
      onProgress: (progress) => seen.push(progress.done)
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(35);
  });
});

describe('the advanced full paradigm still writes values', () => {
  it('binds every mode of a literal namespace', async () => {
    const plan = expandPlan({ namespaces: ['palette'], palette: buildPaletteRamps() });
    const summary = await applyPlan(plan);
    expect(summary.unbound).toEqual([]);
    expect(summary.skipped).toEqual([]);
    expect(figma.writes).toHaveLength(plan.total * 2);
  });

  it('resolves an alias inside the same run', async () => {
    const plan = expandPlan({
      namespaces: ['palette', 'semantic'],
      palette: buildPaletteRamps()
    });
    const summary = await applyPlan(plan);
    expect(summary.skipped).toEqual([]);
    const alias = figma.writes.find((write) => write.variable === 'border/theme-primary');
    expect((alias?.value as any)?.type).toBe('VARIABLE_ALIAS');
  });
});
