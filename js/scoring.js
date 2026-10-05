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

  return Math.max(0, Math.min(100, score));
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

  // Project soil moisture: start from last known, each day = +rain*0.004 - 1.4mm ET
  let sm = hist.soilM[hist.soilM.length - 1];
  for (let i = 0; i <= idx; i++) {
    sm = Math.max(0.15, Math.min(0.45, sm + (fc.rain[i] - 1.4) * 0.004));
  }

  // Project soil temp: lag 3-5 days behind air mean
  let st = hist.soilT[hist.soilT.length - 1];
  for (let i = 0; i <= idx; i++) {
    const tMean = (fc.tMax[i] + fc.tMin[i]) / 2;
    st = st + (tMean - st) * 0.12;
  }

  // Frost in last 7 days: check hist tMin tail + forecast up to today
  const recentTMin = [
    ...(hist.tMin ? hist.tMin.slice(-7) : []),
    ...(fc.tMin ? fc.tMin.slice(0, idx + 1) : [])
  ].slice(-7);
  const frostInLast7Days = recentTMin.some(t => t < 0);

  const conditions = {
    soilT: parseFloat(st.toFixed(1)),
    soilM: parseFloat(sm.toFixed(3)),
    rain10d: parseFloat(rain10d.toFixed(1)),
    tMax,
    tMin,
    rainToday: fc.rain[idx],
    date,
    frostInLast7Days
  };

  const score = scoreFromConditions(conditions, speciesKey);
  return {
    score,
    status: statusFromScore(score),
    soilM: conditions.soilM,
    soilT: conditions.soilT,
    rain10d: conditions.rain10d,
    frostInLast7Days
  };
}

/**
 * Project scores for a list of species on a given forecast day.
 * Returns array sorted by score desc.
 */
export function projectSpeciesScores(hist, fc, idx, speciesList) {
  if (!hist || !fc || !speciesList?.length) return [];
  // Build shared conditions once
  const base = projectDayScore(hist, fc, idx, null);
  if (!base) return [];

  const date = fc.dates?.[idx] || null;
  const tMax = fc.tMax[idx];
  const tMin = fc.tMin[idx];
  const conditions = {
    soilT: base.soilT,
    soilM: base.soilM,
    rain10d: base.rain10d,
    tMax,
    tMin,
    rainToday: fc.rain[idx],
    date,
    frostInLast7Days: base.frostInLast7Days
  };

  return scoreSpeciesList(conditions, speciesList);
}
