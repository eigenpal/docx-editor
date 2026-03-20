'use strict';
var chunkKEXZ6SYZ_js = require('./chunk-KEXZ6SYZ.js');
require('./chunk-QQ63M65M.js');
var chunkWSCNNBR6_js = require('./chunk-WSCNNBR6.js'),
  chunkEOTZWQND_js = require('./chunk-EOTZWQND.js'),
  chunkCTYOM6BE_js = require('./chunk-CTYOM6BE.js'),
  chunkPJVI53AH_js = require('./chunk-PJVI53AH.js'),
  chunkFVUGBRDD_js = require('./chunk-FVUGBRDD.js');
require('./chunk-QVPR2W5S.js');
var chunk5LKX24UR_js = require('./chunk-5LKX24UR.js'),
  chunk4VUZBV2S_js = require('./chunk-4VUZBV2S.js'),
  chunkWIRZTO37_js = require('./chunk-WIRZTO37.js'),
  chunkR2CVPAO4_js = require('./chunk-R2CVPAO4.js'),
  chunk2GSKZFWS_js = require('./chunk-2GSKZFWS.js'),
  chunkAARNCPWR_js = require('./chunk-AARNCPWR.js'),
  chunkZ2UPNKQW_js = require('./chunk-Z2UPNKQW.js'),
  chunkBUEMG4NW_js = require('./chunk-BUEMG4NW.js'),
  chunkSE5EN2QL_js = require('./chunk-SE5EN2QL.js');
(require('./chunk-USRMBYI6.js'), require('./chunk-H5NTJZO4.js'));
var ye = require('react'),
  prosemirrorState = require('prosemirror-state'),
  prosemirrorView = require('prosemirror-view'),
  jsxRuntime = require('react/jsx-runtime');
function _interopDefault(e) {
  return e && e.__esModule ? e : { default: e };
}
var ye__default = /*#__PURE__*/ _interopDefault(ye);
var Ra = /[\p{L}\p{N}''\-]/u,
  Aa = /\s/;
function M(e) {
  return !e || e.length === 0 ? false : Ra.test(e);
}
function K(e) {
  return !e || e.length === 0 ? false : Aa.test(e);
}
function R(e, t) {
  if (!e || e.length === 0) return [0, 0];
  t = Math.max(0, Math.min(t, e.length - 1));
  let o = e[t];
  if (K(o)) {
    let n = t,
      r = t;
    for (; n > 0 && K(e[n - 1]); ) n--;
    for (; r < e.length && K(e[r]); ) r++;
    return [n, r];
  }
  if (M(o)) {
    let n = t,
      r = t;
    for (; n > 0 && M(e[n - 1]); ) n--;
    for (; r < e.length && M(e[r]); ) r++;
    return [n, r];
  }
  return [t, t + 1];
}
function wa(e, t) {
  let [o, n] = R(e, t);
  return e.slice(o, n);
}
function Ia(e, t) {
  let [o, n] = R(e, t);
  return { word: e.slice(o, n), startIndex: o, endIndex: n };
}
function $() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return false;
  let t = e.getRangeAt(0),
    o = t.startContainer;
  if (o.nodeType === Node.TEXT_NODE) {
    let n = o.textContent || '',
      r = t.startOffset,
      [a, i] = R(n, r);
    if (i > a) return (t.setStart(o, a), t.setEnd(o, i), e.removeAllRanges(), e.addRange(t), true);
  }
  if (o.nodeType === Node.ELEMENT_NODE) {
    let n = o,
      r = q(n);
    if (r.length > 0) {
      let a = t.startOffset,
        i = null,
        l = a;
      if (a < n.childNodes.length) {
        let p = n.childNodes[a];
        if (p.nodeType === Node.TEXT_NODE) ((i = p), (l = 0));
        else if (p instanceof Element) {
          let d = q(p);
          d.length > 0 && ((i = d[0]), (l = 0));
        }
      }
      if ((!i && r.length > 0 && ((i = r[0]), (l = 0)), i)) {
        let p = i.textContent || '',
          [d, c] = R(p, l);
        if (c > d) {
          let u = document.createRange();
          return (u.setStart(i, d), u.setEnd(i, c), e.removeAllRanges(), e.addRange(u), true);
        }
      }
    }
  }
  return false;
}
function Na(e, t) {
  let o = window.getSelection();
  if (!o) return false;
  let n = e.textContent || '',
    [r, a] = R(n, t);
  if (a > r) {
    let i = document.createRange();
    return (i.setStart(e, r), i.setEnd(e, a), o.removeAllRanges(), o.addRange(i), true);
  }
  return false;
}
function Oa() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return false;
  let t = e.getRangeAt(0);
  if (t.collapsed) return $();
  let o = t.startContainer,
    n = t.endContainer,
    r = t.startOffset,
    a = t.endOffset;
  if (o.nodeType === Node.TEXT_NODE) {
    let i = o.textContent || '',
      [l] = R(i, t.startOffset);
    r = l;
  }
  if (n.nodeType === Node.TEXT_NODE) {
    let i = n.textContent || '',
      l = Math.max(0, t.endOffset - 1),
      [, p] = R(i, l);
    a = p;
  }
  try {
    return (t.setStart(o, r), t.setEnd(n, a), e.removeAllRanges(), e.addRange(t), !0);
  } catch (i) {
    return (console.warn('Could not expand selection to word boundaries:', i), false);
  }
}
function J() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return false;
  let o = e.getRangeAt(0).commonAncestorContainer,
    n = Da(o);
  if (n) {
    let r = document.createRange();
    return (r.selectNodeContents(n), e.removeAllRanges(), e.addRange(r), true);
  }
  return false;
}
function Da(e) {
  if (!e) return null;
  let t = e;
  for (; t; ) {
    if (t instanceof Element && t.hasAttribute('data-paragraph-index')) return t;
    t = t.parentNode;
  }
  return null;
}
function q(e) {
  let t = [],
    o = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, null),
    n;
  for (; (n = o.nextNode()); ) n.nodeType === Node.TEXT_NODE && t.push(n);
  return t;
}
var V = 0,
  O = null,
  G = null,
  La = 500;
function j() {
  ((V = 0), (G = null), O && (clearTimeout(O), (O = null)));
}
function Q(e) {
  return (
    e.target !== G && j(),
    V++,
    (G = e.target),
    O && clearTimeout(O),
    (O = setTimeout(j, La)),
    Math.min(V, 3)
  );
}
function ka() {
  return (e) => {
    e.ctrlKey || e.metaKey || e.altKey || $();
  };
}
function Ma() {
  return (e) => {
    if (Q(e) === 3) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      J();
    }
  };
}
function P(e) {
  return e ? /[\p{L}\p{N}_]/u.test(e) : false;
}
function Y(e) {
  return e ? /\s/.test(e) : false;
}
function Ka(e) {
  return e ? /[\p{P}]/u.test(e) : false;
}
function Ha(e, t) {
  if (t <= 0) return 0;
  t > e.length && (t = e.length);
  let o = t;
  for (; o > 0 && Y(e[o - 1]); ) o--;
  if (o === 0) return 0;
  for (; o > 0 && P(e[o - 1]); ) o--;
  return o;
}
function _a(e, t) {
  if (t >= e.length) return e.length;
  t < 0 && (t = 0);
  let o = t;
  for (; o < e.length && P(e[o]); ) o++;
  for (; o < e.length && Y(e[o]); ) o++;
  return o;
}
function ee(e, t) {
  if (t >= e.length) return e.length;
  let o = t;
  for (; o < e.length && P(e[o]); ) o++;
  for (; o < e.length && !P(e[o]); ) o++;
  return o;
}
function te(e, t) {
  if (t <= 0) return 0;
  let o = t;
  for (; o > 0 && !P(e[o - 1]); ) o--;
  for (; o > 0 && P(e[o - 1]); ) o--;
  return o;
}
function oe(e, t) {
  if (!window.getSelection()) return null;
  let n = document.createRange();
  if (e.nodeType === Node.TEXT_NODE) {
    (n.setStart(e, Math.min(t, e.textContent?.length || 0)), n.collapse(true));
    let a = n.getBoundingClientRect().top,
      i = 0,
      l = t;
    for (; i < l; ) {
      let p = Math.floor((i + l) / 2);
      (n.setStart(e, p), n.collapse(true));
      let d = n.getBoundingClientRect();
      Math.abs(d.top - a) < 2 ? (l = p) : (i = p + 1);
    }
    return { node: e, offset: i };
  }
  return null;
}
function ne(e, t) {
  if (!window.getSelection()) return null;
  let n = e.textContent?.length || 0,
    r = document.createRange();
  if (e.nodeType === Node.TEXT_NODE) {
    (r.setStart(e, Math.min(t, n)), r.collapse(true));
    let i = r.getBoundingClientRect().top,
      l = t,
      p = n;
    for (; l < p; ) {
      let d = Math.ceil((l + p) / 2);
      (r.setStart(e, d), r.collapse(true));
      let c = r.getBoundingClientRect();
      Math.abs(c.top - i) < 2 ? (l = d) : (p = d - 1);
    }
    return { node: e, offset: l };
  }
  return null;
}
function Ba() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return null;
  let t = e.getRangeAt(0);
  return {
    node: t.startContainer,
    offset: t.startOffset,
    anchorNode: e.anchorNode,
    anchorOffset: e.anchorOffset,
    focusNode: e.focusNode,
    focusOffset: e.focusOffset,
    isCollapsed: e.isCollapsed,
    text: e.toString(),
  };
}
function H(e, t) {
  let o = window.getSelection();
  if (!o) return;
  let n = document.createRange(),
    r = e.nodeType === Node.TEXT_NODE ? e.textContent?.length || 0 : e.childNodes.length;
  (n.setStart(e, Math.min(t, r)), n.collapse(true), o.removeAllRanges(), o.addRange(n));
}
function _(e, t) {
  let o = window.getSelection();
  if (!(!o || !o.anchorNode))
    try {
      o.extend(e, Math.min(t, e.textContent?.length || 0));
    } catch {
      let n = e.nodeType === Node.TEXT_NODE ? e.textContent?.length || 0 : e.childNodes.length;
      o.setBaseAndExtent(o.anchorNode, o.anchorOffset, e, Math.min(t, n));
    }
}
function re(e, t = false) {
  let o = window.getSelection();
  if (!o || o.rangeCount === 0) return false;
  let n = o.focusNode;
  if (!n || n.nodeType !== Node.TEXT_NODE) return false;
  let r = n.textContent || '',
    a = o.focusOffset,
    i;
  return (e === 'left' ? (i = te(r, a)) : (i = ee(r, a)), t ? _(n, i) : H(n, i), true);
}
function ae(e, t = false) {
  let o = window.getSelection();
  if (!o || o.rangeCount === 0) return false;
  let n = o.focusNode;
  if (!n) return false;
  if (n.nodeType === Node.TEXT_NODE) {
    let i = e === 'start' ? oe(n, o.focusOffset) : ne(n, o.focusOffset);
    if (i) return (t ? _(i.node, i.offset) : H(i.node, i.offset), true);
  }
  let r = n.textContent || '',
    a = e === 'start' ? 0 : r.length;
  return (t ? _(n, a) : H(n, a), true);
}
function ie(e) {
  let { key: t, ctrlKey: o, metaKey: n, shiftKey: r, altKey: a } = e,
    i = o || n;
  switch (t) {
    case 'ArrowLeft':
      if (i) return { direction: 'left', unit: 'word', extend: r };
      break;
    case 'ArrowRight':
      if (i) return { direction: 'right', unit: 'word', extend: r };
      break;
    case 'Home':
      return i
        ? { direction: 'left', unit: 'document', extend: r }
        : { direction: 'left', unit: 'line', extend: r };
    case 'End':
      return i
        ? { direction: 'right', unit: 'document', extend: r }
        : { direction: 'right', unit: 'line', extend: r };
  }
  return null;
}
function Wa(e, t) {
  let o = ie(e);
  if (!o) return false;
  switch (o.unit) {
    case 'word':
      if ((o.direction === 'left' || o.direction === 'right') && re(o.direction, o.extend))
        return (e.preventDefault(), true);
      break;
    case 'line':
      let n = o.direction === 'left' ? 'start' : 'end';
      if (ae(n, o.extend)) return (e.preventDefault(), true);
      break;
    case 'document':
      if (o.direction === 'left' && t?.onDocumentStart)
        return (e.preventDefault(), t.onDocumentStart(), true);
      if (o.direction === 'right' && t?.onDocumentEnd)
        return (e.preventDefault(), t.onDocumentEnd(), true);
      break;
  }
  return false;
}
function Fa(e) {
  let { key: t, ctrlKey: o, metaKey: n } = e;
  return !!(((o || n) && (t === 'ArrowLeft' || t === 'ArrowRight')) || t === 'Home' || t === 'End');
}
function Ua() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return false;
  let t = e.focusNode;
  if (!t || t.nodeType !== Node.TEXT_NODE) return false;
  let o = t.textContent || '',
    n = e.focusOffset,
    r = n,
    a = n;
  for (; r > 0 && P(o[r - 1]); ) r--;
  for (; a < o.length && P(o[a]); ) a++;
  if (r === a) return false;
  let i = document.createRange();
  return (i.setStart(t, r), i.setEnd(t, a), e.removeAllRanges(), e.addRange(i), true);
}
function za() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return null;
  let t = e.focusNode;
  if (!t || t.nodeType !== Node.TEXT_NODE) return null;
  let o = t.textContent || '',
    n = e.focusOffset,
    r = n,
    a = n;
  for (; r > 0 && P(o[r - 1]); ) r--;
  for (; a < o.length && P(o[a]); ) a++;
  return r === a ? null : o.slice(r, a);
}
function Va(e, t) {
  let o = e.ctrlKey || e.metaKey,
    n = t.ctrlKey || t.metaKey;
  return (
    e.key.toLowerCase() === t.key.toLowerCase() &&
    o === !!n &&
    e.shiftKey === !!t.shiftKey &&
    e.altKey === !!t.altKey
  );
}
var T = {
  wordLeft: { key: 'ArrowLeft', ctrlKey: true },
  wordRight: { key: 'ArrowRight', ctrlKey: true },
  selectWordLeft: { key: 'ArrowLeft', ctrlKey: true, shiftKey: true },
  selectWordRight: { key: 'ArrowRight', ctrlKey: true, shiftKey: true },
  lineStart: { key: 'Home' },
  lineEnd: { key: 'End' },
  selectToLineStart: { key: 'Home', shiftKey: true },
  selectToLineEnd: { key: 'End', shiftKey: true },
  documentStart: { key: 'Home', ctrlKey: true },
  documentEnd: { key: 'End', ctrlKey: true },
  selectToDocumentStart: { key: 'Home', ctrlKey: true, shiftKey: true },
  selectToDocumentEnd: { key: 'End', ctrlKey: true, shiftKey: true },
};
function S(e) {
  let t = [];
  if (e.ctrlKey || e.metaKey) {
    let n = typeof navigator < 'u' && /Mac/i.test(navigator.platform);
    t.push(n ? '\u2318' : 'Ctrl');
  }
  (e.shiftKey && t.push('Shift'), e.altKey && t.push('Alt'));
  let o = e.key;
  return (
    o === 'ArrowLeft'
      ? (o = '\u2190')
      : o === 'ArrowRight'
        ? (o = '\u2192')
        : o === 'ArrowUp'
          ? (o = '\u2191')
          : o === 'ArrowDown' && (o = '\u2193'),
    t.push(o),
    t.join('+')
  );
}
function Ga() {
  return [
    { action: 'Move by word (left)', shortcut: S(T.wordLeft) },
    { action: 'Move by word (right)', shortcut: S(T.wordRight) },
    { action: 'Select word (left)', shortcut: S(T.selectWordLeft) },
    { action: 'Select word (right)', shortcut: S(T.selectWordRight) },
    { action: 'Go to line start', shortcut: S(T.lineStart) },
    { action: 'Go to line end', shortcut: S(T.lineEnd) },
    { action: 'Select to line start', shortcut: S(T.selectToLineStart) },
    { action: 'Select to line end', shortcut: S(T.selectToLineEnd) },
    { action: 'Go to document start', shortcut: S(T.documentStart) },
    { action: 'Go to document end', shortcut: S(T.documentEnd) },
    { action: 'Select to document start', shortcut: S(T.selectToDocumentStart) },
    { action: 'Select to document end', shortcut: S(T.selectToDocumentEnd) },
  ];
}
var se = /\{([#/^@]?)([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\}/g,
  m = new prosemirrorState.PluginKey('template');
function Xa(e, t, o) {
  return `${e}:${t}:${o}`;
}
function le(e) {
  let t = [];
  e.descendants((p, d) => (p.isText && p.text && t.push({ text: p.text, pos: d }), true));
  let o = '',
    n = [];
  for (let p of t) {
    for (let d = 0; d < p.text.length; d++) n.push(p.pos + d);
    o += p.text;
  }
  let r = [],
    a = [],
    i = new Map(),
    l;
  for (se.lastIndex = 0; (l = se.exec(o)) !== null; ) {
    let [p, d, c] = l,
      u = n[l.index],
      x = n[l.index + p.length - 1] + 1,
      g;
    d === '#'
      ? (g = 'sectionStart')
      : d === '/'
        ? (g = 'sectionEnd')
        : d === '^'
          ? (g = 'invertedStart')
          : d === '@'
            ? (g = 'raw')
            : (g = 'variable');
    let b = `${g}:${c}`,
      k = i.get(b) ?? 0;
    i.set(b, k + 1);
    let w = { id: Xa(g, c, k), type: g, name: c, rawTag: p, from: u, to: x };
    if (g === 'sectionStart' || g === 'invertedStart') ((w.nestedVars = []), a.push(w));
    else if (g === 'sectionEnd') {
      for (let s = a.length - 1; s >= 0; s--)
        if (a[s].name === c) {
          a.splice(s, 1);
          break;
        }
    } else
      g === 'variable' &&
        a.length > 0 &&
        (a[a.length - 1].nestedVars?.push(c), (w.insideSection = true));
    r.push(w);
  }
  return r;
}
function qa(e) {
  switch (e) {
    case 'sectionStart':
    case 'sectionEnd':
      return '#3b82f6';
    case 'invertedStart':
      return '#8b5cf6';
    case 'raw':
      return '#ef4444';
    default:
      return '#f59e0b';
  }
}
function Z(e, t, o, n) {
  let r = [];
  for (let a of t) {
    let i = a.id === o,
      l = a.id === n,
      p = qa(a.type),
      d = ['docx-template-tag'];
    (i && d.push('hovered'),
      l && d.push('selected'),
      r.push(
        prosemirrorView.Decoration.inline(a.from, a.to, {
          class: d.join(' '),
          'data-tag-id': a.id,
          style: `background-color: ${p}22; border-radius: 2px;`,
        })
      ));
  }
  return prosemirrorView.DecorationSet.create(e, r);
}
function ja(e, t) {
  if (e.length !== t.length) return false;
  for (let o = 0; o < e.length; o++) if (e[o].id !== t[o].id) return false;
  return true;
}
function B() {
  return new prosemirrorState.Plugin({
    key: m,
    state: {
      init(e, t) {
        let o = le(t.doc);
        return { tags: o, decorations: Z(t.doc, o) };
      },
      apply(e, t, o, n) {
        if (e.docChanged) {
          let a = le(n.doc),
            i = ja(t.tags, a);
          return {
            tags: a,
            decorations: i
              ? t.decorations.map(e.mapping, e.doc)
              : Z(n.doc, a, t.hoveredId, t.selectedId),
            hoveredId: t.hoveredId,
            selectedId: t.selectedId,
          };
        }
        let r = e.getMeta(m);
        if (r) {
          let a = r.hoveredId ?? t.hoveredId,
            i = r.selectedId ?? t.selectedId;
          return { ...t, hoveredId: a, selectedId: i, decorations: Z(n.doc, t.tags, a, i) };
        }
        return { ...t, decorations: t.decorations.map(e.mapping, e.doc) };
      },
    },
    props: {
      decorations(e) {
        return m.getState(e)?.decorations ?? prosemirrorView.DecorationSet.empty;
      },
      handleClick(e, t) {
        let n = (m.getState(e.state)?.tags ?? []).find((a) => t >= a.from && t <= a.to);
        return n
          ? (e.dispatch(e.state.tr.setMeta(m, { selectedId: n.id })), true)
          : (m.getState(e.state)?.selectedId &&
              e.dispatch(e.state.tr.setMeta(m, { selectedId: void 0 })),
            false);
      },
      handleDOMEvents: {
        mouseover(e, t) {
          let n = t.target.closest?.('[data-tag-id]')?.getAttribute('data-tag-id') || void 0,
            r = m.getState(e.state)?.hoveredId;
          return (n !== r && e.dispatch(e.state.tr.setMeta(m, { hoveredId: n })), false);
        },
        mouseout(e, t) {
          return (
            t.relatedTarget?.closest?.('[data-tag-id]') ||
              (m.getState(e.state)?.hoveredId &&
                e.dispatch(e.state.tr.setMeta(m, { hoveredId: void 0 }))),
            false
          );
        },
      },
    },
  });
}
function pe(e) {
  return m.getState(e)?.tags ?? [];
}
function D(e, t) {
  e.dispatch(e.state.tr.setMeta(m, { hoveredId: t }));
}
function L(e, t) {
  e.dispatch(e.state.tr.setMeta(m, { selectedId: t }));
}
var W = `
.docx-template-tag {
  cursor: pointer;
  transition: background-color 0.1s;
}

.docx-template-tag:hover,
.docx-template-tag.hovered {
  filter: brightness(0.95);
}

.docx-template-tag.selected {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
}
`;
var ti = {
  variable: '#f59e0b',
  sectionStart: '#3b82f6',
  sectionEnd: '#3b82f6',
  invertedStart: '#8b5cf6',
  raw: '#ef4444',
};
function oi(e) {
  switch (e) {
    case 'sectionStart':
      return 'LOOP / IF';
    case 'invertedStart':
      return 'IF NOT';
    case 'raw':
      return 'HTML';
    default:
      return '';
  }
}
function U({ editorView: e, pluginState: t, renderedDomContext: o }) {
  let n = t?.tags ?? [],
    r = t?.hoveredId,
    a = t?.selectedId,
    [i, l] = ye.useState(0),
    p = ye.useRef(null),
    d = ye.useRef(new Map()),
    c = ye.useRef([]),
    u = ye.useMemo(() => n.filter((s) => s.type !== 'sectionEnd' && !s.insideSection), [n]),
    x = ye.useCallback(() => {
      if (u.length === 0 || !o) return c.current;
      let s = [],
        h = o.getContainerOffset(),
        E = new Map();
      for (let f of c.current) E.set(f.tag.id, f.top);
      for (let f of u) {
        let y = o.getRectsForRange(f.from, f.from + 1);
        if (y.length > 0) {
          let v = y[0].y + h.y - 40;
          s.push({ tag: f, top: v });
        } else {
          let v = E.get(f.id);
          v !== void 0 && s.push({ tag: f, top: v });
        }
      }
      s.sort((f, y) => f.top - y.top);
      let I = 6;
      for (let f = 1; f < s.length; f++) {
        let y = s[f - 1],
          v = s[f],
          C = d.current.get(y.tag.id),
          N = 32;
        (C
          ? (N = C.offsetHeight)
          : y.tag.nestedVars &&
            y.tag.nestedVars.length > 0 &&
            (N = 42 + y.tag.nestedVars.length * 26),
          v.top < y.top + N + I && (v.top = y.top + N + I));
      }
      return ((c.current = s), s);
    }, [u, o]),
    g = ye.useMemo(() => x(), [x, i]);
  (ye.useEffect(() => {
    if (!o) return;
    let s = new ResizeObserver(() => {
      requestAnimationFrame(() => l((h) => h + 1));
    });
    return (s.observe(o.pagesContainer), () => s.disconnect());
  }, [o]),
    ye.useEffect(() => {
      let s = () => {
        requestAnimationFrame(() => l((h) => h + 1));
      };
      return (window.addEventListener('resize', s), () => window.removeEventListener('resize', s));
    }, []));
  let b = ye.useRef('');
  ye.useEffect(() => {
    let s = u.map((h) => h.id).join(',');
    if (s && b.current !== s) {
      let h = setTimeout(() => {
        ((b.current = s), l((E) => E + 1));
      }, 50);
      return () => clearTimeout(h);
    }
  }, [u]);
  let k = (s) => {
      e && D(e, s);
    },
    w = (s) => {
      if (!e) return;
      L(e, s.id);
      let { state: h } = e,
        E = h.tr.setSelection(prosemirrorState.TextSelection.near(h.doc.resolve(s.from)));
      (e.dispatch(E), e.focus());
    };
  return u.length === 0
    ? null
    : jsxRuntime.jsx('div', {
        className: 'template-panel',
        ref: p,
        children: jsxRuntime.jsx('div', {
          className: 'template-panel-annotations',
          children: g.map(({ tag: s, top: h }) => {
            let E = oi(s.type),
              I = ti[s.type],
              f = s.type === 'sectionStart' || s.type === 'invertedStart',
              y = s.id === r,
              v = s.id === a;
            return jsxRuntime.jsxs(
              'div',
              {
                className: 'template-annotation-anchor',
                style: { top: `${h}px` },
                children: [
                  jsxRuntime.jsx('div', { className: 'template-annotation-connector' }),
                  jsxRuntime.jsxs('div', {
                    ref: (C) => {
                      C ? d.current.set(s.id, C) : d.current.delete(s.id);
                    },
                    className: `template-annotation-chip ${y ? 'hovered' : ''} ${v ? 'selected' : ''}`,
                    style: { borderLeftColor: I },
                    onMouseEnter: () => k(s.id),
                    onMouseLeave: () => k(void 0),
                    onClick: () => w(s),
                    title: f
                      ? `${s.rawTag}
Iterates over ${s.name}[]. Access nested properties via ${s.name}.property`
                      : s.rawTag,
                    children: [
                      E &&
                        jsxRuntime.jsx('span', {
                          className: 'template-chip-badge',
                          style: { background: I },
                          children: E,
                        }),
                      !E &&
                        jsxRuntime.jsx('span', {
                          className: 'template-chip-dot',
                          style: { color: I },
                          children: '\u25CF',
                        }),
                      jsxRuntime.jsx('span', { className: 'template-chip-name', children: s.name }),
                      f &&
                        s.nestedVars &&
                        s.nestedVars.length > 0 &&
                        jsxRuntime.jsx('div', {
                          className: 'template-chip-nested',
                          children: s.nestedVars.map((C, N) =>
                            jsxRuntime.jsx(
                              'span',
                              {
                                className: 'template-nested-var',
                                title: `Access: ${s.name}.${C}`,
                                children: C.includes('.') ? C.split('.').pop() : C,
                              },
                              N
                            )
                          ),
                        }),
                    ],
                  }),
                ],
              },
              s.id
            );
          }),
        }),
      });
}
var z = `
.template-panel {
  display: flex;
  min-height: 100%;
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  position: relative;
}

.template-panel-annotations {
  flex: 1;
  position: relative;
  overflow: visible;
  min-height: 100%;
  pointer-events: none;
  will-change: transform;
}

.template-panel-annotations > * {
  pointer-events: auto;
}

.template-annotation-anchor {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-start;
  transition: top 0.15s ease-out;
}

.template-annotation-connector {
  width: 20px;
  height: 1px;
  background: #d0d0d0;
  margin-top: 12px;
  margin-right: 4px;
  flex-shrink: 0;
}

.template-annotation-anchor:hover .template-annotation-connector {
  background: #3b82f6;
}

.template-annotation-chip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: white;
  border: 1px solid #e2e8f0;
  border-left: 3px solid #6c757d;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  max-width: 200px;
}

.template-annotation-chip:hover,
.template-annotation-chip.hovered {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  border-color: #cbd5e1;
}

.template-annotation-chip.selected {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
}

.template-chip-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.template-chip-dot {
  font-size: 8px;
}

.template-chip-name {
  color: #334155;
  font-weight: 500;
}

.template-chip-nested {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.template-nested-var {
  font-size: 10px;
  color: #64748b;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 3px;
}

.template-nested-var:hover {
  background: rgba(59, 130, 246, 0.15);
  color: #1e40af;
}
`;
var ii = {
    variable: 'rgba(245, 158, 11, 0.3)',
    sectionStart: 'rgba(59, 130, 246, 0.3)',
    sectionEnd: 'rgba(59, 130, 246, 0.3)',
    invertedStart: 'rgba(139, 92, 246, 0.3)',
    raw: 'rgba(239, 68, 68, 0.3)',
  },
  si = {
    variable: 'rgba(245, 158, 11, 0.5)',
    sectionStart: 'rgba(59, 130, 246, 0.5)',
    sectionEnd: 'rgba(59, 130, 246, 0.5)',
    invertedStart: 'rgba(139, 92, 246, 0.5)',
    raw: 'rgba(239, 68, 68, 0.5)',
  };
function me({ context: e, tags: t, hoveredId: o, selectedId: n, onHover: r, onSelect: a }) {
  let [i, l] = ye.useState(0),
    p = ye.useCallback(() => {
      let c = e.getContainerOffset(),
        u = [];
      for (let x of t) {
        let g = e.getRectsForRange(x.from, x.to);
        for (let b of g)
          u.push({
            tagId: x.id,
            tagType: x.type,
            x: b.x + c.x,
            y: b.y + c.y,
            width: b.width,
            height: b.height,
          });
      }
      return u;
    }, [e, t]),
    d = ye.useMemo(() => p(), [p, i]);
  return (
    ye.useEffect(() => {
      let c = () => {
        requestAnimationFrame(() => l((u) => u + 1));
      };
      return (window.addEventListener('resize', c), () => window.removeEventListener('resize', c));
    }, []),
    ye.useEffect(() => {
      let c = new ResizeObserver(() => {
        requestAnimationFrame(() => l((u) => u + 1));
      });
      return (c.observe(e.pagesContainer), () => c.disconnect());
    }, [e.pagesContainer]),
    d.length === 0
      ? null
      : jsxRuntime.jsx('div', {
          className: 'template-highlight-overlay',
          children: d.map((c, u) => {
            let x = c.tagId === o,
              g = c.tagId === n,
              b = x || g ? si[c.tagType] : ii[c.tagType];
            return jsxRuntime.jsx(
              'div',
              {
                className: `template-highlight ${x ? 'hovered' : ''} ${g ? 'selected' : ''}`,
                style: {
                  position: 'absolute',
                  left: c.x,
                  top: c.y,
                  width: c.width,
                  height: c.height,
                  backgroundColor: b,
                  borderRadius: 2,
                  cursor: 'pointer',
                },
                onMouseEnter: () => r?.(c.tagId),
                onMouseLeave: () => r?.(void 0),
                onClick: () => a?.(c.tagId),
              },
              `${c.tagId}-${u}`
            );
          }),
        })
  );
}
var he = `
.template-highlight-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: visible;
}

.template-highlight {
  pointer-events: auto;
  transition: background-color 0.1s ease;
}

.template-highlight:hover,
.template-highlight.hovered {
  filter: brightness(0.9);
}

.template-highlight.selected {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.6);
}
`;
var ci = ye__default.default.memo(U, (e, t) => {
  let o = e.pluginState,
    n = t.pluginState;
  if (o?.hoveredId !== n?.hoveredId || o?.selectedId !== n?.selectedId) return false;
  let r = o?.tags ?? [],
    a = n?.tags ?? [];
  if (r.length !== a.length) return false;
  for (let i = 0; i < r.length; i++) if (r[i].id !== a[i].id) return false;
  return e.renderedDomContext === t.renderedDomContext;
});
function Te(e = {}) {
  return {
    id: 'template',
    name: 'Template',
    proseMirrorPlugins: [B()],
    Panel: ci,
    panelConfig: {
      position: e.panelPosition ?? 'right',
      defaultSize: e.panelWidth ?? 280,
      minSize: 200,
      maxSize: 400,
      resizable: true,
      collapsible: true,
      defaultCollapsed: e.defaultCollapsed ?? false,
    },
    onStateChange: (o) => {
      let n = m.getState(o.state);
      if (n) return { tags: n.tags, hoveredId: n.hoveredId, selectedId: n.selectedId };
    },
    initialize: (o) => ({ tags: [] }),
    renderOverlay: (o, n, r) =>
      !n || n.tags.length === 0
        ? null
        : ye__default.default.createElement(me, {
            context: o,
            tags: n.tags,
            hoveredId: n.hoveredId,
            selectedId: n.selectedId,
            onHover: (a) => {
              r && D(r, a);
            },
            onSelect: (a) => {
              if (r) {
                L(r, a);
                let i = n.tags.find((l) => l.id === a);
                if (i) {
                  let l = r.state.tr.setSelection(
                    prosemirrorState.TextSelection.near(r.state.doc.resolve(i.from))
                  );
                  (r.dispatch(l), r.focus());
                }
              }
            },
          }),
    styles: `
${W}
${z}
${he}
`,
  };
}
var pi = Te();
var Di = '0.0.2';
Object.defineProperty(exports, 'DEFAULT_SELECTION_STYLE', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.w;
  },
});
Object.defineProperty(exports, 'DocxEditor', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.j;
  },
});
Object.defineProperty(exports, 'EditorToolbar', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.a;
  },
});
Object.defineProperty(exports, 'ErrorBoundary', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.d;
  },
});
Object.defineProperty(exports, 'ErrorProvider', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.c;
  },
});
Object.defineProperty(exports, 'HIGH_CONTRAST_SELECTION_STYLE', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.x;
  },
});
Object.defineProperty(exports, 'PLUGIN_HOST_STYLES', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.U;
  },
});
Object.defineProperty(exports, 'ParseErrorDisplay', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.e;
  },
});
Object.defineProperty(exports, 'PluginHost', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.V;
  },
});
Object.defineProperty(exports, 'SELECTION_CSS_VARS', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.y;
  },
});
Object.defineProperty(exports, 'UnsupportedFeatureWarning', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.f;
  },
});
Object.defineProperty(exports, 'ZOOM_PRESETS', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.m;
  },
});
Object.defineProperty(exports, 'areSelectionStylesInjected', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.P;
  },
});
Object.defineProperty(exports, 'clampZoom', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.v;
  },
});
Object.defineProperty(exports, 'clearSelection', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.K;
  },
});
Object.defineProperty(exports, 'createSelectionChangeHandler', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.Q;
  },
});
Object.defineProperty(exports, 'findNearestZoomPreset', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.p;
  },
});
Object.defineProperty(exports, 'formatZoom', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.s;
  },
});
Object.defineProperty(exports, 'generateOverlayElements', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.S;
  },
});
Object.defineProperty(exports, 'generateSelectionCSS', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.D;
  },
});
Object.defineProperty(exports, 'getHighlightRectStyle', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.C;
  },
});
Object.defineProperty(exports, 'getMergedSelectionRects', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.B;
  },
});
Object.defineProperty(exports, 'getNextZoomPreset', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.q;
  },
});
Object.defineProperty(exports, 'getPreviousZoomPreset', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.r;
  },
});
Object.defineProperty(exports, 'getSelectedText', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.F;
  },
});
Object.defineProperty(exports, 'getSelectionBoundingRect', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.H;
  },
});
Object.defineProperty(exports, 'getSelectionRects', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.z;
  },
});
Object.defineProperty(exports, 'getUserFriendlyMessage', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.h;
  },
});
Object.defineProperty(exports, 'getZoomPresets', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.o;
  },
});
Object.defineProperty(exports, 'hasActiveSelection', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.E;
  },
});
Object.defineProperty(exports, 'highlightTextRange', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.I;
  },
});
Object.defineProperty(exports, 'injectSelectionStyles', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.N;
  },
});
Object.defineProperty(exports, 'isParseError', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.g;
  },
});
Object.defineProperty(exports, 'isSelectionBackwards', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.L;
  },
});
Object.defineProperty(exports, 'isSelectionWithin', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.G;
  },
});
Object.defineProperty(exports, 'isZoomPreset', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.u;
  },
});
Object.defineProperty(exports, 'mergeAdjacentRects', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.A;
  },
});
Object.defineProperty(exports, 'normalizeSelectionDirection', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.M;
  },
});
Object.defineProperty(exports, 'parseZoom', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.t;
  },
});
Object.defineProperty(exports, 'removeSelectionStyles', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.O;
  },
});
Object.defineProperty(exports, 'renderAsync', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.k;
  },
});
Object.defineProperty(exports, 'selectRange', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.J;
  },
});
Object.defineProperty(exports, 'useAutoSave', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.l;
  },
});
Object.defineProperty(exports, 'useClipboard', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.T;
  },
});
Object.defineProperty(exports, 'useErrorNotifications', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.b;
  },
});
Object.defineProperty(exports, 'useSelectionHighlight', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.R;
  },
});
Object.defineProperty(exports, 'useTableSelection', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.i;
  },
});
Object.defineProperty(exports, 'useWheelZoom', {
  enumerable: true,
  get: function () {
    return chunkKEXZ6SYZ_js.n;
  },
});
Object.defineProperty(exports, 'ColorPicker', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.k;
  },
});
Object.defineProperty(exports, 'ContextMenu', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.a;
  },
});
Object.defineProperty(exports, 'InsertImageDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.V;
  },
});
Object.defineProperty(exports, 'InsertSymbolDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.da;
  },
});
Object.defineProperty(exports, 'InsertTableDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.O;
  },
});
Object.defineProperty(exports, 'KeyboardShortcutsDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.qa;
  },
});
Object.defineProperty(exports, 'LoadingIndicator', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.B;
  },
});
Object.defineProperty(exports, 'PasteSpecialDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ka;
  },
});
Object.defineProperty(exports, 'PrintButton', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.l;
  },
});
Object.defineProperty(exports, 'PrintStyles', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.m;
  },
});
Object.defineProperty(exports, 'ResponsePreview', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.g;
  },
});
Object.defineProperty(exports, 'ResponsiveToolbar', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.J;
  },
});
Object.defineProperty(exports, 'ResponsiveToolbarGroup', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.K;
  },
});
Object.defineProperty(exports, 'SYMBOL_CATEGORIES', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ca;
  },
});
Object.defineProperty(exports, 'TableInsertButtons', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.u;
  },
});
Object.defineProperty(exports, 'TableMergeButton', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.t;
  },
});
Object.defineProperty(exports, 'UnsavedIndicator', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.v;
  },
});
Object.defineProperty(exports, 'calculateFitDimensions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js._;
  },
});
Object.defineProperty(exports, 'clampTableConfig', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.S;
  },
});
Object.defineProperty(exports, 'createChangeTracker', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.A;
  },
});
Object.defineProperty(exports, 'createDefaultTableConfig', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.Q;
  },
});
Object.defineProperty(exports, 'createErrorResponse', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.j;
  },
});
Object.defineProperty(exports, 'createMockResponse', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.i;
  },
});
Object.defineProperty(exports, 'createToolbarItem', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.L;
  },
});
Object.defineProperty(exports, 'createToolbarItems', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.M;
  },
});
Object.defineProperty(exports, 'dataUrlToBlob', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.$;
  },
});
Object.defineProperty(exports, 'delay', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.H;
  },
});
Object.defineProperty(exports, 'formatFileSize', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ba;
  },
});
Object.defineProperty(exports, 'formatPrintPageRange', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.r;
  },
});
Object.defineProperty(exports, 'formatShortcutKeys', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.xa;
  },
});
Object.defineProperty(exports, 'formatTableDimensions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.T;
  },
});
Object.defineProperty(exports, 'getActionShortcut', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.c;
  },
});
Object.defineProperty(exports, 'getAllActions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.f;
  },
});
Object.defineProperty(exports, 'getAllCategories', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.wa;
  },
});
Object.defineProperty(exports, 'getAllIndicatorPositions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.z;
  },
});
Object.defineProperty(exports, 'getAllIndicatorVariants', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.y;
  },
});
Object.defineProperty(exports, 'getAllLoadingSizes', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.G;
  },
});
Object.defineProperty(exports, 'getAllLoadingVariants', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.F;
  },
});
Object.defineProperty(exports, 'getAllPasteOptions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.na;
  },
});
Object.defineProperty(exports, 'getCategoryLabel', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.va;
  },
});
Object.defineProperty(exports, 'getCommonShortcuts', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ua;
  },
});
Object.defineProperty(exports, 'getDefaultActions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.e;
  },
});
Object.defineProperty(exports, 'getDefaultPasteOption', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.oa;
  },
});
Object.defineProperty(exports, 'getDefaultPrintOptions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.p;
  },
});
Object.defineProperty(exports, 'getDefaultShortcuts', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.sa;
  },
});
Object.defineProperty(exports, 'getImageAcceptString', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.Z;
  },
});
Object.defineProperty(exports, 'getImageDimensions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.aa;
  },
});
Object.defineProperty(exports, 'getLoadingVariantLabel', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.E;
  },
});
Object.defineProperty(exports, 'getPasteOption', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ma;
  },
});
Object.defineProperty(exports, 'getRecommendedPriority', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.N;
  },
});
Object.defineProperty(exports, 'getShortcutsByCategory', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ta;
  },
});
Object.defineProperty(exports, 'getSupportedImageExtensions', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.Y;
  },
});
Object.defineProperty(exports, 'getSymbolCategories', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.fa;
  },
});
Object.defineProperty(exports, 'getSymbolUnicodeInfo', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ha;
  },
});
Object.defineProperty(exports, 'getSymbolsByCategory', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ga;
  },
});
Object.defineProperty(exports, 'getTablePresets', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.U;
  },
});
Object.defineProperty(exports, 'getVariantLabel', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.x;
  },
});
Object.defineProperty(exports, 'isActionAvailable', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.d;
  },
});
Object.defineProperty(exports, 'isPasteSpecialShortcut', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.pa;
  },
});
Object.defineProperty(exports, 'isPrintSupported', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.s;
  },
});
Object.defineProperty(exports, 'isValidImageFile', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.X;
  },
});
Object.defineProperty(exports, 'isValidTableConfig', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.R;
  },
});
Object.defineProperty(exports, 'openPrintWindow', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.o;
  },
});
Object.defineProperty(exports, 'parsePageRange', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.q;
  },
});
Object.defineProperty(exports, 'searchSymbols', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ia;
  },
});
Object.defineProperty(exports, 'symbolFromCodePoint', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ja;
  },
});
Object.defineProperty(exports, 'triggerPrint', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.n;
  },
});
Object.defineProperty(exports, 'useContextMenu', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.b;
  },
});
Object.defineProperty(exports, 'useInsertImageDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.W;
  },
});
Object.defineProperty(exports, 'useInsertSymbolDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ea;
  },
});
Object.defineProperty(exports, 'useInsertTableDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.P;
  },
});
Object.defineProperty(exports, 'useKeyboardShortcutsDialog', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.ra;
  },
});
Object.defineProperty(exports, 'useLoading', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.C;
  },
});
Object.defineProperty(exports, 'useLoadingOperations', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.D;
  },
});
Object.defineProperty(exports, 'usePasteSpecial', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.la;
  },
});
Object.defineProperty(exports, 'useResponsePreview', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.h;
  },
});
Object.defineProperty(exports, 'useResponsiveToolbar', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.I;
  },
});
Object.defineProperty(exports, 'useUnsavedChanges', {
  enumerable: true,
  get: function () {
    return chunkWSCNNBR6_js.w;
  },
});
Object.defineProperty(exports, 'AdvancedColorPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.k;
  },
});
Object.defineProperty(exports, 'AlignmentButtons', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.l;
  },
});
Object.defineProperty(exports, 'CLIPBOARD_TYPES', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.K;
  },
});
Object.defineProperty(exports, 'FontPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.g;
  },
});
Object.defineProperty(exports, 'FontSizePicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.j;
  },
});
Object.defineProperty(exports, 'FormattingBar', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.y;
  },
});
Object.defineProperty(exports, 'HorizontalRuler', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.E;
  },
});
Object.defineProperty(exports, 'INTERNAL_CLIPBOARD_TYPE', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.J;
  },
});
Object.defineProperty(exports, 'LineSpacingPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.o;
  },
});
Object.defineProperty(exports, 'ListButtons', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.m;
  },
});
Object.defineProperty(exports, 'StylePicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.p;
  },
});
Object.defineProperty(exports, 'TableBorderColorPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.s;
  },
});
Object.defineProperty(exports, 'TableBorderPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.r;
  },
});
Object.defineProperty(exports, 'TableBorderWidthPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.t;
  },
});
Object.defineProperty(exports, 'TableCellFillPicker', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.u;
  },
});
Object.defineProperty(exports, 'TableMoreDropdown', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.v;
  },
});
Object.defineProperty(exports, 'TableToolbar', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.da;
  },
});
Object.defineProperty(exports, 'TextContextMenu', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.Z;
  },
});
Object.defineProperty(exports, 'Toolbar', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.D;
  },
});
Object.defineProperty(exports, 'ToolbarButton', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.A;
  },
});
Object.defineProperty(exports, 'ToolbarGroup', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.B;
  },
});
Object.defineProperty(exports, 'ToolbarSeparator', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.C;
  },
});
Object.defineProperty(exports, 'ZoomControl', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.q;
  },
});
Object.defineProperty(exports, 'addColumn', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ja;
  },
});
Object.defineProperty(exports, 'addRow', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ha;
  },
});
Object.defineProperty(exports, 'cleanWordHtml', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.W;
  },
});
Object.defineProperty(exports, 'copyParagraphs', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.N;
  },
});
Object.defineProperty(exports, 'copyRuns', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.M;
  },
});
Object.defineProperty(exports, 'createClipboardHandlers', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.Y;
  },
});
Object.defineProperty(exports, 'createDefaultListState', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.n;
  },
});
Object.defineProperty(exports, 'createTableContext', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ea;
  },
});
Object.defineProperty(exports, 'deleteColumn', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ka;
  },
});
Object.defineProperty(exports, 'deleteRow', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ia;
  },
});
Object.defineProperty(exports, 'getCellAt', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ga;
  },
});
Object.defineProperty(exports, 'getColumnCount', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.fa;
  },
});
Object.defineProperty(exports, 'getDefaultTextContextMenuItems', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ba;
  },
});
Object.defineProperty(exports, 'getMarginInUnits', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.H;
  },
});
Object.defineProperty(exports, 'getRulerDimensions', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.G;
  },
});
Object.defineProperty(exports, 'getTextActionLabel', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.$;
  },
});
Object.defineProperty(exports, 'getTextActionShortcut', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.aa;
  },
});
Object.defineProperty(exports, 'handlePasteEvent', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.S;
  },
});
Object.defineProperty(exports, 'htmlToRuns', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.X;
  },
});
Object.defineProperty(exports, 'isEditorHtml', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.V;
  },
});
Object.defineProperty(exports, 'isTextActionAvailable', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ca;
  },
});
Object.defineProperty(exports, 'isWordHtml', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.U;
  },
});
Object.defineProperty(exports, 'mergeCells', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.la;
  },
});
Object.defineProperty(exports, 'paragraphsToClipboardContent', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.P;
  },
});
Object.defineProperty(exports, 'parseClipboardHtml', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.T;
  },
});
Object.defineProperty(exports, 'parseMarginFromUnits', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.I;
  },
});
Object.defineProperty(exports, 'positionToMargin', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.F;
  },
});
Object.defineProperty(exports, 'readFromClipboard', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.R;
  },
});
Object.defineProperty(exports, 'runsToClipboardContent', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.O;
  },
});
Object.defineProperty(exports, 'splitCell', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.ma;
  },
});
Object.defineProperty(exports, 'useTextContextMenu', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js._;
  },
});
Object.defineProperty(exports, 'writeToClipboard', {
  enumerable: true,
  get: function () {
    return chunkEOTZWQND_js.Q;
  },
});
Object.defineProperty(exports, 'FindReplaceDialog', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.n;
  },
});
Object.defineProperty(exports, 'createDefaultFindOptions', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.a;
  },
});
Object.defineProperty(exports, 'createSearchPattern', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.c;
  },
});
Object.defineProperty(exports, 'escapeRegexString', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.b;
  },
});
Object.defineProperty(exports, 'findAllMatches', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.d;
  },
});
Object.defineProperty(exports, 'findInDocument', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.j;
  },
});
Object.defineProperty(exports, 'findInParagraph', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.k;
  },
});
Object.defineProperty(exports, 'getDefaultHighlightOptions', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.i;
  },
});
Object.defineProperty(exports, 'getMatchCountText', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.g;
  },
});
Object.defineProperty(exports, 'isEmptySearch', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.h;
  },
});
Object.defineProperty(exports, 'replaceAllInContent', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.e;
  },
});
Object.defineProperty(exports, 'replaceFirstInContent', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.f;
  },
});
Object.defineProperty(exports, 'scrollToMatch', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.l;
  },
});
Object.defineProperty(exports, 'useFindReplace', {
  enumerable: true,
  get: function () {
    return chunkCTYOM6BE_js.m;
  },
});
Object.defineProperty(exports, 'HyperlinkDialog', {
  enumerable: true,
  get: function () {
    return chunkPJVI53AH_js.d;
  },
});
Object.defineProperty(exports, 'useHyperlinkDialog', {
  enumerable: true,
  get: function () {
    return chunkPJVI53AH_js.m;
  },
});
Object.defineProperty(exports, 'TABLE_DATA_ATTRIBUTES', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.x;
  },
});
Object.defineProperty(exports, 'countPageBreaks', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.n;
  },
});
Object.defineProperty(exports, 'createColumnBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.b;
  },
});
Object.defineProperty(exports, 'createHorizontalRule', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.g;
  },
});
Object.defineProperty(exports, 'createLineBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.c;
  },
});
Object.defineProperty(exports, 'createPageBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.a;
  },
});
Object.defineProperty(exports, 'createPageBreakParagraph', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.e;
  },
});
Object.defineProperty(exports, 'createPageBreakRun', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.d;
  },
});
Object.defineProperty(exports, 'createSelectionFromDOM', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.F;
  },
});
Object.defineProperty(exports, 'findPageBreaks', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.o;
  },
});
Object.defineProperty(exports, 'formatLastSaveTime', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.s;
  },
});
Object.defineProperty(exports, 'formatStorageSize', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.v;
  },
});
Object.defineProperty(exports, 'getAutoSaveStatusLabel', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.t;
  },
});
Object.defineProperty(exports, 'getAutoSaveStorageSize', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.u;
  },
});
Object.defineProperty(exports, 'getSelectionRuns', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.E;
  },
});
Object.defineProperty(exports, 'hasPageBreakBefore', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.m;
  },
});
Object.defineProperty(exports, 'insertHorizontalRule', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.h;
  },
});
Object.defineProperty(exports, 'insertPageBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.f;
  },
});
Object.defineProperty(exports, 'isAutoSaveSupported', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.w;
  },
});
Object.defineProperty(exports, 'isBreakContent', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.l;
  },
});
Object.defineProperty(exports, 'isColumnBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.j;
  },
});
Object.defineProperty(exports, 'isLineBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.k;
  },
});
Object.defineProperty(exports, 'isPageBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.i;
  },
});
Object.defineProperty(exports, 'removePageBreak', {
  enumerable: true,
  get: function () {
    return chunkFVUGBRDD_js.p;
  },
});
Object.defineProperty(exports, 'DocumentAgent', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.f;
  },
});
Object.defineProperty(exports, 'buildExtendedSelectionContext', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.m;
  },
});
Object.defineProperty(exports, 'buildSelectionContext', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.l;
  },
});
Object.defineProperty(exports, 'createDocumentWithText', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.e;
  },
});
Object.defineProperty(exports, 'createEmptyDocument', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.d;
  },
});
Object.defineProperty(exports, 'getAgentContext', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.i;
  },
});
Object.defineProperty(exports, 'getDocumentSummary', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.k;
  },
});
Object.defineProperty(exports, 'blendColors', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.l;
  },
});
Object.defineProperty(exports, 'colorsEqual', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.q;
  },
});
Object.defineProperty(exports, 'createRgbColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.i;
  },
});
Object.defineProperty(exports, 'createThemeColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.h;
  },
});
Object.defineProperty(exports, 'darkenColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.j;
  },
});
Object.defineProperty(exports, 'getContrastingColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.f;
  },
});
Object.defineProperty(exports, 'isBlack', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.d;
  },
});
Object.defineProperty(exports, 'isWhite', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.e;
  },
});
Object.defineProperty(exports, 'lightenColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.k;
  },
});
Object.defineProperty(exports, 'parseColorString', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.g;
  },
});
Object.defineProperty(exports, 'resolveColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.a;
  },
});
Object.defineProperty(exports, 'resolveHighlightColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.b;
  },
});
Object.defineProperty(exports, 'resolveShadingColor', {
  enumerable: true,
  get: function () {
    return chunk4VUZBV2S_js.c;
  },
});
Object.defineProperty(exports, 'docxtemplaterPlugin', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.o;
  },
});
Object.defineProperty(exports, 'getTemplateTags', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.e;
  },
});
Object.defineProperty(exports, 'processTemplate', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.a;
  },
});
Object.defineProperty(exports, 'processTemplateAsBlob', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.c;
  },
});
Object.defineProperty(exports, 'processTemplateDetailed', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.b;
  },
});
Object.defineProperty(exports, 'validateTemplate', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.f;
  },
});
Object.defineProperty(exports, 'serializeDocumentBody', {
  enumerable: true,
  get: function () {
    return chunk2GSKZFWS_js.b;
  },
});
Object.defineProperty(exports, 'serializeDocx', {
  enumerable: true,
  get: function () {
    return chunk2GSKZFWS_js.c;
  },
});
Object.defineProperty(exports, 'serializeSectionProperties', {
  enumerable: true,
  get: function () {
    return chunk2GSKZFWS_js.a;
  },
});
Object.defineProperty(exports, 'executeCommand', {
  enumerable: true,
  get: function () {
    return chunkAARNCPWR_js.a;
  },
});
Object.defineProperty(exports, 'executeCommands', {
  enumerable: true,
  get: function () {
    return chunkAARNCPWR_js.b;
  },
});
Object.defineProperty(exports, 'canRenderFont', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.i;
  },
});
Object.defineProperty(exports, 'getLoadedFonts', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.g;
  },
});
Object.defineProperty(exports, 'isFontLoaded', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.e;
  },
});
Object.defineProperty(exports, 'isFontsLoading', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.f;
  },
});
Object.defineProperty(exports, 'loadFont', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.c;
  },
});
Object.defineProperty(exports, 'loadFontFromBuffer', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.j;
  },
});
Object.defineProperty(exports, 'loadFonts', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.d;
  },
});
Object.defineProperty(exports, 'onFontsLoaded', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.h;
  },
});
Object.defineProperty(exports, 'parseDocx', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.n;
  },
});
Object.defineProperty(exports, 'preloadCommonFonts', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.k;
  },
});
Object.defineProperty(exports, 'toArrayBuffer', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.m;
  },
});
Object.defineProperty(exports, 'PluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkBUEMG4NW_js.a;
  },
});
Object.defineProperty(exports, 'pluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkBUEMG4NW_js.b;
  },
});
Object.defineProperty(exports, 'registerPlugins', {
  enumerable: true,
  get: function () {
    return chunkBUEMG4NW_js.c;
  },
});
Object.defineProperty(exports, 'emuToPixels', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.c;
  },
});
Object.defineProperty(exports, 'emuToTwips', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.e;
  },
});
Object.defineProperty(exports, 'formatPx', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.k;
  },
});
Object.defineProperty(exports, 'halfPointsToPixels', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.h;
  },
});
Object.defineProperty(exports, 'pixelsToEmu', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.d;
  },
});
Object.defineProperty(exports, 'pixelsToTwips', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.b;
  },
});
Object.defineProperty(exports, 'pointsToPixels', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.g;
  },
});
Object.defineProperty(exports, 'twipsToEmu', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.f;
  },
});
Object.defineProperty(exports, 'twipsToPixels', {
  enumerable: true,
  get: function () {
    return chunkSE5EN2QL_js.a;
  },
});
exports.ANNOTATION_PANEL_STYLES = z;
exports.AnnotationPanel = U;
exports.NAVIGATION_SHORTCUTS = T;
exports.TEMPLATE_DECORATION_STYLES = W;
exports.VERSION = Di;
exports.createDoubleClickWordSelector = ka;
exports.createTemplatePlugin = Te;
exports.createTemplateProseMirrorPlugin = B;
exports.createTripleClickParagraphSelector = Ma;
exports.describeShortcut = S;
exports.expandSelectionToWord = Ua;
exports.expandSelectionToWordBoundaries = Oa;
exports.extendSelectionTo = _;
exports.findNextWordStart = ee;
exports.findPreviousWordStart = te;
exports.findVisualLineEnd = ne;
exports.findVisualLineStart = oe;
exports.findWordAt = Ia;
exports.findWordBoundaries = R;
exports.findWordEnd = _a;
exports.findWordStart = Ha;
exports.getNavigationShortcutDescriptions = Ga;
exports.getSelectionInfo = Ba;
exports.getTemplatePluginTags = pe;
exports.getWordAt = wa;
exports.getWordAtCursor = za;
exports.handleClickForMultiClick = Q;
exports.handleNavigationKey = Wa;
exports.isNavigationKey = Fa;
exports.isPunctuation = Ka;
exports.isWhitespace = K;
exports.isWhitespaceChar = Y;
exports.isWordChar = P;
exports.isWordCharacter = M;
exports.matchesShortcut = Va;
exports.moveByWord = re;
exports.moveToLineEdge = ae;
exports.parseNavigationAction = ie;
exports.selectParagraphAtCursor = J;
exports.selectWordAtCursor = $;
exports.selectWordInTextNode = Na;
exports.setHoveredElement = D;
exports.setSelectedElement = L;
exports.setSelectionPosition = H;
exports.templatePlugin = pi;
exports.templatePluginKey = m;
