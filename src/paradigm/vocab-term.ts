/**
 * Closed-vocabulary term rules (paradigm charset + camelCase). Shared by the
 * panel (inline edit / 新建) and the overlay helpers — no template imports.
 */

/** camelCase slot word: paradigm rule 7 — hyphens only separate slots. */
export const VOCAB_TERM_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** Normalize / reject a candidate vocab term. Errors are Chinese for the panel. */
export const validateVocabTerm = (
  raw: string
): { ok: true; value: string } | { ok: false; error: string } => {
  const value = raw.trim();
  if (!value) return { ok: false, error: '名称不能为空' };
  if (value.includes('-') || value.includes('_') || value.includes(' ') || value.includes('.')) {
    return { ok: false, error: '不可含连字符、下划线、空格或点：多词请用 camelCase（如 focusRing）' };
  }
  if (!VOCAB_TERM_PATTERN.test(value)) {
    return { ok: false, error: '须为 camelCase：以小写字母开头，仅含字母与数字' };
  }
  return { ok: true, value };
};
