// Builds a review-heavy copy of examples/vite/public/sample.docx for profiling the
// comment / tracked-change derivations at scale.
//
// Two steps:
//   1. Inject review markup into the base body: 50 comments (10 of them replies, anchored
//      over exactly the parent's range, which is the Part 1 threading evidence) and 40
//      tracked changes (15 w:ins, 15 w:del, 5 delete+insert replacement pairs by one
//      author in one editing moment, so the queue folds each pair into one card).
//   2. Repeat the body N times, uniquifying per copy exactly like
//      create-sample-20x-fixture.mjs — bookmarks, anchors, drawing ids — plus comment ids
//      and revision ids, and duplicating word/comments.xml entries per copy so every
//      range marker still names a defined comment.
//
// At 20x the result holds ~1080 comments and ~800 tracked changes: the "long reviewed
// contract" shape where review derivation cost shows up.
//
// Usage: node scripts/create-review-20x-fixture.mjs [multiplier] [outPath]
// Default: 20x -> examples/vite/public/sample-review-20x.docx

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const multiplier = Number(process.argv[2] ?? 20);
const outPath = resolve(
  root,
  process.argv[3] ??
    (multiplier === 1
      ? 'examples/vite/public/sample-review.docx'
      : 'examples/vite/public/sample-review-20x.docx')
);
const srcPath = resolve(root, 'examples/vite/public/sample.docx');

const AUTHORS = ['Ada Reviewer', 'Ben Editor', 'Chris Legal', 'Dana PM'];
const COMMENT_TEXTS = [
  'Please double-check this figure against the appendix.',
  'Wording is ambiguous, suggest tightening the clause.',
  'Approved as written.',
  'This paragraph duplicates the section above, consider removing.',
  'Needs a citation for this claim.',
];
const REPLY_TEXTS = [
  'Agreed, will update in the next pass.',
  'Checked, the figure is correct.',
  'Done in the latest revision.',
];
const INSERT_TEXTS = [
  ' (as amended)',
  ' subject to the conditions below',
  ' effective immediately',
];

// Injected ids start clear of the sample's own comment ids (0-3) and of each other;
// copies then offset by copy*1,000,000 — above the sample's largest id family (the
// ~900,000 TOC bookmarks), so no copy's bumped id can collide with another copy's.
const COMMENT_ID_BASE = 1000;
const REVISION_ID_BASE = 5000;

const zip = unzipSync(readFileSync(srcPath));
const doc = strFromU8(zip['word/document.xml']);

const bodyOpen = doc.indexOf('<w:body>');
const bodyClose = doc.lastIndexOf('</w:body>');
if (bodyOpen === -1 || bodyClose === -1) throw new Error('no w:body');
const prefix = doc.slice(0, bodyOpen + '<w:body>'.length);
const body = doc.slice(bodyOpen + '<w:body>'.length, bodyClose);
const suffix = doc.slice(bodyClose);

const sectPrStart = body.lastIndexOf('<w:sectPr');
if (sectPrStart === -1) throw new Error('no trailing sectPr');
const finalSectPr = body.slice(sectPrStart);

// ── step 1: inject review markup into the base body ──────────────────────────────────

/** Comment entries to append to word/comments.xml, built alongside the body injection. */
const newComments = [];

function isoDate(minute) {
  return `2026-04-0${1 + (minute % 5)}T${String(9 + (minute % 8)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00Z`;
}

/**
 * The plan: which eligible paragraph (by index) gets which review markup.
 * Spread evenly so the review load is uniform across the document (and across pages).
 */
function buildPlan(eligibleCount) {
  const plan = new Map();
  const actions = [];
  for (let i = 0; i < 40; i++) actions.push({ kind: 'comment', reply: i % 4 === 3 }); // 40 anchors, 10 carry a reply
  for (let i = 0; i < 15; i++) actions.push({ kind: 'ins' });
  for (let i = 0; i < 15; i++) actions.push({ kind: 'del' });
  for (let i = 0; i < 5; i++) actions.push({ kind: 'replace' });
  const step = eligibleCount / actions.length;
  actions.forEach((action, index) => {
    let at = Math.floor(index * step);
    while (plan.has(at)) at++;
    plan.set(at, action);
  });
  return plan;
}

/** A paragraph a marker can safely wrap: has a text run, no fields/links/drawings/comments. */
function isEligible(paragraph) {
  return (
    paragraph.includes('<w:t') &&
    !paragraph.includes('<w:drawing') &&
    !paragraph.includes('<w:hyperlink') &&
    !paragraph.includes('commentRange') &&
    !paragraph.includes('<w:fldChar') &&
    !paragraph.includes('<w:instrText') &&
    !paragraph.includes('<w:ins') &&
    !paragraph.includes('<w:del')
  );
}

/** The first `<w:r>...</w:r>` that holds visible text, as [start, end) in the paragraph. */
function firstTextRun(paragraph) {
  const runPattern = /<w:r>[\s\S]*?<\/w:r>/g;
  let match;
  while ((match = runPattern.exec(paragraph)) !== null) {
    if (match[0].includes('<w:t')) return { start: match.index, end: match.index + match[0].length, xml: match[0] };
  }
  return null;
}

function toDeletedRun(runXml) {
  return runXml.replaceAll('<w:t>', '<w:delText>').replaceAll('<w:t ', '<w:delText ').replaceAll('</w:t>', '</w:delText>');
}

let commentSerial = 0;
let revisionSerial = 0;

function injectIntoParagraph(paragraph, action) {
  const run = firstTextRun(paragraph);
  if (!run) return paragraph;
  const before = paragraph.slice(0, run.start);
  const after = paragraph.slice(run.end);
  const author = AUTHORS[(commentSerial + revisionSerial) % AUTHORS.length];

  if (action.kind === 'comment') {
    const id = COMMENT_ID_BASE + commentSerial;
    const minute = commentSerial;
    commentSerial++;
    newComments.push({ id, author, date: isoDate(minute), text: COMMENT_TEXTS[id % COMMENT_TEXTS.length] });
    let starts = `<w:commentRangeStart w:id="${id}"/>`;
    let ends = `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
    if (action.reply) {
      // The reply anchors over EXACTLY the parent's characters — coincident ranges are the
      // Part 1 threading evidence the queue reads when no extension part states a parent.
      const replyId = COMMENT_ID_BASE + commentSerial;
      commentSerial++;
      newComments.push({
        id: replyId,
        author: AUTHORS[(id + 1) % AUTHORS.length],
        date: isoDate(minute + 2),
        text: REPLY_TEXTS[replyId % REPLY_TEXTS.length],
      });
      starts += `<w:commentRangeStart w:id="${replyId}"/>`;
      ends += `<w:commentRangeEnd w:id="${replyId}"/><w:r><w:commentReference w:id="${replyId}"/></w:r>`;
    }
    return before + starts + run.xml + ends + after;
  }

  const id = REVISION_ID_BASE + revisionSerial;
  const date = isoDate(revisionSerial * 7); // minutes apart, so unrelated edits never pair
  revisionSerial++;
  if (action.kind === 'ins') {
    return `${before}<w:ins w:id="${id}" w:author="${author}" w:date="${date}">${run.xml}</w:ins>${after}`;
  }
  if (action.kind === 'del') {
    return `${before}<w:del w:id="${id}" w:author="${author}" w:date="${date}">${toDeletedRun(run.xml)}</w:del>${after}`;
  }
  // replace: a deletion and an adjacent insertion by one author in one editing moment.
  const insId = REVISION_ID_BASE + revisionSerial;
  revisionSerial++;
  const insText = INSERT_TEXTS[id % INSERT_TEXTS.length];
  return (
    `${before}<w:del w:id="${id}" w:author="${author}" w:date="${date}">${toDeletedRun(run.xml)}</w:del>` +
    `<w:ins w:id="${insId}" w:author="${author}" w:date="${date}"><w:r><w:t xml:space="preserve">${insText}</w:t></w:r></w:ins>${after}`
  );
}

function injectReviewMarkup(chunk) {
  const paragraphs = chunk.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? [];
  const eligible = paragraphs.filter(isEligible).length;
  const plan = buildPlan(eligible);
  let eligibleIndex = 0;
  return chunk.replace(/<w:p>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!isEligible(paragraph)) return paragraph;
    const action = plan.get(eligibleIndex);
    eligibleIndex++;
    return action ? injectIntoParagraph(paragraph, action) : paragraph;
  });
}

const content = injectReviewMarkup(body.slice(0, sectPrStart));

// ── step 2: repeat, uniquifying per copy ──────────────────────────────────────────────

function uniquify(chunk, copy) {
  const offset = copy * 1000000;
  const bumpId = (_, a, id, b) => a + (Number(id) + offset) + b;
  return chunk
    .replace(/(<w:bookmark(?:Start|End)[^>]*w:id=")(\d+)(")/g, bumpId)
    .replace(/(<w:bookmarkStart[^>]*w:name=")([^"]+)(")/g, (_, a, name, b) => a + name + '_c' + copy + b)
    .replace(/(<w:hyperlink[^>]*w:anchor=")([^"]+)(")/g, (_, a, name, b) => a + name + '_c' + copy + b)
    .replace(/(<wp:docPr[^>]*id=")(\d+)(")/g, bumpId)
    .replace(/(<w:commentRange(?:Start|End)[^>]*w:id=")(\d+)(")/g, bumpId)
    .replace(/(<w:commentReference[^>]*w:id=")(\d+)(")/g, bumpId)
    .replace(/(<w:(?:ins|del) [^>]*w:id=")(\d+)(")/g, bumpId);
}

let repeated = content;
for (let copy = 1; copy < multiplier; copy++) repeated += uniquify(content, copy);

zip['word/document.xml'] = strToU8(prefix + repeated + finalSectPr + suffix);

// ── comments.xml: append injected comments, then duplicate every entry per copy ───────

const commentsXml = strFromU8(zip['word/comments.xml']);
const commentsClose = commentsXml.lastIndexOf('</w:comments>');
if (commentsClose === -1) throw new Error('no w:comments');

const injectedEntries = newComments
  .map(
    (comment) =>
      `<w:comment w:id="${comment.id}" w:author="${comment.author}" w:date="${comment.date}">` +
      `<w:p><w:r><w:t xml:space="preserve">${comment.text}</w:t></w:r></w:p></w:comment>`
  )
  .join('');

const baseComments = commentsXml.slice(0, commentsClose) + injectedEntries;
const commentEntries = (baseComments.match(/<w:comment [\s\S]*?<\/w:comment>/g) ?? []).join('');
let copiedEntries = '';
for (let copy = 1; copy < multiplier; copy++) {
  copiedEntries += commentEntries.replace(
    /(<w:comment [^>]*w:id=")(\d+)(")/g,
    (_, a, id, b) => a + (Number(id) + copy * 1000000) + b
  );
}
zip['word/comments.xml'] = strToU8(baseComments + copiedEntries + '</w:comments>');

writeFileSync(outPath, zipSync(zip, { level: 6 }));
const totalComments = (4 + newComments.length) * multiplier;
const totalRevisions = revisionSerial * multiplier;
console.log(
  `wrote ${outPath}: x${multiplier}, ${totalComments} comments, ${totalRevisions} tracked-change sites, ` +
    `document.xml ${((prefix.length + repeated.length + finalSectPr.length + suffix.length) / 1e6).toFixed(1)}MB`
);
