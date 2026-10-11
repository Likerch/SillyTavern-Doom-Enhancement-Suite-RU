// Модуль 4, «Пузыри без похода в редактор» (0.8.5): сторож src/lib/bubble-guard.js и его решения, затем — на настоящем
// коде пузырей DES из локального клона (tests/helpers/des-bubbles.js): перерисовка без события оставляет атрибут
// «разложено» без разметки, сторож раскладывает заново и не ходит по кругу, если пузырей в сообщении не бывает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleGuard } from '../src/lib/bubble-guard.js';
import { desBubbleState, relayDesBubbles } from '../src/des-adapter.js';
import { desBubblesFile, loadDesBubbles, messageElement } from './helpers/des-bubbles.js';
import { MiniElement } from './helpers/mini-dom.js';

const skip = desBubblesFile() ? false : 'нет клона DES (vendor/des или DESRU_DES_DIR)';

/** Ручные таймеры: тест сам решает, когда «прошла пауза». */
function manualTimers() {
    /** @type {Map<number, () => void>} */
    const pending = new Map();
    let next = 0;
    return {
        pending,
        setTimer: (/** @type {() => void} */ callback) => {
            next += 1;
            pending.set(next, callback);
            return next;
        },
        clearTimer: (/** @type {number} */ id) => pending.delete(id),
        runAll() {
            const callbacks = [...pending.values()];
            pending.clear();
            for (const callback of callbacks) callback();
        },
    };
}

/**
 * Сообщение ленты: `.mes[mesid]` с `.mes_text`. Состояние пузырей задаётся в тесте.
 * @param {number} id @param {'none'|'laid'|'lost'} state
 */
function fakeMessage(id, state) {
    const mes = new MiniElement('div');
    mes.setAttribute('class', 'mes');
    mes.setAttribute('mesid', String(id));
    const text = new MiniElement('div');
    text.setAttribute('class', 'mes_text');
    mes.appendChild(text);
    return { mes, text, state };
}

/** @param {Partial<import('../src/lib/bubble-guard.js').BubbleGuardDeps>} [overrides] */
function guardFor(messages, overrides = {}) {
    const timers = manualTimers();
    const calls = { restored: [], after: 0 };
    const byElement = new Map(messages.map((message) => [message.mes, message]));
    const guard = new BubbleGuard({
        state: (element) => byElement.get(element).state,
        restore: (element) => {
            const message = byElement.get(element);
            if (message.state !== 'lost') return false;
            calls.restored.push(Number(element.getAttribute('mesid')));
            message.state = message.barren ? 'lost' : 'laid';
            return true;
        },
        afterRestore: () => {
            calls.after += 1;
        },
        isLast: (element) => Number(element.getAttribute('mesid')) === messages.length - 1,
        delayMs: 1500,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        ...overrides,
    });
    return { guard, timers, calls };
}

test('a re-render of .mes_text is checked once after the pause; inner changes are not re-renders', () => {
    const first = fakeMessage(0, 'lost');
    const { guard, timers, calls } = guardFor([first]);
    const inner = new MiniElement('span');
    first.text.appendChild(inner);
    guard.observe([{ target: inner }, { target: first.mes }]);
    assert.equal(timers.pending.size, 0);
    guard.observe([{ target: first.text }, { target: first.text }]);
    guard.observe([{ target: first.text }]);
    assert.equal(timers.pending.size, 1);
    timers.runAll();
    assert.deepEqual(calls.restored, [0]);
    assert.equal(calls.after, 1);
    assert.equal(guard.restored, 1);
});

test('laid out or never laid out messages are left to DES', () => {
    const laid = fakeMessage(0, 'laid');
    const none = fakeMessage(1, 'none');
    const { guard, calls } = guardFor([laid, none]);
    assert.equal(guard.check(laid.mes), false);
    assert.equal(guard.check(none.mes), false);
    assert.deepEqual(calls.restored, []);
});

test('the message editor is open: hands off', () => {
    const message = fakeMessage(0, 'lost');
    message.text.appendChild(new MiniElement('textarea'));
    const { guard, calls } = guardFor([message]);
    assert.equal(guard.check(message.mes), false);
    assert.deepEqual(calls.restored, []);
});

test('the reply being generated is left alone; older messages are restored meanwhile', () => {
    const older = fakeMessage(0, 'lost');
    const last = fakeMessage(1, 'lost');
    const { guard, calls } = guardFor([older, last]);
    guard.setGenerating(true);
    assert.equal(guard.check(last.mes), false);
    assert.equal(guard.check(older.mes), true);
    guard.setGenerating(false);
    assert.equal(guard.check(last.mes), true);
    assert.deepEqual(calls.restored, [0, 1]);
});

test('a stream still being written holds the last message even when the generation flag was reset', () => {
    const last = fakeMessage(0, 'lost');
    let streaming = true;
    const { guard, calls } = guardFor([last], { streaming: () => streaming });
    assert.equal(guard.check(last.mes), false);
    streaming = false;
    assert.equal(guard.check(last.mes), true);
    assert.deepEqual(calls.restored, [0]);
});

test('a message where laying out gives no bubbles is tried once, not in a circle', () => {
    const message = fakeMessage(0, 'lost');
    message.barren = true;
    const { guard, calls } = guardFor([message]);
    assert.equal(guard.check(message.mes), true);
    assert.equal(guard.check(message.mes), false);
    assert.deepEqual(calls.restored, [0]);
});

test('the toggle off, a detached message and dispose stop everything', () => {
    const message = fakeMessage(0, 'lost');
    let on = false;
    const { guard, timers, calls } = guardFor([message], { enabled: () => on });
    guard.observe([{ target: message.text }]);
    assert.equal(timers.pending.size, 0);
    assert.equal(guard.check(message.mes), false);
    on = true;
    message.mes.isConnected = false;
    assert.equal(guard.check(message.mes), false);
    message.mes.isConnected = true;
    guard.observe([{ target: message.text }]);
    guard.dispose();
    assert.equal(timers.pending.size, 0);
    assert.deepEqual(calls.restored, []);
});

// ─── Настоящий DES ─────────────────────────────────────────────────────────

const REPLY = '<p>Вера кивнула. <font color="#7fb3d5">«Значит, корабль придёт»</font>.</p>\n<p>Элизабет подняла фонарь.</p>';
/** То, что вставляет ST updateMessageBlock, когда картинка дорисовалась: новый HTML внутри того же .mes_text. */
const REPLY_WITH_PICTURE = `${REPLY}\n<p><span data-naist-img="img-0001" class="naist-inline">картинка</span></p>`;

/** restoreIfLost адаптера поверх настоящего chatBubbles.js. */
function realGuard(des) {
    return new BubbleGuard({
        state: desBubbleState,
        restore: (element) => {
            if (desBubbleState(element) !== 'lost') return false;
            relayDesBubbles(des, element, 'cards');
            return true;
        },
        isLast: () => false,
        delayMs: 0,
    });
}

test('DES: a silent re-render keeps the "applied" mark without the cards; the guard lays them out again', { skip }, () => {
    const des = /** @type {Record<string, any>} */ (loadDesBubbles());
    const { mes, text } = messageElement(REPLY);
    assert.equal(desBubbleState(mes), 'none');
    des.applyChatBubbles(mes, 'cards');
    assert.equal(desBubbleState(mes), 'laid');

    text.innerHTML = REPLY_WITH_PICTURE;
    assert.equal(desBubbleState(mes), 'lost');
    // DES сам этого не исправит: повторный вызов видит свой атрибут и выходит.
    des.applyChatBubbles(mes, 'cards');
    assert.equal(desBubbleState(mes), 'lost');

    const guard = realGuard(des);
    assert.equal(guard.check(mes), true);
    assert.equal(desBubbleState(mes), 'laid');
    assert.ok(text.innerHTML.includes('data-naist-img="img-0001"'));
    assert.ok(text.innerHTML.includes('Элизабет подняла фонарь.'));
    assert.equal(guard.check(mes), false);
});

test('DES: a message without text for bubbles is laid out once, then left alone', { skip }, () => {
    const des = /** @type {Record<string, any>} */ (loadDesBubbles());
    const { mes, text } = messageElement(REPLY);
    des.applyChatBubbles(mes, 'cards');
    text.innerHTML = '<p></p>';
    const guard = realGuard(des);
    assert.equal(guard.check(mes), true);
    assert.equal(desBubbleState(mes), 'lost');
    assert.equal(guard.check(mes), false);
});
