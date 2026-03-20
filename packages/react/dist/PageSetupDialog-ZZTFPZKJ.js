'use strict';
(require('./chunk-SE5EN2QL.js'), require('./chunk-H5NTJZO4.js'));
var react = require('react'),
  jsxRuntime = require('react/jsx-runtime');
var I = [
  { label: 'Letter (8.5" \xD7 11")', width: 12240, height: 15840 },
  { label: 'A4 (8.27" \xD7 11.69")', width: 11906, height: 16838 },
  { label: 'Legal (8.5" \xD7 14")', width: 12240, height: 20160 },
  { label: 'A3 (11.69" \xD7 16.54")', width: 16838, height: 23811 },
  { label: 'A5 (5.83" \xD7 8.27")', width: 8391, height: 11906 },
  { label: 'B5 (6.93" \xD7 9.84")', width: 9979, height: 14175 },
  { label: 'Executive (7.25" \xD7 10.5")', width: 10440, height: 15120 },
];
function v(i) {
  return Math.round((i / 1440) * 100) / 100;
}
function f(i) {
  return Math.round(i * 1440);
}
function O(i, a) {
  let h = Math.min(i, a),
    n = Math.max(i, a);
  return I.findIndex((l) => Math.abs(l.width - h) < 20 && Math.abs(l.height - n) < 20);
}
var Z = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1e4,
  },
  q = {
    backgroundColor: 'white',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    minWidth: 400,
    maxWidth: 480,
    width: '100%',
    margin: 20,
  },
  J = {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--doc-border)',
    fontSize: 16,
    fontWeight: 600,
  },
  Q = { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 },
  A = {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--doc-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  c = { display: 'flex', alignItems: 'center', gap: 12 },
  g = { width: 80, fontSize: 13, color: 'var(--doc-text-muted)' },
  b = {
    flex: 1,
    padding: '6px 8px',
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    fontSize: 13,
  },
  W = { ...b },
  x = { fontSize: 11, color: 'var(--doc-text-muted)', width: 16 },
  V = {
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--doc-border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  H = {
    padding: '6px 16px',
    fontSize: 13,
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    cursor: 'pointer',
  },
  N = 12240,
  B = 15840,
  s = 1440;
function ee({ isOpen: i, onClose: a, onApply: h, currentProps: n }) {
  let [l, y] = react.useState(N),
    [u, m] = react.useState(B),
    [p, M] = react.useState('portrait'),
    [C, R] = react.useState(s),
    [P, z] = react.useState(s),
    [w, k] = react.useState(s),
    [T, D] = react.useState(s);
  react.useEffect(() => {
    if (!i) return;
    let e = n?.pageWidth || N,
      r = n?.pageHeight || B,
      U = n?.orientation || (e > r ? 'landscape' : 'portrait');
    (y(e),
      m(r),
      M(U),
      R(n?.marginTop ?? s),
      z(n?.marginBottom ?? s),
      k(n?.marginLeft ?? s),
      D(n?.marginRight ?? s));
  }, [i, n]);
  let F = react.useCallback(
      (e) => {
        if (e < 0) return;
        let r = I[e];
        p === 'landscape' ? (y(r.height), m(r.width)) : (y(r.width), m(r.height));
      },
      [p]
    ),
    G = react.useCallback(
      (e) => {
        e !== p && (M(e), y(u), m(l));
      },
      [p, l, u]
    ),
    E = react.useCallback(() => {
      (h({
        pageWidth: l,
        pageHeight: u,
        orientation: p,
        marginTop: C,
        marginBottom: P,
        marginLeft: w,
        marginRight: T,
      }),
        a());
    }, [l, u, p, C, P, w, T, h, a]),
    K = react.useCallback(
      (e) => {
        (e.key === 'Escape' && a(), e.key === 'Enter' && E());
      },
      [a, E]
    );
  if (!i) return null;
  let L = O(l, u);
  return jsxRuntime.jsx('div', {
    style: Z,
    onClick: a,
    onKeyDown: K,
    children: jsxRuntime.jsxs('div', {
      style: q,
      onClick: (e) => e.stopPropagation(),
      onMouseDown: (e) => e.stopPropagation(),
      role: 'dialog',
      'aria-label': 'Page setup',
      children: [
        jsxRuntime.jsx('div', { style: J, children: 'Page Setup' }),
        jsxRuntime.jsxs('div', {
          style: Q,
          children: [
            jsxRuntime.jsx('div', { style: A, children: 'Page Size' }),
            jsxRuntime.jsxs('div', {
              style: c,
              children: [
                jsxRuntime.jsx('label', { style: g, children: 'Size' }),
                jsxRuntime.jsxs('select', {
                  style: W,
                  value: L,
                  onChange: (e) => F(Number(e.target.value)),
                  children: [
                    I.map((e, r) =>
                      jsxRuntime.jsx('option', { value: r, children: e.label }, e.label)
                    ),
                    L < 0 && jsxRuntime.jsx('option', { value: -1, children: 'Custom' }),
                  ],
                }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: c,
              children: [
                jsxRuntime.jsx('label', { style: g, children: 'Orientation' }),
                jsxRuntime.jsxs('select', {
                  style: W,
                  value: p,
                  onChange: (e) => G(e.target.value),
                  children: [
                    jsxRuntime.jsx('option', { value: 'portrait', children: 'Portrait' }),
                    jsxRuntime.jsx('option', { value: 'landscape', children: 'Landscape' }),
                  ],
                }),
              ],
            }),
            jsxRuntime.jsx('div', { style: { ...A, marginTop: 4 }, children: 'Margins' }),
            jsxRuntime.jsxs('div', {
              style: c,
              children: [
                jsxRuntime.jsx('label', { style: g, children: 'Top' }),
                jsxRuntime.jsx('input', {
                  type: 'number',
                  style: b,
                  min: 0,
                  max: 10,
                  step: 0.1,
                  value: v(C),
                  onChange: (e) => R(f(Number(e.target.value) || 0)),
                }),
                jsxRuntime.jsx('span', { style: x, children: 'in' }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: c,
              children: [
                jsxRuntime.jsx('label', { style: g, children: 'Bottom' }),
                jsxRuntime.jsx('input', {
                  type: 'number',
                  style: b,
                  min: 0,
                  max: 10,
                  step: 0.1,
                  value: v(P),
                  onChange: (e) => z(f(Number(e.target.value) || 0)),
                }),
                jsxRuntime.jsx('span', { style: x, children: 'in' }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: c,
              children: [
                jsxRuntime.jsx('label', { style: g, children: 'Left' }),
                jsxRuntime.jsx('input', {
                  type: 'number',
                  style: b,
                  min: 0,
                  max: 10,
                  step: 0.1,
                  value: v(w),
                  onChange: (e) => k(f(Number(e.target.value) || 0)),
                }),
                jsxRuntime.jsx('span', { style: x, children: 'in' }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: c,
              children: [
                jsxRuntime.jsx('label', { style: g, children: 'Right' }),
                jsxRuntime.jsx('input', {
                  type: 'number',
                  style: b,
                  min: 0,
                  max: 10,
                  step: 0.1,
                  value: v(T),
                  onChange: (e) => D(f(Number(e.target.value) || 0)),
                }),
                jsxRuntime.jsx('span', { style: x, children: 'in' }),
              ],
            }),
          ],
        }),
        jsxRuntime.jsxs('div', {
          style: V,
          children: [
            jsxRuntime.jsx('button', { type: 'button', style: H, onClick: a, children: 'Cancel' }),
            jsxRuntime.jsx('button', {
              type: 'button',
              style: {
                ...H,
                backgroundColor: 'var(--doc-primary)',
                color: 'white',
                borderColor: 'var(--doc-primary)',
              },
              onClick: E,
              children: 'Apply',
            }),
          ],
        }),
      ],
    }),
  });
}
exports.PageSetupDialog = ee;
