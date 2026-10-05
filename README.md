# 🍄 Грибной светофор

Персональный помощник по тихой охоте: светофор условий (вернусь без грибов или с полным ведром?) для ваших грибных локаций, журнал походов, автоматический анализ и email-дайджест каждое утро.

**Что умеет:**
- Светофор на 10 дней вперёд для любого места по координатам
- Биотоп (лес / торфяник / болото / луг) подтягивается из OpenStreetMap автоматически
- История погоды и прогноз — из open-meteo (бесплатно, без ключа, без регистрации)
- Журнал грибных дней (удачных и пустых) с привязкой условий
- Паттерны: что отличает ваши удачные дни от пустых + валидация модели (прогноз vs факт)
- Синхронизация между устройствами через приватный GitHub Gist
- Утренний email-дайджест в 7:00 через GitHub Actions
- PWA: ставится на телефон как приложение (иконка на экране, без браузерной обвязки)

Приложение — чистый статический сайт. Никакого сервера, backend-а, базы данных. Все расчёты в браузере, все данные — в вашем приватном Gist. Хостится бесплатно на GitHub Pages.

---

## Деплой с нуля (≈15 минут)

### 1. Создайте приватный GitHub репо

- github.com → New repository
- Имя: `mushroom-traffic-light` (или любое)
- **Private** ✓
- Не инициализируйте README, .gitignore, лицензию
- Создайте

### 2. Залейте код

Из этой папки:

```bash
git init
git add .
git commit -m "Initial"
git branch -M main
git remote add origin git@github.com:USERNAME/REPO.git
git push -u origin main
```

### 3. Включите GitHub Pages

- Settings → Pages
- Source: **Deploy from a branch**
- Branch: `main` / root (`/`)
- Save

Через 1–2 минуты страница будет доступна по адресу `https://USERNAME.github.io/REPO/`.

### 4. Задайте свой пароль

Сгенерируйте SHA-256 хэш пароля:

**Вариант A** — в консоли Node:
```bash
node -e "require('crypto').subtle.digest('SHA-256', new TextEncoder().encode('ВАШ_ПАРОЛЬ')).then(h => console.log(Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('')))"
```

**Вариант B** — в браузерной консоли на развёрнутой странице:
```js
window.setPasswordHash('ВАШ_ПАРОЛЬ')
```
Выдаст хэш и выведет в консоль.

**Вариант C** — через Python:
```python
import hashlib; print(hashlib.sha256('ВАШ_ПАРОЛЬ'.encode()).hexdigest())
```

Замените строку `passwordHash: '...'` в `js/config.js` на свой хэш и запушьте:

```bash
git add js/config.js
git commit -m "Set my password"
git push
```

Через минуту обновите приложение в браузере — спросит пароль.

### 5. Создайте приватный Gist для синхронизации

- github.com/settings/tokens → **Fine-grained tokens** → Generate new token
- Name: `Mushroom Traffic Light`
- Resource owner: ваш аккаунт
- Repository access: **Public Repositories (read-only)** (достаточно)
- Permissions → **Account permissions** → **Gists**: **Read and write**
- Generate → **скопируйте токен** (показывается один раз!)

В приложении: ⚙ Настройки → вставьте токен → «💾 Сохранить и создать Gist». Gist создастся автоматически под именем `mushroom-config.json`, его ID сохранится локально.

Теперь любые изменения автоматически синкаются в Gist, и с другого устройства после ввода того же токена вы получаете все данные.

### 6. Настройте email-дайджест (опционально)

**Resend** (бесплатно до 3000 писем/мес, не нужна карта):

- resend.com → регистрация → API Keys → Create → scope `Sending access`
- Скопируйте ключ (`re_...`)

**Secrets в репо** — Settings → Secrets and variables → Actions → New repository secret:

| Имя | Значение |
|---|---|
| `GIST_TOKEN` | ваш GitHub Fine-grained token (тот же, что для Gist) |
| `GIST_ID` | ID вашего Gist (видно в URL gist.github.com/USERNAME/XXXX) |
| `RESEND_API_KEY` | ключ Resend |
| `EMAIL_TO` | ваш email для получения |
| `EMAIL_FROM` | `onboarding@resend.dev` (дефолт работает без верификации домена) |

**Variables** (не secret): Settings → Secrets and variables → Actions → Variables → New:

| Имя | Значение |
|---|---|
| `APP_URL` | `https://USERNAME.github.io/REPO/` |

**Проверка:** Actions → Daily mushroom digest → Run workflow. Через минуту должно прийти письмо.

**Автоматика:** каждый день в 04:00 UTC (= 07:00 Minsk) workflow запустится сам.

### 7. Поставьте на телефон

Откройте `https://USERNAME.github.io/REPO/` в Safari (iOS) или Chrome (Android):

**iOS:** Поделиться → На экран «Домой»
**Android:** меню → «Установить приложение» (или «Добавить на главный экран»)

Иконка грибов появится как обычное приложение. Открывается в полноэкранном режиме без адресной строки.

---

## Как это работает

**Клиент:**
- `index.html` + `css/styles.css` + `js/*.js` — чистый ванильный JS с модулями
- Данные хранятся в `localStorage` (быстро) + синкаются в Gist (между устройствами)
- Пароль — SHA-256 хэш в `config.js`; при вводе хэш сверяется и сохраняется в `localStorage`
- Chart.js загружается с CDN jsdelivr для графиков

**Данные:**
- Погода и прогноз: `archive-api.open-meteo.com` и `api.open-meteo.com` (CORS включён, бесплатно, без ключа)
- Биотоп: `api.openstreetmap.org/api/0.6/map.json` + `nominatim.openstreetmap.org/reverse` (парсим natural/landuse/wetland теги, point-in-polygon)
- Синк: `api.github.com/gists/:id` (ваш приватный Gist)

**Scoring (0–100):**
- Soil temperature: +25 если 8–14°C
- Soil moisture: +25 если 0.25–0.40
- Σ дождя за 10 дней: +20 если 15–40 мм
- Дневная температура: +15 если 10–20°C
- Ночная температура: +10 если > 2°C
- Дождь сегодня: ±5 (мало/много)

Пороги светофора: ≥70 зелёный, 45–69 жёлтый, <45 красный. Правятся в `js/config.js` → `scoring.threshold`.

**GitHub Actions:**
- Cron `0 4 * * *` UTC — запускается скрипт `scripts/daily-digest.mjs`
- Скрипт читает Gist, для каждой локации запрашивает open-meteo, строит HTML-дайджест и шлёт через Resend

---

## Структура

```
.
├── index.html                   # SPA entry
├── manifest.json                # PWA манифест
├── sw.js                        # service worker (кэш shell'а)
├── css/styles.css               # все стили
├── js/
│   ├── config.js                # пароль, пороги, дефолты (ПРАВИТЬ ЗДЕСЬ)
│   ├── auth.js                  # парольный гейт
│   ├── app.js                   # основная логика, рендер
│   ├── storage.js               # state management + merge
│   ├── gist.js                  # GitHub Gist CRUD
│   ├── weather.js               # open-meteo wrappers
│   ├── osm.js                   # OSM biotope fetch + point-in-polygon
│   └── scoring.js               # scoring algorithm (shared с scripts/)
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   └── icon-512.png
├── scripts/
│   ├── package.json
│   └── daily-digest.mjs         # Node.js скрипт для email
└── .github/workflows/
    └── daily-digest.yml         # GitHub Actions cron
```

---

## Калибровка модели

После 10–15 грибных дней (включая пустые) откройте вкладку «Паттерны» → «Валидация модели». Если точность <70%, подкрутите пороги в `js/config.js`:

```js
scoring: {
  soilT: { ok: [8, 14], ... },      // окно температуры почвы (°C)
  soilM: { ok: [0.25, 0.40], ... }, // окно влажности почвы (м³/м³)
  rain10d: { ok: [15, 40], ... },   // окно осадков за 10 дней (мм)
  threshold: { green: 70, yellow: 45 } // пороги светофора
}
```

Пример: если «пустые» дни стабильно имели score 70+, значит планка «зелёный» слишком низкая — поднимите `threshold.green` до 75–80.

---

## Приватность

- Все данные (локации, грибные дни) — в вашем **приватном** Gist. Никто кроме вас их не видит.
- Токен Gist — только в вашем браузере (`localStorage`) и в GitHub Actions secrets. Нигде на клиенте не логируется.
- Пароль приложения — hash в публичном коде. Это *soft gate*, чтобы случайный человек не увидел UI. Защиту ценных данных обеспечивает приватность Gist.
- Open-meteo и OSM получают только координаты точек (без привязки к личности).
- Resend получает email-адрес (ваш) и содержимое дайджеста.

---

## Ограничения

- **Nominatim rate limit:** 1 запрос/сек. При добавлении 10+ локаций подряд может притормаживать.
- **Overpass API** недоступен из некоторых окружений — используется прямой OSM map endpoint, он надёжнее.
- **Soil moisture прогноз** — проекция от последнего известного значения + rain/ET. Для 10-дневного горизонта это приблизительно.
- **PWA offline** — работает только shell (UI). Для свежих данных нужен интернет.
- **Service worker** — простейший: кеширует только статику, API-запросы всегда идут в сеть.

---

## Расширения, идеи на потом

- Push-уведомления в Telegram (вместо/в дополнение к email) — через bot API
- Карта локаций с кликабельными маркерами
- Экспорт данных в CSV для внешнего анализа
- Фенологические маркеры (цветение иван-чая, пожелтение берёзы) по датам/биотопу
- Логистическая регрессия на пользовательских данных после 50+ дней — персональная функция score

---

Данные о погоде: © open-meteo contributors (CC-BY 4.0)
Карты: © OpenStreetMap contributors (ODbL)
