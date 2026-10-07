/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Core journal effects as the shared model reads them: every node ID a logical ID.
 *
 * A canonical node ID is a logical ID, so the conversion changes no value. It changes the
 * type, at one boundary, so the registry and the materializer accept only IDs that came
 * through a conversion.
 */
import type { CanonicalPrimitiveEffect } from '@docx-editor.dev/core/collaboration/replication';
import type { LogicalId } from './identity.ts';

type IdField = 'logicalId' | 'parentLogicalId' | 'destinationParentLogicalId' | 'rootLogicalId';

/** `T` with each node ID field typed as a logical ID, for each member of a union. */
type WithLogicalIds<T> = T extends unknown
  ? {
      readonly [K in keyof T]: K extends IdField
        ? LogicalId
        : K extends 'childLogicalIds'
          ? readonly LogicalId[]
          : K extends 'descriptor'
            ? WithLogicalIds<T[K]>
            : T[K];
    }
  : never;

export type SharedEffect = WithLogicalIds<CanonicalPrimitiveEffect>;

export function sharedEffect(effect: CanonicalPrimitiveEffect): SharedEffect {
  return effect as SharedEffect;
}

/** A node descriptor of a `putNode` effect, its ID a logical ID. */
export type SharedNodeDescriptor = Extract<SharedEffect, { kind: 'putNode' }>['descriptor'];
