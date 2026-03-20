'use strict';
var react = require('react'),
  jsxRuntime = require('react/jsx-runtime');
var j = {
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
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    minWidth: '400px',
    maxWidth: '500px',
    width: '100%',
    margin: '20px',
  },
  J = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--doc-border)',
  },
  Q = { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--doc-text)' },
  Z = {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: 'var(--doc-text-muted)',
    padding: '4px 8px',
    lineHeight: 1,
  },
  ee = { padding: '20px' },
  T = { marginBottom: '16px' },
  v = {
    display: 'block',
    marginBottom: '6px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--doc-text)',
  },
  g = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--doc-border-input)',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none',
  },
  te = { ...g, borderColor: 'var(--doc-error)' },
  re = { ...g, cursor: 'pointer' },
  oe = { color: 'var(--doc-error)', fontSize: '12px', marginTop: '4px' },
  W = { color: 'var(--doc-text-muted)', fontSize: '12px', marginTop: '4px' },
  ie = { display: 'flex', borderBottom: '1px solid var(--doc-border)', marginBottom: '16px' },
  O = {
    padding: '10px 16px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: 'var(--doc-text-muted)',
    borderBottom: '2px solid transparent',
    marginBottom: '-1px',
  },
  w = { ...O, color: 'var(--doc-link)', borderBottomColor: 'var(--doc-link)', fontWeight: 500 },
  ne = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 20px',
    borderTop: '1px solid var(--doc-border)',
  },
  E = {
    padding: '10px 20px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
  },
  le = { ...E, backgroundColor: 'var(--doc-link)', color: 'white' },
  ae = {
    ...E,
    backgroundColor: 'var(--doc-bg-hover)',
    color: 'var(--doc-text)',
    border: '1px solid var(--doc-border-input)',
  },
  se = { ...E, backgroundColor: 'var(--doc-error)', color: 'white' },
  pe = {
    ...E,
    backgroundColor: 'var(--doc-border-input)',
    color: 'var(--doc-text-muted)',
    cursor: 'not-allowed',
  };
function z(t) {
  if (!t || t.trim() === '') return false;
  let e = t.trim();
  if (e.startsWith('mailto:') || e.startsWith('tel:')) return e.length > 7;
  if (e.startsWith('ftp://')) return e.length > 6;
  try {
    let p = e.match(/^https?:\/\//) ? e : `https://${e}`,
      u = new URL(p);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
function F(t) {
  if (!t) return '';
  let e = t.trim();
  return e.startsWith('mailto:') ||
    e.startsWith('tel:') ||
    e.startsWith('ftp://') ||
    e.match(/^https?:\/\//)
    ? e
    : `https://${e}`;
}
function ke(t) {
  if (!t) return 'unknown';
  let e = t.trim().toLowerCase();
  return e.startsWith('mailto:')
    ? 'email'
    : e.startsWith('tel:')
      ? 'phone'
      : e.startsWith('ftp://')
        ? 'ftp'
        : e.startsWith('http://') || e.startsWith('https://')
          ? 'web'
          : e.includes('@') && !e.includes(' ')
            ? 'email'
            : 'web';
}
function de({
  isOpen: t,
  onClose: e,
  onSubmit: p,
  onRemove: u,
  initialData: a,
  selectedText: f = '',
  isEditing: n = false,
  bookmarks: H = [],
  className: G,
  style: M,
}) {
  let [i, y] = react.useState('url'),
    [s, C] = react.useState(''),
    [L, D] = react.useState(''),
    [x, _] = react.useState(''),
    [N, R] = react.useState(''),
    [k, m] = react.useState(''),
    [B, b] = react.useState(false),
    P = react.useRef(null),
    U = react.useRef(null);
  (react.useEffect(() => {
    t &&
      (a
        ? (a.bookmark ? (y('bookmark'), _(a.bookmark)) : (y('url'), C(a.url || '')),
          D(a.displayText || ''),
          R(a.tooltip || ''))
        : (y('url'), C(''), D(f), _(''), R('')),
      m(''),
      b(false));
  }, [t, a, f]),
    react.useEffect(() => {
      t &&
        setTimeout(() => {
          i === 'url' ? P.current?.focus() : U.current?.focus();
        }, 100);
    }, [t, i]));
  let $ = react.useCallback(() => {
      i === 'url' && s.trim() ? (z(s) ? m('') : m('Please enter a valid URL')) : m('');
    }, [i, s]),
    h = react.useCallback(
      (r) => {
        if ((r?.preventDefault(), i === 'url')) {
          if (!s.trim()) {
            (m('URL is required'), b(true));
            return;
          }
          if (!z(s)) {
            (m('Please enter a valid URL'), b(true));
            return;
          }
        } else if (i === 'bookmark' && !x) return;
        let S = { displayText: L.trim() || void 0, tooltip: N.trim() || void 0 };
        (i === 'url' ? (S.url = F(s)) : (S.bookmark = x), p(S));
      },
      [i, s, x, L, N, p]
    ),
    K = react.useCallback(
      (r) => {
        r.key === 'Escape'
          ? e()
          : r.key === 'Enter' &&
            !r.shiftKey &&
            r.target.tagName !== 'TEXTAREA' &&
            (r.preventDefault(), h());
      },
      [e, h]
    ),
    V = react.useCallback(
      (r) => {
        r.target === r.currentTarget && e();
      },
      [e]
    );
  if (!t) return null;
  let X = H.length > 0,
    Y = (i === 'url' && s.trim() && !k) || (i === 'bookmark' && x);
  return jsxRuntime.jsx('div', {
    className: `docx-hyperlink-dialog-overlay ${G || ''}`,
    style: { ...j, ...M },
    onClick: V,
    onKeyDown: K,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'hyperlink-dialog-title',
    children: jsxRuntime.jsxs('div', {
      className: 'docx-hyperlink-dialog',
      style: q,
      children: [
        jsxRuntime.jsxs('div', {
          className: 'docx-hyperlink-dialog-header',
          style: J,
          children: [
            jsxRuntime.jsx('h2', {
              id: 'hyperlink-dialog-title',
              style: Q,
              children: n ? 'Edit Hyperlink' : 'Insert Hyperlink',
            }),
            jsxRuntime.jsx('button', {
              type: 'button',
              className: 'docx-hyperlink-dialog-close',
              style: Z,
              onClick: e,
              'aria-label': 'Close dialog',
              children: '\xD7',
            }),
          ],
        }),
        jsxRuntime.jsxs('form', {
          className: 'docx-hyperlink-dialog-body',
          style: ee,
          onSubmit: h,
          children: [
            X &&
              jsxRuntime.jsxs('div', {
                className: 'docx-hyperlink-dialog-tabs',
                style: ie,
                children: [
                  jsxRuntime.jsx('button', {
                    type: 'button',
                    className: `docx-hyperlink-dialog-tab ${i === 'url' ? 'active' : ''}`,
                    style: i === 'url' ? w : O,
                    onClick: () => y('url'),
                    'aria-selected': i === 'url',
                    children: 'Web Address',
                  }),
                  jsxRuntime.jsx('button', {
                    type: 'button',
                    className: `docx-hyperlink-dialog-tab ${i === 'bookmark' ? 'active' : ''}`,
                    style: i === 'bookmark' ? w : O,
                    onClick: () => y('bookmark'),
                    'aria-selected': i === 'bookmark',
                    children: 'Bookmark',
                  }),
                ],
              }),
            i === 'url' &&
              jsxRuntime.jsxs('div', {
                className: 'docx-hyperlink-dialog-field',
                style: T,
                children: [
                  jsxRuntime.jsx('label', { htmlFor: 'hyperlink-url', style: v, children: 'URL' }),
                  jsxRuntime.jsx('input', {
                    ref: P,
                    id: 'hyperlink-url',
                    type: 'text',
                    className: 'docx-hyperlink-dialog-input',
                    style: k && B ? te : g,
                    value: s,
                    onChange: (r) => {
                      (C(r.target.value), B && m(''));
                    },
                    onBlur: () => {
                      (b(true), $());
                    },
                    placeholder: 'https://example.com',
                    'aria-invalid': !!k,
                    'aria-describedby': k ? 'url-error' : 'url-hint',
                  }),
                  k && B && jsxRuntime.jsx('div', { id: 'url-error', style: oe, children: k }),
                  !k &&
                    jsxRuntime.jsx('div', {
                      id: 'url-hint',
                      style: W,
                      children: 'Enter a web address, email (mailto:), or phone (tel:)',
                    }),
                ],
              }),
            i === 'bookmark' &&
              jsxRuntime.jsxs('div', {
                className: 'docx-hyperlink-dialog-field',
                style: T,
                children: [
                  jsxRuntime.jsx('label', {
                    htmlFor: 'hyperlink-bookmark',
                    style: v,
                    children: 'Bookmark',
                  }),
                  jsxRuntime.jsxs('select', {
                    ref: U,
                    id: 'hyperlink-bookmark',
                    className: 'docx-hyperlink-dialog-select',
                    style: re,
                    value: x,
                    onChange: (r) => _(r.target.value),
                    children: [
                      jsxRuntime.jsx('option', { value: '', children: 'Select a bookmark...' }),
                      H.map((r) =>
                        jsxRuntime.jsx(
                          'option',
                          { value: r.name, children: r.label || r.name },
                          r.name
                        )
                      ),
                    ],
                  }),
                ],
              }),
            jsxRuntime.jsxs('div', {
              className: 'docx-hyperlink-dialog-field',
              style: T,
              children: [
                jsxRuntime.jsx('label', {
                  htmlFor: 'hyperlink-display-text',
                  style: v,
                  children: 'Display Text',
                }),
                jsxRuntime.jsx('input', {
                  id: 'hyperlink-display-text',
                  type: 'text',
                  className: 'docx-hyperlink-dialog-input',
                  style: g,
                  value: L,
                  onChange: (r) => D(r.target.value),
                  placeholder: 'Text to display (optional)',
                }),
                jsxRuntime.jsx('div', {
                  style: W,
                  children: 'Leave empty to use the selected text',
                }),
              ],
            }),
            jsxRuntime.jsxs('div', {
              className: 'docx-hyperlink-dialog-field',
              style: T,
              children: [
                jsxRuntime.jsx('label', {
                  htmlFor: 'hyperlink-tooltip',
                  style: v,
                  children: 'Tooltip (optional)',
                }),
                jsxRuntime.jsx('input', {
                  id: 'hyperlink-tooltip',
                  type: 'text',
                  className: 'docx-hyperlink-dialog-input',
                  style: g,
                  value: N,
                  onChange: (r) => R(r.target.value),
                  placeholder: 'Text shown on hover',
                }),
              ],
            }),
          ],
        }),
        jsxRuntime.jsxs('div', {
          className: 'docx-hyperlink-dialog-footer',
          style: ne,
          children: [
            n &&
              u &&
              jsxRuntime.jsx('button', {
                type: 'button',
                className: 'docx-hyperlink-dialog-remove',
                style: se,
                onClick: u,
                children: 'Remove Link',
              }),
            jsxRuntime.jsx('div', { style: { flex: 1 } }),
            jsxRuntime.jsx('button', {
              type: 'button',
              className: 'docx-hyperlink-dialog-cancel',
              style: ae,
              onClick: e,
              children: 'Cancel',
            }),
            jsxRuntime.jsx('button', {
              type: 'submit',
              className: 'docx-hyperlink-dialog-submit',
              style: Y ? le : pe,
              onClick: h,
              disabled: !Y,
              children: n ? 'Update' : 'Insert',
            }),
          ],
        }),
      ],
    }),
  });
}
function me(t, e) {
  return { url: F(t), displayText: e };
}
function ye(t, e) {
  return { bookmark: t, displayText: e };
}
function xe(t) {
  return !!t.url && !t.bookmark;
}
function ge(t) {
  return !!t.bookmark;
}
function fe(t) {
  return t.displayText
    ? t.displayText
    : t.url
      ? t.url.replace(/^https?:\/\//, '')
      : t.bookmark
        ? t.bookmark
        : '';
}
function be(t) {
  return t.startsWith('mailto:') ? t : `mailto:${t}`;
}
function he(t) {
  return t.startsWith('tel:') ? t : `tel:${t.replace(/[\s\-\(\)\.]/g, '')}`;
}
function Se(t) {
  return t
    .filter((e) => !e.name.startsWith('_'))
    .map((e) => ({ name: e.name, label: e.name }))
    .sort((e, p) => e.name.localeCompare(p.name));
}
function Te() {
  let [t, e] = react.useState({ isOpen: false, isEditing: false }),
    p = react.useCallback((n) => {
      e({ isOpen: true, selectedText: n, initialData: void 0, isEditing: false });
    }, []),
    u = react.useCallback((n) => {
      e({ isOpen: true, initialData: n, selectedText: n.displayText, isEditing: true });
    }, []),
    a = react.useCallback(() => {
      e((n) => ({ ...n, isOpen: false }));
    }, []),
    f = react.useCallback(() => {
      e((n) => ({ ...n, isOpen: !n.isOpen }));
    }, []);
  return { state: t, openInsert: p, openEdit: u, close: a, toggle: f };
}
var ve = de;
exports.a = z;
exports.b = F;
exports.c = ke;
exports.d = de;
exports.e = me;
exports.f = ye;
exports.g = xe;
exports.h = ge;
exports.i = fe;
exports.j = be;
exports.k = he;
exports.l = Se;
exports.m = Te;
exports.n = ve;
