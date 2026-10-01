// Падежные формы русских имён: лёгкий матчер без словарей и зависимостей.
//
// Модель иногда пишет в трекере имя не в именительном падеже, а как оно стоит в тексте:
// «Ани», «Аню», «Аней» вместо «Аня». Матчер отсекает типовые окончания и сравнивает основы.
// Порог строгий: основы должны совпасть точно, а окончание формы — подходить к типу склонения
// имени карточки. Так «Ана» не станет формой «Аня», а «Арина» — формой «Ирина»
// (нечёткое сравнение основ склеило бы и «Мария» с «Марина»).

/**
 * Нижний регистр, ё → е, одиночные пробелы.
 * @param {unknown} name
 */
export function normalizeRussianName(name) {
    return String(name ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

const CONSONANT_END = /[бвгджзклмнпрстфхцчшщ]$/;
/** Основа короче двух букв ловит слишком много чужих имён. */
const MIN_STEM = 2;

/**
 * Основы и окончания падежных форм для одного слова в именительном падеже.
 * Пустой список — слово не склоняется (Акари, Хироко): совпадёт только оно само.
 * @param {string} word нормализованное слово
 * @returns {{ stem: string, endings: string[] }[]}
 */
export function declension(word) {
    /** @param {number} cut сколько букв отрезать от конца */
    const stem = (cut) => word.slice(0, word.length - cut);
    const fits = (cut) => word.length - cut >= MIN_STEM;
    if (word.endsWith('ия') && fits(1)) {
        return [{ stem: stem(1), endings: ['я', 'и', 'ю', 'ей', 'ею'] }]; // Мария
    }
    if (word.endsWith('ая') && fits(2)) {
        return [{ stem: stem(2), endings: ['ая', 'ой', 'ую', 'ою'] }]; // Толстая
    }
    if (word.endsWith('я') && fits(1)) {
        return [{ stem: stem(1), endings: ['я', 'и', 'е', 'ю', 'ей', 'ею'] }]; // Аня, Илья
    }
    if (word.endsWith('а') && fits(1)) {
        const base = stem(1);
        // Правописание после шипящих и г/к/х: Маша → Маши, Машей; Ольга → Ольги, Ольгой; Анна → Анны, Анной.
        if (/[жшщч]$/.test(base)) return [{ stem: base, endings: ['а', 'и', 'е', 'у', 'ей', 'ею'] }];
        if (base.endsWith('ц')) return [{ stem: base, endings: ['а', 'ы', 'е', 'у', 'ей', 'ею'] }];
        if (/[гкх]$/.test(base)) return [{ stem: base, endings: ['а', 'и', 'е', 'у', 'ой', 'ою'] }];
        return [{ stem: base, endings: ['а', 'ы', 'е', 'у', 'ой', 'ою'] }];
    }
    if (/[иыо]й$/.test(word) && fits(2)) {
        return [
            { stem: stem(1), endings: ['й', 'я', 'ю', 'ем', 'и', 'е'] }, // Василий, Дмитрий
            { stem: stem(2), endings: [word.slice(-2), 'ого', 'его', 'ому', 'ему', 'им', 'ым', 'ом', 'ем'] }, // Достоевский, Белый, Толстой
        ];
    }
    if (/[аеуэюя]й$/.test(word) && fits(1)) {
        return [{ stem: stem(1), endings: ['й', 'я', 'ю', 'ем', 'е'] }]; // Андрей, Николай
    }
    if (word.endsWith('ь') && fits(1)) {
        return [{ stem: stem(1), endings: ['ь', 'я', 'ю', 'ем', 'е', 'и', 'ью'] }]; // Игорь, Любовь
    }
    if (CONSONANT_END.test(word) && word.length >= MIN_STEM) {
        const endings = ['', 'а', 'у', 'е', /[жшщчц]$/.test(word) ? 'ем' : 'ом']; // Иван → Иваном; Кузьмич → Кузьмичем
        if (/[жшщчц]$/.test(word)) endings.push('ом');
        if (/(ов|ев|ин|ын)$/.test(word)) endings.push('ым'); // Петров → Петровым
        const forms = [{ stem: word, endings }];
        // Беглая гласная: Павел → Павла, Лев → Льва.
        if (word.endsWith('ел') && word.length >= 4) forms.push({ stem: `${stem(2)}л`, endings: ['а', 'у', 'ом', 'е'] });
        if (word === 'лев') forms.push({ stem: 'льв', endings: ['а', 'у', 'ом', 'е'] });
        return forms;
    }
    return [];
}

/**
 * Форма ли слово `variant` слова `canonical` в каком-то падеже (оба нормализованы).
 * @param {string} variant
 * @param {string} canonical
 */
export function isWordForm(variant, canonical) {
    if (variant === canonical) return true;
    return declension(canonical).some(({ stem, endings }) => endings.some((ending) => variant === stem + ending));
}

/**
 * Похоже ли имя из трекера на падежную форму имени карточки: столько же слов, и каждое — форма
 * соответствующего слова. Отличие только в регистре или ё/е тоже считается формой.
 * @param {string} variant
 * @param {string} canonical
 */
export function isCaseFormOf(variant, canonical) {
    const variantWords = normalizeRussianName(variant).split(' ');
    const canonicalWords = normalizeRussianName(canonical).split(' ');
    if (!variantWords[0] || variantWords.length !== canonicalWords.length) return false;
    return variantWords.every((word, index) => isWordForm(word, canonicalWords[index]));
}

/**
 * @typedef {object} NameContext
 * @property {readonly string[]} npcCards карточки NPC: только к ним DES разрешает алиасы
 * @property {(name: string) => string} keyOf нормализация имени, как у DES
 * @property {ReadonlyMap<string, readonly string[]>} cardKeys ключ DES → карточки с таким ключом (и персонажи пользователя)
 * @property {(name: string) => boolean} isAlias DES уже знает это имя как алиас
 * @property {(variant: string, canonical: string) => string|null} excluded почему пару склеивать нельзя
 */

/**
 * Решение по одному имени из трекера: дописать его алиасом к карточке или оставить как есть.
 * @param {string} name
 * @param {NameContext} context
 * @returns {{ action: 'alias', canonical: string } | { action: 'skip', reason: string, candidates?: string[] }}
 */
export function decideName(name, context) {
    const variant = String(name ?? '').trim();
    if (!variant) return { action: 'skip', reason: 'пустое имя' };
    if (context.npcCards.includes(variant)) return { action: 'skip', reason: 'это карточка' };
    if (context.isAlias(variant)) return { action: 'skip', reason: 'уже алиас' };

    const candidates = [...new Set(context.npcCards)].filter((card) => isCaseFormOf(variant, card));
    if (!candidates.length) return { action: 'skip', reason: 'не похоже ни на одну карточку' };
    if (candidates.length > 1) return { action: 'skip', reason: 'подходит нескольким карточкам', candidates };
    const canonical = candidates[0];

    // Имя, которое DES считает другой существующей карточкой, не трогаем: алиас у DES сильнее карточки.
    const other = (context.cardKeys.get(context.keyOf(variant)) ?? []).find((card) => card !== canonical);
    if (other !== undefined) return { action: 'skip', reason: `есть отдельная карточка «${other}»` };
    const reason = context.excluded(variant, canonical);
    if (reason) return { action: 'skip', reason };
    return { action: 'alias', canonical };
}

/**
 * Карточки, которые уже стали падежными дублями другой карточки («Аней» при «Аня»): DES завёл их
 * раньше, модуль склеивает только новые имена. Только для предупреждения.
 * @param {readonly string[]} cards
 * @returns {{ variant: string, canonical: string }[]}
 */
export function findCaseDuplicates(cards) {
    const unique = [...new Set(cards)];
    const pairs = [];
    for (const variant of unique) {
        const matches = unique.filter((card) => card !== variant && isCaseFormOf(variant, card)
            && !(normalizeRussianName(card) === normalizeRussianName(variant) && card > variant));
        // Форма может подходить к нескольким карточкам — тогда неясно, к какой, и молчим.
        if (matches.length === 1) pairs.push({ variant, canonical: matches[0] });
    }
    return pairs;
}
