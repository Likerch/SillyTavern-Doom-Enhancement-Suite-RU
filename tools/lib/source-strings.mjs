// Общие части инструментов разработки, которые вытаскивают строки интерфейса из чужого кода
// (tools/extract-des-strings.mjs — DES, tools/extract-ck-strings.mjs — CarrotKernel): разбор JS-литералов,
// плейсхолдеры вместо `${...}`, HTML-сущности и поиск устаревших ключей словаря.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Опции командной строки: `[путь к исходникам] [--missing словарь] [--stale словарь]`.
 * @param {string[]} args
 * @param {string} defaultRoot путь к исходникам по умолчанию (относительно текущей папки)
 */
export function readOptions(args, defaultRoot) {
    /** Значение опции вида `--имя путь`. */
    const option = (name) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : null;
    };
    const missing = option('--missing');
    const stale = option('--stale');
    const optionValues = new Set([missing, stale]);
    const root = path.resolve(args.find((arg) => !arg.startsWith('--') && !optionValues.has(arg)) ?? defaultRoot);
    return { root, missing, stale };
}

/** Все .js в папке и подпапках. */
export function listJs(dir) {
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) result.push(...listJs(full));
        else if (entry.name.endsWith('.js')) result.push(full);
    }
    return result;
}

/**
 * Читает строковый литерал, начинающийся с кавычки в позиции `start`.
 * У частей-выражений `start` — позиция кода выражения (после `${`), чтобы в нём можно было искать вложенные литералы.
 * @returns {{ end: number, parts: (string|{ expr: string, start: number })[] } | null}
 */
export function readLiteral(code, start) {
    const quote = code[start];
    const parts = [];
    let text = '';
    let i = start + 1;
    while (i < code.length) {
        const char = code[i];
        if (char === '\\') {
            const next = code[i + 1];
            text += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            i += 2;
            continue;
        }
        if (char === quote) {
            if (text) parts.push(text);
            return { end: i + 1, parts };
        }
        if (quote === '`' && char === '$' && code[i + 1] === '{') {
            if (text) parts.push(text);
            text = '';
            let depth = 1;
            let j = i + 2;
            while (j < code.length && depth > 0) {
                if (code[j] === '{') depth += 1;
                else if (code[j] === '}') depth -= 1;
                else if (code[j] === '`' || code[j] === '\'' || code[j] === '"') {
                    const inner = readLiteral(code, j);
                    if (!inner) return null;
                    j = inner.end;
                    continue;
                }
                j += 1;
            }
            parts.push({ expr: code.slice(i + 2, j - 1), start: i + 2 });
            i = j;
            continue;
        }
        if (quote !== '`' && char === '\n') return null;
        text += char;
        i += 1;
    }
    return null;
}

/** Вспомогательные функции, чьи имена не годятся в плейсхолдеры: из «escapeHtml(char.name)» берём name. */
export const HELPER_IDENTIFIERS = Object.freeze(['escapeHtml', 'escapeAttr', 'String', 'Number', 'length', 'toFixed', 'trim', 'join', 'map']);

/** Имя плейсхолдера по выражению: последний идентификатор («escapeHtml(char.name)» → name). */
export function placeholderName(expr, used, helpers = HELPER_IDENTIFIERS) {
    const identifiers = expr.match(/[A-Za-z_]\w*/g) ?? [];
    const candidates = identifiers.filter((word) => !helpers.includes(word));
    let name = candidates.at(-1) ?? 'value';
    if (/^\d|\?|===|!==/.test(expr)) name = 'value';
    let unique = name;
    let n = 2;
    while (used.has(unique)) unique = `${name}${n++}`;
    used.add(unique);
    return unique;
}

/** Склеивает части литерала в строку с плейсхолдерами. */
export function joinParts(parts, helpers = HELPER_IDENTIFIERS) {
    const used = new Set();
    return parts.map((part) => (typeof part === 'string' ? part : `{${placeholderName(part.expr, used, helpers)}}`)).join('');
}

export const ENTITIES = Object.freeze({ hellip: '…', mdash: '—', ndash: '–', amp: '&', nbsp: ' ', quot: '"', apos: '\'', lt: '<', gt: '>',
    rarr: '→', larr: '←', uarr: '↑', darr: '↓', times: '×', middot: '·', bull: '•', laquo: '«', raquo: '»', copy: '©', deg: '°' });

/** @param {string} text */
export function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (entity, name) => ENTITIES[name.toLowerCase()] ?? entity);
}

/**
 * Исходники одной строкой: без отступов, JS-экранирования и HTML-сущностей. Три варианта —
 * с `${...}` как есть, без них и с «s» на их месте, чтобы находились и `portrait${s}`, и `card${n === 1 ? '' : 's'}`.
 * @param {string[]} texts содержимое файлов
 */
export function sourceVariants(texts) {
    const decoded = decodeEntities(texts.join('\n')
        .replace(/\\u\{?([0-9a-f]{4,5})\}?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(['"`])/g, '$1'));
    const flat = (text) => text.replace(/\s+/g, ' ');
    return [flat(decoded), flat(decoded.replace(/\$\{[^{}]*\}/g, '')), flat(decoded.replace(/\$\{[^{}]*\}/g, 's'))];
}

/**
 * Ключи словаря, куски которых (текст между плейсхолдерами и тегами) не нашлись ни в одном варианте исходников.
 * @param {string[]} keys
 * @param {string[]} sources результат sourceVariants
 * @returns {Record<string, string>} ключ → ненайденные куски
 */
export function findStale(keys, sources) {
    const stale = {};
    for (const key of keys) {
        if (key.startsWith('__')) continue;
        const missing = key.split(/\{#?\w+(?:\|[^{}]*)?\}|<[^>]+>/)
            .map((piece) => decodeEntities(piece).replace(/\s+/g, ' ').trim())
            .filter((piece) => piece.length >= 3 && /\p{L}/u.test(piece))
            .filter((piece) => !sources.some((source) => source.includes(piece)));
        if (missing.length) stale[key] = missing.map((piece) => JSON.stringify(piece)).join(' | ');
    }
    return stale;
}

/** Ключи словаря в порядке файла. */
export function dictionaryKeys(file) {
    return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Печатает объект как JSON с отступом в 2 пробела и переводом строки в конце. */
export function printJson(object) {
    process.stdout.write(`${JSON.stringify(object, null, 2)}\n`);
}
