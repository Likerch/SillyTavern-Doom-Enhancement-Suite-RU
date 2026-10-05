// Настоящий код пузырей DES в тестах. Код DES в репозиторий не входит (README), поэтому модуль
// src/systems/rendering/chatBubbles.js берётся из локального клона DES только для чтения (vendor/des, см.
// docs/guide/development.md) или из папки в DESRU_DES_DIR. Его импорты (ST и другие модули DES) заменяются
// заглушками, а DOM — маленьким DOM из mini-dom.js; сам текст функций DES не меняется. Нет клона — тесты,
// которым нужен DES, пропускаются.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MiniElement, MiniNode, miniDocument } from './mini-dom.js';

const BUBBLES_PATH = 'src/systems/rendering/chatBubbles.js';
const DEFAULT_DES_DIR = fileURLToPath(new URL('../../vendor/des/', import.meta.url));

/** Путь к chatBubbles.js или `null`, если клона DES нет. */
export function desBubblesFile() {
    const dir = process.env.DESRU_DES_DIR || DEFAULT_DES_DIR;
    const file = `${dir.replace(/[\\/]+$/, '')}/${BUBBLES_PATH}`;
    return existsSync(file) ? file : null;
}

/** HTML-экранирование, как в src/utils/html.js DES (escapeHtml). @param {unknown} value */
function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Загружает модуль пузырей DES поверх заглушек: в чате нет персонажей и цветов — вся реплика рассказчика,
 * как в приветствии новой карточки.
 * @param {{ chatBubbleSettings?: Record<string, unknown> }} [settings] extensionSettings DES
 * @returns {Record<string, any>|null} экспорты chatBubbles.js или `null`, если клона DES нет
 */
export function loadDesBubbles(settings = {}) {
    const file = desBubblesFile();
    if (!file) return null;
    const exported = [];
    const body = readFileSync(file, 'utf8')
        .replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?[ \t]*$/gm, '')
        .replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (_whole, kind, name) => {
            exported.push(name);
            return `${kind} ${name}`;
        });
    const stubs = {
        extensionSettings: { chatBubbleSettings: {}, ...settings },
        getActiveCharacterColors: () => ({}),
        getActiveKnownCharacters: () => ({}),
        saveCharacterRosterChange: () => {},
        resolvePortrait: () => null,
        resolveFullPortrait: () => null,
        getCharacterList: () => [],
        hexToRgb: () => null,
        executeSlashCommandsOnChatInput: async () => {},
        chat: [],
        isSyntheticTrackerMessage: () => false,
        escapeHtml,
        parseTrackerJson: () => null,
        document: miniDocument,
        Node: MiniNode,
    };
    const factory = new Function(...Object.keys(stubs), `${body}\nreturn { ${exported.join(', ')} };`);
    return factory(...Object.values(stubs));
}

/**
 * Сообщение модели в чате: `.mes` с `.mes_text`, в который ST вставил готовый HTML.
 * @param {string} html
 */
export function messageElement(html) {
    const mes = new MiniElement('div');
    mes.setAttribute('class', 'mes');
    mes.setAttribute('is_user', 'false');
    const text = new MiniElement('div');
    text.setAttribute('class', 'mes_text');
    text.innerHTML = html;
    mes.appendChild(text);
    return { mes, text };
}
