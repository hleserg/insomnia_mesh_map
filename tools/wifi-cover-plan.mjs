// Сколько wifi-точек (UniFi XG) и где нужно, чтобы покрыть объекты фестиваля.
// Жадный set-cover: кандидаты — сетка 40 м + сами объекты; каждая новая точка обязана
// иметь LoRa-путь к room server (мокрая листва, панель в лучшую сторону) с запасом ≥8 dB
// и соблюдать разнос от генераторов. Запуск: node tools/wifi-cover-plan.mjs [--json]
import fs from 'node:fs';
import { loadEngine } from './load-engine.mjs';

const E = loadEngine(new URL('../mesh-planner.html', import.meta.url).pathname);
const { link, inForest, R, DATA } = E;
R.forest = 0.45; R.fAm = 30;                       // мокрая листва — худший случай

const nodes = E.getNodes();
const N = s => nodes.find(x => x.name.startsWith(s));
const RS = N('АДМИНИСТРАЦИЯ'), REP = N('ГРЯДА');
const hOf = (x, y) => inForest(x, y) ? 6 : 4;
const aim = (n, t) => ({ ...n, ant: 1, az: Math.round((Math.atan2(t.x - n.x, t.y - n.y) * 180 / Math.PI + 360) % 360) });

// --- wifi-бюджет (та же модель, что в планировщике) ---
const WFf = 2442, phoneH = 1.5, LIM = 110 - 10;    // бюджет минус запас на толпу
const fspl = d => 32.44 + 20 * Math.log10(WFf) + 20 * Math.log10(Math.max(d, 1) / 1000);
const weiss = fl => fl <= 0 ? 0 : fl < 14 ? 0.45 * Math.pow(WFf / 1000, .284) * fl
  : 1.33 * Math.pow(WFf / 1000, .284) * Math.pow(Math.min(fl, 400), .588);
function wifiMargin(ax, ay, ah, x, y) {
  const d = Math.hypot(ax - x, ay - y);
  if (d > 700) return -99;
  const dbp = Math.max(10, 4 * ah * phoneH / (300 / WFf));
  let pl = d <= dbp ? fspl(d) : fspl(dbp) + 10 * R.n * Math.log10(d / dbp);
  const K = Math.max(4, Math.min(24, Math.round(d / 25)));
  let fl = 0;
  for (let s = 0; s < K; s++) { const t = (s + 0.5) / K; if (inForest(ax + (x - ax) * t, ay + (y - ay) * t)) fl += d / K; }
  return LIM - (pl + weiss(fl) + 4);
}

// --- цели: объекты фестиваля ---
const cats = new Set(['stage', 'venue', 'food', 'screen', 'paid', 'shower']);
const targets = DATA.poi.filter(p => cats.has(p[2])).map(p => ({ x: p[0], y: p[1], name: p[3] }));

// --- уже стоящие точки ---
const placed = [
  ...nodes.filter(n => n.role !== 2).map(n => ({ x: n.x, y: n.y, h: Math.max(2, n.h || 4), nm: n.name })),
  ...DATA.fastwifi.map(f => ({ x: f.x, y: f.y, h: 6, nm: 'орг:' + f.name })),
];
const covered = t => placed.some(a => wifiMargin(a.x, a.y, a.h, t.x, t.y) >= 5);

// --- LoRa-пригодность кандидата ---
const noiseMin = [75, 55, 55, 35, 35];
const farFromNoise = (x, y) => E.getNoises().every(s => Math.hypot(s.x - x, s.y - y) >= (noiseMin[s.t] || 35));
function loraOk(x, y) {
  const c = { name: 'C', x, y, role: 0, h: hOf(x, y), tx: 14, g: 8 };
  const direct = link(aim(c, RS), RS).margin;
  const via = Math.min(link(aim(c, REP), REP).margin, link(REP, RS).margin);
  return Math.max(direct, via) >= 8 ? (direct >= via ? 'прямо в RS' : 'через ГРЯДУ') : null;
}

// --- кандидаты ---
const B = DATA.bbox, cand = [];
for (let x = B[0]; x <= B[2]; x += 40) for (let y = B[1]; y <= B[3]; y += 40)
  if (farFromNoise(x, y)) cand.push({ x, y });
targets.forEach(t => { if (farFromNoise(t.x, t.y)) cand.push({ x: t.x + 20, y: t.y + 20 }); });

// --- жадный набор ---
let un = targets.filter(t => !covered(t));
console.log(`объектов всего ${targets.length}, уже покрыто ${targets.length - un.length}, не покрыто ${un.length}:`);
un.forEach(t => console.log('   ', t.name));
const picks = [];
while (un.length) {
  let best = null;
  for (const c of cand) {
    const h = hOf(c.x, c.y);
    const hits = un.filter(t => wifiMargin(c.x, c.y, h, t.x, t.y) >= 5);
    if (!hits.length) continue;
    if (!best || hits.length > best.hits.length) {
      const via = loraOk(c.x, c.y);
      if (via) best = { c, h, hits, via };
    }
  }
  if (!best) { console.log('!! остались недостижимые:', un.map(t => t.name).join(', ')); break; }
  picks.push(best);
  un = un.filter(t => !best.hits.includes(t));
  placed.push({ x: best.c.x, y: best.c.y, h: best.h, nm: 'НОВАЯ-' + picks.length });
  console.log(`+ точка ${picks.length}: (${best.c.x.toFixed(0)},${best.c.y.toFixed(0)}) ` +
    `${E.w2lat(best.c.y).toFixed(6)},${E.w2lng(best.c.x).toFixed(6)} h=${best.h} ` +
    `${inForest(best.c.x, best.c.y) ? 'лес' : 'открыто'} · LoRa: ${best.via} · закрывает: ${best.hits.map(t => t.name).join('; ')}`);
}
console.log(`\nитого дополнительных точек: ${picks.length}`);

if (process.argv.includes('--json')) {
  const plan = {
    nodes: [...nodes, ...picks.map((p, i) => ({
      name: 'WIFI-' + (i + 1), x: +p.c.x.toFixed(1), y: +p.c.y.toFixed(1), role: 0,
      h: p.h, tx: 14, g: 8, wifi: 1, ant: 1,
      az: Math.round((Math.atan2((p.via === 'через ГРЯДУ' ? REP.x : RS.x) - p.c.x,
                                 (p.via === 'через ГРЯДУ' ? REP.y : RS.y) - p.c.y) * 180 / Math.PI + 360) % 360),
    }))],
    noises: E.getNoises(), groves: [], R: { ...R, forest: 0.30, fAm: 25 }, v: 3,
  };
  fs.writeFileSync(new URL('../docs/deploy/mesh-plan-full-wifi.json', import.meta.url), JSON.stringify(plan, null, 1));
  console.log('план сохранён: docs/deploy/mesh-plan-full-wifi.json (импортируется кнопкой «импорт»)');
}
