#!/usr/bin/env node
// Проверка locales/ru.json: дубли ключей, плейсхолдеры, теги в HTML-подсказках.
//   node tools/check-dictionary.mjs [путь к словарю]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER_IN_KEY = /\{#?(\w+)\}/g;
const PLACEHOLDER_IN_VALUE = /\{#?(\w+)(?:\|[^{}]*)?\}/g;
const TAG = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;

/**
 * Ключи верхнего уровня в порядке появления — чтобы поймать дубли, которые JSON.parse молча склеивает.
 * Словарь пишется по одной записи на строку, поэтому хватает построчного разбора.
 * @param {string} text
 */
function topLevelKeys(text) {
    const keys = [];
    for (const line of text.split('\n')) {
        const match = line.match(/^\s*("(?:[^"\\]|\\.)*")\s*:/);
        if (match) keys.push(JSON.parse(match[1]));
    }
    return keys;
}

/** @param {string} value @param {RegExp} pattern */
function names(value, pattern) {
    return [...value.matchAll(pattern)].map((match) => match[1]);
}

/** @param {string} value */
function tags(value) {
    return names(value, TAG).map((tag) => tag.toLowerCase()).sort().join(' ');
}

/**
 * @param {string} file
 * @returns {{ errors: string[], warnings: string[], stats: { entries: number, empty: number } }}
 */
export function checkDictionary(file) {
    const text = fs.readFileSync(file, 'utf8');
    const errors = [];
    const warnings = [];
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return { errors: [`не JSON: ${error.message}`], warnings, stats: { entries: 0, empty: 0 } };
    }

    const seen = new Set();
    for (const key of topLevelKeys(text)) {
        if (seen.has(key)) errors.push(`дубль ключа: ${JSON.stringify(key)}`);
        seen.add(key);
    }

    let entries = 0;
    let empty = 0;
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('__')) continue;
        if (typeof value !== 'string') {
            errors.push(`значение не строка: ${JSON.stringify(key)}`);
            continue;
        }
        if (!value.trim()) {
            empty += 1;
            continue;
        }
        entries += 1;
        const keyNames = new Set(names(key, PLACEHOLDER_IN_KEY));
        for (const name of names(value, PLACEHOLDER_IN_VALUE)) {
            if (!keyNames.has(name)) errors.push(`в переводе плейсхолдер {${name}}, которого нет в ключе: ${JSON.stringify(key)}`);
        }
        for (const name of keyNames) {
            if (!names(value, PLACEHOLDER_IN_VALUE).includes(name)) warnings.push(`перевод теряет {${name}}: ${JSON.stringify(key)}`);
        }
        if (tags(key) !== tags(value)) errors.push(`теги не совпадают (${tags(key) || '—'} → ${tags(value) || '—'}): ${JSON.stringify(key)}`);
    }
    return { errors, warnings, stats: { entries, empty } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const file = process.argv[2] ?? new URL('../locales/ru.json', import.meta.url);
    const { errors, warnings, stats } = checkDictionary(file);
    for (const warning of warnings) console.warn(`предупреждение: ${warning}`);
    for (const error of errors) console.error(`ошибка: ${error}`);
    console.log(`записей: ${stats.entries}, без перевода: ${stats.empty}, ошибок: ${errors.length}, предупреждений: ${warnings.length}`);
    process.exitCode = errors.length ? 1 : 0;
}
