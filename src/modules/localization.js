/**
 * Модуль 1. Перевод интерфейса DES на русский.
 *
 * Словарь — locales/ru.json (ключ — исходная английская строка) плюс словарь пользователя из панели.
 * Сам перевод делает общий движок src/translator.js по карте DES_UI из des-adapter.js: наблюдение
 * только за корнями DES, данные (имена, значения трекера, поля ввода, лорбуки, текст сообщений) не
 * трогаются, непереведённое копится для пополнения словаря.
 */
import { getContext, notify } from '../st.js';
import { log } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { DES_UI } from '../des-adapter.js';
import { renderTemplate } from '../lib/dictionary.js';
import { createTranslator, downloadJson } from '../translator.js';
import { menuButton } from '../ui.js';

const DICTIONARY_URL = new URL('../../locales/ru.json', import.meta.url);

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {Set<() => void>} */
const changeListeners = new Set();
let notifyTimer = 0;
let dictionaryFailed = false;

/** Живые настройки модуля: панель монтируется раньше, чем модуль включается, поэтому не через env. */
function moduleSettings() {
    return getSettings().modules.localization;
}

/** @param {string} key */
function option(key) {
    return moduleSettings()[key] !== false;
}

function notifyChange() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => changeListeners.forEach((listener) => listener()), 300);
}

const translator = createTranslator({
    id: 'des',
    ui: DES_UI,
    userDictionary: () => moduleSettings().userDictionary,
    options: () => ({ toasts: option('toasts'), collect: option('collect'), collectToasts: option('collect') }),
    onCollect: notifyChange,
});

function onChatChanged() {
    translator.refreshChat();
}

// ─── Панель ────────────────────────────────────────────────────────────────

/**
 * Для отладки и пополнения словаря: что не переведено, где и сколько раз встретилось.
 * @returns {{ text: string, kind: string, where: string, count: number }[]}
 */
export function getUntranslated() {
    return translator.untranslated();
}

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'Словарь интерфейса';
    const stats = document.createElement('small');
    stats.className = 'desru-dict-stats';
    const actions = document.createElement('div');
    actions.className = 'desru-log-actions';
    const exportButton = menuButton('fa-file-export', 'Выгрузить непереведённые (JSON)', () => {
        if (!translator.untranslatedCount()) {
            notify('info', 'Непереведённых строк пока нет');
            return;
        }
        downloadJson('desru-untranslated.json', translator.untranslatedAsDictionary(
            'Непереведённые строки DES. Впиши перевод в значение и вставь в словарь пользователя или пришли разработчику.'));
    });
    const clearButton = menuButton('fa-broom', 'Очистить список', () => {
        translator.clearUntranslated();
        render();
    });
    actions.append(exportButton, clearButton);

    const userLabel = document.createElement('small');
    userLabel.className = 'desru-dict-hint';
    userLabel.textContent = 'Свой словарь: JSON-объект «английская строка → перевод». Перекрывает встроенный; подписи своих полей сцены переводятся только здесь.';
    const editor = document.createElement('textarea');
    editor.className = 'text_pole desru-dict-editor';
    editor.rows = 6;
    editor.spellcheck = false;
    editor.value = JSON.stringify(moduleSettings().userDictionary ?? {}, null, 2);
    const error = document.createElement('small');
    error.className = 'desru-dict-error';
    const saveButton = menuButton('fa-floppy-disk', 'Сохранить словарь', () => {
        try {
            const parsed = JSON.parse(editor.value || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('нужен объект { "English": "Русский" }');
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value !== 'string') throw new Error(`значение для «${key}» должно быть строкой`);
            }
            moduleSettings().userDictionary = parsed;
            saveSettings();
            error.textContent = '';
            if (env) {
                translator.rebuild();
                translator.retranslateAll();
            }
            render();
            notify('success', 'Словарь сохранён');
        } catch (problem) {
            error.textContent = `Ошибка: ${problem.message}`;
        }
    });
    section.append(summary, stats, actions, userLabel, editor, error, saveButton);

    const render = () => {
        const userSize = Object.keys(moduleSettings().userDictionary ?? {}).length;
        stats.textContent = env
            ? renderTemplate('В словаре {n} {n|строка|строки|строк}, своих — {u}. Непереведённых встречено: {m}.',
                { n: String(translator.builtInSize()), u: String(userSize), m: String(translator.untranslatedCount()) })
            : 'Модуль выключен.';
    };
    changeListeners.add(render);
    render();
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'localization',
    number: 1,
    title: 'Локализация интерфейса',
    description: 'Переводит кнопки, подписи, подсказки и уведомления DES. Текст чата, значения трекера, имена и лорбуки не трогает.',
    needs: { ui: true, data: false },
    options: [
        { key: 'toasts', title: 'Переводить уведомления DES', description: 'Всплывающие сообщения DES (успех, ошибки, подсказки) — по словарю.' },
        { key: 'collect', title: 'Собирать непереведённые строки', description: 'Для пополнения словаря: список выгружается в JSON в разделе «Словарь интерфейса».' },
    ],
    section: 'localization',
    mountSection,
    async enable(environment) {
        env = environment;
        dictionaryFailed = false;
        try {
            await translator.load(DICTIONARY_URL);
        } catch (error) {
            dictionaryFailed = true;
            log.error('Локализация: не удалось загрузить locales/ru.json — интерфейс останется английским', error);
        }
        translator.rebuild();
        translator.start();
        getContext().eventSource.on(getContext().eventTypes.CHAT_CHANGED, onChatChanged);
        notifyChange();
        log.info(renderTemplate('Модуль 1 (локализация) включён: в словаре {n} {n|строка|строки|строк}.', { n: String(translator.size()) }));
    },
    disable() {
        getContext().eventSource.removeListener(getContext().eventTypes.CHAT_CHANGED, onChatChanged);
        translator.stop();
        env = null;
        notifyChange();
        log.info('Модуль 1 (локализация) выключен: интерфейс DES снова английский.');
    },
    notes() {
        const notes = [];
        if (dictionaryFailed) notes.push({ level: 'warn', text: 'Встроенный словарь не загрузился — переводятся только строки из своего словаря.' });
        return notes;
    },
};
