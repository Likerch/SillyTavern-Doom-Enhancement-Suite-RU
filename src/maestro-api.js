// Программный интерфейс для Maestro: `globalThis.DESRU_API`.
//
// Maestro — расширение-«дирижёр» над всем набором (DES, BunnyMo, CK, …). Через этот объект он берёт у надстройки
// склонения имён и алиасы DES и согласует, кто из двоих выполняет пересекающиеся функции: пока Maestro объявил
// функцию своей, надстройка её пропускает. Ничего не сохраняется — Maestro объявляет свои функции при каждом
// запуске; по умолчанию все функции у надстройки, и её поведение не меняется.
//
// Объект версионный (`version`): поля только добавляются, смысл существующих не меняется. Несовместимое
// изменение — новая версия.

import { log } from './log.js';
import { normalizeRussianName, wordForms } from './lib/russian-names.js';
import { nameFormsKey as buildNameFormsKey } from './lib/regex-keys.js';

export const API_VERSION = 1;
export const API_GLOBAL = 'DESRU_API';

/**
 * Функции, которые Maestro может взять на себя:
 * - `bunnymo.structuralPatches` — модуль 5 не ставит записям BunnyMo флаги рекурсии (excludeRecursion у детекторов
 *   и «анти-клэнкера», preventRecursion у Kaomoji, Medicine Check и LINGUISTICS); русские ключи, текст и падежи
 *   архивов остаются;
 * - `bunnymo.scanTags` — модуль 5 не пишет теги персонажей сцены во вставку «только для сканирования»;
 * - `ck.consistencyRebuild` — модуль 6 не пересобирает вставку тегов CK («Character Consistency»).
 */
export const MAESTRO_FUNCTIONS = Object.freeze(['bunnymo.structuralPatches', 'ck.consistencyRebuild', 'bunnymo.scanTags']);

/** Предел форм у имени из многих слов: формы — все сочетания форм слов, и их число растёт как произведение. */
const MAX_NAME_FORMS = 1000;

/** @type {Set<string>} */
const owned = new Set();
/** @type {Set<() => void>} */
const ownershipListeners = new Set();
/** @type {Set<() => void>} */
const namesListeners = new Set();

/**
 * @param {Iterable<() => void>} listeners
 * @param {string} what
 */
function callAll(listeners, what) {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (error) {
            log.warn(`API для Maestro: подписчик на ${what} упал`, error);
        }
    }
}

// ─── Согласование функций ──────────────────────────────────────────────────

/**
 * Взял ли Maestro функцию на себя. Модули спрашивают на лету, в момент работы.
 * @param {string} id одно из MAESTRO_FUNCTIONS
 */
export function isMaestroOwned(id) {
    return owned.has(id);
}

/** @returns {string[]} функции Maestro в порядке MAESTRO_FUNCTIONS */
export function maestroOwned() {
    return MAESTRO_FUNCTIONS.filter((id) => owned.has(id));
}

/**
 * Функции, которые сейчас у Maestro, — ровно эти (замена, а не добавление); `[]` возвращает все надстройке.
 * Незнакомые id пропускаются: более новый Maestro может знать функции, которых в этой версии нет.
 * @param {readonly string[]} ids
 */
export function setMaestroOwned(ids) {
    if (!Array.isArray(ids)) throw new TypeError('setMaestroOwned: нужен массив id функций');
    const unknown = ids.filter((id) => !MAESTRO_FUNCTIONS.includes(id));
    if (unknown.length) log.warn(`API для Maestro: незнакомые функции пропущены: ${unknown.join(', ')}`);
    const next = new Set(ids.filter((id) => MAESTRO_FUNCTIONS.includes(id)));
    if (next.size === owned.size && [...next].every((id) => owned.has(id))) return;
    owned.clear();
    next.forEach((id) => owned.add(id));
    const list = maestroOwned();
    log.info(list.length ? `Maestro взял на себя: ${list.join(', ')}. Надстройка эти функции пропускает.` : 'Все функции снова у надстройки: Maestro ничего не ведёт.');
    callAll(ownershipListeners, 'смену владельца функций');
}

/**
 * Подписка модулей надстройки на смену владельца функций (например, сразу очистить свой слот).
 * @param {() => void} listener
 * @returns {() => void} отписка
 */
export function onOwnershipChange(listener) {
    ownershipListeners.add(listener);
    return () => ownershipListeners.delete(listener);
}

// ─── Имена ─────────────────────────────────────────────────────────────────

/** Модуль 2 изменил алиасы DES или скрытые имена: сообщить подписчикам API. */
export function notifyNamesChanged() {
    callAll(namesListeners, 'изменение имён');
}

/**
 * Форма слова с регистром и «ё» исходного слова: совпадающее начало берётся из него («Алёна» → «Алёны»,
 * «Павел» → «Павлу»). Слово целиком заглавными — форма тоже.
 * @param {string} original слово как написано
 * @param {string} normalized оно же нормализованное (нижний регистр, ё → е)
 * @param {string} form нормализованная форма
 */
function restoreSpelling(original, normalized, form) {
    if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) return form.toUpperCase();
    const chars = [...form];
    const source = [...original];
    const plain = [...normalized];
    for (let index = 0; index < chars.length && index < plain.length && chars[index] === plain[index]; index += 1) {
        chars[index] = source[index] ?? chars[index];
    }
    return chars.join('');
}

/**
 * Все падежные формы имени, первой — само имя (пробелы схлопнуты). Формы — для поиска имени в тексте: с ними и те,
 * что совпадают с другим именем («Александра» у «Александр», «Петрова» у «Петров»), поэтому алиасами DES их делать
 * нельзя. У имени из нескольких слов — все сочетания форм слов (их же покрывает nameFormsKey). Несклоняемое имя и
 * латиница — только само имя.
 * @param {unknown} name
 * @returns {string[]}
 */
export function nameForms(name) {
    const words = String(name ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return [];
    const perWord = words.map((word) => {
        const normalized = normalizeRussianName(word);
        return [...new Set([word, ...wordForms(normalized, { genitive: true }).map((form) => restoreSpelling(word, normalized, form))])];
    });
    /** @type {string[]} */
    let forms = [''];
    for (const options of perWord) {
        const next = [];
        for (const prefix of forms) {
            for (const option of options) {
                next.push(prefix ? `${prefix} ${option}` : option);
                if (next.length >= MAX_NAME_FORMS) break;
            }
            if (next.length >= MAX_NAME_FORMS) break;
        }
        forms = next;
    }
    return [...new Set(forms)];
}

/**
 * Ключ-регулярка ST для имени во всех падежах (`/…/iu`): границы слова по Unicode, ё и е взаимозаменяемы, пробелы —
 * любые. `null` — имя пустое.
 * @param {unknown} name
 * @returns {string|null}
 */
export function nameFormsKey(name) {
    return buildNameFormsKey(String(name ?? ''), (word) => wordForms(word, { genitive: true }));
}

// ─── Объект API ────────────────────────────────────────────────────────────

/**
 * @typedef {object} DesRuApi
 * @property {number} version
 * @property {(name: string) => string[]} nameForms
 * @property {(name: string) => string|null} nameFormsKey
 * @property {() => Record<string, string[]>} aliases алиасы DES: имя карточки → алиасы (копия)
 * @property {(listener: () => void) => () => void} onNamesChanged
 * @property {() => string[]} functions
 * @property {(ids: string[]) => void} setMaestroOwned
 * @property {() => string[]} maestroOwned
 */

/**
 * @param {{ des: () => import('./des-adapter.js').DesApi|null }} deps живой DES, пока гард разрешает работу с данными
 * @returns {Readonly<DesRuApi>}
 */
export function createApi({ des }) {
    return Object.freeze({
        version: API_VERSION,
        nameForms,
        nameFormsKey,
        aliases() {
            try {
                return des()?.names.aliases() ?? {};
            } catch (error) {
                log.warn('API для Maestro: алиасы DES не прочитались', error);
                return {};
            }
        },
        onNamesChanged(listener) {
            if (typeof listener !== 'function') throw new TypeError('onNamesChanged: нужна функция');
            namesListeners.add(listener);
            return () => {
                namesListeners.delete(listener);
            };
        },
        functions: () => [...MAESTRO_FUNCTIONS],
        setMaestroOwned,
        maestroOwned,
    });
}

/**
 * Выставить `globalThis.DESRU_API`.
 * @param {Parameters<typeof createApi>[0]} deps
 */
export function installApi(deps) {
    globalThis[API_GLOBAL] = createApi(deps);
}

/** Убрать `globalThis.DESRU_API`: функции возвращаются надстройке, подписчики забываются. */
export function uninstallApi() {
    delete globalThis[API_GLOBAL];
    namesListeners.clear();
    if (owned.size) setMaestroOwned([]);
}
