import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markOffScene, normalizeNoQuest } from '../src/lib/tracker-fixes.js';
import { findRussianOffScene, isRussianNoQuest } from '../src/lib/russian-markers.js';
import { DES_VALUES, hasDesOffSceneMarker } from '../src/des-adapter.js';

const offSceneRules = { marker: DES_VALUES.offSceneMarker, find: findRussianOffScene, alreadyMarked: hasDesOffSceneMarker };
const questRules = { none: DES_VALUES.noQuest, isNone: isRussianNoQuest };

test('markOffScene appends the DES marker only to off-scene characters', () => {
    const json = JSON.stringify([
        { name: 'Мира', thoughts: { content: 'Надо заказать ещё эля.' } },
        { name: 'Аня', thoughts: { content: '(не присутствует в сцене) Дома тихо.' } },
        { name: 'Ян', thoughts: 'Вне сцены.' },
    ]);
    const { text, marked } = markOffScene(json, offSceneRules);
    const result = JSON.parse(text);
    assert.deepEqual(marked.map((entry) => entry.name), ['Аня', 'Ян']);
    assert.equal(result[0].thoughts.content, 'Надо заказать ещё эля.');
    assert.equal(result[1].thoughts.content, '(не присутствует в сцене) Дома тихо. (off-scene)');
    assert.equal(result[2].thoughts, 'Вне сцены. (off-scene)');
    assert.ok(hasDesOffSceneMarker(result[1].thoughts.content), 'DES must recognise the marker');
});

test('markOffScene keeps the { characters } wrapper and is idempotent', () => {
    const json = JSON.stringify({ characters: [{ name: 'Аня', thoughts: { content: 'За кадром.' } }] });
    const first = markOffScene(json, offSceneRules);
    assert.equal(first.marked.length, 1);
    assert.ok(Array.isArray(JSON.parse(first.text).characters));
    const second = markOffScene(first.text, offSceneRules);
    assert.equal(second.marked.length, 0);
    assert.equal(second.text, first.text);
});

test('markOffScene leaves broken or foreign data untouched', () => {
    assert.deepEqual(markOffScene('not json', offSceneRules), { text: 'not json', marked: [] });
    assert.equal(markOffScene('{"foo": 1}', offSceneRules).marked.length, 0);
});

test('normalizeNoQuest turns a Russian "no quest" into the DES value', () => {
    const json = JSON.stringify({ main: { title: 'Нет' }, optional: [{ title: 'Найти ключ' }, { title: '—' }, 'нет'] });
    const { text, changed } = normalizeNoQuest(json, questRules);
    const result = JSON.parse(text);
    assert.deepEqual(changed, ['Нет', '—', 'нет']);
    assert.deepEqual(result.main, { title: 'None' });
    assert.deepEqual(result.optional, [{ title: 'Найти ключ' }]);
});

test('normalizeNoQuest handles string quests and leaves real ones alone', () => {
    assert.equal(JSON.parse(normalizeNoQuest('{"main": "Отсутствует"}', questRules).text).main, 'None');
    const real = JSON.stringify({ main: { title: 'Найти Аню' }, optional: [] });
    assert.deepEqual(normalizeNoQuest(real, questRules), { text: real, changed: [] });
    const none = JSON.stringify({ main: { title: 'None' } });
    assert.equal(normalizeNoQuest(none, questRules).changed.length, 0);
});
