/**
 * iNaturalist API — fetch tree species observed near a location.
 * Uses the /v1/observations/species_counts endpoint (public, CORS-enabled).
 *
 * Filters by iconic_taxa=Plantae, quality_grade=research,
 * then client-side-filters to known tree genera for Belarus / Central Europe.
 */

// Genera considered "trees" for mushroom ecology purposes
const TREE_GENERA = new Set([
  'pinus','picea','abies','larix','pseudotsuga',           // conifers
  'betula','alnus','carpinus','corylus',                    // birch family
  'quercus','fagus','castanea',                             // beech family
  'populus','salix',                                        // willow/poplar
  'tilia',                                                  // linden
  'fraxinus','ligustrum',                                   // ash family
  'acer','platanus',                                        // maple/plane
  'ulmus','celtis',                                         // elm family
  'sorbus','malus','pyrus','prunus','padus','crataegus',    // rose family trees
  'robinia','gleditsia',                                    // legume trees
  'juglans','pterocarya',                                   // walnut family
  'ailanthus',                                              // tree of heaven
]);

// Russian display names for common species in Belarus
const RU_NAMES = {
  'Pinus sylvestris':    'Сосна обыкновенная',
  'Picea abies':         'Ель обыкновенная',
  'Betula pendula':      'Берёза бородавчатая',
  'Betula pubescens':    'Берёза пушистая',
  'Populus tremula':     'Осина',
  'Populus alba':        'Тополь белый',
  'Populus nigra':       'Тополь чёрный',
  'Quercus robur':       'Дуб черешчатый',
  'Alnus glutinosa':     'Ольха чёрная',
  'Alnus incana':        'Ольха серая',
  'Tilia cordata':       'Липа мелколистная',
  'Fraxinus excelsior':  'Ясень обыкновенный',
  'Acer platanoides':    'Клён остролистный',
  'Acer campestre':      'Клён полевой',
  'Carpinus betulus':    'Граб обыкновенный',
  'Sorbus aucuparia':    'Рябина обыкновенная',
  'Salix caprea':        'Ива козья',
  'Salix alba':          'Ива белая',
  'Padus avium':         'Черёмуха обыкновенная',
  'Prunus avium':        'Черешня',
  'Ulmus glabra':        'Вяз горный',
  'Ulmus laevis':        'Вяз гладкий',
  'Abies alba':          'Пихта белая',
  'Larix decidua':       'Лиственница европейская',
  'Larix sibirica':      'Лиственница сибирская',
  'Pinus strobus':       'Сосна Веймутова',
  'Robinia pseudoacacia':'Акация белая',
};

function isTree(taxon) {
  const genus = taxon.name.split(' ')[0].toLowerCase();
  return TREE_GENERA.has(genus);
}

function getRuName(latinName, commonNameEn) {
  return RU_NAMES[latinName] || null;
}

/**
 * Fetch tree species observed near (lat, lon) within radiusKm.
 * Returns array of { latin, name, count, inatId } sorted by count desc.
 */
export async function fetchForestTrees(lat, lon, radiusKm = 5) {
  const url = new URL('https://api.inaturalist.org/v1/observations/species_counts');
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lng', lon.toFixed(5));
  url.searchParams.set('radius', radiusKm);
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('rank', 'species');
  url.searchParams.set('iconic_taxa', 'Plantae');
  url.searchParams.set('per_page', 50);

  const res = await fetch(url.toString(), { cache: 'no-cache' }).then(r => r.json());
  const results = res.results || [];

  return results
    .filter(r => r.taxon && isTree(r.taxon))
    .map(r => ({
      inatId: r.taxon.id,
      latin: r.taxon.name,
      name: getRuName(r.taxon.name) || r.taxon.preferred_common_name || r.taxon.name,
      count: r.count
    }))
    .sort((a, b) => b.count - a.count);
}
