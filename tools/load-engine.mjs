// Загружает радиодвижок прямо из mesh-planner.html в Node (vm-песочница с DOM-заглушками),
// чтобы гонять link()/ground()/graph() числом, без браузера.
import fs from 'node:fs';
import vm from 'node:vm';

function ctx2dStub() {
  return new Proxy({}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (!(p in t)) t[p] = typeof p === 'string' ? (() => ({ width: 0 })) : undefined;
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function elemStub() {
  const el = {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    clientWidth: 800, clientHeight: 600, width: 0, height: 0,
    accept: '', files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => ctx2dStub(),
    addEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    querySelectorAll: () => [], appendChild() {}, click() {},
  };
  return el;
}

export function loadEngine(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> in ' + htmlPath);
  let src = m[1];

  const elements = new Map();
  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, elemStub());
      return elements.get(id);
    },
    createElement: () => elemStub(),
    activeElement: { tagName: 'BODY' },
  };
  const sandbox = {
    document: documentStub,
    window: { devicePixelRatio: 1 },
    addEventListener() {}, removeEventListener() {},
    alert() {}, confirm: () => true,
    URL: { createObjectURL: () => '' },
    Blob: class {}, FileReader: class { readAsText() {} readAsArrayBuffer() {} },
    console, Math, JSON, Object, Array, Number, String, Set, Map, Symbol,
    performance: { now: () => 0 },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.__maxhop = 1;

  // Экспорт внутренностей: движок может меняться, берём всё, что объявлено.
  src += `
;globalThis.__engine = (() => {
  const out = {};
  const grab = (name, fn) => { try { out[name] = fn(); } catch (e) {} };
  for (const name of ['link','ground','bground','inForest','noiseAt','noiseRise','J','airtime',
                      'graph','coverage','lam','NTH','w2lat','w2lng','sensAt','noiseRiseOf',
                      'effHeights','profileOf','diffractionLoss','deygout','maxV','vegLoss',
                      'vegStretches','forestExcess','escapeLen','clutterLoss','pathLoss','fsplOf'])
    grab(name, () => eval(name));
  grab('R', () => R); grab('DATA', () => DATA);
  out.getNodes = () => nodes; out.setNodes = v => { nodes = v; };
  try { out.getCov = () => covCache; } catch (e) {}
  out.getNoises = () => noises; out.setNoises = v => { noises = v; };
  out.getGroves = () => groves; out.setGroves = v => { groves = v; };
  return out;
})();`;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: htmlPath });
  return sandbox.__engine;
}
