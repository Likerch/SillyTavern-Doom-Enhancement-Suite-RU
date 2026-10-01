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
});

export const DES_KEYS = Object.freeze({
    /** chat_metadata[...]: стейт чата; DES пересобирает объект целиком при каждом сохранении. */
    chatMetadata: 'dooms_tracker',
    /** chat[i].extra[...][swipe_id]: данные трекера по свайпу. */
    swipeData: 'dooms_tracker_swipes',
    /** Событие eventSource после отдельного запроса трекера (режимы separate/external). */
    updateCompleteEvent: 'dooms_tracker_update_complete',
});

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

/**
 * Доступ к живому DES для модулей 2–4. Модули не знают ни путей, ни селекторов DES:
 * всё, что им нужно, они получают отсюда.
 * @param {{ name: string, manifest: any }} located
 * @param {Record<string, any>} namespaces
 */
function createApi(located, namespaces) {
    return Object.freeze({
        name: located.name,
        version: located.manifest?.version ?? null,
        keys: DES_KEYS,
        /** Живые пространства имён модулей DES (только для чтения привязок; объекты можно мутировать). */
        modules: Object.freeze({ ...namespaces }),
    });
}
