// Послемонтажная проверка: сверка замеренных RSSI/SNR с расчётом движка v2.
// Запуск: node tools/field-check.mjs замеры.json [--wet]
//
// Формат замеров (JSON):
// [
//   {"from":"ГРЯДА","to":"АДМИНИСТРАЦИЯ","rssi":-101,"snr":6.5},
//   {"from":"КИНОБАР","to":"ГРЯДА","rssi":-96}
// ]
// Имена — как в плане (можно начало имени). Порог тревоги — 10 dB (docs/spec.md).
import fs from 'node:fs';
import { loadEngine } from './load-engine.mjs';

const file = process.argv[2];
if (!file) { console.error('нужен файл замеров: node tools/field-check.mjs замеры.json [--wet]'); process.exit(2); }
const wet = process.argv.includes('--wet');

const E = loadEngine(new URL('../mesh-planner.html', import.meta.url).pathname);
if (wet) { E.R.forest = 0.45; E.R.fAm = 30; }
const nodes = E.getNodes();
const find = s => nodes.find(n => n.name.startsWith(s)) ||
  Object.assign({}, E.DATA.preset.find(n => n.name.startsWith(s)));

const meas = JSON.parse(fs.readFileSync(file, 'utf8'));
let alarms = 0;
console.log(`листва: ${wet ? 'мокрая' : 'сухая'} · порог расхождения 10 dB\n`);
console.log('линк'.padEnd(34), 'замер'.padStart(7), 'расчёт'.padStart(8), 'Δ'.padStart(6), '  вердикт');
for (const m of meas) {
  const A = find(m.from), B = find(m.to);
  if (!A || !B) { console.log(`${m.from}→${m.to}: узел не найден в плане`); alarms++; continue; }
  const L = E.link(A, B, {});
  const dd = m.rssi - L.prx;
  const bad = Math.abs(dd) > 10;
  if (bad) alarms++;
  const snr = m.snr !== undefined ? ` snr ${m.snr}` : '';
  console.log(
    `${m.from}→${m.to}`.padEnd(34),
    `${m.rssi}`.padStart(7),
    `${L.prx.toFixed(0)}`.padStart(8),
    `${dd >= 0 ? '+' : ''}${dd.toFixed(1)}`.padStart(6),
    bad ? `  ⚠ РАЗБОР (${L.mech}, лес ${L.flen.toFixed(0)} м, дифр ${L.ldif.toFixed(1)} dB)${snr}`
        : `  ok (${L.mech})${snr}`);
}
console.log(alarms ? `\n${alarms} расхождений больше порога — проверить подвес/азимут/полог или калибровать γ/Am (--wet после дождя)` : '\nвсё в пределах порога');
process.exitCode = alarms ? 1 : 0;
