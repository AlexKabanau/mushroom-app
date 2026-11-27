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

  // GDD10 нормальные значения по DOY для 53.5°N (Пуховичский р-н)
  // Климатологическая норма 1991-2020, Tmean по месяцам: май=14°С, июн=17.5°С, июл=19.5°С, авг=18.5°С, сен=12.5°С
  // База 10°C: норма полного сезона (май–сент) ≈ 982°·d
  // Используется для вычисления аномалии: gddYTD / gdd10NormalForDOY(doy)
  gdd10Normal: {
    121: 4,   131: 44,  141: 84,  151: 124,
    161: 199, 171: 274, 181: 349, 191: 444,
    201: 539, 211: 634, 221: 720, 231: 805,
    241: 890, 251: 927, 261: 952, 271: 977,
    // Конец сезона: полный ожидаемый GDD10 за май–сент = 982°·d
    seasonEnd: 982,
    // Нормальный Jul–Aug rain (мм), Минск 1991-2020
    normalJulAugRain: 160,
  },

  // Scoring thresholds — можно подкрутить после валидации
  scoring: {
    soilT: { ok: [8, 14], fair: [5, 17] },
    soilM: { ok: [0.25, 0.37], fair: [0.2, 0.43] }, // гипоксия болетовых на суглинке >0.37 (M2+M4)
    rain10d: { ok: [20, 55], fair: [11, 75] }, // 14-day window (×1.4 vs old 10-day)
    tMax: { ok: [10, 20], fair: [6, 24] },
    tMin: { ok: 2, fair: -2 },
    threshold: { green: 70, yellow: 45 },
  },

  // Параметры волнового жизненного цикла (WFI — Wave Freshness Index)
  // Bielefeld 2025 (Brejon Lamartiniere) + Salerni & Perini 2004 + Boddy 2014 + Büntgen 2015
  // Все значения — стартовые эвристики, калибруются по данным поездок
  wave: {
    activeDays: 7,       // дней активного выхода новых тел после лага (когорта 5–8 дней)
    decayDays: 7,        // дней затухания (переростки, новые тела не выходят)
    refractoryDays: 18,  // дней рефрактерного минимума (диапазон 14–28, Büntgen 2015)
    noTriggerWFI: 0.65,  // WFI-заглушка если ТВП-триггер не обнаружен в hist
    // ТВП-триггер — два независимых пути (Decision Prompt D3, консенсус 3/3 моделей):
    // moistureTrigger: достаточно дождя без холодового шока (лисичка, русула, ранние болетовые)
    // shockTrigger: нужен холодовый шок + дождь (болеты осенью, опёнок, грузди)
    // Каждый вид имеет triggers: { moisture, shock } в speciesConfig.
    // Дефолт (если не задан для вида): оба активны (AND-поведение через OR двух путей).
    tpvRainMin: 15,      // мм за 5 дней — порог moisture trigger
    tpvRainShock: 8,     // мм за 5 дней — достаточно для shock trigger (меньше, т.к. главное ΔT)
    tpvDeltaTMin: 5,     // °C падение (prevAvg5d − currAvg5d) для shock trigger
    tpvMaxShockTemp: 18, // °C: shock trigger не срабатывает если средняя T за 3д > этого значения
                         // (предотвращает июльское падение 32°→26° от триггера осенних грибов)
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
        soilM: { ok: [0.25, 0.37], fair: [0.2, 0.43] }, // гипоксия
        rain10d: { ok: [20, 55], fair: [14, 70] },
        tMax: { ok: [12, 20], fair: [8, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      mdi: { // Таблицы 1-2 спецификации v2.0, Andrew 2018 DOY 250
        doyPeak: 250, doySigma: 20,
        tMin: 7, tOptLow: 10.5, tOptHigh: 15.5, tMax: 20, sigmaLeft: 3.0, sigmaRight: 2.5,
        moistWilt: 0.17, moistOptLow: 0.25, moistOptHigh: 0.37, moistSat: 0.43,
        rain10dMin: 8, rain10dMax: 60,
      },
      peakMonths: [7, 8, 9], // Andrew 2018: пик 3-4 сент; iNat Belarus: июл=50% rel → добавлен
      lagDays: 7,
      triggers: { moisture: true, shock: true }, // болетовый — оба пути
      note: "Осинник. Триггер — пожелтение осины. Пик: июл–сент.",
    },
    подберёзовик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 18], fair: [6, 22] },
        soilM: { ok: [0.22, 0.37], fair: [0.18, 0.43] }, // гипоксия на суглинке >0.37
        rain10d: { ok: [22, 58], fair: [11, 72] }, // было 17 → 22: single-burst rain после засухи не даёт волну (Oct 2026 кейс)
        tMax: { ok: [10, 22], fair: [6, 26] },
        tMin: { ok: 3, fair: -1 },
      },
      mdi: { // Andrew 2018 DOY 258, широкий сезон → doySigma=25
        doyPeak: 258, doySigma: 25,
        tMin: 5, tOptLow: 9, tOptHigh: 17, tMax: 22.5, sigmaLeft: 3.5, sigmaRight: 3.0,
        moistWilt: 0.15, moistOptLow: 0.22, moistOptHigh: 0.40, moistSat: 0.46,
        rain10dMin: 6, rain10dMax: 70,
      },
      peakMonths: [7, 8, 9, 10], // iNat Belarus: июл=54% rel (31obs), длинный сезон подтверждён
      lagDays: 6,
      triggers: { moisture: true, shock: true }, // болетовый — оба пути
      note: "Берёзняк. Самый длинный сезон: июль–октябрь.",
    },
    белый: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 13], fair: [6, 16] },
        soilM: { ok: [0.26, 0.37], fair: [0.2, 0.42] }, // гипоксия на суглинке >0.37
        rain10d: { ok: [11, 63], fair: [6, 78] }, // 14-day window; Bielefeld fair[0]=4mm×1.4=5.6→6
        tMax: { ok: [12, 21], fair: [8, 24] },   // Bielefeld: rollT оптим. 9-17°C → tMax до 22
        tMin: { ok: 4, fair: 1 },
      },
      mdi: { // Bielefeld + спецификация v2.0, Andrew 2018 DOY 255
        doyPeak: 255, doySigma: 20,
        tMin: 5, tOptLow: 9, tOptHigh: 14.5, tMax: 18.5, sigmaLeft: 3.5, sigmaRight: 2.0,
        moistWilt: 0.18, moistOptLow: 0.26, moistOptHigh: 0.38, moistSat: 0.44,
        rain10dMin: 5, rain10dMax: 65,
      },
      peakMonths: [8, 9], // Andrew 2018: пик 12 сент; iNat Belarus: авг=95% rel (99obs) ≈ сен=100% → два равных слоя
      lagDays: 10,        // Bielefeld: пик корреляции осадков на lag=10, подтверждено данными
      triggers: { moisture: true, shock: true }, // болетовый — оба пути (классический триггер: дождь + холод)
      note: "Ельник/смешанный. Лаг 10 дней подтверждён данными. Пик: авг–сент.",
    },
    лисичка: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [15, 22], fair: [12, 25] },
        soilM: { ok: [0.25, 0.43], fair: [0.2, 0.48] },
        rain10d: { ok: [28, 77], fair: [18, 90] },
        tMax: { ok: [16, 24], fair: [12, 28] },
        tMin: { ok: 10, fair: 6 },
      },
      mdi: { // Andrew 2018 DOY 231 (летний вид), узкий сезон
        doyPeak: 231, doySigma: 18,
        tMin: 11, tOptLow: 15, tOptHigh: 22, tMax: 26, sigmaLeft: 3.0, sigmaRight: 3.0,
        moistWilt: 0.20, moistOptLow: 0.28, moistOptHigh: 0.44, moistSat: 0.48,
        rain10dMin: 14, rain10dMax: 80,
      },
      peakMonths: [7, 8], // iNat Belarus: июл=100% (132obs!!) >> авг=41% — ГЛАВНЫЙ пик июль, не август
                          // Andrew 2018 показал авг 19-20 пик, но iNat (n=283) чётко указывает на июль
      lagDays: 12,
      triggers: { moisture: true, shock: false }, // летний вид: только moisture trigger, холодовый шок стопорит
      noTriggerWFI: 0.90, // летний вид — нет холодового шока, дождь+тепло = триггер
      // Wave параметры Cantharellus: Danell 1994, Kasparavičius 2000, Grok/Carbon consensus 2025
      // Тела живут 30–44 дня, волны перекрываются — жёсткий refractory неуместен.
      // activeDays 10→18: один flush длится 2–3 недели при стабильной влажности.
      // refractoryDays 14→8: лисичка способна рефлашнуть за 8–10 дней при дожде.
      wave: { activeDays: 18, decayDays: 14, refractoryDays: 8 },
      note: "Летний вид. Ель+берёза+мох. Пик: июль–август.",
    },
    маслёнок: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [14, 20], fair: [10, 24] },
        soilM: { ok: [0.22, 0.37], fair: [0.18, 0.43] }, // гипоксия на суглинке >0.37
        rain10d: { ok: [21, 63], fair: [14, 77] },
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
      triggers: { moisture: true, shock: true }, // болетовый — оба пути
      note: "Молодые сосновые посадки 15–40 лет. Появляется быстро. Пик: сент–окт.",
    },
    рыжик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 16], fair: [8, 19] },
        soilM: { ok: [0.22, 0.38], fair: [0.17, 0.43] },
        rain10d: { ok: [20, 55], fair: [14, 70] },
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
      triggers: { moisture: true, shock: true }, // болетовый — оба пути
      note: "Сосновые посадки 20–40 лет, сухие почвы.",
    },
    опёнок: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [6, 14], fair: [4, 18] },
        soilM: { ok: [0.18, 0.46], fair: [0.14, 0.5] }, // широко — растёт на пнях
        rain10d: { ok: [14, 58], fair: [8, 76] },
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
      // lagDays: Armillaria — спорно (Carbon: 10, Grok: 4). Компромисс = 8.
      // День 0 = начало cold shock (не конец rain window).
      // Rhizomorph → primordia дифференциация 7–10 дней (Shim 2006, Chen 2020).
      lagDays: 8,
      triggers: { moisture: false, shock: true }, // только shock trigger — требует cold snap
      specialRule: "frost", // +35% (MDI) / +15 (классика) если за 7 дней был мороз
      // refractoryDays 22→28: обычно 1–2 волны за сезон, долгое восстановление ресурсов.
      wave: { activeDays: 5, decayDays: 5, refractoryDays: 28 },
      note: "Пни, корни. Триггер — первые заморозки. Лаг ~8 дней от cold shock.",
    },
    "груздь настоящий": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 14], fair: [6, 17] },
        soilM: { ok: [0.28, 0.45], fair: [0.22, 0.5] },
        rain10d: { ok: [28, 77], fair: [20, 90] },
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
      triggers: { moisture: true, shock: true }, // грузди: оба пути, но важнее moisture
      wave: { activeDays: 10, decayDays: 9, refractoryDays: 22 }, // медленный долгий слой, тяжёлое восстановление
      note: "Берёза, нейтральные почвы. Лаг 14–20 дней, нужна высокая влажность.",
    },
    "чёрный груздь": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 16], fair: [6, 19] },   // джекпот при 14.6-15.9°C (сент 2026)
        soilM: { ok: [0.28, 0.46], fair: [0.22, 0.51] }, // находки при 0.29-0.30
        rain10d: { ok: [25, 77], fair: [20, 90] }, // 14-day window; джекпот при 21-22мм/10d → ~30мм/14d
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
      triggers: { moisture: true, shock: true }, // грузди: оба пути
      wave: { activeDays: 10, decayDays: 9, refractoryDays: 22 }, // как груздь настоящий
      note: "Берёза у болот. Самые влажные условия из всех. Лаг 14–18 дней. Пик: сент–окт.",
    },
    волнушка: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [8, 14], fair: [6, 17] },
        soilM: { ok: [0.26, 0.43], fair: [0.2, 0.48] },
        rain10d: { ok: [25, 70], fair: [17, 84] },
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
      triggers: { moisture: true, shock: true }, // лактариус: оба пути
      wave: { activeDays: 9, decayDays: 8, refractoryDays: 20 }, // умеренно длиннее болетовых
      note: "Берёза, кислые почвы. Похожа на груздь, менее влажная. Пик: сент–окт.",
    },
    моховик: {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 18], fair: [8, 22] },
        soilM: { ok: [0.24, 0.37], fair: [0.18, 0.42] }, // гипоксия на суглинке >0.37
        rain10d: { ok: [21, 63], fair: [14, 77] },
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
      triggers: { moisture: true, shock: true }, // болетовый — оба пути
      note: "Широкий диапазон. Опушки, молодняк, смешанный лес.",
    },
    "зеленушка": {
      emoji: "🍄",
      // ⚠️ БЕЗОПАСНОСТЬ: Tricholoma equestre связана с рабдомиолизом (Bedry et al. 2001, NEJM 345:798).
      // Запрещена к продаже в РФ и ряде стран ЕС. Показываем скор для поиска,
      // но предупреждение обязательно.
      safetyWarning: "⚠️ Спорный вид — связан с рабдомиолизом при регулярном употреблении (Bedry 2001, NEJM). Не рекомендован в РБ и ЕС.",
      triggers: { moisture: false, shock: true }, // только shock trigger, поздний холодовый вид
      scoring: {
        soilT: { ok: [4, 11], fair: [2, 14] },
        soilM: { ok: [0.18, 0.32], fair: [0.13, 0.38] },
        rain10d: { ok: [15, 50], fair: [8, 65] },
        tMax: { ok: [5, 13], fair: [2, 16] },
        tMin: { ok: 0, fair: -4 },
      },
      peakMonths: [10, 11],
      lagDays: 11,
      note: "Сосняк, поздняя осень. ⚠️ Требует осторожности. Пик: октябрь–ноябрь.",
    },
    "польский гриб": {
      emoji: "🍄",
      scoring: {
        soilT: { ok: [10, 16], fair: [8, 19] },
        soilM: { ok: [0.24, 0.37], fair: [0.18, 0.42] }, // гипоксия на суглинке >0.37
        rain10d: { ok: [21, 58], fair: [14, 72] },
        tMax: { ok: [12, 20], fair: [8, 24] },
        tMin: { ok: 4, fair: 1 },
      },
      mdi: { // Imleria badia, близко к белому, Andrew 2018 DOY 265
        doyPeak: 265, doySigma: 20,
        tMin: 6, tOptLow: 10, tOptHigh: 16, tMax: 20, sigmaLeft: 3.5, sigmaRight: 2.2,
        moistWilt: 0.17, moistOptLow: 0.24, moistOptHigh: 0.40, moistSat: 0.45,
        rain10dMin: 8, rain10dMax: 65,
      },
      peakMonths: [8, 9, 10], // Andrew 2018: пик 19-21 сент; iNat Belarus: авг=42% rel (36obs) значимый
      lagDays: 8,
      triggers: { moisture: true, shock: true }, // болетовый — оба пути
      note: "Ель, сосна, старые посадки. Пик: авг–окт.",
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
