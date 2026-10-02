/**
 * Модуль 5. BunnyMo по-русски.
 *
 * BunnyMo — набор лорбуков с английскими инструкциями и тегами. В русской игре он ломается в трёх местах:
 * ключи не видят русскую прозу (и срабатывают на тексте самого BunnyMo), листы выходят английскими или с
 * переведёнными тегами, паки с запретом рекурсии не достать из архивов персонажей. Модуль чинит это снаружи:
 *
 * 1. Языковой замок — короткая системная вставка, пока в генерации участвуют записи BunnyMo или вставки
 *    CarrotKernel: проза по-русски, машинный слой (теги, SECTION N/M, Name) по-английски. Только в обычных
 *    генерациях: фоновые (quiet — промпт картинки, классификация эмоций, саммари, /gen) идут без него.
 * 2. Правки записей на лету (WORLDINFO_ENTRIES_LOADED, файлы лорбуков не меняются): русские ключи детекторов
 *    и «анти-клэнкера», детекторы — только по тексту чата, архетипы с невидимой строкой, ключи архивов со
 *    всеми падежами имени.
 * 3. Нормализатор ответа (MESSAGE_RECEIVED, раньше DES и CK): переведённые служебные токены — обратно.
 * 4. Теги персонажей сцены — во вставку «только для сканирования»: паки срабатывают и с запретом рекурсии.
 */
import { PROMPT_POSITION, PROMPT_ROLE, getContext, outgoingPromptRegexes, rerenderMessage } from '../st.js';
import { log } from '../log.js';
import { getSettings } from '../settings.js';
import { BUNNYMO_ENTRIES, archiveNameWords, archiveTags, classifyWorlds, isCharacterArchive, packVocabulary } from '../bunnymo-adapter.js';
import { ckMarkedBooks, hasCkSlots } from '../ck-adapter.js';
import { canonicalCardName } from '../name-context.js';
import { normalizeMachineLayer } from '../lib/bunnymo-normalize.js';
import { archiveFormsOf, patchEntries } from '../lib/bunnymo-patch.js';
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
        description: 'Пока в генерации участвует BunnyMo или CarrotKernel, модели напоминают: проза и листы — по-русски, теги, «SECTION N/M» и «Name» — по-английски, имя — как на карточке. Фоновые запросы (промпт картинки, эмоции, саммари, /gen) идут без замка.',
    },
    {
        key: 'detectors',
        title: 'Детекторы на русском',
        description: 'Автодетекторы BunnyMo (ревность, паника, флирт…) получают русские ключи и срабатывают только на тексте чата — не на тексте самого BunnyMo и не на тегах персонажей (<JEALOUSY:POSSESSIVE>).',
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
        description: 'Кириллические ключи архивов персонажей («Аня») срабатывают на «Ани», «Аней» и не срабатывают в «Таня». Формы, которые сами — чужие имена («Александра» у Александра, «Яна» у Яна), не берутся.',
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
/**
 * Начатые генерации, последняя — в конце: фоновая ли (quiet или пробная сборка промпта — без замка и тегов
 * сцены) и есть ли у неё quiet_prompt. Генерации вкладываются: расширение может запустить фоновую из
 * перехватчика обычной, и та начнётся и закончится до сканирования лорбуков обычной.
 * @type {{ quiet: boolean, prompted: boolean }[]}
 */
let generations = [];
const GENERATIONS_KEPT = 8;
/** Слот ST с quiet_prompt текущей генерации: ST заполняет его только на время сканирования лорбуков (inject_ids.QUIET_PROMPT). */
const ST_QUIET_PROMPT_SLOT = 'QUIET_PROMPT';
/**
 * Обработчик WORLD_INFO_ACTIVATED в обёртке subscribe: перед каждой генерацией снова ставим его последним.
 * @type {((...args: any[]) => unknown)|null}
 */
let worldInfoHandler = null;
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
    const archives = new Set(entries.filter((entry) => repos.has(entry?.world) || isCharacterArchive(entry)));
    scan.stats = patchEntries(lists, {
        detectors: option('detectors'),
        antiClanker: option('antiClanker'),
        archetypes: option('archetypes'),
        archiveKeys: option('archiveKeys'),
    }, BUNNYMO_ENTRIES, {
        isArchive: (entry) => archives.has(entry),
        // Без форм, которые сами — имена: «Александра» не включает архив Александра, «Петрова» — архив Петрова.
        formsOf: archiveFormsOf((word) => wordForms(word, { genitive: true }), archiveNameWords(archives)),
    });
    const firstTime = !scan.at;
    scan.at = Date.now();
    if (firstTime && worlds.size) log.info(`BunnyMo: в сканировании лорбуки ${[...worlds].map((world) => `«${world}»`).join(', ')}.`);
    notifyChange();
}

/**
 * После сканирования лорбуков, до сборки промпта: ST шлёт событие, только если что-то сработало (и не в пробной
 * сборке). Обработчик стоит последним — вставки CK к этому моменту уже записаны.
 * @param {any[]} entryList записи, которые ST включил в этой генерации
 */
function onWorldInfoActivated(entryList) {
    if (scanIsQuiet() || !Array.isArray(entryList) || !entryList.length) return;
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
    if (lockWanted()) setLanguageLock(LANGUAGE_LOCK_RU);
    notifyChange();
}

// ─── Вставки ───────────────────────────────────────────────────────────────

/**
 * Идёт ли сейчас сканирование лорбуков фоновой генерации. ST кладёт quiet_prompt генерации в свой слот только на
 * время сканирования, поэтому сканирование относим к последней начатой генерации, у которой quiet_prompt есть
 * (или нет) так же: обычная генерация после вложенной фоновой — снова обычная. Генерацию не видели (модуль
 * включили посреди неё) — фоновая, если у неё есть quiet_prompt.
 */
function scanIsQuiet() {
    const prompted = Boolean(getContext().extensionPrompts?.[ST_QUIET_PROMPT_SLOT]?.value);
    for (let index = generations.length - 1; index >= 0; index -= 1) {
        if (generations[index].prompted === prompted) return generations[index].quiet;
    }
    return prompted;
}

/** Замок — запасная проверка: в этой генерации участвуют BunnyMo или вставки CK. */
function lockWanted() {
    return Boolean(env) && option('languageLock') && (activeNow || hasCkSlots());
}

/**
 * Языковой замок. Фильтр ST 1.19 для вставок в чат не работает (getExtensionPrompt передаёт async-функцию
 * в Array.filter, и Promise всегда «истина»), поэтому текст лежит в слоте только от сканирования лорбуков
 * обычной генерации до её конца, а в остальное время слот пуст. Фильтр — запасная проверка для тех мест ST,
 * где он работает.
 * @param {string} value
 */
function setLanguageLock(value) {
    const { setExtensionPrompt } = getContext();
    setExtensionPrompt(SLOTS.lock, value, PROMPT_POSITION.IN_CHAT, 0, false, PROMPT_ROLE.SYSTEM, lockWanted);
}

/**
 * Теги персонажей прошлой генерации — во вставку, которую ST только сканирует, но не отправляет. Фоновым
 * генерациям и пробным сборкам — пусто: фильтр вставок для сканирования ST проверяет в момент сканирования.
 */
function setSceneTags() {
    const { setExtensionPrompt } = getContext();
    const entry = sceneTags();
    const value = option('packTags') && entry?.tags.length ? entry.tags.join(' ') : '';
    setExtensionPrompt(SLOTS.tags, value, PROMPT_POSITION.NONE, 0, true, PROMPT_ROLE.SYSTEM,
        () => Boolean(env) && option('packTags') && !scanIsQuiet());
}

/**
 * Раньше всех: запомнить генерацию, убрать замок до сканирования лорбуков, обновить теги сцены и поставить
 * обработчик WORLD_INFO_ACTIVATED последним — после CK, который пишет там свою вставку.
 * @param {string} type тип генерации ST: normal, swipe, regenerate, continue, impersonate, quiet…
 * @param {{ quiet_prompt?: string }} [options]
 * @param {boolean} [dryRun] пробная сборка промпта (подсчёт токенов) — модель её не получает
 */
function onGenerationStarted(type, options, dryRun) {
    generations = [...generations, { quiet: type === 'quiet' || dryRun === true, prompted: Boolean(options?.quiet_prompt) }]
        .slice(-GENERATIONS_KEPT);
    activeNow = false;
    setLanguageLock('');
    setSceneTags();
    if (worldInfoHandler) getContext().eventSource.makeLast(getContext().eventTypes.WORLD_INFO_ACTIVATED, worldInfoHandler);
}

/** Генерация закончилась, остановлена или сменился чат: замок не должен попасть в чужую генерацию. */
function onGenerationOver() {
    activeNow = false;
    setLanguageLock('');
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
        log.warn(`BunnyMo: паки по этим тегам не сработают (не по-английски или такого значения нет в подключённых паках): ${result.unresolved.join(' ')}`);
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
 * @returns {(...args: any[]) => unknown} обёртка, под которой обработчик подписан
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
    return safe;
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
            if (unresolved.length) lines.push(`Теги, по которым паки не сработают (не по-английски или такого значения нет в подключённых паках): ${unresolved.join(' ')}`);
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
        generations = [];
        const { eventTypes } = getContext();
        subscribe('on', eventTypes.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
        // Последним: замок смотрит на вставки CK, а CK пишет их в своём обработчике этого же события.
        worldInfoHandler = subscribe('makeLast', eventTypes.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
        // Раньше всех: запомнить генерацию и убрать замок до сканирования лорбуков.
        subscribe('makeFirst', eventTypes.GENERATION_STARTED, onGenerationStarted);
        subscribe('on', eventTypes.GENERATION_ENDED, onGenerationOver);
        subscribe('on', eventTypes.GENERATION_STOPPED, onGenerationOver);
        // Раньше DES и CK: они разбирают лист из этого же ответа.
        subscribe('makeFirst', eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        subscribe('on', eventTypes.CHAT_CHANGED, () => {
            onGenerationOver();
            unresolved = [];
            setSceneTags();
            notifyChange();
        });
        setLanguageLock('');
        setSceneTags();
        notifyChange();
        log.info('Модуль 5 (BunnyMo) включён.');
    },
    disable() {
        const { eventSource } = getContext();
        for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
        subscriptions = [];
        worldInfoHandler = null;
        generations = [];
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
            notes.push({ level: 'warn', text: `Паки не сработают по тегам из ответов (не по-английски или такого значения нет в подключённых паках): ${unresolved.slice(0, 5).join(' ')}${unresolved.length > 5 ? '…' : ''}` });
        }
        return notes;
    },
};
