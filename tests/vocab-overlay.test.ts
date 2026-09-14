import { describe, expect, it } from 'vitest';
import {
  expandCombos,
  expandSelection,
  getTemplate,
  type ComponentTemplate
} from '../src/paradigm/templates';
import {
  emptyVocabOverlay,
  mergeComponentOverlay,
  resolveTemplate,
  setOverlayAxis,
  templateSummariesWithOverlay
} from '../src/paradigm/vocab-overlay';
import { validateVocabTerm } from '../src/paradigm/vocab-term';

describe('validateVocabTerm', () => {
  it('accepts camelCase words', () => {
    expect(validateVocabTerm('focusRing')).toEqual({ ok: true, value: 'focusRing' });
    expect(validateVocabTerm('  primary  ')).toEqual({ ok: true, value: 'primary' });
  });

  it('rejects illegal names with Chinese errors', () => {
    expect(validateVocabTerm('').ok).toBe(false);
    expect(validateVocabTerm('FocusRing').ok).toBe(false);
    const hyphen = validateVocabTerm('focus-ring');
    expect(hyphen.ok).toBe(false);
    if (!hyphen.ok) expect(hyphen.error).toMatch(/连字符|camelCase/);
    expect(validateVocabTerm('1primary').ok).toBe(false);
  });
});

describe('vocab overlay', () => {
  const button = getTemplate('spiral.button') as ComponentTemplate;

  it('does not expose Spiral variantProp on summaries', () => {
    const row = templateSummariesWithOverlay().find((template) => template.id === 'spiral.button');
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('variantProp');
  });

  it('merges a new appearance term into the closed list', () => {
    const overlay = setOverlayAxis(emptyVocabOverlay(), 'spiral.button', 'variant', [
      ...button.axes.find((axis) => axis.slot === 'variant')!.values,
      'brandSoft'
    ]);
    const merged = mergeComponentOverlay(button, overlay);
    expect(merged.axes.find((axis) => axis.slot === 'variant')?.values).toContain('brandSoft');
  });

  it('expands paths from the overlay vocabulary, not the base Spiral mode list alone', () => {
    const overlay = setOverlayAxis(emptyVocabOverlay(), 'spiral.button', 'variant', [
      'brandSoft'
    ]);
    const paths = expandCombos(resolveTemplate('spiral.button', overlay) as ComponentTemplate, {
      variant: ['brandSoft'],
      role: ['background'],
      state: ['rest']
    }).paths;
    expect(paths).toEqual(['button/brandSoft-background-rest']);

    const entries = expandSelection(
      {
        id: 'spiral.button',
        axes: { variant: ['brandSoft'], role: ['background'], state: ['rest'] }
      },
      {
        stamp: '2026-09',
        resolve: (id) => resolveTemplate(id, overlay)
      }
    );
    expect(entries.map((entry) => entry.path)).toEqual(['button/brandSoft-background-rest']);
  });

  it('drops overlay slots that match the base JSON', () => {
    const base = button.axes.find((axis) => axis.slot === 'variant')!.values;
    const overlay = setOverlayAxis(emptyVocabOverlay(), 'spiral.button', 'variant', [...base]);
    expect(overlay.axes['spiral.button']).toBeUndefined();
  });
});
