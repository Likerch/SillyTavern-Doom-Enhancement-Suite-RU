// Сравнение имени в кириллице и латинице: «Аня» ↔ «Anya», «Ania», «Anja»; «Акари» ↔ «Akari»;
// «Сётаро» ↔ «Shotaro» (японские имена по-русски пишут по Поливанову). Не генерируем все написания,
// а проверяем, раскладывается ли латинское слово на варианты букв кириллического — динамикой по позициям.

/** Варианты латиницы для слогов: проверяются раньше одиночных букв. */
const SYLLABLES = Object.freeze([
    ['дзи', ['ji', 'dzi', 'zi']], ['дзё', ['jo', 'dzyo']], ['дзю', ['ju', 'dzyu']], ['дзя', ['ja', 'dzya']], ['дз', ['z', 'dz']],
    ['си', ['shi', 'si']], ['сё', ['sho', 'syo']], ['сю', ['shu', 'syu']], ['ся', ['sha', 'sya']],
    ['ти', ['chi', 'ti']], ['тё', ['cho', 'tyo']], ['тю', ['chu', 'tyu']], ['тя', ['cha', 'tya']],
    ['цу', ['tsu', 'tu']], ['фу', ['fu', 'hu']], ['кс', ['x', 'ks']], ['ий', ['iy', 'ii', 'y', 'i', 'ij']],
    ['ый', ['y', 'yi', 'iy']], ['ье', ['ye', 'ie', 'e']], ['ьи', ['yi', 'i']], ['ья', ['ya', 'ia', 'ja']], ['ью', ['yu', 'iu', 'ju']],
]);

/**
 * Буквы, у которых в начале слова вариантов меньше. «З» внутри слова бывает и «s» (Лиза — Lisa, Роза — Rosa,
 * Изабелла — Isabella), а в начале — только «z»: Зара — Zara, но не Sara (это Сара).
 */
const INITIAL_LETTERS = Object.freeze({ з: ['z'] });

/** Варианты латиницы для одиночных букв. */
const LETTERS = Object.freeze({
    а: ['a'], б: ['b'], в: ['v', 'w'], г: ['g', 'gh'], д: ['d'], е: ['e', 'ye', 'ie'], ё: ['yo', 'io', 'e', 'jo'],
    ж: ['zh', 'j', 'g'], з: ['z', 's'], и: ['i', 'ee', 'y'], й: ['y', 'i', 'j', ''], к: ['k', 'c', 'ck', 'q'], л: ['l'], м: ['m'],
    н: ['n'], о: ['o', 'ou', 'oh'], п: ['p'], р: ['r'], с: ['s', 'c', 'ss'], т: ['t', 'th'], у: ['u', 'oo', 'uu'], ф: ['f', 'ph'],
    х: ['kh', 'h', 'ch'], ц: ['ts', 'c', 'tz', 'z'], ч: ['ch', 'tch'], ш: ['sh', 'sch'], щ: ['shch', 'sch', 'sh'], ъ: [''],
    ы: ['y', 'i'], ь: ['', 'i', 'y'], э: ['e', 'ae'], ю: ['yu', 'iu', 'ju', 'u'], я: ['ya', 'ia', 'ja'],
});

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/** @param {unknown} word */
function normalizeLatin(word) {
    return String(word ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

/** @param {unknown} word */
function normalizeCyrillic(word) {
    return String(word ?? '').toLowerCase().replace(/[^\p{Script=Cyrillic}]/gu, '');
}

/**
 * Можно ли прочитать латинское слово как транслитерацию кириллического.
 * @param {string} cyrillic
 * @param {string} latin
 */
export function translitMatches(cyrillic, latin) {
    const source = normalizeCyrillic(cyrillic);
    const target = normalizeLatin(latin);
    if (!source || !target) return false;
    /** @type {Map<number, boolean>} */
    const memo = new Map();
    const width = target.length + 1;
    const step = (i, j) => {
        if (i === source.length) return j === target.length;
        const key = i * width + j;
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        let ok = false;
        for (const [syllable, options] of SYLLABLES) {
            if (!source.startsWith(syllable, i)) continue;
            ok = options.some((option) => target.startsWith(option, j) && step(i + syllable.length, j + option.length));
            if (ok) break;
        }
        if (!ok) {
            const options = (i === 0 ? INITIAL_LETTERS[source[i]] : null) ?? LETTERS[source[i]] ?? [source[i]];
            ok = options.some((option) => target.startsWith(option, j) && step(i + 1, j + option.length));
        }
        memo.set(key, ok);
        return ok;
    };
    return step(0, 0);
}

/**
 * Одно слово записано кириллицей, другое — латиницей, и это одно и то же имя.
 * @param {string} a
 * @param {string} b
 */
export function sameWordAcrossScripts(a, b) {
    if (CYRILLIC.test(a) && LATIN.test(b) && !LATIN.test(a) && !CYRILLIC.test(b)) return translitMatches(a, b);
    if (LATIN.test(a) && CYRILLIC.test(b) && !CYRILLIC.test(a) && !LATIN.test(b)) return translitMatches(b, a);
    return false;
}
