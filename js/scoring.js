// Scoring algorithm — shared between client and GitHub Actions digest
import { CONFIG } from './config.js';

/**
 * Approximate photoperiod (day length, hours) for a given date at latitude latDeg.
 * Spencer 1971 solar declination + hour-angle formula.
 * Default lat = 53.5°N (Пуховичский район, Беларусь).
 */
/**
 * Approximate photoperiod (day length, hours) for a given date at latitude latDeg.
 * Simple cosine declination formula (accurate to ~0.3°).
 * decl = -23.45° · cos(2π·(doy+10)/365)
 * Default lat = 53.5°N (Пуховичский район, Беларусь).
 */
function dayLengthHours(dateStr, latDeg = 53.5) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d - start) / 86400000);
  const lat  = latDeg * Math.PI / 180;
  const decl = -0.4093 * Math.cos(2 * Math.PI * (doy + 10) / 365); // rad
  const cosH = -Math.tan(lat) * Math.tan(decl);
  if (cosH <= -1) return 24;  // полярный день
  if (cosH >=  1) return 0;   // полярная ночь
  return 2 * (Math.acos(cosH) * 180 / Math.PI) / 15; // часы
}

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

  // Rain quality: одиночный ливень менее эффективен чем равномерные осадки.
  // Инфильтрационная способность почвы ограничивает усвоение больших разовых дождей.
  // Формула: скидываем 50% от каждого мм >8мм в один день за 14-дневное окно.
  // Oct 11, 2026: maxDay=10.7 → effRain = 17.2 - (10.7-8)*0.5 = 15.9мм (fair, не ok)
  const effRain = (c.maxDayRain14d != null)
    ? Math.max(0, c.rain10d - Math.max(0, c.maxDayRain14d - 8) * 0.5)
    : c.rain10d;

  if (effRain >= S.rain10d.ok[0] && effRain <= S.rain10d.ok[1]) score += 20;
  else if (effRain >= S.rain10d.fair[0] && effRain <= S.rain10d.fair[1]) score += 10;

  if (c.tMax >= S.tMax.ok[0] && c.tMax <= S.tMax.ok[1]) score += 15;
  else if (c.tMax >= S.tMax.fair[0] && c.tMax <= S.tMax.fair[1]) score += 7;

  if (c.tMin > S.tMin.ok) score += 10;
  else if (c.tMin > S.tMin.fair) score += 5;

  if (c.rainToday !== undefined) {
    if (c.rainToday < 3) score += 5;
    else if (c.rainToday > 8) score -= 5;
  }

  // Пиковый месяц: +7 бонус (отключается после 20 октября — поздний сезон)
  const specCfg = speciesKey ? CONFIG.speciesConfig?.[speciesKey] : null;
  if (specCfg?.peakMonths && c.date) {
    const _d = new Date(c.date);
    const month = _d.getMonth() + 1; // 1–12
    const lateOct = (month === 10 && _d.getDate() > 20) || month > 10;
    if (!lateOct && specCfg.peakMonths.includes(month)) score += 7;
  }

  // Фотопериод: длина дня как самостоятельный сезонный триггер.
  // M3a, M3b: ~22 сентября в Беларуси (53.5°N) день = 12ч.
  // Осенние виды: +5 при дне < 12ч, -3 при дне > 15ч (лето — не сезон).
  // Лисичка (летний вид): +5 при дне > 14.5ч, -8 при дне < 11ч (зима).
  if (speciesKey && c.date) {
    const dayLen = dayLengthHours(c.date);
    if (speciesKey === 'лисичка') {
      if      (dayLen > 14.5) score += 5;   // летний пик
      else if (dayLen < 11.0) score -= 8;   // зима — не её сезон
    } else if (specCfg) {
      if      (dayLen < 12.0) score += 5;   // осенний фотопериод-триггер
      else if (dayLen > 15.0) score -= 3;   // июнь–июль — слабый штраф
    }
  }

  // Специальное правило: мороз → бонус для опёнка
  if (specCfg?.specialRule === 'frost' && c.frostInLast7Days) score += 15;

  // Трубчатые виды: несколько заморозков = конец плодоношения
  // Büntgen 2015, Boddy 2014: повторные ночные морозы убивают активную волну трубчатых
  const TUBULAR = ['белый','подберёзовик','подосиновик','маслёнок','рыжик','лисичка','моховик','польский гриб'];
  if (TUBULAR.includes(speciesKey) && c.frostCount != null) {
    if      (c.frostCount >= 3) score -= 20;
    else if (c.frostCount === 2) score -= 10;
  }

  // Засуха: штраф если большинство последних 30 дней были сухими
  // Büntgen 2015: засуха >3 недель подавляет плодоношение даже после дождей
  if (c.dryDaysIn30 != null) {
    if      (c.dryDaysIn30 > 24) score -= 15;   // >80% месяца — засуха
    else if (c.dryDaysIn30 > 18) score -= 8;    // >60% месяца — умеренная засуха
  }

  score = Math.max(0, Math.min(100, score));

  // Жёсткий потолок холодной почвы:
  // soilT < 4°C — трубчатые не плодоносят (Boddy 2014, Salerni 2023)
  if (c.soilT != null && c.soilT < 4 && specCfg?.specialRule !== 'frost') {
    score = Math.min(score, 30);
  }

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
  if (effRain < rainMin) {
    const ratio = effRain / rainMin;                      // 0.0 → 1.0 (используем effRain)
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

  // Rolling 14-day rain window (combine hist tail + forecast up to this day)
  // Andrew et al. 2018, Büntgen 2015: 14-day cumulative rain = strongest predictor
  const histTail = hist.rain.slice(-14 + idx + 1);
  const futureRain = fc.rain.slice(0, idx + 1);
  const combined = histTail.concat(futureRain);
  const rain14dWindow = combined.slice(-14);
  const rain10d = rain14dWindow.reduce((a, b) => a + b, 0);
  const maxDayRain14d = parseFloat(Math.max(...rain14dWindow.map(v => v || 0)).toFixed(1));

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

  // Frost count: количество ночей с морозом за последние 10 дней
  const recentTMin10 = [
    ...(hist.tMin ? hist.tMin.slice(-10) : []),
    ...(fc.tMin ? fc.tMin.slice(0, idx + 1) : [])
  ].slice(-10);
  const frostCount = recentTMin10.filter(t => t < 0).length;

  // Dry days in last 30: дни с осадками <2мм за последние 30 дней
  // Büntgen 2015: засуха >3 недель подавляет плодоношение даже после дождей
  const allRainFull = [...(hist.rain || []), ...fc.rain.slice(0, idx + 1)];
  const rain30window = allRainFull.slice(Math.max(0, allRainFull.length - 30));
  const dryDaysIn30 = rain30window.filter(r => (r || 0) < 2).length;

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
    maxDayRain14d,   // max single-day rain in 14d window (for rain quality penalty)
    apiRain,         // затухающий индекс осадков (λ=0.90), используется в MDI
    tMax,
    tMin,
    rainToday: fc.rain[idx],
    date,
    frostInLast7Days,
    frostCount,
    dryDaysIn30,
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
    frostCount: conditions.frostCount,
    dryDaysIn30: conditions.dryDaysIn30,
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
  const rain14dWindow = hist.rain.slice(Math.max(0, hIdx - 13), hIdx + 1);
  const rain10d = rain14dWindow.reduce((a, b) => a + (b || 0), 0);
  const maxDayRain14d = Math.max(...rain14dWindow.map(v => v || 0));
  const frostInLast7Days = hist.tMin
    .slice(Math.max(0, hIdx - 6), hIdx + 1)
    .some(t => t < 0);

  // Frost count (last 10 days)
  const frostCount = (hist.tMin || [])
    .slice(Math.max(0, hIdx - 9), hIdx + 1)
    .filter(t => t < 0).length;

  // Dry days in last 30
  const dryDaysIn30 = (hist.rain || [])
    .slice(Math.max(0, hIdx - 29), hIdx + 1)
    .filter(r => (r || 0) < 2).length;

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
    maxDayRain14d: parseFloat(maxDayRain14d.toFixed(1)),
    apiRain: hist.apiRain?.[hIdx] ?? rain10d,  // затухающий индекс, fallback на rain10d
    tMax: hist.tMax?.[hIdx] ?? ((hist.tMin[hIdx] ?? 0) + 8), // fallback if tMax absent
    tMin: hist.tMin[hIdx],
    rainToday: hist.rain[hIdx],
    date: hist.dates[hIdx],
    frostInLast7Days,
    frostCount,
    dryDaysIn30,
    coldShockDelta
  };
}

// ======================================================
// Wave Freshness Index (WFI) — волновой жизненный цикл
// ======================================================
// Trigg-based state machine: ТВП-триггер (дождь+похолодание) запускает волну.
// Фазы для отображаемого дня, waveAge = days from trigger to displayDate:
//   [0, lag)                → 0.35 инкубация (примордии формируются)
//   [lag, lag+act)          → 1.0  активный выход новых тел
//   [lag+act, lag+act+dec)  → 1.0→0.25 затухание (переростки)
//   [lag+act+dec, ∞)        → 0.2  рефрактерный (мицелий восстанавливается)
// Если ТВП не обнаружен: CONFIG.wave.noTriggerWFI (умеренная неопределённость)
// WFI применяется как финальный множитель в projectSpeciesScores после scoreFn.

function daysBetween(d1, d2) {
  return Math.round(
    (new Date(d2 + 'T12:00:00') - new Date(d1 + 'T12:00:00')) / 86400000
  );
}

/**
 * Scan hist for ТВП events: rain5d ≥ tpvRainMin AND temp drop ≥ tpvDeltaTMin.
 * deltaT = prevAvg(5d before window) − currAvg(5d window ending at i).
 * Returns [{date, rain5d, deltaT}], deduped within 3 days.
 */
export function detectTPVEvents(hist) {
  if (!hist?.dates?.length) return [];
  const W = CONFIG.wave;
  const n = hist.dates.length;
  const events = [];

  // Pre-compute daily mean temperatures (optional: requires tMax+tMin)
  const hasTmp = hist.tMax && hist.tMin && hist.tMax.length === n;
  const tMean = hasTmp
    ? hist.tMax.map((mx, j) => (mx + (hist.tMin[j] ?? mx)) / 2)
    : null;

  for (let i = 9; i < n; i++) {
    // Rain sum over 5 days [i-4..i]
    const rain5d = (hist.rain || [])
      .slice(i - 4, i + 1)
      .reduce((a, b) => a + (b || 0), 0);
    if (rain5d < W.tpvRainMin) continue;

    // Temperature drop check (skip if no temp data)
    if (tMean) {
      const prevSlice = tMean.slice(i - 9, i - 4); // 5 days before
      const currSlice = tMean.slice(i - 4, i + 1); // current 5 days
      if (!prevSlice.length || !currSlice.length) continue;
      const prevAvg = prevSlice.reduce((a, b) => a + b, 0) / prevSlice.length;
      const currAvg = currSlice.reduce((a, b) => a + b, 0) / currSlice.length;
      if (prevAvg - currAvg < W.tpvDeltaTMin) continue;

      const date = hist.dates[i];
      // Deduplicate: skip if within 3 days of previous event
      if (events.length && daysBetween(events[events.length - 1].date, date) <= 3) continue;
      events.push({
        date,
        rain5d: +rain5d.toFixed(1),
        deltaT: +(prevAvg - currAvg).toFixed(1)
      });
    }
  }
  return events;
}

/**
 * Filter triggers: block any trigger that falls within the refractory window
 * of a previous valid trigger.
 * minGap = lagDays + activeDays + decayDays + floor(refractoryDays/2)
 */
function filterValidTriggers(rawTriggers, lagDays) {
  if (!rawTriggers?.length) return [];
  const W = CONFIG.wave;
  const minGap = lagDays + W.activeDays + W.decayDays + Math.floor(W.refractoryDays / 2);
  const sorted = [...rawTriggers].sort((a, b) => a.date.localeCompare(b.date));
  const valid = [];
  for (const t of sorted) {
    if (!valid.length || daysBetween(valid[valid.length - 1].date, t.date) >= minGap) {
      valid.push(t);
    }
  }
  return valid;
}

/**
 * WFI (0–1) for a single wave of waveAge days since its trigger date.
 * waveAge = daysBetween(triggerDate, displayDate)
 */
function waveWFI(waveAge, lagDays) {
  const W = CONFIG.wave;
  if (waveAge < 0) return 0;
  if (waveAge < lagDays) return 0.35;                      // underground incubation
  const activeEnd = lagDays + W.activeDays;
  const decayEnd  = activeEnd + W.decayDays;
  if (waveAge < activeEnd) return 1.0;                     // active emergence
  if (waveAge < decayEnd) {
    const ratio = (waveAge - activeEnd) / W.decayDays;
    return +(1.0 - ratio * 0.75).toFixed(3);               // linear 1.0 → 0.25
  }
  return 0.2;                                              // refractory / spent
}

/**
 * Compute WFI for a display date given detected ТВП triggers and lagDays.
 * Returns the best (highest) WFI from all valid triggers for this lagDays.
 * Falls back to noTriggerFallback (species-specific or CONFIG.wave.noTriggerWFI).
 */
export function computeWFI(allTriggers, displayDate, lagDays, noTriggerFallback = null) {
  const W = CONFIG.wave;
  const fallback = noTriggerFallback ?? W.noTriggerWFI;
  if (!allTriggers?.length || !displayDate) return fallback;

  const valid = filterValidTriggers(allTriggers, lagDays);
  if (!valid.length) return fallback;

  let best = -1;
  for (const t of valid) {
    const age = daysBetween(t.date, displayDate);
    if (age < 0) continue;  // trigger is in the future of displayDate
    const wfi = waveWFI(age, lagDays);
    if (wfi > best) best = wfi;
  }
  return best >= 0 ? best : fallback;
}

/**
 * Like computeWFI but returns detailed wave phase info for UI display.
 * Returns { wfi, phase, label, dayInPhase, totalDays, triggerDate }
 * Phases: 'incubation' | 'active' | 'decay' | 'refractory' | 'unknown'
 */
export function computeWFIDetail(allTriggers, displayDate, lagDays, noTriggerFallback = null) {
  const W = CONFIG.wave;
  const fallback = noTriggerFallback ?? W.noTriggerWFI;
  const noTrigger = { wfi: fallback, phase: 'unknown', label: '? нет данных о волне', dayInPhase: null, totalDays: null, triggerDate: null };

  if (!allTriggers?.length || !displayDate) return noTrigger;
  const valid = filterValidTriggers(allTriggers, lagDays);
  if (!valid.length) return noTrigger;

  let best = -1, bestTrigger = null;
  for (const t of valid) {
    const age = daysBetween(t.date, displayDate);
    if (age < 0) continue;
    const wfi = waveWFI(age, lagDays);
    if (wfi > best) { best = wfi; bestTrigger = { ...t, age }; }
  }
  if (best < 0 || !bestTrigger) return noTrigger;

  const age = bestTrigger.age;
  const activeEnd = lagDays + W.activeDays;
  const decayEnd  = activeEnd + W.decayDays;

  let phase, label, dayInPhase, totalDays;
  if (age < lagDays) {
    phase = 'incubation'; label = '🌱 инкубация';
    dayInPhase = age + 1; totalDays = lagDays;
  } else if (age < activeEnd) {
    phase = 'active'; label = '✨ волна активна';
    dayInPhase = age - lagDays + 1; totalDays = W.activeDays;
  } else if (age < decayEnd) {
    phase = 'decay'; label = '🍂 затухание';
    dayInPhase = age - activeEnd + 1; totalDays = W.decayDays;
  } else {
    phase = 'refractory'; label = '💤 отдых мицелия';
    dayInPhase = age - decayEnd + 1; totalDays = W.refractoryDays;
  }
  return { wfi: best, phase, label, dayInPhase, totalDays, triggerDate: bestTrigger.date };
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
 * tpvTriggers: pass pre-detected ТВП triggers array to reuse across calls.
 *   undefined → auto-detect from hist (default, convenient)
 *   null      → disable WFI entirely (testing/debug)
 *   []|[...]  → use provided list
 *
 * WFI is applied as final multiplier AFTER scoreFn (works with any scoreFn).
 *
 * Returns array sorted by score desc.
 */
export function projectSpeciesScores(hist, fc, idx, speciesList, scoreFn = scoreFromConditions, tpvTriggers = undefined) {
  if (!hist || !fc || !speciesList?.length) return [];

  // Detect ТВП triggers once for this hist (shared across all species in this call)
  const triggers = tpvTriggers !== undefined ? tpvTriggers : detectTPVEvents(hist);
  const displayDate = fc.dates?.[idx] || null;

  return speciesList.map(sp => {
    const cfg = CONFIG.speciesConfig?.[sp];
    const lag  = cfg?.lagDays ?? 7;
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
        frostCount: base.frostCount,
        dryDaysIn30: base.dryDaysIn30,
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

    const rawScore = scoreFn(conditions, sp);

    // WFI: финальный множитель волнового жизненного цикла
    // triggers = null → WFI отключён; triggers = [] → fallback
    // Используем species-specific noTriggerWFI если задан (напр. лисичка = 0.90)
    const spNoTrigger = cfg?.noTriggerWFI ?? null;
    const wfiDetail = (triggers !== null && displayDate)
      ? computeWFIDetail(triggers, displayDate, lag, spNoTrigger)
      : null;
    const wfi = wfiDetail ? wfiDetail.wfi : null;
    const score = wfi !== null
      ? Math.max(0, Math.min(100, Math.round(rawScore * wfi)))
      : rawScore;

    return {
      species: sp,
      emoji: cfg?.emoji || '🍄',
      score,
      wfi: wfi ?? 1,          // для UI: фаза волны (1.0=активна, 0.2=рефрактерная)
      waveDetail: wfiDetail,  // детали фазы волны для UI
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

/**
 * Check if mushroom season is effectively closed.
 * Returns { level: 'open'|'closing'|'closed', reason: string|null }
 *
 * closed:  soilT < 2°C (mycelium dormant) OR 5+ frost nights in 10 days
 * closing: 3–4 frost nights in 10 days (tubulars done, armillaria peak)
 * open:    normal season
 *
 * References: Boddy 2014; Büntgen 2015 (repeated night frosts stop tubular fruiting);
 * soilT < 2°C = mycelium metabolic arrest threshold (Salerni 2023).
 */
export function checkSeasonClosed(soilT, frostCount) {
  if (soilT != null && soilT < 2) {
    return { level: 'closed', reason: `почва ${soilT.toFixed(1)}°C — мицелий спит до весны` };
  }
  if (frostCount != null && frostCount >= 5) {
    return { level: 'closed', reason: `${frostCount} морозных ночей за 10 дней — трубчатые закрыли сезон` };
  }
  if (frostCount != null && frostCount >= 3) {
    return { level: 'closing', reason: `${frostCount} морозных ночи за 10 дней — конец трубчатых, опёнок ещё идёт` };
  }
  return { level: 'open', reason: null };
}
