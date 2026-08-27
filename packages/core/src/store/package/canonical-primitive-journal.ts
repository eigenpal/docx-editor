// Yjs-free canonical mutation journal (full-document-yjs-collaboration task 3.5).
//
// These effects are the compositional package mutation language from design D3. TreeDocOp
// remains the intent API. Collaboration later applies one settled journal as one Yjs
// transaction. Core never imports a CRDT.

import type { OoxmlElement } from './ooxml-tree.ts';

/** Attribute name as the journal addresses it. Prefix is authored fidelity, not identity. @public */
export interface CanonicalAttributeName {
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
}

/** Content-addressed binary part reference. Bytes stay out of the journal. @public */
export interface CanonicalBinaryDescriptor {
  readonly storageKey: string;
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
}

/** Text node shell. Value arrives later through `spliceText`. @public */
export interface CanonicalTextNodeDescriptor {
  readonly logicalId: string;
  readonly kind: 'textValue';
}

/** OOXML element shell. Attributes, bindings, and children arrive as later effects. @public */
export interface CanonicalElementNodeDescriptor {
  readonly logicalId: string;
  readonly kind: OoxmlElement['kind'];
  readonly qname: CanonicalAttributeName;
}

/** Immutable node record required to create a registry entry. @public */
export type CanonicalNodeDescriptor = CanonicalTextNodeDescriptor | CanonicalElementNodeDescriptor;

/** One relationship as the journal records it. @public */
export interface CanonicalRelationshipRecord {
  readonly ownerPart: string;
  readonly id: string;
  readonly type: string;
  readonly rawTarget: string;
  readonly targetMode: 'Internal' | 'External';
  readonly order: number;
}

/** One compositional tree or package effect captured from a canonical write. @public */
export type CanonicalPrimitiveEffect =
  | {
      readonly kind: 'putNode';
      readonly descriptor: CanonicalNodeDescriptor;
    }
  | {
      readonly kind: 'spliceText';
      readonly logicalId: string;
      readonly utf16Start: number;
      readonly deleteCount: number;
      readonly insert: string;
    }
  | {
      readonly kind: 'setAttribute';
      readonly logicalId: string;
      readonly qname: CanonicalAttributeName;
      readonly value: string | null;
    }
  | {
      readonly kind: 'setNamespaceBinding';
      readonly logicalId: string;
      readonly prefix: string;
      readonly uri: string | null;
    }
  | {
      readonly kind: 'spliceChildren';
      readonly parentLogicalId: string;
      readonly start: number;
      readonly deleteCount: number;
      readonly childLogicalIds: readonly string[];
    }
  | {
      readonly kind: 'moveNode';
      readonly logicalId: string;
      readonly destinationParentLogicalId: string;
      readonly destinationIndex: number;
    }
  | {
      readonly kind: 'putXmlPart';
      readonly name: string;
      readonly rootLogicalId: string;
    }
  | {
      readonly kind: 'deleteXmlPart';
      readonly name: string;
    }
  | {
      readonly kind: 'putRelationship';
      readonly owner: string;
      readonly record: CanonicalRelationshipRecord;
    }
  | {
      readonly kind: 'deleteRelationship';
      readonly owner: string;
      readonly relationshipId: string;
    }
  | {
      readonly kind: 'putContentTypeOverride';
      readonly partName: string;
      readonly mediaType: string;
    }
  | {
      readonly kind: 'deleteContentTypeOverride';
      readonly partName: string;
    }
  | {
      readonly kind: 'putBinary';
      readonly descriptor: CanonicalBinaryDescriptor;
    }
  | {
      readonly kind: 'deleteBinary';
      readonly storageKey: string;
    };

/**
 * One immutable journal for one `TreePackageStore` transaction.
 *
 * Empty only when a committed write used a path the journal does not yet intercept.
 *
 * @public
 */
export interface CanonicalPrimitiveJournal {
  readonly effects: readonly CanonicalPrimitiveEffect[];
}

/** Freeze one effect and any nested arrays it owns. */
export function freezeCanonicalPrimitiveEffect(
  effect: CanonicalPrimitiveEffect
): CanonicalPrimitiveEffect {
  if (effect.kind === 'spliceChildren') {
    return Object.freeze({
      ...effect,
      childLogicalIds: Object.freeze([...effect.childLogicalIds]),
    });
  }
  if (effect.kind === 'setAttribute') {
    return Object.freeze({ ...effect, qname: Object.freeze({ ...effect.qname }) });
  }
  if (effect.kind === 'putRelationship') {
    return Object.freeze({ ...effect, record: Object.freeze({ ...effect.record }) });
  }
  if (effect.kind === 'putBinary') {
    return Object.freeze({ ...effect, descriptor: Object.freeze({ ...effect.descriptor }) });
  }
  if (effect.kind === 'putNode') {
    return Object.freeze({
      ...effect,
      descriptor: freezeCanonicalNodeDescriptor(effect.descriptor),
    });
  }
  return Object.freeze({ ...effect });
}

function freezeCanonicalNodeDescriptor(
  descriptor: CanonicalNodeDescriptor
): CanonicalNodeDescriptor {
  if (descriptor.kind === 'textValue') {
    return Object.freeze({ logicalId: descriptor.logicalId, kind: 'textValue' });
  }
  return Object.freeze({
    logicalId: descriptor.logicalId,
    kind: descriptor.kind,
    qname: Object.freeze({ ...descriptor.qname }),
  });
}

/** Freeze a captured effect list into one journal object. */
export function freezeCanonicalPrimitiveJournal(
  effects: readonly CanonicalPrimitiveEffect[]
): CanonicalPrimitiveJournal {
  return Object.freeze({
    effects: Object.freeze(effects.map(freezeCanonicalPrimitiveEffect)),
  });
}
