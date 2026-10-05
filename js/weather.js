// Weather fetching from open-meteo (public API, CORS-enabled)
import { CONFIG } from './config.js';

/** YYYY-MM-DD */
function dayStr(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetch 30 days of historical weather + 14 days of forecast for a location.
 */
export async function fetchWeather(lat, lon) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const archiveUrl = `${CONFIG.endpoints.openMeteoArchive}?latitude=${lat}&longitude=${lon}&start_date=${dayStr(start)}&end_date=${dayStr(yesterday)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,soil_temperature_7_to_28cm_mean,soil_moisture_7_to_28cm_mean&timezone=${encodeURIComponent(CONFIG.timezone)}`;

  const forecastUrl = `${CONFIG.endpoints.openMeteoForecast}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean&past_days=1&forecast_days=14&timezone=${encodeURIComponent(CONFIG.timezone)}`;

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

  // Forecast returns past_days=1 + 14 forecast days = 15 items. We want today onwards (10 days).
  const todayStr = dayStr(today);
  const fcAllDates = forecast.daily.time;
  const todayIdx = fcAllDates.indexOf(todayStr);
  const slice = todayIdx >= 0 ? todayIdx : 1;
  const fc = {
    dates: fcAllDates.slice(slice, slice + 10),
    tMax: forecast.daily.temperature_2m_max.slice(slice, slice + 10),
    tMin: forecast.daily.temperature_2m_min.slice(slice, slice + 10),
    rain: forecast.daily.precipitation_sum.slice(slice, slice + 10),
    humidity: forecast.daily.relative_humidity_2m_mean.slice(slice, slice + 10)
  };

  return {
    hist, fc,
    elevation: forecast.elevation,
    asOf: todayStr
  };
}

/**
 * Fetch historical conditions for a specific date (for mushroom day analysis).
 * Returns { soilM, soilT, rain10d, rain30d, tMax, tMin, humidity }
 */
export async function fetchHistoricalConditions(lat, lon, date) {
  const target = new Date(date);
  const start = new Date(target);
  start.setDate(start.getDate() - 30);

  const url = `${CONFIG.endpoints.openMeteoArchive}?latitude=${lat}&longitude=${lon}&start_date=${dayStr(start)}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,soil_temperature_7_to_28cm_mean,soil_moisture_7_to_28cm_mean,relative_humidity_2m_mean&timezone=${encodeURIComponent(CONFIG.timezone)}`;

  const data = await fetch(url).then(r => r.json());
  const daily = data.daily;
  const n = daily.time.length;
  if (n === 0) return null;

  const dayIdx = daily.time.indexOf(date);
  if (dayIdx < 0) return null;

  const last10Rain = daily.precipitation_sum.slice(Math.max(0, dayIdx - 9), dayIdx + 1).reduce((a, b) => a + b, 0);
  const last30Rain = daily.precipitation_sum.slice(0, dayIdx + 1).reduce((a, b) => a + b, 0);

  return {
    soilM: parseFloat(daily.soil_moisture_7_to_28cm_mean[dayIdx]?.toFixed(3) ?? 0),
    soilT: parseFloat(daily.soil_temperature_7_to_28cm_mean[dayIdx]?.toFixed(1) ?? 0),
    rain10d: parseFloat(last10Rain.toFixed(1)),
    rain30d: parseFloat(last30Rain.toFixed(1)),
    tMax: parseFloat(daily.temperature_2m_max[dayIdx]?.toFixed(1) ?? 0),
    tMin: parseFloat(daily.temperature_2m_min[dayIdx]?.toFixed(1) ?? 0),
    humidity: Math.round(daily.relative_humidity_2m_mean?.[dayIdx] ?? 0)
  };
}
