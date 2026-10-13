// Пресеты трекера DES для Officina: привязка по аватару на событиях ST и DES и члены API trackerPresets / trackerBinding.
import { test } from 'node:test';
import assert from 'node:assert/strict';

console.info = () => {};
console.warn = () => {};
console.debug = () => {};

// ─── Заглушки ST и DES ──────────────────────────────────────────────────────

/** @type {Map<string, Function[]>} */
const listeners = new Map();
const firsts = [];
const eventSource = {
    on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
    },
    makeFirst(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).unshift(handler);
        firsts.push(event);
    },
    removeListener(event, handler) {
        const list = listeners.get(event) ?? [];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
    },
    emit(event, ...args) {
        for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
    },
};
const eventTypes = {
    CHAT_CHANGED: 'chat_id_changed', CHARACTER_PAGE_LOADED: 'character_page_loaded', CHARACTER_DELETED: 'characterDeleted',
    CHARACTER_RENAMED: 'character_renamed', CHARACTER_DUPLICATED: 'character_duplicated',
};
const ctx = {
    characters: [{ avatar: 'anna.png', name: 'Аня' }, { avatar: 'boris.png', name: 'Борис' }, { avatar: 'vera.png', name: 'Вера' }],
    characterId: undefined,
    groupId: null,
    eventSource,
    eventTypes,
    extensionSettings: {},
    ownSaves: 0,
    saveSettingsDebounced() {
        ctx.ownSaves += 1;
    },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.window = new EventTarget();

const { putDesPreset, DES_KEYS } = await import('../src/des-adapter.js');
const { presetBindings, startPresetBindings, stopPresetBindings } = await import('../src/preset-bindings.js');
const { API_FEATURES, createApi } = await import('../src/maestro-api.js');
const { getSettings, saveSettings } = await import('../src/settings.js');

const config = (field = 'Mood') => ({
    infoBox: { widgets: { date: { enabled: true, format: 'Weekday, Month, Year' } }, customFields: [] },
    presentCharacters: { customFields: [{ id: 'f1', name: field, enabled: true, description: 'Настроение' }] },
});

/** DES: presetManager в памяти и фасад, как presets из des-adapter. */
function fakeDes() {
    const settings = {
        historyPersistence: { enabled: true, messageCount: 3 },
        presetManager: {
            presets: {
                p1: { id: 'p1', name: 'Один', trackerConfig: config('One') },
                p2: { id: 'p2', name: 'Два', trackerConfig: config('Two') },
                p3: { id: 'p3', name: 'Три', trackerConfig: config('Three') },
            },
            characterAssociations: { char_0: 'p1', char_2: 'p2', group_g: 'p3' },
            activePresetId: 'p1',
            defaultPresetId: 'p1',
        },
    };
    const calls = { load: [], saves: 0, apply: 0, rerender: 0 };
    let editor = false;
    const manager = settings.presetManager;
    const presets = {
        available: () => true,
        associations: () => manager.characterAssociations,
        list: () => Object.entries(manager.presets).map(([id, preset]) => ({ id, name: preset.name })),
        has: (id) => Boolean(manager.presets[id]),
        get: (id) => (manager.presets[id] ? { id, name: manager.presets[id].name, trackerConfig: structuredClone(manager.presets[id].trackerConfig) } : null),
        activeId: () => manager.activePresetId,
        write(preset) {
            const id = putDesPreset(manager, preset, settings.historyPersistence);
            if (manager.activePresetId === id) calls.load.push(id);
            else calls.saves += 1;
            return id;
        },
        remove(id) {
            if (Object.keys(manager.presets).length <= 1) return false;
            for (const [key, value] of Object.entries(manager.characterAssociations)) if (value === id) delete manager.characterAssociations[key];
            delete manager.presets[id];
            return true;
        },
        // Как autoSwitchPresetForEntity: пресет по привязке открытой карточки, без неё — пресет по умолчанию.
        applyForCurrent() {
            calls.apply += 1;
            const id = ctx.groupId ? null : manager.characterAssociations[`char_${ctx.characterId}`];
            manager.activePresetId = id && manager.presets[id] ? id : manager.defaultPresetId;
        },
        editorOpen: () => editor,
        save() {
            calls.saves += 1;
        },
    };
    return {
        des: { presets, rerender: () => (calls.rerender += 1) },
        manager,
        settings,
        calls,
        setEditor: (open) => (editor = open),
    };
}

const fake = fakeDes();
const store = () => getSettings().modules.fixes.presetBindings;
const start = () => startPresetBindings({ des: () => fake.des, store, saveOwn: saveSettings });
const api = createApi({ des: () => fake.des, bindings: presetBindings });

// ─── Привязка по аватару ────────────────────────────────────────────────────

test('start seeds the map from DES’s current numbers without touching DES', () => {
    assert.equal(presetBindings(), null);
    start();
    assert.ok(presetBindings());
    assert.deepEqual(store().byAvatar, { 'anna.png': 'p1', 'vera.png': 'p2' });
    assert.deepEqual(fake.manager.characterAssociations, { char_0: 'p1', char_2: 'p2', group_g: 'p3' });
    assert.equal(fake.calls.saves, 0, 'DES is not saved');
    assert.ok(ctx.ownSaves > 0, 'the seeded map is saved');
    assert.ok(firsts.includes(eventTypes.CHAT_CHANGED), 'sync runs before DES picks the preset on CHAT_CHANGED');
    assert.equal(api.trackerBinding.active(), true);
});

test('a card added in front: after the list reload the keys follow their cards', () => {
    ctx.characters.unshift({ avatar: 'aaron.png', name: 'Аарон' });
    eventSource.emit(eventTypes.CHARACTER_PAGE_LOADED);
    assert.deepEqual(fake.manager.characterAssociations, { group_g: 'p3', char_1: 'p1', char_3: 'p2' });
    assert.equal(fake.calls.saves, 1, 'saved through DES');
});

test('a binding made in DES’s tracker editor is remembered with the card it was made for', () => {
    ctx.characterId = 2; // Борис
    fake.manager.characterAssociations.char_2 = 'p3';
    window.dispatchEvent(new Event(DES_KEYS.trackerConfigSavedEvent));
    assert.equal(store().byAvatar['boris.png'], 'p3');
    assert.equal(api.trackerBinding.get('boris.png'), 'p3');
});

test('a deleted card loses its binding; the shift after the reload moves the others', () => {
    eventSource.emit(eventTypes.CHARACTER_DELETED, { id: 1, character: { avatar: 'anna.png' } });
    assert.equal(store().byAvatar['anna.png'], undefined);
    ctx.characters.splice(1, 1); // ST перечитал список без Ани
    ctx.characterId = undefined;
    eventSource.emit(eventTypes.CHARACTER_PAGE_LOADED);
    assert.deepEqual(fake.manager.characterAssociations, { group_g: 'p3', char_1: 'p3', char_2: 'p2' });
});

test('a renamed card keeps its binding under the new file name', () => {
    eventSource.emit(eventTypes.CHARACTER_RENAMED, 'vera.png', 'vera2.png');
    ctx.characters[2] = { avatar: 'vera2.png', name: 'Вера' };
    eventSource.emit(eventTypes.CHARACTER_PAGE_LOADED);
    assert.deepEqual(store().byAvatar, { 'boris.png': 'p3', 'vera2.png': 'p2' });
    assert.deepEqual(fake.manager.characterAssociations, { group_g: 'p3', char_1: 'p3', char_2: 'p2' });
});

test('CHAT_CHANGED fixes the keys before DES reads them', () => {
    // Список переставили, а события перезагрузки не было: первая на CHAT_CHANGED сверка всё равно успевает.
    ctx.characters.reverse(); // vera2, boris, aaron
    eventSource.emit(eventTypes.CHAT_CHANGED);
    assert.deepEqual(fake.manager.characterAssociations, { group_g: 'p3', char_0: 'p2', char_1: 'p3' });
});

test('an ordinary list reload re-keys but does not re-pick the open card’s preset', () => {
    ctx.characterId = 1; // Борис
    const applied = fake.calls.apply;
    ctx.characters = [ctx.characters[2], ctx.characters[0], ctx.characters[1]]; // aaron, vera2, boris
    eventSource.emit(eventTypes.CHARACTER_PAGE_LOADED);
    assert.deepEqual(fake.manager.characterAssociations, { group_g: 'p3', char_1: 'p2', char_2: 'p3' });
    assert.equal(fake.calls.apply, applied, 'DES already picked Boris’s preset by the right key; a manual choice must stay');
    ctx.characters = [ctx.characters[1], ctx.characters[2], ctx.characters[0]]; // vera2, boris, aaron
    eventSource.emit(eventTypes.CHARACTER_PAGE_LOADED);
    assert.deepEqual(fake.manager.characterAssociations, { group_g: 'p3', char_0: 'p2', char_1: 'p3' });
    ctx.characterId = undefined;
});

test('trackerBinding.set binds through the API; the open card gets its preset at once', () => {
    ctx.characterId = 2; // aaron
    const applied = fake.calls.apply;
    assert.deepEqual(api.trackerBinding.set('aaron.png', 'p1'), { ok: true });
    assert.equal(fake.manager.characterAssociations.char_2, 'p1');
    assert.equal(store().byAvatar['aaron.png'], 'p1');
    assert.equal(fake.calls.apply, applied + 1, 'DES picks the preset of the open card again');
    assert.deepEqual(api.trackerBinding.set('aaron.png', null), { ok: true });
    assert.equal(fake.manager.characterAssociations.char_2, undefined);
    assert.equal(api.trackerBinding.get('aaron.png'), null);
    assert.deepEqual(api.trackerBinding.set('ghost.png', 'p1'), { ok: false, error: 'no-card' });
    assert.deepEqual(api.trackerBinding.set('aaron.png', 'p404'), { ok: false, error: 'not-found' });
    fake.setEditor(true);
    assert.deepEqual(api.trackerBinding.set('aaron.png', 'p1'), { ok: false, error: 'editor-open' });
    fake.setEditor(false);
    ctx.characterId = undefined;
});

test('switched off: set says so, get answers what DES will pick by the card number', () => {
    stopPresetBindings();
    assert.equal(presetBindings(), null);
    assert.equal(api.trackerBinding.active(), false);
    assert.deepEqual(api.trackerBinding.set('boris.png', 'p1'), { ok: false, error: 'off' });
    assert.equal(api.trackerBinding.get('boris.png'), 'p3', 'boris.png is char_1');
    assert.equal(api.trackerBinding.get('aaron.png'), null);
    eventSource.emit(eventTypes.CHARACTER_PAGE_LOADED);
    window.dispatchEvent(new Event(DES_KEYS.trackerConfigSavedEvent));
    assert.equal(listeners.get(eventTypes.CHAT_CHANGED)?.length ?? 0, 0, 'every listener is removed');
    const none = createApi({ des: () => null, bindings: presetBindings });
    assert.deepEqual(none.trackerBinding.set('boris.png', 'p1'), { ok: false, error: 'unavailable' });
});

// ─── Пресеты ────────────────────────────────────────────────────────────────

test('features list the new members', () => {
    assert.deepEqual(api.features, ['trackerPresets', 'trackerBindingByAvatar']);
    assert.equal(api.features, API_FEATURES);
    assert.ok(Object.isFrozen(api.trackerPresets) && Object.isFrozen(api.trackerBinding));
});

test('list and get give copies', () => {
    assert.deepEqual(api.trackerPresets.list(), [{ id: 'p1', name: 'Один' }, { id: 'p2', name: 'Два' }, { id: 'p3', name: 'Три' }]);
    const preset = api.trackerPresets.get('p2');
    assert.equal(preset.name, 'Два');
    preset.trackerConfig.presentCharacters.customFields = [];
    assert.equal(api.trackerPresets.get('p2').trackerConfig.presentCharacters.customFields.length, 1);
    assert.equal(api.trackerPresets.get('nope'), null);
    assert.equal(api.trackerPresets.get(7), null);
});

test('save refuses garbage and writes nothing', () => {
    const before = structuredClone(fake.manager.presets);
    const bad = api.trackerPresets.save({ name: 'Officina', trackerConfig: { infoBox: {}, presentCharacters: { customFields: 'x' } } });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'invalid');
    assert.ok(bad.errors.some((error) => /^trackerConfig\.infoBox\.widgets/.test(error)), bad.errors.join('\n'));
    assert.ok(bad.errors.some((error) => /^trackerConfig\.presentCharacters\.customFields/.test(error)));
    const badId = api.trackerPresets.save({ id: 'has space', name: ' ', trackerConfig: config() });
    assert.deepEqual(badId.errors.map((error) => error.split(':')[0]), ['id', 'name']);
    assert.equal(api.trackerPresets.save(null).error, 'invalid');
    assert.deepEqual(api.trackerPresets.validate(config()), []);
    assert.ok(api.trackerPresets.validate({}).length > 0);
    assert.deepEqual(fake.manager.presets, before);
});

test('save creates a preset the way DES does and replaces one by id', () => {
    const created = api.trackerPresets.save({ name: '  Officina: Аня ', trackerConfig: config('Курс') });
    assert.equal(created.ok, true);
    assert.match(created.id, /^preset_\d+$/);
    const stored = fake.manager.presets[created.id];
    assert.equal(stored.name, 'Officina: Аня');
    assert.deepEqual(stored.historyPersistence, { enabled: true, messageCount: 3 }, 'like createPreset: a copy of the current history settings');
    assert.notEqual(stored.historyPersistence, fake.settings.historyPersistence);

    stored.historyPersistence.messageCount = 9;
    const replaced = api.trackerPresets.save({ id: created.id, name: 'Officina: Аня 2', trackerConfig: config('Пульс') });
    assert.deepEqual(replaced, { ok: true, id: created.id });
    assert.equal(fake.manager.presets[created.id].historyPersistence.messageCount, 9, 'the replaced preset keeps its own');
    assert.equal(fake.manager.presets[created.id].trackerConfig.presentCharacters.customFields[0].name, 'Пульс');

    const own = api.trackerPresets.save({ id: 'officina.anna', name: 'Свой id', trackerConfig: config() });
    assert.deepEqual(own, { ok: true, id: 'officina.anna' });

    const loads = fake.calls.load.length;
    assert.equal(api.trackerPresets.save({ id: 'p1', name: 'Один', trackerConfig: config('Active') }).ok, true);
    assert.deepEqual(fake.calls.load.slice(loads), ['p1'], 'the active preset is loaded again');

    fake.setEditor(true);
    assert.deepEqual(api.trackerPresets.save({ name: 'X', trackerConfig: config() }), { ok: false, error: 'editor-open' });
    fake.setEditor(false);
});

test('putDesPreset: a free id even when the moment is taken', () => {
    const manager = { presets: { preset_5: {}, preset_5_1: {} } };
    assert.equal(putDesPreset(manager, { name: 'n', trackerConfig: {} }, null, 5), 'preset_5_2');
    assert.equal(manager.presets.preset_5_2.historyPersistence, null);
});

test('remove goes through DES, then the bindings are synced', () => {
    start();
    const synced = [];
    const bindings = () => {
        const running = presetBindings();
        return running && { ...running, sync: (options) => (synced.push(options?.reason), running.sync(options)) };
    };
    const local = createApi({ des: () => fake.des, bindings });
    assert.deepEqual(local.trackerPresets.remove('nope'), { ok: false, error: 'not-found' });
    fake.setEditor(true);
    assert.deepEqual(local.trackerPresets.remove('p2'), { ok: false, error: 'editor-open' });
    fake.setEditor(false);
    assert.deepEqual(local.trackerPresets.remove('p2'), { ok: true });
    assert.equal(synced.length, 1);
    assert.equal(store().byAvatar['vera2.png'], undefined, 'the binding to the removed preset is gone');
    for (const { id } of local.trackerPresets.list().slice(1)) local.trackerPresets.remove(id);
    assert.deepEqual(local.trackerPresets.remove(local.trackerPresets.list()[0].id), { ok: false, error: 'last' });
    stopPresetBindings();
    const none = createApi({ des: () => null });
    assert.deepEqual(none.trackerPresets.list(), []);
    assert.deepEqual(none.trackerPresets.save({ name: 'X', trackerConfig: config() }), { ok: false, error: 'unavailable' });
    assert.deepEqual(none.trackerPresets.remove('p1'), { ok: false, error: 'unavailable' });
});

test('start: a chat opened before the sync gets the preset of its real binding', () => {
    // Пока страница была закрыта, номера сдвинулись: в DES ключ Веры остался под старым номером 1, а она теперь 0.
    fake.manager.presets.p5 = { id: 'p5', name: 'Пять', trackerConfig: config('Five') };
    fake.manager.characterAssociations = { char_1: 'p5' };
    fake.manager.activePresetId = fake.manager.defaultPresetId; // DES выбрал по char_0 — привязки нет, пресет по умолчанию
    Object.assign(store(), { byAvatar: { 'vera2.png': 'p5' }, seen: { char_1: { preset: 'p5', avatar: 'vera2.png' } } });
    ctx.characters = [{ avatar: 'vera2.png', name: 'Вера' }, { avatar: 'boris.png', name: 'Борис' }];
    ctx.characterId = 0;
    const rerendered = fake.calls.rerender;
    start();
    assert.deepEqual(fake.manager.characterAssociations, { char_0: 'p5' });
    assert.equal(fake.manager.activePresetId, 'p5', 'DES picked the preset again');
    assert.equal(fake.calls.rerender, rerendered + 1);
    stopPresetBindings();
    ctx.characterId = undefined;
});
