/**
 * Модуль 4. Исправления DES для русского ролеплея (§11 docs/des-recon.md).
 * Каждое исправление — отдельный переключатель; выключение модуля снимает все обработчики.
 *
 * 1. Кириллические названия полей персонажа: DES строит из них пустые ключи `""` в шаблоне трекера.
 *    Сразу после того, как DES запишет инструкцию (GENERATION_STARTED), возвращаем названия.
 * 2. «Не в сцене» по-русски: детектор DES понимает только английские пометки. Помечаем такие мысли
 *    пометкой, которую DES понимает, — дальше он сам покажет персонажа отсутствующим.
 * 3. «Нет» вместо квеста: DES прячет квест только при значении «None». Приводим к нему.
 * 4. Переводы встроенного переводчика: на каждой смене чата DES стирает `extra.display_text`.
 *    Прячем переводы на время его очистки и возвращаем, ничего не перерисовывая.
 */
import { getContext } from '../st.js';
import { log } from '../log.js';
import { DES_KEYS, DES_TIMING, DES_VALUES, desDetailKey, desSceneFieldKey, hasDesOffSceneMarker } from '../des-adapter.js';
import { restoreDetailKeys } from '../lib/field-keys.js';
import { findRussianOffScene, isRussianNoQuest } from '../lib/russian-markers.js';
import { markOffScene, normalizeNoQuest } from '../lib/tracker-fixes.js';

/** Окно скрытия переводов, после которого стоит пересохранить чат: отложенное сохранение DES могло успеть. */
const LONG_HIDE_FRAMES = 30;

const OPTIONS = [
    {
        key: 'fieldKeys',
        title: 'Кириллические названия полей персонажа',
        description: 'DES превращает «Внешность», «Поведение» и подобные названия в пустые ключи "", и модель получает сломанный шаблон. Возвращаем названия в шаблон трекера (режим together).',
    },
    {
        key: 'offScene',
        title: '«Не в сцене» по-русски',
        description: 'Если в мыслях персонажа написано «не присутствует в сцене», «вне сцены» или «за кадром», DES покажет его отсутствующим — как с английскими пометками.',
    },
    {
        key: 'noQuest',
        title: '«Нет» вместо квеста',
        description: '«Нет», «Отсутствует», «—» DES принимает за название квеста. Превращаем их в служебное «квеста нет».',
    },
    {
        key: 'keepTranslations',
        title: 'Не давать DES стирать переводы',
        description: 'При смене чата DES стирает переводы встроенного переводчика ST. Прячем их на время его очистки и возвращаем.',
    },
];

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {Array<[string, (...args: any[]) => unknown]>} */
let subscriptions = [];
const loggedOnce = new Set();
/** @type {{ stash: Map<any, string>, frames: number } | null} */
let hiddenTranslations = null;

/** @param {string} key */
function option(key) {
    return env?.settings.modules.fixes?.[key] !== false;
}

/** @param {string} key @param {'info'|'warn'} level @param {string} message */
function logOnce(key, level, message) {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    log[level](message);
}

/** @param {string[]} names */
function quoteList(names) {
    return names.map((name) => `«${name}»`).join(', ');
}

function isTogetherMode() {
    return env?.des?.generationMode() === DES_KEYS.togetherMode;
}

/**
 * @param {'on'|'makeFirst'|'makeLast'} method
 * @param {string} event
 * @param {(...args: any[]) => unknown} handler
 */
function subscribe(method, event, handler) {
    const safe = (...args) => {
        if (!env?.des) return;
        try {
            return handler(...args);
        } catch (error) {
            log.error(`Исправления: сбой в обработчике ${event}`, error);
        }
    };
    getContext().eventSource[method](event, safe);
    subscriptions.push([event, safe]);
}

// ─── 1. Кириллические названия полей персонажа ─────────────────────────────

/** Названия включённых полей персонажа, из которых DES построит пустой ключ. */
function cyrillicCharacterFields() {
    return env.des.characterFields().map((field) => String(field.name)).filter((name) => desDetailKey(name) === '');
}

function restoreFieldKeysInPrompt() {
    if (!option('fieldKeys')) return;
    const names = cyrillicCharacterFields();
    if (!names.length) return;
    const slot = env.des.trackerInstructionSlot();
    if (!slot?.value) return;
    const result = restoreDetailKeys(slot.value, names);
    if (result.replaced) {
        slot.value = result.text;
        log.debug(`Исправления: названия полей возвращены в шаблон (${result.replaced})`);
        logOnce('fieldKeys:ok', 'info', `Исправления: в шаблон трекера возвращены названия полей ${quoteList(names)}.`);
    } else if (result.reason) {
        logOnce(`fieldKeys:${result.reason}`, 'warn', `Исправления: не удалось вернуть названия полей в шаблон — ${result.reason}.`);
    }
}

// ─── 2–3. «Не в сцене» и «Нет» вместо квеста ───────────────────────────────

/**
 * Правит то, что DES только что разобрал или загрузил. Повторный вызов ничего не меняет.
 * @param {{ persist: boolean }} options `persist` — свежая генерация: записать и в swipe-данные сообщения
 */
function fixTrackerData({ persist }) {
    const des = env.des;
    const data = des.tracker.read();
    /** @type {Partial<import('../des-adapter.js').TrackerStrings>} */
    const patch = {};
    const notes = [];

    if (option('offScene') && data.characterThoughts) {
        const result = markOffScene(data.characterThoughts, {
            marker: DES_VALUES.offSceneMarker,
            find: findRussianOffScene,
            alreadyMarked: hasDesOffSceneMarker,
        });
        if (result.marked.length) {
            patch.characterThoughts = result.text;
            for (const { name, phrase } of result.marked) notes.push(`${name}: «${phrase}» — не в сцене`);
        }
    }
    if (option('noQuest') && data.quests) {
        const result = normalizeNoQuest(data.quests, { none: DES_VALUES.noQuest, isNone: isRussianNoQuest });
        if (result.changed.length) {
            patch.quests = result.text;
            for (const title of result.changed) notes.push(`квест «${title}» — квеста нет`);
        }
    }
    if (!Object.keys(patch).length) return;

    des.tracker.write(patch, { messageIndex: persist ? des.tracker.lastAssistantIndex() : null });
    if (patch.quests) des.parseQuests(patch.quests);
    if (persist) des.saveChat();
    des.rerender();
    for (const note of notes) {
        if (persist) log.info(`Исправления: ${note}`);
        else log.debug(`Исправления (в памяти): ${note}`);
    }
}

function onFreshTogetherReply() {
    if (isTogetherMode()) fixTrackerData({ persist: true });
}

// ─── 4. Переводы встроенного переводчика ───────────────────────────────────

/** До очистки DES: убираем `display_text` из сообщений и запоминаем его. */
function hideTranslationsFromDes() {
    showHiddenTranslations();
    if (!option('keepTranslations')) return;
    const chat = getContext().chat;
    if (!Array.isArray(chat) || !chat.length) return;
    const stash = new Map();
    for (const message of chat) {
        if (!message || message.is_user || !message.extra || message.extra.display_text === undefined) continue;
        stash.set(message, message.extra.display_text);
        delete message.extra.display_text;
    }
    if (!stash.size) return;
    hiddenTranslations = { stash, frames: Math.ceil(chat.length / DES_TIMING.displayTextCleanupChunk) + 2 };
    // Кадры не идут в скрытой вкладке; если страницу закроют посреди окна, переводы должны успеть вернуться.
    window.addEventListener('pagehide', showHiddenTranslations);
    log.debug(`Исправления: переводы ${stash.size} сообщ. спрятаны от очистки DES на ${hiddenTranslations.frames} кадр.`);
}

/**
 * После обработчиков DES: его очистка идёт по кадрам, наш отсчёт стартует позже и длится дольше,
 * поэтому переводы вернутся уже после последнего прохода DES.
 */
function scheduleTranslationReturn() {
    const job = hiddenTranslations;
    if (!job) return;
    let frames = job.frames;
    const tick = () => {
        if (hiddenTranslations !== job) return;
        frames -= 1;
        if (frames > 0) requestAnimationFrame(tick);
        else showHiddenTranslations();
    };
    requestAnimationFrame(tick);
}

function showHiddenTranslations() {
    const job = hiddenTranslations;
    hiddenTranslations = null;
    window.removeEventListener('pagehide', showHiddenTranslations);
    if (!job) return;
    let restored = 0;
    for (const [message, text] of job.stash) {
        if (!message.extra || message.extra.display_text !== undefined) continue;
        message.extra.display_text = text;
        restored += 1;
    }
    if (!restored) return;
    log.debug(`Исправления: переводы ${restored} сообщ. возвращены.`);
    logOnce('translations:ok', 'info', 'Исправления: переводы встроенного переводчика защищены от очистки DES.');
    if (job.frames > LONG_HIDE_FRAMES) {
        // В длинном чате окно скрытия дольше отложенного сохранения: сохраняем, чтобы переводы точно были в файле.
        Promise.resolve(getContext().saveChatConditional?.()).catch((error) => log.warn('Исправления: не удалось пересохранить чат', error));
    }
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'fixes',
    number: 4,
    title: 'Исправления DES для русского',
    description: 'Обходит места, где DES ломается на русском. Каждое исправление включается отдельно.',
    needs: { ui: true, data: true },
    options: OPTIONS,
    enable(environment) {
        env = environment;
        const { eventTypes } = getContext();
        // DES пишет инструкцию трекера в своём обработчике GENERATION_STARTED — правим сразу после него.
        subscribe('makeLast', eventTypes.GENERATION_STARTED, restoreFieldKeysInPrompt);
        // Режим together: DES разбирает ответ в MESSAGE_RECEIVED; CHARACTER_MESSAGE_RENDERED — страховка порядка.
        subscribe('makeLast', eventTypes.MESSAGE_RECEIVED, onFreshTogetherReply);
        subscribe('makeFirst', eventTypes.CHARACTER_MESSAGE_RENDERED, onFreshTogetherReply);
        // Режимы separate/external: DES сообщает о готовом трекере своим событием.
        subscribe('on', DES_KEYS.updateCompleteEvent, () => fixTrackerData({ persist: true }));
        // Свайп и смена чата: DES загружает сохранённые данные — правим только в памяти.
        subscribe('makeLast', eventTypes.MESSAGE_SWIPED, () => fixTrackerData({ persist: false }));
        subscribe('makeFirst', eventTypes.CHAT_CHANGED, hideTranslationsFromDes);
        subscribe('makeLast', eventTypes.CHAT_CHANGED, () => {
            scheduleTranslationReturn();
            fixTrackerData({ persist: false });
        });
        try {
            fixTrackerData({ persist: false });
        } catch (error) {
            log.warn('Исправления: не удалось поправить уже загруженный трекер', error);
        }
        log.info('Модуль 4 (исправления) включён.');
    },
    disable() {
        const { eventSource } = getContext();
        for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
        subscriptions = [];
        showHiddenTranslations();
        env = null;
        log.info('Модуль 4 (исправления) выключен.');
    },
    /** Замечания для панели: что исправляется и что снаружи не исправить. */
    notes() {
        if (!env?.des) return [];
        const notes = [];
        const fields = cyrillicCharacterFields();
        if (option('fieldKeys') && fields.length) {
            notes.push(isTogetherMode()
                ? { level: 'info', text: `Поля персонажа ${quoteList(fields)}: названия возвращаются в шаблон трекера.` }
                : { level: 'warn', text: `Режим генерации DES — «${env.des.generationMode()}»: поля ${quoteList(fields)} исправляются только в режиме together. В других режимах назови их латиницей.` });
        }
        const sceneFields = env.des.sceneFields().map((field) => String(field.name)).filter((name) => desSceneFieldKey(name) === '');
        if (sceneFields.length) {
            notes.push({ level: 'warn', text: `Поля сцены ${quoteList(sceneFields)} DES молча выкидывает из-за кириллицы в названии, снаружи это не исправить. Назови их латиницей; русскую подпись можно будет задать в словаре модуля 1.` });
        }
        return notes;
    },
};
