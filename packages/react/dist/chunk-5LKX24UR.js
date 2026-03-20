'use strict';
var chunkWIRZTO37_js = require('./chunk-WIRZTO37.js'),
  chunk2GSKZFWS_js = require('./chunk-2GSKZFWS.js'),
  chunkAARNCPWR_js = require('./chunk-AARNCPWR.js'),
  chunkZ2UPNKQW_js = require('./chunk-Z2UPNKQW.js'),
  chunkH5NTJZO4_js = require('./chunk-H5NTJZO4.js');
function G(r, t) {
  let e = et(t),
    n = new RegExp(`<w:p[\\s][^>]*w14:paraId="${e}"`, 'g'),
    a = [],
    o;
  for (; (o = n.exec(r)) !== null; ) a.push(o.index);
  if (a.length === 0 || a.length > 1) return null;
  let s = a[0],
    i = s,
    c = 0;
  for (; i < r.length; ) {
    let l = r.indexOf('<', i);
    if (l === -1) break;
    if (r.startsWith('<w:p', l)) {
      let u = r[l + 4];
      if (u === '>' || u === ' ' || u === '/') {
        let g = r.indexOf('>', l);
        if (g === -1) break;
        if (r[g - 1] === '/') {
          if (c === 0) return { start: s, end: g + 1 };
          i = g + 1;
        } else (c++, (i = g + 1));
      } else i = l + 1;
    } else if (r.startsWith('</w:p>', l)) {
      if ((c--, c === 0)) return { start: s, end: l + 6 };
      i = l + 6;
    } else i = l + 1;
  }
  return null;
}
function Q(r, t) {
  let e = G(r, t);
  return e ? r.substring(e.start, e.end) : null;
}
function q(r) {
  let t = 0,
    e = /<w:p[\s>]/g,
    n;
  for (; (n = e.exec(r)) !== null; ) {
    let a = n.index,
      o = r[a + 4];
    (o === '>' || o === ' ') && t++;
  }
  return t;
}
function X(r) {
  let t = new Map(),
    e = /w14:paraId="([^"]+)"/g,
    n;
  for (; (n = e.exec(r)) !== null; ) {
    let a = n[1];
    t.set(a, (t.get(a) || 0) + 1);
  }
  return t;
}
function tt(r, t, e) {
  if (e.size === 0) return { safe: true };
  let n = X(r),
    a = X(t);
  for (let i of e) {
    let c = n.get(i) || 0;
    if (c === 0) return { safe: false, reason: `paraId-not-found-in-original: ${i}` };
    if (c > 1) return { safe: false, reason: `duplicate-paraId-in-original: ${i}` };
  }
  for (let i of e) {
    let c = a.get(i) || 0;
    if (c === 0) return { safe: false, reason: `paraId-not-found-in-serialized: ${i}` };
    if (c > 1) return { safe: false, reason: `duplicate-paraId-in-serialized: ${i}` };
  }
  let o = q(r),
    s = q(t);
  return o !== s
    ? { safe: false, reason: `paragraph-count-mismatch: original=${o}, serialized=${s}` }
    : { safe: true };
}
function Z(r, t, e) {
  if (e.size === 0) return r;
  if (!tt(r, t, e).safe) return null;
  let a = [];
  for (let s of e) {
    let i = G(r, s);
    if (!i) return null;
    let c = Q(t, s);
    if (!c) return null;
    a.push({ start: i.start, end: i.end, newXml: c });
  }
  a.sort((s, i) => i.start - s.start);
  let o = r;
  for (let { start: s, end: i, newXml: c } of a) o = o.substring(0, s) + c + o.substring(i);
  return o;
}
function et(r) {
  return r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function J(r) {
  for (let t of r)
    if (t.type === 'paragraph') {
      for (let e of t.content)
        if (e.type === 'run') {
          for (let n of e.content)
            if (n.type === 'drawing' && n.image?.src?.startsWith('data:') && !n.image?.rId)
              return true;
        } else if (e.type === 'hyperlink' && e.href && !e.rId && !e.anchor) return true;
    } else if (t.type === 'table') {
      for (let e of t.rows) for (let n of e.cells) if (J(n.content)) return true;
    }
  return false;
}
async function Y(r, t, e) {
  let { changedParaIds: n, structuralChange: a, hasUntrackedChanges: o } = e;
  if (a || o || !t) return null;
  let s = r.package.document.content;
  if (J(s)) return null;
  let i = r.package.document.comments,
    c = i && i.length > 0,
    l = chunk2GSKZFWS_js.j(r);
  try {
    let g = await (await import('./lib-GD2QD2JK.js')).default.loadAsync(t),
      f = new Map();
    if (n.size > 0) {
      let p = g.file('word/document.xml');
      if (!p) return null;
      let m = await p.async('text'),
        b = chunk2GSKZFWS_js.c(r),
        d = Z(m, b, n);
      if (!d) return null;
      f.set('word/document.xml', d);
    }
    if (c) {
      f.set('word/comments.xml', chunk2GSKZFWS_js.d(i));
      let p = g.file('[Content_Types].xml');
      if (p) {
        let d = await p.async('text');
        d.includes('/word/comments.xml') ||
          f.set(
            '[Content_Types].xml',
            d.replace(
              '</Types>',
              `<Override PartName="/word/comments.xml" ContentType="${chunk2GSKZFWS_js.g}"/></Types>`
            )
          );
      }
      let m = 'word/_rels/document.xml.rels',
        b = g.file(m);
      if (b) {
        let d = await b.async('text');
        if (!d.includes('comments.xml')) {
          let x = chunk2GSKZFWS_js.e(d);
          f.set(
            m,
            d.replace(
              '</Relationships>',
              `<Relationship Id="rId${x + 1}" Type="${chunkZ2UPNKQW_js.a.comments}" Target="comments.xml"/></Relationships>`
            )
          );
        }
      }
    }
    for (let [p, m] of l) f.set(p, m);
    let y = g.file('docProps/core.xml');
    if (y) {
      let p = await y.async('text');
      f.set('docProps/core.xml', chunk2GSKZFWS_js.k(p, { updateModifiedDate: !0 }));
    }
    return await chunk2GSKZFWS_js.i(g, f);
  } catch {
    return null;
  }
}
function nt() {
  return [
    {
      styleId: 'Normal',
      type: 'paragraph',
      name: 'Normal',
      default: true,
      qFormat: true,
      uiPriority: 0,
      rPr: { fontSize: 22, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
      pPr: { lineSpacing: 276 },
    },
    {
      styleId: 'Title',
      type: 'paragraph',
      name: 'Title',
      basedOn: 'Normal',
      next: 'Normal',
      qFormat: true,
      uiPriority: 10,
      rPr: { fontSize: 52, bold: true, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
      pPr: { lineSpacing: 240 },
    },
    {
      styleId: 'Subtitle',
      type: 'paragraph',
      name: 'Subtitle',
      basedOn: 'Normal',
      next: 'Normal',
      qFormat: true,
      uiPriority: 11,
      rPr: {
        fontSize: 30,
        color: { rgb: '666666' },
        fontFamily: { ascii: 'Arial', hAnsi: 'Arial' },
      },
      pPr: { lineSpacing: 240 },
    },
    {
      styleId: 'Heading1',
      type: 'paragraph',
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Normal',
      qFormat: true,
      uiPriority: 9,
      rPr: { fontSize: 40, bold: true, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
      pPr: { spaceBefore: 400, spaceAfter: 120, lineSpacing: 240 },
    },
    {
      styleId: 'Heading2',
      type: 'paragraph',
      name: 'Heading 2',
      basedOn: 'Normal',
      next: 'Normal',
      qFormat: true,
      uiPriority: 9,
      rPr: { fontSize: 32, bold: true, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
      pPr: { spaceBefore: 360, spaceAfter: 80, lineSpacing: 240 },
    },
    {
      styleId: 'Heading3',
      type: 'paragraph',
      name: 'Heading 3',
      basedOn: 'Normal',
      next: 'Normal',
      qFormat: true,
      uiPriority: 9,
      rPr: { fontSize: 28, bold: true, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
      pPr: { spaceBefore: 320, spaceAfter: 80, lineSpacing: 240 },
    },
    {
      styleId: 'Heading4',
      type: 'paragraph',
      name: 'Heading 4',
      basedOn: 'Normal',
      next: 'Normal',
      qFormat: true,
      uiPriority: 9,
      rPr: { fontSize: 24, bold: true, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
      pPr: { spaceBefore: 280, spaceAfter: 80, lineSpacing: 240 },
    },
  ];
}
function rt() {
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    orientation: 'portrait',
    marginTop: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    marginRight: 1440,
    headerDistance: 720,
    footerDistance: 720,
    gutter: 0,
    columnCount: 1,
    columnSpace: 720,
    equalWidth: true,
    sectionStart: 'nextPage',
    verticalAlign: 'top',
  };
}
function at(r = {}) {
  let t = rt();
  (r.pageWidth !== void 0 && (t.pageWidth = r.pageWidth),
    r.pageHeight !== void 0 && (t.pageHeight = r.pageHeight),
    r.orientation !== void 0 && (t.orientation = r.orientation),
    r.marginTop !== void 0 && (t.marginTop = r.marginTop),
    r.marginBottom !== void 0 && (t.marginBottom = r.marginBottom),
    r.marginLeft !== void 0 && (t.marginLeft = r.marginLeft),
    r.marginRight !== void 0 && (t.marginRight = r.marginRight));
  let e = { type: 'text', text: r.initialText || '' };
  return {
    package: {
      document: {
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'run',
                content: r.initialText ? [e] : [],
                formatting: { fontSize: 22, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
              },
            ],
            formatting: { lineSpacing: 276 },
          },
        ],
        finalSectionProperties: t,
      },
      styles: {
        docDefaults: {
          rPr: { fontSize: 22, fontFamily: { ascii: 'Arial', hAnsi: 'Arial' } },
          pPr: { lineSpacing: 276 },
        },
        styles: nt(),
      },
    },
    templateVariables: [],
    warnings: [],
  };
}
function Wt(r, t = {}) {
  return at({ ...t, initialText: r });
}
var T = class r {
  constructor(t) {
    chunkH5NTJZO4_js.d(this, '_document');
    chunkH5NTJZO4_js.d(this, '_pendingVariables');
    (t instanceof ArrayBuffer || ArrayBuffer.isView(t)
      ? (this._document = {
          package: { document: { content: [] } },
          originalBuffer: t instanceof ArrayBuffer ? t : t.buffer,
        })
      : (this._document = t),
      (this._pendingVariables = {}));
  }
  static async fromBuffer(t) {
    let e = await chunkZ2UPNKQW_js.n(t);
    return new r(e);
  }
  static fromDocument(t) {
    return new r(t);
  }
  getDocument() {
    return this._document;
  }
  getText() {
    let t = this._document.package.document;
    return this._getBodyText(t);
  }
  getFormattedText() {
    let t = [],
      e = this._document.package.document;
    for (let n of e.content) n.type === 'paragraph' && this._extractParagraphSegments(n, t);
    return t;
  }
  getVariables() {
    return chunkWIRZTO37_js.a(this._document);
  }
  getStyles() {
    let t = this._document.package.styles;
    if (!t?.styles) return [];
    let e = [];
    for (let [n, a] of Object.entries(t.styles))
      if (typeof a == 'object' && a !== null) {
        let o = a;
        e.push({
          id: n,
          name: o.name || n,
          type: o.type === 'numbering' ? 'paragraph' : o.type || 'paragraph',
          builtIn: o.default,
        });
      }
    return e;
  }
  getPageCount() {
    let t = this.getWordCount();
    return Math.max(1, Math.ceil(t / 500));
  }
  getWordCount() {
    return this.getText()
      .split(/\s+/)
      .filter((n) => n.length > 0).length;
  }
  getCharacterCount(t = true) {
    let e = this.getText();
    return t ? e.length : e.replace(/\s/g, '').length;
  }
  getParagraphCount() {
    return this._document.package.document.content.filter((t) => t.type === 'paragraph').length;
  }
  getTableCount() {
    return this._document.package.document.content.filter((t) => t.type === 'table').length;
  }
  getAgentContext(t = 100) {
    let e = this._document.package.document,
      n = e.content.filter((s) => s.type === 'paragraph'),
      a = n.map((s, i) => {
        let c = this._getParagraphText(s),
          l = s.formatting?.styleId;
        return {
          index: i,
          preview: c.slice(0, t),
          style: l,
          isHeading: l?.toLowerCase().includes('heading') || false,
          headingLevel: this._parseHeadingLevel(l),
          isListItem: !!s.listRendering,
          isEmpty: c.trim().length === 0,
        };
      }),
      o = (e.sections || []).map((s, i) => ({
        index: i,
        paragraphCount: s.content?.length || 0,
        pageSize:
          s.properties?.pageWidth && s.properties?.pageHeight
            ? { width: s.properties.pageWidth, height: s.properties.pageHeight }
            : void 0,
        isLandscape: s.properties?.orientation === 'landscape',
        hasHeader: !!s.properties?.headerReferences?.length,
        hasFooter: !!s.properties?.footerReferences?.length,
      }));
    return {
      paragraphCount: n.length,
      wordCount: this.getWordCount(),
      characterCount: this.getCharacterCount(),
      variables: this.getVariables(),
      variableCount: this.getVariables().length,
      availableStyles: this.getStyles(),
      outline: a,
      sections: o,
      hasTables: this.getTableCount() > 0,
      hasImages: this._hasImages(),
      hasHyperlinks: this._hasHyperlinks(),
    };
  }
  insertText(t, e, n = {}) {
    let a = { type: 'insertText', position: t, text: e, formatting: n.formatting };
    return this._executeCommand(a);
  }
  replaceRange(t, e, n = {}) {
    let a = { type: 'replaceText', range: t, text: e, formatting: n.formatting };
    return this._executeCommand(a);
  }
  deleteRange(t) {
    let e = { type: 'deleteText', range: t };
    return this._executeCommand(e);
  }
  applyFormatting(t, e) {
    let n = { type: 'formatText', range: t, formatting: e };
    return this._executeCommand(n);
  }
  applyStyle(t, e) {
    let n = { type: 'applyStyle', paragraphIndex: t, styleId: e };
    return this._executeCommand(n);
  }
  applyParagraphFormatting(t, e) {
    let n = { type: 'formatParagraph', paragraphIndex: t, formatting: e };
    return this._executeCommand(n);
  }
  insertTable(t, e, n, a = {}) {
    let o = {
      type: 'insertTable',
      position: t,
      rows: e,
      columns: n,
      data: a.data,
      hasHeader: a.hasHeader,
    };
    return this._executeCommand(o);
  }
  insertImage(t, e, n = {}) {
    let a = {
      type: 'insertImage',
      position: t,
      src: e,
      width: n.width,
      height: n.height,
      alt: n.alt,
    };
    return this._executeCommand(a);
  }
  insertHyperlink(t, e, n = {}) {
    let a = {
      type: 'insertHyperlink',
      range: t,
      url: e,
      displayText: n.displayText,
      tooltip: n.tooltip,
    };
    return this._executeCommand(a);
  }
  removeHyperlink(t) {
    let e = { type: 'removeHyperlink', range: t };
    return this._executeCommand(e);
  }
  insertParagraphBreak(t) {
    let e = { type: 'insertParagraphBreak', position: t };
    return this._executeCommand(e);
  }
  mergeParagraphs(t, e) {
    let n = { type: 'mergeParagraphs', paragraphIndex: t, count: e };
    return this._executeCommand(n);
  }
  setVariable(t, e) {
    return ((this._pendingVariables[t] = e), this);
  }
  setVariables(t) {
    for (let [e, n] of Object.entries(t)) this._pendingVariables[e] = n;
    return this;
  }
  getPendingVariables() {
    return { ...this._pendingVariables };
  }
  clearPendingVariables() {
    return ((this._pendingVariables = {}), this);
  }
  async applyVariables(t) {
    let e = { ...this._pendingVariables, ...t };
    if (Object.keys(e).length === 0) return this;
    let n = this._document.originalBuffer;
    if (!n) throw new Error('Cannot apply variables: no original buffer for processing');
    let { processTemplate: a } = await import('./processTemplate-MQGSL7MS.js'),
      o = a(n, e),
      s = await chunkZ2UPNKQW_js.n(o),
      i = new r(s);
    return ((i._pendingVariables = {}), i);
  }
  async toBuffer(t) {
    if (this._document.originalBuffer) {
      if (t?.selective) {
        let n = await Y(this._document, this._document.originalBuffer, t.selective);
        if (n) return ((this._document.originalBuffer = n), n);
      }
      let e = await chunk2GSKZFWS_js.f(this._document);
      return ((this._document.originalBuffer = e), e);
    }
    return chunk2GSKZFWS_js.l(this._document);
  }
  async toBlob(t = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    let e = await this.toBuffer();
    return new Blob([e], { type: t });
  }
  executeCommands(t) {
    return new r(chunkAARNCPWR_js.b(this._document, t));
  }
  _executeCommand(t) {
    let e = new r(chunkAARNCPWR_js.a(this._document, t));
    return ((e._pendingVariables = { ...this._pendingVariables }), e);
  }
  _getBodyText(t) {
    let e = [];
    for (let n of t.content)
      n.type === 'paragraph'
        ? e.push(this._getParagraphText(n))
        : n.type === 'table' && e.push(this._getTableText(n));
    return e.join(`
`);
  }
  _getParagraphText(t) {
    let e = [];
    for (let n of t.content)
      n.type === 'run'
        ? e.push(this._getRunText(n))
        : n.type === 'hyperlink' && e.push(this._getHyperlinkText(n));
    return e.join('');
  }
  _getRunText(t) {
    return t.content
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join('');
  }
  _getHyperlinkText(t) {
    let e = [];
    for (let n of t.children) n.type === 'run' && e.push(this._getRunText(n));
    return e.join('');
  }
  _getTableText(t) {
    let e = [];
    for (let n of t.rows)
      for (let a of n.cells)
        for (let o of a.content) o.type === 'paragraph' && e.push(this._getParagraphText(o));
    return e.join('	');
  }
  _extractParagraphSegments(t, e) {
    for (let n of t.content)
      if (n.type === 'run') {
        let a = this._getRunText(n);
        a && e.push({ text: a, formatting: n.formatting });
      } else if (n.type === 'hyperlink') {
        let a = n.href || '';
        for (let o of n.children)
          if (o.type === 'run') {
            let s = this._getRunText(o);
            s && e.push({ text: s, formatting: o.formatting, isHyperlink: true, hyperlinkUrl: a });
          }
      }
  }
  _parseHeadingLevel(t) {
    if (!t) return;
    let e = t.match(/heading\s*(\d)/i);
    if (e) return parseInt(e[1], 10);
  }
  _hasImages() {
    let t = this._document.package.document;
    for (let e of t.content)
      if (e.type === 'paragraph') {
        for (let n of e.content)
          if (n.type === 'run') {
            for (let a of n.content) if (a.type === 'drawing') return true;
          }
      }
    return false;
  }
  _hasHyperlinks() {
    let t = this._document.package.document;
    for (let e of t.content)
      if (e.type === 'paragraph') {
        for (let n of e.content) if (n.type === 'hyperlink') return true;
      }
    return false;
  }
};
async function Gt(r) {
  return T.fromBuffer(r);
}
function Zt(r) {
  return T.fromDocument(r);
}
function ot(r, t = {}) {
  let { outlineMaxChars: e = 100, maxOutlineParagraphs: n = 50 } = t,
    a = r.package.document,
    o = a.content.filter((m) => m.type === 'paragraph'),
    s = it(o, e, n),
    i = chunkWIRZTO37_js.a(r),
    c = st(r),
    l = ct(a),
    u = lt(a),
    g = pt(a),
    f = a.content.some((m) => m.type === 'table'),
    y = ft(a),
    p = mt(a);
  return {
    paragraphCount: o.length,
    wordCount: u,
    characterCount: g,
    variables: i,
    variableCount: i.length,
    availableStyles: c,
    outline: s,
    sections: l,
    hasTables: f,
    hasImages: y,
    hasHyperlinks: p,
  };
}
function Qt(r, t, e = {}) {
  let { contextChars: n = 200, includeSuggestions: a = true } = e,
    s = r.package.document.content.filter((x) => x.type === 'paragraph'),
    i = s[t.start.paragraphIndex];
  if (!i) throw new Error(`Paragraph not found at index ${t.start.paragraphIndex}`);
  let c = h(i),
    l = '';
  if (t.start.paragraphIndex === t.end.paragraphIndex) l = c.slice(t.start.offset, t.end.offset);
  else {
    let x = [];
    for (let C = t.start.paragraphIndex; C <= t.end.paragraphIndex; C++) {
      let H = s[C];
      if (!H) continue;
      let w = h(H);
      C === t.start.paragraphIndex
        ? x.push(w.slice(t.start.offset))
        : C === t.end.paragraphIndex
          ? x.push(w.slice(0, t.end.offset))
          : x.push(w);
    }
    l = x.join(`
`);
  }
  let u = yt(s, t.start.paragraphIndex, t.start.offset, n),
    g = xt(s, t.end.paragraphIndex, t.end.offset, n),
    f = bt(i, t.start.offset),
    y = i.formatting || {},
    p = {
      index: t.start.paragraphIndex,
      fullText: c,
      style: i.formatting?.styleId,
      wordCount: F(c),
    },
    m = false,
    b = Pt(i, t.start.offset),
    d = a ? Ct(l) : [];
  return {
    selectedText: l,
    range: t,
    formatting: f,
    paragraphFormatting: y,
    textBefore: u,
    textAfter: g,
    paragraph: p,
    inTable: m,
    inHyperlink: b,
    suggestedActions: d,
  };
}
function K(r) {
  let t = ot(r, { outlineMaxChars: 50, maxOutlineParagraphs: 10 }),
    e = [`Document with ${t.paragraphCount} paragraphs, ${t.wordCount} words.`];
  (t.hasTables && e.push('Contains tables.'),
    t.hasImages && e.push('Contains images.'),
    t.hasHyperlinks && e.push('Contains hyperlinks.'),
    t.variableCount > 0 &&
      e.push(`Has ${t.variableCount} template variables: ${t.variables.join(', ')}`));
  let n = t.outline.filter((a) => a.isHeading);
  if (n.length > 0) {
    e.push(`
Headings:`);
    for (let a of n.slice(0, 5)) {
      let o = a.headingLevel || 1;
      e.push(`${'  '.repeat(o - 1)}- ${a.preview}`);
    }
    n.length > 5 && e.push(`  ... and ${n.length - 5} more headings`);
  }
  return e.join(' ');
}
function it(r, t, e) {
  let n = [];
  for (let a = 0; a < Math.min(r.length, e); a++) {
    let o = r[a],
      s = h(o),
      i = o.formatting?.styleId;
    n.push({
      index: a,
      preview: s.slice(0, t),
      style: i,
      isHeading: dt(i),
      headingLevel: ht(i),
      isListItem: !!o.listRendering,
      isEmpty: s.trim().length === 0,
    });
  }
  return n;
}
function st(r) {
  let t = r.package.styles;
  if (!t?.styles) return [];
  let e = [];
  for (let [n, a] of Object.entries(t.styles))
    if (typeof a == 'object' && a !== null) {
      let o = a;
      e.push({
        id: n,
        name: o.name || n,
        type: o.type === 'numbering' ? 'paragraph' : o.type || 'paragraph',
        builtIn: o.default,
      });
    }
  return e;
}
function ct(r) {
  return r.sections
    ? r.sections.map((t, e) => ({
        index: e,
        paragraphCount: t.content?.length || 0,
        pageSize:
          t.properties?.pageWidth && t.properties?.pageHeight
            ? { width: t.properties.pageWidth, height: t.properties.pageHeight }
            : void 0,
        isLandscape: t.properties?.orientation === 'landscape',
        hasHeader: !!t.properties?.headerReferences?.length,
        hasFooter: !!t.properties?.footerReferences?.length,
      }))
    : [];
}
function lt(r) {
  let t = 0;
  for (let e of r.content)
    if (e.type === 'paragraph') {
      let n = h(e);
      t += F(n);
    } else e.type === 'table' && (t += ut(e));
  return t;
}
function F(r) {
  return r.split(/\s+/).filter((e) => e.length > 0).length;
}
function pt(r) {
  let t = 0;
  for (let e of r.content)
    if (e.type === 'paragraph') {
      let n = h(e);
      t += n.length;
    } else e.type === 'table' && (t += gt(e));
  return t;
}
function ut(r) {
  let t = 0;
  for (let e of r.rows)
    for (let n of e.cells)
      for (let a of n.content)
        if (a.type === 'paragraph') {
          let o = h(a);
          t += F(o);
        }
  return t;
}
function gt(r) {
  let t = 0;
  for (let e of r.rows)
    for (let n of e.cells)
      for (let a of n.content)
        if (a.type === 'paragraph') {
          let o = h(a);
          t += o.length;
        }
  return t;
}
function h(r) {
  let t = [];
  for (let e of r.content) e.type === 'run' ? t.push(k(e)) : e.type === 'hyperlink' && t.push(v(e));
  return t.join('');
}
function k(r) {
  return r.content
    .filter((t) => t.type === 'text')
    .map((t) => t.text)
    .join('');
}
function v(r) {
  let t = [];
  for (let e of r.children) e.type === 'run' && t.push(k(e));
  return t.join('');
}
function ft(r) {
  for (let t of r.content)
    if (t.type === 'paragraph') {
      for (let e of t.content)
        if (e.type === 'run') {
          for (let n of e.content) if (n.type === 'drawing') return true;
        }
    }
  return false;
}
function mt(r) {
  for (let t of r.content)
    if (t.type === 'paragraph') {
      for (let e of t.content) if (e.type === 'hyperlink') return true;
    }
  return false;
}
function dt(r) {
  return r ? r.toLowerCase().includes('heading') : false;
}
function ht(r) {
  if (!r) return;
  let t = r.match(/heading\s*(\d)/i);
  if (t) return parseInt(t[1], 10);
}
function yt(r, t, e, n) {
  let a = [],
    o = 0,
    s = r[t];
  if (s) {
    let l = h(s).slice(0, e);
    (a.unshift(l), (o += l.length));
  }
  for (let c = t - 1; c >= 0 && o < n; c--) {
    let l = r[c];
    if (!l) continue;
    let u = h(l);
    (a.unshift(u), (o += u.length));
  }
  let i = a.join(`
`);
  return i.length > n ? '...' + i.slice(-n) : i;
}
function xt(r, t, e, n) {
  let a = [],
    o = 0,
    s = r[t];
  if (s) {
    let l = h(s).slice(e);
    (a.push(l), (o += l.length));
  }
  for (let c = t + 1; c < r.length && o < n; c++) {
    let l = r[c];
    if (!l) continue;
    let u = h(l);
    (a.push(u), (o += u.length));
  }
  let i = a.join(`
`);
  return i.length > n ? i.slice(0, n) + '...' : i;
}
function bt(r, t) {
  let e = 0;
  for (let n of r.content)
    if (n.type === 'run') {
      let a = k(n),
        o = e,
        s = e + a.length;
      if (t >= o && t < s) return n.formatting || {};
      e = s;
    } else if (n.type === 'hyperlink') {
      let a = v(n),
        o = e,
        s = e + a.length;
      if (t >= o && t < s) {
        for (let i of n.children) if (i.type === 'run') return i.formatting || {};
      }
      e = s;
    }
  return {};
}
function Pt(r, t) {
  let e = 0;
  for (let n of r.content)
    if (n.type === 'run') {
      let a = k(n);
      e += a.length;
    } else if (n.type === 'hyperlink') {
      let a = v(n),
        o = e,
        s = e + a.length;
      if (t >= o && t < s) return true;
      e = s;
    }
  return false;
}
function Ct(r, t, e) {
  let n = [];
  return (
    r.length > 0 &&
      (n.push(
        { id: 'rewrite', label: 'Rewrite', description: 'Rewrite this text', priority: 10 },
        { id: 'summarize', label: 'Summarize', description: 'Summarize this text', priority: 9 }
      ),
      r.length > 200 &&
        n.push({
          id: 'summarize',
          label: 'Summarize',
          description: 'Create a shorter version',
          priority: 8,
        }),
      r.length < 50 &&
        r.split(/\s+/).length < 10 &&
        n.push({ id: 'expand', label: 'Expand', description: 'Add more details', priority: 8 }),
      n.push({
        id: 'fixGrammar',
        label: 'Fix Grammar',
        description: 'Fix grammar and spelling',
        priority: 7,
      }),
      n.push({
        id: 'translate',
        label: 'Translate',
        description: 'Translate to another language',
        priority: 6,
      }),
      n.push(
        { id: 'makeFormal', label: 'Make Formal', description: 'Use formal tone', priority: 5 },
        { id: 'makeCasual', label: 'Make Casual', description: 'Use casual tone', priority: 4 }
      )),
    n.sort((a, o) => (o.priority || 0) - (a.priority || 0)),
    n
  );
}
function St(r, t, e = {}) {
  let { contextCharsBefore: n = 200, contextCharsAfter: a = 200, includeSuggestions: o = true } = e,
    s = r.package.document,
    i = s.content.filter((x) => x.type === 'paragraph');
  if (t.start.paragraphIndex >= i.length)
    throw new Error(`Invalid start paragraph index: ${t.start.paragraphIndex}`);
  let c = i[t.start.paragraphIndex],
    l = At(i, t),
    u = Tt(i, t.start, n),
    g = kt(i, t.end, a),
    f = It(c, t.start.offset),
    y = c.formatting || {},
    p = {
      index: t.start.paragraphIndex,
      fullText: P(c),
      style: c.formatting?.styleId,
      wordCount: R(P(c)),
    },
    m = Dt(s, t.start),
    b = _t(c, t.start.offset),
    d = o ? Ft(l) : [];
  return {
    selectedText: l,
    range: t,
    formatting: f,
    paragraphFormatting: y,
    textBefore: u,
    textAfter: g,
    paragraph: p,
    inTable: m,
    inHyperlink: b,
    suggestedActions: d,
  };
}
function ne(r, t, e = {}) {
  let n = St(r, t, e),
    { includeDocumentSummary: a = true } = e,
    s = r.package.document.content.filter((p) => p.type === 'paragraph'),
    i = R(n.selectedText),
    c = n.selectedText.length,
    l = t.start.paragraphIndex !== t.end.paragraphIndex,
    u = [];
  for (let p = t.start.paragraphIndex; p <= t.end.paragraphIndex; p++) u.push(p);
  let g = vt(s, t),
    f = a ? K(r) : void 0,
    y = Rt(n.selectedText);
  return {
    ...n,
    documentSummary: f,
    wordCount: i,
    characterCount: c,
    isMultiParagraph: l,
    paragraphIndices: u,
    detectedLanguage: y,
    contentType: g,
  };
}
function re(r, t) {
  let n = r.package.document.content.filter((i) => i.type === 'paragraph'),
    a = [];
  for (let i = t.start.paragraphIndex; i <= t.end.paragraphIndex; i++) {
    let c = n[i];
    if (!c) continue;
    let l = i === t.start.paragraphIndex ? t.start.offset : 0,
      u = i === t.end.paragraphIndex ? t.end.offset : 1 / 0;
    wt(c, l, u, a);
  }
  let o = a.length <= 1 || a.every((i) => Ht(i, a[0]));
  return { predominant: a.length > 0 ? a[0] : {}, isConsistent: o, allFormatting: a };
}
function At(r, t) {
  if (t.start.paragraphIndex === t.end.paragraphIndex) {
    let n = r[t.start.paragraphIndex];
    return n ? P(n).slice(t.start.offset, t.end.offset) : '';
  }
  let e = [];
  for (let n = t.start.paragraphIndex; n <= t.end.paragraphIndex; n++) {
    let a = r[n];
    if (!a) continue;
    let o = P(a);
    n === t.start.paragraphIndex
      ? e.push(o.slice(t.start.offset))
      : n === t.end.paragraphIndex
        ? e.push(o.slice(0, t.end.offset))
        : e.push(o);
  }
  return e.join(`
`);
}
function Tt(r, t, e) {
  let n = [],
    a = 0,
    o = r[t.paragraphIndex];
  if (o) {
    let c = P(o).slice(0, t.offset);
    (n.unshift(c), (a += c.length));
  }
  for (let i = t.paragraphIndex - 1; i >= 0 && a < e; i--) {
    let c = r[i];
    if (!c) continue;
    let l = P(c);
    (n.unshift(l), (a += l.length));
  }
  let s = n.join(`
`);
  return s.length > e ? '...' + s.slice(-e) : s;
}
function kt(r, t, e) {
  let n = [],
    a = 0,
    o = r[t.paragraphIndex];
  if (o) {
    let c = P(o).slice(t.offset);
    (n.push(c), (a += c.length));
  }
  for (let i = t.paragraphIndex + 1; i < r.length && a < e; i++) {
    let c = r[i];
    if (!c) continue;
    let l = P(c);
    (n.push(l), (a += l.length));
  }
  let s = n.join(`
`);
  return s.length > e ? s.slice(0, e) + '...' : s;
}
function It(r, t) {
  let e = 0;
  for (let n of r.content)
    if (n.type === 'run') {
      let a = S(n),
        o = e + a.length;
      if (t >= e && t < o) return n.formatting || {};
      e = o;
    } else if (n.type === 'hyperlink') {
      let a = I(n),
        o = e + a.length;
      if (t >= e && t < o) {
        for (let s of n.children) if (s.type === 'run') return s.formatting || {};
      }
      e = o;
    }
  return {};
}
function wt(r, t, e, n) {
  let a = 0;
  for (let o of r.content)
    if (o.type === 'run') {
      let s = S(o),
        i = a,
        c = a + s.length;
      (c > t && i < e && o.formatting && n.push({ ...o.formatting }), (a = c));
    } else if (o.type === 'hyperlink') {
      let s = I(o),
        i = a,
        c = a + s.length;
      if (c > t && i < e)
        for (let l of o.children) l.type === 'run' && l.formatting && n.push({ ...l.formatting });
      a = c;
    }
}
function Dt(r, t) {
  return false;
}
function _t(r, t) {
  let e = 0;
  for (let n of r.content)
    if (n.type === 'run') {
      let a = S(n);
      e += a.length;
    } else if (n.type === 'hyperlink') {
      let a = I(n),
        o = e,
        s = e + a.length;
      if (t >= o && t < s) return true;
      e = s;
    }
  return false;
}
function Ft(r, t, e) {
  let n = [];
  if (!r || r.trim().length === 0) return n;
  n.push(
    { id: 'askAI', label: 'Ask AI', description: 'Ask AI about this text', priority: 11 },
    { id: 'rewrite', label: 'Rewrite', description: 'Rewrite this text differently', priority: 10 }
  );
  let a = R(r);
  return (
    a > 50 &&
      n.push({
        id: 'summarize',
        label: 'Summarize',
        description: 'Create a shorter version',
        priority: 9,
      }),
    a < 20 &&
      n.push({ id: 'expand', label: 'Expand', description: 'Add more details', priority: 9 }),
    n.push(
      {
        id: 'fixGrammar',
        label: 'Fix Grammar',
        description: 'Fix grammar and spelling',
        priority: 7,
      },
      {
        id: 'translate',
        label: 'Translate',
        description: 'Translate to another language',
        priority: 6,
      },
      { id: 'explain', label: 'Explain', description: 'Explain what this means', priority: 5 }
    ),
    n.push(
      { id: 'makeFormal', label: 'Make Formal', description: 'Use formal tone', priority: 4 },
      { id: 'makeCasual', label: 'Make Casual', description: 'Use casual tone', priority: 3 }
    ),
    n.sort((o, s) => (s.priority || 0) - (o.priority || 0)),
    n
  );
}
function vt(r, t) {
  let e = new Set();
  for (let n = t.start.paragraphIndex; n <= t.end.paragraphIndex; n++) {
    let a = r[n];
    a &&
      (a.listRendering
        ? e.add('list')
        : a.formatting?.styleId?.toLowerCase().includes('heading')
          ? e.add('heading')
          : e.add('prose'));
  }
  return e.size > 1 ? 'mixed' : e.has('list') ? 'list' : e.has('heading') ? 'heading' : 'prose';
}
function Rt(r) {
  return /[а-яА-ЯёЁ]/.test(r)
    ? 'ru'
    : /[一-龯]/.test(r)
      ? 'zh'
      : /[ひらがなカタカナ]/.test(r) || /[\u3040-\u309F\u30A0-\u30FF]/.test(r)
        ? 'ja'
        : /[가-힣]/.test(r)
          ? 'ko'
          : /[àâäéèêëïîôùûüç]/i.test(r)
            ? 'fr'
            : /[äöüß]/i.test(r)
              ? 'de'
              : /[áéíóúñ]/i.test(r)
                ? 'es'
                : 'en';
}
function P(r) {
  let t = [];
  for (let e of r.content) e.type === 'run' ? t.push(S(e)) : e.type === 'hyperlink' && t.push(I(e));
  return t.join('');
}
function S(r) {
  return r.content
    .filter((t) => t.type === 'text')
    .map((t) => t.text)
    .join('');
}
function I(r) {
  let t = [];
  for (let e of r.children) e.type === 'run' && t.push(S(e));
  return t.join('');
}
function R(r) {
  return r.split(/\s+/).filter((t) => t.length > 0).length;
}
function Ht(r, t) {
  let e = Object.keys(r),
    n = Object.keys(t);
  return e.length !== n.length
    ? false
    : e.every((a) => {
        let o = r[a],
          s = t[a];
        return o === s;
      });
}
exports.a = tt;
exports.b = Z;
exports.c = Y;
exports.d = at;
exports.e = Wt;
exports.f = T;
exports.g = Gt;
exports.h = Zt;
exports.i = ot;
exports.j = Qt;
exports.k = K;
exports.l = St;
exports.m = ne;
exports.n = re;
