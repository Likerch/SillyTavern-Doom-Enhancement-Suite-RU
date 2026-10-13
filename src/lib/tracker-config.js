// Проверка trackerConfig пресета DES, который пишут через API (Officina): чтобы в настройки DES не попало то, на чём
// DES 2.6.0 падает, что он молча выкидывает или что ломает его шаблон трекера. Чего DES не читает, не проверяется:
// старые пресеты с лишними полями проходят как есть.

import { DES_TRACKER, desDetailKey, desSceneFieldKey } from '../des-adapter.js';

/** Предел размера пресета в JSON: он целиком живёт в settings.json и уходит на сервер при каждом сохранении. */
export const MAX_TRACKER_CONFIG_LENGTH = 200000;
const MAX_DEPTH = 32;

/** @param {unknown} value */
function isDict(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Значение JSON: объекты, массивы, строки, конечные числа, true/false/null.
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} errors
 * @param {number} depth
 */
function checkJson(value, path, errors, depth = 0) {
    if (errors.length > 20) return;
    const at = path || 'trackerConfig';
    // undefined JSON выбрасывает (редактор DES сам так очищает min/max); в массиве он станет null — это поймают проверки формы.
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) errors.push(`${at}: число должно быть конечным`);
        return;
    }
    if (depth > MAX_DEPTH) {
        errors.push(`${at}: слишком глубокая вложенность`);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => checkJson(item, `${path}[${index}]`, errors, depth + 1));
        return;
    }
    const proto = typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
    if (proto === Object.prototype || proto === null) {
        for (const [key, item] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
            checkJson(item, path ? `${path}.${key}` : key, errors, depth + 1);
        }
        return;
    }
    errors.push(`${at}: не JSON (${typeof value})`);
}

/**
 * Проверки одного объекта: поля известных типов, если они есть.
 * @param {string[]} errors
 */
function checker(errors) {
    return {
        /** @param {Record<string, unknown>} object @param {string} path @param {string[]} keys */
        booleans(object, path, keys) {
            for (const key of keys) {
                if (object[key] !== undefined && typeof object[key] !== 'boolean') errors.push(`${path}.${key}: нужно true или false`);
            }
        },
        /** @param {Record<string, unknown>} object @param {string} path @param {string[]} keys */
        strings(object, path, keys) {
            for (const key of keys) {
                if (object[key] !== undefined && typeof object[key] !== 'string') errors.push(`${path}.${key}: нужна строка`);
            }
        },
        /**
         * Строка, которую DES вставляет в JSON-шаблон трекера без экранирования: кавычка или обратная косая ломают шаблон.
         * @param {unknown} value @param {string} path
         */
        raw(value, path) {
            if (typeof value === 'string' && /["\\]/.test(value)) {
                errors.push(`${path}: DES вставляет этот текст в JSON-шаблон трекера как есть — двойная кавычка или «\\» его ломают; используйте «ёлочки»`);
            }
        },
        /** @param {unknown} value @param {string} path */
        name(value, path) {
            if (typeof value !== 'string' || !value.trim()) errors.push(`${path}: нужно непустое название`);
        },
    };
}

/**
 * Свои поля (сцены или персонажа): общие правила.
 * @param {unknown} list
 * @param {string} path
 * @param {string[]} errors
 * @param {{ keyOf: (name: string) => string, scene: boolean }} options
 */
function checkCustomFields(list, path, errors, { keyOf, scene }) {
    const check = checker(errors);
    const ids = new Set();
    /** @type {Map<string, string>} ключ → название */
    const keys = new Map();
    const cyrillicNames = new Set();
    /** @type {unknown[]} */ (list).forEach((field, index) => {
        const at = `${path}[${index}]`;
        if (!isDict(field)) {
            errors.push(`${at}: нужен объект поля`);
            return;
        }
        const item = /** @type {Record<string, unknown>} */ (field);
        if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`${at}.id: нужен непустой id`);
        else if (ids.has(item.id)) errors.push(`${at}.id: id «${item.id}» уже есть у другого поля`);
        else ids.add(item.id);
        check.name(item.name, `${at}.name`);
        if (typeof item.enabled !== 'boolean') errors.push(`${at}.enabled: нужно true или false`);
        check.booleans(item, at, ['persistInHistory']);
        check.strings(item, at, ['description', 'icon']);
        if (item.type !== undefined && !DES_TRACKER.fieldTypes.includes(/** @type {string} */ (item.type))) {
            errors.push(`${at}.type: у DES нет типа «${String(item.type)}» (есть ${DES_TRACKER.fieldTypes.join(', ')})`);
        }
        if (item.options !== undefined && (!Array.isArray(item.options) || item.options.some((option) => typeof option !== 'string' || !option.trim()))) {
            errors.push(`${at}.options: нужен список непустых строк`);
        }
        if (item.type === 'enum' && !(Array.isArray(item.options) && item.options.length)) {
            errors.push(`${at}.options: у поля-выбора (enum) нужны варианты — без них DES молча делает из него текст`);
        }
        for (const bound of ['min', 'max']) {
            if (item[bound] !== undefined && !Number.isFinite(item[bound])) errors.push(`${at}.${bound}: нужно число`);
        }
        if (Number.isFinite(item.min) && Number.isFinite(item.max) && Number(item.min) > Number(item.max)) errors.push(`${at}: min больше max`);
        // Поле персонажа без типа DES вставляет описанием в шаблон как есть (поля сцены и типизированные — экранирует).
        if (!scene && (item.type === undefined || item.type === 'text')) check.raw(item.description, `${at}.description`);

        if (typeof item.name !== 'string' || !item.name.trim()) return;
        const key = keyOf(item.name);
        if (!key) {
            if (scene) {
                errors.push(`${at}.name: «${item.name}» — DES строит ключ поля сцены из латиницы и молча выбросит это поле; назовите его латиницей (русскую подпись даёт словарь модуля 1)`);
                return;
            }
            // Кириллическое название поля персонажа: ключ пустой, названия в шаблон возвращает модуль 4 — лишь бы не повторялись.
            const lower = item.name.trim().toLowerCase();
            if (cyrillicNames.has(lower)) errors.push(`${at}.name: поле «${item.name}» уже есть`);
            cyrillicNames.add(lower);
            return;
        }
        if (scene && DES_TRACKER.reservedSceneKeys.includes(key)) {
            errors.push(`${at}.name: ключ «${key}» занят встроенным полем сцены DES — DES выбросит это поле`);
            return;
        }
        if (keys.has(key)) errors.push(`${at}.name: «${item.name}» даёт тот же ключ «${key}», что и «${keys.get(key)}»`);
        else keys.set(key, item.name);
    });
}

/**
 * Проверка trackerConfig пресета DES 2.6.0.
 *
 * - `infoBox` — объект с `widgets` (известные виджеты DES, `date` обязателен: редактор трекера читает его без
 *   проверки) и необязательными `customFields` — своими полями сцены с латинскими названиями без повторов ключей
 *   и без встроенных ключей (такие DES молча выбрасывает).
 * - `presentCharacters` — объект с массивом `customFields` (редактор трекера перебирает его без проверки), не больше
 *   `DES_TRACKER.maxCharacterFields` полей, id и ключи без повторов; `thoughts`, `relationships`,
 *   `relationshipFields`, `characterStats` — если есть, нужной формы.
 * - `quests` — если есть, объект.
 * - Текст, который DES вставляет в шаблон трекера без экранирования (описания полей персонажа, формат даты,
 *   описание мыслей, варианты отношений, названия статов), — без двойных кавычек и «\».
 * - Весь объект — JSON не длиннее MAX_TRACKER_CONFIG_LENGTH.
 *
 * @param {unknown} config
 * @returns {{ ok: boolean, errors: string[], config: any }} `config` — копия для записи (при ошибках `null`)
 */
export function validateTrackerConfig(config) {
    /** @type {string[]} */
    const errors = [];
    if (!isDict(config)) return { ok: false, errors: ['trackerConfig: нужен объект'], config: null };
    checkJson(config, '', errors);
    if (errors.length) return { ok: false, errors, config: null };
    const text = JSON.stringify(config);
    if (text.length > MAX_TRACKER_CONFIG_LENGTH) {
        return { ok: false, errors: [`trackerConfig: ${text.length} символов в JSON, предел ${MAX_TRACKER_CONFIG_LENGTH}`], config: null };
    }
    const check = checker(errors);
    const tracker = /** @type {Record<string, any>} */ (config);

    // Сцена.
    const infoBox = tracker.infoBox;
    if (!isDict(infoBox)) {
        errors.push('infoBox: нужен объект (поля сцены)');
    } else {
        const widgets = infoBox.widgets;
        if (!isDict(widgets)) {
            errors.push('infoBox.widgets: нужен объект виджетов сцены');
        } else {
            for (const name of DES_TRACKER.requiredWidgets) {
                if (widgets[name] === undefined) errors.push(`infoBox.widgets.${name}: обязателен — редактор трекера DES читает его без проверки`);
            }
            for (const [name, widget] of Object.entries(widgets)) {
                const at = `infoBox.widgets.${name}`;
                if (!DES_TRACKER.widgets.includes(name)) {
                    errors.push(`${at}: у DES нет такого виджета (есть ${DES_TRACKER.widgets.join(', ')})`);
                    continue;
                }
                if (!isDict(widget)) {
                    errors.push(`${at}: нужен объект`);
                    continue;
                }
                check.booleans(widget, at, ['enabled', 'persistInHistory']);
                check.strings(widget, at, ['format', 'prompt']);
                if (name === 'date') check.raw(widget.format, `${at}.format`);
                if (widget.unit !== undefined && !DES_TRACKER.temperatureUnits.includes(widget.unit)) {
                    errors.push(`${at}.unit: нужно ${DES_TRACKER.temperatureUnits.join(' или ')}`);
                }
            }
        }
        if (infoBox.customFields !== undefined) {
            if (!Array.isArray(infoBox.customFields)) errors.push('infoBox.customFields: нужен массив');
            else checkCustomFields(infoBox.customFields, 'infoBox.customFields', errors, { keyOf: desSceneFieldKey, scene: true });
        }
    }

    // Присутствующие.
    const present = tracker.presentCharacters;
    if (!isDict(present)) {
        errors.push('presentCharacters: нужен объект (поля персонажей)');
    } else {
        check.booleans(present, 'presentCharacters', ['showEmoji', 'showName']);
        if (!Array.isArray(present.customFields)) {
            errors.push('presentCharacters.customFields: нужен массив (можно пустой) — редактор трекера DES перебирает его без проверки');
        } else {
            if (present.customFields.length > DES_TRACKER.maxCharacterFields) {
                errors.push(`presentCharacters.customFields: полей ${present.customFields.length}, можно не больше ${DES_TRACKER.maxCharacterFields} — каждое поле добавляет строку каждому персонажу в шаблоне и в ответе модели`);
            }
            checkCustomFields(present.customFields, 'presentCharacters.customFields', errors, { keyOf: desDetailKey, scene: false });
        }
        if (present.thoughts !== undefined) {
            if (!isDict(present.thoughts)) errors.push('presentCharacters.thoughts: нужен объект');
            else {
                check.booleans(present.thoughts, 'presentCharacters.thoughts', ['enabled', 'persistInHistory']);
                check.strings(present.thoughts, 'presentCharacters.thoughts', ['name', 'description']);
                check.raw(present.thoughts.description, 'presentCharacters.thoughts.description');
            }
        }
        if (present.relationships !== undefined) {
            if (!isDict(present.relationships)) errors.push('presentCharacters.relationships: нужен объект');
            else {
                check.booleans(present.relationships, 'presentCharacters.relationships', ['enabled']);
                check.strings(present.relationships, 'presentCharacters.relationships', ['prompt']);
                const emojis = present.relationships.relationshipEmojis;
                if (emojis !== undefined && (!isDict(emojis) || Object.values(emojis).some((emoji) => typeof emoji !== 'string'))) {
                    errors.push('presentCharacters.relationships.relationshipEmojis: нужен объект «отношение → эмодзи»');
                }
            }
        }
        if (present.relationshipEmojis !== undefined && (!isDict(present.relationshipEmojis) || Object.values(present.relationshipEmojis).some((emoji) => typeof emoji !== 'string'))) {
            errors.push('presentCharacters.relationshipEmojis: нужен объект «отношение → эмодзи»');
        }
        if (present.relationshipFields !== undefined) {
            if (!Array.isArray(present.relationshipFields) || present.relationshipFields.some((name) => typeof name !== 'string' || !name.trim())) {
                errors.push('presentCharacters.relationshipFields: нужен список непустых строк');
            } else {
                present.relationshipFields.forEach((name, index) => check.raw(name, `presentCharacters.relationshipFields[${index}]`));
            }
        }
        const stats = present.characterStats;
        if (stats !== undefined) {
            if (!isDict(stats)) errors.push('presentCharacters.characterStats: нужен объект');
            else {
                check.booleans(stats, 'presentCharacters.characterStats', ['enabled']);
                if (stats.customStats !== undefined) {
                    if (!Array.isArray(stats.customStats)) errors.push('presentCharacters.characterStats.customStats: нужен массив');
                    else {
                        const ids = new Set();
                        stats.customStats.forEach((stat, index) => {
                            const at = `presentCharacters.characterStats.customStats[${index}]`;
                            if (!isDict(stat)) {
                                errors.push(`${at}: нужен объект стата`);
                                return;
                            }
                            if (typeof stat.id !== 'string' || !stat.id.trim()) errors.push(`${at}.id: нужен непустой id`);
                            else if (ids.has(stat.id)) errors.push(`${at}.id: id «${stat.id}» уже есть у другого стата`);
                            else ids.add(stat.id);
                            check.name(stat.name, `${at}.name`);
                            check.raw(stat.name, `${at}.name`);
                            if (typeof stat.enabled !== 'boolean') errors.push(`${at}.enabled: нужно true или false`);
                            check.strings(stat, at, ['colorLow', 'colorHigh']);
                        });
                    }
                }
            }
        }
    }

    // Квесты.
    if (tracker.quests !== undefined) {
        if (!isDict(tracker.quests)) errors.push('quests: нужен объект');
        else check.booleans(tracker.quests, 'quests', ['persistInHistory']);
    }

    return errors.length ? { ok: false, errors, config: null } : { ok: true, errors, config: JSON.parse(text) };
}
