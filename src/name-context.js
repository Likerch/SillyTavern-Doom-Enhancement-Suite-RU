// Контекст для решений об именах (decideName): карточки и алиасы DES плюс исключения пользователя.
// Общий для модуля 2 (склейка имён) и модуля 5 (имя в листе BunnyMo → имя карточки).

import { getContext } from './st.js';
import { getSettings } from './settings.js';
import { desNameKey } from './des-adapter.js';
import { decideName, normalizeRussianName, wordForms } from './lib/russian-names.js';
import { WORD_END, WORD_START, escapeRegex } from './lib/regex-keys.js';

/** @param {unknown} list */
const asArray = (list) => (Array.isArray(list) ? list : []);

/** @param {{ variant: string, canonical: string }} pair */
export function pairKey(pair) {
    return `${normalizeRussianName(pair.variant)}|${normalizeRussianName(pair.canonical)}`;
}

/** Ступени сравнения имён по переключателю модуля 2. */
function steps() {
    const extended = getSettings().modules.names?.nameSteps !== false;
    return { address: extended, parts: extended, diminutives: extended, translit: extended };
}

/**
 * Имена, скрытые из «Present Characters» этого чата, в нижнем регистре (DES сравнивает их так же).
 * @param {import('./des-adapter.js').DesApi} des
 * @returns {Set<string>}
 */
export function hiddenNames(des) {
    return new Set(des.roster.available() ? asArray(des.roster.removed()).map((name) => String(name).toLowerCase()) : []);
}

// ─── Персонажи этого чата ──────────────────────────────────────────────────

/**
 * Кто точно есть в этом чате, ключами DES: его список персонажей DES и те, кого DES сейчас показывает, карточка ST
 * чата (в группе — все участники) и персона пользователя.
 * @param {import('./des-adapter.js').DesApi} des
 * @param {readonly string[]} chatCards
 * @returns {Set<string>}
 */
function chatCastKeys(des, chatCards) {
    const context = getContext();
    /** @type {unknown[]} */
    const names = [...chatCards, context.name1, context.name2];
    try {
        names.push(...des.names.fromThoughts(des.tracker.read().characterThoughts));
    } catch {
        // Мыслей нет или они не разобрались — обойдёмся без них.
    }
    const characters = asArray(context.characters);
    const group = context.groupId ? asArray(context.groups).find((item) => item?.id === context.groupId) : null;
    if (group) {
        for (const avatar of asArray(group.members)) names.push(characters.find((character) => character?.avatar === avatar)?.name);
    } else if (context.characterId !== undefined && context.characterId !== null) {
        names.push(characters[Number(context.characterId)]?.name);
    }
    return new Set(names.filter((name) => typeof name === 'string' && name.trim()).map((name) => desNameKey(String(name))));
}

/**
 * Регулярка имени во всех падежах (без родительного, который совпадает с другим именем: «Александра» у «Александр»),
 * регистр не важен, ё и е взаимозаменяемы, пробелы — любые. `null` — имя пустое.
 * @param {string} name
 */
function namePatternOf(name) {
    const words = normalizeRussianName(name).split(' ').filter(Boolean);
    if (!words.length) return null;
    const parts = words.map((word) => {
        const forms = wordForms(word).sort((a, b) => b.length - a.length);
        return `(?:${forms.map((form) => escapeRegex(form).replace(/е/g, '[её]')).join('|')})`;
    });
    return new RegExp(`${WORD_START}${parts.join('\\s+')}${WORD_END}`, 'giu');
}

/**
 * Названа ли карточка в сообщениях этого чата — хоть раз, в любом падеже. Не в счёт её имя внутри нового имени:
 * «Дарган» в «Капитан Дарган» не делает карточку «Дарган» здешней, а «Офелия Ричардс» при новой «Офелии» — делает.
 * @param {string} card
 * @param {string} variant
 */
function namedInChat(card, variant) {
    const chat = getContext().chat;
    if (!Array.isArray(chat) || !chat.length) return false;
    const cardPattern = namePatternOf(card);
    if (!cardPattern) return false;
    const variantPattern = namePatternOf(variant);
    for (const message of chat) {
        const text = typeof message?.mes === 'string' ? message.mes : '';
        const found = text ? [...text.matchAll(cardPattern)] : [];
        if (!found.length) continue;
        const spans = variantPattern ? [...text.matchAll(variantPattern)].map((match) => [match.index, match.index + match[0].length]) : [];
        const inside = (match) => spans.some(([from, to]) => from <= match.index && match.index + match[0].length <= to);
        if (found.some((match) => !inside(match))) return true;
    }
    return false;
}

/**
 * Есть ли карточка в этом чате. Алиасы DES общие для всех чатов, а общий список его карточек копит персонажей всех
 * чатов: склейка «Офелия» → «Офелия Ричардс» из чужой истории увела бы новую Офелию в старую. Поэтому другое имя
 * склеивается только с карточкой этого чата (decideName): из его списка персонажей DES, из «Персонажей в сцене»,
 * карточкой ST чата или участником группы, персоной — или названной в сообщениях чата. Считается один раз на контекст.
 * @param {import('./des-adapter.js').DesApi} des
 * @param {readonly string[]} chatCards
 * @returns {(card: string, variant: string) => boolean}
 */
function chatLocality(des, chatCards) {
    /** @type {Set<string>|null} */
    let cast = null;
    /** @type {Map<string, boolean>} */
    const named = new Map();
    return (card, variant) => {
        cast ??= chatCastKeys(des, chatCards);
        if (cast.has(desNameKey(card))) return true;
        const key = `${card}\u0000${variant}`;
        if (!named.has(key)) named.set(key, namedInChat(card, variant));
        return named.get(key) === true;
    };
}

// ─── Контекст ──────────────────────────────────────────────────────────────

/**
 * @param {import('./des-adapter.js').DesApi} des
 * @returns {import('./lib/russian-names.js').NameContext}
 */
export function buildNameContext(des) {
    const { npc, users, chat } = des.names.cards();
    /** @type {Map<string, string[]>} */
    const cardKeys = new Map();
    for (const name of [...users, ...npc]) {
        const key = desNameKey(name);
        cardKeys.set(key, [...(cardKeys.get(key) ?? []), name]);
    }
    const aliasMap = des.names.aliases();
    const aliasKeys = new Set(Object.values(aliasMap).flat().map((alias) => alias.trim().toLowerCase()));
    const settings = getSettings().modules.names;
    const exceptions = new Set(asArray(settings.exceptions).map(normalizeRussianName));
    const unmerged = new Set(asArray(settings.unmerged).map(pairKey));
    // Скрытые карточки — не цель склейки: среди них и формы имени игрока, из которых DES при загрузке чата делает NPC.
    const hidden = hiddenNames(des);
    return {
        npcCards: npc.filter((name) => !hidden.has(name.toLowerCase())),
        hiddenCards: npc.filter((name) => hidden.has(name.toLowerCase())),
        userCards: users,
        keyOf: desNameKey,
        cardKeys,
        aliasesOf: new Map(Object.entries(aliasMap)),
        steps: steps(),
        isAlias: (name) => aliasKeys.has(name.trim().toLowerCase()),
        isLocal: chatLocality(des, asArray(chat)),
        excluded(variant, canonical) {
            if (exceptions.has(normalizeRussianName(variant)) || exceptions.has(normalizeRussianName(canonical))) return 'в исключениях';
            if (unmerged.has(pairKey({ variant, canonical }))) return 'разъединено вручную';
            if (des.names.dismissedByDes(variant, canonical)) return 'в попапе DES ответили «Нет»';
            return null;
        },
    };
}

/**
 * Имя карточки DES для имени из текста: сама карточка, её алиас или форма, которую склеил бы модуль 2.
 * @param {import('./des-adapter.js').DesApi|null} des
 * @param {string} name
 * @returns {string|null}
 */
export function canonicalCardName(des, name) {
    if (!des || !name) return null;
    const trimmed = String(name).trim();
    const { npc } = des.names.cards();
    if (npc.includes(trimmed)) return trimmed;
    for (const [card, aliases] of Object.entries(des.names.aliases())) {
        if (aliases.some((alias) => alias.trim().toLowerCase() === trimmed.toLowerCase())) return card;
    }
    const decision = decideName(trimmed, buildNameContext(des));
    return decision.action === 'alias' ? decision.canonical : null;
}
