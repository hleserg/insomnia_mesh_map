// Регрессионные тесты радиодвижка v2 (запуск: node tests/engine.test.mjs из корня репо).
// Аналитические якоря — из docs/spec.md («Как проверять») и ITU-R P.526; монотонности —
// главное требование: перестановка узлов должна менять картину в физичную сторону.
import { loadEngine } from '../tools/load-engine.mjs';

const E = loadEngine(process.argv[2] || new URL('../mesh-planner.html', import.meta.url).pathname);
let fail = 0, n = 0;
const ok = (name, cond, detail = '') => {
  n++;
  if (!cond) { fail++; console.log('FAIL', name, detail); }
  else console.log('  ok', name, detail);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 1. Аналитические якоря ---
ok('FSPL 1 км @868.7 = 91.2 dB', near(E.fsplOf(1000), 91.2, 0.1), E.fsplOf(1000).toFixed(2));
ok('J(0) ≈ 6 dB', near(E.J(0), 6.0, 0.4), E.J(0).toFixed(2));
ok('J(1) ≈ 13.5 dB', near(E.J(1), 13.5, 0.8), E.J(1).toFixed(2));
ok('J(2) ≈ 19 dB', near(E.J(2), 19.0, 0.8), E.J(2).toFixed(2));
ok('J(v<-0.78) = 0', E.J(-1) === 0);
ok('sens SF9 BW62.5 = -132.5', near(E.R.sens, -132.5, 0.1), E.R.sens.toFixed(1));
ok('airtime 60 Б SF9 BW62.5 ≈ 739 мс', near(E.airtime(60), 739, 6), E.airtime(60).toFixed(0));

// --- 2. Чистые функции на синтетике (плоская земля, без леса) ---
const flat = (d, gz = 0, step = 6) => {
  const pts = [];
  for (let u = step; u < d; u += step)
    pts.push({ t: u / d, u, g: gz, fo: false, s: gz });
  return pts;
};
{ // дифракции нет над плоской землёй при поднятых антеннах
  const r = E.diffractionLoss(flat(1000), 'g', 1000, 10, 10);
  ok('плоская трасса: дифракция 0', r.L === 0, 'L=' + r.L.toFixed(2));
}
{ // потери растут с расстоянием, перелом непрерывен
  const { pl: p1 } = E.pathLoss(200, 3, 3, 0);
  const { pl: p2 } = E.pathLoss(800, 3, 3, 0);
  const { pl: p3 } = E.pathLoss(2400, 3, 3, 0);
  ok('PL монотонен по d', p1 < p2 && p2 < p3, [p1, p2, p3].map(x => x.toFixed(1)).join('→'));
  const dbp = E.pathLoss(1, 3, 3, 0).dbp;
  const lo = E.pathLoss(dbp * 0.999, 3, 3, 0).pl, hi = E.pathLoss(dbp * 1.001, 3, 3, 0).pl;
  ok('PL непрерывен в переломе', near(lo, hi, 0.2), `dbp=${dbp.toFixed(0)} ${lo.toFixed(2)}|${hi.toFixed(2)}`);
  ok('выше антенна — дальше перелом', E.pathLoss(1, 12, 12, 0).dbp > E.pathLoss(1, 3, 3, 0).dbp);
}
{ // вопрос заказчика: мачта 3 м на грунте +60 лучше мачты 5 м в низине
  const d = 1000;
  const valley = flat(d, 0);                       // грунт 0, мачта 5 → zA=5
  const ehV = E.effHeights(valley, d, 5, 10);
  const hill = flat(d, 0).map(p => ({ ...p, g: p.u < 80 ? 60 * (1 - p.u / 80) : 0 })); // A на холме +60
  const ehH = E.effHeights(hill, d, 63, 10);
  ok('эффективная высота: холм+3м > низина+5м', ehH.hA > ehV.hA + 30,
    `hill=${ehH.hA.toFixed(1)} valley=${ehV.hA.toFixed(1)}`);
  const plV = E.pathLoss(d, ehV.hA, ehV.hB, 0).pl, plH = E.pathLoss(d, ehH.hA, ehH.hB, 0).pl;
  ok('потери с холма не больше', plH <= plV + 1e-9, `${plH.toFixed(1)} vs ${plV.toFixed(1)}`);
}
{ // лес: потолок и монотонность
  ok('vegLoss монотонен', E.vegLoss(10) < E.vegLoss(50) && E.vegLoss(50) < E.vegLoss(500));
  ok('vegLoss ≤ Am', E.vegLoss(1e5) <= E.R.fAm + 1e-9, E.vegLoss(1e5).toFixed(2));
}
{ // клаттер: в лесу не двоится, на поляне работает, на мачте обнуляется
  const forestPt = { x: 316.8, y: -59.7 };         // АДМИНИСТРАЦИЯ — лес по маске
  const openPt = { x: 928.2, y: -139.2 };          // ФУДКОРТ — открыто
  ok('точка в лесу по маске', E.inForest(forestPt.x, forestPt.y));
  ok('точка на поляне по маске', !E.inForest(openPt.x, openPt.y));
  ok('клаттер в лесу = 0', E.clutterLoss({ ...forestPt, h: 2 }, { ...forestPt, h: 2 }) === 0);
  const low = E.clutterLoss({ ...openPt, h: 2 }, { ...openPt, h: 2 });
  const high = E.clutterLoss({ ...openPt, h: 12 }, { ...openPt, h: 12 });
  ok('клаттер на поляне при h=2 > 0', low > 0, low.toFixed(1));
  ok('клаттер на мачте = 0', high === 0);
}

// --- 3. Реальная карта: физичные отклики на перестановку узлов ---
// В оптимизированном плане СЦЕНА СЕВЕР исключена — для тестов берём её из сырого пресета.
const nodes = E.getNodes();
const byName = s => nodes.find(x => x.name === s) ||
  Object.assign({}, E.DATA.preset.find(x => x.name === s));
const ADM = byName('АДМИНИСТРАЦИЯ'), GRD = byName('ГРЯДА'), SCN = byName('СЦЕНА СЕВЕР');
{ // оптимизированный план: реалистичные подвесы, без СЦЕНЫ СЕВЕР, коллинеарки на RS/repeater
  ok('СЦЕНА СЕВЕР исключена из плана', !nodes.some(n => n.name === 'СЦЕНА СЕВЕР'));
  ok('подвесы в пределах (лес ≤6, поляна ≤5)', nodes.every(n => n.h <= (E.inForest(n.x, n.y) ? 6 : 5)),
    nodes.map(n => n.name.split(' ')[0] + ':' + n.h).join(' '));
  ok('RS и repeater — всенаправленные', nodes.filter(n => n.role !== 0).every(n => (n.ant | 0) === 0));
  ok('companion — панели', nodes.filter(n => n.role === 0).every(n => (n.ant | 0) === 1));
}
const mAt = (A, B, hA, hB) => E.link({ ...A, h: hA }, { ...B, h: hB }, {}).margin;
{ // подъём антенны никогда не ухудшает линк; выход над полог заметно помогает
  const seq = [2, 6, 12, 18, 25].map(h => mAt(ADM, GRD, h, h));
  let mono = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1] - 0.2) mono = false;
  ok('margin(h) не убывает (АДМ↔ГРЯДА)', mono, seq.map(x => x.toFixed(1)).join(' '));
  ok('подъём 12→25 м над полог помогает', seq[4] > seq[2] + 0.5,
    `+${(seq[4] - seq[2]).toFixed(1)} dB`);
}
{ // удаление узла = деградация: даль больше — запас меньше (вдоль одной прямой, открытая зона)
  const dir = { x: GRD.x - ADM.x, y: GRD.y - ADM.y };
  const L = Math.hypot(dir.x, dir.y);
  const at = k => ({ ...GRD, x: ADM.x + dir.x / L * k, y: ADM.y + dir.y / L * k });
  const m300 = E.link(ADM, at(300), {}).margin, m1200 = E.link(ADM, at(1200), {}).margin;
  ok('дальше по той же прямой — хуже', m300 > m1200, `${m300.toFixed(1)} vs ${m1200.toFixed(1)}`);
}
{ // дорисованные заросли на трассе не улучшают линк
  const A = byName('ФУДКОРТ'), B = GRD;
  const m0 = E.link(A, B, {}).margin;
  E.setGroves([{ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, r: 90 }]);
  const m1 = E.link(A, B, {}).margin;
  E.setGroves([]);
  ok('заросли на трассе не добавляют запас', m1 <= m0 + 1e-9, `${m0.toFixed(1)}→${m1.toFixed(1)}`);
}
{ // длина леса не зависит от дискретизации: сверка с шагом 1 м
  for (const [A, B] of [[ADM, GRD], [ADM, SCN]]) {
    const L = E.link(A, B, {});
    const d = Math.hypot(A.x - B.x, A.y - B.y);
    const zA = E.ground(A.x, A.y) + A.h, zB = E.ground(B.x, B.y) + B.h;
    let ref = 0;
    for (let u = 0.5; u < d; u += 1) {
      const t = u / d, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
      if (E.inForest(x, y) && zA + (zB - zA) * t < E.ground(x, y) + E.R.canopy) ref += 1;
    }
    ok(`flen сходится к точному (${A.name}→${B.name})`, near(L.flen, ref, Math.max(20, ref * 0.05)),
      `${L.flen.toFixed(0)} vs ${ref.toFixed(0)}`);
  }
}
{ // ранний отсев не убивает живые линки и совпадает с полным расчётом по вердикту
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const full = E.link(nodes[i], nodes[j], { prof: 1 }), fast = E.link(nodes[i], nodes[j], {});
    if (full.margin >= -30)
      ok(`отсев не сработал зря (${nodes[i].name}↔${nodes[j].name})`,
        near(full.margin, fast.margin, 0.01), `${full.margin.toFixed(1)}|${fast.margin.toFixed(1)}`);
  }
  const far = { ...GRD, x: GRD.x + 60000, y: GRD.y };
  ok('отсев режет мёртвый линк 60 км', E.link(ADM, far, {}).ok === false);
}
{ // сеть из пресета остаётся связной, профиль отдаёт полог для отрисовки
  const G = E.graph();
  ok('связность пресета', G.hop.every(h => h >= 0), G.hop.join(','));
  const L = E.link(ADM, SCN, { prof: 1 });
  ok('профиль содержит полог (s≥g) и флаг леса', L.prof.every(p => p.s >= p.g) && L.prof.some(p => p.fo));
  const mid = L.prof[Math.floor(L.prof.length / 2)];
  const Fref = 17.31 * Math.sqrt((mid.d / 1000) * ((L.d - mid.d) / 1000) / ((E.R.fMHz / 1000) * (L.d / 1000)));
  ok('зона Френеля в правильных единицах', near(mid.F, Fref, 0.01), mid.F.toFixed(2) + ' м');
}

console.log(fail ? `\n${fail}/${n} FAILED` : `\nall ${n} passed`);
process.exitCode = fail ? 1 : 0;
