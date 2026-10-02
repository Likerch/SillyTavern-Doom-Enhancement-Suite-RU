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
 * Для поиска имени в тексте (ключи лорбука, раскраска реплик) родительный нужен: там `genitive: true`.
 */

/**
 * Основы и окончания падежных форм для одного слова в именительном падеже.
 * Пустой список — слово не склоняется (Акари, Хироко): совпадёт только оно само.
 * @param {string} word нормализованное слово
 * @param {{ genitive?: boolean }} [options] `genitive` — с родительным мужских имён (см. MALE_GENITIVE_NOTE)
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

// ─── Звания, обращения, части имени ────────────────────────────────────────

/**
 * Звания и обращения перед именем: «Капитан Дарган», «Леди Мира». Только те, что не бывают родством:
 * «мать Ани» — другой персонаж, а не Аня.
 */
const TITLES = new Set([
    'капитан', 'лейтенант', 'майор', 'полковник', 'подполковник', 'генерал', 'фельдмаршал', 'маршал', 'адмирал',
    'сержант', 'капрал', 'рядовой', 'командир', 'командор', 'комендант', 'офицер', 'доктор', 'профессор',
    'господин', 'госпожа', 'мистер', 'миссис', 'мисс', 'леди', 'лорд', 'сэр', 'сир', 'сударь', 'сударыня',
    'сеньор', 'сеньора', 'сеньорита', 'синьор', 'синьора', 'мадам', 'мадемуазель', 'месье', 'мсье', 'фрау', 'фройляйн',
    'герр', 'пан', 'пани', 'князь', 'княгиня', 'княжна', 'граф', 'графиня', 'барон', 'баронесса', 'виконт', 'виконтесса',
    'маркиз', 'маркиза', 'герцог', 'герцогиня', 'король', 'королева', 'принц', 'принцесса', 'царь', 'царица', 'царевна',
    'царевич', 'император', 'императрица', 'султан', 'шейх', 'эмир', 'хан', 'святой', 'святая', 'преподобный',
    'учитель', 'учительница', 'сенсей', 'мастер', 'магистр', 'советник', 'министр', 'судья', 'шериф', 'детектив',
    'инспектор', 'агент', 'следователь', 'констебль', 'комиссар', 'старейшина', 'вождь', 'жрец', 'жрица', 'архимаг',
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
 * Слова имени, по которым его зовут отдельно: без частиц и коротких служебных слов.
 * @param {string} name нормализованное имя
 */
function nameParts(name) {
    const words = name.split(' ');
    if (words.length < 2) return [];
    return words.filter((word) => word.length >= 3 && !NAME_PARTICLES.has(word) && !TITLES.has(word));
}

/** @param {string} name */
function lowerWords(name) {
    return String(name).toLowerCase().replace(/\s+/g, ' ').trim().split(' ');
}

/**
 * Уменьшительное ли `variant` (в любом падеже) от полного имени `canonical` — или наоборот,
 * когда карточка названа уменьшительно («Саша», а в трекере «Александру»).
 * @param {string} variant нормализованное слово
 * @param {string} canonical нормализованное слово
 */
export function isDiminutiveOf(variant, canonical) {
    const forms = DIMINUTIVES[canonical];
    if (forms && forms.some((form) => isWordForm(variant, form))) return true;
    const fullNames = FULL_NAMES_BY_DIMINUTIVE.get(canonical);
    if (!fullNames) return false;
    if (fullNames.some((full) => isWordForm(variant, full))) return true;
    // Обе формы уменьшительные от одного имени: карточка «Лиза», в трекере «Лизонька».
    for (const [form, owners] of FULL_NAMES_BY_DIMINUTIVE) {
        if (form !== canonical && isWordForm(variant, form) && owners.some((owner) => fullNames.includes(owner))) return true;
    }
    return false;
}

// ─── Решение ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} NameContext
 * @property {readonly string[]} npcCards карточки NPC: только к ним DES разрешает алиасы
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
                return nameParts(normalizeRussianName(card)).some((part) => isWordForm(variant, part));
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
                return variantWords.length === 1 && cardWords.length > 1
                    && nameParts(cardWords.join(' ')).some((part) => sameWordAcrossScripts(variantWords[0], part));
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
    if (context.npcCards.includes(variant)) return { action: 'skip', reason: 'это карточка' };
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
 * то же без пояснений и, наконец, карточка, все слова которой есть в имени из листа. Из таких берём самую
 * полную («Флоренс Клеймор» раньше «Флоренс»); две равные («Флоренс» и «Клеймор») — решать пользователю.
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

    // Полное имя при короткой карточке: все слова карточки есть в имени из листа.
    const words = significantWords(bare);
    if (words.length < 2) return direct;
    const translit = context.steps?.translit !== false;
    /** @param {string} a @param {string} b */
    const same = (a, b) => a.replace(/ё/g, 'е') === b.replace(/ё/g, 'е') || (translit && sameWordAcrossScripts(a, b));
    /** @param {string} card @returns {number} сколько слов карточки нашлось; 0 — не все */
    const fit = (card) => {
        const cardWords = significantWords(card);
        const all = cardWords.length > 0 && cardWords.every((word) => words.some((own) => same(own, word)));
        return all ? cardWords.length : 0;
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
