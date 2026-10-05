// OSM biotope fetching + point-in-polygon
import { CONFIG } from './config.js';

/** Degrees for ~500m at this latitude (works for 50-55 lat) */
function bboxFor(lat, lon, radiusM = 500) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    minLon: lon - dLon, maxLon: lon + dLon,
    minLat: lat - dLat, maxLat: lat + dLat
  };
}

/** Ray-casting point-in-polygon */
function pointInPoly(lat, lon, poly) {
  const n = poly.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].lat, yi = poly[i].lon;
    const xj = poly[j].lat, yj = poly[j].lon;
    if (((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / (yj - yi + 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

const BIOTOPE_LABELS = {
  'landuse=forest': 'Лес',
  'natural=wood': 'Лес',
  'landuse=peat_cutting': 'Торфоразработка',
  'landuse=meadow': 'Луг',
  'landuse=farmland': 'Пашня',
  'landuse=orchard': 'Сад',
  'natural=wetland+bog': 'Верховое болото',
  'natural=wetland+marsh': 'Маршевое болото',
  'natural=wetland+fen': 'Низинное болото',
  'natural=wetland+swamp': 'Заболоченный лес',
  'natural=wetland+reedbed': 'Тростниковые заросли',
  'natural=wetland': 'Болото',
  'natural=water': 'Водоём',
  'natural=scrub': 'Кустарник',
  'natural=heath': 'Верещатник',
  'natural=grassland': 'Естественная трава',
  'waterway=river': 'Река',
  'waterway=stream': 'Ручей'
};

function tagsToLabel(tags) {
  // Compose key with wetland subtype
  if (tags.natural === 'wetland' && tags.wetland) {
    const key = `natural=wetland+${tags.wetland}`;
    if (BIOTOPE_LABELS[key]) return BIOTOPE_LABELS[key];
  }
  // Try direct matches
  for (const [k, v] of Object.entries(tags)) {
    const key = `${k}=${v}`;
    if (BIOTOPE_LABELS[key]) {
      let label = BIOTOPE_LABELS[key];
      // Enrich forest with leaf_type if available
      if ((k === 'landuse' && v === 'forest') || (k === 'natural' && v === 'wood')) {
        if (tags.leaf_type === 'needleleaved') label += ' (хвойный)';
        else if (tags.leaf_type === 'broadleaved') label += ' (лиственный)';
        else if (tags.leaf_type === 'mixed') label += ' (смешанный)';
        if (tags.species) label += ` [${tags.species}]`;
      }
      return label;
    }
  }
  return null;
}

/**
 * Fetch biotope info for a location using OSM data API + Nominatim.
 */
export async function fetchBiotope(lat, lon) {
  const bbox = bboxFor(lat, lon, 500);

  const [osmData, nominatim, nominatimClose] = await Promise.all([
    fetch(`${CONFIG.endpoints.osmMap}?bbox=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`)
      .then(r => r.json()).catch(() => null),
    fetch(`${CONFIG.endpoints.nominatim}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=ru&extratags=1`)
      .then(r => r.json()).catch(() => null),
    fetch(`${CONFIG.endpoints.nominatim}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&accept-language=ru`)
      .then(r => r.json()).catch(() => null)
  ]);

  const biotopeSet = new Set();
  const biotopeTags = [];

  if (osmData?.elements) {
    const nodes = {};
    osmData.elements.forEach(e => { if (e.type === 'node') nodes[e.id] = { lat: e.lat, lon: e.lon }; });

    osmData.elements.forEach(e => {
      if (e.type !== 'way' || !e.tags) return;
      const label = tagsToLabel(e.tags);
      if (!label) return;
      const poly = (e.nodes || []).map(nid => nodes[nid]).filter(Boolean);
      if (poly.length < 3) return;
      // Close polygon check: first and last node must match for a closed way
      const isClosed = e.nodes[0] === e.nodes[e.nodes.length - 1];
      if (isClosed && pointInPoly(lat, lon, poly)) {
        biotopeSet.add(label);
        biotopeTags.push({ label, tags: e.tags, inside: true });
      } else {
        // Still note nearby polygons for context (minimal distance check)
        const minLatP = Math.min(...poly.map(p => p.lat));
        const maxLatP = Math.max(...poly.map(p => p.lat));
        const minLonP = Math.min(...poly.map(p => p.lon));
        const maxLonP = Math.max(...poly.map(p => p.lon));
        if (lat >= minLatP - 0.001 && lat <= maxLatP + 0.001 &&
            lon >= minLonP - 0.001 && lon <= maxLonP + 0.001) {
          biotopeSet.add(label);
          biotopeTags.push({ label, tags: e.tags, inside: false });
        }
      }
    });
  }

  const biotope = Array.from(biotopeSet);
  const adminArea = nominatim?.display_name ? composeAdminArea(nominatim) : null;
  const nearestFeature = nominatimClose?.name || nominatimClose?.display_name?.split(',')[0] || null;

  return {
    biotope,
    biotopeTags,
    adminArea,
    nearestFeature,
    osmSyncedAt: new Date().toISOString().slice(0, 10)
  };
}

function composeAdminArea(nominatim) {
  const addr = nominatim.address || {};
  const parts = [
    addr.city || addr.town || addr.village || addr.hamlet,
    addr.suburb,
    addr.county,
    addr.state
  ].filter(Boolean);
  return parts.join(', ');
}
