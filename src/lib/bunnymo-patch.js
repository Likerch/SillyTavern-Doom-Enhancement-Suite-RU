// Правки записей BunnyMo в текущем сканировании лорбуков (WORLDINFO_ENTRIES_LOADED). Без DOM и ST.
//
// ST отдаёт на каждое сканирование неглубокие копии записей: присваивать полям можно, мутировать
// массивы на месте нельзя (они общие с кэшем). Правка детерминирована — ST считает по записи хэш для
// «липкости» и перезарядки, и он должен совпадать от сканирования к сканированию.

import { ANTI_CLANKER_RU, ARCHETYPE_FORMAT_FIX, ARCHETYPE_NOTE_RU, DETECTOR_STEMS_RU, ROBOTIC_STEMS_RU, stemsKey } from './bunnymo-ru.js';
import { isRegexKey, nameFormsKey } from './regex-keys.js';

const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * @typedef {object} PatchSignatures признаки записей — из bunnymo-adapter.js
 * @property {readonly { id: string, comment: RegExp }[]} detectors
 * @property {RegExp} antiClanker
 * @property {RegExp} antiClankerAlpha
 * @property {readonly RegExp[]} noRecursionOut
 * @property {RegExp} archetypes
 *
 * @typedef {object} PatchOptions
 * @property {boolean} detectors детекторы: русские ключи и без срабатывания на тексте BunnyMo
 * @property {boolean} antiClanker «анти-клэнкер»: русские ключи, текст Alpha по-русски
 * @property {boolean} archetypes архетипы: <NPC name="…"> вместо невидимого для кириллицы <Имя>
 * @property {boolean} archiveKeys кириллические ключи архивов персонажей → все падежные формы
 *
 * @typedef {object} PatchStats
 * @property {number} detectors
 * @property {number} antiClanker
 * @property {number} noRecursion
 * @property {number} archetypes
 * @property {number} archiveKeys сколько ключей архивов заменено
 */

/** @param {unknown} list */
const asKeys = (list) => (Array.isArray(list) ? list.map(String) : []);

/**
 * Ключ, если его ещё нет в записи.
 * @param {any} entry
 * @param {string} key
 */
function addKey(entry, key) {
    const keys = asKeys(entry.key);
    if (keys.includes(key)) return false;
    entry.key = [...keys, key];
    return true;
}

/**
 * Кириллические обычные ключи записи → регулярки со всеми формами.
 * @param {any} entry
 * @param {(word: string) => string[]} formsOf
 */
function widenCyrillicKeys(entry, formsOf) {
    let replaced = 0;
    for (const field of ['key', 'keysecondary']) {
        const keys = asKeys(entry[field]);
        if (!keys.some((key) => CYRILLIC.test(key) && !isRegexKey(key))) continue;
        entry[field] = keys.map((key) => {
            if (!CYRILLIC.test(key) || isRegexKey(key)) return key;
            const regex = nameFormsKey(key, formsOf);
            if (!regex) return key;
            replaced += 1;
            return regex;
        });
    }
    return replaced;
}

/**
 * Правит записи одного сканирования.
 * @param {any[][]} lists globalLore, characterLore, chatLore, personaLore
 * @param {PatchOptions} options
 * @param {PatchSignatures} signatures
 * @param {{ isArchive: (entry: any) => boolean, formsOf: (word: string) => string[] }} helpers
 * @returns {PatchStats}
 */
export function patchEntries(lists, options, signatures, helpers) {
    const stats = { detectors: 0, antiClanker: 0, noRecursion: 0, archetypes: 0, archiveKeys: 0 };
    const detectorKeys = new Map(Object.entries(DETECTOR_STEMS_RU).map(([id, stems]) => [id, stemsKey(stems)]));
    const roboticKey = stemsKey(ROBOTIC_STEMS_RU);
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            if (!entry || typeof entry !== 'object') continue;
            const comment = String(entry.comment ?? '');
            const detector = signatures.detectors.find((item) => item.comment.test(comment));
            if (detector && options.detectors) {
                // Только текст чата: иначе «panic» из библиотеки каомодзи включает детектор паники.
                entry.excludeRecursion = true;
                const key = detectorKeys.get(detector.id);
                if (key) addKey(entry, key);
                stats.detectors += 1;
                continue;
            }
            if (signatures.antiClanker.test(comment) && options.antiClanker) {
                entry.excludeRecursion = true;
                addKey(entry, roboticKey);
                if (signatures.antiClankerAlpha.test(comment) && typeof entry.content === 'string') entry.content = ANTI_CLANKER_RU;
                stats.antiClanker += 1;
                continue;
            }
            if (options.detectors && signatures.noRecursionOut.some((pattern) => pattern.test(comment))) {
                entry.preventRecursion = true;
                stats.noRecursion += 1;
                continue;
            }
            if (options.archetypes && signatures.archetypes.test(comment) && typeof entry.content === 'string') {
                let content = entry.content;
                for (const [from, to] of ARCHETYPE_FORMAT_FIX) content = content.split(from).join(to);
                if (content !== entry.content) {
                    entry.content = content.replace(/(<\/BunnymoTags:[^>]*>)\s*$/, `${ARCHETYPE_NOTE_RU}\n$1`);
                    stats.archetypes += 1;
                }
                continue;
            }
            if (options.archiveKeys && helpers.isArchive(entry)) stats.archiveKeys += widenCyrillicKeys(entry, helpers.formsOf);
        }
    }
    return stats;
}
