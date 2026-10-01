/**
 * Модуль 3. Служебные значения трекера: погода, время суток.
 *
 * План (решение по итогам разведки): инструкция модели через setExtensionPrompt в режиме
 * together и готовый текст для Prompt Editor DES в режимах separate/external; дополнение
 * русского словаря погоды DES в памяти (WEATHER_PATTERNS_BY_LANGUAGE) из редактируемого маппинга.
 * Значения в стейте DES не подменяются. Пока заглушка.
 */
import { log } from '../log.js';

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'serviceValues',
    number: 3,
    title: 'Служебные значения',
    description: 'Учит DES понимать русскую погоду в любой форме и просит модель писать время как ЧЧ:ММ, чтобы работали эффекты погоды и смена дня и ночи.',
    needs: { ui: true, data: true },
    stub: true,
    enable() {
        log.info('Модуль 3 (служебные значения): заглушка, логика ещё не реализована.');
    },
    disable() {
        log.debug('Модуль 3 (служебные значения) остановлен.');
    },
};
