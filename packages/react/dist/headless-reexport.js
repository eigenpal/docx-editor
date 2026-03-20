'use strict';
var chunkQVPR2W5S_js = require('./chunk-QVPR2W5S.js'),
  chunk5LKX24UR_js = require('./chunk-5LKX24UR.js'),
  chunk4VUZBV2S_js = require('./chunk-4VUZBV2S.js'),
  chunkWIRZTO37_js = require('./chunk-WIRZTO37.js'),
  chunkR2CVPAO4_js = require('./chunk-R2CVPAO4.js'),
  chunk2GSKZFWS_js = require('./chunk-2GSKZFWS.js'),
  chunkAARNCPWR_js = require('./chunk-AARNCPWR.js'),
  chunkZ2UPNKQW_js = require('./chunk-Z2UPNKQW.js'),
  chunkBUEMG4NW_js = require('./chunk-BUEMG4NW.js'),
  chunkSE5EN2QL_js = require('./chunk-SE5EN2QL.js');
(require('./chunk-USRMBYI6.js'), require('./chunk-H5NTJZO4.js'));
function l(n) {
  let e = [];
  for (let t of n.content) t.type === 'run' ? e.push(c(t)) : t.type === 'hyperlink' && e.push(g(t));
  return e.join('');
}
function c(n) {
  return n.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('');
}
function g(n) {
  let e = [];
  for (let t of n.children) t.type === 'run' && e.push(c(t));
  return e.join('');
}
function f(n) {
  let e = [];
  for (let t of n.rows)
    for (let o of t.cells) for (let r of o.content) r.type === 'paragraph' && e.push(l(r));
  return e.join('	');
}
function Ne(n) {
  let e = [];
  for (let t of n.content)
    t.type === 'paragraph' ? e.push(l(t)) : t.type === 'table' && e.push(f(t));
  return e.join(`
`);
}
function m(n) {
  return n.split(/\s+/).filter((t) => t.length > 0).length;
}
function qe(n, e = true) {
  return e ? n.length : n.replace(/\s/g, '').length;
}
function Ze(n) {
  let e = 0;
  for (let t of n.content)
    t.type === 'paragraph' ? (e += m(l(t))) : t.type === 'table' && (e += _e(t));
  return e;
}
function _e(n) {
  let e = 0;
  for (let t of n.rows)
    for (let o of t.cells) for (let r of o.content) r.type === 'paragraph' && (e += m(l(r)));
  return e;
}
function Je(n) {
  let e = 0;
  for (let t of n.content)
    t.type === 'paragraph' ? (e += l(t).length) : t.type === 'table' && (e += Ue(t));
  return e;
}
function Ue(n) {
  let e = 0;
  for (let t of n.rows)
    for (let o of t.cells) for (let r of o.content) r.type === 'paragraph' && (e += l(r).length);
  return e;
}
function Xe(n, e, t) {
  let o = [],
    r = 0,
    i = n[e.paragraphIndex];
  if (i) {
    let s = l(i).slice(0, e.offset);
    (o.unshift(s), (r += s.length));
  }
  for (let p = e.paragraphIndex - 1; p >= 0 && r < t; p--) {
    let s = n[p];
    if (!s) continue;
    let u = l(s);
    (o.unshift(u), (r += u.length));
  }
  let a = o.join(`
`);
  return a.length > t ? '...' + a.slice(-t) : a;
}
function Ge(n, e, t) {
  let o = [],
    r = 0,
    i = n[e.paragraphIndex];
  if (i) {
    let s = l(i).slice(e.offset);
    (o.push(s), (r += s.length));
  }
  for (let p = e.paragraphIndex + 1; p < n.length && r < t; p++) {
    let s = n[p];
    if (!s) continue;
    let u = l(s);
    (o.push(u), (r += u.length));
  }
  let a = o.join(`
`);
  return a.length > t ? a.slice(0, t) + '...' : a;
}
function Ke(n, e) {
  let t = 0;
  for (let o of n.content)
    if (o.type === 'run') {
      let r = c(o),
        i = t + r.length;
      if (e >= t && e < i) return o.formatting || {};
      t = i;
    } else if (o.type === 'hyperlink') {
      let r = g(o),
        i = t + r.length;
      if (e >= t && e < i) {
        for (let a of o.children) if (a.type === 'run') return a.formatting || {};
      }
      t = i;
    }
  return {};
}
function Qe(n, e) {
  let t = 0;
  for (let o of n.content)
    if (o.type === 'run') {
      let r = c(o);
      t += r.length;
    } else if (o.type === 'hyperlink') {
      let r = g(o),
        i = t,
        a = t + r.length;
      if (e >= i && e < a) return true;
      t = a;
    }
  return false;
}
function Ye(n, e) {
  let t = 0;
  for (let o of n.content)
    if (o.type === 'run') {
      let r = c(o);
      t += r.length;
    } else if (o.type === 'hyperlink') {
      let r = g(o),
        i = t,
        a = t + r.length;
      if (e >= i && e < a) return o;
      t = a;
    }
}
function $e(n) {
  return n ? n.toLowerCase().includes('heading') : false;
}
function et(n) {
  if (!n) return;
  let e = n.match(/heading\s*(\d)/i);
  if (e) return parseInt(e[1], 10);
}
function tt(n) {
  for (let e of n.content)
    if (e.type === 'paragraph') {
      for (let t of e.content)
        if (t.type === 'run') {
          for (let o of t.content) if (o.type === 'drawing') return true;
        }
    }
  return false;
}
function nt(n) {
  for (let e of n.content)
    if (e.type === 'paragraph') {
      for (let t of e.content) if (t.type === 'hyperlink') return true;
    }
  return false;
}
function ot(n) {
  return n.content.some((e) => e.type === 'table');
}
function x(n) {
  return n.content.filter((e) => e.type === 'paragraph');
}
function rt(n, e) {
  return x(n)[e];
}
function at(n, e) {
  let t = 0;
  for (let o = 0; o < n.content.length; o++)
    if (n.content[o].type === 'paragraph') {
      if (t === e) return o;
      t++;
    }
  return -1;
}
var st = '0.0.2';
Object.defineProperty(exports, 'DEFAULT_AI_ACTIONS', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.g;
  },
});
Object.defineProperty(exports, 'comparePositions', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.d;
  },
});
Object.defineProperty(exports, 'createCollapsedRange', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.a;
  },
});
Object.defineProperty(exports, 'createCommand', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.h;
  },
});
Object.defineProperty(exports, 'createRange', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.b;
  },
});
Object.defineProperty(exports, 'getActionDescription', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.f;
  },
});
Object.defineProperty(exports, 'getActionLabel', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.e;
  },
});
Object.defineProperty(exports, 'isPositionInRange', {
  enumerable: true,
  get: function () {
    return chunkQVPR2W5S_js.c;
  },
});
Object.defineProperty(exports, 'DocumentAgent', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.f;
  },
});
Object.defineProperty(exports, 'attemptSelectiveSave', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.c;
  },
});
Object.defineProperty(exports, 'buildExtendedSelectionContext', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.m;
  },
});
Object.defineProperty(exports, 'buildPatchedDocumentXml', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.b;
  },
});
Object.defineProperty(exports, 'buildSelectionContext', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.l;
  },
});
Object.defineProperty(exports, 'buildSelectionContextFromContext', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.j;
  },
});
Object.defineProperty(exports, 'createAgent', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.g;
  },
});
Object.defineProperty(exports, 'createAgentFromDocument', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.h;
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
Object.defineProperty(exports, 'getSelectionFormattingSummary', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.n;
  },
});
Object.defineProperty(exports, 'validatePatchSafety', {
  enumerable: true,
  get: function () {
    return chunk5LKX24UR_js.a;
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
Object.defineProperty(exports, 'detectVariables', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.a;
  },
});
Object.defineProperty(exports, 'detectVariablesDetailed', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.b;
  },
});
Object.defineProperty(exports, 'detectVariablesInBody', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.c;
  },
});
Object.defineProperty(exports, 'detectVariablesInParagraph', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.d;
  },
});
Object.defineProperty(exports, 'documentHasVariables', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.m;
  },
});
Object.defineProperty(exports, 'extractVariablesFromText', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.e;
  },
});
Object.defineProperty(exports, 'formatVariable', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.i;
  },
});
Object.defineProperty(exports, 'hasTemplateVariables', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.f;
  },
});
Object.defineProperty(exports, 'isValidVariableName', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.g;
  },
});
Object.defineProperty(exports, 'isZodSchema', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.n;
  },
});
Object.defineProperty(exports, 'parseVariable', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.j;
  },
});
Object.defineProperty(exports, 'removeVariables', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.l;
  },
});
Object.defineProperty(exports, 'replaceVariables', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.k;
  },
});
Object.defineProperty(exports, 'sanitizeVariableName', {
  enumerable: true,
  get: function () {
    return chunkWIRZTO37_js.h;
  },
});
Object.defineProperty(exports, 'createTemplateProcessor', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.j;
  },
});
Object.defineProperty(exports, 'getMissingVariables', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.g;
  },
});
Object.defineProperty(exports, 'getTemplateTags', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.e;
  },
});
Object.defineProperty(exports, 'previewTemplate', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.h;
  },
});
Object.defineProperty(exports, 'processTemplate', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.a;
  },
});
Object.defineProperty(exports, 'processTemplateAdvanced', {
  enumerable: true,
  get: function () {
    return chunkR2CVPAO4_js.i;
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
Object.defineProperty(exports, 'createDocx', {
  enumerable: true,
  get: function () {
    return chunk2GSKZFWS_js.l;
  },
});
Object.defineProperty(exports, 'repackDocx', {
  enumerable: true,
  get: function () {
    return chunk2GSKZFWS_js.f;
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
Object.defineProperty(exports, 'updateMultipleFiles', {
  enumerable: true,
  get: function () {
    return chunk2GSKZFWS_js.h;
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
Object.defineProperty(exports, 'parseDocx', {
  enumerable: true,
  get: function () {
    return chunkZ2UPNKQW_js.n;
  },
});
Object.defineProperty(exports, 'PluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkBUEMG4NW_js.a;
  },
});
Object.defineProperty(exports, 'createPluginRegistrar', {
  enumerable: true,
  get: function () {
    return chunkBUEMG4NW_js.d;
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
exports.VERSION = st;
exports.countCharacters = qe;
exports.countWords = m;
exports.getBlockIndexForParagraph = at;
exports.getBodyCharacterCount = Je;
exports.getBodyText = Ne;
exports.getBodyWordCount = Ze;
exports.getFormattingAtPosition = Ke;
exports.getHyperlinkAtPosition = Ye;
exports.getHyperlinkText = g;
exports.getParagraphAtIndex = rt;
exports.getParagraphText = l;
exports.getParagraphs = x;
exports.getRunText = c;
exports.getTableText = f;
exports.getTextAfter = Ge;
exports.getTextBefore = Xe;
exports.hasHyperlinks = nt;
exports.hasImages = tt;
exports.hasTables = ot;
exports.isHeadingStyle = $e;
exports.isPositionInHyperlink = Qe;
exports.parseHeadingLevel = et;
