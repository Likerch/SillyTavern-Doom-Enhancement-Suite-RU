// Модуль 2 целиком: настоящий names.js поверх поддельных ST и DES. Поддельный DES повторяет то, на что модуль
// опирается: addCharacterAlias (без учёта регистра), алиасы общие для всех чатов, карточки и скрытые — у каждого
// чата свои, а при загрузке чата скрытое имя без карточки становится карточкой (orphan-adopt в loadChatData).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dropAdoptedCards, moveDesSheet } from '../src/des-adapter.js';
import { buildNameContext } from '../src/name-context.js';
import { decideName } from '../src/lib/russian-names.js';

console.info = () => {};
console.debug = () => {};

const listeners = {};
const extensionSettings = {};
const st = { chat: [], chatId: 'A', chatMetadata: {} };
const toasts = [];
/** Узлы, созданные поддельным DOM: панель рисует ими «Склейки имён». */
const created = [];
function fakeElement(tag) {
    const node = {
        tag, children: [], style: {}, className: '', textContent: '', value: '',
        append: (...items) => node.children.push(...items),
        replaceChildren: (...items) => { node.children = [...items]; },
        addEventListener: (type, handler) => { if (type === 'click') node.onClick = handler; },
    };
    created.push(node);
    return node;
}
/** Обработчики кликов на документе: так модуль ловит кнопку импорта листа DES. */
const clicks = new Set();
globalThis.document = {
    addEventListener: (type, handler) => { if (type === 'click') clicks.add(handler); },
    removeEventListener: (type, handler) => clicks.delete(handler),
    querySelector: () => null,
    createElement: fakeElement,
};
globalThis.Element ??= class Element {};
globalThis.toastr = { options: {}, success: (text) => toasts.push(['success', text]), info: (text) => toasts.push(['info', text]), warning() {}, error() {} };
globalThis.SillyTavern = {
    getContext: () => ({
        eventSource: {
            on: (event, handler) => (listeners[event] ??= []).push(handler),
            makeFirst: (event, handler) => (listeners[event] ??= []).unshift(handler),
            makeLast: (event, handler) => (listeners[event] ??= []).push(handler),
            removeListener: (event, handler) => { listeners[event] = (listeners[event] ?? []).filter((item) => item !== handler); },
        },
        eventTypes: { MESSAGE_RECEIVED: 'message_received', GENERATION_STARTED: 'generation_started', CHAT_CHANGED: 'chat_id_changed' },
        chat: st.chat,
        chatId: st.chatId,
        chatMetadata: st.chatMetadata,
        extensionSettings,
        saveSettingsDebounced() {},
    }),
};

const { default: names } = await import('../src/modules/names.js');

/** @type {ReturnType<typeof fakeDes>} */
let des;

function fakeDes() {
    const state = { mode: 'together', aliases: {}, users: {}, thoughts: null, chats: {}, workshop: false, reapplied: 0 };
    const chat = () => (state.chats[st.chatId] ??= { known: {}, removed: [], colors: {}, sheets: {} });
    return {
        state,
        chat,
        generationMode: () => state.mode,
        workshopOpen: () => state.workshop,
        names: {
            cards: () => ({ npc: Object.keys(chat().known), users: Object.keys(state.users) }),
            aliases: () => Object.fromEntries(Object.entries(state.aliases).map(([card, list]) => [card, [...list]])),
            addAlias(canonical, alias) {
                const list = state.aliases[canonical] ?? [];
                state.aliases[canonical] = list;
                if (list.some((item) => item.toLowerCase() === alias.toLowerCase())) return false;
                list.push(alias);
                return true;
            },
            removeAlias(canonical, alias) {
                const list = state.aliases[canonical];
                if (!list?.some((item) => item.toLowerCase() === alias.toLowerCase())) return false;
                state.aliases[canonical] = list.filter((item) => item.toLowerCase() !== alias.toLowerCase());
                return true;
            },
            dismissedByDes: () => false,
            save() {},
            fromReply: (text) => JSON.parse(/TRACKER:(\[.*?\])/.exec(String(text))?.[1] ?? '[]'),
            fromThoughts: (thoughts) => (thoughts ? JSON.parse(thoughts).map((entry) => entry.name) : []),
        },
        roster: {
            available: () => true,
            removed: () => chat().removed,
            colors: () => chat().colors,
            save() {},
            forgetAdopted: (list) => dropAdoptedCards(chat().known, chat().removed, list),
        },
        sheets: {
            available: () => true,
            store: () => chat().sheets,
            rename: (from, to, options) => moveDesSheet(chat().sheets, from, to, options),
        },
        tracker: { read: () => ({ characterThoughts: state.thoughts }) },
        bubbles: { reapplyLast() { state.reapplied += 1; } },
    };
}

const fire = (event, ...args) => (listeners[event] ?? []).slice().forEach((handler) => handler(...args));
const settings = () => extensionSettings.desru.modules.names;
/** Следующее задание: модуль доделывает смену чата после всех её обработчиков. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function enable() {
    names.enable({ des, settings: extensionSettings.desru, verdict: null });
    await settle();
}

/** Открыть чат так, как это делает DES: сначала loadChatData (с orphan-adopt), потом наш CHAT_CHANGED. */
async function openChat(id) {
    st.chatId = id;
    const chat = des.chat();
    const users = new Set(Object.keys(des.state.users).map((name) => name.toLowerCase()));
    for (const name of chat.removed) {
        const known = Object.keys(chat.known).some((key) => key.toLowerCase() === name.toLowerCase());
        if (!known && !users.has(name.toLowerCase())) chat.known[name] = { emoji: '👤' };
    }
    fire('chat_id_changed');
    await settle();
}

/** Ответ модели в режиме together: трекер с этими именами. */
function reply(names, text = '') {
    st.chat.splice(0, st.chat.length, { is_user: false, mes: `${text}${names ? ` TRACKER:${JSON.stringify(names)}` : ''}` });
    fire('message_received');
}

beforeEach(() => {
    extensionSettings.desru = {};
    st.chatId = 'A';
    st.chat.length = 0;
    toasts.length = 0;
    des = fakeDes();
});

afterEach(() => names.disable());

test('both spellings of a card with ё become aliases, nothing lands among the unmerged pairs', async () => {
    des.state.mode = 'separate';
    des.chat().known = { 'Алёна': {}, 'Аня': {} };
    await enable();
    assert.deepEqual(des.state.aliases['Алёна'], ['алёна', 'алена']);
    assert.deepEqual(settings().unmerged, []);
    // Пользователь убрал «алена» в Workshop: помним отдельно и не возвращаем, разъединённых не трогаем.
    des.state.aliases['Алёна'] = ['алёна'];
    await openChat('A');
    assert.deepEqual(des.state.aliases['Алёна'], ['алёна']);
    assert.deepEqual(settings().caseAliasesRemoved, [{ variant: 'алена', canonical: 'Алёна' }]);
    assert.deepEqual(settings().unmerged, []);
});

test('the old ё bookkeeping bug is cleaned up once, a later real unmerge stays', async () => {
    extensionSettings.desru = { modules: { names: {
        caseAliasesAdded: [{ variant: 'алёна', canonical: 'Алёна' }],
        unmerged: [{ variant: 'алена', canonical: 'Алёна' }, { variant: 'Ани', canonical: 'Аня' }],
    } } };
    des.chat().known = { 'Алёна': {} };
    des.state.aliases['Алёна'] = ['алёна'];
    await enable();
    assert.deepEqual(settings().unmerged, [{ variant: 'Ани', canonical: 'Аня' }]);
    assert.equal(decideName('Алена', buildNameContext(des)).canonical, 'Алёна');
    names.disable();
    settings().unmerged.push({ variant: 'алена', canonical: 'Алёна' });
    await enable();
    assert.equal(settings().unmerged.length, 2);
});

test('in together mode spellings are left to the case step; separate mode skips spellings another card owns', async () => {
    des.chat().known = { 'Аня': {} };
    await enable();
    assert.equal(des.state.aliases['Аня'], undefined);
    names.disable();
    des.state.mode = 'separate';
    des.state.aliases = { 'Артём': ['артём', 'артем'] };
    st.chatId = 'B';
    des.chat().known = { 'Артем': {} };
    await enable();
    assert.equal(des.state.aliases['Артем'], undefined);
    assert.deepEqual(des.state.aliases['Артём'], ['артём', 'артем']);
});

test('a hidden persona form does not come back as an NPC card after DES reloads the chat', async () => {
    des.state.users = { 'Лиза': {} };
    des.chat().known = { 'Аня': {} };
    await enable();
    reply(['Аня', 'Лизы']);
    assert.deepEqual(des.chat().removed, ['Лизы']);
    assert.equal(settings().journal[0].chatId, 'A');
    des.state.mode = 'separate';
    await openChat('A');
    assert.deepEqual(Object.keys(des.chat().known), ['Аня']);
    assert.equal(des.state.aliases['Лизы'], undefined);
    // Карточку, которую пользователь наполнил сам, не трогаем; и скрытые в любом случае — не цель склейки.
    des.chat().known['Лизы'] = { emoji: '🙂', note: 'своя' };
    await openChat('A');
    assert.ok('Лизы' in des.chat().known);
    assert.equal(des.state.aliases['Лизы'], undefined);
    assert.ok(!buildNameContext(des).npcCards.includes('Лизы'));
});

test('what depends on the chat DES loaded waits for DES, whatever the subscription order', async () => {
    des.state.users = { 'Лиза': {} };
    des.chat().known = { 'Борис': {} };
    await enable();
    reply(['Лизы']);
    des.state.mode = 'separate';
    // DES подписан на CHAT_CHANGED после модуля: его loadChatData идёт уже после нашего обработчика.
    fire('chat_id_changed');
    des.chat().known['Лизы'] = { emoji: '👤' };
    des.state.thoughts = JSON.stringify([{ name: 'Борис' }]);
    await settle();
    assert.ok(!('Лизы' in des.chat().known));
    // Мысли загруженного чата — не новый трекер: неудачный отдельный запрос ничего не раскрашивает.
    st.chat.splice(0, st.chat.length, { is_user: false, mes: 'Борис кивнул. <font color=#3366ff>«Да»</font>' });
    fire('dooms_tracker_update_complete');
    assert.deepEqual(des.chat().colors, {});
});

test('a hide entry is reconciled and unmerged only in its own chat', async () => {
    des.state.users = { 'Лиза': {} };
    await enable();
    reply(['Лизы']);
    await openChat('B');
    assert.equal(settings().journal.length, 1);
    assert.deepEqual(settings().unmerged, []);
    // «Разъединить» из другого чата — только подсказка.
    toasts.length = 0;
    const entry = settings().journal[0];
    unmergeFromPanel(entry);
    assert.match(toasts.at(-1)?.[1] ?? '', /в другом чате/);
    assert.equal(settings().journal.length, 1);
    // В своём чате имя вернули на панель — пара больше не скрывается.
    st.chatId = 'A';
    des.chat().removed.length = 0;
    await openChat('A');
    assert.deepEqual(settings().journal, []);
    assert.deepEqual(settings().unmerged, [{ variant: 'Лизы', canonical: 'Лиза' }]);
});

test('old hide entries without a chat are never moved to the unmerged pairs on their own', async () => {
    extensionSettings.desru = { modules: { names: { journal: [{ variant: 'Лизы', canonical: 'Лиза', kind: 'hide', via: 'падеж', at: 1 }] } } };
    await enable();
    await openChat('B');
    assert.equal(settings().journal.length, 1);
    assert.deepEqual(settings().unmerged, []);
});

test('an alias of a deleted card is forgotten, a removed alias of a living card is remembered', async () => {
    des.chat().known = { 'Аня': {}, 'Мира': {} };
    await enable();
    reply(['Ани', 'Мирой']);
    assert.deepEqual(des.state.aliases, { 'Аня': ['Ани'], 'Мира': ['Мирой'] });
    // «Аню» удалили в Workshop (DES стирает и её алиасы), у «Миры» убрали алиас.
    delete des.chat().known['Аня'];
    delete des.state.aliases['Аня'];
    des.state.aliases['Мира'] = [];
    await openChat('B');
    // В чужом чате удаление не проверить — запись ждёт; убранный алиас живой карточки — сразу.
    assert.deepEqual(settings().journal.map((entry) => entry.variant), ['Ани']);
    assert.deepEqual(settings().unmerged, [{ variant: 'Мирой', canonical: 'Мира' }]);
    await openChat('A');
    assert.deepEqual(settings().journal, []);
    assert.deepEqual(settings().unmerged, [{ variant: 'Мирой', canonical: 'Мира' }]);
});

test('two names of one tracker reply are not merged into each other', async () => {
    des.chat().known = { 'Александр': {}, 'Аня': {}, 'Дарган фон Вартенбург': {} };
    des.state.aliases = { 'Дарган фон Вартенбург': ['Дарган'] };
    await enable();
    reply(['Александр', 'Саша', 'Ани', 'Дарган', 'Капитан Дарган']);
    assert.deepEqual(des.state.aliases, { 'Аня': ['Ани'], 'Дарган фон Вартенбург': ['Дарган'] });
});

test('speaker colours come only from fresh tracker data', async () => {
    des.chat().known = { 'Аня': {} };
    des.state.thoughts = JSON.stringify([{ name: 'Аня' }]);
    await enable();
    const text = 'Аня подняла глаза. <font color=#ff66aa>«Привет»</font>';
    // Ответ без трекера: у DES мысли прошлого ответа — по ним не раскрашиваем.
    reply(null, text);
    assert.deepEqual(des.chat().colors, {});
    reply(['Аня'], text);
    assert.deepEqual(des.chat().colors, { 'Аня': '#ff66aa' });
    // Отдельный запрос трекера не удался: мысли те же — новых цветов нет.
    des.state.mode = 'separate';
    des.chat().known['Борис'] = {};
    des.chat().colors = {};
    st.chat.splice(0, 1, { is_user: false, mes: 'Борис кивнул. <font color=#3366ff>«Да»</font>' });
    fire('dooms_tracker_update_complete');
    assert.deepEqual(des.chat().colors, {});
    des.state.thoughts = JSON.stringify([{ name: 'Борис' }]);
    fire('dooms_tracker_update_complete');
    assert.deepEqual(des.chat().colors, { 'Борис': '#3366ff' });
    assert.equal(des.state.reapplied, 1);
});

test('on a chat switch a sheet only moves to a card without one; a fresh import may update it', async (t) => {
    des.chat().known = { 'Флоренс': {}, 'Аня': {} };
    const card = { characterName: 'Флоренс', mode: 'notes', importedAt: '2026-10-01T10:00:00.000Z' };
    const full = { characterName: 'Флоренс Клеймор', importedAt: '2026-10-02T10:00:00.000Z' };
    const ani = { characterName: 'Аней', importedAt: '2026-10-02T10:00:00.000Z' };
    des.chat().sheets = { 'Флоренс': card, 'Флоренс Клеймор': full, 'Аней': ani };
    await enable();
    assert.deepEqual(des.chat().sheets, { 'Флоренс': card, 'Флоренс Клеймор': full, 'Аня': ani });
    // Импорт из попапа DES: тот же лист записан заново — он обновляет лист карточки, её заметки остаются.
    t.mock.timers.enable({ apis: ['setInterval'] });
    const target = Object.assign(new Element(), { closest: () => ({}) });
    for (const handler of clicks) handler({ target });
    des.chat().sheets['Флоренс Клеймор'] = { characterName: 'Флоренс Клеймор', sections: ['новое'], importedAt: '2026-10-03T10:00:00.000Z' };
    t.mock.timers.tick(500);
    assert.deepEqual(Object.keys(des.chat().sheets).sort(), ['Аня', 'Флоренс']);
    assert.equal(des.chat().sheets['Флоренс'].mode, 'notes');
    assert.deepEqual(des.chat().sheets['Флоренс'].sections, ['новое']);
    assert.match(toasts.at(-1)?.[1] ?? '', /Лист карточки «Флоренс» обновлён/);
});

test('disable drops the Workshop check, so the next start reconciles again', async () => {
    des.chat().known = { 'Аня': {} };
    await enable();
    des.state.workshop = true;
    reply(['Ани']);
    des.state.workshop = false;
    names.disable();
    des.state.aliases['Аня'] = [];
    await enable();
    assert.deepEqual(settings().unmerged, [{ variant: 'Ани', canonical: 'Аня' }]);
});

/** Нажать «Разъединить» у записи в панели «Склейки имён» (панель рисуется поддельным DOM). */
function unmergeFromPanel(entry) {
    created.length = 0;
    names.mountSection(fakeElement('details'));
    const label = (node) => node.children.find((child) => child.tag === 'span')?.textContent;
    const button = created.find((node) => node.tag === 'div' && label(node) === 'Разъединить');
    assert.ok(button, `нет кнопки «Разъединить» для «${entry.variant}»`);
    button.onClick();
}
