/**
 * Модуль 6. CarrotKernel по-русски.
 *
 * CarrotKernel (CK) хранит теги персонажей BunnyMo в архивах и вставляет их в промпт. В русской игре:
 * 1. Кириллические имена. CK сравнивает имена через `[^\w\s]`, любое кириллическое имя у него — пустая
 *    строка, и персонаж получает теги первого попавшегося. Модуль пересобирает вставку тегов после CK
 *    с поиском по юникодному ключу имени и подменяет поиск у генератора листов и макросов CK.
 * 2. Дамп тегов. В режиме показа «thinking» CK дописывает к каждому ответу блок <BunnyMoTags>: он уходит
 *    модели в истории, DES видит в нём лист и ставит кнопку импорта на обычный ответ, а перерисовка CK
 *    стирает пузыри и мысли DES. Модуль вырезает дамп из промпта, прячет ложную кнопку и возвращает
 *    украшения DES.
 * 3. Интерфейс CK — по-русски, тем же движком, что и DES (словарь locales/ru.carrotkernel.json).
 *
 * Файлы CK не меняются; модуль ждёт, пока CK закончит запуск, и проверяет нужные экспорты.
 */
import { getContext, notify } from '../st.js';
import { log } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { CK_CHAT, CK_DISPLAY_MODES, CK_INFO, CK_UI, inspectCk } from '../ck-adapter.js';
import { DES_SELECTORS } from '../des-adapter.js';
import { carrotDumpBodies, findCharacter, ragTriggerForms, stripCarrotDumps, stripCarrotDumpsFromPrompt } from '../lib/carrot-data.js';
import { renderTemplate } from '../lib/dictionary.js';
import { wordForms } from '../lib/russian-names.js';
import { createTranslator, downloadJson } from '../translator.js';
import { menuButton } from '../ui.js';

const DICTIONARY_URL = new URL('../../locales/ru.carrotkernel.json', import.meta.url);
const CK_WAIT_MS = 30000;
/** Модели эмбеддингов, которые понимают русский (подсказка для RAG CK). */
const MULTILINGUAL_HINT = 'bge-m3, multilingual-e5, embed-multilingual-v3.0, text-embedding-3-*';
/** Источник эмбеддингов «встроенные ST»: модель задаётся не в CK, а в config.yaml сервера. */
const LOCAL_EMBEDDINGS = 'transformers';
const NON_ASCII = /[^\x00-\x7F]/;

const OPTIONS = [
    {
        key: 'cyrillicNames',
        title: 'Кириллические имена',
        description: 'CK путает персонажей с русскими именами и вставляет одному теги другого. Модуль пересобирает его вставку тегов и поиск в листах и макросах по полному имени.',
    },
    {
        key: 'dumpFilter',
        title: 'Дамп тегов CK не уходит модели',
        description: 'Блок <BunnyMoTags>, который CK дописывает к ответам в режиме «thinking», вырезается из истории перед отправкой. В чате он остаётся.',
    },
    {
        key: 'desButtons',
        title: 'CK не мешает DES',
        description: 'Без ложной кнопки импорта листа DES на ответах с дампом CK; пузыри и мысли DES возвращаются после того, как CK перерисует сообщение.',
    },
    {
        key: 'ragForms',
        title: 'RAG по падежам имени',
        description: 'RAG CK подтягивает куски листа, только если имя персонажа стоит в последних сообщениях дословно. Модуль дописывает к триггерам листа падежные формы русского имени («Шарлотте», «Шарлоттой»).',
    },
    {
        key: 'translateUi',
        title: 'Интерфейс CK по-русски',
        description: 'Настройки, окна, карточки и уведомления CK — по словарю. Имена, теги и названия лорбуков не переводятся.',
    },
];

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {import('../ck-adapter.js').CkApi|null} */
let ck = null;
/** @type {import('../ck-adapter.js').CkFacts|null} */
let facts = null;
/** @type {Array<[string, (...args: any[]) => unknown]>} */
let subscriptions = [];
/** @type {MutationObserver|null} */
let chatObserver = null;
let dictionaryFailed = false;
/** Лорбуки записей, сработавших в последнем сканировании: среди одноимённых персонажей — они. */
let activeSources = new Set();
const counters = { consistency: 0, dumps: 0, buttons: 0, restored: 0, ragForms: 0 };
/** @type {Set<() => void>} */
const changeListeners = new Set();
let notifyTimer = 0;

function moduleSettings() {
    return getSettings().modules.carrotKernel;
}

/** @param {string} key */
function option(key) {
    return moduleSettings()?.[key] !== false;
}

function notifyChange() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => changeListeners.forEach((listener) => {
        try {
            listener();
        } catch (error) {
            log.warn('CarrotKernel: панель не обновилась', error);
        }
    }), 200);
}

const translator = createTranslator({
    id: 'ck',
    ui: CK_UI,
    userDictionary: () => moduleSettings().userDictionary,
    // Уведомления CK не отличить от чужих: переводим, но в непереведённое не собираем.
    options: () => ({ toasts: option('toasts'), collect: option('collect'), collectToasts: false }),
    onCollect: notifyChange,
});

// ─── 1. Кириллические имена ────────────────────────────────────────────────

/**
 * Поиск персонажа для CK — с той же сигнатурой, что у его findCharacterByName.
 * @param {string} name
 * @param {string|null} [lorebook]
 */
function findForCk(name, lorebook = null) {
    if (!ck || !name) return null;
    const scanned = ck.scanned();
    if (lorebook && scanned.has(`${lorebook}::${name}`)) {
        const data = scanned.get(`${lorebook}::${name}`);
        return { name: data?.name || name, data };
    }
    return findCharacter(scanned.entries(), String(name), activeSources);
}

/**
 * До CK: какие лорбуки сработали — среди одноимённых персонажей поиск берёт оттуда.
 * @param {any[]} entryList
 */
function rememberSources(entryList) {
    activeSources = new Set((Array.isArray(entryList) ? entryList : []).map((entry) => entry?.world).filter(Boolean));
}

/** Поиск для генератора листов и макросов CK (его вызывает и шаблон вставки тегов). */
function installFinder() {
    ck?.installFinder((name, lorebook) => findForCk(name, lorebook));
}

/**
 * После CK: если в его вставке тегов есть не-латинские имена, пересобрать её с правильным поиском.
 */
async function fixConsistency() {
    if (!ck || !option('cyrillicNames') || !ck.enabled() || !ck.sendsToAi()) return;
    const names = ck.lastInjected();
    if (!names.some((name) => NON_ASCII.test(name))) return;
    const slot = ck.consistencySlot();
    if (!slot?.value) return;
    const text = await ck.consistencyText(names, (name) => findForCk(name));
    if (!text || text === slot.value) return;
    ck.setConsistencyText(text);
    counters.consistency += 1;
    log.info(`CarrotKernel: вставка тегов пересобрана для ${names.join(', ')} — CK путает кириллические имена.`);
    notifyChange();
}

/**
 * Триггеры коллекций RAG CK: падежные формы русского имени персонажа. Формы, которые пользователь сам убрал
 * из триггеров в CK, не возвращаем — для этого помним, что дописывали.
 */
function ensureRagTriggerForms() {
    if (!ck || !option('ragForms') || !ck.ragEnabled()) return;
    const collections = ck.ragCollections();
    if (!collections) return;
    const settings = moduleSettings();
    const added = settings.ragFormsAdded && typeof settings.ragFormsAdded === 'object' ? settings.ragFormsAdded : {};
    let total = 0;
    for (const [id, meta] of Object.entries(collections)) {
        if (!meta || typeof meta !== 'object' || !meta.characterName) continue;
        const keywords = Array.isArray(meta.keywords) ? meta.keywords : [];
        const ours = new Set(Array.isArray(added[id]) ? added[id] : []);
        const missing = ragTriggerForms(meta.characterName, (word) => wordForms(word, { genitive: true }))
            .filter((form) => !ours.has(form) && !keywords.some((keyword) => String(keyword).toLowerCase() === form));
        if (!missing.length) continue;
        meta.keywords = [...keywords, ...missing];
        added[id] = [...ours, ...missing];
        total += missing.length;
    }
    if (!total) return;
    settings.ragFormsAdded = added;
    saveSettings();
    ck.saveSettings();
    counters.ragForms += total;
    log.info(`CarrotKernel: к триггерам RAG дописаны падежные формы имён (${total}).`);
    notifyChange();
}

// ─── 2. Дамп тегов и DES ───────────────────────────────────────────────────

/**
 * Chat Completion: дамп CK стоит в конце ответа модели. Ищем его и с обёрткой, и без неё — регулярка
 * «убрать HTML из промпта» (её ставят с DES) срезает теги и оставляет голые строки дампа.
 * @param {{ chat?: { role: string, content: unknown }[], dryRun?: boolean }} data
 */
function stripFromChatCompletion(data) {
    if (!option('dumpFilter') || !Array.isArray(data?.chat)) return;
    const bodies = carrotDumpBodies(getContext().chat);
    let removed = 0;
    for (const message of data.chat) {
        if (message?.role !== 'assistant') continue;
        if (typeof message.content === 'string') {
            const result = stripCarrotDumpsFromPrompt(message.content, bodies);
            if (result.removed) {
                message.content = result.text;
                removed += result.removed;
            }
        } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part?.type !== 'text' || typeof part.text !== 'string') continue;
                const result = stripCarrotDumpsFromPrompt(part.text, bodies);
                if (result.removed) {
                    part.text = result.text;
                    removed += result.removed;
                }
            }
        }
    }
    reportDumps(removed, data?.dryRun);
}

/**
 * Text Completion: один длинный промпт. Без обёртки вырезаем только многострочные дампы —
 * однострочный («Аня:») не отличить от прозы.
 * @param {{ prompt?: unknown, dryRun?: boolean }} data
 */
function stripFromTextCompletion(data) {
    if (!option('dumpFilter') || typeof data?.prompt !== 'string') return;
    const result = stripCarrotDumps(data.prompt);
    let text = result.text;
    let removed = result.removed;
    for (const body of carrotDumpBodies(getContext().chat)) {
        if (!body.includes('\n') || !text.includes(body)) continue;
        text = text.split(body).join('');
        removed += 1;
    }
    if (!removed) return;
    data.prompt = text;
    reportDumps(removed, data.dryRun);
}

/** @param {number} removed @param {boolean} [dryRun] */
function reportDumps(removed, dryRun) {
    if (!removed || dryRun) return;
    counters.dumps += removed;
    log.debug(`CarrotKernel: из промпта вырезано дампов тегов: ${removed}.`);
    notifyChange();
}

/**
 * Кнопка импорта DES на сообщении, где «лист» — только дамп CK: убираем.
 * @param {Element} button
 */
function checkImportButton(button) {
    const des = env?.des;
    if (!des?.sheets.available()) return;
    const messageElement = button.closest('.mes[mesid]');
    const message = getContext().chat?.[Number(messageElement?.getAttribute('mesid'))];
    if (!message || typeof message.mes !== 'string') return;
    const stripped = stripCarrotDumps(message.mes);
    if (!stripped.removed || des.sheets.detects(stripped.text)) return;
    button.remove();
    counters.buttons += 1;
    notifyChange();
}

/** @type {Map<Element, number>} */
const restoreTimers = new Map();

/**
 * CK перерисовал текст сообщения (innerHTML) и стёр пузыри и мысли DES: возвращаем их.
 * @param {Element} messageElement
 */
function scheduleRestore(messageElement) {
    const des = env?.des;
    if (!des) return;
    clearTimeout(restoreTimers.get(messageElement));
    restoreTimers.set(messageElement, setTimeout(() => {
        restoreTimers.delete(messageElement);
        if (!messageElement.isConnected || !des.bubbles.restoreIfLost(messageElement)) return;
        // Мысли и шапку сцены DES держит внутри сообщения — после перерисовки CK их тоже нет.
        // Только когда пропали пузыри: перерисовка DES сама снова вставляет блок CK, иначе был бы круг.
        des.rerender();
        counters.restored += 1;
        notifyChange();
    }, 150));
}

function observeChat() {
    chatObserver?.disconnect();
    const chat = document.querySelector('#chat');
    if (!chat) return;
    chatObserver = new MutationObserver((records) => {
        if (!option('desButtons')) return;
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const element = /** @type {Element} */ (node);
                const buttons = element.matches(DES_SELECTORS.importButton) ? [element] : element.querySelectorAll(DES_SELECTORS.importButton);
                buttons.forEach(checkImportButton);
                const rendered = element.matches(CK_CHAT.renderedTags) ? element : element.querySelector(CK_CHAT.renderedTags);
                const messageElement = rendered?.closest('.mes[mesid]');
                if (messageElement) scheduleRestore(messageElement);
            }
        }
    });
    chatObserver.observe(chat, { childList: true, subtree: true });
}

// ─── Подписки ──────────────────────────────────────────────────────────────

/**
 * @param {'on'|'makeFirst'|'makeLast'} method
 * @param {string} event
 * @param {(...args: any[]) => unknown} handler
 */
function subscribe(method, event, handler) {
    const safe = async (...args) => {
        if (!env || !ck) return;
        try {
            return await handler(...args);
        } catch (error) {
            log.error(`CarrotKernel: сбой в обработчике ${event}`, error);
        }
    };
    getContext().eventSource[method](event, safe);
    subscriptions.push([event, safe]);
    return safe;
}

function unsubscribeAll() {
    const { eventSource } = getContext();
    for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
    subscriptions = [];
}

// ─── Панель ────────────────────────────────────────────────────────────────

/**
 * @param {string} className
 * @param {string} [text]
 */
function small(className, text = '') {
    const element = document.createElement('small');
    element.className = className;
    element.textContent = text;
    return element;
}

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'CarrotKernel';
    const list = document.createElement('ul');
    list.className = 'desru-merge-list';
    const stats = small('desru-dict-stats');
    const actions = document.createElement('div');
    actions.className = 'desru-log-actions';
    actions.append(
        menuButton('fa-file-export', 'Выгрузить непереведённые (JSON)', () => {
            if (!translator.untranslatedCount()) {
                notify('info', 'Непереведённых строк CarrotKernel пока нет');
                return;
            }
            downloadJson('desru-carrotkernel-untranslated.json', translator.untranslatedAsDictionary(
                'Непереведённые строки CarrotKernel. Впиши перевод в значение и вставь в свой словарь или пришли разработчику.'));
        }),
        menuButton('fa-broom', 'Очистить список', () => {
            translator.clearUntranslated();
            render();
        }),
    );
    const userLabel = small('desru-dict-hint', 'Свой словарь для CarrotKernel: JSON-объект «английская строка → перевод». Перекрывает встроенный.');
    const editor = document.createElement('textarea');
    editor.className = 'text_pole desru-dict-editor';
    editor.rows = 4;
    editor.spellcheck = false;
    editor.value = JSON.stringify(moduleSettings().userDictionary ?? {}, null, 2);
    const error = small('desru-dict-error');
    const save = menuButton('fa-floppy-disk', 'Сохранить словарь', () => {
        try {
            const parsed = JSON.parse(editor.value || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('нужен объект { "English": "Русский" }');
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value !== 'string') throw new Error(`значение для «${key}» должно быть строкой`);
            }
            moduleSettings().userDictionary = parsed;
            saveSettings();
            error.textContent = '';
            if (translator.running) {
                translator.rebuild();
                translator.retranslateAll();
            }
            render();
            notify('success', 'Словарь CarrotKernel сохранён');
        } catch (problem) {
            error.textContent = `Ошибка: ${problem.message}`;
        }
    });

    function render() {
        list.replaceChildren();
        const lines = [];
        if (!env) lines.push('Модуль выключен.');
        else if (!facts?.found) lines.push('CarrotKernel не установлен.');
        else if (!ck) lines.push('CarrotKernel недоступен — причина в замечаниях модуля выше.');
        else {
            lines.push(`${facts.name} · v${facts.version ?? '?'} · режим показа «${ck.displayMode()}».`);
            lines.push(`Вставок тегов пересобрано: ${counters.consistency}; дампов вырезано из промпта: ${counters.dumps}; ложных кнопок DES убрано: ${counters.buttons}; сообщений с возвращёнными украшениями DES: ${counters.restored}; форм имён в триггерах RAG: ${counters.ragForms}.`);
        }
        for (const line of lines) list.append(Object.assign(document.createElement('li'), { textContent: line }));
        stats.textContent = translator.running
            ? renderTemplate('Словарь интерфейса CK: {n} {n|строка|строки|строк}. Непереведённых встречено: {m}.',
                { n: String(translator.builtInSize()), m: String(translator.untranslatedCount()) })
            : 'Перевод интерфейса CK выключен.';
    }

    section.append(summary, list, stats, actions, userLabel, editor, error, save);
    render();
    changeListeners.add(render);
}

// ─── Перевод интерфейса ────────────────────────────────────────────────────

async function startTranslator() {
    if (translator.running || !option('translateUi')) return;
    dictionaryFailed = false;
    try {
        await translator.load(DICTIONARY_URL);
    } catch (error) {
        dictionaryFailed = true;
        log.error('CarrotKernel: не удалось загрузить locales/ru.carrotkernel.json — интерфейс CK останется английским', error);
    }
    translator.rebuild();
    translator.start();
    log.info(renderTemplate('CarrotKernel: перевод интерфейса включён, в словаре {n} {n|строка|строки|строк}.', { n: String(translator.size()) }));
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'carrotKernel',
    number: 6,
    title: 'CarrotKernel по-русски',
    description: 'Для расширения CarrotKernel: правильные теги у персонажей с русскими именами, дамп тегов не мешает модели и DES, интерфейс CK по-русски. Работает, только если CK установлен.',
    needs: { ui: false, data: false },
    options: OPTIONS,
    section: 'carrotKernel',
    mountSection,
    async enable(environment) {
        env = environment;
        const result = await inspectCk({ timeoutMs: CK_WAIT_MS });
        if (!env) return;
        facts = result.facts;
        ck = result.api;
        if (!ck) {
            log.info(facts.found ? `CarrotKernel найден, но недоступен: ${describeProblem()}` : 'CarrotKernel не установлен — модулю 6 нечего делать.');
            notifyChange();
            return;
        }
        const { eventTypes } = getContext();
        if (option('cyrillicNames')) installFinder();
        // CK пишет вставку тегов в своём WORLD_INFO_ACTIVATED; запоминаем лорбуки до него, пересобираем после.
        subscribe('makeFirst', eventTypes.WORLD_INFO_ACTIVATED, rememberSources);
        const fix = subscribe('makeLast', eventTypes.WORLD_INFO_ACTIVATED, fixConsistency);
        subscribe('makeFirst', eventTypes.GENERATION_STARTED, () => getContext().eventSource.makeLast(eventTypes.WORLD_INFO_ACTIVATED, fix));
        // RAG CK выбирает коллекции в своём перехватчике генерации — он идёт после GENERATION_STARTED.
        subscribe('on', eventTypes.GENERATION_STARTED, ensureRagTriggerForms);
        subscribe('on', eventTypes.CHAT_COMPLETION_PROMPT_READY, stripFromChatCompletion);
        subscribe('on', eventTypes.GENERATE_AFTER_COMBINE_PROMPTS, stripFromTextCompletion);
        subscribe('on', eventTypes.CHAT_CHANGED, () => {
            observeChat();
            translator.refreshChat();
            ensureRagTriggerForms();
        });
        observeChat();
        ensureRagTriggerForms();
        await startTranslator();
        notifyChange();
        log.info(`Модуль 6 (CarrotKernel) включён: ${facts.name} v${facts.version ?? '?'}.`);
    },
    disable() {
        unsubscribeAll();
        chatObserver?.disconnect();
        chatObserver = null;
        translator.stop();
        if (ck) log.info('Модуль 6 (CarrotKernel) выключен. Поиск персонажей в листах CK вернётся к своему после перезагрузки страницы.');
        ck = null;
        env = null;
        notifyChange();
    },
    status() {
        if (!facts) return { text: 'ищет CarrotKernel…', tone: 'wait' };
        if (!facts.found) return { text: 'ждёт: CK не установлен', tone: 'off' };
        if (!ck) return { text: 'CK недоступен', tone: 'blocked' };
        return null;
    },
    onOptionChange(key, enabled) {
        if (!ck) return;
        if (key === 'cyrillicNames') {
            if (enabled) installFinder();
            else log.info('CarrotKernel: поиск персонажей в листах и макросах CK вернётся к своему после перезагрузки страницы.');
            return;
        }
        if (key !== 'translateUi') return;
        if (enabled) startTranslator().then(notifyChange);
        else {
            translator.stop();
            notifyChange();
        }
    },
    notes() {
        const notes = [];
        if (!facts?.found) {
            notes.push({ level: 'info', text: 'CarrotKernel не установлен — модуль ждёт. После установки перезагрузи страницу.' });
            return notes;
        }
        if (!ck) {
            notes.push({ level: 'warn', text: `CarrotKernel недоступен: ${describeProblem()}` });
            return notes;
        }
        if (facts.version && !CK_INFO.verifiedVersions.includes(facts.version)) {
            notes.push({ level: 'info', text: `Версия CK ${facts.version} не проверялась, проверено на ${CK_INFO.verifiedVersions.join(', ')} (${CK_INFO.verifiedCommit}).` });
        }
        if (ck.displayMode() === CK_DISPLAY_MODES.thinking) {
            notes.push({ level: 'warn', text: 'Режим показа CK — «thinking»: он дописывает дамп тегов к каждому ответу. Модуль убирает его из промпта и не даёт DES ставить кнопку импорта, но проще выбрать в настройках CK режим «none» — теги всё равно уходят модели.' });
        }
        if (ck.ragEnabled() && ck.ragSource() === LOCAL_EMBEDDINGS) {
            notes.push({ level: 'info', text: 'RAG CK — на встроенных эмбеддингах ST: модель задаётся в config.yaml сервера (extensions.models.embedding). Для русских листов нужна многоязычная, например Xenova/multilingual-e5-small; английская по умолчанию ищет плохо.' });
        } else if (ck.ragEnabled() && !/multilingual|bge-m3|e5|text-embedding-3/i.test(ck.ragSource())) {
            notes.push({ level: 'info', text: `RAG CK включён: для русских листов нужна многоязычная модель эмбеддингов (${MULTILINGUAL_HINT}), английская ищет плохо.` });
        }
        if (dictionaryFailed) notes.push({ level: 'warn', text: 'Словарь интерфейса CK не загрузился — переводятся только строки из своего словаря.' });
        return notes;
    },
};

function describeProblem() {
    if (!facts) return 'проверка не завершилась';
    if (facts.stDisabled) return 'выключен в менеджере расширений ST';
    if (!facts.loaded) return 'скрипт не загрузился';
    if (!facts.initialized) return 'не закончил запуск за 30 секунд';
    if (facts.missingExports.length) return `нет ${facts.missingExports.join(', ')}`;
    return 'неизвестно';
}
