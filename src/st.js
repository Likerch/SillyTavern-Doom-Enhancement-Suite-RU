// Единственное место, которое знает, как достучаться до SillyTavern.
// Модули ST импортируются динамически: если ST переименует файл, надстройка
// не упадёт при загрузке, а запишет понятную ошибку в свой журнал.

import { log } from './log.js';

/** Корень `/scripts/` ST, считается от нашего адреса: .../scripts/extensions/third-party/<папка>/src/st.js */
const ST_SCRIPTS_ROOT = new URL('../../../../', import.meta.url);

/** Имя надстройки для ST в формате `third-party/<папка>`; папка совпадает с именем репозитория. */
export const ADDON_NAME = (() => {
    const match = decodeURIComponent(import.meta.url).match(/extensions\/(third-party\/[^/]+)\//);
    return match ? match[1] : null;
})();

export function getContext() {
    return SillyTavern.getContext();
}

/**
 * @param {string} path путь от `/scripts/`, например `extensions.js`
 * @returns {Promise<any>} пространство имён модуля ST
 */
export function importSt(path) {
    return import(new URL(path, ST_SCRIPTS_ROOT).href);
}

/**
 * Внутренние имена всех расширений ST; при сбое — только имя по умолчанию.
 * @param {string} fallback
 * @returns {Promise<string[]>}
 */
export async function listExtensionNames(fallback) {
    try {
        const { extensionNames } = await importSt('extensions.js');
        if (Array.isArray(extensionNames) && extensionNames.length) return extensionNames;
    } catch (error) {
        log.warn('Не удалось получить список расширений ST, ищу по имени по умолчанию', error);
    }
    return [fallback];
}

/**
 * Скрипт расширения на странице: ST вставляет `<script type="module" src="/scripts/extensions/<имя>/<js>">`.
 * Его адрес — основа для импорта модулей расширения: тот же адрес, что оно использует само.
 * @param {string} name
 * @param {any} manifest
 * @returns {string|null}
 */
export function findExtensionScript(name, manifest) {
    const suffix = `/scripts/extensions/${name}/${manifest?.js || 'index.js'}`;
    for (const script of document.querySelectorAll('script[type="module"][src]')) {
        try {
            if (decodeURIComponent(new URL(script.src, location.href).pathname).endsWith(suffix)) return script.src;
        } catch {
            // Битый src чужого скрипта — пропускаем.
        }
    }
    return null;
}

/** Место применения регулярки ST «ответ модели» (regex_placement.AI_OUTPUT в extensions/regex/engine.js). */
const REGEX_AI_OUTPUT = 2;

/**
 * Глобальные регулярки ST (расширение Regex), которые меняют ответы модели только в промпте
 * («Alter Outgoing Prompt»): так их видит модель, а чат и сканирование лорбуков — нет.
 * @returns {{ name: string, regex: RegExp, replace: string }[]}
 */
export function outgoingPromptRegexes() {
    const scripts = getContext().extensionSettings?.regex;
    const result = [];
    for (const script of Array.isArray(scripts) ? scripts : []) {
        if (!script || script.disabled || !script.promptOnly || !script.placement?.includes?.(REGEX_AI_OUTPUT)) continue;
        const match = String(script.findRegex ?? '').match(/^\/([\s\S]+)\/([a-z]*)$/);
        if (!match) continue;
        try {
            result.push({ name: String(script.scriptName ?? ''), regex: new RegExp(match[1], match[2]), replace: String(script.replaceString ?? '') });
        } catch {
            // Битая регулярка — ST её тоже не применит.
        }
    }
    return result;
}

/** Позиции extension-промптов ST (extension_prompt_types в script.js). */
export const PROMPT_POSITION = Object.freeze({ NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 });
/** Роли extension-промптов ST (extension_prompt_roles в script.js). */
export const PROMPT_ROLE = Object.freeze({ SYSTEM: 0, USER: 1, ASSISTANT: 2 });

/**
 * Перерисовать сообщение после правки его текста (то же, что ST делает при редактировании).
 * @param {number} messageId
 */
export function rerenderMessage(messageId) {
    const ctx = getContext();
    const message = ctx.chat?.[messageId];
    if (!message || !document.querySelector(`#chat .mes[mesid="${messageId}"]`)) return;
    ctx.updateMessageBlock(messageId, message);
}

/** Класс наших уведомлений: локализация их пропускает — это не строки DES. */
export const OWN_TOAST_CLASS = 'desru-toast';

/**
 * Уведомление надстройки (toastr ST) с нашим заголовком и классом.
 * @param {'success'|'info'|'warning'|'error'} kind
 * @param {string} message
 * @param {Record<string, unknown>} [options] опции toastr
 */
export function notify(kind, message, options = {}) {
    const toastClass = `${toastr.options?.toastClass ?? 'toast'} ${OWN_TOAST_CLASS}`;
    toastr[kind](message, 'DES — RU', { ...options, toastClass });
}

/**
 * Вызывает `callback` один раз, когда ST сообщит о готовности приложения.
 * APP_READY у ST «липкий»: подписка после события срабатывает сразу.
 * @param {() => void} callback
 */
export function onAppReady(callback) {
    const { eventSource, eventTypes } = getContext();
    let called = false;
    const handler = () => {
        if (called) return;
        called = true;
        eventSource.removeListener(eventTypes.APP_READY, handler);
        callback();
    };
    eventSource.on(eventTypes.APP_READY, handler);
}
