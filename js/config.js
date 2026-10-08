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
      mdi: { // Таблицы 1-2 спецификации v2.0, Andrew 2018 DOY 250
        doyPeak: 250, doySigma: 20,
        tMin: 7, tOptLow: 10.5, tOptHigh: 15.5, tMax: 20, sigmaLeft: 3.0, sigmaRight: 2.5,
        moistWilt: 0.17, moistOptLow: 0.25, moistOptHigh: 0.37, moistSat: 0.43,
        rain10dMin: 8, rain10dMax: 60,
      },
      peakMonths: [8, 9], // Andrew 2018: пик 3-4 сент, начало с конца авг
      lagDays: 7,
      note: "Осинник. Триггер — пожелтение осины. Пик: авг–сент.",
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
      mdi: { // Andrew 2018 DOY 258, широкий сезон → doySigma=25
        doyPeak: 258, doySigma: 25,
        tMin: 5, tOptLow: 9, tOptHigh: 17, tMax: 22.5, sigmaLeft: 3.5, sigmaRight: 3.0,
        moistWilt: 0.15, moistOptLow: 0.22, moistOptHigh: 0.40, moistSat: 0.46,
        rain10dMin: 6, rain10dMax: 70,
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
        rain10d: { ok: [8, 45], fair: [4, 56] }, // Bielefeld: 5-10mm → 25.8% находок, порог снижен
        tMax: { ok: [12, 21], fair: [8, 24] },   // Bielefeld: rollT оптим. 9-17°C → tMax до 22
        tMin: { ok: 4, fair: 1 },
      },
      mdi: { // Bielefeld + спецификация v2.0, Andrew 2018 DOY 255
        doyPeak: 255, doySigma: 20,
        tMin: 5, tOptLow: 9, tOptHigh: 14.5, tMax: 18.5, sigmaLeft: 3.5, sigmaRight: 2.0,
        moistWilt: 0.18, moistOptLow: 0.26, moistOptHigh: 0.38, moistSat: 0.44,
        rain10dMin: 5, rain10dMax: 65,
      },
      peakMonths: [9], // Andrew 2018: пик 12 сент, подтверждено
      lagDays: 10,     // Bielefeld: пик корреляции осадков на lag=10, подтверждено данными
      note: "Ельник/смешанный. Лаг 10 дней подтверждён данными. Пик: сент.",
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
      mdi: { // Andrew 2018 DOY 231 (летний вид), узкий сезон
        doyPeak: 231, doySigma: 18,
        tMin: 11, tOptLow: 15, tOptHigh: 22, tMax: 26, sigmaLeft: 3.0, sigmaRight: 3.0,
        moistWilt: 0.20, moistOptLow: 0.28, moistOptHigh: 0.44, moistSat: 0.48,
        rain10dMin: 14, rain10dMax: 80,
      },
      peakMonths: [8], // Andrew 2018: пик 19-20 авг, июль почти пустой
      lagDays: 12,
      note: "Летний вид. Ель+берёза+мох. Пик: август.",
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
      mdi: { // Andrew 2018 DOY 269 (поздний пик)
        doyPeak: 269, doySigma: 20,
        tMin: 8, tOptLow: 13, tOptHigh: 19.5, tMax: 24, sigmaLeft: 3.0, sigmaRight: 2.5,
        moistWilt: 0.14, moistOptLow: 0.20, moistOptHigh: 0.36, moistSat: 0.42,
        rain10dMin: 6, rain10dMax: 55,
      },
      peakMonths: [9, 10], // Andrew 2018: пик 26 сент, сдвинут позже чем ожидалось
      lagDays: 5,
      note: "Молодые сосновые посадки 15–40 лет. Появляется быстро. Пик: сент–окт.",
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
      mdi: { // Andrew 2018 DOY 262
        doyPeak: 262, doySigma: 20,
        tMin: 6, tOptLow: 10, tOptHigh: 16, tMax: 20, sigmaLeft: 3.0, sigmaRight: 2.2,
        moistWilt: 0.15, moistOptLow: 0.22, moistOptHigh: 0.37, moistSat: 0.43,
        rain10dMin: 8, rain10dMax: 60,
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
      mdi: { // Andrew 2018 DOY 275, триггер заморозков — специфика специального правила
        doyPeak: 275, doySigma: 18,
        tMin: 3, tOptLow: 7.5, tOptHigh: 13.5, tMax: 17.5, sigmaLeft: 2.5, sigmaRight: 2.0,
        moistWilt: 0.14, moistOptLow: 0.22, moistOptHigh: 0.45, moistSat: 0.50,
        rain10dMin: 8, rain10dMax: 75,
      },
      peakMonths: [9, 10],
      lagDays: 4,
      specialRule: "frost", // +35% (MDI) / +15 (классика) если за 7 дней был мороз
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
      mdi: { // Andrew 2018 DOY 252, нейтральные почвы, самый высокий порог дождя
        doyPeak: 252, doySigma: 20,
        tMin: 5, tOptLow: 8.5, tOptHigh: 14, tMax: 18, sigmaLeft: 2.8, sigmaRight: 2.0,
        moistWilt: 0.22, moistOptLow: 0.30, moistOptHigh: 0.46, moistSat: 0.50,
        rain10dMin: 15, rain10dMax: 85,
      },
      peakMonths: [8, 9],
      lagDays: 15,
      note: "Берёза, нейтральные почвы. Лаг 14–20 дней, нужна высокая влажность.",
    },
    "чёрный груздь": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 16], fair: [6, 19] },   // джекпот при 14.6-15.9°C (сент 2026)
        soilM: { ok: [0.28, 0.46], fair: [0.22, 0.51] }, // находки при 0.29-0.30
        rain10d: { ok: [18, 55], fair: [14, 65] }, // джекпот при 21-22мм
        tMax: { ok: [10, 20], fair: [7, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      mdi: { // Близко к груздю настоящему, слегка влажнее, Andrew 2018 DOY 265
        doyPeak: 265, doySigma: 20,
        tMin: 5, tOptLow: 8.5, tOptHigh: 14, tMax: 18, sigmaLeft: 2.8, sigmaRight: 2.0,
        moistWilt: 0.22, moistOptLow: 0.32, moistOptHigh: 0.47, moistSat: 0.52,
        rain10dMin: 16, rain10dMax: 90,
      },
      peakMonths: [9, 10], // Andrew 2018: пик 21-24 сент, не август
      lagDays: 16,
      note: "Берёза у болот. Самые влажные условия из всех. Лаг 14–18 дней. Пик: сент–окт.",
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
      mdi: { // Промежуток между подосиновиком и груздём, Andrew 2018 DOY 273
        doyPeak: 273, doySigma: 20,
        tMin: 5, tOptLow: 9, tOptHigh: 14.5, tMax: 18.5, sigmaLeft: 3.0, sigmaRight: 2.2,
        moistWilt: 0.18, moistOptLow: 0.26, moistOptHigh: 0.44, moistSat: 0.50,
        rain10dMin: 12, rain10dMax: 75,
      },
      peakMonths: [9, 10], // Andrew 2018: пик 27-28 сент
      lagDays: 12,
      note: "Берёза, кислые почвы. Похожа на груздь, менее влажная. Пик: сент–окт.",
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
      mdi: { // Широкий экологический диапазон, Andrew 2018 ~DOY 252
        doyPeak: 252, doySigma: 25,
        tMin: 6, tOptLow: 10, tOptHigh: 18, tMax: 23, sigmaLeft: 3.5, sigmaRight: 2.5,
        moistWilt: 0.16, moistOptLow: 0.24, moistOptHigh: 0.42, moistSat: 0.48,
        rain10dMin: 8, rain10dMax: 65,
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
      mdi: { // Imleria badia, близко к белому, Andrew 2018 DOY 265
        doyPeak: 265, doySigma: 20,
        tMin: 6, tOptLow: 10, tOptHigh: 16, tMax: 20, sigmaLeft: 3.5, sigmaRight: 2.2,
        moistWilt: 0.17, moistOptLow: 0.24, moistOptHigh: 0.40, moistSat: 0.45,
        rain10dMin: 8, rain10dMax: 65,
      },
      peakMonths: [9, 10], // Andrew 2018 (Imleria badia): пик 19-21 сент, август слабый
      lagDays: 8,
      note: "Ель, сосна, старые посадки. Пик: сент–окт.",
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
