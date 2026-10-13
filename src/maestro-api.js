// Программный интерфейс для Maestro и Officina: `globalThis.DESRU_API`.
//
// Maestro — расширение-«дирижёр» над всем набором (DES, BunnyMo, CK, …). Через этот объект он берёт у надстройки
// склонения имён и алиасы DES и согласует, кто из двоих выполняет пересекающиеся функции: пока Maestro объявил
// функцию своей, надстройка её пропускает. Ничего не сохраняется — Maestro объявляет свои функции при каждом
// запуске; по умолчанию все функции у надстройки, и её поведение не меняется.
//
// Officina (мастерская авторов) через него публикует пресет трекера DES для карточки и привязывает его к карточке
// по аватару (0.9.0, `features`: 'trackerPresets', 'trackerBindingByAvatar').
//
// Объект версионный (`version`): поля только добавляются, смысл существующих не меняется. Несовместимое
// изменение — новая версия. Что добавилось внутри версии, перечислено в `features`.

import { getContext } from './st.js';
import { log } from './log.js';
import { desCharEntityKey } from './des-adapter.js';
import { normalizeRussianName, wordForms } from './lib/russian-names.js';
import { nameFormsKey as buildNameFormsKey } from './lib/regex-keys.js';
import { validateTrackerConfig } from './lib/tracker-config.js';

export const API_VERSION = 1;
export const API_GLOBAL = 'DESRU_API';

/** Что добавилось в версии 1 после 0.8.0: по этим строкам соседи проверяют, есть ли нужные поля. */
export const API_FEATURES = Object.freeze(['trackerPresets', 'trackerBindingByAvatar']);

/** id пресета, который можно задать самому: как у DES (`preset_…`) или свой, без пробелов и разметки. */
const PRESET_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_PRESET_NAME = 200;

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

// ─── Пресеты трекера DES и привязка по аватару (Officina) ─────────────────

/**
 * @typedef {{ ok: true }|{ ok: false, error: string, errors?: string[] }} ApiResult
 * Коды ошибок: `unavailable` — DES или его пресеты недоступны (гард, модуль 4 выключен вместе с DES); `off` —
 * выключен переключатель «Пресет трекера — у своей карточки» (модуль 4); `editor-open` — открыт редактор трекера
 * DES, он сохранит своё поверх; `invalid` — в `errors` что не так; `not-found` — нет такого пресета; `last` —
 * последний пресет DES не удаляет; `no-card` — карточки с таким аватаром нет в списке ST.
 */

/**
 * @param {() => import('./des-adapter.js').DesApi|null} des
 * @param {() => import('./preset-bindings.js').PresetBindings|null} bindings
 */
function createTrackerApi(des, bindings) {
    const presets = () => {
        try {
            const facet = des()?.presets;
            return facet?.available() ? facet : null;
        } catch (error) {
            log.warn('API: пресеты трекера DES не прочитались', error);
            return null;
        }
    };
    /** @param {string[]} errors */
    const invalid = (errors) => ({ ok: /** @type {false} */ (false), error: 'invalid', errors });

    const trackerPresets = Object.freeze({
        /** @returns {{ id: string, name: string }[]} */
        list: () => presets()?.list() ?? [],
        /** @param {string} id @returns {{ id: string, name: string, trackerConfig: any }|null} копия */
        get: (id) => (typeof id === 'string' ? presets()?.get(id) ?? null : null),
        /** Проверить trackerConfig, ничего не записывая. @param {unknown} trackerConfig @returns {string[]} ошибки */
        validate: (trackerConfig) => validateTrackerConfig(trackerConfig).errors,
        /**
         * Создать пресет (без `id` или с новым) или заменить существующий. Ничего не пишет, если что-то не так.
         * @param {{ id?: string|null, name: string, trackerConfig: unknown }} input
         * @returns {{ ok: true, id: string }|{ ok: false, error: string, errors?: string[] }}
         */
        save(input) {
            const facet = presets();
            if (!facet) return { ok: false, error: 'unavailable' };
            if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid(['нужен объект { id?, name, trackerConfig }']);
            /** @type {string[]} */
            const errors = [];
            const id = input.id ?? null;
            if (id !== null && (typeof id !== 'string' || !PRESET_ID.test(id))) errors.push('id: латиница, цифры и _ . : - (до 128 знаков) или без id — тогда новый');
            const name = typeof input.name === 'string' ? input.name.trim() : '';
            if (!name) errors.push('name: нужно непустое название пресета');
            else if (name.length > MAX_PRESET_NAME) errors.push(`name: не длиннее ${MAX_PRESET_NAME} знаков`);
            const checked = validateTrackerConfig(input.trackerConfig);
            errors.push(...checked.errors.map((error) => (error.startsWith('trackerConfig') ? error : `trackerConfig.${error}`)));
            if (errors.length) return invalid(errors);
            if (facet.editorOpen()) return { ok: false, error: 'editor-open' };
            const savedId = facet.write({ id, name, trackerConfig: checked.config });
            if (!savedId) return { ok: false, error: 'unavailable' };
            log.info(`API: пресет трекера «${name}» (${savedId}) записан в DES.`);
            return { ok: true, id: savedId };
        },
        /**
         * Удалить пресет вместе с его привязками (штатно в DES; был активным — DES загрузит первый оставшийся).
         * @param {string} id
         * @returns {ApiResult}
         */
        remove(id) {
            const facet = presets();
            if (!facet) return { ok: false, error: 'unavailable' };
            if (typeof id !== 'string' || !facet.has(id)) return { ok: false, error: 'not-found' };
            if (facet.editorOpen()) return { ok: false, error: 'editor-open' };
            if (!facet.remove(id)) return { ok: false, error: 'last' };
            bindings()?.sync({ reason: 'пресет удалён через API' });
            log.info(`API: пресет трекера ${id} удалён из DES.`);
            return { ok: true };
        },
    });

    const trackerBinding = Object.freeze({
        /** Работает ли привязка по аватару (переключатель модуля 4 и пресеты DES на месте). */
        active: () => Boolean(bindings()),
        /**
         * Пресет карточки. Пока привязка по аватару работает — из её карты; выключена — что DES сейчас выберет для
         * карточки по её номеру.
         * @param {string} avatar
         * @returns {string|null}
         */
        get(avatar) {
            if (typeof avatar !== 'string' || !avatar) return null;
            const running = bindings();
            if (running) return running.get(avatar);
            const facet = presets();
            const characters = getContext().characters;
            const index = Array.isArray(characters) ? characters.findIndex((character) => character?.avatar === avatar) : -1;
            const presetId = index >= 0 ? facet?.associations()?.[desCharEntityKey(index)] : null;
            return typeof presetId === 'string' && facet?.has(presetId) ? presetId : null;
        },
        /**
         * Привязать пресет к карточке (`null` — снять привязку). У открытой карточки DES сразу выбирает пресет заново.
         * @param {string} avatar
         * @param {string|null} presetId
         * @returns {ApiResult}
         */
        set(avatar, presetId) {
            const running = bindings();
            if (!running) return { ok: false, error: presets() ? 'off' : 'unavailable' };
            return running.set(avatar, presetId);
        },
    });

    return { trackerPresets, trackerBinding };
}

// ─── Объект API ────────────────────────────────────────────────────────────

/**
 * @typedef {object} DesRuApi
 * @property {number} version
 * @property {readonly string[]} features что добавилось в версии 1 (API_FEATURES)
 * @property {(name: string) => string[]} nameForms
 * @property {(name: string) => string|null} nameFormsKey
 * @property {() => Record<string, string[]>} aliases алиасы DES: имя карточки → алиасы (копия)
 * @property {(listener: () => void) => () => void} onNamesChanged
 * @property {() => string[]} functions
 * @property {(ids: string[]) => void} setMaestroOwned
 * @property {() => string[]} maestroOwned
 * @property {ReturnType<typeof createTrackerApi>['trackerPresets']} trackerPresets пресеты трекера DES
 * @property {ReturnType<typeof createTrackerApi>['trackerBinding']} trackerBinding привязка пресета к карточке по аватару
 */

/**
 * @param {{ des: () => import('./des-adapter.js').DesApi|null, bindings?: () => import('./preset-bindings.js').PresetBindings|null }} deps
 *        живой DES, пока гард разрешает работу с данными; работающая привязка по аватару
 * @returns {Readonly<DesRuApi>}
 */
export function createApi({ des, bindings = () => null }) {
    const { trackerPresets, trackerBinding } = createTrackerApi(des, bindings);
    return Object.freeze({
        version: API_VERSION,
        features: API_FEATURES,
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
        trackerPresets,
        trackerBinding,
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
