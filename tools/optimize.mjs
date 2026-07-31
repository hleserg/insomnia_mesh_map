// Оптимизация конфигурации сети при реалистичных подвесах:
// лес ≤6 м, строения ≤4–5 м, чистое поле 3–4 м (и лучше не ставить).
// Критерий — худший запас худшего необходимого пути companion→room server
// при МОКРОЙ листве (γ=0.45, Am=30) и включённых источниках шума.
// Запуск: node tools/optimize.mjs [--two]
import { loadEngine } from './load-engine.mjs';

const E = loadEngine(new URL('../mesh-planner.html', import.meta.url).pathname);
const { link, inForest, ground, R, DATA } = E;

// мокрая листва — расчётный худший случай
R.forest = 0.45; R.fAm = 30;

const nodes0 = E.getNodes();
const N = n => nodes0.find(x => x.name.startsWith(n));
const RS = N('АДМИНИСТРАЦИЯ');
const comps = ['СЕВЕРНЫЙ ГОРОД', 'КИНОБАР', 'ФУДКОРТ', 'WONDER WAY'].map(N);
const SCN = N('СЦЕНА СЕВЕР');

const hOf = (x, y) => inForest(x, y) ? 6 : 4;      // реалистичный подвес
const mk = (base, over) => ({ ...base, ...over });

// панель ~70° на цель
const aim = (n, tgt) => {
  const az = Math.round((Math.atan2(tgt.x - n.x, tgt.y - n.y) * 180 / Math.PI + 360) % 360);
  return { ...n, ant: 1, az };
};

// запас пути companion→RS: напрямую или через репитер(ы); панель целится в лучшую сторону
function pathMargin(c, reps, rs) {
  let best = -999, via = 'прямая';
  const direct = link(aim(c, rs), rs).margin;
  if (direct > best) { best = direct; via = 'прямо в RS'; }
  for (const rep of reps) {
    const m = Math.min(link(aim(c, rep), rep).margin, link(rep, rs).margin);
    if (m > best) { best = m; via = 'через ' + (rep.name || 'R'); }
  }
  return { m: best, via };
}

// кандидат репитера в точке (x,y): всенаправленная 6 dBi, подвес по грунту
const repAt = (x, y, name) => ({ name: name || 'REP', x, y, role: 2, h: hOf(x, y), tx: 14, g: 6, ant: 0, az: 0 });

// зоны отчуждения от источников шума: дизель+звук 75 м, LED 55 м, бензо/прочее 35 м
const noiseMin = [75, 55, 55, 35, 35];
function farFromNoise(x, y) {
  return E.getNoises().every(s => {
    const d = Math.hypot(s.x - x, s.y - y);
    return d >= (noiseMin[s.t] || 35);
  });
}

const B = DATA.bbox;

function evalConfig(reps, withSCN) {
  const rs = mk(aim(RS, reps[0] || RS), { h: hOf(RS.x, RS.y) });
  const list = withSCN ? [...comps, SCN] : comps;
  let worst = 1e9; const det = [];
  // репитеры должны видеть RS
  for (const rep of reps) {
    const m = link(rep, rs).margin;
    det.push({ leg: (rep.name || 'REP') + '↔RS', m: +m.toFixed(1) });
    // сам по себе не required, если никто через него не ходит — учитывается в pathMargin
  }
  for (const c0 of list) {
    const c = mk(c0, { h: hOf(c0.x, c0.y) });
    const { m, via } = pathMargin(c, reps.map(r => mk(r, {})), rs);
    det.push({ leg: c0.name, m: +m.toFixed(1), via });
    if (m < worst) worst = m;
  }
  return { worst, det };
}

// ---- 1. Текущая топология (репитер на ГРЯДЕ) при реальных высотах ----
const GRD = N('ГРЯДА');
console.log('== Мокрая листва, реалистичные подвесы (лес 6 м / открыто 4 м) ==\n');
for (const withSCN of [true, false]) {
  const { worst, det } = evalConfig([mk(GRD, { h: hOf(GRD.x, GRD.y), ant: 0 })], withSCN);
  console.log(`-- Репитер на ГРЯДЕ, СЦЕНА СЕВЕР ${withSCN ? 'в сети' : 'исключена'}: худший ${worst.toFixed(1)} dB`);
  det.forEach(d => console.log('   ', d.leg.padEnd(18), String(d.m).padStart(6), d.via || ''));
}

// ---- 2. Поиск лучшего положения одного репитера ----
console.log('\n== Поиск позиции репитера (сетка 25 м, зоны шума соблюдены) ==');
let best = null, top = [];
for (let x = B[0]; x <= B[2]; x += 25) for (let y = B[1]; y <= B[3]; y += 25) {
  if (!farFromNoise(x, y)) continue;
  const rep = repAt(x, y, 'R1');
  const { worst } = evalConfig([rep], false);
  if (!best || worst > best.worst) best = { x, y, worst };
  top.push({ x, y, worst });
}
top.sort((a, b) => b.worst - a.worst);
console.log('лучшая точка:', JSON.stringify(best), inForest(best.x, best.y) ? 'лес(h=6)' : 'открыто(h=4)');
console.log('топ-8:', top.slice(0, 8).map(t => `(${t.x},${t.y})=${t.worst.toFixed(1)}`).join(' '));
{
  const { worst, det } = evalConfig([repAt(best.x, best.y, 'R1')], false);
  det.forEach(d => console.log('   ', d.leg.padEnd(18), String(d.m).padStart(6), d.via || ''));
  console.log('   худший:', worst.toFixed(1), 'dB');
}

// ---- 3. Два репитера (жадно: лучший второй к топ-15 первых) ----
if (process.argv.includes('--two') || best.worst < 10) {
  console.log('\n== Два репитера (жадный перебор) ==');
  let best2 = null;
  for (const t of top.slice(0, 15)) {
    for (let x = B[0]; x <= B[2]; x += 40) for (let y = B[1]; y <= B[3]; y += 40) {
      if (!farFromNoise(x, y)) continue;
      if (Math.hypot(x - t.x, y - t.y) < 150) continue;
      const { worst } = evalConfig([repAt(t.x, t.y, 'R1'), repAt(x, y, 'R2')], false);
      if (!best2 || worst > best2.worst) best2 = { a: t, b: { x, y }, worst };
    }
  }
  console.log('лучшая пара:', JSON.stringify(best2));
  const { worst, det } = evalConfig([repAt(best2.a.x, best2.a.y, 'R1'), repAt(best2.b.x, best2.b.y, 'R2')], false);
  det.forEach(d => console.log('   ', d.leg.padEnd(18), String(d.m).padStart(6), d.via || ''));
  console.log('   худший:', worst.toFixed(1), 'dB');
}

// ---- 4. СЦЕНА СЕВЕР: сравнение вариантов ----
console.log('\n== СЦЕНА СЕВЕР ==');
const kb = N('КИНОБАР');
console.log('расстояние КИНОБАР→СЦЕНА СЕВЕР:', Math.hypot(kb.x - SCN.x, kb.y - SCN.y).toFixed(0), 'м (радиус wifi 200 м)');
console.log('noiseRise на СЦЕНЕ СЕВЕР:', E.noiseRise(SCN.x, SCN.y).toFixed(1), 'dB');
