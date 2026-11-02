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
  relationshipsOf,
  relsPartNameFor,
  resolveContentTypeOf,
  serializeOoxmlPart,
  withBinaryPart,
  withContentTypeOverride,
  withPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import type { StoryOutput } from './stories.ts';
import { REL_PLACEHOLDER } from './units.ts';
import { escapeAttribute } from './xml-fragments.ts';

const PLACEHOLDER = new RegExp(`${REL_PLACEHOLDER}([^§"|]+)\\|([^§"]+)§`, 'g');
const NEW_PART = /§NEW:([^§"]+)§/g;
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

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

function resolveTarget(owner: string, target: string): string {
  if (target.startsWith('/')) return target;
  const out = owner.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') out.pop();
    else if (piece !== '.' && piece !== '') out.push(piece);
  }
  const name = out.join('/');
  return name.startsWith('/') ? name : `/${name}`;
}

/** Related parts a copied part may reach through its own relationships, in a chain. */
const MAX_COPY_DEPTH = 8;

/** Whether `pkg` already holds a part with this name. */
export function partExists(pkg: OoxmlPackage, name: string): boolean {
  return pkg.parts.has(name) || pkg.partBytes.has(name) || pkg.partBytes.has(name.slice(1));
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
    while (partExists(pkg, copied));
    media.set(source, copied);
    pkg = withBinaryPart(
      pkg,
      copied,
      bytes,
      resolveContentTypeOf(revised, source) ?? 'application/octet-stream'
    );
    const own = [
      ...relationshipsOf(revised, source).map((record) => ({
        id: record.id,
        type: record.type,
        target: record.rawTarget,
        external: record.targetMode === 'External',
      })),
      ...revised.externalTargets
        .filter((record) => record.ownerPart === source)
        .map((record) => ({
          id: record.id,
          type: record.type,
          target: record.rawTarget,
          external: true,
        })),
    ];
    if (own.length === 0) return copied;
    let entries = '';
    for (const rel of own) {
      let target = rel.target;
      if (!rel.external) {
        const inner = copyPart(resolveTarget(source, rel.target), depth + 1);
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
    pkg = withPart(pkg, rels.part);
    return copied;
  };
  for (const story of stories) {
    const imported = new Map<string, string>();
    let failure: string | null = null;
    let xml = story.xml.replace(NEW_PART, (_, partName: string) => newPartIds.get(partName) ?? '');
    xml = xml.replace(PLACEHOLDER, (_, revisedOwner: string, id: string) => {
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
        return id;
      }
      let target = rel.target;
      if (!rel.external) {
        const copied = copyPart(resolveTarget(revisedOwner, rel.target), 0);
        if (typeof copied !== 'string') {
          failure = copied.failure;
          return id;
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
      ? serializeOoxmlPart(existing).replace(
          /<\/((?:[\w.-]+:)?)Relationships>\s*$/,
          (_, prefix: string) => {
            const entries = prefix
              ? added.map((entry) => entry.replace('<Relationship ', `<${prefix}Relationship `))
              : added;
            return `${entries.join('')}</${prefix}Relationships>`;
          }
        )
      : `<Relationships xmlns="${RELS_NS}">${added.join('')}</Relationships>`;
    const next = readOoxmlPart(relsXml, {
      name: relsName,
      contentType: existing?.contentType || RELS_CONTENT_TYPE,
    });
    if (!next.ok)
      return { ok: false, message: `A relationship part is not valid XML (${next.reason}).` };
    pkg = withPart(pkg, next.part);
  }
  const bytes = writeOoxmlPackage(pkg);
  const check = readOoxmlPackage(bytes);
  if (!check.ok)
    return { ok: false, message: `The compared package does not read back (${check.reason}).` };
  return { ok: true, bytes, pkg: check.package };
}
