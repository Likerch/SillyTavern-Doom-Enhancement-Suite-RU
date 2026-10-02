import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DES_MODULES, DES_UI, dropAdoptedCards, isDesManifest, isLiveDesState, moveDesSheet } from '../src/des-adapter.js';
import { CK_UI } from '../src/ck-adapter.js';

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

test('CarrotKernel layout fixes cannot escape their rule either', () => {
    for (const fix of CK_UI.layoutFixes ?? []) {
        assert.match(fix.selector, /^[.#\w][\w\s.#>:()[\]="'-]*$/, fix.selector);
        // `content: "…"` с русским текстом — да; скобки правил, `<` и обратная косая — нет.
        assert.doesNotMatch(fix.style, /[{}<\\]/, fix.style);
        assert.match(fix.style, /;$/, fix.style);
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
    assert.equal(moveDesSheet(store, 'Флоренс Клеймор', 'флоренс', { merge: true }), 'merged');
    assert.deepEqual(Object.keys(store), ['Флоренс']);
    assert.equal(store['Флоренс'].characterName, 'Флоренс Клеймор');
    assert.equal(store['Флоренс'].mode, 'notes');
    assert.deepEqual(store['Флоренс'].notesSections, [{ title: 'мои заметки' }]);
    // В новом листе тегов нет — старые не остаются, как у DES.
    assert.equal('rawTags' in store['Флоренс'], false);

    const older = { 'Флоренс': fresh, 'Флоренс Клеймор': old };
    assert.equal(moveDesSheet(older, 'Флоренс Клеймор', 'Флоренс', { merge: true }), null);
    assert.deepEqual(Object.keys(older), ['Флоренс', 'Флоренс Клеймор']);
    assert.equal(moveDesSheet({ 'Флоренс': {}, 'Флоренс Клеймор': {} }, 'Флоренс Клеймор', 'Флоренс', { merge: true }), null);
});

test('without merge an existing card sheet is never overwritten', () => {
    const card = { characterName: 'Флоренс', importedAt: '2026-10-01T10:00:00.000Z' };
    const fresh = { characterName: 'Флоренс Клеймор', importedAt: '2026-10-02T10:00:00.000Z' };
    const store = { 'Флоренс': card, 'Флоренс Клеймор': fresh };
    assert.equal(moveDesSheet(store, 'Флоренс Клеймор', 'Флоренс'), null);
    assert.deepEqual(store, { 'Флоренс': card, 'Флоренс Клеймор': fresh });
});

test('a merged sheet keeps the card notes and mode, notes made under the other name follow', () => {
    const card = { characterName: 'Флоренс', mode: 'notes', notesSections: [{ id: 'a', title: 'мои заметки' }], importedAt: '2026-10-01T10:00:00.000Z' };
    // Попап DES заводит под новым именем пустые заметки в режиме листа.
    const fresh = { characterName: 'Флоренс Клеймор', mode: 'sheet', notesSections: [{ id: 'a', title: 'дубль' }, { id: 'b', title: 'новая' }], importedAt: '2026-10-02T10:00:00.000Z' };
    const store = { 'Флоренс': card, 'Флоренс Клеймор': fresh };
    assert.equal(moveDesSheet(store, 'Флоренс Клеймор', 'Флоренс', { merge: true }), 'merged');
    assert.equal(store['Флоренс'].mode, 'notes');
    assert.deepEqual(store['Флоренс'].notesSections, [{ id: 'a', title: 'мои заметки' }, { id: 'b', title: 'новая' }]);
    // У карточки заметок не было — берутся заметки листа как есть.
    const bare = { 'Аня': { importedAt: '2026-10-01T10:00:00.000Z' }, 'Аня Петрова': { mode: 'sheet', notesSections: [], importedAt: '2026-10-02T10:00:00.000Z' } };
    moveDesSheet(bare, 'Аня Петрова', 'Аня', { merge: true });
    assert.equal(bare['Аня'].mode, 'sheet');
    assert.deepEqual(bare['Аня'].notesSections, []);
});

test('cards DES adopted for hidden names are dropped, real cards and visible names stay', () => {
    const known = { 'Аня': { emoji: '👩' }, 'Лизы': { emoji: '👤' }, 'Лизонька': { emoji: '👤', previousColors: ['#ff0000'] }, 'Лизе': { emoji: '👤' } };
    const removed = ['лизы', 'Лизонька'];
    assert.deepEqual(dropAdoptedCards(known, removed, ['Лизы', 'Лизонька', 'Лизе']), ['Лизы']);
    assert.deepEqual(Object.keys(known), ['Аня', 'Лизонька', 'Лизе']);
    assert.deepEqual(dropAdoptedCards(known, removed, []), []);
    assert.deepEqual(dropAdoptedCards(null, removed, ['Лизы']), []);
});

test('DES modules require only the exports the adapter uses', () => {
    assert.deepEqual(Object.keys(DES_MODULES.aliases.exports), ['addCharacterAlias']);
    assert.deepEqual(Object.keys(DES_MODULES.portraitBar.exports), ['updatePortraitBar']);
    assert.deepEqual(Object.keys(DES_MODULES.fullsheet.exports), ['messageHasFullSheet']);
    assert.deepEqual(Object.keys(DES_MODULES.fullsheet.optionalExports), ['injectFullSheetButtonForMessage']);
});

test('campaign names are data, the Unfiled label is chrome', () => {
    assert.ok(DES_UI.exclude.includes('.rpg-lb-campaign-group:not(.unfiled-group) .rpg-lb-campaign-name'));
    assert.ok(![...DES_UI.noCollect, ...DES_UI.exclude].includes('.rpg-lb-campaign-name'));
});
