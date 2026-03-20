'use strict';
var p = require('pizzip'),
  l = require('docxtemplater');
function _interopDefault(e) {
  return e && e.__esModule ? e : { default: e };
}
var p__default = /*#__PURE__*/ _interopDefault(p);
var l__default = /*#__PURE__*/ _interopDefault(l);
function T(e, r, t = {}) {
  return b(e, r, t).buffer;
}
function b(e, r, t = {}) {
  let { nullGetter: n = 'keep', linebreaks: s = true, delimiters: o } = t,
    a = [],
    i = [],
    g = [];
  try {
    let d = new p__default.default(e),
      m = new l__default.default(d, {
        paragraphLoop: !0,
        linebreaks: s,
        nullGetter: (c) => {
          let f = c.value || '';
          if (n === 'error') throw new Error(`Undefined variable: ${f}`);
          return n === 'empty' ? (g.push(f), '') : (g.push(f), `{${f}}`);
        },
        delimiters: o ? { start: o.start || '{', end: o.end || '}' } : void 0,
      });
    return (
      Object.keys(r).forEach((c) => {
        r[c] !== void 0 && r[c] !== null && i.push(c);
      }),
      m.setData(r),
      m.render(),
      {
        buffer: m
          .getZip()
          .generate({
            type: 'arraybuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
          }),
        replacedVariables: i,
        unreplacedVariables: g,
        warnings: a,
      }
    );
  } catch (d) {
    throw u(d);
  }
}
function x(e, r, t = {}) {
  let n = T(e, r, t);
  return new Blob([n], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
function k(e, r, t = 'document', n = {}) {
  let s = x(e, r, n);
  E(s, `${t}.docx`);
}
function R(e) {
  try {
    let r = new p__default.default(e),
      n = new l__default.default(r, { paragraphLoop: !0, linebreaks: !0 }).getFullText();
    return y(n);
  } catch (r) {
    throw u(r);
  }
}
function D(e) {
  let r = [],
    t = [];
  try {
    let n = new p__default.default(e),
      o = new l__default.default(n, { paragraphLoop: !0, linebreaks: !0 }).getFullText();
    t = y(o);
    let a = h(o);
    for (let i of a) r.push({ message: `Unclosed tag: ${i}`, variable: i, type: 'parse' });
    return { valid: r.length === 0, errors: r, tags: t };
  } catch (n) {
    return (r.push(u(n)), { valid: false, errors: r, tags: t });
  }
}
function L(e, r) {
  return e.filter((t) => !(t in r) || r[t] === void 0 || r[t] === null);
}
function O(e, r) {
  try {
    let t = new p__default.default(e),
      n = new l__default.default(t, {
        paragraphLoop: !0,
        linebreaks: !0,
        nullGetter: (s) => `[${s.value || ''}]`,
      });
    return (n.setData(r), n.render(), n.getFullText());
  } catch (t) {
    throw u(t);
  }
}
function y(e) {
  let r = [],
    t = /\{([^{}]+)\}/g,
    n;
  for (; (n = t.exec(e)) !== null; ) {
    let s = n[1].trim();
    s && !r.includes(s) && r.push(s);
  }
  return r.sort();
}
function h(e) {
  let r = [],
    t = 0,
    n = '';
  for (let s of e)
    s === '{' ? (t++, (n = '')) : s === '}' ? (t--, t < 0 && (t = 0)) : t > 0 && (n += s);
  return (t > 0 && n.trim() && r.push(n.trim()), r);
}
function w(e) {
  return 'properties' in e && typeof e.properties == 'object';
}
function u(e) {
  if (e instanceof Error) {
    if (w(e) && e.properties?.errors) {
      let r = e.properties.errors[0];
      return {
        message: r?.message || 'Template processing error',
        variable: r?.properties?.tag,
        type: 'render',
        originalError: e,
      };
    }
    if (e.message.includes('undefined')) {
      let r = e.message.match(/undefined (?:variable|tag):\s*(\S+)/i);
      return {
        message: e.message,
        variable: r ? r[1] : void 0,
        type: 'undefined',
        originalError: e,
      };
    }
    return e.message.includes('parse') ||
      e.message.includes('unclosed') ||
      e.message.includes('syntax')
      ? { message: e.message, type: 'parse', originalError: e }
      : { message: e.message, type: 'unknown', originalError: e };
  }
  return { message: String(e), type: 'unknown' };
}
function E(e, r) {
  let t = URL.createObjectURL(e),
    n = document.createElement('a');
  ((n.href = t),
    (n.download = r),
    document.body.appendChild(n),
    n.click(),
    document.body.removeChild(n),
    URL.revokeObjectURL(t));
}
function P(e, r, t = {}) {
  let { linebreaks: n = true, delimiters: s } = t;
  try {
    let o = new p__default.default(e),
      a = new l__default.default(o, {
        paragraphLoop: !0,
        linebreaks: n,
        delimiters: s ? { start: s.start || '{', end: s.end || '}' } : void 0,
      });
    return (
      a.setData(r),
      a.render(),
      a.getZip().generate({ type: 'arraybuffer', compression: 'DEFLATE' })
    );
  } catch (o) {
    throw u(o);
  }
}
function U(e = {}) {
  return (r, t) => T(r, t, e);
}
var z = T;
exports.a = T;
exports.b = b;
exports.c = x;
exports.d = k;
exports.e = R;
exports.f = D;
exports.g = L;
exports.h = O;
exports.i = P;
exports.j = U;
exports.k = z; //# sourceMappingURL=chunk-WGRUTBZG.js.map
//# sourceMappingURL=chunk-WGRUTBZG.js.map
