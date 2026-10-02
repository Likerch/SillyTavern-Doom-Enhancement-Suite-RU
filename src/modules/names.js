/**
 * Модуль 2. Имена персонажей: падежи, звания, уменьшительные → алиасы DES; раскраска реплик и листы для кириллицы.
 *
 * Модель иногда пишет в трекере имя в падеже из текста («Ани», «Аней»), со званием («Капитан Дарган»),
 * уменьшительно («Саша» при карточке «Александр») или латиницей («Akari» ↔ «Акари») — и DES заводит дубль.
 * В режиме together ответ приходит в MESSAGE_RECEIVED: раньше DES (makeFirst) достаём из него имена тем же
 * разбором, что сделает DES, сверяем с карточками и дописываем форму алиасом. Явный алиас DES проверяет
 * первым, поэтому дальше он сам подставит имя карточки: без дубля и без попапа. Формы имени персонажа
 * пользователя алиасом стать не могут (DES запрещает) — их прячем из «Present Characters».
 * В режимах separate/external точки до разбора нет — там склейка не работает (решение §12.1 разведки),
 * но регистр и ё (там — алиас-написание к каждой карточке), раскраска реплик и листы работают во всех режимах.
 *
 * Каждая склейка пишется в журнал; «разъединить» убирает алиас и запоминает пару, чтобы не склеить снова.
 * Прошлые ответы уже записаны под именем карточки — разделяются только следующие.
 * Алиасы DES общие для всех чатов, а карточки и скрытые имена у каждого чата свои: скрытие в журнале
 * помнит свой чат и сверяется только в нём.
 */
import { getContext, notify } from '../st.js';
import { log } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { DES_KEYS, DES_MODE_NAMES, DES_SELECTORS, desCharacterNameField, desNameKey } from '../des-adapter.js';
import { buildNameContext, hiddenNames, pairKey } from '../name-context.js';
import { decideName, decideSheetOwner, findCaseDuplicates, normalizeRussianName, wordForms } from '../lib/russian-names.js';
import { NAME_INSTRUCTION_RU, replaceExact } from '../lib/service-prompt.js';
import { bestAdjacentSpeaker, messageFontColors, namePattern } from '../lib/speaker-colors.js';
import { menuButton } from '../ui.js';

/** Сколько склеек держим в журнале. */
const JOURNAL_LIMIT = 200;
/** Как часто проверять, закрыт ли Workshop, пока он мог затереть наши алиасы. */
const WORKSHOP_POLL_MS = 2000;
/** Сколько ждать, пока в попапе импорта листа DES подтвердят имя. */
const SHEET_IMPORT_WAIT_MS = 5 * 60 * 1000;
/** Как часто смотреть, не сохранил ли DES импортированный лист. */
const SHEET_IMPORT_POLL_MS = 500;
const VIA_NAMES = Object.freeze({
    'падеж': 'падеж', 'падеж алиаса': 'падеж алиаса', 'звание или обращение': 'звание', 'часть имени': 'часть имени',
    'уменьшительное': 'уменьшительное', 'транслит': 'транслит', 'алиас': 'алиас', 'без пояснения': 'без пояснения',
    'полное имя': 'полное имя',
});

const OPTIONS = [
    {
        key: 'aliasForms',
        title: 'Формы имён → алиасы DES',
        description: '«Ани», «Аней», «аня» в трекере дописываются алиасами к карточке «Аня», и DES не заводит дубль. Только режим «Вместе с ответом».',
    },
    {
        key: 'nameSteps',
        title: 'Звания, имя без фамилии, уменьшительные, транслит',
        description: '«Капитан Дарган», «Аня» при «Аня Петрова», «Саша» при «Александр», «Akari» при «Акари» — тоже алиасы. Склеивается, только если подходит ровно одна карточка.',
    },
    {
        key: 'personaForms',
        title: 'Формы имени игрока не становятся NPC',
        description: '«Лизы», «Лизонька» при персонаже пользователя «Лиза» прячутся из Present Characters: алиас на персонажа пользователя DES не разрешает.',
    },
    {
        key: 'caseAliases',
        title: 'Регистр и ё в любом режиме',
        description: 'В режимах «Отдельным запросом» и «Внешний API» к каждой карточке дописывается алиас-написание в нижнем регистре и без «ё» — так «аня» и «Алена» склеиваются с «Аня» и «Алёна». В режиме «Вместе с ответом» это делает склейка форм.',
    },
    {
        key: 'nominativePrompt',
        title: 'Имена в именительном падеже в промпте',
        description: 'В шаблоне трекера просим писать имя персонажа ровно как на его карточке. Режим «Вместе с ответом».',
    },
    {
        key: 'speakerColors',
        title: 'Раскраска реплик и пузыри для кириллицы',
        description: 'DES связывает цвет реплики с персонажем по его имени рядом, но русские имена не видит. Модуль находит их во всех падежах и записывает цвет персонажу.',
    },
    {
        key: 'sheets',
        title: 'Листы под именем карточки',
        description: 'Лист BunnyMo, который DES сохранил под формой имени, алиасом или полным именем из листа («Флоренс Клеймор (урождённая Блэкени)» при карточке «Флоренс»), перекладывается под имя карточки — его видно на портрете. Повторный импорт обновляет лист карточки.',
    },
];

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {Array<[string, (...args: any[]) => unknown]>} */
let subscriptions = [];
const loggedOnce = new Set();
/** @type {Set<() => void>} */
const changeListeners = new Set();
/** Алиасы, дописанные, пока был открыт Workshop: он сохранит свой снимок поверх — проверим и вернём. */
/** @type {{ variant: string, canonical: string }[]} */
let workshopGuard = [];
let workshopTimer = 0;
let sheetTimer = 0;
let chatLoadedTimer = 0;
/** @type {((event: Event) => void)|null} */
let importClickHandler = null;
/** Мысли персонажей DES на момент последней раскраски (или загрузки чата): по ним видно, пришли ли новые. */
/** @type {string|null|undefined} */
let harvestedThoughts;
const counters = { caseAliases: 0, colors: 0, sheets: 0, restored: 0 };

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

/** @param {unknown} list */
function asArray(list) {
    return Array.isArray(list) ? list : [];
}

/** @param {string[]} list @param {string} name */
const includesName = (list, name) => list.some((item) => String(item).toLowerCase() === String(name).toLowerCase());

/** Открытый чат — так его различает и DES (getContext().chatId); `null` — чата нет. */
function currentChatId() {
    const id = getContext().chatId;
    return id === undefined || id === null || id === '' ? null : String(id);
}

/**
 * Где сделана запись журнала: `this` — в открытом чате, `other` — в другом, `unknown` — старая запись без чата.
 * @param {{ chatId?: string }} entry
 * @returns {'this'|'other'|'unknown'}
 */
function entryChat(entry) {
    if (!entry.chatId) return 'unknown';
    return entry.chatId === currentChatId() ? 'this' : 'other';
}

/**
 * Ключ записи журнала: алиас DES один на все чаты, а скрытие — своё в каждом чате.
 * @param {{ variant: string, canonical: string, kind?: string, chatId?: string }} entry
 */
function journalKey(entry) {
    return entry.kind === 'hide' ? `hide|${pairKey(entry)}|${entry.chatId ?? ''}` : pairKey(entry);
}

/** Ключ алиаса-написания: точное написание, без свёртки ё — «алёна» и «алена» разные. @param {{ variant: string, canonical: string }} pair */
const spellingKey = (pair) => `${pair.variant}|${pair.canonical}`;

// ─── Склейка ───────────────────────────────────────────────────────────────

/** @param {string} variant @param {string} canonical @param {'alias'|'hide'} kind @param {string} via */
function recordMerge(variant, canonical, kind, via) {
    const settings = moduleSettings();
    /** @type {{ variant: string, canonical: string, kind: string, via: string, at: number, chatId?: string }} */
    const entry = { variant, canonical, kind, via, at: Date.now() };
    const chatId = currentChatId();
    if (chatId) entry.chatId = chatId;
    const journal = asArray(settings.journal).filter((item) => journalKey(item) !== journalKey(entry));
    journal.push(entry);
    settings.journal = journal.slice(-JOURNAL_LIMIT);
}

/**
 * Применяет решение по одному имени. @returns {boolean} что-то изменилось
 * @param {string} name
 * @param {import('../lib/russian-names.js').NameDecision} decision
 */
function applyDecision(name, decision) {
    const des = env.des;
    if (decision.action === 'alias') {
        if (!des.names.addAlias(decision.canonical, name)) return false;
        if (des.workshopOpen()) {
            workshopGuard.push({ variant: name, canonical: decision.canonical });
            watchWorkshop();
        }
        recordMerge(name, decision.canonical, 'alias', decision.via);
        log.info(`Имена: «${name}» → «${decision.canonical}» (${VIA_NAMES[decision.via] ?? decision.via}, алиас DES).`);
        return true;
    }
    if (decision.action === 'hide' && option('personaForms') && des.roster.available()) {
        const removed = des.roster.removed();
        if (includesName(removed, name)) return false;
        removed.push(name);
        recordMerge(name, decision.persona, 'hide', decision.via);
        log.info(`Имена: «${name}» — форма имени персонажа пользователя «${decision.persona}», скрыто из Present Characters.`);
        return true;
    }
    return false;
}

/** Ответ модели пришёл (together): до разбора DES дописываем формы имён алиасами. */
function onReplyReceived() {
    if (!isTogetherMode() || !option('aliasForms')) return;
    // DES берёт для трекера последнее сообщение — смотрим туда же.
    const message = lastReply();
    if (!message) return;
    const names = env.des.names.fromReply(message.mes);
    if (!names.length) return;
    const context = buildNameContext(env.des);
    let changedAliases = false;
    let changedRoster = false;
    for (const name of names) {
        const decision = decideName(name, context);
        if (decision.action === 'skip') {
            if (decision.candidates) log.debug(`Имена: «${name}» подходит нескольким карточкам (${decision.candidates.join(', ')}) — не склеиваю.`);
            continue;
        }
        // Два имени в одном ответе трекера — два персонажа: «Саша» не склеится с «Александром», если он тоже тут
        // (сам или уже известным DES алиасом).
        const target = decision.action === 'alias' ? decision.canonical : decision.persona;
        const targetAliases = asArray(context.aliasesOf?.get(target));
        const twin = names.find((other) => other !== name
            && (desNameKey(other) === desNameKey(target) || includesName(targetAliases, other)));
        if (twin !== undefined) {
            log.debug(`Имена: «${name}» и «${twin}» — разные персонажи одного ответа, не склеиваю.`);
            continue;
        }
        if (!applyDecision(name, decision)) continue;
        if (decision.action === 'alias') changedAliases = true;
        else changedRoster = true;
    }
    if (!changedAliases && !changedRoster) return;
    if (changedAliases) env.des.names.save();
    if (changedRoster) env.des.roster.save();
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

// ─── Регистр и ё ───────────────────────────────────────────────────────────

/**
 * Алиасы-написания к каждой карточке: в нижнем регистре и без «ё». DES сравнивает алиасы без учёта
 * регистра, а карточки — точно, поэтому «аня» иначе становится второй карточкой. Только в режимах
 * «Отдельным запросом» и «Внешний API»: в режиме «Вместе с ответом» регистр и ё склеивает decideName, а лишний
 * алиас вредит — алиасы DES общие для всех чатов, и в другом чате с такой же карточкой он уведёт имя к этой.
 * Алиас, который пользователь сам убрал в Workshop, не возвращаем; написание, занятое другой карточкой, не берём.
 */
function ensureCaseAliases() {
    if (!env?.des || !option('caseAliases') || env.des.workshopOpen()) return;
    if (isTogetherMode() && option('aliasForms')) return;
    const des = env.des;
    const { npc, users } = des.names.cards();
    const aliases = des.names.aliases();
    const keys = new Map();
    for (const card of [...npc, ...users]) keys.set(desNameKey(card), [...(keys.get(desNameKey(card)) ?? []), card]);
    // Чьё это написание у DES: алиас карточки или имя карточки с алиасами (может быть из другого чата).
    /** @type {Map<string, Set<string>>} */
    const owners = new Map();
    const own = (spelling, card) => owners.set(spelling, (owners.get(spelling) ?? new Set()).add(card));
    for (const [card, list] of Object.entries(aliases)) {
        own(card.trim().toLowerCase(), card);
        for (const alias of list) own(alias.trim().toLowerCase(), card);
    }
    const settings = moduleSettings();
    const added = asArray(settings.caseAliasesAdded);
    const known = new Set(added.map(spellingKey));
    const removedByUser = asArray(settings.caseAliasesRemoved);
    const refused = new Set(removedByUser.map(spellingKey));
    const unmerged = new Set(asArray(settings.unmerged).map(pairKey));
    // Падежный дубль из прошлых ответов («Аней» при «Аня») алиасами не укрепляем.
    const duplicates = new Set(findCaseDuplicates(npc).map((pair) => pair.variant));
    // Скрытые из «Present Characters» — не NPC: так DES хранит и скрытые формы имени игрока.
    const hidden = hiddenNames(des);
    let changed = false;
    for (const card of npc) {
        // Две карточки с одним ключом («Аня» и «аня») — какая из них настоящая, решает пользователь.
        if ((keys.get(desNameKey(card)) ?? []).length > 1 || duplicates.has(card) || hidden.has(card.toLowerCase())) continue;
        const cardAliases = asArray(aliases[card]);
        const spellings = [...new Set([card.toLowerCase(), card.toLowerCase().replace(/ё/g, 'е')])];
        for (const spelling of spellings) {
            const pair = { variant: spelling, canonical: card };
            if (refused.has(spellingKey(pair)) || unmerged.has(pairKey(pair)) || includesName(cardAliases, spelling)) continue;
            if (known.has(spellingKey(pair))) {
                // Мы его уже дописывали, а теперь его нет: убрали в Workshop — больше не трогаем.
                removedByUser.push(pair);
                refused.add(spellingKey(pair));
                changed = true;
                continue;
            }
            // «артем» у карточки «Артём» не отбираем у карточки «Артем» из другого чата (и наоборот).
            if ([...(owners.get(spelling) ?? [])].some((owner) => owner !== card)) continue;
            if (!des.names.addAlias(card, spelling)) continue;
            added.push(pair);
            known.add(spellingKey(pair));
            own(spelling, card);
            counters.caseAliases += 1;
            changed = true;
        }
    }
    if (!changed) return;
    settings.caseAliasesAdded = added;
    settings.caseAliasesRemoved = removedByUser;
    des.names.save();
    saveSettings();
}

/**
 * Однократно: убрать из разъединённых пары, которые туда по ошибке положил учёт алиасов-написаний (0.6.2 и раньше).
 * Он сравнивал написания со свёрткой ё: дописав «алёна» к «Алёна», считал «алена» убранной пользователем — и пара
 * «алена» ↛ «Алёна» не давала склеить «Алена» и в режиме «Вместе с ответом».
 */
function migrateCaseAliases() {
    const settings = moduleSettings();
    if (settings.caseAliasesMigrated) return;
    const added = new Set(asArray(settings.caseAliasesAdded).map(spellingKey));
    const before = asArray(settings.unmerged);
    const after = before.filter((pair) => {
        const lower = String(pair?.canonical ?? '').toLowerCase();
        const plain = lower.replace(/ё/g, 'е');
        return !(plain !== lower && pair.variant === plain && added.has(spellingKey({ variant: lower, canonical: pair.canonical })));
    });
    settings.caseAliasesMigrated = true;
    if (after.length !== before.length) {
        settings.unmerged = after;
        log.info(`Имена: из разъединённых убраны пары, которые туда по ошибке попали из алиасов-написаний: ${before.length - after.length}.`);
    }
    saveSettings();
}

// ─── Workshop ──────────────────────────────────────────────────────────────

function watchWorkshop() {
    if (workshopTimer) return;
    workshopTimer = setInterval(() => {
        if (!env?.des || env.des.workshopOpen()) return;
        clearInterval(workshopTimer);
        workshopTimer = 0;
        restoreAfterWorkshop();
    }, WORKSHOP_POLL_MS);
}

/** Workshop закрылся: алиасы, дописанные при открытом окне, он мог затереть своим снимком — возвращаем. */
function restoreAfterWorkshop() {
    const guard = workshopGuard;
    workshopGuard = [];
    if (!env?.des || !guard.length) return;
    const aliases = env.des.names.aliases();
    let restored = 0;
    for (const { variant, canonical } of guard) {
        if (includesName(asArray(aliases[canonical]), variant)) continue;
        if (env.des.names.addAlias(canonical, variant)) restored += 1;
    }
    if (!restored) return;
    counters.restored += restored;
    env.des.names.save();
    log.info(`Имена: Workshop сохранил свой снимок поверх новых алиасов — возвращено: ${restored}.`);
    notifyChange();
}

/**
 * Склейки из журнала, которых в DES уже нет: алиас убрали в Workshop или каталоге, скрытое имя вернули на панель.
 * Уважаем это — пара больше не склеивается. Скрытие сверяем только в его чате (у каждого чата свой список
 * скрытых), старые записи без чата сами не разъединяем. Удалённая карточка уносит все свои алиасы — такую склейку
 * просто забываем; удалена ли карточка, видно только в её чате. Пока Workshop открыт или ждёт проверки, не трогаем.
 */
function reconcileJournal() {
    const des = env?.des;
    if (!des || des.workshopOpen() || workshopGuard.length) return;
    const aliases = des.names.aliases();
    const removed = des.roster.available() ? des.roster.removed() : null;
    const { npc } = des.names.cards();
    const settings = moduleSettings();
    const gone = [];
    const deleted = [];
    for (const entry of asArray(settings.journal)) {
        if (entry.kind === 'hide') {
            if (removed && entryChat(entry) === 'this' && !includesName(removed, entry.variant)) gone.push(entry);
            continue;
        }
        if (includesName(asArray(aliases[entry.canonical]), entry.variant)) continue;
        // Другие алиасы карточки на месте — убрали именно этот.
        if (Object.hasOwn(aliases, entry.canonical)) gone.push(entry);
        // Нет ни одного: либо убрали все, либо карточку удалили (DES стирает её алиасы) — видно только в её чате.
        else if (entryChat(entry) === 'other') continue;
        else if (npc.includes(entry.canonical)) gone.push(entry);
        else deleted.push(entry);
    }
    if (!gone.length && !deleted.length) return;
    const dropped = new Set([...gone, ...deleted]);
    settings.journal = asArray(settings.journal).filter((entry) => !dropped.has(entry));
    const unmerged = asArray(settings.unmerged);
    for (const entry of gone) {
        if (!unmerged.some((item) => pairKey(item) === pairKey(entry))) unmerged.push({ variant: entry.variant, canonical: entry.canonical });
    }
    settings.unmerged = unmerged;
    saveSettings();
    const list = (entries) => entries.map((entry) => `«${entry.variant}» → «${entry.canonical}»`).join(', ');
    if (gone.length) log.info(`Имена: склейки убраны вне модуля и больше не повторяются: ${list(gone)}.`);
    if (deleted.length) log.info(`Имена: карточки удалены вместе с алиасами — склейки забыты: ${list(deleted)}.`);
    notifyChange();
}

/**
 * DES при каждой загрузке чата делает карточку из каждого скрытого имени без карточки (orphan-adopt) — скрытая
 * модулем форма имени игрока («Лизы») стала бы NPC. Убираем такие заготовки для своих скрытий этого чата
 * (и старых записей без чата: тронем только нетронутые заготовки DES). Зовётся, когда DES уже загрузил чат.
 */
function forgetAdoptedPersonaForms() {
    const des = env?.des;
    if (!des?.roster.available()) return;
    const names = asArray(moduleSettings().journal)
        .filter((entry) => entry.kind === 'hide' && entryChat(entry) !== 'other')
        .map((entry) => entry.variant);
    const dropped = des.roster.forgetAdopted(names);
    if (dropped.length) log.info(`Имена: DES завёл карточки для скрытых форм имени игрока — убраны: ${dropped.map((name) => `«${name}»`).join(', ')}.`);
}

// ─── Раскраска реплик ──────────────────────────────────────────────────────

/** Формы имени для поиска в тексте: все падежи (с родительным) имени и алиасов, и первое слово имени. */
function speakerPattern(name, aliases) {
    const forms = new Set();
    for (const source of [name, ...aliases]) {
        const words = normalizeRussianName(source).split(' ').filter(Boolean);
        if (words.length === 1) wordForms(words[0], { genitive: true }).forEach((form) => forms.add(form));
        else {
            forms.add(words.join(' '));
            // «Сильвана Лунная» → «Сильвана»: так DES ищет и латиницу.
            if (words[0].length >= 3) wordForms(words[0], { genitive: true }).forEach((form) => forms.add(form));
        }
    }
    return namePattern([...forms]);
}

/**
 * После разбора DES: цвета реплик, которые DES не связал ни с кем (имена рядом — кириллица), — по соседству.
 * @param {string} text сырой текст последнего ответа
 * @returns {boolean} появились ли новые цвета
 */
function harvestSpeakerColors(text) {
    const des = env?.des;
    if (!des || !option('speakerColors') || !des.roster.available() || typeof text !== 'string') return false;
    const messageColors = messageFontColors(text);
    if (!messageColors.length) return false;
    const colors = des.roster.colors();
    const owned = new Set(Object.values(colors).filter(Boolean).map((color) => String(color).toLowerCase()));
    const unowned = messageColors.filter((color) => !owned.has(color));
    if (!unowned.length) return false;
    const present = des.names.fromThoughts(des.tracker.read().characterThoughts);
    const hasColor = (name) => Object.keys(colors).some((key) => key.toLowerCase() === name.toLowerCase() && colors[key]);
    const aliases = des.names.aliases();
    let colorless = present.filter((name) => !hasColor(name))
        .map((name) => ({ name, pattern: speakerPattern(name, asArray(aliases[name])) }));
    const registered = [];
    let free = [...unowned];
    for (const color of unowned) {
        if (!colorless.length) break;
        const best = bestAdjacentSpeaker(text, color, colorless);
        if (!best) continue;
        colors[best] = color;
        registered.push(`${best} → ${color}`);
        colorless = colorless.filter((candidate) => candidate.name !== best);
        free = free.filter((item) => item !== color);
    }
    // Как шаг «исключение» у DES, но после соседства: остался один персонаж без цвета и один ничей цвет.
    if (registered.length && colorless.length === 1 && free.length === 1) {
        colors[colorless[0].name] = free[0];
        registered.push(`${colorless[0].name} → ${free[0]} (последний)`);
    }
    if (!registered.length) return false;
    counters.colors += registered.length;
    des.roster.save();
    log.info(`Имена: цвета реплик по русским именам: ${registered.join(', ')}.`);
    notifyChange();
    return true;
}

/** Последнее сообщение чата, если это ответ модели с текстом. */
function lastReply() {
    const chat = getContext().chat;
    const message = Array.isArray(chat) ? chat[chat.length - 1] : null;
    return message && !message.is_user && typeof message.mes === 'string' ? message : null;
}

/** Мысли персонажей, которые DES сейчас показывает: по ним раскраска ищет имена. */
const currentThoughts = () => env?.des?.tracker.read().characterThoughts ?? null;

/** Together: DES уже разобрал ответ в своём MESSAGE_RECEIVED, пузыри он разложит позже. */
function onReplyParsed() {
    if (!isTogetherMode()) return;
    // Новые карточки DES только что завёл — им тоже нужны алиасы-написания (если склейка форм выключена).
    ensureCaseAliases();
    const message = lastReply();
    // Мысли персонажей DES обновил, только если в ответе был трекер с персонажами; иначе там прошлый ответ.
    if (!message || !env.des.names.fromReply(message.mes).length) return;
    harvestSpeakerColors(message.mes);
    harvestedThoughts = currentThoughts();
}

/** Separate/external: трекер пришёл отдельным запросом, пузыри могли уже стоять — раскладываем заново. */
function onSeparateTrackerDone() {
    ensureCaseAliases();
    const message = lastReply();
    // DES шлёт событие и после неудачного запроса: мысли персонажей не изменились — это прошлый ответ, не раскрашиваем.
    const thoughts = currentThoughts();
    if (!message || thoughts === harvestedThoughts) return;
    harvestedThoughts = thoughts;
    if (harvestSpeakerColors(message.mes)) env.des.bubbles.reapplyLast();
}

// ─── Листы ─────────────────────────────────────────────────────────────────

/**
 * Листы, сохранённые под формой имени, алиасом или полным именем из листа, — под имя карточки. Под карточку
 * без листа лист просто переезжает. Лист карточки обновляет только свежий импорт (как повторный импорт у DES,
 * заметки карточки остаются); старые листы на смене чата поверх листа карточки не ложатся.
 * @param {ReadonlySet<string>} [fresh] только что импортированные листы: о них — уведомление
 */
function rekeySheets(fresh = new Set()) {
    const des = env?.des;
    if (!des || !option('sheets') || !des.sheets.available()) return;
    const store = des.sheets.store();
    if (!store) return;
    const { npc } = des.names.cards();
    const aliases = des.names.aliases();
    const context = buildNameContext(des);
    let moved = 0;
    for (const key of Object.keys(store)) {
        if (npc.includes(key)) continue;
        let canonical = Object.entries(aliases).find(([card, list]) => npc.includes(card) && includesName(list, key))?.[0] ?? null;
        let via = 'алиас';
        if (!canonical) {
            const decision = decideSheetOwner(key, context);
            if (decision.action !== 'alias') {
                if (fresh.has(key) && decision.action === 'skip' && decision.candidates) {
                    log.info(`Имена: лист «${key}» подходит нескольким карточкам (${decision.candidates.join(', ')}) — оставляю под этим именем.`);
                }
                continue;
            }
            ({ canonical, via } = decision);
        }
        const result = des.sheets.rename(key, canonical, { merge: fresh.has(key) });
        if (!result) {
            if (fresh.has(key)) log.info(`Имена: у карточки «${canonical}» уже есть лист не старше «${key}» — оставляю оба как есть.`);
            continue;
        }
        moved += 1;
        log.info(`Имена: лист «${key}» ${result === 'merged' ? 'обновил лист карточки' : 'переложен под карточку'} «${canonical}» (${VIA_NAMES[via] ?? via}).`);
        if (fresh.has(key)) {
            notify('success', result === 'merged'
                ? `Лист карточки «${canonical}» обновлён — DES записал его как «${key}».`
                : `Лист перенесён к карточке «${canonical}» — DES записал его как «${key}».`);
        }
    }
    if (moved) {
        counters.sheets += moved;
        notifyChange();
    }
}

function stopSheetWatch() {
    clearInterval(sheetTimer);
    sheetTimer = 0;
}

/**
 * Клик «Импорт листа»: DES спрашивает имя в попапе и сохраняет лист только после ответа. Ждём, пока какой-то
 * лист появится или обновится (DES кладёт новый объект), и сразу перекладываем его под карточку.
 */
function watchSheetImport() {
    const des = env?.des;
    if (!des || !option('sheets') || !des.sheets.available()) return;
    stopSheetWatch();
    const before = new Map(Object.entries(des.sheets.store() ?? {}));
    const until = Date.now() + SHEET_IMPORT_WAIT_MS;
    sheetTimer = setInterval(() => {
        try {
            const fresh = Object.entries(env?.des?.sheets.store() ?? {})
                .filter(([key, sheet]) => before.get(key) !== sheet)
                .map(([key]) => key);
            if (fresh.length) {
                stopSheetWatch();
                rekeySheets(new Set(fresh));
            } else if (Date.now() > until) {
                stopSheetWatch();
            }
        } catch (error) {
            stopSheetWatch();
            log.warn('Имена: не удалось проверить импортированный лист', error);
        }
    }, SHEET_IMPORT_POLL_MS);
}

/**
 * То, что DES готовит в своём обработчике CHAT_CHANGED (loadChatData: данные трекера, заготовки карточек), —
 * следующим заданием, после всех обработчиков события. Обычно DES и так раньше нас (он подписывается при запуске,
 * мы — после проверки DES), но так порядок подписки не важен.
 */
function afterChatLoaded() {
    clearTimeout(chatLoadedTimer);
    chatLoadedTimer = setTimeout(() => {
        chatLoadedTimer = 0;
        if (!env?.des) return;
        try {
            // Мысли персонажей загруженного чата — не новые данные трекера.
            harvestedThoughts = currentThoughts();
            forgetAdoptedPersonaForms();
        } catch (error) {
            log.error('Имена: сбой после загрузки чата', error);
        }
    }, 0);
}

function onChatChanged() {
    // Импорт, которого ждали, был в прошлом чате.
    stopSheetWatch();
    ensureCaseAliases();
    reconcileJournal();
    rekeySheets();
    notifyChange();
    afterChatLoaded();
}

/**
 * Разъединить: убрать алиас из DES (или вернуть скрытое имя) и запомнить пару. Прошлые ответы остаются как были.
 * Скрытое имя возвращается только в своём чате — у другого чата свой список скрытых.
 * @param {{ variant: string, canonical: string, kind?: string, chatId?: string }} entry
 */
function unmerge(entry) {
    if (!env?.des) {
        notify('error', 'Модуль 2 не работает — алиасы DES сейчас недоступны.');
        return;
    }
    if (entry.kind === 'hide' && entryChat(entry) === 'other') {
        notify('info', `«${entry.variant}» скрыто в другом чате — разъединить можно, только открыв тот чат.`);
        return;
    }
    let removed = false;
    if (entry.kind === 'hide') {
        if (env.des.roster.available()) {
            const list = env.des.roster.removed();
            const index = list.findIndex((name) => String(name).toLowerCase() === entry.variant.toLowerCase());
            if (index >= 0) {
                list.splice(index, 1);
                env.des.roster.save();
                removed = true;
            }
        }
    } else {
        removed = env.des.names.removeAlias(entry.canonical, entry.variant);
        if (removed) env.des.names.save();
    }
    const settings = moduleSettings();
    settings.journal = asArray(settings.journal).filter((item) => journalKey(item) !== journalKey(entry));
    if (!asArray(settings.unmerged).some((item) => pairKey(item) === pairKey(entry))) {
        settings.unmerged = [...asArray(settings.unmerged), { variant: entry.variant, canonical: entry.canonical }];
    }
    saveSettings();
    log.info(`Имена: «${entry.variant}» отделено от «${entry.canonical}»${removed ? '' : ' (в DES уже не было)'}.`);
    notify('success', `«${entry.variant}» больше не склеивается с «${entry.canonical}». Прошлые ответы остаются как были.`);
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

/** @param {import('../lib/russian-names.js').NameDecision} decision @param {string} name */
function describeDecision(decision, name) {
    if (decision.action === 'alias') return `«${name}» → алиас к «${decision.canonical}» (${VIA_NAMES[decision.via] ?? decision.via}).`;
    if (decision.action === 'hide') return `«${name}» — форма имени персонажа пользователя «${decision.persona}»: спрячется из Present Characters.`;
    return `«${name}» не склеится: ${decision.reason}${decision.candidates ? ` (${decision.candidates.join(', ')})` : ''}.`;
}

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'Склейки имён';
    const hint = small('desru-dict-hint', 'Формы имён, которые модель пишет в трекере («Ани», «Капитан Дарган», «Саша»), дописываются алиасами к карточке — их видно и в Workshop DES. '
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
        testResult.textContent = describeDecision(decideName(name, buildNameContext(env.des)), name);
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
            const hidden = entry.kind === 'hide';
            const gone = !hidden && aliases && !asArray(aliases[entry.canonical]).some((alias) => alias.toLowerCase() === String(entry.variant).toLowerCase());
            const via = entry.via ? ` (${VIA_NAMES[entry.via] ?? entry.via})` : '';
            const elsewhere = hidden && entryChat(entry) === 'other' ? ' · в другом чате' : '';
            text.textContent = hidden
                ? `«${entry.variant}» скрыто — форма «${entry.canonical}»${via} · ${formatDate(entry.at)}${elsewhere}`
                : `«${entry.variant}» → «${entry.canonical}»${via} · ${formatDate(entry.at)}${gone ? ' · алиаса в DES уже нет' : ''}`;
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
    title: 'Имена персонажей',
    description: 'Не даёт DES плодить дубли карточек из-за падежей, званий и уменьшительных («Аня», «Аней», «Анечка»): дописывает формы в алиасы DES. Плюс раскраска реплик и листы для русских имён. Каждая склейка записывается и отменяется.',
    needs: { ui: true, data: true },
    options: OPTIONS,
    section: 'names',
    mountSection,
    enable(environment) {
        env = environment;
        const { eventTypes } = getContext();
        // DES разбирает ответ в своём MESSAGE_RECEIVED — наш алиас должен появиться раньше…
        subscribe('makeFirst', eventTypes.MESSAGE_RECEIVED, onReplyReceived);
        // …а цвета реплик — после его разбора, но до пузырей (DES раскладывает их позже).
        subscribe('makeLast', eventTypes.MESSAGE_RECEIVED, onReplyParsed);
        subscribe('on', DES_KEYS.updateCompleteEvent, onSeparateTrackerDone);
        // DES пишет инструкцию трекера в своём GENERATION_STARTED — правим сразу после него.
        subscribe('makeLast', eventTypes.GENERATION_STARTED, rewriteNamePlaceholder);
        subscribe('on', eventTypes.CHAT_CHANGED, onChatChanged);
        importClickHandler = (event) => {
            if (!(event.target instanceof Element) || !event.target.closest(DES_SELECTORS.importButton)) return;
            watchSheetImport();
        };
        document.addEventListener('click', importClickHandler, true);
        migrateCaseAliases();
        onChatChanged();
        log.info('Модуль 2 (имена) включён.');
    },
    disable() {
        const { eventSource } = getContext();
        for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
        subscriptions = [];
        if (importClickHandler) document.removeEventListener('click', importClickHandler, true);
        importClickHandler = null;
        clearInterval(workshopTimer);
        workshopTimer = 0;
        // Проверка после Workshop — дело этого включения: следующее начнёт с чистого листа.
        workshopGuard = [];
        clearTimeout(chatLoadedTimer);
        chatLoadedTimer = 0;
        harvestedThoughts = undefined;
        stopSheetWatch();
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
            notes.push({ level: 'warn', text: `Режим генерации DES — «${DES_MODE_NAMES[mode] ?? mode}»: склейка форм работает только в режиме «${DES_MODE_NAMES.together}» (о похожих именах спрашивает попап DES). Регистр и ё, раскраска реплик и листы работают.` });
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
        const extra = [
            counters.caseAliases && `алиасов-написаний: ${counters.caseAliases}`,
            counters.colors && `цветов реплик: ${counters.colors}`,
            counters.sheets && `листов переложено: ${counters.sheets}`,
            counters.restored && `алиасов возвращено после Workshop: ${counters.restored}`,
        ].filter(Boolean);
        if (extra.length) notes.push({ level: 'info', text: `С начала сессии: ${extra.join(', ')}.` });
        if (!env.des.roster.available() || !env.des.sheets.available()) {
            notes.push({ level: 'warn', text: 'Часть функций модуля недоступна: в DES не нашлось нужных экспортов (подробности — в статусе гарда).' });
        }
        return notes;
    },
};
