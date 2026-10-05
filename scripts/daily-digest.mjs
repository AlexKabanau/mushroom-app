#!/usr/bin/env node
// Daily digest: fetch Gist → compute score for each location → email via Resend
// Runs on GitHub Actions cron at 04:00 UTC (07:00 Minsk)

import { scoreFromConditions, statusFromScore, projectDayScore } from '../js/scoring.js';

const {
  GIST_TOKEN,
  GIST_ID,
  RESEND_API_KEY,
  EMAIL_TO,
  EMAIL_FROM = 'Mushroom Light <onboarding@resend.dev>'
} = process.env;

if (!GIST_TOKEN || !GIST_ID || !RESEND_API_KEY || !EMAIL_TO) {
  console.error('Missing env: GIST_TOKEN, GIST_ID, RESEND_API_KEY, EMAIL_TO required');
  process.exit(1);
}

const TZ = 'Europe/Moscow';
const dayStr = d => d.toISOString().slice(0, 10);

async function pullGist() {
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { 'Authorization': `Bearer ${GIST_TOKEN}`, 'Accept': 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error(`Gist fetch failed: ${r.status}`);
  const gist = await r.json();
  const file = gist.files['mushroom-config.json'];
  if (!file) throw new Error('No mushroom-config.json in Gist');
  if (file.truncated) {
    const raw = await fetch(file.raw_url).then(r => r.text());
    return JSON.parse(raw);
  }
  return JSON.parse(file.content);
}

async function fetchWeather(lat, lon) {
  const today = new Date();
  const start = new Date(today); start.setDate(start.getDate() - 30);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dayStr(start)}&end_date=${dayStr(yesterday)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,soil_temperature_7_to_28cm_mean,soil_moisture_7_to_28cm_mean&timezone=${encodeURIComponent(TZ)}`;
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&past_days=1&forecast_days=14&timezone=${encodeURIComponent(TZ)}`;

  const [archive, forecast] = await Promise.all([
    fetch(archiveUrl).then(r => r.json()),
    fetch(forecastUrl).then(r => r.json())
  ]);

  const hist = {
    dates: archive.daily.time,
    rain: archive.daily.precipitation_sum,
    soilM: archive.daily.soil_moisture_7_to_28cm_mean,
    soilT: archive.daily.soil_temperature_7_to_28cm_mean
  };
  const todayStr = dayStr(today);
  const fcAllDates = forecast.daily.time;
  const todayIdx = fcAllDates.indexOf(todayStr);
  const slice = todayIdx >= 0 ? todayIdx : 1;
  const fc = {
    dates: fcAllDates.slice(slice, slice + 10),
    tMax: forecast.daily.temperature_2m_max.slice(slice, slice + 10),
    tMin: forecast.daily.temperature_2m_min.slice(slice, slice + 10),
    rain: forecast.daily.precipitation_sum.slice(slice, slice + 10)
  };
  return { hist, fc };
}

function formatDate(iso) {
  const dt = new Date(iso);
  const names = ['вс','пн','вт','ср','чт','пт','сб'];
  return `${names[dt.getDay()]} ${dt.getDate()}.${String(dt.getMonth()+1).padStart(2,'0')}`;
}

function statusEmoji(status) { return { green: '🟢', yellow: '🟡', red: '🔴' }[status] || '⚪'; }

async function run() {
  console.log('Pulling Gist...');
  const config = await pullGist();
  console.log(`Loaded ${config.locations.length} locations.`);

  const results = [];
  for (const loc of config.locations) {
    try {
      console.log(`Fetching weather for ${loc.name}...`);
      const w = await fetchWeather(loc.lat, loc.lon);
      const todayScore = projectDayScore(w.hist, w.fc, 0);
      const next7 = Array.from({ length: Math.min(7, w.fc.dates.length) }, (_, i) => ({
        idx: i,
        date: w.fc.dates[i],
        label: formatDate(w.fc.dates[i]),
        ...projectDayScore(w.hist, w.fc, i)
      }));
      const best = next7.reduce((a, b) => (b.score > a.score ? b : a), next7[0]);
      results.push({ loc, todayScore, next7, best });
    } catch (e) {
      console.error(`Failed for ${loc.name}:`, e.message);
      results.push({ loc, error: e.message });
    }
  }

  const subject = buildSubject(results);
  const html = buildHtml(results, config);
  await sendEmail(subject, html);
  console.log('Digest sent.');
}

function buildSubject(results) {
  const best = results
    .filter(r => !r.error)
    .reduce((a, b) => (b.todayScore.score > (a?.todayScore.score ?? -1) ? b : a), null);
  if (!best) return `🍄 Грибной светофор — ошибка загрузки`;
  const emoji = statusEmoji(best.todayScore.status);
  return `${emoji} Грибной светофор: ${best.loc.name} — ${best.todayScore.score}/100`;
}

function buildHtml(results, config) {
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  const rows = results.map(r => {
    if (r.error) {
      return `<tr><td colspan="4" style="padding:10px;color:#B45441">⚠ ${r.loc.name}: ${r.error}</td></tr>`;
    }
    const emoji = statusEmoji(r.todayScore.status);
    const bestEmoji = statusEmoji(r.best.status);
    return `
      <tr style="border-top:1px solid #E6DECC">
        <td style="padding:14px 10px"><strong style="font-family:Georgia,serif">${emoji} ${r.loc.name}</strong><br>
          <span style="font-size:12px;color:#6B5F52;font-family:monospace">${r.loc.lat.toFixed(4)}, ${r.loc.lon.toFixed(4)}</span></td>
        <td style="padding:14px 10px;text-align:center">
          <div style="font-size:28px;font-family:Georgia,serif;font-weight:500">${r.todayScore.score}</div>
          <div style="font-size:11px;color:#6B5F52">score сегодня</div>
        </td>
        <td style="padding:14px 10px;font-size:12px;color:#4A3F35;font-family:monospace">
          Σ дождя 10дн: ${r.todayScore.rain10d} мм<br>
          Влажн. почвы: ${r.todayScore.soilM}<br>
          T почвы: ${r.todayScore.soilT} °C
        </td>
        <td style="padding:14px 10px;text-align:center">
          <strong>${bestEmoji} ${r.best.label}</strong><br>
          <span style="font-size:12px;color:#6B5F52">score ${r.best.score}</span>
        </td>
      </tr>
    `;
  }).join('');

  const forecastGrid = results.filter(r => !r.error).map(r => {
    const cells = r.next7.map(d => {
      const color = { green: '#4A7C3A', yellow: '#D29A3C', red: '#B45441' }[d.status];
      return `<td style="padding:6px 4px;text-align:center;border-left:3px solid ${color};background:white;font-size:11px">
        <div style="color:#8A7C6B;font-size:10px">${d.label}</div>
        <div style="font-family:Georgia,serif;font-size:16px;color:#2D2621">${d.score}</div>
      </td>`;
    }).join('');
    return `
      <div style="margin:14px 0">
        <div style="font-size:12px;color:#6B5F52;margin-bottom:4px">${r.loc.name}</div>
        <table style="border-collapse:collapse;width:100%"><tr>${cells}</tr></table>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#FAF6EC;margin:0;padding:20px;color:#2D2621">
<div style="max-width:600px;margin:0 auto;background:white;padding:28px 24px;border-radius:12px;border:1px solid #E6DECC">
  <h1 style="font-family:Georgia,serif;margin:0 0 4px 0;font-weight:400;font-size:26px">🍄 Грибной светофор</h1>
  <div style="color:#6B5F52;font-size:13px;margin-bottom:20px">${date}</div>

  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#8A7C6B">
        <th style="text-align:left;padding:0 10px 10px">Локация</th>
        <th style="padding:0 10px 10px">Сегодня</th>
        <th style="padding:0 10px 10px">Условия</th>
        <th style="padding:0 10px 10px">Лучший день</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h3 style="font-family:Georgia,serif;margin:28px 0 10px;font-weight:500;font-size:17px">Прогноз на 7 дней</h3>
  ${forecastGrid}

  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #E6DECC;font-size:11px;color:#8A7C6B;line-height:1.6">
    Данные: open-meteo + ваш Gist · Scoring: температура почвы (8–14°C), влажность почвы (0.25–0.40), осадки за 10 дней (15–40 мм).<br>
    Откройте полное приложение: <a href="${process.env.APP_URL || '#'}" style="color:#4A7C3A">грибной светофор</a>
  </div>
</div>
</body></html>`;
}

async function sendEmail(subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject,
      html
    })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Resend failed: ${r.status} ${err}`);
  }
  return r.json();
}

run().catch(e => { console.error(e); process.exit(1); });
