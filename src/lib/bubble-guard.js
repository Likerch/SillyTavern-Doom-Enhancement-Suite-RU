// Пузыри DES там, где он их потерял. Без DES и без ST: что такое «пузыри» и как их разложить, приходит снаружи
// (des-adapter.js), таймеры — тоже, чтобы тесты шли без ожидания.
//
// DES раскладывает сообщение по пузырям только по событиям ST (CHARACTER_MESSAGE_RENDERED, MESSAGE_UPDATED,
// MESSAGE_SWIPED) и помечает это атрибутом на самом .mes_text. Перерисовка текста без события (ST updateMessageBlock,
// innerHTML) этот элемент не заменяет: атрибут остаётся, разметки нет, и DES больше не трогает сообщение — до тех
// пор, пока пользователь не откроет и не закроет редактор. Так делали NAI Studio до 0.15.1 (картинка дорисовалась
// после ответа) и Maestro до 1.21.1 (чистка ответа); так делает CarrotKernel (блок тегов). Правильно — сообщить
// о перерисовке событием MESSAGE_UPDATED, как редактор ST; сторож ловит тех, кто этого не делает.
//
// Сторож смотрит, кто переписал детей .mes_text, и через паузу — дольше, чем DES ждёт перед своей раскладкой по
// событию, — проверяет сообщение. Пузыри потеряны — раскладывает заново. Не трогает сообщение, которое
// редактируют (в .mes_text стоит textarea редактора ST) или которое сейчас пишет модель (последнее во время
// генерации: его перепишет каждый следующий кусок ответа). Сообщение, где раскладка заново пузырей не дала
// (в нём нет текста для пузырей — DES отдаёт пустую разметку), второй раз не трогает: иначе был бы круг.

/**
 * @typedef {object} BubbleGuardDeps
 * @property {(messageElement: Element) => 'none'|'laid'|'lost'} state пузыри сообщения (desBubbleState)
 * @property {(messageElement: Element) => boolean} restore разложить потерянные заново; `false` — не пришлось
 * @property {() => void} [afterRestore] после восстановления: DES держит внутри .mes_text и мысли персонажей
 * @property {(messageElement: Element) => boolean} isLast последнее сообщение чата
 * @property {() => boolean} [streaming] ST сейчас пишет ответ в ленту (его StreamingProcessor не закончил): страховка
 *   к флагу генерации — GENERATION_ENDED приходит и от чужих генераций
 * @property {() => boolean} [enabled] переключатель; читается на каждой проверке
 * @property {number} delayMs пауза после последней перерисовки сообщения
 * @property {(callback: () => void, ms: number) => unknown} [setTimer]
 * @property {(timer: any) => void} [clearTimer]
 * @property {(messageElement: Element) => void} [onRestored] для журнала и счётчиков
 */

export class BubbleGuard {
    /** @param {BubbleGuardDeps} deps */
    constructor(deps) {
        this.deps = deps;
        this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
        this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer));
        /** @type {Map<Element, unknown>} */
        this.timers = new Map();
        /** .mes_text, у которых раскладка заново пузырей не дала. */
        this.barren = new WeakSet();
        /** Модель пишет ответ: последнее сообщение не трогаем. */
        this.generating = false;
        this.restored = 0;
    }

    /**
     * Записи MutationObserver по #chat (childList, subtree): берём только те, где переписаны дети самого .mes_text —
     * так выглядит перерисовка текста; вставки внутрь пузырей и картинок сюда не относятся.
     * @param {Iterable<{ target: any }>} records
     */
    observe(records) {
        if (this.deps.enabled && !this.deps.enabled()) return;
        for (const record of records) {
            const target = record.target;
            if (!target || target.nodeType !== 1 || !hasClass(target, 'mes_text')) continue;
            const messageElement = target.closest?.('.mes[mesid]');
            if (messageElement) this.schedule(messageElement);
        }
    }

    /** @param {Element} messageElement */
    schedule(messageElement) {
        const pending = this.timers.get(messageElement);
        if (pending !== undefined) this.clearTimer(pending);
        this.timers.set(messageElement, this.setTimer(() => {
            this.timers.delete(messageElement);
            this.check(messageElement);
        }, this.deps.delayMs));
    }

    /**
     * @param {Element} messageElement
     * @returns {boolean} пузыри разложены заново
     */
    check(messageElement) {
        if (this.deps.enabled && !this.deps.enabled()) return false;
        if (/** @type {any} */ (messageElement).isConnected === false) return false;
        const mesText = messageElement.querySelector('.mes_text');
        if (!mesText || this.barren.has(mesText)) return false;
        // Открыт редактор сообщения ST: textarea стоит прямо в .mes_text, текст вернётся при закрытии.
        if (mesText.querySelector('textarea')) return false;
        if ((this.generating || this.deps.streaming?.()) && this.deps.isLast(messageElement)) return false;
        if (this.deps.state(messageElement) !== 'lost') return false;
        if (!this.deps.restore(messageElement)) return false;
        if (this.deps.state(messageElement) !== 'laid') this.barren.add(mesText);
        this.restored += 1;
        this.deps.afterRestore?.();
        this.deps.onRestored?.(messageElement);
        return true;
    }

    /** @param {boolean} value */
    setGenerating(value) {
        this.generating = value;
    }

    dispose() {
        for (const timer of this.timers.values()) this.clearTimer(timer);
        this.timers.clear();
    }
}

/** classList есть не у всех узлов (маленький DOM тестов): читаем атрибут. @param {any} element @param {string} name */
function hasClass(element, name) {
    if (element.classList?.contains) return element.classList.contains(name);
    return String(element.getAttribute?.('class') ?? '').split(/\s+/).includes(name);
}
