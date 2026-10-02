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
// Общие части с tools/extract-ck-strings.mjs — в tools/lib/source-strings.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createDictionary, looksTranslatable, normalizeText } from '../src/lib/dictionary.js';
import { dictionaryKeys, findStale, joinParts, listJs, printJson, readLiteral, readOptions, sourceVariants } from './lib/source-strings.mjs';

const { root: desRoot, missing: dictionaryPath, stale: stalePath } = readOptions(process.argv.slice(2), 'vendor/des');

/** Модули DES, которые нигде не импортируются (docs/des-recon.md §1.5). */
const DEAD = new Set(['src/systems/ui/mobile.js', 'src/systems/ui/desktop.js', 'src/systems/ui/snowflakes.js',
    'src/systems/rendering/musicPlayer.js', 'src/systems/features/musicPlayer.js', 'src/core/perf.js',
    'src/systems/generation/inventoryParser.js', 'src/utils/migration.js']);

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

/** Код и разметка DES, в которых ищутся куски ключей для --stale. */
function desSources() {
    const files = listJs(path.join(desRoot, 'src'))
        .concat(['index.js', 'template.html', 'settings.html', 'whatsnew.json'].map((name) => path.join(desRoot, name)))
        .filter((file) => fs.existsSync(file) && !DEAD.has(path.relative(desRoot, file).replaceAll('\\', '/')));
    return sourceVariants(files.map((file) => fs.readFileSync(file, 'utf8')));
}

if (stalePath) {
    const stale = findStale(dictionaryKeys(stalePath), desSources());
    printJson({ __desru: `Ключи словаря, куски которых не нашлись в DES (${Object.keys(stale).length}). Значение — ненайденные куски.`, ...stale });
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
printJson(output);
