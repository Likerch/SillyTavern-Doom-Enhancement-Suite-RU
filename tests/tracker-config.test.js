// Проверка trackerConfig пресета DES, который пишут через API (Officina).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { MAX_TRACKER_CONFIG_LENGTH, validateTrackerConfig } = await import('../src/lib/tracker-config.js');

/** Пресет как у DES 2.6.0 по умолчанию (state.js), коротко. */
function desDefault() {
    return {
        quests: { persistInHistory: false },
        infoBox: {
            widgets: {
                date: { enabled: true, format: 'Weekday, Month, Year', persistInHistory: true },
                weather: { enabled: true, persistInHistory: true },
                temperature: { enabled: true, unit: 'C', persistInHistory: false },
                time: { enabled: true, persistInHistory: true },
                location: { enabled: true, persistInHistory: true },
                recentEvents: { enabled: true, persistInHistory: false },
                moonPhase: { enabled: false, persistInHistory: false },
            },
            customFields: [],
        },
        presentCharacters: {
            showEmoji: true,
            showName: true,
            relationships: { enabled: true, relationshipEmojis: { Lover: '❤️', Friend: '⭐' } },
            relationshipFields: ['Lover', 'Friend'],
            relationshipEmojis: { Lover: '❤️', Friend: '⭐' },
            customFields: [
                { id: 'appearance', name: 'Appearance', enabled: true, description: 'Visible physical appearance', persistInHistory: false },
                { id: 'demeanor', name: 'Demeanor', enabled: true, description: 'Observable demeanor or emotional state', persistInHistory: false },
            ],
            thoughts: { enabled: true, name: 'Thoughts', description: 'Internal Monologue', persistInHistory: false },
            characterStats: { enabled: false, customStats: [{ id: 'health', name: 'Health', enabled: true }] },
        },
    };
}

/** @param {(config: any) => void} change */
function errorsAfter(change) {
    const config = desDefault();
    change(config);
    return validateTrackerConfig(config).errors;
}

/** @param {string[]} errors @param {RegExp} pattern */
function has(errors, pattern) {
    assert.ok(errors.some((error) => pattern.test(error)), `${pattern} not in:\n${errors.join('\n')}`);
}

test('DES’s default preset passes and comes back as an independent copy', () => {
    const config = desDefault();
    const result = validateTrackerConfig(config);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.config, config);
    result.config.infoBox.widgets.date.enabled = false;
    assert.equal(config.infoBox.widgets.date.enabled, true);
});

test('Russian character fields, typed fields and scene fields with Latin names pass', () => {
    const errors = errorsAfter((config) => {
        config.presentCharacters.customFields = [
            { id: 'look', name: 'Внешность', enabled: true, description: 'Одежда, причёска, «приметы»' },
            { id: 'mood', name: 'Поведение', enabled: true, description: 'Настроение' },
            { id: 'hp', name: 'Health', enabled: true, type: 'number', min: 0, max: 100, description: 'Здоровье "в %"' },
        ];
        config.infoBox.customFields = [
            { id: 'scene_1', name: 'Threat (0–6)', icon: '⚠️', enabled: true, description: 'Угроза "растёт"', type: 'progress' },
            { id: 'scene_2', name: 'Faction', enabled: false, type: 'enum', options: ['Гильдия', 'Стража'] },
        ];
    });
    assert.deepEqual(errors, []);
});

test('the shape DES reads without checks is required', () => {
    assert.deepEqual(validateTrackerConfig(null).errors, ['trackerConfig: нужен объект']);
    assert.deepEqual(validateTrackerConfig([]).errors, ['trackerConfig: нужен объект']);
    has(errorsAfter((config) => delete config.infoBox), /^infoBox: нужен объект/);
    has(errorsAfter((config) => delete config.presentCharacters), /^presentCharacters: нужен объект/);
    has(errorsAfter((config) => delete config.infoBox.widgets), /^infoBox\.widgets: нужен объект/);
    has(errorsAfter((config) => delete config.infoBox.widgets.date), /^infoBox\.widgets\.date: обязателен/);
    has(errorsAfter((config) => delete config.presentCharacters.customFields), /^presentCharacters\.customFields: нужен массив/);
    has(errorsAfter((config) => { config.infoBox.customFields = {}; }), /^infoBox\.customFields: нужен массив/);
    has(errorsAfter((config) => { config.quests = 'none'; }), /^quests: нужен объект/);
});

test('more than 8 character fields are refused', () => {
    const fields = (count) => Array.from({ length: count }, (_, index) => ({ id: `f${index}`, name: `Field ${index}`, enabled: index < 3, description: '' }));
    assert.deepEqual(errorsAfter((config) => { config.presentCharacters.customFields = fields(8); }), []);
    has(errorsAfter((config) => { config.presentCharacters.customFields = fields(9); }), /полей 9, можно не больше 8/);
});

test('fields: ids, names, keys and types', () => {
    has(errorsAfter((config) => { config.presentCharacters.customFields[1].id = 'appearance'; }), /\[1\]\.id: id «appearance» уже есть/);
    has(errorsAfter((config) => { config.presentCharacters.customFields[1].name = ' '; }), /\[1\]\.name: нужно непустое название/);
    has(errorsAfter((config) => { config.presentCharacters.customFields[1].name = 'appearance!'; }), /тот же ключ «appearance»/);
    has(errorsAfter((config) => {
        config.presentCharacters.customFields = [
            { id: 'a', name: 'Внешность', enabled: true }, { id: 'b', name: 'внешность', enabled: true },
        ];
    }), /поле «внешность» уже есть/);
    has(errorsAfter((config) => { delete config.presentCharacters.customFields[0].enabled; }), /\[0\]\.enabled: нужно true или false/);
    has(errorsAfter((config) => { config.presentCharacters.customFields[0].type = 'date'; }), /у DES нет типа «date»/);
    has(errorsAfter((config) => { config.presentCharacters.customFields[0] = 'Appearance'; }), /\[0\]: нужен объект поля/);
    has(errorsAfter((config) => { Object.assign(config.presentCharacters.customFields[0], { type: 'number', min: 5, max: 1 }); }), /min больше max/);
    has(errorsAfter((config) => { Object.assign(config.presentCharacters.customFields[0], { type: 'enum', options: [] }); }), /у поля-выбора \(enum\) нужны варианты/);
    has(errorsAfter((config) => { Object.assign(config.presentCharacters.customFields[0], { options: ['ok', ''] }); }), /options: нужен список непустых строк/);
});

test('scene fields DES would drop silently are refused', () => {
    const scene = (field) => errorsAfter((config) => { config.infoBox.customFields = [{ id: 's1', enabled: true, ...field }]; });
    has(scene({ name: 'Угроза' }), /DES строит ключ поля сцены из латиницы/);
    has(scene({ name: 'Tension' }), /ключ «tension» занят встроенным полем сцены/);
    has(scene({ name: 'Weather (now)' }), /ключ «weather» занят/);
    has(errorsAfter((config) => {
        config.infoBox.customFields = [{ id: 's1', name: 'Threat', enabled: true }, { id: 's2', name: 'threat (0-6)', enabled: false }];
    }), /тот же ключ «threat»/);
});

test('widgets: only DES’s own, of the right form', () => {
    has(errorsAfter((config) => { config.infoBox.widgets.wheather = { enabled: true }; }), /infoBox\.widgets\.wheather: у DES нет такого виджета/);
    has(errorsAfter((config) => { config.infoBox.widgets.weather = true; }), /infoBox\.widgets\.weather: нужен объект/);
    has(errorsAfter((config) => { config.infoBox.widgets.temperature.unit = 'K'; }), /unit: нужно C или F/);
    has(errorsAfter((config) => { config.infoBox.widgets.time.enabled = 'yes'; }), /time\.enabled: нужно true или false/);
    has(errorsAfter((config) => { config.infoBox.widgets.date.format = 'Day "1"'; }), /date\.format: DES вставляет этот текст/);
});

test('text DES puts into the tracker template as is may not break it', () => {
    has(errorsAfter((config) => { config.presentCharacters.customFields[0].description = 'Looks "nice"'; }), /customFields\[0\]\.description: DES вставляет/);
    has(errorsAfter((config) => { config.presentCharacters.thoughts.description = 'C:\\path'; }), /thoughts\.description: DES вставляет/);
    has(errorsAfter((config) => { config.presentCharacters.relationshipFields = ['Lover', 'Ex "flame"']; }), /relationshipFields\[1\]: DES вставляет/);
    has(errorsAfter((config) => { config.presentCharacters.characterStats.customStats[0].name = 'H"P'; }), /customStats\[0\]\.name: DES вставляет/);
    // Описание с типом DES экранирует сам.
    assert.deepEqual(errorsAfter((config) => { Object.assign(config.presentCharacters.customFields[0], { type: 'list', description: 'Items "worn"' }); }), []);
});

test('optional parts: relationships, stats, thoughts', () => {
    has(errorsAfter((config) => { config.presentCharacters.relationships = []; }), /relationships: нужен объект/);
    has(errorsAfter((config) => { config.presentCharacters.relationships.relationshipEmojis = { Lover: 1 }; }), /relationshipEmojis: нужен объект «отношение → эмодзи»/);
    has(errorsAfter((config) => { config.presentCharacters.relationshipFields = 'Lover/Friend'; }), /relationshipFields: нужен список/);
    has(errorsAfter((config) => { config.presentCharacters.characterStats.customStats.push({ id: 'health', name: 'HP', enabled: true }); }), /id «health» уже есть у другого стата/);
    has(errorsAfter((config) => { config.presentCharacters.characterStats = { enabled: 1 }; }), /characterStats\.enabled: нужно true или false/);
    has(errorsAfter((config) => { config.presentCharacters.thoughts = 'on'; }), /thoughts: нужен объект/);
    // Старый пресет без relationships, stats и thoughts проходит.
    assert.deepEqual(errorsAfter((config) => {
        delete config.presentCharacters.relationships;
        delete config.presentCharacters.characterStats;
        delete config.presentCharacters.thoughts;
        delete config.quests;
        config.presentCharacters.legacyFlag = true;
        config.userStats = { customStats: [] };
    }), []);
});

test('only JSON goes into DES settings, of sane size', () => {
    has(errorsAfter((config) => { config.presentCharacters.characterStats.max = Infinity; }), /characterStats\.max: число должно быть конечным/);
    has(errorsAfter((config) => { config.presentCharacters.render = () => 1; }), /presentCharacters\.render: не JSON \(function\)/);
    has(errorsAfter((config) => { config.infoBox.when = new Date(0); }), /infoBox\.when: не JSON/);
    // undefined JSON выбрасывает: так редактор DES сам очищает min/max.
    assert.deepEqual(errorsAfter((config) => { config.presentCharacters.customFields[0].max = undefined; }), []);
    has(errorsAfter((config) => { config.infoBox.widgets.date.format = 'x'.repeat(MAX_TRACKER_CONFIG_LENGTH); }), /символов в JSON, предел/);
    const deep = {};
    let node = deep;
    for (let depth = 0; depth < 40; depth += 1) node = (node.next = {});
    has(errorsAfter((config) => { config.infoBox.deep = deep; }), /слишком глубокая вложенность/);
});

// ─── Настоящий пресет DES 2.6.0 по умолчанию (vendor/des или DESRU_DES_DIR) ─

const DES_DIR = process.env.DESRU_DES_DIR || fileURLToPath(new URL('../vendor/des/', import.meta.url));
const stateFile = `${DES_DIR.replace(/[\\/]+$/, '')}/src/core/state.js`;

/** trackerConfig из defaults в state.js DES: литерал объекта от `trackerConfig: {` до парной скобки. */
function desStateTrackerConfig() {
    const source = readFileSync(stateFile, 'utf8');
    const start = source.indexOf('{', source.indexOf('    trackerConfig: {'));
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1;
        if (source[end] === '}' && --depth === 0) break;
    }
    return new Function(`return (${source.slice(start, end + 1)});`)();
}

test('the default trackerConfig of the real DES passes', { skip: existsSync(stateFile) ? false : 'нет клона DES (vendor/des или DESRU_DES_DIR)' }, () => {
    const config = desStateTrackerConfig();
    assert.ok(config.infoBox?.widgets?.date, 'parsed state.js');
    assert.deepEqual(validateTrackerConfig(config).errors, []);
});
