import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, fillDefaults } from '../src/settings.js';

test('fillDefaults fills an empty object with an independent copy of the defaults', () => {
    const settings = fillDefaults({}, DEFAULT_SETTINGS);
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    settings.modules.names.enabled = false;
    assert.equal(DEFAULT_SETTINGS.modules.names.enabled, true);
});

test('fillDefaults keeps user values and adds only missing keys', () => {
    const settings = fillDefaults({ debug: true, modules: { names: { enabled: false } } }, DEFAULT_SETTINGS);
    assert.equal(settings.debug, true);
    assert.equal(settings.modules.names.enabled, false);
    assert.equal(settings.modules.localization.enabled, true);
    assert.equal(settings.settingsVersion, DEFAULT_SETTINGS.settingsVersion);
});

test('fillDefaults replaces a broken nested object with the default', () => {
    const settings = fillDefaults({ modules: 'oops' }, DEFAULT_SETTINGS);
    assert.deepEqual(settings.modules, DEFAULT_SETTINGS.modules);
});
