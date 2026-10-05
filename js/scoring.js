// Scoring algorithm — shared between client and GitHub Actions digest
import { CONFIG } from './config.js';

const S = CONFIG.scoring;

/**
 * Compute score (0-100) for a given set of conditions.
 * Conditions: { soilT, soilM, rain10d, tMax, tMin, rainToday? }
 */
export function scoreFromConditions(c) {
  if (!c) return null;
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

  return Math.max(0, Math.min(100, score));
}

export function statusFromScore(score) {
  if (score >= S.threshold.green) return 'green';
  if (score >= S.threshold.yellow) return 'yellow';
  return 'red';
}

/**
 * Project forward from historical weather to compute forecast-day score.
 * @param {Object} hist - { rain:[], soilM:[], soilT:[] }
 * @param {Object} fc - { tMax:[], tMin:[], rain:[] }
 * @param {Number} idx - forecast day index
 */
export function projectDayScore(hist, fc, idx) {
  if (!hist || !fc) return null;

  const tMax = fc.tMax[idx];
  const tMin = fc.tMin[idx];

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

  const score = scoreFromConditions({ soilT: st, soilM: sm, rain10d, tMax, tMin, rainToday: fc.rain[idx] });
  return {
    score,
    status: statusFromScore(score),
    soilM: parseFloat(sm.toFixed(3)),
    soilT: parseFloat(st.toFixed(1)),
    rain10d: parseFloat(rain10d.toFixed(1))
  };
}
