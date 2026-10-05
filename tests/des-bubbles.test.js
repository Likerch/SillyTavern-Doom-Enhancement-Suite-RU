// Пузыри DES на настоящем коде DES: applyChatBubbles из chatBubbles.js локального клона (tests/helpers/des-bubbles.js)
// раскладывает HTML, какой ST 1.19 вставляет в .mes_text. Без меток картинки без текста пропадают (баг DES),
// с метками (src/lib/bubble-media.js) остаются. Нет клона DES в vendor/des — тесты пропускаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desBubblesFile, loadDesBubbles, messageElement } from './helpers/des-bubbles.js';
import { markMediaForBubbles } from '../src/lib/bubble-media.js';

const skip = desBubblesFile() ? false : 'нет клона DES (vendor/des или DESRU_DES_DIR)';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Приветствия, как их отдаёт showdown ST 1.19 (после DOMPurify — те же теги). `lost` — сколько картинок DES
 * теряет без меток при skipStyledDivs: true / false.
 */
const GREETINGS = [
    {
        name: 'markdown image paragraph',
        html: '<p>Первый абзац.</p>\n<p><img src="https://example.com/a.png" alt="png"></p>\n<p>Второй абзац.</p>',
        text: ['Первый абзац.', 'Второй абзац.'],
        lost: [1, 1],
    },
    {
        name: 'raw <img> line between paragraphs',
        html: '<p>Первый абзац.<br>\n<img src="https://example.com/b.png" style="width:50%"><br>\nВторой абзац.</p>',
        text: ['Первый абзац.', 'Второй абзац.'],
        lost: [1, 1],
    },
    {
        name: 'several images and a data: GIF',
        html: `<p><img src="https://e.com/1.png"><br>\n<img src="https://e.com/2.png"></p>\n<p><img src="${GIF}" alt="gif"></p>\n<p>Текст</p>`,
        text: ['Текст'],
        lost: [3, 3],
    },
    {
        name: 'image inside a plain div',
        html: '<div><img src="https://e.com/d.png"></div>\n<p>Текст</p>',
        text: ['Текст'],
        lost: [1, 1],
    },
    {
        name: 'image inside a styled div',
        html: '<div style="background:#111;padding:8px"><img src="https://e.com/s.png"></div>\n<p>Текст</p>',
        text: ['Текст'],
        // skipStyledDivs: такой div DES оставляет как есть (GFX), без пузырей.
        lost: [0, 1],
    },
    {
        name: 'image and text in one paragraph',
        html: '<p>Text with <img src="https://e.com/i.png" alt="i"> inline</p>',
        text: ['Text with', 'inline'],
        lost: [0, 0],
    },
    {
        name: 'image before a coloured line in one paragraph',
        html: '<p><img src="https://e.com/f.png"><font color="#ff0000">«Привет»</font></p>',
        text: ['«Привет»'],
        lost: [1, 1],
    },
];

/** @param {string} html */
const imagesIn = (html) => [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map((match) => match[1]);

/**
 * Что DES покажет: .mes_text после applyChatBubbles.
 * @param {string} html @param {'cards'|'discord'} style @param {boolean} skipStyledDivs
 */
function render(html, style, skipStyledDivs) {
    const des = /** @type {Record<string, any>} */ (loadDesBubbles({ chatBubbleSettings: { skipStyledDivs } }));
    const { mes, text } = messageElement(html);
    des.applyChatBubbles(mes, style);
    assert.equal(text.getAttribute('data-dooms-bubbles-applied'), 'true');
    return text.innerHTML;
}

for (const style of /** @type {const} */ (['cards', 'discord'])) {
    for (const [index, skipStyledDivs] of [true, false].entries()) {
        for (const greeting of GREETINGS) {
            const label = `${style}, skipStyledDivs ${skipStyledDivs}: ${greeting.name}`;

            test(`DES as is — ${label}`, { skip }, () => {
                const shown = render(greeting.html, style, skipStyledDivs);
                assert.equal(imagesIn(shown).length, imagesIn(greeting.html).length - greeting.lost[index]);
            });

            test(`DES with media marks keeps every image — ${label}`, { skip }, () => {
                const shown = render(markMediaForBubbles(greeting.html), style, skipStyledDivs);
                assert.deepEqual(imagesIn(shown), imagesIn(greeting.html));
                for (const part of greeting.text) assert.ok(shown.includes(part), part);
                // Метка не превращается в отдельный пузырь: пузырей столько же, сколько у DES с текстом вместо картинок.
                const withText = render(greeting.html.replace(/<img\b[^>]*>/g, 'X'), style, skipStyledDivs);
                const bubble = style === 'cards' ? /class="dooms-card[ "]/g : /class="dooms-bubble[ "]/g;
                assert.equal(shown.match(bubble)?.length ?? 0, withText.match(bubble)?.length ?? 0);
            });
        }
    }
}

test('a code block with <img> text stays text in the bubbles', { skip }, () => {
    const html = '<pre><code>&lt;img src="x.png"&gt;\n</code></pre>\n<p>after</p>';
    assert.equal(markMediaForBubbles(html), html);
    const shown = render(html, 'cards', true);
    assert.ok(shown.includes('&lt;img src="x.png"&gt;'));
    assert.deepEqual(imagesIn(shown), []);
});
