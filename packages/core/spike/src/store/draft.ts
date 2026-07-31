/** @spike-features insert-delete-split-join-operations, one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule */
import type {
  AuthoredMark,
  AuthoredPackageModel,
  AuthoredParagraph,
  UnsupportedCapsule,
} from '../model/types';
import type { AuthoredProperty } from '../model/authored-property';
import { createImmutableLookup, freezeAuthoredPackage } from '../model/immutability';

export interface MutableParagraph {
  blockId: string;
  paragraphId: string;
  text: string;
  styleId: string;
  marks: AuthoredMark[];
  authoredProperties: Record<string, AuthoredProperty>;
}

export interface MutableDraft {
  storyId: string;
  paragraphOrder: string[];
  paragraphs: Map<string, MutableParagraph>;
  capsules: readonly UnsupportedCapsule[];
}

let draftFromAuthoredInvocationCount = 0;

export function resetDraftFromAuthoredInvocationCountForTests(): void {
  draftFromAuthoredInvocationCount = 0;
}

export function draftFromAuthoredInvocationCountForTests(): number {
  return draftFromAuthoredInvocationCount;
}

export function draftFromAuthored(authored: AuthoredPackageModel): MutableDraft {
  draftFromAuthoredInvocationCount += 1;
  const paragraphs = new Map<string, MutableParagraph>();
  for (const paragraphId of authored.body.paragraphOrder) {
    const paragraph = authored.body.paragraphs.get(paragraphId);
    if (!paragraph) continue;
    paragraphs.set(paragraphId, {
      blockId: paragraph.blockId,
      paragraphId: paragraph.paragraphId,
      text: paragraph.text,
      styleId: paragraph.styleId,
      marks: paragraph.marks.map((mark) => ({ ...mark })),
      authoredProperties: { ...paragraph.authoredProperties },
    });
  }
  return {
    storyId: authored.body.storyId,
    paragraphOrder: [...authored.body.paragraphOrder],
    paragraphs,
    capsules: authored.capsules,
  };
}

export function findParagraphByBlockId(
  draft: MutableDraft,
  blockId: string
): MutableParagraph | undefined {
  for (const paragraph of draft.paragraphs.values()) {
    if (paragraph.blockId === blockId) return paragraph;
  }
  return undefined;
}

export function findParagraphIdByBlockId(draft: MutableDraft, blockId: string): string | undefined {
  for (const [paragraphId, paragraph] of draft.paragraphs) {
    if (paragraph.blockId === blockId) return paragraphId;
  }
  return undefined;
}

export function paragraphIndexInOrder(draft: MutableDraft, paragraphId: string): number {
  return draft.paragraphOrder.indexOf(paragraphId);
}

export function areAdjacentParagraphs(
  draft: MutableDraft,
  firstParagraphId: string,
  secondParagraphId: string
): boolean {
  const firstIndex = paragraphIndexInOrder(draft, firstParagraphId);
  const secondIndex = paragraphIndexInOrder(draft, secondParagraphId);
  return firstIndex >= 0 && secondIndex === firstIndex + 1;
}

export function draftToAuthoredPackage(draft: MutableDraft): AuthoredPackageModel {
  const paragraphs: Array<readonly [string, AuthoredParagraph]> = draft.paragraphOrder.map(
    (paragraphId) => {
      const paragraph = draft.paragraphs.get(paragraphId);
      if (!paragraph) throw new Error(`missing paragraph ${paragraphId}`);
      return [
        paragraphId,
        {
          blockId: paragraph.blockId,
          paragraphId: paragraph.paragraphId,
          text: paragraph.text,
          styleId: paragraph.styleId,
          marks: Object.freeze(paragraph.marks.map((mark) => Object.freeze({ ...mark }))),
          authoredProperties: Object.freeze({ ...paragraph.authoredProperties }),
        },
      ];
    }
  );
  return freezeAuthoredPackage({
    body: {
      storyId: draft.storyId,
      paragraphOrder: draft.paragraphOrder,
      paragraphs: createImmutableLookup(paragraphs),
    },
    capsules: draft.capsules,
  });
}

export function cloneDraft(draft: MutableDraft): MutableDraft {
  const paragraphs = new Map<string, MutableParagraph>();
  for (const [paragraphId, paragraph] of draft.paragraphs) {
    paragraphs.set(paragraphId, {
      ...paragraph,
      marks: paragraph.marks.map((mark) => ({ ...mark })),
      authoredProperties: { ...paragraph.authoredProperties },
    });
  }
  return {
    storyId: draft.storyId,
    paragraphOrder: [...draft.paragraphOrder],
    paragraphs,
    capsules: draft.capsules,
  };
}
