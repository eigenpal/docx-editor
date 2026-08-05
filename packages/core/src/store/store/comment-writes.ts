// Adding a comment, and replying to one.
//
// This is the write the package transaction exists for. One reply touches the story (three
// markers), `comments.xml` (the body, created if the package has none), `commentsExtended.xml`
// (the parent link, likewise), the relationship part and the content types. All of it commits
// together or none of it does, so there is never a story referencing a comment that does not
// exist, and one undo takes the whole reply back.
//
// Replying to a TRACKED CHANGE lands here too. OOXML gives `w:ins` and `w:del` no body and no
// thread — they carry `(@w:id, @w:author, @w:date)` and nothing else — so a reply against a
// revision is a comment anchored over that revision's range. There is no other faithful reading.

import {
  relationshipsOf,
  resolveContentTypeOf,
  withNewPart,
  withRelationship,
} from '../package/package-edit.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import { insertChildren, findNode, replaceNode } from '../package/ooxml-edit.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { W14_NAMESPACE_URI, XML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isValidParaId, mintParaId, usedParaIds, w14RootPrefix } from '../package/para-id.ts';
import type { TreeDocumentStore, TreeModelChange } from './tree-store.ts';
import type { TreeOpRejection } from './tree-op-validate.ts';

const COMMENTS_PART = '/word/comments.xml';
const COMMENTS_EXTENDED_PART = '/word/commentsExtended.xml';
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_EXTENDED_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

/** Where a comment is anchored, in the model offset space of one story. */
export interface CommentAnchorRequest {
  readonly paragraphId: string;
  readonly start: number;
  /** May sit in the same paragraph or a later one; `endParagraphId` names it when it differs. */
  readonly end: number;
  readonly endParagraphId?: string;
}

/**
 * What adding a comment needs: where it anchors, who wrote it, and its body.
 *
 * `author` is required because `CT_Comment` makes `@w:author` mandatory — a comment without one
 * writes invalid XML, so the write is refused rather than filled with an empty attribute.
 */
export interface AddCommentRequest {
  readonly anchor: CommentAnchorRequest;
  /** Required by `CT_TrackChange`. A comment without one writes invalid XML. */
  readonly author: string;
  readonly initials?: string;
  /** ISO-8601. Absent writes no `@w:date`, because inventing one is a content change. */
  readonly date?: string;
  readonly text: string;
  /** The comment this replies to. Its thread link is written to `commentsExtended.xml`. */
  readonly replyToCommentId?: string;
}

/** The new comment's id and the story change, or the reason the write was refused. */
export type AddCommentResult =
  | {
      readonly ok: true;
      readonly commentId: string;
      /**
       * The story transaction's own change, so the coordinator can publish it.
       *
       * A comment write commits straight on the story store rather than through
       * `applyTreeOps`, and the change is what carries the dirty anchor paragraphs and the
       * `text-local` impact. Dropping it here left the caller with nothing precise to
       * publish and no way to tell a committed write from an identity no-op.
       */
      readonly change: TreeModelChange | null;
    }
  | { readonly ok: false; readonly reason: TreeOpRejection | 'invalid-author' };

function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

function wmlAttr(localName: string, value: string): OoxmlElement['attributes'][number] {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

/**
 * Build an element with an explicit KIND.
 *
 * Typed rather than generic on purpose: everything that reads comments matches on kind, so a
 * body written as generic nodes would serialize correctly and be invisible to the reader in the
 * same session — the comment would appear only after a save and reopen.
 */
function element(
  id: string,
  kind: OoxmlElement['kind'],
  namespaceUri: string,
  prefix: string,
  localName: string,
  attributes: OoxmlElement['attributes'],
  children: readonly OoxmlNode[],
  bindings: readonly { prefix: string; namespaceUri: string }[] = []
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri,
    localName,
    prefix,
    namespaceBindings: bindings,
    attributes,
    children,
  } as OoxmlElement;
}

/**
 * The part a relationship of `type` names, when the package agrees it is that kind of part.
 *
 * The relationship alone is not enough. `Type` is an attacker-controlled attribute in a file
 * an attacker wrote, so a crafted package can declare a comments relationship pointing at
 * `settings.xml`, `document.xml`, or any other part it wants a comment write to land in.
 * Requiring the target's declared CONTENT TYPE to be the comments type as well means a
 * redirect can only ever aim at a part that already is what it claims — and a name the
 * package does not hold yet is fine, because this write is the thing that will create it with
 * the right type.
 */
function relatedPartName(
  pkg: OoxmlPackage,
  storyPartName: string,
  relationshipType: string,
  contentType: string,
  conventional: string
): string {
  for (const record of relationshipsOf(pkg, storyPartName)) {
    if (record.type !== relationshipType) continue;
    const resolved = resolveInternalTarget(storyPartName, record.rawTarget);
    if (!resolved.ok) continue;
    if (!pkg.parts.has(resolved.partName)) return resolved.partName;
    if (resolveContentTypeOf(pkg, resolved.partName) === contentType) return resolved.partName;
  }
  return conventional;
}

/** The comment part this story points at, or the conventional name when it has none yet. */
function commentsPartNameFor(pkg: OoxmlPackage, storyPartName: string): string {
  return relatedPartName(pkg, storyPartName, COMMENTS_REL, COMMENTS_TYPE, COMMENTS_PART);
}

function extendedPartNameFor(pkg: OoxmlPackage, storyPartName: string): string {
  return relatedPartName(
    pkg,
    storyPartName,
    COMMENTS_EXTENDED_REL,
    COMMENTS_EXTENDED_TYPE,
    COMMENTS_EXTENDED_PART
  );
}

/** Highest `w:comment/@w:id` in the part, so the next is seeded from the document. */
function nextCommentId(part: OoxmlPart | undefined): string {
  if (!part) return '0';
  let highest = -1;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'comment') {
      const raw = attribute(node, WML_NAMESPACE_URI, 'id');
      // `ST_DecimalNumber` is unbounded in the schema and signed 32-bit in Word, so a value
      // outside that range is ignored for seeding rather than used and overflowed.
      if (raw !== undefined && /^\d{1,10}$/.test(raw)) {
        const value = Number(raw);
        if (Number.isSafeInteger(value) && value <= 2_147_483_647 && value > highest) {
          highest = value;
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return String(highest + 1);
}

/** Every `w14:paraId` already used anywhere in the package, so a mint cannot collide. */
function paraIdsInPackage(pkg: OoxmlPackage): Set<string> {
  const used = new Set<string>();
  for (const part of pkg.parts.values()) {
    for (const value of usedParaIds(part.root)) used.add(value);
  }
  return used;
}

/** The `w14:paraId` of a comment's first paragraph, when it has one. */
function paraIdOfComment(part: OoxmlPart | undefined, commentId: string): string | null {
  if (!part) return null;
  let found: string | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'comment' && attribute(node, WML_NAMESPACE_URI, 'id') === commentId) {
      for (const child of node.children) {
        if (child.kind !== 'paragraph') continue;
        const value = attribute(child, W14_NAMESPACE_URI, 'paraId');
        if (value !== undefined && isValidParaId(value)) found = value.toUpperCase();
        return;
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/** The paragraph a comment's `w14:paraId` belongs on: its first, which is where Word puts it. */
function firstParagraphOfComment(
  part: OoxmlPart | undefined,
  commentId: string
): OoxmlElement | null {
  if (!part) return null;
  let found: OoxmlElement | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'comment' && attribute(node, WML_NAMESPACE_URI, 'id') === commentId) {
      for (const child of node.children) {
        if (child.kind === 'paragraph') {
          found = child;
          return;
        }
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/**
 * Bind the `w14` prefix on a part root if it is not bound already.
 *
 * `w14:paraId` cannot be written into a part whose root does not declare the namespace: the
 * attribute's prefix would resolve to nothing and the tree invariants reject it as an invalid
 * QName. Word's own comment parts often do not declare `w14`, because until something needs a
 * paraId nothing in them uses it.
 */
function withW14Binding(part: OoxmlPart): { part: OoxmlPart; prefix: string } {
  const existing = w14RootPrefix(part.root);
  if (existing !== null) return { part, prefix: existing };
  const bound: OoxmlElement = {
    ...part.root,
    namespaceBindings: [
      ...part.root.namespaceBindings,
      { prefix: 'w14', namespaceUri: W14_NAMESPACE_URI },
    ],
  } as OoxmlElement;
  return { part: { ...part, root: bound }, prefix: 'w14' };
}

/**
 * Give a comment's paragraph the `w14:paraId` a `w15:commentEx` entry can be keyed by.
 *
 * REPLACES rather than adds. A paragraph reaching here has no id the READER accepted, which is not
 * the same as having no `w14:paraId` attribute: a file can carry one that is legal hex and outside
 * the range MS-DOCX reserves (below 0x80000000), and the reader refuses exactly those. Appending
 * beside it makes the element carry one expanded name twice — a duplicate the part's invariants
 * reject, which took the whole write down with it. So the id another editor wrote is repaired here
 * instead, and a comment stays repliable and resolvable.
 *
 * Both write paths — a reply keying its parent, a resolve keying a thread — go through this, so
 * neither can be repaired while the other is not.
 */
function withStampedParaId(pkg: OoxmlPackage, partName: string, nodeId: string, paraId: string) {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const bound = withW14Binding(part);
  const target = findNode(bound.part, nodeId);
  if (!target || target.kind !== 'paragraph') return withPart(pkg, bound.part);
  const stamped = replaceNode(
    bound.part,
    target.id,
    element(
      target.id,
      'paragraph',
      target.namespaceUri,
      target.prefix ?? 'w',
      target.localName,
      [
        ...target.attributes.filter(
          (entry) => !(entry.namespaceUri === W14_NAMESPACE_URI && entry.localName === 'paraId')
        ),
        {
          kind: 'genericExtension' as const,
          namespaceUri: W14_NAMESPACE_URI,
          localName: 'paraId',
          prefix: bound.prefix,
          value: paraId,
        },
      ],
      target.children
    ),
    { deferValidation: true }
  );
  return withPart(pkg, stamped.ok ? stamped.part : bound.part);
}

/** `<w:comment>` with one paragraph of plain text, carrying a minted `w14:paraId`. */
function commentElement(
  commentId: string,
  paraId: string,
  request: AddCommentRequest,
  paraIdPrefix: string
): OoxmlElement {
  const base = `${COMMENTS_PART}#comment-${commentId}`;
  // `xml:space="preserve"` when the body has an edge space, which is what a conformant
  // reader is entitled to drop — Word writes the attribute for exactly this case. Omitted
  // otherwise, so an ordinary reply adds no attribute the file did not need.
  const preservesSpace = request.text !== request.text.trim();
  const text = element(
    `${base}.t`,
    'text',
    WML_NAMESPACE_URI,
    'w',
    't',
    preservesSpace
      ? [
          {
            kind: 'xmlSpace' as const,
            namespaceUri: XML_NAMESPACE_URI,
            localName: 'space' as const,
            prefix: 'xml' as const,
            value: 'preserve' as const,
          },
        ]
      : [],
    [{ id: `${base}.tv`, kind: 'textValue', value: request.text }]
  );
  // Word's own shape: the body carries `CommentText`, and the run carries
  // `CommentReference`. Without them a comment renders in body formatting and the pane loses
  // the styling every other editor gives it.
  const runProperties = element(
    `${base}.rPr`,
    'runProperties',
    WML_NAMESPACE_URI,
    'w',
    'rPr',
    [],
    [
      element(
        `${base}.rStyle`,
        'generic',
        WML_NAMESPACE_URI,
        'w',
        'rStyle',
        [wmlAttr('val', 'CommentReference')],
        []
      ),
    ]
  );
  const run = element(`${base}.r`, 'run', WML_NAMESPACE_URI, 'w', 'r', [], [runProperties, text]);
  const paragraphProperties = element(
    `${base}.pPr`,
    'paragraphProperties',
    WML_NAMESPACE_URI,
    'w',
    'pPr',
    [],
    [
      element(
        `${base}.pStyle`,
        'generic',
        WML_NAMESPACE_URI,
        'w',
        'pStyle',
        [wmlAttr('val', 'CommentText')],
        []
      ),
    ]
  );
  const paragraph = element(
    `${base}.p`,
    'paragraph',
    WML_NAMESPACE_URI,
    'w',
    'p',
    [
      {
        kind: 'genericExtension' as const,
        namespaceUri: W14_NAMESPACE_URI,
        localName: 'paraId',
        prefix: paraIdPrefix,
        value: paraId,
      },
    ],
    [paragraphProperties, run]
  );
  return element(
    base,
    'comment',
    WML_NAMESPACE_URI,
    'w',
    'comment',
    [
      wmlAttr('id', commentId),
      wmlAttr('author', request.author),
      ...(request.initials === undefined ? [] : [wmlAttr('initials', request.initials)]),
      ...(request.date === undefined ? [] : [wmlAttr('date', request.date)]),
    ],
    [paragraph]
  );
}

function emptyPart(name: string, xml: string): OoxmlElement | null {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  return parsed.ok ? parsed.part.root : null;
}

/**
 * Add a comment, or a reply, in ONE transaction.
 *
 * The comment id and the `w14:paraId` are computed before the transaction opens, because the
 * story markers have to carry the same id the body does and deriving each separately is how the
 * two come to disagree.
 *
 * `w14:paraId` is minted here and only here: on a comment WRITE. Allocating on load would
 * rewrite a document nobody edited and break fingerprint equality on an untouched round trip.
 */
export function addComment(store: TreeDocumentStore, request: AddCommentRequest): AddCommentResult {
  // `CT_TrackChange` makes `@w:author` required, so a comment without one is invalid XML.
  // Refusing here makes that state unrepresentable rather than repaired later.
  if (typeof request.author !== 'string' || request.author.length === 0) {
    return { ok: false, reason: 'invalid-author' };
  }

  const pkg = store.package;
  const storyPartName = store.part.name;
  const commentsName = commentsPartNameFor(pkg, storyPartName);
  const extendedName = extendedPartNameFor(pkg, storyPartName);
  const commentsPart = pkg.parts.get(commentsName);
  const commentId = nextCommentId(commentsPart);
  const paraId = mintParaId(`${commentsName}#${commentId}`, paraIdsInPackage(pkg));

  // A reply's parent needs a `w14:paraId`, because `w15:commentsEx` keys the thread by it and
  // guessing the parent by position is exactly what R7 refuses. Plenty of real files have
  // none — `w14:paraId` is an extension, and an export from another editor omits it — so one
  // is MINTED for the parent as part of this same transaction rather than refusing the reply.
  // That is a write during an edit, which is allowed; what is not allowed is stamping a
  // document nobody edited, and this touches only the comment being replied to.
  const existingParentParaId =
    request.replyToCommentId === undefined
      ? null
      : paraIdOfComment(commentsPart, request.replyToCommentId);
  const parentTarget =
    request.replyToCommentId !== undefined && existingParentParaId === null
      ? firstParagraphOfComment(commentsPart, request.replyToCommentId)
      : null;
  // A reply to a comment the part does not hold cannot be linked to anything.
  if (request.replyToCommentId !== undefined && existingParentParaId === null && !parentTarget) {
    return { ok: false, reason: 'unknown-revision' };
  }
  const mintedParentParaId = parentTarget
    ? mintParaId(
        `${commentsName}#parent-${request.replyToCommentId}`,
        new Set([...paraIdsInPackage(pkg), paraId])
      )
    : null;
  const parentParaId = existingParentParaId ?? mintedParentParaId;

  const endParagraphId = request.anchor.endParagraphId ?? request.anchor.paragraphId;

  const result = store.transact((ctx) => {
    // The comment part first, so the relationship the story needs already has a target.
    ctx.applyPackage((current) => {
      if (current.parts.has(commentsName)) return current;
      const root = emptyPart(commentsName, `<w:comments xmlns:w="${WML_NAMESPACE_URI}"/>`);
      if (!root) return current;
      const withCommentsPart = withNewPart(current, commentsName, root, COMMENTS_TYPE);
      return withRelationship(withCommentsPart, storyPartName, COMMENTS_REL, 'comments.xml').pkg;
    });

    if (parentTarget && mintedParentParaId) {
      ctx.applyPackage((current) =>
        withStampedParaId(current, commentsName, parentTarget.id, mintedParentParaId)
      );
    }

    ctx.applyPackage((current) => {
      const part = current.parts.get(commentsName);
      if (!part) return current;
      const bound = withW14Binding(part);
      const appended = insertChildren(
        bound.part,
        bound.part.root.id,
        bound.part.root.children.length,
        [commentElement(commentId, paraId, request, bound.prefix)],
        { deferValidation: true }
      );
      return appended.ok ? withPart(current, appended.part) : current;
    });

    // Thread state only when there is a thread. A file with no reply gains no sibling part,
    // which is what keeps an untouched round trip untouched.
    if (parentParaId !== null) {
      ctx.applyPackage((current) => {
        if (current.parts.has(extendedName)) return current;
        const root = emptyPart(extendedName, `<w15:commentsEx xmlns:w15="${W15_NAMESPACE_URI}"/>`);
        if (!root) return current;
        const withExtended = withNewPart(current, extendedName, root, COMMENTS_EXTENDED_TYPE);
        return withRelationship(
          withExtended,
          storyPartName,
          COMMENTS_EXTENDED_REL,
          'commentsExtended.xml'
        ).pkg;
      });

      ctx.applyPackage((current) => {
        const part = current.parts.get(extendedName);
        if (!part) return current;
        const entry = element(
          `${extendedName}#ex-${paraId}`,
          'generic',
          W15_NAMESPACE_URI,
          'w15',
          'commentEx',
          [
            {
              kind: 'genericExtension' as const,
              namespaceUri: W15_NAMESPACE_URI,
              localName: 'paraId',
              prefix: 'w15',
              value: paraId,
            },
            {
              kind: 'genericExtension' as const,
              namespaceUri: W15_NAMESPACE_URI,
              localName: 'paraIdParent',
              prefix: 'w15',
              value: parentParaId,
            },
            {
              kind: 'genericExtension' as const,
              namespaceUri: W15_NAMESPACE_URI,
              localName: 'done',
              prefix: 'w15',
              value: '0',
            },
          ],
          []
        );
        const appended = insertChildren(part, part.root.id, part.root.children.length, [entry], {
          deferValidation: true,
        });
        return appended.ok ? withPart(current, appended.part) : current;
      });
    }

    // The story markers last. The END goes in before the START when both are in one paragraph,
    // because inserting at the start would otherwise shift nothing — the markers occupy no
    // offsets — but the run split at the start reshapes the children the end index counts.
    ctx.applyTo(storyPartName, {
      op: 'insertCommentMarker',
      paragraphId: endParagraphId,
      offset: request.anchor.end,
      commentId,
      marker: 'end',
    });
    ctx.applyTo(storyPartName, {
      op: 'insertCommentMarker',
      paragraphId: endParagraphId,
      offset: request.anchor.end,
      commentId,
      marker: 'reference',
    });
    ctx.applyTo(storyPartName, {
      op: 'insertCommentMarker',
      paragraphId: request.anchor.paragraphId,
      offset: request.anchor.start,
      commentId,
      marker: 'start',
    });
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, commentId, change: result.change };
}

/** Whether resolving a thread applied. Marks the comment AND every reply to it, as Word does. */
export type SetCommentResolvedResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      /** The story transaction's change, for the coordinator to publish — see {@link AddCommentResult}. */
      readonly change: TreeModelChange | null;
    }
  | { readonly ok: false; readonly reason: TreeOpRejection | 'unknown-comment' };

/** Every `w15:commentEx` in the part, by the `w15:paraId` it records state for. */
function extendedEntries(part: OoxmlPart | undefined): Map<string, OoxmlElement> {
  const byParaId = new Map<string, OoxmlElement>();
  if (!part) return byParaId;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') {
      const paraId = attribute(node, W15_NAMESPACE_URI, 'paraId');
      if (paraId !== undefined && isValidParaId(paraId)) byParaId.set(paraId.toUpperCase(), node);
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return byParaId;
}

function w15Attr(localName: string, value: string): OoxmlElement['attributes'][number] {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: W15_NAMESPACE_URI,
    localName,
    prefix: 'w15',
    value,
  };
}

/**
 * A `w15:commentEx` for one comment, keeping the thread link it already recorded.
 *
 * The parent link is carried rather than rebuilt because it is the ONLY record of the thread:
 * dropping it while writing `@w15:done` would resolve a reply and promote it to a top-level
 * comment in the same edit.
 */
function resolvedEntry(
  id: string,
  paraId: string,
  parentParaId: string | undefined,
  done: boolean
): OoxmlElement {
  return element(
    id,
    'generic',
    W15_NAMESPACE_URI,
    'w15',
    'commentEx',
    [
      w15Attr('paraId', paraId),
      ...(parentParaId === undefined ? [] : [w15Attr('paraIdParent', parentParaId)]),
      w15Attr('done', done ? '1' : '0'),
    ],
    []
  );
}

/**
 * Mark a comment thread resolved, or reopen it.
 *
 * A THREAD, not one remark: Word resolves a conversation, and its own pane greys the replies with
 * the comment they answer. Resolving only the parent would leave a file whose reply still reads as
 * open under a closed remark — a state Word does not produce and no reader would draw sensibly.
 *
 * `@w15:done` lives in `commentsExtended.xml`, which many documents do not have: a file with no
 * reply has no thread state to record. So the part is created when it is missing, exactly as
 * {@link addComment} creates it, and every comment being resolved gets an entry — a comment with
 * no `w14:paraId` gets one minted, because the state is keyed by it and there is nothing else to
 * key it by.
 *
 * ONE package transaction: the part, its relationship, its content-type override and the entries
 * commit together, so a resolved thread is never half-recorded.
 */
export function setCommentResolved(
  store: TreeDocumentStore,
  commentId: string,
  resolved: boolean
): SetCommentResolvedResult {
  const pkg = store.package;
  const storyPartName = store.part.name;
  const commentsName = commentsPartNameFor(pkg, storyPartName);
  const extendedName = extendedPartNameFor(pkg, storyPartName);
  const commentsPart = pkg.parts.get(commentsName);
  if (!commentsPart) return { ok: false, reason: 'unknown-comment' };
  const target = firstParagraphOfComment(commentsPart, commentId);
  if (!target) return { ok: false, reason: 'unknown-comment' };

  // The thread: this comment, plus every comment whose recorded parent is it.
  const ownParaId = paraIdOfComment(commentsPart, commentId);
  const used = paraIdsInPackage(pkg);
  const mintedOwn = ownParaId ?? mintParaId(`${commentsName}#done-${commentId}`, used);
  const entries = extendedEntries(pkg.parts.get(extendedName));
  const replies: string[] = [];
  for (const [paraId, entry] of entries) {
    const parent = attribute(entry, W15_NAMESPACE_URI, 'paraIdParent');
    if (parent !== undefined && parent.toUpperCase() === mintedOwn.toUpperCase()) {
      replies.push(paraId);
    }
  }

  const result = store.transact((ctx) => {
    if (ownParaId === null) {
      ctx.applyPackage((current) => withStampedParaId(current, commentsName, target.id, mintedOwn));
    }

    ctx.applyPackage((current) => {
      if (current.parts.has(extendedName)) return current;
      const root = emptyPart(extendedName, `<w15:commentsEx xmlns:w15="${W15_NAMESPACE_URI}"/>`);
      if (!root) return current;
      const withExtended = withNewPart(current, extendedName, root, COMMENTS_EXTENDED_TYPE);
      return withRelationship(
        withExtended,
        storyPartName,
        COMMENTS_EXTENDED_REL,
        'commentsExtended.xml'
      ).pkg;
    });

    for (const paraId of [mintedOwn, ...replies]) {
      ctx.applyPackage((current) => {
        const part = current.parts.get(extendedName);
        if (!part) return current;
        const existing = extendedEntries(part).get(paraId.toUpperCase());
        const parent =
          existing === undefined
            ? undefined
            : attribute(existing, W15_NAMESPACE_URI, 'paraIdParent');
        const entry = resolvedEntry(
          existing?.id ?? `${extendedName}#done-${paraId}`,
          paraId,
          parent,
          resolved
        );
        const written = existing
          ? replaceNode(part, existing.id, entry, { deferValidation: true })
          : insertChildren(part, part.root.id, part.root.children.length, [entry], {
              deferValidation: true,
            });
        return written.ok ? withPart(current, written.part) : current;
      });
    }
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, changed: true, change: result.change };
}

/** A comment part exists and declares the comment content type. */
export function hasCommentPart(pkg: OoxmlPackage, storyPartName: string): boolean {
  const name = commentsPartNameFor(pkg, storyPartName);
  return pkg.parts.has(name) && resolveContentTypeOf(pkg, name) === COMMENTS_TYPE;
}

/** Exposed so a surface can tell "no comment part yet" from "no comments". */
export function commentPartNameOf(pkg: OoxmlPackage, storyPartName: string): string {
  return commentsPartNameFor(pkg, storyPartName);
}

/**
 * The `commentsExtended.xml` a story points at.
 *
 * Exported for the same reason as {@link commentPartNameOf}: the READER has to resolve the
 * same name the writer does. Hardcoding `/word/comments.xml` on one side and following the
 * relationship on the other is a split that shows up as a comment written and never read back.
 */
export function commentsExtendedPartNameOf(pkg: OoxmlPackage, storyPartName: string): string {
  return extendedPartNameFor(pkg, storyPartName);
}

/** Re-exported so callers do not re-derive the node lookup. */
export { findNode };
