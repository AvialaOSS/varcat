import { describe, expect, it } from 'vitest';
import {
  countSelection,
  defaultSelection,
  expandCombos,
  expandSelection,
  expandTemplatePlan,
  getTemplate,
  isComponentTemplate,
  shapeSlots,
  spiralCatalog,
  templateRegistry,
  templates,
  validateTemplatePath,
  type ComponentTemplate
} from '../src/paradigm/templates';
import { validateStructure } from '../src/paradigm/validate';
import { getNamespace } from '../src/paradigm/vocabulary';

const componentTemplates = templates.filter(isComponentTemplate);
const curated = componentTemplates.filter((template) => !template.stub);

const allAxes = (template: ComponentTemplate) =>
  template.axes.reduce<Record<string, string[]>>((acc, axis) => {
    acc[axis.slot] = [...axis.values];
    return acc;
  }, {});

describe('registry', () => {
  it('resolves every registered template', () => {
    for (const row of templateRegistry.templates) {
      expect(getTemplate(row.id).id).toBe(row.id);
    }
  });

  it('registers nothing as selected by default', () => {
    expect(templateRegistry.templates.every((row) => row.default === false)).toBe(true);
    expect(defaultSelection()).toEqual([]);
  });

  it('keeps template ids unique', () => {
    const ids = templates.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the seven paradigm layers plus every catalog component', () => {
    expect(templates.filter((template) => template.kind === 'layer')).toHaveLength(7);
    expect(componentTemplates).toHaveLength(spiralCatalog.componentCount);
    expect(curated.map((template) => template.id).sort()).toEqual([
      'spiral.alert',
      'spiral.badge',
      'spiral.button',
      'spiral.input',
      'spiral.segmentator',
      'spiral.switch',
      'spiral.tab',
      'spiral.tag'
    ]);
  });
});

describe('spiral catalog', () => {
  it('carries 44 components across the Spiral story groups', () => {
    expect(spiralCatalog.componentCount).toBe(44);
    expect(spiralCatalog.components).toHaveLength(44);
    expect(spiralCatalog.groups.map((group) => group.name)).toEqual([
      'Basic Input',
      'Information Collect',
      'Information Display',
      'Response And Feedback',
      'Structure Navigation',
      'System Composition'
    ]);
  });

  it('slugs the display name to camelCase', () => {
    const bySlug = new Map(spiralCatalog.components.map((entry) => [entry.slug, entry]));
    expect(bySlug.get('numberInput')?.displayName).toBe('NumberInput');
    expect(bySlug.get('colorPicker')?.displayName).toBe('ColorPicker');
    for (const entry of spiralCatalog.components) {
      expect(entry.slug, entry.slug).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it('drops Icons, which is a foundation, not a component', () => {
    expect(spiralCatalog.components.map((entry) => entry.slug)).not.toContain('icons');
  });

  it('is the closed component type vocabulary', () => {
    const types = getNamespace('component').slots.type;
    for (const entry of spiralCatalog.components) {
      expect(types, entry.slug).toContain(entry.slug);
    }
    expect(types).toHaveLength(spiralCatalog.componentCount);
  });
});

describe('shape', () => {
  it('accepts 2 to 4 leaf slots instead of a fixed 4', () => {
    const widths = new Set(componentTemplates.map((template) => shapeSlots(template.shape).length));
    expect([...widths].sort()).toEqual([2, 3]);
    for (const template of componentTemplates) {
      const slots = shapeSlots(template.shape);
      expect(slots.length).toBeGreaterThanOrEqual(2);
      expect(slots.length).toBeLessThanOrEqual(4);
      expect(template.axes.map((axis) => axis.slot).sort()).toEqual([...slots].sort());
    }
  });

  it('orders the slots appearance → part → state', () => {
    for (const template of componentTemplates) {
      const slots = shapeSlots(template.shape);
      const expected = ['variant', 'role', 'state'].filter((slot) => slots.includes(slot));
      expect(slots, template.id).toEqual(expected);
    }
  });
});

describe('button', () => {
  const button = getTemplate('spiral.button') as ComponentTemplate;

  it('takes its appearance axis from the Spiral mode prop, verbatim', () => {
    expect(button.spiral.variantProp).toBe('mode');
    expect(button.axes.find((axis) => axis.slot === 'variant')?.values).toEqual([
      'primary',
      'second',
      'default',
      'defaultCustom',
      'noBackground',
      'noBackgroundCustom',
      'outline',
      'outlineCustom',
      'destructive'
    ]);
  });

  it('expands the default axes to exactly 12 paths', () => {
    expect(expandCombos(button).paths).toEqual([
      'button/primary-background-rest',
      'button/primary-background-hover',
      'button/primary-background-active',
      'button/primary-foreground-rest',
      'button/primary-foreground-hover',
      'button/primary-foreground-active',
      'button/destructive-background-rest',
      'button/destructive-background-hover',
      'button/destructive-background-active',
      'button/destructive-foreground-rest',
      'button/destructive-foreground-hover',
      'button/destructive-foreground-active'
    ]);
    expect(countSelection({ id: 'spiral.button' })).toBe(12);
  });

  it('is the primary background ladder the redesign asks for', () => {
    const { paths } = expandCombos(button, {
      variant: ['primary'],
      role: ['background'],
      state: ['rest', 'hover', 'active', 'focus', 'disabled']
    });
    expect(paths).toEqual([
      'button/primary-background-rest',
      'button/primary-background-hover',
      'button/primary-background-active',
      'button/primary-background-focus',
      'button/primary-background-disabled'
    ]);
  });

  it('drops the combos the exclude rules call meaningless', () => {
    const { paths, excluded } = expandCombos(button, allAxes(button));
    expect(paths).not.toContain('button/primary-gloss-disabled');
    expect(paths).not.toContain('button/primary-focusRing-rest');
    expect(paths).not.toContain('button/outline-gloss-rest');
    expect(paths).toContain('button/primary-focusRing-focus');
    expect(paths).toContain('button/outline-border-rest');
    expect(excluded.every((row) => row.why.length > 0)).toBe(true);
    expect(paths.length + excluded.length).toBe(9 * 6 * 6);
  });

  it('adds the single-point FLOAT tokens only when extras are asked for', () => {
    const without = expandSelection({ id: 'spiral.button' }, { stamp: 'test' });
    const with_ = expandSelection({ id: 'spiral.button', includeExtras: true }, { stamp: 'test' });
    expect(without.some((entry) => entry.valueType === 'FLOAT')).toBe(false);
    expect(with_).toHaveLength(without.length + button.extras.length);
    const opacity = with_.find((entry) => entry.path === 'button/disabled-opacity');
    expect(opacity?.valueType).toBe('FLOAT');
    expect(opacity?.kind).toBe('unbound');
  });
});

describe('unbound entries', () => {
  it('carry no value and no alias, for a component template', () => {
    for (const entry of expandSelection({ id: 'spiral.button', includeExtras: true }, { stamp: '2026-09' })) {
      expect(entry.kind).toBe('unbound');
      expect(entry.values).toBeUndefined();
      expect(entry.aliases).toBeUndefined();
      expect(entry.note).toBe('VarCat: 待填 · spiral.button · 2026-09');
      expect(entry.templateId).toBe('spiral.button');
    }
  });

  it('carry no value for a layer template either', () => {
    const entries = expandSelection({ id: 'layer.palette' }, { stamp: '2026-09' });
    expect(entries).toHaveLength(74);
    for (const entry of entries) {
      expect(entry.kind).toBe('unbound');
      expect(entry.values).toBeUndefined();
      expect(entry.collection).toBe('palette');
    }
    const semantic = expandSelection({ id: 'layer.semantic' }, { stamp: '2026-09' });
    expect(semantic).toHaveLength(150);
    expect(semantic.every((entry) => entry.aliases === undefined)).toBe(true);
  });

  it('opt into hiddenFromPublishing per run', () => {
    const hidden = expandSelection({ id: 'spiral.tag' }, { hiddenFromPublishing: true });
    const shown = expandSelection({ id: 'spiral.tag' }, { hiddenFromPublishing: false });
    expect(hidden.every((entry) => entry.hiddenFromPublishing === true)).toBe(true);
    expect(shown.every((entry) => entry.hiddenFromPublishing === false)).toBe(true);
  });
});

describe('paradigm compliance', () => {
  it('produces no violation for any template at full axes, extras included', () => {
    const plan = expandTemplatePlan(
      templates.map((template) => ({
        id: template.id,
        axes: isComponentTemplate(template) ? allAxes(template) : undefined,
        includeExtras: true
      })),
      { stamp: 'test' }
    );
    expect(plan.invalid).toEqual([]);
    expect(plan.total).toBeGreaterThan(1000);
  });

  it('passes the namespace-independent structure rules on every path', () => {
    for (const template of componentTemplates) {
      const paths = expandCombos(template, allAxes(template)).paths;
      for (const path of [...paths, ...template.extras.map((extra) => extra.path)]) {
        expect(validateStructure(path), path).toEqual([]);
      }
    }
  });

  it('keeps every path unique inside its collection', () => {
    const plan = expandTemplatePlan(
      componentTemplates.map((template) => ({
        id: template.id,
        axes: allAxes(template),
        includeExtras: true
      })),
      { stamp: 'test' }
    );
    const seen = new Set<string>();
    for (const entry of plan.entries) {
      const key = `${entry.collection}/${entry.path}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('validateTemplatePath', () => {
  const button = getTemplate('spiral.button') as ComponentTemplate;

  it('accepts a path the template can produce', () => {
    expect(validateTemplatePath('button/primary-background-rest', button).valid).toBe(true);
  });

  it('accepts a registered extra', () => {
    expect(validateTemplatePath('button/disabled-opacity', button).valid).toBe(true);
  });

  it('rejects a word that is legal elsewhere but not in this axis', () => {
    const result = validateTemplatePath('button/filled-background-rest', button);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('notInTemplate');
  });

  it('rejects the wrong group', () => {
    const result = validateTemplatePath('input/primary-background-rest', button);
    expect(result.issues.map((issue) => issue.code)).toContain('notInTemplate');
  });

  it('rejects a leaf that echoes the group', () => {
    const result = validateTemplatePath('button/button-primary-background-rest', button);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('groupEcho');
  });

  it('rejects the wrong slot count', () => {
    const result = validateTemplatePath('button/primary-background', button);
    expect(result.issues.map((issue) => issue.code)).toContain('slotCount');
  });
});

describe('stub templates', () => {
  it('use generic parts and states, never an invented appearance word', () => {
    const stub = componentTemplates.find((template) => template.stub)!;
    expect(stub.axes.map((axis) => axis.slot)).toEqual(['role', 'state']);
    expect(stub.spiral.variantProp).toBeNull();
    expect(countSelection({ id: stub.id })).toBe(4);
  });
});

describe('counting', () => {
  it('matches the expansion for every template', () => {
    for (const template of templates) {
      const selection = {
        id: template.id,
        axes: isComponentTemplate(template) ? allAxes(template) : undefined,
        includeExtras: true
      };
      expect(countSelection(selection), template.id).toBe(expandSelection(selection).length);
    }
  });

  it('is zero for an empty axis', () => {
    expect(countSelection({ id: 'spiral.button', axes: { variant: [], role: [], state: [] } })).toBe(0);
  });
});

describe('expansion snapshot', () => {
  it('locks the curated templates at full axes', () => {
    const plan = expandTemplatePlan(
      curated.map((template) => ({
        id: template.id,
        axes: allAxes(template),
        includeExtras: true
      })),
      { stamp: 'snapshot' }
    );
    expect(
      plan.entries.map((entry) => `${entry.collection}/${entry.path} ${entry.valueType}`)
    ).toMatchSnapshot();
  });
});
