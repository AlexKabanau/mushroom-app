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
 * Merge two arrays by ID: start from base, add items from other that are missing.
 * This prevents data loss when one side has newer timestamps but fewer records.
 */
function mergeById(base = [], other = []) {
  const map = new Map((base).map(x => [x.id, x]));
  for (const item of other) {
    if (item.id && !map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

/**
 * Pull remote state from Gist and merge with local.
 * Scalar fields: last-write-wins by updatedAt.
 * Arrays (locations, mushroomDays): union by ID — items present in either side are kept.
 * This prevents a missed Gist push from silently erasing locally-added data.
 */
export async function pullAndMerge(localState) {
  const { token, gistId: storedGistId } = getSettings();
  const gistId = storedGistId || CONFIG.gistId;
  if (!gistId) return localState;
  try {
    const remote = await pullGist(token || null, gistId);
    if (!remote) return localState;
    const localTime  = new Date(localState.updatedAt || 0).getTime();
    const remoteTime = new Date(remote.updatedAt    || 0).getTime();
    // Base = whichever is newer (wins for scalar/settings fields)
    const base  = remoteTime >= localTime ? remote     : localState;
    const other = remoteTime >= localTime ? localState : remote;
    const merged = {
      ...base,
      // Array union: never drop an item just because one side didn't have it
      locations:    mergeById(base.locations    || [], other.locations    || []),
      mushroomDays: mergeById(base.mushroomDays || [], other.mushroomDays || []),
    };
    saveLocal(merged);
    return merged;
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
