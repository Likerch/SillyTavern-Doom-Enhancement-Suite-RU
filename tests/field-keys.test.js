import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDetailKeys } from '../src/lib/field-keys.js';
import { desDetailKey } from '../src/des-adapter.js';

// Фрагмент в том виде, в каком DES собирает шаблон персонажа (по строке на поле).
const template = [
    'Start every reply with ONE JSON code block updating the trackers.',
    '"characters": [',
    '  {',
    '    "name": "CharacterName",',
    '    "emoji": "Character Emoji",',
    '    "details": {',
    '      "": "Внешность персонажа: одежда, \\"поза\\", причёска",',
    '      "mood": "Current mood",',
    '      "": "Поведение"',
    '    },',
    '    "relationship": {"status": "Lover/Friend"}',
    '  }',
    ']',
].join('\n');

test('desDetailKey mirrors DES: Cyrillic names give an empty key', () => {
    assert.equal(desDetailKey('Внешность'), '');
    assert.equal(desDetailKey('Status Effects'), 'status_effects');
    assert.equal(desDetailKey('Mood'), 'mood');
});

test('restoreDetailKeys puts the field names back in order and keeps other lines', () => {
    const { text, replaced } = restoreDetailKeys(template, ['Внешность', 'Поведение']);
    assert.equal(replaced, 2);
    assert.match(text, /^ {6}"Внешность": "Внешность персонажа/m);
    assert.match(text, /^ {6}"mood": "Current mood",$/m);
    assert.match(text, /^ {6}"Поведение": "Поведение"$/m);
    assert.doesNotMatch(text, /^\s*"":/m);
    assert.equal(text.split('\n').length, template.split('\n').length);
});

test('restoreDetailKeys escapes quotes inside field names', () => {
    const { text } = restoreDetailKeys('"details": {\n  "": "x"\n}', ['Имя "в кавычках"']);
    assert.match(text, /"Имя \\"в кавычках\\"": "x"/);
});

test('restoreDetailKeys refuses to guess when the template changed', () => {
    const result = restoreDetailKeys(template, ['Внешность']);
    assert.equal(result.replaced, 0);
    assert.equal(result.text, template);
    assert.match(result.reason, /пустых ключей 2/);
});

test('restoreDetailKeys is a no-op without a details block or empty keys', () => {
    assert.equal(restoreDetailKeys('no tracker here', ['Внешность']).replaced, 0);
    const fixed = restoreDetailKeys(template, ['Внешность', 'Поведение']).text;
    const again = restoreDetailKeys(fixed, ['Внешность', 'Поведение']);
    assert.equal(again.replaced, 0);
    assert.equal(again.text, fixed);
});
