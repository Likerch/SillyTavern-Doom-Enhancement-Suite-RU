import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkDictionary } from '../tools/check-dictionary.mjs';
import { createDictionary } from '../src/lib/dictionary.js';

const file = new URL('../locales/ru.json', import.meta.url);

test('locales/ru.json is valid: no duplicates, placeholders and tags line up', () => {
    const { errors, stats } = checkDictionary(file);
    assert.deepEqual(errors, []);
    assert.ok(stats.entries > 500, `entries: ${stats.entries}`);
});

test('the built-in dictionary translates the core DES chrome', () => {
    const dictionary = createDictionary(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.equal(dictionary.text('Present Characters'), 'Персонажи в сцене');
    assert.equal(dictionary.text('Weather:'), 'Погода:');
    assert.equal(dictionary.text('3 present / 5 known'), '3 в сцене / 5 всего');
    assert.equal(dictionary.text('2 characters'), '2 персонажа');
    assert.equal(dictionary.text('Entry 7'), 'Запись 7');
    assert.equal(dictionary.text('Entry about Anna'), null);
});
