'use strict';
require('./chunk-H5NTJZO4.js');
var react = require('react'),
  jsxRuntime = require('react/jsx-runtime');
var F = {
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
  G = {
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
  Q = { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 },
  w = { display: 'flex', flexDirection: 'column', gap: 8 },
  I = { fontSize: 13, fontWeight: 600, color: 'var(--doc-text)' },
  l = { display: 'flex', alignItems: 'center', gap: 8 },
  a = { width: 75, fontSize: 12, color: 'var(--doc-text-muted)' },
  s = {
    flex: 1,
    padding: '4px 6px',
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    fontSize: 12,
  },
  d = { ...s },
  U = {
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--doc-border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  K = {
    padding: '6px 16px',
    fontSize: 13,
    border: '1px solid var(--doc-border)',
    borderRadius: 4,
    cursor: 'pointer',
  };
function Z({ isOpen: f, onClose: r, onApply: D, currentData: n }) {
  let [v, u] = react.useState('align'),
    [y, k] = react.useState('center'),
    [c, z] = react.useState('column'),
    [b, A] = react.useState(0),
    [g, m] = react.useState('align'),
    [h, L] = react.useState('top'),
    [S, B] = react.useState('paragraph'),
    [x, M] = react.useState(0),
    [C, N] = react.useState(0),
    [P, E] = react.useState(0),
    [T, H] = react.useState(0),
    [R, V] = react.useState(0);
  react.useEffect(() => {
    if (!f) return;
    let e = n?.horizontal,
      p = n?.vertical;
    (e?.align ? (u('align'), k(e.align)) : e?.posOffset != null && (u('offset'), A(e.posOffset)),
      e?.relativeTo && z(e.relativeTo),
      p?.align ? (m('align'), L(p.align)) : p?.posOffset != null && (m('offset'), M(p.posOffset)),
      p?.relativeTo && B(p.relativeTo),
      N(n?.distTop ?? 0),
      E(n?.distBottom ?? 0),
      H(n?.distLeft ?? 0),
      V(n?.distRight ?? 0));
  }, [f, n]);
  let O = react.useCallback(() => {
      let e = {};
      ((e.horizontal = { relativeTo: c, ...(v === 'align' ? { align: y } : { posOffset: b }) }),
        (e.vertical = { relativeTo: S, ...(g === 'align' ? { align: h } : { posOffset: x }) }),
        (e.distTop = C),
        (e.distBottom = P),
        (e.distLeft = T),
        (e.distRight = R),
        D(e),
        r());
    }, [v, y, c, b, g, h, S, x, C, P, T, R, D, r]),
    j = react.useCallback(
      (e) => {
        (e.key === 'Escape' && r(), e.key === 'Enter' && O());
      },
      [r, O]
    );
  return f
    ? jsxRuntime.jsx('div', {
        style: F,
        onClick: r,
        onKeyDown: j,
        children: jsxRuntime.jsxs('div', {
          style: G,
          onClick: (e) => e.stopPropagation(),
          role: 'dialog',
          'aria-label': 'Image position',
          children: [
            jsxRuntime.jsx('div', { style: J, children: 'Image Position' }),
            jsxRuntime.jsxs('div', {
              style: Q,
              children: [
                jsxRuntime.jsxs('div', {
                  style: w,
                  children: [
                    jsxRuntime.jsx('div', { style: I, children: 'Horizontal' }),
                    jsxRuntime.jsxs('div', {
                      style: l,
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Position' }),
                        jsxRuntime.jsxs('select', {
                          style: d,
                          value: v,
                          onChange: (e) => u(e.target.value),
                          children: [
                            jsxRuntime.jsx('option', { value: 'align', children: 'Alignment' }),
                            jsxRuntime.jsx('option', { value: 'offset', children: 'Offset' }),
                          ],
                        }),
                      ],
                    }),
                    v === 'align'
                      ? jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', { style: a, children: 'Align' }),
                            jsxRuntime.jsxs('select', {
                              style: d,
                              value: y,
                              onChange: (e) => k(e.target.value),
                              children: [
                                jsxRuntime.jsx('option', { value: 'left', children: 'Left' }),
                                jsxRuntime.jsx('option', { value: 'center', children: 'Center' }),
                                jsxRuntime.jsx('option', { value: 'right', children: 'Right' }),
                              ],
                            }),
                          ],
                        })
                      : jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', { style: a, children: 'Offset (px)' }),
                            jsxRuntime.jsx('input', {
                              type: 'number',
                              style: s,
                              value: b,
                              onChange: (e) => A(Number(e.target.value) || 0),
                            }),
                          ],
                        }),
                    jsxRuntime.jsxs('div', {
                      style: l,
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Relative to' }),
                        jsxRuntime.jsxs('select', {
                          style: d,
                          value: c,
                          onChange: (e) => z(e.target.value),
                          children: [
                            jsxRuntime.jsx('option', { value: 'page', children: 'Page' }),
                            jsxRuntime.jsx('option', { value: 'column', children: 'Column' }),
                            jsxRuntime.jsx('option', { value: 'margin', children: 'Margin' }),
                            jsxRuntime.jsx('option', { value: 'character', children: 'Character' }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                jsxRuntime.jsxs('div', {
                  style: w,
                  children: [
                    jsxRuntime.jsx('div', { style: I, children: 'Vertical' }),
                    jsxRuntime.jsxs('div', {
                      style: l,
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Position' }),
                        jsxRuntime.jsxs('select', {
                          style: d,
                          value: g,
                          onChange: (e) => m(e.target.value),
                          children: [
                            jsxRuntime.jsx('option', { value: 'align', children: 'Alignment' }),
                            jsxRuntime.jsx('option', { value: 'offset', children: 'Offset' }),
                          ],
                        }),
                      ],
                    }),
                    g === 'align'
                      ? jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', { style: a, children: 'Align' }),
                            jsxRuntime.jsxs('select', {
                              style: d,
                              value: h,
                              onChange: (e) => L(e.target.value),
                              children: [
                                jsxRuntime.jsx('option', { value: 'top', children: 'Top' }),
                                jsxRuntime.jsx('option', { value: 'center', children: 'Center' }),
                                jsxRuntime.jsx('option', { value: 'bottom', children: 'Bottom' }),
                              ],
                            }),
                          ],
                        })
                      : jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', { style: a, children: 'Offset (px)' }),
                            jsxRuntime.jsx('input', {
                              type: 'number',
                              style: s,
                              value: x,
                              onChange: (e) => M(Number(e.target.value) || 0),
                            }),
                          ],
                        }),
                    jsxRuntime.jsxs('div', {
                      style: l,
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Relative to' }),
                        jsxRuntime.jsxs('select', {
                          style: d,
                          value: S,
                          onChange: (e) => B(e.target.value),
                          children: [
                            jsxRuntime.jsx('option', { value: 'page', children: 'Page' }),
                            jsxRuntime.jsx('option', { value: 'margin', children: 'Margin' }),
                            jsxRuntime.jsx('option', { value: 'paragraph', children: 'Paragraph' }),
                            jsxRuntime.jsx('option', { value: 'line', children: 'Line' }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                jsxRuntime.jsxs('div', {
                  style: w,
                  children: [
                    jsxRuntime.jsx('div', { style: I, children: 'Distance from text (px)' }),
                    jsxRuntime.jsxs('div', {
                      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
                      children: [
                        jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', {
                              style: { ...a, width: 45 },
                              children: 'Top',
                            }),
                            jsxRuntime.jsx('input', {
                              type: 'number',
                              style: s,
                              min: 0,
                              value: C,
                              onChange: (e) => N(Number(e.target.value) || 0),
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', {
                              style: { ...a, width: 45 },
                              children: 'Bottom',
                            }),
                            jsxRuntime.jsx('input', {
                              type: 'number',
                              style: s,
                              min: 0,
                              value: P,
                              onChange: (e) => E(Number(e.target.value) || 0),
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', {
                              style: { ...a, width: 45 },
                              children: 'Left',
                            }),
                            jsxRuntime.jsx('input', {
                              type: 'number',
                              style: s,
                              min: 0,
                              value: T,
                              onChange: (e) => H(Number(e.target.value) || 0),
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs('div', {
                          style: l,
                          children: [
                            jsxRuntime.jsx('label', {
                              style: { ...a, width: 45 },
                              children: 'Right',
                            }),
                            jsxRuntime.jsx('input', {
                              type: 'number',
                              style: s,
                              min: 0,
                              value: R,
                              onChange: (e) => V(Number(e.target.value) || 0),
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              style: U,
              children: [
                jsxRuntime.jsx('button', {
                  type: 'button',
                  style: K,
                  onClick: r,
                  children: 'Cancel',
                }),
                jsxRuntime.jsx('button', {
                  type: 'button',
                  style: {
                    ...K,
                    backgroundColor: 'var(--doc-primary)',
                    color: 'white',
                    borderColor: 'var(--doc-primary)',
                  },
                  onClick: O,
                  children: 'Apply',
                }),
              ],
            }),
          ],
        }),
      })
    : null;
}
exports.ImagePositionDialog = Z;
