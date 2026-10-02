import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECTOR_STEMS_RU, ROBOTIC_STEMS_RU, stemsKey } from '../src/lib/bunnymo-ru.js';
import { compileKey } from '../src/lib/regex-keys.js';

const key = (stems) => {
    const regex = compileKey(stemsKey(stems));
    assert.ok(regex, 'ST must accept the key');
    return regex;
};

test('every detector key is a valid ST regex key', () => {
    for (const [name, stems] of Object.entries(DETECTOR_STEMS_RU)) assert.ok(compileKey(stemsKey(stems)), name);
    assert.ok(compileKey(stemsKey(ROBOTIC_STEMS_RU)));
});

test('detectors fire on Russian prose', () => {
    const cases = {
        jealousy: ['Она ревновала его к каждой.', 'Зависть жгла изнутри.'],
        arousal: ['Он был возбуждён.', 'Дыхание стало прерывистым и сбивчивым дыханием'],
        trauma: ['Её накрыла паника.', 'Ему было больно.', 'Флешбэк вернул её в подвал.'],
        conflict: ['— Ты меня бесишь!', 'Они снова поссорились.', 'Он злится.'],
        attachment: ['Не уходи, пожалуйста.', 'Ей было одиноко.'],
        flirting: ['Она игриво подмигнула.', 'Он явно флиртовал.'],
        boundary: ['Хватит. Не трогай меня.', 'Это нарушает моё личное пространство.'],
    };
    for (const [name, sentences] of Object.entries(cases)) {
        const regex = key(DETECTOR_STEMS_RU[name]);
        for (const sentence of sentences) assert.ok(regex.test(sentence), `${name}: ${sentence}`);
    }
});

test('detectors do not fire inside other words', () => {
    assert.ok(!key(DETECTOR_STEMS_RU.trauma).test('Это больше не повторится.'));
    assert.ok(!key(DETECTOR_STEMS_RU.conflict).test('Он любит спорт и заплатил залог.'));
    assert.ok(!key(DETECTOR_STEMS_RU.boundary).test('На столе стопка книг.'));
    assert.ok(!key(DETECTOR_STEMS_RU.jealousy).test('Ей повезло.'));
});

test('the anti-clanker key catches robotic Russian, not normal speech', () => {
    const regex = key(ROBOTIC_STEMS_RU);
    assert.ok(regex.test('Запрос принят. Выполняю протокол.'));
    assert.ok(regex.test('Это оптимальное решение согласно инструкции.'));
    assert.ok(!regex.test('— Пойдём домой, — тихо сказала она.'));
});
