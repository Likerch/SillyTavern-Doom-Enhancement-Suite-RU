import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRussianOffScene, isRussianNoQuest } from '../src/lib/russian-markers.js';

test('findRussianOffScene catches meta notes about being off-scene', () => {
    for (const text of [
        '(не присутствует в сцене) Дома тихо.',
        'Сейчас не на сцене, думает о работе.',
        'Её нет в сцене.',
        'Вне сцены. Ждёт звонка.',
        'За кадром: готовит ужин.',
        'Отсутствует в сцене',
        'Дома, пьёт чай (отсутствует)',
        '[не присутствует]',
        'НЕ В СЦЕНЕ',
    ]) {
        assert.ok(findRussianOffScene(text), text);
    }
});

test('findRussianOffScene ignores ordinary first-person thoughts', () => {
    for (const text of [
        'Мама ушла, а я осталась одна.',
        'Он уехал из города. Надо ему написать.',
        'В его словах отсутствует логика.',
        'Сцена была неловкой.',
        'Я не сценарист, но это странно.',
        '',
    ]) {
        assert.equal(findRussianOffScene(text), null, text);
    }
});

test('isRussianNoQuest recognises the Russian ways to say "no quest"', () => {
    for (const text of ['Нет', 'нет.', 'Отсутствует', 'Нет активного квеста', 'Пока нет', 'нет задания', '—', 'Ничего']) {
        assert.equal(isRussianNoQuest(text), true, text);
    }
    for (const text of ['Найти Аню', 'Нет пути назад', 'None', '', 'Нетопырь']) {
        assert.equal(isRussianNoQuest(text), false, text);
    }
});
