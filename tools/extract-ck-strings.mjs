#!/usr/bin/env node
// Инструмент разработки: вытаскивает строки интерфейса CarrotKernel — текст и атрибуты settings.html, HTML-шаблоны
// в JS (innerHTML, .html(), insertAdjacentHTML…), .text()/textContent, title/placeholder/aria-label, уведомления
// toastr, заголовки окон CK (showCarrotPopup) и попапы ST. `${...}` превращаются в плейсхолдеры словаря ({name});
// тернарники и «||» («${ok ? 'Installed' : 'Install'}») раскрываются в отдельные варианты. HTML разбирается и
// проходится по тем же правилам, что и движок локализации (src/modules/localization.js): текстовые узлы по одному,
// «подсказки» из текста и инлайн-тегов — целиком, как их сериализует браузер (innerHTML: атрибуты в исходном порядке,
// двойные кавычки, <br/> → <br>, < и > в атрибутах — &lt; и &gt;). Литерал, который CK кладёт в элемент целиком,
// тоже может оказаться такой «подсказкой» — поэтому корень фрагмента проверяется наравне с элементами.
//
//   node tools/extract-ck-strings.mjs [путь к CarrotKernel] [--missing locales/ru.carrotkernel.json]
//   node tools/extract-ck-strings.mjs [путь к CarrotKernel] --stale locales/ru.carrotkernel.json
//
// --missing — строки CK, которых нет в словаре. Плейсхолдеры при проверке заменяются числом, так что ключи с {#n}
// и {name} тоже засчитываются; строка «No {tabType} data available» засчитывается и ключами, которые расписывают
// её варианты («No personality data available»).
// --stale — ключи словаря, которые не нашлись в CK: их куски (текст между плейсхолдерами и тегами) не встречаются
// в settings.html и JS, ни одна извлечённая строка ими не переводится и их не собрать из литералов CK по местам
// склейки («Label: значение», «a • b», «a - b»).
// Строки, склеенные из переменных (message += …, текст из таблиц подписей), в --missing видны только кусками —
// вывод надо просматривать глазами. Мёртвый код CK (DEAD_FUNCTIONS, SKIP) не сканируется.
//
// Код CK в репозиторий не попадает: инструмент читает vendor/CarrotKernel (он в .gitignore) и печатает только строки.
import fs from 'node:fs';
import path from 'node:path';
import { createDictionary, looksTranslatable, normalizeText } from '../src/lib/dictionary.js';
import { decodeEntities, findStale, HELPER_IDENTIFIERS, joinParts, placeholderName, printJson, readLiteral, readOptions, sourceVariants } from './lib/source-strings.mjs';

const { root: ckRoot, missing: dictionaryPath, stale: stalePath } = readOptions(process.argv.slice(2), 'vendor/CarrotKernel');

/**
 * Модули CK без интерфейса, мёртвый bunnymo_class.js (его никто не импортирует) и tutorials.js: живые обучения
 * показываются только нативными confirm/alert, а их DOM-оверлей мёртв.
 */
const SKIP = new Set(['bunnymo_class.js', 'carrot-state.js', 'context-manager.js', 'debugger.js', 'sheet-generator.js', 'tutorials.js']);
/**
 * Мёртвые функции CK (их никто не вызывает или их разметка никуда не попадает) — строки из них не выдаём.
 * Ищутся по имени, а не по номерам строк, чтобы список пережил обновление CK.
 */
const DEAD_FUNCTIONS = {
    'index.js': ['populatePackGrids', 'installMainPack', 'installPack', 'updateMainPack', 'updatePack', 'scanForUpdates',
        'updatePackStatus', 'manualScan', 'getTutorialOverlay', 'createTutorialOverlayInModal', 'createTutorialOverlayInDocument',
        'showTutorialOverlay', 'highlightTargetElement', 'addResizeHandler', 'applyViewportSafeguards', 'highlightElement',
        'positionTutorialPopupWithSafeguards', 'positionTutorialPopup', 'addPopupArrow', 'parseBunnymoTags', 'debugModalSizing',
        'generateAvailableLorebooksTab', 'generateActiveLorebooksTab', 'generateAssignmentTab', 'generateSettingsManagement',
        'generateCoreSettingsTab', 'generateDisplaySettingsTab', 'generateAdvancedSettingsTab', 'generateProfileBrowser',
        'generateMyProfilesTab', 'generateRecentActivityTab', 'generateProfileTemplatesTab', 'applyLoadoutChanges',
        'showContextSelectionPopup', 'updatePackListUI', 'vectorizeFullsheetFromMessage'],
    'repository-manager.js': ['updateRepositoryManagerContent', 'updateCharacterCountStats', 'hideGettingStartedSection'],
    'worldbook-tracker.js': ['analyzeTriggerSource', 'classifyTriggerType', 'getMessageSourceIcon'],
    'baby-bunny-mode.js': ['showTutorialBabyBunnyPopup'],
};
/**
 * Узлы-данные, которые не надо выдавать как строки интерфейса. Селекторы простые: tag, .class, #id, [attr], [attr="v"],
 * их сочетания без пробелов и «предок потомок».
 */
const IGNORE = ['.carrot-format-code', '.carrot-slider-icon', '.carrot-tooltip-example code', '#carrot_rag_openai_model', '#carrot_rag_cohere_model',
    '#carrot_rag_google_model', '#carrot_rag_togetherai_model'];
/** Строки чужих библиотек, которые показываются внутри интерфейса CK (select2 в карточках фрагментов): для --stale. */
const EXTERNAL = new Set(['Remove item']);

const HELPERS = [...HELPER_IDENTIFIERS, 'this', 'toUpperCase', 'toLowerCase', 'toLocaleString', 'toString', 'replace', 'slice', 'substring',
    'Math', 'round', 'floor', 'ceil', 'max', 'min', 'escapeHtmlAttr', 'sanitize', 'encodeURIComponent'];

function uiFiles() {
    return fs.readdirSync(ckRoot).filter((name) => name.endsWith('.js') && !SKIP.has(name)).sort();
}

// ─── Мини-разбор HTML ──────────────────────────────────────────────────────

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
/** Блоки, перед которыми браузер закрывает открытый <p>. */
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
/** Теги, которые закрывают такой же открытый тег (<li> внутри <li> и т. п.). */
const SELF_CLOSING_SIBLINGS = new Set(['li', 'option', 'dt', 'dd', 'tr', 'td', 'th']);

/**
 * @typedef {{ type: 'element', tag: string, attrs: [string, string][], children: Node[], offset: number }} Element
 * @typedef {{ type: 'text', value: string, offset: number }} Text
 * @typedef {{ type: 'comment', value: string, offset: number }} Comment
 * @typedef {Element|Text|Comment} Node
 */

/**
 * Разбирает HTML в дерево — достаточно для шаблонов CK. Сущности раскодируются, как это делает браузер.
 * @param {string} html
 * @returns {Element} корень-обёртка (tag '#root')
 */
function parseHtml(html) {
    /** @type {Element} */
    const root = { type: 'element', tag: '#root', attrs: [], children: [], offset: 0 };
    const stack = [root];
    const current = () => stack[stack.length - 1];
    const addText = (value, offset) => {
        const siblings = current().children;
        const last = siblings[siblings.length - 1];
        if (last?.type === 'text') last.value += value;
        else siblings.push({ type: 'text', value, offset });
    };
    let i = 0;
    while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt < 0) {
            addText(decodeEntities(html.slice(i)), i);
            break;
        }
        if (lt > i) addText(decodeEntities(html.slice(i, lt)), i);
        i = lt;
        if (html.startsWith('<!--', i)) {
            const end = html.indexOf('-->', i + 4);
            const stop = end < 0 ? html.length : end;
            current().children.push({ type: 'comment', value: html.slice(i + 4, stop), offset: i });
            i = end < 0 ? html.length : end + 3;
            continue;
        }
        if (html[i + 1] === '!' || html[i + 1] === '?') {
            const end = html.indexOf('>', i);
            i = end < 0 ? html.length : end + 1;
            continue;
        }
        const close = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(html.slice(i, i + 100));
        if (close) {
            const tag = close[1].toLowerCase();
            const index = stack.map((node) => node.tag).lastIndexOf(tag);
            if (index > 0) stack.length = index;
            i += close[0].length;
            continue;
        }
        const open = /^<([a-zA-Z][\w-]*)/.exec(html.slice(i, i + 100));
        if (!open) {
            addText('<', i);
            i += 1;
            continue;
        }
        const tag = open[1].toLowerCase();
        const start = i;
        i += open[0].length;
        /** @type {[string, string][]} */
        const attrs = [];
        while (i < html.length) {
            while (/\s/.test(html[i] ?? '')) i += 1;
            if (html[i] === '>') { i += 1; break; }
            if (html[i] === '/' && html[i + 1] === '>') { i += 2; break; }
            if (html[i] === '/') { i += 1; continue; }
            const name = /^[^\s=>/]+/.exec(html.slice(i))?.[0];
            if (!name) { i += 1; continue; }
            i += name.length;
            while (/\s/.test(html[i] ?? '')) i += 1;
            let value = '';
            if (html[i] === '=') {
                i += 1;
                while (/\s/.test(html[i] ?? '')) i += 1;
                const quote = html[i];
                if (quote === '"' || quote === '\'') {
                    const end = html.indexOf(quote, i + 1);
                    value = html.slice(i + 1, end < 0 ? html.length : end);
                    i = end < 0 ? html.length : end + 1;
                } else {
                    const raw = /^[^\s>]*/.exec(html.slice(i))[0];
                    value = raw;
                    i += raw.length;
                }
            }
            const lower = name.toLowerCase();
            if (!attrs.some(([existing]) => existing === lower)) attrs.push([lower, decodeEntities(value)]);
        }
        if (CLOSES_P.has(tag)) {
            const p = stack.map((node) => node.tag).lastIndexOf('p');
            if (p > 0) stack.length = p;
        }
        if (SELF_CLOSING_SIBLINGS.has(tag) && current().tag === tag) stack.pop();
        /** @type {Element} */
        const element = { type: 'element', tag, attrs, children: [], offset: start };
        current().children.push(element);
        if (VOID.has(tag)) continue;
        if (RAW_TEXT.has(tag)) {
            const end = html.toLowerCase().indexOf(`</${tag}`, i);
            const stop = end < 0 ? html.length : end;
            if (stop > i) element.children.push({ type: 'text', value: tag === 'textarea' || tag === 'title' ? decodeEntities(html.slice(i, stop)) : html.slice(i, stop), offset: i });
            i = end < 0 ? html.length : html.indexOf('>', end) + 1;
            continue;
        }
        stack.push(element);
    }
    return root;
}

/** @param {Element} element @param {string} name */
function attr(element, name) {
    return element.attrs.find(([key]) => key === name)?.[1] ?? null;
}

/** Простой селектор: tag, .class, #id, [attr], [attr="value"] и их сочетания без пробелов. */
function matches(element, selector) {
    const parts = selector.match(/^[a-z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/gi) ?? [];
    return parts.every((part) => {
        if (part.startsWith('.')) return (attr(element, 'class') ?? '').split(/\s+/).includes(part.slice(1));
        if (part.startsWith('#')) return attr(element, 'id') === part.slice(1);
        if (part.startsWith('[')) {
            const [, name, value] = /^\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(part) ?? [];
            const actual = attr(element, name);
            return value === undefined ? actual !== null : actual === value;
        }
        return element.tag === part.toLowerCase();
    });
}

/** @param {Node} node */
function textContent(node) {
    if (node.type === 'text') return node.value;
    if (node.type === 'comment') return '';
    return node.children.map(textContent).join('');
}

/** @param {string} value */
function escapeText(value) {
    return value.replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {string} value */
function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** innerHTML так, как его сериализует браузер: атрибуты в исходном порядке, двойные кавычки. @param {Node} node */
function serialize(node) {
    if (node.type === 'text') return escapeText(node.value);
    if (node.type === 'comment') return `<!--${node.value}-->`;
    const attrs = node.attrs.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
    if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
    return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

// ─── Правила движка локализации ────────────────────────────────────────────

const INLINE_TAGS = new Set(['code', 'strong', 'em', 'b', 'i', 'u', 'br', 'small', 'kbd', 'span', 'a']);
const ATTRIBUTES = ['title', 'placeholder', 'aria-label'];
const EXCLUDED_TAGS = new Set(['input', 'textarea', 'pre', 'script', 'style']);
/** Плейсхолдер, за которым, судя по имени, стоит число: в живом DOM у такого узла нет букв. */
const NUMERIC_PLACEHOLDER = /^(?:n|i|j|k|x|y|idx|num|number|value\d+)$|count|Count|length|Length|total|Total|size|Size|Num|index|Index|Idx|percent|Percent|tokens|Tokens|Chars|chars|Kb|kb/;

/** Есть ли в тексте узла буквы — с учётом того, что плейсхолдер-число букв не даёт. @param {string} value */
function hasLetters(value) {
    if (/\p{L}/u.test(value.replace(/\{(\w+)\}/g, ''))) return true;
    return [...value.matchAll(/\{(\w+)\}/g)].some(([, name]) => !NUMERIC_PLACEHOLDER.test(name));
}

/**
 * @param {Element} element
 * @param {Element[]} ancestors предки элемента, ближайший последним
 */
function isExcluded(element, ancestors) {
    if (EXCLUDED_TAGS.has(element.tag) || attr(element, 'contenteditable') === 'true') return true;
    return IGNORE.some((selector) => {
        const [last, ...outer] = selector.split(/\s+/).reverse();
        if (!matches(element, last)) return false;
        return outer.every((part) => ancestors.some((ancestor) => matches(ancestor, part)));
    });
}

/** @param {Element} element */
const elementChildren = (element) => /** @type {Element[]} */ (element.children.filter((child) => child.type === 'element'));

/** @param {Element} element */
function isIcon(element) {
    return (element.tag === 'i' || element.tag === 'span') && !textContent(element).trim();
}

/** @param {Element} element */
function isShallowInline(element) {
    return INLINE_TAGS.has(element.tag) && !attr(element, 'id')
        && elementChildren(element).every((child) => isIcon(child) && elementChildren(child).length === 0);
}

/** @param {Element} element */
function isRichUnit(element) {
    let formatting = false;
    let icon = false;
    let textNodes = 0;
    for (const child of element.children) {
        if (child.type === 'text') {
            if (hasLetters(child.value)) textNodes += 1;
            continue;
        }
        if (child.type !== 'element') continue;
        if (!isShallowInline(child)) return false;
        if (isIcon(child)) icon = true;
        else formatting = true;
    }
    return textNodes > 0 && (formatting || (icon && textNodes > 1));
}

/** Как wrapInlineRuns в движке: куски «текст + инлайн-теги» между блоками и <br> переводятся целиком. @param {Element} element */
function wrapInlineRuns(element) {
    const children = element.children;
    const hasBlock = children.some((node) => node.type === 'element' && !INLINE_TAGS.has(node.tag));
    const hasBreak = children.some((node) => node.type === 'element' && node.tag === 'br');
    if (!hasBlock && !hasBreak) return;
    const result = [];
    let run = [];
    const flush = () => {
        const elements = run.filter((node) => node.type === 'element');
        const words = run.some((node) => node.type === 'text' && hasLetters(node.value));
        if (words && elements.length > 0 && elements.every(isShallowInline)) {
            result.push({ type: 'element', tag: 'span', attrs: [['class', 'desru-run']], children: run, offset: run[0].offset });
        } else {
            result.push(...run);
        }
        run = [];
    };
    for (const node of children) {
        const inline = node.type === 'text' || (node.type === 'element' && INLINE_TAGS.has(node.tag) && node.tag !== 'br');
        if (inline) {
            run.push(node);
        } else {
            flush();
            result.push(node);
        }
    }
    flush();
    element.children = result;
}

/**
 * Обходит дерево по правилам движка и отдаёт то, что он будет искать в словаре.
 * @param {Element} element
 * @param {(kind: string, value: string, offset: number) => void} emit
 * @param {Element[]} [ancestors] предки элемента (для селекторов IGNORE «предок потомок»)
 */
function visit(element, emit, ancestors = []) {
    if (element.tag !== '#root' && isExcluded(element, ancestors)) {
        // Движок пропускает поля ввода целиком, вместе с атрибутами, но placeholder и title у них — тоже интерфейс:
        // выдаём их, чтобы словарь был готов, когда движок начнёт их переводить.
        if (element.tag === 'input' || element.tag === 'textarea') {
            for (const name of ATTRIBUTES) {
                const value = attr(element, name);
                if (value?.trim()) emit(name, value, element.offset);
            }
        }
        return;
    }
    for (const name of ATTRIBUTES) {
        const value = attr(element, name);
        if (value?.trim()) emit(name, value, element.offset);
    }
    // Корень фрагмента — элемент, в который CK кладёт литерал через innerHTML / .html(): он тоже может быть «подсказкой».
    if (isRichUnit(element)) {
        emit('rich', element.children.map(serialize).join(''), element.offset);
        return;
    }
    wrapInlineRuns(element);
    const inner = element.tag === '#root' ? ancestors : [...ancestors, element];
    for (const child of element.children) {
        if (child.type === 'text') {
            if (child.value.trim()) emit('text', child.value, child.offset);
        } else if (child.type === 'element') {
            visit(child, emit, inner);
        }
    }
}

// ─── Найденные строки ──────────────────────────────────────────────────────

/** @type {Map<string, { places: Set<string>, kinds: Set<string> }>} */
const found = new Map();

/** @param {string} kind @param {string} raw @param {string} where */
function add(kind, raw, where) {
    const value = normalizeText(raw);
    if (!value || !looksTranslatable(value.replace(/\{\w+\}/g, ''))) return;
    if (/^[{}\w\s.,:;/()-]+$/.test(value) && !/[A-Za-z]{2}/.test(value.replace(/\{\w+\}/g, ''))) return;
    if (/^\{\w+\}$/.test(value)) return;
    if (!found.has(value)) found.set(value, { places: new Set(), kinds: new Set() });
    const entry = found.get(value);
    entry.places.add(where);
    entry.kinds.add(kind);
}

// ─── settings.html ─────────────────────────────────────────────────────────

/** @param {string} text @param {number} offset */
function lineAt(text, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
    return line;
}

function scanSettings() {
    const file = path.join(ckRoot, 'settings.html');
    const html = fs.readFileSync(file, 'utf8');
    visit(parseHtml(html), (kind, value, offset) => add(kind, value, `settings.html:${lineAt(html, offset)}`));
}

// ─── JS ────────────────────────────────────────────────────────────────────

/** Перед `/` стоит то, после чего начинается регулярное выражение, а не деление. @param {string} before */
function regexMayStart(before) {
    const trimmed = before.trimEnd();
    if (!trimmed) return true;
    if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(trimmed)) return true;
    return /\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(trimmed);
}

/** Конец регулярного выражения, начатого `/` в позиции `start`, или -1. @param {string} code */
function regexEnd(code, start) {
    let inClass = false;
    for (let i = start + 1; i < code.length; i += 1) {
        const char = code[i];
        if (char === '\n') return -1;
        if (char === '\\') { i += 1; continue; }
        if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) {
            let end = i + 1;
            while (/[a-z]/i.test(code[end] ?? '')) end += 1;
            return end;
        }
    }
    return -1;
}

/**
 * Код без комментариев и тел регулярных выражений той же длины: они заменены пробелами, переводы строк сохранены.
 * Кавычки внутри регулярок (`/["'`]/`) иначе сбивают разбор литералов.
 * @param {string} code
 */
function blankComments(code) {
    let result = '';
    let i = 0;
    while (i < code.length) {
        const char = code[i];
        if (char === '/' && code[i + 1] !== '/' && code[i + 1] !== '*' && regexMayStart(result.slice(-40))) {
            const end = regexEnd(code, i);
            if (end > 0) {
                result += `/${' '.repeat(end - i - 2)}/`.padEnd(end - i, ' ');
                i = end;
                continue;
            }
        }
        if (char === '/' && code[i + 1] === '/') {
            const end = code.indexOf('\n', i);
            const stop = end < 0 ? code.length : end;
            result += ' '.repeat(stop - i);
            i = stop;
            continue;
        }
        if (char === '/' && code[i + 1] === '*') {
            const end = code.indexOf('*/', i + 2);
            const stop = end < 0 ? code.length : end + 2;
            result += code.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            const literal = readLiteral(code, i);
            if (literal) {
                result += code.slice(i, literal.end);
                i = literal.end;
                continue;
            }
        }
        result += char;
        i += 1;
    }
    return result;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/**
 * Делит выражение по операторам верхнего уровня (вне скобок и строк).
 * @param {string} code
 * @param {string[]} operators
 * @returns {{ text: string, start: number }[]}
 */
function splitTop(code, operators) {
    const pieces = [];
    let depth = 0;
    let last = 0;
    let i = 0;
    while (i < code.length) {
        const char = code[i];
        if (char === '\'' || char === '"' || char === '`') {
            const literal = readLiteral(code, i);
            if (literal) { i = literal.end; continue; }
        }
        if (OPEN.has(char)) depth += 1;
        else if (CLOSE.has(char)) depth -= 1;
        else if (depth === 0) {
            const operator = operators.find((op) => code.startsWith(op, i));
            // `+` — не `++` и не `+=`; `||` — не `||=`
            if (operator && !(operator === '+' && (code[i + 1] === '+' || code[i + 1] === '=' || code[i - 1] === '+'))
                && !(operator === '||' && code[i + 2] === '=')) {
                pieces.push({ text: code.slice(last, i), start: last });
                i += operator.length;
                last = i;
                continue;
            }
        }
        i += 1;
    }
    pieces.push({ text: code.slice(last), start: last });
    return pieces;
}

/** Тернарник верхнего уровня: [условие, да, нет] или null. @param {string} code */
function splitTernary(code) {
    let depth = 0;
    let question = -1;
    let nested = 0;
    for (let i = 0; i < code.length; i += 1) {
        const char = code[i];
        if (char === '\'' || char === '"' || char === '`') {
            const literal = readLiteral(code, i);
            if (literal) { i = literal.end - 1; continue; }
        }
        if (OPEN.has(char)) depth += 1;
        else if (CLOSE.has(char)) depth -= 1;
        else if (depth === 0 && char === '?' && code[i + 1] !== '.' && code[i + 1] !== '?' && code[i - 1] !== '?') {
            if (question < 0) question = i;
            else nested += 1;
        } else if (depth === 0 && char === ':' && question >= 0) {
            if (nested > 0) nested -= 1;
            else return [{ text: code.slice(0, question), start: 0 }, { text: code.slice(question + 1, i), start: question + 1 }, { text: code.slice(i + 1), start: i + 1 }];
        }
    }
    return null;
}

/** Снимает внешние скобки и пробелы, сохраняя смещение. @param {{ text: string, start: number }} piece */
function trimPiece(piece) {
    let { text, start } = piece;
    for (;;) {
        const lead = text.length - text.trimStart().length;
        text = text.trim();
        start += lead;
        if (!(text.startsWith('(') && text.endsWith(')'))) break;
        // скобки должны закрывать друг друга, а не «(a) + (b)»
        let depth = 0;
        let wraps = true;
        for (let i = 0; i < text.length - 1; i += 1) {
            if (OPEN.has(text[i])) depth += 1;
            else if (CLOSE.has(text[i])) depth -= 1;
            if (depth === 0) { wraps = false; break; }
        }
        if (!wraps) break;
        text = text.slice(1, -1);
        start += 1;
    }
    return { text, start };
}

const MAX_VARIANTS = 16;

/**
 * Склейка последовательности частей, у каждой — несколько вариантов. Пока произведение не больше MAX_VARIANTS,
 * выдаём все сочетания; иначе — «по диагонали»: k-й вариант берёт k-й вариант каждой части, так что каждый
 * вариант каждой части встретится хотя бы раз.
 * @param {(string|{expr: string, start: number})[][][]} choices
 */
function combine(choices) {
    const total = choices.reduce((product, options) => product * options.length, 1);
    if (total <= MAX_VARIANTS) {
        let result = [[]];
        for (const options of choices) {
            const next = [];
            for (const prefix of result) for (const option of options) next.push([...prefix, ...option]);
            result = next;
        }
        return result;
    }
    const count = Math.max(...choices.map((options) => options.length));
    return Array.from({ length: count }, (_, k) => choices.flatMap((options) => options[k % options.length]));
}

/**
 * Варианты строки, которую даёт выражение: тернарники и `||` дают несколько вариантов, `+` склеивает куски.
 * Вариант — массив частей: строка или { expr } (то, что станет плейсхолдером).
 * @param {{ text: string, start: number }} piece
 * @param {number} base смещение кода в файле
 * @param {Set<number>} consumed позиции литералов, подставленных в варианты (их не надо разбирать отдельно)
 * @returns {(string|{expr: string, start: number})[][]}
 */
function variants(piece, base, consumed, depth = 0) {
    const { text, start } = trimPiece(piece);
    const opaque = [[{ expr: text, start: base + start }]];
    if (!text || depth > 6) return opaque;
    const ternary = splitTernary(text);
    if (ternary) {
        const yes = variants(ternary[1], base + start, consumed, depth + 1);
        const no = variants(ternary[2], base + start, consumed, depth + 1);
        return [...yes, ...no].slice(0, MAX_VARIANTS);
    }
    const alternatives = splitTop(text, ['||', '??']);
    if (alternatives.length > 1) {
        return alternatives.flatMap((alternative) => variants(alternative, base + start, consumed, depth + 1)).slice(0, MAX_VARIANTS);
    }
    const sum = splitTop(text, ['+']);
    if (sum.length > 1 && sum.every((operand) => operand.text.trim())) {
        return combine(sum.map((operand) => variants(operand, base + start, consumed, depth + 1)));
    }
    if (/^['"`]/.test(text)) {
        const literal = readLiteral(text, 0);
        if (literal && literal.end === text.length) {
            consumed.add(base + start);
            return expandLiteral(literal, base + start, consumed, depth);
        }
    }
    return opaque;
}

/**
 * Варианты шаблонной строки: `${...}` из простых строк (тернарники, `||`) подставляются, остальное — плейсхолдеры.
 * @param {{ parts: (string|{expr: string, start: number})[] }} literal
 * @param {number} partBase смещение, к которому отсчитаны `start` частей литерала (0 — литерал прочитан из всего файла)
 * @param {Set<number>} consumed сюда пишутся позиции подставленных вложенных литералов
 */
function expandLiteral(literal, partBase, consumed, depth = 0) {
    const choices = literal.parts.map((part) => {
        if (typeof part === 'string') return [[part]];
        const absolute = partBase + part.start;
        const inner = new Set();
        const expanded = variants({ text: part.expr, start: 0 }, absolute, inner, depth + 1);
        // тернарник или «||» из 2–4 вариантов (строки или вложенные шаблоны) — раскрываем
        if (expanded.length > 1 && expanded.length <= 4) {
            inner.forEach((offset) => consumed.add(offset));
            return expanded;
        }
        return [[{ expr: part.expr, start: absolute }]];
    });
    return combine(choices);
}

/** Строка с плейсхолдерами из частей варианта. */
function render(parts) {
    const merged = [];
    for (const part of parts) {
        if (typeof part === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += part;
        else merged.push(part);
    }
    return joinParts(merged, HELPERS);
}

/** Выражение, которое, судя по коду или имени, даёт разметку (список, значок, кнопки), а не текст. */
const HTML_EXPRESSION = /<[a-z/]|\.map\(|\.join\(|\b(?:render|generate|create|build)[A-Z]\w*\(/;
const HTML_NAME = /(?:html|Html|HTML|icon|Icon|badge|Badge|button|Button|Buttons|indicator|Indicator|rows|Rows|items|Items|list|List|cards|Cards|tabs|Tabs|options|Options|sections|Sections|Section)$/;
const SLOT = '<ck-slot></ck-slot>';

/** Как render, но выражения-разметка становятся пустым блочным элементом: так текст вокруг них делится, как в браузере. */
function renderHtml(parts) {
    const used = new Set();
    const pieces = [];
    for (const part of parts) {
        if (typeof part === 'string') {
            pieces.push(part);
            continue;
        }
        const name = joinParts([part], HELPERS).slice(1, -1);
        if (HTML_EXPRESSION.test(part.expr) || HTML_NAME.test(name)) pieces.push(SLOT);
        else pieces.push(part);
    }
    const merged = [];
    for (const piece of pieces) {
        if (typeof piece === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += piece;
        else merged.push(piece);
    }
    return merged.map((piece) => (typeof piece === 'string' ? piece : `{${placeholderName(piece.expr, used, HELPERS)}}`)).join('');
}

const HTML_TAG = /<[a-z][\w-]*(?:\s[^<>]*)?>|<\/[a-z][\w-]*>/i;

/**
 * Контексты, где строка попадает в интерфейс как текст или атрибут. `args` — номера аргументов вызова,
 * `assign` — правая часть присваивания, `property` — значение свойства объекта.
 */
const CONTEXTS = [
    { pattern: /\btoastr\.(?:success|info|warning|error)\(/g, args: [0, 1], kind: 'toast' },
    { pattern: /\.text\(/g, args: [0], kind: 'text' },
    { pattern: /\.html\(/g, args: [0], kind: 'html' },
    { pattern: /\.(?:append|prepend)\(/g, args: [0], kind: 'html' },
    { pattern: /\b(?:textContent|innerText)\s*=(?!=)/g, assign: true, kind: 'text' },
    { pattern: /\.innerHTML\s*=(?!=)/g, assign: true, kind: 'html' },
    { pattern: /\.(?:title|placeholder)\s*=(?!=)/g, assign: true, kind: 'title' },
    { pattern: /\.(?:attr|prop)\(\s*(['"])(?:title|placeholder|aria-label)\1\s*,/g, args: [0], kind: 'title' },
    { pattern: /\bsetAttribute\(\s*(['"])(?:title|placeholder|aria-label)\1\s*,/g, args: [0], kind: 'title' },
    { pattern: /\bcallGenericPopup\(/g, args: [0], kind: 'popup' },
    { pattern: /\b(?:showCarrotPopup|CarrotKernel\.showPopup)\(/g, args: [0], kind: 'popup title' },
    { pattern: /\bPopup\.show\.\w+\(/g, args: [0, 1], kind: 'popup' },
    { pattern: /[{,]\s*(?:label|title|tooltip|placeholder|description|subtitle|message|buttonText|text|emptyText|okButton|cancelButton)\s*:\s*/g, property: true, kind: 'property' },
    // таблицы подписей: { 0: '↑ Before Character', 'forced': 'Force activated…' }
    { pattern: /[{,]\s*(?:\d+|'[\w-]+'|"[\w-]+")\s*:\s*(?=['"`])/g, property: true, kind: 'map' },
];

/** Литерал внутри вызова журнала (console.log, CarrotDebug.*, debugLog…) — не интерфейс. */
const LOG_CALL = /(?:\bconsole\.\w+|\bCarrotDebug\.\w+|\bdebugLog|\blogSeq|\blog\.\w+|\bthis\.debug|\bdebug)\s*$/;

/** Ближайший незакрытый вызов перед позицией — журнал? @param {string} code @param {number} position */
function inLogCall(code, position) {
    let depth = 0;
    for (let i = position - 1; i >= Math.max(0, position - 400); i -= 1) {
        const char = code[i];
        if (CLOSE.has(char)) depth += 1;
        else if (OPEN.has(char)) {
            if (depth === 0) return char === '(' && LOG_CALL.test(code.slice(Math.max(0, i - 40), i));
            depth -= 1;
        } else if (char === ';' && depth === 0) return false;
    }
    return false;
}

/** Позиция закрывающей `}` для `{` в позиции `open` (строки и шаблоны пропускаются). @param {string} code */
function matchingBrace(code, open) {
    let depth = 0;
    let i = open;
    while (i < code.length) {
        const char = code[i];
        if (char === '\'' || char === '"' || char === '`') {
            const literal = readLiteral(code, i);
            if (literal) { i = literal.end; continue; }
        }
        if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
        i += 1;
    }
    return code.length;
}

/**
 * Тела мёртвых функций файла: `function name(…) {…}` и `const name = (…) => {…}`.
 * @param {string} code код без комментариев
 * @param {string[]} names
 * @returns {[number, number][]}
 */
function deadRanges(code, names) {
    const ranges = [];
    for (const name of names) {
        const pattern = new RegExp(`\\bfunction\\s+${name}\\s*\\(|\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>`, 'g');
        for (const match of code.matchAll(pattern)) {
            const open = code.indexOf('{', match.index + match[0].length);
            if (open >= 0) ranges.push([match.index, matchingBrace(code, open)]);
        }
    }
    return ranges;
}

/** Аргументы вызова, начиная с позиции после `(`. @returns {{ text: string, start: number }[]} */
function readArguments(code, from) {
    let depth = 0;
    let i = from;
    while (i < code.length) {
        const char = code[i];
        if (char === '\'' || char === '"' || char === '`') {
            const literal = readLiteral(code, i);
            if (literal) { i = literal.end; continue; }
        }
        if (OPEN.has(char)) depth += 1;
        else if (CLOSE.has(char)) {
            if (depth === 0) break;
            depth -= 1;
        }
        i += 1;
    }
    return splitTop(code.slice(from, i), [',']).map((piece) => ({ text: piece.text, start: from + piece.start }));
}

/** Правая часть присваивания или значение свойства: до `;`, `,`/`}` верхнего уровня или конца строки. */
function readValue(code, from, stopAtComma) {
    let depth = 0;
    let i = from;
    while (i < code.length) {
        const char = code[i];
        if (char === '\'' || char === '"' || char === '`') {
            const literal = readLiteral(code, i);
            if (literal) { i = literal.end; continue; }
        }
        if (OPEN.has(char)) depth += 1;
        else if (CLOSE.has(char)) {
            if (depth === 0) break;
            depth -= 1;
        } else if (depth === 0 && (char === ';' || (stopAtComma && char === ','))) break;
        else if (depth === 0 && char === '\n' && !/^\s*[?:+|&]/.test(code.slice(i + 1, i + 40)) && !/[?:+|&=(,]\s*$/.test(code.slice(Math.max(from, i - 40), i))) break;
        i += 1;
    }
    return { text: code.slice(from, i), start: from };
}

/**
 * @param {string} file имя файла CK
 */
function scanJs(file) {
    const original = fs.readFileSync(path.join(ckRoot, file), 'utf8');
    const code = blankComments(original);
    const lines = [0];
    for (let i = 0; i < code.length; i += 1) if (code.charCodeAt(i) === 10) lines.push(i + 1);
    const lineOf = (offset) => {
        let low = 0;
        let high = lines.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lines[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return low + 1;
    };
    const where = (offset) => `${file}:${lineOf(offset)}`;
    /** Строка из литерала найдётся в коде — по ней уточняем номер строки внутри многострочного шаблона. */
    const placeOf = (value, from, to) => {
        const probe = normalizeText(value.replace(/<[^>]*>/g, ' ')).split(/\{\w+\}/)[0].trim().slice(0, 24);
        if (probe.length >= 3) {
            const index = code.indexOf(probe, from);
            if (index >= 0 && index < to) return where(index);
        }
        return where(from);
    };
    /** @type {Set<number>} вложенные литералы, уже подставленные во внешний HTML-шаблон как вариант */
    const consumed = new Set();
    const dead = deadRanges(code, DEAD_FUNCTIONS[file] ?? []);
    const isDead = (offset) => dead.some(([start, end]) => offset >= start && offset <= end);

    // 1. Контексты: уведомления, .text(), title и т. п.
    for (const context of CONTEXTS) {
        for (const match of code.matchAll(context.pattern)) {
            if (isDead(match.index)) continue;
            const from = match.index + match[0].length;
            const pieces = context.args
                ? readArguments(code, from).filter((_, index) => context.args.includes(index))
                : [readValue(code, from, Boolean(context.property))];
            for (const piece of pieces) {
                for (const option of variants(piece, 0, new Set())) {
                    if (!option.some((part) => typeof part === 'string' && /[A-Za-z]{2}/.test(part))) continue;
                    const value = render(option);
                    if (HTML_TAG.test(value)) continue; // HTML разбирается ниже целиком
                    // в таблицах значений много служебного: слова вроде 'global', CSS из объектов стилей, имена констант
                    if (context.kind === 'map') {
                        const bare = value.replace(/\{\w+\}/g, '');
                        if (!/\s|[A-Z]|[^\x00-\x7f]/.test(bare) || /^[A-Z0-9_]+$/.test(bare)) continue;
                        if (/\d(?:px|em|rem|s)\b|rgba?\(|var\(--|gradient\(|translate[XY]?\(|\bease\b|\bsolid\b|\/\*|^[\w-]+\/[\w.+-]+/.test(bare)) continue;
                    }
                    add(context.kind, value, where(piece.start));
                }
            }
        }
    }

    // 2. HTML-шаблоны: любой литерал с тегами, включая вложенные в `${...}`.
    const seen = new Set();
    const scanLiterals = (from, to) => {
        let i = from;
        while (i < to) {
            const char = code[i];
            if (char !== '\'' && char !== '"' && char !== '`') { i += 1; continue; }
            const literal = readLiteral(code, i);
            if (!literal) { i += 1; continue; }
            if (!seen.has(i)) {
                seen.add(i);
                const start = i;
                const joined = render(literal.parts);
                if (HTML_TAG.test(joined) && !consumed.has(start) && !inLogCall(code, start) && !isDead(start)) {
                    const inner = new Set();
                    for (const option of expandLiteral(literal, 0, inner)) {
                        const html = renderHtml(option);
                        if (!HTML_TAG.test(html)) continue;
                        visit(parseHtml(html), (kind, value) => add(kind, value, placeOf(value, start, literal.end)));
                    }
                    inner.forEach((offset) => consumed.add(offset));
                }
                for (const part of literal.parts) {
                    if (typeof part !== 'string') scanLiterals(part.start, part.start + part.expr.length);
                }
            }
            i = literal.end;
        }
    };
    scanLiterals(0, code.length);
}

// ─── Сверка со словарём ────────────────────────────────────────────────────

/** Строка с плейсхолдерами, плейсхолдеры заменены числом: её находят и ключи с {#n}, и ключи с {name}. */
const probes = (text) => (/\{\w+\}/.test(text) ? [text, text.replace(/\{\w+\}/g, '1')] : [text]);

/** Переводит ли словарь строку (или её пробу). */
function translates(dictionary, text) {
    return probes(text).some((probe) => dictionary.text(probe) !== null || dictionary.rich(probe) !== null);
}

/**
 * Извлечённая строка с плейсхолдерами как регулярка: так находятся ключи, которые расписывают её варианты
 * («No personality data available» для «No {tabType} data available»). Для строк без тегов допускаются значки
 * в начале и знаки в конце — их движок снимает сам.
 */
function patternOf(text) {
    if (!/\{\w+\}/.test(text) || (text.replace(/\{\w+\}/g, '').match(/\p{L}/gu) ?? []).length < 4) return null;
    const toRegex = (value) => value.split(/\{\w+\}/).map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');
    if (HTML_TAG.test(text)) return new RegExp(`^${toRegex(text)}$`, 'su');
    const core = text.replace(/^[^\p{L}\p{N}{]+/u, '').replace(/[\s:：.…!?*]+$/u, '');
    return new RegExp(`^[^\\p{L}\\p{N}]*${toRegex(core)}[\\s:：.…!?*]*$`, 'su');
}

/** Ключи словаря (кроме служебных) с переводами. @returns {[string, string][]} */
function dictionaryEntries(file) {
    return Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))).filter(([key, value]) => !key.startsWith('__') && typeof value === 'string' && value.trim());
}

/** Места, где CK склеивает строки из кусков: «Label: значение», «a • b», «a - b», «a (b)». */
const JOINS = /\s*(?:•|:\s|\s-\s|\s\(|\)\s|!\s|\.\s)\s*/;

/**
 * Ключ устарел, если его куски не нашлись в исходниках CK (как у DES), И ни одна извлечённая строка им не
 * переводится, И его куски не собираются из литералов CK по местам склейки.
 */
function staleKeys(file, sources) {
    const entries = dictionaryEntries(file);
    const candidates = findStale(entries.map(([key]) => key), sources);
    const strings = [...found.keys()];
    const patterns = strings.map(patternOf).filter(Boolean);
    const lower = sources.map((source) => source.toLowerCase());
    // CK местами делает заглавные из служебных слов (`toUpperCase()`): 'normal_key_match' → NORMAL_KEY_MATCH
    const inSources = (piece) => sources.some((source) => source.includes(piece))
        || (!/\p{Ll}/u.test(piece) && lower.some((source) => source.includes(piece.toLowerCase())));
    const result = {};
    for (const [key, value] of entries) {
        if (!(key in candidates) || EXTERNAL.has(key)) continue;
        const single = createDictionary({ [key]: value });
        if (strings.some((text) => translates(single, text))) continue;
        const normalized = normalizeText(key);
        if (patterns.some((pattern) => pattern.test(normalized))) continue;
        const assembled = key.split(/\{#?\w+(?:\|[^{}]*)?\}|<[^>]+>/)
            .map((piece) => decodeEntities(piece).replace(/\s+/g, ' ').trim())
            .filter((piece) => piece.length >= 3 && /\p{L}/u.test(piece) && !inSources(piece))
            .every((piece) => piece.split(JOINS)
                .map((part) => part.replace(/^[^\p{L}\p{N}]+|[\s•:()!.,"'«»-]+$/gu, ''))
                .filter((part) => part.length >= 3 && /\p{L}/u.test(part))
                .every(inSources));
        if (assembled) continue;
        result[key] = candidates[key];
    }
    return result;
}

// ─── Запуск ────────────────────────────────────────────────────────────────

scanSettings();
for (const file of uiFiles()) scanJs(file);

if (stalePath) {
    const texts = ['settings.html', ...uiFiles()].map((name) => fs.readFileSync(path.join(ckRoot, name), 'utf8'));
    const stale = staleKeys(stalePath, sourceVariants(texts));
    printJson({ __desru: `Ключи словаря, которые не нашлись в CarrotKernel (${Object.keys(stale).length}). Значение — ненайденные куски.`, ...stale });
    process.exit(0);
}

let entries = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
if (dictionaryPath) {
    const dictionaryData = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
    const dictionary = createDictionary(dictionaryData);
    const keys = Object.keys(dictionaryData).filter((key) => !key.startsWith('__')).map(normalizeText);
    const known = (text) => {
        if (translates(dictionary, text)) return true;
        const pattern = patternOf(text);
        return Boolean(pattern) && keys.some((key) => pattern.test(key));
    };
    entries = entries.filter(([text]) => !known(text));
}
const output = { __desru: `Строки интерфейса CarrotKernel (${entries.length}). Ключ — строка, значение — вид и где встречается.` };
for (const [text, { places, kinds }] of entries) output[text] = `${[...kinds].join('/')} · ${[...places].slice(0, 3).join(', ')}`;
printJson(output);
