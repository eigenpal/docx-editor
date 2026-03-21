'use strict';
var chunkQQ63M65M_js = require('./chunk-QQ63M65M.js'),
  chunkEOTZWQND_js = require('./chunk-EOTZWQND.js'),
  chunkCTYOM6BE_js = require('./chunk-CTYOM6BE.js'),
  chunkPJVI53AH_js = require('./chunk-PJVI53AH.js'),
  chunkFVUGBRDD_js = require('./chunk-FVUGBRDD.js'),
  chunk5LKX24UR_js = require('./chunk-5LKX24UR.js'),
  chunk4VUZBV2S_js = require('./chunk-4VUZBV2S.js'),
  chunkAARNCPWR_js = require('./chunk-AARNCPWR.js'),
  chunkZ2UPNKQW_js = require('./chunk-Z2UPNKQW.js'),
  chunkSE5EN2QL_js = require('./chunk-SE5EN2QL.js'),
  chunkH5NTJZO4_js = require('./chunk-H5NTJZO4.js'),
  uf = require('react'),
  jsxRuntime = require('react/jsx-runtime'),
  prosemirrorState = require('prosemirror-state'),
  prosemirrorView = require('prosemirror-view'),
  prosemirrorHistory = require('prosemirror-history'),
  prosemirrorModel = require('prosemirror-model'),
  prosemirrorCommands = require('prosemirror-commands'),
  prosemirrorTables = require('prosemirror-tables'),
  prosemirrorDropcursor = require('prosemirror-dropcursor'),
  prosemirrorKeymap = require('prosemirror-keymap');
require('prosemirror-view/style/prosemirror.css');
var sonner = require('sonner'),
  client = require('react-dom/client');
function _interopDefault(e) {
  return e && e.__esModule ? e : { default: e };
}
var uf__default = /*#__PURE__*/ _interopDefault(uf);
function Jf() {
  return jsxRuntime.jsxs('svg', {
    width: '32',
    height: '40',
    viewBox: '0 0 32 40',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    children: [
      jsxRuntime.jsx('path', {
        d: 'M2 0C0.9 0 0 0.9 0 2V38C0 39.1 0.9 40 2 40H30C31.1 40 32 39.1 32 38V10L22 0H2Z',
        fill: '#cbd5e1',
      }),
      jsxRuntime.jsx('path', { d: 'M22 0L32 10H24C22.9 10 22 9.1 22 8V0Z', fill: '#94a3b8' }),
      jsxRuntime.jsx('rect', { x: '7', y: '18', width: '18', height: '2', rx: '1', fill: '#fff' }),
      jsxRuntime.jsx('rect', { x: '7', y: '23', width: '18', height: '2', rx: '1', fill: '#fff' }),
      jsxRuntime.jsx('rect', { x: '7', y: '28', width: '12', height: '2', rx: '1', fill: '#fff' }),
    ],
  });
}
function ws({ children: e }) {
  return jsxRuntime.jsx('div', { className: 'flex items-center flex-shrink-0', children: e });
}
function Qf(e) {
  return e.replace(/\.docx$/i, '');
}
function Sc({ value: e, onChange: t, placeholder: n = 'Untitled', editable: o = true }) {
  let r = Qf(e);
  return o
    ? jsxRuntime.jsx('input', {
        type: 'text',
        value: r,
        onChange: (i) => {
          let a = i.target.value;
          t?.(a.endsWith('.docx') ? a : a + '.docx');
        },
        placeholder: n,
        className:
          'text-base font-normal text-slate-800 bg-transparent border-0 outline-none px-2 py-0 rounded hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-slate-300 min-w-[100px] max-w-[300px] truncate leading-tight',
        'aria-label': 'Document name',
      })
    : jsxRuntime.jsx('span', {
        className:
          'text-base font-normal text-slate-800 px-2 py-0 min-w-[100px] max-w-[300px] truncate leading-tight',
        children: r || n,
      });
}
function Cs({ children: e }) {
  return jsxRuntime.jsx('div', {
    className: 'flex items-center gap-2 ml-auto flex-shrink-0',
    children: e,
  });
}
function vs() {
  let e = chunkEOTZWQND_js.x(),
    {
      disabled: t = false,
      onFormat: n,
      onPrint: o,
      showPrintButton: r = true,
      onPageSetup: i,
      onInsertImage: a,
      onInsertTable: s,
      showTableInsert: l = true,
      onInsertPageBreak: u,
      onInsertTOC: d,
      onRefocusEditor: c,
    } = e,
    p = uf.useCallback(
      (b) => {
        !t && n && n(b);
      },
      [t, n]
    ),
    f = uf.useCallback(
      (b, g) => {
        !t && s && (s(b, g), requestAnimationFrame(() => c?.()));
      },
      [t, s, c]
    );
  return jsxRuntime.jsxs('div', {
    className: 'flex items-center',
    role: 'menubar',
    'aria-label': 'Menu bar',
    children: [
      ((r && o) || i) &&
        jsxRuntime.jsx(chunkEOTZWQND_js.e, {
          label: 'File',
          disabled: t,
          items: [
            ...(r && o ? [{ icon: 'print', label: 'Print', shortcut: 'Ctrl+P', onClick: o }] : []),
            ...(i ? [{ icon: 'settings', label: 'Page setup', onClick: i }] : []),
          ],
        }),
      jsxRuntime.jsx(chunkEOTZWQND_js.e, {
        label: 'Format',
        disabled: t,
        items: [
          {
            icon: 'format_textdirection_l_to_r',
            label: 'Left-to-right text',
            onClick: () => p('setLtr'),
          },
          {
            icon: 'format_textdirection_r_to_l',
            label: 'Right-to-left text',
            onClick: () => p('setRtl'),
          },
        ],
      }),
      jsxRuntime.jsx(chunkEOTZWQND_js.e, {
        label: 'Insert',
        disabled: t,
        items: [
          ...(a ? [{ icon: 'image', label: 'Image', onClick: a }] : []),
          ...(l && s
            ? [
                {
                  icon: 'grid_on',
                  label: 'Table',
                  submenuContent: (b) =>
                    jsxRuntime.jsx(chunkEOTZWQND_js.f, {
                      onInsert: (g, x) => {
                        (f(g, x), b());
                      },
                    }),
                },
              ]
            : []),
          ...(a || (l && s) ? [{ type: 'separator' }] : []),
          { icon: 'page_break', label: 'Page break', onClick: u, disabled: !u },
          { icon: 'format_list_numbered', label: 'Table of contents', onClick: d, disabled: !d },
        ],
      }),
    ],
  });
}
function kc({ children: e }) {
  let t = null,
    n = null,
    o = [],
    r = [];
  uf.Children.forEach(e, (a) => {
    uf.isValidElement(a) &&
      (a.type === ws ? (t = a) : a.type === Cs ? (n = a) : a.type === vs ? r.push(a) : o.push(a));
  });
  let i = uf.useCallback((a) => {
    let s = a.target;
    s.tagName === 'INPUT' ||
      s.tagName === 'TEXTAREA' ||
      s.tagName === 'SELECT' ||
      s.tagName === 'OPTION' ||
      a.preventDefault();
  }, []);
  return jsxRuntime.jsxs('div', {
    className: 'flex items-stretch bg-white pt-2 pb-1',
    onMouseDown: i,
    'data-testid': 'title-bar',
    children: [
      jsxRuntime.jsx('div', {
        className: 'flex items-center flex-shrink-0 pl-3 pr-1',
        children: t || jsxRuntime.jsx(Jf, {}),
      }),
      jsxRuntime.jsxs('div', {
        className: 'flex flex-col justify-center flex-1 min-w-0 py-1',
        children: [
          o.length > 0 &&
            jsxRuntime.jsx('div', { className: 'flex items-center gap-2 px-1', children: o }),
          r.length > 0 &&
            jsxRuntime.jsx('div', { className: 'flex items-center px-1', children: r }),
        ],
      }),
      n &&
        jsxRuntime.jsx('div', { className: 'flex items-center flex-shrink-0 px-3', children: n }),
    ],
  });
}
function em({ children: e, className: t, ...n }) {
  return jsxRuntime.jsx(chunkEOTZWQND_js.w.Provider, {
    value: n,
    children: jsxRuntime.jsx('div', {
      className: chunkEOTZWQND_js.a('flex flex-col bg-white shadow-sm flex-shrink-0', t),
      'data-testid': 'editor-toolbar',
      children: e,
    }),
  });
}
var Wt = em;
Wt.TitleBar = kc;
Wt.Logo = ws;
Wt.DocumentName = Sc;
Wt.MenuBar = vs;
Wt.TitleBarRight = Cs;
Wt.FormattingBar = chunkEOTZWQND_js.y;
var Cc = uf.createContext(null);
function QS() {
  let e = uf.useContext(Cc);
  if (!e) throw new Error('useErrorNotifications must be used within an ErrorProvider');
  return e;
}
function vc({ children: e }) {
  let t = uf.useMemo(() => new chunkFVUGBRDD_js.H(), []),
    n = uf.useSyncExternalStore(t.subscribe, t.getSnapshot),
    o = uf.useCallback(
      (u, d) => {
        t.showError(u, d);
      },
      [t]
    ),
    r = uf.useCallback(
      (u, d) => {
        t.showWarning(u, d);
      },
      [t]
    ),
    i = uf.useCallback(
      (u, d) => {
        t.showInfo(u, d);
      },
      [t]
    ),
    a = uf.useCallback(
      (u) => {
        t.dismiss(u);
      },
      [t]
    ),
    s = uf.useCallback(() => {
      t.clearAll();
    }, [t]),
    l = uf.useMemo(
      () => ({
        notifications: n.notifications,
        showError: o,
        showWarning: r,
        showInfo: i,
        dismissNotification: a,
        clearNotifications: s,
      }),
      [n.notifications, o, r, i, a, s]
    );
  return jsxRuntime.jsxs(Cc.Provider, {
    value: l,
    children: [e, jsxRuntime.jsx(am, { notifications: n.notifications, onDismiss: a })],
  });
}
function am({ notifications: e, onDismiss: t }) {
  let n = e.filter((r) => !r.dismissed);
  return n.length === 0
    ? null
    : jsxRuntime.jsx('div', {
        className: 'docx-notification-container',
        style: {
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 10001,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '400px',
        },
        children: n.map((r) =>
          jsxRuntime.jsx(sm, { notification: r, onDismiss: () => t(r.id) }, r.id)
        ),
      });
}
function sm({ notification: e, onDismiss: t }) {
  let [n, o] = uf.useState(false),
    i = ((m) => {
      switch (m) {
        case 'error':
          return {
            bg: 'var(--doc-error-bg)',
            border: '#f5c6cb',
            text: 'var(--doc-error)',
            icon: 'var(--doc-error)',
          };
        case 'warning':
          return {
            bg: 'var(--doc-warning-bg)',
            border: '#ffeeba',
            text: '#856404',
            icon: 'var(--doc-warning)',
          };
        case 'info':
          return { bg: '#e8f4fd', border: '#b8daff', text: '#0c5460', icon: 'var(--doc-primary)' };
      }
    })(e.severity),
    a = {
      background: i.bg,
      border: `1px solid ${i.border}`,
      borderRadius: '8px',
      padding: '12px 16px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
      animation: 'slideIn 0.3s ease-out',
    },
    s = { display: 'flex', alignItems: 'flex-start', gap: '8px' },
    l = { color: i.icon, flexShrink: 0 },
    u = { flex: 1, minWidth: 0 },
    d = { color: i.text, fontSize: '14px', fontWeight: 500, wordBreak: 'break-word' },
    c = {
      marginTop: '8px',
      padding: '8px',
      background: 'rgba(0, 0, 0, 0.05)',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'monospace',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      color: i.text,
      maxHeight: '200px',
      overflow: 'auto',
    },
    p = {
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      borderRadius: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: i.text,
    },
    f = (m) => {
      switch (m) {
        case 'error':
          return jsxRuntime.jsxs('svg', {
            width: '20',
            height: '20',
            viewBox: '0 0 20 20',
            fill: 'none',
            children: [
              jsxRuntime.jsx('circle', {
                cx: '10',
                cy: '10',
                r: '8',
                stroke: 'currentColor',
                strokeWidth: '1.5',
              }),
              jsxRuntime.jsx('path', {
                d: 'M10 6v5M10 13v1',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
              }),
            ],
          });
        case 'warning':
          return jsxRuntime.jsxs('svg', {
            width: '20',
            height: '20',
            viewBox: '0 0 20 20',
            fill: 'none',
            children: [
              jsxRuntime.jsx('path', {
                d: 'M10 3L18 17H2L10 3z',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinejoin: 'round',
              }),
              jsxRuntime.jsx('path', {
                d: 'M10 8v4M10 14v1',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
              }),
            ],
          });
        case 'info':
          return jsxRuntime.jsxs('svg', {
            width: '20',
            height: '20',
            viewBox: '0 0 20 20',
            fill: 'none',
            children: [
              jsxRuntime.jsx('circle', {
                cx: '10',
                cy: '10',
                r: '8',
                stroke: 'currentColor',
                strokeWidth: '1.5',
              }),
              jsxRuntime.jsx('path', {
                d: 'M10 9v5M10 6v1',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
              }),
            ],
          });
      }
    };
  return jsxRuntime.jsxs('div', {
    className: `docx-notification-toast docx-notification-${e.severity}`,
    style: a,
    children: [
      jsxRuntime.jsx('style', {
        children: `
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateX(100%);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
        `,
      }),
      jsxRuntime.jsxs('div', {
        style: s,
        children: [
          jsxRuntime.jsx('span', { style: l, children: f(e.severity) }),
          jsxRuntime.jsxs('div', {
            style: u,
            children: [
              jsxRuntime.jsx('div', { style: d, children: e.message }),
              e.details &&
                jsxRuntime.jsxs(jsxRuntime.Fragment, {
                  children: [
                    jsxRuntime.jsx('button', {
                      type: 'button',
                      onClick: () => o(!n),
                      style: { ...p, marginTop: '4px', fontSize: '12px', padding: '2px 8px' },
                      children: n ? 'Hide details' : 'Show details',
                    }),
                    n && jsxRuntime.jsx('div', { style: c, children: e.details }),
                  ],
                }),
            ],
          }),
          jsxRuntime.jsx('button', {
            type: 'button',
            onClick: t,
            style: p,
            title: 'Dismiss',
            children: jsxRuntime.jsx('svg', {
              width: '16',
              height: '16',
              viewBox: '0 0 16 16',
              fill: 'none',
              children: jsxRuntime.jsx('path', {
                d: 'M4 4l8 8M12 4l-8 8',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
              }),
            }),
          }),
        ],
      }),
    ],
  });
}
var si = class extends uf.Component {
  constructor(n) {
    super(n);
    chunkH5NTJZO4_js.d(this, 'resetError', () => {
      this.setState({ hasError: false, error: null, errorInfo: null });
    });
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(n) {
    return { hasError: true, error: n };
  }
  componentDidCatch(n, o) {
    (this.setState({ errorInfo: o }),
      console.error('ErrorBoundary caught an error:', n, o),
      this.props.onError && this.props.onError(n, o));
  }
  render() {
    if (this.state.hasError) {
      let { fallback: n, showDetails: o = true } = this.props,
        { error: r, errorInfo: i } = this.state;
      return n
        ? typeof n == 'function'
          ? n(r, this.resetError)
          : n
        : jsxRuntime.jsx(lm, { error: r, errorInfo: i, showDetails: o, onReset: this.resetError });
    }
    return this.props.children;
  }
};
function lm({ error: e, errorInfo: t, showDetails: n, onReset: o }) {
  let r = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      textAlign: 'center',
      minHeight: '200px',
      background: 'white',
      borderRadius: '8px',
      border: '1px solid var(--doc-border)',
      margin: '20px',
    },
    i = { color: 'var(--doc-error)', marginBottom: '16px' },
    a = { fontSize: '18px', fontWeight: 600, color: 'var(--doc-text)', marginBottom: '8px' },
    s = {
      fontSize: '14px',
      color: 'var(--doc-text-muted)',
      marginBottom: '16px',
      maxWidth: '400px',
    },
    l = {
      width: '100%',
      maxWidth: '600px',
      marginBottom: '16px',
      padding: '12px',
      background: 'var(--doc-error-bg)',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'monospace',
      textAlign: 'left',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '200px',
      overflow: 'auto',
    },
    u = {
      padding: '10px 20px',
      background: 'var(--doc-primary)',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '14px',
      cursor: 'pointer',
    };
  return jsxRuntime.jsxs('div', {
    className: 'docx-error-fallback',
    style: r,
    children: [
      jsxRuntime.jsx('div', {
        style: i,
        children: jsxRuntime.jsxs('svg', {
          width: '48',
          height: '48',
          viewBox: '0 0 48 48',
          fill: 'none',
          children: [
            jsxRuntime.jsx('circle', {
              cx: '24',
              cy: '24',
              r: '20',
              stroke: 'currentColor',
              strokeWidth: '2',
            }),
            jsxRuntime.jsx('path', {
              d: 'M24 14v12M24 30v2',
              stroke: 'currentColor',
              strokeWidth: '2',
              strokeLinecap: 'round',
            }),
          ],
        }),
      }),
      jsxRuntime.jsx('h2', { style: a, children: 'Something went wrong' }),
      jsxRuntime.jsx('p', {
        style: s,
        children:
          'An error occurred while rendering this component. Please try again or contact support if the problem persists.',
      }),
      n &&
        jsxRuntime.jsxs('div', {
          style: l,
          children: [
            jsxRuntime.jsx('strong', { children: 'Error:' }),
            ' ',
            e.message,
            t &&
              jsxRuntime.jsxs(jsxRuntime.Fragment, {
                children: [
                  `

`,
                  jsxRuntime.jsx('strong', { children: 'Component Stack:' }),
                  t.componentStack,
                ],
              }),
          ],
        }),
      jsxRuntime.jsx('button', { type: 'button', onClick: o, style: u, children: 'Try Again' }),
    ],
  });
}
function ek({ message: e, details: t, onRetry: n, className: o = '' }) {
  let r = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      textAlign: 'center',
      background: 'white',
      borderRadius: '8px',
      border: '1px solid var(--doc-border-light)',
    },
    i = { color: 'var(--doc-error)', marginBottom: '16px' },
    a = { fontSize: '16px', fontWeight: 600, color: 'var(--doc-text)', marginBottom: '8px' },
    s = {
      fontSize: '14px',
      color: 'var(--doc-text-muted)',
      marginBottom: '16px',
      maxWidth: '400px',
    },
    l = {
      marginBottom: '16px',
      padding: '12px',
      background: 'var(--doc-bg)',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'monospace',
      maxWidth: '100%',
      overflow: 'auto',
      textAlign: 'left',
    },
    u = {
      padding: '8px 16px',
      background: 'var(--doc-primary)',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '13px',
      cursor: 'pointer',
    };
  return jsxRuntime.jsxs('div', {
    className: `docx-parse-error ${o}`,
    style: r,
    children: [
      jsxRuntime.jsx('div', {
        style: i,
        children: jsxRuntime.jsxs('svg', {
          width: '40',
          height: '40',
          viewBox: '0 0 40 40',
          fill: 'none',
          children: [
            jsxRuntime.jsx('path', {
              d: 'M10 10h20v20H10z',
              stroke: 'currentColor',
              strokeWidth: '2',
              strokeLinejoin: 'round',
            }),
            jsxRuntime.jsx('path', {
              d: 'M25 10l-10 20M15 10l10 20',
              stroke: 'currentColor',
              strokeWidth: '2',
              strokeLinecap: 'round',
            }),
          ],
        }),
      }),
      jsxRuntime.jsx('h3', { style: a, children: 'Unable to Parse Document' }),
      jsxRuntime.jsx('p', { style: s, children: e }),
      t && jsxRuntime.jsx('div', { style: l, children: t }),
      n &&
        jsxRuntime.jsx('button', { type: 'button', onClick: n, style: u, children: 'Try Again' }),
    ],
  });
}
function tk({ feature: e, description: t, className: n = '' }) {
  let o = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: 'var(--doc-warning-bg)',
      border: '1px solid #ffeeba',
      borderRadius: '4px',
      fontSize: '12px',
      color: '#856404',
    },
    r = { flexShrink: 0, color: 'var(--doc-warning)' };
  return jsxRuntime.jsxs('div', {
    className: `docx-unsupported-warning ${n}`,
    style: o,
    children: [
      jsxRuntime.jsx('span', {
        style: r,
        children: jsxRuntime.jsxs('svg', {
          width: '16',
          height: '16',
          viewBox: '0 0 16 16',
          fill: 'none',
          children: [
            jsxRuntime.jsx('path', {
              d: 'M8 2l7 12H1L8 2z',
              stroke: 'currentColor',
              strokeWidth: '1.5',
              strokeLinejoin: 'round',
            }),
            jsxRuntime.jsx('path', {
              d: 'M8 6v4M8 12v1',
              stroke: 'currentColor',
              strokeWidth: '1.5',
              strokeLinecap: 'round',
            }),
          ],
        }),
      }),
      jsxRuntime.jsxs('span', {
        children: [jsxRuntime.jsx('strong', { children: e }), t && `: ${t}`],
      }),
    ],
  });
}
function nk(e) {
  return (
    e.message.includes('parse') ||
    e.message.includes('Parse') ||
    e.message.includes('XML') ||
    e.message.includes('DOCX') ||
    e.message.includes('Invalid')
  );
}
function ok(e) {
  let t = e.message.toLowerCase();
  return t.includes('network') || t.includes('fetch')
    ? 'Network error. Please check your internet connection and try again.'
    : t.includes('parse') || t.includes('xml') || t.includes('invalid')
      ? 'The document could not be parsed. It may be corrupted or in an unsupported format.'
      : t.includes('permission') || t.includes('access')
        ? 'Access denied. You may not have permission to access this file.'
        : t.includes('not found') || t.includes('404')
          ? 'The requested file was not found.'
          : t.includes('timeout')
            ? 'The operation timed out. Please try again.'
            : 'An unexpected error occurred. Please try again.';
}
function Ec({ document: e, onChange: t, onSelectionChange: n }) {
  let o = uf.useMemo(() => new chunkFVUGBRDD_js.C(), []),
    [r, i] = uf.useState({
      context: null,
      table: null,
      tableIndex: null,
      rowIndex: null,
      columnIndex: null,
    }),
    a = uf.useCallback(
      (d, c, p) => {
        if (!e) return;
        let f = chunkFVUGBRDD_js.z(e, d);
        if (!f) {
          (o.clearSelection(),
            i({ context: null, table: null, tableIndex: null, rowIndex: null, columnIndex: null }));
          return;
        }
        o.selectCell({ tableIndex: d, rowIndex: c, columnIndex: p });
        let b = chunkEOTZWQND_js.ea(f, { tableIndex: d, rowIndex: c, columnIndex: p });
        (i({ context: b, table: f, tableIndex: d, rowIndex: c, columnIndex: p }), n?.(b));
      },
      [e, o, n]
    ),
    s = uf.useCallback(() => {
      (o.clearSelection(),
        i({ context: null, table: null, tableIndex: null, rowIndex: null, columnIndex: null }),
        n?.(null));
    }, [o, n]),
    l = uf.useCallback(
      (d) => {
        if (
          !e ||
          !r.context ||
          r.tableIndex === null ||
          r.rowIndex === null ||
          r.columnIndex === null
        )
          return;
        let c = r.table;
        if (!c) return;
        let p = null,
          f = null,
          m = r.rowIndex,
          b = r.columnIndex;
        switch (d) {
          case 'addRowAbove':
            ((p = chunkEOTZWQND_js.ha(c, r.rowIndex, 'before')), (m = r.rowIndex + 1));
            break;
          case 'addRowBelow':
            p = chunkEOTZWQND_js.ha(c, r.rowIndex, 'after');
            break;
          case 'addColumnLeft':
            ((p = chunkEOTZWQND_js.ja(c, r.columnIndex, 'before')), (b = r.columnIndex + 1));
            break;
          case 'addColumnRight':
            p = chunkEOTZWQND_js.ja(c, r.columnIndex, 'after');
            break;
          case 'deleteRow':
            c.rows.length > 1 &&
              ((p = chunkEOTZWQND_js.ia(c, r.rowIndex)),
              m >= p.rows.length && (m = p.rows.length - 1));
            break;
          case 'deleteColumn': {
            if (chunkEOTZWQND_js.fa(c) > 1) {
              p = chunkEOTZWQND_js.ka(c, r.columnIndex);
              let x = chunkEOTZWQND_js.fa(p);
              b >= x && (b = x - 1);
            }
            break;
          }
          case 'mergeCells':
            r.context.selection.selectedCells && (p = chunkEOTZWQND_js.la(c, r.context.selection));
            break;
          case 'splitCell':
            r.context.canSplitCell && (p = chunkEOTZWQND_js.ma(c, r.rowIndex, r.columnIndex));
            break;
          case 'deleteTable':
            ((f = chunkFVUGBRDD_js.B(e, r.tableIndex)), s(), t?.(f));
            return;
        }
        p && ((f = chunkFVUGBRDD_js.A(e, r.tableIndex, p)), t?.(f), f && a(r.tableIndex, m, b));
      },
      [e, r, t, s, a]
    ),
    u = uf.useCallback((d, c, p) => o.isCellSelected(d, c, p), [o, r]);
  return {
    state: r,
    handleCellClick: a,
    handleAction: l,
    clearSelection: s,
    isCellSelected: u,
    tableContext: r.context,
  };
}
var Mc = ({ headings: e, onHeadingClick: t, onClose: n, topOffset: o = 0 }) => {
  let [r, i] = uf.useState(false);
  return (
    uf.useEffect(() => {
      requestAnimationFrame(() => i(true));
    }, []),
    jsxRuntime.jsxs('nav', {
      className: 'docx-outline-nav',
      role: 'navigation',
      'aria-label': 'Document outline',
      style: {
        position: 'absolute',
        top: o,
        left: 30,
        bottom: 0,
        width: 240,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        transform: r ? 'translateX(0)' : 'translateX(-270px)',
        transition: 'transform 0.15s ease-out',
      },
      onMouseDown: (a) => a.stopPropagation(),
      children: [
        jsxRuntime.jsxs('div', {
          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 12px' },
          children: [
            jsxRuntime.jsx('button', {
              onClick: n,
              'aria-label': 'Close outline',
              style: {
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                color: '#444746',
              },
              title: 'Close outline',
              children: jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: 'arrow_back', size: 20 }),
            }),
            jsxRuntime.jsx('span', {
              style: { fontWeight: 400, fontSize: 14, color: '#1f1f1f', letterSpacing: '0.01em' },
              children: 'Outline',
            }),
          ],
        }),
        jsxRuntime.jsx('div', {
          style: { overflowY: 'auto', flex: 1, paddingLeft: 20 },
          children:
            e.length === 0
              ? jsxRuntime.jsx('div', {
                  style: {
                    padding: '8px 16px',
                    color: '#80868b',
                    fontSize: 13,
                    lineHeight: '20px',
                  },
                  children: 'No headings found. Add headings to your document to see them here.',
                })
              : e.map((a, s) =>
                  jsxRuntime.jsx(
                    'div',
                    {
                      style: { marginLeft: a.level * 12 },
                      children: jsxRuntime.jsx('button', {
                        className: 'docx-outline-heading-btn',
                        onClick: () => t(a.pmPos),
                        style: {
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '5px 12px',
                          fontSize: 13,
                          fontWeight: 400,
                          color: '#1f1f1f',
                          lineHeight: '18px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          borderRadius: 0,
                          letterSpacing: '0.01em',
                        },
                        title: a.text,
                        children: a.text,
                      }),
                    },
                    `${a.pmPos}-${s}`
                  )
                ),
        }),
      ],
    })
  );
};
function Fc(e) {
  return e?.length
    ? e
        .flatMap((t) =>
          t.content
            .filter((n) => n.type === 'run')
            .flatMap((n) => ('content' in n ? n.content : []))
            .filter((n) => n.type === 'text')
            .map((n) => ('text' in n ? n.text : ''))
        )
        .join('')
    : '';
}
function Es(e) {
  return e
    ? new Date(e).toLocaleString(void 0, {
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      })
    : '';
}
function Ps(e) {
  return e
    .split(/\s+/)
    .map((t) => t[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
var Lc = [
  '#6DCCB1',
  '#79AAD9',
  '#EE789D',
  '#A987D1',
  '#E6A85F',
  '#F2CC8F',
  '#68B3A2',
  '#B07AA1',
  '#59A14F',
  '#FF9DA7',
  '#E15759',
  '#76B7B2',
];
function mm(e) {
  let t = 0;
  for (let n = 0; n < e.length; n++) t = e.charCodeAt(n) + ((t << 5) - t);
  return Lc[Math.abs(t) % Lc.length];
}
var gm = 340,
  hm = 8,
  di = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    color: '#5f6368',
    display: 'flex',
    borderRadius: '50%',
  },
  Bc = {
    padding: '6px 16px',
    fontSize: 14,
    border: 'none',
    background: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    fontWeight: 500,
    fontFamily: 'inherit',
  },
  Dc = ({
    comments: e,
    trackedChanges: t,
    onCommentClick: n,
    onCommentReply: o,
    onCommentResolve: r,
    onCommentDelete: i,
    onAddComment: a,
    onCancelAddComment: s,
    onAcceptChange: l,
    onRejectChange: u,
    onTrackedChangeReply: d,
    topOffset: c = 0,
    showResolved: p = false,
    isAddingComment: f = false,
    addCommentYPosition: m = null,
    pageWidth: b = 816,
    editorContainerRef: g,
    anchorPositions: x,
  }) => {
    let [T, S] = uf.useState(null),
      [B, v] = uf.useState(''),
      [M, U] = uf.useState(''),
      [ee, O] = uf.useState(null),
      [N, ne] = uf.useState(null),
      [ce, D] = uf.useState(new Map()),
      [z, ae] = uf.useState(false),
      se = uf.useRef(new Set()),
      A = uf.useRef(null),
      Ie = uf.useRef(new Map()),
      Fe = uf.useMemo(() => e.filter((R) => !(R.parentId != null || (R.done && !p))), [e, p]),
      Ue = uf.useMemo(() => {
        let R = new Map();
        for (let K of e)
          if (K.parentId != null) {
            let H = R.get(K.parentId);
            H ? H.push(K) : R.set(K.parentId, [K]);
          }
        return R;
      }, [e]),
      P = (R) => Ue.get(R) ?? [],
      F = uf.useCallback(() => {
        let R = g?.current;
        if (!R) return;
        let K = R.querySelector('.paged-editor__pages');
        if (!K) return;
        let H = R.getBoundingClientRect(),
          ge = R.scrollTop,
          he = [];
        for (let xe of Fe) {
          let pe = `comment-${xe.id}`,
            Ae = x?.get(pe);
          if (Ae != null)
            he.push({ id: pe, targetY: Ae, height: Ie.current.get(pe)?.offsetHeight || 80 });
          else {
            let Ge = K.querySelector(`[data-comment-id="${xe.id}"]`);
            if (Ge) {
              let Ve = Ge.getBoundingClientRect();
              he.push({
                id: pe,
                targetY: Ve.top - H.top + ge,
                height: Ie.current.get(pe)?.offsetHeight || 80,
              });
            }
          }
        }
        (t.forEach((xe, pe) => {
          let Ae = `tc-${xe.revisionId}-${pe}`,
            Ge = x?.get(`revision-${xe.revisionId}`);
          if (Ge != null)
            he.push({ id: Ae, targetY: Ge, height: Ie.current.get(Ae)?.offsetHeight || 80 });
          else {
            let Ve = K.querySelector(`[data-revision-id="${xe.revisionId}"]`);
            if (Ve) {
              let rt = Ve.getBoundingClientRect();
              he.push({
                id: Ae,
                targetY: rt.top - H.top + ge,
                height: Ie.current.get(Ae)?.offsetHeight || 80,
              });
            }
          }
        }),
          f &&
            m != null &&
            he.push({
              id: 'new-comment-input',
              targetY: m,
              height: Ie.current.get('new-comment-input')?.offsetHeight || 120,
            }),
          he.sort((xe, pe) => xe.targetY - pe.targetY));
        let ye = new Map(),
          De = 0;
        for (let xe of he) {
          let pe = Math.max(xe.targetY, De + hm);
          (ye.set(xe.id, pe), (De = pe + xe.height));
        }
        D(ye);
      }, [Fe, t, g, f, m, x]);
    (uf.useEffect(() => {
      let R = g?.current;
      if (!R) return;
      let K = R.querySelector('.paged-editor__pages');
      if (!K) return;
      let H = (ge) => {
        let he = ge.target;
        if (!A.current?.contains(he)) {
          if (K.contains(he)) {
            let ye = he.closest('[data-comment-id]');
            if (ye?.dataset.commentId) {
              (O(`comment-${ye.dataset.commentId}`), n?.(Number(ye.dataset.commentId)));
              return;
            }
            let De = he.closest('.docx-insertion') || he.closest('.docx-deletion');
            if (De?.dataset.revisionId) {
              let xe = Number(De.dataset.revisionId),
                pe = t.findIndex((Ae) => Ae.revisionId === xe);
              if (pe >= 0) {
                O(`tc-${t[pe].revisionId}-${pe}`);
                return;
              }
            }
          }
          (O(null), ne(null));
        }
      };
      return (R.addEventListener('click', H), () => R.removeEventListener('click', H));
    }, [g, t, n]),
      uf.useEffect(() => {
        let R = g?.current;
        if (!R) return;
        let K = setTimeout(F, 50),
          H = setTimeout(() => {
            (F(), ae(true));
          }, 400),
          ge = new ResizeObserver(() => {
            requestAnimationFrame(F);
          });
        return (
          ge.observe(R),
          () => {
            (clearTimeout(K), clearTimeout(H), ge.disconnect());
          }
        );
      }, [F, g]),
      uf.useEffect(() => {
        let R = requestAnimationFrame(F);
        return () => cancelAnimationFrame(R);
      }, [ee, f, F]),
      uf.useEffect(() => {
        let R = [];
        if (ee) {
          let he = Ie.current.get(ee);
          he && R.push(he);
        }
        let K = Ie.current.get('new-comment-input');
        if ((K && R.push(K), R.length === 0)) return;
        let H,
          ge = new ResizeObserver(() => {
            (cancelAnimationFrame(H), (H = requestAnimationFrame(F)));
          });
        for (let he of R) ge.observe(he);
        return () => {
          (cancelAnimationFrame(H), ge.disconnect());
        };
      }, [ee, F]));
    let k = () => {
        M.trim() && (a?.(M.trim()), U(''));
      },
      L = (R, K) => {
        (O(ee === R ? null : R), ne(null), K !== void 0 && n?.(K));
      },
      I = ce.size > 0,
      E = (R, K = 32) => ({
        width: K,
        height: K,
        borderRadius: '50%',
        backgroundColor: mm(R),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: K === 32 ? 13 : 11,
        fontWeight: 500,
        flexShrink: 0,
      }),
      Z = (R) => ({
        padding: '6px 16px',
        fontSize: 14,
        border: 'none',
        borderRadius: 20,
        background: R ? '#1a73e8' : '#f1f3f4',
        color: R ? '#fff' : '#80868b',
        cursor: R ? 'pointer' : 'default',
        fontWeight: 500,
        fontFamily: 'inherit',
      }),
      le = (R, K, H) => {
        let ge = se.current.has(R);
        return (
          H !== void 0 && se.current.add(R),
          {
            ...(I
              ? H !== void 0
                ? { position: 'absolute', top: H, left: 0, right: 0, opacity: 1 }
                : {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    opacity: 0,
                    visibility: 'hidden',
                  }
              : { marginBottom: 6 }),
            padding: K ? '10px 12px' : '8px 10px',
            borderRadius: 8,
            backgroundColor: K ? '#fff' : '#f8fbff',
            cursor: 'pointer',
            boxShadow: K
              ? '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)'
              : '0 1px 3px rgba(60,64,67,0.2), 0 2px 6px rgba(60,64,67,0.08)',
            transition:
              I && H === void 0
                ? 'none'
                : !ge && H !== void 0
                  ? 'opacity 0.2s ease, box-shadow 0.2s ease'
                  : z
                    ? 'opacity 0.2s ease, box-shadow 0.2s ease, top 0.15s ease'
                    : 'none',
          }
        );
      },
      _ = (R, K) =>
        R.length === 0
          ? null
          : jsxRuntime.jsxs('div', {
              style: { marginTop: 8 },
              children: [
                (K ? R : R.slice(-1)).map((H) =>
                  jsxRuntime.jsxs(
                    'div',
                    {
                      style: {
                        marginBottom: K ? 8 : 0,
                        paddingTop: 8,
                        borderTop: '1px solid #e8eaed',
                      },
                      children: [
                        jsxRuntime.jsxs('div', {
                          style: { display: 'flex', alignItems: 'flex-start', gap: 10 },
                          children: [
                            jsxRuntime.jsx('div', {
                              style: E(H.author || 'U', 28),
                              children: Ps(H.author || 'U'),
                            }),
                            jsxRuntime.jsxs('div', {
                              style: { flex: 1, minWidth: 0 },
                              children: [
                                jsxRuntime.jsx('div', {
                                  style: { fontSize: 13, fontWeight: 600, color: '#202124' },
                                  children: H.author || 'Unknown',
                                }),
                                jsxRuntime.jsx('div', {
                                  style: { fontSize: 11, color: '#5f6368' },
                                  children: Es(H.date),
                                }),
                              ],
                            }),
                          ],
                        }),
                        jsxRuntime.jsx('div', {
                          style: {
                            fontSize: 13,
                            color: '#202124',
                            lineHeight: '20px',
                            marginTop: 4,
                            ...(K
                              ? {}
                              : {
                                  overflow: 'hidden',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                }),
                          },
                          children: Fc(H.content),
                        }),
                      ],
                    },
                    H.id
                  )
                ),
                !K &&
                  R.length > 1 &&
                  jsxRuntime.jsxs('div', {
                    style: { fontSize: 12, color: '#5f6368', marginTop: 4 },
                    children: [R.length - 1, ' more ', R.length - 1 === 1 ? 'reply' : 'replies'],
                  }),
              ],
            }),
      J = (R, K) =>
        jsxRuntime.jsx('div', {
          onClick: (H) => H.stopPropagation(),
          style: { marginTop: 12 },
          children:
            T === R
              ? jsxRuntime.jsxs('div', {
                  children: [
                    jsxRuntime.jsx('input', {
                      ref: (H) => H?.focus({ preventScroll: true }),
                      type: 'text',
                      value: B,
                      onChange: (H) => v(H.target.value),
                      onMouseDown: (H) => H.stopPropagation(),
                      onKeyDown: (H) => {
                        (H.stopPropagation(),
                          H.key === 'Enter' &&
                            (H.preventDefault(), B.trim() && K && K(R, B.trim()), v(''), S(null)),
                          H.key === 'Escape' && (S(null), v('')));
                      },
                      placeholder: 'Reply or add others with @',
                      style: {
                        width: '100%',
                        border: '1px solid #1a73e8',
                        borderRadius: 20,
                        outline: 'none',
                        fontSize: 14,
                        padding: '8px 16px',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                        color: '#202124',
                      },
                    }),
                    jsxRuntime.jsxs('div', {
                      style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
                      children: [
                        jsxRuntime.jsx('button', {
                          onClick: (H) => {
                            (H.stopPropagation(), S(null), v(''));
                          },
                          style: Bc,
                          children: 'Cancel',
                        }),
                        jsxRuntime.jsx('button', {
                          onClick: (H) => {
                            (H.stopPropagation(), B.trim() && K && K(R, B.trim()), v(''), S(null));
                          },
                          disabled: !B.trim(),
                          style: Z(!!B.trim()),
                          children: 'Reply',
                        }),
                      ],
                    }),
                  ],
                })
              : jsxRuntime.jsx('input', {
                  readOnly: true,
                  onMouseDown: (H) => H.stopPropagation(),
                  onClick: (H) => {
                    (H.stopPropagation(), S(R));
                  },
                  placeholder: 'Reply or add others with @',
                  style: {
                    width: '100%',
                    border: '1px solid #dadce0',
                    borderRadius: 20,
                    outline: 'none',
                    fontSize: 14,
                    padding: '8px 16px',
                    fontFamily: 'inherit',
                    color: '#80868b',
                    cursor: 'text',
                    backgroundColor: '#fff',
                    boxSizing: 'border-box',
                  },
                }),
        }),
      oe = (R) => {
        let K = P(R.id),
          H = `comment-${R.id}`,
          ge = ee === H,
          he = ce.get(H);
        return jsxRuntime.jsxs(
          'div',
          {
            ref: (ye) => {
              ye ? Ie.current.set(H, ye) : Ie.current.delete(H);
            },
            'data-comment-id': R.id,
            className: 'docx-comment-card',
            onClick: () => L(H, R.id),
            onMouseDown: (ye) => ye.stopPropagation(),
            style: { ...le(H, ge, he), opacity: I && he === void 0 ? 0 : R.done ? 0.6 : 1 },
            children: [
              jsxRuntime.jsxs('div', {
                style: { display: 'flex', alignItems: 'flex-start', gap: 10 },
                children: [
                  jsxRuntime.jsx('div', {
                    style: E(R.author || 'U'),
                    children: Ps(R.author || 'U'),
                  }),
                  jsxRuntime.jsxs('div', {
                    style: { flex: 1, minWidth: 0 },
                    children: [
                      jsxRuntime.jsx('div', {
                        style: { fontSize: 13, fontWeight: 600, color: '#202124' },
                        children: R.author || 'Unknown',
                      }),
                      jsxRuntime.jsx('div', {
                        style: { fontSize: 11, color: '#5f6368' },
                        children: Es(R.date),
                      }),
                    ],
                  }),
                  ge &&
                    jsxRuntime.jsxs('div', {
                      style: { display: 'flex', gap: 4, marginTop: 2, position: 'relative' },
                      children: [
                        jsxRuntime.jsx('button', {
                          onClick: (ye) => {
                            (ye.stopPropagation(), r?.(R.id));
                          },
                          title: 'Resolve',
                          style: di,
                          children: jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: 'check', size: 20 }),
                        }),
                        jsxRuntime.jsx('button', {
                          onClick: (ye) => {
                            (ye.stopPropagation(), ne(N === H ? null : H));
                          },
                          title: 'More options',
                          style: di,
                          children: jsxRuntime.jsx(chunkEOTZWQND_js.d, {
                            name: 'more_vert',
                            size: 20,
                          }),
                        }),
                        N === H &&
                          jsxRuntime.jsx('div', {
                            onClick: (ye) => ye.stopPropagation(),
                            onMouseDown: (ye) => ye.stopPropagation(),
                            style: {
                              position: 'absolute',
                              top: 32,
                              right: 0,
                              background: '#fff',
                              borderRadius: 8,
                              boxShadow:
                                '0 2px 6px rgba(60,64,67,0.3), 0 1px 2px rgba(60,64,67,0.15)',
                              zIndex: 100,
                              minWidth: 120,
                              padding: '4px 0',
                            },
                            children: jsxRuntime.jsx('button', {
                              onClick: () => {
                                (ne(null), i?.(R.id));
                              },
                              style: {
                                display: 'block',
                                width: '100%',
                                padding: '8px 16px',
                                border: 'none',
                                background: 'none',
                                textAlign: 'left',
                                fontSize: 14,
                                color: '#202124',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              },
                              onMouseOver: (ye) => {
                                ye.target.style.backgroundColor = '#f1f3f4';
                              },
                              onMouseOut: (ye) => {
                                ye.target.style.backgroundColor = 'transparent';
                              },
                              children: 'Delete',
                            }),
                          }),
                      ],
                    }),
                ],
              }),
              jsxRuntime.jsx('div', {
                style: { fontSize: 13, color: '#202124', lineHeight: '20px', marginTop: 6 },
                children: Fc(R.content),
              }),
              _(K, ge),
              ge && !R.done && J(R.id, o),
            ],
          },
          R.id
        );
      },
      fe = (R) => Ue.get(R) ?? [],
      Ce = (R, K) => {
        let H = R.author || 'Unknown',
          ge = `tc-${R.revisionId}-${K}`,
          he = ee === ge,
          ye = ce.get(ge),
          De = fe(R.revisionId);
        return jsxRuntime.jsxs(
          'div',
          {
            ref: (xe) => {
              xe ? Ie.current.set(ge, xe) : Ie.current.delete(ge);
            },
            className: 'docx-tracked-change-card',
            onClick: () => L(ge),
            onMouseDown: (xe) => xe.stopPropagation(),
            style: le(ge, he, ye),
            children: [
              jsxRuntime.jsxs('div', {
                style: { display: 'flex', alignItems: 'flex-start', gap: 10 },
                children: [
                  jsxRuntime.jsx('div', { style: E(H), children: Ps(H) }),
                  jsxRuntime.jsxs('div', {
                    style: { flex: 1, minWidth: 0 },
                    children: [
                      jsxRuntime.jsx('div', {
                        style: { fontSize: 13, fontWeight: 600, color: '#202124' },
                        children: H,
                      }),
                      R.date &&
                        jsxRuntime.jsx('div', {
                          style: { fontSize: 11, color: '#5f6368' },
                          children: Es(R.date),
                        }),
                    ],
                  }),
                  he &&
                    jsxRuntime.jsxs('div', {
                      style: { display: 'flex', gap: 4, marginTop: 2 },
                      children: [
                        jsxRuntime.jsx('button', {
                          onClick: (xe) => {
                            (xe.stopPropagation(), l?.(R.from, R.to));
                          },
                          title: 'Accept',
                          style: di,
                          children: jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: 'check', size: 20 }),
                        }),
                        jsxRuntime.jsx('button', {
                          onClick: (xe) => {
                            (xe.stopPropagation(), u?.(R.from, R.to));
                          },
                          title: 'Reject',
                          style: di,
                          children: jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: 'close', size: 20 }),
                        }),
                      ],
                    }),
                ],
              }),
              jsxRuntime.jsxs('div', {
                style: { fontSize: 13, lineHeight: '20px', color: '#202124', marginTop: 6 },
                children: [
                  R.type === 'insertion' ? 'Added' : 'Deleted',
                  ' ',
                  jsxRuntime.jsxs('span', {
                    style: {
                      color: R.type === 'insertion' ? '#137333' : '#c5221f',
                      fontWeight: 500,
                    },
                    children: ['"', R.text.length > 50 ? R.text.slice(0, 50) + '...' : R.text, '"'],
                  }),
                ],
              }),
              _(De, he),
              he && J(R.revisionId, d),
            ],
          },
          ge
        );
      };
    return jsxRuntime.jsx('aside', {
      ref: A,
      className: 'docx-comments-sidebar',
      role: 'complementary',
      'aria-label': 'Comments and changes',
      style: {
        position: 'absolute',
        top: c,
        left: `calc(50% - 120px + ${b / 2 + 12}px)`,
        bottom: 0,
        width: gm,
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        backgroundColor: 'transparent',
        overflowY: I ? 'visible' : 'auto',
        overflowX: 'visible',
        opacity: I ? 1 : 0,
        transition: 'opacity 0.15s ease',
      },
      onMouseDown: (R) => R.stopPropagation(),
      children: jsxRuntime.jsxs('div', {
        style: { position: 'relative' },
        children: [
          f &&
            jsxRuntime.jsxs('div', {
              ref: (R) => {
                R ? Ie.current.set('new-comment-input', R) : Ie.current.delete('new-comment-input');
              },
              style: {
                ...(I
                  ? ce.get('new-comment-input') !== void 0
                    ? { position: 'absolute', top: ce.get('new-comment-input'), left: 0, right: 0 }
                    : { position: 'absolute', top: 0, left: 0, right: 0, visibility: 'hidden' }
                  : { marginBottom: 8 }),
                padding: 12,
                borderRadius: 8,
                backgroundColor: '#fff',
                boxShadow: '0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)',
                zIndex: 50,
              },
              children: [
                jsxRuntime.jsx('textarea', {
                  ref: (R) => R?.focus({ preventScroll: true }),
                  value: M,
                  onChange: (R) => U(R.target.value),
                  onMouseDown: (R) => R.stopPropagation(),
                  onKeyDown: (R) => {
                    (R.stopPropagation(),
                      R.key === 'Enter' && !R.shiftKey && (R.preventDefault(), k()),
                      R.key === 'Escape' && (s?.(), U('')));
                  },
                  placeholder: 'Add a comment...',
                  style: {
                    width: '100%',
                    border: '1px solid #1a73e8',
                    borderRadius: 20,
                    outline: 'none',
                    resize: 'none',
                    fontSize: 14,
                    lineHeight: '20px',
                    padding: '8px 16px',
                    fontFamily: 'inherit',
                    minHeight: 40,
                    boxSizing: 'border-box',
                    color: '#202124',
                  },
                }),
                jsxRuntime.jsxs('div', {
                  style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
                  children: [
                    jsxRuntime.jsx('button', {
                      onClick: () => {
                        (s?.(), U(''));
                      },
                      style: Bc,
                      children: 'Cancel',
                    }),
                    jsxRuntime.jsx('button', {
                      onClick: k,
                      disabled: !M.trim(),
                      style: Z(!!M.trim()),
                      children: 'Comment',
                    }),
                  ],
                }),
              ],
            }),
          Fe.map((R) => oe(R)),
          t.map((R, K) => Ce(R, K)),
          Fe.length === 0 &&
            t.length === 0 &&
            !f &&
            jsxRuntime.jsx('div', {
              style: { padding: '24px 16px', textAlign: 'center', color: '#80868b', fontSize: 13 },
              children: 'No comments or changes yet.',
            }),
        ],
      }),
    });
  };
var xm = 15840,
  Hc = 1440,
  Sm = 1440,
  km = 567,
  Oc = 20,
  Tm = 'var(--doc-text-muted)',
  wm = 'var(--doc-text-subtle)',
  Cm = 'var(--doc-primary)',
  vm = 'var(--doc-primary)',
  Rm = 'var(--doc-primary-hover)';
function zc({
  sectionProps: e,
  zoom: t = 1,
  editable: n = false,
  onTopMarginChange: o,
  onBottomMarginChange: r,
  unit: i = 'inch',
  className: a = '',
  style: s,
}) {
  let [l, u] = uf.useState(null),
    [d, c] = uf.useState(null),
    p = uf.useRef(null),
    f = e?.pageHeight ?? xm,
    m = e?.marginTop ?? Hc,
    b = e?.marginBottom ?? Hc,
    g = chunkSE5EN2QL_js.a(f) * t,
    x = chunkSE5EN2QL_js.a(m) * t,
    T = chunkSE5EN2QL_js.a(b) * t,
    S = uf.useCallback(
      (ee, O) => {
        n && (ee.preventDefault(), u(O));
      },
      [n]
    ),
    B = uf.useCallback(
      (ee) => {
        if (!l || !p.current) return;
        let O = p.current.getBoundingClientRect(),
          N = ee.clientY - O.top,
          ne = chunkSE5EN2QL_js.b(N / t);
        if (l === 'topMargin') {
          let ce = f - b - 720,
            D = Math.max(0, Math.min(ne, ce));
          o?.(Math.round(D));
        } else if (l === 'bottomMargin') {
          let ce = f - ne,
            D = f - m - 720,
            z = Math.max(0, Math.min(ce, D));
          r?.(Math.round(z));
        }
      },
      [l, t, f, m, b, o, r]
    ),
    v = uf.useCallback(() => {
      u(null);
    }, []);
  uf.useEffect(() => {
    if (l)
      return (
        document.addEventListener('mousemove', B),
        document.addEventListener('mouseup', v),
        () => {
          (document.removeEventListener('mousemove', B),
            document.removeEventListener('mouseup', v));
        }
      );
  }, [l, B, v]);
  let M = Pm(f, t, i),
    U = {
      position: 'relative',
      width: Oc,
      height: chunkSE5EN2QL_js.k(g),
      backgroundColor: 'transparent',
      overflow: 'visible',
      userSelect: 'none',
      cursor: l ? 'ns-resize' : 'default',
      ...s,
    };
  return jsxRuntime.jsxs('div', {
    ref: p,
    className: `docx-vertical-ruler ${a}`,
    style: U,
    role: 'slider',
    'aria-label': 'Vertical ruler',
    'aria-orientation': 'vertical',
    children: [
      jsxRuntime.jsx('div', {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
        },
        children: M.map((ee, O) => jsxRuntime.jsx(Em, { tick: ee }, O)),
      }),
      jsxRuntime.jsx(Nc, {
        type: 'topMargin',
        position: x,
        editable: n,
        isDragging: l === 'topMargin',
        isHovered: d === 'topMargin',
        onMouseEnter: () => c('topMargin'),
        onMouseLeave: () => c(null),
        onMouseDown: (ee) => S(ee, 'topMargin'),
      }),
      jsxRuntime.jsx(Nc, {
        type: 'bottomMargin',
        position: g - T,
        editable: n,
        isDragging: l === 'bottomMargin',
        isHovered: d === 'bottomMargin',
        onMouseEnter: () => c('bottomMargin'),
        onMouseLeave: () => c(null),
        onMouseDown: (ee) => S(ee, 'bottomMargin'),
      }),
    ],
  });
}
function Em({ tick: e }) {
  let t = {
      position: 'absolute',
      top: chunkSE5EN2QL_js.k(e.position),
      right: 0,
      height: 1,
      width: e.width,
      backgroundColor: wm,
    },
    n = {
      position: 'absolute',
      top: chunkSE5EN2QL_js.k(e.position),
      left: 2,
      transform: 'translateY(-50%)',
      fontSize: '9px',
      color: Tm,
      fontFamily: 'sans-serif',
      whiteSpace: 'nowrap',
    };
  return jsxRuntime.jsxs(jsxRuntime.Fragment, {
    children: [
      jsxRuntime.jsx('div', { style: t }),
      e.label && jsxRuntime.jsx('div', { style: n, children: e.label }),
    ],
  });
}
function Nc({
  type: e,
  position: t,
  editable: n,
  isDragging: o,
  isHovered: r,
  onMouseEnter: i,
  onMouseLeave: a,
  onMouseDown: s,
}) {
  let l = o ? Rm : r ? vm : Cm,
    u = {
      position: 'absolute',
      top: chunkSE5EN2QL_js.k(t - 5),
      right: 0,
      width: Oc,
      height: 10,
      cursor: n ? 'ns-resize' : 'default',
      zIndex: o ? 10 : 1,
    },
    d = {
      position: 'absolute',
      top: 0,
      right: 2,
      width: 0,
      height: 0,
      borderTop: '5px solid transparent',
      borderBottom: '5px solid transparent',
      borderRight: `8px solid ${l}`,
      transition: 'border-right-color 0.1s',
    };
  return jsxRuntime.jsx('div', {
    className: `docx-ruler-marker docx-ruler-marker-${e}`,
    style: u,
    onMouseEnter: i,
    onMouseLeave: a,
    onMouseDown: s,
    role: 'slider',
    'aria-label': e === 'topMargin' ? 'Top margin' : 'Bottom margin',
    'aria-orientation': 'vertical',
    tabIndex: n ? 0 : -1,
    children: jsxRuntime.jsx('div', { style: d }),
  });
}
function Pm(e, t, n) {
  let o = [];
  if (n === 'inch') {
    let r = Sm / 8,
      i = Math.ceil(e / r);
    for (let a = 0; a <= i; a++) {
      let s = a * r;
      if (s > e) break;
      let l = chunkSE5EN2QL_js.a(s) * t;
      if (a % 8 === 0) {
        let u = a / 8;
        o.push({ position: l, width: 10, label: u > 0 ? String(u) : void 0 });
      } else
        a % 4 === 0
          ? o.push({ position: l, width: 6 })
          : a % 2 === 0
            ? o.push({ position: l, width: 4 })
            : o.push({ position: l, width: 2 });
    }
  } else {
    let r = km / 10,
      i = Math.ceil(e / r);
    for (let a = 0; a <= i; a++) {
      let s = a * r;
      if (s > e) break;
      let l = chunkSE5EN2QL_js.a(s) * t;
      if (a % 10 === 0) {
        let u = a / 10;
        o.push({ position: l, width: 10, label: u > 0 ? String(u) : void 0 });
      } else a % 5 === 0 ? o.push({ position: l, width: 6 }) : o.push({ position: l, width: 3 });
    }
  }
  return o;
}
var Qt = { High: 50, Default: 100, Low: 150 };
function gt(e) {
  return (t) => {
    let n = { ...e.defaultOptions, ...t };
    return {
      type: 'extension',
      config: { name: e.name, priority: e.priority ?? Qt.Default, options: n },
      onSchemaReady(o) {
        return e.onSchemaReady(o, n);
      },
    };
  };
}
function nt(e) {
  return (t) => {
    let n = { ...e.defaultOptions, ...t },
      o = typeof e.nodeSpec == 'function' ? e.nodeSpec(n) : e.nodeSpec;
    return {
      type: 'node',
      config: {
        name: e.name,
        priority: e.priority ?? Qt.Default,
        options: n,
        schemaNodeName: e.schemaNodeName,
        nodeSpec: o,
      },
      onSchemaReady(r) {
        return e.onSchemaReady?.(r, n) ?? {};
      },
    };
  };
}
function Ne(e) {
  return (t) => {
    let n = { ...e.defaultOptions, ...t },
      o = typeof e.markSpec == 'function' ? e.markSpec(n) : e.markSpec;
    return {
      type: 'mark',
      config: {
        name: e.name,
        priority: e.priority ?? Qt.Default,
        options: n,
        schemaMarkName: e.schemaMarkName,
        markSpec: o,
      },
      onSchemaReady(r) {
        return e.onSchemaReady?.(r, n) ?? {};
      },
    };
  };
}
var Wc = nt({
  name: 'doc',
  schemaNodeName: 'doc',
  nodeSpec: { content: '(paragraph | horizontalRule | pageBreak | table | textBox)+' },
});
var _c = nt({ name: 'text', schemaNodeName: 'text', nodeSpec: { group: 'inline' } });
function Vc(e, t) {
  if (!e) return {};
  let n = {};
  if (e.fontFamily) {
    let a = null;
    if (
      (e.fontFamily.asciiTheme && t?.fontScheme,
      a ||
        (a =
          e.fontFamily.ascii ||
          e.fontFamily.hAnsi ||
          e.fontFamily.eastAsia ||
          e.fontFamily.cs ||
          null),
      a)
    ) {
      let s = chunkQQ63M65M_js.a(a);
      n.fontFamily = s.cssFallback;
    }
  }
  if (
    (e.fontSize !== void 0 && (n.fontSize = `${chunkSE5EN2QL_js.i(e.fontSize)}pt`),
    e.bold && (n.fontWeight = 'bold'),
    e.italic && (n.fontStyle = 'italic'),
    e.color && (n.color = chunk4VUZBV2S_js.a(e.color, t)),
    e.highlight && e.highlight !== 'none' && (n.backgroundColor = chunk4VUZBV2S_js.n(e.highlight)),
    e.shading)
  ) {
    let a = jc(e.shading, t);
    a && !n.backgroundColor && (n.backgroundColor = a);
  }
  let o = [],
    r = [],
    i = [];
  if (e.underline && e.underline.style !== 'none') {
    o.push('underline');
    let a = Im(e.underline.style);
    (a !== 'solid' && r.push(a),
      e.underline.color && i.push(chunk4VUZBV2S_js.a(e.underline.color, t)));
  }
  if (
    (e.strike && o.push('line-through'),
    e.doubleStrike && o.push('line-through'),
    o.length > 0 &&
      ((n.textDecoration = o.join(' ')),
      r.length > 0 && (n.textDecorationStyle = r[0]),
      i.length > 0 && (n.textDecorationColor = i[0])),
    e.vertAlign)
  )
    switch (e.vertAlign) {
      case 'superscript':
        ((n.verticalAlign = 'super'), n.fontSize || (n.fontSize = '0.83em'));
        break;
      case 'subscript':
        ((n.verticalAlign = 'sub'), n.fontSize || (n.fontSize = '0.83em'));
        break;
    }
  if (e.position && e.position !== 0) {
    let a = chunkSE5EN2QL_js.h(e.position);
    ((n.position = 'relative'), (n.top = chunkSE5EN2QL_js.k(-a)));
  }
  return (
    e.allCaps ? (n.textTransform = 'uppercase') : e.smallCaps && (n.fontVariant = 'small-caps'),
    e.spacing !== void 0 &&
      e.spacing !== 0 &&
      (n.letterSpacing = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.spacing))),
    e.scale !== void 0 &&
      e.scale !== 100 &&
      ((n.transform = `scaleX(${e.scale / 100})`), (n.display = 'inline-block')),
    e.hidden && (n.display = 'none'),
    e.emboss && (n.textShadow = '1px 1px 1px rgba(255,255,255,0.5), -1px -1px 1px rgba(0,0,0,0.3)'),
    e.imprint &&
      (n.textShadow = '-1px -1px 1px rgba(255,255,255,0.5), 1px 1px 1px rgba(0,0,0,0.3)'),
    e.outline &&
      ((n.WebkitTextStroke = '1px currentColor'), (n.WebkitTextFillColor = 'transparent')),
    e.shadow && !e.emboss && !e.imprint && (n.textShadow = '1px 1px 2px rgba(0,0,0,0.3)'),
    e.rtl && (n.direction = 'rtl'),
    n
  );
}
function Uc(e, t) {
  if (!e) return {};
  let n = {};
  if (
    (e.alignment && (n.textAlign = Fm(e.alignment)),
    e.spaceBefore !== void 0 &&
      (n.marginTop = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.spaceBefore))),
    e.spaceAfter !== void 0 &&
      (n.marginBottom = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.spaceAfter))),
    e.lineSpacing !== void 0 && e.lineSpacing > 0)
  )
    switch (e.lineSpacingRule) {
      case 'exact': {
        let o = chunkSE5EN2QL_js.a(e.lineSpacing);
        o > 0 && (n.lineHeight = chunkSE5EN2QL_js.k(o));
        break;
      }
      case 'atLeast': {
        let o = chunkSE5EN2QL_js.a(e.lineSpacing);
        o > 0 && ((n.minHeight = chunkSE5EN2QL_js.k(o)), (n.lineHeight = chunkSE5EN2QL_js.k(o)));
        break;
      }
      default: {
        let o = e.lineSpacing / 240;
        o > 0 && (n.lineHeight = o.toString());
        break;
      }
    }
  if (
    (e.indentLeft !== void 0 &&
      (n.marginLeft = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.indentLeft))),
    e.indentRight !== void 0 &&
      (n.marginRight = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.indentRight))),
    e.indentFirstLine !== void 0 &&
      (e.hangingIndent
        ? (n.textIndent = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.indentFirstLine)))
        : (n.textIndent = chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(e.indentFirstLine)))),
    e.borders &&
      (e.borders.top && Object.assign(n, zo(e.borders.top, 'Top', t)),
      e.borders.bottom && Object.assign(n, zo(e.borders.bottom, 'Bottom', t)),
      e.borders.left && Object.assign(n, zo(e.borders.left, 'Left', t)),
      e.borders.right && Object.assign(n, zo(e.borders.right, 'Right', t))),
    e.shading)
  ) {
    let o = jc(e.shading, t);
    o && (n.backgroundColor = o);
  }
  return (
    e.bidi && (n.direction = 'rtl'),
    e.pageBreakBefore && (n.pageBreakBefore = 'always'),
    e.keepNext && (n.pageBreakAfter = 'avoid'),
    e.keepLines && (n.pageBreakInside = 'avoid'),
    n
  );
}
function zo(e, t = '', n) {
  if (!e || e.style === 'none' || e.style === 'nil') return {};
  let o = {},
    r = e.size ? chunkSE5EN2QL_js.j(e.size) : 1,
    i = e.color ? chunk4VUZBV2S_js.a(e.color, n) : '#000000',
    a = Lm(e.style),
    s = `border${t}Width`,
    l = `border${t}Style`,
    u = `border${t}Color`;
  return ((o[s] = chunkSE5EN2QL_js.k(Math.max(1, r))), (o[l] = a), (o[u] = i), o);
}
function jc(e, t) {
  return !e || e.pattern === 'clear' || e.pattern === 'nil'
    ? ''
    : e.fill
      ? e.fill.auto || e.fill.rgb === 'auto' || e.fill.rgb === 'FFFFFF'
        ? ''
        : chunk4VUZBV2S_js.c(e.fill, t)
      : e.pattern === 'solid' && e.color
        ? chunk4VUZBV2S_js.c(e.color, t)
        : e.pattern && e.pattern.startsWith('pct') && e.color
          ? chunk4VUZBV2S_js.c(e.color, t)
          : '';
}
function Im(e) {
  switch (e) {
    case 'double':
      return 'double';
    case 'dotted':
    case 'dottedHeavy':
      return 'dotted';
    case 'dash':
    case 'dashedHeavy':
    case 'dashLong':
    case 'dashLongHeavy':
    case 'dotDash':
    case 'dashDotHeavy':
    case 'dotDotDash':
    case 'dashDotDotHeavy':
      return 'dashed';
    case 'wave':
    case 'wavyHeavy':
    case 'wavyDouble':
      return 'wavy';
    default:
      return 'solid';
  }
}
function Fm(e) {
  switch (e) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'both':
    case 'distribute':
      return 'justify';
    default:
      return 'left';
  }
}
function Lm(e) {
  switch (e) {
    case 'none':
    case 'nil':
      return 'none';
    case 'double':
    case 'triple':
      return 'double';
    case 'dotted':
      return 'dotted';
    case 'dashed':
    case 'dashSmallGap':
      return 'dashed';
    case 'threeDEmboss':
      return 'ridge';
    case 'threeDEngrave':
      return 'groove';
    case 'outset':
      return 'outset';
    case 'inset':
      return 'inset';
    default:
      return 'solid';
  }
}
function $o(e) {
  let t = [];
  return (
    e.descendants((n, o) => {
      if (n.type.name === 'paragraph') {
        let r = n.attrs.outlineLevel,
          i = n.attrs.styleId,
          a = r;
        if (a == null && i) {
          let s = i.match(/^[Hh]eading(\d)$/);
          s && (a = parseInt(s[1], 10) - 1);
        }
        if (a != null && a >= 0 && a <= 8) {
          let s = '';
          (n.forEach((l) => {
            l.isText && (s += l.text || '');
          }),
            s.trim() && t.push({ text: s.trim(), level: a, pmPos: o }));
        }
      }
    }),
    t
  );
}
function Dm(e) {
  let t = e.indentLeft;
  e.numPr?.numId && t == null && (t = ((e.numPr.ilvl ?? 0) + 1) * 720);
  let n = {
      alignment: e.alignment,
      spaceBefore: e.spaceBefore,
      spaceAfter: e.spaceAfter,
      lineSpacing: e.lineSpacing,
      lineSpacingRule: e.lineSpacingRule,
      indentLeft: t,
      indentRight: e.indentRight,
      indentFirstLine: e.indentFirstLine,
      hangingIndent: e.hangingIndent,
      borders: e.borders,
      shading: e.shading,
    },
    o = Uc(n);
  return Object.entries(o)
    .map(([r, i]) => `${r.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${i}`)
    .join('; ');
}
function Am(e) {
  switch (e) {
    case 'upperRoman':
      return 'docx-list-upper-roman';
    case 'lowerRoman':
      return 'docx-list-lower-roman';
    case 'upperLetter':
      return 'docx-list-upper-alpha';
    case 'lowerLetter':
      return 'docx-list-lower-alpha';
    default:
      return 'docx-list-decimal';
  }
}
function Hm(e, t, n) {
  if (!e?.numId) return '';
  let o = e.ilvl ?? 0;
  return t
    ? `docx-list-bullet docx-list-level-${o}`
    : `docx-list-numbered ${Am(n)} docx-list-level-${o}`;
}
function Wo(e) {
  if (!e) return;
  let t = e.trim(),
    n = parseFloat(t);
  if (!(isNaN(n) || n === 0)) {
    if (t.endsWith('pt')) return Math.round(n * 20);
    if (t.endsWith('px')) return Math.round(n * 15);
    if (t.endsWith('in')) return Math.round(n * 1440);
    if (t.endsWith('mm')) return Math.round(n * (1440 / 25.4));
    if (t.endsWith('cm')) return Math.round(n * (1440 / 2.54));
    if (/^[\d.]+$/.test(t)) return Math.round(n * 15);
  }
}
function Nm(e) {
  switch (e.trim().toLowerCase()) {
    case 'left':
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'justify':
      return 'both';
    default:
      return;
  }
}
function Om(e) {
  if (!e || e === 'normal') return;
  let t = e.trim();
  if (t.endsWith('%')) {
    let o = parseFloat(t);
    return isNaN(o) || o === 0
      ? void 0
      : { lineSpacing: Math.round(240 * (o / 100)), lineSpacingRule: 'auto' };
  }
  if (/[a-z]/i.test(t)) {
    let o = Wo(t);
    return o == null ? void 0 : { lineSpacing: o, lineSpacingRule: 'exact' };
  }
  let n = parseFloat(t);
  if (!(isNaN(n) || n === 0)) return { lineSpacing: Math.round(240 * n), lineSpacingRule: 'auto' };
}
function Gc(e) {
  let t = e.style,
    n = {};
  if (t.textAlign) {
    let i = Nm(t.textAlign);
    i && (n.alignment = i);
  }
  let o = t.marginLeft || t.paddingLeft;
  if (o) {
    let i = Wo(o);
    i != null && (n.indentLeft = i);
  }
  let r = t.marginRight || t.paddingRight;
  if (r) {
    let i = Wo(r);
    i != null && (n.indentRight = i);
  }
  if (t.textIndent) {
    let i = Wo(t.textIndent);
    i != null &&
      (i < 0
        ? ((n.indentFirstLine = Math.abs(i)), (n.hangingIndent = true))
        : (n.indentFirstLine = i));
  }
  if (t.lineHeight) {
    let i = Om(t.lineHeight);
    i && ((n.lineSpacing = i.lineSpacing), (n.lineSpacingRule = i.lineSpacingRule));
  }
  if (t.marginTop) {
    let i = Wo(t.marginTop);
    i != null && (n.spaceBefore = i);
  }
  if (t.marginBottom) {
    let i = Wo(t.marginBottom);
    i != null && (n.spaceAfter = i);
  }
  return n;
}
var zm = {
  content: 'inline*',
  group: 'block',
  attrs: {
    paraId: { default: null },
    textId: { default: null },
    alignment: { default: null },
    spaceBefore: { default: null },
    spaceAfter: { default: null },
    lineSpacing: { default: null },
    lineSpacingRule: { default: null },
    indentLeft: { default: null },
    indentRight: { default: null },
    indentFirstLine: { default: null },
    hangingIndent: { default: false },
    numPr: { default: null },
    listNumFmt: { default: null },
    listIsBullet: { default: null },
    listMarker: { default: null },
    listMarkerHidden: { default: null },
    listMarkerFontFamily: { default: null },
    listMarkerFontSize: { default: null },
    styleId: { default: null },
    borders: { default: null },
    shading: { default: null },
    tabs: { default: null },
    pageBreakBefore: { default: null },
    keepNext: { default: null },
    keepLines: { default: null },
    contextualSpacing: { default: null },
    defaultTextFormatting: { default: null },
    sectionBreakType: { default: null },
    bidi: { default: null },
    outlineLevel: { default: null },
    bookmarks: { default: null },
    _originalFormatting: { default: null },
    _sectionProperties: { default: null },
  },
  parseDOM: [
    {
      tag: 'p',
      getAttrs(e) {
        let t = e,
          n = {
            paraId: t.dataset.paraId || void 0,
            alignment: t.dataset.alignment,
            styleId: t.dataset.styleId || void 0,
            sectionBreakType: t.dataset.sectionBreak || void 0,
          },
          o = Gc(t);
        return { ...o, ...n, alignment: n.alignment || o.alignment || void 0 };
      },
    },
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((e) => ({
      tag: e,
      getAttrs(t) {
        let n = parseInt(e.charAt(1));
        return { ...Gc(t), styleId: `Heading${n}`, outlineLevel: n - 1 };
      },
    })),
  ],
  toDOM(e) {
    let t = e.attrs,
      n = Dm(t),
      o = Hm(t.numPr, t.listIsBullet, t.listNumFmt),
      r = {};
    return (
      n && (r.style = n),
      o && (r.class = o),
      t.paraId && (r['data-para-id'] = t.paraId),
      t.alignment && (r['data-alignment'] = t.alignment),
      t.styleId && (r['data-style-id'] = t.styleId),
      t.listMarker && (r['data-list-marker'] = t.listMarker),
      t.bidi && (r.dir = 'rtl'),
      t.sectionBreakType &&
        ((r['data-section-break'] = t.sectionBreakType),
        (r.class = (r.class ? r.class + ' ' : '') + 'docx-section-break')),
      ['p', r, 0]
    );
  },
};
function _t(e, t) {
  return (n, o) => {
    let { $from: r, $to: i } = n.selection;
    if (!o) return true;
    let a = n.tr,
      s = new Set();
    return (
      n.doc.nodesBetween(r.pos, i.pos, (l, u) => {
        l.type.name === 'paragraph' &&
          !s.has(u) &&
          (s.add(u), (a = a.setNodeMarkup(u, void 0, { ...l.attrs, [e]: t })));
      }),
      o(a.scrollIntoView()),
      true
    );
  };
}
function Kc(e) {
  return (t, n) => {
    let { $from: o, $to: r } = t.selection;
    if (!n) return true;
    let i = t.tr,
      a = new Set();
    return (
      t.doc.nodesBetween(o.pos, r.pos, (s, l) => {
        s.type.name === 'paragraph' &&
          !a.has(l) &&
          (a.add(l), (i = i.setNodeMarkup(l, void 0, { ...s.attrs, ...e })));
      }),
      n(i.scrollIntoView()),
      true
    );
  };
}
function yr(e) {
  return (t, n) => _t('alignment', e)(t, n);
}
function ui(e, t = 'auto') {
  return (n, o) => Kc({ lineSpacing: e, lineSpacingRule: t })(n, o);
}
function $m(e = 720) {
  return (t, n) => {
    let { $from: o, $to: r } = t.selection;
    if (!n) return true;
    let i = t.tr,
      a = new Set();
    return (
      t.doc.nodesBetween(o.pos, r.pos, (s, l) => {
        if (s.type.name === 'paragraph' && !a.has(l)) {
          a.add(l);
          let u = s.attrs.indentLeft || 0;
          i = i.setNodeMarkup(l, void 0, { ...s.attrs, indentLeft: u + e });
        }
      }),
      n(i.scrollIntoView()),
      true
    );
  };
}
function Wm(e = 720) {
  return (t, n) => {
    let { $from: o, $to: r } = t.selection;
    if (!n) return true;
    let i = t.tr,
      a = new Set();
    return (
      t.doc.nodesBetween(o.pos, r.pos, (s, l) => {
        if (s.type.name === 'paragraph' && !a.has(l)) {
          a.add(l);
          let u = s.attrs.indentLeft || 0,
            d = Math.max(0, u - e);
          i = i.setNodeMarkup(l, void 0, { ...s.attrs, indentLeft: d > 0 ? d : null });
        }
      }),
      n(i.scrollIntoView()),
      true
    );
  };
}
function _m(e) {
  return (t, n) => (o, r) => {
    let { $from: i, $to: a } = o.selection;
    if (!r) return true;
    let s = o.tr,
      l = new Set(),
      u = [];
    if (n?.runFormatting) {
      let c = n.runFormatting;
      (c.bold && u.push(e.marks.bold.create()),
        c.italic && u.push(e.marks.italic.create()),
        c.fontSize && u.push(e.marks.fontSize.create({ size: c.fontSize })),
        c.fontFamily &&
          u.push(
            e.marks.fontFamily.create({
              ascii: c.fontFamily.ascii,
              hAnsi: c.fontFamily.hAnsi,
              asciiTheme: c.fontFamily.asciiTheme,
            })
          ),
        c.color &&
          !c.color.auto &&
          u.push(
            e.marks.textColor.create({
              rgb: c.color.rgb,
              themeColor: c.color.themeColor,
              themeTint: c.color.themeTint,
              themeShade: c.color.themeShade,
            })
          ),
        c.underline &&
          c.underline.style !== 'none' &&
          u.push(e.marks.underline.create({ style: c.underline.style, color: c.underline.color })),
        (c.strike || c.doubleStrike) &&
          u.push(e.marks.strike.create({ double: c.doubleStrike || false })));
    }
    let d = [
      e.marks.bold,
      e.marks.italic,
      e.marks.fontSize,
      e.marks.fontFamily,
      e.marks.textColor,
      e.marks.underline,
      e.marks.strike,
    ].filter(Boolean);
    return (
      o.doc.nodesBetween(i.pos, a.pos, (c, p) => {
        if (c.type.name === 'paragraph' && !l.has(p)) {
          l.add(p);
          let f = { ...c.attrs, styleId: t };
          if (n) {
            let m = n.paragraphFormatting;
            ((f.alignment = m?.alignment ?? null),
              (f.spaceBefore = m?.spaceBefore ?? null),
              (f.spaceAfter = m?.spaceAfter ?? null),
              (f.lineSpacing = m?.lineSpacing ?? null),
              (f.lineSpacingRule = m?.lineSpacingRule ?? null),
              (f.indentLeft = m?.indentLeft ?? null),
              (f.indentRight = m?.indentRight ?? null),
              (f.indentFirstLine = m?.indentFirstLine ?? null),
              (f.hangingIndent = m?.hangingIndent ?? null),
              (f.contextualSpacing = m?.contextualSpacing ?? null),
              (f.keepNext = m?.keepNext ?? null),
              (f.keepLines = m?.keepLines ?? null),
              (f.pageBreakBefore = m?.pageBreakBefore ?? null),
              (f.outlineLevel = m?.outlineLevel ?? null));
          }
          if (((s = s.setNodeMarkup(p, void 0, f)), n)) {
            let m = p + 1,
              b = p + c.nodeSize - 1;
            if (b > m) {
              for (let g of d) s = s.removeMark(m, b, g);
              for (let g of u) s = s.addMark(m, b, g);
            }
          }
        }
      }),
      u.length > 0 && (s = s.setStoredMarks(u)),
      r(s.scrollIntoView()),
      true
    );
  };
}
var Yc = nt({
  name: 'paragraph',
  schemaNodeName: 'paragraph',
  nodeSpec: zm,
  onSchemaReady(e) {
    let t = _m(e.schema);
    return {
      commands: {
        setAlignment: (n) => yr(n),
        alignLeft: () => yr('left'),
        alignCenter: () => yr('center'),
        alignRight: () => yr('right'),
        alignJustify: () => yr('both'),
        setLineSpacing: (n, o) => ui(n, o),
        singleSpacing: () => ui(240),
        oneAndHalfSpacing: () => ui(360),
        doubleSpacing: () => ui(480),
        setSpaceBefore: (n) => _t('spaceBefore', n),
        setSpaceAfter: (n) => _t('spaceAfter', n),
        increaseIndent: (n) => $m(n),
        decreaseIndent: (n) => Wm(n),
        setIndentLeft: (n) => _t('indentLeft', n > 0 ? n : null),
        setIndentRight: (n) => _t('indentRight', n > 0 ? n : null),
        setIndentFirstLine: (n, o) =>
          Kc({ indentFirstLine: n > 0 ? n : null, hangingIndent: o ?? false }),
        applyStyle: (n, o) => t(n, o),
        clearStyle: () => _t('styleId', null),
        insertSectionBreak: (n) => _t('sectionBreakType', n),
        removeSectionBreak: () => _t('sectionBreakType', null),
        generateTOC: () => (n, o) => {
          let r = $o(n.doc);
          if (r.length === 0) return false;
          if (!o) return true;
          let { schema: i } = n,
            a = n.tr,
            s = [];
          for (let d of r) {
            let c = `_Toc${Math.floor(1e8 + Math.random() * 9e8)}`;
            s.push({ name: c, level: d.level, text: d.text });
            let p = a.mapping.map(d.pmPos),
              m = a.doc.resolve(p).nodeAfter;
            if (m && m.type.name === 'paragraph') {
              let x = [
                ...(m.attrs.bookmarks || []).filter((T) => !T.name.startsWith('_Toc')),
                { id: Math.floor(Math.random() * 2147483647), name: c },
              ];
              a.setNodeMarkup(p, void 0, { ...m.attrs, bookmarks: x });
            }
          }
          let l = [];
          l.push(
            i.node('paragraph', { styleId: 'TOCHeading', alignment: 'center' }, [
              i.text('Table of Contents', [i.marks.bold.create()]),
            ])
          );
          for (let d of s) {
            let c = d.level * 720,
              p = `TOC${d.level + 1}`,
              f = i.marks.hyperlink.create({ href: `#${d.name}` });
            l.push(
              i.node('paragraph', { styleId: p, indentLeft: c > 0 ? c : null }, [
                i.text(d.text, [f]),
              ])
            );
          }
          let u = a.mapping.map(n.selection.from);
          return (a.insert(u, prosemirrorModel.Fragment.from(l)), o(a.scrollIntoView()), true);
        },
        toggleBidi: () => (n, o) => {
          let { $from: r } = n.selection,
            i = r.parent;
          if (i.type.name !== 'paragraph') return false;
          let a = i.attrs.bidi || false;
          return _t('bidi', a ? null : true)(n, o);
        },
        setRtl: () => _t('bidi', true),
        setLtr: () => _t('bidi', null),
        setTabs: (n) => _t('tabs', n.length > 0 ? n : null),
        addTabStop:
          (n, o = 'left', r = 'none') =>
          (i, a) => {
            let { $from: s } = i.selection,
              l = s.parent;
            if (l.type.name !== 'paragraph') return false;
            let c = [
              ...(l.attrs.tabs || []).filter((p) => p.position !== n),
              { position: n, alignment: o, leader: r },
            ].sort((p, f) => p.position - f.position);
            return _t('tabs', c)(i, a);
          },
        removeTabStop: (n) => (o, r) => {
          let { $from: i } = o.selection,
            a = i.parent;
          if (a.type.name !== 'paragraph') return false;
          let l = (a.attrs.tabs || []).filter((u) => u.position !== n);
          return _t('tabs', l.length > 0 ? l : null)(o, r);
        },
      },
    };
  },
});
var Xc = gt({
  name: 'history',
  defaultOptions: { depth: 100, newGroupDelay: 500 },
  onSchemaReady(e, t) {
    return {
      plugins: [prosemirrorHistory.history({ depth: t.depth, newGroupDelay: t.newGroupDelay })],
      commands: { undo: () => prosemirrorHistory.undo, redo: () => prosemirrorHistory.redo },
      keyboardShortcuts: {
        'Mod-z': prosemirrorHistory.undo,
        'Mod-y': prosemirrorHistory.redo,
        'Mod-Shift-z': prosemirrorHistory.redo,
      },
    };
  },
});
var Jc = Ne({
  name: 'bold',
  schemaMarkName: 'bold',
  markSpec: {
    parseDOM: [
      { tag: 'strong' },
      {
        tag: 'b',
        getAttrs(e) {
          let t = e.style?.fontWeight;
          return t === 'normal' || t === '400' ? false : null;
        },
      },
      {
        style: 'font-weight',
        getAttrs: (e) => (/^(bold(er)?|[5-9]\d{2})$/.test(e) ? null : false),
      },
    ],
    toDOM() {
      return ['strong', 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: { toggleBold: () => prosemirrorCommands.toggleMark(e.schema.marks.bold) },
      keyboardShortcuts: { 'Mod-b': prosemirrorCommands.toggleMark(e.schema.marks.bold) },
    };
  },
});
var ed = Ne({
  name: 'italic',
  schemaMarkName: 'italic',
  markSpec: {
    parseDOM: [
      { tag: 'i' },
      { tag: 'em' },
      { style: 'font-style', getAttrs: (e) => (e === 'italic' ? null : false) },
    ],
    toDOM() {
      return ['em', 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: { toggleItalic: () => prosemirrorCommands.toggleMark(e.schema.marks.italic) },
      keyboardShortcuts: { 'Mod-i': prosemirrorCommands.toggleMark(e.schema.marks.italic) },
    };
  },
});
function Um(e) {
  let t = {};
  for (let n of e)
    switch (n.type.name) {
      case 'bold':
        t.bold = true;
        break;
      case 'italic':
        t.italic = true;
        break;
      case 'underline':
        t.underline = { style: n.attrs.style || 'single' };
        break;
      case 'strike':
        t.strike = true;
        break;
      case 'textColor':
        t.color = n.attrs;
        break;
      case 'highlight':
        t.highlight = n.attrs.color;
        break;
      case 'fontSize':
        t.fontSize = n.attrs.size;
        break;
      case 'fontFamily':
        t.fontFamily = { ascii: n.attrs.ascii, hAnsi: n.attrs.hAnsi };
        break;
      case 'superscript':
        t.vertAlign = 'superscript';
        break;
      case 'subscript':
        t.vertAlign = 'subscript';
        break;
    }
  return t;
}
function td(e, t) {
  let { $from: n } = e.selection,
    o = n.parent;
  if (o.type.name !== 'paragraph' || o.textContent.length > 0) return t;
  let r = t.storedMarks || e.storedMarks || [];
  if (r.length === 0)
    return t.setNodeMarkup(n.before(), void 0, { ...o.attrs, defaultTextFormatting: null });
  let i = Um(r);
  return t.setNodeMarkup(n.before(), void 0, { ...o.attrs, defaultTextFormatting: i });
}
function hn(e, t) {
  return (n, o) => {
    let { from: r, to: i, empty: a } = n.selection,
      s = e.create(t);
    if (a) {
      if (o) {
        let l = e.isInSet(n.storedMarks || n.selection.$from.marks())
            ? (n.storedMarks || n.selection.$from.marks()).filter((d) => d.type !== e)
            : n.storedMarks || n.selection.$from.marks(),
          u = n.tr.setStoredMarks([...l, s]);
        ((u = td(n, u)), o(u));
      }
      return true;
    }
    return (o && o(n.tr.addMark(r, i, s).scrollIntoView()), true);
  };
}
function bn(e) {
  return (t, n) => {
    let { from: o, to: r, empty: i } = t.selection;
    if (i) {
      if (n) {
        let a = (t.storedMarks || t.selection.$from.marks()).filter((l) => l.type !== e),
          s = t.tr.setStoredMarks(a);
        ((s = td(t, s)), n(s));
      }
      return true;
    }
    return (n && n(t.tr.removeMark(o, r, e).scrollIntoView()), true);
  };
}
function Fs(e, t) {
  let n = [];
  return (
    e.bold && n.push(t.marks.bold.create()),
    e.italic && n.push(t.marks.italic.create()),
    e.underline &&
      n.push(
        t.marks.underline.create({ style: e.underline.style || 'single', color: e.underline.color })
      ),
    e.strike && n.push(t.marks.strike.create()),
    e.doubleStrike && n.push(t.marks.strike.create({ double: true })),
    e.color &&
      n.push(
        t.marks.textColor.create({
          rgb: e.color.rgb,
          themeColor: e.color.themeColor,
          themeTint: e.color.themeTint,
          themeShade: e.color.themeShade,
        })
      ),
    e.highlight && n.push(t.marks.highlight.create({ color: e.highlight })),
    e.fontSize && n.push(t.marks.fontSize.create({ size: e.fontSize })),
    e.fontFamily &&
      n.push(
        t.marks.fontFamily.create({
          ascii: e.fontFamily.ascii,
          hAnsi: e.fontFamily.hAnsi,
          asciiTheme: e.fontFamily.asciiTheme,
        })
      ),
    e.vertAlign === 'superscript' && n.push(t.marks.superscript.create()),
    e.vertAlign === 'subscript' && n.push(t.marks.subscript.create()),
    n
  );
}
var xr = (e, t) => {
  let { from: n, to: o, empty: r } = e.selection;
  if (r) return (t && t(e.tr.setStoredMarks([])), true);
  if (t) {
    let i = e.tr;
    (e.doc.nodesBetween(n, o, (a, s) => {
      if (a.isText && a.marks.length > 0) {
        let l = Math.max(n, s),
          u = Math.min(o, s + a.nodeSize);
        for (let d of a.marks) i = i.removeMark(l, u, d.type);
      }
    }),
      t(i.scrollIntoView()));
  }
  return true;
};
var od = Ne({
  name: 'underline',
  schemaMarkName: 'underline',
  markSpec: {
    attrs: { style: { default: 'single' }, color: { default: null } },
    parseDOM: [
      { tag: 'u' },
      { style: 'text-decoration', getAttrs: (e) => (e.includes('underline') ? {} : false) },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = ['text-decoration: underline'];
      if (t.style && t.style !== 'single') {
        let r = { double: 'double', dotted: 'dotted', dash: 'dashed', wave: 'wavy' }[t.style];
        r && n.push(`text-decoration-style: ${r}`);
      }
      return (
        t.color?.rgb && n.push(`text-decoration-color: #${t.color.rgb}`),
        ['span', { style: n.join('; ') }, 0]
      );
    },
  },
  onSchemaReady(e) {
    return {
      commands: {
        toggleUnderline: () => prosemirrorCommands.toggleMark(e.schema.marks.underline),
        setUnderlineStyle: (t, n) => hn(e.schema.marks.underline, { style: t, color: n }),
      },
      keyboardShortcuts: { 'Mod-u': prosemirrorCommands.toggleMark(e.schema.marks.underline) },
    };
  },
});
var rd = Ne({
  name: 'strike',
  schemaMarkName: 'strike',
  markSpec: {
    attrs: { double: { default: false } },
    parseDOM: [
      { tag: 's' },
      { tag: 'strike' },
      { tag: 'del' },
      { style: 'text-decoration', getAttrs: (e) => (e.includes('line-through') ? {} : false) },
    ],
    toDOM() {
      return ['s', 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: { toggleStrike: () => prosemirrorCommands.toggleMark(e.schema.marks.strike) },
    };
  },
});
var id = Ne({
  name: 'textColor',
  schemaMarkName: 'textColor',
  markSpec: {
    attrs: {
      rgb: { default: null },
      themeColor: { default: null },
      themeTint: { default: null },
      themeShade: { default: null },
    },
    parseDOM: [
      {
        style: 'color',
        getAttrs: (e) => {
          let n = e.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
          return n ? { rgb: n[1].toUpperCase() } : false;
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = Vc({ color: t });
      return ['span', { style: n.color ? `color: ${n.color}` : '' }, 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: {
        setTextColor: (t) =>
          !t.rgb && !t.themeColor ? bn(e.schema.marks.textColor) : hn(e.schema.marks.textColor, t),
        clearTextColor: () => bn(e.schema.marks.textColor),
      },
    };
  },
});
var ad = Ne({
  name: 'highlight',
  schemaMarkName: 'highlight',
  markSpec: {
    attrs: { color: { default: 'yellow' } },
    parseDOM: [
      { tag: 'mark' },
      {
        style: 'background-color',
        getAttrs: (e) => (e && e !== 'transparent' && e !== 'inherit' ? { color: e } : false),
      },
    ],
    toDOM(e) {
      let t = e.attrs.color;
      return ['mark', { style: `background-color: ${chunk4VUZBV2S_js.n(t)}` }, 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: {
        setHighlight: (t) =>
          !t || t === 'none'
            ? bn(e.schema.marks.highlight)
            : hn(e.schema.marks.highlight, { color: t }),
        clearHighlight: () => bn(e.schema.marks.highlight),
      },
    };
  },
});
var sd = Ne({
  name: 'fontSize',
  schemaMarkName: 'fontSize',
  markSpec: {
    attrs: { size: { default: 24 } },
    parseDOM: [
      {
        style: 'font-size',
        getAttrs: (e) => {
          let t = e,
            n = t.match(/^([\d.]+)px$/);
          if (n) {
            let i = parseFloat(n[1]) * 0.75;
            return { size: Math.round(i * 2) };
          }
          let o = t.match(/^([\d.]+)pt$/);
          return o ? { size: Math.round(parseFloat(o[1]) * 2) } : false;
        },
      },
    ],
    toDOM(e) {
      let n = e.attrs.size / 2,
        o = (n * 1.15).toFixed(2);
      return ['span', { style: `font-size: ${n}pt; line-height: ${o}pt` }, 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: {
        setFontSize: (t) => hn(e.schema.marks.fontSize, { size: t }),
        clearFontSize: () => bn(e.schema.marks.fontSize),
      },
    };
  },
});
var ld = Ne({
  name: 'fontFamily',
  schemaMarkName: 'fontFamily',
  markSpec: {
    attrs: {
      ascii: { default: null },
      hAnsi: { default: null },
      eastAsia: { default: null },
      cs: { default: null },
      asciiTheme: { default: null },
      hAnsiTheme: { default: null },
      eastAsiaTheme: { default: null },
      csTheme: { default: null },
    },
    parseDOM: [
      {
        style: 'font-family',
        getAttrs: (e) => {
          let n = e.split(',')[0].trim().replace(/['"]/g, '');
          return n ? { ascii: n } : false;
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = t.ascii || t.hAnsi;
      return n
        ? ['span', { style: `font-family: ${n.includes(' ') ? `"${n}"` : n}, sans-serif` }, 0]
        : ['span', 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: {
        setFontFamily: (t) => hn(e.schema.marks.fontFamily, { ascii: t, hAnsi: t }),
        clearFontFamily: () => bn(e.schema.marks.fontFamily),
      },
    };
  },
});
var cd = Ne({
  name: 'superscript',
  schemaMarkName: 'superscript',
  markSpec: {
    excludes: 'subscript',
    parseDOM: [{ tag: 'sup' }],
    toDOM() {
      return ['sup', 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: {
        toggleSuperscript: () => prosemirrorCommands.toggleMark(e.schema.marks.superscript),
      },
    };
  },
});
var dd = Ne({
  name: 'subscript',
  schemaMarkName: 'subscript',
  markSpec: {
    excludes: 'superscript',
    parseDOM: [{ tag: 'sub' }],
    toDOM() {
      return ['sub', 0];
    },
  },
  onSchemaReady(e) {
    return {
      commands: { toggleSubscript: () => prosemirrorCommands.toggleMark(e.schema.marks.subscript) },
    };
  },
});
function _o(e) {
  let t = e.schema.marks.hyperlink;
  if (!t) return null;
  let { empty: n, $from: o, from: r, to: i } = e.selection;
  if (n) {
    let s = e.storedMarks || o.marks();
    for (let l of s) if (l.type === t) return { href: l.attrs.href, tooltip: l.attrs.tooltip };
    return null;
  }
  let a = null;
  return (
    e.doc.nodesBetween(r, i, (s) => {
      if (s.isText && a === null) {
        let l = t.isInSet(s.marks);
        if (l) return ((a = { href: l.attrs.href, tooltip: l.attrs.tooltip }), false);
      }
      return true;
    }),
    a
  );
}
function Vo(e) {
  let { from: t, to: n, empty: o } = e.selection;
  return o ? '' : e.doc.textBetween(t, n, '');
}
var ud = Ne({
  name: 'hyperlink',
  schemaMarkName: 'hyperlink',
  markSpec: {
    attrs: { href: {}, tooltip: { default: null }, rId: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (e) => {
          let t = e;
          return { href: t.getAttribute('href') || '', tooltip: t.getAttribute('title') || void 0 };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = { href: t.href, target: '_blank', rel: 'noopener noreferrer' };
      return (t.tooltip && (n.title = t.tooltip), ['a', n, 0]);
    },
  },
  onSchemaReady(e) {
    let t = e.schema.marks.hyperlink,
      n = (i, a) => (s, l) => {
        let { from: u, to: d, empty: c } = s.selection;
        if (c) return false;
        if (l) {
          let p = t.create({ href: i, tooltip: a || null }),
            f = s.tr.addMark(u, d, p),
            m = s.schema.marks.textColor;
          (m && (f = f.removeMark(u, d, m)), l(f.scrollIntoView()));
        }
        return true;
      },
      o = (i, a) => {
        let { from: s, to: l, empty: u } = i.selection;
        if (u) {
          let d = i.selection.$from;
          if (!d.marks().find((g) => g.type === t)) return false;
          let f = d.pos,
            m = d.pos;
          return (
            d.parent.forEach((g, x) => {
              if (g.isText) {
                let T = d.start() + x,
                  S = T + g.nodeSize;
                T <= d.pos &&
                  d.pos <= S &&
                  g.marks.some((v) => v.type === t) &&
                  ((f = Math.min(f, T)), (m = Math.max(m, S)));
              }
            }),
            a && a(i.tr.removeMark(f, m, t).scrollIntoView()),
            true
          );
        }
        return (a && a(i.tr.removeMark(s, l, t).scrollIntoView()), true);
      };
    return {
      commands: {
        setHyperlink: n,
        removeHyperlink: () => o,
        insertHyperlink: (i, a, s) => (l, u) => {
          if (u) {
            let d = t.create({ href: a, tooltip: s || null }),
              c = l.schema.text(i, [d]);
            u(l.tr.replaceSelectionWith(c, false).scrollIntoView());
          }
          return true;
        },
      },
    };
  },
});
var pd = Ne({
  name: 'allCaps',
  schemaMarkName: 'allCaps',
  markSpec: {
    parseDOM: [{ style: 'text-transform', getAttrs: (e) => (e === 'uppercase' ? {} : false) }],
    toDOM() {
      return ['span', { style: 'text-transform: uppercase' }, 0];
    },
  },
});
var fd = Ne({
  name: 'smallCaps',
  schemaMarkName: 'smallCaps',
  markSpec: {
    parseDOM: [{ style: 'font-variant', getAttrs: (e) => (e === 'small-caps' ? {} : false) }],
    toDOM() {
      return ['span', { style: 'font-variant: small-caps' }, 0];
    },
  },
});
var md = Ne({
  name: 'footnoteRef',
  schemaMarkName: 'footnoteRef',
  markSpec: {
    attrs: { id: {}, noteType: { default: 'footnote' } },
    parseDOM: [
      {
        tag: 'sup.docx-footnote-ref',
        getAttrs: (e) => {
          let t = e;
          return { id: t.dataset.id || '', noteType: t.dataset.noteType || 'footnote' };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs;
      return [
        'sup',
        { class: `docx-${t.noteType}-ref`, 'data-id': t.id, 'data-note-type': t.noteType },
        0,
      ];
    },
  },
  onSchemaReady(e) {
    let { schema: t } = e;
    function n(r) {
      return (i) => (a, s) => {
        if (!s) return true;
        let l = t.marks.footnoteRef.create({ id: String(i), noteType: r }),
          u = t.text(String(i), [l]),
          d = a.tr.replaceSelectionWith(u, false);
        return (s(d.scrollIntoView()), true);
      };
    }
    let o = (r, i) => {
      let { $from: a, $to: s } = r.selection;
      if (!i) return true;
      let l = r.tr,
        u = t.marks.footnoteRef;
      return ((l = l.removeMark(a.pos, s.pos, u)), i(l.scrollIntoView()), true);
    };
    return {
      commands: {
        insertFootnote: n('footnote'),
        insertEndnote: n('endnote'),
        deleteNoteRef: () => o,
      },
    };
  },
});
function Ym(e) {
  return (e / 2) * (96 / 72);
}
var gd = Ne({
  name: 'characterSpacing',
  schemaMarkName: 'characterSpacing',
  markSpec: {
    attrs: {
      spacing: { default: null },
      position: { default: null },
      scale: { default: null },
      kerning: { default: null },
    },
    parseDOM: [
      {
        tag: 'span.docx-char-spacing',
        getAttrs: (e) => {
          let t = e;
          return {
            spacing: t.dataset.spacing ? Number(t.dataset.spacing) : null,
            position: t.dataset.position ? Number(t.dataset.position) : null,
            scale: t.dataset.scale ? Number(t.dataset.scale) : null,
            kerning: t.dataset.kerning ? Number(t.dataset.kerning) : null,
          };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = [],
        o = { class: 'docx-char-spacing' };
      if (
        (t.spacing != null &&
          t.spacing !== 0 &&
          (n.push(`letter-spacing: ${chunkSE5EN2QL_js.k(chunkSE5EN2QL_js.a(t.spacing))}`),
          (o['data-spacing'] = String(t.spacing))),
        t.position != null && t.position !== 0)
      ) {
        let r = Ym(t.position);
        (n.push(`vertical-align: ${chunkSE5EN2QL_js.k(r)}`),
          (o['data-position'] = String(t.position)));
      }
      return (
        t.scale != null &&
          t.scale !== 100 &&
          (n.push(`transform: scaleX(${t.scale / 100})`),
          n.push('display: inline-block'),
          (o['data-scale'] = String(t.scale))),
        t.kerning != null && (o['data-kerning'] = String(t.kerning)),
        n.length > 0 && (o.style = n.join('; ')),
        ['span', o, 0]
      );
    },
  },
});
var hd = Ne({
  name: 'comment',
  schemaMarkName: 'comment',
  markSpec: {
    attrs: { commentId: { default: 0 } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span.docx-comment',
        getAttrs(e) {
          return { commentId: parseInt(e.dataset.commentId || '0', 10) };
        },
      },
    ],
    toDOM(e) {
      return [
        'span',
        {
          class: 'docx-comment',
          'data-comment-id': String(e.attrs.commentId),
          style:
            'background-color: rgba(255, 212, 0, 0.25); border-bottom: 2px solid rgba(255, 212, 0, 0.6);',
        },
        0,
      ];
    },
  },
});
var bd = Ne({
    name: 'insertion',
    schemaMarkName: 'insertion',
    markSpec: {
      attrs: { revisionId: { default: 0 }, author: { default: '' }, date: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'span.docx-insertion',
          getAttrs(e) {
            let t = e;
            return {
              revisionId: parseInt(t.dataset.revisionId || '0', 10),
              author: t.dataset.author || '',
              date: t.dataset.date || null,
            };
          },
        },
      ],
      toDOM(e) {
        return [
          'span',
          {
            class: 'docx-insertion',
            'data-revision-id': String(e.attrs.revisionId),
            'data-author': e.attrs.author,
            ...(e.attrs.date ? { 'data-date': e.attrs.date } : {}),
            style: 'color: #2e7d32; text-decoration: underline; text-decoration-color: #2e7d32;',
          },
          0,
        ];
      },
    },
  }),
  yd = Ne({
    name: 'deletion',
    schemaMarkName: 'deletion',
    markSpec: {
      attrs: { revisionId: { default: 0 }, author: { default: '' }, date: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'span.docx-deletion',
          getAttrs(e) {
            let t = e;
            return {
              revisionId: parseInt(t.dataset.revisionId || '0', 10),
              author: t.dataset.author || '',
              date: t.dataset.date || null,
            };
          },
        },
      ],
      toDOM(e) {
        return [
          'span',
          {
            class: 'docx-deletion',
            'data-revision-id': String(e.attrs.revisionId),
            'data-author': e.attrs.author,
            ...(e.attrs.date ? { 'data-date': e.attrs.date } : {}),
            style: 'color: #c62828; text-decoration: line-through; text-decoration-color: #c62828;',
          },
          0,
        ];
      },
    },
  });
var xd = Ne({
    name: 'emboss',
    schemaMarkName: 'emboss',
    markSpec: {
      parseDOM: [{ tag: 'span.docx-emboss' }],
      toDOM() {
        return [
          'span',
          {
            class: 'docx-emboss',
            style: 'text-shadow: 1px 1px 1px rgba(255,255,255,0.5), -1px -1px 1px rgba(0,0,0,0.3)',
          },
          0,
        ];
      },
    },
  }),
  Sd = Ne({
    name: 'imprint',
    schemaMarkName: 'imprint',
    markSpec: {
      parseDOM: [{ tag: 'span.docx-imprint' }],
      toDOM() {
        return [
          'span',
          {
            class: 'docx-imprint',
            style: '-1px -1px 1px rgba(255,255,255,0.5), 1px 1px 1px rgba(0,0,0,0.3)',
          },
          0,
        ];
      },
    },
  }),
  kd = Ne({
    name: 'textShadow',
    schemaMarkName: 'textShadow',
    markSpec: {
      parseDOM: [{ tag: 'span.docx-text-shadow' }],
      toDOM() {
        return [
          'span',
          { class: 'docx-text-shadow', style: 'text-shadow: 1px 1px 2px rgba(0,0,0,0.3)' },
          0,
        ];
      },
    },
  }),
  Td = Ne({
    name: 'emphasisMark',
    schemaMarkName: 'emphasisMark',
    markSpec: {
      attrs: { type: { default: 'dot' } },
      parseDOM: [
        { tag: 'span.docx-emphasis-mark', getAttrs: (e) => ({ type: e.dataset.emType || 'dot' }) },
      ],
      toDOM(e) {
        let t = e.attrs.type,
          n = 'filled dot';
        switch (t) {
          case 'dot':
            n = 'filled dot';
            break;
          case 'comma':
            n = 'filled sesame';
            break;
          case 'circle':
            n = 'filled circle';
            break;
          case 'underDot':
            n = 'filled dot';
            break;
        }
        let o = t === 'underDot' ? 'under right' : 'over right';
        return [
          'span',
          {
            class: 'docx-emphasis-mark',
            'data-em-type': t,
            style: `text-emphasis: ${n}; text-emphasis-position: ${o}; -webkit-text-emphasis: ${n}; -webkit-text-emphasis-position: ${o}`,
          },
          0,
        ];
      },
    },
  }),
  wd = Ne({
    name: 'textOutline',
    schemaMarkName: 'textOutline',
    markSpec: {
      parseDOM: [{ tag: 'span.docx-text-outline' }],
      toDOM() {
        return [
          'span',
          {
            class: 'docx-text-outline',
            style: '-webkit-text-stroke: 1px currentColor; -webkit-text-fill-color: transparent',
          },
          0,
        ];
      },
    },
  });
var Cd = nt({
  name: 'hardBreak',
  schemaNodeName: 'hardBreak',
  nodeSpec: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() {
      return ['br'];
    },
  },
  onSchemaReady(e) {
    let t = e.schema.nodes.hardBreak;
    return {
      keyboardShortcuts: {
        'Shift-Enter': (n, o) => (
          o && o(n.tr.replaceSelectionWith(t.create()).scrollIntoView()),
          true
        ),
      },
    };
  },
});
var vd = nt({
  name: 'tab',
  schemaNodeName: 'tab',
  nodeSpec: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'span.docx-tab' }],
    toDOM() {
      return [
        'span',
        { class: 'docx-tab', style: 'display: inline-block; min-width: 16px; white-space: pre;' },
        '	',
      ];
    },
  },
});
var Rd = nt({
  name: 'image',
  schemaNodeName: 'image',
  nodeSpec: {
    inline: true,
    group: 'inline',
    draggable: true,
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      rId: { default: null },
      wrapType: { default: 'inline' },
      displayMode: { default: 'inline' },
      cssFloat: { default: null },
      transform: { default: null },
      distTop: { default: null },
      distBottom: { default: null },
      distLeft: { default: null },
      distRight: { default: null },
      position: { default: null },
      borderWidth: { default: null },
      borderColor: { default: null },
      borderStyle: { default: null },
      wrapText: { default: null },
      hlinkHref: { default: null },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs(e) {
          let t = e;
          return {
            src: t.getAttribute('src') || '',
            alt: t.getAttribute('alt') || void 0,
            title: t.getAttribute('title') || void 0,
            width: t.width || void 0,
            height: t.height || void 0,
            rId: t.dataset.rid || void 0,
            wrapType: t.dataset.wrapType || 'inline',
            displayMode: t.dataset.displayMode || 'inline',
            cssFloat: t.dataset.cssFloat || void 0,
            transform: t.dataset.transform || void 0,
            borderWidth: t.dataset.borderWidth ? Number(t.dataset.borderWidth) : void 0,
            borderColor: t.dataset.borderColor || void 0,
            borderStyle: t.dataset.borderStyle || void 0,
          };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = { src: t.src, class: 'docx-image' };
      (t.alt && (n.alt = t.alt),
        t.title && (n.title = t.title),
        t.rId && (n['data-rid'] = t.rId),
        t.wrapType && (n['data-wrap-type'] = t.wrapType),
        t.displayMode && (n['data-display-mode'] = t.displayMode),
        t.cssFloat && (n['data-css-float'] = t.cssFloat),
        t.transform && (n['data-transform'] = t.transform),
        t.borderWidth && (n['data-border-width'] = String(t.borderWidth)),
        t.borderColor && (n['data-border-color'] = t.borderColor),
        t.borderStyle && (n['data-border-style'] = t.borderStyle));
      let o = [];
      if (
        (t.width && ((n.width = String(t.width)), o.push(`width: ${t.width}px`)),
        t.height && ((n.height = String(t.height)), o.push(`height: ${t.height}px`)),
        o.push('max-width: 100%'),
        t.width && t.height ? o.push('object-fit: contain') : o.push('height: auto'),
        t.displayMode === 'float' && t.cssFloat && t.cssFloat !== 'none')
      ) {
        (o.push(`float: ${t.cssFloat}`),
          (n.class += ` docx-image-float docx-image-float-${t.cssFloat}`));
        let r = t.distTop ?? 0,
          i = t.distBottom ?? 0,
          a = t.distLeft ?? 0,
          s = t.distRight ?? 0;
        t.cssFloat === 'left'
          ? o.push(`margin: ${r}px ${s || 12}px ${i}px ${a}px`)
          : o.push(`margin: ${r}px ${s}px ${i}px ${a || 12}px`);
      } else if (t.displayMode === 'block') {
        (o.push('display: block'),
          o.push('margin-left: auto'),
          o.push('margin-right: auto'),
          (n.class += ' docx-image-block'));
        let r = t.distTop ?? 0,
          i = t.distBottom ?? 0;
        (r > 0 && o.push(`margin-top: ${r}px`), i > 0 && o.push(`margin-bottom: ${i}px`));
      }
      if (
        (t.transform && o.push(`transform: ${t.transform}`), t.borderWidth && t.borderWidth > 0)
      ) {
        let r = t.borderStyle || 'solid',
          i = t.borderColor || '#000000';
        o.push(`border: ${t.borderWidth}px ${r} ${i}`);
      }
      return ((n.style = o.join('; ')), ['img', n]);
    },
  },
});
var Ed = nt({
  name: 'textBox',
  schemaNodeName: 'textBox',
  nodeSpec: {
    group: 'block',
    content: '(paragraph | table)+',
    isolating: true,
    draggable: true,
    attrs: {
      width: { default: 200 },
      height: { default: null },
      textBoxId: { default: null },
      fillColor: { default: null },
      outlineWidth: { default: null },
      outlineColor: { default: null },
      outlineStyle: { default: null },
      marginTop: { default: 4 },
      marginBottom: { default: 4 },
      marginLeft: { default: 7 },
      marginRight: { default: 7 },
      verticalAlign: { default: null },
      displayMode: { default: 'inline' },
      cssFloat: { default: null },
      wrapType: { default: 'inline' },
    },
    parseDOM: [
      {
        tag: 'div.docx-textbox',
        getAttrs(e) {
          let t = e;
          return {
            width: t.dataset.width ? Number(t.dataset.width) : void 0,
            height: t.dataset.height ? Number(t.dataset.height) : void 0,
            textBoxId: t.dataset.textboxId || void 0,
            fillColor: t.dataset.fillColor || void 0,
            outlineWidth: t.dataset.outlineWidth ? Number(t.dataset.outlineWidth) : void 0,
            outlineColor: t.dataset.outlineColor || void 0,
            outlineStyle: t.dataset.outlineStyle || void 0,
            marginTop: t.dataset.marginTop ? Number(t.dataset.marginTop) : void 0,
            marginBottom: t.dataset.marginBottom ? Number(t.dataset.marginBottom) : void 0,
            marginLeft: t.dataset.marginLeft ? Number(t.dataset.marginLeft) : void 0,
            marginRight: t.dataset.marginRight ? Number(t.dataset.marginRight) : void 0,
            verticalAlign: t.dataset.verticalAlign || void 0,
            displayMode: t.dataset.displayMode || void 0,
            cssFloat: t.dataset.cssFloat || void 0,
            wrapType: t.dataset.wrapType || void 0,
          };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = { class: 'docx-textbox' };
      (t.width && (n['data-width'] = String(t.width)),
        t.height && (n['data-height'] = String(t.height)),
        t.textBoxId && (n['data-textbox-id'] = t.textBoxId),
        t.fillColor && (n['data-fill-color'] = t.fillColor),
        t.outlineWidth && (n['data-outline-width'] = String(t.outlineWidth)),
        t.outlineColor && (n['data-outline-color'] = t.outlineColor),
        t.outlineStyle && (n['data-outline-style'] = t.outlineStyle),
        t.marginTop != null && (n['data-margin-top'] = String(t.marginTop)),
        t.marginBottom != null && (n['data-margin-bottom'] = String(t.marginBottom)),
        t.marginLeft != null && (n['data-margin-left'] = String(t.marginLeft)),
        t.marginRight != null && (n['data-margin-right'] = String(t.marginRight)),
        t.verticalAlign && (n['data-vertical-align'] = t.verticalAlign),
        t.displayMode && (n['data-display-mode'] = t.displayMode),
        t.cssFloat && (n['data-css-float'] = t.cssFloat),
        t.wrapType && (n['data-wrap-type'] = t.wrapType));
      let o = [];
      if (
        (t.width && o.push(`width: ${t.width}px`),
        t.height && o.push(`min-height: ${t.height}px`),
        t.fillColor && o.push(`background-color: ${t.fillColor}`),
        t.outlineWidth && t.outlineWidth > 0)
      ) {
        let l = t.outlineStyle || 'solid',
          u = t.outlineColor || '#000000';
        o.push(`border: ${t.outlineWidth}px ${l} ${u}`);
      } else o.push('border: 1px solid var(--doc-border, #d1d5db)');
      let r = t.marginTop ?? 4,
        i = t.marginBottom ?? 4,
        a = t.marginLeft ?? 7,
        s = t.marginRight ?? 7;
      return (
        o.push(`padding: ${r}px ${s}px ${i}px ${a}px`),
        t.verticalAlign === 'middle' || t.verticalAlign === 'center'
          ? (o.push('display: flex'),
            o.push('flex-direction: column'),
            o.push('justify-content: center'))
          : t.verticalAlign === 'bottom' &&
            (o.push('display: flex'),
            o.push('flex-direction: column'),
            o.push('justify-content: flex-end')),
        t.displayMode === 'float' && t.cssFloat && t.cssFloat !== 'none'
          ? (o.push(`float: ${t.cssFloat}`), o.push('margin: 4px 8px'))
          : t.displayMode === 'block' &&
            (o.push('margin-left: auto'), o.push('margin-right: auto')),
        o.push('box-sizing: border-box'),
        o.push('overflow: hidden'),
        o.push('position: relative'),
        (n.style = o.join('; ')),
        ['div', n, 0]
      );
    },
  },
});
function qm(e, t, n) {
  switch (e) {
    case 'ellipse':
    case 'oval':
      return `<ellipse cx="${t / 2}" cy="${n / 2}" rx="${t / 2}" ry="${n / 2}" />`;
    case 'roundRect':
      return `<rect x="0" y="0" width="${t}" height="${n}" rx="${Math.min(t, n) * 0.1}" />`;
    case 'triangle':
    case 'isosTriangle':
      return `<polygon points="${t / 2},0 ${t},${n} 0,${n}" />`;
    case 'diamond':
      return `<polygon points="${t / 2},0 ${t},${n / 2} ${t / 2},${n} 0,${n / 2}" />`;
    case 'line':
    case 'straightConnector1':
      return `<line x1="0" y1="${n / 2}" x2="${t}" y2="${n / 2}" />`;
    default:
      return `<rect x="0" y="0" width="${t}" height="${n}" />`;
  }
}
function Xm(e, t) {
  let n = '';
  try {
    n = JSON.parse(t.gradientStops || '[]')
      .map((c) => `<stop offset="${Math.round(c.position / 1e3)}%" stop-color="${c.color}" />`)
      .join('');
  } catch {
    return '';
  }
  let o = t.gradientType || 'linear';
  if (o === 'radial' || o === 'rectangular' || o === 'path')
    return `<radialGradient id="${e}" cx="50%" cy="50%" r="50%">${n}</radialGradient>`;
  let i = (((t.gradientAngle || 0) - 90) * Math.PI) / 180,
    a = Math.round(50 + 50 * Math.cos(i + Math.PI)),
    s = Math.round(50 + 50 * Math.sin(i + Math.PI)),
    l = Math.round(50 + 50 * Math.cos(i)),
    u = Math.round(50 + 50 * Math.sin(i));
  return `<linearGradient id="${e}" x1="${a}%" y1="${s}%" x2="${l}%" y2="${u}%">${n}</linearGradient>`;
}
var Pd = nt({
  name: 'shape',
  schemaNodeName: 'shape',
  nodeSpec: {
    inline: true,
    group: 'inline',
    draggable: true,
    atom: true,
    attrs: {
      shapeType: { default: 'rect' },
      shapeId: { default: null },
      width: { default: 100 },
      height: { default: 80 },
      fillColor: { default: null },
      fillType: { default: 'solid' },
      gradientType: { default: null },
      gradientAngle: { default: null },
      gradientStops: { default: null },
      outlineWidth: { default: 1 },
      outlineColor: { default: '#000000' },
      outlineStyle: { default: 'solid' },
      transform: { default: null },
      displayMode: { default: 'inline' },
      cssFloat: { default: null },
      wrapType: { default: 'inline' },
      shadowColor: { default: null },
      shadowBlur: { default: null },
      shadowOffsetX: { default: null },
      shadowOffsetY: { default: null },
      glowColor: { default: null },
      glowRadius: { default: null },
    },
    parseDOM: [
      {
        tag: 'span.docx-shape',
        getAttrs(e) {
          let t = e;
          return {
            shapeType: t.dataset.shapeType || 'rect',
            shapeId: t.dataset.shapeId || void 0,
            width: t.dataset.width ? Number(t.dataset.width) : void 0,
            height: t.dataset.height ? Number(t.dataset.height) : void 0,
            fillColor: t.dataset.fillColor || void 0,
            fillType: t.dataset.fillType || 'solid',
            gradientType: t.dataset.gradientType || void 0,
            gradientAngle: t.dataset.gradientAngle ? Number(t.dataset.gradientAngle) : void 0,
            gradientStops: t.dataset.gradientStops || void 0,
            outlineWidth: t.dataset.outlineWidth ? Number(t.dataset.outlineWidth) : void 0,
            outlineColor: t.dataset.outlineColor || void 0,
            outlineStyle: t.dataset.outlineStyle || void 0,
            transform: t.dataset.transform || void 0,
            displayMode: t.dataset.displayMode || void 0,
            cssFloat: t.dataset.cssFloat || void 0,
            wrapType: t.dataset.wrapType || void 0,
            shadowColor: t.dataset.shadowColor || void 0,
            shadowBlur: t.dataset.shadowBlur ? Number(t.dataset.shadowBlur) : void 0,
            shadowOffsetX: t.dataset.shadowOffsetX ? Number(t.dataset.shadowOffsetX) : void 0,
            shadowOffsetY: t.dataset.shadowOffsetY ? Number(t.dataset.shadowOffsetY) : void 0,
            glowColor: t.dataset.glowColor || void 0,
            glowRadius: t.dataset.glowRadius ? Number(t.dataset.glowRadius) : void 0,
          };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = t.width || 100,
        o = t.height || 80,
        r = { class: 'docx-shape', 'data-shape-type': t.shapeType || 'rect' };
      (t.shapeId && (r['data-shape-id'] = t.shapeId),
        (r['data-width'] = String(n)),
        (r['data-height'] = String(o)),
        t.fillColor && (r['data-fill-color'] = t.fillColor),
        t.fillType && (r['data-fill-type'] = t.fillType),
        t.gradientType && (r['data-gradient-type'] = t.gradientType),
        t.gradientAngle != null && (r['data-gradient-angle'] = String(t.gradientAngle)),
        t.gradientStops && (r['data-gradient-stops'] = t.gradientStops),
        t.outlineWidth && (r['data-outline-width'] = String(t.outlineWidth)),
        t.outlineColor && (r['data-outline-color'] = t.outlineColor),
        t.outlineStyle && (r['data-outline-style'] = t.outlineStyle),
        t.transform && (r['data-transform'] = t.transform),
        t.displayMode && (r['data-display-mode'] = t.displayMode),
        t.cssFloat && (r['data-css-float'] = t.cssFloat),
        t.wrapType && (r['data-wrap-type'] = t.wrapType),
        t.shadowColor && (r['data-shadow-color'] = t.shadowColor),
        t.shadowBlur != null && (r['data-shadow-blur'] = String(t.shadowBlur)),
        t.shadowOffsetX != null && (r['data-shadow-offset-x'] = String(t.shadowOffsetX)),
        t.shadowOffsetY != null && (r['data-shadow-offset-y'] = String(t.shadowOffsetY)),
        t.glowColor && (r['data-glow-color'] = t.glowColor),
        t.glowRadius != null && (r['data-glow-radius'] = String(t.glowRadius)));
      let i = [
        'display: inline-block',
        `width: ${n}px`,
        `height: ${o}px`,
        'vertical-align: middle',
        'line-height: 0',
      ];
      if (
        (t.transform && i.push(`transform: ${t.transform}`),
        t.displayMode === 'float' && t.cssFloat && t.cssFloat !== 'none'
          ? (i.push(`float: ${t.cssFloat}`), i.push('margin: 4px 8px'))
          : t.displayMode === 'block' && (i.push('display: block'), i.push('margin: 4px auto')),
        t.shadowColor)
      ) {
        let m = t.shadowOffsetX || 2,
          b = t.shadowOffsetY || 2,
          g = t.shadowBlur || 4;
        i.push(`filter: drop-shadow(${m}px ${b}px ${g}px ${t.shadowColor})`);
      }
      if (t.glowColor && t.glowRadius) {
        let m = i.find((g) => g.startsWith('filter:')),
          b = `drop-shadow(0 0 ${t.glowRadius}px ${t.glowColor})`;
        if (m) {
          let g = i.indexOf(m);
          i[g] = m + ' ' + b;
        } else i.push(`filter: ${b}`);
      }
      r.style = i.join('; ');
      let a = '',
        s;
      if (t.fillType === 'gradient' && t.gradientStops) {
        let m = `grad-${t.shapeId || Math.random().toString(36).slice(2, 8)}`;
        ((s = `url(#${m})`), (a = Xm(m, t)));
      } else s = t.fillType === 'none' ? 'none' : t.fillColor || '#ffffff';
      let l = t.outlineWidth || 1,
        u = t.outlineColor || '#000000',
        d =
          t.outlineStyle === 'dashed'
            ? ' stroke-dasharray="8 4"'
            : t.outlineStyle === 'dotted'
              ? ' stroke-dasharray="2 2"'
              : '',
        c = qm(t.shapeType || 'rect', n, o),
        p =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${o}" viewBox="0 0 ${n} ${o}" style="fill:${s};stroke:${u};stroke-width:${l}${d}">` +
          (a ? `<defs>${a}</defs>` : '') +
          c +
          '</svg>',
        f = document.createElement('span');
      return (
        Object.entries(r).forEach(([m, b]) => {
          f.setAttribute(m, b);
        }),
        (f.innerHTML = p),
        { dom: f }
      );
    },
  },
});
var Md = nt({
  name: 'horizontalRule',
  schemaNodeName: 'horizontalRule',
  nodeSpec: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM() {
      return ['hr'];
    },
  },
});
var Id = nt({
  name: 'pageBreak',
  schemaNodeName: 'pageBreak',
  nodeSpec: {
    group: 'block',
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'div.docx-page-break' }],
    toDOM() {
      return ['div', { class: 'docx-page-break' }];
    },
  },
});
var Fd = nt({
  name: 'field',
  schemaNodeName: 'field',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: {
      fieldType: { default: 'UNKNOWN' },
      instruction: { default: '' },
      displayText: { default: '' },
      fieldKind: { default: 'simple' },
      fldLock: { default: false },
      dirty: { default: false },
    },
    parseDOM: [
      {
        tag: 'span.docx-field',
        getAttrs(e) {
          let t = e;
          return {
            fieldType: t.dataset.fieldType || 'UNKNOWN',
            instruction: t.dataset.instruction || '',
            displayText: t.textContent || '',
            fieldKind: t.dataset.fieldKind || 'simple',
            fldLock: t.dataset.fldLock === 'true',
            dirty: t.dataset.dirty === 'true',
          };
        },
      },
    ],
    toDOM(e) {
      let {
          fieldType: t,
          instruction: n,
          displayText: o,
          fieldKind: r,
          fldLock: i,
          dirty: a,
        } = e.attrs,
        s = o || '';
      if (!s)
        switch (t) {
          case 'PAGE':
            s = '{page}';
            break;
          case 'NUMPAGES':
            s = '{pages}';
            break;
          case 'DATE':
          case 'TIME':
          case 'CREATEDATE':
          case 'SAVEDATE':
            s = new Date().toLocaleDateString();
            break;
          case 'MERGEFIELD':
            s = `\xAB${n.replace(/^MERGEFIELD\s+/i, '').replace(/\s*\\.*$/, '')}\xBB`;
            break;
          default:
            s = `{${t}}`;
        }
      return [
        'span',
        {
          class: `docx-field docx-field-${t.toLowerCase()}`,
          'data-field-type': t,
          'data-instruction': n,
          'data-field-kind': r,
          ...(i ? { 'data-fld-lock': 'true' } : {}),
          ...(a ? { 'data-dirty': 'true' } : {}),
          style: 'outline: 1px solid rgba(200,200,200,0.4); padding: 0 1px; border-radius: 2px;',
        },
        s,
      ];
    },
  },
});
var Ld = nt({
  name: 'sdt',
  schemaNodeName: 'sdt',
  nodeSpec: {
    inline: true,
    group: 'inline',
    content: 'inline*',
    attrs: {
      sdtType: { default: 'richText' },
      alias: { default: null },
      tag: { default: null },
      lock: { default: null },
      placeholder: { default: null },
      showingPlaceholder: { default: false },
      dateFormat: { default: null },
      listItems: { default: null },
      checked: { default: null },
    },
    parseDOM: [
      {
        tag: 'span.docx-sdt',
        getAttrs(e) {
          let t = e;
          return {
            sdtType: t.dataset.sdtType || 'richText',
            alias: t.dataset.alias || null,
            tag: t.dataset.tag || null,
            lock: t.dataset.lock || null,
            placeholder: t.dataset.placeholder || null,
            showingPlaceholder: t.dataset.showingPlaceholder === 'true',
            dateFormat: t.dataset.dateFormat || null,
            listItems: t.dataset.listItems || null,
            checked:
              t.dataset.checked === 'true' ? true : t.dataset.checked === 'false' ? false : null,
          };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = { class: `docx-sdt docx-sdt-${t.sdtType}`, 'data-sdt-type': String(t.sdtType) };
      return (
        t.alias && (n['data-alias'] = String(t.alias)),
        t.tag && (n['data-tag'] = String(t.tag)),
        t.lock && (n['data-lock'] = String(t.lock)),
        t.placeholder && (n['data-placeholder'] = String(t.placeholder)),
        t.showingPlaceholder && (n['data-showing-placeholder'] = 'true'),
        t.dateFormat && (n['data-date-format'] = String(t.dateFormat)),
        t.listItems && (n['data-list-items'] = String(t.listItems)),
        t.checked != null && (n['data-checked'] = String(t.checked)),
        t.sdtType === 'checkbox'
          ? (n.style =
              'border: 1px solid #ccc; border-radius: 3px; padding: 0 2px; display: inline;')
          : (n.style = 'border-bottom: 1px dashed #999; padding: 0 1px; display: inline;'),
        ['span', n, 0]
      );
    },
  },
});
var Bd = nt({
  name: 'math',
  schemaNodeName: 'math',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { display: { default: 'inline' }, ommlXml: { default: '' }, plainText: { default: '' } },
    parseDOM: [
      {
        tag: 'span.docx-math',
        getAttrs(e) {
          let t = e;
          return {
            display: t.dataset.display || 'inline',
            ommlXml: t.dataset.ommlXml || '',
            plainText: t.textContent || '',
          };
        },
      },
    ],
    toDOM(e) {
      let { display: t, ommlXml: n, plainText: o } = e.attrs,
        r = o || '[equation]';
      return [
        'span',
        {
          class: `docx-math docx-math-${t}`,
          'data-display': t,
          'data-omml-xml': n,
          style:
            'font-style: italic; font-family: "Cambria Math", "Latin Modern Math", serif; background: rgba(200,200,255,0.1); padding: 0 2px; border-radius: 2px;',
        },
        r,
      ];
    },
  },
});
function ig(e) {
  switch (e.toLowerCase()) {
    case 'solid':
      return 'single';
    case 'double':
      return 'double';
    case 'dotted':
      return 'dotted';
    case 'dashed':
      return 'dashed';
    case 'groove':
      return 'threeDEngrave';
    case 'ridge':
      return 'threeDEmboss';
    case 'inset':
      return 'inset';
    case 'outset':
      return 'outset';
    default:
      return 'single';
  }
}
function ag(e) {
  if (!e) return 8;
  let t = e.trim().toLowerCase();
  if (t === 'thin') return 4;
  if (t === 'medium') return 8;
  if (t === 'thick') return 16;
  let n = parseFloat(t);
  return isNaN(n)
    ? 8
    : t.endsWith('pt')
      ? Math.round(n * 8)
      : (t.endsWith('px'), Math.round(n * 6));
}
function Dd(e) {
  if (!e || e === 'transparent' || e === 'inherit') return null;
  let t = e.match(/#([0-9a-fA-F]{6})/);
  if (t) return { rgb: t[1].toUpperCase() };
  let n = e.match(/#([0-9a-fA-F]{3})$/);
  if (n) {
    let [r, i, a] = n[1];
    return { rgb: (r + r + i + i + a + a).toUpperCase() };
  }
  let o = e.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  return o
    ? {
        rgb: [o[1], o[2], o[3]]
          .map((i) => parseInt(i).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase(),
      }
    : null;
}
function sg(e) {
  let t = (a, s, l) => {
      if (!(!a || a === 'none' || a === 'hidden'))
        return { style: ig(a), color: Dd(s) || void 0, size: ag(l) };
    },
    n = t(e.borderTopStyle, e.borderTopColor, e.borderTopWidth),
    o = t(e.borderBottomStyle, e.borderBottomColor, e.borderBottomWidth),
    r = t(e.borderLeftStyle, e.borderLeftColor, e.borderLeftWidth),
    i = t(e.borderRightStyle, e.borderRightColor, e.borderRightWidth);
  return !n && !o && !r && !i ? null : { top: n, bottom: o, left: r, right: i };
}
function lg(e) {
  let t = (a) => {
      if (!a || a === '0px') return;
      let s = parseFloat(a);
      if (!(isNaN(s) || s === 0)) return a.endsWith('pt') ? Math.round(s * 20) : Math.round(s * 15);
    },
    n = t(e.paddingTop),
    o = t(e.paddingRight),
    r = t(e.paddingBottom),
    i = t(e.paddingLeft);
  return n === void 0 && o === void 0 && r === void 0 && i === void 0
    ? null
    : { top: n, right: o, bottom: r, left: i };
}
function cg(e) {
  if (e)
    switch (e.toLowerCase()) {
      case 'top':
        return 'top';
      case 'middle':
        return 'center';
      case 'bottom':
        return 'bottom';
      default:
        return;
    }
}
function dg(e) {
  return Dd(e)?.rgb;
}
function Ad(e) {
  let t = e.style,
    n = sg(t),
    o = lg(t);
  return {
    colspan: e.colSpan || 1,
    rowspan: e.rowSpan || 1,
    verticalAlign: e.dataset.valign || cg(t.verticalAlign) || void 0,
    backgroundColor: e.dataset.bgcolor || dg(t.backgroundColor) || void 0,
    borders: n || void 0,
    margins: o || void 0,
  };
}
var ug = {
    content: 'tableRow+',
    group: 'block',
    tableRole: 'table',
    isolating: true,
    attrs: {
      styleId: { default: null },
      width: { default: null },
      widthType: { default: null },
      justification: { default: null },
      columnWidths: { default: null },
      floating: { default: null },
      cellMargins: { default: null },
      look: { default: null },
      _originalFormatting: { default: null },
    },
    parseDOM: [
      {
        tag: 'table',
        getAttrs(e) {
          let t = e;
          return { styleId: t.dataset.styleId || void 0, justification: t.dataset.justification };
        },
      },
    ],
    toDOM(e) {
      let t = e.attrs,
        n = { class: 'docx-table' };
      t.styleId && (n['data-style-id'] = t.styleId);
      let o = ['border-collapse: collapse'];
      if (t.width && t.widthType === 'pct')
        (o.push(`width: ${t.width / 50}%`), o.push('table-layout: fixed'));
      else if (t.width && t.widthType === 'dxa') {
        let r = Math.round((t.width / 20) * 1.333);
        (o.push(`width: ${r}px`), o.push('table-layout: fixed'));
      } else (o.push('width: 100%'), o.push('table-layout: fixed'));
      return (
        t.justification === 'center'
          ? o.push('margin-left: auto', 'margin-right: auto')
          : t.justification === 'right' && o.push('margin-left: auto'),
        (n.style = o.join('; ')),
        ['table', n, ['tbody', 0]]
      );
    },
  },
  pg = {
    content: '(tableCell | tableHeader)+',
    tableRole: 'row',
    attrs: {
      height: { default: null },
      heightRule: { default: null },
      isHeader: { default: false },
      _originalFormatting: { default: null },
    },
    parseDOM: [{ tag: 'tr' }],
    toDOM(e) {
      let t = e.attrs,
        n = {};
      if (t.height) {
        let o = Math.round((t.height / 20) * 1.333);
        n.style = `height: ${o}px`;
      }
      return ['tr', n, 0];
    },
  },
  fg = {
    single: 'solid',
    double: 'double',
    dotted: 'dotted',
    dashed: 'dashed',
    thick: 'solid',
    dashSmallGap: 'dashed',
    dotDash: 'dashed',
    dotDotDash: 'dotted',
    triple: 'double',
    thinThickSmallGap: 'double',
    thickThinSmallGap: 'double',
    thinThickThinSmallGap: 'double',
    thinThickMediumGap: 'double',
    thickThinMediumGap: 'double',
    thinThickThinMediumGap: 'double',
    thinThickLargeGap: 'double',
    thickThinLargeGap: 'double',
    thinThickThinLargeGap: 'double',
    wave: 'solid',
    doubleWave: 'double',
    dashDotStroked: 'dashed',
    threeDEmboss: 'ridge',
    threeDEngrave: 'groove',
    outset: 'outset',
    inset: 'inset',
  };
function Hd(e) {
  let t = [],
    n = e.borders;
  if (!n) return t;
  let o = (r) => {
    if (!r || !r.style || r.style === 'none' || r.style === 'nil') return 'none';
    let i = r.size ? Math.max(1, Math.round((r.size / 8) * 1.333)) : 1,
      a = fg[r.style] || 'solid',
      s = r.color?.rgb ? `#${r.color.rgb}` : '#000000';
    return `${i}px ${a} ${s}`;
  };
  return (
    t.push(`border-top: ${o(n.top)}`),
    t.push(`border-bottom: ${o(n.bottom)}`),
    t.push(`border-left: ${o(n.left)}`),
    t.push(`border-right: ${o(n.right)}`),
    t
  );
}
function Nd(e) {
  let t = e.margins;
  if (!t) {
    let s = Math.round(7.1982);
    return [`padding: ${s}px ${s}px`];
  }
  let n = (s) => (s ? Math.round((s / 20) * 1.333) : 0),
    o = n(t.top),
    r = n(t.right),
    i = n(t.bottom),
    a = n(t.left);
  return [`padding: ${o}px ${r}px ${i}px ${a}px`];
}
function Od(e) {
  if (!e) return [];
  let t = [];
  switch (e) {
    case 'tbRl':
    case 'tbRlV':
      t.push('writing-mode: vertical-rl');
      break;
    case 'btLr':
      t.push('writing-mode: vertical-lr', 'transform: rotate(180deg)');
      break;
    case 'rl':
    case 'rlV':
      t.push('direction: rtl');
      break;
    case 'tb':
    case 'tbV':
      t.push('writing-mode: vertical-lr');
      break;
  }
  return t;
}
function zd(e) {
  let t = [];
  if (e.colwidth && e.colwidth.length > 0) {
    let n = e.colwidth.reduce((o, r) => o + r, 0);
    t.push(`width: ${n}px`);
  } else if (e.width && e.widthType === 'pct') t.push(`width: ${e.width}%`);
  else if (e.width) {
    let n = Math.round((e.width / 20) * 1.333);
    t.push(`width: ${n}px`);
  }
  return t;
}
var mg = {
    content: '(paragraph | table)+',
    tableRole: 'cell',
    isolating: true,
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      width: { default: null },
      widthType: { default: null },
      verticalAlign: { default: null },
      backgroundColor: { default: null },
      borders: { default: null },
      margins: { default: null },
      textDirection: { default: null },
      noWrap: { default: false },
      _originalFormatting: { default: null },
    },
    parseDOM: [{ tag: 'td', getAttrs: (e) => Ad(e) }],
    toDOM(e) {
      let t = e.attrs,
        n = { class: 'docx-table-cell' };
      (t.colspan > 1 && (n.colspan = String(t.colspan)),
        t.rowspan > 1 && (n.rowspan = String(t.rowspan)));
      let o = [];
      return (
        o.push(...Nd(t)),
        t.noWrap
          ? o.push('white-space: nowrap')
          : o.push('word-wrap: break-word', 'overflow-wrap: break-word', 'overflow: hidden'),
        o.push(...zd(t)),
        o.push(...Hd(t)),
        o.push(...Od(t.textDirection)),
        t.verticalAlign &&
          ((n['data-valign'] = t.verticalAlign), o.push(`vertical-align: ${t.verticalAlign}`)),
        t.backgroundColor &&
          ((n['data-bgcolor'] = t.backgroundColor),
          o.push(`background-color: #${t.backgroundColor}`)),
        (n.style = o.join('; ')),
        ['td', n, 0]
      );
    },
  },
  gg = {
    content: '(paragraph | table)+',
    tableRole: 'header_cell',
    isolating: true,
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      width: { default: null },
      widthType: { default: null },
      verticalAlign: { default: null },
      backgroundColor: { default: null },
      borders: { default: null },
      margins: { default: null },
      textDirection: { default: null },
      noWrap: { default: false },
      _originalFormatting: { default: null },
    },
    parseDOM: [{ tag: 'th', getAttrs: (e) => Ad(e) }],
    toDOM(e) {
      let t = e.attrs,
        n = { class: 'docx-table-header' };
      (t.colspan > 1 && (n.colspan = String(t.colspan)),
        t.rowspan > 1 && (n.rowspan = String(t.rowspan)));
      let o = ['font-weight: bold'];
      return (
        o.push(...Nd(t)),
        t.noWrap
          ? o.push('white-space: nowrap')
          : o.push('word-wrap: break-word', 'overflow-wrap: break-word', 'overflow: hidden'),
        o.push(...zd(t)),
        o.push(...Hd(t)),
        o.push(...Od(t.textDirection)),
        t.verticalAlign &&
          ((n['data-valign'] = t.verticalAlign), o.push(`vertical-align: ${t.verticalAlign}`)),
        t.backgroundColor &&
          ((n['data-bgcolor'] = t.backgroundColor),
          o.push(`background-color: #${t.backgroundColor}`)),
        (n.style = o.join('; ')),
        ['th', n, 0]
      );
    },
  };
function Ze(e) {
  let { selection: t } = e,
    { $from: n } = t,
    o = t instanceof prosemirrorTables.CellSelection,
    r,
    i,
    a,
    s,
    l;
  for (let m = n.depth; m > 0; m--) {
    let b = n.node(m);
    if (b.type.name === 'tableCell' || b.type.name === 'tableHeader') {
      l = b;
      let g = n.node(m - 1);
      if (g && g.type.name === 'tableRow') {
        let x = 0,
          T = false;
        g.forEach((S, B, v) => {
          T || (v === n.index(m - 1) ? ((s = x), (T = true)) : (x += S.attrs.colspan || 1));
        });
      }
    } else if (b.type.name === 'tableRow') {
      let g = n.node(m - 1);
      g && g.type.name === 'table' && (a = n.index(m - 1));
    } else if (b.type.name === 'table') {
      ((r = b), (i = n.before(m)));
      break;
    }
  }
  if (!r) return { isInTable: false };
  let u = 0,
    d = 0;
  r.forEach((m) => {
    if (m.type.name === 'tableRow') {
      u++;
      let b = 0;
      (m.forEach((g) => {
        b += g.attrs.colspan || 1;
      }),
        (d = Math.max(d, b)));
    }
  });
  let c = l && ((l.attrs.colspan || 1) > 1 || (l.attrs.rowspan || 1) > 1),
    p,
    f;
  if (l) {
    let m = l.attrs;
    m.backgroundColor && typeof m.backgroundColor == 'string' && (f = m.backgroundColor);
    let b = m.borders;
    if (b)
      for (let g of ['top', 'right', 'bottom', 'left']) {
        let x = b[g];
        if (x?.color && x.style && x.style !== 'none' && x.style !== 'nil') {
          p = x.color;
          break;
        }
      }
  }
  return {
    isInTable: true,
    table: r,
    tablePos: i,
    rowIndex: a,
    columnIndex: s,
    rowCount: u,
    columnCount: d,
    hasMultiCellSelection: o,
    canSplitCell: !!c,
    cellBorderColor: p,
    cellBackgroundColor: f,
  };
}
function _n(e) {
  let { $from: t } = e.selection;
  for (let n = t.depth; n > 0; n--) {
    let o = t.node(n);
    if (o.type.name === 'tableCell' || o.type.name === 'tableHeader') return true;
  }
  return false;
}
function $d(e) {
  let { $from: t } = e.selection,
    n = -1,
    o = -1,
    r = -1;
  for (let i = t.depth; i > 0; i--) {
    let a = t.node(i);
    if (a.type.name === 'tableCell' || a.type.name === 'tableHeader') n = i;
    else if (a.type.name === 'tableRow') o = i;
    else if (a.type.name === 'table') {
      r = i;
      break;
    }
  }
  return n === -1 || o === -1 || r === -1
    ? null
    : { cellDepth: n, cellPos: t.before(n), rowDepth: o, tableDepth: r };
}
function Wd() {
  return (e, t) => {
    if (!_n(e)) return false;
    let n = $d(e);
    if (!n) return false;
    let { $from: o } = e.selection,
      r = o.node(n.tableDepth),
      i = o.node(n.rowDepth),
      a = o.index(n.rowDepth),
      s = o.index(n.tableDepth);
    if (a < i.childCount - 1) {
      let l = n.cellPos + o.node(n.cellDepth).nodeSize;
      if (t) {
        let u = l + 1 + 1,
          d = e.tr.setSelection(prosemirrorState.Selection.near(e.doc.resolve(u)));
        t(d.scrollIntoView());
      }
      return true;
    }
    if (s < r.childCount - 1) {
      let u = o.before(n.rowDepth) + i.nodeSize;
      if (t) {
        let d = u + 1 + 1 + 1,
          c = e.tr.setSelection(prosemirrorState.Selection.near(e.doc.resolve(d)));
        t(c.scrollIntoView());
      }
      return true;
    }
    return false;
  };
}
function _d() {
  return (e, t) => {
    if (!_n(e)) return false;
    let n = $d(e);
    if (!n) return false;
    let { $from: o } = e.selection,
      r = o.node(n.tableDepth),
      i = o.index(n.rowDepth),
      a = o.index(n.tableDepth);
    if (i > 0) {
      let l = o.node(n.rowDepth).child(i - 1),
        u = n.cellPos - l.nodeSize;
      if (t) {
        let d = u + l.nodeSize - 2,
          c = e.tr.setSelection(prosemirrorState.Selection.near(e.doc.resolve(d), -1));
        t(c.scrollIntoView());
      }
      return true;
    }
    if (a > 0) {
      let s = r.child(a - 1),
        u = o.before(n.rowDepth) - s.nodeSize;
      if (t) {
        let c = u + s.nodeSize - 1 - 1,
          p = e.tr.setSelection(prosemirrorState.Selection.near(e.doc.resolve(c), -1));
        t(p.scrollIntoView());
      }
      return true;
    }
    return false;
  };
}
var hg = nt({ name: 'table', schemaNodeName: 'table', nodeSpec: ug }),
  bg = nt({ name: 'tableRow', schemaNodeName: 'tableRow', nodeSpec: pg }),
  yg = nt({ name: 'tableCell', schemaNodeName: 'tableCell', nodeSpec: mg }),
  xg = nt({ name: 'tableHeader', schemaNodeName: 'tableHeader', nodeSpec: gg }),
  Sg = gt({
    name: 'tablePlugin',
    onSchemaReady(e) {
      let { schema: t } = e;
      function n(...P) {
        return (F, k, L) => {
          for (let I of P) if (I(F, k, L)) return true;
          return false;
        };
      }
      function o(P, F = {}) {
        let k = P?.attrs ?? {};
        return {
          colspan: k.colspan || 1,
          rowspan: 1,
          colwidth: k.colwidth,
          width: k.width,
          widthType: k.widthType,
          verticalAlign: k.verticalAlign,
          backgroundColor: k.backgroundColor,
          borders: k.borders,
          margins: k.margins,
          textDirection: k.textDirection,
          noWrap: k.noWrap,
          ...F,
        };
      }
      function r(P, F, k = '000000', L = 9360) {
        let I = [],
          E = Math.floor(L / F),
          Z = 360,
          le = 'atLeast',
          _ = { style: 'single', size: 4, color: { rgb: k } },
          J = { top: _, bottom: _, left: _, right: _ };
        for (let fe = 0; fe < P; fe++) {
          let Ce = [];
          for (let R = 0; R < F; R++) {
            let K = t.nodes.paragraph.create(),
              H = { colspan: 1, rowspan: 1, borders: J, width: E, widthType: 'dxa' };
            Ce.push(t.nodes.tableCell.create(H, K));
          }
          I.push(t.nodes.tableRow.create({ height: Z, heightRule: le }, Ce));
        }
        let oe = Array(F).fill(E);
        return t.nodes.table.create({ columnWidths: oe, width: L, widthType: 'dxa' }, I);
      }
      function i(P, F) {
        return (k, L) => {
          let { $from: I } = k.selection,
            E = '000000',
            Z = k.storedMarks || I.marks();
          for (let _ of Z)
            if (_.type.name === 'textColor' && _.attrs.rgb) {
              E = _.attrs.rgb;
              break;
            }
          let le = I.pos;
          for (let _ = I.depth; _ > 0; _--) {
            let J = I.node(_);
            if (J.type.name === 'paragraph' || J.type.name === 'table') {
              le = I.after(_);
              break;
            }
          }
          if (L) {
            let _ = 9360;
            for (let ye = I.depth; ye > 0; ye--) {
              let De = I.node(ye);
              if (De.type.name === 'tableCell' || De.type.name === 'tableHeader') {
                let xe = De.attrs.width;
                xe && xe > 0 && (_ = Math.max(xe - 216, 360));
                break;
              }
            }
            let J = r(P, F, E, _),
              oe = t.nodes.paragraph.create(),
              Ce = k.doc.resolve(le).nodeBefore?.type.name === 'table',
              R = Ce ? [oe, J, oe] : [J, oe],
              K = k.tr.insert(le, R),
              H = le + 1;
            Ce && (H += oe.nodeSize);
            let he = H + 1 + 1;
            (K.setSelection(prosemirrorState.TextSelection.create(K.doc, he)),
              L(K.scrollIntoView()));
          }
          return true;
        };
      }
      function a(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.rowIndex === void 0 || !k.table || k.tablePos === void 0)
          return false;
        if (F) {
          let L = P.tr,
            I = k.table.child(k.rowIndex),
            E = [];
          I.forEach((_) => {
            let J = t.nodes.paragraph.create(),
              oe = o(_);
            E.push(t.nodes.tableCell.create(oe, J));
          });
          let Z = t.nodes.tableRow.create(
              { height: I.attrs.height ?? 360, heightRule: I.attrs.heightRule ?? 'atLeast' },
              E
            ),
            le = k.tablePos + 1;
          for (let _ = 0; _ < k.rowIndex; _++) le += k.table.child(_).nodeSize;
          (L.insert(le, Z), F(L.scrollIntoView()));
        }
        return true;
      }
      function s(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.rowIndex === void 0 || !k.table || k.tablePos === void 0)
          return false;
        if (F) {
          let L = P.tr,
            I = k.table.child(k.rowIndex),
            E = [];
          I.forEach((_) => {
            let J = t.nodes.paragraph.create(),
              oe = o(_);
            E.push(t.nodes.tableCell.create(oe, J));
          });
          let Z = t.nodes.tableRow.create(
              { height: I.attrs.height ?? 360, heightRule: I.attrs.heightRule ?? 'atLeast' },
              E
            ),
            le = k.tablePos + 1;
          for (let _ = 0; _ <= k.rowIndex; _++) le += k.table.child(_).nodeSize;
          (L.insert(le, Z), F(L.scrollIntoView()));
        }
        return true;
      }
      function l(P, F) {
        let k = Ze(P);
        if (
          !k.isInTable ||
          k.rowIndex === void 0 ||
          !k.table ||
          k.tablePos === void 0 ||
          (k.rowCount || 0) <= 1
        )
          return false;
        if (F) {
          let L = P.tr,
            I = k.tablePos + 1;
          for (let Z = 0; Z < k.rowIndex; Z++) I += k.table.child(Z).nodeSize;
          let E = I + k.table.child(k.rowIndex).nodeSize;
          (L.delete(I, E), F(L.scrollIntoView()));
        }
        return true;
      }
      function u(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.columnIndex === void 0 || !k.table || k.tablePos === void 0)
          return false;
        if (F) {
          let L = P.tr,
            I = (k.columnCount || 1) + 1,
            E = Math.floor(100 / I),
            Z = k.tablePos + 1;
          k.table.forEach((J) => {
            if (J.type.name === 'tableRow') {
              let oe = Z + 1,
                fe = 0;
              if (
                (J.forEach((Ce) => {
                  if (fe === k.columnIndex) {
                    let R = t.nodes.paragraph.create(),
                      K = o(Ce, { colspan: 1, rowspan: 1 });
                    ((K.width = E), (K.widthType = 'pct'));
                    let H = t.nodes.tableCell.create(K, R);
                    L = L.insert(oe, H);
                  }
                  ((oe += Ce.nodeSize), (fe += Ce.attrs.colspan || 1));
                }),
                fe <= k.columnIndex)
              ) {
                let Ce = t.nodes.paragraph.create(),
                  R = o(J.child(J.childCount - 1) ?? null, { colspan: 1, rowspan: 1 });
                ((R.width = E), (R.widthType = 'pct'));
                let K = t.nodes.tableCell.create(R, Ce);
                L = L.insert(oe, K);
              }
            }
            Z += J.nodeSize;
          });
          let _ = L.doc.nodeAt(k.tablePos);
          if (_ && _.type.name === 'table') {
            let J = _.child(0);
            if (J && J.type.name === 'tableRow') {
              let R = k.tablePos + 2;
              J.forEach((K) => {
                ((K.type.name === 'tableCell' || K.type.name === 'tableHeader') &&
                  (L = L.setNodeMarkup(R, void 0, { ...K.attrs, width: E, widthType: 'pct' })),
                  (R += K.nodeSize));
              });
            }
            let oe = J?.childCount ?? I,
              fe = _.attrs.width || 9360,
              Ce = Math.floor(fe / Math.max(1, oe));
            L = L.setNodeMarkup(k.tablePos, void 0, {
              ..._.attrs,
              columnWidths: Array(oe).fill(Ce),
            });
          }
          F(L.scrollIntoView());
        }
        return true;
      }
      function d(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.columnIndex === void 0 || !k.table || k.tablePos === void 0)
          return false;
        if (F) {
          let L = P.tr,
            I = (k.columnCount || 1) + 1,
            E = Math.floor(100 / I),
            Z = k.tablePos + 1;
          k.table.forEach((J) => {
            if (J.type.name === 'tableRow') {
              let oe = Z + 1,
                fe = 0,
                Ce = false;
              if (
                (J.forEach((R) => {
                  if (
                    ((oe += R.nodeSize), (fe += R.attrs.colspan || 1), !Ce && fe > k.columnIndex)
                  ) {
                    let K = t.nodes.paragraph.create(),
                      H = o(R, { colspan: 1, rowspan: 1 });
                    ((H.width = E), (H.widthType = 'pct'));
                    let ge = t.nodes.tableCell.create(H, K);
                    ((L = L.insert(oe, ge)), (Ce = true));
                  }
                }),
                !Ce)
              ) {
                let R = t.nodes.paragraph.create(),
                  K = o(J.child(J.childCount - 1) ?? null, { colspan: 1, rowspan: 1 });
                ((K.width = E), (K.widthType = 'pct'));
                let H = t.nodes.tableCell.create(K, R);
                L = L.insert(oe, H);
              }
            }
            Z += J.nodeSize;
          });
          let _ = L.doc.nodeAt(k.tablePos);
          if (_ && _.type.name === 'table') {
            let J = _.child(0);
            if (J && J.type.name === 'tableRow') {
              let R = k.tablePos + 2;
              J.forEach((K) => {
                ((K.type.name === 'tableCell' || K.type.name === 'tableHeader') &&
                  (L = L.setNodeMarkup(R, void 0, { ...K.attrs, width: E, widthType: 'pct' })),
                  (R += K.nodeSize));
              });
            }
            let oe = J?.childCount ?? I,
              fe = _.attrs.width || 9360,
              Ce = Math.floor(fe / Math.max(1, oe));
            L = L.setNodeMarkup(k.tablePos, void 0, {
              ..._.attrs,
              columnWidths: Array(oe).fill(Ce),
            });
          }
          F(L.scrollIntoView());
        }
        return true;
      }
      function c(P, F) {
        let k = Ze(P);
        if (
          !k.isInTable ||
          k.columnIndex === void 0 ||
          !k.table ||
          k.tablePos === void 0 ||
          (k.columnCount || 0) <= 1
        )
          return false;
        if (F) {
          let L = P.tr,
            I = (k.columnCount || 2) - 1,
            E = Math.floor(100 / I),
            Z = [],
            le = k.tablePos + 1;
          (k.table.forEach((J) => {
            if (J.type.name === 'tableRow') {
              let oe = le + 1,
                fe = 0;
              J.forEach((Ce) => {
                let R = oe,
                  K = oe + Ce.nodeSize,
                  H = Ce.attrs.colspan || 1;
                (fe <= k.columnIndex && k.columnIndex < fe + H && Z.push({ start: R, end: K }),
                  (oe = K),
                  (fe += H));
              });
            }
            le += J.nodeSize;
          }),
            Z.reverse().forEach(({ start: J, end: oe }) => {
              L = L.delete(J, oe);
            }));
          let _ = L.doc.nodeAt(k.tablePos);
          if (_ && _.type.name === 'table') {
            let J = _.child(0);
            if (J && J.type.name === 'tableRow') {
              let R = k.tablePos + 2;
              J.forEach((K) => {
                ((K.type.name === 'tableCell' || K.type.name === 'tableHeader') &&
                  (L = L.setNodeMarkup(R, void 0, { ...K.attrs, width: E, widthType: 'pct' })),
                  (R += K.nodeSize));
              });
            }
            let oe = J?.childCount ?? I,
              fe = _.attrs.width || 9360,
              Ce = Math.floor(fe / Math.max(1, oe));
            L = L.setNodeMarkup(k.tablePos, void 0, {
              ..._.attrs,
              columnWidths: Array(oe).fill(Ce),
            });
          }
          F(L.scrollIntoView());
        }
        return true;
      }
      function p(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.tablePos === void 0 || !k.table) return false;
        if (F) {
          let L = P.tr;
          (L.delete(k.tablePos, k.tablePos + k.table.nodeSize), F(L.scrollIntoView()));
        }
        return true;
      }
      function f(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.tablePos === void 0 || !k.table) return false;
        if (F) {
          let L = k.tablePos + 1,
            I = P.doc.resolve(L),
            E = P.doc.resolve(k.tablePos + k.table.nodeSize - 2),
            Z = prosemirrorTables.CellSelection.create(P.doc, I.pos, E.pos);
          F(P.tr.setSelection(Z));
        }
        return true;
      }
      function m(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.tablePos === void 0 || !k.table || k.rowIndex === void 0)
          return false;
        if (F) {
          let I = k.tablePos + 1;
          for (let J = 0; J < k.rowIndex; J++) {
            let oe = k.table.child(J);
            I += oe.nodeSize;
          }
          let E = k.table.child(k.rowIndex),
            Z = I + 1,
            le = I + E.nodeSize - 2,
            _ = prosemirrorTables.CellSelection.create(P.doc, Z, le);
          F(P.tr.setSelection(_));
        }
        return true;
      }
      function b(P, F) {
        let k = Ze(P);
        if (!k.isInTable || k.tablePos === void 0 || !k.table || k.columnIndex === void 0)
          return false;
        if (F) {
          let L = k.tablePos + 1,
            I = k.table.child(0),
            E = k.table.child(k.table.childCount - 1),
            Z = L + 1;
          for (let oe = 0; oe < k.columnIndex && oe < I.childCount; oe++) Z += I.child(oe).nodeSize;
          let le = L;
          for (let oe = 0; oe < k.table.childCount - 1; oe++) le += k.table.child(oe).nodeSize;
          let _ = le + 1;
          for (let oe = 0; oe < k.columnIndex && oe < E.childCount; oe++) _ += E.child(oe).nodeSize;
          let J = prosemirrorTables.CellSelection.create(P.doc, Z, _);
          F(P.tr.setSelection(J));
        }
        return true;
      }
      function g(P) {
        let F = P.selection,
          k = [];
        if (F instanceof prosemirrorTables.CellSelection)
          return (
            F.forEachCell((I, E) => {
              k.push({ pos: E, node: I });
            }),
            k
          );
        let { $from: L } = F;
        for (let I = L.depth; I > 0; I--) {
          let E = L.node(I);
          if (E.type.name === 'tableCell' || E.type.name === 'tableHeader') {
            k.push({ pos: L.before(I), node: E });
            break;
          }
        }
        return k;
      }
      function x(P, F) {
        let k = new Map(),
          L = new Map(),
          I = P.childCount,
          E = 0;
        return (
          P.forEach((Z, le, _) => {
            if (Z.type.name !== 'tableRow') return;
            let J = 0;
            (Z.forEach((oe, fe) => {
              let Ce = F + le + fe + 2,
                R = oe.attrs.colspan || 1;
              (k.set(Ce, { rowIdx: _, colIdx: J, colspan: R, pos: Ce, node: oe }),
                L.set(`${_},${J}`, Ce),
                (J += R));
            }),
              (E = Math.max(E, J)));
          }),
          { cellByPos: k, cellByRC: L, totalRows: I, totalCols: E }
        );
      }
      function T(P, F) {
        return (k, L) => {
          let I = Ze(k);
          if (!I.isInTable || I.tablePos === void 0 || !I.table) return false;
          if (L) {
            let E = k.tr,
              Z = I.table,
              le = I.tablePos,
              _ = F ?? { style: 'single', size: 4, color: { rgb: '000000' } },
              J = { style: 'none' },
              { cellByPos: oe, cellByRC: fe } = x(Z, le),
              Ce = g(k),
              R = 1 / 0,
              K = -1,
              H = 1 / 0,
              ge = -1;
            for (let { pos: xe } of Ce) {
              let pe = oe.get(xe);
              pe &&
                ((R = Math.min(R, pe.rowIdx)),
                (K = Math.max(K, pe.rowIdx)),
                (H = Math.min(H, pe.colIdx)),
                (ge = Math.max(ge, pe.colIdx + pe.colspan - 1)));
            }
            let he = new Map(),
              ye = (xe, pe) => he.get(xe) ?? { ...pe.attrs },
              De = (xe, pe) => {
                he.set(xe, pe);
              };
            for (let { pos: xe } of Ce) {
              let pe = oe.get(xe);
              if (!pe) continue;
              let Ae = pe.rowIdx === R,
                Ge = pe.rowIdx === K,
                Ve = pe.colIdx === H,
                rt = pe.colIdx + pe.colspan - 1 === ge,
                Ke;
              switch (P) {
                case 'all':
                  Ke = { top: _, bottom: _, left: _, right: _ };
                  break;
                case 'outside':
                  Ke = { top: Ae ? _ : J, bottom: Ge ? _ : J, left: Ve ? _ : J, right: rt ? _ : J };
                  break;
                case 'inside':
                  Ke = { top: Ae ? J : _, bottom: Ge ? J : _, left: Ve ? J : _, right: rt ? J : _ };
                  break;
                case 'none':
                  Ke = { top: J, bottom: J, left: J, right: J };
                  break;
              }
              let Xe = ye(xe, pe.node),
                Pt = Xe.borders || {};
              if ((De(xe, { ...Xe, borders: { ...Pt, ...Ke } }), Ke.top)) {
                let ze = fe.get(`${pe.rowIdx - 1},${pe.colIdx}`);
                if (ze !== void 0) {
                  let Ft = oe.get(ze),
                    je = ye(ze, Ft.node),
                    bt = je.borders || {};
                  De(ze, { ...je, borders: { ...bt, bottom: Ke.top } });
                }
              }
              if (Ke.bottom) {
                let ze = fe.get(`${pe.rowIdx + 1},${pe.colIdx}`);
                if (ze !== void 0) {
                  let Ft = oe.get(ze),
                    je = ye(ze, Ft.node),
                    bt = je.borders || {};
                  De(ze, { ...je, borders: { ...bt, top: Ke.bottom } });
                }
              }
              if (Ke.left) {
                let ze = fe.get(`${pe.rowIdx},${pe.colIdx - 1}`);
                if (ze !== void 0) {
                  let Ft = oe.get(ze),
                    je = ye(ze, Ft.node),
                    bt = je.borders || {};
                  De(ze, { ...je, borders: { ...bt, right: Ke.left } });
                }
              }
              if (Ke.right) {
                let ze = fe.get(`${pe.rowIdx},${pe.colIdx + pe.colspan}`);
                if (ze !== void 0) {
                  let Ft = oe.get(ze),
                    je = ye(ze, Ft.node),
                    bt = je.borders || {};
                  De(ze, { ...je, borders: { ...bt, left: Ke.right } });
                }
              }
            }
            for (let [xe, pe] of he) E.setNodeMarkup(E.mapping.map(xe), void 0, pe);
            L(E.scrollIntoView());
          }
          return true;
        };
      }
      function S(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = g(F),
              Z = P ? P.replace(/^#/, '') : null;
            for (let { pos: le, node: _ } of E)
              I.setNodeMarkup(I.mapping.map(le), void 0, { ..._.attrs, backgroundColor: Z });
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function B(P, F, k) {
        return (L, I) => {
          let E = Ze(L);
          if (!E.isInTable || E.tablePos === void 0 || !E.table) return false;
          if (I) {
            let Z = L.tr,
              le = g(L),
              _ = F || { style: 'none' },
              J = { style: 'none' },
              oe = ['top', 'bottom', 'left', 'right'],
              { cellByPos: fe, cellByRC: Ce } = x(E.table, E.tablePos),
              R = new Map(),
              K = (he, ye) => R.get(he) ?? { ...ye.attrs },
              H = (he, ye) => R.set(he, ye),
              ge = {
                top: { adjSide: 'bottom', dRow: -1, dCol: 0 },
                bottom: { adjSide: 'top', dRow: 1, dCol: 0 },
                left: { adjSide: 'right', dRow: 0, dCol: -1 },
                right: { adjSide: 'left', dRow: 0, dCol: 1 },
              };
            for (let { pos: he, node: ye } of le) {
              let De = fe.get(he),
                xe = K(he, ye),
                pe = xe.borders || {},
                Ae = P === 'all' ? oe : [P],
                Ge = k ? { top: J, bottom: J, left: J, right: J } : { ...pe };
              for (let Ve of Ae) Ge[Ve] = _;
              if (De) {
                let Ve = k ? oe : Ae;
                for (let rt of Ve) {
                  let Ke = Ge[rt],
                    Xe = ge[rt],
                    Pt = rt === 'right' ? De.colIdx + De.colspan : De.colIdx + Xe.dCol,
                    ze = Ce.get(`${De.rowIdx + Xe.dRow},${Pt}`);
                  if (ze !== void 0) {
                    let Ft = fe.get(ze),
                      je = K(ze, Ft.node),
                      bt = je.borders || {};
                    H(ze, { ...je, borders: { ...bt, [Xe.adjSide]: Ke } });
                  }
                }
              }
              H(he, { ...xe, borders: Ge });
            }
            for (let [he, ye] of R) Z.setNodeMarkup(Z.mapping.map(he), void 0, ye);
            I(Z.scrollIntoView());
          }
          return true;
        };
      }
      function v(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = g(F);
            for (let { pos: Z, node: le } of E)
              I.setNodeMarkup(I.mapping.map(Z), void 0, { ...le.attrs, verticalAlign: P });
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function M(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = g(F);
            for (let { pos: Z, node: le } of E) {
              let J = { ...(le.attrs.margins || {}), ...P };
              I.setNodeMarkup(I.mapping.map(Z), void 0, { ...le.attrs, margins: J });
            }
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function U(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = g(F);
            for (let { pos: Z, node: le } of E)
              I.setNodeMarkup(I.mapping.map(Z), void 0, { ...le.attrs, textDirection: P });
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function ee() {
        return (P, F) => {
          let k = Ze(P);
          if (!k.isInTable || k.tablePos === void 0 || !k.table) return false;
          if (F) {
            let L = P.tr,
              I = g(P);
            for (let { pos: E, node: Z } of I)
              L.setNodeMarkup(L.mapping.map(E), void 0, { ...Z.attrs, noWrap: !Z.attrs.noWrap });
            F(L.scrollIntoView());
          }
          return true;
        };
      }
      function O(P, F) {
        return (k, L) => {
          let I = Ze(k);
          if (!I.isInTable || I.tablePos === void 0 || !I.table) return false;
          if (L) {
            let E = k.tr,
              { $from: Z } = k.selection;
            for (let le = Z.depth; le > 0; le--) {
              let _ = Z.node(le);
              if (_.type.name === 'tableRow') {
                let J = Z.before(le),
                  oe = { ..._.attrs, height: P, heightRule: P ? F || 'atLeast' : null };
                return (E.setNodeMarkup(J, void 0, oe), L(E.scrollIntoView()), true);
              }
            }
          }
          return true;
        };
      }
      function N() {
        return (P, F) => {
          let k = Ze(P);
          if (!k.isInTable || k.tablePos === void 0 || !k.table || !k.columnCount) return false;
          if (F) {
            let L = P.tr,
              I = k.table,
              E = k.columnCount,
              Z = I.attrs.columnWidths,
              le = Z ? Z.reduce((fe, Ce) => fe + Ce, 0) : 9360,
              _ = Math.floor(le / E),
              J = k.tablePos + 1;
            I.forEach((fe) => {
              if (fe.type.name === 'tableRow') {
                let Ce = J + 1;
                fe.forEach((R) => {
                  ((R.type.name === 'tableCell' || R.type.name === 'tableHeader') &&
                    (L = L.setNodeMarkup(Ce, void 0, {
                      ...R.attrs,
                      width: _,
                      widthType: 'dxa',
                      colwidth: null,
                    })),
                    (Ce += R.nodeSize));
                });
              }
              J += fe.nodeSize;
            });
            let oe = Array(E).fill(_);
            ((L = L.setNodeMarkup(k.tablePos, void 0, { ...I.attrs, columnWidths: oe })),
              F(L.scrollIntoView()));
          }
          return true;
        };
      }
      function ne() {
        return (P, F) => {
          let k = Ze(P);
          if (!k.isInTable || k.tablePos === void 0 || !k.table) return false;
          if (F) {
            let L = P.tr,
              I = k.table,
              E = k.tablePos + 1;
            (I.forEach((Z) => {
              if (Z.type.name === 'tableRow') {
                let le = E + 1;
                Z.forEach((_) => {
                  ((_.type.name === 'tableCell' || _.type.name === 'tableHeader') &&
                    (L = L.setNodeMarkup(le, void 0, {
                      ..._.attrs,
                      width: null,
                      widthType: null,
                      colwidth: null,
                    })),
                    (le += _.nodeSize));
                });
              }
              E += Z.nodeSize;
            }),
              (L = L.setNodeMarkup(k.tablePos, void 0, {
                ...I.attrs,
                columnWidths: null,
                width: null,
                widthType: 'auto',
              })),
              F(L.scrollIntoView()));
          }
          return true;
        };
      }
      function ce(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = L.table,
              Z = L.tablePos,
              le = E.childCount,
              _ = P.look ?? { firstRow: true, lastRow: false, noHBand: false },
              J = P.conditionals ?? {},
              oe = P.tableBorders;
            I = I.setNodeMarkup(Z, void 0, { ...E.attrs, styleId: P.styleId });
            let fe = 0,
              Ce = Z + 1;
            for (let R = 0; R < le; R++) {
              let K = E.child(R),
                H = R === 0 && !!_.firstRow,
                ge = R === le - 1 && !!_.lastRow,
                he = _.noHBand !== true,
                ye = K.childCount,
                De;
              H
                ? (De = 'firstRow')
                : ge
                  ? (De = 'lastRow')
                  : (he && (De = fe % 2 === 0 ? 'band1Horz' : 'band2Horz'), fe++);
              let xe = Ce + 1;
              for (let pe = 0; pe < ye; pe++) {
                let Ae = K.child(pe),
                  Ge = I.mapping.map(xe),
                  Ve = De,
                  rt = pe === 0 && !!_.firstCol,
                  Ke = pe === ye - 1 && !!_.lastCol;
                H && rt && J.nwCell
                  ? (Ve = 'nwCell')
                  : H && Ke && J.neCell
                    ? (Ve = 'neCell')
                    : ge && rt && J.swCell
                      ? (Ve = 'swCell')
                      : ge && Ke && J.seCell
                        ? (Ve = 'seCell')
                        : rt
                          ? (Ve = 'firstCol')
                          : Ke && (Ve = 'lastCol');
                let Xe = Ve ? J[Ve] : void 0,
                  Pt = { ...Ae.attrs };
                Xe?.backgroundColor
                  ? (Pt.backgroundColor = Xe.backgroundColor)
                  : (Pt.backgroundColor = null);
                let ze = {},
                  Ft = ['top', 'bottom', 'left', 'right'];
                for (let je of Ft)
                  Xe?.borders && Xe.borders[je] !== void 0
                    ? (ze[je] = Xe.borders[je])
                    : oe &&
                      ((je === 'top' && R > 0) || (je === 'bottom' && R < le - 1)
                        ? (ze[je] = oe.insideH ?? oe[je])
                        : (je === 'left' && pe > 0) || (je === 'right' && pe < ye - 1)
                          ? (ze[je] = oe.insideV ?? oe[je])
                          : (ze[je] = oe[je]));
                (Object.keys(ze).length > 0 ? (Pt.borders = ze) : (Pt.borders = null),
                  (I = I.setNodeMarkup(Ge, void 0, Pt)),
                  (xe += Ae.nodeSize));
              }
              Ce += K.nodeSize;
            }
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function D(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = { ...L.table.attrs };
            ('width' in P && (E.width = P.width),
              'widthType' in P && (E.widthType = P.widthType),
              'justification' in P && (E.justification = P.justification),
              I.setNodeMarkup(L.tablePos, void 0, E),
              k(I.scrollIntoView()));
          }
          return true;
        };
      }
      function z() {
        return (P, F) => {
          let k = Ze(P);
          if (!k.isInTable || k.tablePos === void 0 || !k.table) return false;
          if (F) {
            let L = P.tr,
              { $from: I } = P.selection;
            for (let E = I.depth; E > 0; E--) {
              let Z = I.node(E);
              if (Z.type.name === 'tableRow') {
                let le = I.before(E),
                  _ = { ...Z.attrs, isHeader: !Z.attrs.isHeader };
                return (L.setNodeMarkup(le, void 0, _), F(L.scrollIntoView()), true);
              }
            }
          }
          return true;
        };
      }
      function ae(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = g(F),
              Z = P.replace(/^#/, ''),
              le = { style: 'single', size: 4 },
              { cellByPos: _, cellByRC: J } = x(L.table, L.tablePos),
              oe = new Map(),
              fe = (K, H) => oe.get(K) ?? { ...H.attrs },
              Ce = (K, H) => oe.set(K, H),
              R = {
                top: { adjSide: 'bottom', dRow: -1, dCol: 0 },
                bottom: { adjSide: 'top', dRow: 1, dCol: 0 },
                left: { adjSide: 'right', dRow: 0, dCol: -1 },
                right: { adjSide: 'left', dRow: 0, dCol: 1 },
              };
            for (let { pos: K, node: H } of E) {
              let ge = _.get(K),
                he = fe(K, H),
                ye = he.borders || {},
                De = {};
              for (let xe of ['top', 'bottom', 'left', 'right']) {
                let pe = { ...le, ...ye[xe], color: { rgb: Z } };
                if (((De[xe] = pe), ge)) {
                  let Ae = R[xe],
                    Ge = xe === 'right' ? ge.colIdx + ge.colspan : ge.colIdx + Ae.dCol,
                    Ve = J.get(`${ge.rowIdx + Ae.dRow},${Ge}`);
                  if (Ve !== void 0) {
                    let rt = _.get(Ve),
                      Ke = fe(Ve, rt.node),
                      Xe = Ke.borders || {};
                    Ce(Ve, { ...Ke, borders: { ...Xe, [Ae.adjSide]: pe } });
                  }
                }
              }
              Ce(K, { ...he, borders: { ...ye, ...De } });
            }
            for (let [K, H] of oe) I.setNodeMarkup(I.mapping.map(K), void 0, H);
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function se(P) {
        return (F, k) => {
          let L = Ze(F);
          if (!L.isInTable || L.tablePos === void 0 || !L.table) return false;
          if (k) {
            let I = F.tr,
              E = g(F),
              Z = { style: 'single', color: { rgb: '000000' } },
              { cellByPos: le, cellByRC: _ } = x(L.table, L.tablePos),
              J = new Map(),
              oe = (R, K) => J.get(R) ?? { ...K.attrs },
              fe = (R, K) => J.set(R, K),
              Ce = {
                top: { adjSide: 'bottom', dRow: -1, dCol: 0 },
                bottom: { adjSide: 'top', dRow: 1, dCol: 0 },
                left: { adjSide: 'right', dRow: 0, dCol: -1 },
                right: { adjSide: 'left', dRow: 0, dCol: 1 },
              };
            for (let { pos: R, node: K } of E) {
              let H = le.get(R),
                ge = oe(R, K),
                he = ge.borders || {},
                ye = {};
              for (let De of ['top', 'bottom', 'left', 'right']) {
                let xe = { ...Z, ...he[De], size: P };
                if (((ye[De] = xe), H)) {
                  let pe = Ce[De],
                    Ae = De === 'right' ? H.colIdx + H.colspan : H.colIdx + pe.dCol,
                    Ge = _.get(`${H.rowIdx + pe.dRow},${Ae}`);
                  if (Ge !== void 0) {
                    let Ve = le.get(Ge),
                      rt = oe(Ge, Ve.node),
                      Ke = rt.borders || {};
                    fe(Ge, { ...rt, borders: { ...Ke, [pe.adjSide]: xe } });
                  }
                }
              }
              fe(R, { ...ge, borders: { ...he, ...ye } });
            }
            for (let [R, K] of J) I.setNodeMarkup(I.mapping.map(R), void 0, K);
            k(I.scrollIntoView());
          }
          return true;
        };
      }
      function A() {
        return (P, F) => {
          let k = P.selection;
          if (!('$anchorCell' in k && typeof k.forEachCell == 'function')) return false;
          let I = Ze(P);
          if (!I.isInTable || I.tablePos === void 0 || !I.table) return false;
          let E = 0;
          I.table.descendants((_) => {
            (_.type.name === 'tableCell' || _.type.name === 'tableHeader') && (E += 1);
          });
          let Z = 0;
          if (
            (k.forEachCell(() => {
              Z += 1;
            }),
            !(E > 0 && Z >= E))
          )
            return false;
          if (F) {
            let _ = P.tr.delete(I.tablePos, I.tablePos + I.table.nodeSize);
            F(_.scrollIntoView());
          }
          return true;
        };
      }
      function Ie() {
        return (P) => {
          let { $from: F, empty: k } = P.selection;
          if (!k) return false;
          let L = F.parent;
          if (L.type.name !== 'paragraph' || L.textContent.length > 0) return false;
          let I = F.depth;
          if (I < 1) return false;
          let E = F.node(I - 1),
            Z = F.index(I - 1),
            le = Z > 0 ? E.child(Z - 1) : null,
            _ = Z + 1 < E.childCount ? E.child(Z + 1) : null,
            J = le?.type.name === 'table',
            oe = _?.type.name === 'table';
          return !!(J || oe);
        };
      }
      let Fe = new prosemirrorState.PluginKey('activeCell'),
        Ue = new prosemirrorState.Plugin({
          key: Fe,
          props: {
            decorations(P) {
              let { selection: F } = P;
              if (F instanceof prosemirrorTables.CellSelection)
                return prosemirrorView.DecorationSet.empty;
              let { $from: k } = F;
              for (let L = k.depth; L > 0; L--) {
                let I = k.node(L);
                if (I.type.name === 'tableCell' || I.type.name === 'tableHeader') {
                  let E = k.before(L);
                  return prosemirrorView.DecorationSet.create(P.doc, [
                    prosemirrorView.Decoration.node(E, E + I.nodeSize, { class: 'activeCell' }),
                  ]);
                }
              }
              return prosemirrorView.DecorationSet.empty;
            },
          },
        });
      return {
        plugins: [
          prosemirrorTables.columnResizing({
            handleWidth: 5,
            cellMinWidth: 25,
            lastColumnResizable: true,
          }),
          prosemirrorTables.tableEditing(),
          Ue,
        ],
        keyboardShortcuts: { Backspace: n(A(), Ie()), Delete: n(A(), Ie()) },
        commands: {
          insertTable: (P, F) => i(P, F),
          addRowAbove: () => a,
          addRowBelow: () => s,
          deleteRow: () => l,
          addColumnLeft: () => u,
          addColumnRight: () => d,
          deleteColumn: () => c,
          deleteTable: () => p,
          selectTable: () => f,
          selectRow: () => m,
          selectColumn: () => b,
          mergeCells: () => prosemirrorTables.mergeCells,
          splitCell: () => prosemirrorTables.splitCell,
          setCellBorder: (P, F, k) => B(P, F, k),
          setTableBorders: (P, F) => T(P, F),
          setCellVerticalAlign: (P) => v(P),
          setCellMargins: (P) => M(P),
          setCellTextDirection: (P) => U(P),
          toggleNoWrap: () => ee(),
          setRowHeight: (P, F) => O(P, F),
          toggleHeaderRow: () => z(),
          distributeColumns: () => N(),
          autoFitContents: () => ne(),
          setTableProperties: (P) => D(P),
          applyTableStyle: (P) => ce(P),
          setCellFillColor: (P) => S(P),
          setTableBorderColor: (P) => ae(P),
          setTableBorderWidth: (P) => se(P),
          removeTableBorders: () => T('none'),
          setAllTableBorders: (P) => T('all', P),
          setOutsideTableBorders: (P) => T('outside', P),
          setInsideTableBorders: (P) => T('inside', P),
        },
      };
    },
  });
function Vd() {
  return [hg(), bg(), yg(), xg(), Sg()];
}
function Ds(...e) {
  return (t, n, o) => {
    for (let r of e) if (r(t, n, o)) return true;
    return false;
  };
}
function Ud(e) {
  return (t, n) => {
    let { $from: o, $to: r } = t.selection,
      i = o.parent;
    if (i.type.name !== 'paragraph') return false;
    let s = i.attrs.numPr?.numId === e;
    if (!n) return true;
    let l = t.tr,
      u = new Set();
    return (
      t.doc.nodesBetween(o.pos, r.pos, (d, c) => {
        if (d.type.name === 'paragraph' && !u.has(c))
          if ((u.add(c), s))
            l = l.setNodeMarkup(c, void 0, {
              ...d.attrs,
              numPr: null,
              listIsBullet: null,
              listNumFmt: null,
              listMarker: null,
            });
          else {
            let p = e === 1;
            l = l.setNodeMarkup(c, void 0, {
              ...d.attrs,
              numPr: { numId: e, ilvl: d.attrs.numPr?.ilvl || 0 },
              listIsBullet: p,
              listNumFmt: p ? null : 'decimal',
              listMarker: null,
            });
          }
      }),
      n(l.scrollIntoView()),
      true
    );
  };
}
var kg = (e, t) => Ud(1)(e, t),
  Tg = (e, t) => Ud(2)(e, t),
  wg = (e, t) => {
    let { $from: n } = e.selection,
      o = n.parent;
    if (o.type.name !== 'paragraph' || !o.attrs.numPr) return false;
    let r = o.attrs.numPr.ilvl || 0;
    if (r >= 8) return false;
    if (!t) return true;
    let i = n.before(n.depth);
    return (
      t(
        e.tr
          .setNodeMarkup(i, void 0, {
            ...o.attrs,
            numPr: { ...o.attrs.numPr, ilvl: r + 1 },
            indentLeft: null,
            indentFirstLine: null,
            hangingIndent: null,
          })
          .scrollIntoView()
      ),
      true
    );
  },
  Cg = (e, t) => {
    let { $from: n } = e.selection,
      o = n.parent;
    if (o.type.name !== 'paragraph' || !o.attrs.numPr) return false;
    let r = o.attrs.numPr.ilvl || 0;
    if (!t) return true;
    let i = n.before(n.depth);
    return (
      r <= 0
        ? t(
            e.tr
              .setNodeMarkup(i, void 0, {
                ...o.attrs,
                numPr: null,
                listIsBullet: null,
                listNumFmt: null,
                listMarker: null,
                indentLeft: null,
                indentFirstLine: null,
                hangingIndent: null,
              })
              .scrollIntoView()
          )
        : t(
            e.tr
              .setNodeMarkup(i, void 0, {
                ...o.attrs,
                numPr: { ...o.attrs.numPr, ilvl: r - 1 },
                indentLeft: null,
                indentFirstLine: null,
                hangingIndent: null,
              })
              .scrollIntoView()
          ),
      true
    );
  },
  vg = (e, t) => {
    let { $from: n, $to: o } = e.selection;
    if (!t) return true;
    let r = e.tr,
      i = new Set();
    return (
      e.doc.nodesBetween(n.pos, o.pos, (a, s) => {
        a.type.name === 'paragraph' &&
          a.attrs.numPr &&
          !i.has(s) &&
          (i.add(s),
          (r = r.setNodeMarkup(s, void 0, {
            ...a.attrs,
            numPr: null,
            listIsBullet: null,
            listNumFmt: null,
            listMarker: null,
          })));
      }),
      t(r.scrollIntoView()),
      true
    );
  };
function Rg() {
  return (e, t) => {
    let { $from: n, empty: o } = e.selection;
    if (!o) return false;
    let r = n.parent;
    if (r.type.name !== 'paragraph' || !r.attrs.numPr || r.textContent.length > 0) return false;
    if (t) {
      let a = e.tr.setNodeMarkup(n.before(), void 0, {
        ...r.attrs,
        numPr: null,
        listIsBullet: null,
        listNumFmt: null,
        listMarker: null,
      });
      t(a);
    }
    return true;
  };
}
function Eg() {
  return (e, t) => {
    let { $from: n, empty: o } = e.selection;
    if (!o) return false;
    let r = n.parent;
    if (r.type.name !== 'paragraph' || !r.attrs.numPr) return false;
    if (t) {
      let { tr: a } = e,
        s = n.pos;
      (a.split(s, 1, [{ type: e.schema.nodes.paragraph, attrs: { ...r.attrs } }]),
        t(a.scrollIntoView()));
    }
    return true;
  };
}
function Pg() {
  return (e, t) => {
    let { $from: n, empty: o } = e.selection;
    if (!o || n.parentOffset !== 0) return false;
    let r = n.parent;
    if (r.type.name !== 'paragraph' || !r.attrs.numPr) return false;
    if (t) {
      let a = e.tr.setNodeMarkup(n.before(), void 0, {
        ...r.attrs,
        numPr: null,
        listIsBullet: null,
        listNumFmt: null,
        listMarker: null,
      });
      t(a);
    }
    return true;
  };
}
function Mg() {
  return (e, t) => {
    let { $from: n, $to: o } = e.selection,
      r = [];
    if (
      (e.doc.nodesBetween(n.pos, o.pos, (i, a) => {
        i.type.name === 'paragraph' &&
          i.attrs.numPr &&
          (i.attrs.numPr.ilvl ?? 0) < 8 &&
          r.push({ pos: a, attrs: i.attrs });
      }),
      r.length === 0)
    )
      return false;
    if (t) {
      let i = e.tr;
      for (let { pos: a, attrs: s } of r) {
        let l = s.numPr;
        i = i.setNodeMarkup(a, void 0, {
          ...s,
          numPr: { ...l, ilvl: (l.ilvl ?? 0) + 1 },
          indentLeft: null,
          indentFirstLine: null,
          hangingIndent: null,
        });
      }
      t(i);
    }
    return true;
  };
}
function Ig() {
  return (e, t) => {
    let { $from: n, $to: o } = e.selection,
      r = [];
    if (
      (e.doc.nodesBetween(n.pos, o.pos, (i, a) => {
        i.type.name === 'paragraph' && i.attrs.numPr && r.push({ pos: a, attrs: i.attrs });
      }),
      r.length === 0)
    )
      return false;
    if (t) {
      let i = e.tr;
      for (let { pos: a, attrs: s } of r) {
        let l = s.numPr,
          u = l.ilvl ?? 0;
        u <= 0
          ? (i = i.setNodeMarkup(a, void 0, {
              ...s,
              numPr: null,
              listIsBullet: null,
              listNumFmt: null,
              listMarker: null,
              indentLeft: null,
              indentFirstLine: null,
              hangingIndent: null,
            }))
          : (i = i.setNodeMarkup(a, void 0, {
              ...s,
              numPr: { ...l, ilvl: u - 1 },
              indentLeft: null,
              indentFirstLine: null,
              hangingIndent: null,
            }));
      }
      t(i);
    }
    return true;
  };
}
function Fg() {
  return (e, t) => {
    let { schema: n } = e,
      o = n.nodes.tab;
    if (!o) return false;
    if (t) {
      let r = e.tr.replaceSelectionWith(o.create());
      t(r.scrollIntoView());
    }
    return true;
  };
}
var jd = gt({
  name: 'list',
  priority: Qt.High,
  onSchemaReady() {
    return {
      commands: {
        toggleBulletList: () => kg,
        toggleNumberedList: () => Tg,
        increaseListLevel: () => wg,
        decreaseListLevel: () => Cg,
        removeList: () => vg,
      },
      keyboardShortcuts: {
        Tab: Ds(Wd(), Mg(), Fg()),
        'Shift-Tab': Ds(_d(), Ig()),
        'Shift-Enter': () => false,
        Enter: Ds(Rg(), Eg()),
        Backspace: Pg(),
      },
    };
  },
});
function Kd(...e) {
  return (t, n, o) => {
    for (let r of e) if (r(t, n, o)) return true;
    return false;
  };
}
var Og = (e, t) => {
    let { $cursor: n } = e.selection;
    if (!n || n.parentOffset !== 0 || n.parent.type.name !== 'paragraph') return false;
    let o = n.parent.attrs,
      r = o.indentFirstLine != null && o.indentFirstLine > 0,
      i = !!o.hangingIndent,
      a = o.indentLeft != null && o.indentLeft > 0;
    if (!r && !i && !a) return false;
    if (t) {
      let s = n.before(),
        l = e.tr.setNodeMarkup(s, void 0, {
          ...o,
          indentFirstLine: null,
          hangingIndent: null,
          indentLeft: null,
        });
      t(l.scrollIntoView());
    }
    return true;
  },
  zg = [
    'defaultTextFormatting',
    'styleId',
    'lineSpacing',
    'lineSpacingRule',
    'spaceAfter',
    'spaceBefore',
    'contextualSpacing',
  ],
  Yd = new Set(['fontFamily', 'fontSize', 'textColor']),
  $g = (e, t, n) => {
    let { $from: o } = e.selection,
      r = o.parent.type.name === 'paragraph' ? o.parent : null,
      a = (e.storedMarks || o.marks()).filter((u) => Yd.has(u.type.name)),
      s = null;
    if (
      !prosemirrorCommands.splitBlock(
        e,
        t
          ? (u) => {
              s = u;
            }
          : void 0,
        n
      )
    )
      return false;
    if (t && s !== null) {
      let u = s,
        { $from: d } = u.selection,
        c = d.parent;
      if (c.type.name === 'paragraph') {
        let p = { ...c.attrs },
          f = false;
        if (r)
          for (let m of zg) {
            let b = r.attrs[m];
            b != null && p[m] == null && ((p[m] = b), (f = true));
          }
        if (
          (p.borders && ((p.borders = null), (f = true)),
          f && u.setNodeMarkup(d.before(), void 0, p),
          c.textContent.length === 0)
        ) {
          let m = a;
          if (m.length === 0 && r) {
            let b = r.attrs.defaultTextFormatting;
            b && (m = Fs(b, e.schema).filter((x) => Yd.has(x.type.name)));
          }
          if (m.length > 0) {
            let b = { ...(p.defaultTextFormatting ?? {}) },
              g = false;
            for (let x of m)
              if (
                (x.type.name === 'fontSize' &&
                  x.attrs.size !== b.fontSize &&
                  ((b.fontSize = x.attrs.size), (g = true)),
                x.type.name === 'fontFamily')
              ) {
                let T = x.attrs.ascii;
                T &&
                  (!b.fontFamily || b.fontFamily.ascii !== T) &&
                  ((b.fontFamily = { ...b.fontFamily, ascii: T, hAnsi: x.attrs.hAnsi }),
                  (g = true));
              }
            (g && u.setNodeMarkup(d.before(), void 0, { ...p, defaultTextFormatting: b }),
              u.setStoredMarks(m));
          }
        }
      }
      t(u.scrollIntoView());
    }
    return true;
  },
  qd = gt({
    name: 'baseKeymap',
    priority: Qt.Low,
    onSchemaReady(e) {
      return {
        keyboardShortcuts: {
          ...prosemirrorCommands.baseKeymap,
          Enter: $g,
          Backspace: Kd(prosemirrorCommands.deleteSelection, Og, prosemirrorCommands.joinBackward),
          Delete: Kd(prosemirrorCommands.deleteSelection, prosemirrorCommands.joinForward),
          'Mod-a': prosemirrorCommands.selectAll,
          Escape: prosemirrorCommands.selectParentNode,
        },
      };
    },
  });
var fi = new prosemirrorState.PluginKey('selectionTracker');
function jo(e) {
  let { selection: t, doc: n } = e,
    { from: o, to: r, empty: i } = t,
    a = n.resolve(o),
    s = 0,
    l = 0;
  n.forEach((B, v, M) => {
    if (v > r) return false;
    (v <= o && (s = M), v <= r && (l = M));
  });
  let u = Vg(e),
    d = a.parent,
    c = {};
  d.type.name === 'paragraph' &&
    (d.attrs.alignment && (c.alignment = d.attrs.alignment),
    d.attrs.lineSpacing &&
      ((c.lineSpacing = d.attrs.lineSpacing), (c.lineSpacingRule = d.attrs.lineSpacingRule)),
    d.attrs.indentLeft && (c.indentLeft = d.attrs.indentLeft),
    d.attrs.indentRight && (c.indentRight = d.attrs.indentRight),
    d.attrs.indentFirstLine && (c.indentFirstLine = d.attrs.indentFirstLine),
    d.attrs.hangingIndent && (c.hangingIndent = d.attrs.hangingIndent),
    d.attrs.tabs && (c.tabs = d.attrs.tabs),
    d.attrs.numPr && (c.numPr = d.attrs.numPr),
    d.attrs.styleId && (c.styleId = d.attrs.styleId));
  let p = d.attrs?.numPr,
    f = !!p?.numId,
    m = p?.numId === 1 ? 'bullet' : p?.numId ? 'numbered' : void 0,
    b = p?.ilvl,
    g = e.storedMarks || (i ? a.marks() : []),
    x = [],
    T = false,
    S = false;
  for (let B of g)
    (B.type.name === 'comment' && B.attrs.commentId && x.push(B.attrs.commentId),
      B.type.name === 'insertion' && (T = true),
      B.type.name === 'deletion' && (S = true));
  return {
    hasSelection: !i,
    isMultiParagraph: s !== l,
    textFormatting: u,
    paragraphFormatting: c,
    startParagraphIndex: s,
    endParagraphIndex: l,
    inList: f,
    listType: m,
    listLevel: b,
    activeCommentIds: x,
    inInsertion: T,
    inDeletion: S,
  };
}
function Vg(e) {
  let { selection: t } = e,
    { empty: n, $from: o } = t,
    r = e.storedMarks || (n ? o.marks() : []),
    i = {};
  for (let a of r)
    switch (a.type.name) {
      case 'bold':
        i.bold = true;
        break;
      case 'italic':
        i.italic = true;
        break;
      case 'underline':
        i.underline = { style: a.attrs.style || 'single', color: a.attrs.color };
        break;
      case 'strike':
        a.attrs.double ? (i.doubleStrike = true) : (i.strike = true);
        break;
      case 'textColor':
        i.color = {
          rgb: a.attrs.rgb,
          themeColor: a.attrs.themeColor,
          themeTint: a.attrs.themeTint,
          themeShade: a.attrs.themeShade,
        };
        break;
      case 'highlight':
        i.highlight = a.attrs.color;
        break;
      case 'fontSize':
        i.fontSize = a.attrs.size;
        break;
      case 'fontFamily':
        i.fontFamily = {
          ascii: a.attrs.ascii,
          hAnsi: a.attrs.hAnsi,
          asciiTheme: a.attrs.asciiTheme,
        };
        break;
      case 'superscript':
        i.vertAlign = 'superscript';
        break;
      case 'subscript':
        i.vertAlign = 'subscript';
        break;
    }
  return i;
}
function mi(e) {
  return new prosemirrorState.Plugin({
    key: fi,
    state: {
      init(t, n) {
        return jo(n);
      },
      apply(t, n, o, r) {
        if (!t.selectionSet && !t.docChanged) return n;
        let i = jo(r);
        return (e && !jg(n, i) && setTimeout(() => e(i), 0), i);
      },
    },
    view() {
      return {
        update(t, n) {
          if (!e || (t.state.selection.eq(n.selection) && t.state.doc.eq(n.doc))) return;
          let o = fi.getState(t.state);
          o && e(o);
        },
      };
    },
  });
}
function Ug(e, t) {
  if (e === t) return true;
  if (!e || !t || e.length !== t.length) return false;
  for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return false;
  return true;
}
function jg(e, t) {
  return (
    e.hasSelection === t.hasSelection &&
    e.isMultiParagraph === t.isMultiParagraph &&
    e.startParagraphIndex === t.startParagraphIndex &&
    e.endParagraphIndex === t.endParagraphIndex &&
    e.inList === t.inList &&
    e.listType === t.listType &&
    e.listLevel === t.listLevel &&
    e.inInsertion === t.inInsertion &&
    e.inDeletion === t.inDeletion &&
    Ug(e.activeCommentIds, t.activeCommentIds) &&
    JSON.stringify(e.textFormatting) === JSON.stringify(t.textFormatting) &&
    JSON.stringify(e.paragraphFormatting) === JSON.stringify(t.paragraphFormatting)
  );
}
var Xd = gt({
  name: 'selectionTracker',
  defaultOptions: {},
  onSchemaReady(e, t) {
    return {
      plugins: [mi(t.onSelectionChange)],
      commands: { extractSelectionContext: () => (n, o) => (jo(n), true) },
    };
  },
});
var Yg = new prosemirrorState.PluginKey('imageDrag'),
  Jd = gt({
    name: 'imageDrag',
    onSchemaReady(e) {
      return {
        plugins: [
          new prosemirrorState.Plugin({
            key: Yg,
            props: {
              handleDOMEvents: {
                dragstart(n, o) {
                  let { selection: r } = n.state;
                  if (r instanceof prosemirrorState.NodeSelection && r.node.type.name === 'image') {
                    n.dom.classList.add('pm-image-dragging');
                    let i = o;
                    if (i.dataTransfer) {
                      i.dataTransfer.effectAllowed = 'move';
                      let a = document.createElement('div');
                      ((a.style.cssText =
                        'position: fixed; left: -9999px; top: -9999px; opacity: 0.6; pointer-events: none; border: 2px dashed var(--doc-primary, #2563eb); border-radius: 4px; background: rgba(37, 99, 235, 0.08);'),
                        (a.style.width = `${r.node.attrs.width || 100}px`),
                        (a.style.height = `${r.node.attrs.height || 100}px`),
                        document.body.appendChild(a),
                        i.dataTransfer.setDragImage(a, 0, 0),
                        requestAnimationFrame(() => {
                          document.body.removeChild(a);
                        }));
                    }
                  }
                  return false;
                },
                dragend(n) {
                  return (
                    n.dom.classList.remove('pm-image-dragging'),
                    n.dom.querySelectorAll('.pm-drop-indicator').forEach((r) => r.remove()),
                    false
                  );
                },
                dragover(n, o) {
                  let { selection: r } = n.state;
                  if (r instanceof prosemirrorState.NodeSelection && r.node.type.name === 'image') {
                    let i = o;
                    (i.preventDefault(), i.dataTransfer && (i.dataTransfer.dropEffect = 'move'));
                  }
                  return false;
                },
                drop(n) {
                  return (
                    n.dom.classList.remove('pm-image-dragging'),
                    n.dom.querySelectorAll('.pm-drop-indicator').forEach((r) => r.remove()),
                    false
                  );
                },
              },
            },
          }),
        ],
      };
    },
  });
var As = 612;
async function Zg(e) {
  return await new Promise((t, n) => {
    let o = new FileReader();
    ((o.onload = () => t(o.result)),
      (o.onerror = () => n(o.error ?? new Error('Failed to read image file'))),
      o.readAsDataURL(e));
  });
}
async function Jg(e) {
  return await new Promise((t, n) => {
    let o = new Image();
    ((o.onload = () => t({ width: o.naturalWidth || 1, height: o.naturalHeight || 1 })),
      (o.onerror = () => n(new Error('Failed to load pasted image'))),
      (o.src = e));
  });
}
async function Qg(e, t) {
  let n = e.state.schema.nodes.image;
  if (!n) return;
  let o = e.state.selection.from;
  for (let r of t) {
    let i;
    try {
      i = await Zg(r);
    } catch {
      continue;
    }
    let a = 1,
      s = 1;
    try {
      ({ width: a, height: s } = await Jg(i));
    } catch {
      ((a = 1), (s = 1));
    }
    let l = a,
      u = s;
    if (l > As) {
      let p = As / l;
      ((l = As), (u = Math.max(1, Math.round(u * p))));
    }
    let d = n.create({
        src: i,
        alt: r.name,
        width: l,
        height: u,
        rId: `rId_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        wrapType: 'inline',
        displayMode: 'inline',
      }),
      c = e.state.tr.insert(o, d);
    ((o += d.nodeSize),
      c.setSelection(prosemirrorState.TextSelection.create(c.doc, o)),
      e.dispatch(c.scrollIntoView()));
  }
  e.focus();
}
var Qd = gt({
  name: 'imagePaste',
  onSchemaReady(e) {
    return {
      plugins: [
        new prosemirrorState.Plugin({
          props: {
            handleDOMEvents: {
              paste(n, o) {
                let r = o,
                  i = chunkEOTZWQND_js.L(r.clipboardData);
                return i.length === 0 || !n.state.schema.nodes.image
                  ? false
                  : (r.preventDefault(), Qg(n, i).catch(() => {}), true);
              },
            },
          },
        }),
      ],
    };
  },
});
var eu = gt({
  name: 'dropCursor',
  onSchemaReady() {
    return {
      plugins: [
        prosemirrorDropcursor.dropCursor({ color: 'var(--doc-primary, #4285f4)', width: 2 }),
      ],
    };
  },
});
var gi = new prosemirrorState.PluginKey('paragraphChangeTracker');
function tu(e) {
  let t = 0;
  return (
    e.descendants((n) => {
      n.type.name === 'paragraph' && t++;
    }),
    t
  );
}
function oh(e, t, n) {
  let o = new Set(),
    r = false;
  return (
    e.nodesBetween(t, n, (i) => {
      if (i.type.name === 'paragraph') {
        let a = i.attrs.paraId;
        a ? o.add(a) : (r = true);
      }
    }),
    { ids: o, hasUntracked: r }
  );
}
function rh() {
  return new prosemirrorState.Plugin({
    key: gi,
    state: {
      init(e, t) {
        return {
          changedParaIds: new Set(),
          structuralChange: false,
          hasUntrackedChanges: false,
          paragraphCount: tu(t.doc),
        };
      },
      apply(e, t) {
        if (e.getMeta(gi) === 'clear')
          return {
            changedParaIds: new Set(),
            structuralChange: false,
            hasUntrackedChanges: false,
            paragraphCount: t.paragraphCount,
          };
        if (!e.docChanged) return t;
        let n = tu(e.doc),
          o = {
            changedParaIds: new Set(t.changedParaIds),
            structuralChange: t.structuralChange,
            hasUntrackedChanges: t.hasUntrackedChanges,
            paragraphCount: n,
          };
        t.paragraphCount !== n && (o.structuralChange = true);
        for (let r of e.steps)
          r.getMap().forEach((a, s, l, u) => {
            let { ids: d, hasUntracked: c } = oh(e.doc, l, u);
            for (let p of d) o.changedParaIds.add(p);
            c && (o.hasUntrackedChanges = true);
          });
        return o;
      },
    },
  });
}
function Hs(e) {
  return gi.getState(e);
}
function nu(e) {
  return Hs(e)?.changedParaIds ?? new Set();
}
function ou(e) {
  return Hs(e)?.structuralChange ?? false;
}
function ru(e) {
  return Hs(e)?.hasUntrackedChanges ?? false;
}
function iu(e) {
  return e.tr.setMeta(gi, 'clear');
}
var au = gt({
  name: 'paragraphChangeTracker',
  defaultOptions: {},
  onSchemaReady() {
    return { plugins: [rh()] };
  },
});
var su = gt({
  name: 'bidiShortcut',
  priority: Qt.High,
  onSchemaReady(e) {
    return {
      plugins: [
        new prosemirrorState.Plugin({
          props: {
            handleKeyDown(t, n) {
              if (n.key !== 'Shift' || !(n.metaKey || n.ctrlKey)) return false;
              let r = Mn.getCommands();
              return n.code === 'ShiftLeft'
                ? (n.preventDefault(), r.setLtr()(t.state, t.dispatch), true)
                : n.code === 'ShiftRight'
                  ? (n.preventDefault(), r.setRtl()(t.state, t.dispatch), true)
                  : false;
            },
          },
        }),
      ],
    };
  },
});
function lu(e) {
  let t = {},
    n = e.split(';');
  for (let o of n) {
    let r = o.trim();
    if (!r) continue;
    let i = r.indexOf(':');
    if (i < 0) continue;
    let a = r.slice(0, i).trim(),
      s = r.slice(i + 1).trim();
    a && s && (t[a] = s);
  }
  return t;
}
function sh(e, t) {
  let n = e.getAttribute('style') || '',
    o = lu(n);
  for (let [r, i] of Object.entries(t)) r in o || e.style.setProperty(r, i);
}
function lh(e) {
  let t = e.querySelectorAll('style');
  if (t.length === 0) return;
  let n = [];
  for (let o of t) {
    let r = o.textContent || '';
    if (r.trim())
      try {
        let i = e.createElement('style');
        ((i.textContent = r), e.head.appendChild(i));
        let a = i.sheet;
        if (a)
          for (let s = 0; s < a.cssRules.length; s++) {
            let l = a.cssRules[s];
            if (l instanceof CSSStyleRule) {
              let u = {},
                d = l.style;
              for (let c = 0; c < d.length; c++) {
                let p = d[c];
                u[p] = d.getPropertyValue(p);
              }
              Object.keys(u).length > 0 && n.push({ selector: l.selectorText, declarations: u });
            }
          }
        e.head.removeChild(i);
      } catch {
        let i = /([^{]+)\{([^}]+)\}/g,
          a;
        for (; (a = i.exec(r)) !== null; ) {
          let s = a[1].trim(),
            l = lu(a[2]);
          Object.keys(l).length > 0 && n.push({ selector: s, declarations: l });
        }
      }
  }
  if (n.length !== 0)
    for (let { selector: o, declarations: r } of n)
      try {
        let i = e.body.querySelectorAll(o);
        for (let a of i) sh(a, r);
      } catch {}
}
function ch(e) {
  let t = e.body.querySelectorAll('b[id^="docs-internal-guid-"]');
  for (let n of t) {
    let o = n.parentNode;
    if (o) {
      for (; n.firstChild; ) o.insertBefore(n.firstChild, n);
      o.removeChild(n);
    }
  }
}
function dh(e) {
  let t = e.includes('<style'),
    n = e.includes('docs-internal-guid-');
  if (!t && !n) return e;
  try {
    let r = new DOMParser().parseFromString(e, 'text/html');
    if (t) {
      lh(r);
      let i = r.querySelectorAll('style');
      for (let a of i) a.remove();
    }
    return (n && ch(r), r.body.innerHTML);
  } catch {
    return e;
  }
}
var cu = gt({
  name: 'pasteStyleInliner',
  priority: Qt.High,
  onSchemaReady() {
    return {
      plugins: [
        new prosemirrorState.Plugin({
          props: {
            transformPastedHTML(t) {
              return dh(t);
            },
          },
        }),
      ],
    };
  },
});
function Go(e = {}) {
  let t = new Set(e.disable || []),
    n = [];
  function o(r, i) {
    t.has(r) || n.push(i);
  }
  return (
    o('doc', Wc()),
    o('text', _c()),
    o('paragraph', Yc()),
    o('history', Xc({ depth: e.historyDepth, newGroupDelay: e.historyNewGroupDelay })),
    o('bold', Jc()),
    o('italic', ed()),
    o('underline', od()),
    o('strike', rd()),
    o('textColor', id()),
    o('highlight', ad()),
    o('fontSize', sd()),
    o('fontFamily', ld()),
    o('superscript', cd()),
    o('subscript', dd()),
    o('hyperlink', ud()),
    o('allCaps', pd()),
    o('smallCaps', fd()),
    o('footnoteRef', md()),
    o('characterSpacing', gd()),
    o('emboss', xd()),
    o('imprint', Sd()),
    o('textShadow', kd()),
    o('emphasisMark', Td()),
    o('textOutline', wd()),
    o('comment', hd()),
    o('insertion', bd()),
    o('deletion', yd()),
    o('hardBreak', Cd()),
    o('tab', vd()),
    o('image', Rd()),
    o('textBox', Ed()),
    o('shape', Pd()),
    o('imageDrag', Jd()),
    o('imagePaste', Qd()),
    o('dropCursor', eu()),
    o('horizontalRule', Md()),
    o('pageBreak', Id()),
    o('field', Fd()),
    o('sdt', Ld()),
    o('math', Bd()),
    t.has('table') || n.push(...Vd()),
    o('pasteStyleInliner', cu()),
    o('list', jd()),
    o('baseKeymap', qd()),
    o('selectionTracker', Xd({ onSelectionChange: e.onSelectionChange })),
    o('paragraphChangeTracker', au()),
    o('bidiShortcut', su()),
    n
  );
}
var Vn = class {
  constructor(t) {
    chunkH5NTJZO4_js.d(this, 'extensions');
    chunkH5NTJZO4_js.d(this, 'schema', null);
    chunkH5NTJZO4_js.d(this, 'plugins', []);
    chunkH5NTJZO4_js.d(this, 'commands', {});
    this.extensions = [...t].sort((n, o) => n.config.priority - o.config.priority);
  }
  buildSchema() {
    let t = {},
      n = {};
    for (let o of this.extensions)
      o.type === 'node'
        ? (t[o.config.schemaNodeName] = o.config.nodeSpec)
        : o.type === 'mark' && (n[o.config.schemaMarkName] = o.config.markSpec);
    this.schema = new prosemirrorModel.Schema({ nodes: t, marks: n });
  }
  initializeRuntime() {
    if (!this.schema)
      throw new Error('ExtensionManager: buildSchema() must be called before initializeRuntime()');
    let t = { schema: this.schema },
      n = [],
      o = [],
      r = {};
    for (let i of this.extensions) {
      let a = i.onSchemaReady(t);
      (a.commands && Object.assign(r, a.commands),
        a.keyboardShortcuts && n.push(a.keyboardShortcuts),
        a.plugins && o.push(...a.plugins));
    }
    ((this.plugins = [...o, ...n.map((i) => prosemirrorKeymap.keymap(i))]), (this.commands = r));
  }
  getSchema() {
    if (!this.schema) throw new Error('ExtensionManager: buildSchema() must be called first');
    return this.schema;
  }
  getPlugins() {
    return this.plugins;
  }
  getCommands() {
    return this.commands;
  }
  getCommand(t) {
    return this.commands[t];
  }
  destroy() {
    ((this.plugins = []), (this.commands = {}));
  }
};
var hi = new Vn(Go());
hi.buildSchema();
hi.initializeRuntime();
var Mn = hi,
  we = hi.getSchema();
var fh = {
    styleId: 'Normal',
    type: 'paragraph',
    name: 'Normal',
    default: true,
    pPr: { spaceAfter: 160, lineSpacing: 259, lineSpacingRule: 'auto' },
  },
  Sr = class {
    constructor(t) {
      chunkH5NTJZO4_js.d(this, 'stylesById');
      chunkH5NTJZO4_js.d(this, 'docDefaults');
      chunkH5NTJZO4_js.d(this, 'defaultParagraphStyle');
      if (((this.stylesById = new Map()), (this.docDefaults = t?.docDefaults), t?.styles))
        for (let n of t.styles) n.styleId && this.stylesById.set(n.styleId, n);
      this.defaultParagraphStyle = this.findDefaultStyle('paragraph');
    }
    getStyle(t) {
      return this.stylesById.get(t);
    }
    getParagraphStyles() {
      let t = [];
      for (let n of this.stylesById.values())
        n.type === 'paragraph' && !n.hidden && !n.semiHidden && t.push(n);
      return t.sort((n, o) => {
        let r = n.uiPriority ?? 99,
          i = o.uiPriority ?? 99;
        return r !== i ? r - i : (n.name ?? n.styleId).localeCompare(o.name ?? o.styleId);
      });
    }
    resolveParagraphStyle(t) {
      let n = {};
      if (
        (this.docDefaults?.pPr && (n.paragraphFormatting = { ...this.docDefaults.pPr }),
        this.docDefaults?.rPr && (n.runFormatting = { ...this.docDefaults.rPr }),
        !t)
      )
        return (
          this.defaultParagraphStyle && this.mergeStyleIntoResult(n, this.defaultParagraphStyle),
          n
        );
      let o = this.stylesById.get(t);
      return o
        ? (this.mergeStyleIntoResult(n, o), n)
        : (this.defaultParagraphStyle && this.mergeStyleIntoResult(n, this.defaultParagraphStyle),
          n);
    }
    getTableStyles() {
      let t = [];
      for (let n of this.stylesById.values())
        n.type === 'table' && !n.hidden && !n.semiHidden && t.push(n);
      return t.sort((n, o) => {
        let r = n.uiPriority ?? 99,
          i = o.uiPriority ?? 99;
        return r !== i ? r - i : (n.name ?? n.styleId).localeCompare(o.name ?? o.styleId);
      });
    }
    resolveRunStyle(t) {
      let n = {};
      if ((this.docDefaults?.rPr && (n = { ...this.docDefaults.rPr }), !t))
        return Object.keys(n).length > 0 ? n : void 0;
      let o = this.stylesById.get(t);
      if (!o?.rPr) return Object.keys(n).length > 0 ? n : void 0;
      let r = this.mergeTextFormatting(n, o.rPr);
      return r && Object.keys(r).length > 0 ? r : void 0;
    }
    getRunStyleOwnProperties(t) {
      if (!t) return;
      let n = this.stylesById.get(t);
      if (n?.rPr) return Object.keys(n.rPr).length > 0 ? { ...n.rPr } : void 0;
    }
    getDocDefaults() {
      return this.docDefaults;
    }
    getDefaultParagraphStyle() {
      return this.defaultParagraphStyle;
    }
    hasStyle(t) {
      return this.stylesById.has(t);
    }
    findDefaultStyle(t) {
      for (let n of this.stylesById.values()) if (n.type === t && n.default) return n;
      if (t === 'paragraph') return this.stylesById.get('Normal') ?? fh;
    }
    mergeStyleIntoResult(t, n) {
      (n.pPr &&
        (t.paragraphFormatting = this.mergeParagraphFormatting(t.paragraphFormatting, n.pPr)),
        n.rPr && (t.runFormatting = this.mergeTextFormatting(t.runFormatting, n.rPr)));
    }
    mergeParagraphFormatting(t, n) {
      if (!n) return t;
      if (!t) return n ? { ...n } : void 0;
      let o = { ...t };
      for (let r of Object.keys(n)) {
        let i = n[r];
        if (i !== void 0)
          if (r === 'runProperties')
            o.runProperties = this.mergeTextFormatting(o.runProperties, n.runProperties);
          else if (r === 'borders' || r === 'numPr' || r === 'frame') {
            let a = o[r],
              s = i;
            o[r] = { ...(a || {}), ...(s || {}) };
          } else r === 'tabs' && Array.isArray(i) ? (o.tabs = [...i]) : (o[r] = i);
      }
      return o;
    }
    mergeTextFormatting(t, n) {
      if (!n) return t;
      if (!t) return n ? { ...n } : void 0;
      let o = { ...t };
      for (let r of Object.keys(n)) {
        let i = n[r];
        i !== void 0 &&
          (typeof i == 'object' && i !== null ? (o[r] = { ...(o[r] || {}), ...i }) : (o[r] = i));
      }
      return o;
    }
  };
function bo(e) {
  return new Sr(e);
}
function xi(e, t) {
  let n = e.package.document.content,
    o = [],
    r = t?.styles ? bo(t.styles) : null;
  for (let i of n)
    if (i.type === 'paragraph') (o.push(...du(i, r)), Eh(i) && o.push(we.node('pageBreak')));
    else if (i.type === 'table') {
      let a = Os(i, r);
      o.push(a);
    }
  return (o.length === 0 && o.push(we.node('paragraph', {}, [])), we.node('doc', null, o));
}
function Ns(e, t, n, o) {
  let r = gh(e, t),
    i = [],
    a,
    s = new Set(),
    l;
  t && (l = t.resolveParagraphStyle(e.formatting?.styleId).runFormatting);
  let u = xn(l, o);
  for (let d of e.content) {
    if (d.type === 'commentRangeStart') s.add(d.id);
    else if (d.type === 'commentRangeEnd') s.delete(d.id);
    else if (d.type === 'run') {
      let c = zs(d, u, t);
      (s.size > 0 && (c = mh(c, s)), i.push(...c));
    } else if (d.type === 'hyperlink') {
      let c = $s(d, u, t);
      i.push(...c);
    } else if (d.type === 'simpleField' || d.type === 'complexField') {
      let c = xh(d, u);
      c && i.push(c);
    } else if (d.type === 'inlineSdt') {
      let c = kh(d, u, t);
      c && i.push(c);
    } else if (d.type === 'insertion') {
      let c = bi(d, 'insertion', u, t);
      i.push(...c);
    } else if (d.type === 'deletion') {
      let c = bi(d, 'deletion', u, t);
      i.push(...c);
    } else if (d.type === 'moveFrom') {
      let c = bi(d, 'deletion', u, t);
      i.push(...c);
    } else if (d.type === 'moveTo') {
      let c = bi(d, 'insertion', u, t);
      i.push(...c);
    } else if (d.type === 'mathEquation') {
      let c = Sh(d);
      c && i.push(c);
    }
    d.type === 'bookmarkStart' && (a || (a = []), a.push({ id: d.id, name: d.name }));
  }
  return (a && (r.bookmarks = a), we.node('paragraph', r, i));
}
function mh(e, t) {
  if (t.size === 0) return e;
  let n = [...t][0],
    o = we.marks.comment.create({ commentId: n });
  return e.map((r) => (r.isText ? r.mark(o.addToSet(r.marks)) : r));
}
function bi(e, t, n, o) {
  let r = [];
  for (let a of e.content)
    a.type === 'run' ? r.push(...zs(a, n, o)) : a.type === 'hyperlink' && r.push(...$s(a, n, o));
  let i = we.marks[t].create({
    revisionId: e.info.id,
    author: e.info.author,
    date: e.info.date ?? null,
  });
  return r.map((a) => (a.isText ? a.mark(i.addToSet(a.marks)) : a));
}
function gh(e, t) {
  let n = e.formatting,
    o = n?.styleId,
    r = {
      paraId: e.paraId ?? void 0,
      textId: e.textId ?? void 0,
      styleId: o,
      numPr: n?.numPr,
      listNumFmt: e.listRendering?.numFmt,
      listIsBullet: e.listRendering?.isBullet,
      listMarker: e.listRendering?.marker,
      listMarkerHidden: e.listRendering?.markerHidden || void 0,
      listMarkerFontFamily: e.listRendering?.markerFontFamily || void 0,
      listMarkerFontSize: e.listRendering?.markerFontSize || void 0,
      _originalFormatting: n || void 0,
    };
  if (t) {
    let i = t.resolveParagraphStyle(o),
      a = i.paragraphFormatting,
      s = i.runFormatting;
    ((r.alignment = n?.alignment ?? a?.alignment),
      (r.spaceBefore = n?.spaceBefore ?? a?.spaceBefore),
      (r.spaceAfter = n?.spaceAfter ?? a?.spaceAfter),
      (r.lineSpacing = n?.lineSpacing ?? a?.lineSpacing),
      (r.lineSpacingRule = n?.lineSpacingRule ?? a?.lineSpacingRule),
      (r.indentLeft = n?.indentLeft ?? a?.indentLeft),
      (r.indentRight = n?.indentRight ?? a?.indentRight),
      (r.indentFirstLine = n?.indentFirstLine ?? a?.indentFirstLine),
      (r.hangingIndent = n?.hangingIndent ?? a?.hangingIndent),
      (r.borders = n?.borders ?? a?.borders),
      (r.shading = n?.shading ?? a?.shading),
      (r.tabs = n?.tabs ?? a?.tabs),
      (r.pageBreakBefore = n?.pageBreakBefore ?? a?.pageBreakBefore),
      (r.keepNext = n?.keepNext ?? a?.keepNext),
      (r.keepLines = n?.keepLines ?? a?.keepLines),
      (r.contextualSpacing = n?.contextualSpacing ?? a?.contextualSpacing),
      (r.outlineLevel = n?.outlineLevel ?? a?.outlineLevel),
      (r.bidi = n?.bidi ?? a?.bidi));
    let l = yi(n?.runProperties, t);
    ((r.defaultTextFormatting = xn(s, l)),
      !n?.numPr && a?.numPr && a.numPr.numId !== 0 && (r.numPr = a.numPr));
  } else
    ((r.alignment = n?.alignment),
      (r.spaceBefore = n?.spaceBefore),
      (r.spaceAfter = n?.spaceAfter),
      (r.lineSpacing = n?.lineSpacing),
      (r.lineSpacingRule = n?.lineSpacingRule),
      (r.indentLeft = n?.indentLeft),
      (r.indentRight = n?.indentRight),
      (r.indentFirstLine = n?.indentFirstLine),
      (r.hangingIndent = n?.hangingIndent),
      (r.borders = n?.borders),
      (r.shading = n?.shading),
      (r.tabs = n?.tabs),
      (r.pageBreakBefore = n?.pageBreakBefore),
      (r.keepNext = n?.keepNext),
      (r.keepLines = n?.keepLines),
      (r.outlineLevel = n?.outlineLevel),
      (r.bidi = n?.bidi),
      (r.defaultTextFormatting = yi(n?.runProperties, t)));
  if (e.sectionProperties) {
    r._sectionProperties = e.sectionProperties;
    let i = e.sectionProperties.sectionStart;
    (i === 'nextPage' || i === 'continuous' || i === 'oddPage' || i === 'evenPage') &&
      (r.sectionBreakType = i);
  }
  return r;
}
function Yt(e, t, n) {
  if (!e || !t) return;
  let o = e.getStyle(t);
  if (!o?.tblStylePr) return;
  let r = o.tblStylePr.find((l) => l.type === n);
  if (!r) return;
  let i = yi(r.pPr?.runProperties, e),
    a = yi(r.rPr, e),
    s = xn(i, a);
  return { tcPr: r.tcPr, rPr: s };
}
function yn(e, t) {
  if (!e && !t) return;
  if (!e) return t;
  if (!t) return e;
  let n = {},
    o = e.tcPr,
    r = t.tcPr;
  if (o || r) {
    let i = { ...(o ?? {}), ...(r ?? {}) };
    ((o?.borders || r?.borders) && (i.borders = { ...(o?.borders ?? {}), ...(r?.borders ?? {}) }),
      (o?.shading || r?.shading) && (i.shading = { ...(o?.shading ?? {}), ...(r?.shading ?? {}) }),
      (o?.margins || r?.margins) && (i.margins = { ...(o?.margins ?? {}), ...(r?.margins ?? {}) }),
      (n.tcPr = i));
  }
  return ((n.rPr = xn(e.rPr, t.rPr)), n);
}
function yi(e, t) {
  if (!e) return;
  if (!e.styleId || !t) return e;
  let n = t.resolveRunStyle(e.styleId);
  return xn(n, e);
}
function hh(e) {
  let t = new Map(),
    n = e.rows.length,
    o = new Map();
  for (let r = 0; r < n; r++) {
    let i = e.rows[r],
      a = 0;
    for (let s = 0; s < i.cells.length; s++) {
      let l = i.cells[s],
        u = l.formatting?.gridSpan ?? 1,
        d = l.formatting?.vMerge,
        c = `${r}-${a}`;
      if (d === 'restart') (o.set(a, r), t.set(c, { rowSpan: 1, skip: false }));
      else if (d === 'continue') {
        let p = o.get(a);
        if (p !== void 0) {
          let f = `${p}-${a}`,
            m = t.get(f);
          m && m.rowSpan++;
        }
        t.set(c, { rowSpan: 1, skip: true });
      } else (o.delete(a), t.set(c, { rowSpan: 1, skip: false }));
      a += u;
    }
  }
  return t;
}
function Os(e, t) {
  let n = hh(e),
    o = e.columnWidths,
    r = o?.reduce((S, B) => S + B, 0) ?? 0,
    i = e.formatting?.styleId,
    a = e.formatting?.look,
    s = i ? t?.getStyle(i) : void 0,
    l = e.formatting?.borders ?? s?.tblPr?.borders,
    u = e.formatting?.cellMargins ?? s?.tblPr?.cellMargins ?? void 0,
    d = u
      ? { top: u.top?.value, bottom: u.bottom?.value, left: u.left?.value, right: u.right?.value }
      : void 0,
    c = {
      styleId: e.formatting?.styleId,
      width: e.formatting?.width?.value,
      widthType: e.formatting?.width?.type,
      justification: e.formatting?.justification,
      columnWidths: o,
      floating: e.formatting?.floating,
      cellMargins: d,
      look: e.formatting?.look,
      _originalFormatting: e.formatting || void 0,
    },
    p = {
      wholeTable: Yt(t, i, 'wholeTable'),
      firstRow: Yt(t, i, 'firstRow'),
      lastRow: Yt(t, i, 'lastRow'),
      firstCol: Yt(t, i, 'firstCol'),
      lastCol: Yt(t, i, 'lastCol'),
      band1Horz: Yt(t, i, 'band1Horz'),
      band2Horz: Yt(t, i, 'band2Horz'),
      band1Vert: Yt(t, i, 'band1Vert'),
      band2Vert: Yt(t, i, 'band2Vert'),
      nwCell: Yt(t, i, 'nwCell'),
      neCell: Yt(t, i, 'neCell'),
      swCell: Yt(t, i, 'swCell'),
      seCell: Yt(t, i, 'seCell'),
    },
    f = a?.noHBand !== true,
    m = a?.noVBand !== true,
    b = 0,
    g = e.rows.length,
    x = o?.length ?? e.rows[0]?.cells.reduce((S, B) => S + (B.formatting?.gridSpan ?? 1), 0) ?? 0,
    T = e.rows.map((S, B) => {
      let v = B === 0 && !!a?.firstRow,
        M = B === g - 1 && !!a?.lastRow,
        U = f && !v && !M ? (b % 2 === 0 ? p.band1Horz : p.band2Horz) : void 0;
      return (f && !v && !M && b++, bh(S, t, v, o, r, p, U, m, a, l, B, g, x, n, d));
    });
  return we.node('table', c, T);
}
function bh(e, t, n, o, r, i, a, s, l, u, d, c, p, f, m) {
  let b = {
      height: e.formatting?.height?.value,
      heightRule: e.formatting?.heightRule,
      isHeader: n || e.formatting?.header,
      _originalFormatting: e.formatting || void 0,
    },
    g = e.cells.length,
    x = d === 0,
    T = d === (c ?? 1) - 1,
    S = e.formatting?.conditionalFormat,
    B = S?.firstRow ?? x,
    v = S?.lastRow ?? T,
    M = p ?? g,
    U = 0,
    ee = [];
  for (let O = 0; O < e.cells.length; O++) {
    let N = e.cells[O],
      ne = N.formatting?.gridSpan ?? 1,
      ce = `${d ?? 0}-${U}`,
      D = f?.get(ce),
      z = D?.skip ?? false,
      ae = D?.rowSpan ?? 1,
      se;
    if (o && r && r > 0) {
      let Z = 0;
      for (let le = 0; le < ne && U + le < o.length; le++) Z += o[U + le];
      se = Math.round((Z / r) * 100);
    }
    if (((U += ne), z)) continue;
    let A = U - ne === 0,
      Ie = U === M,
      Fe = N.formatting?.conditionalFormat,
      Ue = Fe?.firstRow ?? B,
      P = Fe?.lastRow ?? v,
      F = Fe?.firstColumn ?? A,
      k = Fe?.lastColumn ?? Ie,
      L;
    if (s) {
      let Z = l?.firstColumn ? 1 : 0,
        le = U - ne - Z;
      le >= 0 &&
        !(l?.lastColumn && k) &&
        !(l?.firstColumn && F) &&
        (L = le % 2 === 0 ? i?.band1Vert : i?.band2Vert);
    }
    Fe?.oddVBand ? (L = i?.band1Vert) : Fe?.evenVBand && (L = i?.band2Vert);
    let I = a;
    (S?.oddHBand ? (I = i?.band1Horz) : S?.evenHBand && (I = i?.band2Horz),
      Fe?.oddHBand ? (I = i?.band1Horz) : Fe?.evenHBand && (I = i?.band2Horz));
    let E = i?.wholeTable;
    ((E = yn(E, I)),
      (E = yn(E, L)),
      Ue && (l?.firstRow || S?.firstRow || Fe?.firstRow) && (E = yn(E, i?.firstRow)),
      P && (l?.lastRow || S?.lastRow || Fe?.lastRow) && (E = yn(E, i?.lastRow)),
      F && (l?.firstColumn || S?.firstColumn || Fe?.firstColumn) && (E = yn(E, i?.firstCol)),
      k && (l?.lastColumn || S?.lastColumn || Fe?.lastColumn) && (E = yn(E, i?.lastCol)),
      Ue &&
        F &&
        (l?.firstRow || S?.firstRow || Fe?.firstRow) &&
        (l?.firstColumn || S?.firstColumn || Fe?.firstColumn) &&
        (E = yn(E, i?.nwCell)),
      Ue &&
        k &&
        (l?.firstRow || S?.firstRow || Fe?.firstRow) &&
        (l?.lastColumn || S?.lastColumn || Fe?.lastColumn) &&
        (E = yn(E, i?.neCell)),
      P &&
        F &&
        (l?.lastRow || S?.lastRow || Fe?.lastRow) &&
        (l?.firstColumn || S?.firstColumn || Fe?.firstColumn) &&
        (E = yn(E, i?.swCell)),
      P &&
        k &&
        (l?.lastRow || S?.lastRow || Fe?.lastRow) &&
        (l?.lastColumn || S?.lastColumn || Fe?.lastColumn) &&
        (E = yn(E, i?.seCell)),
      ee.push(yh(N, t, n, se, E, u, x, T, A, Ie, ae, m)));
  }
  return we.node('tableRow', b, ee);
}
function yh(e, t, n, o, r, i, a, s, l, u, d, c) {
  let p = e.formatting,
    f = d ?? 1,
    m = p?.width?.value,
    b = p?.width?.type;
  m === void 0 && o !== void 0 && ((m = o), (b = 'pct'));
  let g = p?.shading?.fill?.rgb ?? r?.tcPr?.shading?.fill?.rgb,
    x = i
      ? {
          top: a ? i.top : i.insideH,
          bottom: s ? i.bottom : i.insideH,
          left: l ? i.left : i.insideV,
          right: u ? i.right : i.insideV,
        }
      : void 0,
    T = r?.tcPr?.borders,
    S = p?.borders,
    B = x || T || S ? { ...(x ?? {}), ...(T ?? {}), ...(S ?? {}) } : void 0,
    v = {
      colspan: p?.gridSpan ?? 1,
      rowspan: f,
      width: m,
      widthType: b,
      verticalAlign: p?.verticalAlign,
      backgroundColor: g,
      textDirection: p?.textDirection,
      noWrap: p?.noWrap,
      borders: B,
      margins: p?.margins
        ? {
            top: p.margins.top?.value,
            bottom: p.margins.bottom?.value,
            left: p.margins.left?.value,
            right: p.margins.right?.value,
          }
        : r?.tcPr?.margins
          ? {
              top: r.tcPr.margins.top?.value,
              bottom: r.tcPr.margins.bottom?.value,
              left: r.tcPr.margins.left?.value,
              right: r.tcPr.margins.right?.value,
            }
          : c,
      _originalFormatting: p || void 0,
    },
    M = [];
  for (let ee of e.content)
    ee.type === 'paragraph'
      ? M.push(Ns(ee, t, void 0, r?.rPr))
      : ee.type === 'table' && M.push(Os(ee, t));
  M.length === 0 && M.push(we.node('paragraph', {}, []));
  let U = n ? 'tableHeader' : 'tableCell';
  return we.node(U, v, M);
}
function xh(e, t) {
  let n = '',
    o,
    r = e.type === 'simpleField' ? e.content : e.fieldResult;
  if (r) {
    for (let s of r)
      if (s.type === 'run') {
        for (let l of s.content) l.type === 'text' && (n += l.text);
        !o && s.formatting && (o = s.formatting);
      }
  }
  let i = xn(t, o),
    a = Ws(i);
  return we.node(
    'field',
    {
      fieldType: e.fieldType,
      instruction: e.instruction,
      displayText: n,
      fieldKind: e.type === 'simpleField' ? 'simple' : 'complex',
      fldLock: e.fldLock ?? false,
      dirty: e.dirty ?? false,
    },
    void 0,
    a
  );
}
function Sh(e) {
  return we.node('math', { display: e.display, ommlXml: e.ommlXml, plainText: e.plainText || '' });
}
function kh(e, t, n) {
  let o = e.properties,
    r = [];
  for (let i of e.content)
    if (i.type === 'run') {
      let a = zs(i, t, n);
      r.push(...a);
    } else if (i.type === 'hyperlink') {
      let a = $s(i, t, n);
      r.push(...a);
    }
  return we.node(
    'sdt',
    {
      sdtType: o.sdtType,
      alias: o.alias ?? null,
      tag: o.tag ?? null,
      lock: o.lock ?? null,
      placeholder: o.placeholder ?? null,
      showingPlaceholder: o.showingPlaceholder ?? false,
      dateFormat: o.dateFormat ?? null,
      listItems: o.listItems ? JSON.stringify(o.listItems) : null,
      checked: o.checked ?? null,
    },
    r.length > 0 ? r : void 0
  );
}
function zs(e, t, n) {
  let o = [],
    r = e.formatting?.styleId ? n?.getRunStyleOwnProperties(e.formatting.styleId) : void 0,
    i = xn(xn(t, r), e.formatting),
    a = Ws(i);
  for (let s of e.content) {
    let l = Th(s, a);
    o.push(...l);
  }
  return o;
}
function xn(e, t) {
  if (!t && !e) return;
  if (!t) return e;
  if (!e) return t;
  let n = { ...e };
  if (
    (t.bold !== void 0 && (n.bold = t.bold),
    t.italic !== void 0 && (n.italic = t.italic),
    t.underline !== void 0 && (n.underline = t.underline),
    t.strike !== void 0 && (n.strike = t.strike),
    t.doubleStrike !== void 0 && (n.doubleStrike = t.doubleStrike),
    t.color !== void 0)
  ) {
    let o = t.color.rgb || t.color.themeColor || t.color.themeTint || t.color.themeShade;
    (!t.color.auto || o) && (n.color = t.color);
  }
  return (
    t.highlight !== void 0 && (n.highlight = t.highlight),
    t.fontSize !== void 0 && (n.fontSize = t.fontSize),
    t.fontFamily !== void 0 && (n.fontFamily = t.fontFamily),
    t.vertAlign !== void 0 && (n.vertAlign = t.vertAlign),
    t.allCaps !== void 0 && (n.allCaps = t.allCaps),
    t.smallCaps !== void 0 && (n.smallCaps = t.smallCaps),
    n
  );
}
function Th(e, t) {
  switch (e.type) {
    case 'text':
      return e.text ? [we.text(e.text, t)] : [];
    case 'break':
      return e.breakType === 'textWrapping' || !e.breakType ? [we.node('hardBreak')] : [];
    case 'tab':
      return [we.node('tab')];
    case 'drawing':
      return e.image ? [wh(e.image)] : [];
    case 'shape': {
      let r = e.shape;
      return r.textBody && r.textBody.content.length > 0 ? [] : [Ch(r)];
    }
    case 'footnoteRef':
      let n = we.mark('footnoteRef', { id: e.id.toString(), noteType: 'footnote' });
      return [we.text(e.id.toString(), [...t, n])];
    case 'endnoteRef':
      let o = we.mark('footnoteRef', { id: e.id.toString(), noteType: 'endnote' });
      return [we.text(e.id.toString(), [...t, o])];
    default:
      return [];
  }
}
function wh(e) {
  let t = e.size?.width ? chunkSE5EN2QL_js.c(e.size.width) : void 0,
    n = e.size?.height ? chunkSE5EN2QL_js.c(e.size.height) : void 0,
    o = e.wrap.type,
    r = e.wrap.wrapText,
    i = e.position?.horizontal?.alignment,
    a;
  o === 'inline' || o === 'topAndBottom'
    ? (a = 'none')
    : o === 'square' || o === 'tight' || o === 'through'
      ? r === 'left'
        ? (a = 'right')
        : r === 'right' || i === 'left'
          ? (a = 'left')
          : i === 'right'
            ? (a = 'right')
            : (a = 'none')
      : (a = 'none');
  let s = 'inline';
  o === 'inline' ? (s = 'inline') : a && a !== 'none' ? (s = 'float') : (s = 'block');
  let l;
  if (e.transform) {
    let x = [];
    (e.transform.rotation && x.push(`rotate(${e.transform.rotation}deg)`),
      e.transform.flipH && x.push('scaleX(-1)'),
      e.transform.flipV && x.push('scaleY(-1)'),
      x.length > 0 && (l = x.join(' ')));
  }
  let u = e.wrap.distT ? chunkSE5EN2QL_js.c(e.wrap.distT) : void 0,
    d = e.wrap.distB ? chunkSE5EN2QL_js.c(e.wrap.distB) : void 0,
    c = e.wrap.distL ? chunkSE5EN2QL_js.c(e.wrap.distL) : void 0,
    p = e.wrap.distR ? chunkSE5EN2QL_js.c(e.wrap.distR) : void 0,
    f;
  e.position &&
    (f = {
      horizontal: e.position.horizontal
        ? {
            relativeTo: e.position.horizontal.relativeTo,
            posOffset: e.position.horizontal.posOffset,
            align: e.position.horizontal.alignment,
          }
        : void 0,
      vertical: e.position.vertical
        ? {
            relativeTo: e.position.vertical.relativeTo,
            posOffset: e.position.vertical.posOffset,
            align: e.position.vertical.alignment,
          }
        : void 0,
    });
  let m, b, g;
  if (e.outline && e.outline.width) {
    ((m = Math.round((e.outline.width / 914400) * 96 * 100) / 100),
      e.outline.color?.rgb && (b = `#${e.outline.color.rgb}`));
    let x = {
      solid: 'solid',
      dot: 'dotted',
      dash: 'dashed',
      lgDash: 'dashed',
      dashDot: 'dashed',
      lgDashDot: 'dashed',
      lgDashDotDot: 'dashed',
      sysDot: 'dotted',
      sysDash: 'dashed',
      sysDashDot: 'dashed',
      sysDashDotDot: 'dashed',
    };
    g = (e.outline.style && x[e.outline.style]) || 'solid';
  }
  return we.node('image', {
    src: e.src || '',
    alt: e.alt,
    title: e.title,
    width: t,
    height: n,
    rId: e.rId,
    wrapType: o,
    displayMode: s,
    cssFloat: a,
    transform: l,
    distTop: u,
    distBottom: d,
    distLeft: c,
    distRight: p,
    position: f,
    borderWidth: m,
    borderColor: b,
    borderStyle: g,
    wrapText: r,
    hlinkHref: e.hlinkHref,
  });
}
function $s(e, t, n) {
  let o = [],
    r = e.href || (e.anchor ? `#${e.anchor}` : ''),
    i = we.mark('hyperlink', { href: r, tooltip: e.tooltip, rId: e.rId });
  for (let a of e.children)
    if (a.type === 'run') {
      let s = a.formatting?.styleId ? n?.resolveRunStyle(a.formatting.styleId) : void 0,
        l = xn(xn(t, s), a.formatting),
        d = [...Ws(l), i];
      for (let c of a.content) c.type === 'text' && c.text && o.push(we.text(c.text, d));
    }
  return o;
}
function Ws(e) {
  if (!e) return [];
  let t = [];
  return (
    e.bold && t.push(we.mark('bold')),
    e.italic && t.push(we.mark('italic')),
    e.underline &&
      e.underline.style !== 'none' &&
      t.push(we.mark('underline', { style: e.underline.style, color: e.underline.color })),
    (e.strike || e.doubleStrike) && t.push(we.mark('strike', { double: e.doubleStrike || false })),
    e.color &&
      !e.color.auto &&
      t.push(
        we.mark('textColor', {
          rgb: e.color.rgb,
          themeColor: e.color.themeColor,
          themeTint: e.color.themeTint,
          themeShade: e.color.themeShade,
        })
      ),
    e.highlight && e.highlight !== 'none' && t.push(we.mark('highlight', { color: e.highlight })),
    e.fontSize && t.push(we.mark('fontSize', { size: e.fontSize })),
    e.fontFamily &&
      t.push(
        we.mark('fontFamily', {
          ascii: e.fontFamily.ascii,
          hAnsi: e.fontFamily.hAnsi,
          eastAsia: e.fontFamily.eastAsia,
          cs: e.fontFamily.cs,
          asciiTheme: e.fontFamily.asciiTheme,
          hAnsiTheme: e.fontFamily.hAnsiTheme,
          eastAsiaTheme: e.fontFamily.eastAsiaTheme,
          csTheme: e.fontFamily.csTheme,
        })
      ),
    e.vertAlign === 'superscript'
      ? t.push(we.mark('superscript'))
      : e.vertAlign === 'subscript' && t.push(we.mark('subscript')),
    e.allCaps && t.push(we.mark('allCaps')),
    e.smallCaps && t.push(we.mark('smallCaps')),
    (e.spacing != null || e.position != null || e.scale != null || e.kerning != null) &&
      t.push(
        we.mark('characterSpacing', {
          spacing: e.spacing ?? null,
          position: e.position ?? null,
          scale: e.scale ?? null,
          kerning: e.kerning ?? null,
        })
      ),
    e.emboss && t.push(we.mark('emboss')),
    e.imprint && t.push(we.mark('imprint')),
    e.shadow && t.push(we.mark('textShadow')),
    e.emphasisMark &&
      e.emphasisMark !== 'none' &&
      t.push(we.mark('emphasisMark', { type: e.emphasisMark })),
    e.outline && t.push(we.mark('textOutline')),
    t
  );
}
function Ch(e) {
  let t = e.size?.width ? chunkSE5EN2QL_js.c(e.size.width) : 100,
    n = e.size?.height ? chunkSE5EN2QL_js.c(e.size.height) : 80,
    o,
    r = 'solid',
    i,
    a,
    s;
  if (
    e.fill &&
    ((r = e.fill.type),
    e.fill.color?.rgb && (o = `#${e.fill.color.rgb}`),
    e.fill.type === 'gradient' && e.fill.gradient)
  ) {
    let p = e.fill.gradient;
    ((i = p.type),
      (a = p.angle),
      (s = JSON.stringify(
        p.stops.map((f) => ({
          position: f.position,
          color: f.color.rgb ? `#${f.color.rgb}` : '#000000',
        }))
      )));
  }
  let l, u, d;
  e.outline &&
    (e.outline.width && (l = Math.round((e.outline.width / 914400) * 96 * 100) / 100),
    e.outline.color?.rgb && (u = `#${e.outline.color.rgb}`),
    (d = e.outline.style || 'solid'));
  let c;
  if (e.transform) {
    let p = [];
    (e.transform.rotation && p.push(`rotate(${e.transform.rotation}deg)`),
      e.transform.flipH && p.push('scaleX(-1)'),
      e.transform.flipV && p.push('scaleY(-1)'),
      p.length > 0 && (c = p.join(' ')));
  }
  return we.node('shape', {
    shapeType: e.shapeType || 'rect',
    shapeId: e.id,
    width: t,
    height: n,
    fillColor: o,
    fillType: r,
    gradientType: i,
    gradientAngle: a,
    gradientStops: s,
    outlineWidth: l,
    outlineColor: u,
    outlineStyle: d,
    transform: c,
  });
}
function du(e, t) {
  let n = vh(e),
    o = Ns(e, t),
    r = [];
  (n.length > 0 && o.content.size === 0) || r.push(o);
  for (let a of n) r.push(Rh(a, t));
  return r;
}
function vh(e) {
  let t = [];
  for (let n of e.content)
    if (n.type === 'run') {
      for (let o of n.content)
        if (o.type === 'shape' && 'shape' in o) {
          let r = o.shape;
          r.textBody &&
            r.textBody.content.length > 0 &&
            t.push({
              type: 'textBox',
              id: r.id,
              size: r.size,
              position: r.position,
              wrap: r.wrap,
              fill: r.fill,
              outline: r.outline,
              content: r.textBody.content,
              margins: r.textBody.margins,
            });
        }
    }
  return t;
}
function Rh(e, t) {
  let n = e.size?.width ? chunkSE5EN2QL_js.c(e.size.width) : 200,
    o = e.size?.height ? chunkSE5EN2QL_js.c(e.size.height) : void 0,
    r;
  e.fill?.color?.rgb && (r = `#${e.fill.color.rgb}`);
  let i, a, s;
  e.outline &&
    e.outline.width &&
    ((i = Math.round((e.outline.width / 914400) * 96 * 100) / 100),
    e.outline.color?.rgb && (a = `#${e.outline.color.rgb}`),
    (s = e.outline.style || 'solid'));
  let l = e.margins?.top != null ? chunkSE5EN2QL_js.c(e.margins.top) : 4,
    u = e.margins?.bottom != null ? chunkSE5EN2QL_js.c(e.margins.bottom) : 4,
    d = e.margins?.left != null ? chunkSE5EN2QL_js.c(e.margins.left) : 7,
    c = e.margins?.right != null ? chunkSE5EN2QL_js.c(e.margins.right) : 7,
    p = [];
  for (let f of e.content) p.push(Ns(f, t));
  return (
    p.length === 0 && p.push(we.node('paragraph', {}, [])),
    we.node(
      'textBox',
      {
        width: n,
        height: o,
        textBoxId: e.id,
        fillColor: r,
        outlineWidth: i,
        outlineColor: a,
        outlineStyle: s,
        marginTop: l,
        marginBottom: u,
        marginLeft: d,
        marginRight: c,
      },
      p
    )
  );
}
function _s(e, t) {
  let n = [],
    o = t?.styles ? bo(t.styles) : null;
  for (let r of e)
    r.type === 'paragraph' ? n.push(...du(r, o)) : r.type === 'table' && n.push(Os(r, o));
  return (n.length === 0 && n.push(we.node('paragraph', {}, [])), we.node('doc', null, n));
}
function Eh(e) {
  for (let t of e.content)
    if (t.type === 'run') {
      for (let n of t.content) if (n.type === 'break' && n.breakType === 'page') return true;
    }
  return false;
}
function Si() {
  return we.node('doc', null, [we.node('paragraph', {}, [])]);
}
function ki(e, t) {
  let o = {
    content: pu(e),
    finalSectionProperties: t?.package.document.finalSectionProperties,
    sections: t?.package.document.sections,
    comments: t?.package.document.comments,
  };
  return t ? { ...t, package: { ...t.package, document: o } } : { package: { document: o } };
}
function pu(e) {
  let t = [],
    n = mu(e);
  return (
    e.forEach((o) => {
      o.type.name === 'paragraph'
        ? t.push(Vs(o, n))
        : o.type.name === 'table'
          ? t.push(hu(o, n))
          : o.type.name === 'textBox'
            ? t.push(Yh(o))
            : o.type.name === 'pageBreak' && t.push(Ph());
    }),
    t
  );
}
function Ph() {
  return {
    type: 'paragraph',
    content: [{ type: 'run', content: [{ type: 'break', breakType: 'page' }] }],
  };
}
function Vs(e, t) {
  let n = e.attrs,
    o = Mh(fu(e, t), e),
    r = n.bookmarks;
  if (r && r.length > 0) {
    let a = r.map((l) => ({ type: 'bookmarkStart', id: l.id, name: l.name })),
      s = r.map((l) => ({ type: 'bookmarkEnd', id: l.id }));
    o = [...a, ...o, ...s];
  }
  let i = {
    type: 'paragraph',
    paraId: n.paraId || void 0,
    textId: n.textId || void 0,
    formatting: Ih(n),
    content: o,
  };
  return (
    n._sectionProperties
      ? (i.sectionProperties = n._sectionProperties)
      : n.sectionBreakType && (i.sectionProperties = { sectionStart: n.sectionBreakType }),
    i
  );
}
function Mh(e, t) {
  let n = new Set();
  if (
    (t.forEach((a) => {
      for (let s of a.marks) s.type.name === 'comment' && n.add(s.attrs.commentId);
    }),
    n.size === 0)
  )
    return e;
  let o = [],
    r = new Set(),
    i = 0;
  t.forEach((a) => {
    let s = new Set();
    for (let l of a.marks) l.type.name === 'comment' && s.add(l.attrs.commentId);
    for (let l of [...r]) s.has(l) || (o.push({ type: 'commentRangeEnd', id: l }), r.delete(l));
    for (let l of s) r.has(l) || (o.push({ type: 'commentRangeStart', id: l }), r.add(l));
    (i < e.length && o.push(e[i]), i++);
  });
  for (let a of r) o.push({ type: 'commentRangeEnd', id: a });
  return o;
}
function Ih(e) {
  if (e._originalFormatting) {
    let n = e._originalFormatting,
      o = { ...n };
    return (
      e.alignment !== (n.alignment || void 0) && (o.alignment = e.alignment || void 0),
      e.numPr !== n.numPr &&
        JSON.stringify(e.numPr) !== JSON.stringify(n.numPr) &&
        (o.numPr = e.numPr || void 0),
      e.styleId !== (n.styleId || void 0) && (o.styleId = e.styleId || void 0),
      e.pageBreakBefore !== (n.pageBreakBefore || void 0) &&
        (o.pageBreakBefore = e.pageBreakBefore || void 0),
      e.bidi !== (n.bidi || void 0) && (o.bidi = e.bidi || void 0),
      o
    );
  }
  if (
    e.alignment ||
    e.spaceBefore ||
    e.spaceAfter ||
    e.lineSpacing ||
    e.indentLeft ||
    e.indentRight ||
    e.indentFirstLine ||
    e.numPr ||
    e.styleId ||
    e.borders ||
    e.shading ||
    e.tabs ||
    e.outlineLevel != null ||
    e.contextualSpacing ||
    e.bidi
  )
    return {
      alignment: e.alignment || void 0,
      spaceBefore: e.spaceBefore || void 0,
      spaceAfter: e.spaceAfter || void 0,
      lineSpacing: e.lineSpacing || void 0,
      lineSpacingRule: e.lineSpacingRule || void 0,
      indentLeft: e.indentLeft || void 0,
      indentRight: e.indentRight || void 0,
      indentFirstLine: e.indentFirstLine || void 0,
      hangingIndent: e.hangingIndent || void 0,
      numPr: e.numPr || void 0,
      styleId: e.styleId || void 0,
      borders: e.borders || void 0,
      shading: e.shading || void 0,
      tabs: e.tabs || void 0,
      outlineLevel: e.outlineLevel ?? void 0,
      contextualSpacing: e.contextualSpacing || void 0,
      bidi: e.bidi || void 0,
    };
}
function fu(e, t) {
  let n = [],
    o = t ?? mu(e),
    r = null,
    i = null,
    a = null;
  return (
    e.forEach((s) => {
      let l = s.marks.find((p) => p.type.name === 'footnoteRef');
      if (l) {
        (r && (n.push(r), (r = null), (i = null)), a && (n.push(a), (a = null)));
        let f = {
          type: l.attrs.noteType === 'endnote' ? 'endnoteRef' : 'footnoteRef',
          id: parseInt(l.attrs.id, 10) || 0,
        };
        n.push({ type: 'run', content: [f] });
        return;
      }
      let u = s.marks.find((p) => p.type.name === 'insertion'),
        d = s.marks.find((p) => p.type.name === 'deletion');
      if (u || d) {
        (r && (n.push(r), (r = null), (i = null)), a && (n.push(a), (a = null)));
        let p = u || d,
          f = s.marks.filter((v) => v.type.name !== 'insertion' && v.type.name !== 'deletion'),
          m = Us(f),
          b = {
            type: 'run',
            content: s.isText && s.text ? [{ type: 'text', text: s.text }] : [],
            ...(Object.keys(m).length > 0 ? { formatting: m } : {}),
          },
          g = {
            id: p.attrs.revisionId,
            author: p.attrs.author || 'Unknown',
            date: p.attrs.date || void 0,
          },
          x = g.id,
          T = (o.insertionById.get(x) ?? 0) > 0,
          S = (o.deletionById.get(x) ?? 0) > 0,
          B = T && S;
        u
          ? B
            ? n.push({ type: 'moveTo', info: g, content: [b] })
            : n.push({ type: 'insertion', info: g, content: [b] })
          : B
            ? n.push({ type: 'moveFrom', info: g, content: [b] })
            : n.push({ type: 'deletion', info: g, content: [b] });
        return;
      }
      let c = s.marks.find((p) => p.type.name === 'hyperlink');
      if (c) {
        let p = Fh(c),
          f = a?.href || (a?.anchor ? `#${a.anchor}` : '');
        ((a && f === p) || (r && (n.push(r), (r = null), (i = null)), a && n.push(a), (a = Bh(c))),
          uu(a, s));
        return;
      }
      if ((a && (n.push(a), (a = null)), s.isText)) {
        let p = Lh(s.marks);
        r && i === p
          ? Dh(r, s.text || '')
          : (r && n.push(r), (r = gu(s.text || '', s.marks)), (i = p));
      } else
        s.type.name === 'hardBreak'
          ? (r && (n.push(r), (r = null), (i = null)), n.push(Ah()))
          : s.type.name === 'image'
            ? (r && (n.push(r), (r = null), (i = null)), n.push($h(s)))
            : s.type.name === 'shape'
              ? (r && (n.push(r), (r = null), (i = null)), n.push(Wh(s)))
              : s.type.name === 'tab'
                ? (r && (n.push(r), (r = null), (i = null)), n.push(Hh()))
                : s.type.name === 'field'
                  ? (r && (n.push(r), (r = null), (i = null)), n.push(Nh(s, s.marks)))
                  : s.type.name === 'sdt'
                    ? (r && (n.push(r), (r = null), (i = null)), n.push(zh(s)))
                    : s.type.name === 'math' &&
                      (r && (n.push(r), (r = null), (i = null)), n.push(Oh(s)));
    }),
    r && n.push(r),
    a && n.push(a),
    n
  );
}
function mu(e) {
  let t = new Map(),
    n = new Map();
  return (
    e.descendants((o) => {
      let r = o.marks.find((a) => a.type.name === 'insertion'),
        i = o.marks.find((a) => a.type.name === 'deletion');
      if (r) {
        let a = Number(r.attrs.revisionId);
        Number.isFinite(a) && t.set(a, (t.get(a) ?? 0) + 1);
      }
      if (i) {
        let a = Number(i.attrs.revisionId);
        Number.isFinite(a) && n.set(a, (n.get(a) ?? 0) + 1);
      }
    }),
    { insertionById: t, deletionById: n }
  );
}
function Fh(e) {
  return e.attrs.href || '';
}
function Lh(e) {
  let t = e.filter((n) => n.type.name !== 'hyperlink');
  return t.length === 0
    ? ''
    : t
        .map((n) => `${n.type.name}:${JSON.stringify(n.attrs)}`)
        .sort()
        .join('|');
}
function Bh(e) {
  let t = e.attrs.href;
  return t?.startsWith('#')
    ? {
        type: 'hyperlink',
        anchor: t.substring(1),
        tooltip: e.attrs.tooltip || void 0,
        children: [],
      }
    : {
        type: 'hyperlink',
        href: t,
        tooltip: e.attrs.tooltip || void 0,
        rId: e.attrs.rId || void 0,
        children: [],
      };
}
function uu(e, t) {
  if (t.isText && t.text) {
    let n = t.marks.filter((r) => r.type.name !== 'hyperlink'),
      o = gu(t.text, n);
    e.children.push(o);
  }
}
function gu(e, t) {
  let n = Us(t),
    o = { type: 'text', text: e };
  return { type: 'run', formatting: Object.keys(n).length > 0 ? n : void 0, content: [o] };
}
function Dh(e, t) {
  let n = e.content[e.content.length - 1];
  n && n.type === 'text' ? (n.text += t) : e.content.push({ type: 'text', text: t });
}
function Ah() {
  return { type: 'run', content: [{ type: 'break', breakType: 'textWrapping' }] };
}
function Hh() {
  return { type: 'run', content: [{ type: 'tab' }] };
}
function Nh(e, t) {
  let n = e.attrs,
    o = t && t.length > 0 ? Us(t) : void 0,
    r = n.displayText || '';
  if (!r)
    switch (n.fieldType) {
      case 'PAGE':
        r = '1';
        break;
      case 'NUMPAGES':
        r = '1';
        break;
      default:
        r = ' ';
        break;
    }
  let i = {
    type: 'run',
    content: [{ type: 'text', text: r }],
    ...(o && Object.keys(o).length > 0 ? { formatting: o } : {}),
  };
  return n.fieldKind === 'complex'
    ? {
        type: 'complexField',
        instruction: n.instruction,
        fieldType: n.fieldType,
        fieldCode: [],
        fieldResult: [i],
        fldLock: n.fldLock || void 0,
        dirty: n.dirty || void 0,
      }
    : {
        type: 'simpleField',
        instruction: n.instruction,
        fieldType: n.fieldType,
        content: [i],
        fldLock: n.fldLock || void 0,
        dirty: n.dirty || void 0,
      };
}
function Oh(e) {
  let t = e.attrs;
  return {
    type: 'mathEquation',
    display: t.display || 'inline',
    ommlXml: t.ommlXml,
    plainText: t.plainText || void 0,
  };
}
function zh(e) {
  let t = e.attrs,
    n = {
      sdtType: t.sdtType ?? 'richText',
      alias: t.alias ?? void 0,
      tag: t.tag ?? void 0,
      lock: t.lock ?? void 0,
      placeholder: t.placeholder ?? void 0,
      showingPlaceholder: t.showingPlaceholder ?? void 0,
      dateFormat: t.dateFormat ?? void 0,
      listItems: t.listItems ? JSON.parse(t.listItems) : void 0,
      checked: t.checked != null ? t.checked : void 0,
    },
    r = fu(e).filter((i) => i.type === 'run' || i.type === 'hyperlink');
  return { type: 'inlineSdt', properties: n, content: r };
}
function $h(e) {
  let t = e.attrs,
    n = t.wrapType || 'inline',
    o = 914400 / 96,
    r = { type: n };
  (t.distTop !== void 0 && (r.distT = Math.round(t.distTop * o)),
    t.distBottom !== void 0 && (r.distB = Math.round(t.distBottom * o)),
    t.distLeft !== void 0 && (r.distL = Math.round(t.distLeft * o)),
    t.distRight !== void 0 && (r.distR = Math.round(t.distRight * o)),
    t.wrapText && (r.wrapText = t.wrapText));
  let i = {
    type: 'image',
    rId: t.rId || '',
    src: t.src,
    alt: t.alt || void 0,
    title: t.title || void 0,
    size: { width: chunkSE5EN2QL_js.d(t.width || 0), height: chunkSE5EN2QL_js.d(t.height || 0) },
    wrap: r,
  };
  if (t.transform) {
    let s = t.transform,
      l = {},
      u = s.match(/rotate\(([-\d.]+)deg\)/);
    (u && (l.rotation = parseFloat(u[1])),
      s.includes('scaleX(-1)') && (l.flipH = true),
      s.includes('scaleY(-1)') && (l.flipV = true),
      (l.rotation || l.flipH || l.flipV) && (i.transform = l));
  }
  if (t.position?.horizontal && t.position?.vertical) {
    let s = t.position;
    i.position = {
      horizontal: {
        relativeTo: s.horizontal.relativeTo || 'column',
        alignment: s.horizontal.align,
        posOffset: s.horizontal.posOffset,
      },
      vertical: {
        relativeTo: s.vertical.relativeTo || 'paragraph',
        alignment: s.vertical.align,
        posOffset: s.vertical.posOffset,
      },
    };
  }
  if (t.borderWidth && t.borderWidth > 0) {
    let s = {
      solid: 'solid',
      dotted: 'dot',
      dashed: 'dash',
      double: 'solid',
      groove: 'solid',
      ridge: 'solid',
      inset: 'solid',
      outset: 'solid',
    };
    i.outline = {
      width: Math.round(t.borderWidth * (914400 / 96)),
      color: t.borderColor ? { rgb: t.borderColor.replace('#', '') } : void 0,
      style: (t.borderStyle && s[t.borderStyle]) || 'solid',
    };
  }
  return (
    t.hlinkHref && (i.hlinkHref = t.hlinkHref),
    { type: 'run', content: [{ type: 'drawing', image: i }] }
  );
}
function Wh(e) {
  let t = e.attrs,
    n = {
      type: 'shape',
      shapeType: t.shapeType || 'rect',
      id: t.shapeId || void 0,
      size: {
        width: t.width ? Math.round(t.width * (914400 / 96)) : 0,
        height: t.height ? Math.round(t.height * (914400 / 96)) : 0,
      },
    };
  if (t.fillType === 'gradient' && t.gradientStops)
    try {
      let r = JSON.parse(t.gradientStops);
      n.fill = {
        type: 'gradient',
        gradient: {
          type: t.gradientType || 'linear',
          angle: t.gradientAngle || void 0,
          stops: r.map((i) => ({ position: i.position, color: { rgb: i.color.replace('#', '') } })),
        },
      };
    } catch {
      n.fill = { type: 'solid', color: { rgb: (t.fillColor || '000000').replace('#', '') } };
    }
  else
    t.fillColor
      ? (n.fill = { type: t.fillType || 'solid', color: { rgb: t.fillColor.replace('#', '') } })
      : t.fillType === 'none' && (n.fill = { type: 'none' });
  if (t.outlineWidth && t.outlineWidth > 0) {
    let r = { solid: 'solid', dotted: 'dot', dashed: 'dash' };
    n.outline = {
      width: Math.round(t.outlineWidth * (914400 / 96)),
      color: t.outlineColor ? { rgb: t.outlineColor.replace('#', '') } : void 0,
      style: (t.outlineStyle && r[t.outlineStyle]) || 'solid',
    };
  }
  return { type: 'run', content: [{ type: 'shape', shape: n }] };
}
function Us(e) {
  let t = {};
  for (let n of e)
    switch (n.type.name) {
      case 'bold':
        ((t.bold = true), (t.boldCs = true));
        break;
      case 'italic':
        ((t.italic = true), (t.italicCs = true));
        break;
      case 'underline': {
        let o = n.attrs;
        t.underline = { style: o.style || 'single', color: o.color };
        break;
      }
      case 'strike':
        n.attrs.double ? (t.doubleStrike = true) : (t.strike = true);
        break;
      case 'textColor': {
        let o = n.attrs;
        t.color = {
          rgb: o.rgb,
          themeColor: o.themeColor,
          themeTint: o.themeTint,
          themeShade: o.themeShade,
        };
        break;
      }
      case 'highlight':
        t.highlight = n.attrs.color;
        break;
      case 'fontSize':
        ((t.fontSize = n.attrs.size), (t.fontSizeCs = n.attrs.size));
        break;
      case 'fontFamily': {
        let o = n.attrs;
        t.fontFamily = {
          ascii: o.ascii,
          hAnsi: o.hAnsi,
          eastAsia: o.eastAsia || void 0,
          cs: o.cs || o.ascii || void 0,
          asciiTheme: o.asciiTheme,
          hAnsiTheme: o.hAnsiTheme || void 0,
          eastAsiaTheme: o.eastAsiaTheme || void 0,
          csTheme: o.csTheme || void 0,
        };
        break;
      }
      case 'superscript':
        t.vertAlign = 'superscript';
        break;
      case 'subscript':
        t.vertAlign = 'subscript';
        break;
      case 'allCaps':
        t.allCaps = true;
        break;
      case 'smallCaps':
        t.smallCaps = true;
        break;
      case 'characterSpacing': {
        (n.attrs.spacing != null && (t.spacing = n.attrs.spacing),
          n.attrs.position != null && (t.position = n.attrs.position),
          n.attrs.scale != null && (t.scale = n.attrs.scale),
          n.attrs.kerning != null && (t.kerning = n.attrs.kerning));
        break;
      }
      case 'emboss':
        t.emboss = true;
        break;
      case 'imprint':
        t.imprint = true;
        break;
      case 'textShadow':
        t.shadow = true;
        break;
      case 'emphasisMark':
        t.emphasisMark = n.attrs.type || 'dot';
        break;
      case 'textOutline':
        t.outline = true;
        break;
    }
  return t;
}
function _h(e) {
  for (let t of e)
    for (let n of t.cells) {
      let o = n.formatting?.borders;
      if (o) {
        let r = o.top || o.left || o.right || o.bottom || o.insideH || o.insideV;
        return r
          ? {
              top: o.top ?? r,
              bottom: o.bottom ?? r,
              left: o.left ?? r,
              right: o.right ?? r,
              insideH: o.insideH ?? o.bottom ?? r,
              insideV: o.insideV ?? o.right ?? r,
            }
          : void 0;
      }
    }
}
function hu(e, t) {
  let n = e.attrs,
    o = [];
  e.forEach((i) => {
    i.type.name === 'tableRow' && o.push(Uh(i, t));
  });
  let r = Vh(n) || void 0;
  if (!r?.borders) {
    let i = _h(o);
    if (i)
      if (r) r.borders = i;
      else
        return {
          type: 'table',
          columnWidths: n.columnWidths || void 0,
          formatting: { borders: i },
          rows: o,
        };
  }
  return { type: 'table', columnWidths: n.columnWidths || void 0, formatting: r, rows: o };
}
function Vh(e) {
  if (e._originalFormatting) {
    let r = e._originalFormatting,
      i = { ...r };
    (e.styleId !== (r.styleId || void 0) && (i.styleId = e.styleId || void 0),
      e.justification !== (r.justification || void 0) &&
        (i.justification = e.justification || void 0),
      e.floating !== (r.floating || void 0) && (i.floating = e.floating || void 0),
      e.look !== (r.look || void 0) && (i.look = e.look || void 0));
    let a = r.width?.value,
      s = r.width?.type;
    return (
      (e.width !== a || e.widthType !== s) &&
        (e.width != null || e.widthType
          ? (i.width = { value: e.width ?? 0, type: e.widthType || 'dxa' })
          : (i.width = void 0)),
      e.cellMargins &&
        (i.cellMargins = {
          top: e.cellMargins.top != null ? { value: e.cellMargins.top, type: 'dxa' } : void 0,
          bottom:
            e.cellMargins.bottom != null ? { value: e.cellMargins.bottom, type: 'dxa' } : void 0,
          left: e.cellMargins.left != null ? { value: e.cellMargins.left, type: 'dxa' } : void 0,
          right: e.cellMargins.right != null ? { value: e.cellMargins.right, type: 'dxa' } : void 0,
        }),
      i
    );
  }
  if (
    !(
      e.styleId ||
      e.width != null ||
      e.widthType ||
      e.justification ||
      e.floating ||
      e.cellMargins ||
      e.look
    )
  )
    return;
  let n = e.cellMargins
      ? {
          top: e.cellMargins.top != null ? { value: e.cellMargins.top, type: 'dxa' } : void 0,
          bottom:
            e.cellMargins.bottom != null ? { value: e.cellMargins.bottom, type: 'dxa' } : void 0,
          left: e.cellMargins.left != null ? { value: e.cellMargins.left, type: 'dxa' } : void 0,
          right: e.cellMargins.right != null ? { value: e.cellMargins.right, type: 'dxa' } : void 0,
        }
      : void 0,
    o;
  return (
    (e.width != null || e.widthType) && (o = { value: e.width ?? 0, type: e.widthType || 'dxa' }),
    {
      styleId: e.styleId || void 0,
      width: o,
      justification: e.justification || void 0,
      floating: e.floating || void 0,
      cellMargins: n,
      look: e.look || void 0,
    }
  );
}
function Uh(e, t) {
  let n = e.attrs,
    o = [];
  return (
    e.forEach((r) => {
      (r.type.name === 'tableCell' || r.type.name === 'tableHeader') && o.push(Gh(r, t));
    }),
    { type: 'tableRow', formatting: jh(n), cells: o }
  );
}
function jh(e) {
  if (e._originalFormatting) {
    let n = e._originalFormatting,
      o = { ...n };
    return (
      e.height !== (n.height?.value || void 0) &&
        (o.height = e.height ? { value: e.height, type: 'dxa' } : void 0),
      e.heightRule !== (n.heightRule || void 0) && (o.heightRule = e.heightRule || void 0),
      e.isHeader !== (n.header || void 0) && (o.header = e.isHeader || void 0),
      o
    );
  }
  if (e.height || e.isHeader)
    return {
      height: e.height ? { value: e.height, type: 'dxa' } : void 0,
      heightRule: e.heightRule || void 0,
      header: e.isHeader || void 0,
    };
}
function Gh(e, t) {
  let n = e.attrs,
    o = [];
  return (
    e.forEach((r) => {
      r.type.name === 'paragraph' ? o.push(Vs(r, t)) : r.type.name === 'table' && o.push(hu(r, t));
    }),
    { type: 'tableCell', formatting: Kh(n), content: o }
  );
}
function Kh(e) {
  if (e._originalFormatting) {
    let o = e._originalFormatting,
      r = { ...o };
    if (
      (e.colspan > 1 && (r.gridSpan = e.colspan),
      e.width != null && (r.width = { value: e.width, type: e.widthType || 'dxa' }),
      e.verticalAlign !== (o.verticalAlign || void 0) &&
        (r.verticalAlign = e.verticalAlign || void 0),
      e.backgroundColor
        ? (r.shading = { fill: { rgb: e.backgroundColor } })
        : !e.backgroundColor && o.shading && (r.shading = void 0),
      e.borders && (r.borders = e.borders),
      e.margins)
    ) {
      let i = e.margins,
        a = {};
      (i.top != null && (a.top = { value: i.top, type: 'dxa' }),
        i.bottom != null && (a.bottom = { value: i.bottom, type: 'dxa' }),
        i.left != null && (a.left = { value: i.left, type: 'dxa' }),
        i.right != null && (a.right = { value: i.right, type: 'dxa' }),
        (r.margins = a));
    }
    return (
      e.textDirection !== (o.textDirection || void 0) &&
        (r.textDirection = e.textDirection || void 0),
      r
    );
  }
  if (
    !(
      e.colspan > 1 ||
      e.rowspan > 1 ||
      e.width != null ||
      e.verticalAlign ||
      e.backgroundColor ||
      e.borders ||
      e.margins ||
      e.textDirection
    )
  )
    return;
  let n;
  if (e.margins) {
    let o = e.margins;
    ((n = {}),
      o.top != null && (n.top = { value: o.top, type: 'dxa' }),
      o.bottom != null && (n.bottom = { value: o.bottom, type: 'dxa' }),
      o.left != null && (n.left = { value: o.left, type: 'dxa' }),
      o.right != null && (n.right = { value: o.right, type: 'dxa' }));
  }
  return {
    gridSpan: e.colspan > 1 ? e.colspan : void 0,
    width: e.width != null ? { value: e.width, type: e.widthType || 'dxa' } : void 0,
    verticalAlign: e.verticalAlign || void 0,
    textDirection: e.textDirection || void 0,
    shading: e.backgroundColor ? { fill: { rgb: e.backgroundColor } } : void 0,
    borders: e.borders,
    margins: n,
  };
}
function Yh(e) {
  let t = e.attrs,
    n = [];
  e.forEach((a) => {
    a.type.name === 'paragraph' && n.push(Vs(a));
  });
  let o = {
    type: 'shape',
    shapeType: 'rect',
    id: t.textBoxId || void 0,
    size: {
      width: t.width ? Math.round(t.width * (914400 / 96)) : 0,
      height: t.height ? Math.round(t.height * (914400 / 96)) : 0,
    },
    textBody: {
      content: n.length > 0 ? n : [{ type: 'paragraph', content: [] }],
      margins: {
        top: t.marginTop != null ? Math.round(t.marginTop * (914400 / 96)) : void 0,
        bottom: t.marginBottom != null ? Math.round(t.marginBottom * (914400 / 96)) : void 0,
        left: t.marginLeft != null ? Math.round(t.marginLeft * (914400 / 96)) : void 0,
        right: t.marginRight != null ? Math.round(t.marginRight * (914400 / 96)) : void 0,
      },
    },
  };
  if (
    (t.fillColor && (o.fill = { type: 'solid', color: { rgb: t.fillColor.replace('#', '') } }),
    t.outlineWidth && t.outlineWidth > 0)
  ) {
    let a = { solid: 'solid', dotted: 'dot', dashed: 'dash' };
    o.outline = {
      width: Math.round(t.outlineWidth * (914400 / 96)),
      color: t.outlineColor ? { rgb: t.outlineColor.replace('#', '') } : void 0,
      style: (t.outlineStyle && a[t.outlineStyle]) || 'solid',
    };
  }
  return { type: 'paragraph', content: [{ type: 'run', content: [{ type: 'shape', shape: o }] }] };
}
function kr(e) {
  return pu(e);
}
function Ko(e) {
  let { selection: t, doc: n } = e,
    { from: o, to: r, empty: i } = t,
    a = n.resolve(o),
    s = 0,
    l = 0;
  n.forEach((g, x, T) => {
    (x <= o && (s = T), x <= r && (l = T));
  });
  let u = {},
    d = a.parent,
    c = d.type.name === 'paragraph' && d.textContent.length === 0,
    p = d.attrs?.defaultTextFormatting,
    f = e.storedMarks || t.$from.marks();
  c && f.length === 0 && p && (u = { ...p });
  for (let g of f)
    switch (g.type.name) {
      case 'bold':
        u.bold = true;
        break;
      case 'italic':
        u.italic = true;
        break;
      case 'underline':
        u.underline = { style: g.attrs.style || 'single', color: g.attrs.color };
        break;
      case 'strike':
        g.attrs.double ? (u.doubleStrike = true) : (u.strike = true);
        break;
      case 'textColor':
        u.color = { rgb: g.attrs.rgb, themeColor: g.attrs.themeColor };
        break;
      case 'highlight':
        u.highlight = g.attrs.color;
        break;
      case 'fontSize':
        u.fontSize = g.attrs.size;
        break;
      case 'fontFamily':
        u.fontFamily = { ascii: g.attrs.ascii, hAnsi: g.attrs.hAnsi };
        break;
      case 'superscript':
        u.vertAlign = 'superscript';
        break;
      case 'subscript':
        u.vertAlign = 'subscript';
        break;
    }
  let m = {},
    b = null;
  return (
    d.type.name === 'paragraph' &&
      (d.attrs.alignment && (m.alignment = d.attrs.alignment),
      d.attrs.lineSpacing &&
        ((m.lineSpacing = d.attrs.lineSpacing), (m.lineSpacingRule = d.attrs.lineSpacingRule)),
      d.attrs.numPr && (m.numPr = d.attrs.numPr),
      d.attrs.indentLeft && (m.indentLeft = d.attrs.indentLeft),
      d.attrs.indentRight && (m.indentRight = d.attrs.indentRight),
      d.attrs.indentFirstLine && (m.indentFirstLine = d.attrs.indentFirstLine),
      d.attrs.hangingIndent && (m.hangingIndent = d.attrs.hangingIndent),
      d.attrs.tabs && (m.tabs = d.attrs.tabs),
      d.attrs.bidi && (m.bidi = true),
      d.attrs.styleId && (b = d.attrs.styleId)),
    {
      hasSelection: !i,
      isMultiParagraph: s !== l,
      textFormatting: u,
      paragraphFormatting: m,
      styleId: b,
      startParagraphIndex: s,
      endParagraphIndex: l,
    }
  );
}
var It = Mn.getCommands(),
  Ti = It.toggleBold(),
  wi = It.toggleItalic(),
  Ci = It.toggleUnderline(),
  vi = It.toggleStrike(),
  Ri = It.toggleSuperscript(),
  Ei = It.toggleSubscript();
function Tr(e) {
  return It.setTextColor(e);
}
var Pi = It.clearTextColor();
function Mi(e) {
  return It.setHighlight(e);
}
It.clearHighlight();
function Ii(e) {
  return It.setFontSize(e);
}
It.clearFontSize();
function Fi(e) {
  return It.setFontFamily(e);
}
It.clearFontFamily();
function Li(e, t) {
  return It.setHyperlink(e, t);
}
var Bi = It.removeHyperlink();
function wr(e, t, n) {
  return It.insertHyperlink(e, t, n);
}
var st = Mn.getCommands();
function Di(e) {
  return st.setAlignment(e);
}
st.alignLeft();
st.alignCenter();
st.alignRight();
st.alignJustify();
function Ai(e, t = 'auto') {
  return st.setLineSpacing(e, t);
}
st.singleSpacing();
st.oneAndHalfSpacing();
st.doubleSpacing();
function Hi(e = 720) {
  return st.increaseIndent(e);
}
function Ni(e = 720) {
  return st.decreaseIndent(e);
}
function Oi(e) {
  return st.setIndentLeft(e);
}
function zi(e) {
  return st.setIndentRight(e);
}
function Cr(e, t) {
  return st.setIndentFirstLine(e, t);
}
var $i = st.toggleBulletList(),
  Wi = st.toggleNumberedList(),
  _i = st.increaseListLevel(),
  Vi = st.decreaseListLevel();
st.removeList();
function vr(e, t) {
  return st.applyStyle(e, t);
}
st.clearStyle();
st.removeSectionBreak();
function Ui(e) {
  return st.removeTabStop(e);
}
var ji = st.setRtl(),
  Gi = st.setLtr(),
  Ki = st.generateTOC();
var ot = Mn.getCommands();
function Yi(e, t) {
  return ot.insertTable(e, t);
}
function Rr(e, t) {
  return ot.addRowAbove()(e, t);
}
function yo(e, t) {
  return ot.addRowBelow()(e, t);
}
function Er(e, t) {
  return ot.deleteRow()(e, t);
}
function Pr(e, t) {
  return ot.addColumnLeft()(e, t);
}
function xo(e, t) {
  return ot.addColumnRight()(e, t);
}
function Mr(e, t) {
  return ot.deleteColumn()(e, t);
}
function Ir(e, t) {
  return ot.deleteTable()(e, t);
}
function qi(e, t) {
  return ot.selectTable()(e, t);
}
function Xi(e, t) {
  return ot.selectRow()(e, t);
}
function Zi(e, t) {
  return ot.selectColumn()(e, t);
}
function Ji(e, t) {
  return ot.mergeCells()(e, t);
}
function Qi(e, t) {
  return ot.splitCell()(e, t);
}
function Un(e, t, n) {
  return ot.setCellBorder(e, t, n);
}
function ea(e, t) {
  return ot.removeTableBorders()(e, t);
}
function ta(e, t, n) {
  return ot.setAllTableBorders(n)(e, t);
}
function na(e, t, n) {
  return ot.setOutsideTableBorders(n)(e, t);
}
function oa(e, t, n) {
  return ot.setInsideTableBorders(n)(e, t);
}
function ra(e) {
  return ot.setCellVerticalAlign(e);
}
function ia(e) {
  return ot.setCellMargins(e);
}
function aa(e) {
  return ot.setCellTextDirection(e);
}
function sa() {
  return ot.toggleNoWrap();
}
function la(e, t) {
  return ot.setRowHeight(e, t);
}
function ca() {
  return ot.toggleHeaderRow();
}
function da() {
  return ot.distributeColumns();
}
function ua() {
  return ot.autoFitContents();
}
function Fr(e) {
  return ot.setTableProperties(e);
}
function pa(e) {
  return ot.applyTableStyle(e);
}
function fa(e) {
  return ot.setCellFillColor(e);
}
function ma(e) {
  return ot.setTableBorderColor(e);
}
function ga(e) {
  return ot.setTableBorderWidth(e);
}
var ha = (e, t) => {
  let { schema: n } = e,
    o = n.nodes.pageBreak,
    r = n.nodes.paragraph;
  if (!o || !r) return false;
  if (t) {
    let { $from: i } = e.selection,
      a = e.tr,
      s = o.create(),
      l = s.nodeSize,
      u;
    if (i.parent.isTextblock)
      if (i.parentOffset > 0 && i.parentOffset < i.parent.content.size) {
        a.split(i.pos);
        let d = a.mapping.map(i.pos);
        (a.insert(d, prosemirrorModel.Fragment.from([s, r.create()])), (u = d + l + 1));
      } else if (i.parentOffset === i.parent.content.size) {
        let d = i.after();
        (a.insert(d, prosemirrorModel.Fragment.from([s, r.create()])), (u = d + l + 1));
      } else {
        let d = i.before();
        (a.insert(d, s), (u = d + l + 1));
      }
    else {
      let d = i.pos;
      (a.insert(d, prosemirrorModel.Fragment.from([s, r.create()])), (u = d + l + 1));
    }
    (a.setSelection(prosemirrorState.TextSelection.create(a.doc, u)), t(a.scrollIntoView()));
  }
  return true;
};
function Bu(e, t, n) {
  return (o, r) => {
    let i = o.schema.marks.insertion,
      a = o.schema.marks.deletion;
    if (!i && !a) return false;
    let s = n === 'accept' ? i : a,
      l = n === 'accept' ? a : i;
    if (r) {
      let u = o.tr,
        d = [];
      o.doc.nodesBetween(e, t, (c, p) => {
        if (!c.isText) return;
        let f = p + c.nodeSize,
          m = Math.max(e, p),
          b = Math.min(t, f);
        (l && c.marks.some((g) => g.type === l) && d.push({ from: m, to: b }),
          s && c.marks.some((g) => g.type === s) && u.removeMark(m, b, s));
      });
      for (let c of d.reverse()) u.delete(c.from, c.to);
      u.steps.length > 0 && r(u);
    }
    return true;
  };
}
function Gs(e, t) {
  return Bu(e, t, 'accept');
}
function Ks(e, t) {
  return Bu(e, t, 'reject');
}
var Au = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '2px 0',
    fontSize: 11,
    color: '#4285f4',
    userSelect: 'none',
  },
  Hu = { fontWeight: 500, letterSpacing: 0.3 },
  pb = {
    background: 'none',
    border: 'none',
    color: '#4285f4',
    cursor: 'pointer',
    fontSize: 11,
    padding: '2px 6px',
    borderRadius: 3,
  },
  fb = {
    position: 'absolute',
    right: 0,
    top: '100%',
    background: 'white',
    border: '1px solid #dadce0',
    borderRadius: 4,
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    zIndex: 100,
    minWidth: 160,
    padding: '4px 0',
  },
  ba = {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    border: 'none',
    background: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    color: '#3c4043',
  },
  Ou = uf.forwardRef(function (
    {
      headerFooter: t,
      position: n,
      styles: o,
      targetElement: r,
      parentElement: i,
      onSave: a,
      onClose: s,
      onSelectionChange: l,
      onRemove: u,
    },
    d
  ) {
    let c = uf.useRef(null),
      p = uf.useRef(null),
      [f, m] = uf.useState(false),
      [b, g] = uf.useState(false),
      x = uf.useRef(null),
      [T, S] = uf.useState(null);
    (uf.useLayoutEffect(() => {
      let ee = () => {
        let N = i.getBoundingClientRect(),
          ne = r.getBoundingClientRect();
        S({
          top: ne.top - N.top + i.scrollTop,
          left: ne.left - N.left + i.scrollLeft,
          width: ne.width,
        });
      };
      ee();
      let O = i.closest('[style*="overflow"]') || i;
      return (
        O.addEventListener('scroll', ee),
        window.addEventListener('resize', ee),
        () => {
          (O.removeEventListener('scroll', ee), window.removeEventListener('resize', ee));
        }
      );
    }, [r, i]),
      uf.useEffect(() => {
        if (!c.current || p.current) return;
        let ee = _s(t.content, { styles: o || void 0 }),
          O = new Vn(Go());
        (O.buildSchema(), O.initializeRuntime());
        let N = O.getPlugins(),
          ne = prosemirrorState.EditorState.create({ doc: ee, schema: we, plugins: N }),
          ce = new prosemirrorView.EditorView(c.current, {
            state: ne,
            dispatchTransaction(D) {
              let z = ce.state.apply(D);
              if ((ce.updateState(z), D.docChanged && m(true), D.selectionSet || D.docChanged)) {
                let ae = Ko(z);
                l?.(ae);
              }
            },
          });
        return (
          (p.current = ce),
          requestAnimationFrame(() => {
            ce.focus();
            let D = Ko(ce.state);
            l?.(D);
          }),
          () => {
            (ce.destroy(), (p.current = null));
          }
        );
      }, [T]));
    let B = uf.useCallback(() => {
        if (!p.current) return;
        let ee = kr(p.current.state.doc);
        a(ee);
      }, [a]),
      v = uf.useCallback(() => {
        f ? B() : s();
      }, [f, B, s]);
    (uf.useEffect(() => {
      function ee(O) {
        O.key === 'Escape' && (O.preventDefault(), O.stopPropagation(), v());
      }
      return (
        document.addEventListener('keydown', ee, true),
        () => document.removeEventListener('keydown', ee, true)
      );
    }, [v]),
      uf.useEffect(() => {
        if (!b) return;
        function ee(O) {
          x.current && !x.current.contains(O.target) && g(false);
        }
        return (
          document.addEventListener('mousedown', ee),
          () => document.removeEventListener('mousedown', ee)
        );
      }, [b]),
      uf.useImperativeHandle(d, () => ({
        getView: () => p.current,
        focus: () => p.current?.focus(),
        undo: () => {
          let ee = p.current;
          return ee ? prosemirrorHistory.undo(ee.state, ee.dispatch) : false;
        },
        redo: () => {
          let ee = p.current;
          return ee ? prosemirrorHistory.redo(ee.state, ee.dispatch) : false;
        },
      })));
    let M = n === 'header' ? 'Header' : 'Footer';
    if (!T) return null;
    let U = { position: 'absolute', top: T.top, left: T.left, width: T.width, zIndex: 10 };
    return jsxRuntime.jsxs('div', {
      className: 'hf-inline-editor',
      style: U,
      onMouseDown: (ee) => {
        ee.stopPropagation();
      },
      children: [
        n === 'footer' &&
          jsxRuntime.jsxs('div', {
            className: 'hf-separator-bar',
            style: Au,
            children: [
              jsxRuntime.jsx('span', { style: Hu, children: M }),
              jsxRuntime.jsx(Nu, {
                label: M,
                showOptions: b,
                setShowOptions: g,
                optionsRef: x,
                onRemove: u,
                onClose: v,
                viewRef: p,
              }),
            ],
          }),
        jsxRuntime.jsx('div', {
          ref: c,
          className: 'hf-editor-pm',
          style: { minHeight: 40, outline: 'none' },
        }),
        n === 'header' &&
          jsxRuntime.jsxs('div', {
            className: 'hf-separator-bar',
            style: Au,
            children: [
              jsxRuntime.jsx('span', { style: Hu, children: M }),
              jsxRuntime.jsx(Nu, {
                label: M,
                showOptions: b,
                setShowOptions: g,
                optionsRef: x,
                onRemove: u,
                onClose: v,
                viewRef: p,
              }),
            ],
          }),
      ],
    });
  });
function Nu({
  label: e,
  showOptions: t,
  setShowOptions: n,
  optionsRef: o,
  onRemove: r,
  onClose: i,
  viewRef: a,
}) {
  let s = (l) => {
    let u = a.current;
    if (!u) return;
    let { $from: d, from: c } = u.state.selection,
      p = u.state.storedMarks || d.marks(),
      f = we.nodes.field.create({
        fieldType: l,
        instruction: ` ${l} \\* MERGEFORMAT `,
        fieldKind: 'simple',
        dirty: true,
      }),
      m = u.state.tr.insert(c, f.mark(p));
    (u.dispatch(m), u.focus());
  };
  return jsxRuntime.jsxs('div', {
    style: { position: 'relative' },
    ref: o,
    children: [
      jsxRuntime.jsx('button', {
        type: 'button',
        style: pb,
        onClick: (l) => {
          (l.stopPropagation(), n((u) => !u));
        },
        onMouseDown: (l) => l.stopPropagation(),
        children: 'Options \u25BE',
      }),
      t &&
        jsxRuntime.jsxs('div', {
          style: fb,
          children: [
            jsxRuntime.jsx('button', {
              type: 'button',
              style: ba,
              onClick: () => {
                (n(false), s('PAGE'));
              },
              onMouseOver: (l) => {
                l.target.style.backgroundColor = '#f1f3f4';
              },
              onMouseOut: (l) => {
                l.target.style.backgroundColor = 'transparent';
              },
              children: 'Insert current page number',
            }),
            jsxRuntime.jsx('button', {
              type: 'button',
              style: ba,
              onClick: () => {
                (n(false), s('NUMPAGES'));
              },
              onMouseOver: (l) => {
                l.target.style.backgroundColor = '#f1f3f4';
              },
              onMouseOut: (l) => {
                l.target.style.backgroundColor = 'transparent';
              },
              children: 'Insert total page count',
            }),
            jsxRuntime.jsx('div', { style: { borderTop: '1px solid #e8eaed', margin: '4px 0' } }),
            r &&
              jsxRuntime.jsxs('button', {
                type: 'button',
                style: ba,
                onClick: () => {
                  (n(false), r());
                },
                onMouseOver: (l) => {
                  l.target.style.backgroundColor = '#f1f3f4';
                },
                onMouseOut: (l) => {
                  l.target.style.backgroundColor = 'transparent';
                },
                children: ['Remove ', e.toLowerCase()],
              }),
            jsxRuntime.jsxs('button', {
              type: 'button',
              style: ba,
              onClick: () => {
                (n(false), i());
              },
              onMouseOver: (l) => {
                l.target.style.backgroundColor = '#f1f3f4';
              },
              onMouseOut: (l) => {
                l.target.style.backgroundColor = 'transparent';
              },
              children: ['Close ', e.toLowerCase(), ' editing'],
            }),
          ],
        }),
    ],
  });
}
var _u = {
    position: 'fixed',
    zIndex: 1e4,
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08)',
    border: '1px solid #dadce0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
  },
  gb = {
    ..._u,
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    maxWidth: '400px',
  },
  hb = { ..._u, padding: '12px', width: '320px' },
  Js = {
    width: '20px',
    height: '20px',
    flexShrink: 0,
    color: '#5f6368',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bb = {
    color: '#1a73e8',
    textDecoration: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '220px',
    fontSize: '14px',
    lineHeight: '20px',
    cursor: 'pointer',
  },
  yb = {
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#5f6368',
    padding: 0,
    flexShrink: 0,
  },
  xb = { width: '1px', height: '20px', background: '#dadce0', flexShrink: 0 },
  $u = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  Wu = {
    flex: 1,
    padding: '6px 8px',
    border: '1px solid #dadce0',
    borderRadius: '4px',
    fontSize: '14px',
    outline: 'none',
    lineHeight: '20px',
  },
  Sb = {
    color: '#1a73e8',
    fontWeight: 600,
    fontSize: '14px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    padding: '6px 12px',
    borderRadius: '4px',
    flexShrink: 0,
  },
  Yo = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
function kb() {
  return jsxRuntime.jsxs('svg', {
    ...Yo,
    children: [
      jsxRuntime.jsx('circle', { cx: '12', cy: '12', r: '10' }),
      jsxRuntime.jsx('path', { d: 'M2 12h20' }),
      jsxRuntime.jsx('path', {
        d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
      }),
    ],
  });
}
function Tb() {
  return jsxRuntime.jsxs('svg', {
    ...Yo,
    children: [
      jsxRuntime.jsx('rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }),
      jsxRuntime.jsx('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
    ],
  });
}
function wb() {
  return jsxRuntime.jsx('svg', {
    ...Yo,
    children: jsxRuntime.jsx('path', {
      d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
    }),
  });
}
function Cb() {
  return jsxRuntime.jsxs('svg', {
    ...Yo,
    children: [
      jsxRuntime.jsx('path', {
        d: 'M18.84 12.25l1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71',
      }),
      jsxRuntime.jsx('path', {
        d: 'M5.17 11.75l-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71',
      }),
      jsxRuntime.jsx('line', { x1: '8', y1: '2', x2: '8', y2: '5' }),
      jsxRuntime.jsx('line', { x1: '2', y1: '8', x2: '5', y2: '8' }),
      jsxRuntime.jsx('line', { x1: '16', y1: '19', x2: '16', y2: '22' }),
      jsxRuntime.jsx('line', { x1: '19', y1: '16', x2: '22', y2: '16' }),
    ],
  });
}
function vb() {
  return jsxRuntime.jsxs('svg', {
    ...Yo,
    children: [
      jsxRuntime.jsx('line', { x1: '4', y1: '9', x2: '20', y2: '9' }),
      jsxRuntime.jsx('line', { x1: '4', y1: '15', x2: '20', y2: '15' }),
      jsxRuntime.jsx('line', { x1: '10', y1: '3', x2: '8', y2: '21' }),
      jsxRuntime.jsx('line', { x1: '16', y1: '3', x2: '14', y2: '21' }),
    ],
  });
}
function Rb() {
  return jsxRuntime.jsxs('svg', {
    ...Yo,
    children: [
      jsxRuntime.jsx('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
      jsxRuntime.jsx('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
    ],
  });
}
function Qs({ title: e, onClick: t, children: n }) {
  return jsxRuntime.jsx('button', {
    type: 'button',
    className: 'ep-hyperlink-popup__icon-btn',
    style: yb,
    title: e,
    onClick: t,
    children: n,
  });
}
function Vu({
  data: e,
  onNavigate: t,
  onCopy: n,
  onEdit: o,
  onRemove: r,
  onClose: i,
  readOnly: a,
}) {
  let [s, l] = uf.useState('view'),
    [u, d] = uf.useState(''),
    [c, p] = uf.useState(''),
    f = uf.useRef(null),
    m = uf.useRef(null);
  (uf.useEffect(() => {
    e && (l('view'), d(e.displayText), p(e.href));
  }, [e]),
    uf.useEffect(() => {
      s === 'edit' &&
        requestAnimationFrame(() => {
          (m.current?.focus(), m.current?.select());
        });
    }, [s]),
    uf.useEffect(() => {
      if (!e) return;
      let M = false,
        U = (O) => {
          f.current && !f.current.contains(O.target) && i();
        },
        ee = setTimeout(() => {
          M || document.addEventListener('mousedown', U);
        }, 0);
      return () => {
        ((M = true), clearTimeout(ee), document.removeEventListener('mousedown', U));
      };
    }, [e, i]),
    uf.useEffect(() => {
      if (!e) return;
      let M = (U) => {
        U.key === 'Escape' && (s === 'edit' ? l('view') : i());
      };
      return (
        document.addEventListener('keydown', M),
        () => document.removeEventListener('keydown', M)
      );
    }, [e, s, i]));
  let b = uf.useCallback(() => {
      e && (n(e.href), sonner.toast('Link copied to clipboard'));
    }, [e, n]),
    g = uf.useCallback(() => {
      e && (d(e.displayText), p(e.href), l('edit'));
    }, [e]),
    x = uf.useCallback(() => {
      let M = c.trim();
      M && o(u.trim() || M, M);
    }, [u, c, o]),
    T = uf.useCallback(
      (M) => {
        M.key === 'Enter' && (M.preventDefault(), x());
      },
      [x]
    );
  if (!e) return null;
  let { anchorRect: S } = e,
    B = S.bottom + 4,
    v = S.left;
  return s === 'edit'
    ? jsxRuntime.jsxs('div', {
        ref: f,
        className: 'ep-hyperlink-popup ep-hyperlink-popup--edit',
        style: { ...hb, top: B, left: v },
        onMouseDown: (M) => M.stopPropagation(),
        children: [
          jsxRuntime.jsxs('div', {
            style: $u,
            children: [
              jsxRuntime.jsx('span', { style: Js, children: jsxRuntime.jsx(vb, {}) }),
              jsxRuntime.jsx('input', {
                ref: m,
                type: 'text',
                style: Wu,
                value: u,
                onChange: (M) => d(M.target.value),
                onKeyDown: T,
                placeholder: 'Display text',
                onFocus: (M) => (M.target.style.borderColor = '#1a73e8'),
                onBlur: (M) => (M.target.style.borderColor = '#dadce0'),
              }),
            ],
          }),
          jsxRuntime.jsxs('div', {
            style: { ...$u, marginBottom: 0 },
            children: [
              jsxRuntime.jsx('span', { style: Js, children: jsxRuntime.jsx(Rb, {}) }),
              jsxRuntime.jsx('input', {
                type: 'text',
                style: Wu,
                value: c,
                onChange: (M) => p(M.target.value),
                onKeyDown: T,
                placeholder: 'https://example.com',
                onFocus: (M) => (M.target.style.borderColor = '#1a73e8'),
                onBlur: (M) => (M.target.style.borderColor = '#dadce0'),
              }),
              jsxRuntime.jsx('button', {
                type: 'button',
                style: {
                  ...Sb,
                  opacity: c.trim() ? 1 : 0.5,
                  cursor: c.trim() ? 'pointer' : 'default',
                },
                onClick: x,
                disabled: !c.trim(),
                children: 'Apply',
              }),
            ],
          }),
        ],
      })
    : jsxRuntime.jsxs('div', {
        ref: f,
        className: 'ep-hyperlink-popup',
        style: { ...gb, top: B, left: v },
        onMouseDown: (M) => M.stopPropagation(),
        children: [
          jsxRuntime.jsx('span', { style: Js, children: jsxRuntime.jsx(kb, {}) }),
          jsxRuntime.jsx('a', {
            href: e.href,
            style: bb,
            title: e.href,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: (M) => {
              (M.preventDefault(), t(e.href));
            },
            children: e.href,
          }),
          jsxRuntime.jsx('span', { style: xb }),
          jsxRuntime.jsx(Qs, { title: 'Copy link', onClick: b, children: jsxRuntime.jsx(Tb, {}) }),
          !a &&
            jsxRuntime.jsxs(jsxRuntime.Fragment, {
              children: [
                jsxRuntime.jsx(Qs, {
                  title: 'Edit link',
                  onClick: g,
                  children: jsxRuntime.jsx(wb, {}),
                }),
                jsxRuntime.jsx(Qs, {
                  title: 'Remove link',
                  onClick: r,
                  children: jsxRuntime.jsx(Cb, {}),
                }),
              ],
            }),
        ],
      });
}
var Me = (e) => ({ style: 'single', size: 4, color: { rgb: e } }),
  Pb = [
    {
      id: 'TableNormal',
      name: 'Normal Table',
      look: { firstRow: false, lastRow: false, noHBand: true, noVBand: true },
    },
    {
      id: 'TableGrid',
      name: 'Table Grid',
      tableBorders: {
        top: Me('000000'),
        bottom: Me('000000'),
        left: Me('000000'),
        right: Me('000000'),
        insideH: Me('000000'),
        insideV: Me('000000'),
      },
      look: { firstRow: false, lastRow: false, noHBand: true, noVBand: true },
    },
    {
      id: 'TableGridLight',
      name: 'Grid Table Light',
      tableBorders: {
        top: Me('BFBFBF'),
        bottom: Me('BFBFBF'),
        left: Me('BFBFBF'),
        right: Me('BFBFBF'),
        insideH: Me('BFBFBF'),
        insideV: Me('BFBFBF'),
      },
      look: { firstRow: true, lastRow: false, noHBand: true, noVBand: true },
      conditionals: { firstRow: { bold: true, borders: { bottom: Me('000000') } } },
    },
    {
      id: 'PlainTable1',
      name: 'Plain Table 1',
      tableBorders: { top: Me('BFBFBF'), bottom: Me('BFBFBF'), insideH: Me('BFBFBF') },
      look: { firstRow: true, lastRow: false, noHBand: true, noVBand: true },
      conditionals: { firstRow: { bold: true } },
    },
    {
      id: 'PlainTable2',
      name: 'Plain Table 2',
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, borders: { bottom: Me('7F7F7F') } },
        band1Horz: { backgroundColor: '#F2F2F2' },
      },
    },
    {
      id: 'PlainTable3',
      name: 'Plain Table 3',
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#A5A5A5' },
        band1Horz: { backgroundColor: '#E7E7E7' },
      },
    },
    {
      id: 'PlainTable4',
      name: 'Plain Table 4',
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#000000' },
        band1Horz: { backgroundColor: '#F2F2F2' },
      },
    },
    {
      id: 'GridTable1Light-Accent1',
      name: 'Grid Table 1 Light',
      tableBorders: {
        top: Me('B4C6E7'),
        bottom: Me('B4C6E7'),
        left: Me('B4C6E7'),
        right: Me('B4C6E7'),
        insideH: Me('B4C6E7'),
        insideV: Me('B4C6E7'),
      },
      look: { firstRow: true, lastRow: false, noHBand: true, noVBand: true },
      conditionals: { firstRow: { bold: true, borders: { bottom: Me('4472C4') } } },
    },
    {
      id: 'GridTable4-Accent1',
      name: 'Grid Table 4 Accent 1',
      tableBorders: {
        top: Me('4472C4'),
        bottom: Me('4472C4'),
        left: Me('4472C4'),
        right: Me('4472C4'),
        insideH: Me('4472C4'),
        insideV: Me('4472C4'),
      },
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#4472C4' },
        band1Horz: { backgroundColor: '#D6E4F0' },
      },
    },
    {
      id: 'GridTable5Dark-Accent1',
      name: 'Grid Table 5 Dark',
      tableBorders: {
        top: Me('FFFFFF'),
        bottom: Me('FFFFFF'),
        left: Me('FFFFFF'),
        right: Me('FFFFFF'),
        insideH: Me('FFFFFF'),
        insideV: Me('FFFFFF'),
      },
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#4472C4' },
        band1Horz: { backgroundColor: '#D6E4F0' },
        band2Horz: { backgroundColor: '#B4C6E7' },
      },
    },
    {
      id: 'ListTable3-Accent2',
      name: 'List Table 3 Accent 2',
      tableBorders: { top: Me('ED7D31'), bottom: Me('ED7D31') },
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#ED7D31' },
        band1Horz: { backgroundColor: '#FBE4D5' },
      },
    },
    {
      id: 'ListTable4-Accent3',
      name: 'List Table 4 Accent 3',
      tableBorders: { top: Me('A5A5A5'), bottom: Me('A5A5A5'), insideH: Me('A5A5A5') },
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#A5A5A5' },
        band1Horz: { backgroundColor: '#EDEDED' },
      },
    },
    {
      id: 'GridTable4-Accent5',
      name: 'Grid Table 4 Accent 5',
      tableBorders: {
        top: Me('5B9BD5'),
        bottom: Me('5B9BD5'),
        left: Me('5B9BD5'),
        right: Me('5B9BD5'),
        insideH: Me('5B9BD5'),
        insideV: Me('5B9BD5'),
      },
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#5B9BD5' },
        band1Horz: { backgroundColor: '#DEEAF6' },
      },
    },
    {
      id: 'GridTable4-Accent6',
      name: 'Grid Table 4 Accent 6',
      tableBorders: {
        top: Me('70AD47'),
        bottom: Me('70AD47'),
        left: Me('70AD47'),
        right: Me('70AD47'),
        insideH: Me('70AD47'),
        insideV: Me('70AD47'),
      },
      look: { firstRow: true, lastRow: false, noHBand: false, noVBand: true },
      conditionals: {
        firstRow: { bold: true, color: '#FFFFFF', backgroundColor: '#70AD47' },
        band1Horz: { backgroundColor: '#E2EFDA' },
      },
    },
  ];
function Uu(e) {
  return Pb.find((t) => t.id === e);
}
function ju() {
  return jsxRuntime.jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '20px',
      color: 'var(--doc-text-muted)',
    },
    children: [
      jsxRuntime.jsx('div', {
        style: {
          width: '36px',
          height: '36px',
          border: '3px solid var(--doc-border)',
          borderTopColor: 'var(--doc-primary)',
          borderRadius: '50%',
          animation: 'docx-spin 0.8s linear infinite',
        },
      }),
      jsxRuntime.jsx('style', {
        children: `
          @keyframes docx-spin {
            to { transform: rotate(360deg); }
          }
        `,
      }),
      jsxRuntime.jsx('div', { style: { fontSize: '14px' }, children: 'Loading document...' }),
    ],
  });
}
function Gu() {
  return jsxRuntime.jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'var(--doc-text-placeholder)',
    },
    children: [
      jsxRuntime.jsxs('svg', {
        width: '64',
        height: '64',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        children: [
          jsxRuntime.jsx('path', {
            d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
          }),
          jsxRuntime.jsx('polyline', { points: '14 2 14 8 20 8' }),
        ],
      }),
      jsxRuntime.jsx('div', { style: { marginTop: '16px' }, children: 'No document loaded' }),
    ],
  });
}
function Ku({ message: e }) {
  return jsxRuntime.jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '20px',
      textAlign: 'center',
    },
    children: [
      jsxRuntime.jsx('div', {
        style: { color: 'var(--doc-error)', marginBottom: '16px' },
        children: jsxRuntime.jsxs('svg', {
          width: '48',
          height: '48',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          children: [
            jsxRuntime.jsx('circle', { cx: '12', cy: '12', r: '10' }),
            jsxRuntime.jsx('path', { d: 'M12 8v4M12 16v.01' }),
          ],
        }),
      }),
      jsxRuntime.jsx('h3', {
        style: { color: 'var(--doc-error)', marginBottom: '8px' },
        children: 'Failed to Load Document',
      }),
      jsxRuntime.jsx('p', {
        style: { color: 'var(--doc-text-muted)', maxWidth: '400px' },
        children: e,
      }),
    ],
  });
}
function Yu(e, t) {
  let n = [],
    o = 0;
  return (
    e.forEach((r) => {
      let i = t[o],
        a = r.toJSON();
      ((!i || JSON.stringify(a) !== JSON.stringify(i)) &&
        n.push({
          index: o,
          nodeJSON: a,
          baseText: i ? (i.content?.map((s) => s.text || '').join('') ?? '') : '',
        }),
        o++);
    }),
    n
  );
}
function qu(e, t) {
  let n = e.tr,
    o = 0,
    r = new Set(['paragraph']);
  for (let i of t) {
    if (!r.has(i.nodeJSON.type)) {
      console.log('[mergeDoc] skipping complex node at index', i.index, ':', i.nodeJSON.type);
      continue;
    }
    let a = false,
      s = 0;
    e.doc.forEach((l, u) => {
      if (a) return;
      let d = s === i.index,
        c = i.baseText && l.textContent === i.baseText;
      if (d || c)
        try {
          let p = e.schema.nodeFromJSON(i.nodeJSON);
          if (p.type.name === l.type.name) {
            let f = n.mapping.map(u),
              m = n.mapping.map(u + l.nodeSize);
            (n.replaceWith(f, m, p), (a = !0), o++);
          }
        } catch (p) {
          console.warn('[mergeDoc] failed to restore paragraph', i.index, p);
        }
      s++;
    });
  }
  return { tr: n, replacements: o };
}
function ko(e) {
  let t = [];
  return (
    e.forEach((n) => {
      t.push(n.toJSON());
    }),
    t
  );
}
function Xu(e, t) {
  if (!t) return false;
  let n = 0,
    o = false;
  return (
    e.forEach((r) => {
      if (o) return;
      let i = t[n];
      ((!i || JSON.stringify(r.toJSON()) !== JSON.stringify(i)) && (o = true), n++);
    }),
    o
  );
}
function Ib(e, t) {
  return JSON.stringify(e) === JSON.stringify(t);
}
function Fb(e, t = {}) {
  let {
      maxEntries: n = 100,
      groupingInterval: o = 500,
      enableKeyboardShortcuts: r = true,
      isEqual: i = Ib,
      onUndo: a,
      onRedo: s,
      containerRef: l,
    } = t,
    [u, d] = uf.useState(e),
    [c, p] = uf.useState([]),
    [f, m] = uf.useState([]),
    b = uf.useRef(0),
    g = uf.useRef(false),
    x = uf.useCallback(
      (O, N) => {
        if (i(u, O)) return;
        if (g.current) {
          d(O);
          return;
        }
        let ne = Date.now();
        (ne - b.current < o && c.length > 0
          ? p((D) => {
              let z = [...D];
              return (
                (z[z.length - 1] = {
                  state: u,
                  timestamp: ne,
                  description: N || z[z.length - 1].description,
                }),
                z
              );
            })
          : p((D) => {
              let z = { state: u, timestamp: ne, description: N },
                ae = [...D, z];
              return ae.length > n ? ae.slice(ae.length - n) : ae;
            }),
          m([]),
          d(O),
          (b.current = ne));
      },
      [u, i, o, n, c.length]
    ),
    T = uf.useCallback(() => {
      if (c.length === 0) return;
      g.current = true;
      let O = c[c.length - 1];
      return (
        p((N) => N.slice(0, -1)),
        m((N) => [...N, { state: u, timestamp: Date.now() }]),
        d(O.state),
        setTimeout(() => {
          g.current = false;
        }, 0),
        a?.(O.state),
        O.state
      );
    }, [c, u, a]),
    S = uf.useCallback(() => {
      if (f.length === 0) return;
      g.current = true;
      let O = f[f.length - 1];
      return (
        m((N) => N.slice(0, -1)),
        p((N) => [...N, { state: u, timestamp: Date.now() }]),
        d(O.state),
        setTimeout(() => {
          g.current = false;
        }, 0),
        s?.(O.state),
        O.state
      );
    }, [f, u, s]),
    B = uf.useCallback(() => {
      (p([]), m([]));
    }, []),
    v = uf.useCallback(
      (O) => {
        (d(O ?? e), p([]), m([]), (b.current = 0));
      },
      [e]
    ),
    M = uf.useCallback(() => [...c], [c]),
    U = uf.useCallback(() => [...f], [f]),
    ee = uf.useCallback((O) => {
      (d((N) => O(N)),
        p((N) => N.map((ne) => ({ ...ne, state: O(ne.state) }))),
        m((N) => N.map((ne) => ({ ...ne, state: O(ne.state) }))));
    }, []);
  return (
    uf.useEffect(() => {
      if (!r) return;
      let O = (ne) => {
          if ((ne.ctrlKey || ne.metaKey) && ne.key === 'z' && !ne.shiftKey) {
            (ne.preventDefault(), T());
            return;
          }
          if (
            ((ne.ctrlKey || ne.metaKey) && ne.key === 'y') ||
            ((ne.ctrlKey || ne.metaKey) && ne.key === 'z' && ne.shiftKey)
          ) {
            (ne.preventDefault(), S());
            return;
          }
        },
        N = l?.current || document;
      return (
        N.addEventListener('keydown', O),
        () => {
          N.removeEventListener('keydown', O);
        }
      );
    }, [r, T, S, l]),
    {
      state: u,
      canUndo: c.length > 0,
      canRedo: f.length > 0,
      undoCount: c.length,
      redoCount: f.length,
      push: x,
      undo: T,
      redo: S,
      clear: B,
      reset: v,
      getUndoStack: M,
      getRedoStack: U,
      transformAll: ee,
    }
  );
}
function Ju(e, t = {}) {
  let n = uf.useCallback(
    (o, r) =>
      !(
        (o?.package?.document !== r?.package?.document &&
          JSON.stringify(o?.package?.document) !== JSON.stringify(r?.package?.document)) ||
        o?.package?.headers !== r?.package?.headers ||
        o?.package?.footers !== r?.package?.footers
      ),
    []
  );
  return Fb(e, { ...t, isEqual: n });
}
var jn = new prosemirrorState.PluginKey('suggestionMode'),
  Sa = 'suggestionModeApplied',
  Db = Date.now();
function Ta(e) {
  return { revisionId: Db++, author: e.author, date: new Date().toISOString() };
}
function ka(e, t, n, o) {
  try {
    let r = e.resolve(t);
    for (let i of [r.nodeBefore, r.nodeAfter])
      if (i?.isText) {
        let a = i.marks.find((s) => s.type.name === n && s.attrs.author === o);
        if (a) return a.attrs;
      }
  } catch {}
  return null;
}
function tp(e, t, n, o, r, i, a) {
  let s = [];
  if (
    (t.nodesBetween(n, o, (u, d) => {
      if (!u.isText) return;
      let c = Math.max(d, n),
        p = Math.min(d + u.nodeSize, o);
      if (c >= p) return;
      let f = u.marks.some((m) => m.type === r && m.attrs.author === a.author);
      s.push({ from: c, to: p, isOwnInsert: f });
    }),
    s.length === 0)
  )
    return;
  let l = ka(t, n, 'deletion', a.author) || Ta(a);
  for (let u = s.length - 1; u >= 0; u--) {
    let d = s[u];
    d.isOwnInsert ? e.delete(d.from, d.to) : e.addMark(d.from, d.to, i.create(l));
  }
}
function Qu(e, t, n, o, r) {
  let i = e.state.schema.marks.insertion;
  if (!i) return false;
  let a = e.state.tr;
  a.setMeta(Sa, true);
  let s = ka(e.state.doc, t, 'insertion', r.author) || Ta(r);
  if (t !== n) {
    let u = e.state.schema.marks.deletion;
    u && tp(a, e.state.doc, t, n, i, u, r);
  }
  let l = a.mapping.map(n);
  return (
    a.insertText(o, l, l),
    a.addMark(l, l + o.length, i.create(s)),
    e.dispatch(a.scrollIntoView()),
    true
  );
}
function ep(e, t, n) {
  let o = jn.getState(e);
  if (!o?.active) return false;
  let { $from: r, $to: i, empty: a } = e.selection,
    s = e.schema.marks.insertion,
    l = e.schema.marks.deletion;
  if (!s || !l) return false;
  if (!t) return true;
  let u = e.tr;
  if ((u.setMeta(Sa, true), !a)) {
    tp(u, e.doc, r.pos, i.pos, s, l, o);
    let x = u.mapping.map(i.pos);
    return (
      u.setSelection(prosemirrorState.TextSelection.near(u.doc.resolve(x))),
      t(u.scrollIntoView()),
      true
    );
  }
  let d = n === 'backward',
    c = d ? r.pos - 1 : r.pos,
    p = d ? r.pos : r.pos + 1;
  if (c < 0 || p > e.doc.content.size) return true;
  let m = e.doc.resolve(c).nodeAfter;
  if (!m?.isText) return false;
  let b = m.marks.some((x) => x.type === s && x.attrs.author === o.author);
  if (m.marks.some((x) => x.type === l)) {
    let x = d ? c : p;
    u.setSelection(prosemirrorState.TextSelection.near(u.doc.resolve(x)));
  } else if (b) u.delete(c, p);
  else {
    let x = ka(e.doc, c, 'deletion', o.author) || ka(e.doc, p, 'deletion', o.author) || Ta(o);
    u.addMark(c, p, l.create(x));
    let T = d ? c : p;
    u.setSelection(prosemirrorState.TextSelection.near(u.doc.resolve(T)));
  }
  return (t(u.scrollIntoView()), true);
}
function np(e = false, t = 'User') {
  return new prosemirrorState.Plugin({
    key: jn,
    state: {
      init() {
        return { active: e, author: t };
      },
      apply(n, o) {
        let r = n.getMeta(jn);
        return r ? { ...o, ...r } : o;
      },
    },
    props: {
      handleDOMEvents: {
        beforeinput(n, o) {
          let r = jn.getState(n.state);
          if (!r?.active) return false;
          if (o.inputType === 'insertText' && o.data) {
            o.preventDefault();
            let { from: i, to: a } = n.state.selection;
            return Qu(n, i, a, o.data, r);
          }
          return false;
        },
      },
      handleKeyDown(n, o) {
        return jn.getState(n.state)?.active
          ? o.key === 'Backspace'
            ? ep(n.state, n.dispatch, 'backward')
            : o.key === 'Delete'
              ? ep(n.state, n.dispatch, 'forward')
              : false
          : false;
      },
      handleTextInput(n, o, r, i) {
        let a = jn.getState(n.state);
        return a?.active ? Qu(n, o, r, i, a) : false;
      },
    },
    appendTransaction(n, o, r) {
      let i = jn.getState(r);
      if (!i?.active) return null;
      let a = n.find((c) => c.docChanged && !c.getMeta(Sa));
      if (!a) return null;
      let s = r.schema.marks.insertion;
      if (!s) return null;
      let l = Ta(i),
        u = r.tr;
      u.setMeta(Sa, true);
      let d = r.schema.marks.deletion;
      return (
        a.steps.forEach((c) => {
          c.getMap().forEach((f, m, b, g) => {
            g > b &&
              r.doc.nodesBetween(b, g, (x, T) => {
                if (!x.isText) return;
                if (!x.marks.some((B) => B.type === s || (d && B.type === d))) {
                  let B = Math.max(T, b),
                    v = Math.min(T + x.nodeSize, g);
                  u.addMark(B, v, s.create(l));
                }
              });
          });
        }),
        u.steps.length > 0 ? u : null
      );
    },
  });
}
function op(e, t, n, o) {
  if (n) {
    let r = { active: e };
    o !== void 0 && (r.author = o);
    let i = t.tr.setMeta(jn, r);
    n(i);
  }
  return true;
}
var Vb = {
  position: 'fixed',
  left: '-9999px',
  top: '0',
  opacity: 0,
  zIndex: -1,
  pointerEvents: 'none',
  userSelect: 'none',
  overflowAnchor: 'none',
};
function ol(e, t, n, o = []) {
  let r = n?.getSchema() ?? we,
    i = e ? xi(e, { styles: t ?? void 0 }) : Si(),
    a = [...o, ...(n?.getPlugins() ?? [])];
  return prosemirrorState.EditorState.create({ doc: i, schema: r, plugins: a });
}
function Ub(e, t) {
  return t ? ki(e.doc, t) : null;
}
var jb = uf.forwardRef(function (t, n) {
    let {
        document: o,
        styles: r,
        theme: i,
        widthPx: a = 612,
        readOnly: s = false,
        onTransaction: l,
        onSelectionChange: u,
        externalPlugins: d = [],
        extensionManager: c,
        onEditorViewReady: p,
        onEditorViewDestroy: f,
        onKeyDown: m,
      } = t,
      b = uf.useRef(null),
      g = uf.useRef(null),
      x = uf.useRef(o),
      T = uf.useRef(false),
      S = uf.useRef(null),
      B = uf.useRef(false),
      v = uf.useRef(l),
      M = uf.useRef(u),
      U = uf.useRef(p),
      ee = uf.useRef(f),
      O = uf.useRef(m);
    ((v.current = l),
      (M.current = u),
      (U.current = p),
      (ee.current = f),
      (O.current = m),
      (x.current = o));
    let N = uf.useCallback(() => {
        if (!b.current || T.current) return;
        let D = {
          state: ol(o, r, c, d),
          editable: () => !s,
          dispatchTransaction: (z) => {
            if (!g.current || T.current) return;
            let ae = g.current.state.apply(z);
            (g.current.updateState(ae),
              v.current?.(z, ae),
              (z.selectionSet || z.docChanged) && M.current?.(ae));
          },
          handleKeyDown: (z, ae) => O.current?.(z, ae) ?? false,
          handleDOMEvents: { focus: () => false, blur: () => false },
        };
        ((g.current = new prosemirrorView.EditorView(b.current, D)), U.current?.(g.current));
      }, [o, r, d, c, s]),
      ne = uf.useCallback(() => {
        g.current &&
          !T.current &&
          ((T.current = true),
          ee.current?.(),
          g.current.destroy(),
          (g.current = null),
          (T.current = false));
      }, []);
    return (
      uf.useEffect(() => (N(), () => ne()), []),
      uf.useEffect(() => {
        if (!g.current || T.current) return;
        let D = ((ae) => {
          if (!ae) return 'empty';
          let se = ae.package?.properties;
          return `${se?.created || ''}-${se?.modified || ''}-${se?.title || ''}`;
        })(o);
        if (B.current && D === S.current) return;
        ((B.current = true), (S.current = D));
        let z = ol(o, r, c, d);
        (g.current.updateState(z), M.current?.(z));
      }, [o, r, c, d]),
      uf.useEffect(() => {
        g.current;
      }, [s]),
      uf.useImperativeHandle(
        n,
        () => ({
          getState() {
            return g.current?.state ?? null;
          },
          getView() {
            return g.current ?? null;
          },
          getDocument() {
            return g.current ? Ub(g.current.state, x.current) : null;
          },
          replaceContent(ce, D) {
            if (!g.current) return;
            x.current = ce;
            let z = ol(ce, D ?? r, c, d);
            (g.current.updateState(z), (S.current = ''));
          },
          focus() {
            g.current?.focus();
          },
          blur() {
            g.current?.hasFocus() && g.current.dom.blur();
          },
          isFocused() {
            return g.current?.hasFocus() ?? false;
          },
          dispatch(ce) {
            g.current && !T.current && g.current.dispatch(ce);
          },
          executeCommand(ce) {
            return g.current ? ce(g.current.state, g.current.dispatch, g.current) : false;
          },
          undo() {
            return g.current ? prosemirrorHistory.undo(g.current.state, g.current.dispatch) : false;
          },
          redo() {
            return g.current ? prosemirrorHistory.redo(g.current.state, g.current.dispatch) : false;
          },
          canUndo() {
            return g.current ? prosemirrorHistory.undo(g.current.state) : false;
          },
          canRedo() {
            return g.current ? prosemirrorHistory.redo(g.current.state) : false;
          },
          setSelection(ce, D) {
            if (!g.current) return;
            let { state: z, dispatch: ae } = g.current,
              se = z.doc.resolve(ce),
              A = D !== void 0 ? z.doc.resolve(D) : se,
              Ie = prosemirrorState.TextSelection.between(se, A);
            ae(z.tr.setSelection(Ie));
          },
          setNodeSelection(ce) {
            if (!g.current) return;
            let { state: D, dispatch: z } = g.current;
            try {
              let ae = prosemirrorState.NodeSelection.create(D.doc, ce);
              z(D.tr.setSelection(ae));
            } catch {
              this.setSelection(ce);
            }
          },
          setCellSelection(ce, D) {
            if (!g.current) return;
            let { state: z, dispatch: ae } = g.current;
            try {
              let se = prosemirrorTables.CellSelection.create(z.doc, ce, D);
              ae(z.tr.setSelection(se));
            } catch {
              this.setSelection(ce, D);
            }
          },
          scrollToSelection() {},
        }),
        []
      ),
      jsxRuntime.jsx('div', {
        ref: b,
        className: 'paged-editor__hidden-pm',
        style: { ...Vb, width: a > 0 ? `${a}px` : void 0 },
      })
    );
  }),
  sp = uf.memo(jb);
var qb = '#000',
  Xb = 'rgba(66, 133, 244, 0.3)',
  Zb = 2,
  Jb = 530,
  Qb = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
    zIndex: 10,
    overflow: 'hidden',
  },
  ey = (e, t, n, o) => ({
    position: 'absolute',
    left: e.x,
    top: e.y,
    width: n,
    height: e.height,
    backgroundColor: t,
    opacity: o ? 1 : 0,
    transition: 'opacity 0.05s ease-out',
    pointerEvents: 'none',
  }),
  ty = (e, t) => ({
    position: 'absolute',
    left: e.x,
    top: e.y,
    width: e.width,
    height: e.height,
    backgroundColor: t,
    pointerEvents: 'none',
  }),
  ny = ({ position: e, color: t, width: n, blinkInterval: o, isFocused: r }) => {
    let [i, a] = uf.useState(r),
      s = uf.useRef(null);
    return (
      uf.useEffect(
        () => (
          s.current && (window.clearInterval(s.current), (s.current = null)),
          r && o > 0
            ? (a(true),
              (s.current = window.setInterval(() => {
                a((l) => !l);
              }, o)))
            : a(false),
          () => {
            s.current && window.clearInterval(s.current);
          }
        ),
        [r, o]
      ),
      uf.useEffect(() => {
        if (r)
          return (
            a(true),
            s.current && window.clearInterval(s.current),
            o > 0 &&
              (s.current = window.setInterval(() => {
                a((l) => !l);
              }, o)),
            () => {
              s.current && window.clearInterval(s.current);
            }
          );
      }, [e.x, e.y, r, o]),
      jsxRuntime.jsx('div', { style: ey(e, t, n, i), 'data-testid': 'caret' })
    );
  },
  oy = ({ rect: e, color: t, index: n }) =>
    jsxRuntime.jsx('div', {
      style: ty(e, t),
      'data-testid': `selection-rect-${n}`,
      'data-page-index': e.pageIndex,
    }),
  cp = ({
    selectionRects: e,
    caretPosition: t,
    isFocused: n,
    readOnly: o = false,
    caretColor: r = qb,
    selectionColor: i = Xb,
    caretWidth: a = Zb,
    blinkInterval: s = Jb,
  }) => {
    if (o) return null;
    let l = e.length > 0,
      u = t !== null && !l;
    return jsxRuntime.jsxs('div', {
      style: Qb,
      'data-testid': 'selection-overlay',
      children: [
        l &&
          e.map((d, c) =>
            jsxRuntime.jsx(
              oy,
              { rect: d, color: i, index: c },
              `sel-${d.pageIndex}-${d.x}-${d.y}-${c}`
            )
          ),
        u &&
          t &&
          jsxRuntime.jsx(ny, { position: t, color: r, width: a, blinkInterval: s, isFocused: n }),
      ],
    });
  };
var il = 10,
  Gn = il / 2,
  Ar = 2,
  fp = '#2563eb',
  up = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
    zIndex: 15,
    overflow: 'visible',
  },
  iy = {
    position: 'absolute',
    border: `${Ar}px solid ${fp}`,
    pointerEvents: 'none',
    boxSizing: 'border-box',
  },
  ay = {
    position: 'absolute',
    width: `${il}px`,
    height: `${il}px`,
    backgroundColor: fp,
    border: '1px solid white',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    zIndex: 16,
  },
  sy = {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    color: 'white',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    padding: '2px 8px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: 20,
    transform: 'translateX(-50%)',
  },
  ly = { nw: 'nw-resize', ne: 'ne-resize', se: 'se-resize', sw: 'sw-resize' };
function cy(e, t, n, o, r, i) {
  let a = e.includes('w') ? -1 : 1,
    s = e.includes('n') ? -1 : 1,
    l = o + t * a,
    u = r + n * s;
  if (i) {
    let d = Math.max(l / o, u / r);
    ((l = o * d), (u = r * d));
  }
  return { width: Math.max(20, Math.min(2e3, l)), height: Math.max(20, Math.min(2e3, u)) };
}
function mp({
  imageInfo: e,
  zoom: t,
  isFocused: n,
  onResize: o,
  onResizeStart: r,
  onResizeEnd: i,
  onDragMove: a,
  onDragStart: s,
  onDragEnd: l,
}) {
  let [u, d] = uf.useState(false),
    [c, p] = uf.useState(false),
    [f, m] = uf.useState(0),
    [b, g] = uf.useState(0),
    [x, T] = uf.useState(null),
    S = uf.useRef(null),
    B = uf.useRef(null),
    v = uf.useRef(o),
    M = uf.useRef(r),
    U = uf.useRef(i),
    ee = uf.useRef(a),
    O = uf.useRef(s),
    N = uf.useRef(l);
  ((v.current = o),
    (M.current = r),
    (U.current = i),
    (ee.current = a),
    (O.current = s),
    (N.current = l));
  let ne = uf.useRef(e),
    ce = uf.useRef(t);
  ((ne.current = e), (ce.current = t));
  let D = uf.useCallback(() => {
    if (!e || !B.current) {
      T(null);
      return;
    }
    let P = B.current.offsetParent;
    if (!P) {
      T(null);
      return;
    }
    let F = P.getBoundingClientRect(),
      k = e.element.getBoundingClientRect();
    T({
      left: (k.left - F.left) / t,
      top: (k.top - F.top) / t,
      width: k.width / t,
      height: k.height / t,
    });
  }, [e, t]);
  (uf.useEffect(() => {
    D();
  }, [D]),
    uf.useEffect(() => {
      if (!e) return;
      let P =
        B.current?.closest('[style*="overflow"]') ?? B.current?.closest('.paged-editor__container');
      if (!P) return;
      let F = () => {
        (S.current && cancelAnimationFrame(S.current), (S.current = requestAnimationFrame(D)));
      };
      return (
        P.addEventListener('scroll', F, { passive: true }),
        window.addEventListener('resize', F, { passive: true }),
        () => {
          (P.removeEventListener('scroll', F),
            window.removeEventListener('resize', F),
            S.current && cancelAnimationFrame(S.current));
        }
      );
    }, [e, D]));
  let z = uf.useCallback(
      (P, F) => {
        if (!e || !x) return;
        (F.preventDefault(), F.stopPropagation());
        let k = x.width,
          L = x.height,
          I = F.clientX,
          E = F.clientY,
          Z = Math.round(k),
          le = Math.round(L);
        (d(true), m(Z), g(le), M.current?.());
        let _ = (oe) => {
            let fe = ce.current,
              Ce = (oe.clientX - I) / fe,
              R = (oe.clientY - E) / fe,
              K = !oe.shiftKey,
              H = cy(P, Ce, R, k, L, K);
            ((Z = Math.round(H.width)),
              (le = Math.round(H.height)),
              m(Z),
              g(le),
              T((ge) => {
                if (!ge) return ge;
                let he = { ...ge };
                return (
                  P.includes('w') && (he.left = ge.left + (ge.width - H.width)),
                  P.includes('n') && (he.top = ge.top + (ge.height - H.height)),
                  (he.width = H.width),
                  (he.height = H.height),
                  he
                );
              }));
          },
          J = () => {
            (window.removeEventListener('mousemove', _),
              window.removeEventListener('mouseup', J),
              d(false));
            let oe = ne.current;
            (oe && v.current?.(oe.pmPos, Z, le), U.current?.());
          };
        (window.addEventListener('mousemove', _), window.addEventListener('mouseup', J));
      },
      [e, x]
    ),
    ae = uf.useCallback(
      (P) => {
        if (!e || !x) return;
        (P.preventDefault(), P.stopPropagation());
        let F = 4,
          k = P.clientX,
          L = P.clientY,
          I = false,
          E = null,
          Z = (_) => {
            let J = _.clientX - k,
              oe = _.clientY - L;
            (!I && Math.sqrt(J * J + oe * oe) < F) ||
              (I ||
                ((I = true),
                p(true),
                O.current?.(),
                (E = document.createElement('div')),
                (E.style.cssText =
                  'position: fixed; pointer-events: none; z-index: 10000; opacity: 0.5; border: 2px dashed #2563eb; border-radius: 4px; background: rgba(37, 99, 235, 0.1);'),
                (E.style.width = `${x.width}px`),
                (E.style.height = `${x.height}px`),
                document.body.appendChild(E)),
              E &&
                ((E.style.left = `${_.clientX - x.width / 2}px`),
                (E.style.top = `${_.clientY - x.height / 2}px`)));
          },
          le = (_) => {
            if (
              (window.removeEventListener('mousemove', Z),
              window.removeEventListener('mouseup', le),
              E && (E.remove(), (E = null)),
              p(false),
              I)
            ) {
              let J = ne.current;
              (J && ee.current?.(J.pmPos, _.clientX, _.clientY), N.current?.());
            }
          };
        (window.addEventListener('mousemove', Z), window.addEventListener('mouseup', le));
      },
      [e, x]
    );
  if (!!!(e && x && n))
    return jsxRuntime.jsx('div', {
      ref: B,
      style: { ...up, visibility: 'hidden' },
      className: 'image-selection-overlay',
    });
  let { left: A, top: Ie, width: Fe, height: Ue } = x;
  return jsxRuntime.jsxs('div', {
    ref: B,
    style: up,
    className: 'image-selection-overlay',
    children: [
      jsxRuntime.jsx('div', {
        style: { ...iy, left: A - Ar, top: Ie - Ar, width: Fe + Ar * 2, height: Ue + Ar * 2 },
      }),
      jsxRuntime.jsx('div', {
        style: {
          position: 'absolute',
          left: A,
          top: Ie,
          width: Fe,
          height: Ue,
          cursor: c ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          zIndex: 15,
        },
        onMouseDown: ae,
      }),
      jsxRuntime.jsx(Ca, { handle: 'nw', style: { left: A - Gn, top: Ie - Gn }, onMouseDown: z }),
      jsxRuntime.jsx(Ca, {
        handle: 'ne',
        style: { left: A + Fe - Gn, top: Ie - Gn },
        onMouseDown: z,
      }),
      jsxRuntime.jsx(Ca, {
        handle: 'se',
        style: { left: A + Fe - Gn, top: Ie + Ue - Gn },
        onMouseDown: z,
      }),
      jsxRuntime.jsx(Ca, {
        handle: 'sw',
        style: { left: A - Gn, top: Ie + Ue - Gn },
        onMouseDown: z,
      }),
      u &&
        jsxRuntime.jsxs('div', {
          style: { ...sy, left: A + Fe / 2, top: Ie + Ue + 12 },
          children: [f, ' \xD7 ', b],
        }),
    ],
  });
}
function Ca({ handle: e, style: t, onMouseDown: n }) {
  return jsxRuntime.jsx('div', {
    style: { ...ay, ...t, cursor: ly[e] },
    onMouseDown: (o) => n(e, o),
    'data-handle': e,
  });
}
var dy = 'Calibri';
function al(e, t, n) {
  if (!n || t <= n) return { width: e, height: t };
  let o = n / t;
  return { width: Math.round(e * o), height: n };
}
var uy = 11;
function at(e) {
  return (e / 1440) * 96;
}
var py = 0;
function Yn() {
  return `block-${++py}`;
}
function fy(e, t) {
  let n = [];
  for (let o = 0; o <= t; o += 1) {
    let r = e[o] ?? 0;
    if (r <= 0) break;
    n.push(r);
  }
  return n.length === 0 ? '1.' : `${n.join('.')}.`;
}
function va(e, t) {
  let n = {};
  for (let o of e)
    switch (o.type.name) {
      case 'bold':
        n.bold = true;
        break;
      case 'italic':
        n.italic = true;
        break;
      case 'underline': {
        let r = o.attrs;
        if (r.style || r.color) {
          let i = r.color ? chunk4VUZBV2S_js.a(r.color, t) : void 0;
          n.underline = { style: r.style, color: i };
        } else n.underline = true;
        break;
      }
      case 'strike':
        n.strike = true;
        break;
      case 'textColor': {
        let r = o.attrs;
        (r.themeColor || r.rgb) &&
          (n.color = chunk4VUZBV2S_js.a(
            {
              rgb: r.rgb,
              themeColor: r.themeColor,
              themeTint: r.themeTint,
              themeShade: r.themeShade,
            },
            t
          ));
        break;
      }
      case 'highlight':
        n.highlight = chunk4VUZBV2S_js.n(o.attrs.color);
        break;
      case 'fontSize': {
        let r = o.attrs;
        n.fontSize = r.size / 2;
        break;
      }
      case 'fontFamily': {
        let r = o.attrs;
        n.fontFamily = r.ascii || r.hAnsi;
        break;
      }
      case 'superscript':
        n.superscript = true;
        break;
      case 'subscript':
        n.subscript = true;
        break;
      case 'hyperlink': {
        let r = o.attrs;
        n.hyperlink = { href: r.href, tooltip: r.tooltip };
        break;
      }
      case 'footnoteRef': {
        let r = o.attrs,
          i = typeof r.id == 'string' ? parseInt(r.id, 10) : r.id;
        r.noteType === 'endnote' ? (n.endnoteRefId = i) : (n.footnoteRefId = i);
        break;
      }
      case 'comment': {
        let r = o.attrs.commentId;
        r && (n.commentIds || (n.commentIds = []), n.commentIds.push(r));
        break;
      }
      case 'insertion':
        ((n.isInsertion = true),
          (n.changeAuthor = o.attrs.author),
          (n.changeDate = o.attrs.date),
          (n.changeRevisionId = o.attrs.revisionId));
        break;
      case 'deletion':
        ((n.isDeletion = true),
          (n.changeAuthor = o.attrs.author),
          (n.changeDate = o.attrs.date),
          (n.changeRevisionId = o.attrs.revisionId));
        break;
    }
  return n;
}
function my(e, t, n) {
  let o = [],
    r = t + 1,
    i = n.theme;
  return (
    e.forEach((a, s) => {
      let l = r + s;
      if (a.isText && a.text) {
        let u = va(a.marks, i),
          d = { kind: 'text', text: a.text, ...u, pmStart: l, pmEnd: l + a.nodeSize };
        o.push(d);
      } else if (a.type.name === 'hardBreak') {
        let u = { kind: 'lineBreak', pmStart: l, pmEnd: l + a.nodeSize };
        o.push(u);
      } else if (a.type.name === 'tab') {
        let d = { kind: 'tab', ...va(a.marks, i), pmStart: l, pmEnd: l + a.nodeSize };
        o.push(d);
      } else if (a.type.name === 'image') {
        let u = a.attrs,
          d = al(u.width || 100, u.height || 100, n.pageContentHeight),
          c = {
            kind: 'image',
            src: u.src,
            width: d.width,
            height: d.height,
            alt: u.alt,
            transform: u.transform,
            wrapType: u.wrapType,
            displayMode: u.displayMode,
            cssFloat: u.cssFloat,
            distTop: u.distTop,
            distBottom: u.distBottom,
            distLeft: u.distLeft,
            distRight: u.distRight,
            position: u.position,
            pmStart: l,
            pmEnd: l + a.nodeSize,
          };
        o.push(c);
      } else if (a.type.name === 'field') {
        let u = a.attrs.fieldType,
          c = {
            kind: 'field',
            fieldType:
              u === 'PAGE'
                ? 'PAGE'
                : u === 'NUMPAGES'
                  ? 'NUMPAGES'
                  : u === 'DATE'
                    ? 'DATE'
                    : u === 'TIME'
                      ? 'TIME'
                      : 'OTHER',
            fallback: a.attrs.displayText || '',
            pmStart: l,
            pmEnd: l + a.nodeSize,
          };
        o.push(c);
      } else if (a.type.name === 'math') {
        let d = {
          kind: 'text',
          text: a.attrs.plainText || '[equation]',
          italic: true,
          fontFamily: 'Cambria Math',
          pmStart: l,
          pmEnd: l + a.nodeSize,
        };
        o.push(d);
      } else if (a.type.name === 'sdt') {
        let u = l + 1;
        a.forEach((d, c) => {
          let p = u + c;
          if (d.isText && d.text) {
            let f = va(d.marks, i),
              m = { kind: 'text', text: d.text, ...f, pmStart: p, pmEnd: p + d.nodeSize };
            o.push(m);
          } else if (d.type.name === 'hardBreak') {
            let f = { kind: 'lineBreak', pmStart: p, pmEnd: p + d.nodeSize };
            o.push(f);
          } else if (d.type.name === 'tab') {
            let m = { kind: 'tab', ...va(d.marks, i), pmStart: p, pmEnd: p + d.nodeSize };
            o.push(m);
          } else if (d.type.name === 'image') {
            let f = d.attrs,
              m = al(f.width || 100, f.height || 100, n.pageContentHeight),
              b = {
                kind: 'image',
                src: f.src,
                width: m.width,
                height: m.height,
                alt: f.alt,
                transform: f.transform,
                wrapType: f.wrapType,
                displayMode: f.displayMode,
                cssFloat: f.cssFloat,
                distTop: f.distTop,
                distBottom: f.distBottom,
                distLeft: f.distLeft,
                distRight: f.distRight,
                position: f.position,
                pmStart: p,
                pmEnd: p + d.nodeSize,
              };
            o.push(b);
          }
        });
      }
    }),
    o
  );
}
function gy(e, t) {
  let n = {};
  if (e.alignment) {
    let s = e.alignment;
    s === 'both' || s === 'distribute'
      ? (n.alignment = 'justify')
      : s === 'left'
        ? (n.alignment = 'left')
        : s === 'center'
          ? (n.alignment = 'center')
          : s === 'right' && (n.alignment = 'right');
  }
  (e.spaceBefore != null || e.spaceAfter != null || e.lineSpacing != null) &&
    ((n.spacing = {}),
    e.spaceBefore != null && (n.spacing.before = at(e.spaceBefore)),
    e.spaceAfter != null && (n.spacing.after = at(e.spaceAfter)),
    e.lineSpacing != null &&
      (e.lineSpacingRule === 'exact' || e.lineSpacingRule === 'atLeast'
        ? ((n.spacing.line = at(e.lineSpacing)),
          (n.spacing.lineUnit = 'px'),
          (n.spacing.lineRule = e.lineSpacingRule))
        : ((n.spacing.line = e.lineSpacing / 240),
          (n.spacing.lineUnit = 'multiplier'),
          (n.spacing.lineRule = 'auto'))));
  let o = e.indentLeft,
    r = e.indentFirstLine,
    i = e.hangingIndent;
  if (
    (e.numPr?.numId &&
      o == null &&
      ((o = ((e.numPr.ilvl ?? 0) + 1) * 720), r == null && ((r = -360), (i = true))),
    (o != null || e.indentRight != null || r != null) &&
      ((n.indent = {}),
      o != null && (n.indent.left = at(o)),
      e.indentRight != null && (n.indent.right = at(e.indentRight)),
      r != null && (i ? (n.indent.hanging = Math.abs(at(r))) : (n.indent.firstLine = at(r)))),
    e.styleId && (n.styleId = e.styleId),
    e.borders)
  ) {
    let s = e.borders;
    n.borders = {};
    let l = (u) => (u ? Ra(u, t) : void 0);
    (s.top && (n.borders.top = l(s.top)),
      s.bottom && (n.borders.bottom = l(s.bottom)),
      s.left && (n.borders.left = l(s.left)),
      s.right && (n.borders.right = l(s.right)),
      s.between && (n.borders.between = l(s.between)),
      s.bar && (n.borders.bar = l(s.bar)),
      !n.borders.top &&
        !n.borders.bottom &&
        !n.borders.left &&
        !n.borders.right &&
        !n.borders.between &&
        !n.borders.bar &&
        delete n.borders);
  }
  (e.shading?.fill?.rgb && (n.shading = `#${e.shading.fill.rgb}`),
    e.tabs &&
      e.tabs.length > 0 &&
      (n.tabs = e.tabs.map((s) => ({ val: hy(s.alignment), pos: s.position, leader: s.leader }))),
    e.pageBreakBefore && (n.pageBreakBefore = true),
    e.keepNext && (n.keepNext = true),
    e.keepLines && (n.keepLines = true),
    e.contextualSpacing && (n.contextualSpacing = true),
    e.bidi && (n.bidi = true),
    e.styleId && (n.styleId = e.styleId),
    e.numPr && (n.numPr = { numId: e.numPr.numId, ilvl: e.numPr.ilvl }),
    e.listMarker && (n.listMarker = e.listMarker),
    e.listIsBullet != null && (n.listIsBullet = e.listIsBullet),
    e.listMarkerHidden && (n.listMarkerHidden = true),
    e.listMarkerFontFamily && (n.listMarkerFontFamily = e.listMarkerFontFamily),
    e.listMarkerFontSize && (n.listMarkerFontSize = e.listMarkerFontSize));
  let a = e.defaultTextFormatting;
  return (
    a &&
      (a.fontSize != null && (n.defaultFontSize = a.fontSize / 2),
      a.fontFamily && (n.defaultFontFamily = a.fontFamily.ascii || a.fontFamily.hAnsi)),
    n
  );
}
function hy(e) {
  switch (e) {
    case 'left':
      return 'start';
    case 'right':
      return 'end';
    case 'center':
      return 'center';
    case 'decimal':
      return 'decimal';
    case 'bar':
      return 'bar';
    case 'clear':
      return 'clear';
    case 'num':
      return 'start';
    default:
      return 'start';
  }
}
function sl(e, t, n) {
  let o = e.attrs,
    r = my(e, t, n),
    i = gy(o, n.theme);
  return { kind: 'paragraph', id: Yn(), runs: r, attrs: i, pmStart: t, pmEnd: t + e.nodeSize };
}
function by(e) {
  return Math.max(1, Math.round((e / 8) * 1.333));
}
var yy = {
  single: 'solid',
  double: 'double',
  dotted: 'dotted',
  dashed: 'dashed',
  thick: 'solid',
  dashSmallGap: 'dashed',
  dotDash: 'dashed',
  dotDotDash: 'dotted',
  triple: 'double',
  wave: 'solid',
  doubleWave: 'double',
  threeDEmboss: 'ridge',
  threeDEngrave: 'groove',
  outset: 'outset',
  inset: 'inset',
};
function Ra(e, t) {
  if (!e || !e.style || e.style === 'none' || e.style === 'nil') return;
  let n = {
    style: yy[e.style] || 'solid',
    width: by(e.size ?? 0),
    color: e.color ? chunk4VUZBV2S_js.a(e.color, t) : '#000000',
  };
  return (e.space !== void 0 && (n.space = chunkSE5EN2QL_js.g(e.space)), n);
}
function xy(e, t) {
  let n = e.borders;
  if (!n) return;
  let o = {},
    r = ['top', 'bottom', 'left', 'right'];
  for (let i of r) {
    let a = n[i],
      s = a ? Ra(a, t) : void 0;
    o[i] = s ?? { width: 0, style: 'none' };
  }
  return Object.keys(o).length > 0 ? o : void 0;
}
function Sy(e, t, n) {
  let o = [],
    r = t + 1;
  e.forEach((l) => {
    (l.type.name === 'paragraph'
      ? o.push(sl(l, r, n))
      : l.type.name === 'table' && o.push(gp(l, r, n)),
      (r += l.nodeSize));
  });
  let i = e.attrs,
    a = i.margins,
    s = {
      top: a?.top != null ? at(a.top) : 1,
      right: a?.right != null ? at(a.right) : 7,
      bottom: a?.bottom != null ? at(a.bottom) : 1,
      left: a?.left != null ? at(a.left) : 7,
    };
  return {
    id: Yn(),
    blocks: o,
    colSpan: i.colspan,
    rowSpan: i.rowspan,
    width: i.width ? at(i.width) : void 0,
    verticalAlign: i.verticalAlign,
    background: i.backgroundColor ? `#${i.backgroundColor}` : void 0,
    borders: xy(i, n.theme),
    padding: s,
  };
}
function ky(e, t, n) {
  let o = [],
    r = t + 1;
  e.forEach((a) => {
    ((a.type.name === 'tableCell' || a.type.name === 'tableHeader') && o.push(Sy(a, r, n)),
      (r += a.nodeSize));
  });
  let i = e.attrs;
  return {
    id: Yn(),
    cells: o,
    height: i.height ? at(i.height) : void 0,
    heightRule: i.heightRule ?? void 0,
    isHeader: i.isHeader,
  };
}
function gp(e, t, n) {
  let o = [],
    r = t + 1;
  e.forEach((m) => {
    (m.type.name === 'tableRow' && o.push(ky(m, r, n)), (r += m.nodeSize));
  });
  let a = e.attrs.columnWidths?.map(at),
    s = e.attrs.width,
    l = e.attrs.widthType;
  if (!a && o.length > 0) {
    let b = o[0].cells.map((g) => g.width);
    b.every((g) => g !== void 0 && g > 0) && (a = b);
  }
  let u = e.attrs.justification,
    d = e.attrs._originalFormatting,
    c = d?.indent?.value && d.indent.type === 'dxa' ? at(d.indent.value) : void 0,
    p = e.attrs.floating,
    f = p
      ? {
          horzAnchor: p.horzAnchor,
          vertAnchor: p.vertAnchor,
          tblpX: p.tblpX !== void 0 ? at(p.tblpX) : void 0,
          tblpXSpec: p.tblpXSpec,
          tblpY: p.tblpY !== void 0 ? at(p.tblpY) : void 0,
          tblpYSpec: p.tblpYSpec,
          topFromText: p.topFromText !== void 0 ? at(p.topFromText) : void 0,
          bottomFromText: p.bottomFromText !== void 0 ? at(p.bottomFromText) : void 0,
          leftFromText: p.leftFromText !== void 0 ? at(p.leftFromText) : void 0,
          rightFromText: p.rightFromText !== void 0 ? at(p.rightFromText) : void 0,
        }
      : void 0;
  return {
    kind: 'table',
    id: Yn(),
    rows: o,
    columnWidths: a,
    width: s,
    widthType: l,
    justification: u,
    indent: c,
    floating: f,
    pmStart: t,
    pmEnd: t + e.nodeSize,
  };
}
function Ty(e, t, n) {
  let o = e.attrs,
    r = o.wrapType,
    i = r === 'behind' || r === 'inFront',
    a = al(o.width || 100, o.height || 100, n);
  return {
    kind: 'image',
    id: Yn(),
    src: o.src,
    width: a.width,
    height: a.height,
    alt: o.alt,
    transform: o.transform,
    anchor: i
      ? { isAnchored: true, offsetH: o.distLeft, offsetV: o.distTop, behindDoc: r === 'behind' }
      : void 0,
    hlinkHref: o.hlinkHref,
    pmStart: t,
    pmEnd: t + e.nodeSize,
  };
}
function wy(e, t, n) {
  let o = e.attrs,
    r = [];
  return (
    e.forEach((i, a) => {
      if (i.type.name === 'paragraph') {
        let s = sl(i, t + 1 + a, n);
        r.push(s);
      }
    }),
    {
      kind: 'textBox',
      id: Yn(),
      width: o.width ?? chunkQQ63M65M_js.d,
      height: o.height ?? void 0,
      fillColor: o.fillColor,
      outlineWidth: o.outlineWidth,
      outlineColor: o.outlineColor,
      outlineStyle: o.outlineStyle,
      margins: {
        top: o.marginTop ?? chunkQQ63M65M_js.c.top,
        bottom: o.marginBottom ?? chunkQQ63M65M_js.c.bottom,
        left: o.marginLeft ?? chunkQQ63M65M_js.c.left,
        right: o.marginRight ?? chunkQQ63M65M_js.c.right,
      },
      content: r,
      pmStart: t,
      pmEnd: t + e.nodeSize,
    }
  );
}
function hp(e, t = {}) {
  let n = { ...t, defaultFont: t.defaultFont ?? dy, defaultSize: t.defaultSize ?? uy },
    o = [],
    r = 0,
    i = new Map();
  return (
    e.forEach((a, s) => {
      let l = r + s;
      switch (a.type.name) {
        case 'paragraph':
          {
            let u = sl(a, l, n),
              d = a.attrs;
            if (d.numPr && !d.listMarker) {
              let p = d.numPr.numId;
              if (p == null || p === 0) break;
              let f = d.numPr.ilvl ?? 0,
                m = i.get(p) ?? new Array(9).fill(0);
              m[f] = (m[f] ?? 0) + 1;
              for (let g = f + 1; g < m.length; g += 1) m[g] = 0;
              i.set(p, m);
              let b = d.listIsBullet ? '\u2022' : fy(m, f);
              u.attrs = { ...u.attrs, listMarker: b };
            }
            o.push(u);
            let c = d._sectionProperties;
            if (c || d.sectionBreakType) {
              let p = {
                kind: 'sectionBreak',
                id: Yn(),
                type: c?.sectionStart ?? d.sectionBreakType,
              };
              if (c) {
                ((c.pageWidth || c.pageHeight) &&
                  (p.pageSize = { w: at(c.pageWidth ?? 12240), h: at(c.pageHeight ?? 15840) }),
                  (c.marginTop !== void 0 || c.marginLeft !== void 0) &&
                    (p.margins = {
                      top: at(c.marginTop ?? 1440),
                      bottom: at(c.marginBottom ?? 1440),
                      left: at(c.marginLeft ?? 1440),
                      right: at(c.marginRight ?? 1440),
                    }));
                let f = c.columnCount ?? 1;
                if (f > 1) {
                  let m = {
                    count: f,
                    gap: at(c.columnSpace ?? 720),
                    equalWidth: c.equalWidth ?? true,
                    separator: c.separator,
                  };
                  p.columns = m;
                }
              }
              o.push(p);
            }
          }
          break;
        case 'table':
          o.push(gp(a, l, n));
          break;
        case 'image':
          o.push(Ty(a, l, n.pageContentHeight));
          break;
        case 'textBox':
          o.push(wy(a, l, n));
          break;
        case 'horizontalRule':
        case 'pageBreak': {
          let u = { kind: 'pageBreak', id: Yn(), pmStart: l, pmEnd: l + a.nodeSize };
          o.push(u);
          break;
        }
      }
    }),
    o
  );
}
var Ln = 11,
  Hr = 'Calibri',
  Ea = 1,
  qo = 0.5;
function bp(e) {
  return {
    fontFamily: e.fontFamily ?? Hr,
    fontSize: e.fontSize ?? Ln,
    bold: e.bold,
    italic: e.italic,
    letterSpacing: e.letterSpacing,
  };
}
function kp(e, t, n) {
  let o = chunkQQ63M65M_js.k(e),
    r = n?.ascent ?? o * 0.8,
    i = n?.descent ?? o * 0.2,
    a = n?.singleLineRatio ?? 1.15,
    s = o * a,
    l;
  if (t?.lineRule === 'exact' && t.line !== void 0) l = t.line;
  else if (t?.lineRule === 'atLeast' && t.line !== void 0) {
    let u = s * Ea;
    l = Math.max(t.line, u);
  } else
    t?.line !== void 0 && t?.lineUnit === 'multiplier'
      ? (l = s * t.line)
      : t?.line !== void 0 && t?.lineUnit === 'px'
        ? (l = t.line)
        : (l = s * Ea);
  return { ascent: r, descent: i, lineHeight: l };
}
function yp(e, t, n) {
  let o = chunkQQ63M65M_js.g({ fontSize: e, fontFamily: n ?? Hr });
  return kp(e, t, o);
}
function xp(e) {
  return e.kind === 'text';
}
function vy(e) {
  return e.kind === 'tab';
}
function Ry(e) {
  return e.kind === 'image';
}
function Ey(e) {
  return e.kind === 'lineBreak';
}
function Py(e) {
  return e.kind === 'field';
}
function My(e) {
  return !e.text || e.text.length === 0;
}
function Iy(e) {
  let t = [];
  for (let n = 0; n < e.length; n++) {
    let o = e[n];
    (o === ' ' || o === '-' || o === '	') && t.push(n + 1);
  }
  return t;
}
var Fy = 48;
function Sp(e, t, n, o) {
  if (!n || n.length === 0) return { leftMargin: 0, rightMargin: 0 };
  let r = 0,
    i = 0,
    a = o + e,
    s = a + t;
  for (let l of n)
    s > l.topY &&
      a < l.bottomY &&
      ((r = Math.max(r, l.leftMargin)), (i = Math.max(i, l.rightMargin)));
  return { leftMargin: r, rightMargin: i };
}
function Tn(e, t, n) {
  let o = e.runs,
    r = e.attrs,
    i = r?.spacing,
    a = n?.floatingZones,
    s = n?.paragraphYOffset ?? 0,
    l = r?.indent,
    u = l?.left ?? 0,
    d = l?.right ?? 0,
    c = (l?.firstLine ?? 0) - (l?.hanging ?? 0),
    p = Math.max(1, t - u - d),
    f = Math.max(1, p - c),
    m = 0,
    b = chunkQQ63M65M_js.k(Ln) * Ea,
    g = Sp(0, b, a, s),
    x = Math.max(1, f - g.leftMargin - g.rightMargin),
    T = [];
  if (o.length === 0) {
    let O = r?.defaultFontSize ?? Ln,
      N = r?.defaultFontFamily ?? Hr,
      ne = yp(O, i, N);
    return (
      T.push({ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 0, ...ne }),
      { kind: 'paragraph', lines: T, totalHeight: ne.lineHeight }
    );
  }
  if (o.length === 1 && xp(o[0]) && My(o[0])) {
    let O = o[0],
      N = O.fontSize ?? r?.defaultFontSize ?? Ln,
      ne = O.fontFamily ?? r?.defaultFontFamily ?? Hr,
      ce = yp(N, i, ne);
    return (
      T.push({ fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 0, ...ce }),
      { kind: 'paragraph', lines: T, totalHeight: ce.lineHeight }
    );
  }
  let S = {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 0,
      width: 0,
      maxFontSize: Ln,
      maxFontMetrics: null,
      maxImageHeightPx: 0,
      availableWidth: x,
      leftOffset: g.leftMargin,
      rightOffset: g.rightMargin,
    },
    B = () => {
      let O = kp(S.maxFontSize, i, S.maxFontMetrics),
        N = { ...O };
      S.maxImageHeightPx > N.lineHeight &&
        ((N.lineHeight = S.maxImageHeightPx),
        (N.ascent = S.maxImageHeightPx * 0.8),
        (N.descent = S.maxImageHeightPx * 0.2));
      let ne = {
        fromRun: S.fromRun,
        fromChar: S.fromChar,
        toRun: S.toRun,
        toChar: S.toChar,
        width: S.width,
        ...N,
      };
      (S.leftOffset > 0 && (ne.leftOffset = S.leftOffset),
        S.rightOffset > 0 && (ne.rightOffset = S.rightOffset),
        T.push(ne),
        (m += O.lineHeight));
    },
    v = (O, N) => {
      B();
      let ne = chunkQQ63M65M_js.k(Ln) * Ea,
        ce = Sp(m, ne, a, s),
        D = Math.max(1, p - ce.leftMargin - ce.rightMargin);
      S = {
        fromRun: O,
        fromChar: N,
        toRun: O,
        toChar: N,
        width: 0,
        maxFontSize: Ln,
        maxFontMetrics: null,
        maxImageHeightPx: 0,
        availableWidth: D,
        leftOffset: ce.leftMargin,
        rightOffset: ce.rightMargin,
      };
    },
    M = (O) => {
      let N = O.fontSize ?? Ln;
      (!S.maxFontMetrics || N > S.maxFontSize) &&
        ((S.maxFontSize = N), (S.maxFontMetrics = chunkQQ63M65M_js.g(O)));
    };
  for (let O = 0; O < o.length; O++) {
    let N = o[O];
    if (Ey(N)) {
      ((S.toRun = O), (S.toChar = 0), v(O + 1, 0));
      continue;
    }
    if (vy(N)) {
      let ne = bp(N);
      M(ne);
      let ce = N.width ?? Fy;
      (S.width + ce > S.availableWidth + qo && (v(O, 0), M(ne)),
        (S.width += ce),
        (S.toRun = O),
        (S.toChar = 1));
      continue;
    }
    if (Ry(N)) {
      let ne = N.wrapType,
        ce = N.displayMode === 'float' || (ne && ['square', 'tight', 'through'].includes(ne));
      if (N.position && ce) {
        ((S.toRun = O), (S.toChar = 1));
        continue;
      }
      if (ne === 'topAndBottom' || N.displayMode === 'block') {
        S.width > 0 && v(O, 0);
        let ae = N.height,
          se = N.distTop ?? 6,
          A = N.distBottom ?? 6;
        ((S.toRun = O), (S.toChar = 1), (S.maxImageHeightPx = ae + se + A), v(O + 1, 0));
        continue;
      }
      let D = N.width,
        z = N.height;
      (z > S.maxImageHeightPx && (S.maxImageHeightPx = z),
        S.width + D > S.availableWidth + qo && v(O, 0),
        (S.width += D),
        (S.toRun = O),
        (S.toChar = 1));
      continue;
    }
    if (Py(N)) {
      let ne = N.fallback || '1',
        ce = {
          fontFamily: N.fontFamily ?? Hr,
          fontSize: N.fontSize ?? Ln,
          bold: N.bold,
          italic: N.italic,
        };
      M(ce);
      let D = chunkQQ63M65M_js.h(ne, ce);
      (S.width > 0 && S.width + D > S.availableWidth + qo && (v(O, 0), M(ce)),
        (S.width += D),
        (S.toRun = O),
        (S.toChar = 1));
      continue;
    }
    if (xp(N)) {
      let ne = N,
        ce = ne.text,
        D = bp(ne);
      if ((M(D), !ce || ce.length === 0)) {
        ((S.toRun = O), (S.toChar = 0));
        continue;
      }
      let z = Iy(ce),
        ae = 0;
      for (; ae < ce.length; ) {
        let se = ce.length;
        for (let Fe of z)
          if (Fe > ae) {
            se = Fe;
            break;
          }
        let A = ce.slice(ae, se),
          Ie = chunkQQ63M65M_js.h(A, D);
        if (Ie > S.availableWidth + qo) {
          S.width > 0 && (v(O, ae), M(D));
          let { charWidths: Fe } = chunkQQ63M65M_js.i(A, D),
            Ue = 0;
          for (; Ue < A.length; ) {
            let P = 0,
              F = Ue;
            for (; F < A.length; ) {
              let k = Fe[F] ?? 0;
              if (P + k > S.availableWidth + qo) break;
              ((P += k), (F += 1));
            }
            (F === Ue && ((F = Math.min(A.length, Ue + 1)), (P = Fe[Ue] ?? 0)),
              (S.width += P),
              (S.toRun = O),
              (S.toChar = ae + F),
              (Ue = F),
              Ue < A.length && (v(O, ae + Ue), M(D)));
          }
          ae = se;
          continue;
        }
        (S.width > 0 && S.width + Ie > S.availableWidth + qo && (v(O, ae), M(D)),
          (S.width += Ie),
          (S.toRun = O),
          (S.toChar = se),
          (ae = se));
      }
    }
  }
  B();
  let ee = T.reduce((O, N) => O + N.lineHeight, 0);
  return (
    i?.before && (ee += i.before),
    i?.after && (ee += i.after),
    { kind: 'paragraph', lines: T, totalHeight: ee }
  );
}
var Ly = new Map();
function Tp() {
  Ly.clear();
}
var By = new Map();
function wp() {
  By.clear();
}
var Dy = 5e3,
  Ay = Dy,
  qn = new Map();
function ll(e) {
  let t = [];
  for (let o of e.runs)
    o.kind === 'text'
      ? t.push(`t:${o.text}|${o.fontFamily}|${o.fontSize}|${o.bold}|${o.italic}`)
      : o.kind === 'tab'
        ? t.push(`tab:${o.width}`)
        : o.kind === 'image'
          ? t.push(`img:${o.width}x${o.height}`)
          : o.kind === 'lineBreak' && t.push('br');
  let n = e.attrs;
  return (
    n &&
      (n.alignment && t.push(`align:${n.alignment}`),
      n.indent &&
        t.push(
          `indent:${n.indent.left}|${n.indent.right}|${n.indent.firstLine}|${n.indent.hanging}`
        ),
      n.spacing &&
        t.push(
          `spacing:${n.spacing.before}|${n.spacing.after}|${n.spacing.line}|${n.spacing.lineRule}`
        )),
    t.join('||')
  );
}
function Hy() {
  for (; qn.size > Ay; ) {
    let e = qn.keys().next().value;
    if (e === void 0) break;
    qn.delete(e);
  }
}
function cl(e, t) {
  let n = ll(e),
    o = qn.get(n);
  if (o !== void 0 && o.maxWidth === t) return (qn.delete(n), qn.set(n, o), o.measure);
}
function dl(e, t, n) {
  let o = ll(e);
  (qn.set(o, { measure: n, maxWidth: t }), Hy());
}
function Cp() {
  qn.clear();
}
function ul() {
  (Tp(), wp(), Cp());
}
function Ny(e) {
  return {
    fontFamily: e.fontFamily ?? 'Arial',
    fontSize: e.fontSize ?? 12,
    bold: e.bold,
    italic: e.italic,
    letterSpacing: e.letterSpacing,
  };
}
function Oy(e, t) {
  let n = [];
  for (let o = t.fromRun; o <= t.toRun && o < e.runs.length; o++) {
    let r = e.runs[o];
    if (r) {
      if (r.kind === 'tab' || r.kind === 'image' || r.kind === 'lineBreak') {
        n.push(r);
        continue;
      }
      if (r.kind === 'text') {
        let i = r.text ?? '',
          a = o === t.fromRun,
          s = o === t.toRun;
        if (a || s) {
          let l = a ? t.fromChar : 0,
            u = s ? t.toChar : i.length,
            d = i.slice(l, u);
          d.length > 0 && n.push({ ...r, text: d });
        } else n.push(r);
      }
    }
  }
  return n;
}
function zy(e, t) {
  let n,
    o,
    r = e.pmStart ?? 0,
    i = 0;
  for (let a = 0; a < e.runs.length && a <= t.toRun; a++) {
    let s = e.runs[a];
    s &&
      (a < t.fromRun
        ? s.kind === 'text'
          ? (i += (s.text ?? '').length)
          : (s.kind === 'tab' || s.kind === 'lineBreak' || s.kind === 'image') && (i += 1)
        : a === t.fromRun &&
          ((i += t.fromChar), (n = r + i), s.kind === 'text' && (i = t.fromChar)));
  }
  if (n !== void 0) {
    let a = 0;
    for (let s = t.fromRun; s <= t.toRun && s < e.runs.length; s++) {
      let l = e.runs[s];
      if (l)
        if (l.kind === 'text') {
          let u = l.text ?? '',
            d = s === t.fromRun ? t.fromChar : 0,
            c = s === t.toRun ? t.toChar : u.length;
          a += c - d;
        } else (l.kind === 'tab' || l.kind === 'lineBreak' || l.kind === 'image') && (a += 1);
    }
    o = n + a;
  }
  return { pmStart: n, pmEnd: o };
}
function $y(e, t, n, o) {
  let r = 0;
  for (let i = n; i < o && i < e.lines.length; i++) {
    let s = e.lines[i].lineHeight;
    if (t >= r && t < r + s) return i;
    r += s;
  }
  return o > n ? Math.min(o - 1, e.lines.length - 1) : null;
}
function Wy(e, t, n, o) {
  let { pmStart: r, pmEnd: i } = zy(e, t);
  if (r === void 0 || i === void 0) return { charOffset: 0, pmPosition: e.pmStart ?? 0 };
  let a = e.attrs?.alignment ?? 'left',
    s = 0;
  a === 'center'
    ? (s = Math.max(0, (o - t.width) / 2))
    : a === 'right' && (s = Math.max(0, o - t.width));
  let l = Math.max(0, n - s);
  if (l <= 0) return { charOffset: 0, pmPosition: r };
  let u = Oy(e, t);
  if (u.length === 0) return { charOffset: 0, pmPosition: r };
  let d = 0,
    c = 0;
  for (let f of u) {
    if (f.kind === 'tab') {
      let m = f.width ?? 48,
        b = d + m;
      if (l <= b) {
        let g = d + m / 2;
        return l < g
          ? { charOffset: c, pmPosition: r + c }
          : { charOffset: c + 1, pmPosition: r + c + 1 };
      }
      ((d = b), (c += 1));
      continue;
    }
    if (f.kind === 'image') {
      let m = f.width,
        b = d + m;
      if (l <= b) {
        let g = d + m / 2;
        return l < g
          ? { charOffset: c, pmPosition: r + c }
          : { charOffset: c + 1, pmPosition: r + c + 1 };
      }
      ((d = b), (c += 1));
      continue;
    }
    if (f.kind === 'lineBreak') {
      if (l >= d) return { charOffset: c, pmPosition: r + c };
      c += 1;
      continue;
    }
    if (f.kind === 'text') {
      let m = f.text ?? '';
      if (m.length === 0) continue;
      let b = Ny(f),
        g = chunkQQ63M65M_js.i(m, b),
        x = d + g.width;
      if (l <= x) {
        let T = l - d,
          S = chunkQQ63M65M_js.j(T, g.charWidths),
          B = c + S;
        return { charOffset: B, pmPosition: r + B };
      }
      ((d = x), (c += m.length));
    }
  }
  return { charOffset: i - r, pmPosition: i };
}
function vp(e) {
  let { fragment: t, block: n, measure: o, localX: r, localY: i } = e;
  if (t.kind !== 'paragraph' || n.kind !== 'paragraph' || o.kind !== 'paragraph') return null;
  let a = t,
    s = n,
    l = o,
    u = $y(l, i, a.fromLine, a.toLine);
  if (u === null) return null;
  let d = l.lines[u];
  if (!d) return null;
  let c = 0;
  for (let S = a.fromLine; S < u; S++) c += l.lines[S]?.lineHeight ?? 0;
  let p = s.attrs?.indent,
    f = p?.left ?? 0,
    m = p?.right ?? 0,
    b = Math.max(0, t.width - f - m),
    g = r - f,
    { charOffset: x, pmPosition: T } = Wy(s, d, g, b);
  return { pmPosition: T, charOffset: x, lineIndex: u };
}
function _y(e) {
  let { cellBlock: t, cellMeasure: n, cellLocalX: o, cellLocalY: r } = e;
  if (!t || !n) return null;
  let i = {
    fragment: {
      kind: 'paragraph',
      blockId: t.id,
      x: 0,
      y: 0,
      width: n.lines.reduce((s, l) => Math.max(s, l.width), 100),
      fromLine: 0,
      toLine: n.lines.length,
      height: n.totalHeight,
    },
    block: t,
    measure: n,
    pageIndex: e.pageIndex,
    localX: o,
    localY: r,
  };
  return vp(i)?.pmPosition ?? null;
}
function pl(e, t) {
  if (t) return _y(t);
  if (!e) return null;
  let { fragment: n } = e;
  return n.kind === 'paragraph'
    ? (vp(e)?.pmPosition ?? null)
    : n.kind === 'image'
      ? (n.pmStart ?? null)
      : null;
}
function Ep(e, t, n, o = 1) {
  let r = document.elementsFromPoint(t, n),
    i = r.find((d) => d.classList.contains('layout-page'));
  if (!i) return null;
  let a = r.find(
    (d) => d.tagName === 'SPAN' && d.dataset.pmStart !== void 0 && d.dataset.pmEnd !== void 0
  );
  if (a) return fl(a, t);
  let s = r.find((d) => d.classList.contains('layout-empty-run'));
  if (s) {
    let d = s.closest('.layout-paragraph');
    if (d && d.dataset.pmStart) return Number(d.dataset.pmStart);
  }
  let l = r.find((d) => d.classList.contains('layout-paragraph') && d.dataset.pmStart !== void 0);
  if (l && l.dataset.pmStart) {
    let d = Rp(l, t, n);
    return d !== null ? d : Number(l.dataset.pmStart);
  }
  let u = r.find((d) => d.classList.contains('layout-table-cell'));
  return u ? Rp(u, t, n) : Vy(e, i, t, n);
}
function fl(e, t, n) {
  let o = Number(e.dataset.pmStart),
    r = Number(e.dataset.pmEnd);
  if (e.classList.contains('layout-run-tab')) {
    let c = e.getBoundingClientRect(),
      p = (c.left + c.right) / 2;
    return t < p ? o : r;
  }
  let i = e.firstChild;
  if (!i || i.nodeType !== Node.TEXT_NODE) return o;
  let a = i,
    s = a.length;
  if (s === 0) return o;
  let l = e.ownerDocument;
  if (!l) return o;
  let u = 0,
    d = s;
  for (; u < d; ) {
    let c = Math.floor((u + d) / 2),
      p = l.createRange();
    (p.setStart(a, c), p.setEnd(a, c));
    let m = p.getBoundingClientRect().left;
    t < m ? (d = c) : (u = c + 1);
  }
  if (u > 0 && u <= s) {
    let c = l.createRange();
    (c.setStart(a, u - 1), c.setEnd(a, u - 1));
    let p = c.getBoundingClientRect();
    (c.setStart(a, Math.min(u, s)), c.setEnd(a, Math.min(u, s)));
    let f = c.getBoundingClientRect(),
      m = Math.abs(t - p.left),
      b = Math.abs(t - f.left);
    if (m < b) return o + (u - 1);
  }
  return o + Math.min(u, r - o);
}
function Rp(e, t, n) {
  let o = e.querySelector('.layout-empty-run');
  if (o) {
    let c = o.closest('.layout-paragraph');
    if (c && c.dataset.pmStart) return Number(c.dataset.pmStart);
  }
  let r = e.querySelectorAll('.layout-line'),
    i = null,
    a = 1 / 0;
  for (let c of Array.from(r)) {
    let p = c,
      f = p.getBoundingClientRect(),
      m = (f.top + f.bottom) / 2,
      b = Math.abs(n - m);
    b < a && ((a = b), (i = p));
  }
  if (!i) {
    let c = e.querySelector('.layout-paragraph[data-pm-start]');
    return c?.dataset.pmStart
      ? Number(c.dataset.pmStart)
      : e.dataset.pmStart
        ? Number(e.dataset.pmStart)
        : null;
  }
  let s = i.querySelectorAll('span[data-pm-start][data-pm-end]');
  if (s.length === 0) {
    let c = i.closest('.layout-paragraph');
    return c?.dataset.pmStart ? Number(c.dataset.pmStart) : null;
  }
  let l = null,
    u = 1 / 0;
  for (let c of Array.from(s)) {
    let p = c,
      f = p.getBoundingClientRect();
    if (t >= f.left && t <= f.right) return fl(p, t);
    let m = t < f.left ? f.left - t : t - f.right;
    m < u && ((u = m), (l = p));
  }
  if (!l) return null;
  let d = l.getBoundingClientRect();
  return t < d.left ? Number(l.dataset.pmStart) : Number(l.dataset.pmEnd);
}
function Vy(e, t, n, o, r) {
  if (t.querySelectorAll('span[data-pm-start][data-pm-end]').length === 0) {
    let f = t.querySelectorAll('.layout-paragraph');
    if (f.length > 0) {
      let m = f[0];
      return Number(m.dataset.pmStart) || 0;
    }
    return null;
  }
  let a = t.querySelectorAll('.layout-line'),
    s = null,
    l = 1 / 0;
  for (let f of Array.from(a)) {
    let m = f,
      b = m.getBoundingClientRect(),
      g = (b.top + b.bottom) / 2,
      x = Math.abs(o - g);
    x < l && ((l = x), (s = m));
  }
  if (!s) return null;
  let u = s.querySelectorAll('span[data-pm-start][data-pm-end]');
  if (u.length === 0) {
    let f = s.closest('.layout-paragraph');
    return f?.dataset.pmStart ? Number(f.dataset.pmStart) : null;
  }
  let d = null,
    c = 1 / 0;
  for (let f of Array.from(u)) {
    let m = f,
      b = m.getBoundingClientRect();
    if (n >= b.left && n <= b.right) return fl(m, n);
    let g = n < b.left ? b.left - n : n - b.right;
    g < c && ((c = g), (d = m));
  }
  if (!d) return null;
  let p = d.getBoundingClientRect();
  return n < p.left ? Number(d.dataset.pmStart) : Number(d.dataset.pmEnd);
}
var Xn = {
  fragment: 'layout-fragment',
  paragraph: 'layout-fragment-paragraph',
  table: 'layout-fragment-table',
  image: 'layout-fragment-image',
};
function Uy(e) {
  return e.kind === 'paragraph';
}
function jy(e) {
  return e.kind === 'table';
}
function Gy(e) {
  return e.kind === 'image';
}
function Pa(e) {
  ((e.style.position = 'absolute'), (e.style.overflow = 'hidden'));
}
function Ky(e, t, n) {
  let o = n.createElement('div');
  return (
    (o.className = `${Xn.fragment} ${Xn.paragraph}`),
    Pa(o),
    (o.dataset.blockId = String(e.blockId)),
    (o.dataset.fromLine = String(e.fromLine)),
    (o.dataset.toLine = String(e.toLine)),
    e.pmStart !== void 0 && (o.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (o.dataset.pmEnd = String(e.pmEnd)),
    e.continuesFromPrev && (o.dataset.continuesFromPrev = 'true'),
    e.continuesOnNext && (o.dataset.continuesOnNext = 'true'),
    o
  );
}
function Yy(e, t, n) {
  let o = n.createElement('div');
  return (
    (o.className = `${Xn.fragment} ${Xn.table}`),
    Pa(o),
    (o.dataset.blockId = String(e.blockId)),
    (o.dataset.fromRow = String(e.fromRow)),
    (o.dataset.toRow = String(e.toRow)),
    e.pmStart !== void 0 && (o.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (o.dataset.pmEnd = String(e.pmEnd)),
    o
  );
}
function qy(e, t, n) {
  let o = n.createElement('div');
  return (
    (o.className = `${Xn.fragment} ${Xn.image}`),
    Pa(o),
    (o.dataset.blockId = String(e.blockId)),
    e.pmStart !== void 0 && (o.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (o.dataset.pmEnd = String(e.pmEnd)),
    e.isAnchored && (o.dataset.anchored = 'true'),
    e.zIndex !== void 0 && (o.style.zIndex = String(e.zIndex)),
    o
  );
}
function Nr(e, t, n = {}) {
  let o = n.document ?? document;
  if (Uy(e)) return Ky(e, t, o);
  if (jy(e)) return Yy(e, t, o);
  if (Gy(e)) return qy(e, t, o);
  let r = o.createElement('div');
  ((r.className = Xn.fragment), Pa(r));
  let i = e;
  return (
    i.blockId !== void 0 && (r.dataset.blockId = String(i.blockId)),
    i.kind && (r.dataset.kind = i.kind),
    r
  );
}
function ml(e) {
  return (e / 1440) * 96;
}
function Xy(e) {
  return (e / 96) * 1440;
}
function Zy(e) {
  let { explicitStops: t = [], defaultTabInterval: n = 720, leftIndent: o = 0 } = e,
    r = t.filter((c) => c.val !== 'clear').filter((c) => c.pos >= o),
    i = t.filter((c) => c.val === 'clear').map((c) => c.pos),
    a = r.reduce((c, p) => Math.max(c, p.pos), 0),
    s = [...r];
  o > 0 &&
    !r.some((c) => c.pos <= o) &&
    (i.some((p) => Math.abs(p - o) < 20) || s.push({ val: 'start', pos: o, leader: 'none' }));
  let u = a > 0 ? Math.max(a, o) : o,
    d = o + 14400;
  for (; u < d; ) {
    u += n;
    let c = r.some((m) => Math.abs(m.pos - u) < 20),
      p = i.some((m) => Math.abs(m - u) < 20),
      f = o > 0 && Math.abs(u - o) < 20;
    !c && !p && !f && s.push({ val: 'start', pos: u, leader: 'none' });
  }
  return s.sort((c, p) => c.pos - p.pos);
}
function Pp(e, t, n = '', o, r = '.') {
  let { defaultTabInterval: i = 720 } = t,
    a = Xy(e),
    l = Zy(t).find((c) => c.pos > a);
  if (!l) {
    let c = ml(i),
      p = c - (e % c);
    return (p <= 0 && (p = c), { width: p, alignment: 'default' });
  }
  let d = ml(l.pos) - e;
  if (l.val === 'center' || l.val === 'end') {
    let c = o ? o(n) : 0;
    l.val === 'center' ? (d -= c / 2) : (d -= c);
  } else if (l.val === 'decimal') {
    let c = n.indexOf(r);
    if (c >= 0 && o) {
      let p = n.slice(0, c),
        f = o(p);
      d -= f;
    }
  } else if (l.val === 'bar') return { width: 0, leader: l.leader, alignment: 'bar' };
  if (d < 1) {
    let c = ml(i),
      p = c - (e % c);
    return (p <= 0 && (p = c), { width: p, alignment: 'default' });
  }
  return { width: d, leader: l.leader, alignment: l.val };
}
var en = {
  fragment: 'layout-paragraph',
  line: 'layout-line',
  run: 'layout-run',
  text: 'layout-run-text',
  tab: 'layout-run-tab',
  image: 'layout-run-image',
  lineBreak: 'layout-run-linebreak',
};
function zr(e) {
  return e.kind === 'text';
}
function Ma(e) {
  return e.kind === 'tab';
}
function Fp(e) {
  return e.kind === 'image';
}
function gl(e) {
  return e.kind === 'lineBreak';
}
function hl(e) {
  return e.kind === 'field';
}
function Jy(e, t) {
  if (
    (t.fontFamily && (e.style.fontFamily = chunkQQ63M65M_js.a(t.fontFamily).cssFallback),
    t.fontSize)
  ) {
    let o = (t.fontSize * 96) / 72;
    e.style.fontSize = `${o}px`;
  }
  (t.bold && (e.style.fontWeight = 'bold'),
    t.italic && (e.style.fontStyle = 'italic'),
    t.color && (e.style.color = t.color),
    t.letterSpacing && (e.style.letterSpacing = `${t.letterSpacing}px`),
    t.highlight && (e.style.backgroundColor = t.highlight));
  let n = [];
  (t.underline &&
    (n.push('underline'),
    typeof t.underline == 'object' &&
      (t.underline.style && (e.style.textDecorationStyle = t.underline.style),
      t.underline.color && (e.style.textDecorationColor = t.underline.color))),
    t.strike && n.push('line-through'),
    t.commentIds &&
      t.commentIds.length > 0 &&
      ((e.style.backgroundColor = 'rgba(255, 212, 0, 0.25)'),
      (e.style.borderBottom = '2px solid rgba(255, 212, 0, 0.6)'),
      (e.dataset.commentId = String(t.commentIds[0]))),
    t.isInsertion &&
      ((e.style.backgroundColor = 'rgba(52, 168, 83, 0.08)'),
      (e.style.borderBottom = '2px dashed #2e7d32'),
      (e.style.paddingBottom = '1px'),
      e.classList.add('docx-insertion'),
      t.changeAuthor && (e.dataset.changeAuthor = t.changeAuthor),
      t.changeDate && (e.dataset.changeDate = t.changeDate),
      t.changeRevisionId != null && (e.dataset.revisionId = String(t.changeRevisionId))),
    t.isDeletion &&
      ((e.style.backgroundColor = 'rgba(211, 47, 47, 0.08)'),
      (e.style.color = '#c62828'),
      n.includes('line-through') || n.push('line-through'),
      (e.style.textDecorationColor = '#c62828'),
      e.classList.add('docx-deletion'),
      t.changeAuthor && (e.dataset.changeAuthor = t.changeAuthor),
      t.changeDate && (e.dataset.changeDate = t.changeDate),
      t.changeRevisionId != null && (e.dataset.revisionId = String(t.changeRevisionId))),
    n.length > 0 && (e.style.textDecorationLine = n.join(' ')),
    t.superscript && ((e.style.verticalAlign = 'super'), (e.style.fontSize = '0.75em')),
    t.subscript && ((e.style.verticalAlign = 'sub'), (e.style.fontSize = '0.75em')));
}
function Xo(e, t, n) {
  (t !== void 0 && (e.dataset.pmStart = String(t)), n !== void 0 && (e.dataset.pmEnd = String(n)));
}
function bl(e, t) {
  let n = t.createElement('span');
  if (((n.className = `${en.run} ${en.text}`), Jy(n, e), Xo(n, e.pmStart, e.pmEnd), e.hyperlink)) {
    let o = t.createElement('a');
    ((o.href = e.hyperlink.href),
      e.hyperlink.href.startsWith('#') || ((o.target = '_blank'), (o.rel = 'noopener noreferrer')),
      e.hyperlink.tooltip && (o.title = e.hyperlink.tooltip),
      (o.textContent = e.text));
    let r = e.color || '#0563c1';
    ((o.style.color = r),
      (o.style.textDecoration = 'underline'),
      (n.style.color = r),
      n.appendChild(o));
  } else n.textContent = e.text;
  return n;
}
function Lp(e, t, n, o) {
  let r = t.createElement('span');
  if (
    ((r.className = `${en.run} ${en.tab}`),
    (r.style.display = 'inline-block'),
    (r.style.width = `${n}px`),
    (r.style.overflow = 'hidden'),
    Xo(r, e.pmStart, e.pmEnd),
    o && o !== 'none')
  ) {
    let i = Qy(o);
    i &&
      ((r.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='4' height='16'><text x='0' y='12' font-size='12' fill='%23000'>${i}</text></svg>`)}")`),
      (r.style.backgroundRepeat = 'repeat-x'),
      (r.style.backgroundPosition = 'bottom'));
  }
  return ((r.textContent = '\xA0'), r);
}
function Qy(e) {
  switch (e) {
    case 'dot':
      return '.';
    case 'hyphen':
      return '-';
    case 'underscore':
      return '_';
    case 'middleDot':
      return '\xB7';
    case 'heavy':
      return '_';
    default:
      return null;
  }
}
function ex(e, t) {
  let n = t.createElement('img');
  return (
    (n.className = `${en.run} ${en.image}`),
    (n.src = e.src),
    (n.width = e.width),
    (n.height = e.height),
    e.alt && (n.alt = e.alt),
    e.transform && (n.style.transform = e.transform),
    (n.style.display = 'inline'),
    (n.style.verticalAlign = 'middle'),
    Xo(n, e.pmStart, e.pmEnd),
    n
  );
}
function Mp(e, t) {
  let n = t.createElement('div');
  ((n.className = 'layout-block-image'),
    (n.style.display = 'block'),
    (n.style.textAlign = 'center'),
    (n.style.marginTop = `${e.distTop ?? 6}px`),
    (n.style.marginBottom = `${e.distBottom ?? 6}px`));
  let o = t.createElement('img');
  return (
    (o.src = e.src),
    (o.width = e.width),
    (o.height = e.height),
    (o.style.marginLeft = 'auto'),
    (o.style.marginRight = 'auto'),
    e.alt && (o.alt = e.alt),
    e.transform && (o.style.transform = e.transform),
    Xo(n, e.pmStart, e.pmEnd),
    n.appendChild(o),
    n
  );
}
function Bp(e, t) {
  return Zo(e) || e.displayMode === 'block' || e.wrapType === 'topAndBottom' ? Mp(e, t) : ex(e, t);
}
function Dp(e, t) {
  let n = t.createElement('br');
  return ((n.className = `${en.run} ${en.lineBreak}`), Xo(n, e.pmStart, e.pmEnd), n);
}
function Ap(e, t, n) {
  let o = e.fallback ?? '';
  switch (e.fieldType) {
    case 'PAGE':
      o = String(n.pageNumber);
      break;
    case 'NUMPAGES':
      o = String(n.totalPages);
      break;
    case 'DATE':
      o = new Date().toLocaleDateString();
      break;
    case 'TIME':
      o = new Date().toLocaleTimeString();
      break;
  }
  let r = {
    text: o,
    bold: e.bold,
    italic: e.italic,
    underline: e.underline,
    strike: e.strike,
    color: e.color,
    highlight: e.highlight,
    fontFamily: e.fontFamily,
    fontSize: e.fontSize,
    pmStart: e.pmStart,
    pmEnd: e.pmEnd,
  };
  return bl(r, t);
}
function tx(e, t, n) {
  if (zr(e)) return bl(e, t);
  if (Ma(e)) return Lp(e, t, 48, void 0);
  if (Fp(e)) return Bp(e, t);
  if (gl(e)) return Dp(e, t);
  if (hl(e) && n) return Ap(e, t, n);
  let o = t.createElement('span');
  return ((o.className = en.run), o);
}
function Hp(e, t) {
  let n = [],
    o = e.runs;
  for (let r = t.fromRun; r <= t.toRun; r++) {
    let i = o[r];
    if (i)
      if (zr(i)) {
        let a = r === t.fromRun ? t.fromChar : 0,
          s = r === t.toRun ? t.toChar : i.text.length;
        if (a > 0 || s < i.text.length) {
          let l = i.text.slice(a, s);
          n.push({
            ...i,
            text: l,
            pmStart: i.pmStart !== void 0 ? i.pmStart + a : void 0,
            pmEnd: i.pmStart !== void 0 ? i.pmStart + s : void 0,
          });
        } else n.push(i);
      } else n.push(i);
  }
  return n;
}
function nx(e) {
  return [
    e.pmStart ?? 'no-start',
    e.pmEnd ?? 'no-end',
    e.src,
    e.width,
    e.height,
    e.displayMode ?? 'inline',
    e.wrapType ?? 'none',
  ].join('|');
}
function ox(e) {
  return { val: e.val, pos: e.pos, leader: e.leader };
}
function rx(e, t, n) {
  let o = '';
  for (let r = t + 1; r < e.length; r++) {
    let i = e[r];
    if (zr(i)) o += i.text;
    else if (hl(i))
      i.fieldType === 'PAGE' && n
        ? (o += String(n.pageNumber))
        : i.fieldType === 'NUMPAGES' && n
          ? (o += String(n.totalPages))
          : (o += i.fallback ?? '');
    else if (Ma(i) || gl(i)) break;
  }
  return o;
}
function ix(e) {
  let n = e.createElement('canvas').getContext('2d');
  return (o, r = 11, i = 'Calibri') => {
    if (!n) return o.length * 7;
    let a = chunkQQ63M65M_js.a(i).cssFallback,
      s = (r * 96) / 72;
    return ((n.font = `${s}px ${a}`), n.measureText(o).width);
  };
}
function Np(e, t, n, o, r) {
  let i = o.createElement('div');
  ((i.className = en.line),
    (i.style.height = `${t.lineHeight}px`),
    (i.style.lineHeight = `${t.lineHeight}px`));
  let a = Hp(e, t);
  if (a.length === 0) {
    let b = o.createElement('span');
    return (
      (b.className = `${en.run} layout-empty-run`),
      (b.innerHTML = '&nbsp;'),
      i.appendChild(b),
      i
    );
  }
  let s = n === 'justify',
    l = false;
  (s &&
    r &&
    ((l = !r.isLastLine || r.paragraphEndsWithLineBreak),
    l &&
      ((i.style.textAlign = 'justify'),
      (i.style.textAlignLast = 'justify'),
      (i.style.width = `${r.availableWidth}px`))),
    (i.style.whiteSpace = 'pre'));
  let u = a.some((b) => zr(b) && b.highlight);
  i.style.overflow = u ? 'hidden' : 'visible';
  let d = a.some(Ma),
    c,
    p = ix(o);
  if (d) {
    let b = r?.tabStops?.map(ox),
      g = r?.leftIndentPx ? Math.round(r.leftIndentPx * 15) : 0;
    c = { explicitStops: b, leftIndent: g };
  }
  let f = 0,
    m = r?.leftIndentPx ?? 0;
  if (r?.isFirstLine) {
    let b = r?.firstLineIndentPx ?? 0;
    f = m + b;
  } else f = m;
  for (let b = 0; b < a.length; b++) {
    let g = a[b];
    if (Ma(g) && c) {
      let x = rx(a, b, r?.context),
        T = Pp(f, c, x, p),
        S = Lp(g, o, T.width, T.leader);
      (i.appendChild(S), (f += T.width));
    } else if (zr(g)) {
      let x = bl(g, o);
      if (g.highlight) {
        let v = (g.fontSize ? (g.fontSize * 96) / 72 : 14.67) * 1.2,
          M = Math.max(0, t.lineHeight - v);
        if (M > 0) {
          let U = M / 2;
          ((x.style.paddingTop = `${U}px`), (x.style.paddingBottom = `${U}px`));
        }
      }
      i.appendChild(x);
      let T = g.fontSize || 11,
        S = g.fontFamily || 'Calibri';
      f += p(g.text, T, S);
    } else if (Fp(g)) {
      if (Zo(g)) continue;
      let x = nx(g);
      if (r?.renderedInlineImageKeys?.has(x)) continue;
      r?.renderedInlineImageKeys?.add(x);
      let T = Bp(g, o);
      (i.appendChild(T),
        g.displayMode !== 'block' && g.wrapType !== 'topAndBottom' && (f += g.width));
    } else if (gl(g)) {
      let x = Dp(g, o);
      i.appendChild(x);
    } else if (hl(g) && r?.context) {
      let x = Ap(g, o, r.context);
      i.appendChild(x);
      let T = g.fallback ?? '';
      g.fieldType === 'PAGE'
        ? (T = String(r.context.pageNumber))
        : g.fieldType === 'NUMPAGES' && (T = String(r.context.totalPages));
      let S = g.fontSize || 11,
        B = g.fontFamily || 'Calibri';
      f += p(T, S, B);
    } else {
      let x = tx(g, o, r?.context);
      i.appendChild(x);
    }
  }
  return i;
}
function Or(e, t) {
  return !e && !t
    ? true
    : !e || !t
      ? false
      : e.style === t.style && e.width === t.width && e.color === t.color;
}
function Ip(e, t) {
  return (!e && !t) || !e || !t
    ? false
    : Or(e.top, t.top) &&
        Or(e.bottom, t.bottom) &&
        Or(e.left, t.left) &&
        Or(e.right, t.right) &&
        Or(e.between, t.between);
}
function Bn(e, t, n, o, r = {}) {
  let i = r.document ?? document,
    a = i.createElement('div');
  ((a.className = en.fragment),
    (a.style.position = 'relative'),
    (a.dataset.blockId = String(e.blockId)),
    (a.dataset.fromLine = String(e.fromLine)),
    (a.dataset.toLine = String(e.toLine)),
    Xo(a, e.pmStart, e.pmEnd),
    e.continuesFromPrev && (a.dataset.continuesFromPrev = 'true'),
    e.continuesOnNext && (a.dataset.continuesOnNext = 'true'));
  let s = n.lines.slice(e.fromLine, e.toLine),
    l = t.attrs?.alignment;
  t.attrs?.styleId && (a.dataset.styleId = t.attrs.styleId);
  let u = t.attrs?.bidi;
  (u && (a.dir = 'rtl'),
    l
      ? l === 'center'
        ? (a.style.textAlign = 'center')
        : l === 'right'
          ? (a.style.textAlign = 'right')
          : l === 'left'
            ? (a.style.textAlign = 'left')
            : (a.style.textAlign = u ? 'right' : 'left')
      : u && (a.style.textAlign = 'right'));
  let d = t.attrs?.indent,
    c = 0,
    p = 0;
  d &&
    (u
      ? (d.left && d.left > 0 && (p = d.left), d.right && d.right > 0 && (c = d.right))
      : (d.left && d.left > 0 && (c = d.left), d.right && d.right > 0 && (p = d.right)));
  let f = t.attrs?.borders;
  if (f) {
    let v = (N) => {
      switch (N) {
        case 'single':
          return 'solid';
        case 'double':
          return 'double';
        case 'dotted':
          return 'dotted';
        case 'dashed':
          return 'dashed';
        case 'thick':
          return 'solid';
        case 'wave':
          return 'wavy';
        case 'dashSmallGap':
          return 'dashed';
        case 'nil':
        case 'none':
          return 'none';
        default:
          return 'solid';
      }
    };
    a.style.boxSizing = 'border-box';
    let M = (N) => `${N.width}px ${v(N.style)} ${N.color}`,
      U = Ip(r.prevBorders, f),
      ee = Ip(f, r.nextBorders);
    if (
      (U && f.between
        ? (a.style.borderTop = M(f.between))
        : f.top && !U && (a.style.borderTop = M(f.top)),
      f.bottom && !ee && (a.style.borderBottom = M(f.bottom)),
      f.left && (a.style.borderLeft = M(f.left)),
      f.right && (a.style.borderRight = M(f.right)),
      f.bar)
    ) {
      let N = i.createElement('div');
      ((N.style.position = 'absolute'),
        (N.style.left = '-8px'),
        (N.style.top = '0'),
        (N.style.bottom = '0'),
        (N.style.borderLeft = M(f.bar)),
        (a.style.position = 'relative'),
        a.appendChild(N));
    }
    if (f.top || f.bottom || f.left || f.right || f.between) {
      let N = f.top || f.between;
      ((a.style.paddingLeft = f.left ? `${f.left.space ?? 4}px` : '0'),
        (a.style.paddingRight = f.right ? `${f.right.space ?? 4}px` : '0'),
        (a.style.paddingTop = N ? `${N.space ?? 2}px` : '0'),
        (a.style.paddingBottom = f.bottom ? `${f.bottom.space ?? 6}px` : '0'));
    }
  }
  t.attrs?.shading && (a.style.backgroundColor = t.attrs.shading);
  let m = e.width - c - p,
    g = t.runs[t.runs.length - 1]?.kind === 'lineBreak',
    x = n.lines.length,
    T = 0;
  d?.hanging && d.hanging > 0
    ? (T = -d.hanging)
    : d?.firstLine && d.firstLine > 0 && (T = d.firstLine);
  let S = 0,
    B = r.renderedInlineImageKeys ?? new Set();
  for (let v = 0; v < s.length; v++) {
    let M = s[v],
      U = e.fromLine + v,
      ee = U === x - 1,
      O = U === 0 && !e.continuesFromPrev,
      N = M.leftOffset ?? 0,
      ne = M.rightOffset ?? 0,
      ce = m;
    if (O) {
      let se = d?.hanging && d.hanging > 0,
        A = d?.firstLine && d.firstLine > 0;
      se && d?.hanging ? (ce = m + d.hanging) : A && d?.firstLine && (ce = m - d.firstLine);
    }
    let D = Np(t, M, l, i, {
      availableWidth: ce - N - ne,
      isLastLine: ee,
      isFirstLine: O,
      paragraphEndsWithLineBreak: g,
      tabStops: t.attrs?.tabs,
      leftIndentPx: c,
      firstLineIndentPx: O ? T : 0,
      context: o,
      renderedInlineImageKeys: B,
    });
    if (N > 0 || ne > 0) {
      (N > 0 && (D.style.marginLeft = `${N}px`), ne > 0 && (D.style.marginRight = `${ne}px`));
      let se = ce - N - ne;
      se > 0 && (D.style.width = `${se}px`);
    }
    S += M.lineHeight;
    let z = d?.hanging && d.hanging > 0,
      ae = d?.firstLine && d.firstLine > 0;
    if (
      (O
        ? c > 0 && z
          ? ((D.style.paddingLeft = `${c}px`), (D.style.textIndent = `-${d.hanging}px`))
          : c > 0 && ae
            ? ((D.style.paddingLeft = `${c}px`), (D.style.textIndent = `${d.firstLine}px`))
            : c > 0
              ? (D.style.paddingLeft = `${c}px`)
              : ae && (D.style.textIndent = `${d.firstLine}px`)
        : c > 0
          ? (D.style.paddingLeft = `${c}px`)
          : z && (D.style.paddingLeft = `${d.hanging}px`),
      p > 0 && (D.style.paddingRight = `${p}px`),
      O && t.attrs?.listMarker && !t.attrs?.listMarkerHidden)
    ) {
      let se = Math.max(0, c - (d?.hanging ?? 0));
      ((D.style.paddingLeft = `${se}px`), (D.style.textIndent = '0'));
      let A;
      if (!t.attrs.listMarkerFontFamily || !t.attrs.listMarkerFontSize)
        for (let P = M.fromRun; P <= M.toRun; P++) {
          let F = t.runs[P];
          if (F && F.kind === 'text') {
            A = F;
            break;
          }
        }
      let Ie = t.attrs.listMarkerFontFamily ?? A?.fontFamily ?? t.attrs.defaultFontFamily,
        Fe = t.attrs.listMarkerFontSize ?? A?.fontSize ?? t.attrs.defaultFontSize,
        Ue = ax(t.attrs.listMarker, d, i, Ie, Fe);
      D.insertBefore(Ue, D.firstChild);
    }
    a.appendChild(D);
  }
  return a;
}
function ax(e, t, n, o, r) {
  let i = n.createElement('span');
  if (
    ((i.className = 'layout-list-marker'),
    (i.style.display = 'inline-block'),
    o && (i.style.fontFamily = chunkQQ63M65M_js.a(o).cssFallback),
    r)
  ) {
    let s = (r * 96) / 72;
    i.style.fontSize = `${s}px`;
  }
  i.textContent = e;
  let a = t?.hanging ?? 24;
  return (
    (i.style.minWidth = `${a}px`),
    (i.style.textAlign = 'left'),
    (i.style.boxSizing = 'border-box'),
    i
  );
}
var wn = {
  table: 'layout-table',
  row: 'layout-table-row',
  cell: 'layout-table-cell',
  cellContent: 'layout-table-cell-content',
  resizeHandle: 'layout-table-resize-handle',
  rowResizeHandle: 'layout-table-row-resize-handle',
  tableEdgeHandleBottom: 'layout-table-edge-handle-bottom',
  tableEdgeHandleRight: 'layout-table-edge-handle-right',
};
function sx(e, t, n) {
  let o = [],
    r = 0;
  for (let i = 0; i < e.blocks.length; i++) {
    let a = e.blocks[i];
    if (a?.kind !== 'paragraph') {
      let u = t.blocks[i];
      u && u.kind === 'table' && (r += u.totalHeight ?? 0);
      continue;
    }
    let s = a;
    for (let u of s.runs) {
      if (u.kind !== 'image') continue;
      let d = u;
      if (!Zo(d)) continue;
      let c = d.position,
        p = d.distTop ?? 0,
        f = d.distBottom ?? 0,
        m = d.distLeft ?? 12,
        b = d.distRight ?? 12,
        g = 'left',
        x = 0;
      if (c?.horizontal) {
        let B = c.horizontal;
        B.align === 'right'
          ? ((g = 'right'), (x = n - d.width))
          : B.align === 'left'
            ? (x = 0)
            : B.align === 'center'
              ? (x = (n - d.width) / 2)
              : B.posOffset !== void 0 &&
                ((x = Zn(B.posOffset)), (g = x > n / 2 ? 'right' : 'left'));
      } else d.cssFloat === 'right' && ((g = 'right'), (x = n - d.width));
      let T = r;
      if (c?.vertical) {
        let B = c.vertical;
        B.posOffset !== void 0 ? (T = r + Zn(B.posOffset)) : B.align === 'top' && (T = 0);
      }
      x = Math.max(0, Math.min(x, n - d.width));
      let S = 'bothSides';
      (d.cssFloat === 'left' ? (S = 'right') : d.cssFloat === 'right' && (S = 'left'),
        o.push({
          src: d.src,
          width: d.width,
          height: d.height,
          alt: d.alt,
          transform: d.transform,
          x,
          y: T,
          side: g,
          distTop: p,
          distBottom: f,
          distLeft: m,
          distRight: b,
          wrapText: S,
          pmStart: d.pmStart,
          pmEnd: d.pmEnd,
        }));
    }
    let l = t.blocks[i];
    l && l.kind === 'paragraph' && (r += l.totalHeight);
  }
  return o;
}
function lx(e, t, n, o) {
  let r = o.createElement('div');
  ((r.className = wn.cellContent), (r.style.position = 'relative'));
  let i = e.padding?.left ?? 7,
    a = e.padding?.right ?? 7,
    s = Math.max(0, t.width - i - a);
  r.style.width = `${s}px`;
  let l = sx(e, t, s),
    u;
  if (l.length > 0) {
    u = l.map((p) => {
      let f = p.x + p.width + p.distRight,
        m = p.y - p.distTop,
        b = p.y + p.height + p.distBottom,
        g = 0,
        x = 0,
        T = p.wrapText ?? 'bothSides';
      return (
        T === 'right'
          ? (g = f)
          : T === 'left'
            ? (x = s - (p.x - p.distLeft))
            : p.side === 'left'
              ? (g = f)
              : (x = s - (p.x - p.distLeft)),
        { leftMargin: g, rightMargin: x, topY: m, bottomY: b }
      );
    });
    let c = o.createElement('div');
    ((c.className = 'layout-cell-floating-images-layer'),
      (c.style.position = 'absolute'),
      (c.style.top = '0'),
      (c.style.left = '0'),
      (c.style.width = '100%'),
      (c.style.height = '100%'),
      (c.style.pointerEvents = 'none'),
      (c.style.zIndex = '10'),
      (c.style.overflow = 'hidden'));
    for (let p of l) {
      let f = o.createElement('div');
      ((f.className = 'layout-cell-floating-image'),
        (f.style.position = 'absolute'),
        (f.style.left = `${p.x}px`),
        (f.style.top = `${p.y}px`),
        (f.style.pointerEvents = 'auto'),
        p.pmStart !== void 0 && (f.dataset.pmStart = String(p.pmStart)),
        p.pmEnd !== void 0 && (f.dataset.pmEnd = String(p.pmEnd)));
      let m = o.createElement('img');
      ((m.src = p.src),
        (m.style.width = `${p.width}px`),
        (m.style.height = `${p.height}px`),
        (m.style.display = 'block'),
        p.alt && (m.alt = p.alt),
        p.transform && (m.style.transform = p.transform),
        f.appendChild(m),
        c.appendChild(f));
    }
    r.appendChild(c);
  }
  let d = 0;
  for (let c = 0; c < e.blocks.length; c++) {
    let p = e.blocks[c],
      f = t.blocks[c];
    if (p?.kind === 'paragraph' && f?.kind === 'paragraph') {
      let m = p,
        b = f;
      u && u.length > 0 && (b = Tn(m, s, { floatingZones: u, paragraphYOffset: d }));
      let g = {
          blockId: m.id,
          width: s,
          height: b.totalHeight,
          fromLine: 0,
          toLine: b.lines.length,
          pmStart: m.pmStart,
          pmEnd: m.pmEnd,
        },
        x = { ...n, insideTableCell: true },
        T = Bn(g, m, b, x, { document: o });
      ((T.style.position = 'relative'), r.appendChild(T), (d += b.totalHeight));
    } else if (p?.kind === 'table' && f?.kind === 'table') {
      let g = cx(p, f, n, o);
      ((g.style.position = 'relative'), r.appendChild(g), (d += f.totalHeight ?? 0));
    }
  }
  return r;
}
function cx(e, t, n, o) {
  let r = o.createElement('div');
  ((r.className = `${wn.table} layout-nested-table`),
    (r.style.position = 'relative'),
    (r.style.width = `${t.totalWidth}px`),
    (r.style.display = 'block'),
    e.justification === 'center'
      ? ((r.style.marginLeft = 'auto'), (r.style.marginRight = 'auto'))
      : e.justification === 'right'
        ? (r.style.marginLeft = 'auto')
        : e.indent && (r.style.marginLeft = `${e.indent}px`),
    (r.dataset.blockId = String(e.id)),
    e.pmStart !== void 0 && (r.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (r.dataset.pmEnd = String(e.pmEnd)));
  let i = [],
    a = 0;
  for (let u = 0; u < t.rows.length; u++) (i.push(a), (a += t.rows[u]?.height ?? 0));
  i.push(a);
  let s = new Map(),
    l = 0;
  for (let u = 0; u < e.rows.length; u++) {
    let d = e.rows[u],
      c = t.rows[u];
    if (!d || !c) continue;
    let p = yl(d, c, u, l, t.columnWidths, e.rows.length, n, o, s, i);
    (r.appendChild(p), (l += c.height));
  }
  return ((r.style.height = `${l}px`), r);
}
function Ia(e, t, n) {
  let o = `border${t.charAt(0).toUpperCase() + t.slice(1)}`;
  if (!n || n.style === 'none' || n.style === 'nil' || n.width === 0) e.style[o] = 'none';
  else {
    let r = n.width ?? 1,
      i = n.color ?? '#000000',
      a = n.style ?? 'solid';
    e.style[o] = `${r}px ${a} ${i}`;
  }
}
function dx(e, t, n, o, r, i, a) {
  let s = a.createElement('div');
  ((s.className = wn.cell),
    (s.style.position = 'absolute'),
    (s.style.left = `${n}px`),
    (s.style.top = '0'),
    (s.style.width = `${t.width}px`),
    (s.style.height = `${o}px`),
    (s.style.overflow = 'hidden'),
    (s.style.boxSizing = 'border-box'));
  let l = e.padding?.top ?? 1,
    u = e.padding?.right ?? 7,
    d = e.padding?.bottom ?? 1,
    c = e.padding?.left ?? 7;
  if (
    ((s.style.padding = `${l}px ${u}px ${d}px ${c}px`),
    e.borders &&
      (r.isFirstRow && Ia(s, 'top', e.borders.top),
      Ia(s, 'right', e.borders.right),
      Ia(s, 'bottom', e.borders.bottom),
      r.isFirstCol && Ia(s, 'left', e.borders.left)),
    e.background && (s.style.backgroundColor = e.background),
    e.verticalAlign)
  )
    switch (((s.style.display = 'flex'), (s.style.flexDirection = 'column'), e.verticalAlign)) {
      case 'top':
        s.style.justifyContent = 'flex-start';
        break;
      case 'center':
        s.style.justifyContent = 'center';
        break;
      case 'bottom':
        s.style.justifyContent = 'flex-end';
        break;
    }
  let p = lx(e, t, i, a);
  if ((s.appendChild(p), e.blocks.length > 0)) {
    let f = e.blocks[0],
      m = e.blocks[e.blocks.length - 1];
    (f && 'pmStart' in f && f.pmStart !== void 0 && (s.dataset.pmStart = String(f.pmStart)),
      m && 'pmEnd' in m && m.pmEnd !== void 0 && (s.dataset.pmEnd = String(m.pmEnd)));
  }
  return s;
}
function yl(e, t, n, o, r, i, a, s, l, u, d) {
  let c = s.createElement('div');
  ((c.className = wn.row),
    (c.style.position = 'absolute'),
    (c.style.left = '0'),
    (c.style.top = `${o}px`),
    (c.style.width = '100%'),
    (c.style.height = `${t.height}px`),
    (c.dataset.rowIndex = String(n)));
  let p = new Set();
  if (l) {
    for (let [, b] of l)
      if (b.startRow < n && b.startRow + b.rowSpan > n)
        for (let g = 0; g < b.colSpan; g++) p.add(b.columnIndex + g);
  }
  let f = 0,
    m = 0;
  for (; p.has(m); ) ((f += r[m] ?? 0), m++);
  for (let b = 0; b < e.cells.length; b++) {
    let g = e.cells[b],
      x = t.cells[b];
    if (!g || !x) continue;
    let T = g.colSpan ?? 1,
      S = g.rowSpan ?? 1,
      B = t.height;
    if (S > 1 && u) {
      B = 0;
      for (let N = n; N < n + S && N < u.length - 1; N++) B += (u[N + 1] ?? 0) - (u[N] ?? 0);
      B === 0 && (B = t.height * S);
    }
    let v = n === 0 || d === true,
      U = m === 0;
    m + T >= r.length;
    let O = dx(g, x, f, B, { isFirstRow: v, isFirstCol: U }, a, s);
    if (
      ((O.dataset.cellIndex = String(b)),
      (O.dataset.columnIndex = String(m)),
      S > 1 && (O.dataset.rowSpan = String(S)),
      c.appendChild(O),
      S > 1 && l)
    ) {
      let N = `${n}-${m}`;
      l.set(N, {
        cell: g,
        cellMeasure: x,
        columnIndex: m,
        startRow: n,
        rowSpan: S,
        colSpan: T,
        x: f,
        totalHeight: B,
      });
    }
    for (let N = 0; N < T && m + N < r.length; N++) f += r[m + N] ?? 0;
    for (m += T; p.has(m); ) ((f += r[m] ?? 0), m++);
  }
  return c;
}
function Fa(e, t, n, o, r = {}) {
  let i = r.document ?? document,
    a = i.createElement('div');
  ((a.className = wn.table),
    (a.style.position = 'absolute'),
    (a.style.width = `${e.width}px`),
    (a.style.height = `${e.height}px`),
    (a.style.overflow = 'hidden'),
    (a.dataset.blockId = String(e.blockId)),
    (a.dataset.fromRow = String(e.fromRow)),
    (a.dataset.toRow = String(e.toRow)),
    e.pmStart !== void 0 && (a.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (a.dataset.pmEnd = String(e.pmEnd)));
  let s = 0;
  for (let m = 0; m < n.columnWidths.length - 1; m++) {
    s += n.columnWidths[m] ?? 0;
    let b = i.createElement('div');
    ((b.className = wn.resizeHandle),
      (b.style.position = 'absolute'),
      (b.style.left = `${s - 3}px`),
      (b.style.top = '0'),
      (b.style.width = '6px'),
      (b.style.height = '100%'),
      (b.style.cursor = 'col-resize'),
      (b.style.zIndex = '10'),
      (b.dataset.columnIndex = String(m)),
      (b.dataset.tableBlockId = String(e.blockId)),
      e.pmStart !== void 0 && (b.dataset.tablePmStart = String(e.pmStart)),
      a.appendChild(b));
  }
  let l = [],
    u = 0;
  for (let m = 0; m < n.rows.length; m++) (l.push(u), (u += n.rows[m]?.height ?? 0));
  l.push(u);
  let d = new Map(),
    c = e.headerRowCount ?? 0,
    p = 0;
  if (c > 0 && e.continuesFromPrev)
    for (let m = 0; m < c; m++) {
      let b = t.rows[m],
        g = n.rows[m];
      if (!b || !g) continue;
      let x = yl(b, g, m, p, n.columnWidths, t.rows.length, o, i, d, l, m === 0);
      ((x.dataset.repeatedHeader = 'true'), a.appendChild(x), (p += g.height));
    }
  for (let m = e.fromRow; m < e.toRow; m++) {
    let b = t.rows[m],
      g = n.rows[m];
    if (!b || !g) continue;
    let x = c > 0 && e.continuesFromPrev ? false : e.continuesFromPrev && m === e.fromRow,
      T = yl(b, g, m, p, n.columnWidths, t.rows.length, o, i, d, l, x);
    (a.appendChild(T), (p += g.height));
  }
  let f = 0;
  for (let m = e.fromRow; m < e.toRow; m++)
    if (((f += n.rows[m]?.height ?? 0), m < e.toRow - 1)) {
      let b = i.createElement('div');
      ((b.className = wn.rowResizeHandle),
        (b.style.position = 'absolute'),
        (b.style.left = '0'),
        (b.style.top = `${f - 3}px`),
        (b.style.width = '100%'),
        (b.style.height = '6px'),
        (b.style.cursor = 'row-resize'),
        (b.style.zIndex = '10'),
        (b.dataset.rowIndex = String(m)),
        (b.dataset.tableBlockId = String(e.blockId)),
        e.pmStart !== void 0 && (b.dataset.tablePmStart = String(e.pmStart)),
        a.appendChild(b));
    }
  if (e.toRow === t.rows.length) {
    let m = i.createElement('div');
    ((m.className = wn.tableEdgeHandleBottom),
      (m.style.position = 'absolute'),
      (m.style.left = '0'),
      (m.style.top = `${f - 3}px`),
      (m.style.width = '100%'),
      (m.style.height = '6px'),
      (m.style.cursor = 'row-resize'),
      (m.style.zIndex = '10'),
      (m.dataset.rowIndex = String(t.rows.length - 1)),
      (m.dataset.tableBlockId = String(e.blockId)),
      (m.dataset.isEdge = 'bottom'),
      e.pmStart !== void 0 && (m.dataset.tablePmStart = String(e.pmStart)),
      a.appendChild(m));
  }
  if (e.toRow === t.rows.length) {
    let m = n.columnWidths.reduce((g, x) => g + x, 0),
      b = i.createElement('div');
    ((b.className = wn.tableEdgeHandleRight),
      (b.style.position = 'absolute'),
      (b.style.left = `${m - 3}px`),
      (b.style.top = '0'),
      (b.style.width = '6px'),
      (b.style.height = '100%'),
      (b.style.cursor = 'col-resize'),
      (b.style.zIndex = '10'),
      (b.dataset.columnIndex = String(n.columnWidths.length - 1)),
      (b.dataset.tableBlockId = String(e.blockId)),
      (b.dataset.isEdge = 'right'),
      e.pmStart !== void 0 && (b.dataset.tablePmStart = String(e.pmStart)),
      a.appendChild(b));
  }
  return a;
}
var xl = { image: 'layout-image', imageAnchored: 'layout-image-anchored' };
function La(e, t, n, o, r = {}) {
  let i = r.document ?? document,
    a = i.createElement('div');
  ((a.className = xl.image),
    e.isAnchored && a.classList.add(xl.imageAnchored),
    (a.style.position = 'absolute'),
    (a.style.width = `${e.width}px`),
    (a.style.height = `${e.height}px`),
    (a.style.overflow = 'hidden'),
    e.zIndex !== void 0 && (a.style.zIndex = String(e.zIndex)),
    t.anchor?.behindDoc && (a.style.zIndex = '-1'),
    (a.dataset.blockId = String(e.blockId)),
    e.pmStart !== void 0 && (a.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (a.dataset.pmEnd = String(e.pmEnd)));
  let s = i.createElement('img');
  if (
    ((s.src = t.src),
    (s.alt = t.alt ?? ''),
    (s.style.width = '100%'),
    (s.style.height = '100%'),
    (s.style.objectFit = 'contain'),
    (s.style.display = 'block'),
    t.transform && (s.style.transform = t.transform),
    (s.draggable = false),
    t.hlinkHref)
  ) {
    let l = i.createElement('a');
    ((l.href = t.hlinkHref),
      (l.target = '_blank'),
      (l.rel = 'noopener noreferrer'),
      (l.style.display = 'block'),
      (l.style.width = '100%'),
      (l.style.height = '100%'),
      l.appendChild(s),
      a.appendChild(l));
  } else a.appendChild(s);
  return a;
}
var Op = { textBox: 'layout-textbox' };
function Ba(e, t, n, o, r = {}) {
  let i = r.document ?? document,
    a = i.createElement('div');
  if (
    ((a.className = Op.textBox),
    (a.style.position = 'absolute'),
    (a.style.width = `${e.width}px`),
    (a.style.height = `${e.height}px`),
    (a.style.overflow = 'hidden'),
    (a.style.boxSizing = 'border-box'),
    t.fillColor && (a.style.backgroundColor = t.fillColor),
    t.outlineWidth && t.outlineWidth > 0)
  ) {
    let d = t.outlineStyle || 'solid',
      c = t.outlineColor || '#000000';
    a.style.border = `${t.outlineWidth}px ${d} ${c}`;
  }
  let s = t.margins ?? chunkQQ63M65M_js.c;
  ((a.style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`),
    (a.dataset.blockId = String(e.blockId)),
    e.pmStart !== void 0 && (a.dataset.pmStart = String(e.pmStart)),
    e.pmEnd !== void 0 && (a.dataset.pmEnd = String(e.pmEnd)));
  let l = e.width - s.left - s.right,
    u = 0;
  for (let d = 0; d < t.content.length; d++) {
    let c = t.content[d],
      p = n.innerMeasures[d];
    if (!p) continue;
    let f = {
        blockId: c.id,
        width: l,
        height: p.totalHeight,
        pmStart: c.pmStart,
        pmEnd: c.pmEnd,
        fromLine: 0,
        toLine: p.lines.length,
      },
      m = Bn(f, c, p, o, { document: i });
    ((m.style.position = 'relative'),
      (m.style.left = '0'),
      (m.style.top = '0'),
      a.appendChild(m),
      (u += p.totalHeight));
  }
  return a;
}
var Jn = {
  page: 'layout-page',
  content: 'layout-page-content',
  header: 'layout-page-header',
  footer: 'layout-page-footer',
};
function Aa(e, t, n, o) {
  if (
    ((e.style.position = 'relative'),
    (e.style.width = `${t}px`),
    (e.style.height = `${n}px`),
    (e.style.backgroundColor = o.backgroundColor ?? '#ffffff'),
    (e.style.overflow = 'hidden'),
    (e.style.fontFamily = 'Calibri, "Segoe UI", Arial, sans-serif'),
    (e.style.fontSize = `${1056 / 72}px`),
    (e.style.color = '#000000'),
    o.showBorders && (e.style.border = '1px solid #ccc'),
    o.showShadow && (e.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)'),
    o.pageBorders)
  ) {
    let r = o.pageBorders,
      i = ['top', 'bottom', 'left', 'right'],
      a = ['Top', 'Bottom', 'Left', 'Right'];
    for (let s = 0; s < i.length; s++) {
      let l = r[i[s]];
      if (l && l.style !== 'none' && l.style !== 'nil') {
        let u = zo(l, a[s], o.theme);
        for (let [d, c] of Object.entries(u)) e.style[d] = String(c);
      }
    }
  }
}
function ux(e, t) {
  let n = t.margins;
  ((e.style.position = 'absolute'),
    (e.style.top = `${n.top}px`),
    (e.style.left = `${n.left}px`),
    (e.style.right = `${n.right}px`),
    (e.style.bottom = `${n.bottom}px`),
    (e.style.overflow = 'visible'));
}
function Wp(e) {
  return e?.align ?? e?.alignment;
}
function px(e, t) {
  let n = e.position.vertical;
  if (!n) return e.paragraphY;
  let o = Wp(n),
    r = n.posOffset !== void 0 ? Zn(n.posOffset) : void 0;
  if (n.relativeTo === 'page') {
    if (r !== void 0) return r - t.flowTop;
    if (o === 'top') return -t.flowTop;
    if (o === 'bottom') return t.pageHeight - e.height - t.flowTop;
    if (o === 'center') return (t.pageHeight - e.height) / 2 - t.flowTop;
  }
  if (n.relativeTo === 'margin') {
    let i = t.margins.top,
      a = t.pageHeight - t.margins.top - t.margins.bottom;
    if (r !== void 0) return i + r - t.flowTop;
    if (o === 'top') return i - t.flowTop;
    if (o === 'bottom') return i + a - e.height - t.flowTop;
    if (o === 'center') return i + (a - e.height) / 2 - t.flowTop;
  }
  return r !== void 0 ? e.paragraphY + r : e.paragraphY;
}
function fx(e, t, n) {
  let o = t.position.horizontal;
  if (!o) {
    e.style.left = '0';
    return;
  }
  let r = Wp(o);
  if (o.relativeTo === 'page') {
    if (o.posOffset !== void 0) {
      e.style.left = `${Zn(o.posOffset) - n.flowLeft}px`;
      return;
    }
    if (r === 'right') {
      e.style.left = `${n.pageWidth - t.width - n.flowLeft}px`;
      return;
    }
    if (r === 'center') {
      e.style.left = `${(n.pageWidth - t.width) / 2 - n.flowLeft}px`;
      return;
    }
    if (r === 'left') {
      e.style.left = `${-n.flowLeft}px`;
      return;
    }
  }
  if (o.posOffset !== void 0) {
    e.style.left = `${Zn(o.posOffset)}px`;
    return;
  }
  if (r === 'right') {
    e.style.left = `${n.contentWidth - t.width}px`;
    return;
  }
  if (r === 'center') {
    e.style.left = `${(n.contentWidth - t.width) / 2}px`;
    return;
  }
  e.style.left = '0';
}
function mx(e, t, n) {
  ((e.style.position = 'absolute'),
    (e.style.left = `${t.x - n.left}px`),
    (e.style.top = `${t.y - n.top}px`),
    (e.style.width = `${t.width}px`),
    'height' in t && (e.style.height = `${t.height}px`));
}
function Zn(e) {
  return e === void 0 ? 0 : Math.round((e * 96) / 914400);
}
function Zo(e) {
  let t = e.wrapType,
    n = e.displayMode;
  return !!((t && ['square', 'tight', 'through'].includes(t)) || n === 'float');
}
function gx(e, t, n) {
  let o = [];
  for (let r of e.runs) {
    if (r.kind !== 'image') continue;
    let i = r;
    if (!Zo(i)) continue;
    let a = i.position,
      s = i.distTop ?? 0,
      l = i.distBottom ?? 0,
      u = i.distLeft ?? 12,
      d = i.distRight ?? 12,
      c = 'left',
      p = 0;
    if (a?.horizontal) {
      let b = a.horizontal;
      b.align === 'right'
        ? ((c = 'right'), (p = n - i.width))
        : b.align === 'left'
          ? ((c = 'left'), (p = 0))
          : b.align === 'center'
            ? ((c = 'left'), (p = (n - i.width) / 2))
            : b.posOffset !== void 0 && ((p = Zn(b.posOffset)), (c = p > n / 2 ? 'right' : 'left'));
    } else i.cssFloat === 'right' && ((c = 'right'), (p = n - i.width));
    let f = 0;
    if (a?.vertical) {
      let b = a.vertical;
      (b.align === 'top'
        ? (f = 0)
        : b.align === 'bottom'
          ? (f = t)
          : b.posOffset !== void 0
            ? (f = Zn(b.posOffset))
            : (f = t),
        (b.relativeTo === 'margin' && (b.align === 'top' || b.posOffset !== void 0)) ||
          (b.relativeTo === 'paragraph' && (f = t + f)));
    } else f = t;
    let m = 'bothSides';
    (i.cssFloat === 'left' ? (m = 'right') : i.cssFloat === 'right' && (m = 'left'),
      o.push({
        src: i.src,
        width: i.width,
        height: i.height,
        alt: i.alt,
        transform: i.transform,
        side: c,
        x: p,
        y: f,
        distTop: s,
        distBottom: l,
        distLeft: u,
        distRight: d,
        pmStart: i.pmStart,
        pmEnd: i.pmEnd,
        wrapText: m,
        wrapType: i.wrapType,
      }));
  }
  return o;
}
function hx(e, t) {
  return e.map((n) => {
    let o = n.x + n.width + n.distRight,
      r = n.y - n.distTop,
      i = n.y + n.height + n.distBottom,
      a = 0,
      s = 0,
      l = n.wrapText ?? 'bothSides';
    return (
      l === 'right'
        ? (a = o)
        : l === 'left'
          ? (s = t - (n.x - n.distLeft))
          : n.side === 'left'
            ? (a = o)
            : (s = t - (n.x - n.distLeft)),
      { leftMargin: a, rightMargin: s, topY: r, bottomY: i }
    );
  });
}
function bx(e, t) {
  let n = t.createElement('div');
  ((n.className = 'layout-floating-images-layer'),
    (n.style.position = 'absolute'),
    (n.style.top = '0'),
    (n.style.left = '0'),
    (n.style.right = '0'),
    (n.style.bottom = '0'),
    (n.style.pointerEvents = 'none'),
    (n.style.zIndex = '10'));
  for (let o of e) {
    let r = t.createElement('div');
    ((r.className = 'layout-page-floating-image'),
      (r.style.position = 'absolute'),
      (r.style.pointerEvents = 'auto'),
      (r.style.top = `${o.y}px`),
      (r.style.left = `${o.x}px`),
      o.pmStart !== void 0 && (r.dataset.pmStart = String(o.pmStart)),
      o.pmEnd !== void 0 && (r.dataset.pmEnd = String(o.pmEnd)));
    let i = t.createElement('img');
    ((i.src = o.src),
      (i.style.width = `${o.width}px`),
      (i.style.height = `${o.height}px`),
      (i.style.display = 'block'),
      o.alt && (i.alt = o.alt),
      o.transform && (i.style.transform = o.transform),
      r.appendChild(i),
      n.appendChild(r));
  }
  return n;
}
function zp(e, t, n, o) {
  let r = n.document ?? document,
    i = r.createElement('div');
  i.style.position = 'relative';
  let a = t.contentWidth ?? 600,
    s = [],
    l = 0;
  for (let u = 0; u < e.blocks.length; u++) {
    let d = e.blocks[u],
      c = e.measures[u];
    if (d?.kind === 'paragraph' && c?.kind === 'paragraph') {
      let p = d,
        f = c,
        m = l,
        b = [];
      for (let S of p.runs)
        if (S.kind === 'image' && 'position' in S && S.position) {
          let B = S;
          s.push({
            src: B.src,
            width: B.width,
            height: B.height,
            alt: B.alt,
            paragraphY: m,
            position: B.position,
          });
        } else b.push(S);
      let g = { ...p, runs: b },
        x = { blockId: p.id, width: a, height: f.totalHeight, fromLine: 0, toLine: f.lines.length },
        T = Bn(x, g, f, t, { document: r });
      ((T.style.position = 'relative'),
        (T.style.marginBottom = '0'),
        i.appendChild(T),
        (l += f.totalHeight));
    }
  }
  for (let u of s) {
    let d = r.createElement('img');
    ((d.src = u.src),
      (d.width = u.width),
      (d.height = u.height),
      u.alt && (d.alt = u.alt),
      (d.style.position = 'absolute'),
      (d.style.display = 'block'),
      (d.style.width = `${u.width}px`),
      (d.style.height = `${u.height}px`),
      (d.style.maxWidth = 'none'),
      (d.style.maxHeight = 'none'),
      fx(d, u, o),
      (d.style.top = `${px(u, o)}px`),
      i.appendChild(d));
  }
  return i;
}
function yx(e, t, n) {
  let o = n.createElement('div');
  ((o.className = 'layout-footnote-area'), (o.style.width = `${t}px`));
  let r = n.createElement('div');
  ((r.style.width = '33%'),
    (r.style.height = '0.5px'),
    (r.style.backgroundColor = '#000'),
    (r.style.marginBottom = '6px'),
    (r.style.marginTop = '6px'),
    o.appendChild(r));
  for (let i of e) {
    let a = n.createElement('div');
    ((a.style.fontSize = '10px'),
      (a.style.lineHeight = '1.3'),
      (a.style.marginBottom = '4px'),
      (a.style.color = '#000'));
    let s = n.createElement('sup');
    ((s.textContent = i.displayNumber),
      (s.style.fontSize = '7px'),
      (s.style.marginRight = '2px'),
      a.appendChild(s));
    let l = n.createTextNode(' ' + i.text);
    (a.appendChild(l), o.appendChild(a));
  }
  return o;
}
function Na(e, t, n = {}) {
  let o = n.document ?? document,
    r = o.createElement('div');
  ((r.className = n.pageClassName ?? Jn.page),
    (r.dataset.pageNumber = String(e.number)),
    Aa(r, e.size.w, e.size.h, n));
  let i = o.createElement('div');
  ((i.className = Jn.content), ux(i, e));
  let a = e.size.w - e.margins.left - e.margins.right,
    s = [],
    l = [];
  for (let f of e.fragments)
    if (f.kind === 'paragraph' && n.blockLookup) {
      let m = n.blockLookup.get(String(f.blockId));
      if (m?.block.kind === 'paragraph') {
        let b = m.block,
          g = f.y - e.margins.top,
          x = gx(b, g, a);
        s.push(...x);
      }
    }
  for (let f of s)
    l.push({
      side: f.side,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      distTop: f.distTop,
      distBottom: f.distBottom,
      distLeft: f.distLeft,
      distRight: f.distRight,
      wrapText: f.wrapText,
      wrapType: f.wrapType,
    });
  if (n.blockLookup)
    for (let f of e.fragments) {
      if (f.kind !== 'table') continue;
      let m = n.blockLookup.get(String(f.blockId));
      if (m?.block.kind !== 'table') continue;
      let g = m.block.floating;
      if (!g) continue;
      let x = f.x - e.margins.left,
        T = f.y - e.margins.top,
        S = g.topFromText ?? 0,
        B = g.bottomFromText ?? 0,
        v = g.leftFromText ?? 12,
        M = g.rightFromText ?? 12,
        U = x < a / 2 ? 'left' : 'right';
      l.push({
        side: U,
        x,
        y: T,
        width: f.width,
        height: f.height,
        distTop: S,
        distBottom: B,
        distLeft: v,
        distRight: M,
      });
    }
  let u = l.length > 0 ? hx(l, a) : [];
  if (s.length > 0) {
    let f = bx(s, o);
    i.appendChild(f);
  }
  let d = (f) => {
      if (f.kind !== 'paragraph' || !n.blockLookup || !f.blockId) return;
      let m = n.blockLookup.get(String(f.blockId));
      if (m?.block.kind === 'paragraph') return m.block.attrs?.borders;
    },
    c,
    p = new Map();
  for (let f = 0; f < e.fragments.length; f++) {
    let m = e.fragments[f],
      b,
      g = { ...t, section: 'body', contentWidth: a },
      x = m.y - e.margins.top;
    if (n.blockLookup && m.blockId) {
      let T = n.blockLookup.get(String(m.blockId));
      if (
        m.kind === 'paragraph' &&
        T?.block.kind === 'paragraph' &&
        T?.measure.kind === 'paragraph'
      ) {
        let S = T.block,
          B = f + 1 < e.fragments.length ? d(e.fragments[f + 1]) : void 0,
          v = String(m.blockId),
          M = p.get(v);
        M || ((M = new Set()), p.set(v, M));
        let U = T.measure;
        (u.length > 0 && (U = Tn(S, a, { floatingZones: u, paragraphYOffset: x })),
          (b = Bn(m, S, U, g, {
            document: o,
            prevBorders: c,
            nextBorders: B,
            renderedInlineImageKeys: M,
          })),
          (c = S.attrs?.borders));
      } else
        m.kind === 'table' && T?.block.kind === 'table' && T?.measure.kind === 'table'
          ? ((b = Fa(m, T.block, T.measure, g, { document: o })), (c = void 0))
          : m.kind === 'image' && T?.block.kind === 'image' && T?.measure.kind === 'image'
            ? ((b = La(m, T.block, T.measure, g, { document: o })), (c = void 0))
            : m.kind === 'textBox' && T?.block.kind === 'textBox' && T?.measure.kind === 'textBox'
              ? ((b = Ba(m, T.block, T.measure, g, { document: o })), (c = void 0))
              : ((b = Nr(m, g, { document: o })), (c = void 0));
    } else ((b = Nr(m, g, { document: o })), (c = void 0));
    (mx(b, m, { left: e.margins.left, top: e.margins.top }), i.appendChild(b));
  }
  if (e.columns && e.columns.separator && e.columns.count > 1) {
    let f = e.columns.count,
      m = e.columns.gap,
      b = (a - (f - 1) * m) / f,
      g = e.size.h - e.margins.top - e.margins.bottom;
    for (let x = 0; x < f - 1; x++) {
      let T = (x + 1) * b + x * m + m / 2,
        S = o.createElement('div');
      ((S.style.position = 'absolute'),
        (S.style.left = `${T}px`),
        (S.style.top = '0'),
        (S.style.height = `${g}px`),
        (S.style.width = '0.5px'),
        (S.style.backgroundColor = '#000'),
        (S.style.pointerEvents = 'none'),
        i.appendChild(S));
    }
  }
  if (n.footnoteArea && n.footnoteArea.length > 0) {
    let f = yx(n.footnoteArea, a, o);
    f.style.position = 'absolute';
    let m = e.footnoteReservedHeight ?? 0,
      b = e.size.h - e.margins.bottom - e.margins.top;
    ((f.style.top = `${b - m}px`), (f.style.left = '0'), (f.style.right = '0'), i.appendChild(f));
  }
  r.appendChild(i);
  {
    let m = n.headerDistance ?? e.margins.header ?? 48,
      b = e.size.w - e.margins.left - e.margins.right,
      g = Math.max(e.margins.top - m, 48),
      x = n.headerContent?.visualTop ?? 0,
      T = n.headerContent?.visualBottom ?? n.headerContent?.height ?? 0,
      S = Math.max(T - x, 24),
      B = T > g,
      v = o.createElement('div');
    ((v.className = Jn.header),
      (v.style.position = 'absolute'),
      (v.style.top = `${m + x}px`),
      (v.style.left = `${e.margins.left}px`),
      (v.style.right = `${e.margins.right}px`),
      (v.style.width = `${b}px`),
      (v.style.height = `${S}px`),
      (v.style.minHeight = `${S}px`));
    let M = !B;
    if (n.headerContent && n.headerContent.blocks.length > 0) {
      let U = zp(n.headerContent, { ...t, section: 'header', contentWidth: b }, n, {
        flowTop: m,
        flowLeft: e.margins.left,
        contentWidth: b,
        pageWidth: e.size.w,
        pageHeight: e.size.h,
        margins: e.margins,
      });
      ((U.style.top = `${-x}px`), U.querySelector('img') && (M = false), v.appendChild(U));
    }
    (M && ((v.style.maxHeight = `${g}px`), (v.style.overflow = 'hidden')), r.appendChild(v));
  }
  {
    let m = n.footerDistance ?? e.margins.footer ?? 48,
      b = e.size.w - e.margins.left - e.margins.right,
      g = Math.max(e.margins.bottom - m, 48),
      x = n.footerContent?.visualTop ?? 0,
      T = n.footerContent?.visualBottom ?? n.footerContent?.height ?? 0,
      S = Math.max(T - x, 24),
      B = S > g,
      v = o.createElement('div');
    ((v.className = Jn.footer),
      (v.style.position = 'absolute'),
      (v.style.top = `${e.size.h - m - S}px`),
      (v.style.left = `${e.margins.left}px`),
      (v.style.right = `${e.margins.right}px`),
      (v.style.width = `${b}px`),
      (v.style.height = `${S}px`),
      (v.style.minHeight = `${S}px`));
    let M = !B;
    if (n.footerContent && n.footerContent.blocks.length > 0) {
      let U = zp(n.footerContent, { ...t, section: 'footer', contentWidth: b }, n, {
        flowTop: e.size.h - m - (n.footerContent?.height ?? 0),
        flowLeft: e.margins.left,
        contentWidth: b,
        pageWidth: e.size.w,
        pageHeight: e.size.h,
        margins: e.margins,
      });
      ((U.style.top = `${-x}px`), U.querySelector('img') && (M = false), v.appendChild(U));
    }
    (M && ((v.style.maxHeight = `${g}px`), (v.style.overflow = 'hidden')), r.appendChild(v));
  }
  return r;
}
function Sl(e, t, n) {
  let o = { pageNumber: e.number, totalPages: t, section: 'body' },
    r = { ...n };
  if (n.footnotesByPage) {
    let i = n.footnotesByPage.get(e.number);
    i && i.length > 0 && (r.footnoteArea = i);
  }
  return { context: o, pageOptions: r };
}
function $p(e) {
  let t = [];
  (t.push(`s:${e.size.w},${e.size.h}`),
    t.push(`m:${e.margins.top},${e.margins.right},${e.margins.bottom},${e.margins.left}`),
    t.push(`n:${e.number}`),
    e.footnoteReservedHeight && t.push(`fn:${e.footnoteReservedHeight}`));
  for (let n of e.fragments) {
    let o = `${n.kind}:${n.blockId},${n.x},${n.y},${n.width},${n.height}`;
    (n.pmStart !== void 0 && (o += `,ps:${n.pmStart}`),
      n.pmEnd !== void 0 && (o += `,pe:${n.pmEnd}`),
      n.kind === 'paragraph'
        ? (o += `,fl:${n.fromLine},tl:${n.toLine}`)
        : n.kind === 'table' && (o += `,fr:${n.fromRow},tr:${n.toRow}`),
      t.push(o));
  }
  return t.join('|');
}
function xx(e) {
  let t = [];
  return (
    e.headerContent &&
      t.push(
        `hdr:${e.headerContent.blocks.length},${e.headerContent.height},${e.headerContent.visualTop ?? 0},${e.headerContent.visualBottom ?? e.headerContent.height}`
      ),
    e.footerContent &&
      t.push(
        `ftr:${e.footerContent.blocks.length},${e.footerContent.height},${e.footerContent.visualTop ?? 0},${e.footerContent.visualBottom ?? e.footerContent.height}`
      ),
    e.theme && t.push(`thm:${e.theme.name ?? 'default'}`),
    e.pageBorders && t.push(`pb:${JSON.stringify(e.pageBorders)}`),
    e.headerDistance !== void 0 && t.push(`hd:${e.headerDistance}`),
    e.footerDistance !== void 0 && t.push(`fd:${e.footerDistance}`),
    t.join('|')
  );
}
function Sx(e, t) {
  ((e.style.display = 'flex'),
    (e.style.flexDirection = 'column'),
    (e.style.alignItems = 'center'),
    (e.style.gap = `${t}px`),
    (e.style.padding = `${t}px`),
    (e.style.backgroundColor = 'var(--doc-bg, #f8f9fa)'));
}
var Da = 2,
  kx = 8;
function kl(e, t, n = {}) {
  let o = e.length,
    r = n.pageGap ?? 24,
    i = t,
    a = i.__pageRenderState,
    s = xx(n),
    l = o >= kx;
  if (a && a.optionsHash === s && l) {
    let g = a.pageStates,
      x = a.pageDataMap,
      T = i.__pageObserver,
      S = [];
    for (let M of e) S.push($p(M));
    let B = a.totalPages !== o,
      v = Math.min(g.length, e.length);
    for (let M = 0; M < v; M++) {
      let U = g[M],
        ee = S[M];
      if (U.fingerprint === ee && !B) {
        let ne = x.get(U.element);
        ne && (ne.page = e[M]);
        continue;
      }
      let O = U.element,
        N = x.get(O);
      (N && ((N.page = e[M]), N.rendered && Tx(O, x, o, n)),
        (U.fingerprint = ee),
        Aa(O, e[M].size.w, e[M].size.h, n),
        (O.dataset.pageNumber = String(e[M].number)));
    }
    if (e.length > g.length) {
      let M = n.document ?? document;
      for (let U = g.length; U < e.length; U++) {
        let ee = e[U],
          O = M.createElement('div');
        ((O.className = n.pageClassName ?? Jn.page),
          (O.dataset.pageNumber = String(ee.number)),
          (O.dataset.pageIndex = String(U)),
          Aa(O, ee.size.w, ee.size.h, n),
          t.appendChild(O),
          g.push({ element: O, fingerprint: S[U] }),
          x.set(O, { page: ee, index: U, rendered: false }),
          T && T.observe(O));
      }
    }
    if (e.length < g.length) {
      for (let M = g.length - 1; M >= e.length; M--) {
        let U = g[M].element;
        (T && T.unobserve(U), x.delete(U), t.removeChild(U));
      }
      g.length = e.length;
    }
    for (let M = 0; M < g.length; M++) {
      let U = x.get(g[M].element);
      U && (U.index = M);
    }
    ((a.totalPages = o), (a.currentOptions = n));
    return;
  }
  let d = i.__pageObserver;
  (d && (d.disconnect(), (i.__pageObserver = void 0)),
    (t.innerHTML = ''),
    (i.__pageRenderState = void 0),
    Sx(t, r));
  let c = [],
    p = [];
  for (let g = 0; g < e.length; g++) {
    let x = e[g];
    if ((p.push($p(x)), l)) {
      let S = (n.document ?? document).createElement('div');
      ((S.className = n.pageClassName ?? Jn.page),
        (S.dataset.pageNumber = String(x.number)),
        (S.dataset.pageIndex = String(g)),
        Aa(S, x.size.w, x.size.h, n),
        t.appendChild(S),
        c.push(S));
    } else {
      let { context: T, pageOptions: S } = Sl(x, o, n),
        B = Na(x, T, S);
      (t.appendChild(B), c.push(B));
    }
  }
  if (!l) return;
  let f = new Map();
  for (let g = 0; g < e.length; g++) f.set(c[g], { page: e[g], index: g, rendered: false });
  let m = new IntersectionObserver(
    (g) => {
      let x = i.__pageRenderState;
      if (!x) return;
      let { currentOptions: T, totalPages: S, pageDataMap: B } = x;
      for (let ee of g) {
        let O = ee.target,
          N = B.get(O);
        if (N && ee.isIntersecting) {
          Ha(O, B, S, T);
          for (let ne = -Da; ne <= Da; ne++) {
            let ce = N.index + ne;
            ce >= 0 &&
              ce < x.pageStates.length &&
              ce !== N.index &&
              Ha(x.pageStates[ce].element, B, S, T);
          }
        }
      }
      let v = window.innerHeight,
        M = v * 3,
        U = new Set();
      for (let [ee, O] of B) {
        if (!O.rendered) continue;
        let N = ee.getBoundingClientRect();
        N.bottom > -M && N.top < v + M && U.add(O.index);
      }
      for (let [ee, O] of B) {
        if (!O.rendered) continue;
        let N = false;
        for (let ne of U)
          if (Math.abs(O.index - ne) <= Da + 1) {
            N = true;
            break;
          }
        !N && U.size > 0 && wx(ee, B);
      }
    },
    { root: null, rootMargin: '1500px 0px 1500px 0px' }
  );
  for (let g of c) m.observe(g);
  ((i.__pageObserver = m),
    (i.__pageRenderState = {
      pageStates: c.map((g, x) => ({ element: g, fingerprint: p[x] })),
      totalPages: o,
      optionsHash: s,
      pageDataMap: f,
      currentOptions: n,
    }));
  let b = Math.min(e.length, Da + 3);
  for (let g = 0; g < b; g++) Ha(c[g], f, o, n);
}
function Ha(e, t, n, o) {
  let r = t.get(e);
  if (!r || r.rendered) return;
  let { context: i, pageOptions: a } = Sl(r.page, n, o),
    s = Na(r.page, i, a);
  for (; s.firstChild; ) e.appendChild(s.firstChild);
  r.rendered = true;
}
function Tx(e, t, n, o) {
  let r = t.get(e);
  if (!r) return;
  let { context: i, pageOptions: a } = Sl(r.page, n, o),
    l = Na(r.page, i, a).querySelector(`.${Jn.content}`),
    u = e.querySelector(`.${Jn.content}`);
  l && u ? e.replaceChild(l, u) : ((e.innerHTML = ''), (r.rendered = false), Ha(e, t, n, o));
}
function wx(e, t) {
  let n = t.get(e);
  !n || !n.rendered || ((e.innerHTML = ''), (n.rendered = false));
}
var Oa = class {
  constructor(t = {}) {
    chunkH5NTJZO4_js.d(this, 'container', null);
    chunkH5NTJZO4_js.d(this, 'blockLookup', new Map());
    chunkH5NTJZO4_js.d(this, 'pageStates', []);
    chunkH5NTJZO4_js.d(this, 'totalPages', 0);
    chunkH5NTJZO4_js.d(this, 'options');
    chunkH5NTJZO4_js.d(this, 'doc');
    ((this.options = t), (this.doc = t.document ?? document));
  }
  setBlockLookup(t) {
    this.blockLookup = t;
  }
  mount(t) {
    ((this.container = t), this.applyContainerStyles());
  }
  unmount() {
    (this.container && (this.container.innerHTML = ''),
      (this.container = null),
      (this.pageStates = []));
  }
  applyContainerStyles() {
    if (!this.container) return;
    let t = this.options.pageGap ?? 24;
    ((this.container.style.display = 'flex'),
      (this.container.style.flexDirection = 'column'),
      (this.container.style.alignItems = 'center'),
      (this.container.style.gap = `${t}px`),
      (this.container.style.padding = `${t}px`),
      (this.container.style.backgroundColor =
        this.options.containerBackground ?? 'var(--doc-bg, #f8f9fa)'),
      (this.container.style.minHeight = '100%'));
  }
  paint(t) {
    if (!this.container) throw new Error('LayoutPainter: not mounted');
    let { pages: n } = t;
    ((this.totalPages = n.length), (this.container.innerHTML = ''), (this.pageStates = []));
    for (let o = 0; o < n.length; o++) {
      let r = n[o],
        i = { pageNumber: r.number, totalPages: this.totalPages, section: 'body' },
        a = this.renderPageWithLookup(r, i);
      (this.container.appendChild(a),
        this.pageStates.push({
          element: a,
          pageNumber: r.number,
          fragmentCount: r.fragments.length,
        }));
    }
  }
  renderPageWithLookup(t, n) {
    let o = this.doc.createElement('div');
    ((o.className = 'layout-page'),
      (o.dataset.pageNumber = String(t.number)),
      (o.style.position = 'relative'),
      (o.style.width = `${t.size.w}px`),
      (o.style.height = `${t.size.h}px`),
      (o.style.backgroundColor = this.options.pageBackground ?? '#ffffff'),
      (o.style.overflow = 'hidden'),
      this.options.showShadow && (o.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)'));
    let r = this.doc.createElement('div');
    ((r.className = 'layout-page-content'),
      (r.style.position = 'absolute'),
      (r.style.top = `${t.margins.top}px`),
      (r.style.left = `${t.margins.left}px`),
      (r.style.right = `${t.margins.right}px`),
      (r.style.bottom = `${t.margins.bottom}px`),
      (r.style.overflow = 'visible'));
    for (let i of t.fragments) {
      let a = this.renderFragmentWithLookup(i, n);
      (this.applyFragmentPosition(a, i), r.appendChild(a));
    }
    return (o.appendChild(r), o);
  }
  renderFragmentWithLookup(t, n) {
    let o = this.blockLookup.get(String(t.blockId));
    if (t.kind === 'paragraph' && o) {
      let r = o.block,
        i = o.measure;
      return Bn(t, r, i, n, { document: this.doc });
    }
    if (t.kind === 'table' && o) {
      let r = o.block,
        i = o.measure;
      return Fa(t, r, i, n, { document: this.doc });
    }
    if (t.kind === 'image' && o) {
      let r = o.block,
        i = o.measure;
      return La(t, r, i, n, { document: this.doc });
    }
    if (t.kind === 'textBox' && o) {
      let r = o.block,
        i = o.measure;
      return Ba(t, r, i, n, { document: this.doc });
    }
    return Nr(t, n, { document: this.doc });
  }
  applyFragmentPosition(t, n) {
    ((t.style.position = 'absolute'),
      (t.style.left = `${n.x}px`),
      (t.style.top = `${n.y}px`),
      (t.style.width = `${n.width}px`),
      'height' in n && (t.style.height = `${n.height}px`));
  }
  getPageCount() {
    return this.totalPages;
  }
  getPageElement(t) {
    return this.pageStates[t]?.element ?? null;
  }
  scrollToPage(t) {
    let n = this.pageStates.find((o) => o.pageNumber === t);
    n?.element && n.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
var Dn,
  Qn,
  eo,
  An,
  Jo,
  To,
  _p,
  Tl,
  za = class {
    constructor() {
      chunkH5NTJZO4_js.f(this, To);
      chunkH5NTJZO4_js.f(this, Dn, 0);
      chunkH5NTJZO4_js.f(this, Qn, 0);
      chunkH5NTJZO4_js.f(this, eo, false);
      chunkH5NTJZO4_js.f(this, An, null);
      chunkH5NTJZO4_js.f(this, Jo, new Set());
    }
    setStateSeq(t) {
      chunkH5NTJZO4_js.g(this, Dn, t);
    }
    incrementStateSeq() {
      return ++chunkH5NTJZO4_js.i(this, Dn)._;
    }
    getStateSeq() {
      return chunkH5NTJZO4_js.e(this, Dn);
    }
    getRenderSeq() {
      return chunkH5NTJZO4_js.e(this, Qn);
    }
    onLayoutStart() {
      chunkH5NTJZO4_js.g(this, eo, true);
    }
    onLayoutComplete(t) {
      (chunkH5NTJZO4_js.g(this, Qn, t),
        chunkH5NTJZO4_js.g(this, eo, false),
        chunkH5NTJZO4_js.h(this, To, _p).call(this));
    }
    isSafeToRender() {
      return (
        !chunkH5NTJZO4_js.e(this, eo) &&
        chunkH5NTJZO4_js.e(this, Qn) >= chunkH5NTJZO4_js.e(this, Dn)
      );
    }
    requestRender() {
      this.isSafeToRender()
        ? chunkH5NTJZO4_js.h(this, To, Tl).call(this)
        : chunkH5NTJZO4_js.g(this, An, () => chunkH5NTJZO4_js.h(this, To, Tl).call(this));
    }
    onRender(t) {
      return (
        chunkH5NTJZO4_js.e(this, Jo).add(t),
        () => {
          chunkH5NTJZO4_js.e(this, Jo).delete(t);
        }
      );
    }
    reset() {
      (chunkH5NTJZO4_js.g(this, Dn, 0),
        chunkH5NTJZO4_js.g(this, Qn, 0),
        chunkH5NTJZO4_js.g(this, eo, false),
        chunkH5NTJZO4_js.g(this, An, null));
    }
    getDebugInfo() {
      return {
        stateSeq: chunkH5NTJZO4_js.e(this, Dn),
        renderSeq: chunkH5NTJZO4_js.e(this, Qn),
        layoutUpdating: chunkH5NTJZO4_js.e(this, eo),
        hasPendingRender: chunkH5NTJZO4_js.e(this, An) !== null,
        isSafe: this.isSafeToRender(),
      };
    }
  };
((Dn = new WeakMap()),
  (Qn = new WeakMap()),
  (eo = new WeakMap()),
  (An = new WeakMap()),
  (Jo = new WeakMap()),
  (To = new WeakSet()),
  (_p = function () {
    if (chunkH5NTJZO4_js.e(this, An) && this.isSafeToRender()) {
      let t = chunkH5NTJZO4_js.e(this, An);
      (chunkH5NTJZO4_js.g(this, An, null), t());
    }
  }),
  (Tl = function () {
    for (let t of chunkH5NTJZO4_js.e(this, Jo))
      try {
        t();
      } catch (n) {
        console.error('LayoutSelectionGate: render callback error', n);
      }
  }));
var Up = '.layout-page-content .layout-line';
function Cx(e) {
  let t = e.parentElement;
  for (; t && t !== document.documentElement; ) {
    let { overflowY: n } = getComputedStyle(t);
    if ((n === 'auto' || n === 'scroll') && t.scrollHeight > t.clientHeight) return t;
    t = t.parentElement;
  }
  return null;
}
function vx(e) {
  let t = Cx(e);
  if (!t) return;
  let n = e.getBoundingClientRect(),
    o = t.getBoundingClientRect(),
    r = 40;
  n.bottom > o.bottom - r
    ? (t.scrollTop += n.bottom - o.bottom + r)
    : n.top < o.top + r && (t.scrollTop -= o.top - n.top + r);
}
function jp({ pagesContainerRef: e }) {
  let t = uf.useRef(null),
    n = uf.useRef(-1),
    o = uf.useCallback(
      (s) => {
        if (!e.current) return null;
        let l = e.current.querySelectorAll('span[data-pm-start][data-pm-end]');
        for (let d of Array.from(l)) {
          let c = d,
            p = Number(c.dataset.pmStart),
            f = Number(c.dataset.pmEnd);
          if (c.classList.contains('layout-run-tab')) {
            if (s >= p && s < f) return c.getBoundingClientRect().left;
            continue;
          }
          if (s >= p && s <= f && d.firstChild?.nodeType === Node.TEXT_NODE) {
            let m = d.firstChild,
              b = Math.min(s - p, m.length),
              g = c.ownerDocument;
            if (!g) continue;
            let x = g.createRange();
            return (x.setStart(m, b), x.setEnd(m, b), x.getBoundingClientRect().left);
          }
        }
        let u = e.current.querySelectorAll('.layout-empty-run');
        for (let d of Array.from(u)) {
          let c = d.closest('.layout-paragraph');
          if (!c) continue;
          let p = Number(c.dataset.pmStart),
            f = Number(c.dataset.pmEnd);
          if (s >= p && s <= f) return d.getBoundingClientRect().left;
        }
        return null;
      },
      [e]
    ),
    r = uf.useCallback(
      (s) => {
        if (!e.current) return null;
        let l = e.current.querySelectorAll(Up);
        for (let u of Array.from(l)) {
          let d = u,
            c = d.querySelectorAll('span[data-pm-start][data-pm-end]');
          for (let p of Array.from(c)) {
            let f = p,
              m = Number(f.dataset.pmStart),
              b = Number(f.dataset.pmEnd);
            if (s >= m && s <= b) return d;
          }
        }
        for (let u of Array.from(l)) {
          let d = u,
            c = d.closest('.layout-paragraph');
          if (!c) continue;
          let p = Number(c.dataset.pmStart),
            f = Number(c.dataset.pmEnd);
          if (s >= p && s <= f && c.querySelector('.layout-line') === d) return d;
        }
        return null;
      },
      [e]
    ),
    i = uf.useCallback((s, l) => {
      let u = s.querySelectorAll('span[data-pm-start][data-pm-end]');
      if (u.length === 0) {
        let f = s.closest('.layout-paragraph');
        return f?.dataset.pmStart ? Number(f.dataset.pmStart) + 1 : null;
      }
      for (let f of Array.from(u)) {
        let m = f,
          b = m.getBoundingClientRect(),
          g = Number(m.dataset.pmStart),
          x = Number(m.dataset.pmEnd);
        if (m.classList.contains('layout-run-tab')) {
          if (l >= b.left && l <= b.right) {
            let T = (b.left + b.right) / 2;
            return l < T ? g : x;
          }
          continue;
        }
        if (l >= b.left && l <= b.right) {
          let T = m.firstChild;
          if (!T || T.nodeType !== Node.TEXT_NODE) return g;
          let S = T,
            B = m.ownerDocument;
          if (!B) return g;
          let v = 0,
            M = S.length;
          for (; v < M; ) {
            let U = Math.floor((v + M) / 2),
              ee = B.createRange();
            (ee.setStart(S, U),
              ee.setEnd(S, U),
              l < ee.getBoundingClientRect().left ? (M = U) : (v = U + 1));
          }
          if (v > 0 && v <= S.length) {
            let U = B.createRange();
            (U.setStart(S, v - 1), U.setEnd(S, v - 1));
            let ee = U.getBoundingClientRect().left;
            (U.setStart(S, Math.min(v, S.length)), U.setEnd(S, Math.min(v, S.length)));
            let O = U.getBoundingClientRect().left;
            if (Math.abs(l - ee) < Math.abs(l - O)) return g + (v - 1);
          }
          return g + Math.min(v, x - g);
        }
      }
      let d = null,
        c = 1 / 0;
      for (let f of Array.from(u)) {
        let m = f,
          b = m.getBoundingClientRect(),
          g = l < b.left ? b.left - l : l - b.right;
        g < c && ((c = g), (d = m));
      }
      if (!d) return null;
      let p = d.getBoundingClientRect();
      return l < p.left ? Number(d.dataset.pmStart) : Number(d.dataset.pmEnd);
    }, []),
    a = uf.useCallback(
      (s, l) => {
        if (l.key !== 'ArrowUp' && l.key !== 'ArrowDown')
          return (
            (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(l.key) ||
              (l.key.length === 1 && !l.ctrlKey && !l.metaKey)) &&
              ((t.current = null), (n.current = -1)),
            false
          );
        if (l.ctrlKey || l.metaKey) return ((t.current = null), (n.current = -1), false);
        if (!e.current) return false;
        let u = Array.from(e.current.querySelectorAll(Up));
        if (u.length === 0) return false;
        let { from: d, anchor: c } = s.state.selection;
        if (t.current === null) {
          let S = o(d);
          if (S === null) return false;
          t.current = S;
        }
        let p;
        if (n.current >= 0 && n.current < u.length) p = n.current;
        else {
          let S = r(d);
          if (!S || ((p = u.indexOf(S)), p === -1)) return false;
        }
        let f = l.key === 'ArrowUp' ? p - 1 : p + 1;
        if (f < 0 || f >= u.length) return ((n.current = -1), false);
        let m = u[f],
          b = i(m, t.current);
        if (b === null) return false;
        n.current = f;
        let { state: g, dispatch: x } = s,
          T = Math.max(0, Math.min(b, g.doc.content.size));
        try {
          let S = l.shiftKey
            ? prosemirrorState.TextSelection.create(g.doc, c, T)
            : prosemirrorState.TextSelection.create(g.doc, T);
          x(g.tr.setSelection(S));
        } catch {
          let S = g.doc.resolve(T),
            B = l.shiftKey
              ? prosemirrorState.TextSelection.between(g.doc.resolve(c), S)
              : prosemirrorState.TextSelection.near(S);
          x(g.tr.setSelection(B));
        }
        return (vx(m), true);
      },
      [e, o, r, i]
    );
  return {
    stickyXRef: t,
    lastVisualLineIndexRef: n,
    getCaretClientX: o,
    findLineElementAtPosition: r,
    findPositionOnLineAtClientX: i,
    handlePMKeyDown: a,
  };
}
var to = 40,
  Va = 12;
function Rx(e) {
  let t = e.parentElement;
  for (; t && t !== document.documentElement; ) {
    let { overflowY: n } = getComputedStyle(t);
    if ((n === 'auto' || n === 'scroll') && t.scrollHeight > t.clientHeight) return t;
    t = t.parentElement;
  }
  return null;
}
function Gp({ pagesContainerRef: e, onScrollExtendSelection: t }) {
  let n = uf.useRef(null),
    o = uf.useRef({ x: 0, y: 0 }),
    r = uf.useRef(false),
    i = uf.useRef(null),
    a = uf.useCallback(() => {
      if (i.current) return i.current;
      let c = e.current;
      return c ? ((i.current = Rx(c)), i.current) : null;
    }, [e]),
    s = uf.useCallback(() => {
      ((r.current = false),
        n.current !== null && (cancelAnimationFrame(n.current), (n.current = null)));
    }, []),
    l = uf.useCallback(() => {
      if (!r.current) return;
      let c = a();
      if (!c) return;
      let p = c.getBoundingClientRect(),
        { x: f, y: m } = o.current,
        b = 0;
      if (m < p.top + to) {
        let g = Math.max(0, p.top + to - m);
        b = -Math.min(Va, (g / to) * Va);
      } else if (m > p.bottom - to) {
        let g = Math.max(0, m - (p.bottom - to));
        b = Math.min(Va, (g / to) * Va);
      }
      (b !== 0 && ((c.scrollTop += b), t(f, m)), (n.current = requestAnimationFrame(l)));
    }, [a, t]),
    u = uf.useCallback(() => {
      r.current || ((r.current = true), (n.current = requestAnimationFrame(l)));
    }, [l]);
  return {
    updateMousePosition: uf.useCallback(
      (c, p) => {
        if (((o.current = { x: c, y: p }), !r.current)) {
          let f = a();
          if (!f) return;
          let m = f.getBoundingClientRect();
          (p < m.top + to || p > m.bottom - to) && u();
        }
      },
      [a, u]
    ),
    stopAutoScroll: s,
  };
}
var Ex = 12,
  Ua = 8;
function Kp(e) {
  let t = [];
  for (let n of e)
    if (n.kind === 'paragraph')
      for (let o of n.runs)
        o.kind === 'text' &&
          o.footnoteRefId != null &&
          t.push({ footnoteId: o.footnoteRefId, pmPos: o.pmStart ?? 0 });
  return t;
}
function wl(e, t) {
  let n = new Map();
  if (t.length === 0) return n;
  for (let o of t)
    for (let r of e) {
      let i = false;
      for (let a of r.fragments) {
        let s = a.pmStart ?? -1,
          l = a.pmEnd ?? -1;
        if (s >= 0 && l >= 0 && o.pmPos >= s && o.pmPos < l) {
          let u = n.get(r.number) ?? [];
          (u.includes(o.footnoteId) || u.push(o.footnoteId), n.set(r.number, u), (i = true));
          break;
        }
      }
      if (i) break;
    }
  return n;
}
function Px(e, t, n) {
  let o = [];
  for (let a = 0; a < e.content.length; a++) {
    let s = e.content[a],
      l = [];
    if (a === 0) {
      let d = { kind: 'text', text: `${t}  `, fontSize: Ua, superscript: true };
      l.push(d);
    }
    for (let d of s.content) {
      let c = d;
      if (c.type === 'run' && Array.isArray(c.content)) {
        let p = c.formatting,
          f = {};
        if (p) {
          if (
            (p.bold && (f.bold = true),
            p.italic && (f.italic = true),
            p.underline && (f.underline = true),
            p.strike && (f.strike = true),
            p.color)
          ) {
            let m = p.color;
            m.val ? (f.color = `#${m.val}`) : m.rgb && (f.color = `#${m.rgb}`);
          }
          if ((p.fontSize && (f.fontSize = p.fontSize / 2), p.fontFamily)) {
            let m = p.fontFamily;
            f.fontFamily = m.ascii || m.hAnsi;
          }
        }
        f.fontSize || (f.fontSize = Ua);
        for (let m of c.content) {
          let b = m;
          b.type === 'text' && typeof b.text == 'string'
            ? l.push({ kind: 'text', text: b.text, ...f })
            : b.type === 'tab'
              ? l.push({ kind: 'tab', ...f })
              : b.type === 'break'
                ? l.push({ kind: 'lineBreak' })
                : b.type;
        }
      }
    }
    l.length === 0 && l.push({ kind: 'text', text: '', fontSize: Ua });
    let u = { kind: 'paragraph', id: `fn-${e.id}-p${a}`, runs: l };
    o.push(u);
  }
  o.length === 0 &&
    o.push({
      kind: 'paragraph',
      id: `fn-${e.id}-empty`,
      runs: [{ kind: 'text', text: '', fontSize: Ua }],
    });
  let r = [];
  for (let a of o)
    if (a.kind === 'paragraph') {
      let s = Tn(a, n);
      r.push(s);
    }
  let i = r.reduce((a, s) => (s.kind === 'paragraph' ? a + s.totalHeight : a), 0);
  return { id: e.id, displayNumber: t, blocks: o, measures: r, height: i };
}
function Yp(e, t, n) {
  let o = new Map(),
    r = new Map();
  for (let s of e) (s.noteType === 'normal' || s.noteType == null) && r.set(s.id, s);
  let i = 1,
    a = new Set();
  for (let s of t) {
    if (a.has(s.footnoteId)) continue;
    a.add(s.footnoteId);
    let l = r.get(s.footnoteId);
    if (!l) continue;
    let u = Px(l, i, n);
    (o.set(s.footnoteId, u), i++);
  }
  return o;
}
function qp(e, t) {
  let n = new Map();
  for (let [o, r] of e) {
    let i = 0;
    for (let a of r) {
      let s = t.get(a);
      s && (i += s.height);
    }
    i > 0 && ((i += Ex), n.set(o, i));
  }
  return n;
}
var Cl = class {
  constructor(t, n = 1) {
    chunkH5NTJZO4_js.d(this, 'pagesContainer');
    chunkH5NTJZO4_js.d(this, 'zoom');
    ((this.pagesContainer = t), (this.zoom = n));
  }
  getCoordinatesForPosition(t) {
    let n = this.pagesContainer.getBoundingClientRect(),
      o = this.pagesContainer.querySelectorAll('span[data-pm-start][data-pm-end]');
    for (let i of Array.from(o)) {
      let a = i,
        s = Number(a.dataset.pmStart),
        l = Number(a.dataset.pmEnd);
      if (a.classList.contains('layout-run-tab')) {
        if (t >= s && t < l) {
          let u = a.getBoundingClientRect(),
            d = a.closest('.layout-line'),
            c = d ? d.offsetHeight : 16;
          return {
            x: (u.left - n.left) / this.zoom,
            y: (u.top - n.top) / this.zoom,
            height: c / this.zoom,
          };
        }
        continue;
      }
      if (t >= s && t <= l && i.firstChild?.nodeType === Node.TEXT_NODE) {
        let u = i.firstChild,
          d = Math.min(t - s, u.length),
          c = a.ownerDocument;
        if (!c) continue;
        let p = c.createRange();
        (p.setStart(u, d), p.setEnd(u, d));
        let f = p.getBoundingClientRect(),
          m = a.closest('.layout-line'),
          b = m ? m.offsetHeight : 16;
        return {
          x: (f.left - n.left) / this.zoom,
          y: (f.top - n.top) / this.zoom,
          height: b / this.zoom,
        };
      }
    }
    let r = this.pagesContainer.querySelectorAll('.layout-empty-run');
    for (let i of Array.from(r)) {
      let a = i.closest('.layout-paragraph');
      if (!a) continue;
      let s = Number(a.dataset.pmStart),
        l = Number(a.dataset.pmEnd);
      if (t >= s && t <= l) {
        let u = i.getBoundingClientRect(),
          d = i.closest('.layout-line'),
          c = d ? d.offsetHeight : 16;
        return {
          x: (u.left - n.left) / this.zoom,
          y: (u.top - n.top) / this.zoom,
          height: c / this.zoom,
        };
      }
    }
    return null;
  }
  findElementsForRange(t, n) {
    let o = [],
      r = this.pagesContainer.querySelectorAll('span[data-pm-start][data-pm-end]');
    for (let i of Array.from(r)) {
      let a = i,
        s = Number(a.dataset.pmStart);
      Number(a.dataset.pmEnd) > t && s < n && o.push(a);
    }
    return o;
  }
  getRectsForRange(t, n) {
    let o = this.pagesContainer.getBoundingClientRect(),
      r = [],
      i = this.pagesContainer.querySelectorAll('span[data-pm-start][data-pm-end]');
    for (let a of Array.from(i)) {
      let s = a,
        l = Number(s.dataset.pmStart);
      if (Number(s.dataset.pmEnd) > t && l < n) {
        if (s.classList.contains('layout-run-tab')) {
          let m = s.getBoundingClientRect();
          r.push({
            x: (m.left - o.left) / this.zoom,
            y: (m.top - o.top) / this.zoom,
            width: m.width / this.zoom,
            height: m.height / this.zoom,
          });
          continue;
        }
        if (a.firstChild?.nodeType !== Node.TEXT_NODE) continue;
        let d = a.firstChild,
          c = s.ownerDocument;
        if (!c) continue;
        let p = Math.max(0, t - l),
          f = Math.min(d.length, n - l);
        if (p < f) {
          let m = c.createRange();
          (m.setStart(d, p), m.setEnd(d, f));
          let b = m.getClientRects();
          for (let g of Array.from(b))
            r.push({
              x: (g.left - o.left) / this.zoom,
              y: (g.top - o.top) / this.zoom,
              width: g.width / this.zoom,
              height: g.height / this.zoom,
            });
        }
      }
    }
    return r;
  }
  getContainerOffset() {
    let t = this.pagesContainer.parentElement;
    if (!t) return { x: 0, y: 0 };
    let n = this.pagesContainer.getBoundingClientRect(),
      o = t.getBoundingClientRect();
    return { x: (n.left - o.left) / this.zoom, y: (n.top - o.top) / this.zoom };
  }
};
function Xp(e, t = 1) {
  return new Cl(e, t);
}
var Bx = 816,
  ef = 1056,
  ja = { top: 96, right: 96, bottom: 96, left: 96 },
  Dx = 24,
  ro = 30,
  Ax = 200,
  Hx = [],
  Nx = {
    position: 'relative',
    width: '100%',
    minHeight: '100%',
    overflow: 'visible',
    backgroundColor: 'var(--doc-bg, #f8f9fa)',
  },
  tf = 24,
  Ox = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: tf,
    paddingBottom: 24,
  },
  zx = { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  $x = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
    overflow: 'visible',
    zIndex: 8,
  };
function Wx(e, t, n, o, r) {
  let i = new Map();
  if (!e?.state) return i;
  let { doc: a, schema: s } = e.state,
    l = s.marks.comment,
    u = s.marks.insertion,
    d = s.marks.deletion;
  if (!l && !u && !d) return i;
  let c = new Set(),
    p = tf + r;
  return (
    a.descendants((f, m) => {
      if (f.isText)
        for (let b of f.marks) {
          let g = null;
          if (
            (l && b.type === l
              ? (g = `comment-${b.attrs.commentId}`)
              : ((u && b.type === u) || (d && b.type === d)) &&
                (g = `revision-${b.attrs.revisionId}`),
            !g || c.has(g))
          )
            continue;
          c.add(g);
          let x = chunkQQ63M65M_js.p(t, n, o, m);
          if (x) {
            i.set(g, x.y + p);
            continue;
          }
          for (let T = 0; T < t.pages.length; T++) {
            let S = t.pages[T],
              B = false;
            for (let v of S.fragments) {
              let M = v.pmStart ?? 0,
                U = v.pmEnd ?? M;
              if (m < M || m > U) continue;
              let ee = v.kind === 'table' ? _x(n, o, v, m) : 0;
              (i.set(g, v.y + ee + chunkQQ63M65M_js.l(t, T) + p), (B = true));
              break;
            }
            if (B) break;
          }
        }
    }),
    i
  );
}
function _x(e, t, n, o) {
  let r = e.findIndex((l) => l.id === n.blockId);
  if (r === -1) return 0;
  let i = e[r],
    a = t[r];
  if (i.kind !== 'table' || a.kind !== 'table') return 0;
  let s = 0;
  for (let l = n.fromRow; l < n.toRow; l++) {
    let u = i.rows[l];
    if (
      !u ||
      u.cells.some((c) =>
        c.blocks.some((p) => {
          let f = p.pmStart ?? 0,
            m = p.pmEnd ?? f;
          return o >= f && o <= m;
        })
      )
    )
      break;
    s += a.rows[l]?.height ?? 0;
  }
  return s;
}
function ln(e) {
  return Math.round((e / 1440) * 96);
}
function Vx(e) {
  return { w: e?.pageWidth ? ln(e.pageWidth) : Bx, h: e?.pageHeight ? ln(e.pageHeight) : ef };
}
function Ux(e) {
  let t = e?.marginTop ? ln(e.marginTop) : ja.top,
    n = e?.marginBottom ? ln(e.marginBottom) : ja.bottom;
  return {
    top: t,
    right: e?.marginRight ? ln(e.marginRight) : ja.right,
    bottom: n,
    left: e?.marginLeft ? ln(e.marginLeft) : ja.left,
    header: e?.headerDistance ? ln(e.headerDistance) : 48,
    footer: e?.footerDistance ? ln(e.footerDistance) : 48,
  };
}
function jx(e) {
  let t = e?.columnCount ?? 1;
  if (t <= 1) return;
  let n = ln(e?.columnSpace ?? 720);
  return { count: t, gap: n, equalWidth: e?.equalWidth ?? true, separator: e?.separator };
}
function Gx(e, t, n) {
  function o(l, u) {
    return u.count <= 1 ? l : Math.floor((l - (u.count - 1) * u.gap) / u.count);
  }
  let r = [],
    i = [];
  for (let l = 0; l < e.length; l++)
    if (e[l].kind === 'sectionBreak') {
      r.push(l);
      let u = e[l];
      i.push(u.columns ?? { count: 1, gap: 0 });
    }
  i.push(n ?? { count: 1, gap: 0 });
  let a = 0,
    s = [];
  for (let l = 0; l < e.length; l++) {
    let u = i[a];
    (s.push(o(t, u)), a < r.length && l === r[a] && a++);
  }
  return s;
}
function Kx(e) {
  let t = e.wrapType,
    n = e.displayMode;
  return !!((t && ['square', 'tight', 'through'].includes(t)) || n === 'float');
}
function vl(e) {
  return e === void 0 ? 0 : Math.round((e * 96) / 914400);
}
function Yx(e, t, n) {
  if (e) {
    if (t === 'pct') return (n * e) / 5e3;
    if (t === 'dxa' || !t || t === 'auto') return Math.round((e / 20) * 1.333);
  }
}
function nf(e, t) {
  let i = e.columnWidths ?? [],
    a = Yx(e.width, e.widthType, t);
  if (i.length === 0 && e.rows.length > 0) {
    let c = e.rows[0].cells.reduce((m, b) => m + (b.colSpan ?? 1), 0),
      f = (a ?? t) / Math.max(1, c);
    i = Array(c).fill(f);
  } else if (i.length > 0 && a) {
    let c = i.reduce((p, f) => p + f, 0);
    if (c > 0 && Math.abs(c - a) > 1) {
      let p = a / c;
      i = i.map((f) => f * p);
    }
  }
  let s = new Map();
  for (let c = 0; c < e.rows.length; c++) {
    let p = e.rows[c];
    if (!p) continue;
    let f = 0,
      m = s.get(c) ?? new Set();
    for (; m.has(f); ) f++;
    for (let b of p.cells) {
      let g = b.colSpan ?? 1,
        x = b.rowSpan ?? 1;
      if (x > 1)
        for (let T = c + 1; T < c + x; T++) {
          s.has(T) || s.set(T, new Set());
          let S = s.get(T);
          for (let B = 0; B < g; B++) S.add(f + B);
        }
      for (f += g; m.has(f); ) f++;
    }
  }
  let l = e.rows.map((c, p) => {
    let f = 0,
      m = s.get(p) ?? new Set();
    for (; m.has(f); ) f++;
    return {
      cells: c.cells.map((b) => {
        let g = b.colSpan ?? 1,
          x = 0;
        for (let v = 0; v < g && f + v < i.length; v++) x += i[f + v] ?? 0;
        for (x === 0 && (x = b.width ?? 100), f += g; m.has(f); ) f++;
        let T = b.padding?.left ?? 7,
          S = b.padding?.right ?? 7,
          B = Math.max(1, x - T - S);
        return {
          blocks: b.blocks.map((v) => of(v, B)),
          width: x,
          height: 0,
          colSpan: b.colSpan,
          rowSpan: b.rowSpan,
        };
      }),
      height: 0,
    };
  });
  for (let c = 0; c < l.length; c++) {
    let p = l[c],
      f = e.rows[c]?.cells,
      m = 0;
    for (let T = 0; T < p.cells.length; T++) {
      let S = p.cells[T],
        B = f?.[T];
      S.height = S.blocks.reduce((U, ee) => ('totalHeight' in ee ? U + ee.totalHeight : U), 0);
      let v = B?.padding?.top ?? 1,
        M = B?.padding?.bottom ?? 1;
      ((S.height += v + M), (m = Math.max(m, S.height)));
    }
    let b = e.rows[c],
      g = b?.height,
      x = b?.heightRule;
    g && x === 'exact'
      ? (p.height = g)
      : g && x === 'atLeast'
        ? (p.height = Math.max(m, g))
        : (p.height = Math.max(m, 24));
  }
  let u = l.reduce((c, p) => c + p.height, 0),
    d = i.reduce((c, p) => c + p, 0) || a || t;
  return { kind: 'table', rows: l, columnWidths: i, totalWidth: d, totalHeight: u };
}
function qx(e, t) {
  let n = [];
  for (let o = 0; o < e.length; o++) {
    let r = e[o];
    if (r.kind !== 'paragraph') continue;
    let i = r;
    for (let a of i.runs) {
      if (a.kind !== 'image') continue;
      let s = a;
      if (!Kx(s)) continue;
      let l = 0,
        u = s.position,
        d = s.distTop ?? 0,
        c = s.distBottom ?? 0,
        p = s.distLeft ?? 12,
        f = s.distRight ?? 12;
      if (u?.vertical) {
        let x = u.vertical;
        x.align === 'top' && x.relativeTo === 'margin'
          ? (l = 0)
          : x.posOffset !== void 0 && (l = vl(x.posOffset));
      }
      let m = l + s.height,
        b = 0,
        g = 0;
      if (u?.horizontal) {
        let x = u.horizontal;
        if (x.align === 'left') b = s.width + f;
        else if (x.align === 'right') g = s.width + p;
        else if (x.posOffset !== void 0) {
          let T = vl(x.posOffset);
          T < t / 2 ? (b = T + s.width + f) : (g = t - T + p);
        }
      } else
        s.cssFloat === 'left' ? (b = s.width + f) : s.cssFloat === 'right' && (g = s.width + p);
      if (b > 0 || g > 0) {
        let x = u?.vertical?.relativeTo === 'margin' || u?.vertical?.relativeTo === 'page';
        n.push({
          leftMargin: b,
          rightMargin: g,
          topY: l - d,
          bottomY: m + c,
          anchorBlockIndex: o,
          isMarginRelative: x,
        });
      }
    }
  }
  for (let o = 0; o < e.length; o++) {
    let r = e[o];
    if (r.kind !== 'table') continue;
    let i = r,
      a = i.floating;
    if (!a) continue;
    let s = nf(i, t),
      l = s.totalWidth,
      u = s.totalHeight,
      d = a.leftFromText ?? 12,
      c = a.rightFromText ?? 12,
      p = a.topFromText ?? 0,
      f = a.bottomFromText ?? 0,
      m = 0,
      b = 0,
      g = 0;
    (a.tblpX !== void 0
      ? (g = a.tblpX)
      : a.tblpXSpec
        ? a.tblpXSpec === 'left' || a.tblpXSpec === 'inside'
          ? (g = 0)
          : a.tblpXSpec === 'right' || a.tblpXSpec === 'outside'
            ? (g = t - l)
            : a.tblpXSpec === 'center' && (g = (t - l) / 2)
        : i.justification === 'center'
          ? (g = (t - l) / 2)
          : i.justification === 'right' && (g = t - l),
      g < t / 2 ? (m = g + l + c) : (b = t - g + d));
    let x = a.tblpY ?? 0,
      T = x + u;
    n.push({ leftMargin: m, rightMargin: b, topY: x - p, bottomY: T + f, anchorBlockIndex: o });
  }
  return n;
}
function of(e, t, n, o) {
  switch (e.kind) {
    case 'paragraph': {
      let r = e;
      if (!n || n.length === 0) {
        let a = cl(r, t);
        if (a) return a;
      }
      let i = Tn(r, t, { floatingZones: n, paragraphYOffset: o ?? 0 });
      return ((!n || n.length === 0) && dl(r, t, i), i);
    }
    case 'table':
      return nf(e, t);
    case 'image': {
      let r = e;
      return { kind: 'image', width: r.width ?? 100, height: r.height ?? 100 };
    }
    case 'textBox': {
      let r = e,
        i = r.margins ?? chunkQQ63M65M_js.c,
        a = (r.width ?? chunkQQ63M65M_js.d) - i.left - i.right,
        s = r.content.map((d) => Tn(d, a)),
        l = s.reduce((d, c) => d + c.totalHeight, 0),
        u = r.height ?? l + i.top + i.bottom;
      return { kind: 'textBox', width: r.width ?? chunkQQ63M65M_js.d, height: u, innerMeasures: s };
    }
    case 'pageBreak':
      return { kind: 'pageBreak' };
    case 'columnBreak':
      return { kind: 'columnBreak' };
    case 'sectionBreak':
      return { kind: 'sectionBreak' };
    default:
      return { kind: 'paragraph', lines: [], totalHeight: 0 };
  }
}
function rf(e, t) {
  let n = Array.isArray(t) ? (t[0] ?? 0) : t,
    o = qx(e, n),
    r = o.filter((p) => p.isMarginRelative),
    i = o.filter((p) => !p.isMarginRelative),
    a = new Map();
  for (let p of r) {
    let f = a.get(p.topY) ?? [];
    (f.push(p), a.set(p.topY, f));
  }
  let s = [...i];
  for (let p of a.values()) {
    let f = Math.min(...p.map((m) => m.anchorBlockIndex));
    for (let m of p) s.push({ ...m, anchorBlockIndex: f });
  }
  let l = new Map();
  for (let p of s) {
    let f = l.get(p.anchorBlockIndex) ?? [];
    (f.push({
      leftMargin: p.leftMargin,
      rightMargin: p.rightMargin,
      topY: p.topY,
      bottomY: p.bottomY,
    }),
      l.set(p.anchorBlockIndex, f));
  }
  let u = new Set(s.map((p) => p.anchorBlockIndex)),
    d = 0,
    c = [];
  return e.map((p, f) => {
    u.has(f) && ((d = 0), (c = l.get(f) ?? []));
    let m = c.length > 0 ? c : void 0;
    try {
      let b = performance.now(),
        g = Array.isArray(t) ? (t[f] ?? n) : t,
        x = of(p, g, m, d),
        T = performance.now() - b;
      return (
        T > 500 && console.warn(`[measureBlocks] Block ${f} (${p.kind}) took ${Math.round(T)}ms`),
        'totalHeight' in x && ((p.kind === 'table' && p.floating) || (d += x.totalHeight)),
        x
      );
    } catch (b) {
      return (
        console.error(`[measureBlocks] Error measuring block ${f} (${p.kind}):`, b),
        { totalHeight: 20 }
      );
    }
  });
}
function Ga(e) {
  let t = [];
  for (let n of e) {
    let o = n;
    if (o.type === 'run' && Array.isArray(o.content)) {
      let r = o.formatting,
        i = {};
      if (r) {
        if (
          (r.bold && (i.bold = true),
          r.italic && (i.italic = true),
          r.underline && (i.underline = true),
          r.strike && (i.strike = true),
          r.color)
        ) {
          let a = r.color;
          a.val ? (i.color = `#${a.val}`) : a.rgb && (i.color = `#${a.rgb}`);
        }
        if ((r.fontSize && (i.fontSize = r.fontSize / 2), r.fontFamily)) {
          let a = r.fontFamily;
          i.fontFamily = a.ascii || a.hAnsi;
        }
      }
      for (let a of o.content) {
        let s = a;
        if (s.type === 'text' && typeof s.text == 'string')
          t.push({ kind: 'text', text: s.text, ...i });
        else if (s.type === 'tab') t.push({ kind: 'tab', ...i });
        else if (s.type === 'break') t.push({ kind: 'lineBreak' });
        else if (s.type === 'drawing' && s.image) {
          let l = s.image,
            u = l.size,
            d = (m) => Math.round((m / 914400) * 96),
            c = u?.width ? d(u.width) : 100,
            p = u?.height ? d(u.height) : 100,
            f = l.position;
          t.push({
            kind: 'image',
            src: l.src || '',
            width: c,
            height: p,
            alt: l.alt || void 0,
            position: f ? { horizontal: f.horizontal, vertical: f.vertical } : void 0,
          });
        }
      }
    }
    if (o.type === 'simpleField') {
      let r = o.fieldType,
        i = {};
      if (Array.isArray(o.content) && o.content.length > 0) {
        let a = o.content[0];
        if (a?.type === 'run' && a.formatting) {
          let s = a.formatting;
          if ((s.fontSize && (i.fontSize = s.fontSize / 2), s.fontFamily)) {
            let l = s.fontFamily;
            i.fontFamily = l.ascii || l.hAnsi;
          }
          if ((s.bold && (i.bold = true), s.italic && (i.italic = true), s.color)) {
            let l = s.color,
              u = l.rgb || l.val;
            u && (i.color = u.startsWith('#') ? u : `#${u}`);
          }
        }
      }
      if (r === 'PAGE') t.push({ kind: 'field', fieldType: 'PAGE', fallback: '1', ...i });
      else if (r === 'NUMPAGES')
        t.push({ kind: 'field', fieldType: 'NUMPAGES', fallback: '1', ...i });
      else if (Array.isArray(o.content)) {
        let a = Ga(o.content);
        t.push(...a);
      }
      continue;
    }
    if (o.type === 'complexField') {
      let r = o.fieldType,
        i = {};
      if (Array.isArray(o.fieldResult) && o.fieldResult.length > 0) {
        let a = o.fieldResult[0];
        if (a?.type === 'run' && a.formatting) {
          let s = a.formatting;
          if ((s.fontSize && (i.fontSize = s.fontSize / 2), s.fontFamily)) {
            let l = s.fontFamily;
            i.fontFamily = l.ascii || l.hAnsi;
          }
          if ((s.bold && (i.bold = true), s.italic && (i.italic = true), s.color)) {
            let l = s.color,
              u = l.rgb || l.val;
            u && (i.color = u.startsWith('#') ? u : `#${u}`);
          }
        }
      }
      if (r === 'PAGE') t.push({ kind: 'field', fieldType: 'PAGE', fallback: '1', ...i });
      else if (r === 'NUMPAGES')
        t.push({ kind: 'field', fieldType: 'NUMPAGES', fallback: '1', ...i });
      else if (Array.isArray(o.fieldResult)) {
        let a = Ga(o.fieldResult);
        t.push(...a);
      }
    }
    if (o.type === 'hyperlink' && Array.isArray(o.children)) {
      let r = Ga(o.children);
      t.push(...r);
    }
  }
  return t;
}
function Xx(e) {
  return e?.align ?? e?.alignment;
}
function Zx(e, t, n, o) {
  let r =
      o.section === 'header'
        ? (o.margins.header ?? 48)
        : o.pageSize.h - (o.margins.footer ?? 48) - n,
    i = e.position?.vertical;
  if (!i) return t;
  let a = Xx(i),
    s = i.posOffset !== void 0 ? vl(i.posOffset) : void 0;
  if (i.relativeTo === 'page') {
    if (s !== void 0) return s - r;
    if (a === 'top') return -r;
    if (a === 'bottom') return o.pageSize.h - e.height - r;
    if (a === 'center') return (o.pageSize.h - e.height) / 2 - r;
  }
  if (i.relativeTo === 'margin') {
    let l = o.margins.top,
      u = o.pageSize.h - o.margins.top - o.margins.bottom;
    if (s !== void 0) return l + s - r;
    if (a === 'top') return l - r;
    if (a === 'bottom') return l + u - e.height - r;
    if (a === 'center') return l + (u - e.height) / 2 - r;
  }
  return s !== void 0 ? t + s : t;
}
function Jx(e, t, n, o) {
  let r = 0,
    i = n,
    a = 0;
  for (let s = 0; s < e.length; s++) {
    let l = e[s],
      u = t[s];
    if (l?.kind !== 'paragraph' || u?.kind !== 'paragraph') continue;
    let d = l,
      c = a,
      p = c + u.totalHeight;
    ((r = Math.min(r, c)), (i = Math.max(i, p)));
    for (let f of d.runs) {
      if (f.kind !== 'image' || !f.position) continue;
      let m = f,
        b = Zx(m, c, n, o);
      ((r = Math.min(r, b)), (i = Math.max(i, b + m.height)));
    }
    a = p;
  }
  return { visualTop: r, visualBottom: i };
}
function Jp(e, t, n) {
  if (!e || !e.content || e.content.length === 0) return;
  let o = [];
  for (let u of e.content) {
    let d = u;
    if (d.type === 'paragraph' && Array.isArray(d.content)) {
      let c = d.formatting,
        p = {};
      if (c) {
        if (c.alignment) {
          let m = c.alignment;
          m === 'both'
            ? (p.alignment = 'justify')
            : ['left', 'center', 'right', 'justify'].includes(m) && (p.alignment = m);
        }
        if (c.borders) {
          let m = c.borders,
            b = {};
          for (let g of ['top', 'bottom', 'left', 'right', 'between']) {
            let x = m[g];
            if (x) {
              let T = Ra(x);
              T && (b[g] = T);
            }
          }
          Object.keys(b).length > 0 && (p.borders = b);
        }
        ((c.spaceAfter != null || c.spaceBefore != null) &&
          (p.spacing = { before: c.spaceBefore, after: c.spaceAfter }),
          Array.isArray(c.tabs) &&
            c.tabs.length > 0 &&
            (p.tabs = c.tabs.map((m) => ({
              val: m.alignment === 'left' ? 'start' : m.alignment === 'right' ? 'end' : m.alignment,
              pos: m.position,
              leader: m.leader,
            }))));
      }
      let f = Ga(d.content);
      if (f.length > 0) {
        let m = {
          kind: 'paragraph',
          id: String(o.length),
          runs: f,
          attrs: Object.keys(p).length > 0 ? p : void 0,
        };
        o.push(m);
      }
    }
  }
  if (o.length === 0) return;
  let r = o.map((u) => {
      if (u.kind !== 'paragraph') return u;
      let d = u;
      if (!d.runs.some((f) => f.kind === 'image' && 'position' in f && f.position)) return u;
      let p = d.runs.filter((f) => !(f.kind === 'image' && 'position' in f && f.position));
      return (p.length === 0 && p.push({ kind: 'text', text: '' }), { ...d, runs: p });
    }),
    i = rf(r, t),
    a = i.reduce((u, d) => (d.kind === 'paragraph' ? u + d.totalHeight : u), 0),
    { visualTop: s, visualBottom: l } = Jx(o, i, a, n);
  return { blocks: o, measures: i, height: a, visualTop: s, visualBottom: l };
}
function Qx(e, t, n) {
  let o = new Map();
  if (!n?.package?.footnotes) return o;
  let r = new Map();
  for (let i of n.package.footnotes) (i.noteType && i.noteType !== 'normal') || r.set(i.id, i);
  for (let [i, a] of e) {
    let s = [];
    for (let l of a) {
      let u = r.get(l);
      if (!u) continue;
      let c = t.get(l)?.displayNumber ?? 0,
        p = chunkZ2UPNKQW_js.b(u);
      s.push({ displayNumber: String(c), text: p });
    }
    s.length > 0 && o.set(i, s);
  }
  return o;
}
var eS = uf.forwardRef(function (t, n) {
    let {
        document: o,
        styles: r,
        theme: i,
        sectionProperties: a,
        headerContent: s,
        footerContent: l,
        readOnly: u = false,
        pageGap: d = Dx,
        zoom: c = 1,
        onDocumentChange: p,
        onSelectionChange: f,
        externalPlugins: m = Hx,
        extensionManager: b,
        onReady: g,
        onRenderedDomContextReady: x,
        pluginOverlays: T,
        onHeaderFooterDoubleClick: S,
        hfEditMode: B,
        onBodyClick: v,
        className: M,
        style: U,
        commentsSidebarOpen: ee = false,
        sidebarOverlay: O,
        scrollContainerRef: N,
        onHyperlinkClick: ne,
        onContextMenu: ce,
        onAnchorPositionsChange: D,
      } = t,
      z = uf.useCallback(() => (N && typeof N == 'object' ? N.current : ae.current), [N]),
      ae = uf.useRef(null),
      se = uf.useRef(null),
      A = uf.useRef(null),
      Ie = uf.useRef(null),
      { handlePMKeyDown: Fe } = jp({ pagesContainerRef: se }),
      Ue = uf.useRef(() => {}),
      P = uf.useRef(f),
      F = uf.useRef(p),
      k = uf.useRef(g),
      L = uf.useRef(x);
    ((P.current = f), (F.current = p), (k.current = g), (L.current = x));
    let [I, E] = uf.useState(null),
      [Z, le] = uf.useState([]),
      [_, J] = uf.useState([]),
      [oe, fe] = uf.useState(false),
      [Ce, R] = uf.useState([]),
      [K, H] = uf.useState(null),
      [ge, he] = uf.useState(null),
      ye = uf.useRef(false),
      De = uf.useCallback(
        (w, W) => {
          let Y = w.tagName === 'IMG' ? w : w.querySelector('img'),
            G = (Y ?? w).getBoundingClientRect();
          return {
            element: Y ?? w,
            pmPos: W,
            width: Math.round(G.width / c),
            height: Math.round(G.height / c),
          };
        },
        [c]
      ),
      xe = uf.useRef(false),
      pe = uf.useRef(null),
      Ae = uf.useRef(false),
      Ge = uf.useRef(0),
      Ve = uf.useRef(0),
      rt = uf.useRef(0),
      Ke = uf.useRef({ left: 0, right: 0 }),
      Xe = uf.useRef(null),
      Pt = uf.useRef(false),
      ze = uf.useRef(0),
      Ft = uf.useRef(0),
      je = uf.useRef(0),
      bt = uf.useRef(0),
      Ut = uf.useRef(null),
      Eo = uf.useRef(false),
      tn = uf.useRef(false),
      tr = uf.useRef(0),
      Nn = uf.useRef(0),
      nr = uf.useRef(0),
      Po = uf.useRef(0),
      Xt = uf.useRef(null),
      Cn = uf.useRef(false),
      ut = uf.useRef(null),
      un = uf.useRef(null),
      Bt = uf.useRef(null),
      Dt = 5,
      [jt, St] = uf.useState(null),
      At = uf.useRef(null),
      de = uf.useCallback(() => {
        At.current && (clearTimeout(At.current), (At.current = null));
      }, []);
    uf.useEffect(
      () => () => {
        At.current && clearTimeout(At.current);
      },
      []
    );
    let Gt = uf.useMemo(() => new za(), []),
      pn = uf.useMemo(() => Vx(a), [a]),
      kt = uf.useMemo(() => Ux(a), [a]),
      or = uf.useMemo(() => jx(a), [a]),
      Le = pn.w - kt.left - kt.right,
      Zt = uf.useMemo(() => new Oa({ pageGap: d, showShadow: true, pageBackground: '#fff' }), [d]);
    Ie.current = Zt;
    let ct = uf.useCallback(
        (w) => {
          let W = performance.now(),
            Y = Gt.getStateSeq();
          Gt.onLayoutStart();
          try {
            let G = performance.now(),
              re = pn.h - kt.top - kt.bottom,
              q = hp(w.doc, { theme: i, pageContentHeight: re }),
              te = performance.now() - G;
            (te > 500 &&
              console.warn(
                `[PagedEditor] toFlowBlocks took ${Math.round(te)}ms (${q.length} blocks)`
              ),
              le(q),
              (G = performance.now()));
            let ie = Gx(q, Le, or),
              ue = rf(q, ie);
            ((te = performance.now() - G),
              te > 1e3 &&
                console.warn(
                  `[PagedEditor] measureBlocks took ${Math.round(te)}ms (${q.length} blocks)`
                ),
              J(ue));
            let Te = Kp(q),
              ke = Te.length > 0 && o?.package?.footnotes,
              ve = Jp(s, Le, { section: 'header', pageSize: pn, margins: kt }),
              Pe = Jp(l, Le, { section: 'footer', pageSize: pn, margins: kt }),
              Re = kt.header ?? 48,
              Be = kt.footer ?? 48,
              Ye = kt.top - Re,
              pt = kt.bottom - Be,
              ft = ve?.visualBottom ?? ve?.height ?? 0,
              Jt = Pe
                ? Math.max((Pe.visualBottom ?? Pe.height) - (Pe.visualTop ?? 0), Pe.height)
                : 0,
              zn = kt;
            if (ft > Ye || Jt > pt) {
              zn = { ...kt };
              let Kt = 8;
              (ft > Ye && (zn.top = Math.max(kt.top, Re + ft + Kt)),
                Jt > pt && (zn.bottom = Math.max(kt.bottom, Be + Jt + Kt)));
            }
            G = performance.now();
            let nn,
              co = new Map(),
              Ao = new Map(),
              ns = a?.sectionStart,
              cr = { pageSize: pn, margins: zn, columns: or, bodyBreakType: ns, pageGap: d };
            if (ke) {
              let Kt = chunkQQ63M65M_js.e(q, ue, cr);
              ((co = wl(Kt.pages, Te)), (Ao = Yp(o.package.footnotes, Te, Le)));
              let uo = qp(co, Ao);
              if (uo.size > 0) {
                ((nn = chunkQQ63M65M_js.e(q, ue, { ...cr, footnoteReservedHeights: uo })),
                  (co = wl(nn.pages, Te)));
                for (let [mn, po] of co) {
                  let fo = nn.pages.find((os) => os.number === mn);
                  fo && (fo.footnoteIds = po);
                }
              } else nn = Kt;
            } else nn = chunkQQ63M65M_js.e(q, ue, cr);
            if (
              ((te = performance.now() - G),
              te > 500 &&
                console.warn(
                  `[PagedEditor] layoutDocument took ${Math.round(te)}ms (${nn.pages.length} pages)`
                ),
              E(nn),
              se.current && Ie.current)
            ) {
              G = performance.now();
              let Kt = new Map();
              for (let mn = 0; mn < q.length; mn++) {
                let po = q[mn],
                  fo = ue[mn];
                po && fo && Kt.set(String(po.id), { block: po, measure: fo });
              }
              Ie.current.setBlockLookup(Kt);
              let uo = ke ? Qx(co, Ao, o) : void 0;
              if (
                (kl(nn.pages, se.current, {
                  pageGap: d,
                  showShadow: !0,
                  pageBackground: '#fff',
                  blockLookup: Kt,
                  headerContent: ve,
                  footerContent: Pe,
                  headerDistance: a?.headerDistance ? ln(a.headerDistance) : void 0,
                  footerDistance: a?.footerDistance ? ln(a.footerDistance) : void 0,
                  pageBorders: a?.pageBorders,
                  theme: i,
                  footnotesByPage: uo?.size ? uo : void 0,
                }),
                (te = performance.now() - G),
                te > 500 && console.warn(`[PagedEditor] renderPages took ${Math.round(te)}ms`),
                x)
              ) {
                let mn = Xp(se.current, c);
                x(mn);
              }
            }
            if (D) {
              let Kt = Wx(A.current?.getView() ?? null, nn, q, ue, d);
              D(Kt);
            }
            let Yr = performance.now() - W;
            Yr > 2e3 &&
              console.warn(
                `[PagedEditor] Layout pipeline took ${Math.round(Yr)}ms total (${q.length} blocks, ${ue.length} measures)`
              );
          } catch (G) {
            console.error('[PagedEditor] Layout pipeline error:', G);
          }
          Gt.onLayoutComplete(Y);
        },
        [Le, or, pn, kt, d, c, Gt, s, l, a, x, o]
      ),
      Tt = uf.useRef(null),
      rr = uf.useCallback(
        (w) => {
          if (Tt.current) {
            Tt.current.state = w;
            return;
          }
          let W = requestAnimationFrame(() => {
            let Y = Tt.current;
            ((Tt.current = null), Y && ct(Y.state));
          });
          Tt.current = { rafId: W, state: w };
        },
        [ct]
      );
    uf.useEffect(
      () => () => {
        Tt.current && (cancelAnimationFrame(Tt.current.rafId), (Tt.current = null));
      },
      []
    );
    let ir = uf.useCallback((w, W = 1) => {
        if (!se.current) return null;
        let Y = se.current.parentElement?.querySelector('[data-testid="selection-overlay"]');
        if (!Y) return null;
        let G = Y.getBoundingClientRect(),
          re = se.current.querySelectorAll('span[data-pm-start][data-pm-end]');
        for (let te of Array.from(re)) {
          let ie = te,
            ue = Number(ie.dataset.pmStart),
            Te = Number(ie.dataset.pmEnd);
          if (ie.classList.contains('layout-run-tab')) {
            if (w >= ue && w < Te) {
              let ke = ie.getBoundingClientRect(),
                ve = ie.closest('.layout-page'),
                Pe = ve ? Number(ve.dataset.pageNumber) - 1 : 0,
                Re = ie.closest('.layout-line'),
                Be = Re ? Re.offsetHeight : 16;
              return {
                x: (ke.left - G.left) / W,
                y: (ke.top - G.top) / W,
                height: Be,
                pageIndex: Pe,
              };
            }
            continue;
          }
          if (w >= ue && w <= Te && te.firstChild?.nodeType === Node.TEXT_NODE) {
            let ke = te.firstChild,
              ve = Math.min(w - ue, ke.length),
              Pe = ie.ownerDocument;
            if (!Pe) continue;
            let Re = Pe.createRange();
            (Re.setStart(ke, ve), Re.setEnd(ke, ve));
            let Be = Re.getBoundingClientRect(),
              Ye = ie.closest('.layout-page'),
              pt = Ye ? Number(Ye.dataset.pageNumber) - 1 : 0,
              ft = ie.closest('.layout-line'),
              Jt = ft ? ft.offsetHeight : 16;
            return {
              x: (Be.left - G.left) / W,
              y: (Be.top - G.top) / W,
              height: Jt,
              pageIndex: pt,
            };
          }
        }
        let q = se.current.querySelectorAll('.layout-empty-run');
        for (let te of Array.from(q)) {
          let ie = te.closest('.layout-paragraph');
          if (!ie) continue;
          let ue = Number(ie.dataset.pmStart),
            Te = Number(ie.dataset.pmEnd);
          if (w >= ue && w <= Te) {
            let ke = te.getBoundingClientRect(),
              ve = ie.closest('.layout-page'),
              Pe = ve ? Number(ve.dataset.pageNumber) - 1 : 0,
              Re = te.closest('.layout-line'),
              Be = Re ? Re.offsetHeight : 16;
            return {
              x: (ke.left - G.left) / W,
              y: (ke.top - G.top) / W,
              height: Be,
              pageIndex: Pe,
            };
          }
        }
        return null;
      }, []),
      Lt = uf.useCallback(
        (w) => {
          let { from: W, to: Y } = w.selection;
          if ((P.current?.(W, Y), se.current)) {
            let G = se.current.querySelectorAll('.layout-table-cell-selected');
            for (let te of Array.from(G)) te.classList.remove('layout-table-cell-selected');
            let re = w.selection;
            if ('$anchorCell' in re && typeof re.forEachCell == 'function') {
              let te = [];
              re.forEachCell((ue, Te) => {
                te.push([Te, Te + ue.nodeSize]);
              });
              let ie = se.current.querySelectorAll('.layout-table-cell');
              for (let ue of Array.from(ie)) {
                let Te = ue,
                  ke = Te.dataset.pmStart;
                if (ke !== void 0) {
                  let ve = Number(ke);
                  for (let [Pe, Re] of te)
                    if (ve >= Pe && ve < Re) {
                      Te.classList.add('layout-table-cell-selected');
                      break;
                    }
                }
              }
            }
          }
          if (!(!I || Z.length === 0))
            if (W === Y) {
              let G = ir(W, c);
              if (G) H(G);
              else {
                let re = se.current?.parentElement?.querySelector(
                    '[data-testid="selection-overlay"]'
                  ),
                  q = se.current?.querySelector('.layout-page');
                if (re && q) {
                  let te = re.getBoundingClientRect(),
                    ie = q.getBoundingClientRect(),
                    ue = chunkQQ63M65M_js.p(I, Z, _, W);
                  H(
                    ue
                      ? {
                          ...ue,
                          x: ue.x + (ie.left - te.left) / c,
                          y: ue.y + (ie.top - te.top) / c,
                        }
                      : null
                  );
                } else H(null);
              }
              R([]);
            } else {
              let G = se.current?.parentElement?.querySelector('[data-testid="selection-overlay"]');
              if (G && se.current) {
                let re = G.getBoundingClientRect(),
                  q = [],
                  te = se.current.querySelectorAll('span[data-pm-start][data-pm-end]');
                for (let ie of Array.from(te)) {
                  let ue = ie,
                    Te = Number(ue.dataset.pmStart);
                  if (Number(ue.dataset.pmEnd) > W && Te < Y) {
                    if (ue.classList.contains('layout-run-tab')) {
                      let Ye = ue.getBoundingClientRect(),
                        pt = ue.closest('.layout-page'),
                        ft = pt ? Number(pt.dataset.pageNumber) - 1 : 0;
                      q.push({
                        x: (Ye.left - re.left) / c,
                        y: (Ye.top - re.top) / c,
                        width: Ye.width / c,
                        height: Ye.height / c,
                        pageIndex: ft,
                      });
                      continue;
                    }
                    let ve = null;
                    if (
                      (ie.firstChild?.nodeType === Node.TEXT_NODE
                        ? (ve = ie.firstChild)
                        : ie.firstChild?.nodeType === Node.ELEMENT_NODE &&
                          ie.firstChild.tagName === 'A' &&
                          ie.firstChild.firstChild?.nodeType === Node.TEXT_NODE &&
                          (ve = ie.firstChild.firstChild),
                      !ve)
                    )
                      continue;
                    let Pe = ue.ownerDocument;
                    if (!Pe) continue;
                    let Re = Math.max(0, W - Te),
                      Be = Math.min(ve.length, Y - Te);
                    if (Re < Be) {
                      let Ye = Pe.createRange();
                      (Ye.setStart(ve, Re), Ye.setEnd(ve, Be));
                      let pt = Ye.getClientRects();
                      for (let ft of Array.from(pt)) {
                        let Jt = ue.closest('.layout-page'),
                          zn = Jt ? Number(Jt.dataset.pageNumber) - 1 : 0;
                        q.push({
                          x: (ft.left - re.left) / c,
                          y: (ft.top - re.top) / c,
                          width: ft.width / c,
                          height: ft.height / c,
                          pageIndex: zn,
                        });
                      }
                    }
                  }
                }
                if (q.length > 0) R(q);
                else {
                  let ie = se.current.querySelector('.layout-page');
                  if (ie) {
                    let ue = ie.getBoundingClientRect(),
                      Te = (ue.left - re.left) / c,
                      ke = (ue.top - re.top) / c,
                      Pe = chunkQQ63M65M_js
                        .o(I, Z, _, W, Y)
                        .map((Re) => ({ ...Re, x: Re.x + Te, y: Re.y + ke }));
                    R(Pe);
                  } else R([]);
                }
              } else R([]);
              H(null);
            }
        },
        [I, Z, _, ir, c]
      ),
      On = uf.useCallback(
        (w, W) => {
          if (w.docChanged) {
            (Gt.incrementStateSeq(), rr(W));
            let Y = A.current?.getDocument();
            Y && F.current?.(Y);
          }
          (Gt.requestRender(), w.docChanged || Lt(W));
        },
        [rr, Lt, Gt]
      ),
      Za = uf.useCallback(
        (w) => {
          let { selection: W } = w;
          (W instanceof prosemirrorState.NodeSelection && W.node.type.name === 'image'
            ? (R([]), H(null))
            : Gt.isSafeToRender() && Lt(w),
            requestAnimationFrame(() => {
              let Y = A.current?.getView();
              if (!Y) {
                he(null);
                return;
              }
              let { selection: G } = Y.state;
              if (G instanceof prosemirrorState.NodeSelection && G.node.type.name === 'image') {
                let re = G.from,
                  q = se.current?.querySelector(`[data-pm-start="${re}"]`);
                if (q) {
                  he(De(q, re));
                  return;
                }
              }
              ye.current || he(null);
            }));
        },
        [Lt, c, De, Gt]
      ),
      wt = uf.useCallback(
        (w, W) => {
          if (!se.current || !I) return null;
          let Y = Ep(se.current, w, W, c);
          if (Y !== null) return Y;
          let G = se.current.querySelectorAll('.layout-page'),
            re = -1,
            q = null;
          for (let ve = 0; ve < G.length; ve++) {
            let Re = G[ve].getBoundingClientRect();
            if (w >= Re.left && w <= Re.right && W >= Re.top && W <= Re.bottom) {
              ((re = ve), (q = Re));
              break;
            }
          }
          if (re < 0 || !q) return null;
          let te = (w - q.left) / c,
            ie = (W - q.top) / c,
            ue = I.pages[re];
          if (!ue) return null;
          let Te = { pageIndex: re, page: ue, pageY: ie },
            ke = chunkQQ63M65M_js.m(Te, Z, _, { x: te, y: ie });
          if (!ke) return null;
          if (ke.fragment.kind === 'table') {
            let ve = chunkQQ63M65M_js.n(Te, Z, _, { x: te, y: ie });
            return pl(ke, ve);
          }
          return pl(ke);
        },
        [I, Z, _, c]
      ),
      vn = uf.useCallback((w) => {
        let W = A.current?.getView();
        if (!W) return null;
        try {
          let Y = W.state.doc.resolve(w);
          for (let G = Y.depth; G > 0; G--) {
            let re = Y.node(G);
            if (re.type.name === 'tableCell' || re.type.name === 'tableHeader') return Y.before(G);
          }
        } catch {}
        return null;
      }, []),
      ar = uf.useCallback((w) => {
        let W = ['layout-block-image', 'layout-image', 'layout-page-floating-image'],
          Y = (G) => !!G.dataset.pmStart && W.some((re) => G.classList.contains(re));
        return w.tagName === 'IMG' && w.classList.contains('layout-run-image')
          ? w
          : w.tagName === 'IMG' && w.parentElement && Y(w.parentElement)
            ? w.parentElement
            : Y(w)
              ? w
              : null;
      }, []),
      Rn = uf.useCallback((w) => {
        let W = se.current;
        if (!W) return;
        let Y = W.querySelector(`[data-pm-start="${w}"]`);
        Y && Y.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, []),
      Ht = uf.useCallback(
        (w) => {
          if (!A.current) return;
          if (w.button === 2) {
            w.preventDefault();
            return;
          }
          if (
            w.button !== 0 ||
            (St(null), de(), w.target.closest('a[href]') && w.preventDefault(), u)
          )
            return;
          if (B && v) {
            let q = w.target;
            if (
              !(
                q.closest('.layout-page-header') ||
                q.closest('.layout-page-footer') ||
                q.closest('.hf-inline-editor')
              )
            ) {
              (w.preventDefault(), w.stopPropagation(), v());
              return;
            }
          }
          if (!B) {
            let q = w.target;
            if (q.closest('.layout-page-header') || q.closest('.layout-page-footer')) {
              (w.preventDefault(),
                A.current && (A.current.setSelection(0), A.current.focus(), fe(true)));
              return;
            }
          }
          let Y = w.target;
          if (Y.classList.contains('layout-table-resize-handle')) {
            (w.preventDefault(),
              w.stopPropagation(),
              (Ae.current = true),
              (Ge.current = w.clientX),
              (Xe.current = Y),
              Y.classList.add('dragging'));
            let q = parseInt(Y.dataset.columnIndex ?? '0', 10);
            ((Ve.current = q), (rt.current = parseInt(Y.dataset.tablePmStart ?? '0', 10)));
            let te = A.current.getView();
            if (te) {
              let ie = te.state.doc.resolve(rt.current + 1);
              for (let ue = ie.depth; ue >= 0; ue--) {
                let Te = ie.node(ue);
                if (Te.type.name === 'table') {
                  let ke = Te.attrs.columnWidths;
                  ke &&
                    ke[q] !== void 0 &&
                    ke[q + 1] !== void 0 &&
                    (Ke.current = { left: ke[q], right: ke[q + 1] });
                  break;
                }
              }
            }
            return;
          }
          if (
            Y.classList.contains('layout-table-row-resize-handle') ||
            Y.classList.contains('layout-table-edge-handle-bottom')
          ) {
            (w.preventDefault(),
              w.stopPropagation(),
              (Pt.current = true),
              (ze.current = w.clientY),
              (Ut.current = Y),
              (Eo.current = Y.dataset.isEdge === 'bottom'),
              Y.classList.add('dragging'));
            let q = parseInt(Y.dataset.rowIndex ?? '0', 10);
            ((Ft.current = q), (je.current = parseInt(Y.dataset.tablePmStart ?? '0', 10)));
            let te = A.current.getView();
            if (te) {
              let ie = te.state.doc.resolve(je.current + 1);
              for (let ue = ie.depth; ue >= 0; ue--) {
                let Te = ie.node(ue);
                if (Te.type.name === 'table') {
                  let ke = null,
                    ve = 0;
                  if (
                    (Te.forEach((Pe) => {
                      (ve === q && (ke = Pe), ve++);
                    }),
                    ke)
                  ) {
                    let Pe = ke.attrs.height;
                    if (Pe) bt.current = Pe;
                    else {
                      let Be = Y.closest('.layout-table')?.querySelector(`[data-row-index="${q}"]`),
                        Ye = Be ? Be.getBoundingClientRect().height : 30;
                      bt.current = Math.round(Ye * 15);
                    }
                  }
                  break;
                }
              }
            }
            return;
          }
          if (Y.classList.contains('layout-table-edge-handle-right')) {
            (w.preventDefault(),
              w.stopPropagation(),
              (tn.current = true),
              (tr.current = w.clientX),
              (Xt.current = Y),
              Y.classList.add('dragging'));
            let q = parseInt(Y.dataset.columnIndex ?? '0', 10);
            ((Nn.current = q), (nr.current = parseInt(Y.dataset.tablePmStart ?? '0', 10)));
            let te = A.current.getView();
            if (te) {
              let ie = te.state.doc.resolve(nr.current + 1);
              for (let ue = ie.depth; ue >= 0; ue--) {
                let Te = ie.node(ue);
                if (Te.type.name === 'table') {
                  let ke = Te.attrs.columnWidths;
                  ke && ke[q] !== void 0 && (Po.current = ke[q]);
                  break;
                }
              }
            }
            return;
          }
          let G = ar(Y);
          if (G) {
            (w.preventDefault(), w.stopPropagation());
            let q = G.dataset.pmStart;
            if (q !== void 0) {
              let te = parseInt(q, 10);
              (A.current.setNodeSelection(te), he(De(G, te)), R([]), H(null));
            }
            (A.current.focus(), fe(true));
            return;
          }
          (he(null), w.preventDefault());
          let re = wt(w.clientX, w.clientY);
          if (re !== null) {
            let q = vn(re);
            ((ut.current = q),
              (Cn.current = false),
              (un.current = null),
              (Bt.current = null),
              (xe.current = true),
              (pe.current = re),
              A.current.setSelection(re));
          } else {
            ((ut.current = null), (Cn.current = false));
            let q = A.current.getView();
            if (q) {
              let te = Math.max(0, q.state.doc.content.size - 1);
              (A.current.setSelection(te), (pe.current = te), (xe.current = true));
            }
          }
          (A.current.focus(), fe(true));
        },
        [wt, vn, u, B, v, c, ne, de]
      ),
      jr = uf.useCallback((w, W) => {
        Ue.current(w, W);
      }, []),
      { updateMousePosition: Mo, stopAutoScroll: fn } = Gp({
        pagesContainerRef: se,
        onScrollExtendSelection: jr,
      });
    Ue.current = (w, W) => {
      if (!xe.current || pe.current === null || !A.current) return;
      let Y = wt(w, W);
      Y !== null && A.current.setSelection(pe.current, Y);
    };
    let Io = uf.useCallback(
        (w) => {
          if (Ae.current) {
            w.preventDefault();
            let G = w.clientX - Ge.current;
            if (Xe.current) {
              let re = parseFloat(Xe.current.style.left);
              ((Xe.current.style.left = `${re + G}px`), (Ge.current = w.clientX));
              let q = Math.round(G * 15),
                te = 300,
                ie = Ke.current.left + q,
                ue = Ke.current.right - q;
              ie >= te && ue >= te && (Ke.current = { left: ie, right: ue });
            }
            return;
          }
          if (Pt.current) {
            w.preventDefault();
            let G = w.clientY - ze.current;
            if (Ut.current) {
              let re = parseFloat(Ut.current.style.top);
              ((Ut.current.style.top = `${re + G}px`), (ze.current = w.clientY));
              let q = Math.round(G * 15),
                te = 200,
                ie = bt.current + q;
              ie >= te && (bt.current = ie);
            }
            return;
          }
          if (tn.current) {
            w.preventDefault();
            let G = w.clientX - tr.current;
            if (Xt.current) {
              let re = parseFloat(Xt.current.style.left);
              ((Xt.current.style.left = `${re + G}px`), (tr.current = w.clientX));
              let q = Math.round(G * 15),
                te = 300,
                ie = Po.current + q;
              ie >= te && (Po.current = ie);
            }
            return;
          }
          if (!xe.current || pe.current === null || !A.current || !se.current) return;
          Mo(w.clientX, w.clientY);
          let W = wt(w.clientX, w.clientY);
          if (W === null) return;
          if (ut.current !== null) {
            if (Cn.current) {
              let re = vn(W);
              if (re !== null) {
                A.current.setCellSelection(ut.current, re);
                return;
              }
            }
            let G = vn(W);
            if (G !== null && G !== ut.current) {
              ((Cn.current = true), A.current.setCellSelection(ut.current, G), (Bt.current = null));
              return;
            }
            if (un.current !== null && W === un.current) {
              if (Bt.current === null) Bt.current = w.clientX;
              else if (Math.abs(w.clientX - Bt.current) >= Dt) {
                ((Cn.current = true),
                  A.current.setCellSelection(ut.current, ut.current),
                  (Bt.current = null));
                return;
              }
            } else ((Bt.current = null), (un.current = W));
          }
          let Y = pe.current;
          A.current.setSelection(Y, W);
        },
        [wt, vn, Mo]
      ),
      En = uf.useCallback(() => {
        if (Ae.current) {
          ((Ae.current = false),
            Xe.current && (Xe.current.classList.remove('dragging'), (Xe.current = null)));
          let w = A.current?.getView();
          if (w) {
            let W = rt.current,
              Y = Ve.current,
              { left: G, right: re } = Ke.current,
              q = w.state.doc.resolve(W + 1);
            for (let te = q.depth; te >= 0; te--) {
              let ie = q.node(te);
              if (ie.type.name === 'table') {
                let ue = q.before(te),
                  Te = w.state.tr,
                  ke = [...ie.attrs.columnWidths];
                ((ke[Y] = G),
                  (ke[Y + 1] = re),
                  Te.setNodeMarkup(ue, void 0, { ...ie.attrs, columnWidths: ke }));
                let ve = ue + 1;
                (ie.forEach((Pe) => {
                  let Re = ve + 1,
                    Be = 0;
                  (Pe.forEach((Ye) => {
                    let pt = Ye.attrs.colspan || 1;
                    if (Be === Y || Be === Y + 1) {
                      let ft = Be === Y ? G : re;
                      Te.setNodeMarkup(Te.mapping.map(Re), void 0, {
                        ...Ye.attrs,
                        width: ft,
                        widthType: 'dxa',
                        colwidth: null,
                      });
                    }
                    ((Re += Ye.nodeSize), (Be += pt));
                  }),
                    (ve += Pe.nodeSize));
                }),
                  w.dispatch(Te));
                break;
              }
            }
          }
          return;
        }
        if (Pt.current) {
          ((Pt.current = false),
            Ut.current && (Ut.current.classList.remove('dragging'), (Ut.current = null)));
          let w = A.current?.getView();
          if (w) {
            let W = je.current,
              Y = Ft.current,
              G = bt.current,
              re = w.state.doc.resolve(W + 1);
            for (let q = re.depth; q >= 0; q--) {
              let te = re.node(q);
              if (te.type.name === 'table') {
                let ie = re.before(q),
                  ue = w.state.tr,
                  Te = ie + 1,
                  ke = 0;
                (te.forEach((ve) => {
                  (ke === Y &&
                    ue.setNodeMarkup(ue.mapping.map(Te), void 0, {
                      ...ve.attrs,
                      height: G,
                      heightRule: 'atLeast',
                    }),
                    (Te += ve.nodeSize),
                    ke++);
                }),
                  w.dispatch(ue));
                break;
              }
            }
          }
          return;
        }
        if (tn.current) {
          ((tn.current = false),
            Xt.current && (Xt.current.classList.remove('dragging'), (Xt.current = null)));
          let w = A.current?.getView();
          if (w) {
            let W = nr.current,
              Y = Nn.current,
              G = Po.current,
              re = w.state.doc.resolve(W + 1);
            for (let q = re.depth; q >= 0; q--) {
              let te = re.node(q);
              if (te.type.name === 'table') {
                let ie = re.before(q),
                  ue = w.state.tr,
                  Te = [...te.attrs.columnWidths];
                ((Te[Y] = G), ue.setNodeMarkup(ie, void 0, { ...te.attrs, columnWidths: Te }));
                let ke = ie + 1;
                (te.forEach((ve) => {
                  let Pe = ke + 1,
                    Re = 0;
                  (ve.forEach((Be) => {
                    let Ye = Be.attrs.colspan || 1;
                    (Re === Y &&
                      ue.setNodeMarkup(ue.mapping.map(Pe), void 0, {
                        ...Be.attrs,
                        width: G,
                        widthType: 'dxa',
                        colwidth: null,
                      }),
                      (Pe += Be.nodeSize),
                      (Re += Ye));
                  }),
                    (ke += ve.nodeSize));
                }),
                  w.dispatch(ue));
                break;
              }
            }
          }
          return;
        }
        ((xe.current = false),
          (Cn.current = false),
          (un.current = null),
          (Bt.current = null),
          fn());
      }, [fn]);
    uf.useEffect(
      () => (
        window.addEventListener('mousemove', Io),
        window.addEventListener('mouseup', En),
        () => {
          (window.removeEventListener('mousemove', Io), window.removeEventListener('mouseup', En));
        }
      ),
      [Io, En]
    );
    let Ja = uf.useCallback(
        (w) => {
          if (u || xe.current || Ae.current || Pt.current || tn.current || Cn.current) return;
          let W = se.current;
          if (!W) return;
          let Y = w.clientX,
            G = w.clientY,
            re = w.target.closest('.layout-table');
          if (!re) {
            let Pe = W.querySelectorAll('.layout-table');
            for (let Re of Array.from(Pe)) {
              let Be = Re.getBoundingClientRect(),
                Ye = Y >= Be.left - ro && Y < Be.left,
                pt = G >= Be.top - ro && G < Be.top,
                ft = Y >= Be.left - ro && Y <= Be.right,
                Jt = G >= Be.top - ro && G <= Be.bottom;
              if ((Ye && Jt) || (pt && ft)) {
                re = Re;
                break;
              }
            }
          }
          if (!re) {
            St(null);
            return;
          }
          let q = re.getBoundingClientRect(),
            te = Y < q.left + ro && Y >= q.left - ro,
            ie = G < q.top + ro && G >= q.top - ro;
          if (!te && !ie) {
            St(null);
            return;
          }
          let ue = re.querySelectorAll(':scope > .layout-table-row');
          if (ue.length === 0) {
            St(null);
            return;
          }
          let Te = W.parentElement;
          if (!Te) return;
          let ke = Te.getBoundingClientRect(),
            ve = (Pe) => (Pe && Number(Pe.dataset.pmStart)) || 0;
          if (te)
            for (let Pe = 0; Pe < ue.length; Pe++) {
              let Re = ue[Pe].getBoundingClientRect();
              if (G >= Re.top && G <= Re.bottom) {
                let Be = ue[Pe].querySelector('.layout-table-cell'),
                  Ye = ve(Be);
                if (!Ye) break;
                let pt = Re.top + Re.height / 2;
                (St({ type: 'row', x: q.left - ke.left - 24, y: pt - ke.top - 10, cellPmPos: Ye }),
                  de());
                return;
              }
            }
          if (ie) {
            let Pe = ue[0].querySelectorAll(':scope > .layout-table-cell');
            for (let Re = 0; Re < Pe.length; Re++) {
              let Be = Pe[Re].getBoundingClientRect();
              if (Y >= Be.left && Y <= Be.right) {
                let Ye = ve(Pe[Re]);
                if (!Ye) break;
                let pt = Be.left + Be.width / 2;
                (St({
                  type: 'column',
                  x: pt - ke.left - 10,
                  y: q.top - ke.top - 24,
                  cellPmPos: Ye,
                }),
                  de());
                return;
              }
            }
          }
          At.current ||
            (At.current = setTimeout(() => {
              (St(null), (At.current = null));
            }, Ax));
        },
        [u, de]
      ),
      He = uf.useCallback(
        (w) => {
          if ((w.preventDefault(), w.stopPropagation(), !jt || !A.current)) return;
          let W = A.current.getView();
          if (!W) return;
          let { type: Y, cellPmPos: G } = jt,
            re = W.state.tr.setSelection(prosemirrorState.TextSelection.create(W.state.doc, G + 1));
          (W.dispatch(re),
            Y === 'row' ? yo(W.state, W.dispatch) : xo(W.state, W.dispatch),
            St(null),
            A.current.focus());
        },
        [jt]
      ),
      Qe = uf.useCallback(
        (w) => {
          let W = w.target.closest('a[href]');
          if (W) {
            w.preventDefault();
            let Y = W.getAttribute('href') || '';
            if (Y.startsWith('#')) {
              let G = Y.substring(1);
              if (G && A.current) {
                let re = A.current.getView();
                if (re) {
                  let q = null;
                  (re.state.doc.descendants((te, ie) => {
                    if (q !== null) return false;
                    if (
                      te.type.name === 'paragraph' &&
                      te.attrs.bookmarks?.some((Te) => Te.name === G)
                    )
                      return ((q = ie), false);
                  }),
                    q !== null && (Rn(q), A.current.setSelection(q + 1)));
                }
              }
            } else if (ne) {
              let G = A.current?.getView();
              if (!(G && G.state.selection.from !== G.state.selection.to)) {
                let q = W.textContent || '',
                  te = W.getAttribute('title') || void 0,
                  ie = W.getBoundingClientRect();
                ne({ href: Y, displayText: q, tooltip: te, anchorRect: ie });
              }
            }
            return;
          }
          if (w.detail === 2 && S) {
            let Y = w.target,
              G = Y.closest('.layout-page-header'),
              re = Y.closest('.layout-page-footer');
            if (G) {
              (w.preventDefault(), w.stopPropagation(), S('header'));
              return;
            }
            if (re) {
              (w.preventDefault(), w.stopPropagation(), S('footer'));
              return;
            }
          }
          if (w.detail === 2 && A.current) {
            let Y = wt(w.clientX, w.clientY);
            if (Y !== null) {
              let G = vn(Y);
              if (G !== null) {
                (w.preventDefault(), w.stopPropagation(), A.current.setCellSelection(G, G));
                return;
              }
              let re = A.current.getView();
              if (re) {
                let { doc: q } = re.state,
                  te = q.resolve(Y),
                  ie = te.parent;
                if (ie.isTextblock) {
                  let ue = ie.textContent,
                    Te = te.parentOffset,
                    ke = Te;
                  for (; ke > 0 && /\w/.test(ue[ke - 1]); ) ke--;
                  let ve = Te;
                  for (; ve < ue.length && /\w/.test(ue[ve]); ) ve++;
                  let Pe = te.start() + ke,
                    Re = te.start() + ve;
                  Pe < Re && A.current.setSelection(Pe, Re);
                }
              }
            }
          }
          if (w.detail === 3 && A.current) {
            let Y = wt(w.clientX, w.clientY);
            if (Y !== null) {
              let G = A.current.getView();
              if (G) {
                let { doc: re } = G.state,
                  q = re.resolve(Y),
                  te = q.start(q.depth),
                  ie = q.end(q.depth);
                A.current.setSelection(te, ie);
              }
            }
          }
        },
        [wt, S, ne]
      ),
      Qa = uf.useCallback(
        (w) => {
          if (!ce) return;
          w.preventDefault();
          let W = A.current?.getView();
          if (!W) return;
          let { from: Y, to: G } = W.state.selection,
            re = wt(w.clientX, w.clientY);
          re !== null &&
            (Y === G || re < Y || re > G) &&
            (A.current?.setSelection(re), A.current?.focus(), fe(true));
          let q = A.current?.getState(),
            te = q ? q.selection.from !== q.selection.to : false;
          ce({ x: w.clientX, y: w.clientY, hasSelection: te });
        },
        [ce, wt]
      ),
      es = uf.useCallback(
        (w) => {
          u || w.target.closest('.docx-comments-sidebar') || (A.current?.focus(), fe(true));
        },
        [u]
      ),
      yt = uf.useCallback((w) => {
        let W = w.relatedTarget;
        (W && ae.current?.contains(W)) ||
          W?.closest(
            '[role="toolbar"], [data-radix-popper-content-wrapper], [data-radix-select-content], .docx-table-options-dropdown'
          ) ||
          fe(false);
      }, []),
      Ct = uf.useCallback((w, W, Y) => {
        let G = A.current?.getView();
        if (G)
          try {
            let re = G.state.doc.nodeAt(w);
            if (!re || re.type.name !== 'image') return;
            let q = G.state.tr.setNodeMarkup(w, void 0, { ...re.attrs, width: W, height: Y });
            (G.dispatch(q), A.current?.setNodeSelection(w));
          } catch {}
      }, []),
      Gr = uf.useCallback(() => {
        ye.current = true;
      }, []),
      Kr = uf.useCallback(() => {
        ye.current = false;
      }, []),
      ts = uf.useCallback(
        (w, W, Y) => {
          let G = A.current?.getView();
          if (G)
            try {
              let re = G.state.doc.nodeAt(w);
              if (!re || re.type.name !== 'image') return;
              if (
                re.attrs.displayMode === 'float' ||
                (re.attrs.wrapType && ['square', 'tight', 'through'].includes(re.attrs.wrapType))
              ) {
                let te = se.current?.querySelectorAll('.layout-page');
                if (!te || te.length === 0) return;
                let ie = null;
                for (let pt of te) {
                  let ft = pt.getBoundingClientRect();
                  if (Y >= ft.top && Y <= ft.bottom) {
                    ie = pt.querySelector('.layout-page-content');
                    break;
                  }
                }
                if ((ie || (ie = te[te.length - 1].querySelector('.layout-page-content')), !ie))
                  return;
                let ue = ie.getBoundingClientRect(),
                  Te = (W - ue.left) / c,
                  ke = (Y - ue.top) / c,
                  ve = 914400 / 96,
                  Pe = Math.round(Te * ve),
                  Re = Math.round(ke * ve),
                  Be = {
                    horizontal: { posOffset: Pe, relativeTo: 'margin' },
                    vertical: { posOffset: Re, relativeTo: 'margin' },
                  },
                  Ye = G.state.tr.setNodeMarkup(w, void 0, { ...re.attrs, position: Be });
                (G.dispatch(Ye), A.current?.setNodeSelection(w));
              } else {
                let te = wt(W, Y);
                if (te === null || te === w || te === w + 1) return;
                let ie = G.state.tr;
                if (te <= w)
                  ((ie = ie.delete(w, w + re.nodeSize)),
                    (ie = ie.insert(te, re)),
                    A.current?.setNodeSelection(te));
                else {
                  ie = ie.delete(w, w + re.nodeSize);
                  let ue = te - re.nodeSize;
                  ((ie = ie.insert(Math.min(ue, ie.doc.content.size), re)),
                    A.current?.setNodeSelection(Math.min(ue, ie.doc.content.size - 1)));
                }
                G.dispatch(ie);
              }
            } catch {}
        },
        [wt, c]
      ),
      Fo = uf.useCallback(() => {
        ye.current = true;
      }, []),
      Lo = uf.useCallback(() => {
        ye.current = false;
      }, []),
      sr = uf.useCallback(
        (w) => {
          if (!u) {
            if (
              (A.current?.isFocused() || (A.current?.focus(), fe(true)),
              w.key === ' ' && !w.ctrlKey && !w.metaKey && !w.nativeEvent.isComposing)
            ) {
              w.preventDefault();
              let W = A.current?.getView();
              if (W) {
                let { from: Y, to: G } = W.state.selection;
                W.someProp('handleTextInput', (q) => q(W, Y, G, ' ')) ||
                  W.dispatch(W.state.tr.insertText(' '));
              }
              return;
            }
            if (
              (['PageUp', 'PageDown'].includes(w.key) && !w.metaKey && w.ctrlKey,
              w.key === 'Home' && (w.metaKey || w.ctrlKey))
            ) {
              let W = z();
              W && (W.scrollTop = 0);
            }
            if (w.key === 'End' && (w.metaKey || w.ctrlKey)) {
              let W = z();
              W && (W.scrollTop = W.scrollHeight);
            }
          }
        },
        [u, z]
      ),
      Bo = uf.useCallback(
        (w) => {
          u ||
            w.target.closest('.docx-comments-sidebar') ||
            A.current?.isFocused() ||
            (A.current?.focus(), fe(true));
        },
        [u]
      ),
      lo = uf.useCallback(
        (w) => {
          (ct(w.state),
            Lt(w.state),
            u ||
              requestAnimationFrame(() => {
                (w.focus(), fe(true));
              }));
        },
        [ct, Lt, u]
      );
    uf.useEffect(() => {
      let w = () => {
        let W = A.current?.getView();
        W && (chunkQQ63M65M_js.f(), ul(), ct(W.state), Lt(W.state));
      };
      return (
        window.document.fonts.addEventListener('loadingdone', w),
        () => {
          window.document.fonts.removeEventListener('loadingdone', w);
        }
      );
    }, []);
    let Do = uf.useRef(0);
    (uf.useEffect(() => {
      if (Do.current === 0) {
        Do.current = 1;
        return;
      }
      let w = A.current?.getView();
      w && ct(w.state);
    }, [s, l, ct]),
      uf.useEffect(() => {
        let w = ae.current;
        if (!w) return;
        let W = new ResizeObserver(() => {
          let Y = A.current?.getState();
          Y && Lt(Y);
        });
        return (W.observe(w), () => W.disconnect());
      }, [Lt]),
      uf.useImperativeHandle(
        n,
        () => ({
          getDocument() {
            return A.current?.getDocument() ?? null;
          },
          replaceContent(w, W) {
            A.current?.replaceContent(w, W);
          },
          getState() {
            return A.current?.getState() ?? null;
          },
          getView() {
            return A.current?.getView() ?? null;
          },
          focus() {
            (A.current?.focus(), fe(true));
          },
          blur() {
            (A.current?.blur(), fe(false));
          },
          isFocused() {
            return A.current?.isFocused() ?? false;
          },
          dispatch(w) {
            A.current?.dispatch(w);
          },
          undo() {
            return A.current?.undo() ?? false;
          },
          redo() {
            return A.current?.redo() ?? false;
          },
          setSelection(w, W) {
            A.current?.setSelection(w, W);
          },
          getLayout() {
            return I;
          },
          relayout() {
            let w = A.current?.getState();
            w && ct(w);
          },
          scrollToPosition: Rn,
        }),
        [I, ct, Rn]
      ),
      uf.useEffect(() => {
        let w = A.current?.getState();
        I && w && Lt(w);
      }, [I, Lt]),
      uf.useEffect(() => {
        k.current &&
          A.current &&
          k.current({
            getDocument: () => A.current?.getDocument() ?? null,
            replaceContent: (w, W) => A.current?.replaceContent(w, W),
            getState: () => A.current?.getState() ?? null,
            getView: () => A.current?.getView() ?? null,
            focus: () => {
              (A.current?.focus(), fe(true));
            },
            blur: () => {
              (A.current?.blur(), fe(false));
            },
            isFocused: () => A.current?.isFocused() ?? false,
            dispatch: (w) => A.current?.dispatch(w),
            undo: () => A.current?.undo() ?? false,
            redo: () => A.current?.redo() ?? false,
            setSelection: (w, W) => A.current?.setSelection(w, W),
            getLayout: () => I,
            relayout: () => {
              let w = A.current?.getState();
              w && ct(w);
            },
            scrollToPosition: Rn,
          });
      }, [I, ct]));
    let lr = uf.useMemo(() => {
      if (!I) return ef + 48;
      let w = I.pages.length;
      return w * pn.h + (w - 1) * d + 48;
    }, [I, pn.h, d]);
    return jsxRuntime.jsxs('div', {
      ref: ae,
      className: `ep-root paged-editor ${M ?? ''}`,
      style: { ...Nx, ...U },
      tabIndex: 0,
      onFocus: es,
      onBlur: yt,
      onKeyDown: sr,
      onMouseDown: Bo,
      children: [
        jsxRuntime.jsx(sp, {
          ref: A,
          document: o,
          styles: r,
          widthPx: Le,
          readOnly: u,
          onTransaction: On,
          onSelectionChange: Za,
          externalPlugins: m,
          extensionManager: b,
          onEditorViewReady: lo,
          onKeyDown: Fe,
        }),
        jsxRuntime.jsxs('div', {
          style: {
            ...Ox,
            minHeight: lr,
            transform: (() => {
              let w = [];
              return (
                ee && w.push('translateX(-120px)'),
                c !== 1 && w.push(`scale(${c})`),
                w.length > 0 ? w.join(' ') : void 0
              );
            })(),
            transformOrigin: 'top center',
            transition: 'transform 0.2s ease',
          },
          children: [
            jsxRuntime.jsx('div', {
              ref: se,
              className: `paged-editor__pages${u ? ' paged-editor--readonly' : ''}${B ? ` paged-editor--hf-editing paged-editor--editing-${B}` : ''}`,
              style: zx,
              onMouseDown: Ht,
              onMouseMove: Ja,
              onClick: Qe,
              onContextMenu: Qa,
              'aria-hidden': 'true',
            }),
            jsxRuntime.jsx(cp, {
              selectionRects: Ce,
              caretPosition: K,
              isFocused: oe,
              pageGap: d,
              readOnly: u,
            }),
            jsxRuntime.jsx(mp, {
              imageInfo: ge,
              zoom: c,
              isFocused: oe,
              onResize: Ct,
              onResizeStart: Gr,
              onResizeEnd: Kr,
              onDragMove: ts,
              onDragStart: Fo,
              onDragEnd: Lo,
            }),
            jt &&
              jsxRuntime.jsx('button', {
                type: 'button',
                onMouseDown: He,
                onMouseEnter: de,
                onMouseLeave: () => St(null),
                style: {
                  position: 'absolute',
                  left: jt.x,
                  top: jt.y,
                  width: 20,
                  height: 20,
                  borderRadius: '4px',
                  border: '1px solid #dadce0',
                  backgroundColor: '#f8f9fa',
                  color: '#5f6368',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 200,
                  padding: 0,
                  boxShadow: 'none',
                },
                title: jt.type === 'row' ? 'Insert row below' : 'Insert column to the right',
                'aria-label': jt.type === 'row' ? 'Insert row below' : 'Insert column to the right',
                children: jsxRuntime.jsx('svg', {
                  width: '12',
                  height: '12',
                  viewBox: '0 0 12 12',
                  fill: 'none',
                  children: jsxRuntime.jsx('path', {
                    d: 'M6 1v10M1 6h10',
                    stroke: 'currentColor',
                    strokeWidth: '1.5',
                    strokeLinecap: 'round',
                  }),
                }),
              }),
            T &&
              jsxRuntime.jsx('div', {
                className: 'paged-editor__plugin-overlays',
                style: $x,
                children: T,
              }),
          ],
        }),
        O,
      ],
    });
  }),
  af = uf.memo(eS);
var rS = uf.lazy(() => import('./FindReplaceDialog-AQFR4OCT.js')),
  iS = uf.lazy(() => import('./HyperlinkDialog-HGZ2S37Z.js')),
  aS = uf.lazy(() =>
    import('./TablePropertiesDialog-STZOGHJB.js').then((e) => ({
      default: e.TablePropertiesDialog,
    }))
  ),
  sS = uf.lazy(() =>
    import('./ImagePositionDialog-DQ4JWS4F.js').then((e) => ({ default: e.ImagePositionDialog }))
  ),
  lS = uf.lazy(() =>
    import('./ImagePropertiesDialog-GJMGLM6G.js').then((e) => ({
      default: e.ImagePropertiesDialog,
    }))
  ),
  cS = uf.lazy(() =>
    import('./FootnotePropertiesDialog-YYIZU5U6.js').then((e) => ({
      default: e.FootnotePropertiesDialog,
    }))
  ),
  dS = uf.lazy(() =>
    import('./PageSetupDialog-ZZTFPZKJ.js').then((e) => ({ default: e.PageSetupDialog }))
  ),
  sf = [
    { value: 'editing', label: 'Editing', icon: 'edit_note', desc: 'Edit document directly' },
    {
      value: 'suggesting',
      label: 'Suggesting',
      icon: 'rate_review',
      desc: 'Edits become suggestions',
    },
    { value: 'viewing', label: 'Viewing', icon: 'visibility', desc: 'Read-only, no edits' },
  ];
function fS({ mode: e, onModeChange: t }) {
  let [n, o] = uf.useState(false),
    [r, i] = uf.useState(false),
    a = uf.useRef(null),
    s = uf.useRef(null),
    [l, u] = uf.useState({ top: 0, left: 0 }),
    d = sf.find((c) => c.value === e);
  return (
    uf.useEffect(() => {
      let c = window.matchMedia('(max-width: 1400px)');
      i(c.matches);
      let p = (f) => i(f.matches);
      return (c.addEventListener('change', p), () => c.removeEventListener('change', p));
    }, []),
    uf.useEffect(() => {
      if (!n || !a.current) return;
      let c = a.current.getBoundingClientRect();
      u({ top: c.bottom + 2, left: c.right - 220 });
    }, [n]),
    uf.useEffect(() => {
      if (!n) return;
      let c = (f) => {
          !a.current?.contains(f.target) && !s.current?.contains(f.target) && o(false);
        },
        p = (f) => {
          f.key === 'Escape' && o(false);
        };
      return (
        document.addEventListener('mousedown', c),
        document.addEventListener('keydown', p),
        () => {
          (document.removeEventListener('mousedown', c),
            document.removeEventListener('keydown', p));
        }
      );
    }, [n]),
    jsxRuntime.jsxs('div', {
      style: { position: 'relative' },
      children: [
        jsxRuntime.jsxs('button', {
          ref: a,
          type: 'button',
          onMouseDown: (c) => c.preventDefault(),
          onClick: () => o(!n),
          title: `${d.label} (Ctrl+Shift+E)`,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: r ? 0 : 4,
            padding: r ? '2px 4px' : '2px 6px 2px 4px',
            border: 'none',
            background: n ? 'var(--doc-hover, #f3f4f6)' : 'transparent',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 400,
            color: 'var(--doc-text, #374151)',
            whiteSpace: 'nowrap',
            height: 28,
          },
          children: [
            jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: d.icon, size: 18 }),
            !r && jsxRuntime.jsx('span', { children: d.label }),
            jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: 'arrow_drop_down', size: 16 }),
          ],
        }),
        n &&
          jsxRuntime.jsx('div', {
            ref: s,
            onMouseDown: (c) => c.preventDefault(),
            style: {
              position: 'fixed',
              top: l.top,
              left: l.left,
              backgroundColor: 'white',
              border: '1px solid var(--doc-border, #d1d5db)',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
              padding: '4px 0',
              zIndex: 1e4,
              minWidth: 220,
            },
            children: sf.map((c) =>
              jsxRuntime.jsxs(
                'button',
                {
                  type: 'button',
                  onMouseDown: (p) => p.preventDefault(),
                  onClick: () => {
                    (t(c.value), o(false));
                  },
                  onMouseOver: (p) => {
                    p.currentTarget.style.backgroundColor = 'var(--doc-hover, #f3f4f6)';
                  },
                  onMouseOut: (p) => {
                    p.currentTarget.style.backgroundColor = 'transparent';
                  },
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--doc-text, #374151)',
                    width: '100%',
                    textAlign: 'left',
                  },
                  children: [
                    jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: c.icon, size: 20 }),
                    jsxRuntime.jsxs('span', {
                      style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
                      children: [
                        jsxRuntime.jsx('span', { style: { fontWeight: 500 }, children: c.label }),
                        jsxRuntime.jsx('span', {
                          style: { fontSize: 11, color: 'var(--doc-text-muted, #9ca3af)' },
                          children: c.desc,
                        }),
                      ],
                    }),
                    c.value === e &&
                      jsxRuntime.jsx(chunkEOTZWQND_js.d, {
                        name: 'check',
                        size: 18,
                        style: { marginLeft: 'auto', color: '#1a73e8' },
                      }),
                  ],
                },
                c.value
              )
            ),
          }),
      ],
    })
  );
}
var mS = Date.now(),
  Ka = -1,
  lf = new Map();
function cf(e, t, n) {
  if (!e || !t) return null;
  let o = e.querySelector('.paged-editor__pages');
  if (!o) return null;
  let r = o.querySelectorAll('[data-pm-start]');
  for (let i of r) {
    let a = i,
      s = Number(a.dataset.pmStart),
      l = Number(a.dataset.pmEnd);
    if (n >= s && n <= l) return a.getBoundingClientRect().top - t.getBoundingClientRect().top;
  }
  return null;
}
function Rl(e, t, n) {
  return {
    id: mS++,
    author: t,
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        formatting: {},
        content: [{ type: 'run', formatting: {}, content: [{ type: 'text', text: e }] }],
      },
    ],
    ...(n !== void 0 && { parentId: n }),
  };
}
var df = uf.forwardRef(function (
  {
    documentBuffer: t,
    document: n,
    onSave: o,
    author: r = 'User',
    onChange: i,
    onSelectionChange: a,
    onError: s,
    onFontsLoaded: l,
    theme: u,
    showToolbar: d = true,
    showZoomControl: c = true,
    showMarginGuides: p = false,
    marginGuideColor: f,
    showRuler: m = false,
    rulerUnit: b = 'inch',
    initialZoom: g = 1,
    readOnly: x = false,
    toolbarExtra: T,
    className: S = '',
    style: B,
    placeholder: v,
    loadingIndicator: M,
    showOutline: U = false,
    showPrintButton: ee = true,
    printOptions: O,
    onPrint: N,
    onCopy: ne,
    onCut: ce,
    onPaste: D,
    mode: z,
    onModeChange: ae,
    externalPlugins: se,
    onEditorViewReady: A,
    onRenderedDomContextReady: Ie,
    pluginOverlays: Fe,
    renderLogo: Ue,
    documentName: P,
    onDocumentNameChange: F,
    documentNameEditable: k = true,
    renderTitleBarRight: L,
  },
  I
) {
  let [E, Z] = uf.useState({
      isLoading: !!t,
      parseError: null,
      zoom: g,
      selectionFormatting: {},
      paragraphIndentLeft: 0,
      paragraphIndentRight: 0,
      paragraphFirstLineIndent: 0,
      paragraphHangingIndent: false,
      paragraphTabs: null,
      pmTableContext: null,
      pmImageContext: null,
    }),
    [le, _] = uf.useState(false),
    [J, oe] = uf.useState(false),
    [fe, Ce] = uf.useState(false),
    [R, K] = uf.useState(false),
    [H, ge] = uf.useState(null),
    [he, ye] = uf.useState(U),
    De = uf.useRef(false);
  De.current = he;
  let [xe, pe] = uf.useState([]),
    Ae = uf.useRef(null),
    Ge = uf.useRef(null),
    [Ve, rt] = uf.useState(false),
    [Ke, Xe] = uf.useState([]),
    [Pt, ze] = uf.useState([]),
    [Ft, je] = uf.useState(lf),
    [bt, Ut] = uf.useState(false),
    [Eo, tn] = uf.useState(null),
    [tr, Nn] = uf.useState(null),
    [nr, Po] = uf.useState(z ?? 'editing'),
    Xt = z ?? nr,
    Cn = (y) => {
      (z || Po(y), ae?.(y));
    },
    ut = x || Xt === 'viewing',
    [un, Bt] = uf.useState(null),
    [Dt, jt] = uf.useState({
      isOpen: false,
      position: { x: 0, y: 0 },
      hasSelection: false,
      cursorInTable: false,
    }),
    St = uf.useRef(null),
    At = uf.useCallback(() => {
      let y = Le.current?.getView();
      if (!y) return;
      let { doc: h, schema: C } = y.state,
        $ = C.marks.insertion,
        V = C.marks.deletion;
      if (!$ && !V) return;
      let Q = [];
      h.descendants((X, me) => {
        if (X.isText)
          for (let be of X.marks)
            (be.type === $ || be.type === V) &&
              Q.push({
                type: be.type === $ ? 'insertion' : 'deletion',
                text: X.text || '',
                author: be.attrs.author || '',
                date: be.attrs.date,
                from: me,
                to: me + X.nodeSize,
                revisionId: be.attrs.revisionId,
              });
      });
      let j = [];
      for (let X of Q) {
        let me = j[j.length - 1];
        me && me.revisionId === X.revisionId && me.type === X.type && me.to === X.from
          ? ((me.text += X.text), (me.to = X.to))
          : j.push({ ...X });
      }
      ze(j);
    }, []);
  (uf.useEffect(
    () => () => {
      St.current && clearTimeout(St.current);
    },
    []
  ),
    uf.useEffect(() => {
      if ((ye(U), U)) {
        let y = Le.current?.getView();
        y && pe($o(y.state.doc));
      }
    }, [U]));
  let de = Ju(n || null, { maxEntries: 100, groupingInterval: 500, enableKeyboardShortcuts: true }),
    Gt = uf.useRef(false);
  uf.useEffect(() => {
    if (Gt.current) return;
    let y = de.state;
    if (!y) return;
    let h = y.package?.document?.comments;
    h && h.length > 0 && (Xe(h), rt(true), (Gt.current = true));
  }, [de.state]);
  let pn = uf.useMemo(() => {
      let y = new Vn(Go());
      return (y.buildSchema(), y.initializeRuntime(), y);
    }, []),
    kt = uf.useMemo(() => np(false, r), []),
    or = uf.useMemo(() => [kt, ...(se ?? [])], [kt, se]),
    Le = uf.useRef(null),
    Zt = uf.useRef(null),
    ct = uf.useRef(null),
    Tt = uf.useRef(null),
    rr = uf.useRef(null),
    ir = uf.useRef(null),
    Lt = uf.useRef(null),
    On = uf.useRef(null),
    Za = uf.useRef(null),
    wt = uf.useRef(null),
    [vn, ar] = uf.useState(0),
    Rn = uf.useRef(de.state);
  Rn.current = de.state;
  let Ht = uf.useRef({ style: 'single', size: 4, color: { rgb: '000000' } }),
    jr = uf.useRef(null),
    Mo = uf.useCallback((y) => {
      let h = jr.current;
      if (h && h.styles === y) return h.resolver;
      let C = bo(y);
      return ((jr.current = { styles: y, resolver: C }), C);
    }, []),
    [fn, Io] = uf.useState({ currentPage: 1, totalPages: 1, visible: false }),
    En = uf.useRef(null),
    Ja = uf.useCallback((y) => {
      if (((Za.current = y), wt.current && (wt.current.disconnect(), (wt.current = null)), !y)) {
        ar(0);
        return;
      }
      ar(y.offsetHeight);
      let h = new ResizeObserver(() => {
        ar(y.offsetHeight);
      });
      (h.observe(y), (wt.current = h));
    }, []);
  uf.useEffect(
    () => () => {
      wt.current?.disconnect();
    },
    []
  );
  let He = uf.useCallback(
      () => (H && Zt.current ? Zt.current.getView() : Le.current?.getView()),
      [H]
    ),
    Qe = uf.useCallback(() => {
      H && Zt.current ? Zt.current.focus() : Le.current?.focus();
    }, [H]),
    Qa = uf.useCallback(() => {
      H && Zt.current ? Zt.current.undo() : Le.current?.undo();
    }, [H]),
    es = uf.useCallback(() => {
      H && Zt.current ? Zt.current.redo() : Le.current?.redo();
    }, [H]),
    yt = chunkCTYOM6BE_js.m(),
    Ct = chunkPJVI53AH_js.m(),
    [Gr, Kr] = uf.useState(false),
    ts = uf.useCallback(() => Kr(true), []),
    [Fo, Lo] = uf.useState(null),
    sr = uf.useRef(0),
    Bo = uf.useCallback(() => {
      ((Gt.current = false),
        (lr.current = false),
        (Ae.current = null),
        (Ge.current = null),
        Xe([]),
        ze([]),
        pe([]),
        rt(false),
        Ut(false),
        tn(null),
        Nn(null),
        Bt(null),
        ge(null),
        je(lf),
        yt.setMatches([], 0),
        St.current && (clearTimeout(St.current), (St.current = null)));
    }, [yt.setMatches]),
    lo = uf.useCallback(
      (y) => {
        (Bo(),
          de.reset(y),
          Z((h) => ({ ...h, isLoading: false, parseError: null })),
          chunkZ2UPNKQW_js.l(y).catch((h) => {
            console.warn('Failed to load document fonts:', h);
          }));
      },
      [Bo, de]
    ),
    Do = uf.useCallback(
      async (y) => {
        let h = ++sr.current;
        (Bo(), Z((C) => ({ ...C, isLoading: true, parseError: null })));
        try {
          let C = await chunkZ2UPNKQW_js.n(y);
          if (sr.current !== h) return;
          lo(C);
        } catch (C) {
          if (sr.current !== h) return;
          let $ = C instanceof Error ? C.message : 'Failed to parse document';
          (Z((V) => ({ ...V, isLoading: false, parseError: $ })),
            s?.(C instanceof Error ? C : new Error($)));
        }
      },
      [Bo, lo, s]
    );
  (uf.useEffect(() => {
    if (!t) {
      n && lo(n);
      return;
    }
    Do(t);
  }, [t, n]),
    uf.useEffect(() => {
      de.state ? (ct.current = new chunk5LKX24UR_js.f(de.state)) : (ct.current = null);
    }, [de.state]));
  let lr = uf.useRef(false);
  (uf.useEffect(() => {
    if (!E.isLoading && de.state) {
      let y = setTimeout(() => {
        (At(), lr.current || ((lr.current = true), ze((h) => (h.length > 0 && rt(true), h))));
      }, 200);
      return () => clearTimeout(y);
    }
  }, [E.isLoading, de.state, At]),
    uf.useEffect(
      () =>
        chunkZ2UPNKQW_js.h(() => {
          l?.();
        }),
      [l]
    ),
    uf.useEffect(() => {
      let y = Le.current?.getView();
      y && op(Xt === 'suggesting', y.state, y.dispatch, r);
    }, [Xt, r, E.isLoading]));
  let w = uf.useCallback((y) => (de.push(y), y), [de]),
    W = uf.useCallback(
      (y) => {
        if ((w(y), i?.(y), De.current)) {
          let h = Le.current?.getView();
          h && pe($o(h.state.doc));
        }
        (St.current && clearTimeout(St.current), (St.current = setTimeout(At, 300)));
      },
      [i, w, At]
    ),
    Y = uf.useCallback(
      (y) => {
        let h = He();
        if (h) {
          let { from: it, to: qe } = h.state.selection;
          rr.current = { from: it, to: qe };
        }
        let C = null;
        if ((h && ((C = Ze(h.state)), C.isInTable || (C = null)), C?.cellBorderColor)) {
          let it = C.cellBorderColor,
            qe = it.rgb;
          ((!qe || qe === 'auto') && (qe = chunk4VUZBV2S_js.a(it, u).replace(/^#/, '')),
            (Ht.current = { ...Ht.current, color: { rgb: qe } }));
        }
        let $ = null;
        if (h) {
          let it = h.state.selection,
            qe = it.node;
          qe?.type.name === 'image' &&
            ($ = {
              pos: it.from,
              wrapType: qe.attrs.wrapType ?? 'inline',
              displayMode: qe.attrs.displayMode ?? 'inline',
              cssFloat: qe.attrs.cssFloat ?? null,
              transform: qe.attrs.transform ?? null,
              alt: qe.attrs.alt ?? null,
              borderWidth: qe.attrs.borderWidth ?? null,
              borderColor: qe.attrs.borderColor ?? null,
              borderStyle: qe.attrs.borderStyle ?? null,
            });
        }
        if (!y) {
          (Bt(null),
            Z((it) => ({ ...it, selectionFormatting: {}, pmTableContext: C, pmImageContext: $ })));
          return;
        }
        let { textFormatting: V, paragraphFormatting: Q } = y,
          j = V.fontFamily?.ascii || V.fontFamily?.hAnsi,
          X = V.fontSize;
        if (!j || !X) {
          let it = Rn.current,
            qe = y.styleId;
          if (it?.package.styles && qe) {
            let vt = Mo(it.package.styles).resolveParagraphStyle(qe);
            (!j &&
              vt.runFormatting?.fontFamily &&
              (j = vt.runFormatting.fontFamily.ascii || vt.runFormatting.fontFamily.hAnsi),
              !X && vt.runFormatting?.fontSize && (X = vt.runFormatting.fontSize));
          }
        }
        let me = V.color?.rgb ? `#${V.color.rgb}` : void 0,
          be = Q.numPr,
          Oe = be
            ? {
                type: be.numId === 1 ? 'bullet' : 'numbered',
                level: be.ilvl ?? 0,
                isInList: true,
                numId: be.numId,
              }
            : void 0,
          et = {
            bold: V.bold,
            italic: V.italic,
            underline: !!V.underline,
            strike: V.strike,
            superscript: V.vertAlign === 'superscript',
            subscript: V.vertAlign === 'subscript',
            fontFamily: j,
            fontSize: X,
            color: me,
            highlight: V.highlight,
            alignment: Q.alignment,
            lineSpacing: Q.lineSpacing,
            listState: Oe,
            styleId: y.styleId ?? void 0,
            indentLeft: Q.indentLeft,
            bidi: !!Q.bidi,
          };
        if (
          (Z((it) => ({
            ...it,
            selectionFormatting: et,
            paragraphIndentLeft: Q.indentLeft ?? 0,
            paragraphIndentRight: Q.indentRight ?? 0,
            paragraphFirstLineIndent: Q.indentFirstLine ?? 0,
            paragraphHangingIndent: Q.hangingIndent ?? false,
            paragraphTabs: Q.tabs ?? null,
            pmTableContext: C,
            pmImageContext: $,
          })),
          h && y.hasSelection && !bt && !ut)
        ) {
          let it = On.current,
            qe = Lt.current,
            { from: on } = h.state.selection,
            vt = cf(it, qe, on);
          if (vt != null && it && qe) {
            let fr = it.querySelector('.paged-editor__pages')?.querySelector('.layout-page'),
              Zr = fr
                ? fr.getBoundingClientRect().right - qe.getBoundingClientRect().left
                : qe.getBoundingClientRect().width / 2 + 408;
            Bt({ top: vt, left: Zr });
          }
        } else Bt(null);
        a?.(y);
      },
      [a, bt, ut]
    ),
    G = Ec({ document: de.state, onChange: W, onSelectionChange: (y) => {} });
  uf.useEffect(() => {
    let y = (h) => {
      let $ = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? h.metaKey : h.ctrlKey;
      if (!$ && !h.shiftKey && !h.altKey && (h.key === 'Delete' || h.key === 'Backspace')) {
        let V = Le.current?.getView();
        if (V) {
          let Q = V.state.selection;
          if ('$anchorCell' in Q && typeof Q.forEachCell == 'function') {
            let X = Ze(V.state);
            if (X.isInTable && X.table) {
              let me = 0;
              X.table.descendants((Oe) => {
                (Oe.type.name === 'tableCell' || Oe.type.name === 'tableHeader') && (me += 1);
              });
              let be = 0;
              if (
                (Q.forEachCell(() => {
                  be += 1;
                }),
                me > 0 && be >= me)
              ) {
                (h.preventDefault(), Ir(V.state, V.dispatch));
                return;
              }
            }
          }
        }
        if (G.state.tableIndex !== null) {
          (h.preventDefault(), G.handleAction('deleteTable'));
          return;
        }
      }
      if ($ && !h.shiftKey && !h.altKey) {
        if (h.key.toLowerCase() === 'f') {
          h.preventDefault();
          let V = window.getSelection(),
            Q = V && !V.isCollapsed ? V.toString() : '';
          yt.openFind(Q);
        } else if (h.key.toLowerCase() === 'h') {
          h.preventDefault();
          let V = window.getSelection(),
            Q = V && !V.isCollapsed ? V.toString() : '';
          yt.openReplace(Q);
        } else if (h.key.toLowerCase() === 'k') {
          h.preventDefault();
          let V = Le.current?.getView();
          if (V) {
            let Q = Vo(V.state),
              j = _o(V.state);
            j ? Ct.openEdit({ url: j.href, displayText: Q, tooltip: j.tooltip }) : Ct.openInsert(Q);
          }
        }
      }
    };
    return (
      document.addEventListener('keydown', y),
      () => {
        document.removeEventListener('keydown', y);
      }
    );
  }, [yt, Ct, G]);
  let re = uf.useCallback(
      (y, h) => {
        let C = He();
        C && (Yi(y, h)(C.state, C.dispatch), Qe());
      },
      [He, Qe]
    ),
    q = uf.useCallback(() => {
      let y = He();
      y && (ha(y.state, y.dispatch), Qe());
    }, [He, Qe]),
    te = uf.useCallback(() => {
      let y = He();
      y && (Ki(y.state, y.dispatch), Qe());
    }, [He, Qe]),
    ie = uf.useCallback(() => {
      ye((y) => {
        if (!y) {
          let h = Le.current?.getView();
          h && pe($o(h.state.doc));
        }
        return !y;
      });
    }, []),
    ue = uf.useCallback((y) => {
      (Le.current?.scrollToPosition(y), Le.current?.setSelection(y + 1), Le.current?.focus());
    }, []),
    Te = uf.useCallback(() => {
      ir.current?.click();
    }, []),
    ke = uf.useCallback(
      (y) => {
        let h = y.target.files?.[0];
        if (!h) return;
        let C = He();
        if (!C) return;
        let $ = new FileReader();
        (($.onload = () => {
          let V = $.result,
            Q = new Image();
          ((Q.onload = () => {
            let j = Q.naturalWidth,
              X = Q.naturalHeight,
              me = 612;
            if (j > me) {
              let qe = me / j;
              ((j = me), (X = Math.round(X * qe)));
            }
            let be = `rId_img_${Date.now()}`,
              Oe = C.state.schema.nodes.image.create({
                src: V,
                alt: h.name,
                width: j,
                height: X,
                rId: be,
                wrapType: 'inline',
                displayMode: 'inline',
              }),
              { from: et } = C.state.selection,
              it = C.state.tr.insert(et, Oe);
            (C.dispatch(it.scrollIntoView()), Qe());
          }),
            (Q.src = V));
        }),
          $.readAsDataURL(h),
          (y.target.value = ''));
      },
      [He, Qe]
    ),
    ve = uf.useCallback(
      (y) => {
        let h = He();
        if (!h || !E.pmImageContext) return;
        let C = E.pmImageContext.pos,
          $ = h.state.doc.nodeAt(C);
        if (!$ || $.type.name !== 'image') return;
        let V = 'inline',
          Q = null;
        switch (y) {
          case 'inline':
            ((V = 'inline'), (Q = null));
            break;
          case 'square':
          case 'tight':
          case 'through':
            ((V = 'float'), (Q = 'left'));
            break;
          case 'topAndBottom':
            ((V = 'block'), (Q = null));
            break;
          case 'behind':
          case 'inFront':
            ((V = 'float'), (Q = 'none'));
            break;
          case 'wrapLeft':
            ((V = 'float'), (Q = 'right'), (y = 'square'));
            break;
          case 'wrapRight':
            ((V = 'float'), (Q = 'left'), (y = 'square'));
            break;
        }
        let j = h.state.tr.setNodeMarkup(C, void 0, {
          ...$.attrs,
          wrapType: y,
          displayMode: V,
          cssFloat: Q,
        });
        (h.dispatch(j.scrollIntoView()), Qe());
      },
      [He, Qe, E.pmImageContext]
    ),
    Pe = uf.useCallback(
      (y) => {
        let h = He();
        if (!h || !E.pmImageContext) return;
        let C = E.pmImageContext.pos,
          $ = h.state.doc.nodeAt(C);
        if (!$ || $.type.name !== 'image') return;
        let V = $.attrs.transform || '',
          Q = V.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/),
          j = Q ? parseFloat(Q[1]) : 0,
          X = /scaleX\(-1\)/.test(V),
          me = /scaleY\(-1\)/.test(V);
        switch (y) {
          case 'rotateCW':
            j = (j + 90) % 360;
            break;
          case 'rotateCCW':
            j = (j - 90 + 360) % 360;
            break;
          case 'flipH':
            X = !X;
            break;
          case 'flipV':
            me = !me;
            break;
        }
        let be = [];
        (j !== 0 && be.push(`rotate(${j}deg)`),
          X && be.push('scaleX(-1)'),
          me && be.push('scaleY(-1)'));
        let Oe = be.length > 0 ? be.join(' ') : null,
          et = h.state.tr.setNodeMarkup(C, void 0, { ...$.attrs, transform: Oe });
        (h.dispatch(et.scrollIntoView()), Qe());
      },
      [He, Qe, E.pmImageContext]
    ),
    Re = uf.useCallback(
      (y) => {
        let h = He();
        if (!h || !E.pmImageContext) return;
        let C = E.pmImageContext.pos,
          $ = h.state.doc.nodeAt(C);
        if (!$ || $.type.name !== 'image') return;
        let V = h.state.tr.setNodeMarkup(C, void 0, {
          ...$.attrs,
          position: { horizontal: y.horizontal, vertical: y.vertical },
          distTop: y.distTop ?? $.attrs.distTop,
          distBottom: y.distBottom ?? $.attrs.distBottom,
          distLeft: y.distLeft ?? $.attrs.distLeft,
          distRight: y.distRight ?? $.attrs.distRight,
        });
        (h.dispatch(V.scrollIntoView()), Qe());
      },
      [He, Qe, E.pmImageContext]
    ),
    Be = uf.useCallback(() => {
      Ce(true);
    }, []),
    Ye = uf.useCallback(
      (y) => {
        let h = He();
        if (!h || !E.pmImageContext) return;
        let C = E.pmImageContext.pos,
          $ = h.state.doc.nodeAt(C);
        if (!$ || $.type.name !== 'image') return;
        let V = h.state.tr.setNodeMarkup(C, void 0, {
          ...$.attrs,
          alt: y.alt ?? null,
          borderWidth: y.borderWidth ?? null,
          borderColor: y.borderColor ?? null,
          borderStyle: y.borderStyle ?? null,
        });
        (h.dispatch(V.scrollIntoView()), Qe());
      },
      [He, Qe, E.pmImageContext]
    ),
    pt = uf.useCallback(
      (y, h) => {
        if (!de.state?.package) return;
        let C = {
          ...de.state.package.document,
          finalSectionProperties: {
            ...de.state.package.document.finalSectionProperties,
            footnotePr: y,
            endnotePr: h,
          },
        };
        w({ ...de.state, package: { ...de.state.package, document: C } });
      },
      [de, w]
    ),
    ft = uf.useCallback(
      (y) => {
        let h = He();
        if (h) {
          switch (y) {
            case 'addRowAbove':
              Rr(h.state, h.dispatch);
              break;
            case 'addRowBelow':
              yo(h.state, h.dispatch);
              break;
            case 'addColumnLeft':
              Pr(h.state, h.dispatch);
              break;
            case 'addColumnRight':
              xo(h.state, h.dispatch);
              break;
            case 'deleteRow':
              Er(h.state, h.dispatch);
              break;
            case 'deleteColumn':
              Mr(h.state, h.dispatch);
              break;
            case 'deleteTable':
              Ir(h.state, h.dispatch);
              break;
            case 'selectTable':
              qi(h.state, h.dispatch);
              break;
            case 'selectRow':
              Xi(h.state, h.dispatch);
              break;
            case 'selectColumn':
              Zi(h.state, h.dispatch);
              break;
            case 'mergeCells':
              Ji(h.state, h.dispatch);
              break;
            case 'splitCell':
              Qi(h.state, h.dispatch);
              break;
            case 'borderAll':
              ta(h.state, h.dispatch, Ht.current);
              break;
            case 'borderOutside':
              na(h.state, h.dispatch, Ht.current);
              break;
            case 'borderInside':
              oa(h.state, h.dispatch, Ht.current);
              break;
            case 'borderNone':
              ea(h.state, h.dispatch);
              break;
            case 'borderTop':
              Un('top', Ht.current, true)(h.state, h.dispatch);
              break;
            case 'borderBottom':
              Un('bottom', Ht.current, true)(h.state, h.dispatch);
              break;
            case 'borderLeft':
              Un('left', Ht.current, true)(h.state, h.dispatch);
              break;
            case 'borderRight':
              Un('right', Ht.current, true)(h.state, h.dispatch);
              break;
            default:
              if (typeof y == 'object') {
                if (y.type === 'cellFillColor') fa(y.color)(h.state, h.dispatch);
                else if (y.type === 'borderColor') {
                  let C = y.color.replace(/^#/, '');
                  ((Ht.current = { ...Ht.current, color: { rgb: C } }),
                    ma(y.color)(h.state, h.dispatch));
                } else if (y.type === 'borderWidth')
                  ((Ht.current = { ...Ht.current, size: y.size }), ga(y.size)(h.state, h.dispatch));
                else if (y.type === 'cellBorder')
                  Un(y.side, {
                    style: y.style,
                    size: y.size,
                    color: { rgb: y.color.replace(/^#/, '') },
                  })(h.state, h.dispatch);
                else if (y.type === 'cellVerticalAlign') ra(y.align)(h.state, h.dispatch);
                else if (y.type === 'cellMargins') ia(y.margins)(h.state, h.dispatch);
                else if (y.type === 'cellTextDirection') aa(y.direction)(h.state, h.dispatch);
                else if (y.type === 'toggleNoWrap') sa()(h.state, h.dispatch);
                else if (y.type === 'rowHeight') la(y.height, y.rule)(h.state, h.dispatch);
                else if (y.type === 'toggleHeaderRow') ca()(h.state, h.dispatch);
                else if (y.type === 'distributeColumns') da()(h.state, h.dispatch);
                else if (y.type === 'autoFitContents') ua()(h.state, h.dispatch);
                else if (y.type === 'openTableProperties') _(true);
                else if (y.type === 'tableProperties') Fr(y.props)(h.state, h.dispatch);
                else if (y.type === 'applyTableStyle') {
                  let C = Uu(y.styleId),
                    $ = Rn.current;
                  if (!C && $?.package.styles) {
                    let Q = Mo($.package.styles).getStyle(y.styleId);
                    if (Q) {
                      if (((C = { id: Q.styleId, name: Q.name ?? Q.styleId }), Q.tblPr?.borders)) {
                        let j = Q.tblPr.borders;
                        C.tableBorders = {};
                        for (let X of ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']) {
                          let me = j[X];
                          me &&
                            (C.tableBorders[X] = {
                              style: me.style,
                              size: me.size,
                              color: me.color?.rgb ? { rgb: me.color.rgb } : void 0,
                            });
                        }
                      }
                      if (Q.tblStylePr) {
                        C.conditionals = {};
                        for (let j of Q.tblStylePr) {
                          let X = {};
                          if (
                            (j.tcPr?.shading?.fill &&
                              (X.backgroundColor = `#${j.tcPr.shading.fill}`),
                            j.tcPr?.borders)
                          ) {
                            let me = {};
                            for (let be of ['top', 'bottom', 'left', 'right']) {
                              let Oe = j.tcPr.borders[be];
                              Oe &&
                                (me[be] = {
                                  style: Oe.style,
                                  size: Oe.size,
                                  color: Oe.color?.rgb ? { rgb: Oe.color.rgb } : void 0,
                                });
                            }
                            X.borders = me;
                          }
                          (j.rPr?.bold && (X.bold = true),
                            j.rPr?.color?.rgb && (X.color = `#${j.rPr.color.rgb}`),
                            (C.conditionals[j.type] = X));
                        }
                      }
                      C.look = { firstRow: true, lastRow: false, noHBand: false, noVBand: true };
                    }
                  }
                  C &&
                    pa({
                      styleId: C.id,
                      tableBorders: C.tableBorders,
                      conditionals: C.conditionals,
                      look: C.look,
                    })(h.state, h.dispatch);
                }
              } else G.handleAction(y);
          }
          Qe();
        }
      },
      [G, He, Qe]
    ),
    Jt = uf.useCallback((y) => {
      (y.preventDefault(), y.stopPropagation());
      let h = Le.current?.getView(),
        C = h ? _n(h.state) : false,
        { from: $, to: V } = h?.state.selection ?? { from: 0, to: 0 },
        Q = $ !== V;
      jt({
        isOpen: true,
        position: { x: y.clientX, y: y.clientY },
        hasSelection: Q,
        cursorInTable: C,
      });
    }, []),
    zn = uf.useCallback(
      (y) => {
        let h = He();
        if (!h) return;
        h.focus();
        let C = h === Le.current?.getView(),
          { from: $, to: V } = h.state.selection,
          Q = rr.current;
        if (C && Q && ($ !== Q.from || V !== Q.to))
          try {
            let j = h.state.tr.setSelection(
              prosemirrorState.TextSelection.create(h.state.doc, Q.from, Q.to)
            );
            h.dispatch(j);
          } catch (j) {
            console.warn('Could not restore selection:', j);
          }
        if (y === 'bold') {
          Ti(h.state, h.dispatch);
          return;
        }
        if (y === 'italic') {
          wi(h.state, h.dispatch);
          return;
        }
        if (y === 'underline') {
          Ci(h.state, h.dispatch);
          return;
        }
        if (y === 'strikethrough') {
          vi(h.state, h.dispatch);
          return;
        }
        if (y === 'superscript') {
          Ri(h.state, h.dispatch);
          return;
        }
        if (y === 'subscript') {
          Ei(h.state, h.dispatch);
          return;
        }
        if (y === 'bulletList') {
          $i(h.state, h.dispatch);
          return;
        }
        if (y === 'numberedList') {
          Wi(h.state, h.dispatch);
          return;
        }
        if (y === 'indent') {
          _i(h.state, h.dispatch) || Hi()(h.state, h.dispatch);
          return;
        }
        if (y === 'outdent') {
          Vi(h.state, h.dispatch) || Ni()(h.state, h.dispatch);
          return;
        }
        if (y === 'clearFormatting') {
          xr(h.state, h.dispatch);
          return;
        }
        if (y === 'setRtl') {
          ji(h.state, h.dispatch);
          return;
        }
        if (y === 'setLtr') {
          Gi(h.state, h.dispatch);
          return;
        }
        if (y === 'insertLink') {
          let j = Vo(h.state),
            X = _o(h.state);
          X ? Ct.openEdit({ url: X.href, displayText: j, tooltip: X.tooltip }) : Ct.openInsert(j);
          return;
        }
        if (typeof y == 'object')
          switch (y.type) {
            case 'alignment':
              Di(y.value)(h.state, h.dispatch);
              break;
            case 'textColor': {
              let j = y.value;
              typeof j == 'string'
                ? Tr({ rgb: j.replace('#', '') })(h.state, h.dispatch)
                : j.auto
                  ? Pi(h.state, h.dispatch)
                  : Tr(j)(h.state, h.dispatch);
              break;
            }
            case 'highlightColor': {
              let j = y.value ? chunkEOTZWQND_js.z(y.value) : '';
              Mi(j || y.value)(h.state, h.dispatch);
              break;
            }
            case 'fontSize':
              Ii(chunkEOTZWQND_js.i(y.value))(h.state, h.dispatch);
              break;
            case 'fontFamily':
              Fi(y.value)(h.state, h.dispatch);
              break;
            case 'lineSpacing':
              Ai(y.value)(h.state, h.dispatch);
              break;
            case 'applyStyle': {
              let j = Rn.current,
                X = j?.package.styles ? Mo(j.package.styles) : null;
              if (X) {
                let me = X.resolveParagraphStyle(y.value);
                vr(y.value, {
                  paragraphFormatting: me.paragraphFormatting,
                  runFormatting: me.runFormatting,
                })(h.state, h.dispatch);
              } else vr(y.value)(h.state, h.dispatch);
              break;
            }
          }
      },
      [He]
    ),
    nn = uf.useCallback((y) => {
      Z((h) => ({ ...h, zoom: y }));
    }, []),
    co = uf.useCallback(
      (y) => {
        let h = He();
        if (!h) return;
        let C = y.url || '',
          $ = y.tooltip,
          { empty: V } = h.state.selection;
        (V && y.displayText
          ? wr(y.displayText, C, $)(h.state, h.dispatch)
          : V
            ? y.displayText && wr(y.displayText, C, $)(h.state, h.dispatch)
            : Li(C, $)(h.state, h.dispatch),
          Ct.close(),
          Qe());
      },
      [Ct, He, Qe]
    ),
    Ao = uf.useCallback(() => {
      let y = He();
      y && (Bi(y.state, y.dispatch), Qe());
    }, [He, Qe]),
    ns = uf.useCallback(() => {
      (Ao(), Ct.close());
    }, [Ct, Ao]),
    cr = uf.useCallback((y) => Lo(y), []),
    Yr = uf.useCallback((y) => {
      window.open(y, '_blank', 'noopener,noreferrer');
    }, []),
    Kt = uf.useCallback((y) => {
      navigator.clipboard.writeText(y).catch(() => {
        let h = document.createElement('textarea');
        ((h.value = y),
          (h.style.position = 'fixed'),
          (h.style.opacity = '0'),
          document.body.appendChild(h),
          h.select(),
          document.execCommand('copy'),
          document.body.removeChild(h));
      });
    }, []),
    uo = uf.useCallback(
      (y, h) => {
        let C = He();
        if (!C) return;
        let $ = C.state.schema.marks.hyperlink;
        if (!$) return;
        let { $from: V } = C.state.selection,
          Q = V.marks().find((j) => j.type === $);
        if (Q) {
          let j = V.parent,
            X = V.start(),
            me = [],
            be = null;
          (j.forEach((vt, pr) => {
            let fr = X + pr,
              Zr = fr + vt.nodeSize;
            (
              vt.isText
                ? vt.marks.find((Bl) => Bl.type === $ && Bl.attrs.href === Q.attrs.href)
                : null
            )
              ? be
                ? (be.end = Zr)
                : (be = { start: fr, end: Zr })
              : be && (me.push(be), (be = null));
          }),
            be && me.push(be));
          let Oe = V.pos,
            et = me.find((vt) => vt.start <= Oe && Oe <= vt.end);
          if (!et) return;
          let it = C.state.tr,
            qe = $.create({ href: h, tooltip: Q.attrs.tooltip }),
            on = C.state.schema.text(y, [...V.marks().filter((vt) => vt.type !== $), qe]);
          (it.replaceWith(et.start, et.end, on), C.dispatch(it.scrollIntoView()));
        }
        (Lo(null), Qe());
      },
      [He, Qe]
    ),
    mn = uf.useCallback(() => {
      let y = He();
      if (!y) return;
      let h = y.state.schema.marks.hyperlink;
      if (!h) return;
      let { $from: C } = y.state.selection,
        $ = C.marks().find((et) => et.type === h);
      if (
        (!$ && C.nodeAfter && ($ = C.nodeAfter.marks.find((et) => et.type === h)),
        !$ && C.nodeBefore && ($ = C.nodeBefore.marks.find((et) => et.type === h)),
        !$ &&
          Fo &&
          C.parent.forEach((it) => {
            if (!$ && it.isText) {
              let qe = it.marks.find((on) => on.type === h && on.attrs.href === Fo.href);
              qe && ($ = qe);
            }
          }),
        !$)
      )
        return;
      let V = C.parent,
        Q = C.start(),
        j = [],
        X = null;
      (V.forEach((et, it) => {
        let qe = Q + it,
          on = qe + et.nodeSize;
        (et.isText ? et.marks.find((pr) => pr.type === h && pr.attrs.href === $.attrs.href) : null)
          ? X
            ? (X.end = on)
            : (X = { start: qe, end: on })
          : X && (j.push(X), (X = null));
      }),
        X && j.push(X));
      let me = C.pos,
        be = j.find((et) => et.start <= me && me <= et.end);
      if (!be) return;
      let Oe = y.state.tr;
      (Oe.removeMark(be.start, be.end, h),
        y.dispatch(Oe.scrollIntoView()),
        Lo(null),
        Qe(),
        sonner.toast('Link removed'));
    }, [He, Qe, Fo]),
    po = uf.useCallback(() => {
      Lo(null);
    }, []),
    fo = uf.useCallback((y) => {
      let h = Le.current?.getView(),
        C = h ? _n(h.state) : false;
      jt({ isOpen: true, position: y, hasSelection: y.hasSelection, cursorInTable: C });
    }, []),
    os = uf.useCallback(() => {
      jt({ isOpen: false, position: { x: 0, y: 0 }, hasSelection: false, cursorInTable: false });
    }, []),
    Il = uf.useMemo(() => {
      let h = typeof navigator < 'u' && /Mac/.test(navigator.platform) ? '\u2318' : 'Ctrl',
        C = [
          { action: 'cut', label: 'Cut', shortcut: `${h}+X` },
          { action: 'copy', label: 'Copy', shortcut: `${h}+C` },
          { action: 'paste', label: 'Paste', shortcut: `${h}+V` },
          {
            action: 'pasteAsPlainText',
            label: 'Paste as Plain Text',
            shortcut: `${h}+Shift+V`,
            dividerAfter: true,
          },
          {
            action: 'delete',
            label: 'Delete',
            shortcut: 'Del',
            dividerAfter: !Dt.hasSelection && !Dt.cursorInTable,
          },
        ];
      return (
        Dt.hasSelection &&
          C.push({ action: 'addComment', label: 'Comment', dividerAfter: !Dt.cursorInTable }),
        Dt.cursorInTable &&
          C.push(
            { action: 'addRowAbove', label: 'Insert row above' },
            { action: 'addRowBelow', label: 'Insert row below' },
            { action: 'deleteRow', label: 'Delete row', dividerAfter: true },
            { action: 'addColumnLeft', label: 'Insert column left' },
            { action: 'addColumnRight', label: 'Insert column right' },
            { action: 'deleteColumn', label: 'Delete column', dividerAfter: true }
          ),
        C.push({ action: 'selectAll', label: 'Select All', shortcut: `${h}+A` }),
        C
      );
    }, [Dt.hasSelection, Dt.cursorInTable]),
    Fl = uf.useCallback(
      async (y) => {
        let h = He();
        if (h)
          switch ((Qe(), y)) {
            case 'cut':
              document.execCommand('cut');
              break;
            case 'copy':
              document.execCommand('copy');
              break;
            case 'paste': {
              try {
                let C = await navigator.clipboard.read(),
                  $ = '',
                  V = '';
                for (let X of C)
                  (X.types.includes('text/html') &&
                    ($ = await (await X.getType('text/html')).text()),
                    X.types.includes('text/plain') &&
                      (V = await (await X.getType('text/plain')).text()));
                let Q = new DataTransfer();
                ($ && Q.items.add($, 'text/html'), V && Q.items.add(V, 'text/plain'));
                let j = new ClipboardEvent('paste', {
                  clipboardData: Q,
                  bubbles: !0,
                  cancelable: !0,
                });
                h.dom.dispatchEvent(j);
              } catch {
                try {
                  let C = await navigator.clipboard.readText();
                  C && h.dispatch(h.state.tr.insertText(C));
                } catch {}
              }
              break;
            }
            case 'pasteAsPlainText':
              try {
                let C = await navigator.clipboard.readText();
                C && h.dispatch(h.state.tr.insertText(C));
              } catch {}
              break;
            case 'delete': {
              let { from: C, to: $ } = h.state.selection;
              C !== $ && h.dispatch(h.state.tr.deleteRange(C, $));
              break;
            }
            case 'selectAll':
              h.dispatch(
                h.state.tr.setSelection(
                  prosemirrorState.TextSelection.create(h.state.doc, 0, h.state.doc.content.size)
                )
              );
              break;
            case 'addRowAbove':
              Rr(h.state, h.dispatch);
              break;
            case 'addRowBelow':
              yo(h.state, h.dispatch);
              break;
            case 'deleteRow':
              Er(h.state, h.dispatch);
              break;
            case 'addColumnLeft':
              Pr(h.state, h.dispatch);
              break;
            case 'addColumnRight':
              xo(h.state, h.dispatch);
              break;
            case 'deleteColumn':
              Mr(h.state, h.dispatch);
              break;
            case 'addComment': {
              let { from: C, to: $ } = h.state.selection;
              if (C === $) break;
              let V = cf(On.current, Lt.current, C);
              tn({ from: C, to: $ });
              let Q = h.state.schema.marks.comment.create({ commentId: Ka }),
                j = h.state.tr.addMark(C, $, Q);
              (j.setSelection(prosemirrorState.TextSelection.create(j.doc, $)),
                h.dispatch(j),
                Nn(V),
                rt(true),
                Ut(true),
                Bt(null));
              break;
            }
          }
      },
      [He, Qe]
    ),
    $n = uf.useCallback(
      (y) => (h) => {
        if (!de.state || ut) return;
        let C = {
          ...de.state,
          package: {
            ...de.state.package,
            document: {
              ...de.state.package.document,
              finalSectionProperties: {
                ...de.state.package.document.finalSectionProperties,
                [y]: h,
              },
            },
          },
        };
        W(C);
      },
      [de.state, ut, W]
    ),
    Pf = uf.useMemo(() => $n('marginLeft'), [$n]),
    Mf = uf.useMemo(() => $n('marginRight'), [$n]),
    If = uf.useMemo(() => $n('marginTop'), [$n]),
    Ff = uf.useMemo(() => $n('marginBottom'), [$n]),
    Lf = uf.useCallback(
      (y) => {
        if (!de.state || ut) return;
        let h = {
          ...de.state,
          package: {
            ...de.state.package,
            document: {
              ...de.state.package.document,
              finalSectionProperties: { ...de.state.package.document.finalSectionProperties, ...y },
            },
          },
        };
        W(h);
      },
      [de.state, ut, W]
    ),
    Bf = uf.useCallback(
      (y) => {
        let h = He();
        h && Oi(y)(h.state, h.dispatch);
      },
      [He]
    ),
    Df = uf.useCallback(
      (y) => {
        let h = He();
        h && zi(y)(h.state, h.dispatch);
      },
      [He]
    ),
    Af = uf.useCallback(
      (y) => {
        let h = He();
        h && (y < 0 ? Cr(-y, true)(h.state, h.dispatch) : Cr(y, false)(h.state, h.dispatch));
      },
      [He]
    ),
    Hf = uf.useCallback(
      (y) => {
        let h = He();
        h && Ui(y)(h.state, h.dispatch);
      },
      [He]
    ),
    Ho = On.current;
  uf.useEffect(() => {
    if (!Ho) return;
    let y = () => {
      let h = Le.current?.getLayout();
      if (!h || h.pages.length === 0) return;
      let C = Ho.scrollTop,
        $ = h.pages.length,
        V = 24,
        Q = 24,
        j = C + Ho.clientHeight / 2,
        X = Q,
        me = 1;
      for (let be = 0; be < h.pages.length; be++) {
        let Oe = h.pages[be].size.h,
          et = X + Oe;
        if (j < et) {
          me = be + 1;
          break;
        }
        ((X = et + V), (me = be + 2));
      }
      ((me = Math.min(me, $)),
        Io({ currentPage: me, totalPages: $, visible: true }),
        En.current && clearTimeout(En.current),
        (En.current = setTimeout(() => {
          Io((be) => ({ ...be, visible: false }));
        }, 600)));
    };
    return (
      Ho.addEventListener('scroll', y, { passive: true }),
      () => {
        (Ho.removeEventListener('scroll', y), En.current && clearTimeout(En.current));
      }
    );
  }, [Ho]);
  let Ll = uf.useCallback(
      async (y) => {
        if (!ct.current) return null;
        try {
          let h = ct.current.getDocument(),
            C = Le.current?.getDocument();
          if (C?.package?.document) {
            h.package.document.content = C.package.document.content;
            let X = JSON.stringify(C.package.document.content),
              me = X.includes('"insertion"'),
              be = X.includes('"deletion"');
            console.log(
              '[DocxEditor.save] content has insertion:',
              me,
              'deletion:',
              be,
              'sections:',
              C.package.document.content.length
            );
          }
          h.package.document.comments = Ke;
          let $ = y?.selective !== !1,
            V = Le.current?.getView(),
            Q;
          if ($ && V) {
            let X = V.state;
            Q = {
              selective: {
                changedParaIds: nu(X),
                structuralChange: ou(X),
                hasUntrackedChanges: ru(X),
              },
            };
          }
          let j = await ct.current.toBuffer(Q);
          return (V && y?.clearTracked !== !1 && V.dispatch(iu(V.state)), o?.(j), j);
        } catch (h) {
          return (s?.(h instanceof Error ? h : new Error('Failed to save document')), null);
        }
      },
      [o, s, Ke]
    ),
    Nf = uf.useCallback(
      (y) => {
        s?.(y);
      },
      [s]
    ),
    qr = uf.useCallback(() => {
      let y = Tt.current?.querySelector('.paged-editor__pages');
      if (!y) {
        (window.print(), N?.());
        return;
      }
      let h = window.open('', '_blank');
      if (!h) {
        (window.print(), N?.());
        return;
      }
      let C = [];
      for (let V of Array.from(document.styleSheets))
        try {
          for (let Q of Array.from(V.cssRules)) Q instanceof CSSFontFaceRule && C.push(Q.cssText);
        } catch {}
      let $ = y.cloneNode(true);
      $.style.cssText = 'display: block; margin: 0; padding: 0;';
      for (let V of Array.from($.querySelectorAll('.layout-page'))) {
        let Q = V;
        ((Q.style.boxShadow = 'none'), (Q.style.margin = '0'));
      }
      (h.document.write(`<!DOCTYPE html>
<html><head><title>Print</title>
<style>
${C.join(`
`)}
* { margin: 0; padding: 0; }
body { background: white; }
.layout-page { break-after: page; }
.layout-page:last-child { break-after: auto; }
@page { margin: 0; size: auto; }
</style>
</head><body>${$.outerHTML}</body></html>`),
        h.document.close(),
        (h.onload = () => {
          (h.print(), h.close());
        }),
        setTimeout(() => {
          h.closed || (h.print(), h.close());
        }, 1e3),
        N?.());
    }, [N]),
    $t = uf.useRef(null),
    Of = uf.useCallback(
      (y, h) => {
        if (!de.state || !y.trim()) return (($t.current = null), null);
        let C = chunkCTYOM6BE_js.j(de.state, y, h),
          $ = { matches: C, totalCount: C.length, currentIndex: 0 };
        return (
          ($t.current = $),
          yt.setMatches(C, 0),
          C.length > 0 && Tt.current && chunkCTYOM6BE_js.l(Tt.current, C[0]),
          $
        );
      },
      [de.state, yt]
    ),
    zf = uf.useCallback(() => {
      if (!$t.current || $t.current.matches.length === 0) return null;
      let y = yt.goToNextMatch(),
        h = $t.current.matches[y];
      return (h && Tt.current && chunkCTYOM6BE_js.l(Tt.current, h), h || null);
    }, [yt]),
    $f = uf.useCallback(() => {
      if (!$t.current || $t.current.matches.length === 0) return null;
      let y = yt.goToPreviousMatch(),
        h = $t.current.matches[y];
      return (h && Tt.current && chunkCTYOM6BE_js.l(Tt.current, h), h || null);
    }, [yt]),
    Wf = uf.useCallback(
      (y) => {
        if (!de.state || !$t.current || $t.current.matches.length === 0) return false;
        let h = $t.current.matches[$t.current.currentIndex];
        if (!h) return false;
        try {
          let C = chunkAARNCPWR_js.a(de.state, {
            type: 'replaceText',
            range: {
              start: { paragraphIndex: h.paragraphIndex, offset: h.startOffset },
              end: { paragraphIndex: h.paragraphIndex, offset: h.endOffset },
            },
            text: y,
          });
          return (W(C), !0);
        } catch (C) {
          return (console.error('Replace failed:', C), false);
        }
      },
      [de.state, W]
    ),
    _f = uf.useCallback(
      (y, h, C) => {
        if (!de.state || !y.trim()) return 0;
        let $ = chunkCTYOM6BE_js.j(de.state, y, C);
        if ($.length === 0) return 0;
        let V = de.state,
          Q = [...$].sort((j, X) =>
            j.paragraphIndex !== X.paragraphIndex
              ? X.paragraphIndex - j.paragraphIndex
              : X.startOffset - j.startOffset
          );
        for (let j of Q)
          try {
            V = chunkAARNCPWR_js.a(V, {
              type: 'replaceText',
              range: {
                start: { paragraphIndex: j.paragraphIndex, offset: j.startOffset },
                end: { paragraphIndex: j.paragraphIndex, offset: j.endOffset },
              },
              text: h,
            });
          } catch (X) {
            console.error('Replace failed for match:', j, X);
          }
        return (W(V), ($t.current = null), yt.setMatches([], 0), $.length);
      },
      [de.state, W, yt]
    );
  uf.useImperativeHandle(
    I,
    () => ({
      getAgent: () => ct.current,
      getDocument: () => de.state,
      getEditorRef: () => Le.current,
      save: Ll,
      setZoom: (y) => Z((h) => ({ ...h, zoom: y })),
      getZoom: () => E.zoom,
      focus: () => {
        Le.current?.focus();
      },
      getCurrentPage: () => fn.currentPage,
      getTotalPages: () => fn.totalPages,
      scrollToPage: (y) => {},
      openPrintPreview: qr,
      print: qr,
      loadDocument: lo,
      loadDocumentBuffer: Do,
      replaceDocumentBuffer: async (y) => {
        let h = await chunkZ2UPNKQW_js.n(y);
        (ct.current &&
          ((ct.current.getDocument().package.document.content = h.package.document.content),
          (ct.current.getDocument().originalBuffer = h.originalBuffer)),
          de.reset(h),
          Le.current?.replaceContent(h, h.package?.styles ?? void 0));
        let C = Le.current?.getView();
        if (C) {
          let V = ko(C.state.doc);
          ((Ae.current = V), (Ge.current = V));
        }
        let $ = h.package?.document?.comments;
        ($ && $.length > 0 ? Xe($) : Xe([]), Z((V) => ({ ...V, isLoading: false })));
      },
      mergeIncomingBuffer: async (y) => {
        let h = Le.current?.getView();
        if (!h) return null;
        if (Ae.current === null) {
          let X = ko(h.state.doc);
          ((Ae.current = X), Ge.current === null && (Ge.current = X));
        }
        let C = Yu(h.state.doc, Ae.current);
        (console.log(
          '[mergeIncoming] base:',
          Ae.current.length,
          'nodes | current:',
          h.state.doc.childCount,
          'nodes | modified:',
          C.length
        ),
          C.length > 0 &&
            console.log(
              '[mergeIncoming] modified paragraphs:',
              C.map((X) => `idx:${X.index} type:${X.nodeJSON.type}`).join(', ')
            ));
        let $ = await chunkZ2UPNKQW_js.n(y);
        (ct.current &&
          ((ct.current.getDocument().package.document.content = $.package.document.content),
          (ct.current.getDocument().originalBuffer = $.originalBuffer)),
          de.reset($),
          Le.current?.replaceContent($, $.package?.styles ?? void 0));
        let V = 0;
        if (C.length > 0) {
          let X = Le.current?.getView();
          if (X) {
            let me = [];
            X.state.doc.forEach((Oe) => {
              me.push(Oe.toJSON());
            });
            let be = C.filter((Oe) => {
              let et = me[Oe.index];
              return et ? JSON.stringify(Oe.nodeJSON) !== JSON.stringify(et) : true;
            });
            if (
              (console.log(
                '[mergeIncoming] truly modified vs incoming:',
                be.length,
                'of',
                C.length
              ),
              be.length > 0)
            ) {
              let Oe = qu(X.state, be);
              ((V = Oe.replacements),
                console.log(
                  '[mergeIncoming] restored:',
                  V,
                  'paragraphs, steps:',
                  Oe.tr.steps.length
                ),
                Oe.tr.steps.length > 0 && X.dispatch(Oe.tr));
            }
          }
        }
        let Q = Le.current?.getView();
        Q && (Ae.current = ko(Q.state.doc));
        let j = $.package?.document?.comments;
        return (
          j &&
            j.length > 0 &&
            Xe((X) => {
              let me = new Set(j.map((Oe) => Oe.id));
              return [...X.filter((Oe) => !me.has(Oe.id)), ...j];
            }),
          Z((X) => ({ ...X, isLoading: false })),
          { saved: C.length, restored: V }
        );
      },
      hasUnpublishedChanges: () => {
        let y = Le.current?.getView();
        if (!y) return false;
        if (!Ge.current) {
          let h = ko(y.state.doc);
          return ((Ge.current = h), Ae.current || (Ae.current = h), false);
        }
        return Xu(y.state.doc, Ge.current);
      },
      resetPublishBaseline: () => {
        let y = Le.current?.getView();
        y && (Ge.current = ko(y.state.doc));
      },
    }),
    [de.state, E.zoom, fn, Ll, qr, lo, Do]
  );
  let { headerContent: dr, footerContent: ur } = uf.useMemo(() => {
      if (!de.state?.package) return { headerContent: null, footerContent: null };
      let y = de.state.package,
        h = y.document?.finalSectionProperties,
        C = y.headers,
        $ = y.footers,
        V = null,
        Q = null;
      if (C && h?.headerReferences) {
        let j = h.headerReferences.find((X) => X.type === 'default');
        j?.rId && (V = C.get(j.rId) ?? null);
      }
      if ($ && h?.footerReferences) {
        let j = h.footerReferences.find((X) => X.type === 'default');
        j?.rId && (Q = $.get(j.rId) ?? null);
      }
      return { headerContent: V, footerContent: Q };
    }, [de.state]),
    Vf = uf.useCallback(
      (y) => {
        if (y === 'header' ? dr : ur) {
          ge(y);
          return;
        }
        if (!de.state?.package) return;
        let C = de.state.package,
          $ = C.document?.finalSectionProperties;
        if (!$) return;
        let V = `rId_new_${y}`,
          Q = {
            type: y === 'header' ? 'header' : 'footer',
            hdrFtrType: 'default',
            content: [{ type: 'paragraph', content: [] }],
          },
          j = y === 'header' ? 'headers' : 'footers',
          X = new Map(C[j] ?? []);
        X.set(V, Q);
        let me = y === 'header' ? 'headerReferences' : 'footerReferences',
          be = $[me] ?? [],
          Oe = { type: 'default', rId: V },
          et = {
            ...de.state,
            package: {
              ...C,
              [j]: X,
              document: C.document
                ? { ...C.document, finalSectionProperties: { ...$, [me]: [...be, Oe] } }
                : C.document,
            },
          };
        (w(et), ge(y));
      },
      [dr, ur, de, w]
    ),
    rs = uf.useCallback(
      (y) => {
        if (!H || !de.state?.package) {
          ge(null);
          return;
        }
        let h = de.state.package,
          C = h.document?.finalSectionProperties,
          V = (H === 'header' ? C?.headerReferences : C?.footerReferences)?.find(
            (X) => X.type === 'default'
          ),
          Q = H === 'header' ? 'headers' : 'footers',
          j = h[Q];
        if (V?.rId && j) {
          let X = j.get(V.rId),
            me = { type: H, hdrFtrType: 'default', ...X, content: y },
            be = new Map(j);
          be.set(V.rId, me);
          let Oe = { ...de.state, package: { ...h, [Q]: be } };
          w(Oe);
        }
        ge(null);
      },
      [H, de, w]
    ),
    Uf = uf.useCallback(() => {
      if (!H) return;
      let y = Zt.current?.getView();
      if (y) {
        let h = kr(y.state.doc);
        rs(h);
      } else ge(null);
    }, [H, rs]),
    jf = uf.useCallback(() => {
      if (!H || !de.state?.package) {
        ge(null);
        return;
      }
      let y = de.state.package,
        h = y.document?.finalSectionProperties,
        C = H === 'header' ? 'headerReferences' : 'footerReferences',
        $ = H === 'header' ? 'headers' : 'footers',
        V = h?.[C],
        Q = V?.find((j) => j.type === 'default');
      if (Q?.rId) {
        let j = new Map(y[$] ?? []);
        j.delete(Q.rId);
        let X = (V ?? []).filter((be) => be.rId !== Q.rId),
          me = {
            ...de.state,
            package: {
              ...y,
              [$]: j,
              document: y.document
                ? { ...y.document, finalSectionProperties: { ...h, [C]: X } }
                : y.document,
            },
          };
        w(me);
      }
      ge(null);
    }, [H, de, w]),
    Gf = uf.useCallback((y) => {
      let h = Tt.current?.querySelector('.paged-editor__pages');
      if (!h) return null;
      let C = y === 'header' ? '.layout-page-header' : '.layout-page-footer';
      return h.querySelector(C);
    }, []),
    Xr = {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      backgroundColor: 'var(--doc-bg-subtle)',
      ...B,
    },
    Kf = { display: 'flex', flex: 1, minHeight: 0, minWidth: 0, flexDirection: 'row' },
    Yf = { flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto', position: 'relative' };
  if (E.isLoading)
    return jsxRuntime.jsx('div', {
      className: `ep-root docx-editor docx-editor-loading ${S}`,
      style: Xr,
      'data-testid': 'docx-editor',
      children: M || jsxRuntime.jsx(ju, {}),
    });
  if (E.parseError)
    return jsxRuntime.jsx('div', {
      className: `ep-root docx-editor docx-editor-error ${S}`,
      style: Xr,
      'data-testid': 'docx-editor',
      children: jsxRuntime.jsx(Ku, { message: E.parseError }),
    });
  if (!de.state)
    return jsxRuntime.jsx('div', {
      className: `ep-root docx-editor docx-editor-empty ${S}`,
      style: Xr,
      'data-testid': 'docx-editor',
      children: v || jsxRuntime.jsx(Gu, {}),
    });
  let qf = jsxRuntime.jsxs(jsxRuntime.Fragment, {
    children: [
      jsxRuntime.jsx(chunkEOTZWQND_js.C, {}),
      jsxRuntime.jsx(chunkEOTZWQND_js.A, {
        onClick: () => rt(!Ve),
        active: Ve,
        title: 'Toggle comments sidebar',
        ariaLabel: 'Toggle comments sidebar',
        children: jsxRuntime.jsx(chunkEOTZWQND_js.d, { name: 'comment', size: 20 }),
      }),
      jsxRuntime.jsx(chunkEOTZWQND_js.C, {}),
      jsxRuntime.jsx(fS, {
        mode: Xt,
        onModeChange: (y) => {
          (Cn(y), y === 'suggesting' && rt(true));
        },
      }),
      T,
    ],
  });
  return jsxRuntime.jsx(vc, {
    children: jsxRuntime.jsx(si, {
      onError: Nf,
      children: jsxRuntime.jsxs('div', {
        ref: Tt,
        className: `ep-root docx-editor ${S}`,
        style: Xr,
        'data-testid': 'docx-editor',
        children: [
          jsxRuntime.jsx('div', {
            style: Kf,
            children: jsxRuntime.jsxs('div', {
              style: {
                position: 'relative',
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
              },
              children: [
                d &&
                  !x &&
                  jsxRuntime.jsxs('div', {
                    ref: Ja,
                    className: 'z-50 flex flex-col gap-0 bg-white shadow-sm flex-shrink-0',
                    children: [
                      jsxRuntime.jsxs(Wt, {
                        currentFormatting: E.selectionFormatting,
                        onFormat: zn,
                        onUndo: Qa,
                        onRedo: es,
                        canUndo: true,
                        canRedo: true,
                        disabled: ut,
                        documentStyles: de.state?.package.styles?.styles,
                        theme: de.state?.package.theme || u,
                        showPrintButton: ee,
                        onPrint: qr,
                        showZoomControl: c,
                        zoom: E.zoom,
                        onZoomChange: nn,
                        onRefocusEditor: Qe,
                        onInsertTable: re,
                        showTableInsert: true,
                        onInsertImage: Te,
                        onInsertPageBreak: q,
                        onInsertTOC: te,
                        imageContext: E.pmImageContext,
                        onImageWrapType: ve,
                        onImageTransform: Pe,
                        onOpenImageProperties: Be,
                        onPageSetup: ts,
                        tableContext: E.pmTableContext,
                        onTableAction: ft,
                        children: [
                          jsxRuntime.jsxs(Wt.TitleBar, {
                            children: [
                              Ue && jsxRuntime.jsx(Wt.Logo, { children: Ue() }),
                              P !== void 0 &&
                                jsxRuntime.jsx(Wt.DocumentName, {
                                  value: P,
                                  onChange: F,
                                  editable: k,
                                }),
                              L && jsxRuntime.jsx(Wt.TitleBarRight, { children: L() }),
                              jsxRuntime.jsx(Wt.MenuBar, {}),
                            ],
                          }),
                          jsxRuntime.jsx(Wt.FormattingBar, { children: qf }),
                        ],
                      }),
                      m &&
                        jsxRuntime.jsx('div', {
                          className:
                            'flex justify-center px-5 py-1 overflow-x-auto flex-shrink-0 bg-doc-bg',
                          style: {
                            paddingRight: Ve ? 'calc(20px + 240px)' : void 0,
                            transition: 'padding 0.2s ease',
                          },
                          children: jsxRuntime.jsx(chunkEOTZWQND_js.E, {
                            sectionProps: de.state?.package.document?.finalSectionProperties,
                            zoom: E.zoom,
                            unit: b,
                            editable: !ut,
                            onLeftMarginChange: Pf,
                            onRightMarginChange: Mf,
                            indentLeft: E.paragraphIndentLeft,
                            indentRight: E.paragraphIndentRight,
                            onIndentLeftChange: Bf,
                            onIndentRightChange: Df,
                            showFirstLineIndent: true,
                            firstLineIndent: E.paragraphFirstLineIndent,
                            hangingIndent: E.paragraphHangingIndent,
                            onFirstLineIndentChange: Af,
                            tabStops: E.paragraphTabs,
                            onTabStopRemove: Hf,
                          }),
                        }),
                    ],
                  }),
                jsxRuntime.jsx('div', {
                  ref: On,
                  style: Yf,
                  children: jsxRuntime.jsx('div', {
                    style: { display: 'flex', flex: 1, minHeight: 0, position: 'relative' },
                    children: jsxRuntime.jsxs('div', {
                      ref: Lt,
                      style: { position: 'relative', flex: 1, minWidth: 0 },
                      onMouseDown: (y) => {
                        y.target === y.currentTarget && (y.preventDefault(), Le.current?.focus());
                      },
                      onContextMenu: Jt,
                      children: [
                        m &&
                          !x &&
                          jsxRuntime.jsx('div', {
                            style: {
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              zIndex: 10,
                              paddingTop: 48,
                            },
                            children: jsxRuntime.jsx(zc, {
                              sectionProps: de.state?.package.document?.finalSectionProperties,
                              zoom: E.zoom,
                              unit: b,
                              editable: !ut,
                              onTopMarginChange: If,
                              onBottomMarginChange: Ff,
                            }),
                          }),
                        jsxRuntime.jsx(af, {
                          ref: Le,
                          document: de.state,
                          styles: de.state?.package.styles,
                          theme: de.state?.package.theme || u,
                          sectionProperties: de.state?.package.document?.finalSectionProperties,
                          headerContent: dr,
                          footerContent: ur,
                          onHeaderFooterDoubleClick: Vf,
                          hfEditMode: H,
                          onBodyClick: Uf,
                          zoom: E.zoom,
                          readOnly: ut,
                          extensionManager: pn,
                          onDocumentChange: W,
                          onSelectionChange: (y, h) => {
                            let C = Le.current?.getView();
                            if (C) {
                              let $ = Ko(C.state);
                              Y($);
                            } else Y(null);
                          },
                          externalPlugins: or,
                          onReady: (y) => {
                            let h = y.getView();
                            (h && !Ae.current && (Ae.current = ko(h.state.doc)), A?.(h));
                          },
                          onRenderedDomContextReady: Ie,
                          pluginOverlays: Fe,
                          onHyperlinkClick: cr,
                          onContextMenu: fo,
                          commentsSidebarOpen: Ve,
                          onAnchorPositionsChange: je,
                          scrollContainerRef: On,
                          sidebarOverlay: Ve
                            ? jsxRuntime.jsx(Dc, {
                                comments: Ke,
                                trackedChanges: Pt,
                                anchorPositions: Ft,
                                pageWidth: (() => {
                                  let y = de.state?.package?.document?.finalSectionProperties;
                                  return y?.pageWidth ? Math.round(y.pageWidth / 15) : 816;
                                })(),
                                editorContainerRef: On,
                                onCommentResolve: (y) => {
                                  Xe((C) => C.map(($) => ($.id === y ? { ...$, done: true } : $)));
                                  let h = Le.current?.getView();
                                  if (h) {
                                    let { state: C, dispatch: $ } = h,
                                      V = C.schema.marks.comment;
                                    if (V) {
                                      let Q = C.tr;
                                      (C.doc.descendants((j, X) => {
                                        if (!j.isText) return;
                                        let me = j.marks.find(
                                          (be) => be.type === V && be.attrs.commentId === y
                                        );
                                        me && Q.removeMark(X, X + j.nodeSize, me);
                                      }),
                                        Q.steps.length > 0 && $(Q));
                                    }
                                  }
                                },
                                onCommentDelete: (y) => {
                                  Xe((C) => C.filter(($) => $.id !== y && $.parentId !== y));
                                  let h = Le.current?.getView();
                                  if (h) {
                                    let { state: C, dispatch: $ } = h,
                                      V = C.schema.marks.comment;
                                    if (V) {
                                      let Q = C.tr;
                                      (C.doc.descendants((j, X) => {
                                        if (!j.isText) return;
                                        let me = j.marks.find(
                                          (be) => be.type === V && be.attrs.commentId === y
                                        );
                                        me && Q.removeMark(X, X + j.nodeSize, me);
                                      }),
                                        Q.steps.length > 0 && $(Q));
                                    }
                                  }
                                },
                                onCommentReply: (y, h) => {
                                  Xe((C) => [...C, Rl(h, r, y)]);
                                },
                                onAddComment: (y) => {
                                  let h = Rl(y, r),
                                    C = Le.current?.getView();
                                  if (C && Eo) {
                                    let { from: $, to: V } = Eo,
                                      Q = C.state.schema.marks.comment.create({ commentId: Ka }),
                                      j = C.state.schema.marks.comment.create({ commentId: h.id }),
                                      X = C.state.tr.removeMark($, V, Q).addMark($, V, j);
                                    C.dispatch(X);
                                  }
                                  (Xe(($) => [...$, h]), Ut(false), tn(null), Nn(null));
                                },
                                onTrackedChangeReply: (y, h) => {
                                  Xe((C) => [...C, Rl(h, r, y)]);
                                },
                                onCancelAddComment: () => {
                                  let y = Le.current?.getView();
                                  if (y && Eo) {
                                    let { from: h, to: C } = Eo,
                                      $ = y.state.schema.marks.comment.create({ commentId: Ka });
                                    y.dispatch(y.state.tr.removeMark(h, C, $));
                                  }
                                  (Ut(false), tn(null), Nn(null));
                                },
                                onAcceptChange: (y, h) => {
                                  let C = Le.current?.getView();
                                  C && (Gs(y, h)(C.state, C.dispatch), At());
                                },
                                onRejectChange: (y, h) => {
                                  let C = Le.current?.getView();
                                  C && (Ks(y, h)(C.state, C.dispatch), At());
                                },
                                isAddingComment: bt,
                                addCommentYPosition: tr,
                                topOffset: 0,
                              })
                            : void 0,
                        }),
                        un != null &&
                          !bt &&
                          !ut &&
                          jsxRuntime.jsx(chunkEOTZWQND_js.c, {
                            content: 'Add comment',
                            side: 'bottom',
                            delayMs: 300,
                            children: jsxRuntime.jsx('button', {
                              type: 'button',
                              onMouseDown: (y) => {
                                (y.preventDefault(), y.stopPropagation());
                                let h = Le.current?.getView();
                                if (h) {
                                  let { from: C, to: $ } = h.state.selection;
                                  if (C !== $) {
                                    tn({ from: C, to: $ });
                                    let V = h.state.schema.marks.comment.create({ commentId: Ka }),
                                      Q = h.state.tr.addMark(C, $, V);
                                    (Q.setSelection(
                                      prosemirrorState.TextSelection.create(Q.doc, $)
                                    ),
                                      h.dispatch(Q));
                                  }
                                }
                                (Nn(un.top), rt(true), Ut(true), Bt(null));
                              },
                              style: {
                                position: 'absolute',
                                top: un.top,
                                left: un.left,
                                transform: 'translate(-50%, -50%)',
                                zIndex: 50,
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                border: '1px solid rgba(26, 115, 232, 0.3)',
                                backgroundColor: '#fff',
                                color: '#1a73e8',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 1px 3px rgba(60,64,67,0.2)',
                                transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
                              },
                              onMouseOver: (y) => {
                                ((y.currentTarget.style.backgroundColor =
                                  'rgba(26, 115, 232, 0.08)'),
                                  (y.currentTarget.style.boxShadow =
                                    '0 1px 4px rgba(26, 115, 232, 0.3)'));
                              },
                              onMouseOut: (y) => {
                                ((y.currentTarget.style.backgroundColor = '#fff'),
                                  (y.currentTarget.style.boxShadow =
                                    '0 1px 3px rgba(60,64,67,0.2)'));
                              },
                              children: jsxRuntime.jsx(chunkEOTZWQND_js.d, {
                                name: 'add_comment',
                                size: 16,
                              }),
                            }),
                          }),
                        jsxRuntime.jsx(chunkEOTZWQND_js.Z, {
                          isOpen: Dt.isOpen,
                          position: Dt.position,
                          hasSelection: Dt.hasSelection,
                          isEditable: !ut,
                          items: Il,
                          onAction: Fl,
                          onClose: () => jt((y) => ({ ...y, isOpen: false })),
                        }),
                        H &&
                          (H === 'header' ? dr : ur) &&
                          (() => {
                            let y = Gf(H),
                              h = Lt.current;
                            return !y || !h
                              ? null
                              : jsxRuntime.jsx(Ou, {
                                  ref: Zt,
                                  headerFooter: H === 'header' ? dr : ur,
                                  position: H,
                                  styles: de.state?.package.styles,
                                  targetElement: y,
                                  parentElement: h,
                                  onSave: rs,
                                  onClose: () => ge(null),
                                  onSelectionChange: Y,
                                  onRemove: jf,
                                });
                          })(),
                      ],
                    }),
                  }),
                }),
                fn.totalPages > 1 &&
                  jsxRuntime.jsxs('div', {
                    style: {
                      position: 'absolute',
                      right: 24,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontFamily:
                        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      zIndex: 1e3,
                      opacity: fn.visible ? 1 : 0,
                      transition: 'opacity 0.3s ease',
                      userSelect: 'none',
                    },
                    'aria-live': 'polite',
                    role: 'status',
                    children: [fn.currentPage, ' of ', fn.totalPages],
                  }),
                he &&
                  jsxRuntime.jsx(Mc, {
                    headings: xe,
                    onHeadingClick: ue,
                    onClose: () => ye(false),
                    topOffset: vn,
                  }),
                !he &&
                  jsxRuntime.jsx('button', {
                    className: 'docx-outline-nav',
                    onClick: ie,
                    onMouseDown: (y) => y.stopPropagation(),
                    title: 'Show document outline',
                    style: {
                      position: 'absolute',
                      left: 48,
                      top: vn + 12,
                      zIndex: 20,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '50%',
                      padding: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    },
                    children: jsxRuntime.jsx(chunkEOTZWQND_js.d, {
                      name: 'format_list_bulleted',
                      size: 20,
                      style: { color: '#444746' },
                    }),
                  }),
              ],
            }),
          }),
          jsxRuntime.jsx(Vu, {
            data: Fo,
            onNavigate: Yr,
            onCopy: Kt,
            onEdit: uo,
            onRemove: mn,
            onClose: po,
            readOnly: ut,
          }),
          jsxRuntime.jsx(chunkEOTZWQND_js.Z, {
            isOpen: Dt.isOpen,
            position: Dt.position,
            hasSelection: Dt.hasSelection,
            isEditable: !ut,
            items: Il,
            onAction: Fl,
            onClose: os,
          }),
          jsxRuntime.jsx(sonner.Toaster, { position: 'bottom-right' }),
          jsxRuntime.jsxs(uf.Suspense, {
            fallback: null,
            children: [
              yt.state.isOpen &&
                jsxRuntime.jsx(rS, {
                  isOpen: yt.state.isOpen,
                  onClose: yt.close,
                  onFind: Of,
                  onFindNext: zf,
                  onFindPrevious: $f,
                  onReplace: Wf,
                  onReplaceAll: _f,
                  initialSearchText: yt.state.searchText,
                  replaceMode: yt.state.replaceMode,
                  currentResult: $t.current,
                }),
              Ct.state.isOpen &&
                jsxRuntime.jsx(iS, {
                  isOpen: Ct.state.isOpen,
                  onClose: Ct.close,
                  onSubmit: co,
                  onRemove: Ct.state.isEditing ? ns : void 0,
                  initialData: Ct.state.initialData,
                  selectedText: Ct.state.selectedText,
                  isEditing: Ct.state.isEditing,
                }),
              le &&
                jsxRuntime.jsx(aS, {
                  isOpen: le,
                  onClose: () => _(false),
                  onApply: (y) => {
                    let h = He();
                    h && Fr(y)(h.state, h.dispatch);
                  },
                  currentProps: E.pmTableContext?.table?.attrs,
                }),
              J && jsxRuntime.jsx(sS, { isOpen: J, onClose: () => oe(false), onApply: Re }),
              fe &&
                jsxRuntime.jsx(lS, {
                  isOpen: fe,
                  onClose: () => Ce(false),
                  onApply: Ye,
                  currentData: E.pmImageContext
                    ? {
                        alt: E.pmImageContext.alt ?? void 0,
                        borderWidth: E.pmImageContext.borderWidth ?? void 0,
                        borderColor: E.pmImageContext.borderColor ?? void 0,
                        borderStyle: E.pmImageContext.borderStyle ?? void 0,
                      }
                    : void 0,
                }),
              Gr &&
                jsxRuntime.jsx(dS, {
                  isOpen: Gr,
                  onClose: () => Kr(false),
                  onApply: Lf,
                  currentProps: de.state?.package.document?.finalSectionProperties,
                }),
              R &&
                jsxRuntime.jsx(cS, {
                  isOpen: R,
                  onClose: () => K(false),
                  onApply: pt,
                  footnotePr: de.state?.package.document?.finalSectionProperties?.footnotePr,
                  endnotePr: de.state?.package.document?.finalSectionProperties?.endnotePr,
                }),
            ],
          }),
          jsxRuntime.jsx('input', {
            ref: ir,
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: ke,
          }),
        ],
      }),
    }),
  });
});
function jP(e, t, n = {}) {
  return new Promise((o, r) => {
    let i = uf__default.default.createRef(),
      a = null;
    try {
      a = client.createRoot(t);
    } catch (d) {
      r(d);
      return;
    }
    let s = {
        save: async () => {
          let d = await (i.current?.save() ?? Promise.resolve(null));
          return d
            ? new Blob([d], {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              })
            : null;
        },
        getDocument: () => i.current?.getDocument() ?? null,
        focus: () => i.current?.focus(),
        setZoom: (d) => i.current?.setZoom(d),
        destroy: () => {
          (a?.unmount(), (a = null));
        },
      },
      l = false,
      u = uf__default.default.createElement(df, {
        ...n,
        documentBuffer: e,
        onError: (d) => {
          (n.onError?.(d), l || ((l = true), r(d)));
        },
        onChange: (d) => {
          (n.onChange?.(d), l || ((l = true), o(s)));
        },
        ref: i,
      });
    a.render(u);
  });
}
function eM(e, t = {}) {
  let {
      storageKey: n,
      interval: o,
      enabled: r = true,
      maxAge: i,
      onSave: a,
      onError: s,
      onRecoveryAvailable: l,
      saveOnChange: u,
      debounceDelay: d,
    } = t,
    c = uf.useMemo(
      () =>
        new chunkFVUGBRDD_js.r({
          storageKey: n,
          interval: o,
          maxAge: i,
          saveOnChange: u,
          debounceDelay: d,
          onSave: a,
          onError: s,
          onRecoveryAvailable: l,
        }),
      [n]
    );
  (uf.useEffect(() => {
    r ? (c.enable(), c.startInterval()) : c.disable();
  }, [c, r]),
    uf.useEffect(() => {
      c.onDocumentChanged(e ?? null);
    }, [c, e]),
    uf.useEffect(
      () => () => {
        c.destroy();
      },
      [c]
    ));
  let p = uf.useSyncExternalStore(c.subscribe, c.getSnapshot),
    f = uf.useCallback(() => c.save(), [c]),
    m = uf.useCallback(() => c.clear(), [c]),
    b = uf.useCallback(() => c.getRecoveryData(), [c]),
    g = uf.useCallback(() => c.acceptRecovery(), [c]),
    x = uf.useCallback(() => c.dismissRecovery(), [c]),
    T = uf.useCallback(() => c.enable(), [c]),
    S = uf.useCallback(() => c.disable(), [c]);
  return {
    status: p.status,
    lastSaveTime: p.lastSaveTime,
    save: f,
    clearAutoSave: m,
    hasRecoveryData: p.hasRecoveryData,
    getRecoveryData: b,
    acceptRecovery: g,
    dismissRecovery: x,
    isEnabled: p.isEnabled,
    enable: T,
    disable: S,
  };
}
var kS = 1,
  pf = 0.25,
  ff = 4,
  TS = 0.1,
  cn = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
function mf(e, t, n) {
  return Math.max(t, Math.min(n, e));
}
function gf(e) {
  return Math.round(e * 100) / 100;
}
function wS(e) {
  let t = cn[0],
    n = Math.abs(e - t);
  for (let o of cn) {
    let r = Math.abs(e - o);
    r < n && ((n = r), (t = o));
  }
  return t;
}
function CS(e) {
  for (let t of cn) if (t > e + 0.01) return t;
  return cn[cn.length - 1];
}
function vS(e) {
  for (let t = cn.length - 1; t >= 0; t--) if (cn[t] < e - 0.01) return cn[t];
  return cn[0];
}
function oM(e = {}) {
  let {
      initialZoom: t = kS,
      minZoom: n = pf,
      maxZoom: o = ff,
      zoomStep: r = TS,
      enabled: i = true,
      containerRef: a,
      onZoomChange: s,
      enableKeyboardShortcuts: l = true,
      preventDefault: u = true,
    } = e,
    [d, c] = uf.useState(t),
    p = uf.useRef(d);
  uf.useEffect(() => {
    p.current = d;
  }, [d]);
  let f = uf.useCallback(
      (v) => {
        let M = gf(mf(v, n, o));
        M !== p.current && (c(M), s?.(M));
      },
      [n, o, s]
    ),
    m = uf.useCallback(() => {
      f(p.current + r);
    }, [r, f]),
    b = uf.useCallback(() => {
      f(p.current - r);
    }, [r, f]),
    g = uf.useCallback(() => {
      f(t);
    }, [t, f]),
    x = uf.useCallback(() => {
      f(1);
    }, [f]),
    T = uf.useCallback(
      (v, M) => {
        if (M > 0) {
          let U = v / M;
          f(U);
        }
      },
      [f]
    ),
    S = uf.useCallback(
      (v) => {
        if (!i || !(v.ctrlKey || v.metaKey)) return;
        u && v.preventDefault();
        let U = v.deltaY;
        U < 0 ? f(p.current + r) : U > 0 && f(p.current - r);
      },
      [i, u, r, f]
    ),
    B = uf.useCallback(
      (v) => {
        if (!(!i || !l || !(v.ctrlKey || v.metaKey))) {
          if (v.key === '0') {
            (v.preventDefault(), x());
            return;
          }
          if (v.key === '+' || v.key === '=') {
            (v.preventDefault(), m());
            return;
          }
          if (v.key === '-') {
            (v.preventDefault(), b());
            return;
          }
        }
      },
      [i, l, m, b, x]
    );
  return (
    uf.useEffect(() => {
      if (!i) return;
      let v = a?.current;
      if (v)
        return (
          v.addEventListener('wheel', S, { passive: false }),
          () => {
            v.removeEventListener('wheel', S);
          }
        );
    }, [i, a, S]),
    uf.useEffect(() => {
      if (!(!i || !l))
        return (
          document.addEventListener('keydown', B),
          () => {
            document.removeEventListener('keydown', B);
          }
        );
    }, [i, l, B]),
    {
      zoom: d,
      setZoom: f,
      zoomIn: m,
      zoomOut: b,
      resetZoom: g,
      zoomTo100: x,
      zoomToFit: T,
      isMinZoom: d <= n,
      isMaxZoom: d >= o,
      zoomPercent: Math.round(d * 100),
      handleWheel: S,
      handleKeyDown: B,
    }
  );
}
function rM() {
  return [...cn];
}
function iM(e) {
  return wS(e);
}
function aM(e) {
  return CS(e);
}
function sM(e) {
  return vS(e);
}
function lM(e) {
  return `${Math.round(e * 100)}%`;
}
function cM(e) {
  let t = e.match(/(\d+(\.\d+)?)/);
  if (t) {
    let n = parseFloat(t[1]);
    if (!isNaN(n)) return n / 100;
  }
  return null;
}
function dM(e) {
  return cn.some((t) => Math.abs(t - e) < 0.01);
}
function uM(e, t = pf, n = ff) {
  return gf(mf(e, t, n));
}
var er = {
    backgroundColor: 'rgba(26, 115, 232, 0.3)',
    borderRadius: 0,
    zIndex: 0,
    opacity: 1,
    mixBlendMode: 'multiply',
  },
  fM = {
    backgroundColor: 'rgba(0, 120, 215, 0.4)',
    borderColor: 'rgba(0, 120, 215, 0.6)',
    borderRadius: 1,
    zIndex: 0,
    opacity: 1,
  },
  mM = {
    backgroundColor: '--docx-selection-bg',
    borderColor: '--docx-selection-border',
    textColor: '--docx-selection-text',
  };
function hf(e) {
  let t = window.getSelection();
  if (!t || t.rangeCount === 0 || t.isCollapsed) return [];
  let n = t.getRangeAt(0);
  if (e && !e.contains(n.commonAncestorContainer)) return [];
  let o = n.getClientRects(),
    r = [],
    i = 0,
    a = 0;
  if (e) {
    let s = e.getBoundingClientRect();
    ((i = s.left + e.scrollLeft), (a = s.top + e.scrollTop));
  }
  for (let s = 0; s < o.length; s++) {
    let l = o[s];
    (l.width === 0 && l.height === 0) ||
      r.push({ left: l.left - i, top: l.top - a, width: l.width, height: l.height });
  }
  return r;
}
function RS(e, t = 2) {
  if (e.length <= 1) return e;
  let n = [...e].sort((i, a) => (Math.abs(i.top - a.top) < t ? i.left - a.left : i.top - a.top)),
    o = [],
    r = { ...n[0] };
  for (let i = 1; i < n.length; i++) {
    let a = n[i],
      s = Math.abs(a.top - r.top) < t,
      l = a.left <= r.left + r.width + t;
    if (s && l) {
      let u = Math.max(r.left + r.width, a.left + a.width);
      ((r.width = u - r.left), (r.height = Math.max(r.height, a.height)));
    } else (o.push(r), (r = { ...a }));
  }
  return (o.push(r), o);
}
function Ml(e) {
  let t = hf(e);
  return RS(t);
}
function gM(e, t = er) {
  return {
    position: 'absolute',
    left: `${e.left}px`,
    top: `${e.top}px`,
    width: `${e.width}px`,
    height: `${e.height}px`,
    backgroundColor: t.backgroundColor,
    borderRadius: t.borderRadius ? `${t.borderRadius}px` : void 0,
    border: t.borderColor ? `1px solid ${t.borderColor}` : void 0,
    zIndex: t.zIndex ?? 0,
    opacity: t.opacity ?? 1,
    mixBlendMode: t.mixBlendMode,
    pointerEvents: 'none',
    userSelect: 'none',
  };
}
function hM(e, t = er) {
  let n = t.backgroundColor;
  return `
    ${e}::selection,
    ${e} *::selection {
      background-color: ${n} !important;
      color: inherit !important;
    }

    ${e}::-moz-selection,
    ${e} *::-moz-selection {
      background-color: ${n} !important;
      color: inherit !important;
    }
  `;
}
function bf() {
  let e = window.getSelection();
  return e !== null && !e.isCollapsed && e.rangeCount > 0;
}
function yf() {
  let e = window.getSelection();
  return e ? e.toString() : '';
}
function xf(e) {
  let t = window.getSelection();
  if (!t || t.rangeCount === 0) return false;
  let n = t.getRangeAt(0);
  return e.contains(n.commonAncestorContainer);
}
function bM() {
  let e = window.getSelection();
  return !e || e.rangeCount === 0 ? null : e.getRangeAt(0).getBoundingClientRect();
}
function yM(e, t, n, o, r) {
  try {
    let i = document.createRange();
    return (i.setStart(t, n), i.setEnd(o, r), i);
  } catch {
    return null;
  }
}
function xM(e) {
  let t = window.getSelection();
  t && (t.removeAllRanges(), t.addRange(e));
}
function SM() {
  let e = window.getSelection();
  e && e.removeAllRanges();
}
function ES() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0) return false;
  let t = e.anchorNode,
    n = e.focusNode;
  return !t || !n
    ? false
    : t === n
      ? e.focusOffset < e.anchorOffset
      : (t.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}
function kM() {
  let e = window.getSelection();
  if (!e || e.rangeCount === 0 || !ES()) return;
  let t = e.getRangeAt(0),
    n = document.createRange();
  (n.setStart(t.startContainer, t.startOffset),
    n.setEnd(t.endContainer, t.endOffset),
    e.removeAllRanges(),
    e.addRange(n));
}
var so = null;
function Sf(e = er) {
  PS();
  let t = `
    /* DOCX Editor Selection Highlighting */

    /* Base selection style for all editable content */
    .docx-editor [contenteditable="true"]::selection,
    .docx-editor [contenteditable="true"] *::selection,
    .docx-run-editable::selection,
    .docx-run-editable *::selection {
      background-color: ${e.backgroundColor} !important;
      color: inherit !important;
    }

    /* Firefox selection */
    .docx-editor [contenteditable="true"]::-moz-selection,
    .docx-editor [contenteditable="true"] *::-moz-selection,
    .docx-run-editable::-moz-selection,
    .docx-run-editable *::-moz-selection {
      background-color: ${e.backgroundColor} !important;
      color: inherit !important;
    }

    /* Ensure selection is visible against all backgrounds */
    .docx-run-highlighted::selection,
    .docx-run-highlighted *::selection {
      /* For highlighted (yellow background) text, use darker selection */
      background-color: rgba(26, 115, 232, 0.5) !important;
    }

    .docx-run-highlighted::-moz-selection,
    .docx-run-highlighted *::-moz-selection {
      background-color: rgba(26, 115, 232, 0.5) !important;
    }

    /* Selection in dark text */
    .docx-run-dark-bg::selection,
    .docx-run-dark-bg *::selection {
      /* Use lighter selection for dark backgrounds */
      background-color: rgba(100, 181, 246, 0.5) !important;
    }

    .docx-run-dark-bg::-moz-selection,
    .docx-run-dark-bg *::-moz-selection {
      background-color: rgba(100, 181, 246, 0.5) !important;
    }

    /* Programmatic highlight class */
    .docx-selection-highlight {
      background-color: ${e.backgroundColor};
      ${e.borderRadius ? `border-radius: ${e.borderRadius}px;` : ''}
      ${e.mixBlendMode ? `mix-blend-mode: ${e.mixBlendMode};` : ''}
    }

    /* Find/replace highlight */
    .docx-find-highlight {
      background-color: rgba(255, 235, 59, 0.5);
      border-radius: 2px;
    }

    .docx-find-highlight-current {
      background-color: rgba(255, 152, 0, 0.6);
      border-radius: 2px;
      outline: 2px solid rgba(255, 152, 0, 0.8);
    }

    /* AI action selection preview */
    .docx-ai-selection-preview {
      background-color: rgba(156, 39, 176, 0.2);
      border-bottom: 2px dashed rgba(156, 39, 176, 0.6);
    }
  `;
  ((so = document.createElement('style')),
    (so.id = 'docx-selection-styles'),
    (so.textContent = t),
    document.head.appendChild(so));
}
function PS() {
  so && (so.remove(), (so = null));
  let e = document.getElementById('docx-selection-styles');
  e && e.remove();
}
function kf() {
  return so !== null || document.getElementById('docx-selection-styles') !== null;
}
function TM(e, t, n = true) {
  return () => {
    if (!e) {
      t([]);
      return;
    }
    let o = n ? Ml(e) : hf(e);
    t(o);
  };
}
function PM(e) {
  let {
      containerRef: t,
      enabled: n = true,
      config: o = er,
      useOverlay: r = false,
      debounceMs: i = 16,
      onSelectionChange: a,
    } = e,
    [s, l] = uf.useState(false),
    [u, d] = uf.useState(''),
    [c, p] = uf.useState([]),
    [f, m] = uf.useState(false),
    b = uf.useRef(null),
    g = uf.useRef(0),
    x = uf.useCallback(() => {
      let v = t.current,
        M = bf(),
        U = yf(),
        ee = v ? xf(v) : false;
      if ((l(M), d(U), m(ee), r && ee)) {
        let O = Ml(v);
        p(O);
      } else p([]);
      a && a(M && ee, U);
    }, [t, r, a]),
    T = uf.useCallback(() => {
      let v = performance.now();
      if (v - g.current < i) {
        (b.current !== null && clearTimeout(b.current),
          (b.current = window.setTimeout(() => {
            ((g.current = performance.now()), x(), (b.current = null));
          }, i)));
        return;
      }
      ((g.current = v), x());
    }, [i, x]),
    S = uf.useCallback(() => {
      x();
    }, [x]),
    B = uf.useCallback(
      (v) => ({
        position: 'absolute',
        left: `${v.left}px`,
        top: `${v.top}px`,
        width: `${v.width}px`,
        height: `${v.height}px`,
        backgroundColor: o.backgroundColor,
        borderRadius: o.borderRadius ? `${o.borderRadius}px` : void 0,
        border: o.borderColor ? `1px solid ${o.borderColor}` : void 0,
        zIndex: o.zIndex ?? 0,
        opacity: o.opacity ?? 1,
        mixBlendMode: o.mixBlendMode,
        pointerEvents: 'none',
        userSelect: 'none',
      }),
      [o]
    );
  return (
    uf.useEffect(() => (n && !kf() && Sf(o), () => {}), [n, o]),
    uf.useEffect(() => {
      if (!n) return;
      let v = () => {
        T();
      };
      return (
        document.addEventListener('selectionchange', v),
        document.addEventListener('mouseup', v),
        x(),
        () => {
          (document.removeEventListener('selectionchange', v),
            document.removeEventListener('mouseup', v),
            b.current !== null && clearTimeout(b.current));
        }
      );
    }, [n, T, x]),
    {
      hasSelection: s,
      selectedText: u,
      highlightRects: c,
      isSelectionInContainer: f,
      refresh: S,
      getOverlayStyle: B,
    }
  );
}
function MM(e, t = er) {
  return e.map((n, o) =>
    uf__default.default.createElement('div', {
      key: `selection-overlay-${o}`,
      style: {
        position: 'absolute',
        left: `${n.left}px`,
        top: `${n.top}px`,
        width: `${n.width}px`,
        height: `${n.height}px`,
        backgroundColor: t.backgroundColor,
        borderRadius: t.borderRadius ? `${t.borderRadius}px` : void 0,
        border: t.borderColor ? `1px solid ${t.borderColor}` : void 0,
        zIndex: t.zIndex ?? 0,
        opacity: t.opacity ?? 1,
        mixBlendMode: t.mixBlendMode,
        pointerEvents: 'none',
        userSelect: 'none',
      },
    })
  );
}
function AM(e = {}) {
  let {
      onCopy: t,
      onCut: n,
      onPaste: o,
      cleanWordFormatting: r = true,
      editable: i = true,
      onError: a,
    } = e,
    s = uf.useRef(false),
    l = uf.useRef(null),
    u = uf.useCallback(
      async (g) => {
        if (s.current) return false;
        s.current = true;
        try {
          let x = await chunkEOTZWQND_js.M(g.runs, { onError: a });
          return (x && t?.(g), x);
        } finally {
          s.current = false;
        }
      },
      [t, a]
    ),
    d = uf.useCallback(
      async (g) => {
        if (s.current || !i) return false;
        s.current = true;
        try {
          let x = await chunkEOTZWQND_js.M(g.runs, { onError: a });
          return (x && n?.(g), x);
        } finally {
          s.current = false;
        }
      },
      [n, i, a]
    ),
    c = uf.useCallback(
      async (g = false) => {
        if (s.current || !i) return null;
        s.current = true;
        try {
          if (navigator.clipboard && navigator.clipboard.read) {
            let x = await navigator.clipboard.read(),
              T = '',
              S = '';
            for (let v of x)
              (v.types.includes('text/html') && (T = await (await v.getType('text/html')).text()),
                v.types.includes('text/plain') &&
                  (S = await (await v.getType('text/plain')).text()));
            g && (T = '');
            let B = chunkEOTZWQND_js.T(T, S, r);
            return ((l.current = B), o?.(B, g), B);
          }
          return null;
        } catch (x) {
          return (a?.(x), null);
        } finally {
          s.current = false;
        }
      },
      [i, r, o, a]
    ),
    p = uf.useCallback(
      (g) => {
        let x = chunkFVUGBRDD_js.F();
        if (!x) return;
        g.preventDefault();
        let T = chunkEOTZWQND_js.O(x.runs);
        (g.clipboardData &&
          (g.clipboardData.setData('text/plain', T.plainText),
          g.clipboardData.setData('text/html', T.html),
          T.internal && g.clipboardData.setData('application/x-docx-editor', T.internal)),
          t?.(x));
      },
      [t]
    ),
    f = uf.useCallback(
      (g) => {
        if (!i) return;
        let x = chunkFVUGBRDD_js.F();
        if (!x) return;
        g.preventDefault();
        let T = chunkEOTZWQND_js.O(x.runs);
        (g.clipboardData &&
          (g.clipboardData.setData('text/plain', T.plainText),
          g.clipboardData.setData('text/html', T.html),
          T.internal && g.clipboardData.setData('application/x-docx-editor', T.internal)),
          n?.(x));
      },
      [i, n]
    ),
    m = uf.useCallback(
      (g) => {
        if (!i) return;
        g.preventDefault();
        let x = chunkEOTZWQND_js.S(g, { cleanWordFormatting: r });
        if (x) {
          l.current = x;
          let T = g.shiftKey ?? false;
          o?.(x, T);
        }
      },
      [i, r, o]
    ),
    b = uf.useCallback((g) => {}, []);
  return {
    copy: u,
    cut: d,
    paste: c,
    handleCopy: p,
    handleCut: f,
    handlePaste: m,
    handleKeyDown: b,
    isProcessing: s.current,
    lastPastedContent: l.current,
  };
}
var Xa = {
    position: 'right',
    defaultSize: 280,
    minSize: 200,
    maxSize: 500,
    resizable: true,
    collapsible: true,
    defaultCollapsed: false,
  },
  Rf = chunkFVUGBRDD_js.I,
  Ef = `
.plugin-host {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: visible;
  position: relative;
}

.plugin-host-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: visible;
}


.plugin-panels-left,
.plugin-panels-right {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #f8f9fa;
  border-color: #e9ecef;
}

.plugin-panels-left {
  border-right: 1px solid #e9ecef;
}

.plugin-panels-right {
  border-left: 1px solid #e9ecef;
}

.plugin-panels-bottom {
  border-top: 1px solid #e9ecef;
  background: #f8f9fa;
}

.plugin-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease, height 0.2s ease;
}

.plugin-panel.collapsed {
  overflow: visible;
}

.plugin-panel-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #6c757d;
  white-space: nowrap;
}

.plugin-panel.collapsed .plugin-panel-toggle {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  flex-direction: column;
  height: 100%;
  padding: 8px 6px;
}

.plugin-panel-toggle:hover {
  background: #e9ecef;
  color: #495057;
}

.plugin-panel-toggle-icon {
  font-weight: bold;
  font-size: 14px;
}

.plugin-panel.collapsed .plugin-panel-toggle-icon {
  transform: rotate(90deg);
}

.plugin-panel-toggle-label {
  font-weight: 500;
}

.plugin-panel-content {
  flex: 1;
  overflow: auto;
}

/* Right panel rendered inside viewport - scrolls with content */
.plugin-panel-in-viewport {
  position: absolute;
  top: 0;
  /* Position is set dynamically via inline styles based on page edge */
  width: 220px;
  pointer-events: auto;
  z-index: 10;
  overflow: visible;
}

.plugin-panel-in-viewport.collapsed {
  width: 32px;
}

.plugin-panel-in-viewport .plugin-panel-toggle {
  position: sticky;
  top: 0;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.plugin-panel-in-viewport-content {
  overflow: visible;
  position: relative;
}

/* Plugin overlay container for rendering highlights/decorations */
.plugin-overlays-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: visible;
  z-index: 5;
}

.plugin-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

/* Individual overlay children manage their own pointer-events.
   Do NOT set pointer-events: auto here \u2014 it overrides overlay containers
   that need pointer-events: none to let clicks pass through to the editor. */
`,
  AS = uf.forwardRef(function ({ plugins: t, children: n, className: o = '' }, r) {
    let [i, a] = uf.useState(null),
      s = uf.useRef(n.props);
    s.current = n.props;
    let [l, u] = uf.useState(null),
      d = uf.useMemo(() => new chunkFVUGBRDD_js.J(), []),
      c = uf.useSyncExternalStore(d.subscribe, d.getSnapshot),
      [p, f] = uf.useState(() => {
        let D = new Set();
        for (let z of t) ({ ...Xa, ...z.panelConfig }).defaultCollapsed && D.add(z.id);
        return D;
      }),
      [m] = uf.useState(() => {
        let D = new Map();
        for (let z of t) {
          let ae = { ...Xa, ...z.panelConfig };
          D.set(z.id, ae.defaultSize);
        }
        return D;
      });
    (uf.useEffect(() => {
      if (!i) return;
      let D = t.map((z) => ({
        id: z.id,
        styles: z.styles,
        initialize: z.initialize,
        onStateChange: z.onStateChange,
        destroy: z.destroy,
      }));
      return (
        d.initialize(D, i),
        () => {
          d.destroy();
        }
      );
    }, [d, i, t]),
      uf.useEffect(() => {
        let D = t.filter((z) => z.styles).map((z) => Rf(z.id, z.styles));
        return () => D.forEach((z) => z());
      }, [t]),
      uf.useEffect(() => {
        if (!i?.dom) return;
        let D = () => {
            d.updateStates(i);
          },
          z = null,
          ae = () => {
            (z && cancelAnimationFrame(z), (z = requestAnimationFrame(D)));
          };
        D();
        let se = i.dom;
        (se.addEventListener('input', ae),
          se.addEventListener('focus', D),
          se.addEventListener('click', D));
        let A = i.dispatch.bind(i);
        return (
          (i.dispatch = (Ie) => {
            (A(Ie), ae());
          }),
          () => {
            (se.removeEventListener('input', ae),
              se.removeEventListener('focus', D),
              se.removeEventListener('click', D),
              z && cancelAnimationFrame(z),
              (i.dispatch = A));
          }
        );
      }, [i, d]),
      uf.useEffect(() => Rf('plugin-host-base', Ef), []));
    let b = uf.useCallback(
        (D) => {
          if (!i) return;
          if (i.coordsAtPos(D)) {
            i.dom.scrollIntoView({ block: 'center', inline: 'nearest' });
            let { state: ae } = i,
              se = ae.doc.resolve(Math.min(D, ae.doc.content.size)),
              A = ae.tr.setSelection(prosemirrorState.TextSelection.near(se));
            (i.dispatch(A), i.focus());
          }
        },
        [i]
      ),
      g = uf.useCallback(
        (D, z) => {
          if (!i) return;
          let { state: ae } = i,
            se = ae.doc.content.size,
            A = Math.max(0, Math.min(D, se)),
            Ie = Math.max(0, Math.min(z, se)),
            Fe = ae.tr.setSelection(prosemirrorState.TextSelection.create(ae.doc, A, Ie));
          (i.dispatch(Fe), i.focus());
        },
        [i]
      ),
      x = uf.useCallback((D) => d.getPluginState(D), [d]),
      T = uf.useCallback(
        (D, z) => {
          d.setPluginState(D, z);
        },
        [d]
      ),
      S = uf.useCallback(() => {
        i && d.updateStates(i);
      }, [i, d]);
    uf.useImperativeHandle(
      r,
      () => ({
        getPluginState: x,
        setPluginState: T,
        getEditorView: () => i,
        refreshPluginStates: S,
      }),
      [x, T, i, S]
    );
    let B = uf.useMemo(() => {
        let D = [];
        for (let z of t) z.proseMirrorPlugins && D.push(...z.proseMirrorPlugins);
        return D;
      }, [t]),
      v = uf.useCallback((D) => {
        f((z) => {
          let ae = new Set(z);
          return (ae.has(D) ? ae.delete(D) : ae.add(D), ae);
        });
      }, []),
      [M, U] = uf.useState(null);
    uf.useEffect(() => {
      if (!l) {
        U(null);
        return;
      }
      let D = () => {
        let se = l.pagesContainer,
          A = se.querySelector('.layout-page');
        if (!A) {
          U(null);
          return;
        }
        let Ie = l.getContainerOffset(),
          Fe = A.getBoundingClientRect(),
          Ue = se.getBoundingClientRect(),
          P = (Fe.right - Ue.left) / l.zoom,
          F = Ie.x + P + 5;
        U(F);
      };
      D();
      let z = () => {
        requestAnimationFrame(D);
      };
      window.addEventListener('resize', z);
      let ae = new ResizeObserver(() => {
        requestAnimationFrame(D);
      });
      return (
        ae.observe(l.pagesContainer),
        () => {
          (window.removeEventListener('resize', z), ae.disconnect());
        }
      );
    }, [l]);
    let ee = uf.useMemo(() => {
        let D = [];
        if (l) {
          for (let z of t)
            if (z.renderOverlay) {
              let ae = c.states.get(z.id);
              D.push(
                jsxRuntime.jsx(
                  'div',
                  {
                    className: 'plugin-overlay',
                    'data-plugin-id': z.id,
                    children: z.renderOverlay(l, ae, i),
                  },
                  `overlay-${z.id}`
                )
              );
            }
        }
        for (let z of t) {
          if (!z.Panel || (z.panelConfig?.position ?? 'right') !== 'right') continue;
          let se = { ...Xa, ...z.panelConfig },
            A = p.has(z.id),
            Ie = m.get(z.id) ?? se.defaultSize,
            Fe = z.Panel,
            Ue = c.states.get(z.id),
            P = M !== null ? `${M}px` : 'calc(50% + 428px)';
          D.push(
            jsxRuntime.jsxs(
              'div',
              {
                className: `plugin-panel-in-viewport ${A ? 'collapsed' : ''}`,
                style: { width: A ? '32px' : `${Ie}px`, left: P },
                'data-plugin-id': z.id,
                children: [
                  se.collapsible &&
                    jsxRuntime.jsx('button', {
                      className: 'plugin-panel-toggle',
                      onClick: () => v(z.id),
                      title: A ? `Show ${z.name}` : `Hide ${z.name}`,
                      'aria-label': A ? `Show ${z.name}` : `Hide ${z.name}`,
                      children: jsxRuntime.jsx('span', {
                        className: 'plugin-panel-toggle-icon',
                        children: A ? '\u2039' : '\u203A',
                      }),
                    }),
                  !A &&
                    l &&
                    jsxRuntime.jsx('div', {
                      className: 'plugin-panel-in-viewport-content',
                      children: jsxRuntime.jsx(Fe, {
                        editorView: i,
                        doc: i?.state.doc ?? null,
                        scrollToPosition: b,
                        selectRange: g,
                        pluginState: Ue,
                        panelWidth: Ie,
                        renderedDomContext: l,
                      }),
                    }),
                ],
              },
              `panel-overlay-${z.id}`
            )
          );
        }
        return D.length > 0 ? D : null;
      }, [l, t, c.version, i, p, m, b, g, v, M]),
      O = uf.useCallback((D) => {
        u(D);
        let z = s.current?.onRenderedDomContextReady;
        typeof z == 'function' && z(D);
      }, []),
      N = uf.useMemo(
        () =>
          uf.cloneElement(n, {
            externalPlugins: B,
            pluginOverlays: ee,
            onRenderedDomContextReady: O,
            onEditorViewReady: (D) => {
              a(D);
              let z = s.current?.onEditorViewReady;
              typeof z == 'function' && z(D);
            },
          }),
        [n, B, ee, O]
      ),
      ne = uf.useMemo(() => {
        let D = [],
          z = [],
          ae = [];
        for (let se of t) {
          if (!se.Panel) continue;
          let A = se.panelConfig?.position ?? 'right';
          A === 'left' ? D.push(se) : A === 'bottom' ? ae.push(se) : z.push(se);
        }
        return { left: D, right: z, bottom: ae };
      }, [t]),
      ce = (D) => {
        if (!D.Panel) return null;
        let z = { ...Xa, ...D.panelConfig },
          ae = p.has(D.id),
          se = m.get(D.id) ?? z.defaultSize,
          A = D.Panel,
          Ie = c.states.get(D.id);
        return jsxRuntime.jsxs(
          'div',
          {
            className: `plugin-panel plugin-panel-${z.position} ${ae ? 'collapsed' : ''}`,
            style: {
              [z.position === 'bottom' ? 'height' : 'width']: ae ? '32px' : `${se}px`,
              minWidth: z.position !== 'bottom' ? (ae ? '32px' : `${z.minSize}px`) : void 0,
              maxWidth: z.position !== 'bottom' ? `${z.maxSize}px` : void 0,
              minHeight: z.position === 'bottom' ? (ae ? '32px' : `${z.minSize}px`) : void 0,
              maxHeight: z.position === 'bottom' ? `${z.maxSize}px` : void 0,
            },
            'data-plugin-id': D.id,
            children: [
              z.collapsible &&
                jsxRuntime.jsxs('button', {
                  className: 'plugin-panel-toggle',
                  onClick: () => v(D.id),
                  title: ae ? `Show ${D.name}` : `Hide ${D.name}`,
                  'aria-label': ae ? `Show ${D.name}` : `Hide ${D.name}`,
                  children: [
                    jsxRuntime.jsx('span', {
                      className: 'plugin-panel-toggle-icon',
                      children: ae ? '\u203A' : '\u2039',
                    }),
                    ae &&
                      jsxRuntime.jsx('span', {
                        className: 'plugin-panel-toggle-label',
                        children: D.name,
                      }),
                  ],
                }),
              !ae &&
                jsxRuntime.jsx('div', {
                  className: 'plugin-panel-content',
                  children: jsxRuntime.jsx(A, {
                    editorView: i,
                    doc: i?.state.doc ?? null,
                    scrollToPosition: b,
                    selectRange: g,
                    pluginState: Ie,
                    panelWidth: se,
                    renderedDomContext: l ?? null,
                  }),
                }),
            ],
          },
          D.id
        );
      };
    return jsxRuntime.jsxs('div', {
      className: `plugin-host ${o}`,
      children: [
        ne.left.length > 0 &&
          jsxRuntime.jsx('div', { className: 'plugin-panels-left', children: ne.left.map(ce) }),
        jsxRuntime.jsxs('div', {
          className: 'plugin-host-editor',
          children: [
            N,
            ne.bottom.length > 0 &&
              jsxRuntime.jsx('div', {
                className: 'plugin-panels-bottom',
                children: ne.bottom.map(ce),
              }),
          ],
        }),
      ],
    });
  });
exports.A = RS;
exports.B = Ml;
exports.C = gM;
exports.D = hM;
exports.E = bf;
exports.F = yf;
exports.G = xf;
exports.H = bM;
exports.I = yM;
exports.J = xM;
exports.K = SM;
exports.L = ES;
exports.M = kM;
exports.N = Sf;
exports.O = PS;
exports.P = kf;
exports.Q = TM;
exports.R = PM;
exports.S = MM;
exports.T = AM;
exports.U = Ef;
exports.V = AS;
exports.a = Wt;
exports.b = QS;
exports.c = vc;
exports.d = si;
exports.e = ek;
exports.f = tk;
exports.g = nk;
exports.h = ok;
exports.i = Ec;
exports.j = df;
exports.k = jP;
exports.l = eM;
exports.m = cn;
exports.n = oM;
exports.o = rM;
exports.p = iM;
exports.q = aM;
exports.r = sM;
exports.s = lM;
exports.t = cM;
exports.u = dM;
exports.v = uM;
exports.w = er;
exports.x = fM;
exports.y = mM;
exports.z = hf;
