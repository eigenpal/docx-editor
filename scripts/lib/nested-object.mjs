// Keys that would mutate the prototype chain rather than the target object.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafePath(path, parts, action) {
  if (parts.some((p) => UNSAFE_KEYS.has(p))) {
    throw new Error(`Refusing to ${action} unsafe key path: ${path}`);
  }
}

/** @param {Record<string, unknown>} obj @param {string} path @param {unknown} value */
export function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  assertSafePath(path, parts, 'set');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (
      !Object.hasOwn(current, key) ||
      typeof current[key] !== 'object' ||
      current[key] === null
    ) {
      Object.defineProperty(current, key, {
        value: {},
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    current = current[key];
  }
  Object.defineProperty(current, parts[parts.length - 1], {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** @param {Record<string, unknown>} obj @param {string} path */
export function deleteNestedValue(obj, path) {
  const parts = path.split('.');
  assertSafePath(path, parts, 'delete');
  const stack = [obj];
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (
      !Object.hasOwn(stack[i], key) ||
      !stack[i][key] ||
      typeof stack[i][key] !== 'object'
    ) {
      return;
    }
    stack.push(stack[i][key]);
  }
  const leaf = stack[stack.length - 1];
  const finalKey = parts[parts.length - 1];
  if (Object.hasOwn(leaf, finalKey)) {
    delete leaf[finalKey];
  }
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]).length === 0) {
      delete stack[i - 1][parts[i - 1]];
    } else break;
  }
}
