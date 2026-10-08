// Main application — rendering + event handlers
import { CONFIG } from './config.js';
import { requireAuth, logout } from './auth.js';
import { loadLocal, saveAndSync, pullAndMerge } from './storage.js';
import { getSettings, saveSettings, createGist, pullGist } from './gist.js';
import { fetchWeather, fetchHistoricalConditions, fetchTriggerWindow } from './weather.js';
import { fetchBiotope } from './osm.js';
import { fetchForestTrees, fetchMushroomObservations } from './inat.js';
import { scoreFromConditions, statusFromScore, projectDayScore, scoreSpeciesList, projectSpeciesScores } from './scoring.js';
import { scoreFromConditionsMDI } from './scoring-mdi.js';

let state = null;
let chartInstance = null;       // combined chart (rain / soilM / soilT / score)
let radarChartInstance = null;
let forecastDays = []; // cached for modal access on card click
let forecastView = 'cards'; // 'cards' | 'calendar'
let scoringMode = 'classic'; // 'classic' | 'mdi'

/** Вернуть активную scoring-функцию по текущему режиму. */
function getScoreFn() {
  return scoringMode === 'mdi' ? scoreFromConditionsMDI : scoreFromConditions;
}

/**
 * Given a day's trip date and a trigger window (fetchTriggerWindow result),
 * compute triggerConditions per species: conditions on the day that triggered
 * the mushroom crop (tripDate - lagDays).
 */
function computeTriggerConditions(day, triggerWindow) {
  const species = day.species || [];
  const result = {};
  for (const sp of species) {
    const cfg = CONFIG.speciesConfig?.[sp];
    if (!cfg) continue;
    const lag = cfg.lagDays ?? 7;
    const tripDate = new Date(day.date + 'T12:00:00');
    tripDate.setDate(tripDate.getDate() - lag);
    const triggerDate = tripDate.toISOString().slice(0, 10);
    const cond = triggerWindow[triggerDate];
    if (cond) result[sp] = { ...cond, triggerDate };
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Current-wave health score: soilM + soilT + temperature, NO rain gate.
 * Rain gate belongs in the trigger (was there enough rain to START a wave?).
 * This measures whether an already-running wave is still in good shape.
 * Max raw = 75 pts (25+25+15+10), scaled to 0–100.
 */
function quickHealthScore(soilM, soilT, tMax, tMin, frostInLast7Days, speciesKey) {
  if (scoringMode === 'mdi') {
    // MDI health: передаём нейтральные дождь (25мм, всегда в норме) и дату null
    // Это отражает "насколько хорошо волне прямо сейчас" без сезонного фактора
    const c = { soilT, soilM, rain10d: 25, date: null, frostInLast7Days };
    const raw = scoreFromConditionsMDI(c, speciesKey);
    return raw !== null ? raw : 50;
  }
  // Классический вариант
  const S = (speciesKey && CONFIG.speciesConfig?.[speciesKey]?.scoring)
    ? CONFIG.speciesConfig[speciesKey].scoring
    : CONFIG.scoring;
  let s = 0;
  if (soilT >= S.soilT.ok[0]   && soilT <= S.soilT.ok[1])   s += 25;
  else if (soilT >= S.soilT.fair[0] && soilT <= S.soilT.fair[1]) s += 12;
  if (soilM >= S.soilM.ok[0]   && soilM <= S.soilM.ok[1])   s += 25;
  else if (soilM >= S.soilM.fair[0] && soilM <= S.soilM.fair[1]) s += 12;
  if (tMax >= S.tMax.ok[0]     && tMax <= S.tMax.ok[1])     s += 15;
  else if (tMax >= S.tMax.fair[0] && tMax <= S.tMax.fair[1]) s += 7;
  if (tMin > S.tMin.ok)   s += 10;
  else if (tMin > S.tMin.fair) s += 5;
  if (frostInLast7Days) s = Math.round(s * 0.6); // frost stresses ongoing wave
  return Math.min(100, Math.round(s * (100 / 75)));
}

/**
 * Generate a contextual hint for a forecast day explaining WHY it has the score it does.
 * triggerScore = how good were conditions lagDays ago (biological wave trigger)
 * currentScore = how good are conditions right now (wave freshness / current state)
 * The final score is √(trigger × current) — both matter.
 */
/**
 * Волна-таймер: сколько дней прошло с последнего продуктивного дождя (≥5мм),
 * и через сколько дней ожидать волну для каждого вида локации.
 */
function renderWaveTimer(hist, loc) {
  const el = document.getElementById('waveTimer');
  if (!el || !hist?.rain?.length || !loc?.species?.length) {
    if (el) el.style.display = 'none';
    return;
  }

  // Найти последний день с дождём ≥5мм в истории
  const RAIN_THRESHOLD = 5;
  let daysSince = null;
  for (let i = hist.rain.length - 1; i >= 0; i--) {
    if ((hist.rain[i] || 0) >= RAIN_THRESHOLD) {
      daysSince = hist.rain.length - 1 - i;
      break;
    }
  }

  if (daysSince === null) {
    el.style.display = 'none';
    return;
  }

  const species = loc.species.filter(sp => CONFIG.speciesConfig?.[sp]);
  if (!species.length) { el.style.display = 'none'; return; }

  const rows = species.map(sp => {
    const lag = CONFIG.speciesConfig[sp].lagDays ?? 7;
    const daysToWave = lag - daysSince;
    let label, cls;
    if (daysToWave <= 0) {
      label = 'волна сейчас';
      cls = 'wt-now';
    } else if (daysToWave <= 3) {
      label = `через ${daysToWave} дн`;
      cls = 'wt-soon';
    } else {
      label = `через ${daysToWave} дн`;
      cls = 'wt-wait';
    }
    return `<div class="wt-row">
      <span class="wt-species">${sp}</span>
      <span class="wt-label ${cls}">${label}</span>
      <span class="wt-lag">лаг ${lag} дн</span>
    </div>`;
  }).join('');

  const rainDate = hist.dates?.[hist.dates.length - 1 - daysSince] || '';
  const rainDateStr = rainDate ? new Date(rainDate).toLocaleDateString('ru', { day: 'numeric', month: 'short' }) : '';

  el.style.display = '';
  el.innerHTML = `
    <div class="wt-header">
      <span class="wt-title">Волна-таймер</span>
      <span class="wt-since">дождь ≥5мм: <strong>${daysSince === 0 ? 'сегодня' : daysSince + ' дн назад'}</strong>${rainDateStr ? ` (${rainDateStr})` : ''}</span>
    </div>
    <div class="wt-rows">${rows}</div>
  `;
}

function buildForecastHint(triggerScore, healthScore, speciesName, lag) {
  const tS = statusFromScore(triggerScore);
  const hS = statusFromScore(healthScore);
  const em = { green: '🟢', yellow: '🟡', red: '🔴' };
  const header = `${em[tS]} Триггер (дождь ~${lag} дн назад): <b>${triggerScore}</b> &nbsp;·&nbsp; ${em[hS]} Здоровье волны: <b>${healthScore}</b>`;
  let body;
  if (tS === 'green' && hS === 'green') {
    body = `Дождь был когда нужно, почва и тепло — в норме. ${speciesName} на пике.`;
  } else if (tS === 'green' && hS === 'yellow') {
    body = `Волна ${speciesName} в разгаре, условия пограничные (почва или тепло чуть ниже нормы). Грибы будут.`;
  } else if (tS === 'green' && hS === 'red') {
    body = `Волна ${speciesName} была запущена, но сейчас почва пересохла или мороз — волна на спаде. Грибы ещё возможны.`;
  } else if (tS === 'yellow' && (hS === 'green' || hS === 'yellow')) {
    body = `Условия неплохие, но триггер был слабым (~${lag} дн назад мало дождей). Слабая волна ${speciesName}.`;
  } else if (tS === 'red' && (hS === 'green' || hS === 'yellow')) {
    body = `Почва и тепло в норме, но триггера не было (~${lag} дн назад без дождей) — ждём осадков для волны ${speciesName}.`;
  } else {
    body = `Слабый триггер и неблагоприятные условия. Пока не стоит.`;
  }
  return `${header}<br><span style="color:#6B5F52">${body}</span>`;
}

// =========================
// INIT
// =========================
async function init() {
  await requireAuth();
  initThemeToggle();
  state = loadLocal();
  state = await pullAndMerge(state);
  attachEventHandlers();
  renderAll();
  await refreshWeatherIfStale();
}

async function refreshWeatherIfStale() {
  const today = new Date().toISOString().slice(0, 10);
  const stale = Object.entries(state.weather).some(([_, w]) => w?.asOf !== today);
  const missing = state.locations.some(l => !state.weather[l.id]);
  if (stale || missing) {
    await syncAllWeather();
  }
}

// =========================
// Sync operations
// =========================
async function syncAllWeather() {
  showToast('Загружаю свежую погоду…');
  for (const loc of state.locations) {
    try {
      const w = await fetchWeather(loc.lat, loc.lon);
      state.weather[loc.id] = w;
      if (!loc.elevation && w.elevation) loc.elevation = Math.round(w.elevation);
    } catch (e) { console.warn('weather fail', loc.name, e); }
  }
  saveAndSync(state);
  renderDashboard();
  showToast('Погода обновлена');
}

async function syncBiotope(locId) {
  const loc = state.locations.find(l => l.id === locId);
  if (!loc) return;
  showToast(`Подтягиваю биотоп для «${loc.name}»…`);
  try {
    const b = await fetchBiotope(loc.lat, loc.lon);
    Object.assign(loc, b);
    saveAndSync(state);
    renderLocations();
    showToast('Биотоп подтянут из OSM');
  } catch (e) {
    showToast('Не удалось: ' + e.message);
  }
}

async function syncForestType(locId) {
  const loc = state.locations.find(l => l.id === locId);
  if (!loc) return;
  showToast(`Загружаю деревья для «${loc.name}»…`);
  try {
    const trees = await fetchForestTrees(loc.lat, loc.lon, 5);
    loc.forestTrees = trees;
    loc.forestTreesSyncedAt = new Date().toISOString().slice(0, 10);
    saveAndSync(state);
    renderLocations();
    showToast(`Найдено ${trees.length} видов деревьев`);
  } catch (e) {
    showToast('Не удалось загрузить iNat: ' + e.message);
  }
}

async function syncHistoricalForDay(dayId) {
  const day = state.mushroomDays.find(d => d.id === dayId);
  if (!day) return;
  const loc = state.locations.find(l => l.id === day.locationId);
  if (!loc) return;
  showToast('Подтягиваю условия…');
  try {
    const [c, triggerWindow] = await Promise.all([
      fetchHistoricalConditions(loc.lat, loc.lon, day.date),
      fetchTriggerWindow(loc.lat, loc.lon, day.date)
    ]);
    if (c) {
      day.conditions = c;
      const trigger = computeTriggerConditions(day, triggerWindow);
      if (trigger) day.triggerConditions = trigger;
      saveAndSync(state);
      renderDays();
      renderPatterns();
      showToast('Условия подтянуты');
    } else {
      showToast('Условия не найдены');
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message);
  }
}

async function syncAllHistorical() {
  // Process days that lack conditions OR have conditions but no triggerConditions yet
  const needsConditions = state.mushroomDays.filter(d => !d.conditions);
  const needsTrigger = state.mushroomDays.filter(
    d => d.conditions && !d.triggerConditions && d.species?.length
  );
  const needs = [...needsConditions, ...needsTrigger];
  if (needs.length === 0) { showToast('Все дни уже с условиями'); return; }
  showToast(`Загружаю условия для ${needs.length} ${needs.length === 1 ? 'дня' : 'дней'}…`);
  for (const d of needs) {
    const loc = state.locations.find(l => l.id === d.locationId);
    if (!loc) continue;
    try {
      const [c, triggerWindow] = await Promise.all([
        d.conditions ? Promise.resolve(null) : fetchHistoricalConditions(loc.lat, loc.lon, d.date),
        fetchTriggerWindow(loc.lat, loc.lon, d.date)
      ]);
      if (c) d.conditions = c;
      const trigger = computeTriggerConditions(d, triggerWindow);
      if (trigger) d.triggerConditions = trigger;
      await new Promise(r => setTimeout(r, 200));
    } catch (e) { console.warn(e); }
  }
  saveAndSync(state);
  renderDays();
  renderPatterns();
  showToast('Готово');
}

// =========================
// Species utilities
// =========================
function allSpecies() { return [...CONFIG.defaultSpecies, ...(state.customSpecies || [])]; }

function speciesCheckboxesHtml(containerId, selected = []) {
  const chips = allSpecies().map(s => {
    const isCustom = (state.customSpecies || []).includes(s);
    const safe = s.replace(/"/g, '&quot;');
    const safeJs = s.replace(/'/g, "\\'");
    return `<label class="${selected.includes(s) ? 'checked' : ''}" data-species="${safe}">
      <input type="checkbox" value="${safe}" ${selected.includes(s) ? 'checked' : ''}>${s}
      ${isCustom ? `<span class="remove-custom" onclick="event.stopPropagation(); window.app.removeCustomSpecies('${safeJs}', '${containerId}');">×</span>` : ''}
    </label>`;
  }).join('');
  const addInline = `<span class="add-species-inline">
    <input type="text" id="${containerId}-newspecies" placeholder="+ свой вид" maxlength="40">
    <button type="button" class="btn sm" onclick="window.app.addCustomSpeciesFromInput('${containerId}')">Добавить</button>
  </span>`;
  return chips + addInline;
}

function wireSpeciesCheckboxes(containerId) {
  document.querySelectorAll(`#${containerId} > label`).forEach(lab => {
    if (lab.dataset.wired) return;
    lab.dataset.wired = '1';
    lab.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-custom')) return;
      e.preventDefault(); // prevent label from double-toggling the hidden checkbox
      const cb = lab.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      lab.classList.toggle('checked', cb.checked);
    });
  });
  const newInput = document.getElementById(`${containerId}-newspecies`);
  if (newInput) {
    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCustomSpeciesFromInput(containerId); }
    });
  }
}

function addCustomSpeciesFromInput(containerId) {
  const inp = document.getElementById(`${containerId}-newspecies`);
  if (!inp) return;
  const raw = (inp.value || '').trim().toLowerCase();
  if (!raw) return;
  if (allSpecies().includes(raw)) { showToast(`«${raw}» уже в списке`); inp.value = ''; return; }
  state.customSpecies = state.customSpecies || [];
  state.customSpecies.push(raw);
  saveAndSync(state);
  const selected = Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)).map(x => x.value);
  selected.push(raw);
  document.getElementById(containerId).innerHTML = speciesCheckboxesHtml(containerId, selected);
  wireSpeciesCheckboxes(containerId);
  showToast(`Добавлено: «${raw}»`);
}

function removeCustomSpecies(name, containerId) {
  if (!confirm(`Удалить «${name}» из вашего списка?`)) return;
  state.customSpecies = (state.customSpecies || []).filter(s => s !== name);
  saveAndSync(state);
  const selected = Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)).map(x => x.value).filter(x => x !== name);
  document.getElementById(containerId).innerHTML = speciesCheckboxesHtml(containerId, selected);
  wireSpeciesCheckboxes(containerId);
  showToast(`Удалено: «${name}»`);
}

// =========================
// Radar chart helpers
// =========================

/** Оценка одного фактора (0–100): 100=ok, 55=fair, 15=за пределами */
function factorScore(val, ok, fair) {
  if (val == null) return 0;
  if (val >= ok[0] && val <= ok[1]) return 100;
  if (val >= fair[0] && val <= fair[1]) return 55;
  return 15;
}
function tMinFactorScore(val, okMin, fairMin) {
  if (val == null) return 0;
  if (val >= okMin) return 100;
  if (val >= fairMin) return 55;
  return 15;
}

/** Per-factor radar array [rain10d, soilM, soilT, tMax, tMin] (0–100 each) */
function conditionsToRadar(c, speciesKey) {
  const S = (speciesKey && CONFIG.speciesConfig?.[speciesKey]?.scoring) ? CONFIG.speciesConfig[speciesKey].scoring : CONFIG.scoring;
  return [
    factorScore(c.rain10d, S.rain10d.ok, S.rain10d.fair),
    factorScore(c.soilM,   S.soilM.ok,   S.soilM.fair),
    factorScore(c.soilT,   S.soilT.ok,   S.soilT.fair),
    factorScore(c.tMax,    S.tMax.ok,     S.tMax.fair),
    tMinFactorScore(c.tMin, S.tMin.ok, S.tMin.fair)
  ];
}

/** Средние условия из лучших дней (many/jackpot) для указанного вида или всех */
function getPersonalIdeal(speciesKey) {
  const best = state.mushroomDays.filter(d =>
    d.conditions &&
    (d.quantity === 'many' || d.quantity === 'jackpot') &&
    (!speciesKey || (d.species || []).includes(speciesKey))
  );
  if (best.length === 0) return null;
  const avg = k => best.reduce((s, d) => s + (d.conditions[k] || 0), 0) / best.length;
  return {
    rain10d: parseFloat(avg('rain10d').toFixed(1)),
    soilM:   parseFloat(avg('soilM').toFixed(3)),
    soilT:   parseFloat(avg('soilT').toFixed(1)),
    tMax:    parseFloat(avg('tMax').toFixed(1)),
    tMin:    parseFloat(avg('tMin').toFixed(1)),
    count: best.length
  };
}

/** Центр ok-диапазонов — теоретический идеал */
function getModelIdeal(speciesKey) {
  const S = (speciesKey && CONFIG.speciesConfig?.[speciesKey]?.scoring) ? CONFIG.speciesConfig[speciesKey].scoring : CONFIG.scoring;
  return {
    rain10d: (S.rain10d.ok[0] + S.rain10d.ok[1]) / 2,
    soilM:   (S.soilM.ok[0]   + S.soilM.ok[1])   / 2,
    soilT:   (S.soilT.ok[0]   + S.soilT.ok[1])   / 2,
    tMax:    (S.tMax.ok[0]    + S.tMax.ok[1])     / 2,
    tMin:    S.tMin.ok + 3
  };
}

function renderRadarChart(w, loc) {
  const radarSection = document.getElementById('radarSection');
  if (!w || !radarSection) return;

  const speciesKey = loc.species?.[0] || null; // первый вид локации как основной

  // Сегодняшние условия из прогноза
  const today = {
    rain10d: projectDayScore(w.hist, w.fc, 0)?.rain10d,
    soilM:   projectDayScore(w.hist, w.fc, 0)?.soilM,
    soilT:   projectDayScore(w.hist, w.fc, 0)?.soilT,
    tMax:    w.fc.tMax[0],
    tMin:    w.fc.tMin[0]
  };

  const personalIdeal = getPersonalIdeal(speciesKey);
  const modelIdeal = getModelIdeal(speciesKey);

  const labels = ['Σ дождя\n10 дн', 'Влажн.\nпочвы', 'Т почвы', 'Т воздуха\nдень', 'Ночная\nтемп.'];
  const todayData    = conditionsToRadar(today,       speciesKey);
  const modelData    = conditionsToRadar(modelIdeal,  speciesKey);
  const datasets = [
    {
      label: 'Модельный идеал',
      data: modelData,
      borderColor: 'rgba(180,84,65,0.5)',
      backgroundColor: 'rgba(180,84,65,0.07)',
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 3,
      pointBackgroundColor: 'rgba(180,84,65,0.5)'
    },
    {
      label: 'Сегодня',
      data: todayData,
      borderColor: '#4A7C3A',
      backgroundColor: 'rgba(74,124,58,0.12)',
      borderWidth: 2.5,
      pointRadius: 4,
      pointBackgroundColor: '#4A7C3A'
    }
  ];

  let metaHtml = `<div class="radar-meta-card">`;
  if (personalIdeal) {
    datasets.splice(1, 0, {
      label: `Мой лучший день`,
      data: conditionsToRadar(personalIdeal, speciesKey),
      borderColor: '#D29A3C',
      backgroundColor: 'rgba(210,154,60,0.10)',
      borderWidth: 2,
      borderDash: [3, 2],
      pointRadius: 3,
      pointBackgroundColor: '#D29A3C'
    });
    metaHtml += `<h4>Мой лучший день (${personalIdeal.count} пох.)</h4>
      <div class="radar-personal-item"><span>Σ дождя</span><span><b>${personalIdeal.rain10d} мм</b></span></div>
      <div class="radar-personal-item"><span>Влажн. почвы</span><span><b>${personalIdeal.soilM}</b></span></div>
      <div class="radar-personal-item"><span>Т почвы</span><span><b>${personalIdeal.soilT} °C</b></span></div>
      <div class="radar-personal-item"><span>Т воздуха</span><span><b>${personalIdeal.tMax} °C</b></span></div>
      <div class="radar-personal-item"><span>Ночная Т</span><span><b>${personalIdeal.tMin} °C</b></span></div>`;
  } else {
    metaHtml += `<h4>Персональный идеал</h4>
      <p style="font-size:12px;color:#8A7C6B;margin:0">Добавь несколько удачных дней (много/джекпот) — появится твой личный идеал.</p>`;
  }
  metaHtml += `<div style="margin-top:12px;border-top:1px solid #F2EBDA;padding-top:10px">`;
  datasets.forEach(ds => {
    const dash = ds.borderDash ? 'border-top: 2px dashed' : 'border-top: 2.5px solid';
    metaHtml += `<div class="radar-legend-row">
      <span style="display:inline-block;width:22px;height:0;${dash} ${ds.borderColor};flex-shrink:0"></span>
      <span>${ds.label}</span>
    </div>`;
  });
  metaHtml += `</div></div>`;

  document.getElementById('radarMeta').innerHTML = metaHtml;

  if (radarChartInstance) radarChartInstance.destroy();
  const ctx = document.getElementById('radarChart').getContext('2d');
  radarChartInstance = new Chart(ctx, {
    type: 'radar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 25, font: { size: 10 }, color: '#8A7C6B', backdropColor: 'transparent' },
          grid: { color: '#E6DECC' },
          angleLines: { color: '#E6DECC' },
          pointLabels: { font: { size: 11 }, color: '#4A3F35' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}%`
          }
        }
      }
    }
  });

  radarSection.style.display = '';
}

// =========================
// Pattern forecast
// =========================

/**
 * Compute % similarity between reference day conditions and a forecast day.
 * Each parameter compared within a reasonable range; weighted sum → 0–100.
 */
function patternMatch(ref, fc) {
  const params = [
    { r: ref.rain10d, f: fc.rain10d, range: 40,   w: 0.30 },
    { r: ref.soilM,   f: fc.soilM,   range: 0.18, w: 0.25 },
    { r: ref.soilT,   f: fc.soilT,   range: 10,   w: 0.25 },
    { r: ref.tMax,    f: fc.tMax,    range: 12,   w: 0.12 },
    { r: ref.tMin,    f: fc.tMin,    range: 8,    w: 0.08 },
  ];
  const score = params.reduce((sum, p) => {
    if (p.r == null || p.f == null) return sum + p.w * 50;
    const sim = Math.max(0, 1 - Math.abs(p.r - p.f) / p.range);
    return sum + sim * p.w;
  }, 0);
  return Math.round(score * 100);
}

/** Render pattern-forecast block below the main forecast grid */
function renderPatternForecast(w) {
  const wrap = document.getElementById('patternForecastWrap');
  if (!wrap) return;

  // Days with conditions (reference pool)
  const daysWithCond = state.mushroomDays.filter(d => d.conditions);
  if (daysWithCond.length === 0) {
    wrap.innerHTML = `<div style="font-size:13px;color:#8A7C6B;padding:10px 0">
      Добавьте грибные дни и подтяните для них условия — появится сравнение с прогнозом.</div>`;
    return;
  }

  const selectedId = wrap.dataset.selectedId || daysWithCond[0]?.id;
  const refDay = daysWithCond.find(d => d.id === selectedId) || daysWithCond[0];
  const refCond = refDay.conditions;
  const refLoc  = state.locations.find(l => l.id === refDay.locationId);

  const selectHtml = `<select id="patternRefSelect" onchange="window.app.setPatternRef(this.value)" style="font-size:13px;max-width:100%">
    ${daysWithCond.map(d => {
      const loc = state.locations.find(l => l.id === d.locationId);
      const dt  = new Date(d.date);
      const dstr= `${dt.getDate()}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
      const qLabels = { little:'мало', some:'средне', many:'много', jackpot:'джекпот', none:'пусто' };
      const specStr = (d.species||[]).slice(0,2).join(', ');
      return `<option value="${d.id}" ${d.id === refDay.id ? 'selected' : ''}>${dstr} · ${loc?.name||'?'} · ${qLabels[d.quantity]||d.quantity}${specStr ? ` · ${specStr}` : ''}</option>`;
    }).join('')}
  </select>`;

  const weekdays = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
  const fcCards = w.fc.dates.map((dateStr, i) => {
    const fcDay = forecastDays[i];
    if (!fcDay) return '';
    const dt = new Date(dateStr);
    const fcCond = { rain10d: fcDay.rain10d, soilM: fcDay.soilM, soilT: fcDay.soilT,
                     tMax: w.fc.tMax[i], tMin: w.fc.tMin[i] };
    const pct = patternMatch(refCond, fcCond);
    const color = pct >= 75 ? '#4A7C3A' : pct >= 50 ? '#D29A3C' : '#B45441';
    const bg    = pct >= 75 ? '#EDF7ED' : pct >= 50 ? '#FDF4E3' : '#FDECEA';
    return `<div style="background:${bg};border-radius:10px;padding:10px 12px;min-width:80px;text-align:center;flex:1 0 80px;max-width:100px">
      <div style="font-size:11px;color:#6B5F52">${weekdays[dt.getDay()]}</div>
      <div style="font-size:11px;color:#8A7C6B">${dt.getDate()}.${String(dt.getMonth()+1).padStart(2,'0')}</div>
      <div style="font-size:22px;font-weight:700;color:${color};margin:4px 0">${pct}%</div>
    </div>`;
  }).join('');

  // Per-parameter comparison for reference day
  const paramRows = [
    { label: '💧 Дождь 10д', ref: `${refCond.rain10d} мм`,     fc: `${forecastDays[0]?.rain10d ?? '?'} мм`  },
    { label: '🌱 Влажн. почвы', ref: refCond.soilM?.toFixed(2), fc: forecastDays[0]?.soilM?.toFixed(2) || '?' },
    { label: '🌍 Т почвы',   ref: `${refCond.soilT}°`,         fc: `${forecastDays[0]?.soilT ?? '?'}°` },
    { label: '🌡 Т день',    ref: `${refCond.tMax}°`,           fc: `${w.fc.tMax[0]?.toFixed(0) ?? '?'}°` },
  ].map(p => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid #F2EBDA">
    <span style="color:#6B5F52">${p.label}</span>
    <span style="color:#A89880">эт: <b style="color:#4A3F35">${p.ref}</b></span>
    <span style="color:#A89880">сег: <b style="color:#4A3F35">${p.fc}</b></span>
  </div>`).join('');

  wrap.innerHTML = `
    <div style="margin-bottom:10px">
      <label style="font-size:12px;color:#6B5F52;display:block;margin-bottom:4px">Эталонный день</label>
      ${selectHtml}
    </div>
    <div style="font-size:12px;color:#8A7C6B;margin-bottom:10px">
      ${refDay.date} · ${refLoc?.name||'?'} · Σ дождя ${refCond.rain10d} мм · Tп ${refCond.soilT}° · влажн. ${refCond.soilM?.toFixed(2)}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${fcCards}</div>
    <div style="background:#F7F3EB;border-radius:8px;padding:10px 12px">${paramRows}</div>
  `;
}

function setPatternRef(id) {
  const wrap = document.getElementById('patternForecastWrap');
  if (wrap) {
    wrap.dataset.selectedId = id;
    const loc  = state.locations.find(l => l.id === state.activeLocationId) || state.locations[0];
    const w    = loc && state.weather[loc.id];
    if (w) renderPatternForecast(w);
  }
}

// =========================
// Location comparison
// =========================
function renderLocationComparison() {
  const wrap = document.getElementById('locationCompareWrap');
  if (!wrap) return;
  if (state.locations.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const weekdays = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const rows = state.locations.map(loc => {
    const w = state.weather[loc.id];
    if (!w) return `<div class="loc-compare-row">
      <div class="lc-name">${loc.name}</div>
      <div class="lc-score lc-nodata">нет погоды</div>
    </div>`;

    const general  = projectDayScore(w.hist, w.fc, 0);
    const spScores = loc.species?.length ? projectSpeciesScores(w.hist, w.fc, 0, loc.species, getScoreFn()) : [];
    const best     = spScores[0] || null;
    const health   = best ? quickHealthScore(general.soilM, general.soilT, w.fc.tMax[0], w.fc.tMin[0], general.frostInLast7Days, best.species) : null;
    const score    = best ? Math.round(Math.sqrt(best.score * health)) : general.score;
    const status   = statusFromScore(score);

    // Next 5 days mini-dots
    const fcLen3 = Math.min(5, w.fc.dates.length);
    const fcDots = Array.from({ length: fcLen3 }, (_, i) => {
      const g2  = projectDayScore(w.hist, w.fc, i);
      const sp2 = loc.species?.length ? projectSpeciesScores(w.hist, w.fc, i, loc.species, getScoreFn()) : [];
      const b2  = sp2[0];
      const h2  = b2 ? quickHealthScore(g2.soilM, g2.soilT, w.fc.tMax[i], w.fc.tMin[i], g2.frostInLast7Days, b2.species) : null;
      const s2  = b2 ? Math.round(Math.sqrt(b2.score * h2)) : g2.score;
      const st2 = statusFromScore(s2);
      const dt  = new Date(w.fc.dates[i]);
      return `<div class="lc-dot-cell">
        <span class="lc-dot lc-dot-${st2}"></span>
        <span class="lc-dot-day">${weekdays[dt.getDay()]}</span>
      </div>`;
    }).join('');

    return `<div class="loc-compare-row ${loc.id === state.activeLocationId ? 'lc-active' : ''}" onclick="window.app.setActive('${loc.id}')">
      <div class="lc-name">${loc.name}${loc.id === state.activeLocationId ? ' <span class="lc-here">●</span>' : ''}</div>
      <div class="lc-score-wrap">
        <span class="score-pill ${status} lc-score-pill">${score}</span>
        ${best ? `<span class="lc-species">${best.species}</span>` : ''}
      </div>
      <div class="lc-mini-forecast">${fcDots}</div>
      <div class="lc-weather">Tп ${general.soilT}° · ${general.rain10d}мм</div>
    </div>`;
  }).join('');

  wrap.innerHTML = rows;
}

// =========================
// Forecast view toggle (cards ↔ calendar)
// =========================
function renderForecastToggle() {
  const btn = document.getElementById('forecastViewToggle');
  if (btn) btn.textContent = forecastView === 'cards' ? '📅 Календарь' : '🗂 Карточки';
}

function toggleForecastView() {
  forecastView = forecastView === 'cards' ? 'calendar' : 'cards';
  renderForecastToggle();
  const loc = state.locations.find(l => l.id === state.activeLocationId) || state.locations[0];
  const w = loc && state.weather[loc.id];
  if (!w) return;
  renderForecastGrid(w);
}

function renderForecastGrid(w) {
  const weekdays = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];

  if (forecastView === 'cards') {
    document.getElementById('forecastGrid').innerHTML = w.fc.dates.slice(0, 10).map((d, i) => {
      const r = forecastDays[i];
      if (!r) return '';
      const dt = new Date(d);
      const speciesLabel = r.bestSpecies ? `<div class="day-species">${r.bestSpecies}</div>` : '';
      const waveLabel = r.waveTag ? `<div class="wave-tag ${r.waveTag.cls}">${r.waveTag.text}</div>` : '';
      return `<div class="day ${r.status}${i === 0 ? ' today' : ''} day-clickable" onclick="window.app.showForecastModal(${i})">
        <div class="day-weekday">${weekdays[dt.getDay()]}</div>
        <div class="day-date">${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}${i === 0 ? ' · сег.' : ''}</div>
        <div class="day-score">${r.score}</div>
        <div class="day-temp">${w.fc.tMax[i].toFixed(0)}°/${w.fc.tMin[i].toFixed(0)}° · Tп ${r.soilT}°</div>
        <div class="day-rain">💧 ${w.fc.rain[i]} мм</div>
        ${waveLabel}${speciesLabel}
      </div>`;
    }).join('');
    return;
  }

  // Calendar view — 3 weeks starting from Monday of current week
  const today = new Date();
  const todayStr2 = today.toISOString().slice(0, 10);
  const dowMon = (today.getDay() + 6) % 7; // Mon=0, Sun=6
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dowMon);

  // Build a map: "YYYY-MM-DD" → { r, i }
  const fcMap = {};
  w.fc.dates.slice(0, 10).forEach((d, i) => { fcMap[d] = { r: forecastDays[i], i }; });

  const monthsRu = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const cells = [];
  let lastMonth = -1;
  let monthLabelHtml = '';

  // 3 rows × 7 = 21 cells
  for (let k = 0; k < 21; k++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + k);
    const ds = d.toISOString().slice(0, 10);
    const isToday = ds === todayStr2;
    const isPast  = d < today && !isToday;
    const m = d.getMonth();
    const day = d.getDate();

    // Month label at start of new month
    if (m !== lastMonth) {
      lastMonth = m;
      monthLabelHtml += `<span class="cal-month-chip" style="grid-column: ${(k % 7) + 1}">${monthsRu[m]} ${d.getFullYear()}</span>`;
    }

    const fc = fcMap[ds];
    if (fc) {
      cells.push(`<div class="cal-cell cal-has-data cal-${fc.r.status}${isToday ? ' cal-today' : ''}" onclick="window.app.showForecastModal(${fc.i})">
        <span class="cal-day-num">${day}</span>
        <span class="cal-score">${fc.r.score}</span>
        ${fc.r.bestSpecies ? `<span class="cal-species">${fc.r.bestSpecies.split(' ')[0]}</span>` : ''}
      </div>`);
    } else {
      cells.push(`<div class="cal-cell${isToday ? ' cal-today' : ''}${isPast ? ' cal-past' : ''}">
        <span class="cal-day-num">${day}</span>
      </div>`);
    }
  }

  const dayHeaders = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d =>
    `<div class="cal-header-cell">${d}</div>`).join('');

  document.getElementById('forecastGrid').innerHTML =
    `<div class="cal-grid">
       ${dayHeaders}
       ${cells.join('')}
     </div>`;
}

// =========================
// Dashboard
// =========================
function renderDashboard() {
  const loc = state.locations.find(l => l.id === state.activeLocationId) || state.locations[0];
  if (!loc) {
    document.getElementById('tab-dashboard').innerHTML = '<div class="empty-state"><p>Добавьте первую локацию на вкладке «Локации».</p></div>';
    return;
  }

  const sel = document.getElementById('locationSelector');
  sel.innerHTML = state.locations.map(l =>
    `<option value="${l.id}" ${l.id === loc.id ? 'selected' : ''}>${l.name}</option>`
  ).join('');
  // Refresh button state
  const refreshBtn = document.getElementById('refreshWeatherBtn');
  if (refreshBtn) refreshBtn.disabled = false;

  const biotopeStr = Array.isArray(loc.biotope) ? loc.biotope.join(' + ') : (loc.biotope || '');
  const parts = [
    `<strong>${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}</strong>`,
    loc.elevation ? `${loc.elevation} м` : null,
    biotopeStr || '<em style="color:#A04A3A">биотоп не подтянут</em>'
  ].filter(Boolean);
  document.getElementById('locationInfo').innerHTML = parts.join(' · ');

  const w = state.weather[loc.id];
  if (!w) {
    document.getElementById('heroVerdict').className = 'verdict yellow';
    document.getElementById('verdictDot').textContent = '?';
    document.getElementById('verdictTitle').textContent = 'Погода не загружена';
    document.getElementById('verdictBody').innerHTML = 'Нажмите «Обновить всё» внизу страницы.';
    document.getElementById('factorCards').innerHTML = '';
    document.getElementById('forecastGrid').innerHTML = '';
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    document.getElementById('checklist').innerHTML = '';
    return;
  }

  const todayScore = projectDayScore(w.hist, w.fc, 0);
  const todaySpeciesScores = loc.species?.length
    ? projectSpeciesScores(w.hist, w.fc, 0, loc.species, getScoreFn())
    : [];
  // Всегда вычисляем альтернативный алгоритм для отображения второго балла
  const altScoreFn = scoringMode === 'mdi' ? scoreFromConditions : scoreFromConditionsMDI;
  const todayAltScores = loc.species?.length
    ? projectSpeciesScores(w.hist, w.fc, 0, loc.species, altScoreFn)
    : [];

  // Forecast: per day, blend lag-shifted trigger score with current conditions score.
  // Final = √(triggerScore × currentScore) — both need to be good for a truly green day.
  // If no species configured, fall back to general (no lag) score.
  const fcLen = Math.min(10, w.fc.dates.length);
  const nextDays = Array.from({ length: fcLen }, (_, i) => {
    const general = projectDayScore(w.hist, w.fc, i);
    if (!loc.species?.length) return { ...general, hint: null };
    const shifted = projectSpeciesScores(w.hist, w.fc, i, loc.species, getScoreFn());
    if (!shifted.length) return { ...general, hint: null, allSpecies: [] };
    // Per-species blend: √(triggerScore × healthScore), health uses species-specific thresholds
    const blended = shifted.map(sp => {
      const health = quickHealthScore(
        general.soilM, general.soilT,
        w.fc.tMax[i], w.fc.tMin[i],
        general.frostInLast7Days,
        sp.species
      );
      const score = Math.round(Math.sqrt(sp.score * health));
      return { ...sp, score, status: statusFromScore(score), triggerScore: sp.score, healthScore: health };
    }).sort((a, b) => b.score - a.score);
    const best = blended[0];
    const hint = buildForecastHint(best.triggerScore, best.healthScore, best.species, best.lag);
    // waveTag — видимый индикатор состояния волны на карточке
    const tS = statusFromScore(best.triggerScore);
    const hS = statusFromScore(best.healthScore);
    let waveTag = null;
    if (tS === 'green' && hS === 'red')    waveTag = { text: '🌊 спад',    cls: 'wave-decline' };
    else if (tS === 'green' && hS === 'yellow') waveTag = { text: '🌊 затухает', cls: 'wave-fading' };
    else if (tS === 'green' && hS === 'green')  waveTag = { text: '🌊 пик',     cls: 'wave-peak' };
    // generalScore = условия без лага и с rain gate — используется для линии графика
    return { ...general, score: best.score, generalScore: general.score,
             status: best.status, bestSpecies: best.species, allSpecies: blended,
             hint, triggerScore: best.triggerScore, healthScore: best.healthScore, waveTag };
  });

  forecastDays = nextDays; // store for click-modal access
  const greenAhead = nextDays.filter(d => d.status === 'green').length;

  let bestIdx = 0, bestScore = -1;
  nextDays.forEach((d, i) => { if (d.score > bestScore) { bestScore = d.score; bestIdx = i; } });
  const bestDate = new Date(w.fc.dates[bestIdx]);
  const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const bestLabel = `${dayNames[bestDate.getDay()]} ${bestDate.getDate()}.${String(bestDate.getMonth() + 1).padStart(2, '0')}`;

  // Best species today (if any configured for location)
  const bestSpecies = todaySpeciesScores[0] || null;
  // Apply same blend: trigger × health (soilM+soilT+temp, no rain gate)
  const todayHealth = bestSpecies
    ? quickHealthScore(
        todayScore.soilM, todayScore.soilT,
        w.fc.tMax[0], w.fc.tMin[0],
        todayScore.frostInLast7Days,
        bestSpecies.species
      )
    : null;
  const displayScore = bestSpecies
    ? Math.round(Math.sqrt(bestSpecies.score * todayHealth))
    : todayScore.score;
  const displayStatus = statusFromScore(displayScore);
  const displaySpeciesName = bestSpecies ? bestSpecies.species : null;

  let title, body;
  if (displayStatus === 'green') {
    const speciesNote = displaySpeciesName ? ` · <em>${displaySpeciesName}${bestSpecies.isPeak ? ' 🌟 пиковый месяц' : ''}</em>` : '';
    title = `Ехать. ${greenAhead} зелёных дня впереди`;
    body = `Все факторы соблюдены${speciesNote}. Лучший день: <strong>${bestLabel}</strong> (score ${bestScore}). Σ дождя за 10 дн — ${todayScore.rain10d} мм, T почвы ${todayScore.soilT} °C.`;
  } else if (displayStatus === 'yellow') {
    const speciesNote = displaySpeciesName ? ` · ${displaySpeciesName}` : '';
    title = `Можно, но средне${speciesNote}`;
    body = `Условия пограничные. Лучший день: <strong>${bestLabel}</strong> (score ${bestScore}). Σ дождя ${todayScore.rain10d} мм, T почвы ${todayScore.soilT} °C.`;
  } else {
    title = 'Пока не стоит';
    body = `Score сегодня ${displayScore}. Лучший день впереди: <strong>${bestLabel}</strong> (score ${bestScore}).`;
  }
  document.getElementById('heroVerdict').className = `verdict ${displayStatus}`;
  document.getElementById('verdictDot').textContent = displayStatus === 'green' ? '▲' : displayStatus === 'yellow' ? '●' : '✕';
  document.getElementById('verdictTitle').textContent = title;
  document.getElementById('verdictBody').innerHTML = body;

  // Factor cards
  const S = CONFIG.scoring;
  const smClass = (todayScore.soilM >= S.soilM.ok[0] && todayScore.soilM <= S.soilM.ok[1]) ? 'ok' : (todayScore.soilM >= S.soilM.fair[0] && todayScore.soilM <= S.soilM.fair[1]) ? 'warn' : 'bad';
  const stClass = (todayScore.soilT >= S.soilT.ok[0] && todayScore.soilT <= S.soilT.ok[1]) ? 'ok' : (todayScore.soilT >= S.soilT.fair[0] && todayScore.soilT <= S.soilT.fair[1]) ? 'warn' : 'bad';
  const sumClass = (todayScore.rain10d >= S.rain10d.ok[0] && todayScore.rain10d <= S.rain10d.ok[1]) ? 'ok' : (todayScore.rain10d >= S.rain10d.fair[0] && todayScore.rain10d <= S.rain10d.fair[1]) ? 'warn' : 'bad';
  const triggered = todayScore.rain10d > 10 && todayScore.soilT < 14;

  const frostToday = todayScore.frostInLast7Days;
  document.getElementById('factorCards').innerHTML = `
    <div class="card"><div class="card-label">Осадки / 10 дней</div><div class="card-value status-${sumClass}">${todayScore.rain10d} мм</div><div class="card-note">норма 15–40 мм</div></div>
    <div class="card"><div class="card-label">Влажность почвы</div><div class="card-value status-${smClass}">${todayScore.soilM.toFixed(2)}</div><div class="card-note">оптимум 0,25–0,40</div></div>
    <div class="card"><div class="card-label">Темп. почвы</div><div class="card-value status-${stClass}">${todayScore.soilT} °C</div><div class="card-note">окно 8–14 °C</div></div>
    <div class="card"><div class="card-label">Заморозок</div><div class="card-value status-${frostToday ? 'ok' : 'warn'}">${frostToday ? '❄ Был' : '—'}</div><div class="card-note">триггер опят</div></div>
  `;

  // Species breakdown
  const speciesEl = document.getElementById('speciesBreakdown');
  if (speciesEl) {
    if (todaySpeciesScores.length === 0) {
      speciesEl.style.display = 'none';
    } else {
      speciesEl.style.display = '';
      const altLabel = scoringMode === 'mdi' ? 'Кл' : 'MDI';
      speciesEl.innerHTML = `<h3 style="margin-top:0;margin-bottom:12px">Виды сегодня</h3>` +
        todaySpeciesScores.map(s => {
          const cfg = CONFIG.speciesConfig?.[s.species];
          const lagNote = cfg?.lagDays ? `<span class="sb-lag">ждать ~${cfg.lagDays} дн от дождя</span>` : '';
          const peakBadge = s.isPeak ? `<span class="sb-peak">пик</span>` : '';
          const altEntry = todayAltScores.find(a => a.species === s.species);
          const altBadge = altEntry != null
            ? `<span class="sb-alt" title="${altLabel === 'MDI' ? 'MDI v2.0' : 'Классика'}">${altLabel}:${altEntry.score}</span>`
            : '';
          return `<div class="sb-row">
            <span class="sb-name">${s.species}${peakBadge}</span>
            <div class="sb-bar"><div class="sb-fill ${s.status}" style="width:${s.score}%"></div></div>
            <span class="score-pill ${s.status} sb-score">${s.score}</span>
            ${altBadge}
            ${lagNote}
          </div>`;
        }).join('');
    }
  }

  // Волна-таймер
  renderWaveTimer(w.hist, loc);

  // Forecast grid (cards or calendar)
  renderForecastGrid(w);
  renderForecastToggle();

  // ── Location comparison, Radar, Pattern forecast ────────────────────────────
  renderLocationComparison();
  try { renderRadarChart(w, loc); } catch (e) { console.error('[radar]', e); }
  try { renderPatternForecast(w); } catch (e) { console.error('[pattern]', e); }

  // ── Чеклист (ДО графиков — чтобы рендерился даже при ошибке Chart.js) ───────
  const checks = [
    { ok: sumClass === 'ok', title: `Σ осадков за 10 дней: ${todayScore.rain10d} мм`, note: 'Норма 15–40 мм для осеннего слоя.' },
    { ok: smClass === 'ok', title: `Влажность почвы: ${todayScore.soilM}`, note: 'Оптимум 0,25–0,40 м³/м³.' },
    { ok: stClass === 'ok', title: `Температура почвы: ${todayScore.soilT} °C`, note: 'Окно 8–14 °C для осеннего плодоношения.' },
    { ok: triggered, title: triggered ? 'Холодный толчок сработал' : 'Холодный толчок не ясен', note: 'Нужно резкое похолодание + возврат тепла.' }
  ];
  document.getElementById('checklist').innerHTML = checks.map(c => `
    <div class="check-row ${c.ok ? 'ok' : 'warn'}">
      <div class="check-mark">${c.ok ? '✓' : '!'}</div>
      <div class="check-text"><strong>${c.title}</strong><span>${c.note}</span></div>
    </div>`).join('');

  // ── Единый график: Score + Weather ──────────────────────────────────────────
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const histLen = w.hist.dates.length;
  const fcLen2  = w.fc.dates.length;
  const allLabels = [...w.hist.dates.map(d => d.slice(5)), ...w.fc.dates.map(d => d.slice(5))];
  const rainHist = [...w.hist.rain, ...Array(fcLen2).fill(null)];
  const rainFc   = [...Array(histLen).fill(null), ...w.fc.rain];
  const soilMHist = [...w.hist.soilM, ...Array(fcLen2).fill(null)];
  const soilMFc   = [...Array(histLen).fill(null), ...(w.fc.soilM?.length
      ? w.fc.soilM.map(v => v != null ? parseFloat(v.toFixed(3)) : null)
      : forecastDays.map(d => d.soilM))];
  const soilTHist = [...w.hist.soilT, ...Array(fcLen2).fill(null)];
  const soilTFc   = [...Array(histLen).fill(null), ...(w.fc.soilT?.length
      ? w.fc.soilT.map(v => v != null ? parseFloat(v.toFixed(1)) : null)
      : forecastDays.map(d => d.soilT))];
  const scoreFn = getScoreFn();
  const scoreHist = w.hist.dates.map((date, i) => {
    const rain10d = w.hist.rain.slice(Math.max(0, i-9), i+1).reduce((a,b) => a+(b||0), 0);
    const c = { soilT: w.hist.soilT[i], soilM: w.hist.soilM[i], rain10d,
                tMax: w.hist.tMax?.[i] ?? null, tMin: w.hist.tMin[i], date,
                frostInLast7Days: w.hist.tMin.slice(Math.max(0,i-6),i+1).some(t=>t<0) };
    if (c.soilT == null || c.soilM == null) return null;
    const spScores = loc.species?.length ? loc.species.map(sp => scoreFn(c, sp)).filter(s => s !== null) : [];
    return spScores.length ? Math.max(...spScores) : scoreFn(c, null);
  });
  // Для линии графика используем generalScore (условия с rain gate, без лага) —
  // это та же формула что и у исторической линии, скачка на границе факт/прогноз нет.
  // Лаговый score (best.score) остаётся в карточках прогноза и вердикте.
  const scoreFc = [...Array(histLen).fill(null), ...forecastDays.map(d => d.generalScore ?? d.score ?? null)];
  const scoreHistPadded = [...scoreHist, ...Array(fcLen2).fill(null)];

  const ctx = document.getElementById('chart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: allLabels,
      datasets: [
        { label: 'Осадки (факт)', data: rainHist, backgroundColor: 'rgba(141,166,214,0.75)', borderWidth: 0, yAxisID: 'y1', order: 4 },
        { label: 'Осадки (прогноз)', data: rainFc, backgroundColor: 'rgba(141,166,214,0.30)', borderWidth: 0, yAxisID: 'y1', order: 4 },
        { label: 'Влажн. почвы', data: soilMHist, type: 'line', borderColor: '#4A7C3A', backgroundColor: 'transparent', tension: 0.3, pointRadius: 1.5, yAxisID: 'y2', borderWidth: 2, order: 2 },
        { label: 'Влажн. (прогн.)', data: soilMFc, type: 'line', borderColor: '#4A7C3A', backgroundColor: 'transparent', tension: 0.3, pointRadius: 1.5, yAxisID: 'y2', borderWidth: 2, borderDash: [4,3], order: 2 },
        { label: 'Т почвы, °C', data: soilTHist, type: 'line', borderColor: '#D29A3C', backgroundColor: 'transparent', tension: 0.3, pointRadius: 1.5, yAxisID: 'y3', borderWidth: 2, order: 3 },
        { label: 'Т почвы (прогн.)', data: soilTFc, type: 'line', borderColor: '#D29A3C', backgroundColor: 'transparent', tension: 0.3, pointRadius: 1.5, yAxisID: 'y3', borderWidth: 2, borderDash: [4,3], order: 3 },
        { label: 'Балл (факт)', data: scoreHistPadded, type: 'line', borderColor: '#B45441', backgroundColor: 'rgba(180,84,65,0.08)', fill: true, tension: 0.35, pointRadius: 1.5, yAxisID: 'y4', borderWidth: 2.5, order: 1 },
        { label: 'Балл (прогноз)', data: scoreFc, type: 'line', borderColor: '#B45441', backgroundColor: 'transparent', tension: 0.35, pointRadius: 1.5, yAxisID: 'y4', borderWidth: 2.5, borderDash: [4,3], order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
        y1: { type: 'linear', position: 'left', beginAtZero: true, grid: { color: '#F2EBDA' },
              title: { display: true, text: 'мм', font: { size: 10 }, color: '#8DA6D6' } },
        y2: { type: 'linear', position: 'right', min: 0.15, max: 0.5, grid: { display: false },
              title: { display: true, text: 'влажн.', font: { size: 10 }, color: '#4A7C3A' } },
        y3: { type: 'linear', position: 'right', min: 0, max: 25, grid: { display: false },
              title: { display: true, text: '°C', font: { size: 10 }, color: '#D29A3C' }, offset: true },
        y4: { type: 'linear', position: 'left', min: 0, max: 110, grid: { display: false },
              title: { display: true, text: 'балл', font: { size: 10 }, color: '#B45441' },
              offset: true, ticks: { display: false } }
      },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { font: { size: 11 }, boxWidth: 14, padding: 8 } },
        tooltip: {
          callbacks: {
            afterBody: (items) => { const idx = items[0]?.dataIndex; return idx === histLen ? ['— прогноз —'] : []; }
          }
        }
      }
    }
  });

}

// =========================
// Locations
// =========================
function renderLocations() {
  document.getElementById('locationsCount').textContent = state.locations.length;
  const container = document.getElementById('locationsList');
  if (state.locations.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>У вас пока нет сохранённых локаций.</p><button class="btn primary" onclick="window.app.openLocationForm()">+ Добавить первую</button></div>';
    return;
  }
  container.innerHTML = state.locations.map(l => {
    const biotopeList = Array.isArray(l.biotope) ? l.biotope : (l.biotope ? [l.biotope] : []);
    const synced = !!l.osmSyncedAt;
    return `<div class="loc-detail ${l.id === state.activeLocationId ? 'active' : ''}">
      <div class="loc-detail-head">
        <div>
          <div class="loc-detail-title">${l.name} ${l.id === state.activeLocationId ? '<span class="pill active">активна</span>' : ''}</div>
          <div class="loc-detail-coords">📍 ${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}${l.elevation ? ` · ${l.elevation} м` : ''}</div>
        </div>
        <div class="loc-detail-actions">
          <button class="btn sm" onclick="window.app.setActive('${l.id}')">${l.id === state.activeLocationId ? '✓ активна' : 'Активировать'}</button>
          <button class="btn sm" onclick="window.app.openLocationForm('${l.id}')">Изменить</button>
          <button class="btn sm" onclick="window.app.syncBiotope('${l.id}')">⟳ OSM</button>
          <button class="btn sm" onclick="window.app.syncForestType('${l.id}')">🌲 iNat</button>
          <button class="btn sm danger" onclick="window.app.deleteLocation('${l.id}')">×</button>
        </div>
      </div>
      <div class="loc-detail-body">
        <div class="loc-detail-row">
          <div class="loc-detail-label">Биотоп (OSM)</div>
          <div class="loc-detail-value">${synced ? biotopeList.map(b => `<span class="pill green">${b}</span>`).join(' ') : '<em>не подтянут — кнопка ⟳ OSM</em>'}</div>
        </div>
        <div class="loc-detail-row">
          <div class="loc-detail-label">Админ. район</div>
          <div class="loc-detail-value">${l.adminArea || '—'}</div>
        </div>
        <div class="loc-detail-row">
          <div class="loc-detail-label">Ближайший объект</div>
          <div class="loc-detail-value">${l.nearestFeature || '—'}</div>
        </div>
        <div class="loc-detail-row">
          <div class="loc-detail-label">Виды грибов</div>
          <div class="loc-detail-value">${(l.species || []).length ? l.species.map(s => `<span class="pill green">${s}</span>`).join(' ') : '<em>не указаны</em>'}</div>
        </div>
        <div class="loc-detail-row">
          <div class="loc-detail-label">Деревья (iNat 5 км)</div>
          <div class="loc-detail-value">${l.forestTrees?.length
            ? `<div class="forest-trees-list">${l.forestTrees.slice(0, 8).map(t =>
                `<div class="forest-tree-row">
                  <span class="forest-tree-name">${t.name}</span>
                  <span class="forest-tree-latin">${t.latin}</span>
                  <span class="forest-tree-count">${t.count} набл.</span>
                </div>`).join('')}
              </div><div class="loc-detail-sync">iNat синк: ${l.forestTreesSyncedAt || '?'} · ${l.forestTrees.length} видов</div>`
            : '<em>не загружено — кнопка 🌲 iNat</em>'
          }</div>
        </div>
        ${synced ? `<div class="loc-detail-sync">OSM синк: ${l.osmSyncedAt}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function setActive(id) {
  state.activeLocationId = id;
  saveAndSync(state);
  renderAll();
  switchTab('dashboard');
}

function openLocationForm(id) {
  const existing = id ? state.locations.find(l => l.id === id) : null;
  openModal(`
    <h3>${existing ? 'Изменить локацию' : 'Новая локация'}</h3>
    <div class="form-row"><label>Название</label><input id="locName" value="${existing?.name || ''}" placeholder="Напр. Березняк за дачей"></div>
    <div class="form-row form-grid-2">
      <div><label>Широта</label><input id="locLat" type="number" step="0.0001" value="${existing?.lat || ''}" placeholder="53.5248"></div>
      <div><label>Долгота</label><input id="locLon" type="number" step="0.0001" value="${existing?.lon || ''}" placeholder="27.6199"></div>
    </div>
    <div class="form-hint" style="background:#FBF3DF;padding:10px 12px;border-radius:6px;margin-bottom:14px">💡 Биотоп, высота и админ-район подтянутся автоматически из OSM и open-meteo после сохранения.</div>
    <div class="form-row"><label>Виды грибов на этой локации</label><div class="checkboxes" id="locSpecies">${speciesCheckboxesHtml('locSpecies', existing?.species || [])}</div></div>
    <div class="modal-actions">
      <button class="btn" onclick="window.app.closeModal()">Отмена</button>
      <button class="btn primary" onclick="window.app.saveLocation('${id || ''}')">${existing ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);
  setTimeout(() => wireSpeciesCheckboxes('locSpecies'), 0);
}

async function saveLocation(id) {
  const name = document.getElementById('locName').value.trim();
  const lat = parseFloat(document.getElementById('locLat').value);
  const lon = parseFloat(document.getElementById('locLon').value);
  const species = Array.from(document.querySelectorAll('#locSpecies input:checked')).map(x => x.value);
  if (!name || isNaN(lat) || isNaN(lon)) { alert('Нужны имя и координаты'); return; }
  let newId = id;
  if (id) {
    const i = state.locations.findIndex(l => l.id === id);
    if (i >= 0) state.locations[i] = { ...state.locations[i], name, lat, lon, species };
  } else {
    newId = `loc-${Date.now()}`;
    state.locations.push({ id: newId, name, lat, lon, species });
  }
  saveAndSync(state);
  closeModal();
  renderAll();
  showToast(id ? 'Сохранено' : 'Локация добавлена. Подтягиваю биотоп и погоду…');
  if (!id) {
    await Promise.all([syncBiotope(newId), syncAllWeather()]);
  }
}

function deleteLocation(id) {
  if (!confirm('Удалить локацию?')) return;
  state.locations = state.locations.filter(l => l.id !== id);
  delete state.weather[id];
  if (state.activeLocationId === id) state.activeLocationId = state.locations[0]?.id;
  saveAndSync(state);
  renderAll();
  showToast('Удалено');
}

// =========================
// Day score preview (in form, before saving)
// =========================
async function previewDayScore(date, locId) {
  const box = document.getElementById('dayScorePreview');
  if (!box) return;
  if (!date || !locId) { box.style.display = 'none'; return; }
  const loc = state.locations.find(l => l.id === locId);
  if (!loc) return;
  box.style.display = '';
  box.className = 'score-preview-box loading';
  box.innerHTML = `Считаю score за ${date}…`;
  try {
    const c = await fetchHistoricalConditions(loc.lat, loc.lon, date);
    if (!c) {
      box.className = 'score-preview-box err';
      box.innerHTML = 'Нет архивных данных за эту дату (доступно с 1940 по вчера)';
      return;
    }
    const score = scoreFromConditions(c);
    const status = statusFromScore(score);
    const emoji = { green: '🟢', yellow: '🟡', red: '🔴' }[status];
    const label = { green: 'зелёный — ехать', yellow: 'жёлтый — пограничный', red: 'красный — не стоило' }[status];
    const selectedQty = document.querySelector('#dayQty label.checked')?.dataset.q;
    let verdictHtml = '';
    if (selectedQty) {
      const isSuccess = selectedQty !== 'none';
      const modelRight = (status === 'green' && isSuccess) || (status === 'red' && !isSuccess);
      const modelWrong = (status === 'green' && !isSuccess) || (status === 'red' && isSuccess);
      if (modelRight) verdictHtml = `<div class="score-preview-verdict ok">✓ Модель права — условия соответствуют исходу</div>`;
      else if (modelWrong) verdictHtml = `<div class="score-preview-verdict off">✗ Модель ошиблась — стоит пересмотреть пороги</div>`;
      else verdictHtml = `<div class="score-preview-verdict neutral">~ Жёлтый — пограничный результат</div>`;
    }
    box.className = `score-preview-box ${status}`;
    box.innerHTML = `<div class="score-preview-title">${emoji} ${score} баллов · ${label}</div>
      <div class="score-preview-sub">T почвы ${c.soilT}° · влажн. ${c.soilM} · Σ10дн ${c.rain10d} мм · T возд. ${c.tMax}/${c.tMin}°</div>
      ${verdictHtml}`;
  } catch(e) {
    box.className = 'score-preview-box err';
    box.innerHTML = 'Ошибка при загрузке условий: ' + e.message;
  }
}

// =========================
// Mushroom Days
// =========================
function renderDays() {
  document.getElementById('daysCount').textContent = state.mushroomDays.length;
  const container = document.getElementById('daysList');
  if (state.mushroomDays.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Пока нет грибных дней.</p><button class="btn primary" onclick="window.app.openDayForm()">+ Добавить первый</button></div>';
    return;
  }
  const sorted = [...state.mushroomDays].sort((a, b) => b.date.localeCompare(a.date));
  const qLabels = { none: 'пусто', little: 'мало', some: 'средне', many: 'много', jackpot: 'джекпот' };
  container.innerHTML = sorted.map(d => {
    const loc = state.locations.find(l => l.id === d.locationId);
    const dt = new Date(d.date);
    const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    const isBlank = d.quantity === 'none';

    // Score badge + verdict
    // Priority: trigger conditions per species (biological) → same-day conditions (fallback)
    let scoreBadgeHtml = '';
    if (d.conditions || d.triggerConditions) {
      let predScore, predStatus;
      let triggerRows = '';

      if (d.triggerConditions && d.species?.length) {
        // Score each species from its own trigger day conditions
        const spScores = d.species
          .map(sp => {
            const tc = d.triggerConditions[sp];
            if (!tc) return null;
            const score = scoreFromConditions(tc, sp);
            const st = statusFromScore(score);
            return { sp, score, st, triggerDate: tc.triggerDate };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score);

        if (spScores.length) {
          predScore  = spScores[0].score;
          predStatus = spScores[0].st;
          triggerRows = `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">` +
            spScores.map(s =>
              `<span style="font-size:10px;color:#6B5F52">${s.sp}:&nbsp;<span class="score-pill ${s.st}" style="font-size:9px;padding:1px 5px">${s.score}</span>&nbsp;<span style="color:#A89880">← ${s.triggerDate}</span></span>`
            ).join('') + `</div>`;
        }
      }

      // Fallback to same-day conditions if no trigger data
      if (predScore === undefined && d.conditions) {
        predScore  = scoreFromConditions(d.conditions);
        predStatus = statusFromScore(predScore);
      }

      if (predScore !== undefined) {
        const isSuccess = !isBlank;
        const emoji = { green: '🟢', yellow: '🟡', red: '🔴' }[predStatus];
        let verdictClass = 'neutral', verdictIcon = '~', verdictTip = 'пограничный';
        if (predStatus !== 'yellow') {
          const modelRight = (predStatus === 'green' && isSuccess) || (predStatus === 'red' && !isSuccess);
          verdictClass = modelRight ? 'ok' : 'off';
          verdictIcon = modelRight ? '✓' : '✗';
          verdictTip = modelRight ? 'модель права' : 'модель ошиблась';
        }
        scoreBadgeHtml = `<div class="day-card-score">
          <span class="score-pill ${predStatus}">${emoji} ${predScore}</span>
          <span class="verdict-badge ${verdictClass}">${verdictIcon} ${verdictTip}</span>
        </div>${triggerRows}`;
      }
    }

    return `<div class="day-card ${isBlank ? 'blank' : ''}">
      <div>
        <div class="date">${dateStr}${isBlank ? ' <span style="color:#B45441;font-size:12px">· пустой поход</span>' : ''}</div>
        <div class="locname">📍 ${loc?.name || '—'}</div>
        ${isBlank ? `<div style="font-size:12px;color:#8A7C6B;margin-top:6px">искал (не нашёл):</div>` : ''}
        <div style="margin-top:${isBlank ? '2' : '6'}px">${(d.species || []).map(s => `<span class="pill green species-chip">${s}</span>`).join('')}</div>
        ${d.notes ? `<div class="notes">${d.notes}</div>` : ''}
        ${d.conditions ? `<div style="margin-top:8px;font-size:11px;color:#8A7C6B;font-family:monospace">T почвы ${d.conditions.soilT}° · влажн. ${d.conditions.soilM} · Σ10дн ${d.conditions.rain10d} мм · T возд. ${d.conditions.tMax}/${d.conditions.tMin}°</div>` : '<div style="margin-top:6px"><button class="btn sm" onclick="window.app.syncHistoricalForDay(\'' + d.id + '\')">⟳ подтянуть условия</button></div>'}
        ${scoreBadgeHtml}
      </div>
      <div class="right">
        <span class="quantity-badge ${d.quantity || 'some'}">${qLabels[d.quantity] || 'средне'}</span>
        <div style="margin-top:10px;display:flex;gap:4px;justify-content:flex-end">
          <button class="btn sm" onclick="window.app.openDayForm('${d.id}')">Изм.</button>
          <button class="btn sm danger" onclick="window.app.deleteDay('${d.id}')">×</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openDayForm(id) {
  const existing = id ? state.mushroomDays.find(d => d.id === id) : null;
  const today = new Date().toISOString().slice(0, 10);
  const defaultLocId = existing?.locationId || state.activeLocationId || state.locations[0]?.id || '';
  openModal(`
    <h3>${existing ? 'Изменить день' : 'Новый грибной день'}</h3>
    <div class="form-row form-grid-2">
      <div><label>Дата</label><input id="dayDate" type="date" value="${existing?.date || today}"></div>
      <div><label>Локация</label><select id="dayLoc">
        ${state.locations.map(l => `<option value="${l.id}" ${l.id === defaultLocId ? 'selected' : ''}>${l.name}</option>`).join('')}
      </select></div>
    </div>
    <div id="dayScorePreview" style="display:none"></div>
    <div class="form-row">
      <label>Исход похода</label>
      <div class="checkboxes" id="dayQty">
        ${['none','little','some','many','jackpot'].map(q => {
          const lbl = { none: '🚫 пусто', little: 'мало (<5)', some: 'средне (5–20)', many: 'много (20–50)', jackpot: 'джекпот (50+)' }[q];
          return `<label class="${(existing?.quantity || 'some') === q ? 'checked' : ''}" data-q="${q}">${lbl}</label>`;
        }).join('')}
      </div>
      <div class="form-hint">💡 Модель покажет свой прогноз за эту дату — сравни с тем, что нашёл.</div>
    </div>
    <div class="form-row"><label>Виды</label><div class="checkboxes" id="daySpecies">${speciesCheckboxesHtml('daySpecies', existing?.species || [])}</div></div>
    <div class="form-row"><label>Заметки</label><textarea id="dayNotes" placeholder="Погода, фенология…">${existing?.notes || ''}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="window.app.closeModal()">Отмена</button>
      <button class="btn primary" onclick="window.app.saveDay('${id || ''}')">${existing ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);
  setTimeout(() => {
    wireSpeciesCheckboxes('daySpecies');
    const dateInput = document.getElementById('dayDate');
    const locSelect = document.getElementById('dayLoc');
    const refreshPreview = () => previewDayScore(dateInput.value, locSelect.value);
    dateInput.addEventListener('change', refreshPreview);
    locSelect.addEventListener('change', refreshPreview);
    document.querySelectorAll('#dayQty label').forEach(lab => {
      lab.addEventListener('click', () => {
        document.querySelectorAll('#dayQty label').forEach(x => x.classList.remove('checked'));
        lab.classList.add('checked');
        // Re-render verdict part if preview already loaded
        const box = document.getElementById('dayScorePreview');
        if (box && box.style.display !== 'none' && !box.classList.contains('loading') && !box.classList.contains('err')) {
          refreshPreview();
        }
      });
    });
    // Auto-show preview on open
    refreshPreview();
  }, 0);
}

async function saveDay(id) {
  const date = document.getElementById('dayDate').value;
  const locationId = document.getElementById('dayLoc').value;
  const species = Array.from(document.querySelectorAll('#daySpecies input:checked')).map(x => x.value);
  const quantity = document.querySelector('#dayQty label.checked')?.dataset.q || 'some';
  const notes = document.getElementById('dayNotes').value.trim();
  if (!date || !locationId) { alert('Нужна дата и локация'); return; }
  let newId = id;
  if (id) {
    const i = state.mushroomDays.findIndex(d => d.id === id);
    if (i >= 0) {
      // If date or location changed, invalidate cached conditions
      if (state.mushroomDays[i].date !== date || state.mushroomDays[i].locationId !== locationId) {
        delete state.mushroomDays[i].conditions;
      }
      state.mushroomDays[i] = { ...state.mushroomDays[i], date, locationId, species, quantity, notes };
    }
  } else {
    newId = `day-${Date.now()}`;
    state.mushroomDays.push({ id: newId, date, locationId, species, quantity, notes });
  }
  saveAndSync(state);
  closeModal();
  renderAll();
  const dayId = newId;
  const target = state.mushroomDays.find(d => d.id === dayId);
  if (target && !target.conditions) {
    await syncHistoricalForDay(dayId);
  }
}

function deleteDay(id) {
  if (!confirm('Удалить этот день?')) return;
  state.mushroomDays = state.mushroomDays.filter(d => d.id !== id);
  saveAndSync(state);
  renderAll();
}

// =========================
// Patterns
// =========================
function renderPatterns() {
  const container = document.getElementById('patternsContent');
  const allWithCond = state.mushroomDays.filter(d => d.conditions);
  const successful = allWithCond.filter(d => d.quantity && d.quantity !== 'none');
  const blanks = allWithCond.filter(d => d.quantity === 'none');

  if (allWithCond.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>Пока нет дней с условиями.</p><p style="font-size:13px">Нажмите «⟳ подтянуть условия» на дне или кнопку «Подтянуть все условия» внизу.</p><button class="btn primary" onclick="window.app.syncAllHistorical()">⟳ Подтянуть все условия</button></div>`;
    return;
  }

  const avg = (arr, key) => arr.length ? arr.reduce((s, d) => s + d.conditions[key], 0) / arr.length : null;
  const sStats = successful.length ? { soilM: avg(successful, 'soilM'), soilT: avg(successful, 'soilT'), rain10d: avg(successful, 'rain10d'), tMax: avg(successful, 'tMax'), tMin: avg(successful, 'tMin') } : null;
  const bStats = blanks.length ? { soilM: avg(blanks, 'soilM'), soilT: avg(blanks, 'soilT'), rain10d: avg(blanks, 'rain10d'), tMax: avg(blanks, 'tMax'), tMin: avg(blanks, 'tMin') } : null;

  const validationRows = allWithCond.map(d => {
    // Use trigger conditions per species when available (more accurate)
    let predScore;
    if (d.triggerConditions && d.species?.length) {
      const spScores = d.species
        .map(sp => { const tc = d.triggerConditions[sp]; return tc ? scoreFromConditions(tc, sp) : null; })
        .filter(s => s !== null);
      if (spScores.length) predScore = Math.max(...spScores);
    }
    if (predScore === undefined) predScore = scoreFromConditions(d.conditions);
    const predStatus = statusFromScore(predScore);
    const actualIsSuccess = d.quantity && d.quantity !== 'none';
    const match = (predStatus === 'green' && actualIsSuccess) || (predStatus === 'red' && !actualIsSuccess) || (predStatus === 'yellow');
    const loc = state.locations.find(l => l.id === d.locationId);
    return { d, predScore, predStatus, actualIsSuccess, match, locName: loc?.name || '—' };
  }).sort((a, b) => b.d.date.localeCompare(a.d.date));

  const strict = validationRows.filter(r => r.predStatus !== 'yellow');
  const correct = strict.filter(r => (r.predStatus === 'green' && r.actualIsSuccess) || (r.predStatus === 'red' && !r.actualIsSuccess));
  const accuracy = strict.length ? Math.round((correct.length / strict.length) * 100) : null;

  const activeLoc = state.locations.find(l => l.id === state.activeLocationId);
  const activeW = activeLoc && state.weather[activeLoc.id];
  const todayScore = activeW ? projectDayScore(activeW.hist, activeW.fc, 0) : null;

  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const byMonth = {};
  successful.forEach(d => { const m = parseInt(d.date.slice(5, 7)); byMonth[m] = (byMonth[m] || 0) + 1; });
  const bySpecies = {};
  successful.forEach(d => (d.species || []).forEach(s => { bySpecies[s] = (bySpecies[s] || 0) + 1; }));

  container.innerHTML = `
    <div class="pattern-grid">
      ${sStats ? `<div class="pattern-card">
        <h4>🟢 Удачные (${successful.length}) — средние условия</h4>
        <div class="pattern-stat"><span>Σ дождя / 10 дн</span><span class="value">${sStats.rain10d.toFixed(1)} мм</span></div>
        <div class="pattern-stat"><span>Влажность почвы</span><span class="value">${sStats.soilM.toFixed(2)}</span></div>
        <div class="pattern-stat"><span>T почвы</span><span class="value">${sStats.soilT.toFixed(1)} °C</span></div>
        <div class="pattern-stat"><span>T день</span><span class="value">${sStats.tMax.toFixed(1)} °C</span></div>
        <div class="pattern-stat"><span>T ночь</span><span class="value">${sStats.tMin.toFixed(1)} °C</span></div>
      </div>` : ''}
      ${bStats ? `<div class="pattern-card">
        <h4>🚫 Пустые (${blanks.length}) — средние условия</h4>
        <div class="pattern-stat"><span>Σ дождя / 10 дн</span><span class="value">${bStats.rain10d.toFixed(1)} мм</span></div>
        <div class="pattern-stat"><span>Влажность почвы</span><span class="value">${bStats.soilM.toFixed(2)}</span></div>
        <div class="pattern-stat"><span>T почвы</span><span class="value">${bStats.soilT.toFixed(1)} °C</span></div>
        <div class="pattern-stat"><span>T день</span><span class="value">${bStats.tMax.toFixed(1)} °C</span></div>
        <div class="pattern-stat"><span>T ночь</span><span class="value">${bStats.tMin.toFixed(1)} °C</span></div>
      </div>` : ''}
      ${todayScore && sStats ? `<div class="pattern-card">
        <h4>Сегодня vs удачные</h4>
        <div class="pattern-stat"><span>Σ дождя</span><span class="value">${todayScore.rain10d} мм ${compareSign(todayScore.rain10d, sStats.rain10d)}</span></div>
        <div class="pattern-stat"><span>Влажн. почвы</span><span class="value">${todayScore.soilM} ${compareSign(todayScore.soilM, sStats.soilM)}</span></div>
        <div class="pattern-stat"><span>T почвы</span><span class="value">${todayScore.soilT} ${compareSign(todayScore.soilT, sStats.soilT)}</span></div>
      </div>` : ''}
      ${Object.keys(byMonth).length ? `<div class="pattern-card"><h4>По месяцам</h4>${Object.entries(byMonth).sort((a, b) => a[0] - b[0]).map(([m, c]) => `<div class="pattern-stat"><span>${monthNames[m - 1]}</span><span class="value">${c}</span></div>`).join('')}</div>` : ''}
      ${Object.keys(bySpecies).length ? `<div class="pattern-card"><h4>По видам</h4>${Object.entries(bySpecies).sort((a, b) => b[1] - a[1]).map(([s, c]) => `<div class="pattern-stat"><span>${s}</span><span class="value">${c}</span></div>`).join('')}</div>` : ''}
    </div>

    ${buildAccuracyBlock(validationRows, accuracy)}
    ${buildSpeciesAccuracyBlock(validationRows)}

    <h3 style="margin-top:28px">Фенологический календарь</h3>
    <div id="phenologyCalendarWrap"></div>

    <h3 style="margin-top:28px">Валидация модели <span class="count">${validationRows.length} зап.${accuracy !== null ? ` · точность ${accuracy}%` : ''}</span></h3>
    <div class="checklist" style="padding:0;overflow:hidden"><table class="validation-table">
      <thead><tr><th>Дата</th><th>Локация</th><th>Прогноз</th><th>Факт</th><th>Условия</th><th>✓</th></tr></thead>
      <tbody>${validationRows.map(r => {
        const dt = new Date(r.d.date);
        const dateStr = `${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getFullYear()).slice(2)}`;
        const outcomeLbl = r.actualIsSuccess ? `<span class="quantity-badge ${r.d.quantity}">${{little:'мало',some:'средне',many:'много',jackpot:'джекпот'}[r.d.quantity]}</span>` : `<span class="quantity-badge none">пусто</span>`;
        return `<tr>
          <td>${dateStr}</td>
          <td style="font-size:12px">${r.locName}</td>
          <td><span class="score-pill ${r.predStatus}">${r.predScore}</span></td>
          <td>${outcomeLbl}</td>
          <td style="font-size:11px;font-family:monospace;color:#6B5F52">${r.d.conditions.rain10d}мм · ${r.d.conditions.soilM} · ${r.d.conditions.soilT}°</td>
          <td style="text-align:center"><span class="match-icon ${r.match ? 'match-ok' : 'match-off'}">${r.match ? '✓' : '✗'}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  // Render phenology calendar after innerHTML is set
  renderPhenologyCalendar();
}

function buildSpeciesAccuracyBlock(rows) {
  // Group days by species, compute accuracy per species
  const bySpecies = {};
  rows.forEach(r => {
    (r.d.species || []).forEach(sp => {
      if (!bySpecies[sp]) bySpecies[sp] = { total: 0, correct: 0, over: 0, under: 0 };
      if (r.predStatus === 'yellow') return;
      bySpecies[sp].total++;
      if (r.match) bySpecies[sp].correct++;
      else if (r.predStatus === 'green' && !r.actualIsSuccess) bySpecies[sp].over++;
      else if (r.predStatus === 'red' && r.actualIsSuccess) bySpecies[sp].under++;
    });
  });

  const entries = Object.entries(bySpecies).filter(([, v]) => v.total >= 2).sort((a, b) => b[1].total - a[1].total);
  if (entries.length === 0) return '';

  const spRows = entries.map(([sp, v]) => {
    const pct = Math.round((v.correct / v.total) * 100);
    const color = pct >= 75 ? '#4A7C3A' : pct >= 50 ? '#B88A2C' : '#A04A3A';
    return `<div class="accuracy-bar-row">
      <span style="width:130px;font-size:12px;color:#4A3F35">${sp}</span>
      <div class="accuracy-bar"><div class="accuracy-fill" style="width:${pct}%;background:${color}"></div></div>
      <span style="font-size:12px;min-width:52px;color:#6B5F52">${pct}% (${v.correct}/${v.total})</span>
    </div>`;
  }).join('');

  return `<div class="accuracy-card" style="margin-top:12px">
    <h4>Точность по видам</h4>
    ${spRows}
    <div class="accuracy-note">Только безжёлтые дни · минимум 2 записи на вид</div>
  </div>`;
}

function buildAccuracyBlock(rows, accuracy) {
  const strict = rows.filter(r => r.predStatus !== 'yellow');
  if (strict.length < 2) return `<div class="accuracy-card"><h4>Точность модели</h4><p style="font-size:13px;color:#8A7C6B;margin:0">Недостаточно данных. Добавьте больше дней (в т.ч. пустых), чтобы увидеть статистику.</p></div>`;

  const overestimates = strict.filter(r => r.predStatus === 'green' && !r.actualIsSuccess);
  const underestimates = strict.filter(r => r.predStatus === 'red' && r.actualIsSuccess);
  const correct = strict.filter(r => r.match);
  const total = strict.length;
  const pct = Math.round((correct.length / total) * 100);
  const overPct = Math.round((overestimates.length / total) * 100);
  const underPct = Math.round((underestimates.length / total) * 100);

  let advice = '';
  if (overestimates.length > underestimates.length && overestimates.length >= 2) {
    advice = `Модель чаще <strong>завышает</strong> прогноз (${overPct}% случаев — зелёный, а грибов не было). Попробуйте поднять <code>threshold.green</code> в <code>config.js</code> с 70 до 75–80.`;
  } else if (underestimates.length > overestimates.length && underestimates.length >= 2) {
    advice = `Модель чаще <strong>занижает</strong> прогноз (${underPct}% случаев — красный, а грибы были). Попробуйте снизить <code>threshold.green</code> до 60–65.`;
  } else if (pct >= 80) {
    advice = `Модель хорошо откалибрована: ${pct}% совпадений. Продолжайте собирать данные для подтверждения.`;
  } else {
    advice = `Ошибки распределены равномерно — модель неплохо сбалансирована, но данных пока мало для уверенных выводов.`;
  }

  const barW = (n) => Math.round((n / total) * 100);

  return `<div class="accuracy-card">
    <h4>Точность модели · ${pct}% (${correct.length}/${total} безжёлтых дней)</h4>
    <div class="accuracy-bar-row">
      <span style="width:100px;font-size:12px">✓ Верно</span>
      <div class="accuracy-bar"><div class="accuracy-fill" style="width:${barW(correct.length)}%;background:#4A7C3A"></div></div>
      <span style="font-size:12px;min-width:28px">${correct.length}</span>
    </div>
    <div class="accuracy-bar-row">
      <span style="width:100px;font-size:12px">↑ Завышено</span>
      <div class="accuracy-bar"><div class="accuracy-fill" style="width:${barW(overestimates.length)}%;background:#B45441"></div></div>
      <span style="font-size:12px;min-width:28px">${overestimates.length}</span>
    </div>
    <div class="accuracy-bar-row">
      <span style="width:100px;font-size:12px">↓ Занижено</span>
      <div class="accuracy-bar"><div class="accuracy-fill" style="width:${barW(underestimates.length)}%;background:#D29A3C"></div></div>
      <span style="font-size:12px;min-width:28px">${underestimates.length}</span>
    </div>
    <div class="accuracy-note">💡 ${advice}</div>
  </div>`;
}

// =========================
// Phenology calendar
// =========================
function renderPhenologyCalendar() {
  const wrap = document.getElementById('phenologyCalendarWrap');
  if (!wrap) return;

  const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const currentMonth = new Date().getMonth() + 1; // 1-based

  // Get species that have peakMonths defined + any user species in their days
  const configSpecies = Object.entries(CONFIG.speciesConfig)
    .filter(([, cfg]) => cfg.peakMonths?.length)
    .map(([name, cfg]) => ({ name, peakMonths: cfg.peakMonths, emoji: cfg.emoji || '🍄', note: cfg.note || '' }));

  if (configSpecies.length === 0) {
    wrap.innerHTML = '<p style="font-size:13px;color:#8A7C6B">Нет видов с данными о сезоне.</p>';
    return;
  }

  const headerCells = monthNames.map((m, i) => {
    const active = (i + 1) === currentMonth;
    return `<div class="pheno-header${active ? ' pheno-now' : ''}">${m}</div>`;
  }).join('');

  const rows = configSpecies.map(sp => {
    const cells = monthNames.map((_, i) => {
      const m = i + 1;
      const isPeak = sp.peakMonths.includes(m);
      const isCurrent = m === currentMonth;
      return `<div class="pheno-cell${isPeak ? ' pheno-peak' : ''}${isCurrent ? ' pheno-now-col' : ''}"></div>`;
    }).join('');
    return `<div class="pheno-row">
      <div class="pheno-species-name" title="${sp.note}">${sp.name}</div>
      ${cells}
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="pheno-table">
      <div class="pheno-row pheno-head-row">
        <div class="pheno-species-name"></div>${headerCells}
      </div>
      ${rows}
    </div>
    <div style="margin-top:8px;font-size:11px;color:#8A7C6B">
      <span class="pheno-peak-legend"></span> Пик сезона &nbsp;
      <span style="border-left:2px solid #B45441;display:inline-block;height:10px;vertical-align:middle;margin-right:3px"></span> Сейчас
    </div>`;
}

function compareSign(a, b) {
  const diff = ((a - b) / b) * 100;
  if (Math.abs(diff) < 10) return '<span style="color:#4A7C3A;font-size:11px">≈</span>';
  if (diff > 0) return `<span style="color:#B88A2C;font-size:11px">+${diff.toFixed(0)}%</span>`;
  return `<span style="color:#A04A3A;font-size:11px">${diff.toFixed(0)}%</span>`;
}

// =========================
// Settings modal (Gist, password, export/import)
// =========================
function openSettings() {
  const s = getSettings();
  const mobileStatus = s.gistId
    ? (CONFIG.gistId
        ? `<div class="form-hint" style="color:#4A7C3A;margin-top:6px">✓ Мобильный доступ настроен (config.js уже содержит Gist ID)</div>`
        : `<div class="form-hint" style="background:#FFF7E6;border:1px solid #D29A3C;border-radius:6px;padding:8px 10px;margin-top:6px">
            📱 <b>Мобильный доступ без токена:</b> скопируйте ID в <code>config.js</code> → <code>gistId: "..."</code> и задеплойте.<br>
            <code style="font-size:11px;word-break:break-all">${s.gistId}</code>
            <button class="btn ghost" style="padding:2px 8px;margin-left:6px;font-size:11px" onclick="navigator.clipboard.writeText('${s.gistId}').then(()=>window.app.showToast('ID скопирован!'))">📋</button>
          </div>`)
    : '';
  openModal(`
    <h3>Настройки</h3>
    <div class="form-row">
      <label>GitHub Personal Access Token (scope: gist)</label>
      <input id="setToken" type="password" value="${s.token || ''}" placeholder="ghp_...">
      <div class="form-hint">Создать: github.com/settings/tokens → Fine-grained → Access: только Gists → Permissions: Gists (R/W). Токен хранится локально и не покидает устройство (кроме api.github.com).</div>
    </div>
    <div class="form-row">
      <label>Gist ID (создаётся автоматически или вставьте существующий)</label>
      <input id="setGistId" value="${s.gistId || ''}" placeholder="abc123def456...">
      ${mobileStatus}
      <div id="newGistHint" style="display:none"></div>
    </div>
    <div style="display:flex;gap:8px;margin:14px 0">
      <button class="btn" onclick="window.app.saveSettingsAndCreateGist()">💾 Сохранить и создать Gist</button>
      <button class="btn" onclick="window.app.pullFromGist()">⬇ Подтянуть из Gist</button>
    </div>
    <hr style="border:none;border-top:1px solid #E6DECC;margin:20px 0">
    <h4 style="margin:0 0 10px">Экспорт/импорт</h4>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" onclick="window.app.exportJson()">📋 Скопировать все данные</button>
      <button class="btn" onclick="window.app.openImportModal()">📥 Импорт из JSON</button>
    </div>
    <hr style="border:none;border-top:1px solid #E6DECC;margin:20px 0">
    <button class="btn danger" onclick="window.app.doLogout()">🔒 Выйти</button>
    <div class="modal-actions"><button class="btn primary" onclick="window.app.closeModal()">Закрыть</button></div>
  `);
}

async function saveSettingsAndCreateGist() {
  const token = document.getElementById('setToken').value.trim();
  let gistId = document.getElementById('setGistId').value.trim();
  if (!token) { alert('Нужен токен'); return; }
  try {
    if (!gistId) {
      gistId = await createGist(token, state);
      // Update input and show prominent copy hint for mobile setup
      document.getElementById('setGistId').value = gistId;
      const hint = document.getElementById('newGistHint');
      if (hint) {
        hint.style.display = 'block';
        hint.innerHTML = `
          <div style="background:#EDF7ED;border:1px solid #4A7C3A;border-radius:6px;padding:10px;margin-top:8px">
            <b>✅ Gist создан!</b><br>
            <code style="font-size:11px;word-break:break-all">${gistId}</code>
            <button class="btn ghost" style="padding:2px 8px;margin-left:6px;font-size:11px"
              onclick="navigator.clipboard.writeText('${gistId}').then(()=>window.app.showToast('ID скопирован!'))">📋</button><br>
            <small style="color:#555">📱 Для телефона без токена: вставьте ID в <code>config.js</code> → <code>gistId: "${gistId}"</code> и задеплойте снова.</small>
          </div>`;
      }
    }
    saveSettings({ token, gistId });
    showToast('Настройки сохранены — автосинк включён');
    // Don't close if newly created — let user copy the Gist ID
    if (document.getElementById('newGistHint')?.style.display === 'none') closeModal();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function pullFromGist() {
  const token = document.getElementById('setToken').value.trim();
  const gistId = document.getElementById('setGistId').value.trim();
  if (!token || !gistId) { alert('Нужны токен и Gist ID'); return; }
  try {
    const remote = await pullGist(token, gistId);
    if (remote && confirm('Перезаписать локальные данные данными из Gist?')) {
      state = remote;
      saveAndSync(state);
      saveSettings({ token, gistId });
      closeModal();
      renderAll();
      showToast('Данные подтянуты из Gist');
    }
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

function exportJson() {
  const text = JSON.stringify(state, null, 2);
  navigator.clipboard.writeText(text).then(() => showToast('Скопировано')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('Скопировано');
  });
}

function openImportModal() {
  openModal(`
    <h3>Импорт из JSON</h3>
    <div class="form-row"><label>Вставьте JSON</label><textarea class="sync-box" id="importBox"></textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="window.app.closeModal()">Отмена</button>
      <button class="btn primary" onclick="window.app.doImport()">Импортировать</button>
    </div>
  `);
}

function doImport() {
  try {
    const data = JSON.parse(document.getElementById('importBox').value);
    if (!data.locations) throw new Error('Нет поля locations');
    state = data;
    saveAndSync(state);
    closeModal();
    renderAll();
    showToast('Импортировано');
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

function doLogout() {
  if (!confirm('Выйти и удалить сохранённый пароль с этого устройства?')) return;
  logout();
}

// =========================
// Modal, toast, tabs
// =========================
function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'dashboard') renderDashboard();
  if (name === 'locations') renderLocations();
  if (name === 'days') renderDays();
  if (name === 'patterns') renderPatterns();
}

function attachEventHandlers() {
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.getElementById('locationSelector').addEventListener('change', e => { state.activeLocationId = e.target.value; saveAndSync(state); renderDashboard(); });
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  window.addEventListener('gist-synced', () => showSyncStatus('ok'));
  window.addEventListener('gist-error', e => showSyncStatus('err', e.detail));
}

function showSyncStatus(status, msg) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  if (status === 'ok') { el.textContent = `☁ Синк: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`; el.style.color = '#4A7C3A'; }
  else { el.textContent = `⚠ ${msg || 'ошибка синка'}`; el.style.color = '#B45441'; }
}

function showForecastModal(idx) {
  const r = forecastDays[idx];
  if (!r) return;
  const loc = state.locations.find(l => l.id === state.activeLocationId) || state.locations[0];
  const w = loc && state.weather[loc.id];
  if (!w) return;

  const dt = new Date(w.fc.dates[idx]);
  const wdays = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const dateStr = `${wdays[dt.getDay()]}, ${dt.getDate()}.${String(dt.getMonth()+1).padStart(2,'0')}`;
  const dotColor = r.status === 'green' ? '#4A7C3A' : r.status === 'yellow' ? '#D29A3C' : '#B45441';
  const dotIcon = r.status === 'green' ? '▲' : r.status === 'yellow' ? '●' : '✕';

  const speciesHtml = r.allSpecies?.length
    ? `<div style="margin:14px 0 0">${r.allSpecies.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #F2EBDA">
          <span style="font-size:13px;color:#4A3F35">${s.species}${s.isPeak ? ' 🌟' : ''}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:#A89880">↯ ${s.triggerScore}</span>
            <span class="score-pill ${s.status}">${s.score}</span>
          </div>
        </div>`).join('')}</div>`
    : '';

  const hintHtml = r.hint
    ? `<div style="background:#F7F3EB;border-radius:8px;padding:12px 14px;margin-top:14px;font-size:13px;line-height:1.8">${r.hint}</div>`
    : '';

  // Parameter bars: how each factor scores against model thresholds
  const bestSp = r.allSpecies?.[0];
  const paramConditions = {
    rain10d: r.rain10d, soilM: r.soilM, soilT: r.soilT,
    tMax: w.fc.tMax[idx], tMin: w.fc.tMin[idx]
  };
  const paramScores = conditionsToRadar(paramConditions, bestSp?.species || null);
  const paramDefs = [
    { label: '💧 Дождь 10 дн', value: `${r.rain10d} мм`,    score: paramScores[0] },
    { label: '🌱 Влажность почвы', value: r.soilM.toFixed(2), score: paramScores[1] },
    { label: '🌍 Темп. почвы',  value: `${r.soilT}°`,        score: paramScores[2] },
    { label: '🌡 Темп. день',   value: `${w.fc.tMax[idx].toFixed(0)}°`,score: paramScores[3] },
    { label: '🌙 Темп. ночь',   value: `${w.fc.tMin[idx].toFixed(0)}°`,score: paramScores[4] },
  ];
  const paramColor = s => s >= 80 ? '#4A7C3A' : s >= 40 ? '#D29A3C' : '#B45441';
  const paramBarsHtml = `<div style="margin-top:16px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#8A7C6B;margin-bottom:8px">Условия</div>
    ${paramDefs.map(p => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <span style="font-size:12px;color:#4A3F35;width:130px;flex-shrink:0">${p.label}</span>
        <div style="flex:1;height:7px;background:#F2EBDA;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${p.score}%;background:${paramColor(p.score)};border-radius:4px;transition:width 0.4s"></div>
        </div>
        <span style="font-size:11px;color:#6B5F52;width:42px;text-align:right">${p.value}</span>
      </div>`).join('')}
  </div>`;

  openModal(`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:4px">
      <div style="width:50px;height:50px;border-radius:50%;background:${dotColor};display:flex;align-items:center;justify-content:center;color:white;font-size:13px;font-weight:700;flex-shrink:0">${dotIcon} ${r.score}</div>
      <div>
        <div style="font-size:19px;font-family:Georgia,serif;font-weight:500">${dateStr}</div>
        <div style="font-size:13px;color:#6B5F52">${w.fc.tMax[idx].toFixed(0)}° / ${w.fc.tMin[idx].toFixed(0)}° · 💧 ${w.fc.rain[idx]} мм · Tп ${r.soilT}°${w.fc.wind?.[idx] != null ? ` · 💨 ${Math.round(w.fc.wind[idx])} км/ч` : ''}${w.fc.humidity?.[idx] != null ? ` · 💦 ${Math.round(w.fc.humidity[idx])}%` : ''}</div>
      </div>
    </div>
    ${speciesHtml ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#8A7C6B;margin-top:16px;margin-bottom:2px">Виды <span style="color:#A89880;font-weight:400;text-transform:none">↯ = скор триггера</span></div>${speciesHtml}` : ''}
    ${paramBarsHtml}
    ${hintHtml}
    <div class="modal-actions"><button class="btn primary" onclick="window.app.closeModal()">Закрыть</button></div>
  `);
}

function renderAll() {
  document.getElementById('dataDate').textContent = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('locCount').textContent = `${state.locations.length} лок · ${state.mushroomDays.length} дн`;
  renderDashboard();
  renderLocations();
  renderDays();
  renderPatterns();
}

// Expose for inline onclick= handlers
function setAlgoMode(mode) {
  if (mode !== 'classic' && mode !== 'mdi') return;
  scoringMode = mode;
  // Обновить кнопки переключателя
  document.querySelectorAll('.asw-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  renderDashboard();
}

/**
 * Загрузить наблюдения iNaturalist рядом с активной локацией.
 * При 0 результатов — показывает кнопки расширения радиуса и периода.
 * @param {number} radius  Радиус поиска в км (по умолчанию 5)
 * @param {number} days    Период поиска в днях (по умолчанию 10)
 */
async function loadInatObservations(radius = 5, days = 10) {
  const btn = document.getElementById('inatObsBtn');
  const panel = document.getElementById('inatPanel');
  if (!btn || !panel) return;

  const loc = state.locations.find(l => l.id === state.activeLocationId) || state.locations[0];
  if (!loc) return;

  btn.disabled = true;
  btn.textContent = '⏳ Загружаю…';
  panel.style.display = '';
  panel.innerHTML = '<span class="inat-empty">Запрашиваю данные iNaturalist…</span>';

  try {
    const species = loc.species?.length ? loc.species : Object.keys(CONFIG.speciesConfig || {});
    const data = await fetchMushroomObservations(loc.lat, loc.lon, species, radius, days);

    let html = `<h4>🔭 Наблюдения iNaturalist — ${data.radiusKm} км, ${data.dateRange}</h4>`;

    if (data.matched.length > 0) {
      html += `<div style="margin-bottom:10px">`;
      const maxCount = Math.max(...data.matched.map(x => x.count), 1);
      for (const m of data.matched) {
        const pct = Math.round((m.count / maxCount) * 100);
        html += `<div class="inat-match-row">
          <span class="inat-sp-name">${m.species}</span>
          <span class="inat-taxon">${m.taxon}</span>
          <div class="inat-bar-wrap"><div class="inat-bar" style="width:${pct}%"></div></div>
          <span class="inat-count">${m.count}</span>
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="inat-empty">Совпадений с вашими видами не найдено.</div>`;
    }

    if (data.nearby.length > 0) {
      html += `<details style="margin-top:8px"><summary style="font-size:12px;color:#8A7C6B;cursor:pointer">Другие грибы в районе (${data.nearby.length})</summary>`;
      for (const n of data.nearby) {
        html += `<div class="inat-match-row">
          <span class="inat-sp-name" style="font-style:italic">${n.taxon}</span>
          <span class="inat-count">${n.count}</span>
        </div>`;
      }
      html += `</details>`;
    }

    html += `<div class="inat-meta">Всего грибов в радиусе: ${data.total}. Только research-grade наблюдения.</div>`;

    // Если совсем ничего нет — предлагаем расширить
    if (data.total === 0) {
      html += `<div class="inat-expand-block">
        <div class="inat-expand-label">Ничего не найдено. Расширить поиск?</div>
        <div class="inat-expand-row">
          <span class="inat-expand-hint">📍 Радиус:</span>`;
      for (const r of [15, 30, 50]) {
        if (r > radius) {
          html += `<button class="btn sm inat-expand-btn" onclick="window.app.loadInatObservations(${r},${days})">${r} км</button>`;
        }
      }
      html += `</div><div class="inat-expand-row">
          <span class="inat-expand-hint">📅 Период:</span>`;
      for (const d of [20, 30]) {
        if (d > days) {
          html += `<button class="btn sm inat-expand-btn" onclick="window.app.loadInatObservations(${radius},${d})">${d} дн</button>`;
        }
      }
      html += `</div></div>`;
    }

    panel.innerHTML = html;

  } catch (e) {
    panel.innerHTML = `<span class="inat-empty">Ошибка: ${e.message}. Попробуйте позже.</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = `🔍 Наблюдения iNat (${radius} км / ${days} дней)`;
  }
}

/**
 * Переключатель тёмной/светлой темы.
 * Цикл: авто (системная) → тёмная → светлая → авто
 * Сохраняется в localStorage.theme.
 */
function toggleTheme() {
  const html = document.documentElement;
  const cur = localStorage.getItem('theme'); // null | 'dark' | 'light'
  let next;
  if (!cur) {
    next = 'dark';
  } else if (cur === 'dark') {
    next = 'light';
  } else {
    next = null; // авто
  }
  html.classList.remove('dark', 'light');
  if (next) {
    html.classList.add(next);
    localStorage.setItem('theme', next);
  } else {
    localStorage.removeItem('theme');
  }
  // Обновить иконку кнопки
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : next === 'light' ? '🔆' : '🌙';
  // Перерисовать графики (цвета осей зависят от темы)
  renderDashboard();
}

/** Синхронизировать иконку кнопки с текущим состоянием темы при загрузке. */
function initThemeToggle() {
  const t = localStorage.getItem('theme');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : t === 'light' ? '🔆' : '🌙';
}

window.app = {
  setActive, openLocationForm, saveLocation, deleteLocation, syncBiotope, syncForestType,
  openDayForm, saveDay, deleteDay, syncHistoricalForDay,
  syncAllHistorical, syncAllWeather,
  previewDayScore,
  addCustomSpeciesFromInput, removeCustomSpecies,
  openSettings, saveSettingsAndCreateGist, pullFromGist,
  exportJson, openImportModal, doImport, doLogout,
  closeModal, showToast, showForecastModal,
  setPatternRef,
  toggleForecastView,
  setAlgoMode,
  loadInatObservations,
  toggleTheme
};

// Boot
init();
