// Ключи лорбука ST в виде регулярных выражений, которые работают для кириллицы.
//
// «Целое слово» в ST — `(?:^|\W)ключ(?:$|\W)` без флага `u`: для него кириллица — не буквы, поэтому
// «аня» срабатывает внутри «Таня» и «баня», а «Ани» и «Аней» не находятся вовсе. Ключ-регулярку
// (`/…/флаги`) ST проверяет как есть — границы слова здесь через lookaround по `\p{L}`.
//
// Формат — как его читает parseRegexFromString в ST: `/шаблон/флаги`, флаги только из [gimsuy],
// внутри шаблона нет неэкранированного `/`.

/** Буква, цифра или подчёркивание в любом алфавите. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';
export const WORD_START = `(?<!${WORD_CHAR})`;
export const WORD_END = `(?!${WORD_CHAR})`;
/**
 * Хвост ключа: совпадение не внутри тега <…> на той же строке — перед ним нет незакрытой «<» или после
 * него нет «>». Ставится в конец ключа, чтобы проверка шла только там, где слово уже нашлось.
 * Без флага `u` тоже работает — годится и для чужих ключей-регулярок.
 */
export const OUTSIDE_TAG = '(?:(?<!<[^<>\\n]*)|(?![^<>\\n]*>))';

/** @param {string} text */
export function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Похоже ли значение на ключ-регулярку ST.
 * @param {unknown} key
 */
export function isRegexKey(key) {
    return /^\/[\s\S]+\/[gimsuy]*$/.test(String(key ?? '').trim());
}

/**
 * Оборачивает шаблон в ключ-регулярку ST. Неэкранированные `/` экранируются: иначе ST не примет ключ.
 * @param {string} source
 * @param {string} [flags]
 */
export function regexKey(source, flags = 'iu') {
    let body = '';
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (char === '\\') {
            body += char + (source[index + 1] ?? '');
            index += 1;
        } else {
            body += char === '/' ? '\\/' : char;
        }
    }
    return `/${body}/${flags}`;
}

/** Буква ё в шаблоне: совпадает и с «ё», и с «е» — модели пишут по-разному. */
function yoTolerant(text) {
    return escapeRegex(text).replace(/[её]/g, '[её]').replace(/[ЕЁ]/g, '[ЕЁ]');
}

/**
 * Ключ «одно из слов или фраз целиком». Пробелы внутри фразы — любые пробельные символы.
 * @param {readonly string[]} words
 */
export function wordsKey(words) {
    const alternatives = [...new Set(words.map((word) => String(word).trim()).filter(Boolean))]
        .sort((a, b) => b.length - a.length)
        .map((word) => word.split(/\s+/).map(yoTolerant).join('\\s+'));
    return regexKey(`${WORD_START}(?:${alternatives.join('|')})${WORD_END}`);
}

/**
 * Ключ для имени со всеми падежными формами каждого слова: «Аня Петрова» →
 * (?:аня|ани|…)\s+(?:петрова|петровой|…). Регистр не важен, ё и е взаимозаменяемы.
 * @param {string} name
 * @param {(word: string) => string[]} formsOf формы слова (нормализованные, вместе с самим словом)
 */
export function nameFormsKey(name, formsOf) {
    const words = String(name).trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const parts = words.map((word) => {
        const forms = [...new Set([word, ...formsOf(word)])].sort((a, b) => b.length - a.length);
        return forms.length > 1 ? `(?:${forms.map(yoTolerant).join('|')})` : yoTolerant(forms[0]);
    });
    return regexKey(`${WORD_START}${parts.join('\\s+')}${WORD_END}`);
}

/**
 * Ключ, который не срабатывает внутри тегов: «jealousy» не находится в <JEALOUSY:POSSESSIVE>, «clingy» —
 * в <TRAIT:SHY, CLINGY>. Нужен ключам, которые сканируют и вставку тегов сцены (её ST добавляет к тексту
 * каждой записи, запрет рекурсии на неё не действует).
 * Обычный ключ становится регуляркой с теми же правилами, что у записи; у ключа-регулярки дописывается
 * проверка в конец, флаги остаются. Ключ, который ST не примет, и пустой — без изменений.
 * @param {unknown} key
 * @param {{ caseSensitive?: boolean, wholeWords?: boolean }} [options] как у записи: без учёта регистра, целым словом
 * @returns {string}
 */
export function outsideTagsKey(key, { caseSensitive = false, wholeWords = true } = {}) {
    const text = String(key ?? '').trim();
    if (!text) return String(key ?? '');
    if (isRegexKey(text)) {
        const match = text.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
        if (!match || !compileKey(text) || match[1].endsWith(OUTSIDE_TAG)) return text;
        return `/(?:${match[1]})${OUTSIDE_TAG}/${match[2]}`;
    }
    const words = text.split(/\s+/).map(escapeRegex).join('\\s+');
    return regexKey(`${wholeWords ? `${WORD_START}${words}${WORD_END}` : words}${OUTSIDE_TAG}`, caseSensitive ? 'u' : 'iu');
}

/**
 * Проверяет ключ так же, как ST: разбирает `/шаблон/флаги` и компилирует.
 * @param {string} key
 * @returns {RegExp|null}
 */
export function compileKey(key) {
    const match = String(key).match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match || /(^|[^\\])\//.test(match[1])) return null;
    try {
        return new RegExp(match[1].replace('\\/', '/'), match[2]);
    } catch {
        return null;
    }
}
