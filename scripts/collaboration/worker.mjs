// Copied into each isolated installation. Never import workspace source here.
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { unzipSync } from 'fflate';
import { Awareness } from 'y-protocols/awareness';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  normalizeParagraphIdentity,
  TreePackageStore,
  canonicalOoxmlFingerprint,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import {
  createDocumentCollaboration,
  readCollaborationDocument,
  COLLABORATION_FORMAT_VERSION,
  DOCUMENT_COLLABORATION_VERSIONS,
  assertCollaborationFormatCompatibility,
  readCollaborationFormatVersion,
} from '@docx-editor.dev/pro/collaboration';

// Synthetic test identities must reproduce across processes and reruns. This shim
// is confined to this disposable worker; production cryptography is unchanged.
const cryptography = globalThis.crypto;
let entropySeed = 'fixture',
  entropyCounter = 0;
function deterministicBytes(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let offset = 0; offset < bytes.length; offset += 32) {
    const block = createHash('sha256').update(`${entropySeed}:${entropyCounter++}`).digest();
    bytes.set(block.subarray(0, Math.min(32, bytes.length - offset)), offset);
  }
  return array;
}
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {
    subtle: cryptography.subtle,
    getRandomValues: deterministicBytes,
    randomUUID: () => {
      const hex = Buffer.from(deterministicBytes(new Uint8Array(16))).toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
    },
  },
});

const encode = (bytes) => Buffer.from(bytes).toString('base64');
const decode = (str) => new Uint8Array(Buffer.from(str, 'base64'));
let doc, awareness, room, store, port, detach, roomId;
let updates = [];
function dispose() {
  detach?.();
  room?.destroy();
  awareness?.destroy();
  doc?.destroy();
  doc = awareness = room = store = port = detach = undefined;
}
function load(bytes) {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}
function nodes(root) {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}
function packageOf() {
  return store.currentPackage();
}
function resultOf(bytes) {
  const pkg = load(bytes);
  const parts = [...pkg.parts.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    binary: Object.entries(unzipSync(bytes))
      .filter(([name]) => !/\.(xml|rels)$/.test(name))
      .map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')])
      .sort(),
    fingerprint: parts.map((part) => [part.name, canonicalOoxmlFingerprint(part)]),
    digest: semanticDigest(parts),
    paragraphs: nodes(pkg.parts.get(pkg.mainDocumentPart).root)
      .filter((n) => n.kind === 'paragraph')
      .map((p) =>
        nodes(p)
          .filter((n) => n.kind === 'textValue')
          .map((n) => n.value)
          .join('')
      ),
  };
}
async function command(input) {
  switch (input.command) {
    case 'info':
      return { format: COLLABORATION_FORMAT_VERSION, versions: DOCUMENT_COLLABORATION_VERSIONS };
    case 'open': {
      dispose();
      updates = [];
      roomId = input.roomId;
      entropySeed = `${input.clientID}:${input.actor}`;
      entropyCounter = 0;
      doc = new Y.Doc();
      doc.clientID = input.clientID;
      awareness = new Awareness(doc);
      if (input.state) Y.applyUpdate(doc, decode(input.state), 'restore');
      room = await createDocumentCollaboration({
        ydoc: doc,
        awareness,
        documentId: roomId,
        identity: { actorId: input.actor, name: input.actor },
        offlineEditing: true,
        bootstrap: input.state
          ? { kind: 'join', timeoutMs: 1000 }
          : { kind: 'create', document: decode(input.document) },
      });
      const pkg = load(room.document);
      store = new TreePackageStore(
        pkg,
        normalizeParagraphIdentity(pkg.parts.get(pkg.mainDocumentPart))
      );
      port = createCollaborationDocumentPort(store, { documentId: roomId });
      detach = room.session.attach(port);
      doc.on('update', (update) => updates.push(encode(update)));
      return resultOf(room.document);
    }
    case 'edit': {
      const paragraphs = nodes(store.bodyStore().part.root).filter((n) => n.kind === 'paragraph');
      const op = { ...input.operation };
      if (op.op === 'joinParagraphs') {
        op.firstId = paragraphs[input.paragraph ?? 0].id;
        op.secondId = paragraphs[(input.paragraph ?? 0) + 1].id;
      } else op.paragraphId = paragraphs[input.paragraph ?? 0].id;
      const scope = { kind: 'body' };
      const refusal = room.session.gateOperations([op], scope);
      if (refusal) throw new Error(`Operation refused: ${refusal}`);
      const result = store.transact(scope, (context) => context.apply(op));
      if (!result.ok) throw new Error(result.detail ?? result.reason);
      port.flushPendingJournals();
      return true;
    }
    case 'undo':
    case 'redo': {
      const result = room.session[input.command]();
      port.flushPendingJournals();
      return result;
    }
    case 'drain': {
      const held = updates;
      updates = [];
      return held;
    }
    case 'apply': {
      // Model the admission boundary before any transport can apply bytes.
      assertCollaborationFormatCompatibility(input.format);
      if (input.roomId !== roomId) throw new Error('room-id-mismatch');
      Y.applyUpdate(doc, decode(input.update), 'relay');
      return true;
    }
    case 'state':
      return encode(Y.encodeStateAsUpdate(doc));
    case 'export': {
      const bytes = await readCollaborationDocument(doc);
      return { document: encode(bytes), ...resultOf(bytes) };
    }
    case 'snapshot':
      return resultOf(writeOoxmlPackage(packageOf()));
    case 'inspect': {
      const restored = new Y.Doc();
      Y.applyUpdate(restored, decode(input.state));
      const before = encode(Y.encodeStateAsUpdate(restored));
      let format, error;
      try {
        format = readCollaborationFormatVersion(restored);
        assertCollaborationFormatCompatibility(format);
      } catch (caught) {
        error = caught.code ?? caught.message;
      }
      const unchanged = before === encode(Y.encodeStateAsUpdate(restored));
      restored.destroy();
      return { format, error, unchanged };
    }
    case 'hash':
      return createHash('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex');
    case 'close':
      dispose();
      return true;
    default:
      throw new Error(`Unknown command ${input.command}`);
  }
}
for await (const line of createInterface({ input: process.stdin })) {
  const input = JSON.parse(line);
  try {
    process.stdout.write(JSON.stringify({ id: input.id, value: await command(input) }) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ id: input.id, error: error.stack ?? String(error) }) + '\n'
    );
  }
}
dispose();
