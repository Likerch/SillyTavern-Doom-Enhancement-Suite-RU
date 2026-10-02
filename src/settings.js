// Настройки надстройки живут в extension_settings под собственным ключом.
// В ключи DES мы пишем только там, где это явно предусмотрено (алиасы, модуль 2).

import { getContext } from './st.js';

export const SETTINGS_KEY = 'desru';

/** Значения по умолчанию. Не изменять на месте: `fillDefaults` копирует их. */
export const DEFAULT_SETTINGS = {
    settingsVersion: 1,
    debug: false,
    modules: {
        localization: { enabled: true, toasts: true, collect: true, userDictionary: {} },
        // exceptions: имена, которые не склеивать; journal: склейки { variant, canonical, kind, via, at }; unmerged: разъединённые пары;
        // caseAliasesAdded: алиасы-написания (нижний регистр, без ё), которые модуль дописал сам
        names: {
            enabled: true, aliasForms: true, nominativePrompt: true, nameSteps: true, caseAliases: true, personaForms: true,
            speakerColors: true, sheets: true, exceptions: [], journal: [], unmerged: [], caseAliasesAdded: [],
        },
        // userWeatherWords: свой словарь погоды { тип: [слова] }; null — встроенный
        serviceValues: { enabled: true, weatherWords: true, weatherPrompt: true, timePrompt: true, userWeatherWords: null },
        fixes: { enabled: true, fieldKeys: true, offScene: true, noQuest: true, keepTranslations: true },
        bunnymo: { enabled: true, languageLock: true, detectors: true, antiClanker: true, archetypes: true, archiveKeys: true, normalizer: true, packTags: true },
        carrotKernel: { enabled: true, cyrillicNames: true, dumpFilter: true, desButtons: true, translateUi: true, toasts: true, collect: true, userDictionary: {} },
    },
};

/** @param {unknown} value */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Дописывает в `target` недостающие ключи из `defaults`, рекурсивно для вложенных объектов.
 * То, что пользователь уже настроил, не трогает; испорченный вложенный объект заменяет копией по умолчанию.
 * @template T
 * @param {Record<string, any>} target
 * @param {T} defaults
 * @returns {T}
 */
export function fillDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        const current = target[key];
        if (current === undefined || (isPlainObject(value) && !isPlainObject(current))) {
            target[key] = structuredClone(value);
        } else if (isPlainObject(value)) {
            fillDefaults(current, value);
        }
    }
    return /** @type {T} */ (target);
}

/** @returns {typeof DEFAULT_SETTINGS} живой объект настроек из extension_settings */
export function getSettings() {
    const { extensionSettings } = getContext();
    if (!isPlainObject(extensionSettings[SETTINGS_KEY])) extensionSettings[SETTINGS_KEY] = {};
    return fillDefaults(extensionSettings[SETTINGS_KEY], DEFAULT_SETTINGS);
}

export function saveSettings() {
    getContext().saveSettingsDebounced();
}
