/**
 * Модуль 2. Падежные формы имён → алиасы DES.
 *
 * Модель иногда пишет в трекере имя в падеже из текста («Ани», «Аней»), и DES заводит дубль карточки.
 * В режиме together ответ приходит в MESSAGE_RECEIVED: раньше DES (makeFirst) достаём из него имена
 * тем же разбором, что сделает DES, сверяем с карточками и дописываем форму алиасом. Явный алиас DES
 * проверяет первым, поэтому дальше он сам подставит имя карточки: без дубля и без попапа.
 * В режимах separate/external точки до разбора нет — там модуль не работает (решение §12.1 разведки).
 *
 * Каждая склейка пишется в журнал; «разъединить» убирает алиас и запоминает пару, чтобы не склеить снова.
 * Прошлые ответы уже записаны под именем карточки — разделяются только следующие.
 */
import { getContext, notify } from '../st.js';
import { log } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { DES_KEYS, desCharacterNameField, desNameKey } from '../des-adapter.js';
import { decideName, findCaseDuplicates, normalizeRussianName } from '../lib/russian-names.js';
import { NAME_INSTRUCTION_RU, replaceExact } from '../lib/service-prompt.js';
import { menuButton } from '../ui.js';

/** Сколько склеек держим в журнале. */
const JOURNAL_LIMIT = 200;
const MODE_NAMES = Object.freeze({ together: 'Вместе с ответом', separate: 'Отдельным запросом', external: 'Внешний API' });

const OPTIONS = [
    {
        key: 'aliasForms',
        title: 'Падежные формы → алиасы DES',
        description: '«Ани», «Аней», «аня» в трекере дописываются алиасами к карточке «Аня», и DES не заводит дубль. Только режим «Вместе с ответом».',
    },
    {
        key: 'nominativePrompt',
        title: 'Имена в именительном падеже в промпте',
        description: 'В шаблоне трекера просим писать имя персонажа ровно как на его карточке. Режим «Вместе с ответом».',
    },
];

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {Array<[string, (...args: any[]) => unknown]>} */
let subscriptions = [];
const loggedOnce = new Set();
/** @type {Set<() => void>} */
const changeListeners = new Set();

function moduleSettings() {
    return getSettings().modules.names;
}

/** @param {string} key */
function option(key) {
    return moduleSettings()?.[key] !== false;
}

/** @param {string} key @param {'info'|'warn'} level @param {string} message */
function logOnce(key, level, message) {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    log[level](message);
}

function notifyChange() {
    for (const listener of changeListeners) {
        try {
            listener();
        } catch (error) {
            log.warn('Имена: панель не обновилась', error);
        }
    }
}

function isTogetherMode() {
    return env?.des?.generationMode() === DES_KEYS.togetherMode;
}

/** @param {{ variant: string, canonical: string }} pair */
function pairKey(pair) {
    return `${normalizeRussianName(pair.variant)}|${normalizeRussianName(pair.canonical)}`;
}

/** @param {unknown} list */
function asArray(list) {
    return Array.isArray(list) ? list : [];
}

// ─── Склейка ───────────────────────────────────────────────────────────────

/** @returns {import('../lib/russian-names.js').NameContext} */
function buildContext() {
    const { npc, users } = env.des.names.cards();
    /** @type {Map<string, string[]>} */
    const cardKeys = new Map();
    for (const name of [...users, ...npc]) {
        const key = desNameKey(name);
        cardKeys.set(key, [...(cardKeys.get(key) ?? []), name]);
    }
    const aliasKeys = new Set(Object.values(env.des.names.aliases()).flat().map((alias) => alias.trim().toLowerCase()));
    const settings = moduleSettings();
    const exceptions = new Set(asArray(settings.exceptions).map(normalizeRussianName));
    const unmerged = new Set(asArray(settings.unmerged).map(pairKey));
    return {
        npcCards: npc,
        keyOf: desNameKey,
        cardKeys,
        isAlias: (name) => aliasKeys.has(name.trim().toLowerCase()),
        excluded(variant, canonical) {
            if (exceptions.has(normalizeRussianName(variant)) || exceptions.has(normalizeRussianName(canonical))) return 'в исключениях';
            if (unmerged.has(pairKey({ variant, canonical }))) return 'разъединено вручную';
            if (env.des.names.dismissedByDes(variant, canonical)) return 'в попапе DES ответили «Нет»';
            return null;
        },
    };
}

/** @param {string} variant @param {string} canonical */
function recordMerge(variant, canonical) {
    const settings = moduleSettings();
    const journal = asArray(settings.journal).filter((entry) => pairKey(entry) !== pairKey({ variant, canonical }));
    journal.push({ variant, canonical, at: Date.now() });
    settings.journal = journal.slice(-JOURNAL_LIMIT);
}

/** Ответ модели пришёл (together): до разбора DES дописываем падежные формы алиасами. */
function onReplyReceived() {
    if (!isTogetherMode() || !option('aliasForms')) return;
    const chat = getContext().chat;
    // DES берёт для трекера последнее сообщение — смотрим туда же.
    const message = Array.isArray(chat) ? chat[chat.length - 1] : null;
    if (!message || message.is_user || typeof message.mes !== 'string') return;
    const names = env.des.names.fromReply(message.mes);
    if (!names.length) return;
    const context = buildContext();
    let added = 0;
    for (const name of names) {
        const decision = decideName(name, context);
        if (decision.action !== 'alias') {
            if (decision.candidates) log.debug(`Имена: «${name}» подходит нескольким карточкам (${decision.candidates.join(', ')}) — не склеиваю.`);
            continue;
        }
        if (!env.des.names.addAlias(decision.canonical, name)) continue;
        added += 1;
        recordMerge(name, decision.canonical);
        log.info(`Имена: «${name}» → «${decision.canonical}» (алиас DES).`);
    }
    if (!added) return;
    env.des.names.save();
    saveSettings();
    notifyChange();
}

/** Сразу после того, как DES запишет инструкцию трекера (GENERATION_STARTED), просим именительный падеж. */
function rewriteNamePlaceholder() {
    if (!isTogetherMode() || !option('nominativePrompt')) return;
    const slot = env.des.trackerInstructionSlot();
    if (!slot?.value) return;
    // Фоновые генерации тоже шлют GENERATION_STARTED, а DES переписывает слот не на каждой: правка уже может стоять.
    if (slot.value.includes(desCharacterNameField(NAME_INSTRUCTION_RU))) return;
    const result = replaceExact(slot.value, desCharacterNameField(), desCharacterNameField(NAME_INSTRUCTION_RU));
    if (!result.replaced) {
        logOnce('prompt:name', 'warn', 'Имена: в шаблоне трекера нет штатного поля имени DES — оставляю как есть.');
        return;
    }
    slot.value = result.text;
    logOnce('prompt:ok', 'info', 'Имена: в шаблоне трекера модель просят писать имя как на карточке.');
}

/**
 * Разъединить: убрать алиас из DES и запомнить пару. Прошлые ответы остаются под именем карточки.
 * @param {{ variant: string, canonical: string }} entry
 */
function unmerge(entry) {
    if (!env?.des) {
        notify('error', 'Модуль 2 не работает — алиасы DES сейчас недоступны.');
        return;
    }
    const removed = env.des.names.removeAlias(entry.canonical, entry.variant);
    if (removed) env.des.names.save();
    const settings = moduleSettings();
    settings.journal = asArray(settings.journal).filter((item) => pairKey(item) !== pairKey(entry));
    if (!asArray(settings.unmerged).some((item) => pairKey(item) === pairKey(entry))) {
        settings.unmerged = [...asArray(settings.unmerged), { variant: entry.variant, canonical: entry.canonical }];
    }
    saveSettings();
    log.info(`Имена: «${entry.variant}» отделено от «${entry.canonical}»${removed ? '' : ' (алиаса в DES уже не было)'}.`);
    notify('success', `«${entry.variant}» больше не склеивается с «${entry.canonical}». Прошлые ответы остаются под «${entry.canonical}».`);
    notifyChange();
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
            log.error(`Имена: сбой в обработчике ${event}`, error);
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

/** @param {number} at */
function formatDate(at) {
    return new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** @param {unknown} text */
function parseNameList(text) {
    return [...new Set(String(text ?? '').split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean))];
}

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'Склейки имён';
    const hint = small('desru-dict-hint', 'Падежные формы, которые модель пишет в трекере («Ани», «Аней»), дописываются алиасами к карточке («Аня») — их видно и в Workshop DES. '
        + '«Разъединить» убирает алиас; прошлые ответы остаются под именем карточки, разделяются только следующие.');

    const list = document.createElement('ul');
    list.className = 'desru-merge-list';
    const unmergedLine = small('desru-dict-hint');
    const forgetButton = menuButton('fa-eraser', 'Забыть разъединённые пары', () => {
        moduleSettings().unmerged = [];
        saveSettings();
        renderList();
    });

    const exceptionsLabel = small('desru-dict-hint', 'Не склеивать (имена через запятую или с новой строки) — например, когда «Ани» и «Аня» правда разные персонажи:');
    const exceptions = document.createElement('textarea');
    exceptions.className = 'text_pole desru-dict-editor';
    exceptions.rows = 2;
    exceptions.spellcheck = false;
    const saveExceptions = menuButton('fa-floppy-disk', 'Сохранить исключения', () => {
        moduleSettings().exceptions = parseNameList(exceptions.value);
        saveSettings();
        exceptions.value = moduleSettings().exceptions.join(', ');
        notify('success', 'Исключения сохранены');
        runTest();
    });

    const tester = document.createElement('input');
    tester.type = 'text';
    tester.className = 'text_pole';
    tester.placeholder = 'Проверить имя из трекера, например «Аней»';
    const testResult = small('desru-dict-hint');
    function runTest() {
        const name = tester.value.trim();
        if (!name) {
            testResult.textContent = '';
            return;
        }
        if (!env?.des) {
            testResult.textContent = 'Модуль не работает — проверить не на чем.';
            return;
        }
        const decision = decideName(name, buildContext());
        testResult.textContent = decision.action === 'alias'
            ? `«${name}» → алиас к «${decision.canonical}».`
            : `«${name}» не склеится: ${decision.reason}${decision.candidates ? ` (${decision.candidates.join(', ')})` : ''}.`;
    }
    tester.addEventListener('input', runTest);

    function renderList() {
        const settings = moduleSettings();
        const aliases = env?.des ? env.des.names.aliases() : null;
        const journal = asArray(settings.journal).slice().reverse();
        list.replaceChildren();
        if (!journal.length) list.append(Object.assign(document.createElement('li'), { textContent: 'Склеек пока нет.' }));
        for (const entry of journal) {
            const item = document.createElement('li');
            const text = document.createElement('span');
            const gone = aliases && !asArray(aliases[entry.canonical]).some((alias) => alias.toLowerCase() === String(entry.variant).toLowerCase());
            text.textContent = `«${entry.variant}» → «${entry.canonical}» · ${formatDate(entry.at)}${gone ? ' · алиаса в DES уже нет' : ''}`;
            const button = menuButton('fa-link-slash', 'Разъединить', () => unmerge(entry));
            item.append(text, button);
            list.append(item);
        }
        const unmerged = asArray(settings.unmerged);
        unmergedLine.textContent = unmerged.length
            ? `Разъединены и больше не склеиваются: ${unmerged.map((pair) => `«${pair.variant}» ↛ «${pair.canonical}»`).join(', ')}.`
            : '';
        forgetButton.style.display = unmerged.length ? '' : 'none';
        exceptions.value = asArray(settings.exceptions).join(', ');
    }

    section.append(summary, hint, list, unmergedLine, forgetButton, exceptionsLabel, exceptions, saveExceptions, tester, testResult);
    renderList();
    changeListeners.add(() => {
        renderList();
        runTest();
    });
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'names',
    number: 2,
    title: 'Нормализация имён',
    description: 'Не даёт DES плодить дубли карточек из-за падежей («Аня», «Ани», «Аней»): дописывает формы в алиасы DES. Каждая склейка записывается и отменяется.',
    needs: { ui: true, data: true },
    options: OPTIONS,
    section: 'names',
    mountSection,
    enable(environment) {
        env = environment;
        const { eventTypes } = getContext();
        // DES разбирает ответ в своём MESSAGE_RECEIVED — наш алиас должен появиться раньше.
        subscribe('makeFirst', eventTypes.MESSAGE_RECEIVED, onReplyReceived);
        // DES пишет инструкцию трекера в своём GENERATION_STARTED — правим сразу после него.
        subscribe('makeLast', eventTypes.GENERATION_STARTED, rewriteNamePlaceholder);
        notifyChange();
        log.info('Модуль 2 (имена) включён.');
    },
    disable() {
        const { eventSource } = getContext();
        for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
        subscriptions = [];
        env = null;
        notifyChange();
        log.info('Модуль 2 (имена) выключен.');
    },
    /** Замечания для панели: режим, дубли из прошлых ответов, сколько склеено. */
    notes() {
        if (!env?.des) return [];
        const notes = [];
        const mode = env.des.generationMode();
        if (mode !== DES_KEYS.togetherMode) {
            notes.push({ level: 'warn', text: `Режим генерации DES — «${MODE_NAMES[mode] ?? mode}»: модуль 2 работает только в режиме «Вместе с ответом». В этом режиме о похожих именах спрашивает попап DES.` });
        }
        const exceptions = new Set(asArray(moduleSettings().exceptions).map(normalizeRussianName));
        const duplicates = findCaseDuplicates(env.des.names.cards().npc)
            .filter((pair) => !exceptions.has(normalizeRussianName(pair.variant)) && !exceptions.has(normalizeRussianName(pair.canonical)));
        if (duplicates.length) {
            const shown = duplicates.slice(0, 5).map((pair) => `«${pair.variant}» и «${pair.canonical}»`).join(', ');
            notes.push({ level: 'warn', text: `Похоже на дубли из прошлых ответов: ${shown}${duplicates.length > 5 ? ' и другие' : ''}. Модуль склеивает только новые имена; старые можно объединить в каталоге персонажей DES.` });
        }
        const merged = asArray(moduleSettings().journal).length;
        if (merged) notes.push({ level: 'info', text: `Склеено форм: ${merged} — список в разделе «Склейки имён».` });
        return notes;
    },
};
