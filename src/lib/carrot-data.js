// Данные CarrotKernel без DOM: сравнение имён персонажей и его блок тегов в ответах.

/**
 * Ключ имени для сравнения: регистр, ё, пробелы и знаки не важны, буквы любого алфавита сохраняются.
 * CK сравнивает через `[^\w\s]` и `[^a-zA-Z0-9\s]`, и любое кириллическое имя у него становится пустой строкой.
 * @param {unknown} name
 */
export function characterNameKey(name) {
    return String(name ?? '').normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

/**
 * Персонаж из `scannedCharacters` CK (ключ «лорбук::имя» → { name, tags: Map, source, uid }).
 * Сначала точное имя, потом ключ имени; среди одноимённых — из лорбука, который сработал сейчас.
 * @param {Iterable<[string, any]>} entries
 * @param {string} name
 * @param {ReadonlySet<string>} [activeSources] лорбуки записей, сработавших в этом сканировании
 * @returns {{ name: string, data: any }|null}
 */
export function findCharacter(entries, name, activeSources = new Set()) {
    if (!name) return null;
    const wanted = characterNameKey(name);
    if (!wanted) return null;
    /** @type {{ name: string, data: any, exact: boolean, active: boolean }[]} */
    const found = [];
    for (const [cacheKey, data] of entries) {
        const stored = String(data?.name || String(cacheKey).split('::')[1] || cacheKey);
        if (characterNameKey(stored) !== wanted) continue;
        found.push({ name: stored, data, exact: stored === name, active: activeSources.has(data?.source) });
    }
    if (!found.length) return null;
    const rank = (item) => (item.exact ? 2 : 0) + (item.active ? 1 : 0);
    const best = found.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    return { name: best.name, data: best.data };
}

/**
 * Блок, который CK в режиме показа «thinking» дописывает к ответу модели:
 * `<BunnyMoTags>` и внутри «Имя:» плюс строки «• КАТЕГОРИЯ: значения».
 * Лист BunnyMo выглядит иначе — внутри теги <KEY:VALUE>, — и его не трогаем.
 */
const DUMP_BLOCK_RE = /(\n[ \t]*)*<BunnyMoTags>\n?([\s\S]*?)<\/BunnyMoTags>/g;

/**
 * Тело блока — дамп CK: только строки «Имя:» и «• КАТЕГОРИЯ: значения» (категорий может и не быть —
 * CK пропускает теги, сохранённые массивом), без тегов <KEY:VALUE>.
 * @param {string} body
 */
export function isCarrotDumpBody(body) {
    const lines = String(body ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length || /<[A-Za-z][A-Za-z0-9_]*:/.test(body)) return false;
    return lines.every((line) => line.startsWith('•') || line.endsWith(':'));
}

/**
 * Тела всех дампов CK в сообщениях чата (без обёртки, обрезанные): чтобы найти их в промпте и тогда,
 * когда регулярка ST уже срезала с них теги <BunnyMoTags>.
 * @param {readonly { mes?: unknown }[]} chat
 * @returns {string[]}
 */
export function carrotDumpBodies(chat) {
    const bodies = new Set();
    for (const message of Array.isArray(chat) ? chat : []) {
        if (typeof message?.mes !== 'string' || !message.mes.includes('<BunnyMoTags>')) continue;
        for (const match of message.mes.matchAll(DUMP_BLOCK_RE)) {
            if (isCarrotDumpBody(match[2]) && match[2].trim()) bodies.add(match[2].trim());
        }
    }
    return [...bodies];
}

/**
 * Текст сообщения из промпта без дампа CK в конце — и с обёрткой, и без неё (её могла срезать
 * регулярка «убрать HTML из промпта»: тогда от дампа остаются голые строки «Имя:» и «• …»).
 * @param {string} text
 * @param {readonly string[]} bodies тела дампов из carrotDumpBodies
 * @returns {{ text: string, removed: number }}
 */
export function stripCarrotDumpsFromPrompt(text, bodies) {
    const wrapped = stripCarrotDumps(text);
    let result = wrapped.text;
    let removed = wrapped.removed;
    for (const body of bodies) {
        const trimmed = result.replace(/\s+$/, '');
        if (!trimmed.endsWith(body)) continue;
        result = trimmed.slice(0, trimmed.length - body.length).replace(/\s+$/, '');
        removed += 1;
    }
    return { text: removed ? result : text, removed };
}

/**
 * Текст без блоков тегов CK.
 * @param {string} text
 * @returns {{ text: string, removed: number }}
 */
export function stripCarrotDumps(text) {
    if (typeof text !== 'string' || !text.includes('<BunnyMoTags>')) return { text, removed: 0 };
    let removed = 0;
    const result = text.replace(DUMP_BLOCK_RE, (whole, _spacing, body) => {
        if (!isCarrotDumpBody(body)) return whole;
        removed += 1;
        return '';
    });
    return { text: removed ? result : text, removed };
}
