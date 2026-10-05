// Mushroom Traffic Light — configuration
// ВАЖНО: это публичный клиентский файл. Пароль здесь — не для серьёзной защиты,
// а чтобы случайный прохожий по URL не увидел ваши данные. Серьёзная защита —
// токен Gist (приватный) и настройки Access.

export const CONFIG = {
  // SHA-256 хэш пароля. Сгенерировать: см. README "4. Задайте свой пароль".
  // Дефолт — пароль "pukhovichi" (ОБЯЗАТЕЛЬНО замените перед деплоем!)
  passwordHash: 'aea4b2847f66f0ad81bb459a18d0e18305e0c2b0c5c5a1eaf6082f196d0eab45',

  // Название приложения
  appName: 'Грибной светофор',

  // Timezone для open-meteo запросов и cron
  timezone: 'Europe/Moscow',

  // API endpoints
  endpoints: {
    openMeteoArchive: 'https://archive-api.open-meteo.com/v1/archive',
    openMeteoForecast: 'https://api.open-meteo.com/v1/forecast',
    nominatim: 'https://nominatim.openstreetmap.org/reverse',
    osmMap: 'https://api.openstreetmap.org/api/0.6/map.json',
    github: 'https://api.github.com'
  },

  // Scoring thresholds — можно подкрутить после валидации
  scoring: {
    soilT: { ok: [8, 14], fair: [5, 17] },
    soilM: { ok: [0.25, 0.40], fair: [0.20, 0.45] },
    rain10d: { ok: [15, 40], fair: [8, 55] },
    tMax: { ok: [10, 20], fair: [6, 24] },
    tMin: { ok: 2, fair: -2 },
    threshold: { green: 70, yellow: 45 }
  },

  // Дефолтный список видов грибов
  defaultSpecies: [
    'подосиновик','подберёзовик','белый','лисичка','опёнок','маслёнок',
    'моховик','сыроежка','рыжик','груздь настоящий','чёрный груздь','груздь дубовый',
    'волнушка','зеленушка','польский гриб','подвишенник','козляк',
    'рядовка','строчок','сморчок','дубовик','зонтик'
  ],

  // Дефолтная локация (можно удалить после первого добавления своей)
  defaultLocation: {
    id: 'pukhovichi-main',
    name: 'Пуховичи — осинник',
    lat: 53.5248, lon: 27.6199,
    species: ['подосиновик', 'подберёзовик', 'белый', 'лисичка']
  }
};
