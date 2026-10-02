// Версионный гард: по фактам от адаптера решает, что надстройке можно делать.
// Чистая функция без DOM и ST, проверяется тестами (tests/guard.test.js).

/**
 * @typedef {'ok'|'partial'|'mismatch'|'inactive'|'absent'|'st-disabled'|'not-loaded'|'error'} GuardState
 *
 * @typedef {object} GuardVerdict
 * @property {GuardState} state
 * @property {boolean} ui          можно переводить интерфейс DES (модуль 1)
 * @property {boolean} data        можно работать с данными и промптом DES (модули 2–4)
 * @property {boolean} desUpdated  показать предупреждение «DES обновился, нужна проверка селекторов»
 * @property {string} summary      одна строка для панели
 * @property {string[]} problems   что именно не сошлось
 * @property {string[]} notes      информационные замечания
 */

/**
 * @param {import('./des-adapter.js').DesFacts|null} facts `null` — проверка DES завершилась ошибкой
 * @param {{ verifiedVersions: readonly string[], templateMissing?: string[] }} options
 * @returns {GuardVerdict}
 */
export function evaluateGuard(facts, { verifiedVersions, templateMissing = [] }) {
    if (!facts) return verdict('error', 'Проверка DES завершилась ошибкой — подробности в журнале.');
    if (!facts.found) return verdict('absent', 'DES не найден — надстройке нечего делать.');
    if (facts.stDisabled) return verdict('st-disabled', 'DES выключен в менеджере расширений ST.');
    if (!facts.loaded) return verdict('not-loaded', 'DES не загрузился — смотри ошибки ST при запуске.');

    const label = facts.version ? `DES ${facts.version}` : 'DES';
    const notes = [];
    if (facts.version && !verifiedVersions.includes(facts.version)) {
        notes.push(`Версия ${facts.version} не проверялась, проверено на ${verifiedVersions.join(', ')}.`);
    }
    if (facts.missingOptional?.length) {
        notes.push(`Часть функций отключена: нет ${facts.missingOptional.join(', ')}.`);
    }
    if (facts.sameInstance === null) {
        notes.push('У DES ещё нет сохранённых настроек — не удалось подтвердить, что его модули подключены те же.');
    }

    const problems = [
        ...facts.missingSelectors.map((selector) => `нет элемента ${selector}`),
        ...facts.missingExports.map((name) => `нет экспорта ${name}`),
    ];
    if (facts.sameInstance === false) problems.push('модули DES подключились вторым экземпляром, его данные недоступны');
    const uiProblems = templateMissing.map((selector) => `в окнах DES нет ${selector}`);

    if (facts.ownEnabled === false) {
        return {
            ...verdict('inactive', `${label} выключен своим переключателем — модули 2–4 ждут его включения.`),
            ui: true,
            desUpdated: problems.length > 0,
            problems,
            notes,
        };
    }
    if (problems.length) {
        return {
            ...verdict('mismatch', `${label}: селекторы или экспорты не сошлись — модули 2–4 отключены, перевод работает по мере возможности.`),
            ui: true,
            desUpdated: true,
            problems: [...problems, ...uiProblems],
            notes,
        };
    }
    if (uiProblems.length) {
        return {
            ...verdict('partial', `${label} работает, но часть его окон изменилась — перевод может быть неполным.`),
            ui: true,
            data: true,
            desUpdated: true,
            problems: uiProblems,
            notes,
        };
    }
    return { ...verdict('ok', `${label} найден, проверки пройдены.`), ui: true, data: true, notes };
}

/**
 * @param {GuardState} state
 * @param {string} summary
 * @returns {GuardVerdict}
 */
function verdict(state, summary) {
    return { state, ui: false, data: false, desUpdated: false, summary, problems: [], notes: [] };
}
