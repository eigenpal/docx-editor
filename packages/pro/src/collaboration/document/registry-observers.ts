/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Observer wiring for one `DocumentRegistry`.
 *
 * The registry derives every index from Yjs events, so it has to observe the shared types —
 * but it does not own the document. Registration therefore returns the matching detach, and
 * the registry exposes it as `destroy()`: a registry left observing outlives its consumer,
 * every later transaction pays its handlers, and its derived indexes retain the whole tree.
 */

import type * as Y from 'yjs';
import type { PackageSchema } from './schema.ts';

export interface RegistryObserverHooks {
  readonly onNodeEvents: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void;
  readonly onAttributeEvent: (event: Y.YMapEvent<string>) => void;
  readonly onBindingEvent: (event: Y.YMapEvent<string>) => void;
  readonly onRelationshipChange: () => void;
  readonly onPartChange: () => void;
}

/** Attach the registry's derived-index observers. Returns the matching detach. */
export function observeRegistrySchema(
  schema: PackageSchema,
  hooks: RegistryObserverHooks
): () => void {
  schema.nodes.observeDeep(hooks.onNodeEvents);
  schema.attributes.observe(hooks.onAttributeEvent);
  schema.bindings.observe(hooks.onBindingEvent);
  schema.relationships.observeDeep(hooks.onRelationshipChange);
  schema.parts.observeDeep(hooks.onPartChange);
  return () => {
    schema.nodes.unobserveDeep(hooks.onNodeEvents);
    schema.attributes.unobserve(hooks.onAttributeEvent);
    schema.bindings.unobserve(hooks.onBindingEvent);
    schema.relationships.unobserveDeep(hooks.onRelationshipChange);
    schema.parts.unobserveDeep(hooks.onPartChange);
  };
}
