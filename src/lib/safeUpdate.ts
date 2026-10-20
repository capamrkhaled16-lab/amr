/**
 * Safe-update guards: prevent replacing real values with null/0/blank
 * unless the user explicitly chose that value.
 *
 * Usage: call shouldUpdate(oldValue, newValue) before writing to DB.
 * Returns false if the new value is empty/null/0 but the old value was real.
 */

/**
 * Returns true if the update is safe to apply.
 * Blocks: real value → null, real value → '', real value → 0 (for numbers),
 * unless allowBlank is true (user explicitly cleared the field).
 */
export function shouldUpdate<T>(
  oldValue: T | null | undefined,
  newValue: T | null | undefined,
  allowBlank = false,
): boolean {
  if (allowBlank) return true;

  const newIsEmpty = isBlank(newValue);
  const oldHasValue = !isBlank(oldValue);

  // Block: replacing a real value with an empty one
  if (newIsEmpty && oldHasValue) return false;

  return true;
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (typeof v === 'number' && v === 0) return true;
  return false;
}

/**
 * Returns the value to write: newValue if safe, oldValue otherwise.
 * Use for single-field updates where we want to silently keep the old value
 * rather than overwrite with garbage.
 */
export function safeValue<T>(
  oldValue: T | null | undefined,
  newValue: T | null | undefined,
  allowBlank = false,
): T | null | undefined {
  return shouldUpdate(oldValue, newValue, allowBlank) ? newValue : oldValue;
}

/**
 * Filters a payload object to only include fields that are safe to update.
 * Removes any field where the new value is blank but the old value was real.
 */
export function safePayload(
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>,
  allowBlankFields: string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, newValue] of Object.entries(newRecord)) {
    const allowBlank = allowBlankFields.includes(key);
    if (shouldUpdate(oldRecord[key], newValue, allowBlank)) {
      result[key] = newValue;
    }
  }
  return result;
}
