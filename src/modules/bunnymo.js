/**
 * Модуль 5. BunnyMo по-русски.
 *
 * BunnyMo — набор лорбуков с английскими инструкциями и тегами. В русской игре он ломается в трёх местах:
 * ключи не видят русскую прозу (и срабатывают на тексте самого BunnyMo), листы выходят английскими или с
 * переведёнными тегами, паки с запретом рекурсии не достать из архивов персонажей. Модуль чинит это снаружи:
 *
 * 1. Языковой замок — короткая системная вставка, пока в генерации участвуют записи BunnyMo или вставки
 *    CarrotKernel: проза по-русски, машинный слой (теги, SECTION N/M, Name) по-английски.
 * 2. Правки записей на лету (WORLDINFO_ENTRIES_LOADED, файлы лорбуков не меняются): русские ключи детекторов
 *    и «анти-клэнкера», детекторы — только по тексту чата, архетипы с невидимой строкой, ключи архивов со
 *    всеми падежами имени.
 * 3. Нормализатор ответа (MESSAGE_RECEIVED, раньше DES и CK): переведённые служебные токены — обратно.
 * 4. Теги персонажей сцены — во вставку «только для сканирования»: паки срабатывают и с запретом рекурсии.
 */
import { PROMPT_POSITION, PROMPT_ROLE, getContext, outgoingPromptRegexes, rerenderMessage } from '../st.js';
import { log } from '../log.js';
import { getSettings } from '../settings.js';
import { BUNNYMO_ENTRIES, archiveTags, classifyWorlds, isCharacterArchive, packVocabulary } from '../bunnymo-adapter.js';
import { ckMarkedBooks, hasCkSlots } from '../ck-adapter.js';
import { canonicalCardName } from '../name-context.js';
import { normalizeMachineLayer } from '../lib/bunnymo-normalize.js';
import { patchEntries } from '../lib/bunnymo-patch.js';
import { LANGUAGE_LOCK_RU } from '../lib/bunnymo-ru.js';
import { wordForms } from '../lib/russian-names.js';

/** Наши слоты extension-промптов. */
const SLOTS = Object.freeze({ lock: 'desru_bunnymo_language', tags: 'desru_bunnymo_tags' });
/** chat_metadata[...]: теги персонажей последней генерации — чтобы паки сработали и после перезагрузки страницы. */
const META_KEY = 'desru_bunnymo';
/** Сколько нерешённых тегов держим для панели. */
const UNRESOLVED_LIMIT = 20;

const OPTIONS = [
    {
        key: 'languageLock',
        title: 'Языковой замок',
        description: 'Пока в генерации участвует BunnyMo или CarrotKernel, модели напоминают: проза и листы — по-русски, теги, «SECTION N/M» и «Name» — по-английски, имя — как на карточке.',
    },
    {
        key: 'detectors',
        title: 'Детекторы на русском',
        description: 'Автодетекторы BunnyMo (ревность, паника, флирт…) получают русские ключи и срабатывают только на тексте чата, а не на тексте самого BunnyMo.',
    },
    {
        key: 'antiClanker',
        title: '«Анти-клэнкер» на русском',
        description: 'Записи Anti-Clanker ловят «роботную» русскую речь; текст Alpha — по-русски и без грубостей оригинала.',
    },
    {
        key: 'archetypes',
        title: 'Архетипы без «<Имя>» в тексте',
        description: 'Строка архетипов (!archetypes) с кириллическим именем показывалась текстом. Просим формат, который прячется.',
    },
    {
        key: 'archiveKeys',
        title: 'Ключи архивов со всеми падежами',
        description: 'Кириллические ключи архивов персонажей («Аня») срабатывают на «Ани», «Аней» и не срабатывают в «Таня».',
    },
    {
        key: 'normalizer',
        title: 'Нормализатор листов',
        description: 'Если модель перевела служебное — «Раздел 1 из 8», «**Имя:**», <ВИД:Эльф>, — возвращаем английское, чтобы лист нашли DES и CarrotKernel, а теги — паки. Проза не меняется.',
    },
    {
        key: 'packTags',
        title: 'Паки по тегам персонажей сцены',
        description: 'Теги персонажей из сработавших архивов идут в скрытую вставку для сканирования лорбуков: так срабатывают и паки, закрытые от рекурсии (BunnyRX, CoT-линзы, часть BSM-5 и MBTI). Отстаёт на один ответ.',
    },
];

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {Array<[string, (...args: any[]) => unknown]>} */
let subscriptions = [];
/** @type {Set<() => void>} */
const changeListeners = new Set();

/** Что было в последнем сканировании лорбуков. */
const scan = {
    at: 0,
    /** @type {Set<string>} */
    core: new Set(),
    /** @type {Set<string>} */
    packs: new Set(),
    /** @type {Set<string>} лорбуки CK: архивы и библиотеки тегов */
    marked: new Set(),
    /** @type {Map<string, Set<string>>} */
    vocabulary: new Map(),
    /** @type {import('../lib/bunnymo-patch.js').PatchStats|null} */
    stats: null,
};
/** Сработал ли BunnyMo в текущей генерации. */
let activeNow = false;
/** @type {string[]} */
let unresolved = [];
let normalizedMessages = 0;

function moduleSettings() {
    return getSettings().modules.bunnymo;
}

/** @param {string} key */
function option(key) {
    return moduleSettings()?.[key] !== false;
}

function notifyChange() {
    for (const listener of changeListeners) {
        try {
            listener();
        } catch (error) {
            log.warn('BunnyMo: панель не обновилась', error);
        }
    }
}

/** @returns {{ names: string[], tags: string[] }|null} теги персонажей последней генерации в этом чате */
function sceneTags() {
    const saved = getContext().chatMetadata?.[META_KEY];
    return saved && Array.isArray(saved.tags) ? { names: Array.isArray(saved.names) ? saved.names : [], tags: saved.tags } : null;
}

/** @param {{ names: string[], tags: string[] }} value */
function saveSceneTags(value) {
    const ctx = getContext();
    if (!ctx.chatMetadata || JSON.stringify(sceneTags()) === JSON.stringify(value)) return;
    ctx.chatMetadata[META_KEY] = value;
    ctx.saveMetadataDebounced?.();
}

/** Все лорбуки BunnyMo, которые видели в сканировании, и отмеченные в CK. */
function bunnyWorlds() {
    return new Set([...scan.core, ...scan.packs, ...scan.marked]);
}

// ─── Правки лорбуков ───────────────────────────────────────────────────────

/** @param {{ globalLore?: any[], characterLore?: any[], chatLore?: any[], personaLore?: any[] }} payload */
function onEntriesLoaded(payload) {
    const lists = [payload?.globalLore, payload?.characterLore, payload?.chatLore, payload?.personaLore].filter(Array.isArray);
    const entries = lists.flat();
    const { core, packs } = classifyWorlds(entries);
    const { repos, libraries } = ckMarkedBooks();
    scan.core = core;
    scan.packs = packs;
    scan.marked = new Set([...repos, ...libraries].filter((world) => entries.some((entry) => entry?.world === world)));
    const worlds = bunnyWorlds();
    scan.vocabulary = packVocabulary(entries.filter((entry) => worlds.has(entry?.world)));
    scan.stats = patchEntries(lists, {
        detectors: option('detectors'),
        antiClanker: option('antiClanker'),
        archetypes: option('archetypes'),
        archiveKeys: option('archiveKeys'),
    }, BUNNYMO_ENTRIES, {
        isArchive: (entry) => repos.has(entry?.world) || isCharacterArchive(entry),
        formsOf: (word) => wordForms(word, { genitive: true }),
    });
    const firstTime = !scan.at;
    scan.at = Date.now();
    if (firstTime && worlds.size) log.info(`BunnyMo: в сканировании лорбуки ${[...worlds].map((world) => `«${world}»`).join(', ')}.`);
    notifyChange();
}

/** @param {any[]} entryList записи, которые ST включил в этой генерации */
function onWorldInfoActivated(entryList) {
    if (!Array.isArray(entryList) || !entryList.length) return;
    const worlds = bunnyWorlds();
    if (entryList.some((entry) => worlds.has(entry?.world) || isCharacterArchive(entry))) activeNow = true;
    /** @type {Set<string>} */
    const tags = new Set();
    const names = [];
    for (const entry of entryList) {
        if (!isCharacterArchive(entry)) continue;
        const archive = archiveTags(entry);
        if (archive.name) names.push(archive.name);
        archive.tags.forEach((tag) => tags.add(tag));
    }
    if (tags.size) saveSceneTags({ names, tags: [...tags] });
    notifyChange();
}

// ─── Вставки ───────────────────────────────────────────────────────────────

/** Языковой замок: значение постоянное, а нужна ли вставка — ST спрашивает у фильтра при сборке промпта. */
function setLanguageLock() {
    const { setExtensionPrompt } = getContext();
    setExtensionPrompt(SLOTS.lock, LANGUAGE_LOCK_RU, PROMPT_POSITION.IN_CHAT, 0, false, PROMPT_ROLE.SYSTEM,
        () => Boolean(env) && option('languageLock') && (activeNow || hasCkSlots()));
}

/** Теги персонажей прошлой генерации — во вставку, которую ST только сканирует, но не отправляет. */
function setSceneTags() {
    const { setExtensionPrompt } = getContext();
    const entry = sceneTags();
    const value = option('packTags') && entry?.tags.length ? entry.tags.join(' ') : '';
    setExtensionPrompt(SLOTS.tags, value, PROMPT_POSITION.NONE, 0, true, PROMPT_ROLE.SYSTEM);
}

function onGenerationStarted() {
    activeNow = false;
    setLanguageLock();
    setSceneTags();
}

function clearSlots() {
    const { setExtensionPrompt } = getContext();
    setExtensionPrompt(SLOTS.lock, '', PROMPT_POSITION.IN_CHAT, 0);
    setExtensionPrompt(SLOTS.tags, '', PROMPT_POSITION.NONE, 0);
}

// ─── Нормализатор ──────────────────────────────────────────────────────────

/** @param {number|string} messageId */
function onMessageReceived(messageId) {
    if (!option('normalizer')) return;
    const chat = getContext().chat;
    const index = Number(messageId);
    const message = Array.isArray(chat) ? chat[Number.isInteger(index) ? index : chat.length - 1] : null;
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') return;
    const before = message.mes;
    const result = normalizeMachineLayer(before, {
        vocabulary: scan.vocabulary,
        canonicalName: (name) => canonicalCardName(env?.des ?? null, name),
    });
    if (result.unresolved.length) {
        unresolved = [...new Set([...result.unresolved, ...unresolved])].slice(0, UNRESOLVED_LIMIT);
        log.warn(`BunnyMo: теги не по-английски, паки по ним не сработают: ${result.unresolved.join(' ')}`);
    }
    if (result.text !== before) {
        message.mes = result.text;
        if (Array.isArray(message.swipes) && message.swipes[message.swipe_id ?? 0] === before) message.swipes[message.swipe_id ?? 0] = result.text;
        rerenderMessage(Number.isInteger(index) ? index : chat.length - 1);
        normalizedMessages += 1;
        log.info(`BunnyMo: в ответе исправлен машинный слой (${result.changes.length}): ${result.changes.slice(0, 5).join('; ')}${result.changes.length > 5 ? '…' : ''}`);
    }
    notifyChange();
}

/** Регулярки ST «только в промпте», которые срезали бы теги BunnyMo из истории. */
function tagStrippingRegexes() {
    const sample = '<BunnymoTags><Name:Аня>, <SPECIES:ELF></BunnymoTags>';
    return outgoingPromptRegexes().filter(({ regex, replace }) => {
        try {
            return !sample.replace(regex, replace).includes('<SPECIES:ELF>');
        } catch {
            return false;
        }
    }).map(({ name }) => name);
}

// ─── Подписки ──────────────────────────────────────────────────────────────

/**
 * @param {'on'|'makeFirst'|'makeLast'} method
 * @param {string} event
 * @param {(...args: any[]) => unknown} handler
 */
function subscribe(method, event, handler) {
    const safe = (...args) => {
        if (!env) return;
        try {
            return handler(...args);
        } catch (error) {
            log.error(`BunnyMo: сбой в обработчике ${event}`, error);
        }
    };
    getContext().eventSource[method](event, safe);
    subscriptions.push([event, safe]);
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

/** @param {Set<string>} set */
const names = (set) => [...set].map((name) => `«${name}»`).join(', ');

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'BunnyMo';
    const hint = small('desru-dict-hint', 'Что модуль увидел в последнем сканировании лорбуков и что поправил. Файлы лорбуков не меняются — правки живут только в памяти, пока модуль включён.');
    const list = document.createElement('ul');
    list.className = 'desru-merge-list';

    function render() {
        list.replaceChildren();
        const lines = [];
        if (!env) lines.push('Модуль выключен.');
        else if (!scan.at) lines.push('Лорбуки ещё не сканировались — отправь сообщение.');
        else {
            lines.push(scan.core.size ? `Основной лорбук BunnyMo: ${names(scan.core)}.` : 'Основной лорбук BunnyMo в этом чате не подключён.');
            if (scan.packs.size) lines.push(`Паки: ${names(scan.packs)}.`);
            if (scan.marked.size) lines.push(`Архивы и библиотеки CarrotKernel: ${names(scan.marked)}.`);
            const stats = scan.stats;
            if (stats) {
                lines.push(`Правки: детекторов ${stats.detectors}, «анти-клэнкер» ${stats.antiClanker}, без рекурсии ${stats.noRecursion}, архетипы ${stats.archetypes}, ключей архивов ${stats.archiveKeys}.`);
            }
            const vocabularySize = [...scan.vocabulary.values()].reduce((sum, set) => sum + set.size, 0);
            if (vocabularySize) lines.push(`Словарь тегов паков: ${vocabularySize}.`);
            const tags = sceneTags();
            if (tags) lines.push(`Теги сцены для паков (${tags.names.join(', ') || 'без имени'}): ${tags.tags.length}.`);
            if (normalizedMessages) lines.push(`Ответов с исправленным машинным слоем: ${normalizedMessages}.`);
            if (unresolved.length) lines.push(`Теги не по-английски (паки по ним не сработают): ${unresolved.join(' ')}`);
        }
        for (const line of lines) list.append(Object.assign(document.createElement('li'), { textContent: line }));
    }

    section.append(summary, hint, list);
    render();
    changeListeners.add(render);
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'bunnymo',
    number: 5,
    title: 'BunnyMo по-русски',
    description: 'Чтобы BunnyMo и его паки полноценно работали в русской игре: языковой замок, русские ключи детекторов, падежи в архивах, нормализатор листов, паки по тегам персонажей. Лорбуки не меняются.',
    needs: { ui: false, data: false },
    options: OPTIONS,
    section: 'bunnymo',
    mountSection,
    enable(environment) {
        env = environment;
        const { eventTypes } = getContext();
        subscribe('on', eventTypes.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
        subscribe('on', eventTypes.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
        // Раньше всех: сбросить признак «BunnyMo сработал» и обновить вставки до сканирования лорбуков.
        subscribe('makeFirst', eventTypes.GENERATION_STARTED, onGenerationStarted);
        // Раньше DES и CK: они разбирают лист из этого же ответа.
        subscribe('makeFirst', eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        subscribe('on', eventTypes.CHAT_CHANGED, () => {
            unresolved = [];
            setSceneTags();
            notifyChange();
        });
        setLanguageLock();
        setSceneTags();
        notifyChange();
        log.info('Модуль 5 (BunnyMo) включён.');
    },
    disable() {
        const { eventSource } = getContext();
        for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
        subscriptions = [];
        clearSlots();
        env = null;
        notifyChange();
        log.info('Модуль 5 (BunnyMo) выключен: правки лорбуков снимутся со следующего сканирования.');
    },
    notes() {
        const notes = [];
        const stripping = tagStrippingRegexes();
        if (stripping.length && bunnyWorlds().size) {
            notes.push({ level: 'warn', text: `Регулярка ST ${stripping.map((name) => `«${name}»`).join(', ')} вырезает теги <…> из ответов в промпте: модель не видит теги BunnyMo в прошлых листах. Паки и CarrotKernel работают (лорбуки сканируют чат без регулярок), но для BunnyMo лучше исключить из неё теги вида <KEY:VALUE>.` });
        }
        if (scan.at && !bunnyWorlds().size) {
            notes.push({ level: 'info', text: 'BunnyMo в подключённых к этому чату лорбуках не найден — модулю пока нечего делать.' });
        }
        if (unresolved.length) {
            notes.push({ level: 'warn', text: `Модель написала теги не по-английски, паки по ним не сработают: ${unresolved.slice(0, 5).join(' ')}${unresolved.length > 5 ? '…' : ''}` });
        }
        return notes;
    },
};
