// Пресеты трекера DES остаются у своей карточки (модуль 4, переключатель «Пресет трекера — у своей карточки»).
//
// DES привязывает пресет к карточке ключом `char_<номер>`, а номер сдвигается, когда карточки добавляют, удаляют или
// ST перечитывает список. Надстройка держит свою карту «аватар → пресет» (settings.modules.fixes.presetBindings) и
// сверяет с ней привязки DES (src/lib/tracker-bindings.js):
// - при запуске и после каждой перезагрузки списка карточек (CHARACTER_PAGE_LOADED — ST шлёт его и после
//   getCharacters), удаления и переименования карточки;
// - первой на CHAT_CHANGED — до того, как DES по привязке выберет пресет для открытого чата;
// - сразу после «Save» в редакторе трекера DES (его событие dooms:tracker-config-saved) — так привязка, которую
//   пользователь сделал в DES, попадает в карту с той карточкой, для которой он её делал.
// Сохраняется через saveSettings DES (его настройки и наши уходят одним сохранением ST).

import { getContext } from './st.js';
import { log } from './log.js';
import { DES_KEYS, desCharEntityKey } from './des-adapter.js';
import { avatarsOf, cleanSeen, cleanShadow, rekeyAssociations, renameAvatar } from './lib/tracker-bindings.js';

/**
 * @typedef {{ byAvatar: Record<string, string>, seen: Record<string, import('./lib/tracker-bindings.js').SeenKey> }} BindingStore
 *
 * @typedef {object} BindingDeps
 * @property {() => import('./des-adapter.js').DesApi|null} des живой DES, пока гард разрешает работу с данными
 * @property {() => BindingStore} store живой объект в настройках надстройки
 * @property {() => void} saveOwn сохранить настройки надстройки
 */

/**
 * @typedef {object} PresetBindings
 * @property {(options?: SyncOptions) => import('./lib/tracker-bindings.js').RekeyReport|null} sync
 * @property {(avatar: string) => string|null} get
 * @property {(avatar: string, presetId: string|null) => { ok: true } | { ok: false, error: string }} set
 * @property {() => number} count число карточек с привязкой
 */

/** @type {{ deps: BindingDeps, snapshot: (string|null)[]|null, off: (() => void)[], api: PresetBindings }|null} */
let running = null;

/** Работающая привязка по аватару или `null` (переключатель выключен, модуль 4 остановлен). */
export function presetBindings() {
    return running?.api ?? null;
}

/** @param {(string|null)[]} avatars @param {string} avatar */
function cardName(avatars, avatar) {
    const index = avatars.indexOf(avatar);
    const name = index >= 0 ? getContext().characters?.[index]?.name : null;
    return typeof name === 'string' && name ? `«${name}»` : avatar;
}

/** Ключ привязки открытой карточки (не группы) или `null`. */
function currentCharKey() {
    const ctx = getContext();
    if (ctx.groupId) return null;
    const id = ctx.characterId;
    if (id === undefined || id === null || id === '') return null;
    const index = Number(id);
    return Number.isInteger(index) && index >= 0 ? desCharEntityKey(index) : null;
}

/**
 * @typedef {{ changesNow?: boolean, applyCurrent?: boolean, reason?: string }} SyncOptions
 * `changesNow` — DES только что записал свой ключ (номера карточек — нынешние), иначе изменения DES считаются
 * сделанными при списке прошлой сверки. `applyCurrent` — если привязка открытой карточки изменилась, DES выбирает
 * её пресет заново: при запуске (чат мог открыться раньше сверки, и DES выбрал по старому ключу) и после привязки
 * через API. На обычных сверках не нужно: открытой карточке DES уже выбрал пресет по верному ключу, а ручной выбор
 * пресета в редакторе трекера трогать нельзя.
 */

/**
 * Сверить привязки DES с картой по аватару и записать итог.
 * @param {NonNullable<typeof running>} state
 * @param {SyncOptions} [options]
 * @returns {import('./lib/tracker-bindings.js').RekeyReport|null} `null` — сверять не с чем (DES или список карточек недоступны)
 */
function syncNow(state, { changesNow = false, applyCurrent = false, reason = '' } = {}) {
    const des = state.deps.des();
    if (!des?.presets.available()) return null;
    const associations = des.presets.associations();
    const newAvatars = avatarsOf(getContext().characters);
    // Пустой список — ST его ещё не загрузил или как раз перечитывает: сверка убрала бы все привязки.
    if (!associations || !newAvatars.length) return null;
    const store = state.deps.store();
    const shadowBefore = cleanShadow(store.byAvatar);
    const seenBefore = cleanSeen(store.seen);
    const presetIds = des.presets.list().map((preset) => preset.id);
    const result = rekeyAssociations({
        associations,
        previous: seenBefore,
        oldAvatars: changesNow ? newAvatars : (state.snapshot ?? newAvatars),
        newAvatars,
        shadow: shadowBefore,
        // Пустой список пресетов у DES не бывает (он сам заводит Default); если он пуст — не снимать по нему привязки.
        presetIds: presetIds.length ? presetIds : null,
    });
    state.snapshot = newAvatars;

    const currentKey = currentCharKey();
    const currentBefore = currentKey ? associations[currentKey] : undefined;
    if (result.changed) {
        for (const key of Object.keys(associations)) {
            if (!(key in result.associations)) delete associations[key];
        }
        Object.assign(associations, result.associations);
    }
    const ownChanged = JSON.stringify(result.shadow) !== JSON.stringify(shadowBefore) || JSON.stringify(result.seen) !== JSON.stringify(seenBefore);
    store.byAvatar = result.shadow;
    store.seen = result.seen;
    if (result.changed) des.presets.save();
    else if (ownChanged) state.deps.saveOwn();

    const { report } = result;
    for (const item of report.captured) {
        log.info(`Пресеты трекера: ${cardName(newAvatars, item.avatar)} привязана к пресету «${presetName(des, item.presetId)}» в DES — запомнил по аватару.`);
    }
    for (const item of report.released) {
        log.info(item.reason === 'preset-gone'
            ? `Пресеты трекера: пресета ${item.presetId} больше нет — привязка ${cardName(newAvatars, item.avatar)} снята.`
            : `Пресеты трекера: привязку ${cardName(newAvatars, item.avatar)} сняли в DES.`);
    }
    const moved = report.moved.filter((item) => item.from);
    if (moved.length) {
        log.info(`Пресеты трекера: номера карточек сдвинулись${reason ? ` (${reason})` : ''} — привязки переставлены: ${moved.map((item) => `${cardName(newAvatars, item.avatar)} ${item.from} → ${item.to}`).join(', ')}.`);
    }
    const foreign = report.dropped.filter((item) => item.reason === 'foreign');
    if (foreign.length) {
        log.info(`Пресеты трекера: убраны старые привязки ${foreign.map((item) => item.key).join(', ')} — они вели к карточкам, которых под этими номерами уже нет.`);
    }

    if (applyCurrent && result.changed && currentKey && result.associations[currentKey] !== currentBefore && !des.presets.editorOpen()) {
        const activeBefore = des.presets.activeId();
        des.presets.applyForCurrent();
        if (des.presets.activeId() !== activeBefore) {
            des.rerender();
            log.info(`Пресеты трекера: у открытой карточки привязка поправлена — DES загрузил пресет «${presetName(des, String(des.presets.activeId()))}».`);
        }
    }
    return report;
}

/** @param {import('./des-adapter.js').DesApi} des @param {string} presetId */
function presetName(des, presetId) {
    return des.presets.list().find((preset) => preset.id === presetId)?.name ?? presetId;
}

/**
 * Включить привязку по аватару: сверка сразу и на событиях ST и DES.
 * @param {BindingDeps} deps
 */
export function startPresetBindings(deps) {
    if (running) return;
    const { eventSource, eventTypes } = getContext();
    /** @type {NonNullable<typeof running>} */
    const state = {
        deps,
        snapshot: null,
        off: [],
        api: /** @type {PresetBindings} */ ({}),
    };
    /** @param {string} label @param {() => void} action */
    const safe = (label, action) => {
        try {
            action();
        } catch (error) {
            log.error(`Пресеты трекера: сбой (${label})`, error);
        }
    };
    /** @param {'on'|'makeFirst'} method @param {string|undefined} event @param {(...args: any[]) => void} handler */
    const listen = (method, event, handler) => {
        if (!event) return;
        const wrapped = (...args) => {
            if (running === state) safe(event, () => handler(...args));
        };
        eventSource[method](event, wrapped);
        state.off.push(() => eventSource.removeListener(event, wrapped));
    };

    state.api = Object.freeze({
        sync: (options) => (running === state ? syncNow(state, options) : null),
        get(avatar) {
            const presetId = cleanShadow(state.deps.store().byAvatar)[avatar];
            return presetId && state.deps.des()?.presets.has(presetId) ? presetId : null;
        },
        set(avatar, presetId) {
            const des = state.deps.des();
            if (!des?.presets.available()) return { ok: false, error: 'unavailable' };
            if (des.presets.editorOpen()) return { ok: false, error: 'editor-open' };
            if (typeof avatar !== 'string' || !avatarsOf(getContext().characters).includes(avatar)) return { ok: false, error: 'no-card' };
            if (presetId !== null && (typeof presetId !== 'string' || !des.presets.has(presetId))) return { ok: false, error: 'not-found' };
            // Сначала догнать то, что изменилось в DES, потом записать своё.
            syncNow(state, { reason: 'привязка через API' });
            const store = state.deps.store();
            const shadow = cleanShadow(store.byAvatar);
            if (presetId === null) delete shadow[avatar];
            else shadow[avatar] = presetId;
            store.byAvatar = shadow;
            state.deps.saveOwn();
            syncNow(state, { applyCurrent: true, reason: 'привязка через API' });
            return { ok: true };
        },
        count: () => Object.keys(cleanShadow(state.deps.store().byAvatar)).length,
    });
    running = state;

    const sync = (reason, changesNow = false) => () => syncNow(state, { reason, changesNow });
    // DES выбирает пресет в своём обработчике CHAT_CHANGED — сверяем раньше него.
    listen('makeFirst', eventTypes.CHAT_CHANGED, sync('смена чата'));
    listen('on', eventTypes.CHARACTER_PAGE_LOADED, sync('список карточек перечитан'));
    listen('on', eventTypes.CHARACTER_DUPLICATED, sync('карточку скопировали'));
    listen('on', eventTypes.CHARACTER_DELETED, (event) => {
        const avatar = event?.character?.avatar;
        const store = state.deps.store();
        const shadow = cleanShadow(store.byAvatar);
        if (typeof avatar === 'string' && shadow[avatar]) {
            delete shadow[avatar];
            store.byAvatar = shadow;
            log.info(`Пресеты трекера: карточку ${avatar} удалили — её привязка снята.`);
        }
        syncNow(state, { reason: 'карточку удалили' });
    });
    listen('on', eventTypes.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        const store = state.deps.store();
        const moved = { shadow: cleanShadow(store.byAvatar), seen: cleanSeen(store.seen) };
        if (!renameAvatar(moved, oldAvatar, newAvatar)) return;
        store.byAvatar = moved.shadow;
        store.seen = moved.seen;
        if (state.snapshot) state.snapshot = state.snapshot.map((avatar) => (avatar === oldAvatar ? newAvatar : avatar));
        state.deps.saveOwn();
        // Список ST перечитает следом — тогда и сверка (CHARACTER_PAGE_LOADED).
    });
    // Привязку, сделанную в редакторе трекера DES, запомнить с карточкой, для которой её сделали: номера — нынешние.
    if (typeof window !== 'undefined') {
        const onSaved = () => {
            if (running === state) safe(DES_KEYS.trackerConfigSavedEvent, () => syncNow(state, { changesNow: true, reason: 'редактор трекера' }));
        };
        window.addEventListener(DES_KEYS.trackerConfigSavedEvent, onSaved);
        state.off.push(() => window.removeEventListener(DES_KEYS.trackerConfigSavedEvent, onSaved));
    }
    safe('запуск', () => syncNow(state, { applyCurrent: true, reason: 'запуск' }));
}

/** Выключить привязку по аватару. Карта по аватару остаётся в настройках до следующего включения. */
export function stopPresetBindings() {
    if (!running) return;
    for (const off of running.off) {
        try {
            off();
        } catch {
            // Отписка не должна мешать остальным.
        }
    }
    running = null;
}
