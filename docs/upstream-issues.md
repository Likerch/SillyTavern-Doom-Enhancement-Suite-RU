# Что можно починить только в самом DES

Часть русских проблем DES (§11 `des-recon.md`) надстройка обходит снаружи — это модуль 4.
То, что ниже, снаружи не исправить или можно только обойти: нужен патч в самом DES.

Это готовые тексты issue для [репозитория DES](https://github.com/DangerDaza/Dooms-Enhancement-Suite/issues),
на английском, вставлять как есть. Отправлять их или нет — решаешь ты.
Ссылки — на коммит `10ad241` (v2.6.0). Код DES не копируется: только места и суть исправления.

---

## 1. Non-Latin field names produce empty JSON keys

> `toSnakeCase` / `toFieldKey` in `src/systems/generation/jsonPromptHelpers.js` (lines 15–32) keep only `[a-z0-9]`.
> - A character field named in Cyrillic (e.g. «Внешность», «Поведение») becomes the key `""`. The tracker template then contains several `"": …` lines (lines 282–290). The model receives an ambiguous template, and `JSON.parse` keeps only the last duplicate key.
> - A custom scene field with a non-Latin name is silently dropped by `getCustomSceneFields` (lines 127–129). It never reaches the prompt or the Scene Tracker.
>
> Suggested fix: build keys from Unicode letters (e.g. `/[^\p{L}\p{N}]+/gu`), or fall back to the display name when the ASCII key is empty. The display code already looks up the exact field name first (`src/systems/rendering/thoughts.js:376-386`), so the display name works as a key.

*В надстройке:* поля персонажа в режиме together обходятся модулем 4; для полей сцены — только предупреждение в панели.

## 2. `\b` word boundaries never match non-Latin names

> In JavaScript `\b` and `\w` are ASCII-only even with the `u` flag, so every partial name match fails for Cyrillic, Greek, CJK and other scripts:
> - `src/systems/rendering/chatBubbles.js:338` (colour → speaker scoring) and `:774-790` (`findClosestName`) — speaker attribution from narration never works for Cyrillic names;
> - `namesMatch` in `src/systems/ui/portraitBar.js:728-737`, `src/systems/rendering/thoughts.js:138-152`, `src/systems/features/avatarGenerator.js:207-219`;
> - `src/systems/ui/characterSheet.js:420-422`.
>
> Suggested fix: Unicode-aware lookarounds with the `u` flag, e.g. `(?<![\p{L}\p{N}_])NAME(?![\p{L}\p{N}_])`.

*В надстройке:* модуль 2 сам связывает цвета реплик с русскими именами (то же соседство, но с юникодными границами
и падежами) и приводит имена к каноническим — тогда срабатывает точное сравнение. Поиск автора реплики без цвета
снаружи не исправить.

## 3. `onChatChangedTtsCleanup` wipes SillyTavern's Chat Translation

> `index.js:3046-3075` deletes `extra.display_text` from every non-user message on every `CHAT_CHANGED`. SillyTavern's built-in translate extension stores translations exactly there. They disappear from memory on the next chat switch and from the chat file on the next save. Messages that contain `<font>` tags are also re-rendered from the original text.
>
> Suggested fix: run the cleanup once, as a migration behind a settings flag. Or remove only the `display_text` that DES itself wrote — the message text with `<font>` tags stripped.

*В надстройке:* обходится модулем 4 — переводы прячутся от очистки и возвращаются.

## 4. English-only meta markers

> Several features only understand English values, so non-English roleplay silently loses them:
> - the "character is off-scene" detector (`portraitBar.js:1252`, `thoughts.js:534`, `thoughts.js:1506`, `sceneHeaders.js:825`);
> - time-of-day words (`weatherEffects.js:23-59`);
> - the "no quest" sentinel, an exact `'None'` (`sceneHeaders.js:857`, `quests.js:42`, `quests.js:104`, `promptBuilder.js:411`, `:417`, `:585`).
>
> Suggested fix: expose these lists per language, the way `WEATHER_PATTERNS_BY_LANGUAGE` is exposed. That also gives add-ons a clean extension point.

*В надстройке:* «не в сцене» и «квеста нет» обходятся модулем 4, время суток — инструкцией модели в модуле 3.

## 5. `sanitizeFilename` strips non-ASCII names

> `src/systems/ui/portraitBar.js:1471-1473` keeps only `[a-zA-Z0-9_-]`. For a Cyrillic name the result is empty, so looking up a portrait by file name in `portraits/` never works.
>
> Suggested fix: keep `\p{L}` / `\p{N}` (with the `u` flag) and replace only characters that are invalid in file names.

*В надстройке:* снаружи не исправить; портреты, загруженные через Workshop, работают и так.

## 6. Typo in the Russian weather list

> `src/systems/ui/weatherEffects.js:130`: the `wind` group contains the single literal `"шквал,буря"` instead of two entries, `"шквал"` and `"буря"`. As a result «шквал» on its own never matches.

*В надстройке:* модуль 3 дописывает «шквал» в словарь погоды DES в памяти.

## 7. Weather matching: substrings, English first, a cache that never resets

> `parseWeatherType` (`src/systems/ui/weatherEffects.js:199-220`) lowercases the forecast, walks all `en` groups before `ru`, takes the first group whose pattern is a plain substring (`text.includes(pattern)`), and memoizes the result in `weatherTypeCache` (`:17`), which is cleared only after 200 entries (`:217`). In non-English roleplay this shows up as:
> - inflected forms never match: «дождливо», «метели», «ливни», «ясный» → no effect;
> - substring false positives: «безоблачно» (cloudless) contains «облачно» → no effect; «угроза» (threat) contains «гроза» → storm;
> - a mixed forecast such as "Cloudy, дождь" resolves by the English `cloud` → no effect;
> - the tracker prompt always lists the English keywords (`src/systems/generation/jsonPromptHelpers.js:195`, `getWeatherKeywordsAsPromptString('en')`), so a model writing in another language improvises;
> - patterns added to `WEATHER_PATTERNS_BY_LANGUAGE` at runtime (by an add-on or a future settings UI) do not apply to forecasts that were already parsed, because the cache is never reset.
>
> Suggested fix: match patterns at word starts (for example `new RegExp('(?<!\\p{L})' + pattern, 'u')`), so stems like «дожд» work and «угроза» no longer matches «гроза»; pick the earliest match across languages instead of strictly `en` first; list keywords in the prompt for the language the user plays in; clear `weatherTypeCache` when the patterns change, or export a function that does.

*В надстройке:* модуль 3 дописывает основы и формы, причём до первого разбора, и просит модель писать одно русское слово из списка. Ложные срабатывания самого DES («угроза» → гроза) снаружи не исправить.

## 8. Unreachable time words

> `parseHourFromTime` (`src/systems/ui/weatherEffects.js:23-59`) checks `night` (`:37`) before `midnight` (`:38`) and `late night` (`:39`). Both contain "night", so midnight is read as 22:00 and "late night" as 22:00 instead of 0 and 2.
>
> Suggested fix: check the longer phrases first.

*В надстройке:* модуль 3 просит модель писать время как ЧЧ:ММ — по цифрам DES час понимает.

## 9. Inflected and case-only variants of a card name create duplicate cards

> In languages with grammatical case the tracker often names a character the way the prose does: Russian «Ани», «Аней» for the card «Аня». `applyCharacterAliases` (`src/systems/features/characterAliases.js:567-618`) handles them inconsistently:
> - a one-letter difference ("Ани") goes to the Tier 2 popup;
> - a two-letter difference on a short name ("Аней") is below the `namesAreSimilar` threshold (`src/utils/nameSimilarity.js:62-70`) and silently becomes a new card;
> - a name equal to a card after `normalizeName` ("мира" for «Мира», "Алена" for «Алёна») is treated as "exactly an existing card" by `resolveStructuralVariant`, is NOT rewritten, and `getCharacterList` then creates a second card with that exact spelling.
>
> Suggested fix:
> 1. In Tier 1, when a name equals a card after `normalizeName`, rewrite it to the card's exact name.
> 2. Let add-ons plug a language-specific matcher into the similarity check (or emit an event before `applyCharacterAliases`).
> 3. Export a `removeCharacterAlias(canonical, alias)` next to `addCharacterAlias`.

*В надстройке:* модуль 2 дописывает такие формы алиасами ещё до разбора ответа (режим together).

---

# CarrotKernel и BunnyMo

Тексты issue для [CarrotKernel](https://github.com/Coneja-Chibi/CarrotKernel/issues) (коммит `145c273`) и
[BunnyMo](https://github.com/Coneja-Chibi/BunnyMo/issues) (V3.0, коммит `7a61c9f`). Как и выше — на английском, отправлять
или нет, решаешь ты. Код не копируется.

## CK 1. Non-Latin character names collapse to an empty string

> `findCharacterByName` in `index.js:1277-1347` compares names after `replace(/[^\w\s]/g, '')` and `replace(/[^a-zA-Z0-9\s]/g, '')`. Every Cyrillic (Greek, CJK…) name becomes `""`, so `""` from the searched name equals `""` from the first stored character, and the function returns whoever is first in `scannedCharacters`. With two Russian characters in a repo, `injectCharacterData` (`index.js:1404, 1455`) injects the first character's tags for both; `getTriggeredCharacters` and the card renderer get the wrong data too.
>
> Suggested fix: compare Unicode-aware keys, e.g. `name.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '')`, and never treat an empty variation as a match.

*В надстройке:* модуль 6 пересобирает вставку тегов и подменяет поиск генератора листов через `initializeSheetGenerator`.
Карточки в режиме «cards» снаружи не починить.

## CK 2. The persistent `<BunnyMoTags>` dump is empty and goes back to the model

> - `generatePersistentTagsBlock` (`index.js:3036-3066`) checks `values.size`, but tags stored by `processActivatedLorebookEntries` are arrays, so every category is skipped and the dump contains only names.
> - `initializeBunnyMoTagsContextFiltering` (`index.js:3290`) wraps `window.Generate`, which SillyTavern 1.19 no longer calls, so the dump is sent to the model with every message.
> - The dump makes Doom's Enhancement Suite show its "Import Character Sheet" button on ordinary replies (its detector accepts any `<BunnymoTags>` block, case-insensitively).
>
> Suggested fix: use `Array.from(values).length`; strip the dump in `CHAT_COMPLETION_PROMPT_READY` / `GENERATE_AFTER_COMBINE_PROMPTS`; or keep the dump out of `message.mes` (e.g. in `message.extra`).

*В надстройке:* модуль 6 вырезает дамп из промпта и убирает ложную кнопку DES.

## CK 3. `scan=true` on the consistency injection never reaches a scan

> `injectCharacterData` runs inside `WORLD_INFO_ACTIVATED`, after the World Info scan for this generation is finished, and the injection is `ephemeral=true`, so it is removed before the next scan. Pack entries with `excludeRecursion` (BunnyRX, CoT Lenses, parts of BSM-5 and MBTI) can therefore never be activated by character tags.
>
> Suggested fix: keep a non-ephemeral, scan-only copy of the active characters' tags (`position=none scan=true`) for the next generation.

*В надстройке:* модуль 5 делает такую вставку сам («паки по тегам персонажей сцены»).

## BunnyMo 1. Auto-trigger detectors fire on BunnyMo's own text

> The detectors (#46–#52) and Anti-Clanker Alpha (#55) have `excludeRecursion: false`, while always-on entries feed the recursion buffer: «panic» in the Kaomoji library (#25) fires the trauma detector, «close all `<think>` tags» in AUTO-FILTRATION: LINGUISTICS (#64) fires the attachment detector, «consistently» fires Anti-Clanker, `<MED:` in Medicine Check (#41) fires HawThorne Link — Medications.
>
> Suggested fix: `excludeRecursion: true` on the detectors and Anti-Clanker, `preventRecursion: true` on #25, #41 and #64.

## BunnyMo 2. Non-English play

> - All detector keys are English, so they never fire in a non-English roleplay; nothing tells the model which language to write sheets in, and models tend to translate the tags, which silently breaks the packs.
> - The archetype line `<Name> <MBTI>` (#12) is shown as text when the name starts with a non-Latin letter (`<Алиса>` is not an HTML tag).
>
> Suggested fix: a short language rule in the sheet commands («prose in the user's language, tags and SECTION headers in English»); a hidden format like `<NPC name="…">` for the archetype line.

*В надстройке:* модуль 5 — языковой замок, русские ключи детекторов, нормализатор листов, формат архетипов.
