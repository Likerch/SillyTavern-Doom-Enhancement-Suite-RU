import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDesManifest, isLiveDesState } from '../src/des-adapter.js';

test('isDesManifest recognises DES by homePage or display name', () => {
    assert.equal(isDesManifest({ display_name: 'Whatever', homePage: 'https://github.com/DangerDaza/Dooms-Enhancement-Suite' }), true);
    assert.equal(isDesManifest({ display_name: "Doom's Enhancement Suite" }), true);
    assert.equal(isDesManifest({ display_name: 'SillyTavern - Doom\'s Enhancement Suite - RU', homePage: 'https://github.com/Likerch/SillyTavern-Dooms-Enhancement-Suite-RU' }), false);
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
