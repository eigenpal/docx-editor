/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */
import { canonicalJson } from '../canonical-json';
import { sha256Hex } from '../oracle-hash';
import type { DocumentModel } from './types';
import { validateDocumentModel } from './validators';

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export interface AuthoredFingerprintPayload {
  readonly revision: number;
  readonly storyId: string;
  readonly paragraphs: readonly {
    readonly blockId: string;
    readonly paragraphId: string;
    readonly text: string;
    readonly styleId: string;
    readonly marks: readonly {
      readonly markId: string;
      readonly kind: 'bold' | 'italic';
      readonly start: number;
      readonly end: number;
    }[];
    readonly authoredProperties: Readonly<
      Record<
        string,
        | { readonly state: 'omitted' }
        | { readonly state: 'raw'; readonly rawLexical: string }
        | { readonly state: 'value'; readonly value: string | number | boolean }
      >
    >;
  }[];
  readonly capsules: readonly {
    readonly capsuleId: string;
    readonly ownerStoryId: string;
    readonly ownerBlockId: string;
    readonly childIndex: number;
    readonly byteBoundaryStart: number;
    readonly byteBoundaryEnd: number;
    readonly bytesHex: string;
    readonly namespaceBindings: Readonly<Record<string, string>>;
    readonly previousSiblingBytesHex: string;
    readonly nextSiblingBytesHex: string;
  }[];
}

export function authoredFingerprintPayload(model: DocumentModel): AuthoredFingerprintPayload {
  const errors = validateDocumentModel(model);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  return {
    revision: model.revision,
    storyId: model.authored.body.storyId,
    paragraphs: model.authored.body.paragraphOrder.map((paragraphId) => {
      const paragraph = model.authored.body.paragraphs.get(paragraphId)!;
      return {
        blockId: paragraph.blockId,
        paragraphId: paragraph.paragraphId,
        text: paragraph.text,
        styleId: paragraph.styleId,
        marks: paragraph.marks.map((mark) => ({
          markId: mark.markId,
          kind: mark.kind,
          start: mark.start,
          end: mark.end,
        })),
        authoredProperties: Object.fromEntries(
          Object.entries(paragraph.authoredProperties).map(([name, property]) => [name, { ...property }])
        ),
      };
    }),
    capsules: model.authored.capsules.map((capsule) => ({
      capsuleId: capsule.capsuleId,
      ownerStoryId: capsule.ownerStoryId,
      ownerBlockId: capsule.ownerBlockId,
      childIndex: capsule.childIndex,
      byteBoundaryStart: capsule.byteBoundaryStart,
      byteBoundaryEnd: capsule.byteBoundaryEnd,
      bytesHex: bytesToHex(capsule.bytes),
      namespaceBindings: { ...capsule.namespaceBindings },
      previousSiblingBytesHex: bytesToHex(capsule.previousSiblingBytes),
      nextSiblingBytesHex: bytesToHex(capsule.nextSiblingBytes),
    })),
  };
}

export function fingerprintAuthoredModel(
  model: DocumentModel,
  options: { includePayload?: boolean } = {}
): string {
  const payload = authoredFingerprintPayload(model);
  const canonical = canonicalJson(payload);
  if (options.includePayload) return canonical;
  return sha256Hex(canonical);
}
