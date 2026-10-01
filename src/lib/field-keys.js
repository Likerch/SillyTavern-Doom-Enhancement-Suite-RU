// Возврат названий полей персонажа в JSON-шаблон трекера.

const DETAILS_OPEN = /"details"\s*:\s*\{\s*$/;
const BLOCK_CLOSE = /^\s*\}\s*,?\s*$/;
const EMPTY_KEY = /^(\s*)""(?=\s*:)/;

/**
 * В шаблоне трекера DES кириллические названия полей персонажа превращаются в пустые ключи `""`.
 * Возвращаем им названия: k-й пустой ключ в блоке `"details"` получает k-е название из `names`.
 * DES пишет каждое поле своей строкой, поэтому разбор построчный и не зависит от кавычек в описаниях.
 * Если число пустых ключей не совпало с числом названий, шаблон не трогаем: значит, DES изменил формат.
 * @param {string} text инструкция трекера
 * @param {string[]} names названия полей с пустым ключом, в порядке полей
 * @returns {{ text: string, replaced: number, reason?: string }}
 */
export function restoreDetailKeys(text, names) {
    if (!names.length || typeof text !== 'string') return { text, replaced: 0 };
    const lines = text.split('\n');
    const open = lines.findIndex((line) => DETAILS_OPEN.test(line));
    if (open < 0) return { text, replaced: 0, reason: 'в шаблоне нет блока "details"' };

    const emptyLines = [];
    let closed = false;
    for (let index = open + 1; index < lines.length; index++) {
        if (BLOCK_CLOSE.test(lines[index])) {
            closed = true;
            break;
        }
        if (EMPTY_KEY.test(lines[index])) emptyLines.push(index);
    }
    if (!closed) return { text, replaced: 0, reason: 'блок "details" не закрыт' };
    if (!emptyLines.length) return { text, replaced: 0 };
    if (emptyLines.length !== names.length) {
        return { text, replaced: 0, reason: `пустых ключей ${emptyLines.length}, а полей с кириллицей ${names.length}` };
    }

    emptyLines.forEach((lineIndex, position) => {
        lines[lineIndex] = lines[lineIndex].replace(EMPTY_KEY, (match, indent) => `${indent}${JSON.stringify(names[position])}`);
    });
    return { text: lines.join('\n'), replaced: emptyLines.length };
}
