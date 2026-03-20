'use strict';
var chunkXJCWBPY7_js = require('./chunk-XJCWBPY7.js'),
  chunkNGK4AG2P_js = require('./chunk-NGK4AG2P.js'),
  chunk6L7HNODA_js = require('./chunk-6L7HNODA.js'),
  chunk65V65RRX_js = require('./chunk-65V65RRX.js'),
  chunkWGRUTBZG_js = require('./chunk-WGRUTBZG.js'),
  chunk4FIPZCBR_js = require('./chunk-4FIPZCBR.js'),
  chunkAZGNVGHV_js = require('./chunk-AZGNVGHV.js'),
  chunk5XGN7UAV_js = require('./chunk-5XGN7UAV.js');
function E() {
  return { type: 'break', breakType: 'page' };
}
function ft() {
  return { type: 'break', breakType: 'column' };
}
function St(t) {
  return { type: 'break', breakType: 'textWrapping', clear: t };
}
function vt() {
  return { type: 'run', content: [E()] };
}
function R() {
  return { type: 'paragraph', content: [], formatting: { pageBreakBefore: true } };
}
function I(t) {
  return t.content.filter((n) => n.type === 'run');
}
function bt(t, n) {
  let { paragraphIndex: e } = n,
    o = [...(t.package.document.content || [])],
    r = R();
  return (
    o.splice(e + 1, 0, r),
    { ...t, package: { ...t.package, document: { ...t.package.document, content: o } } }
  );
}
function k() {
  return {
    type: 'paragraph',
    content: [],
    formatting: {
      borders: { bottom: { style: 'single', color: { rgb: '000000' }, size: 12, space: 1 } },
      spaceBefore: 120,
      spaceAfter: 120,
    },
  };
}
function xt(t, n) {
  let { paragraphIndex: e } = n,
    o = [...(t.package.document.content || [])],
    r = k();
  return (
    o.splice(e + 1, 0, r),
    { ...t, package: { ...t.package, document: { ...t.package.document, content: o } } }
  );
}
function d(t) {
  return t.type === 'break' && t.breakType === 'page';
}
function yt(t) {
  return t.type === 'break' && t.breakType === 'column';
}
function Ct(t) {
  return t.type === 'break' && t.breakType === 'textWrapping';
}
function Tt(t) {
  return t.type === 'break';
}
function g(t) {
  return t.formatting?.pageBreakBefore === true;
}
function Dt(t) {
  let n = 0;
  for (let e of t.package.document.content || [])
    if (e.type === 'paragraph') {
      let o = e;
      g(o) && n++;
      let r = I(o);
      for (let a of r) for (let s of a.content) d(s) && n++;
    }
  return n;
}
function Et(t) {
  let n = [],
    e = t.package.document.content || [];
  for (let o = 0; o < e.length; o++) {
    let r = e[o];
    if (r.type === 'paragraph') {
      let a = r;
      g(a) && n.push({ paragraphIndex: o });
      let s = I(a);
      for (let l = 0; l < s.length; l++) {
        let c = s[l];
        for (let p of c.content) d(p) && n.push({ paragraphIndex: o, runIndex: l });
      }
    }
  }
  return n;
}
function Rt(t, n) {
  let { paragraphIndex: e, runIndex: o } = n,
    r = [...(t.package.document.content || [])],
    a = r[e];
  if (a.type !== 'paragraph') return t;
  let s = a;
  if (g(s) && o === void 0)
    return (
      (r[e] = { ...s, formatting: { ...s.formatting, pageBreakBefore: false } }),
      { ...t, package: { ...t.package, document: { ...t.package.document, content: r } } }
    );
  if (o !== void 0) {
    let l = [],
      c = 0;
    for (let p of s.content)
      if (p.type === 'run') {
        if (c === o) {
          let D = p.content.filter((X) => !d(X));
          D.length > 0 && l.push({ ...p, content: D });
        } else l.push(p);
        c++;
      } else l.push(p);
    return (
      (r[e] = { ...s, content: l }),
      { ...t, package: { ...t.package, document: { ...t.package.document, content: r } } }
    );
  }
  return t;
}
var u = class {
  constructor(n) {
    chunk5XGN7UAV_js.a(this, 'listeners', new Set());
    chunk5XGN7UAV_js.a(this, 'snapshot');
    chunk5XGN7UAV_js.a(
      this,
      'subscribe',
      (n) => (
        this.listeners.add(n),
        () => {
          this.listeners.delete(n);
        }
      )
    );
    chunk5XGN7UAV_js.a(this, 'getSnapshot', () => this.snapshot);
    this.snapshot = n;
  }
  setSnapshot(n) {
    ((this.snapshot = n), this.notify());
  }
  notify() {
    for (let n of this.listeners) n();
  }
};
var _ = 'docx-editor-autosave',
  It = 3e4,
  kt = 1440 * 60 * 1e3,
  Pt = 2e3,
  A = 1;
function L() {
  try {
    let t = '__docx_editor_test__';
    return (localStorage.setItem(t, 'test'), localStorage.removeItem(t), !0);
  } catch {
    return false;
  }
}
function P(t) {
  return JSON.stringify({ ...t, originalBuffer: null });
}
function _t(t) {
  try {
    let n = JSON.parse(t);
    return !n || typeof n != 'object' || !n.document || !n.savedAt
      ? null
      : (n.version !== A && console.warn('Auto-save data version mismatch, may need migration'), n);
  } catch {
    return null;
  }
}
function At(t, n) {
  let e = new Date(t).getTime();
  return Date.now() - e > n;
}
var h = class extends u {
  constructor(e = {}) {
    super({ status: 'idle', lastSaveTime: null, hasRecoveryData: false, isEnabled: true });
    chunk5XGN7UAV_js.a(this, 'storageKey');
    chunk5XGN7UAV_js.a(this, 'interval');
    chunk5XGN7UAV_js.a(this, 'maxAge');
    chunk5XGN7UAV_js.a(this, 'saveOnChange');
    chunk5XGN7UAV_js.a(this, 'debounceDelay');
    chunk5XGN7UAV_js.a(this, 'onSaveCallback');
    chunk5XGN7UAV_js.a(this, 'onErrorCallback');
    chunk5XGN7UAV_js.a(this, 'onRecoveryAvailableCallback');
    chunk5XGN7UAV_js.a(this, 'storageAvailable');
    chunk5XGN7UAV_js.a(this, 'currentDocument', null);
    chunk5XGN7UAV_js.a(this, 'lastSavedJson', null);
    chunk5XGN7UAV_js.a(this, 'intervalTimer', null);
    chunk5XGN7UAV_js.a(this, 'debounceTimer', null);
    chunk5XGN7UAV_js.a(this, 'status', 'idle');
    chunk5XGN7UAV_js.a(this, 'lastSaveTime', null);
    chunk5XGN7UAV_js.a(this, '_hasRecoveryData', false);
    chunk5XGN7UAV_js.a(this, '_isEnabled');
    ((this.storageKey = e.storageKey ?? _),
      (this.interval = e.interval ?? It),
      (this.maxAge = e.maxAge ?? kt),
      (this.saveOnChange = e.saveOnChange ?? true),
      (this.debounceDelay = e.debounceDelay ?? Pt),
      (this.onSaveCallback = e.onSave),
      (this.onErrorCallback = e.onError),
      (this.onRecoveryAvailableCallback = e.onRecoveryAvailable),
      (this._isEnabled = true),
      (this.storageAvailable = L()),
      this.checkRecoveryData());
  }
  onDocumentChanged(e) {
    ((this.currentDocument = e),
      this._isEnabled && this.saveOnChange && e && this.storageAvailable && this.debounceSave());
  }
  async save() {
    if (!this.storageAvailable)
      return (this.onErrorCallback?.(new Error('localStorage is not available')), false);
    let e = this.currentDocument;
    if (!e) return false;
    this.updateStatus('saving');
    try {
      let o = P(e);
      if (o === this.lastSavedJson) return (this.updateStatus('saved'), !0);
      (this.persistToStorage(o), (this.lastSavedJson = o));
      let r = new Date();
      return ((this.lastSaveTime = r), this.updateStatus('saved'), this.onSaveCallback?.(r), !0);
    } catch (o) {
      return (
        console.error('Auto-save failed:', o),
        this.updateStatus('error'),
        this.onErrorCallback?.(o),
        false
      );
    }
  }
  clear() {
    if (this.storageAvailable)
      try {
        (localStorage.removeItem(this.storageKey),
          (this._hasRecoveryData = !1),
          (this.lastSavedJson = null),
          this.emitSnapshot());
      } catch (e) {
        console.error('Failed to clear auto-save:', e);
      }
  }
  getRecoveryData() {
    if (!this.storageAvailable) return null;
    try {
      let e = localStorage.getItem(this.storageKey);
      if (!e) return null;
      let o = _t(e);
      return o ? (At(o.savedAt, this.maxAge) ? (this.clear(), null) : o) : null;
    } catch {
      return null;
    }
  }
  acceptRecovery() {
    let e = this.getRecoveryData();
    return e ? ((this._hasRecoveryData = false), this.emitSnapshot(), e.document) : null;
  }
  dismissRecovery() {
    (this.clear(), (this._hasRecoveryData = false), this.emitSnapshot());
  }
  enable() {
    ((this._isEnabled = true), this.startInterval(), this.emitSnapshot());
  }
  disable() {
    ((this._isEnabled = false), this.stopTimers(), this.emitSnapshot());
  }
  startInterval() {
    (this.stopTimers(),
      !(!this._isEnabled || !this.storageAvailable) &&
        (this.intervalTimer = setInterval(() => {
          this.save();
        }, this.interval)));
  }
  destroy() {
    if ((this.stopTimers(), this._isEnabled && this.currentDocument && this.storageAvailable))
      try {
        this.persistToStorage(P(this.currentDocument));
      } catch (e) {
        console.error('Failed to save on destroy:', e);
      }
  }
  checkRecoveryData() {
    if (!this.storageAvailable) return;
    let e = this.getRecoveryData();
    e &&
      ((this._hasRecoveryData = true), this.emitSnapshot(), this.onRecoveryAvailableCallback?.(e));
  }
  persistToStorage(e) {
    let o = { document: JSON.parse(e), savedAt: new Date().toISOString(), version: A };
    localStorage.setItem(this.storageKey, JSON.stringify(o));
  }
  debounceSave() {
    (this.debounceTimer && clearTimeout(this.debounceTimer),
      (this.debounceTimer = setTimeout(() => {
        this.save();
      }, this.debounceDelay)));
  }
  stopTimers() {
    (this.intervalTimer && (clearInterval(this.intervalTimer), (this.intervalTimer = null)),
      this.debounceTimer && (clearTimeout(this.debounceTimer), (this.debounceTimer = null)));
  }
  updateStatus(e) {
    ((this.status = e), this.emitSnapshot());
  }
  emitSnapshot() {
    this.setSnapshot({
      status: this.status,
      lastSaveTime: this.lastSaveTime,
      hasRecoveryData: this._hasRecoveryData,
      isEnabled: this._isEnabled,
    });
  }
};
function B(t) {
  if (!t) return 'Never';
  let e = new Date().getTime() - t.getTime(),
    o = Math.floor(e / 1e3),
    r = Math.floor(o / 60),
    a = Math.floor(r / 60);
  return o < 10
    ? 'Just now'
    : o < 60
      ? `${o} seconds ago`
      : r < 60
        ? `${r} minute${r === 1 ? '' : 's'} ago`
        : a < 24
          ? `${a} hour${a === 1 ? '' : 's'} ago`
          : t.toLocaleDateString();
}
function F(t) {
  return { idle: 'Ready', saving: 'Saving...', saved: 'Saved', error: 'Save failed' }[t];
}
function z(t = _) {
  try {
    let n = localStorage.getItem(t);
    return n ? new Blob([n]).size : 0;
  } catch {
    return 0;
  }
}
function w(t) {
  return t < 1024
    ? `${t} B`
    : t < 1024 * 1024
      ? `${(t / 1024).toFixed(1)} KB`
      : `${(t / (1024 * 1024)).toFixed(1)} MB`;
}
function N() {
  return L();
}
var m = {
  TABLE_INDEX: 'data-table-index',
  ROW_INDEX: 'data-row',
  COLUMN_INDEX: 'data-col',
  TABLE_CELL: 'data-table-cell',
};
function O(t, n) {
  if (!(t instanceof Element)) return null;
  let e = t;
  for (; e && e !== n; ) {
    if (e.tagName === 'TD' || e.tagName === 'TH') {
      let o = e.getAttribute(m.ROW_INDEX),
        r = e.getAttribute(m.COLUMN_INDEX);
      if (o !== null && r !== null) {
        let a = e;
        for (; a && a !== n; ) {
          if (a.tagName === 'TABLE') {
            let s = a.getAttribute(m.TABLE_INDEX);
            if (s !== null)
              return {
                tableIndex: parseInt(s, 10),
                rowIndex: parseInt(o, 10),
                columnIndex: parseInt(r, 10),
              };
            break;
          }
          a = a.parentElement;
        }
      }
      break;
    }
    e = e.parentElement;
  }
  return null;
}
function M(t, n) {
  if (!t.package?.document?.content) return null;
  let e = 0;
  for (let o of t.package.document.content)
    if (o.type === 'table') {
      if (e === n) return o;
      e++;
    }
  return null;
}
function H(t, n, e) {
  if (!t.package?.document?.content) return t;
  let o = 0,
    r = t.package.document.content.map((a) => {
      if (a.type === 'table') {
        if (o === n) return (o++, e);
        o++;
      }
      return a;
    });
  return { ...t, package: { ...t.package, document: { ...t.package.document, content: r } } };
}
function V(t, n) {
  if (!t.package?.document?.content) return t;
  let e = 0,
    o = t.package.document.content.filter((r) => {
      if (r.type === 'table') {
        let a = e === n;
        return (e++, !a);
      }
      return true;
    });
  return { ...t, package: { ...t.package, document: { ...t.package.document, content: o } } };
}
var f = class extends u {
  constructor() {
    super({ selectedCell: null });
  }
  selectCell(n) {
    this.setSnapshot({ selectedCell: n });
  }
  clearSelection() {
    this.setSnapshot({ selectedCell: null });
  }
  isCellSelected(n, e, o) {
    let { selectedCell: r } = this.getSnapshot();
    return r ? r.tableIndex === n && r.rowIndex === e && r.columnIndex === o : false;
  }
  getSelectedCell() {
    return this.getSnapshot().selectedCell;
  }
};
function W(t) {
  if (!t || t === 'transparent' || t === 'inherit') return null;
  if (t.startsWith('#')) return t.slice(1).toUpperCase();
  let n = t.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (n) {
    let e = parseInt(n[1]).toString(16).padStart(2, '0'),
      o = parseInt(n[2]).toString(16).padStart(2, '0'),
      r = parseInt(n[3]).toString(16).padStart(2, '0');
    return (e + o + r).toUpperCase();
  }
  return null;
}
function y(t) {
  let n = window.getComputedStyle(t),
    e = {};
  ((n.fontWeight === 'bold' || parseInt(n.fontWeight) >= 700) && (e.bold = true),
    n.fontStyle === 'italic' && (e.italic = true));
  let o = n.textDecoration || n.textDecorationLine;
  (o && o.includes('underline') && (e.underline = { style: 'single' }),
    o && o.includes('line-through') && (e.strike = true));
  let r = parseFloat(n.fontSize);
  !isNaN(r) && r > 0 && (e.fontSize = Math.round((r / 1.333) * 2));
  let a = n.fontFamily.replace(/["']/g, '').split(',')[0].trim();
  a && (e.fontFamily = { ascii: a });
  let s = n.color;
  if (s && s !== 'rgb(0, 0, 0)') {
    let c = W(s);
    c && (e.color = { rgb: c });
  }
  let l = n.backgroundColor;
  if (l && l !== 'transparent' && l !== 'rgba(0, 0, 0, 0)') {
    let c = T(l);
    c && (e.shading = { fill: { rgb: c } });
  }
  return Object.keys(e).length > 0 ? e : void 0;
}
function Lt(t, n) {
  let e = document.createRange();
  e.selectNodeContents(t);
  let o =
      n.compareBoundaryPoints(Range.START_TO_START, e) >= 0 &&
      n.compareBoundaryPoints(Range.START_TO_END, e) <= 0,
    r =
      n.compareBoundaryPoints(Range.END_TO_START, e) >= 0 &&
      n.compareBoundaryPoints(Range.END_TO_END, e) <= 0;
  if (o && r) return n.toString();
  if (o) {
    let a = document.createRange();
    return (
      a.setStart(n.startContainer, n.startOffset),
      a.selectNodeContents(t),
      a.setEnd(e.endContainer, e.endOffset),
      a.toString()
    );
  } else if (r) {
    let a = document.createRange();
    return (
      a.selectNodeContents(t),
      a.setEnd(n.endContainer, n.endOffset),
      a.setStart(e.startContainer, e.startOffset),
      a.toString()
    );
  } else if (n.intersectsNode(t)) return t.textContent || '';
  return '';
}
function U(t) {
  let n = t;
  for (; n; ) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      let e = n;
      if (e.hasAttribute('data-paragraph-index')) return e;
    }
    n = n.parentNode;
  }
  return null;
}
function C() {
  let t = window.getSelection();
  if (!t || t.isCollapsed) return [];
  let n = [],
    e = t.getRangeAt(0),
    o = e.commonAncestorContainer,
    r = o.nodeType === Node.ELEMENT_NODE ? o : o.parentElement;
  if (!r) return n;
  if (
    (r.querySelectorAll('.docx-run').forEach((s) => {
      if (e.intersectsNode(s)) {
        let l = Lt(s, e);
        if (l) {
          let c = y(s);
          n.push({ type: 'run', formatting: c, content: [{ type: 'text', text: l }] });
        }
      }
    }),
    n.length === 0)
  ) {
    let s = t.toString();
    s && n.push({ type: 'run', content: [{ type: 'text', text: s }] });
  }
  return n;
}
function $() {
  let t = window.getSelection();
  if (!t || t.isCollapsed) return null;
  let n = C();
  if (n.length === 0) return null;
  let e = t.toString(),
    o = t.getRangeAt(0),
    r = U(o.startContainer),
    a = U(o.endContainer),
    s = r ? parseInt(r.getAttribute('data-paragraph-index') || '0', 10) : 0,
    l = a ? parseInt(a.getAttribute('data-paragraph-index') || '0', 10) : 0;
  return {
    text: e,
    runs: n,
    startParagraphIndex: s,
    startRunIndex: 0,
    startOffset: o.startOffset,
    endParagraphIndex: l,
    endRunIndex: 0,
    endOffset: o.endOffset,
    isMultiParagraph: s !== l,
  };
}
var T = W;
var S = class extends u {
  constructor() {
    super({ notifications: [] });
    chunk5XGN7UAV_js.a(this, 'notifications', []);
    chunk5XGN7UAV_js.a(this, 'idCounter', 0);
    chunk5XGN7UAV_js.a(this, 'timers', new Set());
  }
  showError(e, o) {
    return this.addNotification(e, 'error', o);
  }
  showWarning(e, o) {
    return this.addNotification(e, 'warning', o);
  }
  showInfo(e, o) {
    return this.addNotification(e, 'info', o);
  }
  dismiss(e) {
    ((this.notifications = this.notifications.map((r) =>
      r.id === e ? { ...r, dismissed: true } : r
    )),
      this.emitSnapshot());
    let o = setTimeout(() => {
      (this.timers.delete(o),
        (this.notifications = this.notifications.filter((r) => r.id !== e)),
        this.emitSnapshot());
    }, 300);
    this.timers.add(o);
  }
  clearAll() {
    this.notifications = [];
    for (let e of this.timers) clearTimeout(e);
    (this.timers.clear(), this.emitSnapshot());
  }
  destroy() {
    for (let e of this.timers) clearTimeout(e);
    (this.timers.clear(), (this.notifications = []));
  }
  addNotification(e, o, r) {
    let a = `error-${++this.idCounter}-${Date.now()}`,
      s = { id: a, message: e, severity: o, details: r, timestamp: Date.now() };
    if (((this.notifications = [...this.notifications, s]), this.emitSnapshot(), o !== 'error')) {
      let l = setTimeout(() => {
        (this.timers.delete(l), this.dismiss(a));
      }, 5e3);
      this.timers.add(l);
    }
    return a;
  }
  emitSnapshot() {
    this.setSnapshot({ notifications: this.notifications });
  }
};
function J(t, n) {
  let e = `plugin-styles-${t}`,
    o = document.getElementById(e);
  o && o.remove();
  let r = document.createElement('style');
  return (
    (r.id = e),
    (r.textContent = n),
    document.head.appendChild(r),
    () => {
      let a = document.getElementById(e);
      a && a.remove();
    }
  );
}
var v = class extends u {
  constructor() {
    super({ states: new Map(), version: 0 });
    chunk5XGN7UAV_js.a(this, 'plugins', []);
    chunk5XGN7UAV_js.a(this, 'pluginStates', new Map());
    chunk5XGN7UAV_js.a(this, 'version', 0);
  }
  initialize(e, o) {
    (this.destroyPlugins(), (this.plugins = e));
    for (let r of e)
      r.initialize && !this.pluginStates.has(r.id) && this.pluginStates.set(r.id, r.initialize(o));
    this.emitSnapshot();
  }
  updateStates(e) {
    let o = false;
    for (let r of this.plugins)
      if (r.onStateChange) {
        let a = r.onStateChange(e);
        a !== void 0 && (this.pluginStates.set(r.id, a), (o = true));
      }
    return (o && (this.version++, this.emitSnapshot()), o);
  }
  getPluginState(e) {
    return this.pluginStates.get(e);
  }
  setPluginState(e, o) {
    (this.pluginStates.set(e, o), this.version++, this.emitSnapshot());
  }
  destroy() {
    (this.destroyPlugins(), this.emitSnapshot());
  }
  destroyPlugins() {
    for (let e of this.plugins) e.destroy && e.destroy();
    (this.pluginStates.clear(), (this.plugins = []));
  }
  emitSnapshot() {
    this.setSnapshot({ states: new Map(this.pluginStates), version: this.version });
  }
};
var b = class extends u {
  constructor() {
    super({
      hasLayout: false,
      selectionRects: [],
      caretPosition: null,
      selectedImageInfo: null,
      isFocused: false,
      isDragging: false,
      isResizingColumn: false,
      isImageInteracting: false,
      version: 0,
    });
    chunk5XGN7UAV_js.a(this, '_hasLayout', false);
    chunk5XGN7UAV_js.a(this, '_selectionRects', []);
    chunk5XGN7UAV_js.a(this, '_caretPosition', null);
    chunk5XGN7UAV_js.a(this, '_isDragging', false);
    chunk5XGN7UAV_js.a(this, '_dragAnchor', null);
    chunk5XGN7UAV_js.a(this, '_columnResize', {
      isResizing: false,
      startX: 0,
      columnIndex: 0,
      tablePmStart: 0,
      originalWidths: { left: 0, right: 0 },
    });
    chunk5XGN7UAV_js.a(this, '_selectedImageInfo', null);
    chunk5XGN7UAV_js.a(this, '_isImageInteracting', false);
    chunk5XGN7UAV_js.a(this, '_isFocused', false);
    chunk5XGN7UAV_js.a(this, '_version', 0);
  }
  setLayoutReady(e) {
    ((this._hasLayout = e), this.emitSnapshot());
  }
  updateSelection(e, o) {
    ((this._selectionRects = e), (this._caretPosition = o), this.emitSnapshot());
  }
  startDrag(e) {
    ((this._isDragging = true), (this._dragAnchor = e), this.emitSnapshot());
  }
  endDrag() {
    ((this._isDragging = false), (this._dragAnchor = null), this.emitSnapshot());
  }
  getDragAnchor() {
    return this._dragAnchor;
  }
  startColumnResize(e, o, r, a) {
    ((this._columnResize = {
      isResizing: true,
      startX: r,
      columnIndex: o,
      tablePmStart: e,
      originalWidths: a,
    }),
      this.emitSnapshot());
  }
  endColumnResize() {
    ((this._columnResize = { ...this._columnResize, isResizing: false }), this.emitSnapshot());
  }
  getColumnResize() {
    return this._columnResize;
  }
  setSelectedImage(e) {
    ((this._selectedImageInfo = e), this.emitSnapshot());
  }
  clearSelectedImage() {
    ((this._selectedImageInfo = null), (this._isImageInteracting = false), this.emitSnapshot());
  }
  setImageInteracting(e) {
    ((this._isImageInteracting = e), this.emitSnapshot());
  }
  setFocused(e) {
    ((this._isFocused = e), this.emitSnapshot());
  }
  emitSnapshot() {
    (this._version++,
      this.setSnapshot({
        hasLayout: this._hasLayout,
        selectionRects: this._selectionRects,
        caretPosition: this._caretPosition,
        selectedImageInfo: this._selectedImageInfo,
        isFocused: this._isFocused,
        isDragging: this._isDragging,
        isResizingColumn: this._columnResize.isResizing,
        isImageInteracting: this._isImageInteracting,
        version: this._version,
      }));
  }
};
var x = class extends u {
  constructor(e = {}) {
    let o = e.initialZoom ?? 1;
    super({
      loadingState: 'idle',
      parseError: null,
      isReady: false,
      zoom: o,
      fontsLoaded: false,
      version: 0,
    });
    chunk5XGN7UAV_js.a(this, '_loadingState', 'idle');
    chunk5XGN7UAV_js.a(this, '_parseError', null);
    chunk5XGN7UAV_js.a(this, '_zoom');
    chunk5XGN7UAV_js.a(this, '_fontsLoaded', false);
    chunk5XGN7UAV_js.a(this, '_document', null);
    chunk5XGN7UAV_js.a(this, '_version', 0);
    chunk5XGN7UAV_js.a(this, 'onChangeCallback');
    chunk5XGN7UAV_js.a(this, 'onErrorCallback');
    ((this._zoom = o), (this.onChangeCallback = e.onChange), (this.onErrorCallback = e.onError));
  }
  setParsingStarted() {
    ((this._loadingState = 'parsing'), (this._parseError = null), this.emitSnapshot());
  }
  setDocumentLoaded(e) {
    ((this._document = e),
      (this._loadingState = 'loading-fonts'),
      (this._parseError = null),
      this.emitSnapshot());
  }
  setFontsLoaded() {
    ((this._fontsLoaded = true), (this._loadingState = 'ready'), this.emitSnapshot());
  }
  setLoadError(e) {
    ((this._loadingState = 'error'),
      (this._parseError = e.message),
      this.onErrorCallback?.(e),
      this.emitSnapshot());
  }
  getDocument() {
    return this._document;
  }
  updateDocument(e) {
    ((this._document = e), this.onChangeCallback?.(e), this.emitSnapshot());
  }
  setZoom(e) {
    ((this._zoom = Math.max(0.25, Math.min(4, e))), this.emitSnapshot());
  }
  getZoom() {
    return this._zoom;
  }
  emitSnapshot() {
    (this._version++,
      this.setSnapshot({
        loadingState: this._loadingState,
        parseError: this._parseError,
        isReady: this._loadingState === 'ready',
        zoom: this._zoom,
        fontsLoaded: this._fontsLoaded,
        version: this._version,
      }));
  }
};
var pn = '0.0.2';
Object.defineProperty(exports, 'DocumentAgent', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.f;
  },
});
Object.defineProperty(exports, 'attemptSelectiveSave', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.c;
  },
});
Object.defineProperty(exports, 'blendColors', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.z;
  },
});
Object.defineProperty(exports, 'buildExtendedSelectionContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.m;
  },
});
Object.defineProperty(exports, 'buildPatchedDocumentXml', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.b;
  },
});
Object.defineProperty(exports, 'buildSelectionContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.l;
  },
});
Object.defineProperty(exports, 'colorsEqual', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.E;
  },
});
Object.defineProperty(exports, 'createDocumentWithText', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.e;
  },
});
Object.defineProperty(exports, 'createEmptyDocument', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.d;
  },
});
Object.defineProperty(exports, 'createRgbColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.w;
  },
});
Object.defineProperty(exports, 'createThemeColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.v;
  },
});
Object.defineProperty(exports, 'darkenColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.x;
  },
});
Object.defineProperty(exports, 'ensureHexPrefix', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.A;
  },
});
Object.defineProperty(exports, 'generateThemeTintShadeMatrix', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.D;
  },
});
Object.defineProperty(exports, 'getAgentContext', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.i;
  },
});
Object.defineProperty(exports, 'getContrastingColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.t;
  },
});
Object.defineProperty(exports, 'getDocumentSummary', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.k;
  },
});
Object.defineProperty(exports, 'getThemeTintShadeHex', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.C;
  },
});
Object.defineProperty(exports, 'isBlack', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.r;
  },
});
Object.defineProperty(exports, 'isWhite', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.s;
  },
});
Object.defineProperty(exports, 'lightenColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.y;
  },
});
Object.defineProperty(exports, 'parseColorString', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.u;
  },
});
Object.defineProperty(exports, 'resolveColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.o;
  },
});
Object.defineProperty(exports, 'resolveHighlightColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.p;
  },
});
Object.defineProperty(exports, 'resolveHighlightToCss', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.B;
  },
});
Object.defineProperty(exports, 'resolveShadingColor', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.q;
  },
});
Object.defineProperty(exports, 'validatePatchSafety', {
  enumerable: true,
  get: function () {
    return chunkXJCWBPY7_js.a;
  },
});
Object.defineProperty(exports, 'detectVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.a;
  },
});
Object.defineProperty(exports, 'detectVariablesDetailed', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.b;
  },
});
Object.defineProperty(exports, 'detectVariablesInBody', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.c;
  },
});
Object.defineProperty(exports, 'detectVariablesInParagraph', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.d;
  },
});
Object.defineProperty(exports, 'documentHasVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.m;
  },
});
Object.defineProperty(exports, 'docxtemplaterPlugin', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.o;
  },
});
Object.defineProperty(exports, 'extractVariablesFromText', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.e;
  },
});
Object.defineProperty(exports, 'formatVariable', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.i;
  },
});
Object.defineProperty(exports, 'hasTemplateVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.f;
  },
});
Object.defineProperty(exports, 'isValidVariableName', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.g;
  },
});
Object.defineProperty(exports, 'parseVariable', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.j;
  },
});
Object.defineProperty(exports, 'removeVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.l;
  },
});
Object.defineProperty(exports, 'replaceVariables', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.k;
  },
});
Object.defineProperty(exports, 'sanitizeVariableName', {
  enumerable: true,
  get: function () {
    return chunkNGK4AG2P_js.h;
  },
});
Object.defineProperty(exports, 'createDocx', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.l;
  },
});
Object.defineProperty(exports, 'repackDocx', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.f;
  },
});
Object.defineProperty(exports, 'serializeDocumentBody', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.b;
  },
});
Object.defineProperty(exports, 'serializeDocx', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.c;
  },
});
Object.defineProperty(exports, 'serializeSectionProperties', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.a;
  },
});
Object.defineProperty(exports, 'updateMultipleFiles', {
  enumerable: true,
  get: function () {
    return chunk6L7HNODA_js.h;
  },
});
Object.defineProperty(exports, 'canRenderFont', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.q;
  },
});
Object.defineProperty(exports, 'emuToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.d;
  },
});
Object.defineProperty(exports, 'emuToTwips', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.f;
  },
});
Object.defineProperty(exports, 'formatPx', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.j;
  },
});
Object.defineProperty(exports, 'getLoadedFonts', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.o;
  },
});
Object.defineProperty(exports, 'halfPointsToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.i;
  },
});
Object.defineProperty(exports, 'isFontLoaded', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.m;
  },
});
Object.defineProperty(exports, 'isFontsLoading', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.n;
  },
});
Object.defineProperty(exports, 'loadFont', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.k;
  },
});
Object.defineProperty(exports, 'loadFontFromBuffer', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.r;
  },
});
Object.defineProperty(exports, 'loadFonts', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.l;
  },
});
Object.defineProperty(exports, 'onFontsLoaded', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.p;
  },
});
Object.defineProperty(exports, 'parseDocx', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.u;
  },
});
Object.defineProperty(exports, 'pixelsToEmu', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.e;
  },
});
Object.defineProperty(exports, 'pixelsToTwips', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.c;
  },
});
Object.defineProperty(exports, 'pointsToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.h;
  },
});
Object.defineProperty(exports, 'preloadCommonFonts', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.s;
  },
});
Object.defineProperty(exports, 'toArrayBuffer', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.t;
  },
});
Object.defineProperty(exports, 'twipsToEmu', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.g;
  },
});
Object.defineProperty(exports, 'twipsToPixels', {
  enumerable: true,
  get: function () {
    return chunk65V65RRX_js.b;
  },
});
Object.defineProperty(exports, 'getTemplateTags', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.e;
  },
});
Object.defineProperty(exports, 'processTemplate', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.a;
  },
});
Object.defineProperty(exports, 'processTemplateAsBlob', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.c;
  },
});
Object.defineProperty(exports, 'processTemplateDetailed', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.b;
  },
});
Object.defineProperty(exports, 'validateTemplate', {
  enumerable: true,
  get: function () {
    return chunkWGRUTBZG_js.f;
  },
});
Object.defineProperty(exports, 'executeCommand', {
  enumerable: true,
  get: function () {
    return chunk4FIPZCBR_js.a;
  },
});
Object.defineProperty(exports, 'executeCommands', {
  enumerable: true,
  get: function () {
    return chunk4FIPZCBR_js.b;
  },
});
Object.defineProperty(exports, 'PluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.a;
  },
});
Object.defineProperty(exports, 'pluginRegistry', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.b;
  },
});
Object.defineProperty(exports, 'registerPlugins', {
  enumerable: true,
  get: function () {
    return chunkAZGNVGHV_js.c;
  },
});
exports.AutoSaveManager = h;
exports.EditorCoordinator = x;
exports.ErrorManager = S;
exports.LayoutCoordinator = b;
exports.PluginLifecycleManager = v;
exports.Subscribable = u;
exports.TABLE_DATA_ATTRIBUTES = m;
exports.TableSelectionManager = f;
exports.VERSION = pn;
exports.countPageBreaks = Dt;
exports.createColumnBreak = ft;
exports.createHorizontalRule = k;
exports.createLineBreak = St;
exports.createPageBreak = E;
exports.createPageBreakParagraph = R;
exports.createPageBreakRun = vt;
exports.createSelectionFromDOM = $;
exports.deleteTableFromDocument = V;
exports.extractFormattingFromElement = y;
exports.findPageBreaks = Et;
exports.findTableFromClick = O;
exports.formatLastSaveTime = B;
exports.formatStorageSize = w;
exports.getAutoSaveStatusLabel = F;
exports.getAutoSaveStorageSize = z;
exports.getSelectionRuns = C;
exports.getTableFromDocument = M;
exports.hasPageBreakBefore = g;
exports.injectStyles = J;
exports.insertHorizontalRule = xt;
exports.insertPageBreak = bt;
exports.isAutoSaveSupported = N;
exports.isBreakContent = Tt;
exports.isColumnBreak = yt;
exports.isLineBreak = Ct;
exports.isPageBreak = d;
exports.removePageBreak = Rt;
exports.rgbToHex = T;
exports.updateTableInDocument = H; //# sourceMappingURL=core.js.map
//# sourceMappingURL=core.js.map
