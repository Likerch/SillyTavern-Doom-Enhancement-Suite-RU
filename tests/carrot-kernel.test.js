// Модуль 6 на поддельной странице с поддельным CarrotKernel: файлы CK — во временной папке с путём,
// как у установленного расширения (…/scripts/extensions/third-party/CarrotKernel/), их импортирует сам адаптер.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

console.info = () => {};
console.warn = () => {};
console.debug = () => {};
console.error = () => {};

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'desru-ck-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const root = path.join(base, 'scripts', 'extensions', 'third-party', 'CarrotKernel');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'index.js'), 'export {};\n');
fs.writeFileSync(path.join(root, 'carrot-state.js'), [
    'export const scannedCharacters = new Map();',
    'let last = [];',
    'export function getLastInjectedCharacters() { return [...last]; }',
    'export function setLastInjectedCharacters(names) { last = [...names]; }',
].join('\n'));
fs.writeFileSync(path.join(root, 'sheet-generator.js'), [
    'export let findCharacterByName = null;',
    'export function initializeSheetGenerator(fn) { findCharacterByName = fn; }',
    'export const calls = { processTemplate: 0 };',
    'export const CarrotTemplateManager = {',
    '    hasTemplate: true,',
    '    getPrimaryTemplateForCategory() { return this.hasTemplate ? { id: "character_consistency" } : null; },',
    '    async processTemplate() { calls.processTemplate += 1; return "from template"; },',
    '};',
].join('\n'));
const CK_INDEX = pathToFileURL(path.join(root, 'index.js')).href;

class EventEmitter {
    events = {};
    on(event, listener) { (this.events[event] ??= []).push(listener); }
    makeFirst(event, listener) { this.removeListener(event, listener); (this.events[event] ??= []).unshift(listener); }
    makeLast(event, listener) { this.removeListener(event, listener); (this.events[event] ??= []).push(listener); }
    removeListener(event, listener) {
        const list = this.events[event] ?? [];
        if (list.includes(listener)) list.splice(list.indexOf(listener), 1);
    }
    async emit(event, ...args) {
        for (const listener of (this.events[event] ?? []).slice()) await listener(...args);
    }
    count() {
        return Object.values(this.events).reduce((sum, list) => sum + list.length, 0);
    }
}

let panelReady = true;
const element = () => ({ append() {}, remove() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], style: {} });
globalThis.location = { href: 'file:///' };
globalThis.document = {
    querySelector: (selector) => (selector === '#carrot_settings' && panelReady ? element() : null),
    querySelectorAll: (selector) => (selector.startsWith('script') ? [{ src: CK_INDEX }] : []),
    getElementById: () => null,
    createElement: element,
    createDocumentFragment: () => ({ querySelector: () => null }),
    head: element(),
    body: element(),
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.Node ??= { ELEMENT_NODE: 1, TEXT_NODE: 3 };
globalThis.toastr = { options: {}, info() {}, success() {}, warning() {}, error() {} };
/** Словарь интерфейса CK приходит, когда тест скажет. */
let releaseDictionary = () => {};
globalThis.fetch = () => new Promise((resolve) => {
    releaseDictionary = () => resolve({ ok: true, json: async () => ({ Settings: 'Настройки' }) });
});
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled += 1; });

const eventSource = new EventEmitter();
const eventTypes = {
    GENERATION_STARTED: 'generation_started', WORLD_INFO_ACTIVATED: 'world_info_activated', CHAT_CHANGED: 'chat_changed',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
};
let ckSaves = 0;
const collections = {
    c1: { characterName: 'Шарлотта Клеймор', keywords: ['Шарлотта Клеймор'] },
    c2: { characterName: 'Ника', keywords: ['Ника'] },
};
const ctx = {
    eventSource, eventTypes, extensionPrompts: {}, chat: [], chatMetadata: {},
    extensionSettings: {
        desru: { modules: { carrotKernel: { translateUi: false } } },
        CarrotKernel: { enabled: true, sendToAI: true, displayMode: 'none', maxCharactersDisplay: 5,
            rag: { enabled: true, vectorSource: 'transformers', collectionMetadata: collections } },
    },
    saveSettingsDebounced() { ckSaves += 1; },
    getExtensionManifest: (name) => (name === 'third-party/CarrotKernel' ? { display_name: 'CarrotKernel', version: '1.0.0', js: 'index.js' } : null),
};
globalThis.SillyTavern = { getContext: () => ctx };

const { log } = await import('../src/log.js');
const { default: carrotKernel } = await import('../src/modules/carrot-kernel.js');
const ckState = await import(new URL('carrot-state.js', CK_INDEX).href);
const ckSheets = await import(new URL('sheet-generator.js', CK_INDEX).href);
ckState.scannedCharacters.set('Архив::Борис', { name: 'Борис', source: 'Архив', tags: new Map([['SPECIES', new Set(['ORC'])]]) });
ckState.scannedCharacters.set('Архив::Аня', { name: 'Аня', source: 'Архив', tags: new Map([['SPECIES', new Set(['HUMAN'])]]) });

const options = () => ctx.extensionSettings.desru.modules.carrotKernel;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @param {() => boolean} condition */
async function until(condition) {
    for (let waited = 0; waited < 3000 && !condition(); waited += 20) await sleep(20);
    return condition();
}
const attached = () => carrotKernel.status() === null;
const translatorStarted = () => log.entries().some((entry) => entry.message.includes('перевод интерфейса включён'));
const setOption = (key, value) => {
    options()[key] = value;
    carrotKernel.onOptionChange(key, value);
};

test('enable does not wait for CarrotKernel to finish starting', async () => {
    panelReady = false;
    const started = Date.now();
    await carrotKernel.enable({ des: null });
    assert.ok(Date.now() - started < 200);
    assert.deepEqual(carrotKernel.status(), { text: 'ищет CarrotKernel…', tone: 'wait' });
    panelReady = true;
    assert.ok(await until(attached));
});

test('our finder is installed and finds Cyrillic names', () => {
    assert.equal(ckSheets.findCharacterByName('Аня').data.tags.get('SPECIES').has('HUMAN'), true);
    assert.equal(ckSheets.findCharacterByName('Борис').data.tags.get('SPECIES').has('ORC'), true);
});

test('RAG case forms are added, and removed again when the option is switched off', () => {
    assert.ok(collections.c1.keywords.includes('шарлоттой'));
    assert.deepEqual(collections.c2.keywords, ['Ника'], '«никой» would fire on «паникой»');
    const saves = ckSaves;
    setOption('ragForms', false);
    assert.deepEqual(collections.c1.keywords, ['Шарлотта Клеймор']);
    assert.deepEqual(options().ragFormsAdded, {});
    assert.ok(ckSaves > saves, 'CK settings are saved');
    setOption('ragForms', true);
    assert.ok(collections.c1.keywords.includes('шарлотте'));
});

test('a form the user removed is not brought back by switching the option off and on', async () => {
    collections.c1.keywords = collections.c1.keywords.filter((keyword) => keyword !== 'шарлотте');
    setOption('ragForms', false);
    assert.deepEqual(collections.c1.keywords, ['Шарлотта Клеймор']);
    setOption('ragForms', true);
    assert.ok(!collections.c1.keywords.includes('шарлотте'));
    assert.ok(collections.c1.keywords.includes('шарлоттой'));
    const saves = ckSaves;
    await eventSource.emit(eventTypes.GENERATION_STARTED, 'normal', {}, false);
    assert.equal(ckSaves, saves, 'nothing to do — nothing saved');
});

test('the multilingual-model note reads the model of the current source', () => {
    const noted = () => carrotKernel.notes().some((note) => note.text.includes('многоязычная модель эмбеддингов'));
    ctx.extensionSettings.vectors = { source: 'openai', openai_model: 'text-embedding-3-large' };
    assert.equal(noted(), false);
    ctx.extensionSettings.vectors = { source: 'openai', openai_model: 'text-embedding-ada-002' };
    assert.equal(noted(), true);
    ctx.extensionSettings.vectors = { source: 'cohere', cohere_model: 'embed-multilingual-v3.0' };
    assert.equal(noted(), false);
    ctx.extensionSettings.vectors = { source: 'cohere' };
    assert.equal(noted(), true, 'CK default embed-english-v3.0');
    delete ctx.extensionSettings.vectors;
    Object.assign(ctx.extensionSettings.CarrotKernel.rag, { vectorSource: 'ollama', ollamaModel: 'bge-m3' });
    assert.equal(noted(), false, 'without Vector Storage settings CK uses its own');
    ctx.extensionSettings.CarrotKernel.rag.vectorSource = 'transformers';
});

test('the tag insert built from a CK template is left alone; without a template it is rebuilt', async () => {
    ckState.setLastInjectedCharacters(['Аня']);
    ctx.extensionPrompts['script_inject_carrot-consistency'] = { value: 'CK text', position: 1 };
    await eventSource.emit(eventTypes.WORLD_INFO_ACTIVATED, [{ world: 'Архив' }]);
    assert.equal(ckSheets.calls.processTemplate, 0);
    assert.equal(ctx.extensionPrompts['script_inject_carrot-consistency'].value, 'CK text');
    ckSheets.CarrotTemplateManager.hasTemplate = false;
    await eventSource.emit(eventTypes.WORLD_INFO_ACTIVATED, [{ world: 'Архив' }]);
    assert.equal(ctx.extensionPrompts['script_inject_carrot-consistency'].value, '[Character Consistency Data]\n\nАня:\n• SPECIES: HUMAN\n\n');
    ckSheets.CarrotTemplateManager.hasTemplate = true;
});

test('after disable CK keeps a working finder', () => {
    carrotKernel.disable();
    assert.equal(eventSource.count(), 0);
    assert.equal(ckSheets.findCharacterByName('Аня').name, 'Аня');
});

test('an inspection that ends after disable attaches nothing', async () => {
    panelReady = false;
    await carrotKernel.enable({ des: null });
    carrotKernel.disable();
    panelReady = true;
    await sleep(400);
    assert.equal(eventSource.count(), 0);
});

test('the UI translator does not start after it was switched off while loading', async () => {
    options().translateUi = true;
    await carrotKernel.enable({ des: null });
    assert.ok(await until(attached));
    setOption('translateUi', false);
    releaseDictionary();
    await sleep(50);
    assert.equal(translatorStarted(), false);
    setOption('translateUi', true);
    releaseDictionary();
    assert.ok(await until(translatorStarted));
    carrotKernel.disable();
    await sleep(50);
    assert.equal(unhandled, 0);
});
