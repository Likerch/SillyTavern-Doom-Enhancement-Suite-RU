import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideName, findCaseDuplicates, isCaseFormOf, normalizeRussianName } from '../src/lib/russian-names.js';

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
    assert.deepEqual(decideName('Аней', ctx), { action: 'alias', canonical: 'Аня' });
    assert.deepEqual(decideName('  Мирой ', ctx), { action: 'alias', canonical: 'Мира' });
    assert.deepEqual(decideName('аня', ctx), { action: 'alias', canonical: 'Аня' });
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
    assert.deepEqual(decideName('Мисс Танаке', ctx), { action: 'alias', canonical: 'Мисс Танака' });
});
