// Ядро надстройки: дожидается ST и DES, запускает версионный гард и включает модули,
// которые разрешены и гардом, и пользователем. Каждый шаг обёрнут: надстройка может
// деградировать, но не может сломать SillyTavern.

import { ADDON_NAME, getContext, notify, onAppReady } from './st.js';
import { log } from './log.js';
import { getSettings, saveSettings } from './settings.js';
import { DES_INFO, checkTemplate, inspectDes, onDesToggle, onTemplateInserted } from './des-adapter.js';
import { evaluateGuard } from './guard.js';
import { mountPanel } from './panel.js';
import localization from './modules/localization.js';
import names from './modules/names.js';
import serviceValues from './modules/service-values.js';
import fixes from './modules/fixes.js';
import bunnymo from './modules/bunnymo.js';
import carrotKernel from './modules/carrot-kernel.js';

/**
 * @typedef {object} AddonEnv то, что получает модуль при включении
 * @property {import('./des-adapter.js').DesApi|null} des доступ к живому DES (только если гард пропустил данные)
 * @property {import('./guard.js').GuardVerdict} verdict
 * @property {ReturnType<typeof getSettings>} settings
 *
 * @typedef {object} AddonModule
 * @property {string} id ключ в settings.modules
 * @property {number} number номер модуля из ТЗ
 * @property {string} title
 * @property {string} description
 * @property {{ ui: boolean, data: boolean }} needs что модуль требует от гарда
 * @property {boolean} [stub] логика ещё не реализована
 * @property {{ key: string, title: string, description: string }[]} [options] переключатели внутри модуля
 *           (settings.modules[id][key]); модуль читает их на лету, перезапуск не нужен
 * @property {() => void|Promise<void>} [preload] ранний шаг при загрузке надстройки, до APP_READY и гарда:
 *           для того, что должно успеть раньше первых вычислений DES. Сам проверяет, что DES на месте;
 *           если гард потом модуль не пустит, ядро вызовет disable
 * @property {(env: AddonEnv) => void|Promise<void>} enable
 * @property {() => void|Promise<void>} disable
 * @property {(key: string, enabled: boolean) => void} [onOptionChange] переключатель внутри работающего модуля
 * @property {() => { level: 'info'|'warn', text: string }[]} [notes] замечания для панели, пока модуль работает
 * @property {() => { text: string, tone: 'on'|'off'|'wait'|'blocked' }|null} [status] своё состояние вместо «работает»
 *           (например, модуль включён, но его расширения нет)
 * @property {string} [section] свой раздел панели: `[data-desru-section]` в settings.html
 * @property {(section: HTMLElement) => void} [mountSection] рисует этот раздел (один раз, при монтировании панели)
 */

/** @type {AddonModule[]} Порядок — как в панели. */
const MODULES = [localization, names, serviceValues, fixes, bunnymo, carrotKernel];

const DES_INIT_TIMEOUT_MS = 30000;
const RECHECK_TIMEOUT_MS = 5000;

const state = {
    checking: true,
    /** @type {import('./des-adapter.js').DesFacts|null} */
    facts: null,
    /** @type {import('./des-adapter.js').DesApi|null} */
    des: null,
    /** @type {import('./guard.js').GuardVerdict|null} */
    verdict: null,
    /** @type {string[]} */
    templateMissing: [],
    /** @type {Set<string>} */
    running: new Set(),
    /** @type {Set<string>} модули, сделавшие ранний шаг, но ещё не включённые */
    preloaded: new Set(),
    warnedDesUpdated: false,
    lastVerdictKey: '',
};

/** @type {Awaited<ReturnType<typeof mountPanel>>|null} */
let panel = null;
let syncQueue = Promise.resolve();
let recheckTimer = 0;

export async function start() {
    // Скрипт надстройки грузится раньше, чем ST откроет последний чат: ранние шаги успевают до DES.
    const preloading = preloadModules();
    await new Promise((resolve) => onAppReady(resolve));
    await preloading;
    const settings = getSettings();
    log.setDebug(settings.debug);
    log.info(`Запуск надстройки ${getAddonVersion()}`);

    try {
        panel = await mountPanel({
            modules: MODULES,
            settings,
            onModuleToggle,
            onModuleOptionToggle,
            onDebugToggle,
            onRecheck: () => recheck(RECHECK_TIMEOUT_MS),
            onOpen: () => render(),
        });
    } catch (error) {
        log.error('Не удалось показать панель настроек', error);
    }
    render();

    await recheck(DES_INIT_TIMEOUT_MS);

    // Окна DES ленивые: их селекторы можно проверить только когда DES вставит template.html.
    onTemplateInserted(() => {
        state.templateMissing = checkTemplate();
        if (!state.templateMissing.length) log.info('Окна DES на месте: селекторы шаблона совпали.');
        applyVerdict();
    });
    // Переключатель самого DES работает без перезагрузки — перепроверяем после него.
    onDesToggle(() => {
        clearTimeout(recheckTimer);
        recheckTimer = setTimeout(() => recheck(RECHECK_TIMEOUT_MS), 1500);
    });
}

async function preloadModules() {
    let settings;
    try {
        settings = getSettings();
    } catch (error) {
        log.error('Настройки надстройки недоступны при загрузке', error);
        return;
    }
    for (const module of MODULES) {
        if (typeof module.preload !== 'function' || settings.modules[module.id]?.enabled === false) continue;
        try {
            await module.preload();
            state.preloaded.add(module.id);
        } catch (error) {
            log.warn(`Модуль ${module.number} (${module.title}): ранний шаг не удался`, error);
        }
    }
}

function getAddonVersion() {
    try {
        return getContext().getExtensionManifest?.(ADDON_NAME)?.version ?? '?';
    } catch {
        return '?';
    }
}

/** @param {number} timeoutMs сколько ждать инициализации DES */
async function recheck(timeoutMs) {
    state.checking = true;
    render();
    try {
        const { facts, api } = await inspectDes({ timeoutMs });
        state.facts = facts;
        state.des = api;
        state.templateMissing = checkTemplate();
    } catch (error) {
        log.error('Проверка DES завершилась ошибкой', error);
        state.facts = null;
        state.des = null;
    } finally {
        state.checking = false;
    }
    applyVerdict();
}

function applyVerdict() {
    state.verdict = evaluateGuard(state.facts, {
        verifiedVersions: DES_INFO.verifiedVersions,
        templateMissing: state.templateMissing,
    });
    reportVerdict(state.verdict);
    syncModules();
    render();
}

/** @param {import('./guard.js').GuardVerdict} verdict */
function reportVerdict(verdict) {
    const key = JSON.stringify([verdict.state, verdict.problems, verdict.notes]);
    if (key === state.lastVerdictKey) return;
    state.lastVerdictKey = key;

    const level = verdict.state === 'ok' ? 'info' : ['mismatch', 'partial', 'error'].includes(verdict.state) ? 'warn' : 'info';
    log[level](`Гард: ${verdict.summary}`);
    for (const problem of verdict.problems) log.warn(`Гард: ${problem}`);
    for (const note of verdict.notes) log.info(`Гард: ${note}`);

    if (verdict.desUpdated && !state.warnedDesUpdated) {
        state.warnedDesUpdated = true;
        const consequence = verdict.data
            ? 'Перевод части окон может не работать.'
            : 'Модули 2–4 отключены, перевод работает по мере возможности.';
        notify('warning', `DES обновился, нужна проверка селекторов. ${consequence} Подробности — в настройках надстройки.`, { timeOut: 10000 });
    }
}

/**
 * @param {AddonModule} module
 * @param {import('./guard.js').GuardVerdict|null} verdict
 */
function isAllowed(module, verdict) {
    if (!verdict) return false;
    return (!module.needs.ui || verdict.ui) && (!module.needs.data || verdict.data);
}

/** Включает и выключает модули по настройкам и гарду. Вызовы выстраиваются в очередь. */
function syncModules() {
    syncQueue = syncQueue.then(async () => {
        const settings = getSettings();
        for (const module of MODULES) {
            const shouldRun = settings.modules[module.id]?.enabled !== false && isAllowed(module, state.verdict);
            const isRunning = state.running.has(module.id);
            if (shouldRun && !isRunning) {
                try {
                    await module.enable({ des: state.des, verdict: /** @type {import('./guard.js').GuardVerdict} */ (state.verdict), settings });
                    state.running.add(module.id);
                    state.preloaded.delete(module.id);
                } catch (error) {
                    log.error(`Модуль ${module.number} (${module.title}) не запустился`, error);
                }
            } else if (!shouldRun && (isRunning || state.preloaded.has(module.id))) {
                try {
                    await module.disable();
                } catch (error) {
                    log.error(`Модуль ${module.number} (${module.title}) не остановился чисто`, error);
                } finally {
                    state.running.delete(module.id);
                    state.preloaded.delete(module.id);
                }
            }
        }
        render();
    }).catch((error) => log.error('Сбой при переключении модулей', error));
    return syncQueue;
}

/**
 * @param {string} id
 * @param {boolean} enabled
 */
function onModuleToggle(id, enabled) {
    const settings = getSettings();
    settings.modules[id].enabled = enabled;
    saveSettings();
    syncModules();
}

/**
 * @param {string} id
 * @param {string} key
 * @param {boolean} enabled
 */
function onModuleOptionToggle(id, key, enabled) {
    const settings = getSettings();
    settings.modules[id][key] = enabled;
    saveSettings();
    const module = MODULES.find((candidate) => candidate.id === id);
    const title = module?.options?.find((option) => option.key === key)?.title ?? key;
    log.info(`${module ? `Модуль ${module.number}` : id}: «${title}» ${enabled ? 'включено' : 'выключено'}`);
    if (module && state.running.has(id) && typeof module.onOptionChange === 'function') {
        try {
            module.onOptionChange(key, enabled);
        } catch (error) {
            log.error(`Модуль ${module.number}: не удалось применить «${title}»`, error);
        }
    }
    render();
}

/** @param {boolean} enabled */
function onDebugToggle(enabled) {
    const settings = getSettings();
    settings.debug = enabled;
    log.setDebug(enabled);
    saveSettings();
    log.info(enabled ? 'Режим отладки включён' : 'Режим отладки выключен');
}

/**
 * @param {AddonModule} module
 * @returns {{ text: string, tone: 'on'|'off'|'wait'|'blocked' }}
 */
function describeModule(module) {
    const settings = getSettings();
    if (settings.modules[module.id]?.enabled === false) return { text: 'выключен', tone: 'off' };
    if (state.running.has(module.id)) {
        let custom = null;
        try {
            custom = module.status?.() ?? null;
        } catch (error) {
            log.warn(`Модуль ${module.number}: не удалось узнать состояние`, error);
        }
        return custom ?? { text: module.stub ? 'включён (пока заглушка)' : 'работает', tone: 'on' };
    }
    if (state.checking && !state.verdict) return { text: 'ждёт проверки DES', tone: 'wait' };
    if (!state.verdict?.ui) return { text: 'не работает: DES недоступен', tone: 'blocked' };
    if (module.needs.data && !state.verdict.data) return { text: 'остановлен гардом', tone: 'blocked' };
    return { text: 'запускается…', tone: 'wait' };
}

/**
 * @param {AddonModule} module
 * @returns {{ level: 'info'|'warn', text: string }[]}
 */
function moduleNotes(module) {
    if (!state.running.has(module.id) || typeof module.notes !== 'function') return [];
    try {
        return module.notes();
    } catch (error) {
        log.warn(`Модуль ${module.number}: не удалось собрать замечания`, error);
        return [];
    }
}

function render() {
    if (!panel) return;
    try {
        panel.render({
            checking: state.checking,
            facts: state.facts,
            verdict: state.verdict,
            modules: MODULES.map((module) => ({ id: module.id, status: describeModule(module), notes: moduleNotes(module) })),
            version: getAddonVersion(),
            verifiedCommit: DES_INFO.verifiedCommit,
            verifiedVersions: DES_INFO.verifiedVersions,
        });
    } catch (error) {
        log.error('Панель настроек не обновилась', error);
    }
}
