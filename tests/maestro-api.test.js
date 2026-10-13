// API для Maestro: склонения, алиасы, событие имён, согласование функций и установка globalThis.DESRU_API.
import { test } from 'node:test';
import assert from 'node:assert/strict';

console.info = () => {};
console.warn = () => {};
console.debug = () => {};

const {
    API_GLOBAL, MAESTRO_FUNCTIONS, createApi, installApi, isMaestroOwned, nameForms, nameFormsKey, notifyNamesChanged,
    onOwnershipChange, setMaestroOwned, uninstallApi,
} = await import('../src/maestro-api.js');
const { compileKey } = await import('../src/lib/regex-keys.js');
const { BUNNYMO_ENTRIES } = await import('../src/bunnymo-adapter.js');
const { patchEntries } = await import('../src/lib/bunnymo-patch.js');

const fakeDes = (aliases) => ({ names: { aliases: () => structuredClone(aliases) } });

test('nameForms: the name first, every case form, the spelling of the name kept', () => {
    const forms = nameForms('Аня');
    assert.equal(forms[0], 'Аня');
    for (const form of ['Ани', 'Ане', 'Аню', 'Аней', 'Анею']) assert.ok(forms.includes(form), form);
    assert.ok(nameForms('Алёна').includes('Алёной'), 'ё of the name stays');
    assert.ok(nameForms('Павел').includes('Павлу'), 'fleeting vowel');
    assert.ok(nameForms('Лев').includes('Льву'));
    assert.ok(nameForms('Александр').includes('Александра'), 'search forms include the genitive');
    assert.ok(nameForms('АНЯ').includes('АНИ'), 'all caps stay all caps');
});

test('nameForms: indeclinable and Latin names, empty input', () => {
    assert.deepEqual(nameForms('Акари'), ['Акари']);
    assert.deepEqual(nameForms('Akari'), ['Akari']);
    assert.deepEqual(nameForms('   '), []);
    assert.deepEqual(nameForms(undefined), []);
});

test('nameForms: a name of several words gives every combination of word forms', () => {
    const forms = nameForms('Аня  Петрова');
    assert.equal(forms[0], 'Аня Петрова');
    assert.ok(forms.includes('Ани Петровой'));
    assert.ok(forms.includes('Аню Петрову'));
    assert.equal(new Set(forms).size, forms.length);
});

test('nameFormsKey: an ST regex key that finds every form and not the name inside another word', () => {
    const key = nameFormsKey('Аня Петрова');
    const regex = compileKey(key);
    assert.ok(regex, key);
    for (const form of nameForms('Аня Петрова')) assert.ok(regex.test(`\x01User: Вот ${form}.`), form);
    const single = compileKey(nameFormsKey('Аня'));
    assert.ok(single.test('с Аней'));
    assert.ok(single.test('с Анёй'), 'ё and е are interchangeable');
    assert.equal(single.test('Таня'), false);
    assert.equal(nameFormsKey(''), null);
});

test('aliases come from the live DES while the guard allows it, as a copy', () => {
    let des = null;
    const api = createApi({ des: () => des });
    assert.deepEqual(api.aliases(), {});
    des = fakeDes({ Аня: ['Ани', 'аня'] });
    const aliases = api.aliases();
    assert.deepEqual(aliases, { Аня: ['Ани', 'аня'] });
    aliases.Аня.push('x');
    assert.deepEqual(api.aliases(), { Аня: ['Ани', 'аня'] });
    des = { names: { aliases() { throw new Error('boom'); } } };
    assert.deepEqual(api.aliases(), {});
});

test('onNamesChanged fires on changes, survives a failing listener and unsubscribes', () => {
    const api = createApi({ des: () => null });
    let calls = 0;
    const offBad = api.onNamesChanged(() => {
        throw new Error('listener bug');
    });
    const off = api.onNamesChanged(() => {
        calls += 1;
    });
    notifyNamesChanged();
    assert.equal(calls, 1);
    off();
    offBad();
    notifyNamesChanged();
    assert.equal(calls, 1);
    assert.throws(() => api.onNamesChanged('nope'), TypeError);
});

test('functions and ownership: replace semantics, unknown ids skipped, nothing owned by default', () => {
    const api = createApi({ des: () => null });
    assert.deepEqual(api.functions(), ['bunnymo.structuralPatches', 'ck.consistencyRebuild', 'bunnymo.scanTags']);
    assert.deepEqual(api.functions(), [...MAESTRO_FUNCTIONS]);
    assert.deepEqual(api.maestroOwned(), []);
    let changes = 0;
    const off = onOwnershipChange(() => {
        changes += 1;
    });
    api.setMaestroOwned(['bunnymo.scanTags', 'ck.consistencyRebuild', 'future.function']);
    assert.deepEqual(api.maestroOwned(), ['ck.consistencyRebuild', 'bunnymo.scanTags']);
    assert.equal(isMaestroOwned('ck.consistencyRebuild'), true);
    assert.equal(isMaestroOwned('bunnymo.structuralPatches'), false);
    api.setMaestroOwned(['ck.consistencyRebuild', 'bunnymo.scanTags']);
    assert.equal(changes, 1, 'the same set is not a change');
    api.setMaestroOwned(['bunnymo.structuralPatches']);
    assert.deepEqual(api.maestroOwned(), ['bunnymo.structuralPatches']);
    assert.throws(() => api.setMaestroOwned('bunnymo.scanTags'), TypeError);
    api.setMaestroOwned([]);
    assert.deepEqual(api.maestroOwned(), []);
    assert.equal(changes, 3);
    off();
});

test('install sets a frozen globalThis.DESRU_API; uninstall removes it and gives every function back', () => {
    installApi({ des: () => null });
    const api = globalThis[API_GLOBAL];
    assert.equal(api.version, 1);
    assert.ok(Object.isFrozen(api));
    api.setMaestroOwned(['ck.consistencyRebuild']);
    let calls = 0;
    api.onNamesChanged(() => {
        calls += 1;
    });
    uninstallApi();
    assert.equal(API_GLOBAL in globalThis, false);
    assert.equal(isMaestroOwned('ck.consistencyRebuild'), false);
    notifyNamesChanged();
    assert.equal(calls, 0, 'listeners are dropped with the API');
});

test('0.9.0 only adds members: version 1, features, tracker presets and binding; the 0.8.0 members stay', () => {
    const api = createApi({ des: () => null });
    assert.equal(api.version, 1);
    assert.deepEqual(api.features, ['trackerPresets', 'trackerBindingByAvatar']);
    for (const name of ['nameForms', 'nameFormsKey', 'aliases', 'onNamesChanged', 'functions', 'setMaestroOwned', 'maestroOwned']) {
        assert.equal(typeof api[name], 'function', name);
    }
    assert.deepEqual(Object.keys(api.trackerPresets), ['list', 'get', 'validate', 'save', 'remove']);
    assert.deepEqual(Object.keys(api.trackerBinding), ['active', 'get', 'set']);
    assert.deepEqual(api.trackerPresets.list(), [], 'without DES: empty, no throw');
    assert.equal(api.trackerBinding.active(), false);
});

test('bunnymo.structuralPatches: recursion flags are skipped, Russian keys and text stay', () => {
    const lists = [[
        { uid: 46, world: 'BM', comment: '🔮 AUTO-TRIGGER: Jealousy Detection System', key: ['jealous'], excludeRecursion: false, content: 'x' },
        { uid: 55, world: 'BM', comment: 'ANTI-CLANKER ALPHA', key: ['robot'], excludeRecursion: false, content: 'rude' },
        { uid: 25, world: 'BM', comment: 'Master - Kaomoji Library', key: [], preventRecursion: false, content: 'panic' },
    ]];
    const helpers = { isArchive: () => false, formsOf: (word) => [word] };
    const options = { detectors: true, antiClanker: true, archetypes: true, archiveKeys: true, structural: false };
    const stats = patchEntries(lists, options, BUNNYMO_ENTRIES, helpers);
    const [detector, alpha, kaomoji] = lists[0];
    assert.equal(detector.excludeRecursion, false);
    assert.equal(alpha.excludeRecursion, false);
    assert.equal(kaomoji.preventRecursion, false);
    assert.ok(detector.key.length > 1, 'Russian detector key added');
    assert.ok(alpha.key.length > 1, 'Russian robotic-speech key added');
    assert.notEqual(alpha.content, 'rude', 'Alpha text replaced');
    assert.equal(stats.noRecursion, 0);
    assert.equal(stats.detectors, 1);
});
