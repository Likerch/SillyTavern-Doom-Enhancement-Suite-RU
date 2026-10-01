// Панель надстройки в Extensions: статус DES и гарда, переключатели модулей, журнал.
// Разметка — settings.html, здесь только привязка и отрисовка состояния.

import { ADDON_NAME, getContext } from './st.js';
import { formatEntries, log, stringifyDetails } from './log.js';

const LOG_LINES_SHOWN = 200;

const BADGES = {
    ok: ['работает', 'desru-tone-on'],
    partial: ['частично', 'desru-tone-warn'],
    mismatch: ['DES изменился', 'desru-tone-warn'],
    inactive: ['DES выключен', 'desru-tone-off'],
    absent: ['нет DES', 'desru-tone-off'],
    'st-disabled': ['DES выключен', 'desru-tone-off'],
    'not-loaded': ['DES не загрузился', 'desru-tone-error'],
    error: ['ошибка', 'desru-tone-error'],
};

/**
 * @param {object} options
 * @param {import('./core.js').AddonModule[]} options.modules
 * @param {ReturnType<typeof import('./settings.js').getSettings>} options.settings
 * @param {(id: string, enabled: boolean) => void} options.onModuleToggle
 * @param {(enabled: boolean) => void} options.onDebugToggle
 * @param {() => void} options.onRecheck
 */
export async function mountPanel({ modules, settings, onModuleToggle, onDebugToggle, onRecheck }) {
    if (!ADDON_NAME) throw new Error('не удалось определить папку надстройки по её адресу');
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) throw new Error('нет контейнера настроек расширений ST');

    const html = await getContext().renderExtensionTemplateAsync(ADDON_NAME, 'settings');
    host.insertAdjacentHTML('beforeend', html);
    const root = host.querySelector('#desru-settings');
    if (!root) throw new Error('в шаблоне панели нет #desru-settings');

    /** @param {string} name */
    const part = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-desru="${name}"]`));

    const moduleRows = new Map();
    for (const module of modules) {
        const row = document.createElement('div');
        row.className = 'desru-module';
        row.innerHTML = '<label class="checkbox_label"><input type="checkbox"><span class="desru-module-title"></span></label>'
            + '<span class="desru-module-state"></span><small class="desru-module-desc"></small>';
        row.querySelector('.desru-module-title').textContent = `${module.number}. ${module.title}`;
        row.querySelector('.desru-module-desc').textContent = module.description;
        const checkbox = /** @type {HTMLInputElement} */ (row.querySelector('input'));
        checkbox.checked = settings.modules[module.id]?.enabled !== false;
        checkbox.addEventListener('change', () => onModuleToggle(module.id, checkbox.checked));
        part('modules').append(row);
        moduleRows.set(module.id, row);
    }

    part('recheck').addEventListener('click', () => onRecheck());

    const debug = /** @type {HTMLInputElement} */ (part('debug'));
    debug.checked = Boolean(settings.debug);
    debug.addEventListener('change', () => onDebugToggle(debug.checked));

    const logSection = /** @type {HTMLDetailsElement} */ (part('log-section'));
    const logView = part('log');
    const renderLog = () => {
        if (!logSection.open) return;
        logView.textContent = log.entries().slice(-LOG_LINES_SHOWN).map(formatLine).join('\n');
        logView.scrollTop = logView.scrollHeight;
    };
    logSection.addEventListener('toggle', renderLog);
    log.subscribe(renderLog);
    part('copy-log').addEventListener('click', () => copyLog());
    part('clear-log').addEventListener('click', () => log.clear());

    return {
        /**
         * @param {object} view
         * @param {boolean} view.checking
         * @param {import('./des-adapter.js').DesFacts|null} view.facts
         * @param {import('./guard.js').GuardVerdict|null} view.verdict
         * @param {{ id: string, status: { text: string, tone: string } }[]} view.modules
         * @param {string} view.version
         * @param {string} view.verifiedCommit
         * @param {readonly string[]} view.verifiedVersions
         */
        render(view) {
            const [badgeText, badgeTone] = view.checking
                ? ['проверяю…', 'desru-tone-wait']
                : BADGES[view.verdict?.state ?? 'error'] ?? BADGES.error;
            const badge = part('badge');
            badge.textContent = badgeText;
            badge.className = `desru-badge ${badgeTone}`;
            part('summary').textContent = view.checking ? 'Жду, пока DES закончит инициализацию.' : view.verdict?.summary ?? '';
            part('des-name').textContent = view.facts?.name ? `${view.facts.name}${view.facts.version ? ` · v${view.facts.version}` : ''}` : '';

            fillList(part('problems'), view.checking ? [] : view.verdict?.problems ?? []);
            fillList(part('notes'), view.checking ? [] : view.verdict?.notes ?? []);

            for (const { id, status } of view.modules) {
                const state = moduleRows.get(id)?.querySelector('.desru-module-state');
                if (!state) continue;
                state.textContent = status.text;
                state.className = `desru-module-state desru-tone-${status.tone}`;
            }
            part('footer').textContent = `Надстройка v${view.version} · проверено на DES ${view.verifiedVersions.join(', ')} (${view.verifiedCommit}) · не форк DES`;
        },
    };
}

/**
 * @param {HTMLElement} list
 * @param {string[]} items
 */
function fillList(list, items) {
    list.replaceChildren(...items.map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
    }));
    list.hidden = items.length === 0;
}

/** @param {import('./log.js').LogEntry} entry */
function formatLine(entry) {
    const time = entry.time.toLocaleTimeString('ru-RU', { hour12: false });
    const details = entry.details === undefined ? '' : ` | ${stringifyDetails(entry.details)}`;
    return `${time} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}${details}`;
}

async function copyLog() {
    const text = formatEntries(log.entries()) || '(журнал пуст)';
    try {
        await navigator.clipboard.writeText(text);
        toastr.success('Журнал скопирован', 'DES — RU');
    } catch {
        // Без защищённого контекста clipboard недоступен — копируем через выделение.
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        const copied = document.execCommand('copy');
        area.remove();
        if (copied) toastr.success('Журнал скопирован', 'DES — RU');
        else toastr.error('Не удалось скопировать журнал', 'DES — RU');
    }
}
