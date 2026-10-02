// Модуль 5 на поддельном ST: языковой замок и теги сцены в обычных, фоновых и пробных генерациях.
// Порядок событий и getExtensionPrompt — как в ST 1.19 (фильтр вставок в чат там не работает).
import { test } from 'node:test';
import assert from 'node:assert/strict';

console.info = () => {};
console.warn = () => {};
console.debug = () => {};

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
}

const IN_CHAT = 1;
const prompts = {};
function setExtensionPrompt(key, value, position, depth, scan = false, role = 0, filter = null) {
    prompts[key] = { value: String(value), position: Number(position), depth: Number(depth), scan: Boolean(scan), role, filter };
}
/** script.js getExtensionPrompt: async-функция в Array.filter — фильтр не отсекает ничего. */
async function inChatPrompts() {
    const filterByFunction = async (prompt) => !(typeof prompt.filter === 'function' && !await prompt.filter());
    const list = Object.keys(prompts).sort().map((key) => prompts[key]).filter((prompt) => prompt.position === IN_CHAT && prompt.value)
        .filter(filterByFunction);
    return (await Promise.all(list)).map((prompt) => prompt.value).join('\n');
}
/** getExtensionPromptByName: здесь фильтр ждут честно (так ST собирает вставки для сканирования лорбуков). */
async function promptByName(key) {
    const prompt = prompts[key];
    if (!prompt || (typeof prompt.filter === 'function' && !await prompt.filter())) return '';
    return prompt.value;
}

const eventSource = new EventEmitter();
const eventTypes = {
    GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
    WORLD_INFO_ACTIVATED: 'world_info_activated', WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', MESSAGE_RECEIVED: 'message_received',
    CHAT_CHANGED: 'chat_changed',
};
const ctx = {
    eventSource, eventTypes, extensionPrompts: prompts, setExtensionPrompt, chat: [], chatMetadata: {}, extensionSettings: {},
    saveSettingsDebounced() {}, saveMetadataDebounced() {},
};
globalThis.SillyTavern = { getContext: () => ctx };

const core = ['!fullsheet', '!quicksheet', '!tagsheet'].map((key, uid) => ({ uid, world: 'BunnyMo', key: [key], comment: 'sheet', content: 'x' }));
const archive = { uid: 9, world: 'Архив', key: ['Аня'], content: '<BunnymoTags><Name:Аня>, <JEALOUSY:POSSESSIVE>, <TRAIT:CLINGY></BunnymoTags>' };
const tavern = { uid: 20, world: 'Мир', key: ['таверна'], content: 'Таверна.' };

/**
 * Генерация как в ST: GENERATION_STARTED → перехватчики → слот QUIET_PROMPT → сканирование лорбуков →
 * WORLD_INFO_ACTIVATED (не в пробной сборке и только если что-то сработало) → сборка промпта → GENERATION_ENDED.
 */
async function generate(type, { quietPrompt, activated = [], interceptor } = {}, dryRun = false) {
    await eventSource.emit(eventTypes.GENERATION_STARTED, type, { quiet_prompt: quietPrompt }, dryRun);
    if (!dryRun && interceptor) await interceptor();
    setExtensionPrompt('QUIET_PROMPT', quietPrompt ?? '', 0, 0, true);
    await eventSource.emit(eventTypes.WORLDINFO_ENTRIES_LOADED, { globalLore: [...core, archive, tavern], characterLore: [], chatLore: [], personaLore: [] });
    const scanned = [];
    for (const key of Object.keys(prompts)) if (prompts[key].scan) scanned.push(await promptByName(key));
    if (!dryRun && activated.length) await eventSource.emit(eventTypes.WORLD_INFO_ACTIVATED, activated);
    setExtensionPrompt('QUIET_PROMPT', '', 0, 0, true);
    const sent = await inChatPrompts();
    if (!dryRun) await eventSource.emit(eventTypes.GENERATION_ENDED, 0);
    return { lock: sent.includes('Язык ролевой игры'), sceneTags: scanned.some((text) => text.includes('<JEALOUSY:POSSESSIVE>')) };
}

// CarrotKernel пишет вставку тегов в своём обработчике WORLD_INFO_ACTIVATED (обычная подписка, при своём запуске).
const ck = (entries) => {
    if (entries.some((entry) => entry.world === 'Архив' || entry.ck)) setExtensionPrompt('script_inject_carrot-consistency', 'Аня: POSSESSIVE', IN_CHAT, 4, true);
};
eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, ck);
eventSource.on(eventTypes.GENERATION_ENDED, () => setExtensionPrompt('script_inject_carrot-consistency', '', IN_CHAT, 4, true));

const { default: bunnymo } = await import('../src/modules/bunnymo.js');
bunnymo.enable({ des: null });

test('the lock is in ordinary generations with BunnyMo, and only while they run', async () => {
    assert.equal(prompts.desru_bunnymo_language.value, '', 'nothing before the first generation');
    assert.deepEqual(await generate('normal', { activated: [core[0], archive] }), { lock: true, sceneTags: false });
    assert.equal(prompts.desru_bunnymo_language.value, '', 'cleared after GENERATION_ENDED');
    assert.deepEqual(ctx.chatMetadata.desru_bunnymo.tags, ['<JEALOUSY:POSSESSIVE>', '<TRAIT:CLINGY>']);
    assert.deepEqual(await generate('normal', { activated: [tavern] }), { lock: false, sceneTags: true }, 'no BunnyMo, no CK: no lock');
    assert.deepEqual(await generate('normal', { activated: [{ ...tavern, ck: true }] }), { lock: true, sceneTags: true }, 'CK inserts only');
});

test('quiet generations and dry runs get neither the lock nor the scene tags', async () => {
    assert.deepEqual(await generate('quiet', { quietPrompt: 'Describe the scene as SD tags', activated: [core[0], archive] }), { lock: false, sceneTags: false });
    assert.deepEqual(await generate('quiet', { activated: [core[0]] }), { lock: false, sceneTags: false });
    assert.deepEqual(await generate('normal', { activated: [core[0]] }, true), { lock: false, sceneTags: false });
});

test('a quiet generation nested in an ordinary one does not take its lock', async () => {
    let nested = null;
    const outer = await generate('normal', {
        activated: [core[0]],
        interceptor: async () => {
            nested = await generate('quiet', { quietPrompt: 'Think step by step', activated: [core[0]] });
        },
    });
    assert.deepEqual(nested, { lock: false, sceneTags: false });
    assert.deepEqual(outer, { lock: true, sceneTags: true });
});

test('the lock sees CK inserts even when CK subscribed after the module', async () => {
    eventSource.removeListener(eventTypes.WORLD_INFO_ACTIVATED, ck);
    eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, ck);
    assert.equal((await generate('normal', { activated: [{ ...tavern, ck: true }] })).lock, true);
});

test('a stopped generation and a chat change clear the lock', async () => {
    setExtensionPrompt('desru_bunnymo_language', 'stale', IN_CHAT, 0);
    await eventSource.emit(eventTypes.GENERATION_STOPPED);
    assert.equal(prompts.desru_bunnymo_language.value, '');
    setExtensionPrompt('desru_bunnymo_language', 'stale', IN_CHAT, 0);
    await eventSource.emit(eventTypes.CHAT_CHANGED);
    assert.equal(prompts.desru_bunnymo_language.value, '');
});

test('the option and the module switch the lock off', async () => {
    ctx.extensionSettings.desru.modules.bunnymo.languageLock = false;
    assert.equal((await generate('normal', { activated: [core[0]] })).lock, false);
    ctx.extensionSettings.desru.modules.bunnymo.languageLock = true;
    bunnymo.disable();
    assert.deepEqual(await generate('normal', { activated: [core[0], archive] }), { lock: false, sceneTags: false });
});
