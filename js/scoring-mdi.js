// scoring-mdi.js — MDI v2.0 (Mushroom Day Index)
// Асимметричные гауссовы кривые + мультипликативное физиологическое ядро
// Источник: спецификация v2.0, Bielefeld dataset (Zenodo 17881359), Andrew 2018 (Dryad)
import { CONFIG } from './config.js';

/**
 * Асимметричный гаусс с плоским оптимумом.
 * Возвращает [0, 1]:
 *   = 1.0 при x ∈ [tOptLow, tOptHigh]
 *   Гауссовый спад ниже/выше, sigmaLeft (холодная сторона), sigmaRight (горячая, круче)
 *   = 0 за пределами [tMin, tMax]
 */
function asymGaussian(x, tMin, tOptLow, tOptHigh, tMax, sigmaLeft, sigmaRight) {
  if (x <= tMin || x >= tMax) return 0;
  if (x >= tOptLow && x <= tOptHigh) return 1.0;
  if (x < tOptLow) {
    return Math.exp(-0.5 * Math.pow((x - tOptLow) / sigmaLeft, 2));
  }
  return Math.exp(-0.5 * Math.pow((x - tOptHigh) / sigmaRight, 2));
}

/**
 * Трапециевидная функция влажности почвы.
 * Линейный рост wilt→optLow, плато 1.0 через optLow→optHigh,
 * мягкий спад к sat (анаэробиоз).
 */
function trapMoisture(soilM, wilt, optLow, optHigh, sat) {
  if (soilM <= wilt || soilM >= sat) return 0;
  if (soilM < optLow) return (soilM - wilt) / (optLow - wilt);
  if (soilM <= optHigh) return 1.0;
  return 1.0 - 0.7 * ((soilM - optHigh) / (sat - optHigh));
}

/**
 * Сезонный фактор — гауссов пик вокруг doyPeak (день года).
 * doySigma ≈ 20 дней = охват ±30 дней на уровне 0.5.
 */
function doyFactor(date, doyPeak, doySigma) {
  if (!date) return 0.7; // нет даты → нейтральный сезон
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d - start) / 86400000);
  const dist = Math.min(Math.abs(doy - doyPeak), 365 - Math.abs(doy - doyPeak));
  return Math.exp(-0.5 * Math.pow(dist / doySigma, 2));
}

/**
 * Рассчитать MDI-балл (0–100) по объекту условий.
 * Интерфейс идентичен scoreFromConditions(c, speciesKey).
 * Если для вида нет mdi-параметров — использует genericMDI.
 */
export function scoreFromConditionsMDI(c, speciesKey = null) {
  if (!c) return null;

  const specCfg = speciesKey ? CONFIG.speciesConfig?.[speciesKey] : null;
  const mdi = specCfg?.mdi;

  if (!mdi) return scoreGenericMDI(c);

  // 1. Сезонный фактор (DOY-гаусс)
  const sf = doyFactor(c.date, mdi.doyPeak, mdi.doySigma ?? 20);

  // 2. Температура почвы (асимметричный гаусс)
  const tSoilFactor = asymGaussian(
    c.soilT, mdi.tMin, mdi.tOptLow, mdi.tOptHigh, mdi.tMax,
    mdi.sigmaLeft, mdi.sigmaRight
  );

  // 3. Влажность почвы (трапеция)
  const mSoilFactor = trapMoisture(
    c.soilM, mdi.moistWilt, mdi.moistOptLow, mdi.moistOptHigh, mdi.moistSat
  );

  // 4. Осадочный фактор (затухающий API-индекс, fallback → rain10d)
  // В MDI v2.0 используется API (Antecedent Precipitation Index, λ=0.90),
  // который учитывает накопленную историческую влагу, а не просто сумму 10 дней.
  const rainMetric = c.apiRain ?? c.rain10d; // API передаётся из projectDayScore
  let rainFactor = 1.0;
  if (rainMetric < mdi.rain10dMin) {
    // Формула из спецификации: Cap = 25 + 45*(P/Pmin) → factor 0.25 + 0.75*ratio
    rainFactor = 0.25 + 0.75 * (rainMetric / mdi.rain10dMin);
  } else if (rainMetric > mdi.rain10dMax) {
    // Вымокание: мягкий спад выше максимума
    rainFactor = Math.max(0.3, 1.0 - 0.5 * ((rainMetric - mdi.rain10dMax) / 40));
  }

  // 5. Модификаторы
  let shockBonus = 1.0;

  // Cold Shock ΔT (правило Василькова): ΔT ≥ 4.5°C, tMean ∈ [7, 14]°C, soilM ≥ 0.24
  // c.coldShockDelta передаётся из projectDayScore
  if ((c.coldShockDelta ?? 0) >= 4.5) {
    const tMean = c.tMax != null && c.tMin != null ? (c.tMax + c.tMin) / 2 : null;
    if (tMean !== null && tMean >= 7 && tMean <= 14 && c.soilM >= 0.24) {
      // Бонус 0..+40% пропорционально силе толчка выше 4.5°C
      shockBonus += 0.40 * Math.min(1.0, (c.coldShockDelta - 4.5) / 4.0);
    }
  }

  if (specCfg?.specialRule === 'frost' && c.frostInLast7Days) {
    shockBonus = Math.max(shockBonus, 1.35); // триггер опёнка: заморозок
  }

  // 6. Мультипликативное физиологическое ядро
  const physCore = tSoilFactor * mSoilFactor * rainFactor;

  // 7. Финальный балл 0–100
  let score = 100 * (0.65 * physCore + 0.35 * sf) * shockBonus;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Запасной MDI для видов без mdi-параметров в конфиге (симметричный гаусс по умолчанию).
 */
function scoreGenericMDI(c) {
  const S = CONFIG.scoring;
  const tOpt = (S.soilT.ok[0] + S.soilT.ok[1]) / 2;
  const tSigma = S.soilT.ok[1] - S.soilT.ok[0];
  const tFactor = (c.soilT >= S.soilT.fair[0] && c.soilT <= S.soilT.fair[1])
    ? Math.exp(-0.5 * Math.pow((c.soilT - tOpt) / tSigma, 2)) : 0;
  const mFactor = trapMoisture(c.soilM, 0.10, S.soilM.ok[0], S.soilM.ok[1], 0.50);
  let rFactor = 1.0;
  if (c.rain10d < S.rain10d.fair[0]) rFactor = 0.25 + 0.75 * (c.rain10d / S.rain10d.fair[0]);
  return Math.max(0, Math.min(100,
    Math.round(100 * (0.65 * tFactor * mFactor * rFactor + 0.35 * 0.7))
  ));
}
