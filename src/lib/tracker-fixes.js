// Правки JSON-строк трекера DES. Чистые функции: на входе и выходе — строки в формате DES.

/** @param {string} json */
function parse(json) {
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/**
 * Помечает персонажей, чьи мысли по-русски говорят «не в сцене», пометкой, которую понимает DES.
 * @param {string} json characterThoughts DES: массив персонажей или `{ characters: [...] }`
 * @param {{ marker: string, find: (text: string) => string|null, alreadyMarked: (text: string) => boolean }} rules
 * @returns {{ text: string, marked: { name: string, phrase: string }[] }}
 */
export function markOffScene(json, rules) {
    const parsed = parse(json);
    const characters = Array.isArray(parsed) ? parsed : parsed?.characters;
    if (!Array.isArray(characters)) return { text: json, marked: [] };

    const marked = [];
    for (const character of characters) {
        if (!character || typeof character !== 'object') continue;
        const { thoughts } = character;
        const content = typeof thoughts === 'string' ? thoughts : thoughts?.content;
        if (typeof content !== 'string' || !content || rules.alreadyMarked(content)) continue;
        const phrase = rules.find(content);
        if (!phrase) continue;
        const next = `${content.trimEnd()} ${rules.marker}`;
        if (typeof thoughts === 'string') character.thoughts = next;
        else thoughts.content = next;
        marked.push({ name: String(character.name ?? '?'), phrase });
    }
    return marked.length ? { text: JSON.stringify(parsed, null, 2), marked } : { text: json, marked };
}

/**
 * Название квеста в любом из форматов DES: строка, `{ title }` или `{ value }`.
 * @param {unknown} quest
 * @returns {string|null}
 */
function questTitle(quest) {
    if (typeof quest === 'string') return quest;
    if (quest && typeof quest === 'object') {
        if (typeof quest.title === 'string') return quest.title;
        if (typeof quest.value === 'string') return quest.value;
    }
    return null;
}

/**
 * @param {unknown} quest
 * @param {string} none
 */
function withTitle(quest, none) {
    if (typeof quest === 'string') return none;
    if (typeof quest.title === 'string') return { ...quest, title: none };
    return { ...quest, value: none };
}

/**
 * Заменяет русское «квеста нет» служебным значением DES; такие побочные квесты убирает.
 * @param {string} json quests DES: `{ main, optional: [] }`
 * @param {{ none: string, isNone: (text: string) => boolean }} rules
 * @returns {{ text: string, changed: string[] }}
 */
export function normalizeNoQuest(json, rules) {
    const parsed = parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: json, changed: [] };

    const changed = [];
    const mainTitle = questTitle(parsed.main);
    if (mainTitle !== null && mainTitle !== rules.none && rules.isNone(mainTitle)) {
        parsed.main = withTitle(parsed.main, rules.none);
        changed.push(mainTitle);
    }
    if (Array.isArray(parsed.optional)) {
        parsed.optional = parsed.optional.filter((quest) => {
            const title = questTitle(quest);
            if (title === null || !rules.isNone(title)) return true;
            changed.push(title);
            return false;
        });
    }
    return changed.length ? { text: JSON.stringify(parsed, null, 2), changed } : { text: json, changed };
}
