# Разведка Doom's Enhancement Suite (этап 0)

> **Объект:** DES **v2.6.0**, коммит `10ad241514d6d015b6c655d7542d561d47fd6cf0`
> (2026-09-25, «Release 2.6.0 — Costume Change», ветка `main`). Клон лежит в `vendor/des`
> (только чтение, в `.gitignore`).
> **Сверка с ядром ST:** SillyTavern **1.19.0**, коммит `7e8663c` (2026-09-14). Клон временный,
> в репозиторий не входит; повторить: `git clone --depth 1 --branch 1.19.0 https://github.com/SillyTavern/SillyTavern.git`.
> **Ссылки:** `файл:строка` — относительно `vendor/des/`; `ST:файл:строка` — исходники ST 1.19.0.
> Дата разведки: 2026-10-01.

---

## 0. Коротко: что меняет план

1. **i18n у DES есть, но рудиментарный.** Есть `src/core/i18n.js` и `src/i18n/en.json`
   (46 ключей, только `en`). Локали ru и zh-tw удалены 2026-07-07 (`eb25dd6`); по `CHANGELOG.md:125`
   UI «~95% hardcoded English».
   - Подход ТЗ (DOM-перевод по словарю «английская строка → русская») остаётся единственным разумным.
   - Нюанс: DES сам перезаписывает текст у своих `[data-i18n-key]`-узлов. Значит, маркер
     `data-desru-done` должен сверять содержимое, а не ставиться навсегда (§1.6).
2. **Большая часть UI DES ленивая.** 11 модалок из `template.html` попадают в DOM только при первом
   открытии любого окна DES (`index.js:663-676`). Гард «проверить селекторы на старте» физически
   может проверить только жадные узлы, остальные — при их появлении (§10, вопрос 5).
3. **Погода: русский словарь у DES уже есть.** Это `WEATHER_PATTERNS_BY_LANGUAGE.ru`
   (`src/systems/ui/weatherEffects.js:127-136`), и матчер перебирает все языки (`:199-220`).
   - «дождь», «снег», «ясно» срабатывают уже сейчас.
   - Эффекты молчат по другим причинам (§3.5).
   - Модуль 3 в виде «подменять на английское» не нужен; предлагаю другой (§9.3).
4. **Алиасы DES применяются до записи в стейт, и у DES уже есть нечёткий матчинг имён.**
   - Алиасы: `applyCharacterAliases` вызывается сразу после парсинга, до цветов, свайпов и рендера.
   - Матчинг: Левенштейн ≤1/≤2, попап «тот же персонаж?» — ловит часть падежей, часть нет (§4.4).
   - Чистая точка интеграции для модуля 2 — дописать алиас в DES до того, как DES распарсит
     ответ, а не править стейт постфактум.
5. **У DES нет `window`-API, но его файлы — ES-модули с экспортами.** Импорт по тому же URL даёт тот же
   экземпляр модуля (ST грузит расширения без query-строк, `ST:public/scripts/extensions.js:819`).
   Это главная развилка (§10, вопрос 1): только DOM и события ST, как в ТЗ, или ещё и импорт модулей DES.
6. **Попутно нашлись русские проблемы DES, которых нет в ТЗ (§11):**
   - «не в сцене» определяется только по английским фразам;
   - `\b` в сопоставлении имён не работает на кириллице, из-за этого ломается атрибуция говорящего в чат-пузырях;
   - кириллические названия пользовательских полей превращаются в пустой ключ;
   - DES на каждой смене чата стирает переводы встроенного переводчика ST.
7. **NovelAI и картинки — §8.** Прямой интеграции с NovelAI в DES нет, inline-картинок в сообщениях нет.
   Есть генерация портретов NPC через штатный `/sd` ST: если в ST → Image Generation выбрать
   источник NovelAI, портреты DES уже пойдут через NovelAI.

---

## 1. Карта селекторов (вопрос 1)

### 1.1 Общая картина

- **Единой обёртки нет.** Узлы DES разбросаны по `body`, `#extensions_settings2`, `#sheld`,
  `#form_sheld`/`#send_form`, `#chat` и внутрь сообщений (`.mes_block`, `.mes_text`,
  `.mes_buttons`, `.mes_reasoning_actions`).
- **Префиксы:**
  - `rpg-*` — шаблоны, модалки, Lore Library (`rpg-lb-`), лист персонажа (`rpg-cs-`). Это наследие форка
    RPG Companion, так что сам префикс не доказывает принадлежность к DES. Якоримся на конкретных id и классах ниже.
  - `dooms-*` — всё рантайм-генерируемое и всё в чате.
  - `cw-*` — Workshop, `cr-*` — Roster, плюс `doom-icon`.
  - Встречаются и голые классы (`helper`, `muted`, `active`, `is-open`), и классы ST (`menu_button`, `inline-drawer*`, `mes_button`).
- **Три жизненных цикла:**
  1. **Жадные, при инициализации:** блок в Extensions, кнопка «D», портрет-бар.
  2. **Ленивые, один раз:** 11 корней `template.html` добавляются в `body` при первом `ensureSettingsUI()`
     (`index.js:663-676`, `src/core/lazyUI.js`). Закрытие только скрывает модалку.
  3. **Рантайм:** всё остальное собирается из HTML-строк и **пересоздаётся целиком**. Единственное исключение —
     карточки портрет-бара, их сверяет `domDiff.keyedReconcile` (`src/systems/ui/portraitBar.js:595`).
- **DES не использует MutationObserver** (есть только IntersectionObserver в пузырях,
  `chatBubbles.js:1391`) и ничего не делает по токенам стриминга. На наши правки DOM DES не
  реагирует, но по своему расписанию перерисовывает свои узлы.

### 1.2 Корни по поверхностям

| # | Поверхность | Корень | Куда и когда вставляется | Внутри сообщения? |
|---|---|---|---|---|
| 1 | Блок в Extensions | анонимный `<div>` > `.inline-drawer`; якорь `#rpg-extension-enabled` (`settings.html:1-40`) | `#extensions_settings2`, при старте, **даже если DES выключен** (`index.js:287-289`) | нет |
| 2 | Кнопка «D» | `#dooms-settings-fab` > `button#dooms-fab-settings` > `span.doom-icon` | `body`, при `initUI`, только если DES включён (`index.js:2489-2507`) | нет |
| 2a | Меню кнопки «D» | `ul.dooms-fab-menu` (пересобирается на каждое открытие, `index.js:2627-2650`); ПКМ — `div.dooms-fab-context-menu` в `body` (`:2702-2713`) | — | нет |
| 3 | Панель настроек | `#rpg-settings-popup` > 14 секций `.rpg-accordion-section[data-accordion=…]` (`template.html:2-1711`) | `body`, лениво; открыта = класс `is-open` (`src/systems/ui/modals.js:43-60`) | нет |
| 4 | Present Characters | `#dooms-portrait-bar-wrapper` > `#dooms-pb-toggle`, `#dooms-portrait-bar` (> `.dooms-pb-header`, `#dooms-pb-scroll`) (`portraitBar.js:185-232`) | по `portraitPosition`: перед или после `#send_form`, перед `#chat` в `#sheld`, либо `body` (`portraitBar.js:234-264`, `:661-691`) | нет |
| 4a | ПКМ по портрету | `#dooms-pb-context-menu` > `.dooms-pb-ctx-item[data-action]` | сначала сосед обёртки, при первом ПКМ **переезжает в `body`** (`portraitBar.js:362-364`) | нет |
| 5 | Scene Tracker: grid / stacked / compact | `div.dooms-scene-header.dooms-scene-layout-{grid\|stacked\|compact}` | **в `.mes_block` последнего не-user сообщения** (`src/systems/rendering/sceneHeaders.js:658-671`) | **да** |
| 6 | Scene Tracker: banner | `div.dooms-info-banner` | сразу после последнего `.mes`, ребёнок `#chat` (`:608-620`) | нет |
| 7 | Scene Tracker: HUD | `div.dooms-info-hud` (fixed, перетаскиваемый) | первый ребёнок `#chat` (`:621-626`) | нет |
| 8 | Scene Tracker: ticker / ticker-bottom | `div.dooms-info-ticker-wrapper` (+`.ticker-bottom`) + `style#dooms-ticker-rotate-style` | перед `#chat` (в `#sheld`) / перед `#form_sheld` (`:627-657`) | нет |
| 9 | Карточки смены сцены | `div.dooms-scene-transition.dooms-transition-*` (опция `inlineBanners`) | перед `.mes`, где сменились место или время (`:437-557`) | между сообщениями |
| 10 | Character Workshop | `#character-workshop-popup` (`template.html:2381-2769`) | `body`, лениво; открывается событием `dooms:open-workshop`; подблоки пересобираются `.html()`; `#cw-version-add-menu` на время открытия переезжает в `body` | нет |
| 11 | Character Sheet | `#rpg-character-sheet-popup` (`template.html:1801-1819`) | `body`, лениво; `.rpg-cs-sections` пересобирается при каждом открытии (`src/systems/ui/characterSheet.js:717-773`) | нет |
| 12 | Lore Library | `#rpg-lorebook-modal.rpg-lb-modal` (`template.html:2358-2375`); меню `div.rpg-lb-context-menu` в `body` | `body`, лениво; **тело пересобирается при каждом открытии**; десктоп или мобильная вёрстка выбирается на каждом рендере (`src/systems/rendering/lorebook.js:786-793`); перехватывает кнопку WI в ST (`index.js:2424-2461`) | нет |
| 13 | Doom Counter | **модалки нет**. Выбор твиста/ножа — `div.dooms-dc-inline` в конце `#chat` (`src/systems/generation/doomCounter.js:616-634`); отладочный бейдж `.dooms-dc-debug-badge` в шапке сцены; `.dooms-dc-trap-badge` в `.mes_block` (`index.js:3215-3225`) | — | inline — между сообщениями; trap-бейдж — **да** |
| 14 | Пузыри мыслей | `details.dooms-inline-thought[data-character]` (`src/systems/rendering/thoughts.js:1603-1617`) | **в `.mes_text` последнего не-user сообщения**; при каждом проходе все удаляются и вставляются заново (`:1439-1597`) | **да** |
| 15 | Прочие модалки (лениво, `body`) | `#rpg-system-log-popup`, `#rpg-notification-log-popup`, `#rpg-inspector-popup`, `#rpg-tracker-editor-popup`, `#rpg-prompts-editor-popup`, `#rpg-character-data-editor-popup`, `#character-roster-popup` | — | нет |
| 16 | Временные оверлеи в `body` | `div.dooms-alias-overlay` (попап «тот же персонаж?», может выскочить сразу после ответа; `src/systems/features/characterAliases.js:281-298`), `#dooms-whats-new` (удаляется при закрытии), `div.rpg-emoji-picker`, `#rpg-import-mode-dialog`, `#dooms-compose-overlay` (моб.), погодный слой `div.rpg-weather-particles` (без текста) | — | нет |
| 17 | Прочее в сообщениях | `div.dooms-bubbles…` (**заменяет весь `innerHTML` `.mes_text`**, `chatBubbles.js:1110-1321`), `details.dooms-tracker-json` (опция, в `.mes_block`), `div.dooms-import-fullsheet-btn` (в `.mes_buttons`, только `title`), `div.dooms-reasoning-tts` (в `.mes_reasoning_actions`, только `title`), `button#dooms-mobile-quick-jump` (в `#send_form`) | — | **да** |

**Scene Tracker:** режимов не шесть, а **семь**: grid, stacked, compact, banner, hud, ticker,
`ticker-bottom`. Режим берётся из `extensionSettings.sceneTracker.layout` (селект `#rpg-st-layout`).
При каждом обновлении (если не сработал кэш) все узлы шапки, баннера, HUD и тикера удаляются и
вставляются заново (`sceneHeaders.js:335-340`).

### 1.3 Хром или данные: правила для переводчика

**Переводить** только:
- текстовые узлы, чьё содержимое (после `trim`) **точно** равно ключу словаря или шаблону;
- атрибуты `title`, `placeholder`, `aria-label`;
- текст `<option>` (значение `value` не трогаем).

**Смешанные узлы**, где данные и хром в одном текстовом узле, требуют шаблонов с плейсхолдерами:

| Где | Примеры |
|---|---|
| Портрет-бар | `#dooms-pb-count`: «`{n} character(s)`», «`{p} present / {t} known`» — переписывается при каждом рендере |
| Мысли | `.dooms-thought-name`: «`{emoji} {name}'s thoughts`» |
| Doom Counter | `.dooms-dc-inline-header span`: «`{owner}'s knives are drawn — choose:`», «`{owner}'s knife is drawn`» |
| Workshop | «`Remove the {label} version`», «`Add a campaign version of {name}`», «`Add {campaign} version`», «`Forging {theme} knives… (asking your AI)`», «`N / M expressions uploaded`», «`{name} (missing)`» |
| Лист персонажа | «`{a} / {b} messages`», «`Message #{n}`», «`Tracker data available for {a} of {b} messages…`» |
| Lore Library | «`~N tokens`», «`Active: N Lorebooks`», «`Campaign: {name}`», «`Selected: N`», «`Entry {uid}`» |
| Попап алиаса | имя и канон прямо внутри хромового предложения (`characterAliases.js:288`) |
| Шапка сцены | `title` бейджа Doom Counter: «`Doom Counter: Tension {t}/10 \| Streak {s}/{n} \| Countdown {c}`» |

**Данные в хромовых классах** — переводить по классу нельзя:
- **Scene Tracker:** пользовательские поля сцены используют те же `.dooms-scene-label`, `.dooms-ip-label` и
  `.dooms-ip-hud-label`, что и встроенные. Отличие: у пользовательских поля иконка `span.dooms-cf-icon`, у встроенных — `<i class="fa-solid …">`.
- **Чат-пузыри:** `.dooms-bubble-author` содержит «Narrator» или «Unknown» (это хром, родитель
  `.dooms-bubble-narrator` / `.dooms-bubble-unknown`) **или** имя говорящего (это данные, родитель `.dooms-bubble-character`).
- **Портрет:** `.dooms-pb-back-label` — это «❤️ Relationship» **или** сырой ключ из ответа модели (`portraitBar.js:1524-1567`).
- **Настройки:** `#rpg-st-custom-fields .rpg-setting-label` = «`{icon} {fieldName}`».
- **Workshop:** `.cw-campaign-badge-text` и `.cw-version-label` — «Base» **или** имя кампании.
- **Lore Library:**
  - `.rpg-lb-entry-row-title` — комментарий записи или «`Entry {uid}`»;
  - `.rpg-lb-tab` (моб.) — «All»/«Unfiled» или имя кампании;
  - подменю «Move to…» — имена кампаний и книг.

**Никогда не трогать:**
- **Поля ввода:** все `input`, `textarea`, `[contenteditable]` — и значения, и текст.
- **Значения Scene Tracker:** `.dooms-scene-value`, `.dooms-ip-value`, `.dooms-ip-hud-value`, `.dooms-ip-panel-value`, `.dooms-scene-char-badge`.
- **Портрет-бар и мысли:** `.dooms-portrait-card-name`, `.dooms-pb-back-value`, `.dooms-inline-thought-content`.
- **Doom Counter:** `.dooms-dc-card-title`, `.dooms-dc-card-desc`.
- **Лист персонажа:** всё содержимое разделов. DES читает его обратно из DOM для «Copy Sheet», `characterSheet.js:960-968`.
- **Lore Library:** имена книг и всё содержимое записей.
- **Служебное:** `pre.rpg-inspector-content` (промпты), `#dooms-version-display`, `.dooms-github-star-count`.
- **Сообщения:** всё в `.mes_text`, что не является узлом DES из таблицы выше.

### 1.4 Тосты, нативные диалоги, попапы ST

- **Тосты.** 145 вызовов `toastr.*` с захардкоженным английским, через i18n DES идут только 4. Рисуются в общий
  контейнер toastr ST (не узел DES), и многие подставляют имена. DES сам оборачивает `toastr.*` ради
  своего Notification Log (`src/systems/ui/notificationLog.js:66-86`).
- **Нативные диалоги.** 31 вызов `confirm`/`prompt`/`alert`: через DOM их не достать вообще.
- **Попапы ST.** 4 места идут через ST `callGenericPopup`: контент живёт внутри `dialog.popup` ST, а кнопки OK/Cancel — строки ST.

### 1.5 Объём строк и мёртвый код

- **Объём:**
  - `template.html` — примерно 650–750 строк UI (из них 107 `<option>`);
  - JS — ещё ~800+ (разметка, атрибуты, тосты, диалоги);
  - **итого порядка 1200–1500 записей в словаре.**
- **Мёртвый код** (не тратим силы на перевод):
  - `src/systems/ui/mobile.js` и `desktop.js` — нигде не импортируются;
  - `snowflakes.js`, оба `musicPlayer.js`;
  - сайдбар-панели `#rpg-info-box`, `#rpg-thoughts`, `#rpg-quests` — контейнеры никто не создаёт (`index.js:679-681`);
  - `#rpg-mobile-toggle`, `#rpg-thought-panel`.

### 1.6 Перерисовки и наблюдение

- **Во время стриминга DES ничего не делает.** Всплеск идёт после ответа:
  - `MESSAGE_RECEIVED`: шапка сцены, портрет-бар, погода; возможно Doom Counter (+600 мс) и попап алиаса;
  - `CHARACTER_MESSAGE_RENDERED`: +0 мс кнопки, +100 мс шапка, +800 мс пузыри (заменяют `.mes_text`), +900 мс мысли.
  - В separate/external режиме всё это повторяется после запроса трекера (+500 мс).
- **Чат-пузыри перестраивают сообщения ещё и при прокрутке** (IntersectionObserver).
- **Своё i18n DES:**
  - `data-i18n-key` стоит на 7 живых узлах Tracker Editor;
  - `i18n.applyTranslations(document.body)` вызывается при старте, после загрузки шаблона и при выкл/вкл DES
    (`index.js:701`, `:2417`, `:305`) и **возвращает этим узлам английский**.
  - Вывод: маркер `data-desru-done` должен хранить переведённое значение, а повторно переводить узел, если текст вернулся к английскому оригиналу.
- **Предлагаемая схема наблюдения** (без `subtree` на `body`):
  - мелкие observer'ы (`childList` без `subtree`) на `body`, `#sheld`, `#form_sheld`, `#chat`, `#extensions_settings2` — только чтобы заметить появление корней DES;
  - глубокий observer (`childList` + `characterData` + атрибуты `title`/`placeholder`/`aria-label`) — только на найденных корнях DES;
  - узлы DES внутри сообщений — пересканом по событиям ST (`CHARACTER_MESSAGE_RENDERED`, `MESSAGE_UPDATED`,
    `MESSAGE_SWIPED`, `CHAT_CHANGED`, `MORE_MESSAGES_LOADED`) с задержкой ~1 с, а не observer'ом на `.mes_text`;
  - сама обработка — с debounce и `requestIdleCallback`.

---

## 2. Карта стейта (вопрос 2)

### 2.1 Где что лежит

| Что | Где | Путь | Ссылки |
|---|---|---|---|
| Настройки DES (глобально) | `extension_settings` (→ settings.json) | `extension_settings['third-party/<папка DES>']` — весь объект `extensionSettings`. Папка берётся из `import.meta.url`, она не фиксирована | `src/core/config.js:11-16`, `src/core/persistence.js:544-558` |
| Стейт чата | `chat_metadata` (→ .jsonl чата) | `chat_metadata.dooms_tracker` — **пересобирается целиком при каждом `saveChatData()`**, чужие ключи внутри теряются | `persistence.js:567-601` |
| Трекер по сообщению и свайпу | `chat[i].extra` | `extra.dooms_tracker_swipes[swipe_id]` = `{quests, infoBox, characterThoughts}` (JSON-строки) | `src/systems/integration/sillytavern.js:211-222`, `src/systems/generation/apiClient.js:377-390` |
| Резерв при чтении | `chat[i].swipe_info[id].extra.dooms_tracker_swipes[id]` | DES туда сам не пишет | `persistence.js:756-758` |
| localStorage | `dooms_tracker_external_api_key`, `dooms-portrait-no-file`, `doomsPerfDebug`, `dooms_tracker_welcome_seen` | — | `apiClient.js:49`, `portraitBar.js:137` |
| Файлы на сервере ST | портреты `/user/images/des-portraits/*.png` (через `/api/images/upload`) | — | `src/utils/avatars.js:16-17,109` |
| Глобальные regex ST | 3 скрипта в `extension_settings.regex`, ставятся при каждом старте, если их нет (§5.3) | — | `index.js:2973-2993` |

Глобальные словари внутри настроек DES ключуются **точной строкой имени** (регистр сохраняется), id нет:
`knownCharacters`, `characterColors`, `npcAvatars`, `npcAvatarsFullRes`, `npcAvatarHistory`,
`characterAliases`, `aliasDismissals`, `characterKnives`, `characterRelationships`,
`characterInjection`, `characterAppearance`, `heroPositions`, `generatedPortraits`,
`userCharacters`, `pinnedCharacters`, `bannedCharacters`, `campaignProfiles`
(`src/core/state.js:71, 258-270, 349-350`).

Режим per-chat tracking включён принудительно (`state.js:263`, `index.js:2046-2049`), поэтому
действующие `knownCharacters`, `removedCharacters`, `characterColors` и `bannedCharacters` лежат
в `chat_metadata.dooms_tracker` (`persistence.js:586-591`).

### 2.2 Форматы

- Данные трекера хранятся **JSON-строками** и парсятся заново на каждом рендере
  (`src/systems/generation/parser.js:167-183`, `lockManager.js:220-231`).
- Мемоизированный парсер `src/utils/trackerParse.js:10-42` отдаёт общий объект, мутировать его нельзя.
- **Писать только строками:** `infoBox.js:121` и `apiClient.js:394` делают `.trim()` и упадут на объекте.
- Единый ответ модели: `{"quests":{…},"infoBox":{…},"characters":[…]}` (`promptBuilder.js:193-213`).

**Персонаж — элемент `characters`** (`jsonPromptHelpers.js:257-316`):

```json
{ "name": "Аня", "emoji": "😊", "color": "#C71585",
  "details": { "appearance": "…", "demeanor": "…" },
  "relationship": { "status": "Friend" },
  "stats": [ { "name": "Health", "value": 90 } ],
  "thoughts": { "content": "…" } }
```

- `color` есть только при раскраске диалогов; ключи `details` — это `toSnakeCase(имя поля)`;
  `relationship` — только если включены отношения.
- **Флага присутствия и поля аватара нет.** Присутствие вычисляется в `getCharacterList()`
  (`portraitBar.js:1247-1377`), портрет ищется по имени.

**Сцена — `infoBox`** (`jsonPromptHelpers.js:168-252`):

```json
{ "date": {"value": "…"}, "time": {"start": "14:00", "end": "14:20"},
  "location": {"value": "…"}, "weather": {"emoji": "🌧️", "forecast": "rain"},
  "temperature": {"value": 12, "unit": "C"}, "recentEvents": ["…"],
  "moonPhase": "…", "tension": "…", "timeSinceRest": "…", "conditions": "…", "terrain": "…",
  "<custom_key>": "…", "doomTension": 3 }
```

Квесты идут отдельным блоком: `{"main":{"title":…},"optional":[{"title":…}]}` → `extensionSettings.quests`
(`parser.js:409-416`).

**В памяти** (`state.js:502-517`):
- `lastGeneratedData = {quests, infoBox, characterThoughts, html}` — источник для **отображения**.
- `committedTrackerData` — источник для **следующего запроса**. Копируется из `lastGeneratedData`, когда
  пользователь отправляет сообщение (`src/systems/generation/injector.js:743-800`).
- Оба — `export let`, и `loadChatData` их **переприсваивает** (`persistence.js:716-780`) → читать только через
  namespace модуля, ссылки не кэшировать.

### 2.3 Как рождается карточка

1. Источник — `getCharacterList()`: читает `lastGeneratedData.characterThoughts`.
2. Фильтры по порядку: английский off-scene regex по мыслям, персонажи с ожидающим решением по алиасу, `removedCharacters`.
3. Новое имя → `knownChars[char.name] = {emoji}` с **точным регистром** (`portraitBar.js:1320-1334`).
4. Отсутствующие карточки — это ключи `knownCharacters`, которых нет в текущем списке. **Автоматически они
   не удаляются никогда.**

### 2.4 Свайпы, правки, перезагрузка

- **Свайп:** берёт `extra.dooms_tracker_swipes[swipe_id]` в `lastGeneratedData` (`sillytavern.js:435-492`).
- **Правка текста сообщения** (`MESSAGE_UPDATED`): трекер **не** перепарсивается.
- **Удаление сообщения:** оба стора откатываются к данным нового последнего ответа.
- **Загрузка чата:** сначала `chat_metadata.dooms_tracker`, затем **оба стора перекрываются swipe-данными
  последнего ответа** (`persistence.js:703-787`). Внешняя правка, которая должна пережить перезагрузку,
  обязана попасть в `extra.dooms_tracker_swipes[swipe_id]` этого сообщения.

---

## 3. Погода и indoor/outdoor (вопрос 3)

### 3.1 Что читается и когда

- **Поле:** `infoBox.weather.forecast`, при пустом — `infoBox.weather.emoji` (`weatherEffects.js:225-249`).
  Источник: `lastGeneratedData.infoBox || committedTrackerData.infoBox`.
- **Плоская форма не работает:** `"weather": "дождь"` или `{"value": …}` → эффекта нет (`:231-233`), хотя Scene
  Tracker такое отображает (`sceneHeaders.js:756-762`).
- **Пересчёт только по событиям:**
  - инициализация, `CHAT_CHANGED`;
  - `MESSAGE_RECEIVED`: в together сразу, в separate — после запроса трекера;
  - `MESSAGE_SWIPED`, `MESSAGE_DELETED`, переключатель погоды.
- **Не пересчитывается** при ручной правке полей, `MESSAGE_UPDATED` и кнопке Refresh.

### 3.2 Алгоритм (`parseWeatherType`, `weatherEffects.js:199-220`)

1. Текст переводится в нижний регистр (`toLowerCase()`).
2. Перебор по языкам в порядке объявления: **сначала все группы `en`, потом `ru`**.
3. Побеждает первая группа, где `text.includes(pattern)`. Регэкспов и `\b` нет.
4. Результат кэшируется в модуле (кэш сбрасывается только после 200 записей, `:17`).

### 3.3 Точный список ключевых слов (в порядке приоритета, `weatherEffects.js:116-137`)

```text
en: blizzard → [blizzard]
    storm    → [storm, thunder, lightning]
    wind     → [wind, breeze, gust, gale]
    snow     → [snow, flurries]
    rain     → [rain, drizzle, shower]
    mist     → [mist, fog, haze]
    sunny    → [sunny, clear, bright]
    none     → [cloud, overcast, indoor, inside]
ru: blizzard → [метель]
    storm    → [гроза, буря, шторм]
    wind     → [ветер, ветрено, ветерок, бриз, легкий бриз, слегка ветрено, легкий ветер, "шквал,буря"]
    snow     → [снег, снегопад]
    rain     → [дождь, морось, ливень]
    mist     → [мгла, туман, туманно]
    sunny    → [солнечно, ясно, ярко, ясное утро, ясный день]
    none     → [облачно, пасмурно, в помещении, внутри]
```

- `"шквал,буря"` — одна строка с запятой, баг DES: просто «шквал» не матчится.
- Ничего не совпало → `none` → эффекта нет.
- Отрисовка (`:594-644`):
  - blizzard = снег + ветер;
  - storm = молнии + дождь;
  - sunny зависит от времени суток: ночью луна, звёзды и светлячки, днём солнце.
- Типов sandstorm, ash, leaves, hail, cloudy **нет**.

### 3.4 Indoor/outdoor

**Отдельного детектора нет**, хотя README его обещает (`README.md:63`).
- Работает только группа `none`: en `indoor`, `inside`; ru `в помещении`, `внутри`. Действие — убрать все эффекты.
- `location` не читается, флага indoor нет, принудительного переключателя нет.
- Так как `none` — последняя группа языка:
  - «в помещении, за окном дождь» → rain;
  - но «Indoor; дождь» → none, потому что английские группы проверяются раньше русских.

### 3.5 Почему у тебя «не срабатывает» — кандидаты

1. **Выключено по умолчанию:**
   - `enableDynamicWeather: false` (`state.js:55`);
   - показ погоды в Scene Tracker `sceneTracker.showWeather: false` (`state.js:94`). Его переключатель
     `#rpg-st-show-weather` заодно включает/выключает поле погоды **в промпте** (`index.js:1165-1171`, `:1299-1306`).
2. **Формы не из списка:**
   - «дождливо», «дожди», «моросит», «снежно», «вьюга», «пурга», «буран», «грозовой», «шквал», «дымка»,
     «ясный», «ясная ночь», «солнечный», «солнце» → none;
   - «Безоблачно» → none, потому что содержит «облачно».
3. **Смешанный текст** — побеждает ранняя группа:
   - «Ясно, лёгкий ветер» → wind;
   - «Холодный ветер, снег» → wind, не метель;
   - «Cloudy, дождь» → none.
4. **Промпт DES требует английский список.** Текст: `"forecast": "SINGLE keyword only. Valid forecast values (use one of these exactly): "blizzard", … "inside""`
   (`jsonPromptHelpers.js:194-199`). Язык `'en'` захардкожен. Русскоязычная модель на этом начинает импровизировать.
5. **Плоская форма поля** (§3.1).

### 3.6 Время суток (влияет только на вариант sunny и положение солнца/луны)

- `parseHourFromTime` (`weatherEffects.js:23-59`) понимает только английские слова (dawn, morning, noon, evening,
  night…), потом `ЧЧ:ММ` и am/pm.
- «Утро», «Вечер», «Ночь» → `null` → рисуется дневное солнце.
- «Поздний вечер, 23:10» работает благодаря цифрам.
- В шаблоне промпта формат времени не задан: `"time": {"start": "TimeStart", "end": "TimeEnd"}` (`jsonPromptHelpers.js:187`).

### 3.7 Где пользователь видит значение погоды

- **Только в Scene Tracker** (все раскладки), как `emoji + forecast`, и только при `showWeather` (`sceneHeaders.js:755-763`).
- Иконка статичная (`fa-cloud-sun`) и **не выбирается по ключевому слову**.
- Info Box, FAB и полоса погоду не показывают — это мёртвый код.
- **Модель тоже видит сохранённое значение** в следующем ходе: предыдущий трекер и история (`promptBuilder.js:110-148`,
  `:634-638`). Запись английского в стейт меняет то, что видит модель.

### 3.8 Внешний доступ

- `setWeather(type)` нет, CSS-классов, включающих эффект, нет: rain, snow и mist рисуются только на canvas.
- `WEATHER_PATTERNS_BY_LANGUAGE` **экспортирован и не заморожен**, его можно дополнять из импорта.
- `updateWeatherEffect()` экспортирован, вызывается без аргументов и читает стейт сам.

---

## 4. Алиасы (вопрос 4)

### 4.1 Хранилище и API

- **Хранилище:** `extensionSettings.characterAliases = { "<точное имя карточки>": ["алиас", …] }` — глобально,
  не по чатам (`state.js:71`).
- **Экспорты `src/systems/features/characterAliases.js`:**
  - `resolveCharacterAlias(name)` (`:48-51`);
  - `addCharacterAlias(canonical, alias): boolean` (`:64-77`) — дедуп без учёта регистра; сохранять вызывающий
    должен сам, через `saveSettings()` из `persistence.js`;
  - `applyCharacterAliases(thoughts, {suggestSimilar})` (`:567-618`);
  - `adoptVariantAsAlias(canonical, variant)` (`:355-477`);
  - `hasPendingAliasDecision`, `waitForAliasDecisions`.
- **Кэша нет:** словарь пересобирается на каждом вызове → новый алиас действует со следующего парсинга без перезагрузки.

### 4.2 Когда применяется — **до записи в стейт**

- **together:** `MESSAGE_RECEIVED` → `onMessageReceived` → `parseResponse` → `removeLocks` →
  `applyCharacterAliases(…, {suggestSimilar: true})`. Только после этого идут `lastGeneratedData`, сбор цветов,
  swipe-хранилище, рендер и сохранение (`sillytavern.js:153-278`).
- **separate/external:** `updateRPGData` (`apiClient.js:329-348`), тот же порядок.
- **При восстановлении** (загрузка чата, свайп) алиасы применяются только в памяти.
- Переписывается `char.name` в данных трекера; текст сообщения не трогается.

### 4.3 Алгоритм `applyCharacterAliases`

1. **Явный алиас** (trim + lowercase). Побеждает даже существующую карточку с таким же именем.
2. **Tier 1, структурный вариант** («Имя (пояснение)», английский артикль). DES тихо склеивает и **сам дописывает алиас**.
   - Тонкость: имя, равное карточке после нормализации (регистр, ё/е, й/и, пробелы), **не переписывается**.
     В результате `getCharacterList` создаёт вторую карточку с точным регистром: «аня» vs «Аня», «Алена» vs «Алёна» — тихие дубли.
3. **Tier 2**, только при свежем парсинге: `namesAreSimilar` (`src/utils/nameSimilarity.js:62-70`).
   - Допуск: Левенштейн ≤1, если короткое имя ≤5 символов, иначе ≤2; плюс подмножество слов или префикс.
   - Появляется попап «тот же персонаж?»: «Да» → `adoptVariantAsAlias`, «Нет» → отказ запоминается в `aliasDismissals`.

### 4.4 Как это работает на русских падежах (прогнано в node на реальном коде)

| Канон | Форма | Итог в DES |
|---|---|---|
| Аня | Ани / Аню / Ане | расстояние 1 → **попап** |
| Аня | Аней / Анею | расстояние 2 при коротком имени → **тихий дубль** |
| Анна | Анной | тихий дубль |
| Андрей | Андреем | попап (имя длинное, допуск 2) |
| Сергей | Сергея | попап |
| Аня Петрова | Ани Петровой | расстояние 3 → тихий дубль |
| Аня Петрова | Аня | попап (подмножество слов) |
| Аня | аня / АНЯ | тихий дубль по регистру |

### 4.5 Можно ли дописать алиас программно

- **Да, через импорт:** `addCharacterAlias(<точное имя карточки>, форма)` + `saveSettings()` из `persistence.js`.
- **Через `extension_settings[…].characterAliases` + `saveSettingsDebounced` — ненадёжно.** До первого
  `saveSettings()` DES в сессии это другой объект, чем живой стейт DES (`persistence.js:102-112`; об этом
  предупреждает комментарий самого DES в `characterAliases.js:195-201`).
- **Алиас, добавленный позже, не склеивает уже существующий дубль.** Полную склейку делает только
  `adoptVariantAsAlias`, и он **удаляет данные варианта глобально, во всех чатах** (портреты, цвета, ножи,
  внешность…), не трогая committed- и swipe-данные. Для обратимых склеек он не годится.
- **Открытый черновик Workshop** держит снимок алиасов; его сохранение перезапишет массив
  (`src/systems/ui/characterWorkshop.js:1189, 1204, 2627-2635`).

---

## 5. События, момент парсинга, API DES (вопрос 5)

### 5.1 Режимы генерации

Режим задаётся `extensionSettings.generationMode` (`state.js:13`); `autoUpdate` по умолчанию `false` (`state.js:11`).

| Режим | Как пишется трекер |
|---|---|
| `together` (по умолчанию) | в основном ответе модели |
| `separate` | отдельный запрос через ST `generateRaw` |
| `external` | прямой `fetch` из браузера к внешнему OpenAI-совместимому API |

### 5.2 Подписки DES на события ST

DES использует только обычный `eventSource.on`, без `makeFirst`/`makeLast`. Основные обработчики регистрируются **в конце длинной асинхронной
инициализации** (`index.js:3435-3456`).

| Событие | Обработчик | Что делает |
|---|---|---|
| `GENERATION_STARTED` | `injector.js:650` и др. | переносит трекер в committed; пишет все свои extension-слоты |
| `CHAT_COMPLETION_PROMPT_READY`, `GENERATE_*_COMBINE_PROMPTS` | `injector.js:524-602` | добавляет историю трекера в промпт |
| `MESSAGE_SENT` | `sillytavern.js:123` | флаг ожидания ответа; в separate без авто — коммит |
| **`MESSAGE_RECEIVED`** | **`sillytavern.js:153`** | **together: парсинг, стейт, рендер, сохранение; separate: планирует запрос трекера** |
| `CHARACTER_MESSAGE_RENDERED` | `index.js:3170` | только украшения (шапка, пузыри, мысли, кнопки) |
| `MESSAGE_SWIPED` | `sillytavern.js:435` | грузит swipe-данные, перерисовывает всё |
| `MESSAGE_UPDATED` | `index.js:3313` | только украшения, **без перепарсинга** |
| `MESSAGE_DELETED` | `sillytavern.js:506` | откат стора к последнему ответу |
| `CHAT_CHANGED` | `sillytavern.js:367` + ~9 сбросов кэшей | автосмена пресета, `loadChatData`, рендер; **стирает `extra.display_text`** (§11) |
| `GENERATION_ENDED/STOPPED`, `USER_MESSAGE_RENDERED`, `SETTINGS_UPDATED`, `CONNECTION_PROFILE_*`, `MORE_MESSAGES_LOADED` | разное | служебное |

**На что DES не подписан:** `MESSAGE_EDITED`, `STREAM_TOKEN_RECEIVED`, `APP_READY`.

**Порядок слушателей в ST 1.19 проверен:**
- `emit` вызывает слушателей по очереди и ждёт каждого (`await`);
- `makeFirst` ставит слушателя в начало списка (`ST:public/lib/eventemitter.js:90-107, 130-158`);
- `MESSAGE_RECEIVED` идёт перед `CHARACTER_MESSAGE_RENDERED` (`ST:public/script.js:3799-3800, 6691-6693`).

→ Наш `eventSource.makeFirst(MESSAGE_RECEIVED, …)` **гарантированно** выполнится до парсинга DES.

### 5.3 Момент парсинга

- **together:** на `MESSAGE_RECEIVED` DES берёт `chat[chat.length-1].mes` (аргумент messageId игнорирует).
  - Парсинг, стейт, swipe-данные, рендер и `saveChatData({immediate:true})` идут **одним синхронным проходом**
    (`sillytavern.js:153-297`). Внутри этого прохода вклиниться нельзя — только до (`makeFirst`) или после (`makeLast`).
  - Срабатывает на **каждый** `MESSAGE_RECEIVED`, включая first_message.
- **Как ищется блок:** все сбалансированные `{…}` в первых 50k символов, обёртка ```json не обязательна
  (`parser.js:125-163`). Если объектов больше одного, единый формат не распознаётся (`:206-208`) → **наша инъекция
  не должна провоцировать модель на второй JSON-объект**. Фоллбэки: ```json, `<trackers>`, старый текстовый формат.
- **`mes` DES не меняет никогда:** JSON остаётся в тексте сообщения. Скрывают его глобальные regex-скрипты ST,
  которые DES ставит сам (`index.js:2973-2993`):
  - «…Remove Tracker JSON (Together Mode)» — вырезает **любые** fenced-блоки из отображения и промпта
    (`src/systems/features/jsonCleaning.js:86-102`);
  - «Clean RPG Trackers (From Outgoing Prompt)»;
  - «Clean HTML (From Outgoing Prompt)» — вырезает **все HTML-теги** из ответов модели в исходящем промпте
    (`htmlCleaning.js:46-82`).
- **separate/external:** на `MESSAGE_RECEIVED` только `setTimeout(500)` → `updateRPGData` (если `autoUpdate`), иначе кнопка Refresh.
  - Между ответом модели и парсингом **нет события**.
  - В конце DES испускает через `eventSource` своё событие **`dooms_tracker_update_complete`** (без аргументов)
    (`apiClient.js:11, 483`). Это наша точка «после».

### 5.4 Собственный API DES

- **`window`:** только `window.DES_INSPECTOR` (read-only инспектор промптов) и два внутренних хелпера. `window.DES` нет.
- **Событие через `eventSource`:** только `dooms_tracker_update_complete`.
- **CustomEvent на `window`:**
  - DES испускает: `dooms:perf-mode-changed`, `dooms:tracker-config-saved`, `dooms:inject-state-changed`;
  - DES слушает (можно диспатчить): `dooms:open-workshop {characterName,isUser}`, `dooms:cancel-inject {name}`,
    `dooms:open-roster`, а также `doom-counter-trigger` на `document`.
- **Слэш-команды и макросы** DES не регистрирует.
- **Сообщения, которые DES игнорирует:** `extra.api==='manual' && extra.model==='tracker system'` или `extra.type` ∈
  `situationaltracker`/`stattracker`/`trackernote` (`src/utils/messageGuards.js:23-44`).
- **Полезные ES-экспорты** (импорт по точному URL `/scripts/extensions/third-party/<папка>/src/…`):
  - `core/state.js`: `extensionSettings`, `lastGeneratedData`, `committedTrackerData` и их сеттеры;
  - `core/persistence.js`: `saveSettings`, `saveChatData`;
  - `features/characterAliases.js`: `addCharacterAlias`, `applyCharacterAliases`;
  - `ui/weatherEffects.js`: `WEATHER_PATTERNS_BY_LANGUAGE`, `updateWeatherEffect`;
  - рендеры: `portraitBar.js` → `updatePortraitBar`, `clearPortraitCache`; `thoughts.js` → `renderThoughts`, `updateChatThoughts`;
    `sceneHeaders.js` → `updateChatSceneHeaders`, `resetSceneHeaderCache`.
- **Ограничение:** экспортированные функции подменить нельзя (привязки ES-модулей только для чтения), можно лишь
  вызывать их и мутировать объекты.

---

## 6. Промпт трекера (вопрос 6)

### 6.1 together — через `setExtensionPrompt`: **наш промпт попадает в тот же запрос**

| Слот DES | Позиция / глубина / роль | Содержимое |
|---|---|---|
| `dooms-tracker-inject` | `IN_CHAT`, depth 0, role **user** (`state.js:18`, `injector.js:856-861`) | инструкция и JSON-шаблон трекера |
| `dooms-tracker-example` | `IN_CHAT` на глубине последнего ответа, role assistant | предыдущий трекер в ```json |
| `dooms-tracker-html`, `dooms-tracker-dialogue-coloring` | `IN_CHAT`, depth 0, system | HTML и раскраска |
| `dooms-tracker-new-fields`, `dooms-doom-counter-twist`, слоты Workshop | разные | — |

- ST склеивает extension-промпты с одинаковыми позицией, глубиной и ролью **в алфавитном порядке ключей**
  (`ST:public/script.js:3309-3315`). Выбором имени ключа наш текст можно поставить сразу после
  `dooms-tracker-inject`, чтобы перекрыть английский список погоды.
- DES переписывает свои слоты на каждом `GENERATION_STARTED`.
- DES вставляет свои слоты в **любой** `Generate()`, включая quiet. Нам не мешает, просто знать.

### 6.2 separate — **нет**

- Запрос собирается с нуля (`promptBuilder.js:834-960`) и уходит через `generateRaw`.
- Extension-промпты, World Info, Author's Note и пресет туда не попадают (проверено по ST: `generateRaw` не
  вызывает `getExtensionPrompt`, `ST:public/script.js:4122`).
- Влиять можно только через сохранённые промпты DES.

### 6.3 external — **нет**

Прямой `fetch` к `<baseUrl>/chat/completions`, мимо всего пайплайна ST (`apiClient.js:46-106`).

### 6.4 Prompt Editor DES

Всё хранится в `extension_settings['third-party/<папка>']`; пустая строка = «использовать дефолт».
Вне таблицы остаются ещё ~10 промптов (HTML, раскраска, твисты, ножи, портреты) — они нас не касаются.

| Поле редактора | Ключ |
|---|---|
| Tracker Prompt (полная замена всего блока, побеждает всё) | `customTrackerPrompt` |
| Tracker Instructions (поддерживает `{userName}`) | `customTrackerInstructionsPrompt` — **заменяет** штатную фразу-инструкцию DES (`promptBuilder.js:177-185`) |
| Weather Forecast Instruction | `customWeatherPrompt` — подставляется **внутрь** `"forecast": "…"` (`jsonPromptHelpers.js:197-198`) |
| Character Thoughts | `customCharacterThoughtsPrompt` |

- **Для имени персонажа отдельной инструкции нет:** захардкожено `"name": "CharacterName"` (`jsonPromptHelpers.js:266-268`).
- **DES читает всё это заново** на каждой генерации, без кэша. Ловушки:
  1. До первого `saveSettings()` DES запись верхнеуровневых ключей в `extension_settings[…]` уходит не в тот объект.
  2. `trackerConfig` целиком заменяется при `CHAT_CHANGED` (автопресеты), при Cancel в Tracker Editor и при импорте (`persistence.js:1273-1425`).

### 6.5 Вывод по опции «инжект инструкции модели»

- **together:** работает наш `setExtensionPrompt`.
- **separate/external:** только текст для ручной вставки в Prompt Editor DES. Черновик:
  - **Поле «Weather Forecast Instruction»** (стоит внутри кавычек JSON-шаблона, поэтому без двойных кавычек):
    ```text
    одно значение по-русски, в начальной форме, без пояснений, из списка: метель, гроза, шторм, ветер, снег, снегопад, дождь, ливень, морось, туман, ясно, солнечно, облачно, пасмурно, в помещении
    ```
  - **Поле «Tracker Instructions»** — дописать **в конец штатного текста** (поле заменяет его целиком, поэтому
    сначала скопировать то, что там стоит по умолчанию):
    ```text
    Значения пиши по-русски, ключи JSON не трогай. "name" — имя персонажа в именительном падеже, ровно как на его карточке (не «Ани»/«Аней», а «Аня»). "time" — всегда с часами в формате ЧЧ:ММ (например, «Вечер, 19:40»). Значения из фиксированных списков (статус отношений и т. п.) пиши ровно как в списке.
    ```
- Финальный текст я выверю на этапе модуля 3. Здесь он — чтобы показать, что опция реализуема.

---

## 7. Коммит и прочее (вопрос 7)

- **Коммиты:** DES `10ad241514d6d015b6c655d7542d561d47fd6cf0` (v2.6.0, 2026-09-25); ST 1.19.0 `7e8663cd9c184a550b37238218bdd32c6efc68e9`.
- **Телеметрия:** фраза README «DES sends no telemetry» на HEAD верна. Анонимный usage-ping был добавлен в `ca7fbbb`
  и удалён в `47b909f` (2026-07-16); тег `usage-ping` остался в репозитории как след.
- **Но:** при **каждой загрузке страницы, даже с выключенным DES**, уходит `GET https://api.github.com/repos/DangerDaza/Dooms-Enhancement-Suite`
  (счётчик звёзд, `index.js:337`). Для нашего расширения это неважно, отмечаю для полноты картины.

---

## 8. NovelAI и картинки (твой вопрос)

### 8.1 Прямой интеграции с NovelAI в DES нет

Поиск по всему репозиторию: ни `novelai`, ни `nai`, ни `image.novelai.net`. Собственного HTTP-клиента
для картинок у DES нет.

### 8.2 Что есть: портреты NPC через штатный `/sd` ST

- **Как генерируется:**
  - Все картинки DES — портреты, через `executeSlashCommandsOnChatInput('/sd quiet=true <prompt>')`
    (`src/systems/features/avatarGenerator.js:413-416, 685-688`).
  - Перед этим проверяется, что `/sd` вообще есть (`:53-56`).
- **Кто запускает:**
  - **Auto Portraits:** `portraitEnhancementMode: 'autoPortraits'` + `autoPortraitMode`
    ∈ `only_missing` / `state_changed` / `every_reply` (`state.js:341-343`, `avatarGenerator.js:69-76`).
    По умолчанию выбран режим `expressions`. `state_changed` — перерисовка при смене состояния, это и есть «Costume Change» из релиза 2.6.0.
  - **Пакетная генерация** `autoGenerateAvatars` (по умолчанию `false`, `state.js:355`).
  - **ПКМ по карточке:** «Regenerate Portrait» и «Restore Previous Portrait» (хранится история из 5, `portraitBar.js:1127-1166`); то же есть в Workshop.
- **Промпт картинки:**
  - его пишет LLM по системке «image-generation prompts for anime-style models» (`promptBuilder.js:1144`);
  - либо берётся фиксированная строка из Workshop → Appearance → «Portrait prompt» (`characterAppearance`, `avatarGenerator.js:58-67`);
  - перед отправкой из него вычищаются `|`, `{{ }}` и переводы строк (`:41-51`).
- **Результат:** URL пишется в `extensionSettings.npcAvatars[name]`; data-URL сохраняются файлом в `/user/images/des-portraits/`.
- **Следствие:** `/sd` берёт источник из ST → Image Generation. В ST 1.19 есть источник `novel` с моделями до
  `nai-diffusion-4-5-full` / `-curated` (`ST:public/scripts/extensions/stable-diffusion/index.js:78, 2460-2484`).
  Выбери там NovelAI, и портреты DES пойдут через NovelAI, с ключом в секретах сервера ST. naiproxy для этого не нужен.

### 8.3 Inline-картинок нет

- DES не генерирует картинки в тексте сообщений и не создаёт `extra.media`.
- В чате DES показывает только портреты: аватар говорящего в чат-пузырях (`chatBubbles.js:931`) и портрет в пузыре мыслей (`thoughts.js:644`).
- **Единственное «картинка в сообщение»** — Workshop → Inject into Scene → Attach Portrait (`injectAttachPortrait`,
  по умолчанию `false`, `state.js:276`).
  - На следующем `MESSAGE_SENT` DES кладёт портрет в `extra.image` + `extra.inline_image = true` сообщения
    **пользователя**, чтобы его увидела модель со зрением (`characterWorkshop.js:3326-3362`).
  - В ST 1.19 `extra.image` — устаревшее поле: при отрисовке ST переносит его в `extra.media`
    (`ST:public/script.js:2144-2160, 2178-2181`), так что портрет ещё и виден вложением.
- **Inline Banners** (`inlineBanners`) — текстовые карточки смены сцены, без картинок.
- **Опция HTML** (`DEFAULT_HTML_PROMPT`, `promptBuilder.js:21`) просит модель встраивать HTML/CSS/SVG, «embed all assets directly».
  Если её включить, она может спорить с инструкцией пресета вставлять внешний `<img src>`.

### 8.4 Как DES уживается с naiproxy (`<img src=…/gen?…&token=…>` в тексте ответа)

- **Плюс: история не уходит модели.** Regex «Clean HTML (From Outgoing Prompt)», который DES ставит сам, вырезает все теги из ответов модели
  в **исходящем промпте**. Твои `<img>` из истории не уходят модели и провайдеру: токен прокси не светится, токены экономятся.
  На отображение он не влияет.
- **Риск: код-блоки.** Regex «Remove Tracker JSON (Together Mode)» прячет **любые** fenced-блоки ```…``` в ответах. Если пресет когда-нибудь
  обернёт `<img>` в код-блок, картинка исчезнет.
- **Проверить руками: чат-пузыри.** Они перестраивают `.mes_text`; инлайн-элементы, включая `<img>`, переносятся как outerHTML
  (`chatBubbles.js:643-646`). Должно выживать — внесу в ручной чек-лист.
- **Для README:** в ST по умолчанию `forbid_external_media: true` (`ST:public/scripts/power-user.js:336`). У тебя это уже решено, раз naiproxy работает.

### 8.5 Что умеет сам ST 1.19 (к проектированию будущего модуля)

- **Разовые параметры `/sd`:** `width`, `height`, `seed`, `steps`, `cfg`, `negative`, `model`, `sampler`,
  `scheduler` и др. временно перекрывают настройки на один вызов
  (`ST:…/stable-diffusion/index.js:5385-5449, 5495-5521`). Размер и пропорции **на каждую картинку** в 1.19 можно задать
  штатным `/sd`. Ограничение «только глобальные настройки» было у auto_illustrator, не у ST.
- **`quiet=true`** возвращает путь сохранённого файла и ничего не публикует в чат (так DES забирает портреты).
- **Событие `SD_PROMPT_PROCESSING`** даёт расширению переписать промпт картинки перед генерацией (`ST:…/stable-diffusion/index.js:3054-3057`).
- **Ещё есть:** function tool `GenerateImage`, interactive mode, Anlas guard для NovelAI (`novel_anlas_guard`).
- **Вложения сообщений** в 1.19 — это `extra.media[]` (`{url, type, title, source}`) + `media_index`; `getContext()` отдаёт
  `appendMediaToMessage` и `ensureMessageMediaIsArray`.

### 8.6 Варианты будущего NovelAI-модуля (решать не сейчас)

| Вариант | Как | Плюсы | Минусы |
|---|---|---|---|
| A. Как сейчас: naiproxy + `<img src>` в тексте | модель пишет тег, браузер грузит картинку | ноль клиентского кода, кэш на сервере | токен прокси в истории чата; внешний домен; картинка — не вложение ST (нет галереи и свайпов) |
| B. Наш модуль + штатный `/sd` с источником NovelAI | модель пишет плейсхолдер (`<pic prompt=… ratio=…>`), модуль вызывает `/sd quiet=true width=… height=…` и кладёт результат в `extra.media` | ключ в секретах ST, картинки — файлы ST, видны как вложения, сетевых запросов из нашего кода нет (ходит сервер ST) | зависим от настроек ST Image Generation; парсинг плейсхолдеров |
| C. Наш модуль + naiproxy | модуль ловит плейсхолдер и ходит в прокси | все параметры прокси (V4.5/V5, свои дефолты) | сетевые запросы из расширения (ТЗ их запрещает — нужно отдельное решение); токен на клиенте |

---

## 9. Точки интеграции — предложение по модулям

### 9.1 Общий адаптер (`src/des-adapter.js`)

| Нужно | Точка | Механизм | Нужен импорт DES? |
|---|---|---|---|
| Найти DES, понять, включён ли он | `extensionNames` (`ST:public/scripts/extensions.js:21`) + `getExtensionManifest()` (display_name / homePage) + `extension_settings.disabledExtensions` | API ST | нет |
| Версия DES | `manifest.version` | API ST | нет |
| DES готов | появились `#dooms-settings-fab` / `#rpg-extension-enabled` | DOM | нет |
| До парсинга (together) | `eventSource.makeFirst(MESSAGE_RECEIVED)` + `chat[last].mes` | события ST | нет |
| После парсинга (together) | `makeLast(MESSAGE_RECEIVED)` / `CHARACTER_MESSAGE_RENDERED` | события ST | для правки стейта — да |
| После separate/external | `eventSource.on('dooms_tracker_update_complete')` | событие DES | для правки — да |
| Читать трекер | `chat[i].extra.dooms_tracker_swipes[swipe_id]`, `chat_metadata.dooms_tracker` | данные ST | нет |
| Дописать алиас | `addCharacterAlias` + `saveSettings` | импорт | **да** |
| Править трекер и перерисовать | сторы + swipe-данные + `saveChatData` + рендеры (§5.4) | импорт | **да** (без импорта перерисовать можно только портрет-бар — через `dooms:inject-state-changed`) |
| Словарь погоды | `WEATHER_PATTERNS_BY_LANGUAGE` | импорт | **да** |
| Инструкция модели (together) | `setExtensionPrompt('<ключ после dooms-tracker-inject>', …, IN_CHAT, 0, false, USER)` | API ST | нет |
| Свои данные | `extension_settings.desru`, `chat_metadata.desru` (не внутри `dooms_tracker`!) | ST | нет |

- **Зависимость от DES** через `dependencies` в манифесте **не ставим**: без DES ST тогда откажется нас грузить и покажет ошибку,
  а нужна тихая деградация. `loading_order` ставим больше 100 (у DES 100).
- **Гард:**
  - на старте — версия манифеста DES + жадные селекторы (+ ожидаемые экспорты, если выберем импорт);
  - ленивые селекторы проверяем при появлении шаблона;
  - не сошлось → предупреждение, модули 2 и 3 выключаются, модуль 1 работает по возможности.

### 9.2 Модуль 1 — локализация

- **Наблюдение** по схеме из §1.6.
- **Словарь** с двумя типами записей: точные строки и шаблоны с плейсхолдерами (§1.3).
- **Непереведённое** копим только из узлов внутри корней DES; кнопка выгрузки в JSON.
- **Идемпотентность по содержимому** (из-за i18n DES, §1.6).

### 9.3 Модуль 3 — погода (предлагаю пересмотреть задачу)

Раз DES уже понимает русские базовые формы, подмена на английский не нужна. Предлагаю:
- **(c) Промпт** — основное. Наша инструкция в together («forecast — одно значение из списка …», «time — с ЧЧ:ММ»);
  для separate/external — текст для Prompt Editor (§6.5).
- **(a) Словарь DES в памяти** — страховка. При старте дописать в группы `WEATHER_PATTERNS_BY_LANGUAGE.ru` основы и формы
  из нашего редактируемого маппинга: «дожд», «морос», «ливн», «снеж», «вьюг», «пург», «буран», «гроз», «шквал», «дымк», «ясн», «солнеч»…
  - Стейт не трогаем: пользователь и модель видят русское.
  - Нужен импорт; порядок групп и ложные срабатывания на подстроках учитываем.
  - Нужен ещё ответ на вопрос 2b (§10): мутировать данные DES в памяти — согласовывать отдельно.
- **(b) Подмена значения в стейте + обратный перевод в UI** — **не предлагаю.** Модель в следующем ходе увидит английское,
  а показ русского потребует переписывать значение поля трекера в DOM, что противоречит правилу «не трогать значения».
- **Плюс подсказки:** наша панель читает `enableDynamicWeather` и `sceneTracker.showWeather` DES и подсказывает,
  если они выключены. Это только чтение, без записи.

### 9.4 Модуль 2 — имена

- **together:**
  1. `makeFirst(MESSAGE_RECEIVED)` → достаём имена из JSON в `chat[last].mes`.
  2. Наш матчер (отсечение окончаний + сравнение основ с порогом) сверяет их с карточками: per-chat `knownCharacters`,
     глобальные карточки, алиасы, исключения.
  3. Совпало → алиас в DES (`addCharacterAlias`) → DES канонизирует сам: без попапа и без дубля.
- **separate/external:** события до парсинга нет.
  - Вариант 1 — правка постфактум после `dooms_tracker_update_complete`. Дубль мелькнёт; попап DES Tier 2 может успеть появиться.
  - Вариант 2 — заранее генерировать вероятные падежные формы известных имён и дописывать их алиасами.
- **Защита от склеек:** исключения («две Ани»); не дописывать алиас, равный существующей карточке или персоне;
  канон — точное имя карточки.
- **Журнал склеек** храним у себя; «разъединить» = удалить алиас и запись журнала. Прошлые ходы уже сохранены
  каноническим именем; задним числом их не разделить, только будущие ходы. Это честное ограничение — пропишу в UI.
- **`adoptVariantAsAlias` не используем** (глобально удаляет данные варианта).
- **Уже существующие дубли:** нужна точечная склейка — per-chat `knownCharacters`/`characterColors`, сторы, swipe-данные
  последнего ответа, `saveChatData`, перерисовка. Только с импортом.

---

## 10. Развилки — нужны твои решения

1. **Глубина интеграции.**
   - **A** — как в ТЗ: только DOM, события и публичный API ST.
   - **B** — то же плюс импорт ES-модулей DES (тот же экземпляр по точному URL), строго через `des-adapter.js`
     с проверкой наличия каждого экспорта.

   → **Рекомендую B.** Без него модуль 2 работает только в together, причём переписывая имена прямо в JSON внутри `mes`;
   существующие дубли не склеить; модуль 3 теряет вариант (a).
2. **Модуль 3.**
   - **a)** Согласна ли ты переформулировать задачу: вместо «подменять на английский» — промпт (c) + словарь DES в памяти (a), без (b)?
   - **b)** Мутировать `WEATHER_PATTERNS_BY_LANGUAGE` в памяти — для тебя это допустимо, или это «хак», которого не надо?
   - **c)** Добавить в модуль 3 время суток (инструкция «ЧЧ:ММ»)?
3. **Модуль 2.**
   - **a)** Писать алиасы в `characterAliases` DES (рекомендую: они видны и удаляются в Workshop → Identity)
     или держать только в своём сторе?
   - **b)** Separate/external: правка постфактум или проактивная генерация падежных форм?
4. **Модуль 1.**
   - **a)** Тосты DES переводить (наблюдение за контейнером toastr, только точные совпадения и шаблоны) или нет?
   - **b)** Нативные `confirm`/`prompt` оставить английскими (рекомендую) или подменять `window.confirm` (не рекомендую)?
   - **c)** Брать ли старый `ru.json` DES (≈230 строк до `eb25dd6`, AGPL, ключи i18n DES) как источник терминологии
     с атрибуцией — или переводим с нуля?
5. **Гард версии.** Проверяем версию манифеста и жадные селекторы на старте, ленивые — при появлении. Строгое «все
   селекторы на старте» невозможно из-за ленивой загрузки. Ок?
6. **Русские проблемы вне ТЗ (§11).** Предлагаю пока только показывать предупреждения в нашей панели
   (кириллические названия полей, выключенная погода и т. п.), а фиксы — отдельным этапом после модуля 2. Ок?
7. **Живые данные.** Разрешишь посмотреть на VPS реальные значения `weather.forecast` и имена в
   `extra.dooms_tracker_swipes` твоих чатов (только поля трекера, без текста сообщений)? Это подтвердит причину §3.5
   и даст реальные падежные формы для тестов. SSH из этой сессии упирается в сетевую песочницу, нужен запуск без неё.
8. **Имя репозитория:** `SillyTavern-DES-RU` — оставляем?

---

## 11. Русская специфика, найденная попутно (вне ТЗ)

> Что из этого обходит надстройка — модуль 4 (README). Что снаружи не исправить — готовые issue для DES
> в `docs/upstream-issues.md`.

1. **Присутствие в сцене.** Английские regex с `\b` по тексту мыслей (`portraitBar.js:1252`, `thoughts.js:534, 1506`,
   `sceneHeaders.js:825`): «не в сцене», «ушла» не распознаются, персонаж остаётся присутствующим.
2. **`\b` в сопоставлении имён.**
   - Затронуты: `namesMatch` (`portraitBar.js:728-737`, `thoughts.js:138-152`, `avatarGenerator.js:207-219`),
     атрибуция говорящего в чат-пузырях (`chatBubbles.js:338`, `findClosestName` `:774-790`).
   - В JS `\b` и `\w` работают только по ASCII **даже с флагом `u`**. Для кириллического имени частичное совпадение
     не находится никогда, `findClosestName` возвращает `null`.
3. **Кириллические названия пользовательских полей.** `toSnakeCase`/`toFieldKey` оставляют `[a-z0-9]` → пустой ключ
   (`jsonPromptHelpers.js:15-32`). Поле сцены **молча выпадает** из промпта (`:127-129`), поля персонажа сталкиваются под ключом `""`.
   Обход: называть поля латиницей.
4. **`sanitizeFilename`** (`portraitBar.js:1471-1473`) стирает кириллицу → поиск портрета по имени в папке `portraits/` не работает.
5. **Время суток** — только английские слова (§3.6).
6. **Квесты.** Отсутствие квеста — это строка `'None'` с точным сравнением (`quests.js:42,104`, `sceneHeaders.js:857`):
   русское «Нет» покажется как название квеста.
7. **Статусы отношений.** Промпт: «choose one: Lover/Friend/Ally/Enemy/Neutral»; бейдж ищется точным сравнением
   (`thoughts.js:621-629`). Переименовать в русские можно в Settings → Workshop → Relationships, без кода.
   В ростере зашит английский `REL_EMOJI` (`characterRoster.js:63-69`).
8. **Фаза луны и напряжение** — английские списки в промпте, показываются как есть; перенастраиваются по виджету (`jsonPromptHelpers.js:214-226`).
9. **`extra.display_text`.** На каждом `CHAT_CHANGED` DES стирает его у всех сообщений не-пользователя (`index.js:3046-3075`).
   Встроенный переводчик чата ST хранит перевод именно там (`ST:public/scripts/extensions/translate/index.js:215`),
   поэтому с DES переводы слетают при смене чата.
10. **Регистр и ё.** Поиск алиаса — простой lowercase, а сравнение похожести складывает ё→е и й→и. Получаются тихие дубли
    «Алёна»/«Алена», «аня»/«Аня» (§4.3).

---

## 12. Решения и данные с сервера (2026-10-01)

### 12.1 Решения по §10

| # | Вопрос | Решение |
|---|---|---|
| 1 | Импорт ES-модулей DES | **Да**, только через `src/des-adapter.js` |
| 2 | Модуль 3 | Промпт + дополнение словаря погоды DES в памяти, без подмены значений; время ЧЧ:ММ — да |
| 3 | Модуль 2: куда писать алиасы | В `characterAliases` DES. Separate/external (решено на этапе модуля 2): **только режим together**, в других — предупреждение в панели, похожие имена спрашивает штатный попап DES |
| 4 | Модуль 1 | Тосты переводим; `confirm`/`prompt` остаются английскими; старый `ru.json` DES — источник терминов с атрибуцией |
| 5 | Гард | Версия и жадные селекторы на старте, ленивые — при появлении |
| 6 | Русские баги §11 | Чинить сразу, а не отдельным поздним этапом → появился **модуль 4 «Исправления DES для русского»** |
| 7 | Живые данные | Разрешено смотреть сервер |
| 8 | Имя | Отображаемое: «SillyTavern - Doom's Enhancement Suite - RU»; репозиторий: `SillyTavern-Doom-Enhancement-Suite-RU` (в имени репозитория GitHub нельзя пробелы и апостроф) |
| — | Порядок этапов | скелет → модуль 4 (исправления) → модуль 1 → модуль 3 → модуль 2 → README |

### 12.2 Что на сервере (только чтение)

- **Установка:** ST 1.19.0 в Docker; DES лежит в `/opt/sillytavern/extensions/Dooms-Enhancement-Suite` (глобальный third-party), коммит
  **ровно `10ad241`**. Поставлен **сегодня в 12:25 UTC**, поэтому данных DES в чатах ещё нет: ни один из 42 чатов не содержит `dooms_tracker`.
- **Настройки DES:**

  | Настройка | Значение |
  |---|---|
  | режим генерации | `together` — значит, перехват `makeFirst(MESSAGE_RECEIVED)` покрывает всё |
  | `autoUpdate` | `false` |
  | динамическая погода | **включена**; поле погоды в промпте есть, но в Scene Tracker она не показывается (`showWeather: false`) |
  | раскраска диалогов | вкл. |
  | чат-пузыри | `cards` |
  | мысли в чате | вкл. |
  | History Persistence | вкл. |
  | Lore Library | вкл. |
  | Doom Counter | выкл. |
  | алиасы | пусто |
  | `autoGenerateAvatars` | **вкл.** |

- **Поля персонажа названы кириллицей: «Внешность», «Поведение».** Это ровно баг §11.3: DES строит из них пустые
  ключи `""`. Первая живая цель для модуля 4.
- **Статусы отношений:** к английским добавлены русские («Любовник», «Друг», «Союзник», «Враг», «Нейтральный»); подпись мыслей — «Мысли».
- **Генерация картинок ST уже настроена на NovelAI:** `sd.source: novel`, `nai-diffusion-4-5-full`, 1088×1920,
  interactive mode и function tool включены. Портреты DES пойдут через NovelAI сразу.
- **Встроенный переводчик ST настроен** (Яндекс, ручной режим) → баг §11.9 (стирание `display_text`) для тебя актуален.
- **Внешние картинки:** `forbid_external_media: false` — для naiproxy.
- **Отключены:** sillyimages, auto-illustrator, rpg-companion.
- **Regex DES на месте:** все три + один от RPG Companion.

### 12.3 Реальные ответы модели (3 свежих чата с RPG Companion — тот же формат трекера)

| Что | Что пишет модель |
|---|---|
| Погода | `{"emoji": "☀️", "forecast": "солнечно"}` во всех 72 записях — базовая форма, которую DES понимает |
| Время | всегда `ЧЧ:ММ` (144 из 144) |
| Ключи `details` | `внешность`, `поведение` — модель держит кириллические ключи |
| Отношения | «Любовник», «Нейтральный», «Союзник» |
| Имена | в трекере пишутся в именительном падеже; падежных дублей в выборке нет |

Дубли имён всё же есть, но другого рода:
- «Акари» / «Акари Саотомэ» — подмножество слов, DES спросит попапом;
- «Мисс Танака» / «Мисс Танака (голос из зала)» — уточнение в скобках, DES склеит сам;
- групповые NPC вроде «Студентки в зале».

Выборка небольшая, поэтому матчер имён (модуль 2) всё равно нужен; его тесты дополню этими примерами.

---

## 13. Что не проверено и требует живого ST

- Реальный порядок вставки DOM у ST: вложенность `#send_form` в `#form_sheld`, `.mes_buttons` в `.mes_block`,
  контейнер toastr. Агент вывел это из кода DES, а не из DOM ST. Проверю при первом запуске скелета.
- Выживание `<img>` naiproxy внутри чат-пузырей DES (§8.4).
- Поведение при выключении и повторном включении DES без перезагрузки (DES заново вызывает `initUI`, §1.6).

## 14. Этап 3: что выяснилось на живом ST

- **Строки, склеенные из нескольких литералов.** Например, `Open ${name} in Workshop${activeSuffix}` или счётчик
  каталога `${total} ${'character'|'characters'}${scopeTxt}${activeTxt}`. В словаре лежат строки целиком, какими
  они видны на странице. `extract-des-strings.mjs --stale` такие ключи показывает как «не найденные» — это ожидаемо.
- **Значок плюс один кусок текста** (`<i class="fa-…"></i> Tracker Prompt`) — это не HTML-фрагмент: переводится
  текстовый узел, а ключ нужен простой.
- **Мобильная вёрстка.** У подписей ползунков в настройках DES на телефоне 85 px (`nowrap` + многоточие), поэтому
  переводы там короткие: «Ширина», «Шрифт», «Скругление». Где коротким переводом не обойтись, правка вёрстки
  лежит в `DES_UI.layoutFixes` и подключается только вместе с модулем 1:
  - ряд «Вернуть встроенный · Глубина · Роль» в редакторе промптов — перенос;
  - кнопки футера редактора трекера на узком экране — поля поуже.
- **Тестовая среда.** Мобильные стили ST задают ширины в `100dvw`. В скрытом окне браузера `dvw` = 0, и вся вёрстка
  схлопывается — это артефакт среды, а не DES. Мерить на видимом окне или подменять `dvw` на пиксели.
- **Нативные `confirm`/`prompt`** (31 вызов) остаются английскими, как решено в §12.1. Текст попапов ST,
  которые DES открывает через `callGenericPopup`, переводится; кнопки у них от ST.

## 15. Этап 4: погода и время на живом ST

- **Кэш разбора погоды.** `parseWeatherType` запоминает тип по тексту прогноза в `weatherTypeCache`
  (`weatherEffects.js:17`), а сбрасывает кэш только после 200 разных текстов (`:217`). Снаружи кэш не очистить.
  Поэтому слова, дописанные после первого разбора, на уже разобранный прогноз не действуют до перезагрузки.
- **Когда успеть.** ST грузит скрипты расширений внутри `getSettings()` (DES — порядок 100, мы — 110), а последний
  чат открывает позже: `RA_autoloadchat` в `initRossMods()` идёт ещё до `APP_READY`. Поэтому модуль 3 дописывает
  слова в ранний шаг ядра (`preload`, до `APP_READY`, только проверка экспортов). Гард проверит DES уже потом;
  если не пустит, ядро снимет слова. Проверено: строка «дописано слов: 30 (при загрузке)» стоит в журнале раньше
  «Запуск надстройки».
- **Шаблон трекера.** Инструкция погоды — `"forecast": "SINGLE keyword only. ${getWeatherKeywordsAsPromptString('en')}"`
  (`jsonPromptHelpers.js:195-198`); функция экспортирована, поэтому точный текст строим ей же и меняем без регэкспов.
  Время — `"time": {"start": "TimeStart", "end": "TimeEnd"}`, поле обязательное (`CORE_FIELDS`). Своя «Инструкция
  для погоды» в редакторе промптов DES (`customWeatherPrompt`) заменяет штатную — тогда мы её не трогаем.
- **Поле погоды в промпте** включает `trackerConfig.infoBox.widgets.weather.enabled`. Переключатель «Погода» в
  трекере сцены меняет и показ, и это поле, но редактор трекера меняет только поле — поэтому подсказки модуля
  смотрят на поле.
- **Проверка на моке:** ответ с «моросит» (нет в словаре DES) → `getParticleEngine().active` = `rain`. В запросе к
  модели — наша инструкция погоды и `ЧЧ:ММ`; с выключенным модулем — снова штатный английский шаблон.
- **Пределы.** «угроза» содержит «гроза» из словаря самого DES — это гроза, и снаружи это не исправить
  (`docs/upstream-issues.md` §7). Группа `none` проверяется последней, поэтому дописывать в неё бессмысленно:
  «в помещении, за окном дождь» у DES — дождь.

## 16. Этап 5: имена на живом ST

- **Точка.** DES подписан на `MESSAGE_RECEIVED` обычным `on` (`registerAllEvents`, `index.js:3438`) и берёт
  `chat[последнее].mes`. Наш `makeFirst` срабатывает раньше. Имена достаём экспортированным `parseResponse` DES —
  это чистая функция, поэтому видим ровно то, что DES разберёт следом.
- **Канон** — как у DES в `buildCanonicalNameMap`: `extensionSettings.knownCharacters`, `userCharacters` и
  `chat_metadata.dooms_tracker.knownCharacters`. Алиасы — только к NPC; имя, совпавшее по ключу DES с другой
  карточкой (в том числе персонажем пользователя), не трогаем: явный алиас DES сильнее существующей карточки.
- **Отказы попапа** DES хранит в `aliasDismissals["<ключ варианта>|<ключ канона>"]`. Ключ — `normalizeName`:
  нижний регистр, без диакритики (ё → е, й → и). Модуль такие пары тоже не склеивает.
- **Удаление алиаса.** Функции удаления DES не экспортирует; его комментарий допускает замену массива целиком
  (так делает Workshop). Так и разъединяем.
- **Проверено на моке:**
  - «Ани» → алиас до разбора, попапа нет;
  - «Аней» → алиас, а без модуля DES молча заводит карточку «Аней»;
  - «мира» при «Мира» без модуля DES тоже заводит вторую карточку — подтверждение §4.3;
  - с выключенным модулем «Аню» вызывает попап DES, и ответ «Нет» модуль потом уважает.
- **Фоновые генерации.** `GENERATION_STARTED` приходит и на генерации, для которых DES слот трекера не переписывает.
  В слоте остаётся уже поправленный текст, поэтому «наша правка уже стоит» считается успехом. Это касается
  и модуля 3, ложные предупреждения там исправлены.
