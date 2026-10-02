/**
 * Модуль 3. Служебные значения трекера: погода и время.
 *
 * 1. Русская погода для эффектов DES: дописываем в русский словарь погоды DES (только в памяти) формы,
 *    которых в нём нет, — «дождливо», «вьюга», «безоблачно». DES кэширует разбор прогноза навсегда,
 *    поэтому слова дописываются ещё при загрузке надстройки (preload), раньше, чем ST откроет чат.
 * 2. Погода по-русски в промпте: DES просит одно английское слово; в режиме together меняем эту
 *    инструкцию в шаблоне трекера на список русских слов, которые DES понимает.
 * 3. Время как ЧЧ:ММ: по часам DES решает, день или ночь; просим модель писать время с часами.
 *
 * Значения в трекере не меняются: и пользователь, и модель видят то, что модель написала.
 */
import { getContext, notify } from '../st.js';
import { log } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { DES_KEYS, DES_MODE_NAMES, DES_WEATHER, desForecastField, desHourOf, desTimeField, desWeatherTypeOf, importDesModuleEarly } from '../des-adapter.js';
import { DEFAULT_WEATHER_WORDS, addWeatherWords, normalizeWeatherWords, sameWeatherWords } from '../lib/weather-words.js';
import { TIME_INSTRUCTION_RU, TIME_PLACEHOLDER_RU, WEATHER_INSTRUCTION_RU, replaceExact } from '../lib/service-prompt.js';
import { copyText, menuButton } from '../ui.js';

/** Как эффекты DES называются для пользователя. */
const EFFECT_NAMES = Object.freeze({
    blizzard: 'метель', storm: 'гроза', wind: 'ветер', snow: 'снег', rain: 'дождь', mist: 'туман',
    sunny: 'ясно', none: 'без эффекта',
});
/** В группу `none` дописывать бессмысленно: она проверяется последней. */
const EDITABLE_TYPES = DES_WEATHER.types.filter((type) => type !== 'none');

const OPTIONS = [
    {
        key: 'weatherWords',
        title: 'Русская погода для эффектов DES',
        description: 'Дописывает в словарь погоды DES формы вроде «дождливо», «моросит», «вьюга», «безоблачно», чтобы срабатывали дождь, снег и туман. Только в памяти, значения в трекере не меняются.',
    },
    {
        key: 'weatherPrompt',
        title: 'Погода по-русски в промпте',
        description: 'DES просит модель писать погоду одним английским словом. Просим одно русское слово из списка, который DES понимает. Режим «Вместе с ответом».',
    },
    {
        key: 'timePrompt',
        title: 'Время как ЧЧ:ММ',
        description: 'Просим модель писать время в трекере с часами: по ним DES решает, день сейчас или ночь (солнце, луна, звёзды). Режим «Вместе с ответом».',
    },
];

/** @type {import('../core.js').AddonEnv|null} */
let env = null;
/** @type {(() => void)|null} снять наши слова из словаря DES */
let undoWords = null;
/** @type {unknown} таблица DES, в которую слова сейчас дописаны */
let wordsTable = null;
/** @type {Array<[string, (...args: any[]) => unknown]>} */
let subscriptions = [];
const loggedOnce = new Set();
/** @type {Set<() => void>} */
const changeListeners = new Set();

function moduleSettings() {
    return getSettings().modules.serviceValues;
}

/** @param {string} key */
function option(key) {
    return moduleSettings()?.[key] !== false;
}

/** @param {string} key @param {'info'|'warn'} level @param {string} message */
function logOnce(key, level, message) {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    log[level](message);
}

function notifyChange() {
    for (const listener of changeListeners) {
        try {
            listener();
        } catch (error) {
            log.warn('Служебные значения: панель не обновилась', error);
        }
    }
}

function isTogetherMode() {
    return env?.des?.generationMode() === DES_KEYS.togetherMode;
}

// ─── 1. Словарь погоды ─────────────────────────────────────────────────────

/** Слова, которые дописываем: свои, если пользователь их сохранил, иначе встроенные. */
function currentWords() {
    const saved = moduleSettings()?.userWeatherWords;
    if (saved && typeof saved === 'object') return normalizeWeatherWords(saved, EDITABLE_TYPES).words;
    return DEFAULT_WEATHER_WORDS;
}

/**
 * Дописывает слова в словарь погоды DES; свои прежние сначала снимает.
 * @param {Record<string, { id: string, patterns: string[] }[]>|undefined} table WEATHER_PATTERNS_BY_LANGUAGE
 * @param {string} reason для журнала
 */
function applyWords(table, reason) {
    removeWords();
    if (!option('weatherWords')) return;
    const groups = table?.[DES_WEATHER.language];
    if (!Array.isArray(groups)) {
        logOnce('words:no-table', 'warn', 'Служебные значения: у DES нет русского словаря погоды — слова не дописаны.');
        return;
    }
    const { added, missingTypes, undo } = addWeatherWords(groups, currentWords());
    undoWords = undo;
    wordsTable = table;
    log.info(`Служебные значения: в словарь погоды DES дописано слов: ${added.length} (${reason}).`);
    if (missingTypes.length) {
        logOnce('words:types', 'warn', `Служебные значения: у DES нет типов погоды ${missingTypes.join(', ')} — эти слова пропущены.`);
    }
}

function removeWords() {
    wordsTable = null;
    if (!undoWords) return;
    undoWords();
    undoWords = null;
}

/** После правки словаря на ходу: дописать заново и пересчитать эффект. */
function reapplyWords(reason) {
    if (!env?.des) return;
    applyWords(env.des.weather.table(), reason);
    env.des.weather.refresh();
    log.info('Служебные значения: прогнозы, которые DES уже разобрал, он помнит до перезагрузки страницы.');
    notifyChange();
}

// ─── 2–3. Подсказки модели в шаблоне трекера ───────────────────────────────

/** Сразу после того, как DES запишет инструкцию трекера (GENERATION_STARTED), правим погоду и время. */
function rewritePrompt() {
    if (!isTogetherMode()) return;
    const slot = env.des.trackerInstructionSlot();
    if (!slot?.value) return;
    let text = slot.value;
    const changed = [];
    // Фоновые генерации тоже шлют GENERATION_STARTED, а DES переписывает слот не на каждой: правка уже может стоять.
    const ourWeather = desForecastField(WEATHER_INSTRUCTION_RU);
    const ourTime = desTimeField(TIME_PLACEHOLDER_RU, TIME_PLACEHOLDER_RU);
    if (option('weatherPrompt') && !env.des.weather.customInstruction() && !text.includes(ourWeather)) {
        const result = replaceExact(text, desForecastField(env.des.weather.defaultInstruction()), ourWeather);
        if (result.replaced) {
            text = result.text;
            changed.push('погода');
        } else if (env.des.weather.inPrompt()) {
            logOnce('prompt:weather', 'warn', 'Служебные значения: в шаблоне трекера нет штатной инструкции погоды DES — оставляю как есть.');
        }
    }
    if (option('timePrompt') && !text.includes(ourTime)) {
        const result = replaceExact(text, desTimeField(), ourTime);
        if (result.replaced) {
            text = result.text;
            changed.push('время');
        } else {
            logOnce('prompt:time', 'warn', 'Служебные значения: в шаблоне трекера нет штатного поля времени DES — оставляю как есть.');
        }
    }
    if (!changed.length) return;
    slot.value = text;
    log.debug(`Служебные значения: шаблон трекера поправлен (${changed.join(', ')}).`);
    logOnce('prompt:ok', 'info', `Служебные значения: в шаблоне трекера по-русски — ${changed.join(' и ')}.`);
}

/**
 * @param {'on'|'makeFirst'|'makeLast'} method
 * @param {string} event
 * @param {(...args: any[]) => unknown} handler
 */
function subscribe(method, event, handler) {
    const safe = (...args) => {
        if (!env?.des) return;
        try {
            return handler(...args);
        } catch (error) {
            log.error(`Служебные значения: сбой в обработчике ${event}`, error);
        }
    };
    getContext().eventSource[method](event, safe);
    subscriptions.push([event, safe]);
}

// ─── Панель ────────────────────────────────────────────────────────────────

/** @param {string} text */
function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * @param {string} className
 * @param {string} [text]
 */
function small(className, text = '') {
    const element = document.createElement('small');
    element.className = className;
    element.textContent = text;
    return element;
}

/** @param {HTMLElement} section */
function mountSection(section) {
    section.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = 'Погода и служебные значения';

    const hint = small('desru-dict-hint', 'Слова погоды по типам эффектов DES. DES ищет слово как часть прогноза: «дожд» поймает и «дождь», и «дождливо». '
        + 'Короткие куски ловят лишнее — «гроз» сработал бы и на «угроза». Нужны включённые «Русская погода для эффектов DES» и «Динамическая погода» в DES.');

    const grid = document.createElement('div');
    grid.className = 'desru-weather-grid';
    /** @type {Map<string, HTMLInputElement>} */
    const inputs = new Map();
    for (const type of EDITABLE_TYPES) {
        const label = document.createElement('label');
        label.className = 'desru-weather-row';
        const name = document.createElement('span');
        name.textContent = capitalize(EFFECT_NAMES[type] ?? type);
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'text_pole';
        input.spellcheck = false;
        inputs.set(type, input);
        label.append(name, input);
        grid.append(label);
    }
    const fill = () => {
        const words = currentWords();
        for (const [type, input] of inputs) input.value = (words[type] ?? []).join(', ');
    };

    const status = small('desru-dict-error');
    const store = (words) => {
        moduleSettings().userWeatherWords = !words || sameWeatherWords(words, DEFAULT_WEATHER_WORDS) ? null : words;
        saveSettings();
        fill();
        reapplyWords('правка словаря');
    };
    const saveButton = menuButton('fa-floppy-disk', 'Сохранить слова', () => {
        const draft = Object.fromEntries([...inputs].map(([type, input]) => [type, input.value]));
        const { words, rejected } = normalizeWeatherWords(draft, EDITABLE_TYPES);
        store(words);
        status.textContent = rejected.length
            ? `Пропущены: ${rejected.map((word) => `«${word}»`).join(', ')} — нужно от трёх букв, только буквы, пробелы и дефисы.`
            : '';
        notify('success', 'Слова погоды сохранены');
    });
    const resetButton = menuButton('fa-rotate-left', 'Вернуть встроенные', () => {
        store(null);
        status.textContent = '';
        notify('success', 'Встроенные слова погоды восстановлены');
    });
    const actions = document.createElement('div');
    actions.className = 'desru-log-actions';
    actions.append(saveButton, resetButton);

    const tester = document.createElement('input');
    tester.type = 'text';
    tester.className = 'text_pole';
    tester.placeholder = 'Проверить прогноз, например «моросит»';
    const testResult = small('desru-dict-hint');
    const runTest = () => {
        const text = tester.value.trim();
        if (!text) {
            testResult.textContent = '';
        } else if (!env?.des) {
            testResult.textContent = 'Модуль не работает — проверить не на чем.';
        } else {
            const type = desWeatherTypeOf(text, env.des.weather.table());
            testResult.textContent = type === 'none' ? 'DES: без эффекта.' : `DES: эффект «${EFFECT_NAMES[type] ?? type}».`;
        }
    };
    tester.addEventListener('input', runTest);

    const promptHint = small('desru-dict-hint', 'В режимах «Отдельным запросом» и «Внешний API» подсказки модели не доходят. Вставьте в редакторе промптов DES в поле «Инструкция для погоды»:');
    const promptText = document.createElement('textarea');
    promptText.className = 'text_pole desru-dict-editor';
    promptText.rows = 2;
    promptText.readOnly = true;
    promptText.value = WEATHER_INSTRUCTION_RU;
    const copyButton = menuButton('fa-copy', 'Скопировать', async () => {
        if (await copyText(WEATHER_INSTRUCTION_RU)) notify('success', 'Инструкция для погоды скопирована');
        else notify('error', 'Не удалось скопировать');
    });
    const timeHint = small('desru-dict-hint', `А для времени — допишите в конец «Инструкций трекера»: «${TIME_INSTRUCTION_RU}»`);

    section.append(summary, hint, grid, actions, status, tester, testResult, promptHint, promptText, copyButton, timeHint);
    fill();
    changeListeners.add(runTest);
}

// ─── Модуль ────────────────────────────────────────────────────────────────

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'serviceValues',
    number: 3,
    title: 'Служебные значения',
    description: 'Учит DES понимать русскую погоду в любой форме и просит модель писать время как ЧЧ:ММ, чтобы работали эффекты погоды и смена дня и ночи.',
    needs: { ui: true, data: true },
    options: OPTIONS,
    section: 'serviceValues',
    mountSection,
    async preload() {
        if (!option('weatherWords')) return;
        const weather = await importDesModuleEarly('weather');
        if (weather) applyWords(weather.WEATHER_PATTERNS_BY_LANGUAGE, 'при загрузке');
    },
    enable(environment) {
        env = environment;
        const { eventTypes } = getContext();
        // Обычно слова уже дописаны ранним шагом в ту же таблицу — тогда второй раз не трогаем.
        const table = env.des.weather.table();
        if (!undoWords || wordsTable !== table) applyWords(table, 'при включении');
        // DES пишет инструкцию трекера в своём обработчике GENERATION_STARTED — правим сразу после него.
        subscribe('makeLast', eventTypes.GENERATION_STARTED, rewritePrompt);
        env.des.weather.refresh();
        notifyChange();
        log.info('Модуль 3 (служебные значения) включён.');
    },
    disable() {
        const { eventSource } = getContext();
        for (const [event, handler] of subscriptions) eventSource.removeListener(event, handler);
        subscriptions = [];
        removeWords();
        env?.des?.weather.refresh();
        env = null;
        notifyChange();
        log.info('Модуль 3 (служебные значения) выключен.');
    },
    onOptionChange(key) {
        if (key === 'weatherWords') reapplyWords('переключатель');
    },
    /** Замечания для панели: что мешает эффектам и что сейчас в трекере. */
    notes() {
        if (!env?.des) return [];
        const weather = env.des.weather;
        const notes = [];
        if (!weather.effectsEnabled()) {
            notes.push({ level: 'warn', text: 'Эффекты погоды в DES выключены (настройки DES → «Динамическая погода»): словарь погоды пока ни на что не влияет.' });
        }
        if (!weather.inPrompt()) {
            notes.push({ level: 'info', text: 'Поля погоды нет в шаблоне трекера: модель её не пишет, эффектам не из чего взяться. Включается переключателем «Погода» в настройках трекера сцены DES.' });
        }
        const mode = env.des.generationMode();
        if (mode !== DES_KEYS.togetherMode && (option('weatherPrompt') || option('timePrompt'))) {
            notes.push({ level: 'warn', text: `Режим генерации DES — «${DES_MODE_NAMES[mode] ?? mode}»: подсказки модели в этом режиме не доходят. Готовый текст для редактора промптов DES — в разделе «Погода и служебные значения».` });
        }
        if (option('weatherPrompt') && weather.customInstruction()) {
            notes.push({ level: 'info', text: 'В редакторе промптов DES задана своя «Инструкция для погоды» — её не трогаем.' });
        }
        const { forecast, time } = weather.current();
        if (forecast) {
            const type = desWeatherTypeOf(forecast, weather.table());
            notes.push({ level: 'info', text: `Сейчас в трекере погода «${forecast}» → ${type === 'none' ? 'без эффекта' : `эффект «${EFFECT_NAMES[type] ?? type}»`}.` });
        }
        if (time && desHourOf(time) === null) {
            notes.push({ level: 'warn', text: `Время в трекере «${time}» без часов: DES не поймёт, день сейчас или ночь, и нарисует дневное небо.` });
        }
        return notes;
    },
};
