'use strict';
var chunk5XGN7UAV_js = require('./chunk-5XGN7UAV.js');
var a = class {
    constructor() {
      chunk5XGN7UAV_js.a(this, 'plugins', new Map());
      chunk5XGN7UAV_js.a(this, 'commandHandlers', new Map());
      chunk5XGN7UAV_js.a(this, 'eventListeners', new Set());
      chunk5XGN7UAV_js.a(this, 'initialized', new Set());
    }
    register(e, r) {
      let t = [];
      if (!e.id) return { success: false, error: 'Plugin must have an id' };
      if (this.plugins.has(e.id))
        return { success: false, error: `Plugin '${e.id}' is already registered` };
      if (e.dependencies) {
        for (let i of e.dependencies)
          if (!this.plugins.has(i))
            return {
              success: false,
              error: `Plugin '${e.id}' requires '${i}' which is not registered`,
            };
      }
      if (e.commandHandlers)
        for (let [i, o] of Object.entries(e.commandHandlers)) {
          if (this.commandHandlers.has(i)) {
            let d = this.commandHandlers.get(i);
            t.push(`Command '${i}' from '${e.id}' overrides handler from '${d.pluginId}'`);
          }
          this.commandHandlers.set(i, { pluginId: e.id, handler: o });
        }
      if ((this.plugins.set(e.id, e), e.initialize && !this.initialized.has(e.id)))
        try {
          let i = e.initialize();
          i instanceof Promise
            ? i
                .then(() => {
                  this.initialized.add(e.id);
                })
                .catch((o) => {
                  this.emit({ type: 'error', pluginId: e.id, error: o });
                })
            : this.initialized.add(e.id);
        } catch (i) {
          this.emit({ type: 'error', pluginId: e.id, error: i });
        }
      return (
        r?.debug && console.log(`[PluginRegistry] Registered plugin: ${e.id}`),
        this.emit({ type: 'registered', plugin: e }),
        { success: true, plugin: e, warnings: t.length > 0 ? t : void 0 }
      );
    }
    unregister(e) {
      let r = this.plugins.get(e);
      if (!r) return false;
      for (let [t, i] of this.plugins)
        if (i.dependencies?.includes(e))
          return (console.warn(`Cannot unregister '${e}': '${t}' depends on it`), false);
      for (let [t, { pluginId: i }] of this.commandHandlers)
        i === e && this.commandHandlers.delete(t);
      if (r.destroy)
        try {
          let t = r.destroy();
          t instanceof Promise &&
            t.catch((i) => {
              this.emit({ type: 'error', pluginId: e, error: i });
            });
        } catch (t) {
          this.emit({ type: 'error', pluginId: e, error: t });
        }
      return (
        this.plugins.delete(e),
        this.initialized.delete(e),
        this.emit({ type: 'unregistered', pluginId: e }),
        true
      );
    }
    get(e) {
      return this.plugins.get(e);
    }
    getAll() {
      return Array.from(this.plugins.values());
    }
    has(e) {
      return this.plugins.has(e);
    }
    get size() {
      return this.plugins.size;
    }
    getCommandHandler(e) {
      return this.commandHandlers.get(e)?.handler;
    }
    getCommandTypes() {
      return Array.from(this.commandHandlers.keys());
    }
    hasCommandHandler(e) {
      return this.commandHandlers.has(e);
    }
    getMcpTools() {
      let e = [];
      for (let r of this.plugins.values()) r.mcpTools && e.push(...r.mcpTools);
      return e;
    }
    getMcpToolsForPlugin(e) {
      return this.plugins.get(e)?.mcpTools || [];
    }
    getMcpTool(e) {
      for (let r of this.plugins.values())
        if (r.mcpTools) {
          let t = r.mcpTools.find((i) => i.name === e);
          if (t) return t;
        }
    }
    addEventListener(e) {
      this.eventListeners.add(e);
    }
    removeEventListener(e) {
      this.eventListeners.delete(e);
    }
    emit(e) {
      for (let r of this.eventListeners)
        try {
          r(e);
        } catch (t) {
          console.error('[PluginRegistry] Event listener error:', t);
        }
    }
    clear() {
      for (let e of this.plugins.values())
        if (e.destroy)
          try {
            e.destroy();
          } catch {}
      (this.plugins.clear(), this.commandHandlers.clear(), this.initialized.clear());
    }
    getDebugInfo() {
      return {
        plugins: Array.from(this.plugins.keys()),
        commandTypes: Array.from(this.commandHandlers.keys()),
        mcpTools: this.getMcpTools().map((e) => e.name),
        initialized: Array.from(this.initialized),
      };
    }
  },
  l = new a();
function c(s, e) {
  return s.map((r) => l.register(r, e));
}
function g(s) {
  return (e) => l.register(e, s);
}
exports.a = a;
exports.b = l;
exports.c = c;
exports.d = g; //# sourceMappingURL=chunk-AZGNVGHV.js.map
//# sourceMappingURL=chunk-AZGNVGHV.js.map
