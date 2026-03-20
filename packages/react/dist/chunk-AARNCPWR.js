'use strict';
var chunkBUEMG4NW_js = require('./chunk-BUEMG4NW.js');
function v(s, t) {
  let a = chunkBUEMG4NW_js.b.getCommandHandler(t.type);
  if (a) return a(s, t);
  switch (t.type) {
    case 'insertText':
      return R(s, t);
    case 'replaceText':
      return E(s, t);
    case 'deleteText':
      return B(s, t);
    case 'formatText':
      return S(s, t);
    case 'formatParagraph':
      return V(s, t);
    case 'applyStyle':
      return $(s, t);
    case 'insertTable':
      return H(s, t);
    case 'insertImage':
      return A(s, t);
    case 'insertHyperlink':
      return F(s, t);
    case 'removeHyperlink':
      return j(s, t);
    case 'insertParagraphBreak':
      return T(s, t);
    case 'mergeParagraphs':
      return N(s, t);
    case 'splitParagraph':
      return M(s, t);
    case 'setVariable':
      return O(s, t);
    case 'applyVariables':
      return _(s, t);
    default:
      let r = t;
      throw new Error(`Unknown command type: ${r.type}`);
  }
}
function z(s, t) {
  return t.reduce((a, r) => v(a, r), s);
}
function h(s) {
  return JSON.parse(JSON.stringify(s));
}
function g(s, t) {
  let a = 0;
  for (let r = 0; r < s.content.length; r++)
    if (s.content[r].type === 'paragraph') {
      if (a === t) return r;
      a++;
    }
  return -1;
}
function I(s) {
  let t = '';
  for (let a of s.content)
    if (a.type === 'run') for (let r of a.content) r.type === 'text' && (t += r.text);
    else if (a.type === 'hyperlink') {
      for (let r of a.children)
        if (r.type === 'run') for (let e of r.content) e.type === 'text' && (t += e.text);
    }
  return t;
}
function b(s, t) {
  return { type: 'run', formatting: t, content: [{ type: 'text', text: s }] };
}
function C(s, t, a, r) {
  let e = [],
    o = 0,
    p = false;
  for (let n of s.content)
    if (n.type === 'run') {
      let c = n.content
          .filter((l) => l.type === 'text')
          .map((l) => l.text)
          .join(''),
        i = o,
        u = o + c.length;
      if (!p && t >= i && t <= u) {
        let l = t - i;
        (l > 0 && e.push({ ...n, content: [{ type: 'text', text: c.slice(0, l) }] }),
          e.push(b(a, r || n.formatting)),
          l < c.length && e.push({ ...n, content: [{ type: 'text', text: c.slice(l) }] }),
          (p = true));
      } else e.push(n);
      o = u;
    } else e.push(n);
  return (p || e.push(b(a, r)), e);
}
function y(s, t, a) {
  let r = [],
    e = 0;
  for (let o of s.content)
    if (o.type === 'run') {
      let p = o.content
          .filter((i) => i.type === 'text')
          .map((i) => i.text)
          .join(''),
        n = e,
        c = e + p.length;
      if (c <= t || n >= a) r.push(o);
      else {
        let i = '';
        (n < t && (i += p.slice(0, t - n)),
          c > a && (i += p.slice(a - n)),
          i.length > 0 && r.push({ ...o, content: [{ type: 'text', text: i }] }));
      }
      e = c;
    } else r.push(o);
  return r;
}
function D(s, t, a, r) {
  let e = [],
    o = 0;
  for (let p of s.content)
    if (p.type === 'run') {
      let n = p.content
          .filter((u) => u.type === 'text')
          .map((u) => u.text)
          .join(''),
        c = o,
        i = o + n.length;
      if (i <= t || c >= a) e.push(p);
      else if (c >= t && i <= a) e.push({ ...p, formatting: { ...p.formatting, ...r } });
      else {
        let u = Math.max(t, c),
          l = Math.min(a, i);
        (c < u && e.push({ ...p, content: [{ type: 'text', text: n.slice(0, u - c) }] }),
          e.push({
            ...p,
            formatting: { ...p.formatting, ...r },
            content: [{ type: 'text', text: n.slice(u - c, l - c) }],
          }),
          i > l && e.push({ ...p, content: [{ type: 'text', text: n.slice(l - c) }] }));
      }
      o = i;
    } else e.push(p);
  return e;
}
function R(s, t) {
  let a = h(s),
    r = a.package.document,
    e = g(r, t.position.paragraphIndex);
  if (e === -1) throw new Error(`Paragraph index ${t.position.paragraphIndex} not found`);
  let o = r.content[e];
  return ((o.content = C(o, t.position.offset, t.text, t.formatting)), a);
}
function E(s, t) {
  let a = h(s),
    r = a.package.document,
    { start: e, end: o } = t.range;
  if (e.paragraphIndex === o.paragraphIndex) {
    let p = g(r, e.paragraphIndex);
    if (p === -1) throw new Error(`Paragraph index ${e.paragraphIndex} not found`);
    let n = r.content[p];
    ((n.content = y(n, e.offset, o.offset)), (n.content = C(n, e.offset, t.text, t.formatting)));
  } else {
    let p = g(r, e.paragraphIndex),
      n = r.content[p],
      c = I(n);
    ((n.content = y(n, e.offset, c.length)), (n.content = C(n, e.offset, t.text, t.formatting)));
    let i = [];
    for (let u = e.paragraphIndex + 1; u <= o.paragraphIndex; u++) i.push(g(r, u));
    for (let u = i.length - 1; u >= 0; u--) i[u] !== -1 && r.content.splice(i[u], 1);
  }
  return a;
}
function B(s, t) {
  let a = h(s),
    r = a.package.document,
    { start: e, end: o } = t.range;
  if (e.paragraphIndex === o.paragraphIndex) {
    let p = g(r, e.paragraphIndex);
    if (p === -1) throw new Error(`Paragraph index ${e.paragraphIndex} not found`);
    let n = r.content[p];
    n.content = y(n, e.offset, o.offset);
  } else {
    let p = g(r, e.paragraphIndex),
      n = r.content[p],
      c = I(n);
    n.content = y(n, e.offset, c.length);
    let i = g(r, o.paragraphIndex),
      u = r.content[i];
    ((u.content = y(u, 0, o.offset)), n.content.push(...u.content));
    let l = [];
    for (let f = e.paragraphIndex + 1; f <= o.paragraphIndex; f++) l.push(g(r, f));
    for (let f = l.length - 1; f >= 0; f--) l[f] !== -1 && r.content.splice(l[f], 1);
  }
  return a;
}
function S(s, t) {
  let a = h(s),
    r = a.package.document,
    { start: e, end: o } = t.range;
  if (e.paragraphIndex === o.paragraphIndex) {
    let p = g(r, e.paragraphIndex);
    if (p === -1) throw new Error(`Paragraph index ${e.paragraphIndex} not found`);
    let n = r.content[p];
    n.content = D(n, e.offset, o.offset, t.formatting);
  } else
    for (let p = e.paragraphIndex; p <= o.paragraphIndex; p++) {
      let n = g(r, p);
      if (n === -1) continue;
      let c = r.content[n],
        i = I(c),
        u = 0,
        l = i.length;
      (p === e.paragraphIndex && (u = e.offset),
        p === o.paragraphIndex && (l = o.offset),
        (c.content = D(c, u, l, t.formatting)));
    }
  return a;
}
function V(s, t) {
  let a = h(s),
    r = a.package.document,
    e = g(r, t.paragraphIndex);
  if (e === -1) throw new Error(`Paragraph index ${t.paragraphIndex} not found`);
  let o = r.content[e];
  if (((o.formatting = { ...o.formatting, ...t.formatting }), 'numPr' in t.formatting)) {
    let p = t.formatting.numPr;
    if (p && p.numId !== void 0 && p.numId !== 0) {
      let n = p.ilvl ?? 0,
        c = p.numId === 1,
        i = c ? '\u2022' : '1.';
      if (a.package.numbering) {
        let u = a.package.numbering.nums.find((l) => l.numId === p.numId);
        if (u) {
          let l = a.package.numbering.abstractNums.find((f) => f.abstractNumId === u.abstractNumId);
          if (l) {
            let f = l.levels.find((x) => x.ilvl === n);
            f && (i = f.lvlText || i);
          }
        }
      }
      o.listRendering = { level: n, numId: p.numId, marker: i, isBullet: c };
    } else delete o.listRendering;
  }
  return a;
}
function $(s, t) {
  let a = h(s),
    r = a.package.document,
    e = g(r, t.paragraphIndex);
  if (e === -1) throw new Error(`Paragraph index ${t.paragraphIndex} not found`);
  let o = r.content[e];
  return ((o.formatting = { ...o.formatting, styleId: t.styleId }), a);
}
function H(s, t) {
  let a = h(s),
    r = a.package.document,
    e = [];
  for (let n = 0; n < t.rows; n++) {
    let c = [];
    for (let i = 0; i < t.columns; i++) {
      let u = t.data?.[n]?.[i] || '';
      c.push({ type: 'tableCell', content: [{ type: 'paragraph', content: u ? [b(u)] : [] }] });
    }
    e.push({
      type: 'tableRow',
      formatting: n === 0 && t.hasHeader ? { header: true } : void 0,
      cells: c,
    });
  }
  let o = { type: 'table', rows: e },
    p = g(r, t.position.paragraphIndex);
  return (p === -1 ? r.content.push(o) : r.content.splice(p + 1, 0, o), a);
}
function A(s, t) {
  let a = h(s),
    r = a.package.document,
    e = g(r, t.position.paragraphIndex);
  if (e === -1) throw new Error(`Paragraph index ${t.position.paragraphIndex} not found`);
  let o = r.content[e],
    n = {
      type: 'run',
      content: [
        {
          type: 'drawing',
          image: {
            type: 'image',
            rId: `rId_img_${Date.now()}`,
            src: t.src,
            alt: t.alt,
            size: { width: (t.width || 100) * 914400, height: (t.height || 100) * 914400 },
            wrap: { type: 'inline' },
          },
        },
      ],
    },
    c = C(o, t.position.offset, '', void 0),
    i = false,
    u = 0;
  for (let l = 0; l < c.length; l++) {
    let f = c[l];
    if (f.type === 'run') {
      let x = f.content
        .filter((d) => d.type === 'text')
        .map((d) => d.text)
        .join('');
      if (((u += x.length), !i && u >= t.position.offset)) {
        (c.splice(l + 1, 0, n), (i = true));
        break;
      }
    }
  }
  return (i || c.push(n), (o.content = c), a);
}
function F(s, t) {
  let a = h(s),
    r = a.package.document,
    { start: e, end: o } = t.range;
  if (e.paragraphIndex !== o.paragraphIndex)
    throw new Error('Hyperlinks cannot span multiple paragraphs');
  let p = g(r, e.paragraphIndex);
  if (p === -1) throw new Error(`Paragraph index ${e.paragraphIndex} not found`);
  let n = r.content[p],
    c = I(n),
    i = t.displayText || c.slice(e.offset, o.offset);
  n.content = y(n, e.offset, o.offset);
  let u = { type: 'hyperlink', href: t.url, tooltip: t.tooltip, children: [b(i)] },
    l = false,
    f = 0,
    x = [];
  for (let d of n.content)
    if (d.type === 'run') {
      let P = d.content
          .filter((m) => m.type === 'text')
          .map((m) => m.text)
          .join(''),
        w = f + P.length;
      if (!l && f <= e.offset && e.offset <= w) {
        let m = e.offset - f;
        (m > 0 && x.push({ ...d, content: [{ type: 'text', text: P.slice(0, m) }] }),
          x.push(u),
          m < P.length && x.push({ ...d, content: [{ type: 'text', text: P.slice(m) }] }),
          (l = true));
      } else x.push(d);
      f = w;
    } else x.push(d);
  return (l || x.push(u), (n.content = x), a);
}
function j(s, t) {
  let a = h(s),
    r = a.package.document,
    { start: e } = t.range,
    o = g(r, e.paragraphIndex);
  if (o === -1) throw new Error(`Paragraph index ${e.paragraphIndex} not found`);
  let p = r.content[o],
    n = [];
  for (let c of p.content)
    if (c.type === 'hyperlink') for (let i of c.children) i.type === 'run' && n.push(i);
    else n.push(c);
  return ((p.content = n), a);
}
function T(s, t) {
  let a = h(s),
    r = a.package.document,
    e = g(r, t.position.paragraphIndex);
  if (e === -1) throw new Error(`Paragraph index ${t.position.paragraphIndex} not found`);
  let o = r.content[e],
    p = I(o),
    n = y({ ...o, content: [...o.content] }, t.position.offset, p.length),
    c = y({ ...o, content: [...o.content] }, 0, t.position.offset);
  o.content = n;
  let i = { type: 'paragraph', formatting: o.formatting, content: c };
  return (r.content.splice(e + 1, 0, i), a);
}
function N(s, t) {
  let a = h(s),
    r = a.package.document,
    e = g(r, t.paragraphIndex);
  if (e === -1) throw new Error(`Paragraph index ${t.paragraphIndex} not found`);
  let o = r.content[e],
    p = [];
  for (let n = 1; n <= t.count; n++) {
    let c = g(r, t.paragraphIndex + n);
    if (c !== -1) {
      let i = r.content[c];
      (o.content.push(...i.content), p.push(c));
    }
  }
  for (let n = p.length - 1; n >= 0; n--) r.content.splice(p[n], 1);
  return a;
}
function M(s, t) {
  return T(s, { position: t.position });
}
function O(s, t) {
  let a = h(s);
  return (
    a.templateVariables || (a.templateVariables = []),
    a.templateVariables.includes(t.name) || a.templateVariables.push(t.name),
    a
  );
}
function _(s, t) {
  let a = h(s),
    r = a.package.document;
  function e(n) {
    for (let c of n.content)
      if (c.type === 'text')
        for (let [i, u] of Object.entries(t.values)) {
          let l = new RegExp(`\\{${i}\\}`, 'g');
          c.text = c.text.replace(l, u);
        }
  }
  function o(n) {
    for (let c of n.content)
      if (c.type === 'run') e(c);
      else if (c.type === 'hyperlink') for (let i of c.children) i.type === 'run' && e(i);
  }
  function p(n) {
    if (n.type === 'paragraph') o(n);
    else if (n.type === 'table')
      for (let c of n.rows) for (let i of c.cells) for (let u of i.content) p(u);
  }
  for (let n of r.content) p(n);
  return a;
}
exports.a = v;
exports.b = z;
