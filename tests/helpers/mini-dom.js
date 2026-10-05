// Маленький DOM для тестов пузырей DES (tests/des-bubbles.test.js). Умеет ровно то, чем пользуются
// applyChatBubbles и его помощники в chatBubbles.js: разбор и сериализация HTML, childNodes, textContent,
// cloneNode, атрибуты и простые селекторы (тег, .класс, [атрибут], [атрибут*="…"] и списки через запятую).
// Разбирает корректный HTML, какой выдают showdown и DOMPurify; это не браузер: незакрытые <p> и прочие
// исправления парсера HTML5 не воспроизводятся.

const NBSP = String.fromCharCode(0xa0);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: NBSP };

/** @param {string} text */
function decode(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
        const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
    });
}

/** Как браузер сериализует текст (innerHTML). @param {string} text */
const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replaceAll(NBSP, '&nbsp;');
/** @param {string} value */
const escapeAttr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replaceAll(NBSP, '&nbsp;');

export class MiniNode {
    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
    static COMMENT_NODE = 8;

    /** @param {number} nodeType */
    constructor(nodeType) {
        this.nodeType = nodeType;
        /** @type {MiniElement|null} */
        this.parentNode = null;
        /** @type {MiniNode[]} */
        this.childNodes = [];
    }

    get parentElement() {
        return this.parentNode;
    }

    remove() {
        if (!this.parentNode) return;
        const siblings = this.parentNode.childNodes;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentNode = null;
    }
}

class MiniText extends MiniNode {
    /** @param {string} data */
    constructor(data) {
        super(MiniNode.TEXT_NODE);
        this.data = data;
    }

    get textContent() {
        return this.data;
    }

    get nodeValue() {
        return this.data;
    }

    cloneNode() {
        return new MiniText(this.data);
    }
}

class MiniComment extends MiniNode {
    /** @param {string} data */
    constructor(data) {
        super(MiniNode.COMMENT_NODE);
        this.data = data;
    }

    get textContent() {
        return this.data;
    }

    get nodeValue() {
        return this.data;
    }

    cloneNode() {
        return new MiniComment(this.data);
    }
}

export class MiniElement extends MiniNode {
    /** @param {string} name */
    constructor(name) {
        super(MiniNode.ELEMENT_NODE);
        this.localName = name.toLowerCase();
        this.tagName = name.toUpperCase();
        /** @type {{ name: string, value: string }[]} */
        this.attributes = [];
    }

    /** @param {string} name */
    getAttribute(name) {
        return this.attributes.find((attr) => attr.name === name.toLowerCase())?.value ?? null;
    }

    /** @param {string} name */
    hasAttribute(name) {
        return this.getAttribute(name) !== null;
    }

    /** @param {string} name @param {unknown} value */
    setAttribute(name, value) {
        const key = name.toLowerCase();
        const found = this.attributes.find((attr) => attr.name === key);
        if (found) found.value = String(value);
        else this.attributes.push({ name: key, value: String(value) });
    }

    /** @param {string} name */
    removeAttribute(name) {
        this.attributes = this.attributes.filter((attr) => attr.name !== name.toLowerCase());
    }

    /** @param {MiniNode} node */
    appendChild(node) {
        node.remove();
        node.parentNode = this;
        this.childNodes.push(node);
        return node;
    }

    /** @param {boolean} [deep] */
    cloneNode(deep = false) {
        const copy = new MiniElement(this.localName);
        copy.attributes = this.attributes.map((attr) => ({ ...attr }));
        if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
        return copy;
    }

    get textContent() {
        return this.childNodes.filter((child) => child.nodeType !== MiniNode.COMMENT_NODE).map((child) => child.textContent).join('');
    }

    get innerText() {
        return this.textContent;
    }

    get innerHTML() {
        return this.childNodes.map(serialize).join('');
    }

    set innerHTML(html) {
        for (const child of this.childNodes) child.parentNode = null;
        this.childNodes = [];
        parseInto(this, String(html));
    }

    get outerHTML() {
        return serialize(this);
    }

    /** @param {string} selector */
    querySelectorAll(selector) {
        const matches = compileSelector(selector);
        /** @type {MiniElement[]} */
        const found = [];
        const walk = (node) => {
            for (const child of node.childNodes) {
                if (!(child instanceof MiniElement)) continue;
                if (matches(child)) found.push(child);
                walk(child);
            }
        };
        walk(this);
        return found;
    }

    /** @param {string} selector */
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    /** @param {string} selector */
    closest(selector) {
        const matches = compileSelector(selector);
        for (let node = /** @type {MiniElement|null} */ (this); node; node = node.parentNode) {
            if (matches(node)) return node;
        }
        return null;
    }
}

/** @param {MiniNode} node */
function serialize(node) {
    if (node instanceof MiniText) return escapeText(node.data);
    if (node instanceof MiniComment) return `<!--${node.data}-->`;
    const element = /** @type {MiniElement} */ (node);
    const attrs = element.attributes.map(({ name, value }) => ` ${name}="${escapeAttr(value)}"`).join('');
    if (VOID.has(element.localName)) return `<${element.localName}${attrs}>`;
    return `<${element.localName}${attrs}>${element.innerHTML}</${element.localName}>`;
}

const TOKEN = /<!--([\s\S]*?)-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** @param {MiniElement} root @param {string} html */
function parseInto(root, html) {
    /** @type {MiniElement[]} */
    const stack = [root];
    const current = () => stack[stack.length - 1];
    for (const [, comment, closeName, openName, attrs, text] of html.matchAll(TOKEN)) {
        if (comment !== undefined) {
            current().appendChild(new MiniComment(comment));
        } else if (closeName) {
            const name = closeName.toLowerCase();
            const index = stack.findLastIndex((element, i) => i > 0 && element.localName === name);
            if (index > 0) stack.length = index;
        } else if (openName) {
            const element = new MiniElement(openName);
            for (const [, name, double, single, bare] of attrs.matchAll(ATTR)) {
                if (!element.hasAttribute(name)) element.setAttribute(name, decode(double ?? single ?? bare ?? ''));
            }
            current().appendChild(element);
            if (!VOID.has(element.localName)) stack.push(element);
        } else {
            const value = decode(text);
            const last = current().childNodes.at(-1);
            if (last instanceof MiniText) last.data += value;
            else current().appendChild(new MiniText(value));
        }
    }
}

const SIMPLE = /^([a-z][\w-]*|\*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i;
const ATTR_TEST = /\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;

/**
 * @param {string} selector
 * @returns {(element: MiniElement) => boolean}
 */
function compileSelector(selector) {
    const tests = selector.split(',').map((part) => {
        const match = part.trim().match(SIMPLE);
        if (!match) throw new Error(`mini-dom: селектор не поддерживается: ${part.trim()}`);
        const [, tag, classes, attrs] = match;
        const classList = classes.split('.').filter(Boolean);
        const attrTests = [...attrs.matchAll(ATTR_TEST)].map(([, name, op, double, single, bare]) => ({ name, op, value: double ?? single ?? bare }));
        return (/** @type {MiniElement} */ element) => {
            if (tag && tag !== '*' && element.localName !== tag.toLowerCase()) return false;
            const own = (element.getAttribute('class') ?? '').split(/\s+/);
            if (!classList.every((name) => own.includes(name))) return false;
            return attrTests.every(({ name, op, value }) => {
                const actual = element.getAttribute(name);
                if (actual === null) return false;
                if (!op) return true;
                if (op === '=') return actual === value;
                if (op === '*=') return actual.includes(value);
                if (op === '^=') return actual.startsWith(value);
                return actual.endsWith(value);
            });
        };
    });
    return (element) => tests.some((test) => test(element));
}

export const miniDocument = {
    /** @param {string} name */
    createElement: (name) => new MiniElement(name),
};
