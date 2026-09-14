export type Axis = {
  slot: string;
  label: string;
  labelZh?: string;
  note?: string;
  values: string[];
  default: string[];
};

export type TemplateSummary = {
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
  extras?: number;
  defaultCount: number;
  maxCount: number;
  axes?: Axis[];
};

export type AxisSelection = { axes: Record<string, string[]>; includeExtras: boolean };

export type DryRunPath = { collection: string; path: string; status: 'new' | 'existing' };

export type NamespaceSummary = {
  key: string;
  shape: string;
  valueKind: string;
  modes: string[];
};

export type ModeBudgetRow = {
  collection: string;
  needs: string[];
  has: string[];
  exists: boolean;
};

/** Session overlay for editable plan vocabulary (persisted in clientStorage). */
export type VocabOverlay = {
  version: 1;
  axes: Record<string, Record<string, string[]>>;
};
