/**
 * Builds the output package: the original package with the compared main story, plus the
 * relationships (and media) that content taken from the revised document refers to.
 */
import {
  readOoxmlPackage,
  readOoxmlPart,
  relationshipsOf,
  relsPartNameFor,
  resolveContentTypeOf,
  serializeOoxmlPart,
  withBinaryPart,
  withPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { REL_PLACEHOLDER } from './units.ts';
import { escapeAttribute } from './xml-fragments.ts';

const PLACEHOLDER = new RegExp(`${REL_PLACEHOLDER}([^§"]+)§`, 'g');
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

export type AssembleResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

interface RevisedRel {
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function revisedRelationship(pkg: OoxmlPackage, owner: string, id: string): RevisedRel | null {
  const internal = relationshipsOf(pkg, owner).find((record) => record.id === id);
  if (internal) return { type: internal.type, target: internal.rawTarget, external: false };
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
  return out.join('/').startsWith('/') ? out.join('/') : `/${out.join('/').replace(/^\//, '')}`;
}

export function assemblePackage(
  base: OoxmlPackage,
  revised: OoxmlPackage,
  documentXml: string
): AssembleResult {
  const owner = base.mainDocumentPart;
  const revisedOwner = revised.mainDocumentPart;
  const relsName = relsPartNameFor(owner);
  const used = new Set<string>([
    ...relationshipsOf(base, owner).map((record) => record.id),
    ...base.externalTargets
      .filter((record) => record.ownerPart === owner)
      .map((record) => record.id),
  ]);
  let pkg = base;
  let counter = 1;
  const freshId = () => {
    let id: string;
    do id = `rIdCmp${counter++}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  const mapping = new Map<string, string>();
  let added = '';
  let mediaCounter = 1;
  for (const match of documentXml.matchAll(PLACEHOLDER)) {
    const original = match[1]!;
    if (mapping.has(original)) continue;
    const rel = revisedRelationship(revised, revisedOwner, original);
    if (!rel)
      return {
        ok: false,
        message: `The revised document refers to a missing relationship (${original}).`,
      };
    const id = freshId();
    mapping.set(original, id);
    if (rel.external) {
      added += `<Relationship Id="${id}" Type="${escapeAttribute(rel.type)}" Target="${escapeAttribute(rel.target)}" TargetMode="External"/>`;
      continue;
    }
    const source = resolveTarget(revisedOwner, rel.target);
    const bytes = revised.partBytes.get(source) ?? revised.partBytes.get(source.slice(1));
    if (!bytes)
      return { ok: false, message: `The revised document refers to a missing part (${source}).` };
    const extension = /\.[A-Za-z0-9]+$/.exec(source)?.[0] ?? '';
    const name = `/word/media/compare${mediaCounter++}${extension}`;
    pkg = withBinaryPart(
      pkg,
      name,
      bytes,
      resolveContentTypeOf(revised, source) ?? 'application/octet-stream'
    );
    added += `<Relationship Id="${id}" Type="${escapeAttribute(rel.type)}" Target="${escapeAttribute(name.replace('/word/', ''))}"/>`;
  }
  const xml = documentXml.replace(PLACEHOLDER, (_, original: string) => mapping.get(original)!);
  const contentType =
    base.parts.get(owner)?.contentType ??
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
  const documentPart = readOoxmlPart(xml, { name: owner, contentType });
  if (!documentPart.ok)
    return { ok: false, message: `The compared story is not valid XML (${documentPart.reason}).` };
  pkg = withPart(pkg, documentPart.part);
  if (added) {
    const relsPart = base.parts.get(relsName);
    if (!relsPart) return { ok: false, message: 'The original document has no relationship part.' };
    const relsXml = serializeOoxmlPart(relsPart).replace(
      /<\/((?:[\w.-]+:)?)Relationships>\s*$/,
      (_, prefix: string) =>
        `${prefix ? added.replace(/<Relationship /g, `<${prefix}Relationship `) : added}</${prefix}Relationships>`
    );
    const next = readOoxmlPart(relsXml, {
      name: relsName,
      contentType: relsPart.contentType || RELS_CONTENT_TYPE,
    });
    if (!next.ok)
      return { ok: false, message: `The relationship part is not valid XML (${next.reason}).` };
    pkg = withPart(pkg, next.part);
  }
  const bytes = writeOoxmlPackage(pkg);
  const check = readOoxmlPackage(bytes);
  if (!check.ok)
    return { ok: false, message: `The compared package does not read back (${check.reason}).` };
  return { ok: true, bytes };
}
