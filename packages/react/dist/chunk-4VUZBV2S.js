'use strict';
var d = {
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2: '44546A',
    lt2: 'E7E6E6',
    accent1: '4472C4',
    accent2: 'ED7D31',
    accent3: 'A5A5A5',
    accent4: 'FFC000',
    accent5: '5B9BD5',
    accent6: '70AD47',
    hlink: '0563C1',
    folHlink: '954F72',
  },
  T = {
    black: '000000',
    blue: '0000FF',
    cyan: '00FFFF',
    darkBlue: '00008B',
    darkCyan: '008B8B',
    darkGray: 'A9A9A9',
    darkGreen: '006400',
    darkMagenta: '8B008B',
    darkRed: '8B0000',
    darkYellow: '808000',
    green: '00FF00',
    lightGray: 'D3D3D3',
    magenta: 'FF00FF',
    red: 'FF0000',
    white: 'FFFFFF',
    yellow: 'FFFF00',
    none: '',
  },
  h = {
    dk1: 'dk1',
    lt1: 'lt1',
    dk2: 'dk2',
    lt2: 'lt2',
    accent1: 'accent1',
    accent2: 'accent2',
    accent3: 'accent3',
    accent4: 'accent4',
    accent5: 'accent5',
    accent6: 'accent6',
    hlink: 'hlink',
    folHlink: 'folHlink',
    dark1: 'dk1',
    light1: 'lt1',
    dark2: 'dk2',
    light2: 'lt2',
    hyperlink: 'hlink',
    followedHyperlink: 'folHlink',
    background1: 'lt1',
    text1: 'dk1',
    background2: 'lt2',
    text2: 'dk2',
    tx1: 'dk1',
    tx2: 'dk2',
    bg1: 'lt1',
    bg2: 'lt2',
  };
function b(e) {
  if (!e) return 1;
  let t = parseInt(e, 16);
  return isNaN(t) ? 1 : t / 255;
}
function c(e) {
  let t = e.padStart(6, '0').slice(0, 6),
    n = parseInt(t.slice(0, 2), 16),
    r = parseInt(t.slice(2, 4), 16),
    l = parseInt(t.slice(4, 6), 16);
  return { r: isNaN(n) ? 0 : n, g: isNaN(r) ? 0 : r, b: isNaN(l) ? 0 : l };
}
function g(e, t, n) {
  let r = (l) =>
    Math.max(0, Math.min(255, Math.round(l)))
      .toString(16)
      .padStart(2, '0');
  return `${r(e)}${r(t)}${r(n)}`.toUpperCase();
}
function p(e, t, n) {
  ((e /= 255), (t /= 255), (n /= 255));
  let r = Math.max(e, t, n),
    l = Math.min(e, t, n),
    o = (r + l) / 2;
  if (r === l) return { h: 0, s: 0, l: o };
  let u = r - l,
    i = o > 0.5 ? u / (2 - r - l) : u / (r + l),
    a;
  switch (r) {
    case e:
      a = ((t - n) / u + (t < n ? 6 : 0)) / 6;
      break;
    case t:
      a = ((n - e) / u + 2) / 6;
      break;
    case n:
      a = ((e - t) / u + 4) / 6;
      break;
    default:
      a = 0;
  }
  return { h: a * 360, s: i, l: o };
}
function C(e, t, n) {
  if (((e = e / 360), t === 0)) {
    let u = Math.round(n * 255);
    return { r: u, g: u, b: u };
  }
  let r = (u, i, a) => (
      a < 0 && (a += 1),
      a > 1 && (a -= 1),
      a < 1 / 6
        ? u + (i - u) * 6 * a
        : a < 1 / 2
          ? i
          : a < 2 / 3
            ? u + (i - u) * (2 / 3 - a) * 6
            : u
    ),
    l = n < 0.5 ? n * (1 + t) : n + t - n * t,
    o = 2 * n - l;
  return {
    r: Math.round(r(o, l, e + 1 / 3) * 255),
    g: Math.round(r(o, l, e) * 255),
    b: Math.round(r(o, l, e - 1 / 3) * 255),
  };
}
function f(e, t) {
  if (t <= 0 || t >= 1) return t >= 1 ? 'FFFFFF' : e;
  let n = c(e),
    r = p(n.r, n.g, n.b);
  r.l = r.l + (1 - r.l) * t;
  let l = C(r.h, r.s, r.l);
  return g(l.r, l.g, l.b);
}
function m(e, t) {
  if (t <= 0 || t >= 1) return t <= 0 ? '000000' : e;
  let n = c(e),
    r = p(n.r, n.g, n.b);
  r.l = r.l * t;
  let l = C(r.h, r.s, r.l);
  return g(l.r, l.g, l.b);
}
function k(e, t) {
  let n = h[t] ?? t,
    r = [
      'dk1',
      'lt1',
      'dk2',
      'lt2',
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
      'hlink',
      'folHlink',
    ],
    l = (o) => r.includes(o);
  return e?.colorScheme
    ? l(n)
      ? (e.colorScheme[n] ?? d[n] ?? '000000')
      : '000000'
    : l(n)
      ? (d[n] ?? '000000')
      : '000000';
}
function x(e) {
  if (!e) return null;
  let t = e.toLowerCase();
  return h[e] ?? h[t] ?? null;
}
function s(e, t, n = '000000') {
  if (!e) return `#${n}`;
  if (e.auto) return `#${n}`;
  let r;
  if (e.themeColor) {
    let l = x(e.themeColor);
    if ((l ? (r = k(t, l)) : (r = e.rgb ?? n), e.themeTint)) {
      let o = b(e.themeTint);
      r = f(r, o);
    } else if (e.themeShade) {
      let o = b(e.themeShade);
      r = m(r, o);
    }
  } else e.rgb ? (r = e.rgb === 'auto' ? n : e.rgb) : (r = n);
  return `#${r.toUpperCase().replace(/^#/, '')}`;
}
function S(e) {
  if (!e || e === 'none') return '';
  let t = T[e];
  return t ? `#${t}` : '';
}
function v(e, t) {
  return e ? (e.auto ? 'transparent' : s(e, t)) : '';
}
function M(e, t) {
  if (!e) return false;
  if (e.auto) return true;
  let r = s(e, t).replace(/^#/, '').toLowerCase(),
    l = c(r);
  return (l.r + l.g + l.b) / 3 < 20;
}
function A(e, t) {
  if (!e) return false;
  let r = s(e, t).replace(/^#/, '').toLowerCase(),
    l = c(r);
  return (l.r + l.g + l.b) / 3 > 235;
}
function H(e, t) {
  if (!e) return '#000000';
  let r = s(e, t).replace(/^#/, ''),
    l = c(r);
  return (0.299 * l.r + 0.587 * l.g + 0.114 * l.b) / 255 > 0.5 ? '#000000' : '#FFFFFF';
}
function R(e) {
  if (!e) return;
  let t = e.trim();
  if (t.toLowerCase() === 'auto') return { auto: true };
  let n = x(t);
  if (n) return { themeColor: n };
  let r = t.replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/i.test(r)
    ? { rgb: r }
    : /^[0-9A-F]{3}$/i.test(r)
      ? {
          rgb: r
            .split('')
            .map((o) => o + o)
            .join(''),
        }
      : { rgb: r.padStart(6, '0').slice(0, 6) };
}
function E(e, t, n) {
  let r = { themeColor: e };
  return (
    t !== void 0 &&
      t > 0 &&
      t < 1 &&
      (r.themeTint = Math.round(t * 255)
        .toString(16)
        .toUpperCase()
        .padStart(2, '0')),
    n !== void 0 &&
      n > 0 &&
      n < 1 &&
      (r.themeShade = Math.round(n * 255)
        .toString(16)
        .toUpperCase()
        .padStart(2, '0')),
    r
  );
}
function $(e) {
  return { rgb: e.replace(/^#/, '').toUpperCase() };
}
function L(e, t, n) {
  let l = s(e, t).replace(/^#/, ''),
    o = 1 - n / 100;
  return `#${m(l, o)}`;
}
function B(e, t, n) {
  let l = s(e, t).replace(/^#/, ''),
    o = n / 100;
  return `#${f(l, o)}`;
}
function U(e, t, n, r) {
  let l = s(e, r).replace(/^#/, ''),
    o = s(t, r).replace(/^#/, ''),
    u = c(l),
    i = c(o),
    a = {
      r: Math.round(u.r * (1 - n) + i.r * n),
      g: Math.round(u.g * (1 - n) + i.g * n),
      b: Math.round(u.b * (1 - n) + i.b * n),
    };
  return `#${g(a.r, a.g, a.b)}`;
}
function F(e) {
  return e.startsWith('#') ? e : `#${e}`;
}
function D(e) {
  return S(e) || F(e);
}
var y = [
    { slot: 'lt1', name: 'Background 1' },
    { slot: 'dk1', name: 'Text 1' },
    { slot: 'lt2', name: 'Background 2' },
    { slot: 'dk2', name: 'Text 2' },
    { slot: 'accent1', name: 'Accent 1' },
    { slot: 'accent2', name: 'Accent 2' },
    { slot: 'accent3', name: 'Accent 3' },
    { slot: 'accent4', name: 'Accent 4' },
    { slot: 'accent5', name: 'Accent 5' },
    { slot: 'accent6', name: 'Accent 6' },
  ],
  V = [
    { type: 'base', value: 0, hexValue: '', labelSuffix: '' },
    { type: 'tint', value: 0.8, hexValue: 'CC', labelSuffix: ', Lighter 80%' },
    { type: 'tint', value: 0.6, hexValue: '99', labelSuffix: ', Lighter 60%' },
    { type: 'tint', value: 0.4, hexValue: '66', labelSuffix: ', Lighter 40%' },
    { type: 'shade', value: 0.75, hexValue: 'BF', labelSuffix: ', Darker 25%' },
    { type: 'shade', value: 0.5, hexValue: '80', labelSuffix: ', Darker 50%' },
  ];
function I(e, t, n) {
  return t === 'tint' ? f(e, n) : m(e, n);
}
function _(e) {
  let t = e ?? d;
  return V.map((n) =>
    y.map((r) => {
      let l = t[r.slot] ?? d[r.slot] ?? '000000',
        o;
      n.type === 'base'
        ? (o = l.toUpperCase())
        : n.type === 'tint'
          ? (o = f(l, n.value))
          : (o = m(l, n.value));
      let u = { hex: o, themeSlot: r.slot, label: `${r.name}${n.labelSuffix}` };
      return (
        n.type === 'tint' && n.hexValue
          ? (u.tint = n.hexValue)
          : n.type === 'shade' && n.hexValue && (u.shade = n.hexValue),
        u
      );
    })
  );
}
function O(e, t, n) {
  if (!e && !t) return true;
  if (!e || !t) return false;
  let r = s(e, n).toUpperCase(),
    l = s(t, n).toUpperCase();
  return r === l;
}
exports.a = s;
exports.b = S;
exports.c = v;
exports.d = M;
exports.e = A;
exports.f = H;
exports.g = R;
exports.h = E;
exports.i = $;
exports.j = L;
exports.k = B;
exports.l = U;
exports.m = F;
exports.n = D;
exports.o = I;
exports.p = _;
exports.q = O;
