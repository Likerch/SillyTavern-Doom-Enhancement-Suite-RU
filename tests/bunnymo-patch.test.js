import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNNYMO_ENTRIES, archiveTags, classifyWorlds, isCharacterArchive, packVocabulary } from '../src/bunnymo-adapter.js';
import { patchEntries } from '../src/lib/bunnymo-patch.js';
import { compileKey } from '../src/lib/regex-keys.js';
import { wordForms } from '../src/lib/russian-names.js';

const ALL = { detectors: true, antiClanker: true, archetypes: true, archiveKeys: true };
const helpers = { isArchive: isCharacterArchive, formsOf: (word) => wordForms(word, { genitive: true }) };

function scan() {
    return [[
        { uid: 46, world: 'BM', comment: '🔮 AUTO-TRIGGER: Jealousy Detection System', key: ['jealous', 'envious'], excludeRecursion: false, content: 'x' },
        { uid: 55, world: 'BM', comment: '🔮 AUTO-TRIGGER: ANTI CLANKER ALPHA - Α (Aggro) - Speech Focused', key: ['/\\bdata\\b/i'], content: 'rude english' },
        { uid: 57, world: 'BM', comment: '🔮 AUTO-TRIGGER: ANTI CLANKER THETA - Θ (Subtle/IC)', key: ['/\\bdata\\b/i'], content: 'theta' },
        { uid: 25, world: 'BM', comment: '◕‿◕ Master - Kaomoji Library', key: [], content: 'panic' },
        { uid: 12, world: 'BM', comment: '🎭 Master - Archetypes', key: ['!archetypes'],
            content: '<BunnymoTags:Master - Archetypes>\nfor example <Richard> <ENFJ-U> ... Format it like <{{char}}> <XXXX>)\n</BunnymoTags:Master - Archetypes>' },
        { uid: 1, world: 'Архив', comment: 'Аня', key: ['Аня', 'Anya', '/^custom$/i'], keysecondary: ['Петрова'],
            content: '<BunnymoTags><Name:Аня>, <SPECIES:HUMAN>, <DERE:KUUDERE></BunnymoTags>' },
        { uid: 2, world: 'Мир', comment: 'Таверна', key: ['таверна'], content: 'Обычная запись' },
    ]];
}

test('detectors get Russian keys and stop firing on BunnyMo text', () => {
    const lists = scan();
    const original = lists[0][0].key;
    const stats = patchEntries(lists, ALL, BUNNYMO_ENTRIES, helpers);
    const entry = lists[0][0];
    assert.equal(entry.excludeRecursion, true);
    assert.equal(entry.key.length, 3);
    assert.ok(compileKey(entry.key[2]).test('Она ревновала.'));
    assert.deepEqual(original, ['jealous', 'envious'], 'the cached array is not mutated');
    assert.equal(stats.detectors, 1);
    assert.equal(lists[0][3].preventRecursion, true);
});

test('anti-clanker gets Russian keys; only Alpha gets the Russian text', () => {
    const lists = scan();
    patchEntries(lists, ALL, BUNNYMO_ENTRIES, helpers);
    const [, alpha, theta] = lists[0];
    assert.match(alpha.content, /ВМЕШАТЕЛЬСТВО BUNNYMO/);
    assert.equal(theta.content, 'theta');
    assert.ok(compileKey(alpha.key[1]).test('Запрос принят.'));
    assert.equal(alpha.excludeRecursion, true);
});

test('archetypes ask for a hidden <NPC name> line', () => {
    const lists = scan();
    patchEntries(lists, ALL, BUNNYMO_ENTRIES, helpers);
    const content = lists[0][4].content;
    assert.match(content, /<NPC name="Richard"> <ENFJ-U>/);
    assert.match(content, /<NPC name="\{\{char\}\}"> <XXXX>/);
    assert.match(content, /как на карточке персонажа\.\n<\/BunnymoTags:Master - Archetypes>$/);
});

test('Cyrillic archive keys cover every case form; other entries are untouched', () => {
    const lists = scan();
    const stats = patchEntries(lists, ALL, BUNNYMO_ENTRIES, helpers);
    const archive = lists[0][5];
    assert.equal(stats.archiveKeys, 2);
    const regex = compileKey(archive.key[0]);
    for (const text of ['Аня', 'у Ани', 'с Аней']) assert.ok(regex.test(text), text);
    assert.ok(!regex.test('Таня'));
    assert.equal(archive.key[1], 'Anya');
    assert.equal(archive.key[2], '/^custom$/i');
    assert.ok(compileKey(archive.keysecondary[0]).test('Петровой'));
    assert.deepEqual(lists[0][6].key, ['таверна']);
});

test('options switch every fix off', () => {
    const lists = scan();
    const stats = patchEntries(lists, { detectors: false, antiClanker: false, archetypes: false, archiveKeys: false }, BUNNYMO_ENTRIES, helpers);
    assert.deepEqual(stats, { detectors: 0, antiClanker: 0, noRecursion: 0, archetypes: 0, archiveKeys: 0 });
    assert.equal(lists[0][1].content, 'rude english');
});

test('worlds are classified by content, packs by tag keys', () => {
    const entries = [
        ...['!fullsheet', '!quicksheet', '!tagsheet'].map((key) => ({ world: 'Мой BunnyMo', key: [key], comment: 'sheet' })),
        ...['<SPECIES:ELF>', '<SPECIES:ORC>', '<DEPRESSION>'].map((key) => ({ world: 'Пак', key: [key, key.toLowerCase()] })),
        { world: 'Лор', key: ['таверна'] }, { world: 'Лор', key: ['замок'] }, { world: 'Лор', key: ['<SPECIES:ELF>'] },
    ];
    const { core, packs } = classifyWorlds(entries);
    assert.deepEqual([...core], ['Мой BunnyMo']);
    assert.deepEqual([...packs], ['Пак']);
    const vocabulary = packVocabulary(entries.filter((entry) => entry.world === 'Пак'));
    assert.deepEqual([...vocabulary.get('SPECIES')], ['ELF', 'ORC']);
});

test('archive tags are read from the BunnymoTags block', () => {
    const entry = scan()[0][5];
    assert.deepEqual(archiveTags(entry), { name: 'Аня', tags: ['<SPECIES:HUMAN>', '<DERE:KUUDERE>'] });
    assert.ok(!isCharacterArchive(scan()[0][0]));
});

test('the MBTI archetype is a scene tag too, wrappers are not', () => {
    const entry = { content: '<BunnymoTags><Name:Флоренс>, <PERSONALITY><Dere:Deredere>, <esfp-h>, </PERSONALITY> <ESFP-H></BunnymoTags>' };
    assert.deepEqual(archiveTags(entry), { name: 'Флоренс', tags: ['<DERE:Deredere>', '<ESFP-H>'] });
});
