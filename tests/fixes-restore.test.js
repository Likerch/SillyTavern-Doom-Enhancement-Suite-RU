// Модуль 4, «Пузыри без похода в редактор»: настоящий fixes.js поверх поддельного ST. Переключатель включён
// по умолчанию; MORE_MESSAGES_LOADED раскладывает подгруженные сообщения; перерисовка текста сообщения доходит
// до сторожа через MutationObserver ленты; во время генерации последнее сообщение не трогается; выключение модуля
// снимает наблюдателя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MiniElement } from './helpers/mini-dom.js';

console.info = () => {};
console.debug = () => {};
console.warn = () => {};

/** @type {Map<string, Function[]>} */
const handlers = new Map();
const eventSource = {
    on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    makeFirst: (event, handler) => handlers.set(event, [handler, ...(handlers.get(event) ?? [])]),
    makeLast: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    removeListener: (event, handler) => handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== handler)),
};
const emit = async (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) await handler(...args);
};
const EVENTS = {
    GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
    MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    MESSAGE_SWIPED: 'message_swiped', CHAT_CHANGED: 'chat_id_changed', MORE_MESSAGES_LOADED: 'more_messages_loaded',
};

const chatElement = new MiniElement('div');
chatElement.setAttribute('id', 'chat');
globalThis.document = { querySelector: (selector) => (selector === '#chat' ? chatElement : null), querySelectorAll: () => [] };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.location = { href: 'http://localhost:8000/' };

/** @type {{ callback: Function, target: unknown, disconnected: boolean }[]} */
const observers = [];
globalThis.MutationObserver = class {
    constructor(callback) {
        this.entry = { callback, target: null, disconnected: false };
        observers.push(this.entry);
    }
    observe(target) {
        this.entry.target = target;
    }
    disconnect() {
        this.entry.disconnected = true;
    }
};

const chat = [{ mes: 'a' }, { mes: 'b' }];
globalThis.SillyTavern = {
    getContext: () => ({
        eventSource,
        eventTypes: EVENTS,
        getExtensionManifest: () => null,
        extensionSettings: { disabledExtensions: [] },
        chat,
        saveSettingsDebounced() {},
    }),
};

const { default: fixes } = await import('../src/modules/fixes.js');
const { getSettings } = await import('../src/settings.js');

/** Сообщение ленты; состояние пузырей задаёт тест. @param {number} id */
function message(id) {
    const mes = new MiniElement('div');
    mes.setAttribute('class', 'mes');
    mes.setAttribute('mesid', String(id));
    const text = new MiniElement('div');
    text.setAttribute('class', 'mes_text');
    mes.appendChild(text);
    chatElement.appendChild(mes);
    return { mes, text };
}

const calls = { restore: [], applyMissing: 0, rerender: 0 };
/** @type {Map<unknown, 'none'|'laid'|'lost'>} */
const states = new Map();
const settings = getSettings();
const env = {
    des: {
        tracker: { read: () => ({ quests: null, infoBox: null, characterThoughts: null }) },
        characterFields: () => [],
        sceneFields: () => [],
        generationMode: () => 'together',
        rerender: () => {
            calls.rerender += 1;
        },
        bubbles: {
            mode: () => 'cards',
            state: (element) => states.get(element) ?? 'none',
            restoreIfLost(element) {
                if (states.get(element) !== 'lost') return false;
                calls.restore.push(Number(element.getAttribute('mesid')));
                states.set(element, 'laid');
                return true;
            },
            applyMissing() {
                calls.applyMissing += 1;
                return true;
            },
        },
    },
    verdict: { state: 'ok', ui: true, data: true },
    settings,
    refresh() {},
};

const older = message(0);
const last = message(1);

test('the option is on by default and listed in module 4', () => {
    assert.equal(settings.modules.fixes.restoreBubbles, true);
    const option = fixes.options.find((item) => item.key === 'restoreBubbles');
    assert.ok(option);
    assert.match(option.description, /Show more messages/);
});

test('enable watches the chat; a silent re-render is laid out again after the pause, the reply in progress is not', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await fixes.enable(env);
    const observer = observers.at(-1);
    assert.equal(observer.target, chatElement);

    states.set(older.mes, 'lost');
    states.set(last.mes, 'lost');
    await emit(EVENTS.GENERATION_STARTED, 'normal', {}, false);
    observer.callback([{ target: older.text }, { target: last.text }]);
    t.mock.timers.tick(1000);
    assert.deepEqual(calls.restore, []);
    t.mock.timers.tick(600);
    assert.deepEqual(calls.restore, [0]);
    assert.equal(calls.rerender, 1);

    await emit(EVENTS.GENERATION_ENDED);
    observer.callback([{ target: last.text }]);
    t.mock.timers.tick(1600);
    assert.deepEqual(calls.restore, [0, 1]);

    // Пробная и тихая генерации последнее сообщение не держат.
    states.set(last.mes, 'lost');
    await emit(EVENTS.GENERATION_STARTED, 'quiet', {}, false);
    observer.callback([{ target: last.text }]);
    t.mock.timers.tick(1600);
    assert.deepEqual(calls.restore, [0, 1, 1]);
});

test('«Show more messages» lays out the loaded messages; the toggle off stops it and the guard', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await emit(EVENTS.MORE_MESSAGES_LOADED);
    t.mock.timers.tick(200);
    assert.equal(calls.applyMissing, 1);

    settings.modules.fixes.restoreBubbles = false;
    await emit(EVENTS.MORE_MESSAGES_LOADED);
    states.set(older.mes, 'lost');
    observers.at(-1).callback([{ target: older.text }]);
    t.mock.timers.tick(2000);
    assert.equal(calls.applyMissing, 1);
    assert.deepEqual(calls.restore, [0, 1, 1]);
    settings.modules.fixes.restoreBubbles = true;
});

test('disable disconnects the observer and drops the handlers', async () => {
    const observer = observers.at(-1);
    await fixes.disable();
    assert.equal(observer.disconnected, true);
    assert.equal((handlers.get(EVENTS.MORE_MESSAGES_LOADED) ?? []).length, 0);
});
