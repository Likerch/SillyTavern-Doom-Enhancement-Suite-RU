/**
 * Модуль 1. Перевод интерфейса DES на русский.
 *
 * - Словарь: locales/ru.json (ключ — исходная английская строка) + словарь пользователя из панели.
 * - Наблюдение ограничено корнями DES (карта — DES_UI в des-adapter.js): за контейнерами ST следим
 *   без subtree, только чтобы заметить появление корней; глубоко — только внутри самих корней.
 *   В ленте сообщений (#chat) наблюдатель с subtree, но любая запись, не относящаяся к корню DES,
 *   отбрасывается сразу — текст сообщений, в том числе при стриминге, не трогается.
 * - Переводим текстовые узлы, атрибуты title/placeholder/aria-label и подсказки с инлайн-тегами
 *   целиком. Данные (имена, значения трекера, поля ввода, лорбуки, текст сообщений) не трогаем.
 * - Идемпотентность по содержимому: для каждого узла помним исходник и наш перевод. Если DES
 *   перерисовал узел (в т. ч. своим i18n обратно в английский), переводим заново.
 * - Непереведённое копится и выгружается в JSON для пополнения словаря.
 */
import { OWN_TOAST_CLASS, getContext, notify } from '../st.js';
import { log } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { DES_SELECTORS, DES_UI } from '../des-adapter.js';
import { createDictionary, looksTranslatable, normalizeText, renderTemplate } from '../lib/dictionary.js';
import { menuButton } from '../ui.js';

const DICTIONARY_URL = new URL('../../locales/ru.json', import.meta.url);
const ROOT_SELECTOR = DES_UI.roots.map((root) => root.selector).join(', ');
const CHAT_ROOT_SELECTOR = DES_UI.chatRoots.map((root) => root.selector).join(', ');
const CHROME_SELECTOR = DES_UI.chrome.join(', ');
const EXCLUDE_SELECTOR = DES_UI.exclude.join(', ');
const NO_COLLECT_SELECTOR = DES_UI.noCollect.join(', ');
const USER_ONLY_SELECTOR = DES_UI.userOnly.join(', ');
const DATA_ATTRIBUTE_SELECTOR = DES_UI.dataAttributes.join(', ');
const OBSERVE_ROOT = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...DES_UI.attributes] };
/** Инлайн-теги, из которых состоят подсказки; иконки Font Awesome форматированием не считаются. */
const INLINE_TAGS = new Set(['CODE', 'STRONG', 'EM', 'B', 'I', 'U', 'BR', 'SMALL', 'KBD', 'SPAN', 'A']);
const DRAWER_CONFIG = Object.freeze({ selector: 'drawer', mode: 'full' });
const CHAT_CONFIG = new Map(DES_UI.chatRoots.map((root) => [root.selector, root]));

/** @typedef {{ selector: string, mode: 'full'|'chrome' }} RootConfig */
/** @typedef {{ noCollect: boolean, userOnly: boolean }} VisitContext */

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
let builtIn = {};
let dictionary = createDictionary({});
let userDictionary = createDictionary({});
/** Поколение словаря: после правки словаря все узлы переводятся заново от исходника. */
let generation = 0;

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
/** @type {Set<() => void>} */
const changeListeners = new Set();
let notifyTimer = 0;

// ─── Настройки ─────────────────────────────────────────────────────────────

/** Живые настройки модуля: панель монтируется раньше, чем модуль включается, поэтому не через env. */
function moduleSettings() {
    return getSettings().modules.localization;
}

/** @param {string} key */
function option(key) {
    return moduleSettings()[key] !== false;
}

function notifyChange() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => changeListeners.forEach((listener) => listener()), 300);
}

// ─── Словарь ───────────────────────────────────────────────────────────────

async function loadBuiltInDictionary() {
    try {
        const response = await fetch(DICTIONARY_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('словарь должен быть объектом');
        builtIn = data;
    } catch (error) {
        builtIn = {};
        log.error('Локализация: не удалось загрузить locales/ru.json — интерфейс останется английским', error);
    }
}

function rebuildDictionaries() {
    const user = moduleSettings().userDictionary;
    const userEntries = user && typeof user === 'object' && !Array.isArray(user) ? user : {};
    dictionary = createDictionary({ ...builtIn, ...userEntries });
    userDictionary = createDictionary(userEntries);
    generation += 1;
}

/** @param {VisitContext} context */
function dictionaryFor(context) {
    return context.userOnly ? userDictionary : dictionary;
}

// ─── Непереведённое ────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {'text'|'attribute'|'rich'|'toast'} kind
 * @param {Element|null} where
 */
function collect(text, kind, where) {
    if (!option('collect')) return;
    const key = normalizeText(text);
    if (!key || (kind !== 'rich' && !looksTranslatable(key))) return;
    const entry = untranslated.get(key);
    if (entry) {
        entry.count += 1;
        return;
    }
    untranslated.set(key, { kind, where: describeRoot(where), count: 1 });
    notifyChange();
}

/** @param {Element|null} element */
function describeRoot(element) {
    if (!element) return 'уведомление';
    const root = element.closest(`${ROOT_SELECTOR}, ${CHAT_ROOT_SELECTOR}`);
    if (!root) return element.closest('#extensions_settings2, #extensions_settings') ? 'блок DES в Extensions' : 'другое';
    return root.id ? `#${root.id}` : `.${String(root.className).split(/\s+/)[0]}`;
}

// ─── Перевод узлов ─────────────────────────────────────────────────────────

/** Сохраняет ведущие и хвостовые пробелы исходного узла вокруг перевода. */
function keepWhitespace(original, translation) {
    const lead = original.match(/^\s*/)[0];
    const trail = original.match(/\s*$/)[0];
    return `${lead}${translation}${trail}`;
}

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
    for (const name of DES_UI.attributes) {
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
        // Элемент с id DES ищет и заполняет сам: такую подсказку нельзя переписывать через innerHTML.
        if (!isShallowInline(child_)) return false;
        if (isIcon(child_)) icon = true;
        else formatting = true;
    }
    return textNodes > 0 && (formatting || (icon && textNodes > 1));
}

const RUN_CLASS = 'desru-run';

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
 * @param {Element} element
 * @param {VisitContext} context
 * @returns {boolean} перевод применён
 */
function translateRich(element, context) {
    const current = element.innerHTML;
    const state = richState.get(element);
    if (state && current === state.value && state.generation === generation) return true;
    const source = state && current === state.value ? state.source : current;
    const translation = dictionaryFor(context).rich(source);
    if (translation === null) {
        if (state && current === state.value) element.innerHTML = state.source;
        richState.delete(element);
        if (!context.noCollect && !context.userOnly) collect(source, 'rich', element);
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
    const isCustomLabel = element.matches(CHROME_SELECTOR) && Boolean(element.parentElement?.querySelector(DES_UI.customFieldMarker));
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
 * Обходит поддерево режима full.
 * @param {Element} element
 * @param {VisitContext} parentContext
 */
function visit(element, parentContext) {
    if (element.matches(EXCLUDE_SELECTOR)) return;
    const context = contextOf(element, parentContext);
    translateAttributes(element, context);
    if (isRichUnit(element)) {
        // Подсказка переводится целиком или остаётся английской: обрывки дали бы смесь языков в одной фразе.
        translateRich(element, context);
        return;
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
    if (!element || element.closest(EXCLUDE_SELECTOR)) return;

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

// ─── Корни и наблюдатели ───────────────────────────────────────────────────

/** @param {Element} element */
function configForRoot(element) {
    return DES_UI.roots.find((root) => element.matches(root.selector)) ?? null;
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

/** Ищет корни DES в добавленном узле и вокруг него. */
function discover(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = /** @type {Element} */ (node);
    if (element.matches(ROOT_SELECTOR)) attachRoot(element);
    element.querySelectorAll(ROOT_SELECTOR).forEach((root) => attachRoot(root));
    const toggle = element.matches(DES_SELECTORS.drawerToggle) ? element : element.querySelector(DES_SELECTORS.drawerToggle);
    if (toggle) attachRoot(DES_UI.drawerOf(toggle), DRAWER_CONFIG);
    if (element.matches(DES_UI.toastContainer)) observeToasts(element);
    if (element.matches(DES_UI.stPopup)) translatePopup(element);
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

function observeChat() {
    const chat = document.querySelector(DES_UI.chat);
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

/** @param {Element} root */
function chatConfigFor(root) {
    for (const [selector, config] of CHAT_CONFIG) if (root.matches(selector)) return config;
    return null;
}

/** @param {Element} container */
function observeToasts(container) {
    if (observers.some((observer) => observer.desruTarget === container)) return;
    container.querySelectorAll('.toast').forEach(translateToast);
    const observer = new MutationObserver((records) => {
        for (const record of records) record.addedNodes.forEach((node) => node.nodeType === Node.ELEMENT_NODE && translateToast(/** @type {Element} */ (node)));
        observer.takeRecords();
    });
    observer.desruTarget = container;
    observer.observe(container, { childList: true });
    observers.push(observer);
}

/** @param {Element} toast */
function translateToast(toast) {
    if (!option('toasts') || toast.classList.contains(OWN_TOAST_CLASS)) return;
    for (const part of toast.querySelectorAll(DES_UI.toastParts.join(', '))) {
        for (const child of part.childNodes) {
            if (child.nodeType !== Node.TEXT_NODE) continue;
            const text = child.nodeValue ?? '';
            const translation = dictionary.text(text);
            if (translation === null) {
                collect(text, 'toast', null);
                continue;
            }
            child.nodeValue = keepWhitespace(text, translation);
        }
    }
}

/** Попап ST с текстом DES: переводим только то, что есть в словаре. */
function translatePopup(popup) {
    const content = popup.querySelector(DES_UI.stPopupContent);
    if (content) visit(content, { noCollect: true, userOnly: false });
}

function scanDocument() {
    const toggle = document.querySelector(DES_SELECTORS.drawerToggle);
    if (toggle) attachRoot(DES_UI.drawerOf(toggle), DRAWER_CONFIG);
    document.querySelectorAll(ROOT_SELECTOR).forEach((root) => attachRoot(root));
    const toasts = document.querySelector(DES_UI.toastContainer);
    if (toasts) observeToasts(toasts);
    observeChat();
}

function startObserving() {
    for (const selector of DES_UI.containers) {
        const container = selector === 'body' ? document.body : document.querySelector(selector);
        if (container) observeContainer(container);
    }
    scanDocument();
}

/** Переводит заново все известные корни (после правки словаря). */
function retranslateAll() {
    pruneRoots();
    for (const [root, { config, observer }] of roots) {
        translateInRoot(root, root, config);
        observer?.takeRecords();
    }
    const chat = document.querySelector(DES_UI.chat);
    chat?.querySelectorAll(CHAT_ROOT_SELECTOR).forEach((root) => {
        const config = chatConfigFor(root);
        if (config) translateInRoot(root, root, config);
    });
    for (const observer of observers) observer.takeRecords();
}

const LAYOUT_STYLE_ID = 'desru-layout-fixes';

/** Подключает правки вёрстки DES под русские подписи (DES_UI.layoutFixes). */
function applyLayoutFixes() {
    if (document.getElementById(LAYOUT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LAYOUT_STYLE_ID;
    style.textContent = DES_UI.layoutFixes.map((fix) => {
        const rule = `${fix.selector} { ${fix.style} }`;
        return fix.media ? `@media ${fix.media} { ${rule} }` : rule;
    }).join('\n');
    document.head.append(style);
}

function removeLayoutFixes() {
    document.getElementById(LAYOUT_STYLE_ID)?.remove();
}

/** Возвращает английский во всех узлах, которые мы перевели. */
function restoreAll() {
    const elements = new Set([...roots.keys()]);
    document.querySelector(DES_UI.chat)?.querySelectorAll(CHAT_ROOT_SELECTOR).forEach((root) => elements.add(root));
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

// ─── Панель ────────────────────────────────────────────────────────────────

/**
 * Для отладки и пополнения словаря: что не переведено, где и сколько раз встретилось.
 * @returns {{ text: string, kind: string, where: string, count: number }[]}
 */
export function getUntranslated() {
    return [...untranslated.entries()].map(([text, entry]) => ({ text, ...entry }));
}

/** @returns {Record<string, string>} непереведённое в формате словаря */
function untranslatedAsDictionary() {
    const result = { __desru: 'Непереведённые строки DES. Впиши перевод в значение и вставь в словарь пользователя или пришли разработчику.' };
    const byRoot = [...untranslated.entries()].sort((a, b) => a[1].where.localeCompare(b[1].where));
    for (const [text] of byRoot) result[text] = '';
    return result;
}

function downloadJson(name, data) {
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

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'Словарь интерфейса';
    const stats = document.createElement('small');
    stats.className = 'desru-dict-stats';
    const actions = document.createElement('div');
    actions.className = 'desru-log-actions';
    const exportButton = menuButton('fa-file-export', 'Выгрузить непереведённые (JSON)', () => {
        if (!untranslated.size) {
            notify('info', 'Непереведённых строк пока нет');
            return;
        }
        downloadJson('desru-untranslated.json', untranslatedAsDictionary());
    });
    const clearButton = menuButton('fa-broom', 'Очистить список', () => {
        untranslated.clear();
        render();
    });
    actions.append(exportButton, clearButton);

    const userLabel = document.createElement('small');
    userLabel.className = 'desru-dict-hint';
    userLabel.textContent = 'Свой словарь: JSON-объект «английская строка → перевод». Перекрывает встроенный; подписи своих полей сцены переводятся только здесь.';
    const editor = document.createElement('textarea');
    editor.className = 'text_pole desru-dict-editor';
    editor.rows = 6;
    editor.spellcheck = false;
    editor.value = JSON.stringify(moduleSettings().userDictionary ?? {}, null, 2);
    const error = document.createElement('small');
    error.className = 'desru-dict-error';
    const saveButton = menuButton('fa-floppy-disk', 'Сохранить словарь', () => {
        try {
            const parsed = JSON.parse(editor.value || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('нужен объект { "English": "Русский" }');
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value !== 'string') throw new Error(`значение для «${key}» должно быть строкой`);
            }
            moduleSettings().userDictionary = parsed;
            saveSettings();
            error.textContent = '';
            if (env) {
                rebuildDictionaries();
                retranslateAll();
            }
            render();
            notify('success', 'Словарь сохранён');
        } catch (problem) {
            error.textContent = `Ошибка: ${problem.message}`;
        }
    });
    section.append(summary, stats, actions, userLabel, editor, error, saveButton);

    const render = () => {
        const builtInSize = Object.keys(builtIn).filter((key) => !key.startsWith('__') && builtIn[key]).length;
        const userSize = Object.keys(moduleSettings().userDictionary ?? {}).length;
        stats.textContent = env
            ? renderTemplate('В словаре {n} {n|строка|строки|строк}, своих — {u}. Непереведённых встречено: {m}.',
                { n: String(builtInSize), u: String(userSize), m: String(untranslated.size) })
            : 'Модуль выключен.';
    };
    changeListeners.add(render);
    render();
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'localization',
    number: 1,
    title: 'Локализация интерфейса',
    description: 'Переводит кнопки, подписи, подсказки и уведомления DES. Текст чата, значения трекера, имена и лорбуки не трогает.',
    needs: { ui: true, data: false },
    options: [
        { key: 'toasts', title: 'Переводить уведомления DES', description: 'Всплывающие сообщения DES (успех, ошибки, подсказки) — по словарю.' },
        { key: 'collect', title: 'Собирать непереведённые строки', description: 'Для пополнения словаря: список выгружается в JSON в разделе «Словарь интерфейса».' },
    ],
    section: 'localization',
    mountSection,
    async enable(environment) {
        env = environment;
        await loadBuiltInDictionary();
        rebuildDictionaries();
        applyLayoutFixes();
        startObserving();
        getContext().eventSource.on(getContext().eventTypes.CHAT_CHANGED, observeChat);
        notifyChange();
        log.info(renderTemplate('Модуль 1 (локализация) включён: в словаре {n} {n|строка|строки|строк}.', { n: String(dictionary.size) }));
    },
    disable() {
        getContext().eventSource.removeListener(getContext().eventTypes.CHAT_CHANGED, observeChat);
        observers.forEach((observer) => observer.disconnect());
        observers = [];
        observedChat = null;
        for (const { observer } of roots.values()) observer?.disconnect();
        restoreAll();
        removeLayoutFixes();
        roots.clear();
        env = null;
        notifyChange();
        log.info('Модуль 1 (локализация) выключен: интерфейс DES снова английский.');
    },
    notes() {
        const notes = [];
        if (!Object.keys(builtIn).length) notes.push({ level: 'warn', text: 'Встроенный словарь не загрузился — переводятся только строки из своего словаря.' });
        return notes;
    },
};
