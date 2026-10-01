/**
 * Адаптер DES — единственное место, которое знает, как устроен Doom's Enhancement Suite:
 * где он установлен, какие его ES-модули и экспорты мы используем, какие селекторы DOM
 * проверяем, какие ключи данных и события у него есть. При обновлении DES правится только
 * этот файл. Подробности и ссылки на код DES — в docs/des-recon.md.
 *
 * Сверено с DES 2.6.0 (коммит 10ad241) на SillyTavern 1.19.0.
 */
import { getContext, importSt } from './st.js';
import { log } from './log.js';

export const DES_INFO = Object.freeze({
    displayName: "Doom's Enhancement Suite",
    /** Часть homePage манифеста, в нижнем регистре. */
    repo: 'dangerdaza/dooms-enhancement-suite',
    /** Имя папки при установке по URL репозитория. */
    defaultName: 'third-party/Dooms-Enhancement-Suite',
    verifiedVersions: Object.freeze(['2.6.0']),
    verifiedCommit: '10ad241',
});

export const DES_SELECTORS = Object.freeze({
    /** Переключатель в блоке DES в Extensions: блок появляется при старте, даже если DES выключен своим переключателем. */
    drawerToggle: '#rpg-extension-enabled',
    /** Кнопка «D»: появляется в initUI, только если DES включён. */
    fab: '#dooms-settings-fab',
    /** Первый корень template.html: по нему видно, что DES вставил ленивые окна в <body>. */
    templateMarker: '#rpg-settings-popup',
    /**
     * Корни template.html и их ключевые узлы. Шаблон вставляется в <body> целиком
     * при первом открытии любого окна DES, поэтому проверяются все сразу.
     */
    templateRoots: Object.freeze({
        '#rpg-settings-popup': Object.freeze(['.rpg-settings-popup-content', '.rpg-accordion-section[data-accordion]']),
        '#rpg-system-log-popup': Object.freeze([]),
        '#rpg-notification-log-popup': Object.freeze([]),
        '#rpg-inspector-popup': Object.freeze([]),
        '#rpg-character-sheet-popup': Object.freeze(['.rpg-cs-sections']),
        '#rpg-tracker-editor-popup': Object.freeze([]),
        '#rpg-prompts-editor-popup': Object.freeze([]),
        '#rpg-character-data-editor-popup': Object.freeze([]),
        '#rpg-lorebook-modal': Object.freeze(['.rpg-lb-modal-content', '.rpg-lb-modal-body']),
        '#character-workshop-popup': Object.freeze(['.workshop-nav.cw-tabs']),
        '#character-roster-popup': Object.freeze(['#cr-grid']),
    }),
});

/**
 * Модуль 1: где живёт интерфейс DES и что в нём — данные (docs/des-recon.md §1).
 *
 * Корень — элемент, внутри которого переводим. Режим `full`: всё, кроме зон `exclude` (общих и своих).
 * Режим `chrome`: только узлы из `chrome` — для мест, где хром тонким слоем лежит поверх данных
 * (Scene Tracker, пузыри чата, мысли). В `noCollect` переводим по словарю, но не копим непереведённое:
 * там вперемешку данные. В `userOnly` — подписи пользовательских полей: только словарь пользователя.
 */
export const DES_UI = Object.freeze({
    /** Контейнеры ST, за прямыми детьми которых следим, чтобы заметить появление корней DES (без subtree). */
    containers: Object.freeze(['body', '#sheld', '#form_sheld', '#send_form', '#extensions_settings2']),
    /** Лента сообщений: здесь следим с subtree, но разбираем только корни DES из `chatRoots`. */
    chat: '#chat',
    /** Блок DES в Extensions — анонимный div; находим его по переключателю. */
    drawerOf: (toggle) => toggle.closest('.inline-drawer')?.parentElement ?? null,

    roots: Object.freeze([
        // template.html: модалки, вставляются в <body> один раз
        { selector: '#rpg-settings-popup', mode: 'full' },
        { selector: '#rpg-system-log-popup', mode: 'full' },
        { selector: '#rpg-notification-log-popup', mode: 'full' },
        { selector: '#rpg-inspector-popup', mode: 'full' },
        { selector: '#rpg-character-sheet-popup', mode: 'full' },
        { selector: '#rpg-tracker-editor-popup', mode: 'full' },
        { selector: '#rpg-prompts-editor-popup', mode: 'full' },
        { selector: '#rpg-character-data-editor-popup', mode: 'full' },
        { selector: '#rpg-lorebook-modal', mode: 'full' },
        { selector: '#character-workshop-popup', mode: 'full' },
        { selector: '#character-roster-popup', mode: 'full' },
        // постоянные элементы и временные оверлеи
        { selector: '#dooms-settings-fab', mode: 'full' },
        { selector: '.dooms-fab-context-menu', mode: 'full' },
        { selector: '#dooms-portrait-bar-wrapper', mode: 'full' },
        { selector: '#dooms-pb-context-menu', mode: 'full' },
        { selector: '.dooms-alias-overlay', mode: 'full' },
        { selector: '#dooms-whats-new', mode: 'full' },
        { selector: '.rpg-emoji-picker', mode: 'full' },
        { selector: '#rpg-import-mode-dialog', mode: 'full' },
        { selector: '#dooms-compose-overlay', mode: 'full' },
        { selector: '.rpg-lb-context-menu', mode: 'full' },
        { selector: '#cw-version-add-menu', mode: 'full' },
        { selector: '#dooms-mobile-quick-jump', mode: 'full' },
        // Scene Tracker: тикер живёт в #sheld, остальное — в ленте
        { selector: '.dooms-info-ticker-wrapper', mode: 'chrome' },
    ]),

    /** Корни внутри #chat. Сообщения пользователя и модели — данные: здесь только хром DES. */
    chatRoots: Object.freeze([
        { selector: '.dooms-scene-header', mode: 'chrome' },
        { selector: '.dooms-info-banner', mode: 'chrome' },
        { selector: '.dooms-info-hud', mode: 'chrome' },
        { selector: '.dooms-dc-inline', mode: 'chrome' },
        { selector: '.dooms-dc-trap-badge', mode: 'full' },
        { selector: 'details.dooms-tracker-json', mode: 'chrome' },
        { selector: 'details.dooms-inline-thought', mode: 'chrome' },
        { selector: '.dooms-bubbles', mode: 'chrome' },
        { selector: '.dooms-import-fullsheet-btn', mode: 'full' },
        { selector: '.dooms-reasoning-tts', mode: 'full' },
    ]),

    /** Хром внутри корней режима `chrome`. */
    chrome: Object.freeze([
        // Scene Tracker во всех раскладках: подписи полей, заголовок HUD, отладочный бейдж Doom Counter
        '.dooms-scene-label', '.dooms-ip-label', '.dooms-ip-hud-label', '.dooms-ip-panel-label',
        '.dooms-ip-hud-title', '.dooms-ip-ticker-expand', '.dooms-dc-debug-badge', '.dooms-dc-debug-pending',
        // Doom Counter: заголовок, кнопки, подсказки (карточки твистов — данные)
        '.dooms-dc-inline-header', '.dooms-dc-loading-label', '.dooms-dc-actions', '.dooms-dc-chosen-hint',
        // Tracker Data под сообщением
        '.dooms-tracker-json-label', '.dooms-tracker-json-edit', '.dooms-tracker-json-editor-actions',
        // мысли в сообщении
        '.dooms-thought-name', '.dooms-thought-tts',
        // пузыри чата: «Narrator» / «Unknown» и роль — хром, имя говорящего и текст — данные
        '.dooms-bubble-narrator .dooms-bubble-author', '.dooms-bubble-unknown .dooms-bubble-author',
        '.dooms-card-narrator .dooms-card-author', '.dooms-card-unknown .dooms-card-author',
        '.dooms-card-role', '.dooms-bubble-tts',
    ]),

    /** Данные: не переводим и не собираем (действует во всех корнях). */
    exclude: Object.freeze([
        'input', 'textarea', 'pre', 'script', 'style', '[contenteditable="true"]', '.rpg-editable',
        // Present Characters
        '.dooms-portrait-card-name', '.dooms-portrait-card-emoji', '.dooms-pb-back-name', '.dooms-pb-back-value', '.dooms-pb-back-emoji',
        // мысли и пузыри (на случай, если хром-узел окажется внутри)
        '.dooms-inline-thought-content', '.dooms-bubble-text', '.dooms-card-text',
        // Doom Counter: карточки твистов и ножей
        '.dooms-dc-card-title', '.dooms-dc-card-desc', '.dooms-dc-card-emoji', '.dooms-dc-chosen-title', '.dooms-dc-chosen-emoji',
        // Workshop
        '#cw-char-title', '#cw-preview-name', '#cw-preview-rel', '.cw-alias-tag', '.rpg-rel-chip', '.rpg-dc-knife-text', '.rpg-cs-expr-label',
        '#cw-inj-lorebook-list li:not(.cw-combobox-none):not(.cw-combobox-empty)',
        // лист персонажа: DES читает эти узлы обратно для «Copy Sheet»
        '.rpg-cs-hero-name', '.rpg-cs-title', '.rpg-cs-section-title', '.rpg-cs-section-body', '.rpg-cs-section-emoji',
        '.rpg-cs-timeline-status', '.rpg-cs-thought-text',
        // Lore Library
        '.rpg-lb-tree-book-name', '.rpg-lb-breadcrumb-part', '.rpg-lb-entry-row-pos',
        // журналы, инспектор, What's New, ростер, версии
        '.rpg-log-entry', '.rpg-notif-text', '.rpg-notif-time', '.dooms-wn-item-title', '.dooms-wn-item-body', '.dooms-wn-version',
        '.cr-tile-name', '#rpg-preset-entity-name', '#dooms-version-display', '.dooms-github-star-count',
    ]),

    /** Переводим по словарю, но не копим непереведённое: здесь вперемешку данные. */
    noCollect: Object.freeze([
        '.dooms-pb-back-label', '#rpg-ws-relationship-preview', '#rpg-fab-menu-toggles', '.dooms-fab-menu-item',
        '#rpg-connection-profile', '#rpg-update-branch', '#rpg-preset-select', '#cw-linked-persona', '#rpg-update-status',
        '#rpg-current-version', '#rpg-external-api-test-result', '#rpg-theme-badge',
        '.cw-campaign-badge-text', '.cw-version-label', '.rpg-lb-campaign-name', '.rpg-lb-panel-title', '.rpg-lb-editor-title',
        '.rpg-lb-mobile-back', '.rpg-lb-tab', '.rpg-lb-entry-row-title', '.rpg-lb-context-menu-item', '.rpg-lb-move-menu',
        '.rpg-inspector-body', '.dooms-alias-card',
    ]),

    /** Подписи пользовательских полей: переводятся только словарём пользователя. */
    userOnly: Object.freeze([
        '#rpg-st-custom-fields .rpg-setting-label',
        'label[for^="rpg-history-scenefield-"]', 'label[for^="rpg-history-charfield-"]', 'label[for="rpg-history-thoughts"]',
    ]),
    /** Строка Scene Tracker с пользовательским полем: у неё значок `.dooms-cf-icon` вместо иконки Font Awesome. */
    customFieldMarker: '.dooms-cf-icon',

    /** Атрибуты, которые переводим, и элементы, где в этих атрибутах лежат данные (имена, названия). */
    attributes: Object.freeze(['title', 'placeholder', 'aria-label']),
    dataAttributes: Object.freeze(['.dooms-portrait-card', '.dooms-ip-ticker-char-dot', '.dooms-ip-panel-char-dot', '.dooms-ip-hud-char-dot', '.dooms-ip-char-dot', '.rpg-color-swatch']),

    /** Уведомления toastr (контейнер создаёт ST при первом тосте) и попапы ST, в которых DES показывает свой текст. */
    toastContainer: '#toast-container',
    toastParts: Object.freeze(['.toast-title', '.toast-message']),
    stPopup: 'dialog.popup',
    stPopupContent: '.popup-content',

    /**
     * Правки вёрстки DES под более длинные русские подписи: подключаются, пока включена локализация,
     * и снимаются вместе с ней. Только то, что нельзя решить коротким переводом. `media` — необязательно.
     */
    layoutFixes: Object.freeze([
        // Редактор промптов: ряд «Вернуть встроенный · Глубина · Роль» без переноса (flex в инлайн-стиле);
        // на телефоне русские подписи выталкивают «Роль» за край экрана.
        Object.freeze({ selector: '.rpg-prompt-injection-controls', style: 'flex-wrap: wrap;' }),
        // Редактор трекера: «Сброс · Экспорт · Импорт» на телефоне не влезают в ряд и ломаются на две строки.
        Object.freeze({ media: '(max-width: 480px)', selector: '.rpg-editor-footer-row > .rpg-btn-secondary', style: 'padding-left: 0.75em; padding-right: 0.75em;' }),
    ]),
});

/**
 * ES-модули DES, которые нужны модулям 2–4, и экспорты, без которых они не работают.
 * Все они статически импортируются в index.js DES, поэтому к нашему импорту уже загружены:
 * мы получаем те же экземпляры и не запускаем код DES повторно.
 */
export const DES_MODULES = Object.freeze({
    state: { path: 'src/core/state.js', exports: { extensionSettings: 'object', lastGeneratedData: 'object', committedTrackerData: 'object' } },
    persistence: { path: 'src/core/persistence.js', exports: { saveSettings: 'function', saveChatData: 'function' } },
    aliases: { path: 'src/systems/features/characterAliases.js', exports: { addCharacterAlias: 'function', applyCharacterAliases: 'function' } },
    weather: { path: 'src/systems/ui/weatherEffects.js', exports: { WEATHER_PATTERNS_BY_LANGUAGE: 'object', updateWeatherEffect: 'function' } },
    portraitBar: { path: 'src/systems/ui/portraitBar.js', exports: { updatePortraitBar: 'function', clearPortraitCache: 'function' } },
    thoughts: { path: 'src/systems/rendering/thoughts.js', exports: { updateChatThoughts: 'function' } },
    sceneHeaders: { path: 'src/systems/rendering/sceneHeaders.js', exports: { updateChatSceneHeaders: 'function', resetSceneHeaderCache: 'function' } },
    parser: { path: 'src/systems/generation/parser.js', exports: { parseQuests: 'function' } },
});

export const DES_KEYS = Object.freeze({
    /** chat_metadata[...]: стейт чата; DES пересобирает объект целиком при каждом сохранении. */
    chatMetadata: 'dooms_tracker',
    /** chat[i].extra[...][swipe_id]: данные трекера по свайпу. */
    swipeData: 'dooms_tracker_swipes',
    /** Событие eventSource после отдельного запроса трекера (режимы separate/external). */
    updateCompleteEvent: 'dooms_tracker_update_complete',
    /** Режим, в котором трекер пишется в основном ответе модели и проходит через extension-промпт. */
    togetherMode: 'together',
});

/** Слоты extension-промптов ST, которые пишет DES. */
export const DES_SLOTS = Object.freeze({
    /** Инструкция и JSON-шаблон трекера (режим together); DES переписывает его на каждом GENERATION_STARTED. */
    trackerInstructions: 'dooms-tracker-inject',
});

/** Служебные значения, которые DES сравнивает как строки. */
export const DES_VALUES = Object.freeze({
    /** «Квеста нет» — так DES прячет строку квеста (sceneHeaders.js, quests.js, promptBuilder.js). */
    noQuest: 'None',
    /** Фраза, которую понимает английский детектор «персонаж не в сцене» (portraitBar.js, thoughts.js, sceneHeaders.js). */
    offSceneMarker: '(off-scene)',
});

/** Тайминги DES, от которых зависят наши обработчики. */
export const DES_TIMING = Object.freeze({
    /**
     * По скольку сообщений за кадр (requestAnimationFrame) DES стирает `extra.display_text`
     * в своей очистке на CHAT_CHANGED (onChatChangedTtsCleanup в index.js).
     */
    displayTextCleanupChunk: 50,
});

/**
 * Ключ JSON, который DES строит из названия поля персонажа: только латиница и цифры в snake_case.
 * Для кириллицы получается пустая строка — отсюда пустые ключи `""` в промпте (jsonPromptHelpers.js).
 * @param {string} name
 */
export function desDetailKey(name) {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Ключ пользовательского поля сцены у DES: то же, но без пояснения в скобках в конце названия.
 * Пустой ключ — DES молча выкидывает поле и из промпта, и из Scene Tracker.
 * @param {string} name
 */
export function desSceneFieldKey(name) {
    return desDetailKey(String(name ?? '').replace(/\s*\(.*\)\s*$/, '').trim());
}

/**
 * Уже есть пометка, которую распознаёт английский детектор DES?
 * @param {string} text
 */
export function hasDesOffSceneMarker(text) {
    return /\boff[\s-]?scene\b/i.test(String(text ?? ''));
}

/**
 * @typedef {object} DesFacts
 * @property {boolean} found          DES есть среди расширений ST
 * @property {string|null} name       внутреннее имя ST, например `third-party/Dooms-Enhancement-Suite`
 * @property {string|null} version    версия из манифеста
 * @property {boolean} stDisabled     выключен в менеджере расширений ST
 * @property {boolean} loaded         скрипт DES загружен на страницу
 * @property {boolean|null} ownEnabled собственный переключатель DES (`null` — неизвестно)
 * @property {string[]} missingSelectors жадные узлы DOM, которых не оказалось
 * @property {string[]} missingExports   экспорты DES, которых не оказалось
 * @property {boolean|null} sameInstance импортированный стейт — тот же объект, что у DES (`null` — проверить нечем)
 */

/** @returns {DesFacts} */
export function emptyFacts() {
    return {
        found: false,
        name: null,
        version: null,
        stDisabled: false,
        loaded: false,
        ownEnabled: null,
        missingSelectors: [],
        missingExports: [],
        sameInstance: null,
    };
}

/**
 * Это манифест DES? Сначала по homePage (надёжно), затем по display_name.
 * @param {any} manifest
 */
export function isDesManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return false;
    const homePage = String(manifest.homePage ?? '').toLowerCase();
    return homePage.includes(DES_INFO.repo) || manifest.display_name === DES_INFO.displayName;
}

/**
 * Импортированный объект настроек — живой объект DES, а не его копия?
 * После первого saveSettings() DES это один и тот же объект. До него DES держит свою копию,
 * собранную через Object.assign из сохранённого блоба, поэтому вложенные объекты у них общие.
 * @param {any} settingsObject `extensionSettings` из импортированного state.js
 * @param {any} savedBlob `extension_settings[имя DES]`
 * @returns {boolean|null} `null` — сохранённых настроек ещё нет, сравнивать не с чем
 */
export function isLiveDesState(settingsObject, savedBlob) {
    if (!settingsObject || typeof settingsObject !== 'object') return false;
    if (!savedBlob || typeof savedBlob !== 'object') return null;
    if (settingsObject === savedBlob) return true;
    let comparable = false;
    for (const [key, value] of Object.entries(savedBlob)) {
        if (!value || typeof value !== 'object') continue;
        comparable = true;
        if (settingsObject[key] === value) return true;
    }
    return comparable ? false : null;
}

/** Внутренние имена всех расширений ST; при сбое — только имя по умолчанию. */
async function getExtensionNames() {
    try {
        const { extensionNames } = await importSt('extensions.js');
        if (Array.isArray(extensionNames) && extensionNames.length) return extensionNames;
    } catch (error) {
        log.warn('Не удалось получить список расширений ST, ищу DES по имени по умолчанию', error);
    }
    return [DES_INFO.defaultName];
}

/**
 * Скрипт DES на странице: ST вставляет `<script type="module" src="/scripts/extensions/<имя>/<js>">`.
 * Его адрес — основа для импорта модулей DES: тот же адрес, что DES использует сам.
 * @param {string} name
 * @param {any} manifest
 * @returns {string|null}
 */
function findLoadedScript(name, manifest) {
    const suffix = `/scripts/extensions/${name}/${manifest?.js || 'index.js'}`;
    for (const script of document.querySelectorAll('script[type="module"][src]')) {
        try {
            if (decodeURIComponent(new URL(script.src, location.href).pathname).endsWith(suffix)) return script.src;
        } catch {
            // Битый src чужого скрипта — пропускаем.
        }
    }
    return null;
}

/** @returns {Promise<{ name: string, manifest: any, stDisabled: boolean, scriptUrl: string|null } | null>} */
async function locateDes() {
    const ctx = getContext();
    for (const name of await getExtensionNames()) {
        if (!String(name).startsWith('third-party/')) continue;
        let manifest = null;
        try {
            manifest = ctx.getExtensionManifest?.(name);
        } catch {
            manifest = null;
        }
        if (!isDesManifest(manifest)) continue;
        const disabledList = ctx.extensionSettings?.disabledExtensions;
        return {
            name,
            manifest,
            stDisabled: Array.isArray(disabledList) && disabledList.includes(name),
            scriptUrl: findLoadedScript(name, manifest),
        };
    }
    return null;
}

/**
 * Ждёт появления элемента. Используется только на старте, поэтому простой опрос раз в 250 мс.
 * @param {string} selector
 * @param {number} timeoutMs
 * @returns {Promise<Element|null>}
 */
export function waitForElement(selector, timeoutMs) {
    const found = document.querySelector(selector);
    if (found || timeoutMs <= 0) return Promise.resolve(found);
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            const element = document.querySelector(selector);
            if (element || Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                resolve(element);
            }
        }, 250);
    });
}

/**
 * @param {string} scriptUrl адрес index.js DES
 * @returns {Promise<{ namespaces: Record<string, any>, missing: string[] }>}
 */
async function importDesModules(scriptUrl) {
    /** @type {Record<string, any>} */
    const namespaces = {};
    const missing = [];
    for (const [key, spec] of Object.entries(DES_MODULES)) {
        try {
            const namespace = await import(new URL(spec.path, scriptUrl).href);
            for (const [exportName, type] of Object.entries(spec.exports)) {
                const value = namespace[exportName];
                if (typeof value !== type || value === null) missing.push(`${spec.path} → ${exportName}`);
            }
            namespaces[key] = namespace;
        } catch (error) {
            missing.push(`${spec.path} → модуль не загрузился (${error?.message ?? error})`);
        }
    }
    return { namespaces, missing };
}

/**
 * Собирает факты о DES: найден ли, включён ли, на месте ли жадные узлы DOM и нужные экспорты.
 * Ничего не меняет ни в DES, ни в ST.
 * @param {{ timeoutMs?: number }} [options] сколько ждать инициализации DES
 * @returns {Promise<{ facts: DesFacts, api: DesApi|null }>}
 */
export async function inspectDes({ timeoutMs = 30000 } = {}) {
    const facts = emptyFacts();
    const located = await locateDes();
    if (!located) return { facts, api: null };

    const ctx = getContext();
    facts.found = true;
    facts.name = located.name;
    facts.version = located.manifest?.version ?? null;
    facts.stDisabled = located.stDisabled;
    facts.loaded = Boolean(located.scriptUrl);
    if (facts.stDisabled || !located.scriptUrl) return { facts, api: null };

    const savedBlob = ctx.extensionSettings?.[located.name];
    facts.ownEnabled = savedBlob ? savedBlob.enabled !== false : null;

    // DES инициализируется асинхронно: сначала loadSettings, потом блок в Extensions, потом initUI с кнопкой «D».
    // Появление этих узлов значит, что настройки DES уже загружены.
    if (!await waitForElement(DES_SELECTORS.drawerToggle, timeoutMs)) facts.missingSelectors.push(DES_SELECTORS.drawerToggle);
    if (facts.ownEnabled !== false && !await waitForElement(DES_SELECTORS.fab, timeoutMs)) facts.missingSelectors.push(DES_SELECTORS.fab);

    const { namespaces, missing } = await importDesModules(located.scriptUrl);
    facts.missingExports = missing;
    if (namespaces.state) {
        facts.sameInstance = isLiveDesState(namespaces.state.extensionSettings, ctx.extensionSettings?.[located.name]);
        if (typeof namespaces.state.extensionSettings?.enabled === 'boolean') facts.ownEnabled = namespaces.state.extensionSettings.enabled;
    }

    const api = missing.length || facts.sameInstance === false ? null : createApi(located, namespaces);
    return { facts, api };
}

/**
 * Узлы template.html, которых не хватает. Пустой список, если шаблон ещё не вставлен.
 * @returns {string[]}
 */
export function checkTemplate() {
    if (!document.querySelector(DES_SELECTORS.templateMarker)) return [];
    const missing = [];
    for (const [root, probes] of Object.entries(DES_SELECTORS.templateRoots)) {
        const element = document.querySelector(root);
        if (!element) {
            missing.push(root);
            continue;
        }
        for (const probe of probes) {
            if (!element.querySelector(probe)) missing.push(`${root} ${probe}`);
        }
    }
    return missing;
}

/**
 * Вызывает `callback` один раз, когда DES вставит template.html в <body> (или сразу, если уже вставил).
 * Наблюдение — только за прямыми детьми <body>, без subtree.
 * @param {() => void} callback
 * @returns {() => void} отмена наблюдения
 */
export function onTemplateInserted(callback) {
    if (document.querySelector(DES_SELECTORS.templateMarker)) {
        callback();
        return () => {};
    }
    const observer = new MutationObserver(() => {
        if (!document.querySelector(DES_SELECTORS.templateMarker)) return;
        observer.disconnect();
        callback();
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
}

/**
 * Следит за собственным переключателем DES (включение и выключение без перезагрузки).
 * @param {() => void} callback
 * @returns {() => void} отписка
 */
export function onDesToggle(callback) {
    const handler = (event) => {
        if (event.target instanceof Element && event.target.matches(DES_SELECTORS.drawerToggle)) callback();
    };
    document.addEventListener('change', handler, true);
    return () => document.removeEventListener('change', handler, true);
}

/**
 * @typedef {ReturnType<typeof createApi>} DesApi
 */

/** @typedef {{ quests: string|null, infoBox: string|null, characterThoughts: string|null }} TrackerStrings */

/**
 * Доступ к живому DES для модулей 2–4. Модули не знают ни путей, ни селекторов, ни форматов DES:
 * всё, что им нужно, они получают отсюда.
 * @param {{ name: string, manifest: any }} located
 * @param {Record<string, any>} namespaces
 */
function createApi(located, namespaces) {
    const { state, persistence, portraitBar, thoughts, sceneHeaders, parser } = namespaces;
    // `extensionSettings`, `lastGeneratedData`, `committedTrackerData` у DES — `export let`, и при загрузке
    // чата он их переприсваивает. Поэтому читаем через пространство имён каждый раз, а не кэшируем.
    const settings = () => state.extensionSettings ?? {};
    const asString = (value) => (typeof value === 'string' ? value : null);

    /** @param {string} label @param {() => void} action */
    const attempt = (label, action) => {
        try {
            action();
        } catch (error) {
            log.warn(`DES: не удалось выполнить ${label}`, error);
        }
    };

    return Object.freeze({
        name: located.name,
        version: located.manifest?.version ?? null,
        keys: DES_KEYS,
        values: DES_VALUES,
        /** Живые пространства имён модулей DES (привязки только для чтения, объекты можно мутировать). */
        modules: Object.freeze({ ...namespaces }),

        /** @returns {string} режим генерации трекера: together / separate / external */
        generationMode: () => String(settings().generationMode ?? DES_KEYS.togetherMode),
        /** Включённые поля персонажа — тем же фильтром, что DES использует при сборке промпта. */
        characterFields: () => (settings().trackerConfig?.presentCharacters?.customFields ?? [])
            .filter((field) => field && field.enabled && field.name),
        /** Включённые пользовательские поля сцены. */
        sceneFields: () => (settings().trackerConfig?.infoBox?.customFields ?? [])
            .filter((field) => field && field.enabled && field.name),

        /** Слот ST с инструкцией трекера (живой объект из extension_prompts) или `null`. */
        trackerInstructionSlot() {
            const slot = getContext().extensionPrompts?.[DES_SLOTS.trackerInstructions];
            return slot && typeof slot.value === 'string' ? slot : null;
        },

        tracker: Object.freeze({
            /** @returns {TrackerStrings} то, что DES сейчас показывает (JSON-строки) */
            read() {
                const data = state.lastGeneratedData ?? {};
                return {
                    quests: asString(data.quests),
                    infoBox: asString(data.infoBox),
                    characterThoughts: asString(data.characterThoughts),
                };
            },
            /**
             * Сообщение, к которому DES привязывает свежие данные трекера: последнее, если это ответ модели.
             * @returns {number|null}
             */
            lastAssistantIndex() {
                const chat = getContext().chat;
                const index = Array.isArray(chat) ? chat.length - 1 : -1;
                return index >= 0 && !chat[index]?.is_user ? index : null;
            },
            /**
             * Записывает исправленные JSON-строки в живой стейт DES. С `messageIndex` — ещё и в swipe-данные
             * этого сообщения, но только в поля, которые совпадают с тем, что DES только что разобрал:
             * так мы никогда не перезапишем чужие или устаревшие данные.
             * @param {Partial<TrackerStrings>} patch
             * @param {{ messageIndex?: number|null }} [options]
             */
            write(patch, { messageIndex = null } = {}) {
                const live = state.lastGeneratedData;
                const committed = state.committedTrackerData;
                if (!live || typeof live !== 'object') return;
                const before = { ...live };
                for (const [key, value] of Object.entries(patch)) {
                    live[key] = value;
                    if (committed && committed[key] === before[key]) committed[key] = value;
                }
                if (messageIndex === null) return;
                const message = getContext().chat?.[messageIndex];
                const entry = message?.extra?.[DES_KEYS.swipeData]?.[message.swipe_id ?? 0];
                if (!entry) return;
                for (const [key, value] of Object.entries(patch)) {
                    if (entry[key] === before[key]) entry[key] = value;
                }
            },
        }),

        /** Отдаёт квесты парсеру DES: он сам обновит своё зеркало квестов и сохранит настройки. */
        parseQuests(questsText) {
            attempt('разбор квестов', () => parser.parseQuests(questsText));
        },
        /** Сохраняет стейт чата DES (и сам чат) так же, как это делает DES. */
        saveChat() {
            attempt('сохранение чата', () => persistence.saveChatData());
        },
        /** Перерисовывает всё, что DES строит из данных трекера. */
        rerender() {
            attempt('сброс кэша шапки сцены', () => sceneHeaders.resetSceneHeaderCache());
            attempt('перерисовку шапки сцены', () => sceneHeaders.updateChatSceneHeaders());
            attempt('перерисовку Present Characters', () => portraitBar.updatePortraitBar());
            attempt('перерисовку мыслей', () => thoughts.updateChatThoughts());
        },
    });
}
