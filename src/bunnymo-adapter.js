/**
 * Адаптер BunnyMo — единственное место, которое знает, как устроены лорбуки BunnyMo: по каким
 * признакам узнать его записи, паки и архивы персонажей, как выглядят теги. BunnyMo — не расширение,
 * а набор лорбуков, поэтому узнаём его по содержимому записей, а не по имени файла (его переименовывают).
 * Подробности — docs/bunnymo-recon.md.
 *
 * Сверено с BunnyMo V3.0 (коммит 7a61c9f) и паками из «BunnMo Packs».
 */

export const BUNNYMO_INFO = Object.freeze({
    displayName: 'BunnyMo',
    repo: 'https://github.com/Coneja-Chibi/BunnyMo',
    verifiedVersion: 'V3.0',
    verifiedCommit: '7a61c9f',
});

/**
 * Записи основного лорбука BunnyMo, которые модуль 5 правит на лету, — по названию записи (comment).
 * Названия у BunnyMo стабильны между версиями, номера записей — нет.
 */
export const BUNNYMO_ENTRIES = Object.freeze({
    /** Автодетекторы #46–#53: английские ключи-эмоции, вставляют блок «X ANALYSIS» в размышления. */
    detectors: Object.freeze([
        Object.freeze({ id: 'jealousy', comment: /AUTO-TRIGGER:\s*Jealousy Detection/i }),
        Object.freeze({ id: 'arousal', comment: /AUTO-TRIGGER:\s*Arousal Pattern Detection/i }),
        Object.freeze({ id: 'trauma', comment: /AUTO-TRIGGER:\s*Trauma Response Detection/i }),
        Object.freeze({ id: 'conflict', comment: /AUTO-TRIGGER:\s*Conflict Style Detection/i }),
        Object.freeze({ id: 'attachment', comment: /AUTO-TRIGGER:\s*Attachment Style Detection/i }),
        Object.freeze({ id: 'flirting', comment: /AUTO-TRIGGER:\s*Flirting Style Detection/i }),
        Object.freeze({ id: 'boundary', comment: /AUTO-TRIGGER:\s*Boundary Recognition Detection/i }),
        Object.freeze({ id: 'sex', comment: /AUTO-TRIGGER:\s*Sex Detection/i }),
    ]),
    /** «Анти-клэнкер» #55–#58 (группа Anti-Clanker): английские регулярки «роботной» речи. */
    antiClanker: /ANTI[\s-]*CLANKER/i,
    /** Из них по умолчанию включена только Alpha (#55): грубая англоязычная тирада от лица {{char}}. */
    antiClankerAlpha: /ANTI[\s-]*CLANKER\s+ALPHA/i,
    /** Постоянные записи, чей текст включает другие записи рекурсией («panic» из Kaomoji → детектор паники и т. п.). */
    noRecursionOut: Object.freeze([/Master - Kaomoji Library/i, /Master - Medicine Check/i, /AUTO-FILTRATION:\s*LINGUISTICS/i]),
    /** Архетипы #12: просит строку «<Имя> <MBTI>» в начале каждого ответа. */
    archetypes: /Master - Archetypes/i,
    /** Признаки основного лорбука: команды листов. */
    sheetCommands: Object.freeze(['!fullsheet', '!quicksheet', '!tagsheet', '!memsheet', '!updatesheet', '!physheet']),
});

/** Тег BunnyMo в ключе записи пака: <SPECIES:ELF>, <DEPRESSION>, <ENFJ-U>. */
const PACK_KEY_RE = /^<([A-Za-z][A-Za-z0-9_\-]*)(?::([^<>]+))?>$/;
/** Блок тегов персонажа: <BunnymoTags>…</BunnymoTags> (без двоеточия — с ним это обёртка записи BunnyMo). */
const TAG_BLOCK_RE = /<bunnymotags>([\s\S]*?)<\/bunnymotags>/i;
const TAG_RE = /<([A-Za-z][A-Za-z0-9_\-]*):([^<>\n]+)>/g;
/** Архетип MBTI без двоеточия: <ESFP-H>, <INTJ-U>. По нему срабатывают записи пака MBTI. */
const MBTI_TAG_RE = /<([EI][NS][FT][JP]-[UH])>/gi;

/** @param {any} entry */
function keysOf(entry) {
    return [...(Array.isArray(entry?.key) ? entry.key : []), ...(Array.isArray(entry?.keysecondary) ? entry.keysecondary : [])]
        .map((key) => String(key).trim()).filter(Boolean);
}

/**
 * Запись основного лорбука BunnyMo? По команде листа в ключах или по одной из известных записей.
 * @param {any} entry
 */
export function isBunnyMoCoreEntry(entry) {
    const comment = String(entry?.comment ?? '');
    if (keysOf(entry).some((key) => BUNNYMO_ENTRIES.sheetCommands.includes(key.toLowerCase()))) return true;
    if (/Master - |AUTO-TRIGGER:|AUTO-FILTRATION:|ANTI[\s-]*CLANKER|HawThorne Link/i.test(comment)) return true;
    return /^<BunnymoTags:/i.test(String(entry?.content ?? '').trimStart());
}

/**
 * Какие лорбуки из сканирования относятся к BunnyMo: основной (по записям) и паки (по ключам-тегам).
 * @param {any[]} entries все записи текущего сканирования (у каждой есть `world`)
 * @returns {{ core: Set<string>, packs: Set<string> }}
 */
export function classifyWorlds(entries) {
    /** @type {Map<string, { core: number, keyed: number, tagged: number }>} */
    const stats = new Map();
    for (const entry of entries) {
        const world = String(entry?.world ?? '');
        if (!world) continue;
        const item = stats.get(world) ?? { core: 0, keyed: 0, tagged: 0 };
        if (isBunnyMoCoreEntry(entry)) item.core += 1;
        const keys = keysOf(entry);
        if (keys.length) {
            item.keyed += 1;
            if (keys.some((key) => PACK_KEY_RE.test(key))) item.tagged += 1;
        }
        stats.set(world, item);
    }
    const core = new Set();
    const packs = new Set();
    for (const [world, item] of stats) {
        if (item.core >= 3) core.add(world);
        else if (item.tagged >= 3 && item.tagged / Math.max(item.keyed, 1) >= 0.6) packs.add(world);
    }
    return { core, packs };
}

/**
 * Словарь тегов, по которым срабатывают паки: КЛЮЧ → значения (верхний регистр). Из ключей записей.
 * @param {any[]} entries записи паков
 * @returns {Map<string, Set<string>>}
 */
export function packVocabulary(entries) {
    /** @type {Map<string, Set<string>>} */
    const vocabulary = new Map();
    for (const entry of entries) {
        for (const key of keysOf(entry)) {
            const match = PACK_KEY_RE.exec(key);
            if (!match?.[2]) continue;
            const name = match[1].toUpperCase();
            if (!vocabulary.has(name)) vocabulary.set(name, new Set());
            vocabulary.get(name).add(match[2].trim().toUpperCase());
        }
    }
    return vocabulary;
}

/**
 * Архив персонажа: запись с блоком <BunnymoTags>, где есть теги (шаблон BunnyMo #43 или архив CarrotKernel).
 * @param {any} entry
 */
export function isCharacterArchive(entry) {
    const block = TAG_BLOCK_RE.exec(String(entry?.content ?? ''));
    return Boolean(block && /<[A-Za-z][A-Za-z0-9_]*:[^<>\n]+>/.test(block[1]));
}

/**
 * Теги персонажа из записи-архива: имя (из <Name:…>), теги <KEY:VALUE> и архетип MBTI (<ESFP-H>).
 * @param {any} entry
 * @returns {{ name: string|null, tags: string[] }}
 */
export function archiveTags(entry) {
    const block = TAG_BLOCK_RE.exec(String(entry?.content ?? ''));
    if (!block) return { name: null, tags: [] };
    let name = null;
    const tags = new Set();
    for (const match of block[1].matchAll(TAG_RE)) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (key.toUpperCase() === 'NAME') name = value;
        else tags.add(`<${key.toUpperCase()}:${value}>`);
    }
    for (const match of block[1].matchAll(MBTI_TAG_RE)) tags.add(`<${match[1].toUpperCase()}>`);
    return { name, tags: [...tags] };
}
