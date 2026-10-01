// Журнал надстройки: кольцевой буфер для панели настроек и вывод в консоль с префиксом.

const PREFIX = '[DES-RU]';
const LIMIT = 500;

/** @typedef {{ time: Date, level: 'debug'|'info'|'warn'|'error', message: string, details?: unknown }} LogEntry */

/** @type {LogEntry[]} */
const entries = [];
/** @type {Set<(entry: LogEntry|null) => void>} */
const listeners = new Set();
let debugEnabled = false;

/**
 * @param {LogEntry['level']} level
 * @param {unknown} message
 * @param {unknown} [details]
 */
function push(level, message, details) {
    /** @type {LogEntry} */
    const entry = { time: new Date(), level, message: String(message) };
    if (details !== undefined) entry.details = details;
    entries.push(entry);
    if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);

    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'info';
    if (details === undefined) console[method](PREFIX, entry.message);
    else console[method](PREFIX, entry.message, details);

    notify(entry);
}

/** @param {LogEntry|null} entry `null` — журнал очищен */
function notify(entry) {
    for (const listener of listeners) {
        try {
            listener(entry);
        } catch {
            // Подписчик (панель) не должен ломать журнал.
        }
    }
}

export const log = {
    /** Подробности для отладки: пишутся, только когда включён режим отладки. */
    debug(message, details) {
        if (debugEnabled) push('debug', message, details);
    },
    info(message, details) {
        push('info', message, details);
    },
    warn(message, details) {
        push('warn', message, details);
    },
    error(message, details) {
        push('error', message, details);
    },
    /** @param {boolean} value */
    setDebug(value) {
        debugEnabled = Boolean(value);
    },
    get debugEnabled() {
        return debugEnabled;
    },
    /** @returns {LogEntry[]} */
    entries() {
        return entries.slice();
    },
    clear() {
        entries.length = 0;
        notify(null);
    },
    /**
     * @param {(entry: LogEntry|null) => void} listener
     * @returns {() => void} отписка
     */
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

/**
 * Превращает подробности записи в строку: ошибки — с сообщением, объекты — в JSON (без падений на циклах).
 * @param {unknown} details
 */
export function stringifyDetails(details) {
    if (details instanceof Error) return details.stack || `${details.name}: ${details.message}`;
    if (typeof details === 'string') return details;
    try {
        const seen = new WeakSet();
        return JSON.stringify(details, (key, value) => {
            if (value instanceof Error) return `${value.name}: ${value.message}`;
            if (value && typeof value === 'object') {
                if (seen.has(value)) return '[цикл]';
                seen.add(value);
            }
            return value;
        });
    } catch {
        return String(details);
    }
}

/**
 * Текст журнала для копирования в баг-репорт.
 * @param {LogEntry[]} list
 */
export function formatEntries(list) {
    return list.map((entry) => {
        const head = `${entry.time.toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`;
        return entry.details === undefined ? head : `${head} | ${stringifyDetails(entry.details)}`;
    }).join('\n');
}
