// Привязки пресетов трекера DES к карточкам — по аватару, а не по номеру.
//
// DES хранит привязку ключом `char_<номер>` (presetManager.characterAssociations), а номер — это место карточки в
// массиве characters ST. Добавили, удалили карточку или ST перечитал список — номера сдвигаются, и пресет молча
// уходит к другой карточке. Надстройка держит свою карту «аватар → пресет» (аватар — имя файла карточки, он
// стабилен) и после каждого сдвига переставляет ключи DES так, чтобы `char_<номер>` снова вёл к своей карточке.
//
// Здесь — только чистая логика: что изменилось в DES, куда переехали карточки, какие ключи записать.

import { desCharEntityIndex, desCharEntityKey } from '../des-adapter.js';

/**
 * @typedef {{ preset: string, avatar: string|null }} SeenKey ключ DES, каким надстройка оставила его в прошлый раз:
 *          пресет и карточка, для которой он записан (`null` — карточки с таким номером не было, ключ чужой)
 *
 * @typedef {object} RekeyReport
 * @property {{ avatar: string, presetId: string, previous: string|null }[]} captured привязки, сделанные в DES
 *           с прошлой сверки (его редактор трекера), — теперь они в карте по аватару
 * @property {{ avatar: string, presetId: string, reason: 'removed'|'preset-gone' }[]} released привязки, которых
 *           больше нет: снята в DES или пресет удалён
 * @property {{ avatar: string, from: string|null, to: string }[]} moved карточки, чей ключ переставлен
 * @property {{ key: string, presetId: unknown, reason: 'moved'|'released'|'foreign' }[]} dropped убранные ключи DES
 * @property {string[]} kept чужие ключи, оставленные как есть
 */

/** @param {unknown} value */
function isDict(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function isId(value) {
    return typeof value === 'string' && value !== '';
}

/**
 * Аватар карточки с этим номером в списке; `null` — карточки нет.
 * @param {ArrayLike<unknown>|Record<number, unknown>|null|undefined} list
 * @param {number} index
 */
function avatarAt(list, index) {
    const value = list?.[index];
    return isId(value) ? value : null;
}

/**
 * Аватары карточек ST по номерам.
 * @param {unknown} characters массив characters ST
 * @returns {(string|null)[]}
 */
export function avatarsOf(characters) {
    return Array.isArray(characters) ? characters.map((character) => (isId(character?.avatar) ? character.avatar : null)) : [];
}

/**
 * Карта «аватар → пресет» без мусора.
 * @param {unknown} shadow
 * @returns {Record<string, string>}
 */
export function cleanShadow(shadow) {
    /** @type {Record<string, string>} */
    const clean = {};
    if (!isDict(shadow)) return clean;
    for (const [avatar, presetId] of Object.entries(/** @type {Record<string, unknown>} */ (shadow))) {
        if (isId(avatar) && isId(presetId)) clean[avatar] = presetId;
    }
    return clean;
}

/**
 * Ключи, какими надстройка оставила их в прошлый раз, без мусора.
 * @param {unknown} seen
 * @returns {Record<string, SeenKey>}
 */
export function cleanSeen(seen) {
    /** @type {Record<string, SeenKey>} */
    const clean = {};
    if (!isDict(seen)) return clean;
    for (const [key, entry] of Object.entries(/** @type {Record<string, any>} */ (seen))) {
        if (desCharEntityIndex(key) === null || !isDict(entry) || !isId(entry.preset)) continue;
        clean[key] = { preset: entry.preset, avatar: isId(entry.avatar) ? entry.avatar : null };
    }
    return clean;
}

/**
 * Сверка привязок DES с картой «аватар → пресет».
 *
 * Правила:
 * 1. **Что изменил DES.** Ключ `char_<n>`, которого не было в прошлый раз или у которого другой пресет, поставил
 *    сам DES (его редактор трекера) для карточки, стоявшей под номером n в тот момент (`oldAvatars`; нет её там —
 *    карточка под этим номером сейчас). Такая привязка попадает в карту по аватару и побеждает то, что там было.
 *    Ключ, который был и пропал, снял DES («Associate» сняли или удалили пресет): привязка карточки снимается.
 * 2. Привязка к пресету, которого больше нет (`presetIds`), снимается.
 * 3. **Куда переехали карточки.** Каждая карточка из карты, которая есть в списке, получает ключ своего
 *    сегодняшнего номера (`newAvatars`); ключ на этом номере перезаписывается.
 * 4. **Остальные ключи `char_*`.** Ключ, записанный для карточки (её сдвинули, привязку сняли, карточки нет в
 *    списке), убирается. Чужой ключ — для номера, под которым не было карточки, — остаётся как есть, пока не
 *    мешает: если под его номером теперь есть карточка, он убирается, иначе DES отдал бы ей пресет, которого к ней
 *    никто не привязывал. Ключи групп `group_<id>` стабильны и не трогаются никогда.
 *
 * Первая сверка (`previous` пуст, `oldAvatars` = `newAvatars`) — это и есть затравка: все ключи DES считаются его
 * изменениями и привязываются к карточкам под их нынешними номерами.
 *
 * @param {object} input
 * @param {Record<string, unknown>|null|undefined} input.associations characterAssociations DES сейчас
 * @param {Record<string, SeenKey>|null|undefined} input.previous ключи `char_*`, какими надстройка оставила их в прошлый раз,
 *        с карточками, для которых они записаны (прежние номера)
 * @param {ArrayLike<unknown>|Record<number, unknown>|null|undefined} input.oldAvatars номер → аватар, когда DES менял ключи
 *        (список прошлой сверки); пусто — нынешний
 * @param {ArrayLike<unknown>|Record<number, unknown>} input.newAvatars номер → аватар сейчас
 * @param {Record<string, string>|null|undefined} input.shadow аватар → id пресета
 * @param {Iterable<string>|null} [input.presetIds] существующие пресеты; `null` — не проверять
 * @returns {{ associations: Record<string, unknown>, shadow: Record<string, string>, seen: Record<string, SeenKey>,
 *            changed: boolean, report: RekeyReport }}
 */
export function rekeyAssociations({ associations, previous, oldAvatars, newAvatars, shadow, presetIds = null }) {
    const nextShadow = cleanShadow(shadow);
    const prev = cleanSeen(previous);
    /** @type {RekeyReport} */
    const report = { captured: [], released: [], moved: [], dropped: [], kept: [] };

    /** @type {Record<string, unknown>} */
    const others = {};
    /** @type {Map<string, unknown>} */
    const current = new Map();
    for (const [key, value] of Object.entries(isDict(associations) ? /** @type {Record<string, unknown>} */ (associations) : {})) {
        if (desCharEntityIndex(key) === null) others[key] = value;
        else current.set(key, value);
    }

    // 1. Что изменил DES с прошлой сверки. owners: ключ → карточка, для которой он записан (null — чужой).
    /** @type {Map<string, string|null>} */
    const owners = new Map();
    for (const key of new Set([...current.keys(), ...Object.keys(prev)])) {
        const index = /** @type {number} */ (desCharEntityIndex(key));
        const value = current.get(key);
        const was = prev[key];
        if (was && value === was.preset) {
            owners.set(key, was.avatar);
            continue;
        }
        if (!current.has(key)) {
            if (was?.avatar && nextShadow[was.avatar] === was.preset) {
                delete nextShadow[was.avatar];
                report.released.push({ avatar: was.avatar, presetId: was.preset, reason: 'removed' });
            }
            continue;
        }
        const owner = isId(value) ? (avatarAt(oldAvatars, index) ?? avatarAt(newAvatars, index)) : null;
        owners.set(key, owner);
        if (owner && nextShadow[owner] !== value) {
            report.captured.push({ avatar: owner, presetId: /** @type {string} */ (value), previous: nextShadow[owner] ?? null });
            nextShadow[owner] = /** @type {string} */ (value);
        }
    }

    // 2. Пресеты, которых больше нет.
    if (presetIds) {
        const existing = new Set(presetIds);
        for (const [avatar, presetId] of Object.entries(nextShadow)) {
            if (existing.has(presetId)) continue;
            delete nextShadow[avatar];
            report.released.push({ avatar, presetId, reason: 'preset-gone' });
        }
    }

    // 3. Нынешние номера карточек из карты.
    /** @type {Map<string, number>} */
    const indexOf = new Map();
    for (const [key, value] of Array.isArray(newAvatars) ? newAvatars.entries() : Object.entries(newAvatars ?? {})) {
        const index = Number(key);
        if (isId(value) && !indexOf.has(value) && Number.isInteger(index) && index >= 0) indexOf.set(value, index);
    }
    /** @type {Map<string, { preset: string, avatar: string }>} */
    const desired = new Map();
    for (const [avatar, presetId] of Object.entries(nextShadow)) {
        const index = indexOf.get(avatar);
        if (index !== undefined) desired.set(desCharEntityKey(index), { preset: presetId, avatar });
    }

    // 4. Итог.
    /** @type {Record<string, unknown>} */
    const result = { ...others };
    /** @type {Record<string, SeenKey>} */
    const seen = {};
    /** @type {Map<string, string>} карточка → её ключ до сверки */
    const keyOf = new Map();
    for (const [key, owner] of owners) {
        if (owner && current.has(key) && !keyOf.has(owner)) keyOf.set(owner, key);
    }
    for (const [key, entry] of desired) {
        result[key] = entry.preset;
        seen[key] = { preset: entry.preset, avatar: entry.avatar };
        const from = keyOf.get(entry.avatar) ?? null;
        if (from !== key) report.moved.push({ avatar: entry.avatar, from, to: key });
    }
    for (const [key, value] of current) {
        if (desired.has(key)) continue;
        const owner = owners.get(key) ?? null;
        if (owner) {
            report.dropped.push({ key, presetId: value, reason: nextShadow[owner] ? 'moved' : 'released' });
            continue;
        }
        if (avatarAt(newAvatars, /** @type {number} */ (desCharEntityIndex(key)))) {
            report.dropped.push({ key, presetId: value, reason: 'foreign' });
            continue;
        }
        result[key] = value;
        if (isId(value)) seen[key] = { preset: value, avatar: null };
        report.kept.push(key);
    }

    const before = [...current.entries()].map(([key, value]) => `${key}=${String(value)}`).sort().join('\n');
    const after = Object.entries(result).filter(([key]) => desCharEntityIndex(key) !== null)
        .map(([key, value]) => `${key}=${String(value)}`).sort().join('\n');
    return { associations: result, shadow: nextShadow, seen, changed: before !== after, report };
}

/**
 * Переименование карточки (новый аватар): привязка и прошлые ключи переходят к новому имени файла.
 * @param {{ shadow: Record<string, string>, seen: Record<string, SeenKey> }} state меняется на месте
 * @param {string} oldAvatar
 * @param {string} newAvatar
 * @returns {boolean} было ли что переносить
 */
export function renameAvatar(state, oldAvatar, newAvatar) {
    if (!isId(oldAvatar) || !isId(newAvatar) || oldAvatar === newAvatar) return false;
    let touched = false;
    if (isId(state.shadow[oldAvatar])) {
        state.shadow[newAvatar] = state.shadow[oldAvatar];
        delete state.shadow[oldAvatar];
        touched = true;
    }
    for (const entry of Object.values(state.seen)) {
        if (entry.avatar !== oldAvatar) continue;
        entry.avatar = newAvatar;
        touched = true;
    }
    return touched;
}
