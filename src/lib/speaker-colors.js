// Кто говорит цветом реплики — для пузырей и раскраски DES, когда имена кириллические.
//
// DES связывает новый цвет <font color> с персонажем по соседству: чьё имя чаще стоит в повествовании
// рядом с репликами этого цвета (chatBubbles.js, _bestAdjacentName). Имя он ищет регуляркой `\b…\b`,
// а `\b` в JS не видит кириллицу — русские имена не находятся, и реплики остаются «Unknown».
// Здесь тот же подсчёт: окно 200 символов, рядом с репликой (60 символов) — 3 очка, дальше — 1,
// побеждает единственный лучший. Но с юникодными границами слов и падежными формами имени.

import { WORD_END, WORD_START, escapeRegex } from './regex-keys.js';

const WINDOW = 200;
const NEAR = 60;
const FONT_OPEN_RE = /<font\s+color=["']?(#[0-9a-fA-F]{6})["']?>/gi;

/** @param {string} text */
function stripFonts(text) {
    return text.replace(/<font\b[^>]*>[\s\S]*?<\/font>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

/**
 * Цвета реплик в сообщении в порядке появления (нижний регистр, без повторов).
 * @param {unknown} text
 */
export function messageFontColors(text) {
    const colors = [];
    for (const match of String(text ?? '').matchAll(FONT_OPEN_RE)) {
        const color = match[1].toLowerCase();
        if (!colors.includes(color)) colors.push(color);
    }
    return colors;
}

/**
 * Регулярка для поиска имени в тексте по всем формам.
 * @param {readonly string[]} forms формы имени (любой регистр)
 */
export function namePattern(forms) {
    const alternatives = [...new Set(forms.map((form) => String(form).trim().toLowerCase()).filter(Boolean))]
        .sort((a, b) => b.length - a.length)
        .map((form) => form.split(/\s+/).map((word) => escapeRegex(word).replace(/[её]/g, '[её]')).join('\\s+'));
    return alternatives.length ? new RegExp(`${WORD_START}(?:${alternatives.join('|')})${WORD_END}`, 'giu') : null;
}

/**
 * Персонаж, чьё имя сильнее всего соседствует с репликами цвета `color`; `null` — ничья или нет сигнала.
 * @param {string} messageText сырой текст сообщения (с тегами <font>)
 * @param {string} color
 * @param {readonly { name: string, pattern: RegExp|null }[]} candidates
 */
export function bestAdjacentSpeaker(messageText, color, candidates) {
    if (!candidates.length || typeof messageText !== 'string') return null;
    const scores = new Map(candidates.map((candidate) => [candidate.name, 0]));
    const open = new RegExp(`<font\\s+color=["']?#?${escapeRegex(color.replace('#', ''))}["']?>`, 'gi');
    for (const match of messageText.matchAll(open)) {
        const before = stripFonts(messageText.slice(Math.max(0, match.index - WINDOW), match.index));
        const closeIndex = messageText.indexOf('</font>', match.index);
        const afterStart = closeIndex === -1 ? match.index + match[0].length : closeIndex + '</font>'.length;
        const after = stripFonts(messageText.slice(afterStart, afterStart + WINDOW));
        for (const { name, pattern } of candidates) {
            if (!pattern) continue;
            for (const found of before.matchAll(pattern)) {
                scores.set(name, scores.get(name) + (before.length - found.index <= NEAR ? 3 : 1));
            }
            for (const found of after.matchAll(pattern)) {
                scores.set(name, scores.get(name) + (found.index <= NEAR ? 3 : 1));
            }
        }
    }
    let best = null;
    let bestScore = 0;
    let tie = false;
    for (const [name, score] of scores) {
        if (score > bestScore) {
            best = name;
            bestScore = score;
            tie = false;
        } else if (score === bestScore && score > 0) {
            tie = true;
        }
    }
    return !tie && bestScore > 0 ? best : null;
}
