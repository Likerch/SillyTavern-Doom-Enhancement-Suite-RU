// Мелкие элементы панели надстройки, общие для ядра и модулей.

/**
 * Кнопка в стиле ST: значок Font Awesome и подпись.
 * @param {string} icon класс значка, например `fa-copy`
 * @param {string} label
 * @param {() => void} onClick
 */
export function menuButton(icon, label, onClick) {
    const button = document.createElement('div');
    button.className = 'menu_button menu_button_icon';
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    const text = document.createElement('span');
    text.textContent = label;
    button.append(glyph, text);
    button.addEventListener('click', onClick);
    return button;
}

/**
 * Копирует текст в буфер обмена. Без защищённого контекста clipboard недоступен — тогда через выделение.
 * @param {string} text
 * @returns {Promise<boolean>} получилось ли
 */
export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        const copied = document.execCommand('copy');
        area.remove();
        return copied;
    }
}
