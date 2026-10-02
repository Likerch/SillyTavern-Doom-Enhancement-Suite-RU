import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileKey, isRegexKey, nameFormsKey, regexKey, wordsKey } from '../src/lib/regex-keys.js';
import { wordForms } from '../src/lib/russian-names.js';

test('keys are in the format ST parses, slashes are escaped', () => {
    assert.equal(regexKey('a/b'), '/a\\/b/iu');
    assert.equal(regexKey('a\\/b'), '/a\\/b/iu');
    assert.ok(compileKey(regexKey('a/b')).test('A/B'));
    assert.ok(isRegexKey('/x/i'));
    assert.ok(!isRegexKey('аня'));
});

test('word keys respect Cyrillic word boundaries', () => {
    const key = compileKey(wordsKey(['аня', 'личное пространство']));
    assert.ok(key.test('Это Аня.'));
    assert.ok(!key.test('Это Таня.'));
    assert.ok(!key.test('В бане жарко'));
    assert.ok(key.test('Не нарушай личное  пространство!'));
});

test('name keys find every case form, but not other words', () => {
    const key = compileKey(nameFormsKey('Аня Петрова', (word) => wordForms(word, { genitive: true })));
    for (const text of ['Аня Петрова пришла', 'у Ани Петровой', 'с Аней Петровой', 'АНЮ ПЕТРОВУ']) assert.ok(key.test(text), text);
    assert.ok(!key.test('Таня Петрова'));
    const ivan = compileKey(nameFormsKey('Иван', (word) => wordForms(word, { genitive: true })));
    for (const text of ['Иван', 'нет Ивана', 'Ивану', 'с Иваном']) assert.ok(ivan.test(text), text);
    assert.ok(!ivan.test('Иванов'));
    const alyona = compileKey(nameFormsKey('Алёна', (word) => wordForms(word, { genitive: true })));
    assert.ok(alyona.test('Алене'));
    assert.ok(alyona.test('Алёной'));
});
