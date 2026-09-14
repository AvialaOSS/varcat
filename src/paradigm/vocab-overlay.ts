/**
 * Session overlay for template axis vocabularies.
 *
 * Base values live in paradigm/templates (the plan closed vocabulary JSON).
 * The Figma plugin cannot write those repo files, so edits made in the panel are
 * stored in `figma.clientStorage` and merged over the base lists at runtime.
 * Generated paths always read the merged list — never live Spiral cva / mode enums.
 */
import {
  getTemplate,
  isComponentTemplate,
  templateSummaries,
  templates,
  type ComponentTemplate,
  type Template,
  type TemplateAxis
} from './templates';
import { validateVocabTerm, VOCAB_TERM_PATTERN } from './vocab-term';

export { validateVocabTerm, VOCAB_TERM_PATTERN };

export type VocabOverlay = {
  version: 1;
  /** templateId → slot → full closed list for that axis (replaces base `values`). */
  axes: Record<string, Record<string, string[]>>;
};

export const emptyVocabOverlay = (): VocabOverlay => ({ version: 1, axes: {} });

export const isVocabOverlay = (raw: unknown): raw is VocabOverlay => {
  if (!raw || typeof raw !== 'object') return false;
  const row = raw as VocabOverlay;
  if (row.version !== 1 || !row.axes || typeof row.axes !== 'object') return false;
  for (const slots of Object.values(row.axes)) {
    if (!slots || typeof slots !== 'object') return false;
    for (const values of Object.values(slots)) {
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) return false;
    }
  }
  return true;
};

const unique = (values: string[]): string[] => [...new Set(values)];

export const mergeAxis = (axis: TemplateAxis, overlayValues?: string[]): TemplateAxis => {
  if (!overlayValues) return axis;
  const values = unique(overlayValues.filter((value) => typeof value === 'string' && value.length > 0));
  return {
    ...axis,
    values,
    default: axis.default.filter((value) => values.includes(value))
  };
};

export const mergeComponentOverlay = (
  template: ComponentTemplate,
  overlay?: VocabOverlay | null
): ComponentTemplate => {
  const slotMap = overlay?.axes[template.id];
  if (!slotMap) return template;
  return {
    ...template,
    axes: template.axes.map((axis) => mergeAxis(axis, slotMap[axis.slot]))
  };
};

export const resolveTemplate = (id: string, overlay?: VocabOverlay | null): Template => {
  const base = getTemplate(id);
  return isComponentTemplate(base) ? mergeComponentOverlay(base, overlay) : base;
};

export const withOverlay = (overlay?: VocabOverlay | null) => (template: Template): Template =>
  isComponentTemplate(template) ? mergeComponentOverlay(template, overlay) : template;

/** Summaries already merged with the session overlay (what the axes step renders). */
export const templateSummariesWithOverlay = (overlay?: VocabOverlay | null) =>
  templateSummaries(withOverlay(overlay));

/**
 * Set one slot's closed list on the overlay. Empty / unknown templates are ignored.
 * Returns a new overlay object. Lists that match the base JSON are dropped so
 * storage stays sparse.
 */
export const setOverlayAxis = (
  overlay: VocabOverlay,
  templateId: string,
  slot: string,
  values: string[]
): VocabOverlay => {
  const template = templates.find((row) => row.id === templateId);
  if (!template || !isComponentTemplate(template)) return overlay;
  if (!template.axes.some((axis) => axis.slot === slot)) return overlay;

  const nextValues = unique(values);
  const base = template.axes.find((axis) => axis.slot === slot)!;
  const unchanged =
    nextValues.length === base.values.length &&
    nextValues.every((value, index) => value === base.values[index]);

  const axes = { ...overlay.axes };
  const slots = { ...(axes[templateId] ?? {}) };
  if (unchanged) {
    delete slots[slot];
    if (Object.keys(slots).length === 0) delete axes[templateId];
    else axes[templateId] = slots;
  } else {
    slots[slot] = nextValues;
    axes[templateId] = slots;
  }
  return { version: 1, axes };
};
