import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileKey, isRegexKey, nameFormsKey, outsideTagsKey, regexKey, wordsKey } from '../src/lib/regex-keys.js';
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

test('outside-tag keys do not match inside <KEY:VALUE> tags, but match prose', () => {
    const scene = '<GENRE:ROMANCE> <JEALOUSY:POSSESSIVE> <TRAIT:SHY, CLINGY, NEEDY> <BOUNDARIES:PERSONAL SPACE>';
    for (const word of ['jealousy', 'possessive', 'clingy', 'personal space']) {
        const key = compileKey(outsideTagsKey(word));
        assert.ok(key, `ST must accept the key for ${word}`);
        assert.ok(!key.test(scene), word);
    }
    const jealous = compileKey(outsideTagsKey('jealous'));
    assert.ok(jealous.test('She was jealous.'));
    assert.ok(jealous.test('<i>jealous</i> again'), 'closed markup around the word is not a tag');
    assert.ok(!jealous.test('Her jealousy grew.'), 'whole words, like the entry setting');
    assert.ok(compileKey(outsideTagsKey('turned on')).test('he was turned  on'));
    assert.ok(compileKey(outsideTagsKey('jealous', { wholeWords: false })).test('Her jealousy grew.'));
    assert.ok(!compileKey(outsideTagsKey('Jealous', { caseSensitive: true })).test('jealous'));
});

test('regex keys keep their pattern and flags and get the same tag guard', () => {
    const source = String.raw`/\b(?:in)?efficien(?:cy|t)\b/i`;
    const key = outsideTagsKey(source);
    assert.ok(key.startsWith(String.raw`/(?:\b(?:in)?efficien(?:cy|t)\b)`), key);
    assert.ok(key.endsWith('/i'));
    assert.ok(compileKey(key).test('So efficient.'));
    assert.ok(!compileKey(key).test('<TRAIT:EFFICIENT>'));
    assert.equal(outsideTagsKey(key), key, 'idempotent');
    assert.ok(compileKey(outsideTagsKey(String.raw`/a\/b/i`)).test('a/b'));
    assert.equal(outsideTagsKey('/broken(/i'), '/broken(/i', 'a key ST rejects stays as it is');
    assert.equal(outsideTagsKey('   '), '   ');
});
