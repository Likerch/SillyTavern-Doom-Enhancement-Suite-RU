// Подсказки модели для модуля 3: погода и время в шаблоне трекера DES.

/**
 * Одно слово на каждый эффект DES — базовые формы, которые понимает русский словарь DES и без
 * наших дополнений. «облачно» и «в помещении» — без эффекта; «ясно» ночью DES рисует луной и звёздами.
 */
export const PROMPT_WEATHER_WORDS = Object.freeze(['метель', 'гроза', 'ветер', 'снег', 'дождь', 'туман', 'ясно', 'облачно', 'в помещении']);

/** Инструкция поля forecast. Стоит внутри кавычек JSON-шаблона, поэтому без двойных кавычек. */
export const WEATHER_INSTRUCTION_RU = `Одно значение из списка, по-русски и без пояснений: ${PROMPT_WEATHER_WORDS.join(', ')}`;

/** Заглушка значений времени в шаблоне: модель подставляет часы и минуты. */
export const TIME_PLACEHOLDER_RU = 'ЧЧ:ММ';

/** Фраза для «Инструкций трекера» DES в режимах без нашего промпта (separate/external). */
export const TIME_INSTRUCTION_RU = 'Время в трекере — всегда часы и минуты в формате ЧЧ:ММ, например 19:40.';

/**
 * Заменяет в тексте все точные вхождения `from` на `to`.
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {{ text: string, replaced: number }}
 */
export function replaceExact(text, from, to) {
    if (typeof text !== 'string' || !from || from === to) return { text, replaced: 0 };
    const parts = text.split(from);
    if (parts.length === 1) return { text, replaced: 0 };
    return { text: parts.join(to), replaced: parts.length - 1 };
}
