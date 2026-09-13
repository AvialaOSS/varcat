/**
 * Upsert a Variable by paradigm path. Existing variables are updated in place;
 * variables the user added by hand are never deleted.
 */

export type UpsertResult = {
  variable: Variable;
  created: boolean;
};

const normalizeHex = (raw: string) => {
  const hex = String(raw).trim().replace(/^#/, '');
  if (hex.length === 3) return `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}FF`;
  if (hex.length === 6) return `${hex}FF`;
  return hex.slice(0, 8).padEnd(8, 'F');
};

/** `#RRGGBB` or `#RRGGBBAA` → Figma RGBA (0–1 channels). */
export const hexToRgba = (raw: string): RGBA => {
  const hex = normalizeHex(raw);
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: channel(6) };
};

export const findVariable = async (
  collection: VariableCollection,
  path: string,
  valueType: VariableResolvedDataType
): Promise<Variable | null> => {
  const variables = await figma.variables.getLocalVariablesAsync(valueType);
  return (
    variables.find(
      (variable) => variable.name === path && variable.variableCollectionId === collection.id
    ) ?? null
  );
};

export const upsertVariable = async (
  collection: VariableCollection,
  path: string,
  valueType: VariableResolvedDataType
): Promise<UpsertResult> => {
  const existing = await findVariable(collection, path, valueType);
  if (existing) return { variable: existing, created: false };
  return { variable: figma.variables.createVariable(path, collection, valueType), created: true };
};

export const setLiteral = (
  variable: Variable,
  modeId: string,
  valueType: VariableResolvedDataType,
  value: string | number
): void => {
  if (valueType === 'COLOR') {
    variable.setValueForMode(modeId, hexToRgba(String(value)));
    return;
  }
  if (valueType === 'FLOAT') {
    variable.setValueForMode(modeId, Number(value));
    return;
  }
  variable.setValueForMode(modeId, String(value));
};

export const setAlias = (variable: Variable, modeId: string, target: Variable): void => {
  variable.setValueForMode(modeId, figma.variables.createVariableAlias(target));
};
