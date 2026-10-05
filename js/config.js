// Mushroom Traffic Light — configuration
// ВАЖНО: это публичный клиентский файл. Пароль здесь — не для серьёзной защиты,
// а чтобы случайный прохожий по URL не увидел ваши данные. Серьёзная защита —
// токен Gist (приватный) и настройки Access.

export const CONFIG = {
  // SHA-256 хэш пароля. Сгенерировать: см. README "4. Задайте свой пароль".
  // Дефолт — пароль "pukhovichi" (ОБЯЗАТЕЛЬНО замените перед деплоем!)
  passwordHash:
    "1dc6a6320681ce7843be315fcd412c5dc8adfb3b44e96e081c1271f55ac91127",

  // ID публичного Gist для доступа с телефона без токена.
  // Заполните после первого создания Gist через Настройки.
  // Пример: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
  // Оставьте null если не нужен мобильный доступ без токена.
  gistId: "4592f7a5bea4de672c7254c8e45c5e2b",

  // Название приложения
  appName: "Грибной светофор",

  // Timezone для open-meteo запросов и cron
  timezone: "Europe/Moscow",

  // API endpoints
  endpoints: {
    openMeteoArchive: "https://archive-api.open-meteo.com/v1/archive",
    openMeteoForecast: "https://api.open-meteo.com/v1/forecast",
    nominatim: "https://nominatim.openstreetmap.org/reverse",
    osmMap: "https://api.openstreetmap.org/api/0.6/map.json",
    github: "https://api.github.com",
  },

  // Scoring thresholds — можно подкрутить после валидации
  scoring: {
    soilT: { ok: [8, 14], fair: [5, 17] },
    soilM: { ok: [0.25, 0.4], fair: [0.2, 0.45] },
    rain10d: { ok: [15, 40], fair: [8, 55] },
    tMax: { ok: [10, 20], fair: [6, 24] },
    tMin: { ok: 2, fair: -2 },
    threshold: { green: 70, yellow: 45 },
  },

  // Видо-специфичные пороги и паттерны
  // scoring: пороги температуры/влажности для этого вида
  // peakMonths: массив месяцев пика (1=янв, 9=сент)
  // lagDays: дней от триггера (дождь+холод) до урожая
  // specialRule: 'frost' — +15 бонус если за 7 дней был мороз (tMin<0)
  // note: краткая подсказка для пользователя
  speciesConfig: {
    подосиновик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 15], fair: [8, 18] },
        soilM: { ok: [0.25, 0.38], fair: [0.2, 0.43] },
        rain10d: { ok: [15, 40], fair: [10, 50] },
        tMax: { ok: [12, 20], fair: [8, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      peakMonths: [9, 10],
      lagDays: 7,
      note: "Осинник. Триггер — пожелтение осины. Пик: сент–окт.",
    },
    подберёзовик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 18], fair: [6, 22] },
        soilM: { ok: [0.22, 0.4], fair: [0.18, 0.45] },
        rain10d: { ok: [12, 42], fair: [8, 52] },
        tMax: { ok: [10, 22], fair: [6, 26] },
        tMin: { ok: 3, fair: -1 },
      },
      peakMonths: [8, 9, 10],
      lagDays: 6,
      note: "Берёзняк. Самый длинный сезон: июнь–октябрь.",
    },
    белый: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 13], fair: [6, 16] },
        soilM: { ok: [0.26, 0.4], fair: [0.2, 0.44] },
        rain10d: { ok: [20, 45], fair: [13, 56] },
        tMax: { ok: [12, 20], fair: [8, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      peakMonths: [9],
      lagDays: 10,
      note: "Ельник/смешанный. Нужно больше осадков. Лаг 10–12 дней.",
    },
    лисичка: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [15, 22], fair: [12, 25] },
        soilM: { ok: [0.25, 0.43], fair: [0.2, 0.48] },
        rain10d: { ok: [20, 55], fair: [13, 65] },
        tMax: { ok: [16, 24], fair: [12, 28] },
        tMin: { ok: 10, fair: 6 },
      },
      peakMonths: [7, 8],
      lagDays: 12,
      note: "Летний вид. Ель+берёза+мох. Пик: июль–август.",
    },
    маслёнок: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [14, 20], fair: [10, 24] },
        soilM: { ok: [0.22, 0.4], fair: [0.18, 0.45] },
        rain10d: { ok: [15, 45], fair: [10, 55] },
        tMax: { ok: [14, 22], fair: [10, 26] },
        tMin: { ok: 8, fair: 4 },
      },
      peakMonths: [8, 9],
      lagDays: 5,
      note: "Молодые сосновые посадки 15–40 лет. Появляется быстро.",
    },
    рыжик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 16], fair: [8, 19] },
        soilM: { ok: [0.22, 0.38], fair: [0.17, 0.43] },
        rain10d: { ok: [15, 40], fair: [10, 50] },
        tMax: { ok: [12, 20], fair: [8, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      peakMonths: [8, 9],
      lagDays: 6,
      note: "Сосновые посадки 20–40 лет, сухие почвы.",
    },
    опёнок: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [6, 14], fair: [4, 18] },
        soilM: { ok: [0.18, 0.46], fair: [0.14, 0.5] }, // широко — растёт на пнях
        rain10d: { ok: [10, 42], fair: [6, 55] },
        tMax: { ok: [8, 16], fair: [5, 19] },
        tMin: { ok: 0, fair: -4 },
      },
      peakMonths: [9, 10],
      lagDays: 4,
      specialRule: "frost", // +15 если за 7 дней был мороз
      note: "Пни, корни. Триггер — первые заморозки. Самый быстрый: 3–5 дней.",
    },
    "груздь настоящий": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 14], fair: [6, 17] },
        soilM: { ok: [0.28, 0.45], fair: [0.22, 0.5] },
        rain10d: { ok: [20, 55], fair: [14, 65] },
        tMax: { ok: [10, 20], fair: [7, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      peakMonths: [8, 9],
      lagDays: 15,
      note: "Берёза, нейтральные почвы. Лаг 14–20 дней, нужна высокая влажность.",
    },
    "чёрный груздь": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 14], fair: [6, 17] },
        soilM: { ok: [0.3, 0.46], fair: [0.24, 0.51] },
        rain10d: { ok: [22, 55], fair: [16, 65] },
        tMax: { ok: [10, 20], fair: [7, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      peakMonths: [8, 9],
      lagDays: 16,
      note: "Берёза у болот. Самые влажные условия из всех. Лаг 14–18 дней.",
    },
    волнушка: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 14], fair: [6, 17] },
        soilM: { ok: [0.26, 0.43], fair: [0.2, 0.48] },
        rain10d: { ok: [18, 50], fair: [12, 60] },
        tMax: { ok: [10, 20], fair: [7, 24] },
        tMin: { ok: 3, fair: 0 },
      },
      peakMonths: [8, 9],
      lagDays: 12,
      note: "Берёза, кислые почвы. Похожа на груздь, менее влажная.",
    },
    моховик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 18], fair: [8, 22] },
        soilM: { ok: [0.24, 0.42], fair: [0.18, 0.46] },
        rain10d: { ok: [15, 45], fair: [10, 55] },
        tMax: { ok: [12, 22], fair: [8, 26] },
        tMin: { ok: 5, fair: 2 },
      },
      peakMonths: [8, 9],
      lagDays: 7,
      note: "Широкий диапазон. Опушки, молодняк, смешанный лес.",
    },
    "польский гриб": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 16], fair: [8, 19] },
        soilM: { ok: [0.24, 0.4], fair: [0.18, 0.44] },
        rain10d: { ok: [15, 42], fair: [10, 52] },
        tMax: { ok: [12, 20], fair: [8, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      peakMonths: [8, 9, 10],
      lagDays: 8,
      note: "Ель, сосна, старые посадки. Долгий сезон.",
    },
  },

  // Дефолтный список видов грибов
  defaultSpecies: [
    "подосиновик",
    "подберёзовик",
    "белый",
    "лисичка",
    "опёнок",
    "маслёнок",
    "моховик",
    "сыроежка",
    "рыжик",
    "груздь настоящий",
    "чёрный груздь",
    "груздь дубовый",
    "волнушка",
    "зеленушка",
    "польский гриб",
    "подвишенник",
    "козляк",
    "рядовка",
    "строчок",
    "сморчок",
    "дубовик",
    "зонтик",
  ],

  // Дефолтная локация (можно удалить после первого добавления своей)
  defaultLocation: {
    id: "pukhovichi-main",
    name: "Пуховичи — осинник",
    lat: 53.5248,
    lon: 27.6199,
    species: ["подосиновик", "подберёзовик", "белый", "лисичка"],
  },
};
