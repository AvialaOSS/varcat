/**
 * Pure paradigm validator. No Figma API, no IO: every function is a function of
 * its arguments plus the committed vocabulary JSON, so it runs the same in the
 * plugin sandbox, in the dry-run CLI and in vitest.
 */
import {
  componentMatrix,
  getNamespace,
  NAMESPACE_KEYS,
  vocabulary,
  type Namespace,
  type NamespaceKey
} from './vocabulary';

export type IssueCode =
  | 'illegalChar'
  | 'emptySegment'
  | 'missingGroup'
  | 'tooManySegments'
  | 'slotCase'
  | 'pluralSlot'
  | 'groupEcho'
  | 'slotCount'
  | 'unknownNamespace'
  | 'unknownSlotValue'
  | 'matrixViolation'
  | 'notWhitelisted';

export type Issue = {
  code: IssueCode;
  message: string;
  slot?: string;
  value?: string;
};

export type ValidationResult = {
  path: string;
  valid: boolean;
  namespace?: NamespaceKey;
  slots?: Record<string, string>;
  issues: Issue[];
};

const SLOT_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const LEGAL_PATH_PATTERN = /^[a-zA-Z0-9/-]+$/;

const issue = (code: IssueCode, message: string, extra?: Omit<Issue, 'code' | 'message'>): Issue => ({
  code,
  message,
  ...extra
});

/** Collapses `\` and duplicate slashes and trims each segment. Does not validate. */
export const normalizeVariablePath = (raw: string): string =>
  String(raw)
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');

/** Every word that appears in any closed slot vocabulary. */
const KNOWN_SLOT_WORDS: Set<string> = new Set(
  NAMESPACE_KEYS.flatMap((key) => Object.values(getNamespace(key).slots).flat())
);

/**
 * Rule 5 without false positives: a slot is only reported as plural when
 * dropping the trailing `s` lands on a word the vocabulary already knows, so
 * `buttons` is rejected while `xs`, `canvas` and `thickness` pass.
 */
const isPluralSlot = (slot: string): boolean => {
  if (!slot.endsWith('s') || vocabulary.pluralSafeSlots.includes(slot)) return false;
  return KNOWN_SLOT_WORDS.has(slot.slice(0, -1));
};

/**
 * Rules 1–5 and 7: charset, segment/slot casing, mandatory group, no group echo,
 * singular slots, `-` only between slots. Namespace-independent.
 */
export const validateStructure = (path: string): Issue[] => {
  const issues: Issue[] = [];

  if (!path) {
    return [issue('emptySegment', 'Path is empty')];
  }
  if (!LEGAL_PATH_PATTERN.test(path)) {
    const offenders = [...new Set(path.split('').filter((ch) => !/[a-zA-Z0-9/-]/.test(ch)))];
    issues.push(
      issue(
        'illegalChar',
        `Illegal character(s) ${offenders.map((c) => JSON.stringify(c)).join(', ')}: the charset is ${vocabulary.charset} plus / as the group separator`
      )
    );
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    issues.push(issue('emptySegment', 'Empty segment: a path may not start, end or double up on /'));
  }

  const filled = segments.filter((segment) => segment.length > 0);
  if (filled.length < 2) {
    issues.push(issue('missingGroup', 'A group is mandatory: the path must be {group}/{leaf}'));
  }
  if (filled.length > 2) {
    issues.push(
      issue('tooManySegments', `Exactly one group is allowed, found ${filled.length} segments`)
    );
  }

  const group = filled[0];
  const leaf = filled[filled.length - 1];

  for (const segment of filled) {
    for (const slot of segment.split('-')) {
      if (!SLOT_PATTERN.test(slot)) {
        issues.push(
          issue(
            'slotCase',
            `Slot "${slot}" must start with a lowercase letter and stay camelCase (a-zA-Z0-9, no leading digit)`,
            { value: slot }
          )
        );
        continue;
      }
      if (isPluralSlot(slot)) {
        issues.push(issue('pluralSlot', `Slot "${slot}" looks plural; the paradigm is singular`, {
          value: slot
        }));
      }
    }
  }

  if (filled.length >= 2 && leaf.split('-').includes(group)) {
    issues.push(
      issue('groupEcho', `Leaf "${leaf}" repeats the whole group name "${group}"`, { value: group })
    );
  }

  return issues;
};

const parseSlots = (namespace: Namespace, path: string): Record<string, string> | null => {
  const filled = normalizeVariablePath(path).split('/');
  if (filled.length !== 2) return null;
  const leafSlots = filled[1].split('-');
  if (leafSlots.length !== namespace.leafSlots.length) return null;
  const slots: Record<string, string> = { [namespace.groupSlot]: filled[0] };
  namespace.leafSlots.forEach((slot, index) => {
    slots[slot] = leafSlots[index];
  });
  return slots;
};

const whitelistPaths = (namespace: Namespace): Set<string> | null => {
  if (namespace.key !== 'component') return null;
  return new Set(componentMatrix.entries.map((entry) => entry.path));
};

/** Vocabulary + matrix + whitelist check for a path already assigned to a namespace. */
export const validateInNamespace = (path: string, key: NamespaceKey): ValidationResult => {
  const namespace = getNamespace(key);
  const normalized = normalizeVariablePath(path);
  const issues = validateStructure(normalized);
  const slots = parseSlots(namespace, normalized);

  if (!slots) {
    issues.push(
      issue(
        'slotCount',
        `${key} expects the shape ${namespace.shape} (${namespace.leafSlots.length} leaf slot${namespace.leafSlots.length === 1 ? '' : 's'})`
      )
    );
    return { path: normalized, valid: false, namespace: key, issues };
  }

  for (const [slot, value] of Object.entries(slots)) {
    const allowed = namespace.slots[slot];
    if (allowed && !allowed.includes(value)) {
      issues.push(
        issue('unknownSlotValue', `"${value}" is not in the closed ${slot} vocabulary of ${key}`, {
          slot,
          value
        })
      );
    }
  }

  for (const constraint of namespace.matrix) {
    const keyValue = slots[constraint.key];
    const constrained = slots[constraint.constrains];
    const allow = constraint.allow[keyValue];
    if (!allow) continue;
    if (!allow.includes(constrained)) {
      issues.push(
        issue(
          'matrixViolation',
          `${constraint.constrains} "${constrained}" is not legal for ${constraint.key} "${keyValue}"`,
          { slot: constraint.constrains, value: constrained }
        )
      );
    }
  }

  const whitelist = whitelistPaths(namespace);
  if (whitelist && !whitelist.has(normalized)) {
    issues.push(
      issue(
        'notWhitelisted',
        `${normalized} is vocabulary-legal but not in matrices/component.json; add a recipe before creating it`
      )
    );
  }

  return { path: normalized, valid: issues.length === 0, namespace: key, slots, issues };
};

/**
 * Guesses the namespace from the group segment and the leaf slot count. Used by
 * the "Validate selection" report, where a path arrives without a collection.
 */
export const detectNamespace = (path: string): NamespaceKey | null => {
  const normalized = normalizeVariablePath(path);
  const filled = normalized.split('/');
  if (filled.length !== 2) return null;
  const group = filled[0];
  const leafCount = filled[1].split('-').length;

  const candidates = NAMESPACE_KEYS.filter((key) => {
    const namespace = getNamespace(key);
    const groupVocabulary = namespace.slots[namespace.groupSlot];
    return (
      namespace.leafSlots.length === leafCount && !!groupVocabulary && groupVocabulary.includes(group)
    );
  });

  if (candidates.length === 0) return null;
  const exact = candidates.find((key) => validateInNamespace(normalized, key).valid);
  return exact ?? candidates[0];
};

/**
 * Full check. Pass `namespace` when the collection is known (Apply / Dry-run);
 * omit it to let the validator classify the path (Validate selection).
 */
export const validateVariablePath = (
  path: string,
  options?: { namespace?: NamespaceKey }
): ValidationResult => {
  const normalized = normalizeVariablePath(path);
  const key = options?.namespace ?? detectNamespace(normalized);
  if (!key) {
    const issues = validateStructure(normalized);
    issues.push(
      issue(
        'unknownNamespace',
        'No namespace matches this group and slot count; it belongs to none of the five paradigm namespaces'
      )
    );
    return { path: normalized, valid: false, issues };
  }
  return validateInNamespace(normalized, key);
};

export type ValidationReport = {
  total: number;
  validCount: number;
  invalidCount: number;
  results: ValidationResult[];
  violations: ValidationResult[];
};

/** Batch report for the plugin UI: one row per path, violations pulled out. */
export const validateVariablePaths = (
  paths: Array<string | { path: string; namespace?: NamespaceKey }>
): ValidationReport => {
  const results = paths.map((entry) =>
    typeof entry === 'string'
      ? validateVariablePath(entry)
      : validateVariablePath(entry.path, { namespace: entry.namespace })
  );
  const violations = results.filter((result) => !result.valid);
  return {
    total: results.length,
    validCount: results.length - violations.length,
    invalidCount: violations.length,
    results,
    violations
  };
};

export const formatIssues = (result: ValidationResult): string =>
  result.issues.map((item) => `${item.code}: ${item.message}`).join('; ');
