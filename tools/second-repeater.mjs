// Второй репитер для надёжности: ищем позицию R2, максимизирующую живучесть сети
// при отказе ГРЯДЫ (N+1), на мокрой листве, с реальными подвесами и зонами шума.
// Запуск: node tools/second-repeater.mjs
import { loadEngine } from './load-engine.mjs';

const E = loadEngine(new URL('../mesh-planner.html', import.meta.url).pathname);
const { link, inForest, R, DATA } = E;
R.forest = 0.45; R.fAm = 30;                         // мокрая листва

const nodes = E.getNodes();
const N = s => nodes.find(x => x.name.startsWith(s));
const RS = N('АДМИНИСТРАЦИЯ'), GRD = N('ГРЯДА');
const comps = ['СЕВЕРНЫЙ ГОРОД', 'КИНОБАР', 'ФУДКОРТ', 'WONDER WAY'].map(N);
const hOf = (x, y) => inForest(x, y) ? 6 : 4;
const aim = (n, t) => ({ ...n, ant: 1, az: Math.round((Math.atan2(t.x - n.x, t.y - n.y) * 180 / Math.PI + 360) % 360) });
const repAt = (x, y) => ({ name: 'R2', x, y, role: 2, h: hOf(x, y), tx: 14, g: 6, ant: 0, az: 0 });

const noiseMin = [75, 55, 55, 35, 35];
const farFromNoise = (x, y) => E.getNoises().every(s => Math.hypot(s.x - x, s.y - y) >= (noiseMin[s.t] || 35));

// лучший путь companion→RS при заданном наборе живых репитеров
function best(c, reps) {
  let m = link(aim(c, RS), RS).margin;
  for (const r of reps) m = Math.max(m, Math.min(link(aim(c, r), r).margin, link(r, RS).margin));
  return m;
}
const worstOf = reps => Math.min(...comps.map(c => best(c, reps)));

console.log('Мокрая листва. Базовая живучесть:');
console.log('  все живы (ГРЯДА):        худший путь', worstOf([GRD]).toFixed(1), 'dB');
console.log('  ГРЯДА умерла, R2 нет:    худший путь', worstOf([]).toFixed(1), 'dB  ← КИНОБАР без связи');

const B = DATA.bbox;
let top = [];
for (let x = B[0]; x <= B[2]; x += 25) for (let y = B[1]; y <= B[3]; y += 25) {
  if (!farFromNoise(x, y)) continue;
  if (Math.hypot(x - GRD.x, y - GRD.y) < 200) continue;       // резерв не рядом с основным
  const r2 = repAt(x, y);
  const mFail = worstOf([r2]);                                // ГРЯДА мертва, живёт R2
  if (mFail <= 0) continue;
  const mBoth = worstOf([GRD, r2]);                           // обе живы
  top.push({ x, y, mFail, mBoth });
}
top.sort((a, b) => b.mFail - a.mFail || b.mBoth - a.mBoth);
console.log('\nТоп-6 позиций R2 (критерий: худший путь при мёртвой ГРЯДЕ):');
for (const t of top.slice(0, 6))
  console.log(`  (${t.x},${t.y})  ${E.w2lat(t.y).toFixed(6)},${E.w2lng(t.x).toFixed(6)}  ` +
    `${inForest(t.x, t.y) ? 'лес h=6' : 'открыто h=4'}  отказ ГРЯДЫ: ${t.mFail.toFixed(1)} dB  обе живы: ${t.mBoth.toFixed(1)} dB`);

if (top.length) {
  const t = top[0], r2 = repAt(t.x, t.y);
  console.log('\nДетали лучшей позиции:');
  console.log('  R2↔RS:', link(r2, { ...RS }).margin.toFixed(1), 'dB');
  for (const c of comps)
    console.log(' ', c.name.padEnd(15),
      'через R2:', Math.min(link(aim(c, r2), r2).margin, link(r2, RS).margin).toFixed(1),
      '| через ГРЯДУ:', Math.min(link(aim(c, GRD), GRD).margin, link(GRD, RS).margin).toFixed(1),
      '| прямо:', link(aim(c, RS), RS).margin.toFixed(1));
  // выживание при отказе R2 (симметрия) и при отказе RS — для полноты
  console.log('  отказ R2 (ГРЯДА жива):', worstOf([GRD]).toFixed(1), 'dB');
}
