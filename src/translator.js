/**
 * Движок перевода интерфейса чужого расширения по словарю. Один экземпляр — на одно расширение:
 * модуль 1 переводит DES (карта DES_UI в des-adapter.js), модуль 6 — CarrotKernel (CK_UI в ck-adapter.js).
 *
 * - Наблюдение ограничено корнями расширения: за контейнерами ST следим без subtree, только чтобы
 *   заметить появление корней; глубоко — только внутри самих корней. В ленте сообщений (#chat)
 *   наблюдатель с subtree, но любая запись, не относящаяся к корню, отбрасывается сразу — текст
 *   сообщений, в том числе при стриминге, не трогается.
 * - Переводим текстовые узлы, атрибуты title/placeholder/aria-label и подсказки с инлайн-тегами
 *   целиком. Данные (имена, значения, поля ввода, лорбуки, текст сообщений) не трогаем.
 * - Идемпотентность по содержимому: для каждого узла помним исходник и наш перевод. Если расширение
 *   перерисовало узел (в т. ч. своим i18n обратно в английский), переводим заново.
 * - Непереведённое копится и выгружается в JSON для пополнения словаря.
 * - Уведомления (toastr) — общие на всех: их переводит первый словарь, в котором нашлась строка.
 */
import { OWN_TOAST_CLASS } from './st.js';
import { createDictionary, looksTranslatable, normalizeText } from './lib/dictionary.js';

/** Инлайн-теги, из которых состоят подсказки; иконки Font Awesome форматированием не считаются. */
const INLINE_TAGS = new Set(['CODE', 'STRONG', 'EM', 'B', 'I', 'U', 'BR', 'SMALL', 'KBD', 'SPAN', 'A']);
const RUN_CLASS = 'desru-run';
/** Поля ввода: значение — данные, но подсказки на них (placeholder, title) — интерфейс. */
const FORM_FIELD = 'input, textarea';

/**
 * @typedef {{ selector: string, mode: 'full'|'chrome' }} RootConfig
 * @typedef {{ noCollect: boolean, userOnly: boolean }} VisitContext
 *
 * @typedef {object} UiMap карта интерфейса расширения (DES_UI, CK_UI)
 * @property {readonly string[]} containers контейнеры ST, за прямыми детьми которых следим
 * @property {string} chat лента сообщений
 * @property {readonly RootConfig[]} roots
 * @property {readonly RootConfig[]} chatRoots корни внутри ленты
 * @property {readonly string[]} chrome хром внутри корней режима `chrome`
 * @property {readonly string[]} exclude данные: не переводим и не собираем
 * @property {readonly string[]} noCollect переводим, но не собираем непереведённое
 * @property {readonly string[]} userOnly только словарь пользователя
 * @property {string} [customFieldMarker] строка с пользовательским полем (только словарь пользователя)
 * @property {readonly string[]} attributes
 * @property {readonly string[]} dataAttributes элементы, у которых в атрибутах данные
 * @property {string} toastContainer
 * @property {readonly string[]} toastParts
 * @property {string} stPopup
 * @property {string} stPopupContent
 * @property {readonly { selector: string, style: string, media?: string }[]} [layoutFixes]
 * @property {{ toggle: string, rootOf: (toggle: Element) => Element|null }} [drawer] блок расширения в Extensions без своего id
 */

// ─── Общий перевод уведомлений ─────────────────────────────────────────────

/** @type {Set<ReturnType<typeof createTranslator>>} */
const translators = new Set();
/** @type {Map<Element, MutationObserver>} */
const toastObservers = new Map();

/** @param {Element} toast */
function translateToast(toast) {
    if (toast.classList.contains(OWN_TOAST_CLASS)) return;
    const active = [...translators].filter((translator) => translator.toastsEnabled());
    if (!active.length) return;
    for (const part of toast.querySelectorAll(active[0].ui.toastParts.join(', '))) {
        for (const child of part.childNodes) {
            if (child.nodeType !== Node.TEXT_NODE) continue;
            const text = child.nodeValue ?? '';
            let translated = false;
            for (const translator of active) {
                const translation = translator.dictionary().text(text);
                if (translation === null) continue;
                child.nodeValue = keepWhitespace(text, translation);
                translated = true;
                break;
            }
            if (!translated) active.forEach((translator) => translator.collectToast(text));
        }
    }
}

/** @param {Element} container */
function observeToasts(container) {
    if (toastObservers.has(container)) return;
    container.querySelectorAll('.toast').forEach(translateToast);
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach((node) => node.nodeType === Node.ELEMENT_NODE && translateToast(/** @type {Element} */ (node)));
        }
        observer.takeRecords();
    });
    observer.observe(container, { childList: true });
    toastObservers.set(container, observer);
}

function releaseToasts() {
    if (translators.size) return;
    for (const observer of toastObservers.values()) observer.disconnect();
    toastObservers.clear();
}

/** Сохраняет ведущие и хвостовые пробелы исходного узла вокруг перевода. */
function keepWhitespace(original, translation) {
    const lead = original.match(/^\s*/)[0];
    const trail = original.match(/\s*$/)[0];
    return `${lead}${translation}${trail}`;
}

/** Пустой <i>/<span> — значок (Font Awesome или картинка фоном), а не форматирование текста. */
function isIcon(element) {
    return (element.tagName === 'I' || element.tagName === 'SPAN') && !element.textContent.trim();
}

/**
 * Инлайн-тег, который можно переписать вместе с подсказкой: без id и без вложенной разметки,
 * кроме значков («<strong><i class="fa-…"></i> Заголовок</strong>»).
 * @param {Element} element
 */
function isShallowInline(element) {
    return INLINE_TAGS.has(element.tagName) && !element.id
        && [...element.children].every((child) => isIcon(child) && child.children.length === 0);
}

/**
 * Подсказка из текста и инлайн-тегов (<code>, <strong>…) переводится одним куском. Фраза, которую
 * разрезал значок посередине («нажмите значок (<i>) рядом…»), — тоже.
 * @param {Element} element
 */
function isRichUnit(element) {
    let formatting = false;
    let icon = false;
    let textNodes = 0;
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (/\p{L}/u.test(child.nodeValue ?? '')) textNodes += 1;
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const child_ = /** @type {Element} */ (child);
        // Элемент с id расширение ищет и заполняет само: такую подсказку нельзя переписывать через innerHTML.
        if (!isShallowInline(child_)) return false;
        if (isIcon(child_)) icon = true;
        else formatting = true;
    }
    return textNodes > 0 && (formatting || (icon && textNodes > 1));
}

/**
 * В подсказке, где текст с инлайн-тегами перемежается списками и <br>, оборачивает каждый такой
 * кусок в <span class="desru-run">, чтобы перевести его целиком. Вёрстку обёртка не меняет.
 * @param {Element} element
 */
function wrapInlineRuns(element) {
    const children = [...element.childNodes];
    const hasBlock = children.some((node) => node.nodeType === Node.ELEMENT_NODE && !INLINE_TAGS.has(/** @type {Element} */ (node).tagName));
    const hasBreak = children.some((node) => node.nodeName === 'BR');
    if (!hasBlock && !hasBreak) return;
    /** @type {Node[]} */
    let run = [];
    const flush = () => {
        const elements = run.filter((node) => node.nodeType === Node.ELEMENT_NODE);
        const words = run.some((node) => node.nodeType === Node.TEXT_NODE && /\p{L}/u.test(node.nodeValue ?? ''));
        const plain = elements.every((node) => isShallowInline(/** @type {Element} */ (node)));
        if (words && elements.length > 0 && plain) {
            const wrapper = document.createElement('span');
            wrapper.className = RUN_CLASS;
            run[0].before(wrapper);
            wrapper.append(...run);
        }
        run = [];
    };
    for (const node of children) {
        const inline = node.nodeType === Node.TEXT_NODE
            || (node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(/** @type {Element} */ (node).tagName) && node.nodeName !== 'BR');
        if (inline) run.push(node);
        else flush();
    }
    flush();
}

/**
 * @param {object} config
 * @param {string} config.id для журнала и стиля правок вёрстки
 * @param {UiMap} config.ui
 * @param {() => Record<string, string>} config.userDictionary словарь пользователя (живой)
 * @param {() => { toasts: boolean, collect: boolean, collectToasts: boolean }} config.options
 * @param {() => void} [config.onCollect] появилась новая непереведённая строка
 */
export function createTranslator({ id, ui, userDictionary: getUserDictionary, options, onCollect = () => {} }) {
    const ROOT_SELECTOR = ui.roots.map((root) => root.selector).join(', ') || ':not(*)';
    const CHAT_ROOT_SELECTOR = ui.chatRoots.map((root) => root.selector).join(', ') || ':not(*)';
    const CHROME_SELECTOR = ui.chrome.join(', ') || ':not(*)';
    const EXCLUDE_SELECTOR = ui.exclude.join(', ') || ':not(*)';
    const NO_COLLECT_SELECTOR = ui.noCollect.join(', ') || ':not(*)';
    const USER_ONLY_SELECTOR = ui.userOnly.join(', ') || ':not(*)';
    const DATA_ATTRIBUTE_SELECTOR = ui.dataAttributes.join(', ') || ':not(*)';
    const OBSERVE_ROOT = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ui.attributes] };
    const DRAWER_CONFIG = Object.freeze({ selector: 'drawer', mode: 'full' });
    const CHAT_CONFIG = new Map(ui.chatRoots.map((root) => [root.selector, root]));
    const LAYOUT_STYLE_ID = id === 'des' ? 'desru-layout-fixes' : `desru-layout-fixes-${id}`;

    let builtIn = {};
    let dictionary = createDictionary({});
    let userDictionary = createDictionary({});
    /** Поколение словаря: после правки словаря все узлы переводятся заново от исходника. */
    let generation = 0;
    let running = false;

    /** @type {WeakMap<Text, { source: string, value: string, generation: number }>} */
    const textState = new WeakMap();
    /** @type {WeakMap<Element, Map<string, { source: string, value: string, generation: number }>>} */
    const attributeState = new WeakMap();
    /** @type {WeakMap<Element, { source: string, value: string, generation: number }>} */
    const richState = new WeakMap();
    /** @type {Map<Element, { config: RootConfig, observer: MutationObserver|null }>} */
    const roots = new Map();
    /** @type {MutationObserver[]} */
    let observers = [];
    /** @type {Element|null} */
    let observedChat = null;
    /** @type {Map<string, { kind: string, where: string, count: number }>} */
    const untranslated = new Map();

    // ─── Словарь ───────────────────────────────────────────────────────────

    /** @param {URL} url */
    async function load(url) {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('словарь должен быть объектом');
        builtIn = data;
    }

    function rebuild() {
        const user = getUserDictionary();
        const userEntries = user && typeof user === 'object' && !Array.isArray(user) ? user : {};
        dictionary = createDictionary({ ...builtIn, ...userEntries });
        userDictionary = createDictionary(userEntries);
        generation += 1;
    }

    /** @param {VisitContext} context */
    function dictionaryFor(context) {
        return context.userOnly ? userDictionary : dictionary;
    }

    // ─── Непереведённое ────────────────────────────────────────────────────

    /**
     * @param {string} text
     * @param {'text'|'attribute'|'rich'|'toast'} kind
     * @param {Element|null} where
     */
    function collect(text, kind, where) {
        if (!options().collect) return;
        const key = normalizeText(text);
        if (!key || (kind !== 'rich' && !looksTranslatable(key))) return;
        const entry = untranslated.get(key);
        if (entry) {
            entry.count += 1;
            return;
        }
        untranslated.set(key, { kind, where: describeRoot(where), count: 1 });
        onCollect();
    }

    /** @param {Element|null} element */
    function describeRoot(element) {
        if (!element) return 'уведомление';
        const root = element.closest(`${ROOT_SELECTOR}, ${CHAT_ROOT_SELECTOR}`);
        if (!root) return element.closest('#extensions_settings2, #extensions_settings') ? 'блок в Extensions' : 'другое';
        return root.id ? `#${root.id}` : `.${String(root.className).split(/\s+/)[0]}`;
    }

    // ─── Перевод узлов ─────────────────────────────────────────────────────

    /**
     * @param {Text} node
     * @param {VisitContext} context
     */
    function translateText(node, context) {
        const current = node.nodeValue ?? '';
        if (!current.trim()) return;
        const state = textState.get(node);
        if (state && current === state.value && state.generation === generation) return;
        const source = state && current === state.value ? state.source : current;
        const translation = dictionaryFor(context).text(source);
        if (translation === null) {
            if (state && current === state.value) node.nodeValue = state.source;
            textState.delete(node);
            if (!context.noCollect && !context.userOnly) collect(source, 'text', node.parentElement);
            return;
        }
        const value = keepWhitespace(source, translation);
        if (value !== current) node.nodeValue = value;
        textState.set(node, { source, value, generation });
    }

    /**
     * @param {Element} element
     * @param {VisitContext} context
     */
    function translateAttributes(element, context) {
        if (element.matches(DATA_ATTRIBUTE_SELECTOR)) return;
        for (const name of ui.attributes) {
            const current = element.getAttribute(name);
            if (current === null || !current.trim()) continue;
            let states = attributeState.get(element);
            const state = states?.get(name);
            if (state && current === state.value && state.generation === generation) continue;
            const source = state && current === state.value ? state.source : current;
            const translation = dictionaryFor(context).text(source);
            if (translation === null) {
                if (!context.noCollect && !context.userOnly) collect(source, 'attribute', element);
                continue;
            }
            if (translation !== current) element.setAttribute(name, translation);
            if (!states) attributeState.set(element, states = new Map());
            states.set(name, { source, value: translation, generation });
        }
    }

    /**
     * @param {Element} element
     * @param {VisitContext} context
     * @param {boolean} [collectMissing] записать ли в непереведённое, если перевода нет
     * @returns {boolean} перевод применён
     */
    function translateRich(element, context, collectMissing = true) {
        const current = element.innerHTML;
        const state = richState.get(element);
        if (state && current === state.value && state.generation === generation) return true;
        const source = state && current === state.value ? state.source : current;
        const translation = dictionaryFor(context).rich(source);
        if (translation === null) {
            if (state && current === state.value) element.innerHTML = state.source;
            richState.delete(element);
            if (collectMissing && !context.noCollect && !context.userOnly) collect(source, 'rich', element);
            return false;
        }
        const sanitize = globalThis.DOMPurify?.sanitize;
        if (typeof sanitize !== 'function') return false;
        element.innerHTML = sanitize(translation);
        richState.set(element, { source, value: element.innerHTML, generation });
        return true;
    }

    /**
     * @param {Element} element
     * @param {VisitContext} parent
     * @returns {VisitContext}
     */
    function contextOf(element, parent) {
        const isCustomLabel = Boolean(ui.customFieldMarker) && element.matches(CHROME_SELECTOR)
            && Boolean(element.parentElement?.querySelector(ui.customFieldMarker));
        return {
            noCollect: parent.noCollect || element.matches(NO_COLLECT_SELECTOR),
            userOnly: parent.userOnly || isCustomLabel || element.matches(USER_ONLY_SELECTOR),
        };
    }

    /**
     * Контекст для узла в середине дерева: по его предкам.
     * @param {Element} element
     */
    function contextFromAncestors(element) {
        return {
            noCollect: Boolean(element.closest(NO_COLLECT_SELECTOR)),
            userOnly: Boolean(element.closest(USER_ONLY_SELECTOR)),
        };
    }

    /**
     * Поле ввода, у которого переводим только подсказки: само исключено ради значения, но не лежит в зоне данных.
     * @param {Element} element
     */
    function isTranslatableField(element) {
        return element.matches(FORM_FIELD) && !element.parentElement?.closest(EXCLUDE_SELECTOR);
    }

    /**
     * Обходит поддерево режима full.
     * @param {Element} element
     * @param {VisitContext} parentContext
     */
    function visit(element, parentContext) {
        if (element.matches(EXCLUDE_SELECTOR)) {
            if (isTranslatableField(element)) translateAttributes(element, contextOf(element, parentContext));
            return;
        }
        const context = contextOf(element, parentContext);
        translateAttributes(element, context);
        if (isRichUnit(element)) {
            // Подсказка переводится целиком или остаётся английской: обрывки дали бы смесь языков в одной фразе.
            // Исключение — строки, разделённые <br>: если целиком перевода нет, переводим каждую строку.
            const lines = Boolean(element.querySelector(':scope > br'));
            if (translateRich(element, context, !lines) || !lines) return;
        }
        wrapInlineRuns(element);
        for (const child of [...element.childNodes]) {
            if (child.nodeType === Node.TEXT_NODE) translateText(/** @type {Text} */ (child), context);
            else if (child.nodeType === Node.ELEMENT_NODE) visit(/** @type {Element} */ (child), context);
        }
    }

    /**
     * Переводит изменившийся узел внутри корня с учётом режима корня.
     * @param {Node} node
     * @param {Element} root
     * @param {RootConfig} config
     */
    function translateInRoot(node, root, config) {
        if (!node.isConnected) return;
        const element = node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node.parentElement;
        if (!element) return;
        if (element.closest(EXCLUDE_SELECTOR)) {
            // Подсказки поля ввода (но не его текст и не значение).
            if (node === element && config.mode === 'full' && isTranslatableField(element)) translateAttributes(element, contextFromAncestors(element));
            return;
        }

        if (config.mode === 'chrome') {
            const owner = element.closest(CHROME_SELECTOR);
            if (owner && root.contains(owner)) {
                visit(owner, contextFromAncestors(owner.parentElement ?? owner));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (element.matches(CHROME_SELECTOR)) visit(element, contextFromAncestors(element));
            for (const chrome of element.querySelectorAll(CHROME_SELECTOR)) visit(chrome, contextFromAncestors(chrome));
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const parent = /** @type {Element} */ (node.parentElement);
            if (richState.has(parent) || isRichUnit(parent)) {
                visit(parent, contextFromAncestors(parent));
            } else {
                translateText(/** @type {Text} */ (node), contextFromAncestors(parent));
            }
            return;
        }
        visit(element, contextFromAncestors(element.parentElement ?? element));
    }

    // ─── Корни и наблюдатели ───────────────────────────────────────────────

    /** @param {Element} element */
    function configForRoot(element) {
        return ui.roots.find((root) => element.matches(root.selector)) ?? null;
    }

    /**
     * @param {Element|null} element
     * @param {RootConfig|null} [config]
     */
    function attachRoot(element, config = null) {
        if (!element || roots.has(element)) return;
        const resolved = config ?? configForRoot(element);
        if (!resolved) return;
        // Корень внутри уже наблюдаемого корня обслуживает наблюдатель предка.
        const nested = [...roots.keys()].some((root) => root !== element && root.contains(element));
        let observer = null;
        if (!nested) {
            observer = new MutationObserver((records) => {
                const touched = new Set();
                for (const record of records) {
                    if (record.type === 'childList') record.addedNodes.forEach((node) => touched.add(node));
                    else touched.add(record.target);
                }
                for (const node of touched) translateInRoot(node, element, resolved);
                observer.takeRecords();
            });
            observer.observe(element, OBSERVE_ROOT);
        }
        roots.set(element, { config: resolved, observer });
        translateInRoot(element, element, resolved);
        observer?.takeRecords();
    }

    function pruneRoots() {
        for (const [root, entry] of roots) {
            if (root.isConnected) continue;
            entry.observer?.disconnect();
            roots.delete(root);
        }
    }

    /** Ищет корни в добавленном узле и вокруг него. */
    function discover(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = /** @type {Element} */ (node);
        if (element.matches(ROOT_SELECTOR)) attachRoot(element);
        element.querySelectorAll(ROOT_SELECTOR).forEach((root) => attachRoot(root));
        if (ui.drawer) {
            const toggle = element.matches(ui.drawer.toggle) ? element : element.querySelector(ui.drawer.toggle);
            if (toggle) attachRoot(ui.drawer.rootOf(toggle), DRAWER_CONFIG);
        }
        if (element.matches(ui.toastContainer)) observeToasts(element);
        if (element.matches(ui.stPopup)) translatePopup(element);
    }

    /** @param {Element} container */
    function observeContainer(container) {
        const observer = new MutationObserver((records) => {
            for (const record of records) record.addedNodes.forEach(discover);
            if (records.some((record) => record.removedNodes.length)) pruneRoots();
        });
        observer.observe(container, { childList: true });
        observers.push(observer);
    }

    /** @param {Element} root */
    function chatConfigFor(root) {
        for (const [selector, config] of CHAT_CONFIG) if (root.matches(selector)) return config;
        return null;
    }

    function observeChat() {
        if (!ui.chatRoots.length) return;
        const chat = document.querySelector(ui.chat);
        if (!chat || chat === observedChat) return;
        observedChat = chat;
        const observer = new MutationObserver((records) => {
            /** @type {Map<Element, Set<Node>>} */
            const touched = new Map();
            const add = (root, node) => {
                if (!touched.has(root)) touched.set(root, new Set());
                touched.get(root).add(node);
            };
            for (const record of records) {
                if (record.type === 'childList') {
                    for (const node of record.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = /** @type {Element} */ (node);
                            if (element.matches(CHAT_ROOT_SELECTOR)) add(element, element);
                            element.querySelectorAll(CHAT_ROOT_SELECTOR).forEach((root) => add(root, root));
                        }
                        const owner = node.parentElement?.closest(CHAT_ROOT_SELECTOR);
                        if (owner) add(owner, node);
                    }
                } else {
                    const element = record.target.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (record.target) : record.target.parentElement;
                    const owner = element?.closest(CHAT_ROOT_SELECTOR);
                    if (owner) add(owner, record.target);
                }
            }
            for (const [root, nodes] of touched) {
                const config = chatConfigFor(root);
                if (!config) continue;
                for (const node of nodes) translateInRoot(node, root, config);
            }
            observer.takeRecords();
        });
        observer.observe(chat, OBSERVE_ROOT);
        observers.push(observer);
        for (const root of chat.querySelectorAll(CHAT_ROOT_SELECTOR)) {
            const config = chatConfigFor(root);
            if (config) translateInRoot(root, root, config);
        }
        observer.takeRecords();
    }

    /** Попап ST с текстом расширения: переводим только то, что есть в словаре. */
    function translatePopup(popup) {
        const content = popup.querySelector(ui.stPopupContent);
        if (content) visit(content, { noCollect: true, userOnly: false });
    }

    function scanDocument() {
        if (ui.drawer) {
            const toggle = document.querySelector(ui.drawer.toggle);
            if (toggle) attachRoot(ui.drawer.rootOf(toggle), DRAWER_CONFIG);
        }
        document.querySelectorAll(ROOT_SELECTOR).forEach((root) => attachRoot(root));
        const toasts = document.querySelector(ui.toastContainer);
        if (toasts) observeToasts(toasts);
        observeChat();
    }

    /** Переводит заново все известные корни (после правки словаря). */
    function retranslateAll() {
        if (!running) return;
        pruneRoots();
        for (const [root, { config, observer }] of roots) {
            translateInRoot(root, root, config);
            observer?.takeRecords();
        }
        document.querySelector(ui.chat)?.querySelectorAll(CHAT_ROOT_SELECTOR).forEach((root) => {
            const config = chatConfigFor(root);
            if (config) translateInRoot(root, root, config);
        });
        for (const observer of observers) observer.takeRecords();
    }

    function applyLayoutFixes() {
        if (!ui.layoutFixes?.length || document.getElementById(LAYOUT_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = LAYOUT_STYLE_ID;
        style.textContent = ui.layoutFixes.map((fix) => {
            const rule = `${fix.selector} { ${fix.style} }`;
            return fix.media ? `@media ${fix.media} { ${rule} }` : rule;
        }).join('\n');
        document.head.append(style);
    }

    /** Возвращает английский во всех узлах, которые мы перевели. */
    function restoreAll() {
        const elements = new Set([...roots.keys()]);
        document.querySelector(ui.chat)?.querySelectorAll(CHAT_ROOT_SELECTOR).forEach((root) => elements.add(root));
        for (const root of elements) {
            if (!root.isConnected) continue;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
            const nodes = [root];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (const node of nodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const state = textState.get(/** @type {Text} */ (node));
                    if (state && node.nodeValue === state.value) node.nodeValue = state.source;
                    continue;
                }
                const element = /** @type {Element} */ (node);
                const rich = richState.get(element);
                if (rich && element.innerHTML === rich.value) element.innerHTML = rich.source;
                for (const [name, state] of attributeState.get(element) ?? []) {
                    if (element.getAttribute(name) === state.value) element.setAttribute(name, state.source);
                }
            }
        }
    }

    const api = {
        ui,
        get running() {
            return running;
        },
        /** Загружает встроенный словарь; при ошибке бросает её — словарь остаётся пустым. */
        async load(url) {
            builtIn = {};
            await load(url);
        },
        rebuild,
        /** Число строк во встроенном словаре (без служебных и пустых). */
        builtInSize: () => Object.keys(builtIn).filter((key) => !key.startsWith('__') && builtIn[key]).length,
        size: () => dictionary.size,
        dictionary: () => dictionary,
        toastsEnabled: () => running && options().toasts,
        /** @param {string} text */
        collectToast(text) {
            if (running && options().collectToasts) collect(text, 'toast', null);
        },
        start() {
            if (running) return;
            running = true;
            translators.add(api);
            applyLayoutFixes();
            for (const selector of ui.containers) {
                const container = selector === 'body' ? document.body : document.querySelector(selector);
                if (container) observeContainer(container);
            }
            scanDocument();
        },
        /** Лента сообщений пересоздаётся при смене чата — переподключаемся. */
        refreshChat: () => running && observeChat(),
        retranslateAll,
        stop() {
            if (!running) return;
            running = false;
            translators.delete(api);
            observers.forEach((observer) => observer.disconnect());
            observers = [];
            observedChat = null;
            for (const { observer } of roots.values()) observer?.disconnect();
            restoreAll();
            document.getElementById(LAYOUT_STYLE_ID)?.remove();
            roots.clear();
            releaseToasts();
        },
        /** @returns {{ text: string, kind: string, where: string, count: number }[]} */
        untranslated: () => [...untranslated.entries()].map(([text, entry]) => ({ text, ...entry })),
        untranslatedCount: () => untranslated.size,
        clearUntranslated: () => untranslated.clear(),
        /**
         * Непереведённое в формате словаря.
         * @param {string} note пояснение в поле __desru
         */
        untranslatedAsDictionary(note) {
            const result = { __desru: note };
            const byRoot = [...untranslated.entries()].sort((a, b) => a[1].where.localeCompare(b[1].where));
            for (const [text] of byRoot) result[text] = '';
            return result;
        },
    };
    return api;
}

/**
 * Скачивает JSON файлом.
 * @param {string} name
 * @param {unknown} data
 */
export function downloadJson(name, data) {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
