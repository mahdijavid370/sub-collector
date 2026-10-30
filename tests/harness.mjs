// هارنس تست بدون وابستگی خارجی: اسکریپت داخلی index.html را با یک DOM حداقلی اجرا می‌کند
// تا منطق واقعی پارسر و تولیدکننده‌ها (Xray / Sing-Box / Clash) روی داده‌های واقعی تست شود.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readHtml(htmlPath = path.join(repoRoot, 'index.html')) {
  return readFileSync(htmlPath, 'utf8');
}

export function extractInlineScript(html = readHtml()) {
  const matches = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!matches.length) throw new Error('هیچ اسکریپت داخلی در index.html پیدا نشد');
  return matches.map(m => m[1]).join('\n;\n');
}

const ATTR = (tag, name) => {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
};

/** مقدار/وضعیت اولیه هر عنصر دارای id را از markup واقعی HTML استخراج می‌کند */
export function seedFromHtml(html = readHtml()) {
  const seeds = new Map();
  const tagRe = /<([a-zA-Z][\w-]*)([^>]*\bid="[^"]+"[^>]*)>/g;
  for (const m of html.matchAll(tagRe)) {
    const [, tag, attrs] = m;
    const id = ATTR(attrs, 'id');
    if (!id) continue;
    const seed = { tag, checked: /\bchecked\b/.test(attrs), textContent: '' };
    const val = ATTR(attrs, 'value');
    if (tag === 'select') {
      const close = html.indexOf('</select>', m.index);
      const body = html.slice(m.index, close === -1 ? undefined : close);
      const opts = [...body.matchAll(/<option([^>]*)>([^<]*)/g)]
        .map((o) => ({ tag: o[1], value: (o[1].match(/value="([^"]*)"/) || [, ''])[1], textContent: o[2] }));
      const selected = opts.find((o) => /\bselected\b/.test(o.tag));
      seed.value = selected ? selected.value : (opts.length ? opts[0].value : '');
      seed.options = opts.map((o) => ({ value: o.value, textContent: o.textContent }));
    } else {
      seed.value = val ?? '';
    }
    const text = html.slice(m.index + m[0].length, m.index + m[0].length + 200).match(/^([^<]*)/);
    if (text && text[1].trim()) seed.textContent = text[1].trim();
    seeds.set(id, seed);
  }
  return seeds;
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(String(el._class || '').split(/\s+/).filter(Boolean)); }
  add(...c) { c.forEach(x => this.set.add(x)); this.sync(); }
  remove(...c) { c.forEach(x => this.set.delete(x)); this.sync(); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    this.sync();
    return on;
  }
  contains(c) { return this.set.has(c); }
  sync() { this.el._class = [...this.set].join(' '); }
}

function makeStyle() {
  return new Proxy({}, {
    get(t, k) { return k === 'setProperty' || k === 'removeProperty' ? () => {} : (t[k] ?? ''); },
    set(t, k, v) { t[k] = v; return true; }
  });
}

export function makeElement(tag = 'div', props = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    _class: props.className || '',
    _attrs: { ...(props.attrs || {}) },
    value: props.value ?? '',
    _text: props.textContent ?? '',
    innerHTML: props.innerHTML ?? '',
    checked: !!props.checked,
    disabled: false,
    dataset: props.dataset ? { ...props.dataset } : {},
    children: [],
    options: (props.options || []).map(o => ({ value: o.value, textContent: o.textContent ?? o.value })),
    style: makeStyle(),
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = this.listeners.get(type) || [];
      this.listeners.set(type, l.filter(f => f !== fn));
    },
    dispatch(type, ev = {}) {
      (this.listeners.get(type) || []).forEach(fn => fn.call(this, { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...ev }));
    },
    appendChild(c) {
      if (c && c.tagName === 'FRAGMENT') { this.children.push(...c.children); c.children = []; }
      else this.children.push(c);
      return c;
    },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    remove() { this._removed = true; },
    click() { this.dispatch('click'); },
    focus() { this._focused = true; },
    select() {},
    scrollIntoView() { this._scrolled = true; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext: () => makeCtx()
  };
  /* مثل DOM واقعی: نوشتن textContent فرزندان را پاک می‌کند */
  Object.defineProperty(el, 'textContent', {
    get() { return this.children.length ? this.children.map((c) => c._text ?? '').join('') : this._text; },
    set(v) { this._text = String(v); if (v === '') this.children = []; }
  });
  el.classList = new ClassList(el);
  /* مثل DOM واقعی: className و classList همگام می‌مانند */
  Object.defineProperty(el, 'className', {
    get() { return this._class; },
    set(v) { this._class = String(v); this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  return el;
}

function makeCtx() {
  const noop = () => {};
  return {
    clearRect: noop, beginPath: noop, arc: noop, fill: noop, fillRect: noop,
    setTransform: noop, save: noop, restore: noop, translate: noop, scale: noop,
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; }
  };
}

/**
 * ساخت یک سند قلابی.
 * @param {Record<string, object>} extra عناصری که با id ثبت می‌شوند
 */
export function createSandbox({ extra = {}, clipboard = {}, width = 1280, htmlPath } = {}) {
  const seeds = seedFromHtml(readHtml(htmlPath));
  const registry = new Map(Object.entries(extra).map(([id, props]) => [id, makeElement(props.tag || 'div', { id, ...props })]));
  const calls = { toasts: [], copies: [], scrolls: 0, timers: [] };

  const elementFor = (id) => {
    if (!registry.has(id)) {
      const seed = seeds.get(id) || {};
      registry.set(id, makeElement(seed.tag || 'div', { id, ...seed }));
    }
    return registry.get(id);
  };

  const documentStub = {
    body: makeElement('body', { className: 'theme-glass' }),
    documentElement: makeElement('html'),
    head: makeElement('head'),
    createElement: (tag) => makeElement(tag),
    createDocumentFragment: () => makeElement('fragment'),
    createTextNode: (t) => ({ textContent: t }),
    getElementById: (id) => elementFor(id),
    querySelector: (sel) => elementFor(sel.replace(/^#/, '').split(/[\s[]/)[0]),
    querySelectorAll: (sel) => (sel.startsWith('[data-tpl]') ? [...registry.values()].filter(e => e.dataset.tpl) : [elementFor(sel)]),
    addEventListener: () => {},
    execCommand: () => true
  };

  const storage = new Map();
  const localStorageStub = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };

  let rafQueue = [];
  const sandbox = {
    document: documentStub,
    localStorage: localStorageStub,
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: {
      userAgent: 'node',
      clipboard: {
        writeText: async (t) => { if (clipboard.writeShouldFail) throw new Error('denied'); calls.copies.push(t); },
        readText: async () => { if (clipboard.readText === undefined) throw new Error('denied'); calls.copies.push(clipboard.readText); return clipboard.readText; }
      }
    },
    innerWidth: width,
    innerHeight: 900,
    devicePixelRatio: 1,
    isSecureContext: true,
    location: { protocol: 'https:', host: 'example.test', href: 'https://example.test/', origin: 'https://example.test' },
    performance: globalThis.performance || { now: () => Date.now() },
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, addListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '#22d3ee' }),
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => { const id = calls.timers.length + 1; calls.timers.push({ id, fn, ms }); return id; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { const id = 10000 + calls.timers.length; calls.timers.push({ id, fn, ms, interval: true }); return id; },
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: async () => { throw new Error('no network in tests'); },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    Intl: globalThis.Intl,
    console,
    QRCode: class { constructor(el, opts) { calls.qr = (calls.qr || 0) + 1; this.opts = opts; el.children.push({ tag: 'canvas' }); } },
    encodeURIComponent: globalThis.encodeURIComponent,
    decodeURIComponent: globalThis.decodeURIComponent,
    __calls: calls,
    __rafQueue: rafQueue,
    __registry: registry,
    __storage: storage
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  return { context, sandbox, calls, registry, storage, flushRaf: () => { const q = rafQueue; rafQueue = []; q.forEach(fn => fn()); } };
}

// پل دسترسی به bindingهای let/const سطح بالای اسکریپت (که روی globalObject قرار نمی‌گیرند)
const BRIDGE = `
globalThis.__get = function (name) { try { return eval(name); } catch (e) { return undefined; } };
globalThis.__set = function (name, v) { try { eval(name + ' = v'); return true; } catch (e) { return false; } };
`;

/** اسکریپت index.html را داخل سند قلابی اجرا می‌کند و APIهایش را برمی‌گرداند */
export function loadApp(opts) {
  const { context, sandbox, calls, registry, storage, flushRaf } = createSandbox(opts);
  const code = extractInlineScript(readHtml(opts && opts.htmlPath));
  vm.runInContext(code + '\n' + BRIDGE, context, { filename: 'index.html:inline' });
  const get = (name) => sandbox.__get(name);
  return { sandbox, calls, registry, storage, flushRaf, get, set: sandbox.__set };
}
