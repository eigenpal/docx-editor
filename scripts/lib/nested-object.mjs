// Keys that would mutate the prototype chain rather than the target object. Compared one
// literal at a time, in the loop that does the writing, so the guard sits on the same path
// a reader (or a static analyzer) walks to reach the assignment.
//
// The three names are spelled out again inside `setNestedValue`, at the descent step and at
// the leaf write. That repetition is deliberate — a guard behind a helper call is a guard
// the analysis cannot see — so ADDING A NAME HERE MEANS ADDING IT AT BOTH SITES TOO.
// `scripts/lib/nested-object.test.mjs` asserts the three lists agree.
function isUnsafeKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function assertSafePath(path, parts, action) {
  if (parts.some(isUnsafeKey)) {
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
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`Refusing to set unsafe key path: ${path}`);
    }
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
  const leafKey = parts[parts.length - 1];
  if (leafKey === '__proto__' || leafKey === 'constructor' || leafKey === 'prototype') {
    throw new Error(`Refusing to set unsafe key path: ${path}`);
  }
  Object.defineProperty(current, leafKey, {
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
