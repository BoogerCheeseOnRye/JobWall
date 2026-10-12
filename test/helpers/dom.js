// A DOM small enough to read, big enough to run app.js. This is how the render
// path gets tested without a browser: if app.js ever reads a field that does not
// exist or throws on real data, this fails instead of a blank page.
export function makeDom() {
  const els = new Map();
  const make = (key) => ({
    key,
    _html: '',
    _text: '',
    innerHTML: '',
    textContent: '',
    className: '',
    value: '',
    files: [],
    hidden: false,
    checked: false,
    disabled: false,
    dataset: {},
    handlers: new Map(),
    style: {},
    addEventListener(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, []);
      this.handlers.get(type).push(fn);
    },
    scrollIntoView() {},
    // Delegated handlers read the real DOM API, so the stub has to answer it.
    // Every stub element is its own ancestor: enough for the closest() calls the
    // page makes, and it fails loudly if a selector-based one is added later.
    closest(sel) {
      return sel.startsWith('.') && this.key.includes(sel.slice(1)) ? this : null;
    },
    querySelector(sel) {
      return sel.startsWith('b') || sel.startsWith('.') ? { textContent: '', ...this } : null;
    },
    remove() {},
    click() {},
    children: [],
    classList: {
      _set: new Set(),
      add(...names) { for (const n of names) this._set.add(n); },
      remove(...names) { for (const n of names) this._set.delete(n); },
      contains(name) { return this._set.has(name); },
      toggle(name, force) {
        const on = force ?? !this._set.has(name);
        if (on) this._set.add(name);
        else this._set.delete(name);
        return on;
      },
    },
    setAttribute(name, v) { this[name] = v; },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
    },
    requestSubmit() {
      for (const fn of this.handlers.get('submit') || []) fn({ preventDefault() {} });
    },
    fire(type, ev = {}) {
      for (const fn of this.handlers.get(type) || []) fn(ev);
    },
  });
  const get = (sel) => {
    if (!els.has(sel)) {
      const el = make(sel);
      Object.defineProperty(el, 'innerHTML', {
        get() { return this._html; },
        set(v) { this._html = String(v); },
      });
      Object.defineProperty(el, 'textContent', {
        get() { return this._text; },
        set(v) { this._text = String(v); },
      });
      els.set(sel, el);
    }
    return els.get(sel);
  };
  return {
    els,
    get,
    document: {
      querySelector: get,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: (tag) => make(tag),
      body: make('body'),
    },
  };
}


// A stand-in for Response: the shim reads .text() and parses it itself, so
// that a host answering with an HTML error page can never reach res.json() and
// surface as "Unexpected token '<'".
export function stubResponse(body, { ok = true, status = 200 } = {}) {
  const text = async () => (typeof body === 'string' ? body : JSON.stringify(body));
  return { ok, status, statusText: '', text, json: async () => JSON.parse(await text()) };
}
