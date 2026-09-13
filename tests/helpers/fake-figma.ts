/**
 * Minimal in-memory stand-in for the parts of the `figma` global that
 * `src/figma/*` touches. It records every `setValueForMode` call, which is how
 * the unbound tests prove Apply leaves empty shells alone.
 */
export type FakeVariable = {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: string;
  description: string;
  hiddenFromPublishing: boolean;
  valuesByMode: Record<string, unknown>;
  setValueForMode: (modeId: string, value: unknown) => void;
};

export type FakeCollection = {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  addMode: (name: string) => string;
  renameMode: (modeId: string, name: string) => void;
};

export type FakeFigma = {
  variables: {
    getLocalVariablesAsync: (type?: string) => Promise<FakeVariable[]>;
    getLocalVariableCollectionsAsync: () => Promise<FakeCollection[]>;
    createVariableCollection: (name: string) => FakeCollection;
    createVariable: (name: string, collection: FakeCollection, type: string) => FakeVariable;
    createVariableAlias: (target: FakeVariable) => { type: 'VARIABLE_ALIAS'; id: string };
  };
  /** Every value write, in order. Empty means nothing was bound. */
  writes: Array<{ variable: string; modeId: string; value: unknown }>;
  /** Max modes this "plan" allows per collection; extra modes throw, like Figma. */
  modeLimit: number;
  state: { collections: FakeCollection[]; variables: FakeVariable[] };
};

export const createFakeFigma = (options: { modeLimit?: number } = {}): FakeFigma => {
  const collections: FakeCollection[] = [];
  const variables: FakeVariable[] = [];
  const writes: FakeFigma['writes'] = [];
  const modeLimit = options.modeLimit ?? 4;
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}:${++sequence}`;

  const makeCollection = (name: string): FakeCollection => {
    const collection: FakeCollection = {
      id: nextId('coll'),
      name,
      modes: [{ modeId: nextId('mode'), name: 'Mode 1' }],
      addMode(modeName: string) {
        if (this.modes.length >= modeLimit) throw new Error('mode limit reached');
        const modeId = nextId('mode');
        this.modes.push({ modeId, name: modeName });
        return modeId;
      },
      renameMode(modeId: string, modeName: string) {
        const found = this.modes.find((mode) => mode.modeId === modeId);
        if (found) found.name = modeName;
      }
    };
    collections.push(collection);
    return collection;
  };

  const fake: FakeFigma = {
    variables: {
      getLocalVariablesAsync: async (type?: string) =>
        type ? variables.filter((variable) => variable.resolvedType === type) : [...variables],
      getLocalVariableCollectionsAsync: async () => [...collections],
      createVariableCollection: (name: string) => makeCollection(name),
      createVariable: (name: string, collection: FakeCollection, type: string) => {
        const variable: FakeVariable = {
          id: nextId('var'),
          name,
          variableCollectionId: collection.id,
          resolvedType: type,
          description: '',
          hiddenFromPublishing: false,
          valuesByMode: {},
          setValueForMode(modeId: string, value: unknown) {
            this.valuesByMode[modeId] = value;
            writes.push({ variable: this.name, modeId, value });
          }
        };
        variables.push(variable);
        return variable;
      },
      createVariableAlias: (target: FakeVariable) => ({
        type: 'VARIABLE_ALIAS' as const,
        id: target.id
      })
    },
    writes,
    modeLimit,
    state: { collections, variables }
  };

  return fake;
};

export const installFakeFigma = (options: { modeLimit?: number } = {}): FakeFigma => {
  const fake = createFakeFigma(options);
  (globalThis as any).figma = fake;
  return fake;
};

export const uninstallFakeFigma = () => {
  delete (globalThis as any).figma;
};
