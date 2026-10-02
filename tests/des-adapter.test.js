import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DES_UI, isDesManifest, isLiveDesState, moveDesSheet } from '../src/des-adapter.js';

test('isDesManifest recognises DES by homePage or display name', () => {
    assert.equal(isDesManifest({ display_name: 'Whatever', homePage: 'https://github.com/DangerDaza/Dooms-Enhancement-Suite' }), true);
    assert.equal(isDesManifest({ display_name: "Doom's Enhancement Suite" }), true);
    assert.equal(isDesManifest({ display_name: 'SillyTavern - Doom\'s Enhancement Suite - RU', homePage: 'https://github.com/Likerch/SillyTavern-Doom-Enhancement-Suite-RU' }), false);
    assert.equal(isDesManifest(null), false);
});

test('isLiveDesState accepts the very same object', () => {
    const blob = { enabled: true, trackerConfig: {} };
    assert.equal(isLiveDesState(blob, blob), true);
});

test('isLiveDesState accepts the Object.assign copy DES keeps before its first save', () => {
    const blob = { enabled: true, trackerConfig: { infoBox: {} } };
    const live = Object.assign({ settingsVersion: 15 }, blob);
    assert.equal(isLiveDesState(live, blob), true);
});

test('isLiveDesState rejects an unrelated copy of the module', () => {
    const blob = { enabled: true, trackerConfig: { infoBox: {} } };
    const freshDefaults = { enabled: true, trackerConfig: { infoBox: {} } };
    assert.equal(isLiveDesState(freshDefaults, blob), false);
});

test('isLiveDesState cannot decide without saved settings', () => {
    assert.equal(isLiveDesState({ enabled: true }, undefined), null);
    assert.equal(isLiveDesState({ enabled: true }, { enabled: true }), null);
});

test('layout fixes are plain selector + declarations, nothing that escapes the rule', () => {
    assert.ok(DES_UI.layoutFixes.length > 0);
    for (const fix of DES_UI.layoutFixes) {
        assert.match(fix.selector, /^[.#\w][\w\s.#>:()[\]="'-]*$/, fix.selector);
        assert.match(fix.style, /^[\w\s:;%().,-]+;$/, fix.style);
        if (fix.media !== undefined) assert.match(fix.media, /^\([\w\s:.-]+\)$/, fix.media);
    }
});

test('a sheet moves to a free name, keys compare without case', () => {
    const sheet = { characterName: 'Флоренс Клеймор', importedAt: '2026-10-02T10:00:00.000Z' };
    const store = { 'Флоренс Клеймор': sheet };
    assert.equal(moveDesSheet(store, 'Флоренс Клеймор', 'Флоренс'), 'moved');
    assert.deepEqual(store, { 'Флоренс': sheet });
    assert.equal(moveDesSheet(store, 'Флоренс', 'Флоренс'), null);
    assert.equal(moveDesSheet({ 'флоренс': sheet }, 'флоренс', 'Флоренс'), null);
    assert.equal(moveDesSheet(store, 'Шарлотта', 'Флоренс'), null);
    assert.equal(moveDesSheet(null, 'a', 'b'), null);
});

test('a newer import updates the card sheet like a DES re-import, an older one is left alone', () => {
    const old = { characterName: 'Флоренс', rawTags: '<OLD>', mode: 'notes', notesSections: [{ title: 'мои заметки' }], importedAt: '2026-10-01T10:00:00.000Z' };
    const fresh = { characterName: 'Флоренс Клеймор', sections: [], importedAt: '2026-10-02T10:00:00.000Z' };
    const store = { 'Флоренс': old, 'Флоренс Клеймор': fresh };
    assert.equal(moveDesSheet(store, 'Флоренс Клеймор', 'флоренс'), 'merged');
    assert.deepEqual(Object.keys(store), ['Флоренс']);
    assert.equal(store['Флоренс'].characterName, 'Флоренс Клеймор');
    assert.equal(store['Флоренс'].mode, 'notes');
    assert.deepEqual(store['Флоренс'].notesSections, [{ title: 'мои заметки' }]);
    // В новом листе тегов нет — старые не остаются, как у DES.
    assert.equal('rawTags' in store['Флоренс'], false);

    const older = { 'Флоренс': fresh, 'Флоренс Клеймор': old };
    assert.equal(moveDesSheet(older, 'Флоренс Клеймор', 'Флоренс'), null);
    assert.deepEqual(Object.keys(older), ['Флоренс', 'Флоренс Клеймор']);
    assert.equal(moveDesSheet({ 'Флоренс': {}, 'Флоренс Клеймор': {} }, 'Флоренс Клеймор', 'Флоренс'), null);
});
