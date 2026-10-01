import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuard } from '../src/guard.js';
import { emptyFacts } from '../src/des-adapter.js';

const options = { verifiedVersions: ['2.6.0'] };
const healthy = () => ({ ...emptyFacts(), found: true, name: 'third-party/Dooms-Enhancement-Suite', version: '2.6.0', loaded: true, ownEnabled: true, sameInstance: true });

test('a healthy DES unlocks everything without warnings', () => {
    const verdict = evaluateGuard(healthy(), options);
    assert.equal(verdict.state, 'ok');
    assert.equal(verdict.ui, true);
    assert.equal(verdict.data, true);
    assert.equal(verdict.desUpdated, false);
    assert.deepEqual(verdict.problems, []);
});

test('missing or disabled DES degrades quietly', () => {
    for (const [facts, state] of [
        [emptyFacts(), 'absent'],
        [{ ...healthy(), stDisabled: true }, 'st-disabled'],
        [{ ...healthy(), loaded: false }, 'not-loaded'],
        [null, 'error'],
    ]) {
        const verdict = evaluateGuard(facts, options);
        assert.equal(verdict.state, state);
        assert.equal(verdict.ui, false);
        assert.equal(verdict.data, false);
        assert.equal(verdict.desUpdated, false, `${state} must not warn about a DES update`);
    }
});

test('DES switched off by its own toggle keeps only the UI module', () => {
    const verdict = evaluateGuard({ ...healthy(), ownEnabled: false }, options);
    assert.equal(verdict.state, 'inactive');
    assert.equal(verdict.ui, true);
    assert.equal(verdict.data, false);
    assert.equal(verdict.desUpdated, false);
});

test('missing selectors or exports block modules 2-4 and raise the update warning', () => {
    const verdict = evaluateGuard({ ...healthy(), missingSelectors: ['#dooms-settings-fab'], missingExports: ['src/core/state.js → lastGeneratedData'] }, options);
    assert.equal(verdict.state, 'mismatch');
    assert.equal(verdict.ui, true);
    assert.equal(verdict.data, false);
    assert.equal(verdict.desUpdated, true);
    assert.equal(verdict.problems.length, 2);
});

test('a second copy of DES modules blocks data access', () => {
    const verdict = evaluateGuard({ ...healthy(), sameInstance: false }, options);
    assert.equal(verdict.state, 'mismatch');
    assert.equal(verdict.data, false);
});

test('changed DES windows only warn: data modules keep working', () => {
    const verdict = evaluateGuard(healthy(), { ...options, templateMissing: ['#rpg-lorebook-modal .rpg-lb-modal-body'] });
    assert.equal(verdict.state, 'partial');
    assert.equal(verdict.ui, true);
    assert.equal(verdict.data, true);
    assert.equal(verdict.desUpdated, true);
});

test('an unverified version is a note, not a problem', () => {
    const verdict = evaluateGuard({ ...healthy(), version: '2.7.0' }, options);
    assert.equal(verdict.state, 'ok');
    assert.equal(verdict.notes.length, 1);
    assert.match(verdict.notes[0], /2\.7\.0/);
});
