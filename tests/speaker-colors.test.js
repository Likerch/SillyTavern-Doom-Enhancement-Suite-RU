import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestAdjacentSpeaker, messageFontColors, namePattern } from '../src/lib/speaker-colors.js';
import { wordForms } from '../src/lib/russian-names.js';

const candidate = (name) => ({ name, pattern: namePattern(name.toLowerCase().split(' ').flatMap((word) => wordForms(word, { genitive: true }))) });

const MESSAGE = 'Аня подняла глаза. <font color=#ff66aa>«Ты опоздал»</font> — сказала она.\n'
    + 'Борис усмехнулся. <font color=#3366ff>«Пробки»</font>\n'
    + 'Ане не понравился ответ. <font color=#ff66aa>«Опять?»</font>';

test('colors are listed once in order of appearance', () => {
    assert.deepEqual(messageFontColors(MESSAGE), ['#ff66aa', '#3366ff']);
});

test('Cyrillic names and their case forms vote for the nearest color', () => {
    // Как в DES: цвета по порядку, получивший цвет персонаж дальше не участвует.
    const candidates = [candidate('Аня'), candidate('Борис')];
    assert.equal(bestAdjacentSpeaker(MESSAGE, '#ff66aa', candidates), 'Аня');
    assert.equal(bestAdjacentSpeaker(MESSAGE, '#3366ff', candidates.slice(1)), 'Борис');
    assert.equal(bestAdjacentSpeaker('Ане стало смешно. <font color=#aa0000>«Ха»</font>', '#aa0000', candidates), 'Аня');
});

test('a tie or no mention gives no speaker', () => {
    const text = 'Аня и Борис переглянулись. <font color=#00ff00>«Ну?»</font>';
    assert.equal(bestAdjacentSpeaker(text, '#00ff00', [candidate('Аня'), candidate('Борис')]), null);
    assert.equal(bestAdjacentSpeaker(text, '#00ff00', [candidate('Вера')]), null);
});

test('names inside other words do not count', () => {
    const text = 'Таня вошла. <font color=#123456>«Привет»</font>';
    assert.equal(bestAdjacentSpeaker(text, '#123456', [candidate('Аня')]), null);
});
