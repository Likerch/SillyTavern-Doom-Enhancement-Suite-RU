// Модуль 4, «Картинки в пузырях чата»: настоящий fixes.js поверх поддельного ST. Хук messageFormatter ставится
// один раз (ST не умеет его снимать) — ранним шагом, если DES на месте, или при включении модуля, — и молчит,
// когда переключатель или модуль выключены.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MEDIA_MARK } from '../src/lib/bubble-media.js';

console.info = () => {};
console.debug = () => {};
const warnings = [];
console.warn = (...args) => warnings.push(args.join(' '));

const NAME = 'third-party/Dooms-Enhancement-Suite';
// Скрипт DES на поддельной странице: его модуль пузырей — заглушка с нужными экспортами.
const fakeSt = join(tmpdir(), `desru-fake-st-${process.pid}`);
const desRoot = join(fakeSt, 'scripts', 'extensions', 'third-party', 'Dooms-Enhancement-Suite');
after(() => rmSync(fakeSt, { recursive: true, force: true }));
mkdirSync(join(desRoot, 'src', 'systems', 'rendering'), { recursive: true });
writeFileSync(
    join(desRoot, 'src', 'systems', 'rendering', 'chatBubbles.js'),
    'export function applyChatBubbles() {}\nexport function clearBubbleState() {}\nexport function revertLastMessageBubbles() {}\n',
);
const desScript = { src: pathToFileURL(join(desRoot, 'index.js')).href };

const page = { desInstalled: false };
globalThis.location = { href: 'http://localhost:8000/' };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = {
    querySelectorAll: (selector) => (selector.startsWith('script') && page.desInstalled ? [desScript] : []),
    querySelector: () => null,
};

/** @type {{ fn: (mes: string, info: object) => string, options: { stage?: string, order?: number } }[]} */
const hooks = [];
const messageFormatter = {
    stage: { BEFORE_REGEX: 'beforeRegex', AFTER_REGEX: 'afterRegex', AFTER_MARKDOWN: 'afterMarkdown' },
    order: { EARLIEST: 0, EARLY: 10, NORMAL: 50, LATE: 90, LATEST: 100 },
    addHook: (fn, options = {}) => hooks.push({ fn, options }),
};
const st = { formatter: /** @type {object|undefined} */ (undefined) };
const extensionSettings = { disabledExtensions: [] };
globalThis.SillyTavern = {
    getContext: () => ({
        eventSource: { on() {}, makeFirst() {}, makeLast() {}, removeListener() {} },
        eventTypes: {
            GENERATION_STARTED: 'generation_started', MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
            MESSAGE_SWIPED: 'message_swiped', CHAT_CHANGED: 'chat_id_changed',
        },
        getExtensionManifest: (name) => (name === NAME ? { display_name: "Doom's Enhancement Suite", homePage: 'https://github.com/DangerDaza/Dooms-Enhancement-Suite', js: 'index.js' } : null),
        messageFormatter: st.formatter,
        extensionSettings,
        chat: [],
        saveSettingsDebounced() {},
    }),
};

const { default: fixes } = await import('../src/modules/fixes.js');
const { getSettings } = await import('../src/settings.js');

const settings = getSettings();
const env = {
    des: {
        tracker: { read: () => ({ quests: null, infoBox: null, characterThoughts: null }) },
        characterFields: () => [],
        sceneFields: () => [],
        generationMode: () => 'together',
    },
    verdict: { state: 'ok', ui: true, data: true },
    settings,
    refresh() {},
};

const GREETING = '<p>Привет.</p>\n<p><img src="https://example.com/a.png" alt="png"></p>';
const MARKED = `<p>Привет.</p>\n<p><img src="https://example.com/a.png" alt="png">${MEDIA_MARK}</p>`;
const AI = { isUser: false, isSystem: false, isReasoning: false, messageId: 0, stage: 'afterMarkdown' };
const format = (mes, info = AI) => hooks.reduce((text, hook) => hook.fn(text, info), mes);

test('the option is on by default and listed in module 4', () => {
    assert.equal(settings.modules.fixes.bubbleImages, true);
    const option = fixes.options.find((item) => item.key === 'bubbleImages');
    assert.ok(option);
    assert.match(option.title, /Картинки в пузырях/);
});

test('without DES the early step installs nothing', async () => {
    st.formatter = messageFormatter;
    page.desInstalled = false;
    await fixes.preload();
    assert.equal(hooks.length, 0);
});

test('without messageFormatter the module still starts and says why images are not fixed', async () => {
    st.formatter = undefined;
    await fixes.enable(env);
    assert.equal(hooks.length, 0);
    assert.ok(fixes.notes().some((note) => note.level === 'warn' && /messageFormatter/.test(note.text)));
    await fixes.disable();
});

test('with DES the early step installs one afterMarkdown hook that runs late', async () => {
    st.formatter = messageFormatter;
    page.desInstalled = true;
    await fixes.preload();
    assert.equal(hooks.length, 1);
    assert.deepEqual(hooks[0].options, { stage: 'afterMarkdown', order: 90 });
    assert.equal(format(GREETING), MARKED);
});

test('user messages, reasoning and image-free messages are left alone', () => {
    assert.equal(format(GREETING, { ...AI, isUser: true }), GREETING);
    assert.equal(format(GREETING, { ...AI, isReasoning: true }), GREETING);
    assert.equal(format('<p>Только текст.</p>'), '<p>Только текст.</p>');
});

test('the toggle off means no change, on again — marks again', () => {
    settings.modules.fixes.bubbleImages = false;
    assert.equal(format(GREETING), GREETING);
    settings.modules.fixes.bubbleImages = true;
    assert.equal(format(GREETING), MARKED);
});

test('a disabled module leaves the hook silent; enabling it again reuses the same hook', async () => {
    await fixes.disable();
    assert.equal(format(GREETING), GREETING);
    await fixes.enable(env);
    assert.equal(hooks.length, 1);
    assert.equal(format(GREETING), MARKED);
    assert.ok(!fixes.notes().some((note) => /messageFormatter/.test(note.text)));
    await fixes.disable();
});
