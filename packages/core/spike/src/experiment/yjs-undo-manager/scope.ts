/** @spike-features yjs-backend */
import * as Y from 'yjs';
import { YJS_ROOT_KEYS, YJS_ROOT_NAME } from '../../store/yjs/doc-access';

const AUTHORED_SCOPE_KEYS = YJS_ROOT_KEYS.filter((key) => key !== 'allocator');

export function collectAuthoredModelScope(doc: Y.Doc): readonly Y.AbstractType<unknown>[] {
  const root = doc.getMap(YJS_ROOT_NAME);
  const scope: Y.AbstractType<unknown>[] = [];
  for (const key of AUTHORED_SCOPE_KEYS) {
    const value = root.get(key);
    if (value instanceof Y.AbstractType) scope.push(value);
  }
  return Object.freeze(scope);
}
