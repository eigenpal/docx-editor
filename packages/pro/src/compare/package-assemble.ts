/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Builds the output package: the original package with the compared stories, new parts for
 * stories only the revised document has, and the relationships (and media) that content taken
 * from the revised document refers to.
 */
import {
  readOoxmlPackage,
  readOoxmlPart,
  resolveInternalTarget,
  relationshipsOf,
  relsPartNameFor,
  resolveContentTypeOf,
  serializeOoxmlPart,
  withBinaryPart,
  withContentTypeOverride,
  withPart,
  writeOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { DrawingIds } from './drawing-ids.ts';
import type { StoryOutput } from './stories.ts';
import { isPartNameTaken } from './related-parts.ts';
import { fromPlaceholder, MARK, REL_PLACEHOLDER } from './units.ts';
import { escapeAttribute, isElement, R_NS, type ElementNode } from './xml-fragments.ts';

const O_NS = 'urn:schemas-microsoft-com:office:office';

/**
 * Relationship ids the content of `owner` names, defined or not. A minted id never takes one,
 * so a reference to a missing relationship stays missing.
 */
function referencedRelationshipIds(pkg: OoxmlPackage, owner: string): string[] {
  const root = pkg.parts.get(owner)?.root;
  if (!root || !isElement(root)) return [];
  const out: string[] = [];
  const stack: ElementNode[] = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    for (const attribute of node.attributes) {
      if (
        attribute.namespaceUri === R_NS ||
        (attribute.namespaceUri === O_NS && attribute.localName === 'relid')
      )
        out.push(attribute.value);
    }
    for (const child of node.children) if (isElement(child)) stack.push(child);
  }
  return out;
}

const PLACEHOLDER = new RegExp(`${REL_PLACEHOLDER}([^§"|]+)\\|([^§"]+)§`, 'g');
const NEW_PART = new RegExp(`${MARK}NEW:([^§"]+)§`, 'g');
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

const UNTYPED_RELATIONSHIPS =
  'The original document declares no content type for relationship parts, which the compare result needs.';

/**
 * `pkg` with a relationship part, or null when nothing types it: a package may declare each
 * part's type by an override and omit the relationship default, and the package model writes
 * no override for a relationship part.
 */
function withRelationshipPart(pkg: OoxmlPackage, part: OoxmlPart): OoxmlPackage | null {
  const next = withPart(pkg, part);
  return resolveContentTypeOf(next, part.name) === null ? null : next;
}

export type AssembleResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly pkg: OoxmlPackage }
  | { readonly ok: false; readonly message: string };

interface Rel {
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function relationshipOf(pkg: OoxmlPackage, owner: string, id: string): Rel | null {
  const record = relationshipsOf(pkg, owner).find((entry) => entry.id === id);
  if (record)
    return {
      type: record.type,
      target: record.rawTarget,
      external: record.targetMode === 'External',
    };
  const external = pkg.externalTargets.find(
    (record) => record.ownerPart === owner && record.id === id
  );
  if (external) return { type: external.type, target: external.rawTarget, external: true };
  return null;
}

/**
 * The part name an internal target names from `owner`, decoded as the package reader decodes
 * it (percent escapes, dot segments), so lookups find the part the editor shows. Null when the
 * target is not a valid part name.
 */
function resolveTarget(owner: string, target: string): string | null {
  const resolved = resolveInternalTarget(owner, target);
  return resolved.ok ? resolved.partName : null;
}

/** Related parts a copied part may reach through its own relationships, in a chain. */
const MAX_COPY_DEPTH = 8;

/** Whether `pkg` already holds a part with this name. */
export function partExists(pkg: OoxmlPackage, name: string): boolean {
  return pkg.parts.has(name) || pkg.partBytes.has(name) || pkg.partBytes.has(name.slice(1));
}

/**
 * `xml` (a serialized relationships part) with `added` appended inside its root, whether the root
 * is written with an end tag or self-closed; null when the root is neither.
 */
function withRelationships(xml: string, added: readonly string[]): string | null {
  const entriesFor = (prefix: string) =>
    (prefix
      ? added.map((entry) => entry.replace('<Relationship ', `<${prefix}Relationship `))
      : added
    ).join('');
  const closed = /<\/((?:[\w.-]+:)?)Relationships>\s*$/;
  if (closed.test(xml))
    return xml.replace(
      closed,
      (_, prefix: string) => `${entriesFor(prefix)}</${prefix}Relationships>`
    );
  const empty = /<((?:[\w.-]+:)?)Relationships(\b[^>]*?)\s*\/>\s*$/;
  if (empty.test(xml))
    return xml.replace(
      empty,
      (_, prefix: string, attributes: string) =>
        `<${prefix}Relationships${attributes}>${entriesFor(prefix)}</${prefix}Relationships>`
    );
  return null;
}

/** Target of `part` written relative to `owner`'s folder. */
function relativeTarget(owner: string, part: string): string {
  const dir = owner.slice(0, owner.lastIndexOf('/') + 1);
  return part.startsWith(dir) ? part.slice(dir.length) : part;
}

/** Relationships to add, per owner part. */
class RelationshipPlan {
  readonly #added = new Map<string, string[]>();
  readonly #used = new Map<string, Set<string>>();
  #counter = 1;

  constructor(private readonly base: OoxmlPackage) {}

  add(owner: string, type: string, target: string, external: boolean): string {
    let used = this.#used.get(owner);
    if (!used) {
      used = new Set([
        ...relationshipsOf(this.base, owner).map((record) => record.id),
        ...this.base.externalTargets
          .filter((record) => record.ownerPart === owner)
          .map((record) => record.id),
        ...referencedRelationshipIds(this.base, owner),
      ]);
      this.#used.set(owner, used);
    }
    let id: string;
    do id = `rIdCmp${this.#counter++}`;
    while (used.has(id));
    used.add(id);
    const list = this.#added.get(owner) ?? [];
    list.push(
      `<Relationship Id="${id}" Type="${escapeAttribute(type)}" Target="${escapeAttribute(target)}"${external ? ' TargetMode="External"' : ''}/>`
    );
    this.#added.set(owner, list);
    return id;
  }

  entries(): IterableIterator<[string, string[]]> {
    return this.#added.entries();
  }
}

export function assemblePackage(
  base: OoxmlPackage,
  revised: OoxmlPackage,
  stories: readonly StoryOutput[]
): AssembleResult {
  let pkg = base;
  const plan = new RelationshipPlan(base);
  const main = base.mainDocumentPart;
  const newPartIds = new Map<string, string>();
  for (const story of stories) {
    if (story.isNew && story.relType) {
      newPartIds.set(
        story.partName,
        plan.add(main, story.relType, relativeTarget(main, story.partName), false)
      );
    }
  }
  const media = new Map<string, string>();
  let mediaCounter = 1;
  /**
   * Copies a revised part under a name the output does not use, with the parts its own
   * relationships reach (a chart's workbook), and returns the new name.
   */
  const copyPart = (source: string, depth: number): string | { failure: string } => {
    const known = media.get(source);
    if (known) return known;
    const bytes = revised.partBytes.get(source) ?? revised.partBytes.get(source.slice(1));
    if (!bytes) return { failure: `The revised document refers to a missing part (${source}).` };
    if (depth > MAX_COPY_DEPTH)
      return { failure: 'The revised document nests related parts too deeply.' };
    const extension = /\.[A-Za-z0-9]+$/.exec(source)?.[0] ?? '';
    let copied: string;
    do copied = `/word/media/compare${mediaCounter++}${extension}`;
    while (partExists(pkg, copied) || isPartNameTaken(base, copied));
    media.set(source, copied);
    pkg = withBinaryPart(
      pkg,
      copied,
      bytes,
      resolveContentTypeOf(revised, source) ?? 'application/octet-stream'
    );
    // An external relationship can appear in both lists; each id is written once.
    const byId = new Map<string, { type: string; target: string; external: boolean }>();
    for (const record of relationshipsOf(revised, source)) {
      byId.set(record.id, {
        type: record.type,
        target: record.rawTarget,
        external: record.targetMode === 'External',
      });
    }
    for (const record of revised.externalTargets) {
      if (record.ownerPart !== source || byId.has(record.id)) continue;
      byId.set(record.id, { type: record.type, target: record.rawTarget, external: true });
    }
    const own = [...byId].map(([id, rel]) => ({ id, ...rel }));
    if (own.length === 0) return copied;
    let entries = '';
    for (const rel of own) {
      let target = rel.target;
      if (!rel.external) {
        const resolved = resolveTarget(source, rel.target);
        if (resolved === null)
          return { failure: `The revised document has an invalid part name (${rel.target}).` };
        const inner = copyPart(resolved, depth + 1);
        if (typeof inner !== 'string') return inner;
        target = relativeTarget(copied, inner);
      }
      entries += `<Relationship Id="${escapeAttribute(rel.id)}" Type="${escapeAttribute(rel.type)}" Target="${escapeAttribute(target)}"${rel.external ? ' TargetMode="External"' : ''}/>`;
    }
    const relsName = relsPartNameFor(copied);
    const rels = readOoxmlPart(`<Relationships xmlns="${RELS_NS}">${entries}</Relationships>`, {
      name: relsName,
      contentType: RELS_CONTENT_TYPE,
    });
    if (!rels.ok) return { failure: `A relationship part is not valid XML (${rels.reason}).` };
    const typed = withRelationshipPart(pkg, rels.part);
    if (!typed) return { failure: UNTYPED_RELATIONSHIPS };
    pkg = typed;
    return copied;
  };
  const drawingIds = new DrawingIds(base, new Set(stories.map((story) => story.partName)));
  for (const story of stories) drawingIds.reserveWritten(story.xml);
  for (const story of stories) {
    const imported = new Map<string, string>();
    let failure: string | null = null;
    let xml = drawingIds.resolve(
      story.xml.replace(NEW_PART, (_, partName: string) => newPartIds.get(partName) ?? '')
    );
    xml = xml.replace(PLACEHOLDER, (_, owner: string, encodedId: string) => {
      const revisedOwner = fromPlaceholder(owner);
      const id = fromPlaceholder(encodedId);
      const key = `${revisedOwner}|${id}`;
      const known = imported.get(key);
      if (known) return known;
      const rel = relationshipOf(revised, revisedOwner, id);
      if (!rel) {
        // A reference that leads nowhere in the revised document stays as written, when the
        // id names nothing in the output part either: the output is no more broken than the
        // input. An id the output part uses for something else would point at that instead.
        if (relationshipOf(base, story.partName, id))
          failure = `The revised document refers to a missing relationship (${id}).`;
        return escapeAttribute(id);
      }
      let target = rel.target;
      if (!rel.external) {
        const resolved = resolveTarget(revisedOwner, rel.target);
        const copied =
          resolved === null
            ? { failure: `The revised document has an invalid part name (${rel.target}).` }
            : copyPart(resolved, 0);
        if (typeof copied !== 'string') {
          failure = copied.failure;
          return escapeAttribute(id);
        }
        target = relativeTarget(story.partName, copied);
      }
      const newId = plan.add(story.partName, rel.type, target, rel.external);
      imported.set(key, newId);
      return newId;
    });
    if (failure) return { ok: false, message: failure };
    const part = readOoxmlPart(xml, { name: story.partName, contentType: story.contentType });
    if (!part.ok)
      return { ok: false, message: `A compared story is not valid XML (${part.reason}).` };
    pkg = withPart(pkg, part.part);
    if (story.isNew) pkg = withContentTypeOverride(pkg, story.partName, story.contentType);
  }
  for (const [owner, added] of plan.entries()) {
    const relsName = relsPartNameFor(owner);
    const existing = pkg.parts.get(relsName);
    const relsXml = existing
      ? withRelationships(serializeOoxmlPart(existing), added)
      : `<Relationships xmlns="${RELS_NS}">${added.join('')}</Relationships>`;
    // Never write a reference whose relationship was not recorded.
    if (relsXml === null)
      return { ok: false, message: 'A relationship part has no root to add relationships to.' };
    const next = readOoxmlPart(relsXml, {
      name: relsName,
      contentType: existing?.contentType || RELS_CONTENT_TYPE,
    });
    if (!next.ok)
      return { ok: false, message: `A relationship part is not valid XML (${next.reason}).` };
    const typed = withRelationshipPart(pkg, next.part);
    if (!typed) return { ok: false, message: UNTYPED_RELATIONSHIPS };
    pkg = typed;
  }
  let bytes: Uint8Array;
  try {
    bytes = writeOoxmlPackage(pkg);
  } catch (error) {
    // The writer refuses what it cannot write (two names for one part); never throw past here.
    return {
      ok: false,
      message: `The compared package cannot be written (${(error as Error).message}).`,
    };
  }
  const check = readOoxmlPackage(bytes);
  if (!check.ok)
    return { ok: false, message: `The compared package does not read back (${check.reason}).` };
  return { ok: true, bytes, pkg: check.package };
}
