'use strict';
require('./chunk-H5NTJZO4.js');
var react = require('react'),
  jsxRuntime = require('react/jsx-runtime');
var D = {
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
  k = {
    backgroundColor: 'white',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    minWidth: 380,
    maxWidth: 440,
    width: '100%',
    margin: 20,
  },
  w = {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--doc-border)',
    fontSize: 16,
    fontWeight: 600,
  },
  R = { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 },
  h = { display: 'flex', flexDirection: 'column', gap: 8 },
  C = { fontSize: 13, fontWeight: 600, color: 'var(--doc-text)' },
  v = { display: 'flex', alignItems: 'center', gap: 8 },
  u = { width: 60, fontSize: 12, color: 'var(--doc-text-muted)' },
  s = {
    flex: 1,
    padding: '4px 6px',
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    fontSize: 12,
  },
  z = { ...s },
  A = { ...s, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' },
  B = {
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--doc-border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  P = {
    padding: '6px 16px',
    fontSize: 13,
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    cursor: 'pointer',
  };
function T({ isOpen: p, onClose: i, onApply: g, currentData: l }) {
  let [c, S] = react.useState(''),
    [r, x] = react.useState(0),
    [d, y] = react.useState('#000000'),
    [a, f] = react.useState('solid');
  react.useEffect(() => {
    p &&
      (S(l?.alt ?? ''),
      x(l?.borderWidth ?? 0),
      y(l?.borderColor ?? '#000000'),
      f(l?.borderStyle ?? 'solid'));
  }, [p, l]);
  let b = react.useCallback(() => {
      (g({
        alt: c || void 0,
        borderWidth: r > 0 ? r : void 0,
        borderColor: r > 0 ? d : void 0,
        borderStyle: r > 0 ? a : void 0,
      }),
        i());
    }, [c, r, d, a, g, i]),
    I = react.useCallback(
      (t) => {
        (t.key === 'Escape' && i(), t.key === 'Enter' && !t.shiftKey && b());
      },
      [i, b]
    );
  return p
    ? jsxRuntime.jsx('div', {
        style: D,
        onClick: i,
        onKeyDown: I,
        children: jsxRuntime.jsxs('div', {
          style: k,
          onClick: (t) => t.stopPropagation(),
          role: 'dialog',
          'aria-label': 'Image properties',
          children: [
            jsxRuntime.jsx('div', { style: w, children: 'Image Properties' }),
            jsxRuntime.jsxs('div', {
              style: R,
              children: [
                jsxRuntime.jsxs('div', {
                  style: h,
                  children: [
                    jsxRuntime.jsx('div', { style: C, children: 'Alt Text' }),
                    jsxRuntime.jsx('textarea', {
                      style: A,
                      value: c,
                      onChange: (t) => S(t.target.value),
                      placeholder: 'Describe this image for accessibility...',
                    }),
                  ],
                }),
                jsxRuntime.jsxs('div', {
                  style: h,
                  children: [
                    jsxRuntime.jsx('div', { style: C, children: 'Border' }),
                    jsxRuntime.jsxs('div', {
                      style: v,
                      children: [
                        jsxRuntime.jsx('label', { style: u, children: 'Width' }),
                        jsxRuntime.jsx('input', {
                          type: 'number',
                          style: { ...s, maxWidth: 80 },
                          min: 0,
                          max: 20,
                          step: 0.5,
                          value: r,
                          onChange: (t) => x(Number(t.target.value) || 0),
                        }),
                        jsxRuntime.jsx('span', {
                          style: { fontSize: 12, color: 'var(--doc-text-muted)' },
                          children: 'px',
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs('div', {
                      style: v,
                      children: [
                        jsxRuntime.jsx('label', { style: u, children: 'Style' }),
                        jsxRuntime.jsxs('select', {
                          style: z,
                          value: a,
                          onChange: (t) => f(t.target.value),
                          children: [
                            jsxRuntime.jsx('option', { value: 'solid', children: 'Solid' }),
                            jsxRuntime.jsx('option', { value: 'dashed', children: 'Dashed' }),
                            jsxRuntime.jsx('option', { value: 'dotted', children: 'Dotted' }),
                            jsxRuntime.jsx('option', { value: 'double', children: 'Double' }),
                            jsxRuntime.jsx('option', { value: 'groove', children: 'Groove' }),
                            jsxRuntime.jsx('option', { value: 'ridge', children: 'Ridge' }),
                            jsxRuntime.jsx('option', { value: 'inset', children: 'Inset' }),
                            jsxRuntime.jsx('option', { value: 'outset', children: 'Outset' }),
                          ],
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs('div', {
                      style: v,
                      children: [
                        jsxRuntime.jsx('label', { style: u, children: 'Color' }),
                        jsxRuntime.jsx('input', {
                          type: 'color',
                          value: d,
                          onChange: (t) => y(t.target.value),
                          style: {
                            width: 32,
                            height: 24,
                            padding: 0,
                            border: '1px solid var(--doc-border)',
                            borderRadius: 4,
                            cursor: 'pointer',
                          },
                        }),
                        jsxRuntime.jsx('input', {
                          type: 'text',
                          style: { ...s, maxWidth: 90 },
                          value: d,
                          onChange: (t) => y(t.target.value),
                        }),
                      ],
                    }),
                    r > 0 &&
                      jsxRuntime.jsx('div', {
                        style: {
                          marginTop: 4,
                          padding: 8,
                          border: `${r}px ${a} ${d}`,
                          borderRadius: 4,
                          fontSize: 11,
                          color: 'var(--doc-text-muted)',
                          textAlign: 'center',
                        },
                        children: 'Preview',
                      }),
                  ],
                }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: B,
              children: [
                jsxRuntime.jsx('button', {
                  type: 'button',
                  style: P,
                  onClick: i,
                  children: 'Cancel',
                }),
                jsxRuntime.jsx('button', {
                  type: 'button',
                  style: {
                    ...P,
                    backgroundColor: 'var(--doc-primary)',
                    color: 'white',
                    borderColor: 'var(--doc-primary)',
                  },
                  onClick: b,
                  children: 'Apply',
                }),
              ],
            }),
          ],
        }),
      })
    : null;
}
exports.ImagePropertiesDialog = T;
