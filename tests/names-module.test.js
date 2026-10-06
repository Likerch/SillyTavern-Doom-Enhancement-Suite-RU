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
const st = { chat: [], chatId: 'A', chatMetadata: {}, name1: 'Игрок', name2: '' };
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
        name1: st.name1,
        name2: st.name2,
        extensionSettings,
        saveSettingsDebounced() {},
    }),
};

const { default: names } = await import('../src/modules/names.js');

/** @type {ReturnType<typeof fakeDes>} */
let des;

function fakeDes() {
    // `global` — общие карточки DES (knownCharacters настроек): копятся из всех чатов, видны в любом.
    const state = { mode: 'together', aliases: {}, users: {}, global: {}, thoughts: null, chats: {}, workshop: false, reapplied: 0 };
    const chat = () => (state.chats[st.chatId] ??= { known: {}, removed: [], colors: {}, sheets: {} });
    return {
        state,
        chat,
        generationMode: () => state.mode,
        workshopOpen: () => state.workshop,
        names: {
            cards: () => ({
                npc: [...new Set([...Object.keys(state.global), ...Object.keys(chat().known)])],
                users: Object.keys(state.users),
                chat: Object.keys(chat().known),
            }),
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
            // Ответы «Нет» в попапе DES «тот же персонаж?»: «вариант|карточка».
            dismissedByDes: (variant, canonical) => (state.dismissed ?? []).includes(`${variant}|${canonical}`),
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

/** Ответ модели в режиме together: трекер с этими именами; `history` — тексты сообщений чата до него. */
function reply(names, text = '', history = []) {
    const earlier = history.map((mes) => ({ is_user: false, mes }));
    st.chat.splice(0, st.chat.length, ...earlier, { is_user: false, mes: `${text}${names ? ` TRACKER:${JSON.stringify(names)}` : ''}` });
    fire('message_received');
}

beforeEach(() => {
    extensionSettings.desru = {};
    st.chatId = 'A';
    st.name2 = '';
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

/**
 * Нарисовать панель «Склейки имён» поддельным DOM и вернуть строки журнала: текст и подпись кнопки.
 * @returns {{ text: string, button: string, click: () => void }[]}
 */
function panelJournal() {
    created.length = 0;
    const section = fakeElement('details');
    names.mountSection(section);
    const list = section.children.find((node) => node.className === 'desru-merge-list');
    const label = (node) => node.children.find((child) => child.tag === 'span')?.textContent;
    return list.children.filter((item) => item.children.length === 2).map((item) => ({
        text: item.children[0].textContent,
        button: label(item.children[1]),
        click: () => item.children[1].onClick(),
    }));
}

/** Нажать «Разъединить» у записи в панели «Склейки имён». */
function unmergeFromPanel(entry) {
    const row = panelJournal().find((item) => item.button === 'Разъединить' && item.text.includes(`«${entry.variant}»`));
    assert.ok(row, `нет кнопки «Разъединить» для «${entry.variant}»`);
    row.click();
}

test('Maestro hears about alias and hidden-name changes, not about replies that change nothing', async () => {
    const { createApi } = await import('../src/maestro-api.js');
    const api = createApi({ des: () => des });
    let calls = 0;
    const off = api.onNamesChanged(() => {
        calls += 1;
    });
    try {
        des.state.users = { 'Лиза': {} };
        des.chat().known = { 'Аня': {} };
        await enable();
        assert.equal(calls, 0);
        reply(['Ани']);
        assert.equal(calls, 1, 'alias added');
        assert.deepEqual(api.aliases(), { 'Аня': ['Ани'] });
        reply(['Ани']);
        assert.equal(calls, 1, 'already an alias: nothing changed');
        reply(['Лизы']);
        assert.equal(calls, 2, 'persona form hidden');
        des.state.mode = 'separate';
        des.chat().known['Борис'] = {};
        await openChat('A');
        // Смена чата: алиасы-написания (режим separate) и заготовка DES для скрытой «Лизы» убрана — два изменения.
        assert.equal(calls, 4);
        assert.deepEqual(api.aliases()['Борис'], ['борис']);
    } finally {
        off();
    }
});

// ─── Склейка только с персонажами этого чата ───────────────────────────────

test('a new name is not glued to a character known only from another chat: the journal offers «Склеить»', async () => {
    const { createApi } = await import('../src/maestro-api.js');
    const api = createApi({ des: () => des });
    let calls = 0;
    const off = api.onNamesChanged(() => {
        calls += 1;
    });
    try {
        // «Офелия Ричардс» — из прошлой истории: в общих карточках DES, в этом чате её нет.
        des.state.global = { 'Офелия Ричардс': {} };
        des.chat().known = { 'Аня': {} };
        await enable();
        reply(['Офелия'], 'Офелия поправила шляпку.');
        assert.deepEqual(des.state.aliases, {});
        assert.equal(calls, 0, 'nothing changed in DES');
        assert.deepEqual(settings().journal.map(({ variant, canonical, kind, via, chatId }) => ({ variant, canonical, kind, via, chatId })),
            [{ variant: 'Офелия', canonical: 'Офелия Ричардс', kind: 'remote', via: 'часть имени', chatId: 'A' }]);
        // Следующий ответ с тем же именем — та же запись, а не новая.
        reply(['Офелия']);
        assert.equal(settings().journal.length, 1);
        // Смена чата не делает из записи разъединённую пару.
        await openChat('B');
        await openChat('A');
        assert.equal(settings().journal.length, 1);
        assert.deepEqual(settings().unmerged ?? [], []);

        const [row] = panelJournal();
        assert.equal(row.text.split(' · ')[0], 'Не склеил «Офелия» с «Офелия Ричардс»: «Офелия Ричардс» есть только в другом чате');
        assert.equal(row.button, 'Склеить');
        row.click();
        assert.deepEqual(des.state.aliases, { 'Офелия Ричардс': ['Офелия'] });
        assert.equal(calls, 1, 'Maestro hears about the glue');
        assert.match(toasts.at(-1)?.[1] ?? '', /Теперь «Офелия» — это «Офелия Ричардс»/);
        assert.deepEqual(settings().journal.map(({ kind }) => kind), ['alias']);

        // Дальше это обычная склейка: «Разъединить» убирает алиас и запоминает пару.
        const [glued] = panelJournal();
        assert.equal(glued.button, 'Разъединить');
        glued.click();
        assert.deepEqual(des.state.aliases, { 'Офелия Ричардс': [] });
        assert.deepEqual(settings().unmerged, [{ variant: 'Офелия', canonical: 'Офелия Ричардс' }]);
        assert.equal(calls, 2);
        // Разъединённая пара не возвращается и записью «Не склеил».
        reply(['Офелия']);
        assert.deepEqual(settings().journal, []);
    } finally {
        off();
    }
});

test('a character of this chat is still a glue target: its roster, the scene, the ST card, the messages', async () => {
    des.state.global = { 'Офелия Ричардс': {} };
    await enable();
    // В списке персонажей DES этого чата.
    des.chat().known = { 'Офелия Ричардс': {} };
    reply(['Офелия']);
    assert.deepEqual(des.state.aliases, { 'Офелия Ричардс': ['Офелия'] });

    const glued = async (setup, name = 'Саша') => {
        names.disable();
        des = fakeDes();
        des.state.global = { 'Александр': {} };
        extensionSettings.desru = {};
        st.name2 = '';
        const history = setup() ?? [];
        await enable();
        reply([name], '', history);
        return des.state.aliases['Александр'] ?? [];
    };
    // Сейчас в «Персонажах в сцене».
    assert.deepEqual(await glued(() => {
        des.state.thoughts = JSON.stringify([{ name: 'Александр' }]);
    }), ['Саша']);
    // Карточка ST этого чата.
    assert.deepEqual(await glued(() => {
        st.name2 = 'Александр';
    }), ['Саша']);
    // Назван в сообщениях чата, в любом падеже.
    assert.deepEqual(await glued(() => ['Ты снова встретил Александра Петровича?', 'С Александром всё в порядке.']), ['Саша']);
    // Нигде — только запись «Не склеил».
    assert.deepEqual(await glued(() => ['Саша помахал рукой.']), []);
    assert.equal(settings().journal[0].kind, 'remote');
});

test('a card named only inside the new name is not this chat\'s character', async () => {
    des.state.global = { 'Дарган': {} };
    await enable();
    reply(['Капитан Дарган'], 'Капитан Дарган отдал приказ.', ['Капитану Даргану доложили о гостях.']);
    assert.deepEqual(des.state.aliases, {});
    assert.equal(settings().journal[0].kind, 'remote');
    // Его зовут и просто «Дарган» — значит, этот персонаж здесь есть.
    reply(['Капитан Дарган'], 'Дарган кивнул.');
    assert.deepEqual(des.state.aliases, { 'Дарган': ['Капитан Дарган'] });
    assert.deepEqual(settings().journal.map(({ kind }) => kind), ['alias']);
});

test('case, register and ё of a name glue even to a card from another chat', async () => {
    des.state.global = { 'Офелия': {}, 'Алёна': {} };
    await enable();
    reply(['Офелии', 'алена']);
    assert.deepEqual(des.state.aliases, { 'Офелия': ['Офелии'], 'Алёна': ['алена'] });
    assert.deepEqual(settings().journal.map(({ variant, kind, via }) => `${variant}:${kind}:${via}`), ['Офелии:alias:падеж', 'алена:alias:падеж']);
});

test('a «Не склеил» entry goes away once its card is gone or the pair is settled in DES', async () => {
    des.state.global = { 'Офелия Ричардс': {}, 'Александр': {}, 'Дарган': {} };
    await enable();
    reply(['Офелия', 'Саша', 'Капитан Дарган']);
    assert.deepEqual(settings().journal.map(({ variant }) => variant), ['Офелия', 'Саша', 'Капитан Дарган']);
    delete des.state.global['Офелия Ричардс'];
    des.state.aliases['Александр'] = ['Саша'];
    // На «Капитана Даргана» DES спросил попапом и услышал «Нет».
    des.state.dismissed = ['Капитан Дарган|Дарган'];
    await openChat('A');
    assert.deepEqual(settings().journal, []);
    assert.deepEqual(settings().unmerged ?? [], []);
});

test('«Склеить» for a card that was deleted meanwhile only drops the entry', async () => {
    des.state.global = { 'Офелия Ричардс': {} };
    await enable();
    reply(['Офелия']);
    const [row] = panelJournal();
    delete des.state.global['Офелия Ричардс'];
    row.click();
    assert.deepEqual(des.state.aliases, {});
    assert.deepEqual(settings().journal, []);
    assert.match(toasts.at(-1)?.[1] ?? '', /больше нет/);
});

test('a persona form is hidden as before, and a hidden name is not a glue target', async () => {
    des.state.users = { 'Лиза': {} };
    des.state.global = { 'Аня Петрова': {} };
    des.chat().known = { 'Аня Петрова': {} };
    await enable();
    reply(['Лизонька']);
    assert.deepEqual(des.chat().removed, ['Лизонька']);
    // «Аня Петрова» скрыта в этом чате — не цель склейки, даже будучи здешней.
    des.chat().removed.push('Аня Петрова');
    reply(['Аня']);
    assert.equal(des.state.aliases['Аня Петрова'], undefined);
    assert.deepEqual(settings().journal.map(({ kind }) => kind), ['hide']);
});
