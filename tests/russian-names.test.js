import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareSheetName, decideName, decideSheetOwner, findCaseDuplicates, isCaseFormOf, normalizeRussianName, wordForms } from '../src/lib/russian-names.js';

const FORMS = {
    'Аня': ['Ани', 'Ане', 'Аню', 'Аней', 'Анею'],
    'Анна': ['Анны', 'Анне', 'Анну', 'Анной', 'Анною'],
    'Ольга': ['Ольги', 'Ольге', 'Ольгу', 'Ольгой'],
    'Маша': ['Маши', 'Маше', 'Машу', 'Машей'],
    'Мария': ['Марии', 'Марию', 'Марией'],
    'Илья': ['Ильи', 'Илье', 'Илью', 'Ильёй'],
    'Иван': ['Ивану', 'Иваном', 'Иване'],
    'Андрей': ['Андрея', 'Андрею', 'Андреем', 'Андрее'],
    'Василий': ['Василию', 'Василием', 'Василии'],
    'Игорь': ['Игоря', 'Игорю', 'Игорем'],
    'Любовь': ['Любови', 'Любовью'],
    'Павел': ['Павлу', 'Павлом', 'Павле'],
    'Лев': ['Льву', 'Львом', 'Льве'],
    'Пётр': ['Петру', 'Петром'],
    'Достоевский': ['Достоевского', 'Достоевскому', 'Достоевским'],
    'Толстая': ['Толстой', 'Толстую'],
    'Аня Петрова': ['Ани Петровой', 'Аню Петрову', 'Аней Петровой'],
    'Мира': ['Миры', 'Мире', 'Миру', 'Мирой'],
};

test('case forms of a card name are recognised', () => {
    for (const [canonical, forms] of Object.entries(FORMS)) {
        for (const form of forms) assert.ok(isCaseFormOf(form, canonical), `${form} → ${canonical}`);
    }
});

test('case and ё differences count as the same name', () => {
    assert.ok(isCaseFormOf('аня', 'Аня'));
    assert.ok(isCaseFormOf('АНЯ', 'Аня'));
    assert.ok(isCaseFormOf('Алена', 'Алёна'));
    assert.ok(isCaseFormOf('акари', 'Акари'));
    assert.equal(normalizeRussianName('  Алёна   Петрова '), 'алена петрова');
});

test('different names with similar spelling stay apart', () => {
    const pairs = [['Ана', 'Аня'], ['Аня', 'Ана'], ['Аня', 'Анна'], ['Анна', 'Аня'], ['Ася', 'Аня'], ['Арина', 'Ирина'],
        ['Марина', 'Мария'], ['Мария', 'Марина'], ['Саша', 'Маша'], ['Мир', 'Мира'], ['Иванов', 'Иван'], ['Акарой', 'Акари']];
    for (const [variant, canonical] of pairs) assert.ok(!isCaseFormOf(variant, canonical), `${variant} ≠ ${canonical}`);
});

test('a female name is never merged into the male card it looks like a genitive of', () => {
    const pairs = [['Александра', 'Александр'], ['Яна', 'Ян'], ['Валентина', 'Валентин'], ['Ярослава', 'Ярослав'],
        ['Валерия', 'Валерий'], ['Юлия', 'Юлий'], ['Евгения', 'Евгений'], ['Петрова', 'Петров'], ['Ивана', 'Иван'],
        ['Павла', 'Павел'], ['Аня Петрова', 'Аня Петров']];
    for (const [variant, canonical] of pairs) assert.ok(!isCaseFormOf(variant, canonical), `${variant} ≠ ${canonical}`);
    // Остальные падежи мужского имени по-прежнему склеиваются.
    for (const form of ['Александру', 'Александром', 'Александре']) assert.ok(isCaseFormOf(form, 'Александр'), form);
    for (const form of ['Валерию', 'Валерием']) assert.ok(isCaseFormOf(form, 'Валерий'), form);
});

test('word counts must match: first name vs full name is not a case form', () => {
    assert.ok(!isCaseFormOf('Аня', 'Аня Петрова'));
    assert.ok(!isCaseFormOf('Акари Саотомэ', 'Акари'));
    assert.ok(!isCaseFormOf('Ани Смирновой', 'Аня Петрова'));
    assert.ok(!isCaseFormOf('Мисс Танака (голос из зала)', 'Мисс Танака'));
});

/** Контекст как у модуля: ключ DES — нижний регистр без диакритики. */
function context({ npc = [], users = [], aliases = [], excluded = () => null } = {}) {
    const keyOf = (name) => String(name).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    const cardKeys = new Map();
    for (const name of [...npc, ...users]) cardKeys.set(keyOf(name), [...(cardKeys.get(keyOf(name)) ?? []), name]);
    const aliasKeys = new Set(aliases.map((alias) => alias.toLowerCase()));
    return { npcCards: npc, keyOf, cardKeys, isAlias: (name) => aliasKeys.has(name.trim().toLowerCase()), excluded };
}

test('a case form of an NPC card becomes its alias', () => {
    const ctx = context({ npc: ['Аня', 'Мира'] });
    assert.deepEqual(decideName('Аней', ctx), { action: 'alias', canonical: 'Аня', via: 'падеж' });
    assert.deepEqual(decideName('  Мирой ', ctx), { action: 'alias', canonical: 'Мира', via: 'падеж' });
    assert.deepEqual(decideName('аня', ctx), { action: 'alias', canonical: 'Аня', via: 'падеж' });
});

test('cards, aliases, persons and ambiguity are left to DES', () => {
    assert.equal(decideName('Аня', context({ npc: ['Аня'] })).reason, 'это карточка');
    assert.equal(decideName('Ани', context({ npc: ['Аня'], aliases: ['ани'] })).reason, 'уже алиас');
    assert.equal(decideName('Лену', context({ users: ['Лена'] })).reason, 'не похоже ни на одну карточку');
    const ambiguous = decideName('ани', context({ npc: ['Аня', 'Ани'] }));
    assert.equal(ambiguous.reason, 'подходит нескольким карточкам');
    assert.deepEqual(ambiguous.candidates, ['Аня', 'Ани']);
    assert.match(decideName('лена', context({ npc: ['Лена'], users: ['ЛЕНА'] })).reason, /отдельная карточка/);
    assert.equal(decideName('', context({ npc: ['Аня'] })).reason, 'пустое имя');
});

test('exceptions and unmerged pairs are respected', () => {
    const ctx = context({ npc: ['Аня'], excluded: (variant, canonical) => (variant === 'Ани' && canonical === 'Аня' ? 'разъединено' : null) });
    assert.equal(decideName('Ани', ctx).reason, 'разъединено');
    assert.equal(decideName('Аней', ctx).action, 'alias');
});

test('a player character with the same key is never redirected to an NPC', () => {
    assert.match(decideName('лена', context({ npc: ['Лена'], users: ['лена'] })).reason, /отдельная карточка «лена»/);
});

test('existing case duplicates are found, once per pair', () => {
    assert.deepEqual(findCaseDuplicates(['Аня', 'Аней', 'Мира', 'Ана']), [{ variant: 'Аней', canonical: 'Аня' }]);
    assert.deepEqual(findCaseDuplicates(['Аня', 'аня']), [{ variant: 'аня', canonical: 'Аня' }]);
    assert.deepEqual(findCaseDuplicates(['Аня', 'Ани', 'ани']), [{ variant: 'Ани', canonical: 'Аня' }]);
    assert.deepEqual(findCaseDuplicates(['Аня Петрова', 'Аня']), []);
});

test('real names from the server sample are not merged by mistake', () => {
    const ctx = context({ npc: ['Акари', 'Мисс Танака', 'Студентки в зале'] });
    assert.equal(decideName('Акари Саотомэ', ctx).action, 'skip');
    assert.equal(decideName('Мисс Танака (голос из зала)', ctx).action, 'skip');
    assert.deepEqual(decideName('Мисс Танаке', ctx), { action: 'alias', canonical: 'Мисс Танака', via: 'падеж' });
});

test('case forms of an alias lead to its card', () => {
    const ctx = context({ npc: ['Дарган фон Вартенбург'] });
    ctx.aliasesOf = new Map([['Дарган фон Вартенбург', ['Дарган']]]);
    assert.deepEqual(decideName('Даргану', ctx), { action: 'alias', canonical: 'Дарган фон Вартенбург', via: 'падеж алиаса' });
    assert.deepEqual(decideName('Дарганом', ctx), { action: 'alias', canonical: 'Дарган фон Вартенбург', via: 'падеж алиаса' });
});

test('titles and Japanese honorifics are stripped, kinship words are not', () => {
    const ctx = context({ npc: ['Дарган', 'Аня', 'Akari'] });
    assert.equal(decideName('Капитан Дарган', ctx).canonical, 'Дарган');
    assert.equal(decideName('Фельдмаршал Дарган', ctx).via, 'звание или обращение');
    assert.equal(decideName('Аня-сан', ctx).canonical, 'Аня');
    assert.equal(decideName('Akari-chan', ctx).canonical, 'Akari');
    assert.equal(decideName('сестра Ани', ctx).action, 'skip');
    assert.equal(decideName('мать Ани', ctx).action, 'skip');
});

test('a first name or a surname alone leads to the full card, unless two cards share it', () => {
    const ctx = context({ npc: ['Аня Петрова', 'Дарган фон Вартенбург'] });
    assert.deepEqual(decideName('Аня', ctx), { action: 'alias', canonical: 'Аня Петрова', via: 'часть имени' });
    assert.equal(decideName('Ани', ctx).canonical, 'Аня Петрова');
    assert.equal(decideName('Петровой', ctx).canonical, 'Аня Петрова');
    assert.equal(decideName('Вартенбургу', ctx).canonical, 'Дарган фон Вартенбург');
    assert.equal(decideName('фон', ctx).action, 'skip');
    const twins = decideName('Аня', context({ npc: ['Аня Петрова', 'Аня Смирнова'] }));
    assert.equal(twins.reason, 'подходит нескольким карточкам');
    // Есть карточка ровно «Аня» — форма идёт к ней, а не к «Ане Петровой».
    assert.equal(decideName('Ане', context({ npc: ['Аня', 'Аня Петрова'] })).canonical, 'Аня');
});

test('diminutives lead to the full name and back, ambiguity is left to DES', () => {
    assert.deepEqual(decideName('Саша', context({ npc: ['Александр'] })), { action: 'alias', canonical: 'Александр', via: 'уменьшительное' });
    assert.equal(decideName('Саше', context({ npc: ['Александр'] })).canonical, 'Александр');
    assert.equal(decideName('Аня', context({ npc: ['Анна Петрова'] })).canonical, 'Анна Петрова');
    assert.equal(decideName('Александру', context({ npc: ['Саша'] })).canonical, 'Саша');
    assert.equal(decideName('Шура', context({ npc: ['Саша'] })).canonical, 'Саша');
    assert.equal(decideName('Саша', context({ npc: ['Александр', 'Александра'] })).reason, 'подходит нескольким карточкам');
    assert.equal(decideName('Маша', context({ npc: ['Александр'] })).action, 'skip');
});

test('transliteration links Cyrillic and Latin spellings', () => {
    assert.deepEqual(decideName('Акари', context({ npc: ['Akari'] })), { action: 'alias', canonical: 'Akari', via: 'транслит' });
    assert.equal(decideName('Anya', context({ npc: ['Аня'] })).canonical, 'Аня');
    assert.equal(decideName('Ania', context({ npc: ['Аня'] })).canonical, 'Аня');
    assert.equal(decideName('Сётаро', context({ npc: ['Shotaro'] })).canonical, 'Shotaro');
    assert.equal(decideName('Тиё', context({ npc: ['Chiyo'] })).canonical, 'Chiyo');
    assert.equal(decideName('Акари', context({ npc: ['Akari Saotome'] })).canonical, 'Akari Saotome');
    assert.equal(decideName('Ana', context({ npc: ['Аня'] })).action, 'skip');
    assert.equal(decideName('Mira', context({ npc: ['Аня'] })).action, 'skip');
});

test('forms of a player character are hidden, never aliased', () => {
    const ctx = context({ npc: ['Аня'], users: ['Лиза'] });
    ctx.userCards = ['Лиза'];
    assert.deepEqual(decideName('Лизы', ctx), { action: 'hide', persona: 'Лиза', via: 'падеж' });
    assert.equal(decideName('Лизонька', ctx).action, 'hide');
    assert.equal(decideName('лиза', ctx).reason, 'это персонаж пользователя');
    assert.equal(decideName('Лиза', ctx).reason, 'это персонаж пользователя');
    assert.equal(decideName('Ани', ctx).action, 'alias');
});

test('steps can be switched off', () => {
    const ctx = context({ npc: ['Аня Петрова'] });
    ctx.steps = { parts: false, diminutives: false, translit: false, address: false };
    assert.equal(decideName('Аня', ctx).action, 'skip');
    assert.equal(decideName('Ани Петровой', ctx).action, 'alias');
});

test('word forms with the genitive are available for text search', () => {
    assert.ok(wordForms('иван', { genitive: true }).includes('ивана'));
    assert.ok(!wordForms('иван').includes('ивана'));
    assert.ok(wordForms('павел', { genitive: true }).includes('павла'));
    assert.ok(wordForms('василий', { genitive: true }).includes('василия'));
    assert.deepEqual(wordForms('акари'), ['акари']);
});

test('notes are stripped from a sheet name', () => {
    assert.equal(bareSheetName('Флоренс Клеймор (урождённая Блэкени)'), 'Флоренс Клеймор');
    assert.equal(bareSheetName('Флоренс «Фло» Клеймор, капитан команды'), 'Флоренс Клеймор');
    assert.equal(bareSheetName('**Флоренс Клеймор** — бариста'), 'Флоренс Клеймор');
    assert.equal(bareSheetName('Флоренс / Florence'), 'Флоренс');
    assert.equal(bareSheetName('Флоренс Клеймор (урождённая'), 'Флоренс Клеймор');
    assert.equal(bareSheetName('Анна-Мария Клеймор'), 'Анна-Мария Клеймор');
    assert.equal(bareSheetName('(Флоренс)'), '(Флоренс)');
});

test('a sheet saved under a fuller name goes to the short card', () => {
    const ctx = context({ npc: ['Флоренс', 'Шарлотта'] });
    assert.deepEqual(decideSheetOwner('Флоренс Клеймор (урождённая Блэкени)', ctx), { action: 'alias', canonical: 'Флоренс', via: 'полное имя' });
    assert.equal(decideSheetOwner('Шарлотта Клеймор', ctx).canonical, 'Шарлотта');
    assert.equal(decideSheetOwner('Леди Флоренс Клеймор', ctx).canonical, 'Флоренс');
    // Восточный порядок: фамилия первой.
    assert.equal(decideSheetOwner('Ямада Акари', context({ npc: ['Акари'] })).canonical, 'Акари');
    assert.equal(decideSheetOwner('Florence Claymore', context({ npc: ['Florence'] })).canonical, 'Florence');
    // Без пояснения — ровно карточка.
    assert.deepEqual(decideSheetOwner('Флоренс Клеймор (урождённая Блэкени)', context({ npc: ['Флоренс Клеймор', 'Флоренс'] })),
        { action: 'alias', canonical: 'Флоренс Клеймор', via: 'без пояснения' });
    assert.equal(decideSheetOwner('Аня (младшая сестра)', context({ npc: ['Аня'] })).canonical, 'Аня');
    // Как в трекере: падеж и часть имени по-прежнему работают.
    assert.equal(decideSheetOwner('Аней', context({ npc: ['Аня'] })).canonical, 'Аня');
    assert.equal(decideSheetOwner('Аня', context({ npc: ['Аня Петрова'] })).canonical, 'Аня Петрова');
});

test('a fuller sheet name prefers the fullest card and leaves real ambiguity alone', () => {
    assert.equal(decideSheetOwner('Флоренс Клеймор Младшая', context({ npc: ['Флоренс', 'Флоренс Клеймор'] })).canonical, 'Флоренс Клеймор');
    const family = decideSheetOwner('Флоренс Клеймор', context({ npc: ['Флоренс', 'Клеймор'] }));
    assert.equal(family.action, 'skip');
    assert.deepEqual(family.candidates.sort(), ['Клеймор', 'Флоренс']);
    assert.equal(decideSheetOwner('Флоренс Клеймор', context({ npc: ['Шарлотта'] })).action, 'skip');
    assert.equal(decideSheetOwner('Флоренс', context({ npc: ['Шарлотта'] })).action, 'skip');
    // Слово карточки должно стоять в имени целиком: «Флор» — не «Флоренс».
    assert.equal(decideSheetOwner('Флоренс Клеймор', context({ npc: ['Флор'] })).action, 'skip');
});

test('sheet owners respect exceptions and the player character', () => {
    const excluded = (variant) => (normalizeRussianName(variant) === 'флоренс клеймор (урожденная блэкени)' ? 'в исключениях' : null);
    assert.equal(decideSheetOwner('Флоренс Клеймор (урождённая Блэкени)', context({ npc: ['Флоренс'], excluded })).reason, 'в исключениях');
    const ctx = context({ npc: ['Флоренс'], users: ['Артур'] });
    ctx.userCards = ['Артур'];
    assert.equal(decideSheetOwner('Артур Клеймор', ctx).action, 'skip');
    assert.equal(decideSheetOwner('Флоренс Клеймор', ctx).canonical, 'Флоренс');
});
