'use strict';
require('./chunk-H5NTJZO4.js');
var react = require('react'),
  jsxRuntime = require('react/jsx-runtime');
var C = {
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
  P = {
    backgroundColor: 'white',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    minWidth: 360,
    maxWidth: 440,
    width: '100%',
    margin: 20,
  },
  T = {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--doc-border)',
    fontSize: 16,
    fontWeight: 600,
  },
  k = { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  c = { display: 'flex', alignItems: 'center', gap: 12 },
  u = { width: 80, fontSize: 13, color: 'var(--doc-text-muted)' },
  x = {
    flex: 1,
    padding: '6px 8px',
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    fontSize: 13,
  },
  S = { ...x },
  R = {
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--doc-border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  h = {
    padding: '6px 16px',
    fontSize: 13,
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    cursor: 'pointer',
  };
function z({ isOpen: n, onClose: r, onApply: y, currentProps: i }) {
  let [a, b] = react.useState(i?.width || 0),
    [l, f] = react.useState(i?.widthType || 'auto'),
    [p, g] = react.useState(i?.justification || 'left');
  react.useEffect(() => {
    n && (b(i?.width || 0), f(i?.widthType || 'auto'), g(i?.justification || 'left'));
  }, [n, i]);
  let d = react.useCallback(() => {
      let t = {};
      (l === 'auto'
        ? ((t.width = null), (t.widthType = 'auto'))
        : ((t.width = a), (t.widthType = l)),
        (t.justification = p),
        y(t),
        r());
    }, [a, l, p, y, r]),
    w = react.useCallback(
      (t) => {
        (t.key === 'Escape' && r(), t.key === 'Enter' && d());
      },
      [r, d]
    );
  return n
    ? jsxRuntime.jsx('div', {
        style: C,
        onClick: r,
        onKeyDown: w,
        children: jsxRuntime.jsxs('div', {
          style: P,
          onClick: (t) => t.stopPropagation(),
          role: 'dialog',
          'aria-label': 'Table properties',
          children: [
            jsxRuntime.jsx('div', { style: T, children: 'Table Properties' }),
            jsxRuntime.jsxs('div', {
              style: k,
              children: [
                jsxRuntime.jsxs('div', {
                  style: c,
                  children: [
                    jsxRuntime.jsx('label', { style: u, children: 'Width type' }),
                    jsxRuntime.jsxs('select', {
                      style: S,
                      value: l,
                      onChange: (t) => f(t.target.value),
                      children: [
                        jsxRuntime.jsx('option', { value: 'auto', children: 'Auto' }),
                        jsxRuntime.jsx('option', { value: 'dxa', children: 'Fixed (twips)' }),
                        jsxRuntime.jsx('option', { value: 'pct', children: 'Percentage' }),
                      ],
                    }),
                  ],
                }),
                l !== 'auto' &&
                  jsxRuntime.jsxs('div', {
                    style: c,
                    children: [
                      jsxRuntime.jsx('label', { style: u, children: 'Width' }),
                      jsxRuntime.jsx('input', {
                        type: 'number',
                        style: x,
                        min: 0,
                        step: l === 'pct' ? 5 : 100,
                        value: a,
                        onChange: (t) => b(Number(t.target.value) || 0),
                      }),
                      jsxRuntime.jsx('span', {
                        style: { fontSize: 11, color: 'var(--doc-text-muted)' },
                        children: l === 'pct' ? '(50ths of %)' : 'tw',
                      }),
                    ],
                  }),
                jsxRuntime.jsxs('div', {
                  style: c,
                  children: [
                    jsxRuntime.jsx('label', { style: u, children: 'Alignment' }),
                    jsxRuntime.jsxs('select', {
                      style: S,
                      value: p,
                      onChange: (t) => g(t.target.value),
                      children: [
                        jsxRuntime.jsx('option', { value: 'left', children: 'Left' }),
                        jsxRuntime.jsx('option', { value: 'center', children: 'Center' }),
                        jsxRuntime.jsx('option', { value: 'right', children: 'Right' }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: R,
              children: [
                jsxRuntime.jsx('button', {
                  type: 'button',
                  style: h,
                  onClick: r,
                  children: 'Cancel',
                }),
                jsxRuntime.jsx('button', {
                  type: 'button',
                  style: {
                    ...h,
                    backgroundColor: 'var(--doc-primary)',
                    color: 'white',
                    borderColor: 'var(--doc-primary)',
                  },
                  onClick: d,
                  children: 'Apply',
                }),
              ],
            }),
          ],
        }),
      })
    : null;
}
exports.TablePropertiesDialog = z;
