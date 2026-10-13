// Пресеты трекера DES у своей карточки: сверка привязок `char_<номер>` с картой «аватар → пресет».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { avatarsOf, cleanSeen, rekeyAssociations, renameAvatar } = await import('../src/lib/tracker-bindings.js');
const { desCharEntityIndex, desCharEntityKey } = await import('../src/des-adapter.js');

/** Одна сверка; `previous` — что надстройка оставила в прошлый раз. */
const rekey = (input) => rekeyAssociations({ presetIds: null, ...input });

/** Сверка, затем ещё одна по её итогу: вторая ничего не должна менять. */
function settle(input) {
    const first = rekey(input);
    const second = rekey({
        associations: first.associations, previous: first.seen, oldAvatars: input.newAvatars, newAvatars: input.newAvatars,
        shadow: first.shadow, presetIds: input.presetIds ?? null,
    });
    assert.equal(second.changed, false, 'the second sync is a no-op');
    assert.deepEqual(second.associations, first.associations);
    assert.deepEqual(second.shadow, first.shadow);
    return first;
}

test('keys: char_<number> is a card, group_<id> and others are not', () => {
    assert.equal(desCharEntityKey(3), 'char_3');
    assert.equal(desCharEntityIndex('char_12'), 12);
    assert.equal(desCharEntityIndex('group_1700000000000'), null);
    assert.equal(desCharEntityIndex('char_'), null);
    assert.equal(desCharEntityIndex('char_1x'), null);
    assert.deepEqual(avatarsOf([{ avatar: 'a.png' }, {}, null, { avatar: '' }]), ['a.png', null, null, null]);
    assert.deepEqual(avatarsOf(undefined), []);
});

test('first run seeds the map from the current numbers and changes nothing in DES', () => {
    const associations = { char_0: 'p1', char_2: 'p2', group_7: 'p3', char_9: 'p4' };
    const newAvatars = ['anna.png', 'boris.png', 'vera.png'];
    const result = settle({ associations, previous: {}, oldAvatars: newAvatars, newAvatars, shadow: {} });
    assert.equal(result.changed, false);
    assert.deepEqual(result.shadow, { 'anna.png': 'p1', 'vera.png': 'p2' });
    assert.deepEqual(result.associations, associations, 'char_9 points to no card: kept as it is');
    assert.deepEqual(result.report.kept, ['char_9']);
    assert.deepEqual(result.seen, {
        char_0: { preset: 'p1', avatar: 'anna.png' },
        char_2: { preset: 'p2', avatar: 'vera.png' },
        char_9: { preset: 'p4', avatar: null },
    });
});

test('a card added in front shifts the numbers: the bindings follow their cards, groups stay', () => {
    const before = ['anna.png', 'boris.png', 'vera.png'];
    const seeded = rekey({ associations: { char_0: 'p1', char_2: 'p2', group_7: 'p3' }, previous: {}, oldAvatars: before, newAvatars: before, shadow: {} });
    const after = ['aaron.png', 'anna.png', 'boris.png', 'vera.png'];
    const result = settle({ associations: seeded.associations, previous: seeded.seen, oldAvatars: before, newAvatars: after, shadow: seeded.shadow });
    assert.equal(result.changed, true);
    assert.deepEqual(result.associations, { group_7: 'p3', char_1: 'p1', char_3: 'p2' });
    assert.deepEqual(result.shadow, seeded.shadow);
    assert.deepEqual(result.report.moved, [
        { avatar: 'anna.png', from: 'char_0', to: 'char_1' },
        { avatar: 'vera.png', from: 'char_2', to: 'char_3' },
    ]);
    assert.equal(result.associations.char_0, undefined, 'the new card does not inherit Anna’s preset');
});

test('a deleted card and an arbitrary re-sort: every binding lands on its card', () => {
    const before = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
    const seen = { char_0: { preset: 'pA', avatar: 'a.png' }, char_2: { preset: 'pC', avatar: 'c.png' }, char_4: { preset: 'pE', avatar: 'e.png' } };
    const associations = { char_0: 'pA', char_2: 'pC', char_4: 'pE' };
    // c.png удалена (ST уже убрал её из карты), список перечитан в другом порядке
    const after = ['e.png', 'b.png', 'd.png', 'a.png'];
    const result = settle({ associations, previous: seen, oldAvatars: before, newAvatars: after, shadow: { 'a.png': 'pA', 'e.png': 'pE' } });
    assert.deepEqual(result.associations, { char_0: 'pE', char_3: 'pA' });
    assert.deepEqual(result.shadow, { 'a.png': 'pA', 'e.png': 'pE' });
    assert.ok(result.report.dropped.some((item) => item.key === 'char_2' && item.reason === 'released'));
});

test('a binding made in DES is remembered with the card that had that number then', () => {
    const before = ['anna.png', 'boris.png'];
    const seen = { char_0: { preset: 'p1', avatar: 'anna.png' } };
    // В DES привязали Бориса (номер 1), потом список перечитали: впереди появилась новая карточка.
    const associations = { char_0: 'p1', char_1: 'p9' };
    const after = ['aaron.png', 'anna.png', 'boris.png'];
    const result = settle({ associations, previous: seen, oldAvatars: before, newAvatars: after, shadow: { 'anna.png': 'p1' } });
    assert.deepEqual(result.shadow, { 'anna.png': 'p1', 'boris.png': 'p9' });
    assert.deepEqual(result.associations, { char_1: 'p1', char_2: 'p9' });
    assert.deepEqual(result.report.captured, [{ avatar: 'boris.png', presetId: 'p9', previous: null }]);
});

test('right after DES saved (numbers of now) the change goes to the card under that number now', () => {
    const now = ['aaron.png', 'anna.png', 'boris.png'];
    const seen = { char_1: { preset: 'p1', avatar: 'anna.png' } };
    const result = settle({ associations: { char_1: 'p1', char_0: 'p5' }, previous: seen, oldAvatars: now, newAvatars: now, shadow: { 'anna.png': 'p1' } });
    assert.deepEqual(result.shadow, { 'anna.png': 'p1', 'aaron.png': 'p5' });
    assert.equal(result.changed, false);
});

test('DES wins over the map for a key it changed; a key DES removed releases the card', () => {
    const avatars = ['anna.png', 'boris.png'];
    const seen = { char_0: { preset: 'p1', avatar: 'anna.png' }, char_1: { preset: 'p2', avatar: 'boris.png' } };
    const shadow = { 'anna.png': 'p1', 'boris.png': 'p2' };
    const result = settle({ associations: { char_0: 'p3' }, previous: seen, oldAvatars: avatars, newAvatars: avatars, shadow });
    assert.deepEqual(result.shadow, { 'anna.png': 'p3' });
    assert.deepEqual(result.associations, { char_0: 'p3' });
    assert.deepEqual(result.report.captured, [{ avatar: 'anna.png', presetId: 'p3', previous: 'p1' }]);
    assert.deepEqual(result.report.released, [{ avatar: 'boris.png', presetId: 'p2', reason: 'removed' }]);
});

test('the map wins over a key DES did not touch: the API bound another preset', () => {
    const avatars = ['anna.png'];
    const seen = { char_0: { preset: 'p1', avatar: 'anna.png' } };
    const result = settle({ associations: { char_0: 'p1' }, previous: seen, oldAvatars: avatars, newAvatars: avatars, shadow: { 'anna.png': 'p2' } });
    assert.deepEqual(result.associations, { char_0: 'p2' });
    assert.equal(result.changed, true);
});

test('bindings to deleted presets are released', () => {
    const avatars = ['anna.png', 'boris.png'];
    const seen = { char_0: { preset: 'p1', avatar: 'anna.png' }, char_1: { preset: 'p2', avatar: 'boris.png' } };
    const result = settle({
        associations: { char_0: 'p1', char_1: 'p2' }, previous: seen, oldAvatars: avatars, newAvatars: avatars,
        shadow: { 'anna.png': 'p1', 'boris.png': 'p2' }, presetIds: ['p1'],
    });
    assert.deepEqual(result.shadow, { 'anna.png': 'p1' });
    assert.deepEqual(result.associations, { char_0: 'p1' });
    assert.deepEqual(result.report.released, [{ avatar: 'boris.png', presetId: 'p2', reason: 'preset-gone' }]);
});

test('a foreign key stays while no card has its number, goes when a card takes it, yields to a bound card', () => {
    const seen = { char_5: { preset: 'old', avatar: null } };
    const short = ['anna.png', 'boris.png'];
    const kept = settle({ associations: { char_5: 'old' }, previous: seen, oldAvatars: short, newAvatars: short, shadow: {} });
    assert.deepEqual(kept.associations, { char_5: 'old' });
    assert.deepEqual(kept.report.kept, ['char_5']);

    const long = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'];
    const taken = settle({ associations: { char_5: 'old' }, previous: seen, oldAvatars: short, newAvatars: long, shadow: {} });
    assert.deepEqual(taken.associations, {}, 'f.png never had that preset');
    assert.deepEqual(taken.shadow, {});
    assert.deepEqual(taken.report.dropped, [{ key: 'char_5', presetId: 'old', reason: 'foreign' }]);

    const bound = settle({ associations: { char_5: 'old' }, previous: seen, oldAvatars: long, newAvatars: long, shadow: { 'f.png': 'mine' } });
    assert.deepEqual(bound.associations, { char_5: 'mine' });
});

test('a bound card missing from the list loses its key but keeps its binding until it comes back', () => {
    const before = ['anna.png', 'boris.png'];
    const seen = { char_1: { preset: 'p2', avatar: 'boris.png' } };
    const gone = settle({ associations: { char_1: 'p2' }, previous: seen, oldAvatars: before, newAvatars: ['anna.png'], shadow: { 'boris.png': 'p2' } });
    assert.deepEqual(gone.associations, {});
    assert.deepEqual(gone.shadow, { 'boris.png': 'p2' });
    const back = settle({ associations: gone.associations, previous: gone.seen, oldAvatars: ['anna.png'], newAvatars: ['boris.png', 'anna.png'], shadow: gone.shadow });
    assert.deepEqual(back.associations, { char_0: 'p2' });
});

test('garbage is not adopted: non-string values, broken seen entries and shadow junk', () => {
    const avatars = ['anna.png', 'boris.png'];
    const result = rekey({
        associations: { char_0: 42, char_7: null, group_x: 'g' },
        previous: { char_0: 'p1', bogus: { preset: 'x', avatar: 'y' }, char_1: { preset: '', avatar: 'boris.png' } },
        oldAvatars: avatars,
        newAvatars: avatars,
        shadow: { '': 'p1', 'boris.png': 7, 'anna.png': 'p1' },
    });
    assert.deepEqual(result.shadow, { 'anna.png': 'p1' });
    assert.deepEqual(result.associations, { group_x: 'g', char_0: 'p1', char_7: null }, 'char_7 has no card: left as it is');
    assert.deepEqual(cleanSeen({ char_0: 'p1', char_2: { preset: 'p', avatar: 3 } }), { char_2: { preset: 'p', avatar: null } });
});

test('a sparse list of numbers works as well as an array', () => {
    const result = rekey({ associations: { char_3: 'p1' }, previous: {}, oldAvatars: { 3: 'anna.png' }, newAvatars: { 0: 'anna.png' }, shadow: {} });
    assert.deepEqual(result.associations, { char_0: 'p1' });
});

test('renameAvatar moves the binding and the remembered keys to the new file name', () => {
    const state = { shadow: { 'anna.png': 'p1' }, seen: { char_0: { preset: 'p1', avatar: 'anna.png' }, char_4: { preset: 'x', avatar: null } } };
    assert.equal(renameAvatar(state, 'anna.png', 'anya.png'), true);
    assert.deepEqual(state.shadow, { 'anya.png': 'p1' });
    assert.equal(state.seen.char_0.avatar, 'anya.png');
    assert.equal(renameAvatar(state, 'nobody.png', 'x.png'), false);
    assert.equal(renameAvatar(state, 'anya.png', 'anya.png'), false);
    // После переименования ST перечитывает список: сверка видит ключ своим и не заводит старое имя заново.
    const result = settle({ associations: { char_0: 'p1' }, previous: state.seen, oldAvatars: ['anya.png'], newAvatars: ['b.png', 'anya.png'], shadow: state.shadow });
    assert.deepEqual(result.shadow, { 'anya.png': 'p1' });
    assert.deepEqual(result.associations, { char_1: 'p1' });
});

// ─── Сверка с исходниками DES 2.6.0 (vendor/des или DESRU_DES_DIR) ──────────

const DES_DIR = process.env.DESRU_DES_DIR || fileURLToPath(new URL('../vendor/des/', import.meta.url));
const desFile = (path) => `${DES_DIR.replace(/[\\/]+$/, '')}/${path}`;
const noDes = existsSync(desFile('src/core/persistence.js')) ? false : 'нет клона DES (vendor/des или DESRU_DES_DIR)';

test('DES keys a binding by the card number (this_chid) or the group id, and saves through saveSettings', { skip: noDes }, () => {
    const persistence = readFileSync(desFile('src/core/persistence.js'), 'utf8');
    assert.match(persistence, /return `group_\$\{context\.groupId\}`/);
    assert.match(persistence, /return `char_\$\{context\.characterId\}`/);
    assert.match(persistence, /characterAssociations\[entityKey\] = activePresetId;/);
    for (const name of ['loadPreset', 'deletePreset', 'autoSwitchPresetForEntity', 'saveSettings']) {
        assert.match(persistence, new RegExp(`export function ${name}\\(`), name);
    }
    const events = readFileSync(desFile('src/systems/integration/sillytavern.js'), 'utf8');
    assert.match(events, /const presetSwitched = autoSwitchPresetForEntity\(\);/, 'DES picks the preset on CHAT_CHANGED');
    const editor = readFileSync(desFile('src/systems/ui/trackerEditor.js'), 'utf8');
    assert.match(editor, /associatePresetWithCurrentEntity\(\);[\s\S]*dispatchEvent\(new CustomEvent\('dooms:tracker-config-saved'\)\)/, 'the event comes after the binding');
    assert.match(editor, /#rpg-tracker-editor-popup/);
});
