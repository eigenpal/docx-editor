/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import { rejectDangerousKey } from './limits.ts';
import {
  NODE_DELETED_FIELD,
  NODE_REPLACED_BY_FIELD,
  parseAttributeMapKey,
  parseBindingMapKey,
  type DirtyPaths,
  type PackageSchema,
} from './schema.ts';

export function observeDirtyPaths(
  schema: PackageSchema,
  onDirty: (paths: DirtyPaths) => void
): () => void {
  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    const logicalIds = new Set<LogicalId>();
    let membershipChanged = false;
    for (const event of events) {
      const path = event.path;
      if (path.length === 0) {
        for (const key of event.changes.keys.keys()) logicalIds.add(String(key));
        membershipChanged = true;
        continue;
      }
      logicalIds.add(String(path[0]));
      if (event.target instanceof Y.Array) membershipChanged = true;
      if (
        event.target instanceof Y.Map &&
        (event.changes.keys.has(NODE_DELETED_FIELD) ||
          event.changes.keys.has(NODE_REPLACED_BY_FIELD))
      ) {
        membershipChanged = true;
      }
    }
    if (logicalIds.size > 0 || membershipChanged) {
      onDirty({ logicalIds, membershipChanged, packageChanged: false });
    }
  };
  const sideMapHandler = (event: Y.YMapEvent<string>): void => {
    const logicalIds = new Set<LogicalId>();
    for (const key of event.changes.keys.keys()) {
      const parsed = parseAttributeMapKey(String(key)) ?? parseBindingMapKey(String(key));
      if (!parsed || rejectDangerousKey(parsed.logicalId)) continue;
      logicalIds.add(parsed.logicalId);
    }
    if (logicalIds.size > 0) {
      onDirty({ logicalIds, membershipChanged: false, packageChanged: false });
    }
  };
  const packageHandler = (): void => {
    onDirty({ logicalIds: new Set(), membershipChanged: false, packageChanged: true });
  };
  schema.nodes.observeDeep(handler);
  schema.attributes.observe(sideMapHandler);
  schema.bindings.observe(sideMapHandler);
  schema.parts.observeDeep(packageHandler);
  schema.relationships.observeDeep(packageHandler);
  schema.overrides.observe(packageHandler);
  schema.defaults.observe(packageHandler);
  schema.binaries.observeDeep(packageHandler);
  return () => {
    schema.nodes.unobserveDeep(handler);
    schema.attributes.unobserve(sideMapHandler);
    schema.bindings.unobserve(sideMapHandler);
    schema.parts.unobserveDeep(packageHandler);
    schema.relationships.unobserveDeep(packageHandler);
    schema.overrides.unobserve(packageHandler);
    schema.defaults.unobserve(packageHandler);
    schema.binaries.unobserveDeep(packageHandler);
  };
}
