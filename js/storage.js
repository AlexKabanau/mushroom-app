// State management: local-first with optional Gist sync
import { CONFIG } from './config.js';
import { getSettings, pullGist, scheduleSync } from './gist.js';

const LOCAL_KEY = 'mushroom-state';

function emptyState() {
  return {
    locations: [{ ...CONFIG.defaultLocation }],
    mushroomDays: [],
    activeLocationId: CONFIG.defaultLocation.id,
    customSpecies: [],
    weather: {},
    updatedAt: null
  };
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

export function saveLocal(state) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

/**
 * Pull remote state from Gist and merge with local (last-write-wins by updatedAt).
 */
export async function pullAndMerge(localState) {
  const { token, gistId } = getSettings();
  if (!token || !gistId) return localState;
  try {
    const remote = await pullGist(token, gistId);
    if (!remote) return localState;
    const localTime = new Date(localState.updatedAt || 0).getTime();
    const remoteTime = new Date(remote.updatedAt || 0).getTime();
    if (remoteTime > localTime) {
      saveLocal(remote);
      return remote;
    }
    return localState;
  } catch (e) {
    console.warn('Gist pull failed, using local state', e);
    return localState;
  }
}

/**
 * Save state locally and trigger a debounced sync to Gist.
 */
export function saveAndSync(state) {
  state.updatedAt = new Date().toISOString();
  saveLocal(state);
  scheduleSync(() => state);
}
