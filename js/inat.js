/**
 * iNaturalist API — fetch tree species and mushroom observations near a location.
 * Uses the /v1/observations/species_counts endpoint (public, CORS-enabled).
 */

/**
 * Русские названия грибов по латинскому имени.
 * Используется для отображения nearby видов из iNaturalist.
 */
const MUSHROOM_RU_NAMES = {
  // Благородные
  'Boletus edulis':             'Белый гриб (боровик)',
  'Boletus pinophilus':         'Белый гриб сосновый',
  'Boletus reticulatus':        'Белый гриб дубовый',
  'Boletus aereus':             'Белый гриб чёрный',
  'Leccinum versipelle':        'Подосиновик жёлто-бурый',
  'Leccinum aurantiacum':       'Подосиновик красный',
  'Leccinum scabrum':           'Подберёзовик обыкновенный',
  'Cantharellus cibarius':      'Лисичка обыкновенная',
  'Craterellus cornucopioides': 'Лисичка чёрная (трубчатая)',
  'Suillus luteus':             'Маслёнок поздний',
  'Suillus granulatus':         'Маслёнок зернистый',
  'Lactarius deliciosus':       'Рыжик',
  'Armillaria mellea':          'Опёнок осенний',
  'Armillaria ostoyae':         'Опёнок тёмный',
  'Flammulina velutipes':       'Опёнок зимний (фламмулина)',
  'Lactarius torminosus':       'Волнушка розовая',
  'Imleria badia':              'Моховик бурый',
  'Xerocomus subtomentosus':    'Моховик зелёный',
  'Xerocomellus chrysenteron':  'Моховик трещиноватый',
  'Lactarius resimus':          'Груздь настоящий',
  'Lactarius necator':          'Груздь чёрный (чернушка)',
  'Lactarius zonarius':         'Груздь дубовый',
  'Russula':                    'Сыроежка',
  'Morchella esculenta':        'Сморчок настоящий',
  'Morchella':                  'Сморчок',
  'Hydnum repandum':            'Ежовик жёлтый',
  'Macrolepiota procera':       'Гриб-зонтик пёстрый',
  'Agaricus campestris':        'Шампиньон луговой',
  'Agaricus sylvaticus':        'Шампиньон лесной',
  'Pleurotus ostreatus':        'Вёшенка обыкновенная',
  // Частые в Беларуси
  'Amanita muscaria':           'Мухомор красный',
  'Amanita phalloides':         'Бледная поганка',
  'Amanita citrina':            'Мухомор лимонный',
  'Amanita rubescens':          'Мухомор серо-розовый (жемчужный)',
  'Amanita fulva':              'Мухомор жёлто-коричневый',
  'Lycoperdon perlatum':        'Дождевик жемчужный',
  'Lycoperdon pyriforme':       'Дождевик грушевидный',
  'Calvatia gigantea':          'Головач гигантский',
  'Coprinus comatus':           'Навозник белый',
  'Coprinopsis atramentaria':   'Навозник серый',
  'Hypholoma fasciculare':      'Ложноопёнок серно-жёлтый',
  'Hypholoma capnoides':        'Ложноопёнок серый',
  'Paxillus involutus':         'Свинушка тонкая',
  'Stropharia aeruginosa':      'Строфария сине-зелёная (Verdigris)',
  'Cortinarius':                'Паутинник',
  'Mycena':                     'Мицена',
  'Mycena galericulata':        'Мицена колпаковидная',
  'Russula emetica':            'Сыроежка едкая',
  'Russula virescens':          'Сыроежка зеленоватая',
  'Lactarius rufus':            'Горькушка',
  'Tylopilus felleus':          'Горчак (желчный гриб)',
  'Fomes fomentarius':          'Трутовик настоящий',
  'Fomitopsis betulina':        'Берёзовая губка',
  'Trametes versicolor':        'Трутовик разноцветный',
  'Grifola frondosa':           'Трутовик ветвистый (гриффола)',
  'Tricholoma equestre':        'Рядовка жёлтая',
  'Tricholoma terreum':         'Рядовка землистая',
  'Lepista nuda':               'Рядовка фиолетовая (синеножка)',
  'Clitocybe nebularis':        'Говорушка туманная',
  'Galerina marginata':         'Галерина окаймлённая (ядовитая!)',
};

/** Получить русское название гриба по латинскому или по английскому common name */
function getMushroomRuName(latinName, commonNameEn) {
  // Exact Latin match
  if (MUSHROOM_RU_NAMES[latinName]) return MUSHROOM_RU_NAMES[latinName];
  // Partial match by genus (e.g. "Cortinarius sp.")
  const genus = latinName.split(' ')[0];
  if (MUSHROOM_RU_NAMES[genus]) return MUSHROOM_RU_NAMES[genus];
  // Fallback: English common name if available, otherwise Latin
  return commonNameEn || latinName;
}

/**
 * Mapping: config species key → canonical iNaturalist taxon name.
 * Used to match /v1/observations/species_counts results client-side.
 */
const MUSHROOM_TAXA = {
  'белый':              'Boletus edulis',
  'подосиновик':        'Leccinum versipelle',
  'подберёзовик':       'Leccinum scabrum',
  'лисичка':            'Cantharellus cibarius',
  'маслёнок':           'Suillus luteus',
  'рыжик':              'Lactarius deliciosus',
  'опёнок':             'Armillaria mellea',
  'волнушка':           'Lactarius torminosus',
  'моховик':            'Imleria badia',
  'груздь настоящий':   'Lactarius resimus',
  'чёрный груздь':      'Lactarius necator',
  'сыроежка':           'Russula',
  'груздь дубовый':     'Lactarius zonarius',
};

/**
 * Fetch recent research-grade mushroom observations near (lat, lon).
 * Returns array of { species (config key), taxon, count } for species with count > 0,
 * sorted by count desc.
 *
 * Uses /v1/observations/species_counts with iconic_taxa=Fungi, one API call total.
 */
export async function fetchMushroomObservations(lat, lon, speciesList, radiusKm = 80, daysBack = 10) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  const d1 = start.toISOString().slice(0, 10);
  const d2 = end.toISOString().slice(0, 10);

  const url = new URL('https://api.inaturalist.org/v1/observations/species_counts');
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lng', lon.toFixed(5));
  url.searchParams.set('radius', radiusKm);
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('iconic_taxa', 'Fungi');
  url.searchParams.set('d1', d1);
  url.searchParams.set('d2', d2);
  url.searchParams.set('per_page', 200);

  const res = await fetch(url.toString(), { cache: 'no-cache' }).then(r => r.json());
  const results = res.results || [];

  // Build lookup: taxon name (lower) → count
  const byName = new Map();
  for (const r of results) {
    if (!r.taxon) continue;
    byName.set(r.taxon.name.toLowerCase(), { count: r.count, taxon: r.taxon.name, id: r.taxon.id });
    // Also index without author (some names have substrings)
  }

  // Match our species list
  const mapped = [];
  for (const sp of speciesList) {
    const latin = MUSHROOM_TAXA[sp];
    if (!latin) continue;
    const entry = byName.get(latin.toLowerCase());
    if (entry) {
      mapped.push({ species: sp, taxon: entry.taxon, count: entry.count });
    }
  }

  // Also include any unrecognized mushroom finds in the area (top-5 excluding matched)
  const matchedTaxa = new Set(mapped.map(m => m.taxon.toLowerCase()));
  const extra = results
    .filter(r => r.taxon && !matchedTaxa.has(r.taxon.name.toLowerCase()))
    .slice(0, 5)
    .map(r => ({
      species: null,
      taxon: getMushroomRuName(r.taxon.name, r.taxon.preferred_common_name),
      count: r.count
    }));

  return {
    matched: mapped.sort((a, b) => b.count - a.count),
    nearby: extra,
    total: res.total_results ?? 0,
    dateRange: `${d1} — ${d2}`,
    radiusKm
  };
}

// ── Tree species lookup (existing) ────────────────────────────────────────────
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
