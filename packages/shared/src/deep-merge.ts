/**
 * Deep merge utility for sFlow
 * Handles arrays via Set union (aligned with oh-my-openagent)
 */

/**
 * Deep merge two objects
 * Arrays: Set union (concatenate + deduplicate by identity)
 * Objects: recursive merge
 * Primitives: source wins
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
        // Array merge: Set union (deduplicated concatenation)
        (result as Record<string, unknown>)[key] = [...new Set([...targetValue, ...sourceValue])];
      } else if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        );
      } else if (sourceValue !== undefined) {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

/**
 * Check if value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
