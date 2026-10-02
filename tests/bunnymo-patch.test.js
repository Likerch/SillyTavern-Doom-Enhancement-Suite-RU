import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNNYMO_ENTRIES, archiveNameWords, archiveTags, classifyWorlds, isCharacterArchive, packVocabulary } from '../src/bunnymo-adapter.js';
import { archiveFormsOf, patchEntries } from '../src/lib/bunnymo-patch.js';
import { compileKey, nameFormsKey } from '../src/lib/regex-keys.js';
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

test('detector keys never fire on the scene tags, but still on prose', () => {
    const lists = [[
        { uid: 46, world: 'BM', comment: '🔮 AUTO-TRIGGER: Jealousy Detection System', key: ['jealous', 'jealousy', 'possessive', 'clingy'], matchWholeWords: true },
        { uid: 50, world: 'BM', comment: '🔮 AUTO-TRIGGER: Attachment Style Detection', key: ['attachment', 'turned on'], matchWholeWords: true },
        { uid: 52, world: 'BM', comment: '🔮 AUTO-TRIGGER: Boundary Recognition Detection', key: ['/\\b(?:in)?efficien(?:cy|t)\\b/i'] },
        { uid: 55, world: 'BM', comment: '🔮 AUTO-TRIGGER: ANTI CLANKER ALPHA - Α (Aggro) - Speech Focused', key: ['/\\btemplat(?:e|es)\\b/i'], content: 'x' },
    ]];
    const original = lists[0][0].key;
    patchEntries(lists, ALL, BUNNYMO_ENTRIES, helpers);
    const scene = '<GENRE:ROMANCE> <JEALOUSY:POSSESSIVE> <TRAIT:CLINGY> <ATTACHMENT:FEARFUL_AVOIDANT> <TRAIT:EFFICIENT> <TEMPLATE:MERFOLK>';
    const fires = (entry, text) => entry.key.some((key) => compileKey(key)?.test(text));
    for (const entry of lists[0]) {
        assert.ok(entry.key.every((key) => compileKey(key)), `ST accepts every key of #${entry.uid}`);
        assert.ok(!fires(entry, scene), `#${entry.uid} on the scene tags`);
    }
    const [jealousy, attachment, boundary, alpha] = lists[0];
    assert.ok(fires(jealousy, 'She was so jealous.'));
    assert.ok(fires(jealousy, 'Она ревновала.'), 'the Russian key is kept');
    assert.ok(fires(attachment, 'He was turned on.'));
    assert.ok(fires(boundary, 'How efficient.'));
    assert.ok(fires(alpha, 'Use the template.'));
    assert.deepEqual(original, ['jealous', 'jealousy', 'possessive', 'clingy'], 'the cached array is not mutated');
    const again = [[{ uid: 46, world: 'BM', comment: '🔮 AUTO-TRIGGER: Jealousy Detection System', key: original, matchWholeWords: true }]];
    patchEntries(again, ALL, BUNNYMO_ENTRIES, helpers);
    assert.deepEqual(again[0][0].key, jealousy.key, 'deterministic');
});

test('BunnyMo sheet templates and placeholder blocks are not character archives', () => {
    const template = (key, name) => ({ world: 'BM', comment: '👤FULL CHARACTER SHEET FORMAT 👤', key: [key],
        content: `<BunnymoTags><Name:${name}>, <GENRE:BLANK>, <GENRE:ROMANCE>, <LING:SUGGESTIVE></BunnymoTags>` });
    assert.ok(!isCharacterArchive(template('!fullsheet', 'NAME')));
    assert.ok(!isCharacterArchive(template('!updatesheet', 'BLANK')));
    assert.ok(!isCharacterArchive({ world: 'Мой', key: ['NAME HERE'], content: '<BunnymoTags><Name:NAME>, <GENRE:BLANK></BunnymoTags>' }));
    assert.ok(!isCharacterArchive({ world: 'Мой', key: ['x'], content: '<BunnymoTags><GENDER:VALUE></BunnymoTags>' }));
    assert.ok(isCharacterArchive({ world: 'Мой', key: ['Аня'], content: '<BunnymoTags><Name:Аня>, <SPECIES:HUMAN></BunnymoTags>' }));
    assert.ok(isCharacterArchive({ world: 'Мой', key: ['Аня'], content: '<BunnymoTags><Name:Аня></BunnymoTags>' }));
    const tags = archiveTags({ content: '<BunnymoTags><Name:Аня>, <GENRE:BLANK>, <Dere:NEW>, <ATTACHMENT:TARGET>, <LING:NONE>, <LING:OLD></BunnymoTags>' });
    assert.deepEqual(tags.tags, ['<LING:NONE>', '<LING:OLD>'], 'placeholders dropped; NONE and OLD are real pack values');
});

test('packs wrapped in <BunnymoTags:…> are packs, not the core lorebook', () => {
    const wrapped = (world, n) => Array.from({ length: n }, (_, i) => ({ world, key: [], comment: `Lens ${i}`, content: `<BunnymoTags:Lens ${i}>\ntext\n</BunnymoTags:Lens ${i}>` }));
    const entries = [
        ...['!fullsheet', '!quicksheet', '!tagsheet'].map((key) => ({ world: 'BunnyMo', key: [key], comment: 'sheet' })),
        ...wrapped('Линзы', 4),
        ...wrapped('Мало', 2),
    ];
    const { core, packs } = classifyWorlds(entries);
    assert.deepEqual([...core], ['BunnyMo']);
    assert.deepEqual([...packs], ['Линзы']);
});

test('archive keys skip case forms that are other names', () => {
    const archives = [
        { world: 'А', key: ['Иван Петров'], content: '<BunnymoTags><Name:Иван Петров>, <SPECIES:HUMAN></BunnymoTags>' },
        { world: 'А', key: ['Мария'], content: '<BunnymoTags><Name:Мария Петрова>, <SPECIES:HUMAN></BunnymoTags>' },
    ];
    const taken = archiveNameWords(archives);
    assert.deepEqual([...taken].sort(), ['иван', 'мария', 'петров', 'петрова']);
    const formsOf = archiveFormsOf((word) => wordForms(word, { genitive: true }), taken);
    const fires = (name, text) => compileKey(nameFormsKey(name, formsOf)).test(text);
    for (const [name, text] of [['Александр', 'Александра пришла'], ['Ян', 'Яна пришла'], ['Валентин', 'Валентина пришла'],
        ['Евгений', 'Евгения пришла'], ['Ярослав', 'Ярослава пришла'], ['Юлий', 'Юлия пришла'], ['Петров', 'Петрова пришла']]) {
        assert.ok(!fires(name, text), `${name}: ${text}`);
    }
    for (const [name, text] of [['Иван', 'нет Ивана'], ['Александр', 'с Александром'], ['Ян', 'Яну'], ['Ярослав', 'Ярославу'],
        ['Пётр', 'нет Петра'], ['Лев', 'нет Льва'], ['Аня', 'с Аней'], ['Ярослава', 'Ярослава пришла']]) {
        assert.ok(fires(name, text), `${name}: ${text}`);
    }
});
