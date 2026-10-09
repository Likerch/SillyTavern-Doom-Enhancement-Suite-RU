/**
 * Теги BunnyMo по персонажам: паки срабатывают только для тех, кто сейчас в сцене.
 *
 * Архив персонажа срабатывает по имени, а его теги (<DERE:TSUNDERE>) подтягивают описания из паков. Модуль 5
 * кладёт теги во вставку «только для сканирования», чтобы срабатывали и паки с запретом рекурсии. Раньше там
 * лежали теги всех, чьи архивы сработали последними, и их паки шли каждый ход, даже когда персонаж давно ушёл.
 * Теперь теги хранятся по персонажу, а во вставку идут только теги тех, кто в сцене по трекеру DES (без трекера —
 * тех, чьи архивы сработали в последней генерации).
 *
 * Чистые функции: модуль хранит результат в chat_metadata.
 */

export const SCENE_TAGS_VERSION = 2;
/** Сколько персонажей помним в одном чате (самые давние уходят первыми). */
export const SCENE_TAGS_CHARACTERS = 40;

/**
 * @typedef {{ version: 2, chars: Record<string, { tags: string[], at: number }>, last: string[] }} SceneTagStore
 */

/** @returns {SceneTagStore} */
export function emptySceneTags() {
    return { version: SCENE_TAGS_VERSION, chars: {}, last: [] };
}

/** @param {unknown} value */
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []);

/**
 * Сохранённое значение → хранилище. Старый формат `{ names, tags }` (общие теги последней генерации) становится
 * тегами каждого из этих имён: лишнее отсеет первая же новая генерация.
 * @param {unknown} saved
 * @returns {SceneTagStore}
 */
export function readSceneTags(saved) {
    const store = emptySceneTags();
    if (!saved || typeof saved !== 'object') return store;
    const value = /** @type {Record<string, any>} */ (saved);
    if (value.version === SCENE_TAGS_VERSION && value.chars && typeof value.chars === 'object') {
        for (const [name, entry] of Object.entries(value.chars)) {
            const tags = strings(entry?.tags);
            if (name.trim() && tags.length) store.chars[name] = { tags, at: Number(entry?.at) || 0 };
        }
        store.last = strings(value.last);
        return store;
    }
    const tags = strings(value.tags);
    const names = strings(value.names);
    if (!tags.length) return store;
    for (const name of names) store.chars[name] = { tags: [...tags], at: 0 };
    store.last = names;
    return store;
}

/**
 * Архивы, сработавшие в этой генерации, → теги каждого персонажа заменяются свежими.
 * @param {SceneTagStore} store
 * @param {{ name: string|null, tags: string[] }[]} archives
 * @param {number} at
 * @returns {SceneTagStore}
 */
export function recordSceneTags(store, archives, at) {
    const named = archives.filter((archive) => archive.name && archive.name.trim() && archive.tags.length);
    if (!named.length) return store;
    const chars = { ...store.chars };
    for (const archive of named) chars[/** @type {string} */ (archive.name).trim()] = { tags: [...new Set(archive.tags)], at };
    const kept = Object.entries(chars).sort((a, b) => b[1].at - a[1].at).slice(0, SCENE_TAGS_CHARACTERS);
    return {
        version: SCENE_TAGS_VERSION,
        chars: Object.fromEntries(kept),
        last: [...new Set(named.map((archive) => /** @type {string} */ (archive.name).trim()))],
    };
}

/** @param {string} name */
const fold = (name) => String(name ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Один ли это персонаж: то же имя, имя без фамилии («Neia» и «Neia Caigella») или одна группа алиасов DES.
 * @param {string} a
 * @param {string} b
 * @param {string[][]} groups
 */
export function sameCharacter(a, b, groups = []) {
    const x = fold(a);
    const y = fold(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const first = (value) => value.split(' ')[0];
    if ((x.includes(' ') || y.includes(' ')) && first(x) === first(y) && (x === first(x) || y === first(y))) return true;
    return groups.some((group) => group.some((name) => fold(name) === x) && group.some((name) => fold(name) === y));
}

/**
 * Группы алиасов DES: каноническое имя → другие имена.
 * @param {Record<string, string[]>|null|undefined} aliases
 * @returns {string[][]}
 */
export function aliasGroups(aliases) {
    if (!aliases || typeof aliases !== 'object') return [];
    return Object.entries(aliases).map(([canonical, list]) => [canonical, ...strings(list)]);
}

/**
 * Теги для вставки: персонажи в сцене (`present`), а без трекера — те, чьи архивы сработали последними.
 * @param {SceneTagStore} store
 * @param {string[]|null} present имена из трекера DES; null — трекера нет
 * @param {string[][]} [groups] группы алиасов DES
 * @returns {{ names: string[], tags: string[] }}
 */
export function sceneTagList(store, present, groups = []) {
    const wanted = present ?? store.last;
    const names = [];
    const tags = new Set();
    for (const [name, entry] of Object.entries(store.chars)) {
        if (!wanted.some((other) => sameCharacter(name, other, groups))) continue;
        names.push(name);
        entry.tags.forEach((tag) => tags.add(tag));
    }
    return { names, tags: [...tags] };
}
