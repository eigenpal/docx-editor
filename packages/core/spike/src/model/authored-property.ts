/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */

export type AuthoredProperty =
  | { readonly state: 'omitted' }
  | { readonly state: 'raw'; readonly rawLexical: string }
  | { readonly state: 'value'; readonly value: string | number | boolean };

const RESOLVED_OR_CACHE_PROPERTY =
  /(?:resolved|cache|derived|dependencyFingerprint|inputFingerprint|shapingEnvironment)/i;
const UNSAFE_PROPERTY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function freezeAuthoredProperty(property: AuthoredProperty): AuthoredProperty {
  return Object.freeze({ ...property });
}

export function freezeAuthoredProperties(
  properties: Readonly<Record<string, AuthoredProperty>>
): Readonly<Record<string, AuthoredProperty>> {
  for (const name of Object.keys(properties)) {
    if (isUnsafeAuthoredPropertyName(name)) {
      throw new TypeError(`unsafe authored property key: ${name}`);
    }
    if (rejectsResolvedOrCacheAuthoredPropertyName(name)) {
      throw new TypeError(`resolved or cache value in authored state: ${name}`);
    }
  }
  const frozen: Record<string, AuthoredProperty> = {};
  for (const [name, property] of Object.entries(properties)) {
    frozen[name] = freezeAuthoredProperty(property);
  }
  return Object.freeze(frozen);
}

export function isValidAuthoredProperty(value: unknown): value is AuthoredProperty {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const property = value as Record<string, unknown>;
  if (property.state === 'omitted') return hasExactKeys(property, ['state']);
  if (property.state === 'raw') {
    return (
      hasExactKeys(property, ['state', 'rawLexical']) &&
      typeof property.rawLexical === 'string' &&
      /^-?[0-9]{1,32}$/.test(property.rawLexical)
    );
  }
  if (property.state === 'value') {
    if (!hasExactKeys(property, ['state', 'value'])) return false;
    return (
      typeof property.value === 'boolean' ||
      (typeof property.value === 'string' && property.value.length > 0) ||
      (typeof property.value === 'number' && Number.isSafeInteger(property.value))
    );
  }
  return false;
}

export function rejectsResolvedOrCacheAuthoredPropertyName(name: string): boolean {
  return RESOLVED_OR_CACHE_PROPERTY.test(name);
}

export function isUnsafeAuthoredPropertyName(name: string): boolean {
  return UNSAFE_PROPERTY_KEYS.has(name);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}
