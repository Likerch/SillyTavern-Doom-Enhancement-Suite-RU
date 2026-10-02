/**
 * Адаптер CarrotKernel — единственное место, которое знает, как устроен CK: где он установлен,
 * какие его ES-модули и экспорты мы используем, его слоты extension-промптов, формат вставки тегов,
 * элементы в чате и карта интерфейса для перевода. При обновлении CK правится только этот файл.
 * Подробности и ссылки на код CK — docs/bunnymo-recon.md. Код CK не копируется: у него нет лицензии.
 *
 * Сверено с CarrotKernel 1.0.0 (коммит 145c273) на SillyTavern 1.19.0.
 */
import { findExtensionScript, getContext, listExtensionNames } from './st.js';
import { waitForElement } from './des-adapter.js';

export const CK_INFO = Object.freeze({
    displayName: 'CarrotKernel',
    /** CK сам грузит свои файлы по пути `third-party/CarrotKernel` — другая папка у него не работает. */
    defaultName: 'third-party/CarrotKernel',
    verifiedVersions: Object.freeze(['1.0.0']),
    verifiedCommit: '145c273',
    /** extension_settings[...] */
    settingsKey: 'CarrotKernel',
});

export const CK_SELECTORS = Object.freeze({
    /** Панель настроек CK: появляется после initializeSheetGenerator, то есть когда CK закончил запуск. */
    settingsRoot: '#carrot_settings',
});

/**
 * ES-модули CK. Оба статически импортируются его index.js, поэтому мы получаем те же экземпляры.
 * Ничего в них не заменяем, кроме функции поиска персонажа у генератора листов — её CK сам
 * передаёт через initializeSheetGenerator и разрешает переопределять.
 * Здесь только то, без чего модулю 6 не работать: отмеченные в CK лорбуки читаются из его настроек (ckMarkedBooks).
 */
export const CK_MODULES = Object.freeze({
    state: {
        path: 'carrot-state.js',
        exports: { scannedCharacters: 'object', getLastInjectedCharacters: 'function' },
    },
    sheets: { path: 'sheet-generator.js', exports: { initializeSheetGenerator: 'function', CarrotTemplateManager: 'object' } },
});

/** Слоты extension-промптов, которые пишет CK (через /inject — префикс script_inject_). */
export const CK_SLOTS = Object.freeze({
    /** Теги персонажей из архивов: пишется в WORLD_INFO_ACTIVATED, удаляется после генерации (ephemeral). */
    consistency: 'script_inject_carrot-consistency',
    consistencyInjectId: 'carrot-consistency',
    /** Все вставки CK: листы (carrot-sheet-*), теги библиотек (carrot-tag-*), теги персонажей. */
    prefix: 'script_inject_carrot-',
    /** RAG по листам (fullsheet-rag.js). */
    rag: 'carrotkernel_rag',
});

/** Шаблон вставки тегов в Template Manager CK и его запасной формат (index.js, injectCharacterData). */
export const CK_INJECTION = Object.freeze({
    templateCategory: 'Character Data Injection',
    fallbackHeader: '[Character Consistency Data]\n\n',
});

/** Элементы CK в чате. */
export const CK_CHAT = Object.freeze({
    /** Блок тегов, который CK рисует внутри .mes_text, перезаписав его innerHTML (index.js, renderPersistentBunnyMoTags). */
    renderedTags: 'details.bunnymo-tags-container',
});

/** Режимы показа CK (settings.displayMode). */
export const CK_DISPLAY_MODES = Object.freeze({ thinking: 'thinking', cards: 'cards', none: 'none' });

/**
 * Эмбеддинги RAG CK (fullsheet-rag.js, getVectorSettings): источник и модель CK берёт из настроек встроенного
 * расширения Vector Storage ST (extension_settings.vectors), если они есть, иначе — из своих (settings.rag).
 * Для каждого источника — поле модели в обоих местах и модель CK по умолчанию.
 */
export const CK_RAG = Object.freeze({
    defaultSource: 'transformers',
    models: Object.freeze({
        openai: Object.freeze({ vectors: 'openai_model', rag: 'openaiModel', fallback: 'text-embedding-ada-002' }),
        mistral: Object.freeze({ vectors: 'openai_model', rag: 'openaiModel', fallback: 'text-embedding-ada-002' }),
        cohere: Object.freeze({ vectors: 'cohere_model', rag: 'cohereModel', fallback: 'embed-english-v3.0' }),
        togetherai: Object.freeze({ vectors: 'togetherai_model', rag: 'togetheraiModel', fallback: 'togethercomputer/m2-bert-80M-32k-retrieval' }),
        ollama: Object.freeze({ vectors: 'ollama_model', rag: 'ollamaModel', fallback: 'mxbai-embed-large' }),
        vllm: Object.freeze({ vectors: 'vllm_model', rag: 'vllmModel', fallback: '' }),
        webllm: Object.freeze({ vectors: 'webllm_model', rag: 'webllmModel', fallback: '' }),
        palm: Object.freeze({ vectors: 'google_model', rag: 'googleModel', fallback: 'text-embedding-005' }),
        vertexai: Object.freeze({ vectors: 'google_model', rag: 'googleModel', fallback: 'text-embedding-005' }),
    }),
});

/**
 * Карта интерфейса CK для движка перевода (формат — UiMap в src/translator.js).
 * У CK нет своей локализации: всё строится строками в JS и в settings.html. Подробная карта с номерами
 * строк кода CK — docs/ck-ui-map.md.
 *
 * Данные, которые CK читает обратно из DOM, исключены обязательно: `.carrot-lorebook-name` (поиск),
 * `.trigger-tag` (станет ключами записи), текст textarea, редактируемые веса ключевых слов.
 * `data-tooltip` CK пишет, но ни он, ни ST его не показывают — не переводим.
 */
export const CK_UI = Object.freeze({
    containers: Object.freeze(['body', '#extensions_settings', '#extensions_settings2', '#sheld']),
    chat: '#chat',
    roots: Object.freeze([
        // Панель настроек; внутри — хост попапов CK (#carrot-popup-overlay: менеджеры архивов, шаблонов и паков) и визуализатор фрагментов.
        { selector: '#carrot_settings', mode: 'full' },
        // Окна, которые CK вешает прямо в <body>.
        { selector: '#carrot-main-lorebook-popout', mode: 'full' },
        { selector: '.baby-bunny-overlay', mode: 'full' },
        { selector: '#carrot-baby-chunking-modal', mode: 'full' },
        { selector: '.carrot-connection-overlay', mode: 'full' },
        { selector: '.ck-panel', mode: 'full' },
        { selector: '.ck-config-panel', mode: 'full' },
        { selector: '.ck-trigger', mode: 'full' },
        { selector: '.bunnymo-tag-popup', mode: 'full' },
        // Кнопка 🐰 рядом с кнопкой лорбуков ST — только подсказка.
        { selector: '#carrot_lorebook_connector_button', mode: 'full' },
    ]),
    chatRoots: Object.freeze([
        { selector: 'details.carrot-thinking-details', mode: 'full' },
        { selector: 'details.bunnymo-tags-container', mode: 'full' },
        { selector: '.bunnymo-external-cards', mode: 'full' },
        { selector: '.bmt-system-message-header', mode: 'full' },
        { selector: '.bmt-cards-grid', mode: 'full' },
        { selector: '.carrot-rag-fullsheet-button', mode: 'full' },
        { selector: '.CarrotKernel_baby_bunny_button', mode: 'full' },
    ]),
    chrome: Object.freeze([]),
    exclude: Object.freeze([
        'input', 'textarea', 'pre', 'script', 'style', '[contenteditable="true"]',
        // панель настроек
        '.carrot-format-code', '.carrot-tooltip-example code', '.carrot-slider-icon', '.carrot-lorebook-name',
        '#carrot_rag_old_provider', '#carrot_rag_new_provider',
        '#carrot_rag_openai_model', '#carrot_rag_cohere_model', '#carrot_rag_google_model', '#carrot_rag_togetherai_model',
        '#carrot-rag-collections-list div:has(> .carrot-rename-collection-btn) > div:first-child',
        // редакторы фрагментов (визуализатор RAG и Baby Bunny)
        '#carrot-rag-modal-title', '.chunk-keywords-preview:not(.empty)', '.chunk-formatted-display',
        'select.carrot-chunk-keywords option', 'select.chunk-keywords-select option', '.select2-selection__choice',
        '.keyword-weight-badge', '.token-count',
        '.world_entry_edit span[style*="padding: 2px 6px"] > span:not([class])', '.world_entry_edit label.checkbox > span',
        // попапы: менеджер архивов, браузер паков, редактор шаблонов
        '.carrot-repo-file-name', '.carrot-repo-breadcrumb-item[data-repo-nav]', '.carrot-repo-breadcrumb-active:not(:has(i))',
        '.carrot-repo-preview-info > h4', '#carrot-repo-file-list > div[style*="56px"] > span', '.carrot-tag-item',
        '#carrot-characters-list div[style*="font-size: 14px"]',
        '#carrot-breadcrumbs', '.carrot-file-name', '.carrot-file-size', '.carrot-preview-title-text h3', '.carrot-entry-key',
        '.carrot-entry-preview', '.carrot-readme-content', '.carrot-text-content', '.carrot-stat-number',
        '.carrot-install-dialog .carrot-pack-name',
        '#bmt_template_selector option:not([value=""])', '.bmt-macro-description div[style*="monospace"]',
        '.carrot-popup-body > div[style*="pre-wrap"]',
        // Baby Bunny
        '.trigger-tag', '#tag-preview', '.batch-tag-preview', '.batch-char-header > div:nth-of-type(1)',
        '.batch-char-header > div:nth-of-type(2) > div:first-child',
        '#baby-bunny-existing-lorebook option:not([value=""])', '#batch-existing-lorebook option:not([value=""])',
        // связи лорбуков
        '.carrot-conn-item > div:nth-child(2) > div:first-child', '.carrot-conn-star',
        // WorldBook Tracker
        '.ck-entry__title', '.ck-header__badge', '.ck-debug__field:has(> span)', '.ck-potato-mode > div > div:first-child',
        // чат
        '.carrot-thinking-content > details > summary', '.character-tags-content > div > div > span',
        '.bunnymo-character-section > div',
        '.bunnymo-character-card > div:nth-child(1) > div', 'button.character-selector-btn', '[data-original-tag]',
        '.bmt-cards-grid .bunnymo-character-card > div:nth-child(2) > div > div',
    ]),
    /** Подписи вперемешку с данными: переводим по словарю, но не собираем непереведённое. */
    noCollect: Object.freeze([
        '.carrot-error-details', '.carrot-error-state', '#carrot-rag-chunk-stats', '.chunk-meta-badge', '.chunk-stat__value',
        '.ck-debug__field', '.ck-summary__tag', '.ck-world-header', '.ck-potato-mode > div',
        '.carrot-repo-summary', '.carrot-repo-file-meta', '#carrot-browser-stats', '.carrot-popup-header h4',
        '.carrot-thinking-content > em', '.token-value', '#carrot-rag-collections-list',
    ]),
    userOnly: Object.freeze([]),
    attributes: Object.freeze(['title', 'placeholder', 'aria-label']),
    /** Подсказки, в которых имя или ключевое слово. */
    dataAttributes: Object.freeze(['button.character-selector-btn', '.select2-selection__choice', '.chunk-keyword-mini-badge', 'label.checkbox']),
    toastContainer: '#toast-container',
    toastParts: Object.freeze(['.toast-title', '.toast-message']),
    stPopup: 'dialog.popup',
    stPopupContent: '.popup-content',
    layoutFixes: Object.freeze([
        // Текст в CSS (::after) движок не достанет: виден, когда CK выключают его главным переключателем.
        Object.freeze({ selector: '.carrot-disabled .carrot-card:not(.carrot-enable-card)::after', style: 'content: "🥕 Включите CarrotKernel, чтобы открыть функции";' }),
    ]),
});

/**
 * Лорбуки, которые пользователь отметил в CK как архивы персонажей и библиотеки тегов. Читается из
 * настроек CK напрямую — нужно модулю 5 и тогда, когда модуль 6 выключен.
 * @returns {{ repos: Set<string>, libraries: Set<string> }}
 */
export function ckMarkedBooks() {
    const saved = getContext().extensionSettings?.[CK_INFO.settingsKey];
    const list = (value) => new Set(Array.isArray(value) ? value.map(String) : []);
    return { repos: list(saved?.characterRepoBooks), libraries: list(saved?.tagLibraries) };
}

/**
 * Есть ли сейчас вставки CK в промпте (теги персонажей, листы, RAG).
 * @param {Record<string, any>} [prompts] extension_prompts ST
 */
export function hasCkSlots(prompts = getContext().extensionPrompts ?? {}) {
    return Object.entries(prompts).some(([key, prompt]) => (key.startsWith(CK_SLOTS.prefix) || key === CK_SLOTS.rag)
        && typeof prompt?.value === 'string' && prompt.value.trim() !== '');
}

/**
 * @typedef {object} CkFacts
 * @property {boolean} found
 * @property {string|null} name
 * @property {string|null} version
 * @property {boolean} stDisabled
 * @property {boolean} loaded
 * @property {boolean} initialized CK закончил запуск (его панель настроек на месте)
 * @property {string[]} missingExports
 */

/** @returns {CkFacts} */
export function emptyCkFacts() {
    return { found: false, name: null, version: null, stDisabled: false, loaded: false, initialized: false, missingExports: [] };
}

/** @param {any} manifest */
export function isCkManifest(manifest) {
    return Boolean(manifest && typeof manifest === 'object' && manifest.display_name === CK_INFO.displayName);
}

async function locateCk() {
    const ctx = getContext();
    for (const name of await listExtensionNames(CK_INFO.defaultName)) {
        if (!String(name).startsWith('third-party/')) continue;
        let manifest = null;
        try {
            manifest = ctx.getExtensionManifest?.(name);
        } catch {
            manifest = null;
        }
        if (!isCkManifest(manifest)) continue;
        const disabledList = ctx.extensionSettings?.disabledExtensions;
        return {
            name,
            manifest,
            stDisabled: Array.isArray(disabledList) && disabledList.includes(name),
            scriptUrl: findExtensionScript(name, manifest),
        };
    }
    return null;
}

/**
 * Собирает факты о CK и, если всё на месте, отдаёт доступ к нему. Ничего не меняет.
 * @param {{ timeoutMs?: number }} [options] сколько ждать, пока CK закончит запуск
 * @returns {Promise<{ facts: CkFacts, api: CkApi|null }>}
 */
export async function inspectCk({ timeoutMs = 30000 } = {}) {
    const facts = emptyCkFacts();
    const located = await locateCk();
    if (!located) return { facts, api: null };
    facts.found = true;
    facts.name = located.name;
    facts.version = located.manifest?.version ?? null;
    facts.stDisabled = located.stDisabled;
    facts.loaded = Boolean(located.scriptUrl);
    if (facts.stDisabled || !located.scriptUrl) return { facts, api: null };

    facts.initialized = Boolean(await waitForElement(CK_SELECTORS.settingsRoot, timeoutMs));
    /** @type {Record<string, any>} */
    const namespaces = {};
    for (const [key, spec] of Object.entries(CK_MODULES)) {
        try {
            const namespace = await import(new URL(spec.path, located.scriptUrl).href);
            for (const [exportName, type] of Object.entries(spec.exports)) {
                if (typeof namespace[exportName] !== type || namespace[exportName] === null) facts.missingExports.push(`${spec.path} → ${exportName}`);
            }
            namespaces[key] = namespace;
        } catch (error) {
            facts.missingExports.push(`${spec.path} → модуль не загрузился (${error?.message ?? error})`);
        }
    }
    const api = facts.missingExports.length || !facts.initialized ? null : createCkApi(located, namespaces);
    return { facts, api };
}

/** @typedef {ReturnType<typeof createCkApi>} CkApi */

/**
 * @param {{ name: string, manifest: any }} located
 * @param {Record<string, any>} namespaces
 */
function createCkApi(located, namespaces) {
    const { state, sheets } = namespaces;
    const settings = () => getContext().extensionSettings?.[CK_INFO.settingsKey] ?? {};
    /** Настройки Vector Storage ST, если они есть: CK берёт эмбеддинги оттуда. */
    const vectors = () => {
        const value = getContext().extensionSettings?.vectors;
        return value && typeof value === 'object' ? value : null;
    };
    const ragSource = () => String((vectors() ? vectors().source ?? CK_RAG.defaultSource : settings().rag?.vectorSource || CK_RAG.defaultSource) || '');
    return Object.freeze({
        name: located.name,
        version: located.manifest?.version ?? null,
        settings,
        enabled: () => settings().enabled !== false,
        sendsToAi: () => settings().sendToAI !== false,
        displayMode: () => String(settings().displayMode ?? CK_DISPLAY_MODES.thinking),
        ragEnabled: () => settings().rag?.enabled === true,
        /** Источник эмбеддингов RAG, как его выбирает CK: transformers, openai, cohere, ollama… */
        ragSource,
        /** Модель эмбеддингов для этого источника; '' — модель задаёт сервер (transformers, llamacpp, nomicai…). */
        ragModel: () => {
            const fields = CK_RAG.models[ragSource()];
            if (!fields) return '';
            const base = vectors();
            return String((base ? base[fields.vectors] ?? fields.fallback : settings().rag?.[fields.rag] || fields.fallback) || '');
        },
        /**
         * Коллекции RAG CK — живой объект его настроек { id: { characterName, keywords, alwaysActive } } или `null`.
         * `keywords` — триггеры: коллекция включается, если один из них — подстрока последних сообщений.
         */
        ragCollections: () => {
            const metadata = settings().rag?.collectionMetadata;
            return metadata && typeof metadata === 'object' ? metadata : null;
        },
        /** Сохранить настройки CK (после правки триггеров RAG). */
        saveSettings: () => getContext().saveSettingsDebounced(),
        /** Живая карта CK «лорбук::имя» → { name, tags: Map, source, uid }. */
        scanned: () => state.scannedCharacters,
        /** Имена персонажей, чьи теги CK вставил в этой генерации. */
        lastInjected: () => {
            const names = state.getLastInjectedCharacters?.();
            return Array.isArray(names) ? names.map(String) : [];
        },
        /**
         * Своя функция поиска персонажа для генератора листов и макросов CK (getTriggeredCharacters).
         * CK передаёт туда свою при запуске; вернуть её нельзя — до перезагрузки страницы остаётся наша.
         * @param {(name: string, lorebook?: string|null, silent?: boolean) => { name: string, data: any }|null} find
         */
        installFinder(find) {
            sheets.initializeSheetGenerator(find);
        },
        /** Слот с тегами персонажей (живой объект из extension_prompts) или `null`. */
        consistencySlot() {
            const slot = getContext().extensionPrompts?.[CK_SLOTS.consistency];
            return slot && typeof slot.value === 'string' ? slot : null;
        },
        /**
         * Записать текст вставки тегов — туда же, куда его пишет /inject (слот и метаданные чата).
         * @param {string} text
         */
        setConsistencyText(text) {
            const slot = getContext().extensionPrompts?.[CK_SLOTS.consistency];
            if (slot) slot.value = text;
            const stored = getContext().chatMetadata?.script_injects?.[CK_SLOTS.consistencyInjectId];
            if (stored && typeof stored === 'object') stored.value = text;
        },
        /**
         * Собирает ли CK вставку тегов шаблоном из Template Manager. Шаблон раскрывается макросами генератора
         * листов ({{TRIGGERED_CHARACTER_TAGS}} и др.), а те ищут персонажа функцией из initializeSheetGenerator —
         * с нашим поиском текст CK уже правильный (данные, которые CK передаёт в processTemplate, тот не читает).
         * В CK 1.0.0 шаблон есть всегда: без своего — встроенный character_consistency.
         */
        usesInjectionTemplate() {
            return Boolean(sheets.CarrotTemplateManager?.getPrimaryTemplateForCategory?.(CK_INJECTION.templateCategory));
        },
        /**
         * Текст вставки тегов в запасном формате CK (без шаблона), но с правильным поиском персонажа:
         * его CK собирает своим поиском, а тот путает кириллические имена. Лимит персонажей — как у CK.
         * Шаблон не раскрываем: processTemplate CK считает использования и пересохраняет свои шаблоны.
         * @param {string[]} names
         * @param {(name: string) => { name: string, data: any }|null} find
         * @returns {string}
         */
        consistencyText(names, find) {
            const limit = Number(settings().maxCharactersDisplay);
            const chosen = names.slice(0, Number.isFinite(limit) && limit > 0 ? limit : names.length);
            let text = CK_INJECTION.fallbackHeader;
            for (const name of chosen) {
                const found = find(name);
                if (!found?.data?.tags) continue;
                text += `${name}:\n`;
                for (const [category, values] of found.data.tags) text += `• ${category}: ${Array.from(values).join(', ')}\n`;
                text += '\n';
            }
            return text;
        },
    });
}
