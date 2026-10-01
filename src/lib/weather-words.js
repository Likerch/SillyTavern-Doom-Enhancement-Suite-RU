// Русские слова погоды, которые модуль 3 дописывает в словарь эффектов DES (только в памяти).

/**
 * Встроенные дополнения по типам эффектов DES. DES ищет каждое слово как часть текста прогноза,
 * поэтому здесь основы и формы, которых у DES нет: «дожд» ловит «дождливо» и «дождя».
 * Основы подобраны так, чтобы не цеплять обычные слова: нет «гроз» (угроза), «солнц» (без солнца),
 * «дым» (дым пожара), «град» (градус), «гром» (громко).
 */
export const DEFAULT_WEATHER_WORDS = Object.freeze({
    blizzard: Object.freeze(['метел', 'вьюг', 'вьюж', 'пург', 'буран', 'снежная буря']),
    storm: Object.freeze(['грозов', 'молни', 'раскат', 'бури', 'бурю', 'бурей', 'ураган']),
    wind: Object.freeze(['ветр', 'вихр', 'шквал']),
    snow: Object.freeze(['снеж']),
    rain: Object.freeze(['дожд', 'морос', 'ливн']),
    mist: Object.freeze(['мгл', 'дымк', 'марев']),
    sunny: Object.freeze(['солнечн', 'ясный', 'ясная', 'ясные', 'безоблачн', 'звёздн', 'звездн']),
});

/** Короче трёх букв слово ловит слишком много чужого текста. */
export const MIN_WORD_LENGTH = 3;
const WORD = /^\p{L}[\p{L} -]*\p{L}$/u;

/**
 * «дожд, морос; ливн» → ['дожд', 'морос', 'ливн'].
 * @param {unknown} text
 * @returns {string[]}
 */
export function parseWordList(text) {
    return String(text ?? '').split(/[,;\n]+/).map((word) => word.trim()).filter(Boolean);
}

/**
 * Приводит словарь погоды к виду { тип: [слова] }: нижний регистр (DES сравнивает в нижнем),
 * одиночные пробелы, без повторов. Неизвестные типы молча отбрасываются, неподходящие слова — в `rejected`.
 * @param {unknown} input { тип: string[] | string }
 * @param {readonly string[]} types допустимые типы эффектов
 * @returns {{ words: Record<string, string[]>, rejected: string[] }}
 */
export function normalizeWeatherWords(input, types) {
    /** @type {Record<string, string[]>} */
    const words = {};
    const rejected = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { words, rejected };
    for (const [type, value] of Object.entries(input)) {
        if (!types.includes(type)) continue;
        const list = Array.isArray(value) ? value : parseWordList(value);
        const clean = [];
        for (const raw of list) {
            const word = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
            if (!word) continue;
            if (word.length < MIN_WORD_LENGTH || !WORD.test(word)) {
                rejected.push(word);
                continue;
            }
            if (!clean.includes(word)) clean.push(word);
        }
        if (clean.length) words[type] = clean;
    }
    return { words, rejected };
}

/**
 * Одинаковые ли словари погоды (порядок слов важен: так их видит пользователь).
 * @param {Record<string, readonly string[]>} a
 * @param {Record<string, readonly string[]>} b
 */
export function sameWeatherWords(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const left = a[key] ?? [];
        const right = b[key] ?? [];
        if (left.length !== right.length || left.some((word, index) => word !== right[index])) return false;
    }
    return true;
}

/**
 * Дописывает слова в группы одного языка таблицы погоды DES (живые массивы). Слово, которое в группе
 * уже есть, пропускается. `undo` снимает ровно то, что дописано, и безопасно вызывается повторно.
 * @param {{ id: string, patterns: string[] }[]} groups
 * @param {Record<string, readonly string[]>} words
 * @returns {{ added: { id: string, word: string }[], missingTypes: string[], undo: () => void }}
 */
export function addWeatherWords(groups, words) {
    /** @type {{ group: { id: string, patterns: string[] }, word: string }[]} */
    const pushed = [];
    const known = new Set();
    for (const group of groups) {
        if (!group || typeof group.id !== 'string' || !Array.isArray(group.patterns)) continue;
        known.add(group.id);
        for (const word of words[group.id] ?? []) {
            if (group.patterns.includes(word)) continue;
            group.patterns.push(word);
            pushed.push({ group, word });
        }
    }
    const added = pushed.map(({ group, word }) => ({ id: group.id, word }));
    const missingTypes = Object.keys(words).filter((type) => !known.has(type));
    const undo = () => {
        for (const { group, word } of pushed.splice(0).reverse()) {
            const index = group.patterns.lastIndexOf(word);
            if (index >= 0) group.patterns.splice(index, 1);
        }
    };
    return { added, missingTypes, undo };
}
