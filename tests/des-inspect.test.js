// inspectDes на поддельной странице: скрипт DES есть, а сам DES то запустился, то нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DES_SELECTORS, inspectDes } from '../src/des-adapter.js';
import { evaluateGuard } from '../src/guard.js';

console.info = () => {};
console.warn = () => {};

const NAME = 'third-party/Dooms-Enhancement-Suite';
const present = new Set();
globalThis.location = { href: 'http://localhost:8000/' };
globalThis.document = {
    querySelectorAll: (selector) => (selector.startsWith('script') ? [{ src: `http://localhost:8000/scripts/extensions/${NAME}/index.js` }] : []),
    querySelector: (selector) => (present.has(selector) ? { selector } : null),
};
globalThis.SillyTavern = {
    getContext: () => ({
        getExtensionManifest: (name) => (name === NAME ? { display_name: "Doom's Enhancement Suite", version: '2.6.0', js: 'index.js' } : null),
        extensionSettings: { disabledExtensions: [], [NAME]: { enabled: true } },
    }),
};

const verdictOf = (facts) => evaluateGuard(facts, { verifiedVersions: ['2.6.0'] });

test('a DES script that never started is "not loaded", not "DES updated"', async () => {
    present.clear();
    const { facts, api } = await inspectDes({ timeoutMs: 0 });
    assert.equal(facts.found, true);
    assert.equal(facts.loaded, false);
    assert.equal(api, null);
    assert.deepEqual(facts.missingSelectors, []);
    assert.deepEqual(facts.missingExports, []);
    const verdict = verdictOf(facts);
    assert.equal(verdict.state, 'not-loaded');
    assert.equal(verdict.desUpdated, false);
});

test('a started DES with a missing button is still a mismatch', async () => {
    present.clear();
    present.add(DES_SELECTORS.drawerToggle);
    const { facts } = await inspectDes({ timeoutMs: 0 });
    assert.equal(facts.loaded, true);
    assert.deepEqual(facts.missingSelectors, [DES_SELECTORS.fab]);
    const verdict = verdictOf(facts);
    assert.equal(verdict.state, 'mismatch');
    assert.equal(verdict.desUpdated, true);
});
