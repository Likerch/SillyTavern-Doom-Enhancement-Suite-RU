import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, normalizeMachineLayer, resolveValue } from '../src/lib/bunnymo-normalize.js';

const vocabulary = new Map([
    ['DERE', new Set(['TSUNDERE', 'KUUDERE', 'YANDERE'])],
    ['MED', new Set(['XANAX', 'ZOLOFT'])],
    ['SPECIES', new Set(['ELF', 'KITSUNE', 'HARPY'])],
]);

test('Russian section headers become SECTION N/M, titles stay Russian', () => {
    const sheet = '## Раздел 1 из 8: 🆔 **Основа личности**\nтекст\n## РАЗДЕЛ 2/8: 👁️ **Внешность**\nтекст';
    const { text } = normalizeMachineLayer(sheet);
    assert.match(text, /^## SECTION 1\/8: 🆔 \*\*Основа личности\*\*$/m);
    assert.match(text, /^## SECTION 2\/8: 👁️ \*\*Внешность\*\*$/m);
    assert.equal(normalizeMachineLayer('**Раздел 3 из 8:** Связи').text, '**SECTION 3/8:** Связи');
});

test('plain lines need a ladder, and chapters of a story are left alone', () => {
    assert.equal(normalizeMachineLayer('Раздел 1 из 8: договор подписан.').text, 'Раздел 1 из 8: договор подписан.');
    const ladder = normalizeMachineLayer('Раздел 1 из 2: а\nРаздел 2 из 2: б').text;
    assert.equal(ladder, 'SECTION 1/2: а\nSECTION 2/2: б');
    const story = '## Часть 1 из 2\nОни шли.\n## Часть 2 из 2\nОни пришли.';
    assert.equal(normalizeMachineLayer(story).text, story);
});

test('sheet labels and the card name are fixed only in sheets', () => {
    const sheet = 'Титул персонажа: Тихий страж\n## Раздел 1 из 8: Основа\n**Имя:** Аней\n## Раздел 2 из 8: Связи';
    const canonicalName = (name) => (name === 'Аней' ? 'Аня' : null);
    const { text } = normalizeMachineLayer(sheet, { canonicalName });
    assert.match(text, /^Character Title: Тихий страж$/m);
    assert.match(text, /^\*\*Name:\*\* Аня$/m);
    assert.equal(normalizeMachineLayer('**Имя:** так сказала Аня').text, '**Имя:** так сказала Аня');
});

test('tags get English keys and values', () => {
    const { text, unresolved } = normalizeMachineLayer(
        '<BunnymoTags><Name:Аней>, <ВИД:Эльф>, <ПОЛ:женский>, <Dere:Цундере>, <ЧЕРТА:спокойная>, <GENRE:SLICE OF LIFE>, '
        + '<MED:Ксанакс>, <SPECIES:Гарпия>, <SPECIES:Неведомая зверушка></BunnymoTags>',
        { vocabulary, canonicalName: (name) => (name === 'Аней' ? 'Аня' : null) },
    );
    for (const tag of ['<Name:Аня>', '<SPECIES:ELF>', '<GENDER:FEMALE>', '<Dere:TSUNDERE>', '<TRAIT:CALM>', '<GENRE:SLICE_OF_LIFE>',
        '<MED:XANAX>', '<SPECIES:HARPY>']) {
        assert.ok(text.includes(tag), tag);
    }
    assert.deepEqual(unresolved, ['<SPECIES:Неведомая зверушка>']);
});

test('wrappers and the closing BunnymoTags case are fixed', () => {
    const { text } = normalizeMachineLayer('<BunnymoTags><ЛИЧНОСТЬ><TRAIT:CALM></ЛИЧНОСТЬ></bunnymotags>');
    assert.equal(text, '<BunnymoTags><PERSONALITY><TRAIT:CALM></PERSONALITY></BunnymoTags>');
});

test('a lone tag-like phrase in prose is not a tag', () => {
    const prose = 'На двери висела табличка <Вид: на море> и звонок.';
    assert.equal(normalizeMachineLayer(prose).text, prose);
    const dump = '<ВИД:Эльф> <ПОЛ:женский>';
    assert.equal(normalizeMachineLayer(dump).text, '<SPECIES:ELF> <GENDER:FEMALE>');
});

test('prose and foreign markup are not touched', () => {
    const prose = 'Аня улыбнулась: <тихо> — Привет. <font color=#ff00aa>«Ну здравствуй»</font> <https://example.com> 12:30';
    const result = normalizeMachineLayer(prose);
    assert.equal(result.text, prose);
    assert.deepEqual(result.unresolved, []);
});

test('values resolve by dictionary, adjective stem and transliteration', () => {
    assert.equal(resolveValue('TRAIT', 'Высокомерный'), 'ARROGANT');
    assert.equal(resolveValue('DERE', 'кудере', vocabulary), 'KUUDERE');
    assert.equal(resolveValue('DERE', 'яндэрэ', vocabulary), 'YANDERE');
    assert.equal(resolveValue('MENTAL', 'депрессия'), 'DEPRESSION');
    assert.equal(resolveValue('SPECIES', 'Кракозябра', vocabulary), null);
});

test('tags are extracted from BunnymoTags blocks only', () => {
    const text = 'Тег в прозе <SPECIES:ORC>.\n<BunnymoTags><Name:Аня>, <SPECIES:ELF> <SPECIES:ELF></BunnymoTags>';
    assert.deepEqual(extractTags(text), ['<Name:Аня>', '<SPECIES:ELF>']);
});
