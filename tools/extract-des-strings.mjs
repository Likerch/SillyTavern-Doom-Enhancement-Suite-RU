#!/usr/bin/env node
// Инструмент разработки: вытаскивает строки интерфейса из JS-кода DES — уведомления, .text(), заголовки,
// плейсхолдеры, текст HTML-шаблонов. `${...}` превращаются в плейсхолдеры словаря ({name}).
// Пригодится, когда DES обновится: сравнить вывод со словарём и найти новые строки.
//
//   node tools/extract-des-strings.mjs [путь к DES] [--missing locales/ru.json]
//   node tools/extract-des-strings.mjs [путь к DES] --stale locales/ru.json
//
// --missing — строки DES, которых нет в словаре; --stale — ключи словаря, куски которых не нашлись в коде,
// шаблонах, settings.html и whatsnew.json DES (опечатка в ключе или строка, которую DES убрал). Строки, которые DES
// склеивает из нескольких литералов, тоже попадут в отчёт — его надо просмотреть глазами.
//
// Код DES в репозиторий не попадает: инструмент читает vendor/des (он в .gitignore) и печатает только строки.
import fs from 'node:fs';
import path from 'node:path';
import { createDictionary, looksTranslatable, normalizeText } from '../src/lib/dictionary.js';

const args = process.argv.slice(2);
/** Значение опции вида `--имя путь`. */
function option(name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
}
const dictionaryPath = option('--missing');
const stalePath = option('--stale');
const optionValues = new Set([dictionaryPath, stalePath]);
const desRoot = path.resolve(args.find((arg) => !arg.startsWith('--') && !optionValues.has(arg)) ?? 'vendor/des');

/** Модули DES, которые нигде не импортируются (docs/des-recon.md §1.5). */
const DEAD = new Set(['src/systems/ui/mobile.js', 'src/systems/ui/desktop.js', 'src/systems/ui/snowflakes.js',
    'src/systems/rendering/musicPlayer.js', 'src/systems/features/musicPlayer.js', 'src/core/perf.js',
    'src/systems/generation/inventoryParser.js', 'src/utils/migration.js']);

function listJs(dir) {
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
 * @returns {{ end: number, parts: (string|{ expr: string })[] } | null}
 */
function readLiteral(code, start) {
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
            parts.push({ expr: code.slice(i + 2, j - 1) });
            i = j;
            continue;
        }
        if (quote !== '`' && char === '\n') return null;
        text += char;
        i += 1;
    }
    return null;
}

/** Имя плейсхолдера по выражению: последний идентификатор («escapeHtml(char.name)» → name). */
function placeholderName(expr, used) {
    const identifiers = expr.match(/[A-Za-z_]\w*/g) ?? [];
    const candidates = identifiers.filter((word) => !['escapeHtml', 'escapeAttr', 'String', 'Number', 'length', 'toFixed', 'trim', 'join', 'map'].includes(word));
    let name = candidates.at(-1) ?? 'value';
    if (/^\d|\?|===|!==/.test(expr)) name = 'value';
    let unique = name;
    let n = 2;
    while (used.has(unique)) unique = `${name}${n++}`;
    used.add(unique);
    return unique;
}

/** Склеивает части литерала в строку с плейсхолдерами. */
function joinParts(parts) {
    const used = new Set();
    return parts.map((part) => (typeof part === 'string' ? part : `{${placeholderName(part.expr, used)}}`)).join('');
}

const TEXT_IN_HTML = />([^<>]+)</g;
const ATTRIBUTE_IN_HTML = /\b(?:title|placeholder|aria-label)="([^"]*)"/g;

/** @type {Map<string, Set<string>>} */
const found = new Map();
function add(text, where) {
    const value = normalizeText(text.replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, '\''));
    if (!value || !looksTranslatable(value.replace(/\{\w+\}/g, ''))) return;
    if (/^[{}\w]+$/.test(value) && value.includes('{')) return;
    if (!found.has(value)) found.set(value, new Set());
    found.get(value).add(where);
}

const CALL_CONTEXT = /(?:toastr\.(?:success|info|warning|error)\(\s*(?:[^,()]+,\s*)?|\.text\(\s*|textContent\s*=\s*|\.title\s*=\s*|placeholder\s*=\s*|\.attr\(\s*['"](?:title|placeholder|aria-label)['"]\s*,\s*|setAttribute\(\s*['"](?:title|placeholder|aria-label)['"]\s*,\s*|\blabel:\s*|\bt\(\s*'[^']*'\s*,\s*)$/;

const ENTITIES = { hellip: '…', mdash: '—', ndash: '–', amp: '&', nbsp: ' ', quot: '"', apos: '\'', lt: '<', gt: '>',
    rarr: '→', larr: '←', uarr: '↑', darr: '↓', times: '×', middot: '·', bull: '•', laquo: '«', raquo: '»', copy: '©', deg: '°' };

/** @param {string} text */
function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (entity, name) => ENTITIES[name.toLowerCase()] ?? entity);
}

/**
 * Код и разметка DES одной строкой: без отступов, JS-экранирования и HTML-сущностей. Три варианта —
 * с `${...}` как есть, без них и с «s» на их месте, чтобы находились и `portrait${s}`, и `card${n === 1 ? '' : 's'}`.
 */
function desSourceVariants() {
    const files = listJs(path.join(desRoot, 'src'))
        .concat(['index.js', 'template.html', 'settings.html', 'whatsnew.json'].map((name) => path.join(desRoot, name)))
        .filter((file) => fs.existsSync(file) && !DEAD.has(path.relative(desRoot, file).replaceAll('\\', '/')));
    const decoded = decodeEntities(files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
        .replace(/\\u\{?([0-9a-f]{4,5})\}?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(['"`])/g, '$1'));
    const flat = (text) => text.replace(/\s+/g, ' ');
    return [flat(decoded), flat(decoded.replace(/\$\{[^{}]*\}/g, '')), flat(decoded.replace(/\$\{[^{}]*\}/g, 's'))];
}

if (stalePath) {
    const sources = desSourceVariants();
    const stale = {};
    for (const key of Object.keys(JSON.parse(fs.readFileSync(stalePath, 'utf8')))) {
        if (key.startsWith('__')) continue;
        const missing = key.split(/\{#?\w+(?:\|[^{}]*)?\}|<[^>]+>/)
            .map((piece) => decodeEntities(piece).replace(/\s+/g, ' ').trim())
            .filter((piece) => piece.length >= 3 && /\p{L}/u.test(piece))
            .filter((piece) => !sources.some((source) => source.includes(piece)));
        if (missing.length) stale[key] = missing.map((piece) => JSON.stringify(piece)).join(' | ');
    }
    const output = { __desru: `Ключи словаря, куски которых не нашлись в DES (${Object.keys(stale).length}). Значение — ненайденные куски.`, ...stale };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
}

for (const file of listJs(path.join(desRoot, 'src')).concat(path.join(desRoot, 'index.js'))) {
    const relative = path.relative(desRoot, file).replaceAll('\\', '/');
    if (DEAD.has(relative)) continue;
    const code = fs.readFileSync(file, 'utf8');
    let i = 0;
    while (i < code.length) {
        const char = code[i];
        // комментарии
        if (char === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) break; continue; }
        if (char === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
        if (char !== '\'' && char !== '"' && char !== '`') { i += 1; continue; }
        const literal = readLiteral(code, i);
        if (!literal) { i += 1; continue; }
        const line = code.slice(0, i).split('\n').length;
        const where = `${relative}:${line}`;
        const value = joinParts(literal.parts);
        const before = code.slice(Math.max(0, i - 80), i);
        if (/<[a-z][^>]*>|<\/[a-z]+>/i.test(value)) {
            for (const match of value.matchAll(TEXT_IN_HTML)) add(match[1], where);
            for (const match of value.matchAll(ATTRIBUTE_IN_HTML)) add(match[1], where);
        } else if (CALL_CONTEXT.test(before)) {
            add(value, where);
        }
        i = literal.end;
    }
}

let entries = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
if (dictionaryPath) {
    const dictionary = createDictionary(JSON.parse(fs.readFileSync(dictionaryPath, 'utf8')));
    entries = entries.filter(([text]) => dictionary.text(text) === null && dictionary.rich(text) === null);
}
const output = { __desru: `Строки из JS-кода DES (${entries.length}). Ключ — строка, значение — где встречается.` };
for (const [text, places] of entries) output[text] = [...places].slice(0, 3).join(', ');
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
