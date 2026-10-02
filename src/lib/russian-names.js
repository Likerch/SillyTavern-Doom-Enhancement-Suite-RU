// Падежные формы русских имён: лёгкий матчер без словарей и зависимостей.
//
// Модель иногда пишет в трекере имя не в именительном падеже, а как оно стоит в тексте:
// «Ани», «Аню», «Аней» вместо «Аня». Матчер отсекает типовые окончания и сравнивает основы.
// Порог строгий: основы должны совпасть точно, а окончание формы — подходить к типу склонения
// имени карточки. Так «Ана» не станет формой «Аня», а «Арина» — формой «Ирина»
// (нечёткое сравнение основ склеило бы и «Мария» с «Марина»).
//
// Поверх падежей — ступени слабее: падежи алиасов, звания и японские суффиксы обращения,
// имя без фамилии, уменьшительные и транслит (decideName). Каждая ступень склеивает, только
// если подходит ровно одна карточка; иначе решает DES.

import { DIMINUTIVES, FULL_NAMES_BY_DIMINUTIVE } from './russian-diminutives.js';
import { sameWordAcrossScripts } from './translit.js';

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

/*
 * MALE_GENITIVE_NOTE. Родительный падеж мужского имени часто совпадает с женским именем в именительном:
 * Александр → Александра, Ян → Яна, Валерий → Валерия, Петров → Петрова. Новая героиня появляется в трекере
 * как раз в именительном, и склейка спрятала бы её в карточку мужчины. Поэтому эти формы модуль не склеивает —
 * их решает попап DES («тот же персонаж?»). Остальные падежи мужских имён (Ивану, Иваном, Иване) склеиваются.
 * Так же и наоборот: косвенные падежи женской фамилии на -ая совпадают с мужской на -ой (Толстая → Толстой,
 * Трубецкая → Трубецкой) — мужчина не прячется в карточку женщины. В имени из нескольких слов такая форма
 * подходит, если другое слово явно в косвенном падеже: «Ани Толстой» — это «Аня Толстая» (isCaseFormOf).
 * Для поиска имени в тексте (ключи лорбука, раскраска реплик) эти формы нужны: там `genitive: true`.
 */

/**
 * Основы и окончания падежных форм для одного слова в именительном падеже.
 * Пустой список — слово не склоняется (Акари, Хироко): совпадёт только оно само.
 * @param {string} word нормализованное слово
 * @param {{ genitive?: boolean }} [options] `genitive` — и с формами, которые совпадают с именительным другого
 *        имени: родительный мужских имён и -ой женских фамилий на -ая (см. MALE_GENITIVE_NOTE)
 * @returns {{ stem: string, endings: string[] }[]}
 */
export function declension(word, { genitive = false } = {}) {
    /** @param {number} cut сколько букв отрезать от конца */
    const stem = (cut) => word.slice(0, word.length - cut);
    const fits = (cut) => word.length - cut >= MIN_STEM;
    if (word.endsWith('ия') && fits(1)) {
        return [{ stem: stem(1), endings: ['я', 'и', 'ю', 'ей', 'ею'] }]; // Мария
    }
    if (word.endsWith('ая') && fits(2)) {
        // Без -ой: «Толстой», «Трубецкой» — это и мужские фамилии (см. MALE_GENITIVE_NOTE).
        return [{ stem: stem(2), endings: ['ая', 'ую', 'ою', ...(genitive ? ['ой'] : [])] }]; // Толстая
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
            // Без родительного на -я: «Валерия», «Юлия», «Евгения» — это и женские имена (см. MALE_GENITIVE_NOTE).
            { stem: stem(1), endings: ['й', 'ю', 'ем', 'и', 'е', ...(genitive ? ['я'] : [])] }, // Василий, Дмитрий
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
        // Без родительного на -а: «Александра», «Яна», «Валентина», «Петрова» — это и женские имена (см. MALE_GENITIVE_NOTE).
        const endings = ['', 'у', 'е', /[жшщчц]$/.test(word) ? 'ем' : 'ом']; // Иван → Ивану, Иваном; Кузьмич → Кузьмичем
        if (/[жшщчц]$/.test(word)) endings.push('ом');
        if (/(ов|ев|ин|ын)$/.test(word)) endings.push('ым'); // Петров → Петровым
        if (genitive) endings.push('а');
        const forms = [{ stem: word, endings }];
        // Беглая гласная: Павел → Павлу, Лев → Льву (родительный не склеиваем — см. MALE_GENITIVE_NOTE).
        const fleeting = ['у', 'ом', 'е', ...(genitive ? ['а'] : [])];
        if (word.endsWith('ел') && word.length >= 4) forms.push({ stem: `${stem(2)}л`, endings: fleeting });
        if (word === 'лев') forms.push({ stem: 'льв', endings: fleeting });
        return forms;
    }
    return [];
}

/**
 * Все формы слова вместе с ним самим (нормализованные).
 * @param {string} word нормализованное слово
 * @param {{ genitive?: boolean }} [options]
 */
export function wordForms(word, options) {
    const forms = new Set([word]);
    for (const { stem, endings } of declension(word, options)) {
        for (const ending of endings) forms.add(stem + ending);
    }
    return [...forms];
}

/**
 * Форма ли слово `variant` слова `canonical` в каком-то падеже (оба нормализованы).
 * @param {string} variant
 * @param {string} canonical
 * @param {{ genitive?: boolean }} [options] как у declension
 */
export function isWordForm(variant, canonical, options) {
    if (variant === canonical) return true;
    return declension(canonical, options).some(({ stem, endings }) => endings.some((ending) => variant === stem + ending));
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
    const strict = variantWords.map((word, index) => isWordForm(word, canonicalWords[index]));
    if (strict.every(Boolean)) return true;
    // Форма, совпадающая с именительным другого имени («Толстой», «Петрова»), подходит, только если другое слово
    // явно в косвенном падеже: «Ани Толстой» — это «Аня Толстая», а «Аня Петрова» — не «Аня Петров».
    const oblique = variantWords.some((word, index) => strict[index] && word !== canonicalWords[index]);
    return oblique && variantWords.every((word, index) => strict[index] || isWordForm(word, canonicalWords[index], { genitive: true }));
}

// ─── Звания, обращения, части имени ────────────────────────────────────────

/**
 * Звания и обращения перед именем: «Капитан Дарган», «Леди Мира». Только те, что не бывают родством:
 * «мать Ани» — другой персонаж, а не Аня. И не бывают именем: «Хан Соло» — не «Соло».
 */
const TITLES = new Set([
    'капитан', 'лейтенант', 'майор', 'полковник', 'подполковник', 'генерал', 'фельдмаршал', 'маршал', 'адмирал',
    'сержант', 'капрал', 'рядовой', 'командир', 'командор', 'комендант', 'офицер', 'доктор', 'профессор',
    'господин', 'госпожа', 'мистер', 'миссис', 'мисс', 'леди', 'лорд', 'сэр', 'сир', 'сударь', 'сударыня',
    'сеньор', 'сеньора', 'сеньорита', 'синьор', 'синьора', 'мадам', 'мадемуазель', 'месье', 'мсье', 'фрау', 'фройляйн',
    'герр', 'пан', 'пани', 'князь', 'княгиня', 'княжна', 'граф', 'графиня', 'барон', 'баронесса', 'виконт', 'виконтесса',
    'маркиз', 'маркиза', 'герцог', 'герцогиня', 'король', 'королева', 'принц', 'принцесса', 'царь', 'царица', 'царевна',
    'царевич', 'император', 'императрица', 'султан', 'шейх', 'эмир', 'святой', 'святая', 'преподобный',
    'учитель', 'учительница', 'сенсей', 'мастер', 'магистр', 'советник', 'министр', 'судья', 'шериф', 'детектив',
    'инспектор', 'агент', 'следователь', 'констебль', 'комиссар', 'старейшина', 'вождь', 'жрец', 'жрица', 'архимаг',
]);

/**
 * Слова, с которых начинается описание, а не имя: родство, возраст, люди и роли («Мать Ани», «Брат Анны»,
 * «Старший стражник», «Девушка в красном»). У такой карточки нет имени, по которому её зовут одним словом.
 * Нормализованы (ё → е).
 */
const DESCRIPTORS = new Set([
    // родство
    'мать', 'мама', 'матушка', 'отец', 'папа', 'батюшка', 'брат', 'братец', 'братишка', 'сестра', 'сестрица', 'сестренка',
    'сын', 'сынок', 'дочь', 'дочка', 'жена', 'муж', 'супруг', 'супруга', 'дядя', 'дядюшка', 'тетя', 'тетушка', 'тетка',
    'бабушка', 'бабуля', 'бабка', 'дедушка', 'дед', 'внук', 'внучка', 'племянник', 'племянница', 'кузен', 'кузина',
    'мачеха', 'отчим', 'теща', 'тесть', 'свекровь', 'свекор', 'зять', 'невестка', 'невеста', 'жених', 'вдова', 'вдовец',
    // возраст, порядок
    'старший', 'старшая', 'младший', 'младшая', 'старый', 'старая', 'молодой', 'молодая', 'юный', 'юная',
    'маленький', 'маленькая', 'первый', 'первая', 'второй', 'вторая', 'третий', 'третья', 'главный', 'главная',
    // люди
    'девушка', 'парень', 'мужчина', 'женщина', 'девочка', 'мальчик', 'ребенок', 'юноша', 'старик', 'старуха',
    'незнакомец', 'незнакомка', 'человек', 'гость', 'гостья',
    // роли
    'стражник', 'стражница', 'страж', 'охранник', 'охранница', 'солдат', 'слуга', 'служанка', 'горничная', 'дворецкий',
    'торговец', 'торговка', 'продавец', 'продавщица', 'хозяин', 'хозяйка', 'трактирщик', 'трактирщица', 'бармен',
    'официант', 'официантка', 'кузнец', 'лекарь', 'целитель', 'целительница',
]);

/** Японские суффиксы обращения: «Аня-сан», «Акари-тян», «Akari-chan». */
const HONORIFIC_SUFFIX = /[-‐–](?:сан|кун|тян|чан|сама|сенсей|сэнсэй|семпай|сэмпай|сенпай|доно|тан|сан|san|kun|chan|sama|sensei|senpai|sempai|dono|tan)$/iu;

/** Частицы в составных именах: «Дарган фон Вартенбург», «Жанна д’Арк». Частью имени не считаются. */
const NAME_PARTICLES = new Set(['фон', 'фан', 'ван', 'дер', 'де', 'ди', 'да', 'дю', 'ла', 'ле', 'дель', 'делла', 'ибн', 'бин', 'бен', 'аль', 'эль',
    'von', 'van', 'der', 'de', 'di', 'da', 'du', 'la', 'le', 'del', 'della', 'ibn', 'bin', 'ben', 'al', 'el', 'the']);

/**
 * Имя без звания в начале и японского суффикса обращения в конце; `null` — снимать нечего.
 * @param {string} name нормализованное имя
 */
export function stripAddress(name) {
    let words = name.split(' ');
    let changed = false;
    while (words.length > 1 && TITLES.has(words[0])) {
        words = words.slice(1);
        changed = true;
    }
    const last = words[words.length - 1];
    const bare = last.replace(HONORIFIC_SUFFIX, '');
    if (bare && bare !== last) {
        words = [...words.slice(0, -1), bare];
        changed = true;
    }
    return changed ? words.join(' ') : null;
}

/**
 * Где в имени из нескольких слов само имя — первое значимое слово (без званий и частиц), по которому карточку
 * зовут отдельно: «Аня» — «Аня Петрова», «Дарган» — «Капитан Дарган фон Вартенбург». Фамилия одна — не повод
 * склеивать (однофамильцы, родня): это решает попап DES. У карточки-описания («Мать Ани», «Девушка в красном»)
 * имени нет. Слова — в нижнем регистре, ё можно не заменять.
 * @param {readonly string[]} words
 * @returns {number} индекс имени или -1
 */
function givenNameIndex(words) {
    if (words.length < 2) return -1;
    const plain = words.map((word) => word.replace(/ё/g, 'е'));
    const index = plain.findIndex((word) => !TITLES.has(word) && !NAME_PARTICLES.has(word));
    if (index < 0 || plain[index].length < 3 || DESCRIPTORS.has(plain[index])) return -1;
    return index;
}

/** @param {string} name */
function lowerWords(name) {
    return String(name).toLowerCase().replace(/\s+/g, ' ').trim().split(' ');
}

/**
 * Уменьшительное ли `variant` (в любом падеже) от полного имени `canonical` — или наоборот,
 * когда карточка названа уменьшительно («Ваня», а в трекере «Ивану»).
 * @param {string} variant нормализованное слово
 * @param {string} canonical нормализованное слово
 */
export function isDiminutiveOf(variant, canonical) {
    const forms = DIMINUTIVES[canonical];
    if (forms && forms.some((form) => isWordForm(variant, form))) return true;
    const fullNames = FULL_NAMES_BY_DIMINUTIVE.get(canonical);
    if (!fullNames) return false;
    // Карточка названа уменьшительно: имя из трекера должно подходить ко всем, кем она может быть.
    // «Евгений» при карточке «Женя» не склеится — Женя бывает и Евгенией.
    if (fullNames.length === 1 && isWordForm(variant, fullNames[0])) return true;
    // Обе формы уменьшительные от одного имени: карточка «Лиза», в трекере «Лизонька».
    for (const [form, owners] of FULL_NAMES_BY_DIMINUTIVE) {
        if (form !== canonical && isWordForm(variant, form) && fullNames.every((full) => owners.includes(full))) return true;
    }
    return false;
}

// ─── Решение ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} NameContext
 * @property {readonly string[]} npcCards карточки NPC, к которым можно склеить: только к ним DES разрешает алиасы
 * @property {readonly string[]} [hiddenCards] карточки NPC, скрытые из «Present Characters»: сами не склеиваются
 *           и к ним не склеивают (так DES хранит и скрытые модулем формы имени игрока)
 * @property {(name: string) => string} keyOf нормализация имени, как у DES
 * @property {ReadonlyMap<string, readonly string[]>} cardKeys ключ DES → карточки с таким ключом (и персонажи пользователя)
 * @property {(name: string) => boolean} isAlias DES уже знает это имя как алиас
 * @property {(variant: string, canonical: string) => string|null} excluded почему пару склеивать нельзя
 * @property {ReadonlyMap<string, readonly string[]>} [aliasesOf] карточка → её алиасы (для падежей алиасов)
 * @property {readonly string[]} [userCards] персонажи пользователя: их формы прячем, а не склеиваем
 * @property {{ address?: boolean, parts?: boolean, diminutives?: boolean, translit?: boolean }} [steps]
 *           какие ступени слабее падежей включены (по умолчанию все)
 */

/**
 * @typedef {{ action: 'alias', canonical: string, via: string }
 *   | { action: 'hide', persona: string, via: string }
 *   | { action: 'skip', reason: string, candidates?: string[] }} NameDecision
 */

/**
 * Ступени сравнения: от самой надёжной к самой слабой. Каждая отвечает, подходит ли имя `variant`
 * (нормализованное) к карточке `card`; первая ступень, где подошла хоть одна карточка, решает.
 * @param {NameContext} context
 */
function matchSteps(context) {
    const steps = context.steps ?? {};
    const aliasesOf = context.aliasesOf ?? new Map();
    /** @type {{ via: string, test: (variant: string, card: string, raw: string) => boolean }[]} */
    const list = [
        { via: 'падеж', test: (variant, card) => isCaseFormOf(variant, card) },
        {
            via: 'падеж алиаса',
            test: (variant, card) => (aliasesOf.get(card) ?? []).some((alias) => isCaseFormOf(variant, alias)),
        },
    ];
    if (steps.address !== false) {
        list.push({
            via: 'звание или обращение',
            test(variant, card) {
                const bare = stripAddress(variant);
                if (!bare) return false;
                const names = [card, ...(aliasesOf.get(card) ?? [])].map(normalizeRussianName);
                // После звания имя бывает и в падеже («Капитану Даргану»), но тогда звание тоже в падеже —
                // проверяем только именительный, чтобы «сестра Ани» не стала Аней.
                return names.includes(bare) || names.some((name) => isCaseFormOf(bare, name) && variant.split(' ').length === 1);
            },
        });
    }
    if (steps.parts !== false) {
        list.push({
            via: 'часть имени',
            test(variant, card) {
                if (variant.includes(' ')) return false;
                const words = normalizeRussianName(card).split(' ');
                const index = givenNameIndex(words);
                return index >= 0 && isWordForm(variant, words[index]);
            },
        });
    }
    if (steps.diminutives !== false) {
        list.push({
            via: 'уменьшительное',
            test(variant, card) {
                const variantWords = variant.split(' ');
                const cardWords = normalizeRussianName(card).split(' ');
                if (variantWords.length === 1) return isDiminutiveOf(variantWords[0], cardWords[0]);
                if (variantWords.length !== cardWords.length) return false;
                return isDiminutiveOf(variantWords[0], cardWords[0])
                    && variantWords.slice(1).every((word, index) => isWordForm(word, cardWords[index + 1]));
            },
        });
    }
    if (steps.translit !== false) {
        list.push({
            via: 'транслит',
            test(variant, card, raw) {
                // Без замены ё на е: по Поливанову «сё» — это «sho», а «се» — «se».
                const variantWords = lowerWords(raw);
                const cardWords = lowerWords(card);
                if (variantWords.length === cardWords.length) {
                    return variantWords.every((word, index) => sameWordAcrossScripts(word, cardWords[index]));
                }
                const index = givenNameIndex(cardWords);
                return variantWords.length === 1 && index >= 0 && sameWordAcrossScripts(variantWords[0], cardWords[index]);
            },
        });
    }
    return list;
}

/**
 * Решение по одному имени из трекера: дописать его алиасом к карточке, спрятать (форма имени
 * персонажа пользователя) или оставить как есть.
 * @param {string} name
 * @param {NameContext} context
 * @returns {NameDecision}
 */
export function decideName(name, context) {
    const variant = String(name ?? '').trim();
    if (!variant) return { action: 'skip', reason: 'пустое имя' };
    if (context.npcCards.includes(variant) || context.hiddenCards?.includes(variant)) return { action: 'skip', reason: 'это карточка' };
    if (context.isAlias(variant)) return { action: 'skip', reason: 'уже алиас' };
    const normalized = normalizeRussianName(variant);
    const npc = [...new Set(context.npcCards)];
    const users = [...new Set(context.userCards ?? [])];
    if (users.includes(variant)) return { action: 'skip', reason: 'это персонаж пользователя' };

    for (const step of matchSteps(context)) {
        const candidates = npc.filter((card) => step.test(normalized, card, variant));
        const personas = users.filter((card) => step.test(normalized, card, variant));
        if (!candidates.length && !personas.length) continue;
        if (candidates.length + personas.length > 1) {
            return { action: 'skip', reason: 'подходит нескольким карточкам', candidates: [...candidates, ...personas] };
        }
        if (personas.length) {
            // Алиасы на персонажа пользователя DES запрещает; форму его имени прячем из списка персонажей.
            const persona = personas[0];
            // То же имя с другим регистром или «е» вместо «ё» DES и так считает персонажем — его не прячем.
            if (context.keyOf(variant) === context.keyOf(persona)) return { action: 'skip', reason: 'это персонаж пользователя' };
            const reason = context.excluded(variant, persona);
            if (reason) return { action: 'skip', reason };
            return { action: 'hide', persona, via: step.via };
        }
        const canonical = candidates[0];
        // Имя, которое DES считает другой существующей карточкой, не трогаем: алиас у DES сильнее карточки.
        const other = (context.cardKeys.get(context.keyOf(variant)) ?? []).find((card) => card !== canonical);
        if (other !== undefined) return { action: 'skip', reason: `есть отдельная карточка «${other}»` };
        const reason = context.excluded(variant, canonical);
        if (reason) return { action: 'skip', reason };
        return { action: 'alias', canonical, via: step.via };
    }
    return { action: 'skip', reason: 'не похоже ни на одну карточку' };
}

// ─── Листы ─────────────────────────────────────────────────────────────────

/** Пояснения к имени в листе: в скобках и прозвище в кавычках. */
const NAME_NOTES = /\([^)]*\)|\[[^\]]*\]|«[^»]*»|"[^"]*"|“[^”]*”|„[^“”]*[“”]/g;
/** Всё после запятой, косой черты или тире с пробелами — тоже пояснение: «Флоренс Клеймор, капитан». */
const NAME_TAIL = /\s[—–-]\s|[,;/|]/;

/**
 * Имя из листа без пояснений: «Флоренс Клеймор (урождённая Блэкени)» → «Флоренс Клеймор»,
 * «Флоренс «Фло» Клеймор, капитан» → «Флоренс Клеймор». Снимать нечего — то же имя.
 * @param {unknown} name
 */
export function bareSheetName(name) {
    const raw = String(name ?? '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
    const bare = raw.replace(NAME_NOTES, ' ').replace(/\s*[([].*$/, '').split(NAME_TAIL)[0].replace(/\s+/g, ' ').trim();
    return bare || raw;
}

/** Слова имени для сравнения листа с карточкой: без званий, частиц и суффиксов обращения. */
function significantWords(name) {
    return lowerWords(name)
        .map((word) => word.replace(HONORIFIC_SUFFIX, ''))
        .filter((word) => word && !TITLES.has(word.replace(/ё/g, 'е')) && !NAME_PARTICLES.has(word));
}

/**
 * Чей лист. DES сохраняет лист под именем, которое подставил из самого листа, а оно бывает полнее карточки:
 * «Флоренс Клеймор (урождённая Блэкени)» при карточке «Флоренс». По очереди: как имя из трекера (decideName),
 * то же без пояснений и, наконец, карточка, все слова которой есть в имени из листа и среди них — первое
 * значимое слово этого имени (само имя): «Артур Клеймор» — не лист «Клеймора» и не «Мистера Клеймора».
 * Из таких берём самую полную («Флоренс Клеймор» раньше «Флоренс»); две равные — решать пользователю.
 * @param {string} name
 * @param {NameContext} context
 * @returns {NameDecision}
 */
export function decideSheetOwner(name, context) {
    const raw = String(name ?? '').trim();
    const direct = decideName(raw, context);
    if (direct.action !== 'skip' || direct.candidates) return direct;
    const bare = bareSheetName(raw);
    const users = context.userCards ?? [];
    /** @param {string} canonical @param {string} via @returns {NameDecision} */
    const owner = (canonical, via) => {
        const reason = context.excluded(raw, canonical) ?? context.excluded(bare, canonical);
        return reason ? { action: 'skip', reason } : { action: 'alias', canonical, via };
    };
    if (bare !== raw) {
        if (users.includes(bare)) return { action: 'skip', reason: 'лист персонажа пользователя' };
        if (context.npcCards.includes(bare)) return owner(bare, 'без пояснения');
        const decision = decideName(bare, context);
        if (decision.action === 'alias') return owner(decision.canonical, decision.via);
        if (decision.action !== 'skip' || decision.candidates) return decision;
    }

    // Полное имя при короткой карточке: все слова карточки есть в имени из листа, и имя из листа — одно из них.
    const words = significantWords(bare);
    if (words.length < 2) return direct;
    const translit = context.steps?.translit !== false;
    /** @param {string} a @param {string} b */
    const same = (a, b) => a.replace(/ё/g, 'е') === b.replace(/ё/g, 'е') || (translit && sameWordAcrossScripts(a, b));
    /** @param {string} card @returns {number} сколько слов карточки нашлось; 0 — не все или нет имени */
    const fit = (card) => {
        const cardWords = significantWords(card);
        const all = cardWords.length > 0 && cardWords.every((word) => words.some((own) => same(own, word)));
        return all && cardWords.some((word) => same(words[0], word)) ? cardWords.length : 0;
    };
    const personas = [...new Set(users)].filter((card) => fit(card) > 0);
    if (personas.length) return { action: 'skip', reason: 'похоже на персонажа пользователя', candidates: personas };
    const scored = [...new Set(context.npcCards)].map((card) => ({ card, score: fit(card) })).filter(({ score }) => score > 0);
    if (!scored.length) return direct;
    const best = Math.max(...scored.map(({ score }) => score));
    const top = scored.filter(({ score }) => score === best).map(({ card }) => card);
    if (top.length > 1) return { action: 'skip', reason: 'подходит нескольким карточкам', candidates: top };
    return owner(top[0], 'полное имя');
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
