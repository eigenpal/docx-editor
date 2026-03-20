'use strict';
var chunkXJCWBPY7_js = require('./chunk-XJCWBPY7.js'),
  chunkNGK4AG2P_js = require('./chunk-NGK4AG2P.js'),
  chunk6L7HNODA_js = require('./chunk-6L7HNODA.js'),
  chunk65V65RRX_js = require('./chunk-65V65RRX.js'),
  chunkWGRUTBZG_js = require('./chunk-WGRUTBZG.js'),
  chunk4FIPZCBR_js = require('./chunk-4FIPZCBR.js'),
  chunkAZGNVGHV_js = require('./chunk-AZGNVGHV.js');
require('./chunk-5XGN7UAV.js');
function p(t) {
  let e = [];
  for (let n of t.content) n.type === 'run' ? e.push(l(n)) : n.type === 'hyperlink' && e.push(g(n));
  return e.join('');
}
function l(t) {
  return t.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('');
}
function g(t) {
  let e = [];
  for (let n of t.children) n.type === 'run' && e.push(l(n));
  return e.join('');
}
function d(t) {
  let e = [];
  for (let n of t.rows)
    for (let r of n.cells) for (let o of r.content) o.type === 'paragraph' && e.push(p(o));
  return e.join('	');
}
function Ve(t) {
  let e = [];
  for (let n of t.content)
    n.type === 'paragraph' ? e.push(p(n)) : n.type === 'table' && e.push(d(n));
  return e.join(`
`);
}
function u(t) {
  return t.split(/\s+/).filter((n) => n.length > 0).length;
}
function Ee(t, e = true) {
  return e ? t.length : t.replace(/\s/g, '').length;
}
function Oe(t) {
  let e = 0;
  for (let n of t.content)
    n.type === 'paragraph' ? (e += u(p(n))) : n.type === 'table' && (e += Me(n));
  return e;
}
function Me(t) {
  let e = 0;
  for (let n of t.rows)
    for (let r of n.cells) for (let o of r.content) o.type === 'paragraph' && (e += u(p(o)));
  return e;
}
function Le(t) {
  let e = 0;
  for (let n of t.content)
    n.type === 'paragraph' ? (e += p(n).length) : n.type === 'table' && (e += ze(n));
  return e;
}
function ze(t) {
  let e = 0;
  for (let n of t.rows)
    for (let r of n.cells) for (let o of r.content) o.type === 'paragraph' && (e += p(o).length);
  return e;
}
function je(t, e, n) {
  let r = [],
    o = 0,
    i = t[e.paragraphIndex];
  if (i) {
    let s = p(i).slice(0, e.offset);
    (r.unshift(s), (o += s.length));
  }
  for (let m = e.paragraphIndex - 1; m >= 0 && o < n; m--) {
    let s = t[m];
    if (!s) continue;
    let c = p(s);
    (r.unshift(c), (o += c.length));
  }
  let a = r.join(`
`);
  return a.length > n ? '...' + a.slice(-n) : a;
}
function qe(t, e, n) {
  let r = [],
    o = 0,
    i = t[e.paragraphIndex];
  if (i) {
    let s = p(i).slice(e.offset);
    (r.push(s), (o += s.length));
  }
  for (let m = e.paragraphIndex + 1; m < t.length && o < n; m++) {
    let s = t[m];
    if (!s) continue;
    let c = p(s);
    (r.push(c), (o += c.length));
  }
  let a = r.join(`
`);
  return a.length > n ? a.slice(0, n) + '...' : a;
}
function We(t, e) {
  let n = 0;
  for (let r of t.content)
    if (r.type === 'run') {
      let o = l(r),
        i = n + o.length;
      if (e >= n && e < i) return r.formatting || {};
      n = i;
    } else if (r.type === 'hyperlink') {
      let o = g(r),
        i = n + o.length;
      if (e >= n && e < i) {
        for (let a of r.children) if (a.type === 'run') return a.formatting || {};
      }
      n = i;
    }
  return {};
}
function Ne(t, e) {
  let n = 0;
  for (let r of t.content)
    if (r.type === 'run') {
      let o = l(r);
      n += o.length;
    } else if (r.type === 'hyperlink') {
      let o = g(r),
        i = n,
        a = n + o.length;
      if (e >= i && e < a) return true;
      n = a;
    }
  return false;
}
function _e(t, e) {
  let n = 0;
  for (let r of t.content)
    if (r.type === 'run') {
      let o = l(r);
      n += o.length;
    } else if (r.type === 'hyperlink') {
      let o = g(r),
        i = n,
        a = n + o.length;
      if (e >= i && e < a) return r;
      n = a;
    }
}
function Ge(t) {
  return t ? t.toLowerCase().includes('heading') : false;
}
function Ue(t) {
  if (!t) return;
  let e = t.match(/heading\s*(\d)/i);
  if (e) return parseInt(e[1], 10);
}
function Ze(t) {
  for (let e of t.content)
    if (e.type === 'paragraph') {
      for (let n of e.content)
        if (n.type === 'run') {
          for (let r of n.content) if (r.type === 'drawing') return true;
        }
    }
  return false;
}
function $e(t) {
  for (let e of t.content)
    if (e.type === 'paragraph') {
      for (let n of e.content) if (n.type === 'hyperlink') return true;
    }
  return false;
}
function Je(t) {
  return t.content.some((e) => e.type === 'table');
}
function x(t) {
  return t.content.filter((e) => e.type === 'paragraph');
}
function Xe(t, e) {
  return x(t)[e];
}
function Ke(t, e) {
  let n = 0;
  for (let r = 0; r < t.content.length; r++)
    if (t.content[r].type === 'paragraph') {
      if (n === e) return r;
      n++;
    }
  return -1;
}
function Qe(t) {
  return { start: t, end: t, collapsed: true };
}
function Ye(t, e) {
  return {
    start: t,
    end: e,
    collapsed: t.paragraphIndex === e.paragraphIndex && t.offset === e.offset,
  };
}
function et(t, e) {
  return !(
    t.paragraphIndex < e.start.paragraphIndex ||
    (t.paragraphIndex === e.start.paragraphIndex && t.offset < e.start.offset) ||
    t.paragraphIndex > e.end.paragraphIndex ||
    (t.paragraphIndex === e.end.paragraphIndex && t.offset > e.end.offset)
  );
}
function tt(t, e) {
  return t.paragraphIndex < e.paragraphIndex
    ? -1
    : t.paragraphIndex > e.paragraphIndex
      ? 1
      : t.offset < e.offset
        ? -1
        : t.offset > e.offset
          ? 1
          : 0;
}
function nt(t) {
  return {
    askAI: 'Ask AI',
    rewrite: 'Rewrite',
    expand: 'Expand',
    summarize: 'Summarize',
    translate: 'Translate',
    explain: 'Explain',
    fixGrammar: 'Fix Grammar',
    makeFormal: 'Make Formal',
    makeCasual: 'Make Casual',
    custom: 'Custom Prompt',
  }[t];
}
function rt(t) {
  return {
    askAI: 'Ask AI a question about this text',
    rewrite: 'Rewrite this text in a different way',
    expand: 'Expand this text with more details',
    summarize: 'Summarize this text to be shorter',
    translate: 'Translate this text to another language',
    explain: 'Explain what this text means',
    fixGrammar: 'Fix grammar and spelling errors',
    makeFormal: 'Make the tone more formal',
    makeCasual: 'Make the tone more casual',
    custom: 'Enter a custom prompt',
  }[t];
}
var ot = ['askAI', 'rewrite', 'expand', 'summarize', 'translate', 'explain'];
function at(t) {
  return { ...t, id: it() };
}
function it() {
  return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
var mt = '0.0.2';
Object.defineProperty(exports, 'DocumentAgent', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.f;
  },
});
Object.defineProperty(exports, 'attemptSelectiveSave', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.c;
  },
});
Object.defineProperty(exports, 'blendColors', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.z;
  },
});
Object.defineProperty(exports, 'buildExtendedSelectionContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.m;
  },
});
Object.defineProperty(exports, 'buildPatchedDocumentXml', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.b;
  },
});
Object.defineProperty(exports, 'buildSelectionContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.l;
  },
});
Object.defineProperty(exports, 'buildSelectionContextFromContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.j;
  },
});
Object.defineProperty(exports, 'colorsEqual', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.E;
  },
});
Object.defineProperty(exports, 'createAgent', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.g;
  },
});
Object.defineProperty(exports, 'createAgentFromDocument', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.h;
  },
});
Object.defineProperty(exports, 'createDocumentWithText', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.e;
  },
});
Object.defineProperty(exports, 'createEmptyDocument', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.d;
  },
});
Object.defineProperty(exports, 'createRgbColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.w;
  },
});
Object.defineProperty(exports, 'createThemeColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.v;
  },
});
Object.defineProperty(exports, 'darkenColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.x;
  },
});
Object.defineProperty(exports, 'getAgentContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.i;
  },
});
Object.defineProperty(exports, 'getContrastingColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.t;
  },
});
Object.defineProperty(exports, 'getDocumentSummary', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.k;
  },
});
Object.defineProperty(exports, 'getSelectionFormattingSummary', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.n;
  },
});
Object.defineProperty(exports, 'isBlack', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.r;
  },
});
Object.defineProperty(exports, 'isWhite', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.s;
  },
});
Object.defineProperty(exports, 'lightenColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.y;
  },
});
Object.defineProperty(exports, 'parseColorString', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.u;
  },
});
Object.defineProperty(exports, 'resolveColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.o;
  },
});
Object.defineProperty(exports, 'resolveHighlightColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.p;
  },
});
Object.defineProperty(exports, 'resolveShadingColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.q;
  },
});
Object.defineProperty(exports, 'validatePatchSafety', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.a;
  },
});
Object.defineProperty(exports, 'detectVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.a;
  },
});
Object.defineProperty(exports, 'detectVariablesDetailed', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.b;
  },
});
Object.defineProperty(exports, 'detectVariablesInBody', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.c;
  },
});
Object.defineProperty(exports, 'detectVariablesInParagraph', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.d;
  },
});
Object.defineProperty(exports, 'documentHasVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.m;
  },
});
Object.defineProperty(exports, 'extractVariablesFromText', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.e;
  },
});
Object.defineProperty(exports, 'formatVariable', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.i;
  },
});
Object.defineProperty(exports, 'hasTemplateVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.f;
  },
});
Object.defineProperty(exports, 'isValidVariableName', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.g;
  },
});
Object.defineProperty(exports, 'isZodSchema', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.n;
  },
});
Object.defineProperty(exports, 'parseVariable', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.j;
  },
});
Object.defineProperty(exports, 'removeVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.l;
  },
});
Object.defineProperty(exports, 'replaceVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.k;
  },
});
Object.defineProperty(exports, 'sanitizeVariableName', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.h;
  },
});
Object.defineProperty(exports, 'createDocx', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.l;
  },
});
Object.defineProperty(exports, 'repackDocx', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.f;
  },
});
Object.defineProperty(exports, 'serializeDocumentBody', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.b;
  },
});
Object.defineProperty(exports, 'serializeDocx', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.c;
  },
});
Object.defineProperty(exports, 'serializeSectionProperties', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.a;
  },
});
Object.defineProperty(exports, 'updateMultipleFiles', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.h;
  },
});
Object.defineProperty(exports, 'emuToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.d;
  },
});
Object.defineProperty(exports, 'emuToTwips', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.f;
  },
});
Object.defineProperty(exports, 'formatPx', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.j;
  },
});
Object.defineProperty(exports, 'halfPointsToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.i;
  },
});
Object.defineProperty(exports, 'parseDocx', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.u;
  },
});
Object.defineProperty(exports, 'pixelsToEmu', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.e;
  },
});
Object.defineProperty(exports, 'pixelsToTwips', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.c;
  },
});
Object.defineProperty(exports, 'pointsToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.h;
  },
});
Object.defineProperty(exports, 'twipsToEmu', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.g;
  },
});
Object.defineProperty(exports, 'twipsToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.b;
  },
});
Object.defineProperty(exports, 'createTemplateProcessor', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.j;
  },
});
Object.defineProperty(exports, 'getMissingVariables', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.g;
  },
});
Object.defineProperty(exports, 'getTemplateTags', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.e;
  },
});
Object.defineProperty(exports, 'previewTemplate', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.h;
  },
});
Object.defineProperty(exports, 'processTemplate', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.a;
  },
});
Object.defineProperty(exports, 'processTemplateAdvanced', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.i;
  },
});
Object.defineProperty(exports, 'processTemplateAsBlob', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.c;
  },
});
Object.defineProperty(exports, 'processTemplateDetailed', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.b;
  },
});
Object.defineProperty(exports, 'validateTemplate', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.f;
  },
});
Object.defineProperty(exports, 'executeCommand', {
  enumerable: true,
  get: function () {
    return chunk4FIPZCBR_js.a;
  },
});
Object.defineProperty(exports, 'executeCommands', {
  enumerable: true,
  get: function () {
    return chunk4FIPZCBR_js.b;
  },
});
Object.defineProperty(exports, 'PluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.a;
  },
});
Object.defineProperty(exports, 'createPluginRegistrar', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.d;
  },
});
Object.defineProperty(exports, 'pluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.b;
  },
});
Object.defineProperty(exports, 'registerPlugins', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.c;
  },
});
exports.DEFAULT_AI_ACTIONS = ot;
exports.VERSION = mt;
exports.comparePositions = tt;
exports.countCharacters = Ee;
exports.countWords = u;
exports.createCollapsedRange = Qe;
exports.createCommand = at;
exports.createRange = Ye;
exports.getActionDescription = rt;
exports.getActionLabel = nt;
exports.getBlockIndexForParagraph = Ke;
exports.getBodyCharacterCount = Le;
exports.getBodyText = Ve;
exports.getBodyWordCount = Oe;
exports.getFormattingAtPosition = We;
exports.getHyperlinkAtPosition = _e;
exports.getHyperlinkText = g;
exports.getParagraphAtIndex = Xe;
exports.getParagraphText = p;
exports.getParagraphs = x;
exports.getRunText = l;
exports.getTableText = d;
exports.getTextAfter = qe;
exports.getTextBefore = je;
exports.hasHyperlinks = $e;
exports.hasImages = Ze;
exports.hasTables = Je;
exports.isHeadingStyle = Ge;
exports.isPositionInHyperlink = Ne;
exports.isPositionInRange = et;
exports.parseHeadingLevel = Ue; //# sourceMappingURL=headless.js.map
//# sourceMappingURL=headless.js.map
