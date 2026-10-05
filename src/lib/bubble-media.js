// Картинки в пузырях чата DES. Чистая функция над HTML-строкой, без DOM.
//
// DES режет отрисованный текст сообщения на блоки (<p>, <br>, <div>, переводы строк) и выбрасывает блок, в котором
// после stripHtml(…).trim() не осталось текста (chatBubbles.js: getTopLevelBlocks → flushPending,
// parseBlockIntoSegments). Абзац из одной картинки текста не имеет — и пропадает из пузырей вместе с картинкой.
//
// Лечим отображение, а не сообщение: в готовом HTML (хук messageFormatter ST, стадия afterMarkdown) после каждой
// картинки ставим скрытую метку с символом U+200B. String.prototype.trim() его не снимает (это не пробел, а символ
// формата), поэтому DES видит в блоке текст и оставляет его вместе с картинкой. Атрибут hidden — чтобы метка
// не заняла строку: под картинкой с display:block пустой строки не появится.

const ZWSP = String.fromCharCode(0x200b);

/** Атрибут метки: по нему её можно найти в DOM (классы в сообщениях ST переименовывает в custom-…). */
export const MEDIA_MARK_ATTR = 'data-desru-media';

/** Метка после картинки: невидимая, но с текстом для DES. */
export const MEDIA_MARK = `<span ${MEDIA_MARK_ATTR} hidden>${ZWSP}</span>`;

/** Одиночные теги-картинки: метка сразу после тега. */
const VOID_MEDIA = new Set(['img']);

/** Медиа-контейнеры: метка после закрывающего тега, внутри (source, image у svg) — ничего. */
const BOX_MEDIA = new Set(['picture', 'video', 'audio', 'svg', 'canvas']);

/** Код и сырой текст: внутри ничего не трогаем. */
const RAW = new Set(['pre', 'code', 'script', 'style', 'textarea', 'template']);

/**
 * Картинки NAI Studio: заглушки `[nai:img:…]` после её хука, маркеры `<img data-nai=…>`, картинки для виджетов
 * (`#naist:` в адресе). Их раскладкой и группировкой занимается NAI Studio — не трогаем.
 */
const NAI_STUDIO = /\bdata-nai|#naist/i;

/** Быстрый отсев: в большинстве сообщений картинок нет. */
const HAS_MEDIA = /<(?:img|picture|video|audio|svg|canvas)\b/i;

/** Комментарий или тег; значения атрибутов в кавычках могут содержать `>`. */
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/**
 * Ставит {@link MEDIA_MARK} после каждой картинки, видео, аудио, svg и canvas вне кода, чтобы пузыри DES не
 * выбрасывали блоки без текста. Текст и разметка вокруг не меняются; повторный вызов ничего не добавляет.
 * @param {string} html готовый HTML сообщения (после Markdown, до DOMPurify)
 * @returns {string}
 */
export function markMediaForBubbles(html) {
    if (typeof html !== 'string' || !HAS_MEDIA.test(html)) return html;
    /** @type {string[]} открытые теги кода */
    const raws = [];
    /** @type {string[]} открытые медиа-контейнеры */
    const boxes = [];
    let out = '';
    let last = 0;

    /** @param {number} end позиция сразу после тега */
    const mark = (end) => {
        if (html.startsWith(MEDIA_MARK, end)) return;
        out += html.slice(last, end) + MEDIA_MARK;
        last = end;
    };
    /** @param {string[]} stack @param {string} name */
    const close = (stack, name) => {
        stack.length = stack.lastIndexOf(name);
    };

    for (const match of html.matchAll(TAG)) {
        const [whole, slash, rawName, attrs = ''] = match;
        if (!rawName) continue;
        const name = rawName.toLowerCase();
        const end = /** @type {number} */ (match.index) + whole.length;
        const selfClosing = /\/\s*$/.test(attrs);

        if (raws.length) {
            if (slash && raws.includes(name)) close(raws, name);
            else if (!slash && !selfClosing && RAW.has(name)) raws.push(name);
            continue;
        }
        if (RAW.has(name)) {
            if (!slash && !selfClosing) raws.push(name);
            continue;
        }
        if (BOX_MEDIA.has(name)) {
            if (!slash && !selfClosing) {
                boxes.push(name);
            } else if (!slash) {
                if (!boxes.length) mark(end);
            } else if (boxes.includes(name)) {
                close(boxes, name);
                if (!boxes.length) mark(end);
            }
            continue;
        }
        if (boxes.length || slash || !VOID_MEDIA.has(name) || NAI_STUDIO.test(attrs)) continue;
        mark(end);
    }
    return last ? out + html.slice(last) : html;
}
