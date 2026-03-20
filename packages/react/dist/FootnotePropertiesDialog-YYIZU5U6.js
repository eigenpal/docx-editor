'use strict';
require('./chunk-H5NTJZO4.js');
var react = require('react'),
  jsxRuntime = require('react/jsx-runtime');
var A = {
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
  D = {
    backgroundColor: 'white',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    padding: 24,
    minWidth: 400,
    maxWidth: 500,
  },
  S = { marginBottom: 16, padding: 12, border: '1px solid #e0e0e0', borderRadius: 4 },
  a = { display: 'block', fontSize: 12, color: '#666', marginBottom: 4 },
  i = {
    width: '100%',
    padding: '4px 8px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 13,
    marginBottom: 8,
  },
  P = {
    width: 60,
    padding: '4px 8px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 13,
    marginBottom: 8,
  },
  L = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  h = {
    padding: '6px 16px',
    border: '1px solid #ccc',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    backgroundColor: 'white',
  },
  O = { ...h, backgroundColor: '#2563eb', color: 'white', border: '1px solid #2563eb' },
  f = [
    { value: 'decimal', label: '1, 2, 3, ...' },
    { value: 'lowerRoman', label: 'i, ii, iii, ...' },
    { value: 'upperRoman', label: 'I, II, III, ...' },
    { value: 'lowerLetter', label: 'a, b, c, ...' },
    { value: 'upperLetter', label: 'A, B, C, ...' },
    { value: 'chicago', label: '*, \u2020, \u2021, ...' },
  ];
function j({ isOpen: x, onClose: l, onApply: y, footnotePr: r, endnotePr: s }) {
  let [u, C] = react.useState(r?.position ?? 'pageBottom'),
    [p, F] = react.useState(r?.numFmt ?? 'decimal'),
    [m, N] = react.useState(r?.numStart ?? 1),
    [c, R] = react.useState(r?.numRestart ?? 'continuous'),
    [d, E] = react.useState(s?.position ?? 'docEnd'),
    [b, k] = react.useState(s?.numFmt ?? 'lowerRoman'),
    [v, I] = react.useState(s?.numStart ?? 1),
    [g, w] = react.useState(s?.numRestart ?? 'continuous'),
    B = react.useCallback(() => {
      (y(
        { position: u, numFmt: p, numStart: m, numRestart: c },
        { position: d, numFmt: b, numStart: v, numRestart: g }
      ),
        l());
    }, [u, p, m, c, d, b, v, g, y, l]);
  return x
    ? jsxRuntime.jsx('div', {
        style: A,
        onClick: l,
        children: jsxRuntime.jsxs('div', {
          style: D,
          onClick: (e) => e.stopPropagation(),
          children: [
            jsxRuntime.jsx('h3', {
              style: { margin: '0 0 16px', fontSize: 16 },
              children: 'Footnote & Endnote Properties',
            }),
            jsxRuntime.jsxs('div', {
              style: S,
              children: [
                jsxRuntime.jsx('h4', {
                  style: { margin: '0 0 8px', fontSize: 14 },
                  children: 'Footnotes',
                }),
                jsxRuntime.jsx('label', { style: a, children: 'Position' }),
                jsxRuntime.jsxs('select', {
                  style: i,
                  value: u,
                  onChange: (e) => C(e.target.value),
                  children: [
                    jsxRuntime.jsx('option', { value: 'pageBottom', children: 'Bottom of page' }),
                    jsxRuntime.jsx('option', { value: 'beneathText', children: 'Below text' }),
                  ],
                }),
                jsxRuntime.jsx('label', { style: a, children: 'Number format' }),
                jsxRuntime.jsx('select', {
                  style: i,
                  value: p,
                  onChange: (e) => F(e.target.value),
                  children: f.map((e) =>
                    jsxRuntime.jsx('option', { value: e.value, children: e.label }, e.value)
                  ),
                }),
                jsxRuntime.jsxs('div', {
                  style: { display: 'flex', gap: 12, alignItems: 'center' },
                  children: [
                    jsxRuntime.jsxs('div', {
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Start at' }),
                        jsxRuntime.jsx('input', {
                          type: 'number',
                          min: 1,
                          style: P,
                          value: m,
                          onChange: (e) => N(parseInt(e.target.value, 10) || 1),
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs('div', {
                      style: { flex: 1 },
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Numbering' }),
                        jsxRuntime.jsxs('select', {
                          style: i,
                          value: c,
                          onChange: (e) => R(e.target.value),
                          children: [
                            jsxRuntime.jsx('option', {
                              value: 'continuous',
                              children: 'Continuous',
                            }),
                            jsxRuntime.jsx('option', {
                              value: 'eachSect',
                              children: 'Restart each section',
                            }),
                            jsxRuntime.jsx('option', {
                              value: 'eachPage',
                              children: 'Restart each page',
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
              style: S,
              children: [
                jsxRuntime.jsx('h4', {
                  style: { margin: '0 0 8px', fontSize: 14 },
                  children: 'Endnotes',
                }),
                jsxRuntime.jsx('label', { style: a, children: 'Position' }),
                jsxRuntime.jsxs('select', {
                  style: i,
                  value: d,
                  onChange: (e) => E(e.target.value),
                  children: [
                    jsxRuntime.jsx('option', { value: 'docEnd', children: 'End of document' }),
                    jsxRuntime.jsx('option', { value: 'sectEnd', children: 'End of section' }),
                  ],
                }),
                jsxRuntime.jsx('label', { style: a, children: 'Number format' }),
                jsxRuntime.jsx('select', {
                  style: i,
                  value: b,
                  onChange: (e) => k(e.target.value),
                  children: f.map((e) =>
                    jsxRuntime.jsx('option', { value: e.value, children: e.label }, e.value)
                  ),
                }),
                jsxRuntime.jsxs('div', {
                  style: { display: 'flex', gap: 12, alignItems: 'center' },
                  children: [
                    jsxRuntime.jsxs('div', {
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Start at' }),
                        jsxRuntime.jsx('input', {
                          type: 'number',
                          min: 1,
                          style: P,
                          value: v,
                          onChange: (e) => I(parseInt(e.target.value, 10) || 1),
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs('div', {
                      style: { flex: 1 },
                      children: [
                        jsxRuntime.jsx('label', { style: a, children: 'Numbering' }),
                        jsxRuntime.jsxs('select', {
                          style: i,
                          value: g,
                          onChange: (e) => w(e.target.value),
                          children: [
                            jsxRuntime.jsx('option', {
                              value: 'continuous',
                              children: 'Continuous',
                            }),
                            jsxRuntime.jsx('option', {
                              value: 'eachSect',
                              children: 'Restart each section',
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
              style: L,
              children: [
                jsxRuntime.jsx('button', { style: h, onClick: l, children: 'Cancel' }),
                jsxRuntime.jsx('button', { style: O, onClick: B, children: 'Apply' }),
              ],
            }),
          ],
        }),
      })
    : null;
}
exports.FootnotePropertiesDialog = j;
