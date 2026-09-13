/**
 * Idempotent Variable Collection + mode handling. Re-running Apply on a file
 * that already has the collections must reuse them, never duplicate them.
 */

export type EnsuredCollection = {
  collection: VariableCollection;
  /** Paradigm mode name → Figma modeId. */
  modeIds: Record<string, string>;
  created: boolean;
  /** Modes the current Figma plan refused to create (mode limit). */
  missingModes: string[];
};

export const findCollection = async (name: string): Promise<VariableCollection | null> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  return collections.find((collection) => collection.name === name) ?? null;
};

/**
 * Creates or reuses `name` and makes sure every mode in `modes` exists. The
 * first requested mode renames Figma's default mode instead of adding a second
 * one, so a fresh collection does not end up with a stray "Mode 1".
 */
export const ensureCollection = async (
  name: string,
  modes: string[]
): Promise<EnsuredCollection> => {
  const existing = await findCollection(name);
  const collection = existing ?? figma.variables.createVariableCollection(name);
  const modeIds: Record<string, string> = {};
  const missingModes: string[] = [];

  modes.forEach((mode, index) => {
    const found = collection.modes.find((candidate) => candidate.name === mode);
    if (found) {
      modeIds[mode] = found.modeId;
      return;
    }
    if (index === 0 && collection.modes.length === 1 && modes.length > 1) {
      // Fresh collection: adopt the default mode as the first paradigm mode.
      const fallback = collection.modes[0];
      if (!modes.includes(fallback.name)) {
        collection.renameMode(fallback.modeId, mode);
        modeIds[mode] = fallback.modeId;
        return;
      }
    }
    if (collection.modes.length === 1 && modes.length === 1) {
      collection.renameMode(collection.modes[0].modeId, mode);
      modeIds[mode] = collection.modes[0].modeId;
      return;
    }
    try {
      modeIds[mode] = collection.addMode(mode);
    } catch {
      missingModes.push(mode);
    }
  });

  return { collection, modeIds, created: !existing, missingModes };
};
