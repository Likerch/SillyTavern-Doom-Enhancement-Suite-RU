// Единственное место, которое знает, как достучаться до SillyTavern.
// Модули ST импортируются динамически: если ST переименует файл, надстройка
// не упадёт при загрузке, а запишет понятную ошибку в свой журнал.

/** Корень `/scripts/` ST, считается от нашего адреса: .../scripts/extensions/third-party/<папка>/src/st.js */
const ST_SCRIPTS_ROOT = new URL('../../../../', import.meta.url);

/** Имя надстройки для ST в формате `third-party/<папка>`; папка совпадает с именем репозитория. */
export const ADDON_NAME = (() => {
    const match = decodeURIComponent(import.meta.url).match(/extensions\/(third-party\/[^/]+)\//);
    return match ? match[1] : null;
})();

export function getContext() {
    return SillyTavern.getContext();
}

/**
 * @param {string} path путь от `/scripts/`, например `extensions.js`
 * @returns {Promise<any>} пространство имён модуля ST
 */
export function importSt(path) {
    return import(new URL(path, ST_SCRIPTS_ROOT).href);
}

/** Класс наших уведомлений: локализация их пропускает — это не строки DES. */
export const OWN_TOAST_CLASS = 'desru-toast';

/**
 * Уведомление надстройки (toastr ST) с нашим заголовком и классом.
 * @param {'success'|'info'|'warning'|'error'} kind
 * @param {string} message
 * @param {Record<string, unknown>} [options] опции toastr
 */
export function notify(kind, message, options = {}) {
    const toastClass = `${toastr.options?.toastClass ?? 'toast'} ${OWN_TOAST_CLASS}`;
    toastr[kind](message, 'DES — RU', { ...options, toastClass });
}

/**
 * Вызывает `callback` один раз, когда ST сообщит о готовности приложения.
 * APP_READY у ST «липкий»: подписка после события срабатывает сразу.
 * @param {() => void} callback
 */
export function onAppReady(callback) {
    const { eventSource, eventTypes } = getContext();
    let called = false;
    const handler = () => {
        if (called) return;
        called = true;
        eventSource.removeListener(eventTypes.APP_READY, handler);
        callback();
    };
    eventSource.on(eventTypes.APP_READY, handler);
}
