// Теги BunnyMo по персонажам: во вставку для сканирования идут только теги тех, кто в сцене.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SCENE_TAGS_CHARACTERS, aliasGroups, emptySceneTags, readSceneTags, recordSceneTags, sameCharacter, sceneTagList,
} from '../src/lib/scene-tags.js';

const vera = { name: 'Vera', tags: ['<DERE:KUUDERE>', '<TRAIT:LOYAL>'] };
const tom = { name: 'Tom Hale', tags: ['<DERE:DANDERE>'] };

test('tags are kept per character and replaced by a fresh archive', () => {
    let store = recordSceneTags(emptySceneTags(), [vera, tom], 1);
    assert.deepEqual(Object.keys(store.chars).sort(), ['Tom Hale', 'Vera']);
    assert.deepEqual(store.last, ['Vera', 'Tom Hale']);
    store = recordSceneTags(store, [{ name: 'Vera', tags: ['<DERE:YANDERE>'] }], 2);
    assert.deepEqual(store.chars.Vera.tags, ['<DERE:YANDERE>']);
    assert.deepEqual(store.chars['Tom Hale'].tags, ['<DERE:DANDERE>'], 'others stay recorded');
    assert.deepEqual(store.last, ['Vera']);
    assert.equal(recordSceneTags(store, [{ name: null, tags: ['<X:Y>'] }], 3), store, 'nameless archives change nothing');
});

test('only the characters present in the DES tracker bring their tags', () => {
    const store = recordSceneTags(emptySceneTags(), [vera, tom], 1);
    assert.deepEqual(sceneTagList(store, ['Vera']), { names: ['Vera'], tags: vera.tags });
    assert.deepEqual(sceneTagList(store, []), { names: [], tags: [] }, 'nobody in the scene: no pack tags');
    assert.deepEqual(sceneTagList(store, ['Tom']).names, ['Tom Hale'], 'a first name finds the full name');
    assert.deepEqual(sceneTagList(store, ['Вера'], aliasGroups({ Vera: ['Вера'] })).names, ['Vera'], 'DES aliases glue names');
    assert.deepEqual(sceneTagList(store, ['Вероника']).names, [], 'a different name does not match');
});

test('without a tracker the characters of the last activation are used', () => {
    let store = recordSceneTags(emptySceneTags(), [vera, tom], 1);
    store = recordSceneTags(store, [vera], 2);
    assert.deepEqual(sceneTagList(store, null).names, ['Vera']);
});

test('the old shared format is read as tags of each named character', () => {
    const store = readSceneTags({ names: ['Vera'], tags: ['<DERE:KUUDERE>'] });
    assert.deepEqual(store.chars.Vera.tags, ['<DERE:KUUDERE>']);
    assert.deepEqual(store.last, ['Vera']);
    assert.deepEqual(readSceneTags(null), emptySceneTags());
    assert.deepEqual(readSceneTags({ version: 2, chars: { Vera: { tags: ['<A:B>'], at: 5 }, '': { tags: ['<C:D>'] } }, last: ['Vera'] }).chars,
        { Vera: { tags: ['<A:B>'], at: 5 } });
});

test('the store is bounded, oldest characters leave first', () => {
    let store = emptySceneTags();
    for (let index = 0; index < SCENE_TAGS_CHARACTERS + 5; index += 1) store = recordSceneTags(store, [{ name: `NPC ${index}`, tags: ['<A:B>'] }], index);
    assert.equal(Object.keys(store.chars).length, SCENE_TAGS_CHARACTERS);
    assert.ok(!store.chars['NPC 0'] && store.chars[`NPC ${SCENE_TAGS_CHARACTERS + 4}`]);
});

test('sameCharacter: case, ё, first names and alias groups', () => {
    assert.ok(sameCharacter('Алёна', 'алена'));
    assert.ok(sameCharacter('Neia', 'Neia Caigella'));
    assert.ok(!sameCharacter('Anna Petrova', 'Anna Smirnova'), 'two full names with the same first name differ');
    assert.ok(sameCharacter('Нея', 'Neia Caigella', [['Neia Caigella', 'Нея']]));
});
