// Энергобюджет узлов: что реально запитать автономно, а что требует сети/генератора.
// Запуск: node tools/power-budget.mjs [часов]
const HOURS = +(process.argv[2] || 96);          // 4 суток фестиваля по умолчанию

// Потребление (средние рабочие цифры, а не пиковые из даташитов)
const LOAD = {
  lora_repeater: { w: 0.30, name: 'MeshCore repeater/companion (ESP32+SX1262, приём постоянно)' },
  lora_server:   { w: 0.45, name: 'MeshCore room server (то же + хранение и BLE)' },
  unifi_xg:      { w: 15.0, name: 'UniFi XG в работе (PoE 802.3at, пик 25 Вт)' },
  poe_loss:      { w: 2.0,  name: 'потери PoE-инжектора и кабеля' },
  router:        { w: 4.0,  name: 'мини-роутер/локальный сервер точки' },
};
const DOD = 0.8;        // глубина разряда LiFePO4
const EFF = 0.85;       // КПД преобразования

const wh = w => w * HOURS;
const cap = w => wh(w) / DOD / EFF;                     // нужная ёмкость, Вт·ч
const ah12 = w => cap(w) / 12;                          // в Ач при 12 В
const kg = w => cap(w) / 90;                            // LiFePO4 ~90 Вт·ч/кг с корпусом

console.log(`Горизонт автономии: ${HOURS} ч (${(HOURS / 24).toFixed(1)} сут)\n`);
const rows = [
  ['только LoRa-репитер', LOAD.lora_repeater.w],
  ['только LoRa room server', LOAD.lora_server.w],
  ['LoRa + wifi-точка UniFi XG', LOAD.lora_repeater.w + LOAD.unifi_xg.w + LOAD.poe_loss.w + LOAD.router.w],
];
console.log('конфигурация узла                 мощность   расход      батарея      вес LiFePO4');
for (const [nm, w] of rows)
  console.log(nm.padEnd(32), (w.toFixed(2) + ' Вт').padStart(9),
    (wh(w).toFixed(0) + ' Вт·ч').padStart(10), (ah12(w).toFixed(0) + ' Ач@12В').padStart(12),
    (kg(w).toFixed(1) + ' кг').padStart(12));

// Солнце: Калужская обл., конец июля. Открытое место против леса под пологом.
const SUN = { open: 4.2, forest: 0.4 };   // кВт·ч/м²/сут (лес: 5-10% от открытого)
const PANEL_EFF = 0.18, SYS = 0.7;        // КПД панели и системы (контроллер, углы, пыль)
console.log('\nПодзарядка солнечной панелью 100 Вт (0.55 м²):');
for (const [where, ins] of Object.entries(SUN)) {
  const dayWh = 0.55 * PANEL_EFF * 1000 * ins * SYS;
  console.log(` ${where === 'open' ? 'открытое место' : 'под пологом леса'}: ${dayWh.toFixed(0)} Вт·ч/сут → ` +
    `LoRa-узел (${(LOAD.lora_repeater.w * 24).toFixed(1)} Вт·ч/сут): ${dayWh > LOAD.lora_repeater.w * 24 ? 'ПОКРЫВАЕТ ✅' : 'не покрывает ❌'} | ` +
    `узел с UniFi XG (${((LOAD.lora_repeater.w + LOAD.unifi_xg.w + LOAD.poe_loss.w + LOAD.router.w) * 24).toFixed(0)} Вт·ч/сут): ` +
    `${dayWh > (LOAD.lora_repeater.w + LOAD.unifi_xg.w + LOAD.poe_loss.w + LOAD.router.w) * 24 ? 'покрывает' : 'НЕ ПОКРЫВАЕТ ❌'}`);
}

// Сколько нужно панелей, чтобы вытянуть wifi-точку на открытом месте
const wifiW = LOAD.lora_repeater.w + LOAD.unifi_xg.w + LOAD.poe_loss.w + LOAD.router.w;
const dayOpen = 0.55 * PANEL_EFF * 1000 * SUN.open * SYS;
console.log(`\nЧтобы вытянуть узел с wifi на открытом месте: ${Math.ceil(wifiW * 24 / dayOpen)} панелей по 100 Вт ` +
  `+ буфер на ночь ${(wifiW * 14 / DOD / EFF).toFixed(0)} Вт·ч (${(wifiW * 14 / DOD / EFF / 12).toFixed(0)} Ач)`);
console.log(`В лесу под пологом — ${Math.ceil(wifiW * 24 / (0.55 * PANEL_EFF * 1000 * SUN.forest * SYS))} панелей: нереально.`);

console.log('\nВывод: LoRa-узел автономен где угодно (пауэрбанк на весь фестиваль),');
console.log('wifi-точка в лесу без сети или генератора — нет.');
