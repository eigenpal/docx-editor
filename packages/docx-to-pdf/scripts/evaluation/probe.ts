/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Eval protocol 1. Runs headless checks; never exercises browser input. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../../../core/src/store/package/ooxml-package.ts';
import {
  canonicalOoxmlFingerprint,
  type OoxmlNode,
  type OoxmlElement,
  type OoxmlPart,
} from '../../../core/src/store/package/ooxml-tree.ts';
import { semanticDigest } from '../../../core/src/store/package/ooxml-digest.ts';
import { TreeDocumentStore } from '../../../core/src/store/store/tree-store.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
} from '../../../core/src/layout/semantic-layout.ts';
import { createLayoutSession } from '../../../core/src/layout/layout-session.ts';

export interface ProbeCheck {
  id: string;
  level: 'L1' | 'L2' | 'L3';
  status: 'passed' | 'failed' | 'unsupported';
  reason?: string;
  firstDivergence?: {
    part: string;
    nodeId?: string;
    path: string;
    beforeHash?: string;
    afterHash?: string;
  };
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => hash(JSON.stringify(value));
const MARKER = ' EvalProbe ';

/** Hashes never include extracted text in the response. */
export function snapshot(pkg: OoxmlPackage): Map<string, string> {
  const result = new Map<string, string>();
  for (const [name, part] of [...pkg.parts].sort(([a], [b]) => a.localeCompare(b))) {
    result.set(`${name}:tree`, hash(canonicalOoxmlFingerprint(part)));
    result.set(`${name}:semantic`, jsonHash(semanticDigest([part])));
  }
  for (const [name, bytes] of pkg.partBytes) {
    if (!pkg.parts.has(name)) result.set(`${name}:binary`, hash(bytes));
  }
  for (const [name, relationships] of pkg.relationships) {
    result.set(
      `${name}:relationships`,
      jsonHash([...relationships].sort((a, b) => a.id.localeCompare(b.id)))
    );
  }
  result.set(':externalTargets', jsonHash(pkg.externalTargets));
  result.set(':mainDocumentPart', hash(pkg.mainDocumentPart));
  return result;
}

export function compareSnapshots(
  id: string,
  before: Map<string, string>,
  after: Map<string, string>
): ProbeCheck {
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (before.get(key) !== after.get(key)) {
      return {
        id,
        level: 'L1',
        status: 'failed',
        firstDivergence: {
          part: key.slice(0, key.lastIndexOf(':')).slice(0, 240),
          path: key.slice(0, 500),
          beforeHash: before.get(key),
          afterHash: after.get(key),
        },
      };
    }
  }
  return { id, level: 'L1', status: 'passed' };
}

function reopen(pkg: OoxmlPackage): OoxmlPackage {
  const parsed = readOoxmlPackage(writeOoxmlPackage(pkg));
  if (!parsed.ok) throw new Error(`reopen:${parsed.reason}`);
  return parsed.package;
}

function findParagraph(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  // Probe a plain paragraph only. Complex fields and revision ownership need other recipes.
  if (
    root.kind === 'paragraph' &&
    root.children.every(
      (child) =>
        child.kind === 'paragraphProperties' ||
        (child.kind === 'run' &&
          child.children.every((item) => item.kind === 'runProperties' || item.kind === 'text'))
    )
  )
    return root;
  for (const child of root.children) {
    const match = findParagraph(child);
    if (match) return match;
  }
  return undefined;
}

function textOf(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
}

function replaceNode(node: OoxmlElement, target: OoxmlElement): OoxmlElement {
  if (node.id === target.id) return target;
  return {
    ...node,
    children: node.children.map((child) =>
      child.kind === 'textValue' ? child : replaceNode(child, target)
    ),
  } as OoxmlElement;
}

/** Omit identities re-derived on reopen, but retain geometry, text, and source offsets. */
function geometry(pages: unknown): unknown {
  return JSON.parse(
    JSON.stringify(pages, (key, value) =>
      key === 'id' || key.endsWith('Id') || key.endsWith('Ids') || typeof value === 'function'
        ? undefined
        : value
    )
  );
}

function layoutDifference(before: unknown, after: unknown, path = 'pages'): string | undefined {
  if (Object.is(before, after)) return undefined;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return path;
  const a = before as Record<string, unknown>,
    b = after as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const difference = layoutDifference(a[key], b[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return undefined;
}

export function probe(bytes: Uint8Array, timeoutMs = 60_000) {
  const started = performance.now();
  const checks: ProbeCheck[] = [];
  const guard = () => {
    if (performance.now() - started > timeoutMs) throw new Error('probe-timeout');
  };
  const finish = () => {
    for (const id of [
      'open',
      'preservation',
      'edit-isolation',
      'edit-save-reopen',
      'undo',
      'incremental-layout',
    ]) {
      if (!checks.some((check) => check.id === id))
        checks.push({
          id,
          level: id === 'incremental-layout' ? 'L2' : 'L1',
          status: 'unsupported',
          reason: 'prerequisite-not-completed',
        });
    }
    return {
      protocol: 1,
      status: checks.some((check) => check.status === 'failed')
        ? 'failed'
        : checks.some((check) => check.id === 'open' && check.status === 'passed')
          ? checks.some((check) => check.id !== 'browser-input' && check.status === 'unsupported')
            ? 'partial'
            : 'passed'
          : 'unsupported',
      checks,
      scope: {
        browserInput: false,
        editRecipe: 'first-plain-paragraph-insert-v1',
        layout: 'body-only-fixed-metrics-consistency',
        productionFonts: false,
        timeout: 'cooperative-between-stages; parent must enforce process timeout',
      },
      timings: { totalMs: Math.round((performance.now() - started) * 100) / 100 },
    };
  };
  checks.push({
    id: 'browser-input',
    level: 'L3',
    status: 'unsupported',
    reason: 'headless-probe',
  });
  const parsed = readOoxmlPackage(bytes);
  if (!parsed.ok) {
    checks.push({ id: 'open', level: 'L1', status: 'unsupported', reason: parsed.reason });
    return finish();
  }
  checks.push({ id: 'open', level: 'L1', status: 'passed' });
  try {
    const original = snapshot(parsed.package);
    guard();
    checks.push(compareSnapshots('preservation', original, snapshot(reopen(parsed.package))));
    guard();
    const store = new TreeDocumentStore(parsed.package);
    const target = findParagraph(store.part.root);
    if (!target) {
      for (const id of ['edit-isolation', 'edit-save-reopen', 'undo', 'incremental-layout']) {
        checks.push({
          id,
          level: id === 'incremental-layout' ? 'L2' : 'L1',
          status: 'unsupported',
          reason: 'no-plain-paragraph',
        });
      }
      return finish();
    }
    const session = createLayoutSession();
    const options = { measurer: createFixedMeasurer(6, 14), displayMode: 'proposed' as const };
    let layoutError: string | undefined;
    try {
      layoutSemanticDocument(store.part, store.revision, { ...options, session });
    } catch (error) {
      layoutError = error instanceof Error ? error.name : 'layout-error';
    }
    guard();
    const edited = store.transact((tx) => {
      tx.apply({ op: 'insertText', paragraphId: target.id, offset: 0, text: MARKER });
    });
    if (!edited.ok) {
      for (const id of ['edit-isolation', 'edit-save-reopen', 'undo', 'incremental-layout']) {
        checks.push({
          id,
          level: id === 'incremental-layout' ? 'L2' : 'L1',
          status: 'unsupported',
          reason: `edit-refused:${edited.reason}`,
        });
      }
      return finish();
    }
    const updated = findById(store.part.root, target.id)!;
    const maskedPart: OoxmlPart = { ...store.part, root: replaceNode(store.part.root, target) };
    const masked = {
      ...store.package,
      parts: new Map(store.package.parts).set(store.part.name, maskedPart),
    };
    const isolation = compareSnapshots('edit-isolation', original, snapshot(masked));
    if (textOf(updated) !== MARKER + textOf(target)) {
      isolation.status = 'failed';
      isolation.firstDivergence = {
        part: store.part.name,
        nodeId: target.id,
        path: 'paragraph.text',
        beforeHash: hash(MARKER + textOf(target)),
        afterHash: hash(textOf(updated)),
      };
    }
    checks.push(isolation);
    guard();
    const reopened = reopen(store.package);
    checks.push(compareSnapshots('edit-save-reopen', snapshot(store.package), snapshot(reopened)));
    guard();
    if (layoutError)
      checks.push({
        id: 'incremental-layout',
        level: 'L2',
        status: 'unsupported',
        reason: layoutError,
      });
    else {
      try {
        const retained = geometry(
          layoutSemanticDocument(store.part, store.revision, { ...options, session }).pages
        );
        guard();
        const fresh = geometry(layoutSemanticDocument(store.part, store.revision, options).pages);
        const reopenedLayout = geometry(
          layoutSemanticDocument(reopened.parts.get(reopened.mainDocumentPart)!, 0, options).pages
        );
        const freshPath = layoutDifference(retained, fresh);
        const path = freshPath ?? layoutDifference(retained, reopenedLayout);
        checks.push({
          id: 'incremental-layout',
          level: 'L2',
          status: path ? 'failed' : 'passed',
          ...(path
            ? {
                firstDivergence: {
                  part: store.part.name,
                  nodeId: target.id,
                  path,
                  beforeHash: jsonHash(retained),
                  afterHash: jsonHash(freshPath ? fresh : reopenedLayout),
                },
              }
            : {}),
        });
      } catch (error) {
        checks.push({
          id: 'incremental-layout',
          level: 'L2',
          status: 'unsupported',
          reason: error instanceof Error ? error.name : 'layout-error',
        });
      }
    }
    guard();
    store.undo();
    checks.push(compareSnapshots('undo', original, snapshot(store.package)));
  } catch (error) {
    checks.push({
      id: 'probe-execution',
      level: 'L1',
      status: 'failed',
      reason:
        error instanceof Error && /^(probe-timeout|reopen:[a-z-]+)$/.test(error.message)
          ? error.message
          : error instanceof Error
            ? error.name
            : 'probe-error',
    });
  }
  return finish();
}

function findById(node: OoxmlNode, id: string): OoxmlNode | undefined {
  if (node.id === id) return node;
  if (node.kind !== 'textValue')
    for (const child of node.children) {
      const found = findById(child, id);
      if (found) return found;
    }
  return undefined;
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Expected input.docx output.json');
  const result = probe(new Uint8Array(await readFile(input)));
  await writeFile(output, JSON.stringify(result));
  process.stdout.write(`${JSON.stringify({ protocol: 1, status: result.status, output })}\n`);
}
