// Нормализатор машинного слоя BunnyMo в ответе модели. Чистая функция, без DOM и ST.
//
// Принцип: проза — по-русски, машинный слой — по-английски. Его разбирают DES (кнопка импорта листа),
// CarrotKernel (архивы персонажей) и сами паки BunnyMo (срабатывают по точному английскому тегу).
// Если модель всё же перевела служебное, возвращаем английское. Проза не трогается:
//   - заголовки разделов «## Раздел 1 из 8:» → «## SECTION 1/8:» (название раздела остаётся русским);
//   - подписи «**Имя:**» → «**Name:**», «Титул персонажа:» → «Character Title:» — только в листах;
//   - теги <ВИД:Эльф> → <SPECIES:ELF>: русский ключ → английский, русское значение → английское по словарю
//     или транслитом по словарю паков; <Name:Аней> → имя карточки;
//   - обёртки <ЛИЧНОСТЬ>…</ЛИЧНОСТЬ> → <PERSONALITY>…</PERSONALITY>;
//   - закрывающий </bunnymotags> в другом регистре, чем открывающий, — к регистру открывающего
//     (CarrotKernel иначе не найдёт блок тегов).

import { TAG_KEYS_RU, VALUES_RU, WRAPPERS_RU } from './bunnymo-vocab.js';
import { translitMatches } from './translit.js';

const CYRILLIC = /\p{Script=Cyrillic}/u;
/** Ключи, у которых значение — имя, а не слово из словаря BunnyMo. */
const NAME_KEYS = new Set(['NAME']);
/** Словари значений, общие для нескольких ключей. */
const VALUE_DICTIONARY_OF = Object.freeze({ MENTAL: 'BSM', MOOD: 'BSM', PERSONALITY: 'TRAIT', DIVINE: 'DOMAIN' });
/** Английские ключи, которые знает словарь: только у них пробелы в значении заменяются на «_». */
const KNOWN_KEYS = new Set([...Object.values(TAG_KEYS_RU).map((key) => key.toUpperCase()), 'MBTI', 'NSFW', 'DIVINE', 'DOMAIN', 'BENDER', 'MENTAL']);
const ADJECTIVE_END = /(?:ого|его|ому|ему|ыми|ими|ый|ий|ой|ая|яя|ое|ее|ые|ие|ых|их|ую|юю|ым|им|ом|ем)$/;

const TAG_RE = /<([\p{L}][\p{L}\p{N}_ ]{0,39}):([^<>\n]{1,80})>/gu;
const WRAPPER_RE = /<(\/?)([\p{L}][\p{L}_ ]{1,40})>/gu;
const BLOCK_OPEN_RE = /<bunnymotags>/gi;
const BLOCK_CLOSE_RE = /<\/bunnymotags>/gi;
const HEADER_RE = /^([ \t]*(?:<details[^>]*>\s*)?(<summary[^>]*>)?[ \t]*(#{1,3})?[ \t]*(\*\*)?[ \t]*(?:[^\s\p{L}\p{N}]{1,8}[ \t]*)?)(раздел|секция|section)[ \t]+(\d{1,3})[ \t]*(?:из|\/|／|of)[ \t]*(\d{1,3})[ \t]*(:?)/gimu;

/** @param {string} text */
const keyToken = (text) => String(text).trim().toUpperCase().replace(/Ё/g, 'Е').replace(/[\s-]+/g, '_');
/** @param {string} text */
const valueToken = (text) => String(text).trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s-]+/g, '_');

/**
 * @typedef {object} NormalizeOptions
 * @property {ReadonlyMap<string, ReadonlySet<string>>} [vocabulary] значения тегов из ключей паков: КЛЮЧ → значения (верхний регистр)
 * @property {(name: string) => string|null} [canonicalName] имя карточки для имени из листа («Аней» → «Аня»)
 */

/**
 * Английское значение для русского значения тега; `null` — не нашлось.
 * @param {string} key английский ключ в верхнем регистре
 * @param {string} value
 * @param {ReadonlyMap<string, ReadonlySet<string>>} [vocabulary]
 */
export function resolveValue(key, value, vocabulary) {
    const token = valueToken(value);
    if (!token) return null;
    const dictionary = VALUES_RU[VALUE_DICTIONARY_OF[key] ?? key];
    if (dictionary) {
        const direct = dictionary[token] ?? dictionary[token.replace(ADJECTIVE_END, '')];
        if (direct) return direct;
    }
    const known = vocabulary?.get(key);
    if (known) {
        const plain = token.replace(/_/g, '');
        for (const candidate of known) {
            if (translitMatches(plain, candidate.toLowerCase().replace(/_/g, ''))) return candidate;
        }
    }
    return null;
}

/**
 * @param {string} text
 * @param {NormalizeOptions} [options]
 * @returns {{ text: string, changes: string[], unresolved: string[] }}
 */
export function normalizeMachineLayer(text, { vocabulary, canonicalName } = {}) {
    if (typeof text !== 'string' || !text) return { text, changes: [], unresolved: [] };
    const changes = [];
    const unresolved = [];
    let result = text;

    // 1. Заголовки разделов. Без разметки (#, **, <summary>) заголовком считаем только «лесенку»:
    //    хотя бы два раздела с одним и тем же M — так «Часть 1 из 3» в прозе не тронется.
    const ladders = new Map();
    for (const match of result.matchAll(HEADER_RE)) ladders.set(match[7], (ladders.get(match[7]) ?? 0) + 1);
    result = result.replace(HEADER_RE, (whole, prefix, summary, hashes, bold, word, n, m, colon) => {
        const structural = Boolean(summary || hashes || bold);
        if (!structural && (ladders.get(m) ?? 0) < 2) return whole;
        if (word === 'SECTION' && colon && whole.includes(`${n}/${m}`)) return whole;
        changes.push(`«${whole.trim()}» → «SECTION ${n}/${m}:»`);
        return `${prefix}SECTION ${n}/${m}:`;
    });
    const isSheet = /^\s*(?:<summary[^>]*>)?\s*#{0,3}.*?SECTION\s+\d+\/\d+:/m.test(result) || /<bunnymotags>/i.test(result);

    // 2. Подписи листа, по которым DES находит имя и титул.
    if (isSheet) {
        const before = result;
        result = result
            .replace(/\*\*\s*Имя\s*:\s*\*\*/g, '**Name:**')
            .replace(/\*\*\s*Имя\s*\*\*\s*:/g, '**Name:**');
        const firstSection = result.search(/SECTION\s+\d+\/\d+:/);
        const head = firstSection >= 0 ? result.slice(0, firstSection) : result;
        const fixedHead = head.replace(/(Титул персонажа|Звание персонажа|Титул)(\s*):/g, 'Character Title$2:');
        result = fixedHead + result.slice(head.length);
        if (result !== before) changes.push('подписи листа «Имя», «Титул» → «Name», «Character Title»');
        if (canonicalName) {
            result = result.replace(/(\*\*Name:\*\*[ \t]*)([^\n]+)/g, (whole, label, value) => {
                const clean = value.replace(/[[\]*]/g, '').trim();
                const canonical = canonicalName(clean);
                if (!canonical || canonical === clean) return whole;
                changes.push(`имя в листе «${clean}» → «${canonical}»`);
                return `${label}${canonical}`;
            });
        }
    }

    // 3. Теги <КЛЮЧ:ЗНАЧЕНИЕ> — только в машинном выводе BunnyMo: в листе, в блоке тегов или когда тегов
    //    с ключами BunnyMo хотя бы два. Одиночное «<Цвет: красный>» в прозе не трогаем.
    const knownTags = [...result.matchAll(TAG_RE)].filter(([, key]) => {
        const token = keyToken(key);
        return KNOWN_KEYS.has(token) || Boolean(TAG_KEYS_RU[token]);
    }).length;
    const machine = isSheet || /<банн?имо_?теги>/i.test(result) || knownTags >= 2;
    if (machine) result = result.replace(TAG_RE, (whole, rawKey, rawValue) => {
        let key = rawKey.trim();
        if (CYRILLIC.test(key)) {
            const mapped = TAG_KEYS_RU[keyToken(key)];
            if (!mapped) {
                // Вне листа <Аня: …> — скорее проза в угловых скобках, чем тег: не шумим.
                if (isSheet && !WRAPPERS_RU[keyToken(key)]) unresolved.push(whole);
                return whole;
            }
            key = mapped;
        }
        const upper = key.toUpperCase();
        let value = rawValue.trim();
        if (NAME_KEYS.has(upper)) {
            const canonical = canonicalName?.(value.replace(/_/g, ' ')) ?? null;
            if (canonical && canonical !== value) value = canonical;
        } else if (CYRILLIC.test(value)) {
            const english = resolveValue(upper, value, vocabulary);
            if (english) value = english;
            else unresolved.push(`<${key}:${value}>`);
        } else if (KNOWN_KEYS.has(upper) && /^[A-Za-z]+(?: +[A-Za-z]+)+$/.test(value)) {
            value = value.replace(/ +/g, '_');
        }
        const rebuilt = `<${key}:${value}>`;
        if (rebuilt !== whole) changes.push(`${whole} → ${rebuilt}`);
        return rebuilt;
    });

    // 4. Обёртки блоков.
    result = result.replace(WRAPPER_RE, (whole, slash, name) => {
        if (!CYRILLIC.test(name)) return whole;
        const mapped = WRAPPERS_RU[keyToken(name)];
        if (!mapped) return whole;
        changes.push(`${whole} → <${slash}${mapped}>`);
        return `<${slash}${mapped}>`;
    });

    // 5. Регистр закрывающего </BunnymoTags> — как у открывающего.
    const opens = [...result.matchAll(BLOCK_OPEN_RE)];
    if (opens.length) {
        let cursor = 0;
        let fixed = '';
        for (const open of opens) {
            const openName = open[0].slice(1, -1);
            if (open.index < cursor) continue;
            BLOCK_CLOSE_RE.lastIndex = open.index + open[0].length;
            const close = BLOCK_CLOSE_RE.exec(result);
            if (!close) break;
            const expected = `</${openName}>`;
            fixed += result.slice(cursor, close.index) + expected;
            if (close[0] !== expected) changes.push(`${close[0]} → ${expected}`);
            cursor = close.index + close[0].length;
        }
        result = fixed + result.slice(cursor);
    }

    return { text: result, changes, unresolved: [...new Set(unresolved)] };
}

/**
 * Теги из блоков <BunnymoTags> в тексте: для вставки «только для сканирования» и для паков.
 * @param {string} text
 * @returns {string[]} теги вида <KEY:VALUE> в порядке появления, без повторов
 */
export function extractTags(text) {
    const tags = new Set();
    for (const block of String(text ?? '').matchAll(/<bunnymotags>([\s\S]*?)<\/bunnymotags>/gi)) {
        for (const tag of block[1].matchAll(/<([A-Za-z][A-Za-z0-9_\-]*):([^<>\n]+)>/g)) {
            tags.add(`<${tag[1].trim()}:${tag[2].trim()}>`);
        }
    }
    return [...tags];
}
