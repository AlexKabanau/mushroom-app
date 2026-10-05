// GitHub Gist sync — stores app state in a private Gist
import { CONFIG } from './config.js';

const FILENAME = 'mushroom-config.json';
const SETTINGS_KEY = 'mushroom-gist-settings';

export function getSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export async function createGist(token, initialData) {
  const r = await fetch(`${CONFIG.endpoints.github}/gists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description: 'Mushroom Traffic Light — personal foraging data',
      public: false,
      files: { [FILENAME]: { content: JSON.stringify(initialData, null, 2) } }
    })
  });
  if (!r.ok) throw new Error(`Gist create failed: ${r.status}`);
  const gist = await r.json();
  return gist.id;
}

export async function pullGist(token, gistId) {
  const r = await fetch(`${CONFIG.endpoints.github}/gists/${gistId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  if (!r.ok) throw new Error(`Gist pull failed: ${r.status}`);
  const gist = await r.json();
  const file = gist.files[FILENAME];
  if (!file) return null;
  // Large files might be truncated; use raw URL
  if (file.truncated) {
    const raw = await fetch(file.raw_url).then(r => r.text());
    return JSON.parse(raw);
  }
  return JSON.parse(file.content);
}

export async function pushGist(token, gistId, data) {
  data.updatedAt = new Date().toISOString();
  const r = await fetch(`${CONFIG.endpoints.github}/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: { [FILENAME]: { content: JSON.stringify(data, null, 2) } }
    })
  });
  if (!r.ok) throw new Error(`Gist push failed: ${r.status}`);
  return true;
}

// Debounced auto-sync
let syncTimer = null;
export function scheduleSync(getData, delay = 2000) {
  const { token, gistId } = getSettings();
  if (!token || !gistId) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await pushGist(token, gistId, getData());
      window.dispatchEvent(new CustomEvent('gist-synced'));
    } catch (e) {
      console.error('Gist sync failed', e);
      window.dispatchEvent(new CustomEvent('gist-error', { detail: e.message }));
    }
  }, delay);
}
