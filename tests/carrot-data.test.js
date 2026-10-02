import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carrotDumpBodies, characterNameKey, findCharacter, isCarrotDumpBody, stripCarrotDumps, stripCarrotDumpsFromPrompt } from '../src/lib/carrot-data.js';

const scanned = () => new Map([
    ['Архив::Аня', { name: 'Аня', source: 'Архив', tags: new Map([['SPECIES', ['HUMAN']]]) }],
    ['Архив::Борис', { name: 'Борис', source: 'Архив', tags: new Map([['SPECIES', ['ORC']]]) }],
    ['Другой::Борис', { name: 'Борис', source: 'Другой', tags: new Map([['SPECIES', ['ELF']]]) }],
    ['Архив::Alice', { name: 'Alice', source: 'Архив', tags: new Map() }],
]);

test('Cyrillic names keep their letters in the comparison key', () => {
    assert.equal(characterNameKey(' Алёна  Петрова! '), 'алена петрова');
    assert.notEqual(characterNameKey('Аня'), characterNameKey('Борис'));
    assert.equal(characterNameKey('Анна-Мария'), 'анна мария');
    assert.equal(characterNameKey('Mary_Jane'), characterNameKey('Mary Jane'));
});

test('each Cyrillic character gets their own data', () => {
    assert.equal(findCharacter(scanned(), 'Борис').data.tags.get('SPECIES')[0], 'ORC');
    assert.equal(findCharacter(scanned(), 'Аня').data.tags.get('SPECIES')[0], 'HUMAN');
    assert.equal(findCharacter(scanned(), 'аня').name, 'Аня');
    assert.equal(findCharacter(scanned(), 'Вера'), null);
    assert.equal(findCharacter(scanned(), 'Alice').name, 'Alice');
});

test('among namesakes the lorebook that fired now wins', () => {
    assert.equal(findCharacter(scanned(), 'Борис', new Set(['Другой'])).data.source, 'Другой');
});

test('CK tag dumps are recognised and stripped, BunnyMo sheets are kept', () => {
    const dump = 'Ответ модели.\n\n<BunnyMoTags>\nАня:\n• SPECIES: HUMAN\n• TRAIT: CALM, KIND\n\n</BunnyMoTags>';
    assert.deepEqual(stripCarrotDumps(dump), { text: 'Ответ модели.', removed: 1 });
    const sheet = 'Лист.\n<BunnyMoTags><Name:Аня>, <SPECIES:HUMAN></BunnyMoTags>';
    assert.deepEqual(stripCarrotDumps(sheet), { text: sheet, removed: 0 });
    assert.ok(isCarrotDumpBody('Аня:\n• SPECIES: HUMAN\n'));
    assert.ok(isCarrotDumpBody('Аня:\n\nБорис:\n'), 'CK writes empty bodies when tags are arrays');
    assert.ok(!isCarrotDumpBody('просто текст'));
});

test('dump remnants are stripped from the prompt even after an HTML-cleaning regex', () => {
    const chat = [{ mes: 'Ответ.\n\n<BunnyMoTags>\nАня:\n• SPECIES: ELF\n\nБорис:\n\n</BunnyMoTags>' }, { mes: 'Без дампа.' }];
    const bodies = carrotDumpBodies(chat);
    assert.deepEqual(bodies, ['Аня:\n• SPECIES: ELF\n\nБорис:']);
    // Регулярка ST вырезала теги вместе с пробелом перед ними.
    assert.deepEqual(stripCarrotDumpsFromPrompt('Ответ.\nАня:\n• SPECIES: ELF\n\nБорис:\n', bodies), { text: 'Ответ.', removed: 1 });
    assert.deepEqual(stripCarrotDumpsFromPrompt(chat[0].mes, bodies), { text: 'Ответ.', removed: 1 });
    assert.deepEqual(stripCarrotDumpsFromPrompt('Аня: привет', bodies), { text: 'Аня: привет', removed: 0 });
});
