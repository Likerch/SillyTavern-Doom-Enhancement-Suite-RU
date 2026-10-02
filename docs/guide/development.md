# Для разработчиков

[← Оглавление](README.md)

## Устройство

Надстройка — обычные ES-модули без сборки. Код DES, CarrotKernel и BunnyMo в репозиторий не входит. Надстройка
работает с ними через DOM, события SillyTavern и публичные экспорты их ES-модулей.

| Путь | Что там |
|---|---|
| `index.js` | Точка входа: запускает ядро |
| `src/core.js` | Ядро: ждёт ST и DES, запускает гард и включает модули, которые разрешены и гардом, и пользователем |
| `src/guard.js` | Версионный гард: по фактам о DES решает, можно ли переводить интерфейс и трогать данные |
| `src/des-adapter.js` | **Единственное место, которое знает, как устроен DES**: селекторы, пути и экспорты его модулей, ключи данных, куски шаблона трекера, зеркала его разбора (погода, час, имена) |
| `src/ck-adapter.js`, `src/bunnymo-adapter.js` | То же для CarrotKernel и BunnyMo |
| `src/translator.js` | Движок перевода интерфейса по словарю; им пользуются модули 1 и 6 |
| `src/modules/` | Модули 1–6 |
| `src/lib/` | Чистая логика без DOM: словарь, матчер имён, транслит, нормализатор BunnyMo, правки записей, слова погоды, правки шаблона |
| `locales/` | Встроенные словари интерфейса DES и CK |
| `settings.html`, `src/panel.js`, `style.css` | Панель надстройки |
| `tests/` | Тесты чистой логики |
| `tools/` | Инструменты словаря |
| `vendor/` | Клоны DES, CarrotKernel и BunnyMo только для чтения. Используются для разведки и не попадают в git |

## Документы

- [docs/des-recon.md](../des-recon.md) — разведка DES: селекторы, стейт, точки интеграции, решения (§12), находки этапов.
- [docs/bunnymo-recon.md](../bunnymo-recon.md) — разведка BunnyMo и CarrotKernel: решения (§8.1), результаты (§9).
- [docs/ck-ui-map.md](../ck-ui-map.md) — карта интерфейса CarrotKernel для перевода.
- [docs/upstream-issues.md](../upstream-issues.md) — что можно починить только в DES и CK, готовые тексты issue.
- [docs/manual-test.md](../manual-test.md) — чек-лист ручной проверки на живом ST.

## Проверки

- `npm test` — тесты чистой логики. Нужен Node 22+, зависимостей нет.
- `node tools/check-dictionary.mjs` — проверяет встроенные словари: дубли, плейсхолдеры, теги.
- `node tools/extract-des-strings.mjs vendor/des --missing locales/ru.json` — строки из кода DES, которых нет в словаре.
  `--stale locales/ru.json` — ключи словаря, которых больше нет в DES. Оба отчёта смотрите глазами: в первом
  попадаются промпты и куски уже переведённых подсказок, во втором — строки, которые DES склеивает из частей.
- `node tools/extract-ck-strings.mjs vendor/CarrotKernel --missing locales/ru.carrotkernel.json` — то же для CarrotKernel.

## Как обновить надстройку под новый DES

1. Обновите клон: `git -C vendor/des pull`. Посмотрите, что поменялось с проверенного коммита:
   `git -C vendor/des diff --stat 10ad241..HEAD`. Особенно важны файлы, на которые ссылается `docs/des-recon.md`.
2. Поправьте `src/des-adapter.js`: селекторы, пути модулей и экспорты, куски шаблона трекера и зеркала разбора DES.
3. Словарь: прогоните оба отчёта `extract-des-strings.mjs`, на живом ST пройдитесь по окнам DES и выгрузите непереведённое
   из панели. Пополните `locales/ru.json` и проверьте его `node tools/check-dictionary.mjs`.
4. Обновите `DES_INFO.verifiedVersions` и `verifiedCommit` в адаптере. Поднимите версию в `manifest.json` и `package.json`.
5. Запустите `npm test`, затем пройдите чек-лист `docs/manual-test.md` на живом ST.

С новыми CarrotKernel и BunnyMo — то же самое. Нужны `src/ck-adapter.js` (`CK_INFO`, `CK_MODULES`, `CK_UI`),
`src/bunnymo-adapter.js` (`BUNNYMO_INFO`, сигнатуры записей) и `tools/extract-ck-strings.mjs`.

## Правила

- Ни одного файла DES, CK или BunnyMo не менять: только DOM, события и экспорты.
- Никакой телеметрии и внешних запросов.
- Всё знание о DES — в `src/des-adapter.js`, о CK и BunnyMo — в их адаптерах.
- Надстройка может деградировать, но не может сломать SillyTavern: каждый шаг ядра обёрнут, гард отключает
  модули при несовпадении.

## Лицензия

[AGPL-3.0-or-later](../../LICENSE).
