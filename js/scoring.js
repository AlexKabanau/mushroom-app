// Scoring algorithm — shared between client and GitHub Actions digest
import { CONFIG } from './config.js';

/**
 * Get scoring thresholds for a species (or default if unknown).
 */
function getThresholds(speciesKey) {
  return (speciesKey && CONFIG.speciesConfig?.[speciesKey]?.scoring)
    ? CONFIG.speciesConfig[speciesKey].scoring
    : CONFIG.scoring;
}

/**
 * Compute score (0–100) for a given set of conditions.
 * @param {Object} c - { soilT, soilM, rain10d, tMax, tMin, rainToday?, date?, frostInLast7Days? }
 * @param {string|null} speciesKey - optional species name from CONFIG.speciesConfig
 */
export function scoreFromConditions(c, speciesKey = null) {
  if (!c) return null;
  const S = getThresholds(speciesKey);
  let score = 0;

  if (c.soilT >= S.soilT.ok[0] && c.soilT <= S.soilT.ok[1]) score += 25;
  else if (c.soilT >= S.soilT.fair[0] && c.soilT <= S.soilT.fair[1]) score += 12;

  if (c.soilM >= S.soilM.ok[0] && c.soilM <= S.soilM.ok[1]) score += 25;
  else if (c.soilM >= S.soilM.fair[0] && c.soilM <= S.soilM.fair[1]) score += 12;

  if (c.rain10d >= S.rain10d.ok[0] && c.rain10d <= S.rain10d.ok[1]) score += 20;
  else if (c.rain10d >= S.rain10d.fair[0] && c.rain10d <= S.rain10d.fair[1]) score += 10;

  if (c.tMax >= S.tMax.ok[0] && c.tMax <= S.tMax.ok[1]) score += 15;
  else if (c.tMax >= S.tMax.fair[0] && c.tMax <= S.tMax.fair[1]) score += 7;

  if (c.tMin > S.tMin.ok) score += 10;
  else if (c.tMin > S.tMin.fair) score += 5;

  if (c.rainToday !== undefined) {
    if (c.rainToday < 3) score += 5;
    else if (c.rainToday > 8) score -= 5;
  }

  // Пиковый месяц: +7 бонус если дата попадает в пиковые месяцы вида
  const specCfg = speciesKey ? CONFIG.speciesConfig?.[speciesKey] : null;
  if (specCfg?.peakMonths && c.date) {
    const month = new Date(c.date).getMonth() + 1; // 1–12
    if (specCfg.peakMonths.includes(month)) score += 7;
  }

  // Специальное правило: мороз → бонус для опёнка
  if (specCfg?.specialRule === 'frost' && c.frostInLast7Days) score += 15;

  score = Math.max(0, Math.min(100, score));

  // ======================================================
  // Дождевой потолок: дождь — триггер плодоношения.
  // Без свежих осадков мицелий не запускает новую волну
  // даже если почва ещё влажная от прошлых дождей.
  // Потолок пропорционален rain10d относительно минимума вида.
  // rainMin берётся из rain10d.fair[0] каждого вида — порог
  // калиброван по данным: для белого = 4мм (Bielefeld dataset,
  // Zenodo 17881359 — пик корреляции на lag=10, 25% находок при 5-10мм).
  // ======================================================
  const rainMin = S.rain10d.fair[0]; // минимальный порог для вида (белый: 4мм, грузди: 14-16мм)
  if (c.rain10d < rainMin) {
    const ratio = c.rain10d / rainMin;                    // 0.0 → 1.0
    const cap = Math.round(28 + ratio * 42);              // 28 (0мм) → 70 (≥rainMin)
    score = Math.min(score, cap);
  }

  return score;
}

export function statusFromScore(score) {
  const t = CONFIG.scoring.threshold;
  if (score >= t.green) return 'green';
  if (score >= t.yellow) return 'yellow';
  return 'red';
}

/**
 * Score a list of species for the same conditions.
 * Returns array of { species, score, status, lag, note } sorted by score desc.
 */
export function scoreSpeciesList(c, speciesList) {
  if (!c || !speciesList?.length) return [];
  return speciesList
    .map(sp => {
      const score = scoreFromConditions(c, sp);
      const cfg = CONFIG.speciesConfig?.[sp];
      return {
        species: sp,
        emoji: cfg?.emoji || '🍄',
        score,
        status: statusFromScore(score),
        lag: cfg?.lagDays ?? null,
        note: cfg?.note ?? null,
        isPeak: cfg?.peakMonths && c.date
          ? cfg.peakMonths.includes(new Date(c.date).getMonth() + 1)
          : false
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Project forward from historical weather to compute forecast-day score.
 * @param {Object} hist - { rain:[], soilM:[], soilT:[], tMin:[] }
 * @param {Object} fc - { dates:[], tMax:[], tMin:[], rain:[] }
 * @param {Number} idx - forecast day index
 * @param {string|null} speciesKey - optional species for species-specific score
 */
export function projectDayScore(hist, fc, idx, speciesKey = null) {
  if (!hist || !fc) return null;

  const tMax = fc.tMax[idx];
  const tMin = fc.tMin[idx];
  const date = fc.dates?.[idx] || null;

  // Rolling 10-day rain window (combine hist tail + forecast up to this day)
  const histTail = hist.rain.slice(-10 + idx + 1);
  const futureRain = fc.rain.slice(0, idx + 1);
  const combined = histTail.concat(futureRain);
  const rain10d = combined.slice(-10).reduce((a, b) => a + b, 0);

  // Soil moisture: используем реальный прогноз open-meteo если доступен,
  // иначе проецируем от последней исторической точки
  let sm;
  if (fc.soilM?.[idx] != null) {
    sm = fc.soilM[idx];
  } else {
    sm = hist.soilM[hist.soilM.length - 1];
    for (let i = 0; i <= idx; i++) {
      sm = Math.max(0.15, Math.min(0.45, sm + (fc.rain[i] - 1.4) * 0.004));
    }
  }

  // Soil temp: используем реальный прогноз open-meteo если доступен
  let st;
  if (fc.soilT?.[idx] != null) {
    st = fc.soilT[idx];
  } else {
    st = hist.soilT[hist.soilT.length - 1];
    for (let i = 0; i <= idx; i++) {
      const tMean = (fc.tMax[i] + fc.tMin[i]) / 2;
      st = st + (tMean - st) * 0.12;
    }
  }

  // API осадков: проекция затухающего индекса вперёд от последнего исторического значения
  // API_t = λ * API_{t-1} + P_{t-1}
  const LAMBDA = 0.90;
  let apiRain = hist.apiRain?.[hist.apiRain.length - 1] ?? 0;
  // day 0: API = λ*api_yesterday + hist.rain_last
  apiRain = LAMBDA * apiRain + (hist.rain[hist.rain.length - 1] || 0);
  for (let i = 1; i <= idx; i++) {
    apiRain = LAMBDA * apiRain + (fc.rain[i - 1] || 0);
  }
  apiRain = parseFloat(apiRain.toFixed(2));

  // Frost in last 7 days: check hist tMin tail + forecast up to today
  const recentTMin = [
    ...(hist.tMin ? hist.tMin.slice(-7) : []),
    ...(fc.tMin ? fc.tMin.slice(0, idx + 1) : [])
  ].slice(-7);
  const frostInLast7Days = recentTMin.some(t => t < 0);

  // Cold Shock ΔT (правило Василькова):
  // ΔT = среднее за дни [-10..-4] минус среднее за дни [-3..0]
  // Используем hist.tMax+tMin для вычисления tMean
  const allTMax = [...(hist.tMax || []), ...fc.tMax.slice(0, idx + 1)];
  const allTMin = [...(hist.tMin || []), ...fc.tMin.slice(0, idx + 1)];
  const allTMean = allTMax.map((mx, i) => (mx + (allTMin[i] ?? mx)) / 2);
  const endIdx = allTMean.length - 1;
  const slice1 = allTMean.slice(Math.max(0, endIdx - 10), Math.max(0, endIdx - 3)); // дни -10..-4
  const slice2 = allTMean.slice(Math.max(0, endIdx - 3), endIdx + 1);               // дни -3..0
  const avg1 = slice1.length ? slice1.reduce((a, b) => a + b, 0) / slice1.length : null;
  const avg2 = slice2.length ? slice2.reduce((a, b) => a + b, 0) / slice2.length : null;
  const coldShockDelta = (avg1 !== null && avg2 !== null) ? parseFloat((avg1 - avg2).toFixed(1)) : 0;

  const conditions = {
    soilT: parseFloat(st.toFixed(1)),
    soilM: parseFloat(sm.toFixed(3)),
    rain10d: parseFloat(rain10d.toFixed(1)),
    apiRain,         // затухающий индекс осадков (λ=0.90), используется в MDI
    tMax,
    tMin,
    rainToday: fc.rain[idx],
    date,
    frostInLast7Days,
    coldShockDelta   // для MDI cold shock trigger
  };

  const score = scoreFromConditions(conditions, speciesKey);
  return {
    score,
    status: statusFromScore(score),
    soilM: conditions.soilM,
    soilT: conditions.soilT,
    rain10d: conditions.rain10d,
    apiRain: conditions.apiRain,
    frostInLast7Days,
    coldShockDelta: conditions.coldShockDelta
  };
}

/**
 * Build conditions object for a trigger day that falls in HISTORICAL data.
 * histOffset = number of days before the first forecast day (fc.dates[0]).
 * histOffset=1 → yesterday, histOffset=7 → a week ago, etc.
 */
function conditionsFromHist(hist, histOffset) {
  const hIdx = hist.dates.length - histOffset;
  if (hIdx < 0 || hIdx >= hist.dates.length) return null;
  const rain10d = hist.rain
    .slice(Math.max(0, hIdx - 9), hIdx + 1)
    .reduce((a, b) => a + (b || 0), 0);
  const frostInLast7Days = hist.tMin
    .slice(Math.max(0, hIdx - 6), hIdx + 1)
    .some(t => t < 0);

  // Cold Shock ΔT для исторического триггерного дня
  let coldShockDelta = 0;
  if (hist.tMax && hist.tMin) {
    const allTMean = hist.tMax.map((mx, i) => (mx + (hist.tMin[i] ?? mx)) / 2);
    const s1 = allTMean.slice(Math.max(0, hIdx - 10), Math.max(0, hIdx - 3));
    const s2 = allTMean.slice(Math.max(0, hIdx - 3), hIdx + 1);
    const a1 = s1.length ? s1.reduce((a, b) => a + b, 0) / s1.length : null;
    const a2 = s2.length ? s2.reduce((a, b) => a + b, 0) / s2.length : null;
    coldShockDelta = (a1 !== null && a2 !== null) ? parseFloat((a1 - a2).toFixed(1)) : 0;
  }

  return {
    soilT: hist.soilT[hIdx],
    soilM: hist.soilM[hIdx],
    rain10d,
    apiRain: hist.apiRain?.[hIdx] ?? rain10d,  // затухающий индекс, fallback на rain10d
    tMax: hist.tMax?.[hIdx] ?? ((hist.tMin[hIdx] ?? 0) + 8), // fallback if tMax absent
    tMin: hist.tMin[hIdx],
    rainToday: hist.rain[hIdx],
    date: hist.dates[hIdx],
    frostInLast7Days,
    coldShockDelta
  };
}

/**
 * Project scores for a list of species on a given forecast day.
 *
 * KEY INSIGHT: mushrooms on day X were TRIGGERED by conditions on day X-lagDays.
 * So we score the TRIGGER DAY, not the display day.
 *
 * triggerIdx = idx - lagDays
 *   >= 0  → trigger is within forecast range → use projectDayScore
 *   <  0  → trigger is in historical data   → use conditionsFromHist
 *
 * Returns array sorted by score desc.
 */
export function projectSpeciesScores(hist, fc, idx, speciesList, scoreFn = scoreFromConditions) {
  if (!hist || !fc || !speciesList?.length) return [];

  return speciesList.map(sp => {
    const cfg = CONFIG.speciesConfig?.[sp];
    const lag = cfg?.lagDays ?? 7;
    const triggerIdx = idx - lag; // which day's conditions drove today's crop

    let conditions;
    if (triggerIdx >= 0) {
      // Trigger is within forecast window
      const base = projectDayScore(hist, fc, triggerIdx, null);
      if (!base) return null;
      conditions = {
        soilT: base.soilT,
        soilM: base.soilM,
        rain10d: base.rain10d,
        tMax: fc.tMax[triggerIdx],
        tMin: fc.tMin[triggerIdx],
        rainToday: fc.rain[triggerIdx],
        date: fc.dates?.[triggerIdx] || null,
        frostInLast7Days: base.frostInLast7Days,
        coldShockDelta: base.coldShockDelta ?? 0,
        apiRain: base.apiRain ?? base.rain10d
      };
    } else {
      // Trigger is in historical data
      // fc starts from today; triggerIdx=-1 means yesterday (1 day before fc[0])
      const histOffset = -triggerIdx; // days before fc[0] = days before today
      conditions = conditionsFromHist(hist, histOffset);
    }

    if (!conditions) return null;

    const score = scoreFn(conditions, sp);
    return {
      species: sp,
      emoji: cfg?.emoji || '🍄',
      score,
      status: statusFromScore(score),
      lag,
      note: cfg?.note ?? null,
      isPeak: cfg?.peakMonths && conditions.date
        ? cfg.peakMonths.includes(new Date(conditions.date).getMonth() + 1)
        : false
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.score - a.score);
}
