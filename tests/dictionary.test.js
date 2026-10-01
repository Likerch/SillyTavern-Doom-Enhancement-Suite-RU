import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDictionary, looksTranslatable, normalizeText, renderTemplate } from '../src/lib/dictionary.js';

const dictionary = createDictionary({
    'Present Characters': 'Персонажи в сцене',
    'Relationship': 'Отношения',
    'Time': 'Время',
    'Loading branches': 'Загружаю ветки',
    '{p} present / {t} known': '{p} в сцене / {t} всего',
    '{n} character(s)': '{n} {n|персонаж|персонажа|персонажей}',
    '{emoji} {name}\'s thoughts': '{emoji} Мысли: {name}',
    'Upload sprites to <code>data/</code> and <strong>reload</strong>.': 'Загрузи спрайты в <code>data/</code> и <strong>перезагрузи</strong>.',
    'Not translated yet': '',
});

test('normalizeText collapses template whitespace', () => {
    assert.equal(normalizeText('\n      Present\n      Characters  '), 'Present Characters');
});

test('exact strings ignore surrounding whitespace', () => {
    assert.equal(dictionary.text('  Present Characters\n'), 'Персонажи в сцене');
});

test('icons and trailing punctuation are kept around a known label', () => {
    assert.equal(dictionary.text('❤️ Relationship'), '❤️ Отношения');
    assert.equal(dictionary.text('Time:'), 'Время:');
    assert.equal(dictionary.text('Loading branches…'), 'Загружаю ветки…');
});

test('templates keep the data and reorder the chrome', () => {
    assert.equal(dictionary.text('2 present / 5 known'), '2 в сцене / 5 всего');
    assert.equal(dictionary.text("😊 Мира's thoughts"), '😊 Мысли: Мира');
});

test('templates decline the noun by number', () => {
    assert.equal(dictionary.text('1 character(s)'), '1 персонаж');
    assert.equal(dictionary.text('3 character(s)'), '3 персонажа');
    assert.equal(dictionary.text('5 character(s)'), '5 персонажей');
    assert.equal(dictionary.text('21 character(s)'), '21 персонаж');
    assert.equal(dictionary.text('12 character(s)'), '12 персонажей');
});

test('numeric placeholders only match numbers', () => {
    const numeric = createDictionary({ 'Entry {#uid}': 'Запись {uid}', 'Selected: {#n}': 'Выбрано: {n}' });
    assert.equal(numeric.text('Entry 12'), 'Запись 12');
    assert.equal(numeric.text('Entry about Anna'), null);
    assert.equal(numeric.text('Selected: 3'), 'Выбрано: 3');
});

test('rich hints can be templates too', () => {
    const rich = createDictionary({ 'A card named <strong>{name}</strong> exists.': 'Карточка <strong>{name}</strong> уже есть.' });
    assert.equal(rich.rich('A card named <strong>Аня</strong> exists.'), 'Карточка <strong>Аня</strong> уже есть.');
});

test('service keys starting with __ are ignored', () => {
    assert.equal(createDictionary({ __comment: 'note', Save: 'Сохранить' }).size, 1);
});

test('rich hints are looked up by their whole HTML', () => {
    assert.equal(
        dictionary.rich('Upload sprites to <code>data/</code>\n   and <strong>reload</strong>.'),
        'Загрузи спрайты в <code>data/</code> и <strong>перезагрузи</strong>.',
    );
});

test('unknown and empty entries are not translated', () => {
    assert.equal(dictionary.text('Something else'), null);
    assert.equal(dictionary.text('Not translated yet'), null);
    assert.equal(dictionary.text('   '), null);
});

test('renderTemplate leaves unknown placeholders alone', () => {
    assert.equal(renderTemplate('{a} и {b}', { a: '1' }), '1 и {b}');
});

test('looksTranslatable keeps UI text and skips code, links and numbers', () => {
    for (const text of ['Save', 'Present Characters', 'Open in Workshop', 'ON']) assert.equal(looksTranslatable(text), true, text);
    for (const text of ['42', 'v2.6.0', '#e94560', 'https://github.com', 'icon.png', 'portraitBar', 'dooms_tracker', 'Аня', '😊', '110px', '.webp']) {
        assert.equal(looksTranslatable(text), false, text);
    }
});
