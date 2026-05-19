// Transform API Extractor's raw `.api.json` doc-model dump into a
// consumer-friendly JSON shape that a docs site (e.g. docx-editor-page)
// can render directly. The clean shape:
//
//   {
//     package: "@eigenpal/docx-editor-react",
//     subpath: "./hooks",
//     version: "1.0.0",
//     exports: [
//       {
//         name: "useAutoSave",
//         kind: "function" | "interface" | "class" | "type-alias" | ...
//         releaseTag: "public" | "beta" | "internal",
//         summary: "...",            // first paragraph of TSDoc
//         remarks: "...",            // @remarks block
//         examples: ["..."],         // each @example block, code only
//         deprecated: null | "...",  // @deprecated text
//         signature: "function useAutoSave(doc: Document, options?: UseAutoSaveOptions): UseAutoSaveReturn",
//         source: {                  // GitHub link, joined from a separate source index
//           path: "packages/react/src/hooks/useAutoSave.ts",
//           line: 42,
//           url: "https://github.com/.../blob/main/.../useAutoSave.ts#L42"
//         },
//         members: [...],            // interfaces/classes: nested members
//         parameters: [...],         // functions: { name, type, optional, description }
//         returns: { type, description }   // functions
//       }
//     ]
//   }
//
// Why our own transformer instead of TypeDoc?
// - Same source-of-truth as the API Extractor surface gate (`api:check`).
//   No second parser, no second set of bugs to chase.
// - We control the shape — site stays free to render however it wants.

import fs from 'node:fs';
import path from 'node:path';
import { TSDocParser, TSDocConfiguration, TSDocTagDefinition, TSDocTagSyntaxKind } from '@microsoft/tsdoc';

// ─── TSDoc parsing ────────────────────────────────────────────────────────

// API Extractor's TSDoc allows tags the standard config doesn't (@public,
// @internal, @beta, @packageDocumentation, etc.). Register them so the
// parser doesn't drop the surrounding doc comment when it sees an
// "unknown" tag. The shape of each tag matches the API Extractor
// `tsdoc.json` schema (modifier vs block vs inline).
const tsdocConfig = new TSDocConfiguration();
const CUSTOM_TAGS = [
  { tagName: '@alpha', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@beta', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@experimental', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@internal', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@override', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@public', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@packageDocumentation', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@readonly', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@sealed', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@virtual', syntaxKind: TSDocTagSyntaxKind.ModifierTag },
  { tagName: '@decorator', syntaxKind: TSDocTagSyntaxKind.BlockTag },
];
for (const t of CUSTOM_TAGS) {
  if (!tsdocConfig.tryGetTagDefinition(t.tagName)) {
    tsdocConfig.addTagDefinition(new TSDocTagDefinition(t));
  }
}
const tsdocParser = new TSDocParser(tsdocConfig);

// Track TSDoc node kinds we encounter but don't render. Logged once at
// program exit so a future @microsoft/tsdoc upgrade adding new node types
// is visible without breaking output.
const unhandledNodeKinds = new Set();
process.on('exit', () => {
  if (unhandledNodeKinds.size > 0) {
    console.warn(
      `[docs-model] unhandled TSDoc kinds skipped: ${[...unhandledNodeKinds].join(', ')}`
    );
  }
});

function renderDocNode(node) {
  if (!node) return '';
  let out = '';
  let recurse = true;
  switch (node.kind) {
    case 'PlainText':
      out += node.text;
      recurse = false;
      break;
    case 'SoftBreak':
      out += ' ';
      recurse = false;
      break;
    case 'CodeSpan':
      out += `\`${node.code}\``;
      recurse = false;
      break;
    case 'LinkTag': {
      // `{@link Target}` — Target is either a URL or a TSDoc declaration
      // reference. We surface the URL form as markdown and the declaration
      // form as the text plus its canonical reference so the docs site
      // can route the link.
      const url = node.urlDestination || '';
      const decl = node.codeDestination?.emitAsTsdoc?.() || '';
      const text = node.linkText || url || decl;
      if (url) out += `[${text}](${url})`;
      else if (decl) out += `[${text}](${decl})`;
      else out += text;
      recurse = false;
      break;
    }
    case 'InlineTag':
      // `{@inheritDoc Foo}` and other inline tags we don't expand.
      // Keep the literal so the docs site can render or skip.
      out += `{${node.tagName}${node.tagContent ? ' ' + node.tagContent : ''}}`;
      recurse = false;
      break;
    case 'FencedCode': {
      const code = node.code.endsWith('\n') ? node.code : node.code + '\n';
      out += `\n\`\`\`${node.language || ''}\n${code}\`\`\`\n`;
      recurse = false;
      break;
    }
    case 'EscapedText':
      out += node.decodedText;
      recurse = false;
      break;
    case 'Paragraph':
      // Walk children; a blank line is inserted by `Section` between
      // paragraphs (we don't add one here to avoid double-spacing).
      break;
    case 'Section':
      // A Section wraps multiple Paragraphs. Insert `\n\n` between them so
      // multi-paragraph remarks/summaries don't collapse into one block.
      if (node.getChildNodes) {
        const parts = [];
        for (const child of node.getChildNodes()) {
          parts.push(renderDocNode(child));
        }
        out += parts.filter((p) => p.length > 0).join('\n\n');
      }
      recurse = false;
      break;
    case 'HtmlStartTag':
    case 'HtmlEndTag':
      // Pass through HTML — the docs site renders markdown anyway.
      out += node.emitAsHtml ? node.emitAsHtml() : '';
      recurse = false;
      break;
    case 'BlockTag':
      // Block tag header (`@example`, `@remarks`). Skip — the caller has
      // already located the relevant block; this node represents the tag
      // marker itself, not the prose.
      recurse = false;
      break;
    case 'Excerpt':
      // The TSDoc parser wraps free-form text in Excerpt nodes when it
      // can't classify them more precisely. Walk children.
      break;
    default:
      unhandledNodeKinds.add(node.kind);
      break;
  }
  if (recurse && node.getChildNodes) {
    for (const child of node.getChildNodes()) {
      out += renderDocNode(child);
    }
  }
  return out;
}

function renderSection(section) {
  return section ? renderDocNode(section).trim() : '';
}

function parseDocComment(rawDocComment) {
  if (!rawDocComment) {
    return {
      summary: '',
      remarks: '',
      examples: [],
      deprecated: null,
      paramDescriptions: new Map(),
      returnsDescription: '',
    };
  }
  const ctx = tsdocParser.parseString(rawDocComment);
  const doc = ctx.docComment;

  const summary = renderSection(doc.summarySection);
  const remarks = doc.remarksBlock ? renderSection(doc.remarksBlock.content) : '';
  const examples = (doc.customBlocks || [])
    .filter((b) => b.blockTag.tagName === '@example')
    .map((b) => renderSection(b.content));
  // `deprecated` is either the explanation string from `@deprecated <text>`
  // or an empty string for the bare `@deprecated` modifier. Never `true`.
  // Stable shape: `string | null`.
  const deprecated = doc.deprecatedBlock
    ? renderSection(doc.deprecatedBlock.content) || ''
    : null;

  const paramDescriptions = new Map();
  for (const p of doc.params.blocks) {
    paramDescriptions.set(p.parameterName, renderSection(p.content));
  }
  const returnsDescription = doc.returnsBlock
    ? renderSection(doc.returnsBlock.content)
    : '';

  return { summary, remarks, examples, deprecated, paramDescriptions, returnsDescription };
}

// ─── Excerpt rendering ────────────────────────────────────────────────────

// Render the API Extractor `excerptTokens` array (a flat list of `Content`
// and `Reference` tokens spanning the entire declaration) back into a
// signature string, optionally a sliced range.
function renderExcerpt(tokens, range) {
  const slice = range
    ? tokens.slice(range.startIndex, range.endIndex)
    : tokens;
  return slice.map((t) => t.text).join('').trim();
}

// Same as `renderExcerpt` but also returns the canonical references the
// tokens point to. Consumers (e.g. the docs site) use this to link types
// to their own pages.
function renderExcerptWithRefs(tokens, range) {
  const slice = range ? tokens.slice(range.startIndex, range.endIndex) : tokens;
  const text = slice.map((t) => t.text).join('').trim();
  const refs = [];
  for (const t of slice) {
    if (t.kind === 'Reference' && t.canonicalReference) {
      refs.push({ text: t.text, ref: t.canonicalReference });
    }
  }
  return { text, refs };
}

// ─── Kind mapping ─────────────────────────────────────────────────────────

// API Extractor's `kind` enum is PascalCase; the clean JSON uses kebab.
function normalizeKind(kind) {
  const map = {
    Variable: 'variable',
    Function: 'function',
    Interface: 'interface',
    Class: 'class',
    TypeAlias: 'type-alias',
    Enum: 'enum',
    EnumMember: 'enum-member',
    Namespace: 'namespace',
    PropertySignature: 'property',
    Property: 'property',
    MethodSignature: 'method',
    Method: 'method',
    Constructor: 'constructor',
    ConstructSignature: 'construct-signature',
    CallSignature: 'call-signature',
    IndexSignature: 'index-signature',
  };
  return map[kind] || kind.toLowerCase();
}

function normalizeReleaseTag(tag) {
  return (tag || 'None').toLowerCase();
}

// ─── Member transformation ────────────────────────────────────────────────

function transformItem(item, sourceIndex, github) {
  const docs = parseDocComment(item.docComment || '');
  const tokens = item.excerptTokens || [];

  const out = {
    name: item.name,
    kind: normalizeKind(item.kind),
    releaseTag: normalizeReleaseTag(item.releaseTag),
    summary: docs.summary,
    remarks: docs.remarks || '',
    examples: docs.examples,
    deprecated: docs.deprecated,
    signature: renderExcerpt(tokens),
  };

  const source = sourceIndex.get(item.name);
  if (source) {
    out.source = {
      path: source.path,
      line: source.line,
      url: makeGithubUrl(source.path, source.line, github),
    };
  }

  // Function / Method / Constructor: parameters + return type
  if (item.parameters && item.parameters.length > 0) {
    out.parameters = item.parameters.map((p) => {
      const { text, refs } = renderExcerptWithRefs(tokens, p.parameterTypeTokenRange);
      return {
        name: p.parameterName,
        type: text,
        optional: Boolean(p.isOptional),
        description: docs.paramDescriptions.get(p.parameterName) || '',
        ...(refs.length ? { typeRefs: refs } : {}),
      };
    });
  }
  if (item.returnTypeTokenRange) {
    const { text, refs } = renderExcerptWithRefs(tokens, item.returnTypeTokenRange);
    if (text) {
      out.returns = {
        type: text,
        description: docs.returnsDescription,
        ...(refs.length ? { typeRefs: refs } : {}),
      };
    }
  }

  // TypeAlias body
  if (item.kind === 'TypeAlias' && item.typeTokenRange) {
    const { text, refs } = renderExcerptWithRefs(tokens, item.typeTokenRange);
    out.aliasOf = { type: text, ...(refs.length ? { typeRefs: refs } : {}) };
  }

  // Property: declared type. API Extractor uses `propertyTypeTokenRange`
  // for PropertySignature/Property; Variables use `variableTypeTokenRange`
  // instead (different field, handled in the next branch).
  if ((item.kind === 'PropertySignature' || item.kind === 'Property')
      && item.propertyTypeTokenRange) {
    const { text, refs } = renderExcerptWithRefs(tokens, item.propertyTypeTokenRange);
    out.type = text;
    if (refs.length) out.typeRefs = refs;
    out.optional = Boolean(item.isOptional);
  }
  if (item.kind === 'Variable' && item.variableTypeTokenRange) {
    const { text, refs } = renderExcerptWithRefs(tokens, item.variableTypeTokenRange);
    if (text) {
      out.type = text;
      if (refs.length) out.typeRefs = refs;
    }
  }

  // Nested members (interfaces, classes, namespaces, enums)
  if (Array.isArray(item.members) && item.members.length > 0) {
    out.members = item.members
      .map((m) => transformItem(m, sourceIndex, github))
      // Strip internal symbols and untagged ones. The contract is
      // `releaseTag: public | beta`. Anything missing a tag (`none`)
      // shouldn't have been on the public surface in the first place.
      .filter((m) => m.releaseTag !== 'internal' && m.releaseTag !== 'none');
  }

  return out;
}

// ─── GitHub URL ───────────────────────────────────────────────────────────

function makeGithubUrl(relPath, line, github) {
  const { repo, ref } = github;
  return `https://github.com/${repo}/blob/${ref}/${relPath}#L${line}`;
}

// ─── Top-level entry transform ────────────────────────────────────────────

export function transformApiPackageJson(rawJson, { sourceIndex, github, packageName, subpath, version, entryDocBlock }) {
  // The doc-model file always has a single Package as the root, with one
  // EntryPoint child whose `members` array is the public surface. The
  // EntryPoint may carry its own `docComment` if the entry barrel has a
  // `@packageDocumentation` block — but tsup strips file-head comments
  // from the dist `.d.ts`, so the caller can also pass `entryDocBlock`
  // (raw `/** … */` text recovered from source) as a fallback.
  const pkg = rawJson;
  if (pkg.kind !== 'Package') {
    throw new Error(`Expected root kind 'Package', got '${pkg.kind}'`);
  }
  const entryPoint = (pkg.members || []).find((m) => m.kind === 'EntryPoint');
  if (!entryPoint) {
    throw new Error(`No EntryPoint child found in package ${packageName}`);
  }

  const docCommentSource =
    entryPoint.docComment || pkg.docComment || entryDocBlock || '';
  const entryDocs = parseDocComment(docCommentSource);
  // Strip a leading `<scope>/<pkg>[/<subpath>]` line from the entry
  // summary. Our barrels start every `@packageDocumentation` block
  // with this header line; TSDoc reads the `@scope` as an unknown tag
  // and drops the `@`, leaving prose like `eigenpal/docx-editor-react/...`
  // in front of the real description. The package/subpath are already
  // structured fields below, so the line is duplicate noise.
  entryDocs.summary = entryDocs.summary
    .replace(/^[\w-]+\/[\w/-]+\s+/, '')
    .trim();
  const exports = (entryPoint.members || [])
    .map((m) => transformItem(m, sourceIndex, github))
    .filter((m) => m.releaseTag !== 'internal' && m.releaseTag !== 'none');

  return {
    _schemaVersion: 1,
    package: packageName,
    subpath,
    version,
    summary: entryDocs.summary,
    remarks: entryDocs.remarks || '',
    examples: entryDocs.examples,
    exports,
  };
}
