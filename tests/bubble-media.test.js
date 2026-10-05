// Метки картинок для пузырей DES (src/lib/bubble-media.js) на HTML, какой ST 1.19 отдаёт хукам afterMarkdown:
// примеры сняты с showdown 2.1.0 с настройками ST (simpleLineBreaks, parseImgDimensions и т. д.).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_MARK, MEDIA_MARK_ATTR, markMediaForBubbles } from '../src/lib/bubble-media.js';

const M = MEDIA_MARK;
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Метки убраны — должен остаться исходный HTML. @param {string} html */
const unmark = (html) => html.replaceAll(M, '');

test('the mark is invisible text that String.prototype.trim keeps', () => {
    const text = M.replace(/<[^>]+>/g, '');
    assert.equal(text.length, 1);
    assert.equal(text.codePointAt(0), 0x200b);
    assert.equal(text.trim(), text);
    assert.match(M, new RegExp(`^<span ${MEDIA_MARK_ATTR} hidden>`));
});

test('a markdown image paragraph gets a mark after the image', () => {
    const html = '<p>Первый абзац.</p>\n<p><img src="https://example.com/a.png" alt="png" /></p>\n<p>Второй абзац.</p>';
    assert.equal(
        markMediaForBubbles(html),
        `<p>Первый абзац.</p>\n<p><img src="https://example.com/a.png" alt="png" />${M}</p>\n<p>Второй абзац.</p>`,
    );
});

test('a raw <img> line between paragraphs gets a mark before its <br>', () => {
    const html = '<p>Первый абзац.<br />\n<img src="https://example.com/b.png" style="width:50%"><br />\nВторой абзац.</p>';
    assert.equal(
        markMediaForBubbles(html),
        `<p>Первый абзац.<br />\n<img src="https://example.com/b.png" style="width:50%">${M}<br />\nВторой абзац.</p>`,
    );
});

test('several images, a data: GIF included, each get their own mark', () => {
    const html = `<p><img src="https://e.com/1.png"><br />\n<img src="https://e.com/2.png"><br />\n<img src="${GIF}" alt="gif" /></p>\n<p>Текст</p>`;
    const out = markMediaForBubbles(html);
    assert.equal(out.split(M).length - 1, 3);
    assert.equal(
        out,
        `<p><img src="https://e.com/1.png">${M}<br />\n<img src="https://e.com/2.png">${M}<br />\n<img src="${GIF}" alt="gif" />${M}</p>\n<p>Текст</p>`,
    );
});

test('an image inside a styled div is marked inside the div', () => {
    const html = '<div style="background:#000;padding:4px"><img src="https://e.com/d.png"></div>\n<p>Текст</p>';
    assert.equal(markMediaForBubbles(html), `<div style="background:#000;padding:4px"><img src="https://e.com/d.png">${M}</div>\n<p>Текст</p>`);
});

test('an image with text in one paragraph keeps the text as is', () => {
    const html = '<p>Text with <img src="https://e.com/i.png" alt="i" /> inline</p>';
    const out = markMediaForBubbles(html);
    assert.equal(out, `<p>Text with <img src="https://e.com/i.png" alt="i" />${M} inline</p>`);
    assert.equal(unmark(out), html);
});

test('code blocks and inline code are untouched', () => {
    for (const html of [
        '<pre><code>&lt;img src="x.png"&gt;\n</code></pre>\n<p>after</p>',
        '<p>Текст <code>&lt;img src="x"&gt;</code> и всё</p>',
        '<pre><code class="language-html"><img src="raw.png"></code></pre>',
        '<p><code><video src="v.mp4"></video></code></p>',
        '<style>.x::after { content: "<img src=y>"; }</style>',
    ]) {
        assert.equal(markMediaForBubbles(html), html, html);
    }
    // Картинка после кода — уже снаружи.
    assert.equal(markMediaForBubbles('<pre><code>x</code></pre><img src="a.png">'), `<pre><code>x</code></pre><img src="a.png">${M}`);
});

test('media containers get one mark after the closing tag, nothing inside', () => {
    assert.equal(
        markMediaForBubbles('<p><picture><source srcset="a.webp"><img src="a.png"></picture></p>'),
        `<p><picture><source srcset="a.webp"><img src="a.png"></picture>${M}</p>`,
    );
    assert.equal(
        markMediaForBubbles('<video controls src="v.mp4"><source src="v.webm"></video>'),
        `<video controls src="v.mp4"><source src="v.webm"></video>${M}`,
    );
    assert.equal(
        markMediaForBubbles('<svg viewBox="0 0 1 1"><svg><image href="a.png"/></svg></svg><svg/>'),
        `<svg viewBox="0 0 1 1"><svg><image href="a.png"/></svg></svg>${M}<svg/>${M}`,
    );
    assert.equal(markMediaForBubbles('<audio controls src="a.mp3"></audio>'), `<audio controls src="a.mp3"></audio>${M}`);
});

test('NAI Studio placeholders and markers stay as they are', () => {
    for (const html of [
        '<p><span data-naist-img="abc123"></span></p>',
        '<p>[nai:img:abc123]</p>',
        '<p><img data-naist-img="abc123" class="naist-compat" src="data:image/gif;base64,R0lGOD#naist:abc123" alt=""></p>',
        '<figure><img data-nai=\'{"prompt":"1girl, red hair","caption":"x"}\'></figure>',
        '<p><img class="naist-marker-stream" src="data:image/gif;base64,R0lGOD#naist-stream" width="832" height="1216"></p>',
    ]) {
        assert.equal(markMediaForBubbles(html), html, html);
    }
});

test('attribute values with ">" do not confuse the scanner', () => {
    assert.equal(markMediaForBubbles('<p><img title="a > b" src="q.png"></p>'), `<p><img title="a > b" src="q.png">${M}</p>`);
});

test('nothing to do: same string back, and a second pass adds nothing', () => {
    const plain = '<p>Только текст, «кавычки» и <em>курсив</em>.</p>';
    assert.equal(markMediaForBubbles(plain), plain);
    const once = markMediaForBubbles('<p><img src="a.png"></p>');
    assert.equal(markMediaForBubbles(once), once);
    assert.equal(markMediaForBubbles(''), '');
    assert.equal(markMediaForBubbles(/** @type {any} */ (null)), null);
});
