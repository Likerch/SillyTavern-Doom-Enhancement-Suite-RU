/**
 * Модуль 1. Перевод интерфейса DES на русский.
 *
 * План: MutationObserver только по корням DES (карта — в des-adapter.js), словарь
 * locales/ru.json (ключ — исходная английская строка), перевод текстовых узлов и атрибутов
 * title/placeholder/aria-label, тосты, сбор непереведённых строк с выгрузкой в JSON.
 * Пока заглушка.
 */
import { log } from '../log.js';

/** @type {import('../core.js').AddonModule} */
export default {
    id: 'localization',
    number: 1,
    title: 'Локализация интерфейса',
    description: 'Переводит кнопки, подписи, подсказки и уведомления DES. Текст чата, значения трекера, имена и лорбуки не трогает.',
    needs: { ui: true, data: false },
    stub: true,
    enable() {
        log.info('Модуль 1 (локализация): заглушка, перевод ещё не реализован.');
    },
    disable() {
        log.debug('Модуль 1 (локализация) остановлен.');
    },
};
