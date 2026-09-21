import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
async function tops(path, pageNo) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: false }).promise;
  const page = await pdf.getPage(pageNo);
  const h = page.view[3];
  const c = await page.getTextContent();
  const m = new Map();
  for (const it of c.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const y = Number((h - it.transform[5]).toFixed(4));
    if (!m.has(y)) m.set(y, '');
    m.set(y, (m.get(y) + it.str).slice(0, 34));
  }
  await pdf.destroy();
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}
const A = await tops(process.argv[2], Number(process.argv[4] ?? 1));
const B = await tops(process.argv[3], Number(process.argv[4] ?? 1));
console.log(`ours ${A.length} baselines, reference ${B.length}`);
for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
  const a = A[i], b = B[i];
  if (!a || !b) { console.log(`  ${i}  ${a?.[0] ?? '—'}  ${b?.[0] ?? '—'}  MISSING  ${(a ?? b)[1]}`); continue; }
  const d = Number((a[0] - b[0]).toFixed(4));
  console.log(`  ${String(i).padStart(3)} ${a[0].toFixed(3).padStart(9)} ${b[0].toFixed(3).padStart(9)} ${d.toFixed(3).padStart(7)}${Math.abs(d) > 0.01 ? '  <<<' : '     '} ${a[1].slice(0, 26)}`);
}
