// Контекст для решений об именах (decideName): карточки и алиасы DES плюс исключения пользователя.
// Общий для модуля 2 (склейка имён) и модуля 5 (имя в листе BunnyMo → имя карточки).

import { getSettings } from './settings.js';
import { desNameKey } from './des-adapter.js';
import { decideName, normalizeRussianName } from './lib/russian-names.js';

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
 * @param {import('./des-adapter.js').DesApi} des
 * @returns {import('./lib/russian-names.js').NameContext}
 */
export function buildNameContext(des) {
    const { npc, users } = des.names.cards();
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
    return {
        npcCards: npc,
        userCards: users,
        keyOf: desNameKey,
        cardKeys,
        aliasesOf: new Map(Object.entries(aliasMap)),
        steps: steps(),
        isAlias: (name) => aliasKeys.has(name.trim().toLowerCase()),
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
