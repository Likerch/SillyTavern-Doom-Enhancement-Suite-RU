<!-- Техническая карта интерфейса CarrotKernel для движка перевода (модуль 6). По-английски, со ссылками на строки кода CK
     (коммит 145c273); код CK сюда не копируется. Карта CK_UI в src/ck-adapter.js собрана по §14. Составлена при подготовке
     словаря locales/ru.carrotkernel.json; при обновлении CK сверять заново. -->

# CarrotKernel UI map for the DES-RU localization engine

Source: `vendor/CarrotKernel` at commit 145c273 (read-only). All references are `file:line` in that folder.
Abbreviations: **IX** index.js, **SH** settings.html, **BB** baby-bunny-mode.js, **CV** chunk-visualizer.js,
**FR** fullsheet-rag.js, **LC** lorebook-connector.js, **WT** worldbook-tracker.js, **CR** card-renderer.js,
**TE** template-editor.js, **RM** repository-manager.js, **TU** tutorials.js, **UI** ui-updates.js, **PM** pack-manager.js.

Dead code (no UI ever reaches the DOM): bunnymo_class.js (never imported), sheet-generator.js / debugger.js /
context-manager.js / carrot-state.js (no DOM), IX:4835-6514 (pack grids, tutorial-overlay helpers, lorebook/settings/profile
tab generators, the index.js copy of `manualScan`), IX:8203-8375 (`showContextSelectionPopup`, "Choose Storage Level"),
IX:8446-8575 (chunk-modal handlers, unbound by CV:847-858 on every open; only the case toggle IX:8578-8595 is live),
IX:9162-9323 and IX:9698-9804 (pack scan/sync/update buttons and `updatePackListUI`: `#carrot-pack-scan`, `#carrot-pack-list`…
do not exist), UI:128-139 (`cachedPackSummary` is never set), the BB tutorial popup BB:3630-3930 (`showTutorialBabyBunnyPopup`,
exposed on `window.CarrotKernel` but never called), the TU overlay TU:273-377, RM:528-559/666-674/716-725, CR:1005-1115.
The dictionary skips strings that only exist in dead code.

---

## 0. Summary

| # | Root (selector) | Parent | Lifecycle | Suggested mode |
|---|---|---|---|---|
| 1 | `#carrot_settings` (class `carrot-extension-settings`) | **`#extensions_settings`** (not `…2`), IX:7219-7220 | persistent | full + excludes |
| 1a | `#carrot-popup-overlay` (popup host, contains `#carrot-popup-container`) | inside `#carrot_settings` (SH:823-827), never moved | persistent node, content temporary | full (covered by 1) |
| 1b | `#carrot-rag-visualizer-modal` (Chunk Visualizer) | inside `#carrot_settings` (SH:855-900) | persistent, shown/hidden | full (covered by 1) |
| 2 | `#carrot-main-lorebook-popout` + `#carrot-popout-backdrop` | `body` (IX:9537-9538) | temporary; **moves** `#carrot-lorebook-management > .carrot-card-body` out of `#carrot_settings` and back | full |
| 3 | `.baby-bunny-overlay` (single / batch popups) | `body` (BB:1079, 1819) | temporary | full + excludes |
| 4 | `#carrot-baby-chunking-modal` | `body` (BB:2602) | temporary (removed 300 ms after close) | full + excludes |
| 5 | `.carrot-connection-overlay` (Lorebook Connections) | `body` (LC:284) + an anonymous `<style>` sibling | temporary | full + excludes |
| 6 | `.ck-panel`, `.ck-config-panel`, `.ck-trigger` (WorldBook Tracker) | `body` (WT:2256, 2485, 2070) | persistent, shown/hidden | full + excludes |
| 7 | `.bunnymo-tag-popup` (Tag Details) | `body` (CR:1981) | temporary | full + excludes |
| 7a | anonymous `body > div` (WorldBook search popup / "WorldBook search not available" notification) | `body` (CR:2028, 2058) | auto-removed after 3 s / 2 s | text match only |
| 8 | `#carrot_lorebook_connector_button` (🐰) | after ST `#world_button` (IX:9377-9379) | persistent | title only |
| 9 | ST option `#set_character_world` | ST `#char-management-dropdown` | text overwritten once (IX:9415) | one text node |
| 10 | chat roots, see §8 | `#chat` | per message | chrome |
| 11 | toasts | `#toast-container` | temporary | text nodes |
| 12 | ST popup (delete collection) | `dialog.popup .popup-content` | temporary | as DES `translatePopup` |

Observation advice:
- Observe `#extensions_settings` children (childList, no subtree) to catch `#carrot_settings`; then one deep observer on `#carrot_settings`
  covers the popup host, the chunk visualizer, the status panels and the lorebook list.
- Observe `body` children (no subtree) for roots 2-7a and the select2 dropdowns. The overlays can open **without user action**:
  the Baby Bunny single/batch popup opens on `CHARACTER_MESSAGE_RENDERED` when Baby Bunny Mode is on (IX:6844-6861).
- Inside `#chat`, accept only the chat roots of §8; everything else in `.mes_text` is chat data.
- Use `attributeFilter: ['title', 'placeholder', 'aria-label']`. CK floods `style`: `showCarrotPopup` sets inline `pointer-events:auto`
  on every descendant 50 ms after opening (IX:3490-3492), hover handlers rewrite styles everywhere (CR:710-724, 904-912, 1838-1852;
  IX:343-368), drag/resize of the tracker trigger changes style on every pointermove (WT:1847-1848, 2007-2008).
- CK has no own i18n and no `data-i18n` (except one ST-style `span[data-i18n="Content"]` in chunk cards, CV:473, BB:3244).
- **`data-tooltip` is dead in CK**: 19 attributes (SH:12, 130, 593, 612, 631, 670, 689, 712; IX:3733, 3736, 3739, 3742, 3932, 4006,
  4009, 4016, 4059, 4065, 4071), but
  nothing renders them — no CSS `attr(data-tooltip)`, no CK JS reader, and ST 1.19 only reads `data-tooltip` on its own bookmark
  flag (`scripts/bookmarks.js:312`). The current draft `CK_UI.attributes` includes `'data-tooltip'`: translating it changes nothing
  visible and only feeds the untranslated-strings collector, so I'd drop it. (BB:3077 copies `data-tooltip-on/off` into `title`;
  those `title`s are translated normally.)
- CK's only MutationObserver: WT:2146-2155, `observe(panel, { attributes: true })` on `.ck-panel` — never add/remove classes
  on `.ck-panel`.
- CK reads translated text back only in a few places (see §11); no logic compares English button labels.

---

## 1. Settings panel `#carrot_settings`

**Mount.** `$('#extensions_settings').append(settingsHtml)` inside the async init IIFE (IX:6973-7348, append at 7219-7220). Persistent.
`#carrot_settings > .inline-drawer > .inline-drawer-content` holds the cards in this order: `#carrot-feature-controls`,
`#carrot-rag-settings` (inline drawer, collapsed), `.carrot-status-section`, `#carrot-lorebook-management`, `.carrot-help-section`,
`#carrot-popup-overlay`, `#carrot-tutorial-overlay`, `#carrot-rag-visualizer-modal`.

**Late bind.** `bindSettingsEvents()` (IX:7422) waits for `#carrot-pack-scan`, which does not exist; `waitForElement` polls 10 s and
rejects (IX:7426-7472), then `bindActualEvents()` (IX:7474-8439) runs. So ~10 s after load there is a burst: `.text()` on every slider
value span, `#carrot_rag_url_hint_text`, the provider-warning check, show/hide of RAG containers, RAG init. Everything after IX:8441
binds immediately.

**Class `carrot-disabled`** on `#carrot_settings` (IX:7394/7412) is set only when Master Enable is switched off during the session.
It activates CSS text the DOM engine cannot reach (see §12).

### 1.1 Texts that JS rewrites (all `.text()` → one text node; none are read back)
- Status panels (`updateStatusPanels`, UI:26-141). Triggers: module-level `setTimeout(500)` (IX:603-605; may run before the panel exists,
  so "Initializing...", "0 characters indexed" can stay), Master toggle (IX:7494), AI Injection toggle (7523), lorebook checkbox (9023),
  repo button (9092), scan button (9125, 9131), RM:208. No interval.
  - `#carrot-system-status`: 'Active and Ready' / 'Disabled' (UI:41/46); `#carrot-system-detail`: 'Click to open tutorial' / 'Click to learn how to enable'.
  - `#carrot-repo-status`: `${n} characters indexed` (UI:62, always plural), `${n} lorebooks selected` (67), '0 characters indexed' (72);
    `#carrot-repo-detail`: `From ${n} repositories` (63), 'Click to scan for characters', 'Click to manage repositories'.
  - `#carrot-injection-status`: 'Disabled' / 'AI Injection Off' / 'Standby' / 'Ready'; `#carrot-injection-detail`: 'System disabled' /
    'Hover for details' / 'No characters to inject' / `${n} characters available` (104).
  - `#carrot-injection-tooltip-status` (inside the hover tooltip `#carrot-injection-tooltip`): 'System Disabled' / 'AI Injection Disabled' /
    'Waiting for character data' / `Ready to inject ${n} characters` (106).
  - `#carrot-pack-status`: 'Disabled' / 'Ready for management'; IX:7132-7136 writes three `<p>` with `.html()` 2 s after the third failed
    pack-manager init ("❌ Pack Manager failed to initialize after ${retries} attempts.", a Refresh Page button, "💻 Open console…").
    `#carrot-pack-detail`: 'System disabled' / 'Click to install and update packs'.
  - `#carrot-template-status` / `#carrot-template-detail` are never written.
- Slider value spans (numbers only; written on every `input` event while dragging): `#carrot_max_display_value`, `#carrot_max_inject_value`,
  `#carrot_injection_depth_value`, `#carrot_rag_topk_value`, `#carrot_rag_threshold_value`, `#carrot_rag_context_value`,
  `#carrot_rag_chunksize_value`, `#carrot_rag_overlap_value`, `#carrot_rag_depth_value`, `#carrot_rag_crosslink_value`,
  `#carrot_rag_keyword_limit_value` (IX:7638-7840).
- `#carrot_rag_url_hint_text` (IX:7944) from the map IX:7936-7939 ("Set the {Ollama|llama.cpp|KoboldCpp|vLLM} URL in the Text Completion
  API connection settings.").
- `#carrot_rag_old_provider` / `#carrot_rag_new_provider` (IX:8066-8067): provider display name `source` or `${source} (${model})` — **data**.
- `#carrot_rag_revectorize_btn`: `.html()` → spinner + " Re-vectorizing..." (IX:8100); the HTML captured at click time is restored (8093/8177).
- `#carrot-scan-btn`: `.text('Scanning...')` (IX:9110) then `.text('Scan Selected Lorebooks')` (9130) — this deletes its `<i>` icon.
- `.carrot-repo-btn` / `.carrot-lorebook-status` in the lorebook list: '📚'/'👤', '🔄 Wrapping...', '🔄 Unwrapping...' (`.text()`), '📚 Tag Lib' /
  '👤 Char Repo' (`.html()`) (IX:9028-9094).
- Chunk visualizer labels: see §1.4.

### 1.2 Lorebook list `#carrot-lorebook-list` (in `#carrot-lorebook-management .carrot-card-body`)
- Built wholesale once by `updateLorebookList()` (IX:2337-2458, called at IX:7223), replacing "Loading available lorebooks...". Never
  rebuilt; later changes are incremental (above). The search hides items with `.toggle()` (IX:9153-9159).
- Item: `.carrot-lorebook-item > label.carrot-lorebook-checkbox` (`input.carrot-lorebook-toggle[data-lorebook]`, `span.carrot-lorebook-name`,
  for suggested items a `div` of badge spans '🌍 Global' / '🐰 BunnyMo') + `.carrot-lorebook-actions` (`span.carrot-lorebook-status`
  '👤 Char Repo' / '📚 Tag Lib', `button.carrot-repo-btn[data-lorebook][title="Toggle between Character Repository and Tag Library"]`).
  Group headings '✨ Suggested', 'All Lorebooks' (`#carrot-lorebook-list > div:not(.carrot-lorebook-item) > div`), empty state
  `.carrot-empty-state` 'No lorebooks found'. `text-transform: uppercase` on statuses and headings — keys are mixed case.
- **Data:** `.carrot-lorebook-name` (lorebook names, unescaped; **the search reads it back with `.text()`**, IX:9156), all `data-lorebook`.
- **Popout:** `#carrot-main-lorebook-popout-btn` (title "Open in separate window") moves the whole card body to `body` (§2).

### 1.3 RAG Saved Data Viewer `#carrot-rag-collections-list`
- Rebuilt wholesale with `.html()` on `#carrot-rag-refresh-viewer` click (IX:8635) and after toggle (8764), rename (8781), move (8901),
  delete (8990, +100 ms). Then async `.text()` per collection into `.token-value` (IX:8730, 8734), possibly seconds later.
  Changing `#carrot_rag_viewer_context` does not re-render. `#carrot-rag-empty-state` is hidden at the first refresh.
- Empty: a div, rich unit `No collections saved yet for <strong>${ctx}</strong> storage. Generate and save a fullsheet first!` (IX:8652),
  ctx = option value global / character / chat.
- Header: rich unit `Found ${n} collection${n > 1 ? 's' : ''} in <span style="text-transform: uppercase; color: #8b5cf6;">${ctx}</span> storage` (IX:8659).
- Per collection (IX:8671-8707): display name div (**data**: `div:has(> .carrot-rename-collection-btn) > div`), rename button title,
  collection id div (**data** text, but its `title` "Internal database identifier - cannot be changed" is UI: text-data/title-UI element,
  select it structurally: `div:has(> .carrot-rename-collection-btn) + div`), toggle `div.carrot-toggle-collection-btn[title]`,
  buttons "View Chunks", "Move to...", delete title; stats `<div><strong>Chunks:</strong> N</div>`, `.collection-token-count` /
  `.collection-avg-token-count` with `<strong>Total Size:</strong>` / `<strong>Avg Size:</strong>` + `span.token-value` "`N tokens`"
  (`toLocaleString()`, so "12,345" in en-US and "12 345" in ru-RU), `<strong>Sections:</strong> N`. Numbers after `<strong>` are bare text nodes.
- `[data-collection]` attributes are read by handlers.

### 1.4 Chunk Visualizer `#carrot-rag-visualizer-modal` (SH:855-900; logic CV)
- Opened by `.carrot-view-chunks-btn` (IX:8767-8770 → IX:3526 → CV:129). Shown with `.addClass('is-visible').fadeIn` (CV:188-193), hidden
  at CV:203-205. Persistent node; mutations happen even while hidden.
- On every open: `#carrot-rag-modal-title` rebuilt with `.html()` → `<i class="fa-solid fa-cube"></i> ${name} <span …>[${contextLevel}]</span>`
  (CV:161-163; replaces the static "Chunk Visualizer"); `#carrot-rag-modal-subtitle` `.text(\`${n} chunks\`)` (CV:164, not refreshed after
  add/delete); `.chunk-format-label` 'Formatted'/'Plain' (CV:171, 861); `.chunk-case-label` 'Case: Match'/'Case: Ignore' + the
  `#carrot-rag-case-toggle` title (CV:174-182; also the live handler IX:8578-8595, which also toasts). Labels are never read back
  (state is in JS).
- `renderChunks` (CV:233-322) rebuilds `#carrot-rag-chunk-stats` (labels `.chunk-stat__label` Showing/Total/Average/Sections, values
  `.chunk-stat__value` "N" or "`${n.toLocaleString()} chars`") and `#carrot-rag-chunks-container` (cards, or `.chunk-empty-state p`
  "No chunks match your filters.") with `.html()`, then after 10 ms runs select2 per card and an async token count into `.token-count`.
- **Full rebuild on every `input` keystroke in `#carrot-rag-chunk-search`** (CV:853-855), on the format toggle, add, any card chevron,
  enable toggle, delete, keyword refresh, prompt edit, link checkbox, link-mode radio. The fancy/plaintext switch replaces one card
  (`replaceWith`, CV:709-725).
- Card structure and data zones: §6 (shared with the Baby Bunny chunking modal).

### 1.5 Data zones in `#carrot_settings` (exclude)
- `input`, `textarea`, `select` values (the engine already skips form fields).
- `.carrot-format-code` (SH:808-814, the long BunnyMoTags example) and `.carrot-tooltip-example code` (SH:663).
- `.carrot-slider-icon` (emoji; two are mojibake `dY"X`, `dY"&`, SH:455, 482).
- `.carrot-lorebook-name`, `#carrot_rag_old_provider`, `#carrot_rag_new_provider`, model `<select>`s `#carrot_rag_openai_model`,
  `#carrot_rag_cohere_model`, `#carrot_rag_google_model`, `#carrot_rag_togetherai_model` (option text = model ids).
- RAG viewer: collection display name and id (§1.3); slider value spans (numbers).
- Chunk visualizer: `#carrot-rag-modal-title` (name; the `[global]` span is an enum, translating it is optional), `#carrot-rag-chunks-container`
  data zones (§6).
- Popup host contents: §3.

### 1.6 Mixed chrome + data in one node (settings)
- Slider headers: "Max Characters Displayed: <span id>6</span>" etc. — the label text node is separate from the value span (fine).
  "Consider last <span id>3</span> messages" and "Section size: <span>1000</span> chars" split a sentence around a number (fragments).
- Provider warning paragraph: "Your embedding provider has changed from" `<strong id>` "to" `<strong id>` ". Embeddings …" — the `<strong>`s
  have ids, so the paragraph is not a rich unit; fragments only.
- `<p><strong>Current Status:</strong> <span id="carrot-injection-tooltip-status">Ready</span></p>` — separate nodes.

---

## 2. Main lorebook popout `body > #carrot-main-lorebook-popout`
- Built from ST's `#zoomed_avatar_template`, re-id'd, emptied (IX:9441-9465); children `.panelControlBar` (grip
  `#carrot-main-lorebook-popout-header`, `<h3>` "📚 Lorebook Management", `button.dragClose > span` "Close") + an unnamed content wrapper
  `div` (`#carrot-main-lorebook-popout > div:last-child`, IX:9497-9506). Backdrop `#carrot-popout-backdrop`.
- Opening **moves** `#carrot-lorebook-management > .carrot-card-body` into the wrapper (IX:9553-9554) and adds a placeholder
  `#carrot-main-lorebook-placeholder.carrot-card-body` "Currently viewing in separate window" (IX:9609-9612) to `#carrot-lorebook-management`.
  Closing moves it back and removes popout, backdrop and placeholder (IX:9668-9674). An observer rooted at `#carrot_settings` misses
  the moved node while it is popped out; moving back produces remove + add mutations.
- IX:9553 finds the wrapper positionally (`find('div').last()`): do not inject elements.
- Triggers: `#carrot-main-lorebook-popout-btn`, `.dragClose`, backdrop click, Esc (IX:9418-9422, 9548, 9532, 9691-9695).

---

## 3. Popup host `#carrot-popup-overlay` (inside `#carrot_settings`)

`showCarrotPopup(title, content)` (IX:3363-3500), also `window.showCarrotPopup`, `CarrotKernel.showPopup`:
- **Wrapped mode** (IX:3422-3434): `#carrot-popup-container` innerHTML = `.carrot-popup-content > .carrot-popup-header > h4{title, raw}` +
  `button.carrot-popup-close` "✕" (no title/aria) + `.carrot-popup-body{content}`.
- **Raw mode** (IX:3376-3419) when the content contains `carrot-repo-browser` / `carrot-github-browser` or the title contains
  `BunnyMo Repository`: content goes straight into the container, class `.carrot-repo-browser-popup`; **the title is not rendered**.
- Shown with inline `display:flex` + `.active` (IX:3469-3480); +50 ms style flood (IX:3490-3492).
- `closeCarrotPopup` (IX:3503-3518): removes `.active`, after 300 ms `.hide()` + `#carrot-popup-container.empty()`.
  Race: "Back to Repository Manager" (RM:710-713) and the pack install Cancel (IX:4636-4640) re-open synchronously; the pending
  `.empty()` then wipes the new popup.
- **`#carrot-popup-container` is not stable:** the Move Collection dialog does `$('#carrot-popup-overlay').html(popup)` (IX:340) and
  later `.empty()` on the overlay (383/398), destroying the container; nothing recreates it. **Observe `#carrot-popup-overlay`.**

Popups rendered here (all temporary, rebuilt wholesale on each show):

| Popup | Code | Mode | Notes |
|---|---|---|---|
| "CarrotKernel Disabled" | IX:3576-3579, 3602-3605, RM:68-71 | wrapped | `<p>` sentence + `<p>Click the <strong>Master Enable</strong> toggle in the Feature Controls section.</p>` |
| "Baby Bunny Mode Tutorial 🐰" | IX:3532-3555 (settings tutorial card 5) | wrapped | headings, 4 `<li><strong>Label:</strong> text</li>`, 3 `<li><code>!fullsheet …</code> - …</li>` (`<code>` = commands) |
| Template Editor | TE:997-1070 → IX:3425 | wrapped, h4 "Template Editor" | §3.1 |
| Template Preview | TE:1415-1437 | wrapped | body `div` = raw processed template (**data**) |
| Character Repository Manager | RM:126-188 | raw (`.carrot-repo-browser`) | §3.2 |
| Character Details - {name} | RM:677-707 | wrapped, h4 has the name | §3.2 |
| BunnyMo Repository (pack manager) | IX:3660-3715, 3719-3844 | raw (`.carrot-github-browser` / `.carrot-repo-browser`) | §3.3 |
| Repository Connection Error | IX:3702-3714 | wrapped | `.carrot-error-details` = error text (data) |
| 🥕 Pack Installation / 🎉 Installation Complete / ❌ Installation Failed | IX:4157-4200, 4562-4595, 4603-4631 | wrapped | §3.3 |
| WorldBook Tracker | IX:9819-9941 (capture click on any `.fa-carrot`) | wrapped | body "Loading tracker..." forever (nothing fills it) |
| Move Collection | IX:219-403 | **replaces the overlay's children** | §3.4 |

### 3.1 Template Editor `#bmt_template_prompt_interface.bmt-template-interface` (TE:13-149)
- t0 insert; +100 ms a hidden copy of `#carrot-tutorial-overlay` is appended to `#carrot-popup-container` (TE:1002-1053, duplicate ids,
  never shown); `#bmt_template_selector` options rebuilt (`.empty()` + `.append`, TE:1077-1086); +200 ms `update_macros()` empties and
  rebuilds `#macro_definitions` completely (TE:367-477): two `.bmt-macro-category-section` ("CarrotKernel Macros", "SillyTavern System
  Macros") with ~58 `div.macro_definition.bmt_interface_card#macro_{NAME}` cards — **the biggest mutation burst in CK**.
- Rebuilds: template change (TE:1282-1285, then macros +100 ms), duplicate/delete/reset (TE:1439-1525), macro enable toggle
  re-creates that card's description and contents (TE:545-551, 696-722). New Macro prepends a card (TE:519). Typing in `#prompt` changes
  no DOM.
- **Data:** `textarea#prompt` (value and its default child text node, TE:80-91 — never touch it), `#bmt_template_selector option:not([value=""])`
  (template names; built-in names are English literals from sheet-generator.js, custom ones prefixed "✏️ "), `input.macro_name`,
  macro names everywhere (`{{…}}` and UPPER_SNAKE tokens), `.bmt-category-count` (numbers), the monospace example output blocks
  `.bmt-macro-description div[style*="monospace"]` (TE:734-849).
- `#template_type` (system/user/assistant) and `#template_category` (**option value = English label**, TE:121-127) are read/written with
  `.val()`: translate option text only, never `value`.
- Macro documentation (`.bmt-macro-description`, TE:724-868): purpose/use-case prose — left out of the dictionary (licence), only
  headers and the generic fallback strings are included.

### 3.2 Character Repository Manager `.carrot-repo-browser` (RM)
- Opened from SH:613 → RM:65-80. Parts: `.carrot-repo-header-card` (RM:128-164), `.carrot-repo-breadcrumb` (RM:168-170/236-268),
  `#carrot-repo-file-list` (RM:172-174/271-279), `#carrot-repo-preview` (RM:180-182/282-338). Views home (RM:385-427), repository
  (RM:430-464), character (RM:467-525).
- Wholesale `$container.html()` on every navigation (breadcrumb, double-click repo, click character, `[data-repo-nav]`); a single click
  on a repo replaces only `#carrot-repo-preview` (RM:348-368).
- Rescan button `button[onclick="manualRepositoryScan()"]`: textContent read (RM:200) and overwritten '⏳ Scanning...' / `✅ Found ${n} characters`
  / '🔄 Rescan Repositories' / original (RM:202-229), destroying its icon. +500 ms adds `div#carrot-characters-list` at the end of
  `#carrot-popup-container` (RM:581-663).
- Tutorial button (RM:138) closes the popup and throws (ReferenceError).
- **Data:** `.carrot-repo-file-name` (repo / character / category names; fallback 'Unknown'), `.carrot-repo-breadcrumb-item[data-repo-nav]`,
  `.carrot-repo-breadcrumb-active` without `<i>` (RM:249-265, shows "Lorebook::NAME"), `.carrot-repo-preview-info > h4` (RM:307),
  `ul.carrot-repo-character-quick-list li > strong` (RM:298), tag value chips `#carrot-repo-file-list > div[style*="56px"] > span`
  (RM:518-520), source value `div[style*="font-size: 13px"]` (RM:498), `#carrot-characters-list` names (`div[style*="font-size: 14px"]`),
  Character Details: h2 `🎭 {key}`, text after "Source:", `.carrot-tag-item` (prints "[object Set]").
- **Mixed (one text node):** RM:483 ` ${name} • ${n} category|categories` (character view summary) — data and chrome in one node, can only
  be matched by a `{name} • {#n} categories` template; RM:297-298 `🟢 ` + `<strong>${name}</strong>` + ` - ${n} tags`.

### 3.3 Pack manager / GitHub browser (IX:3587-4822; PM and github-browser.js have no DOM)
- `openPackManager` (IX:3587-3615; from SH:690, the Retry button, and the sticky update toast click PM:789). Loading popup
  `.carrot-github-browser > .carrot-loading-state` (IX:3662-3674), 30 s timeout.
- Browser `.carrot-repo-browser` (IX:3719-3844): header card with icon-only buttons (`.carrot-refresh-btn`, `.carrot-home-btn`,
  `.carrot-detect-btn`, `.carrot-close-btn`; only dead `data-tooltip`), `#carrot-breadcrumbs`, `#carrot-browser-stats`, `#carrot-file-list`,
  `#carrot-file-preview`, footer. `updateBrowserContent` (IX:3845-3922) rebuilds breadcrumbs, file list (first a "Checking for updates..."
  state, which can persist for seconds of GitHub requests), stats — all innerHTML, on every click (row, breadcrumb, home, refresh, detect,
  install). `previewFile` (IX:4643-4822) rebuilds `#carrot-file-preview` twice (loading, then JSON / README / text / error).
- **Data:** `#carrot-breadcrumbs` (folder names; only " BunnyMo" is UI — skip the whole element), `.carrot-file-name`, `.carrot-file-size`,
  `#carrot-file-preview .carrot-preview-title-text h3` (pack / file name), `.carrot-entry-key`, `.carrot-entry-preview`, `.carrot-readme-content`
  (+ its `pre`, README inserted unescaped), `.carrot-text-content pre`, `.carrot-debug-info pre`, `.carrot-stat-number`,
  install dialog `.carrot-pack-name`, error details (`.carrot-error-details`, `.carrot-error-state p`, IX:3836).
- **Mixed:** `#carrot-browser-stats > span` = `${folders} folders, ${files} files` + optional ` • ${installed}/${json} packs installed` +
  optional ` • ${u} update(s) available` in **one** text node (IX:3910-3918) — only matchable with templates per combination;
  `.carrot-file-type` labels (IX:4027-4034); `${cleanName} is now available in your lorebooks` (IX:4569); `TRIGGER: ${p}%` (4745);
  `+ ${n} more entries` (4750); `${size}KB` (4580, 4726); `<strong>Error:</strong> ${message}` (4616).
- `#carrot-progress-text.textContent` set four times during install (IX:4521/4532/4541/4558).

### 3.4 Move Collection dialog `.carrot-popup-container.rag-copy-context-popup` (IX:219-403)
- Placed with `$('#carrot-popup-overlay').html(popup)` (IX:340) → destroys `#carrot-popup-container`. Temporary: emptied 300 ms after
  Cancel / Confirm; Esc cancels (IX:371-376). Trigger `.carrot-copy-context-btn` (IX:8785-8792).
- Subtitle rich unit: `Move <strong style="color: var(--SmartThemeQuoteColor, #10b981);">${name}</strong> from <strong>${SOURCE}</strong> storage to:`
  (IX:230; SOURCE = GLOBAL / CHARACTER / CHAT via `.toUpperCase()`).
- Options `label.copy-context-option[data-level] > div > div:first-child` (titles) and `div:last-child` (description, conditional
  'Cannot move - already here' vs a description, IX:261/289/317). Radios `input[name="copy-context-level"]` — `.val()` read at IX:390.
- **Data:** `.rag-copy-context-popup .carrot-card-subtitle > strong:first-of-type` (collection name).

---

## 4. Body overlays

### 4.1 Baby Bunny single popup `body > .baby-bunny-overlay > .carrot-popup-container.baby-bunny-popup` (BB:1490-2062)
- Opened by `checkForCompletedSheets` (one character), the message button, **automatically on `CHARACTER_MESSAGE_RENDERED`** when Baby Bunny
  Mode is on (IX:6844-6861), and one by one from the batch popup. Removed on Cancel (BB:2018), Create (2047), backdrop (2055-2059),
  Skip to Chunking (1908). Built once, then in-place updates: trigger chips added/removed, `#tag-preview` `.html()` on Save (BB:2002),
  sections shown/hidden, `#baby-bunny-skip-to-chunking` loading state (`.html()` + title saved and restored, BB:1869-1882).
- Use `.baby-bunny-overlay > .baby-bunny-popup:not(.baby-bunny-tutorial)`; duplicate ids if two popups are open.
- **Data:** `#baby-bunny-lorebook-name`, `#baby-bunny-entry-name` (input values), `#baby-bunny-existing-lorebook option:not([value=""])`,
  `#baby-bunny-triggers-container .trigger-tag` (incl. `.tag-text`; **BB:2039 reads `.tag-text` back as the entry keys** — the fallback
  name 'Character' would be a dictionary hit), `#tag-preview` (escaped sheet text + highlight spans), `#tag-editor` (textarea).

### 4.2 Baby Bunny batch popup `body > .baby-bunny-overlay > .carrot-popup-container.baby-bunny-batch-popup` (BB:616-1349)
- Opened when more than one character is found (BB:182). Removed on Cancel, Create, Process Individually; backdrop does not close.
- In-place updates: `#batch-selected-count` `.text()` (BB:1125), chips, `.batch-tag-preview` `.html()` on Save (1221), sections toggled.
- **Data:** character name `.batch-char-header > div:nth-of-type(2) > div:first-child` (BB:703, unescaped, no class), number badges
  (`.batch-char-header > div:nth-of-type(1)`, BB:698, 959), `.batch-entry-name`, `.batch-trigger-input`, `.batch-triggers-container .trigger-tag`,
  `.batch-tag-preview`, `.batch-tag-editor` (textarea; **BB:1268 reads it with `.val()` as the entry content**), `#batch-lorebook-name`,
  `#batch-existing-lorebook option:not([value=""])`, `.batch-multiple-lorebook-name`, `#batch-selected-count`.
- **Mixed:** `<span id="batch-selected-count">N</span> of N characters selected` (BB:873; the trailing text node holds the frozen total),
  `.batch-char-header > div:nth-of-type(2) > div:last-child` "`${n} characters of data`" (BB:706), placeholder `Lorebook name for ${name}` (BB:965).

### 4.3 Baby Bunny chunking modal `body > #carrot-baby-chunking-modal.carrot-popup-overlay` (BB:2402-3614)
- Created lazily (BB:2491-2602), shown with `.addClass('active').css('display','flex')` (2481), removed 300 ms after close (2735-2743).
  Opened only from "Skip to Chunking" (BB:1912-1913).
- `#carrot-chunking-content-container` rebuilt with `.html()`: Chunks tab `renderChunkPreviews` (BB:2748-3093, select2 initialised
  synchronously per card) / Original tab (BB:2703-2730). Stats `.text()`: `#chunking-count`, `#chunking-tab-count`, `#chunking-total-tokens`,
  `#chunking-avg-size`.
- Full rebuild on open, tab switch, add, regenerate, expand/collapse all, enable toggle, delete, link changes, keyword refresh, weight edit
  commit, fancy/plaintext switch. No rebuild while typing.
- `#carrot-chunking-finalize` → "Processing..." and back (`.html()` saved/restored, BB:3574-3612).
- **Data:** `#chunking-character-name`, the stat values, the original document `textarea[readonly]`, everything in §6.
- **Mixed:** `<i></i> Chunks (<span id="chunking-tab-count">N</span>)` (text nodes " Chunks (" and ")"), `(${n} characters)` (BB:2711).

### 4.4 Lorebook Connections `body > .carrot-connection-overlay` (LC:113-296)
- Opened by the 🐰 button `#carrot_lorebook_connector_button` (IX:9384), the relabelled ST option `#set_character_world` (IX:9407) and
  `openLorebookConnector`. If no character is selected only a toast appears. Removed (`.remove()`) by Close, backdrop, Edit (opens ST's WI
  editor), Apply; re-opening removes the old one first. A sibling `<style>` is appended with it (skip).
- Static: h3 "🐰 Lorebook Connections", `Character: <strong>${name}</strong> • Chat: <strong>${chat}</strong>` (LC:164-166, rich unit),
  Close, search input (placeholder), Apply button. The loading block is replaced in the same tick.
- `#carrot-connection-list` rebuilt wholesale with `.html()` (LC:416) on open, **on every keystroke in the search field (no debounce)**,
  star click, scope `<select>` change, badge click.
- Item `div.carrot-conn-item[data-lorebook]`: `.carrot-conn-star` (⭐/☆, conditional multi-line title), name div (**data**; the previous
  element sibling of `.carrot-conn-open-editor`), `button.carrot-conn-open-editor` (" Edit", title), `.carrot-conn-badge[data-type]`
  (Char Repo / Tag Lib / Lorebook in a span, title), `select.carrot-conn-scope` (None / Character / Chat; values safe).
- **Data:** `.carrot-connection-header p > strong` (character name, chat file name; fallbacks 'Unknown Character', 'No Chat Selected'),
  the lorebook name div (exclude structurally: `.carrot-conn-item > div:nth-child(2) > div:first-child`), search value, all `data-*`.

### 4.5 WorldBook Tracker (WT; init IX:7317-7328 when the master switch is on; default on)
- Four persistent `body` children: `.ck-trigger` (SVG + numeric CSS badge `::after { content: attr(data-ck-badge-count) }`, title),
  `.ck-connection` (no text), `.ck-panel`, `.ck-config-panel` (static, built once). enable/disable only toggle `style.display`; the
  eventSource listeners stay, so the hidden panel keeps being rebuilt.
- `.ck-panel` is rebuilt wholesale (`innerHTML = 'Updating...'`, then `''` and DOM building, WT:2539, 2597-3364) on every
  `WORLD_INFO_ACTIVATED` (every generation, swipe, continue, quiet generations from other extensions) and `WORLDINFO_FORCE_ACTIVATE`
  (vector WI: two rebuilds per generation), config clicks, debug toggle. Not on chat change (content stays stale). The two persistent
  buttons `.ck-debug-toggle` and `.ck-clear-highlights` are re-appended each render (already translated). 'Updating...' is detached
  synchronously.
- Variants: empty state `.ck-empty-state` (`__title`, `__desc`); potato mode `.ck-potato-mode` (unclassed divs: header
  `🥕 Active Entries (${n})`, world headers `📚 ${world} (${n})`, title `comment || 'Untitled'`, meta `${chars} chars • depth ${d}`);
  normal mode `.ck-header` (`.ck-header__title`, size buttons with titles, `.ck-header__badge` number) + `.ck-content` with
  `.ck-world-header` (unclassed `span` = world name, or 'All Entries' / 'Unknown') and `.ck-entry[data-strategy]` rows:
  `.ck-entry__title` (**data**: comment or keys; fallback 'Unnamed Entry'), `.ck-entry__icon` (emoji + title), `.ck-entry__trigger-indicator`
  (emoji + title `Triggered by: ${label}`), `.ck-entry__trigger-reason` (CONSTANT, VECTOR/RAG, PERSONA, CHARACTER, SCENARIO, SYSTEM,
  STICKY, KEY MATCH, optionally + ` (STICKY n)`; CSS uppercase), `.ck-entry__sticky` (`📌n`, title `Sticky: ${n} turns remaining` /
  `Sticky: Expired ${n} turns ago`), `.ck-summary > span.ck-summary__tag` (labels '🔵 CONSTANT' etc., '⏳ DELAYED' on almost every entry,
  `📝 ${n} chars`; **data** tags `🔑 N`, `#N`, `🎲 N%`, `👥 ${group}` raw innerHTML), `.ck-debug > .ck-debug__content > .ck-debug__section`
  (`.ck-debug__heading` + `.ck-debug__field`).
- **Data:** `.ck-entry__title`, `.ck-world-header > span:not(.ck-header__badge)`, `.ck-header__badge`, the `.ck-debug__field` after
  "🔑 TRIGGER KEYS (n)" (raw keys via innerHTML) and after "📝 CONTENT PREVIEW" (entry content). Section order shifts (content section
  optional) — classify by the heading emoji. Potato mode has no classes (structural detection only).
- **Mixed:** activation field (WT:3197) is one text node `📍 Position: ${pos} • 🏗️ Depth: ${d} • 🔢 Order: ${o}[ • 🎲 Probability: ${p}%]`
  (position names WT:1272-1284); why field `${REASON}: ${description}` (WT:3230); heading `🔑 TRIGGER KEYS (${n})`.
- The last unclassed div in `.ck-debug__content` (WT:3331, `innerHTML = debugLines.join('<br>')`) mixes text, `<strong>` and `<br>` and
  data in one element: as an all-inline element it is one **rich unit** containing data (unmatchable); it becomes per-line runs only
  when the recursion-info `<div>` (WT:3320-3324, shown on almost every entry) is present. Left out of the dictionary except static lines.
- Dead strings: '▼ Click for details' / '▲ Click to collapse' (no `.expand-indicator`), 'Sticky: Not active', `analyzeTriggerSource`
  notes (WT:1479-1706, never called).
- `maxHeight = scrollHeight` measured at click (WT:3349): longer translated text after expanding gets clipped until re-toggled.
  `.ck-config-panel` is a fixed 300 px; compact `.ck-entry__title` is nowrap + ellipsis.

### 4.6 Card-renderer body popups
- Tag Details `body > div.bunnymo-tag-popup` (CR:1894-1981): opened by a tag chip click, one at a time; removed by Search, Close or a click
  on its padding. Content set once. **Data:** text after `<strong>Tag:</strong>` (CR:1920, unescaped).
- WorldBook search popup: `body > div` without id/class (CR:1995-2028; only if `window.world_info_character_cards` exists), auto-removed
  after 3 s; usual case is a notification `body > div` "WorldBook search not available" (CR:2043-2058), removed after 2 s. Catchable only
  by observing `body` children and matching text.

### 4.7 select2 (keyword editors in §6)
- `span.select2-container` is inserted after `select.carrot-chunk-keywords` (CV) / `select.chunk-keywords-select` (BB), inside the card.
  Choices `li.select2-selection__choice[title=<keyword>]` with `button.select2-selection__choice__remove[title="Remove item"][aria-label="Remove item"]`,
  `span.select2-selection__choice__display` (CK `templateSelection`, CV:657-683, BB:2820-2959), inline search
  `textarea.select2-search__field[placeholder]` (copied from the `<select placeholder>`).
- The dropdown is appended to **`document.body`** (no `dropdownParent`) — outside every CK root; items are keywords (data) plus select2's own
  "No results found" / "Searching…".
- CV initialises select2 10 ms after `.html()` (a translated `<select placeholder>` is picked up); BB initialises synchronously (the English
  placeholder is copied before the observer runs — handle `textarea.select2-search__field[placeholder]` directly).

### 4.8 Tutorials (TU)
- The live tutorials (`startTutorial`, TU:200-270; from SH:594, 632, 757, 766, 775, 784 and TE:21) add `.carrot-tutorial-highlight` to targets
  and show **native `confirm()` per step + `alert()` at the end** — no DOM text. The overlay `#carrot-tutorial-overlay` (SH:830-852 and a
  TE copy) is never shown; `closeTutorial` removes it by id (TU:444-468). Some targets are positional (`.carrot-setting-item:first-child`,
  `:nth-child(2)`, `:nth-child(3)`, TU:25-39): never insert wrapper elements.

---

## 5. Elements inside ST's own UI
- `#carrot_lorebook_connector_button.menu_button` "🐰" with title `CarrotKernel Lorebook Connections&#10;&#10;Manage character and chat lorebook connections`
  (two LF), inserted after `#world_button` in `#avatar_controls .form_create_bottom_buttons_block` (IX:9376-9394). `#world_button` is hidden;
  `<style>.chat_lorebook_button{display:none !important}</style>` goes to `<head>` (IX:9393).
- ST option `#set_character_world` text → '🐰 Lorebook Connections (CarrotKernel)' (IX:9415); both CK and ST find it by id. It keeps
  `data-i18n="Link to World Info"`, so ST's i18n may rewrite it back.
- `head > style[data-carrot-kernel]` (WT:7-8), `#carrot-card-styles`, `#bunnymo-animations` (CR:75-457), thinking-block CSS (IX:7067-7069): no text.

---

## 6. Chunk cards (Chunk Visualizer `#carrot-rag-chunks-container` and Baby Bunny `#carrot-chunking-content-container`)
Card root `.world_entry[data-hash]` (CV:577-607, BB:3250-3290); classes collide with ST's WI editor (`.world_entry`, `.world_entry_form`,
`.wi-card-entry`, `.inline-drawer*`, `.keyprimaryselect`, `.text_pole`, `.checkbox_label`, `label.checkbox`) — always scope rules to the two containers.
- **Data (exclude):**
  - textareas: `.carrot-chunk-title-edit` / `.chunk-title-edit`, `.carrot-chunk-text-edit` / `.chunk-text-edit`, `.carrot-chunk-keywords-plaintext` /
    `.chunk-keywords-plaintext` — **FR:4272-4276 reads the text-edit textarea with `.val()` on keyword refresh**, and an untouched textarea's value
    is its child text node, so translating that node would overwrite the chunk text;
  - `select.carrot-chunk-keywords option` / `select.chunk-keywords-select option` (keywords; select2 copies option text into choices);
  - select2 choices `.select2-selection__choice` text and `title`, `.keyword-text`, `.keyword-weight-badge[contenteditable="true"]`
    (parsed with `parseInt($(this).text())`, CV:809, BB:2874, 2939), `.regex_item`, `input.keyword-weight-input`;
  - keyword preview `.chunk-keywords-preview:not(.empty)` with `.chunk-keyword-mini-badge` (`${k}<sup>${w}</sup>`; its `title`
    "`${k} (weight: ${w})`" is UI+data) and `.chunk-keyword-more-badge` (`+N`, title "Click to expand N more keywords");
  - `.chunk-meta-badge` / `.token-count` numbers (the BB size badge "`${n} chars`" is UI+number);
  - `.chunk-formatted-display` (chunk text rendered as HTML, CV:476; its `title` "Click to edit" is UI);
  - `input.carrot-inclusion-group-input` (value);
  - link titles: `.world_entry_edit span[style*="padding: 2px 6px"] > span:not([class])` (CV:509/522, BB:3334/3347),
    `label.checkbox > span > span:not([class])` (CV:547) and in BB a **bare text node** next to an optional icon inside
    `.chunk-links-drawer-content label.checkbox > span` (BB:3377, 3389) — exclude that `span` as a whole.
- **UI:** "Primary Keywords", "Content" (`span[data-i18n="Content"]`), "Inclusion Group", "Prioritize", "Only one entry with the same label will be activated",
  "This activates:", "Activated by:", `<strong>Linked Chunks <span style="opacity: 0.6;">(N)</span></strong>` (rich unit when N > 0), "No other chunks available to link",
  "Link Mode:", " Soft" / " Force", "No keywords", titles (toggle enabled/disabled, refresh, delete, switch input type, weight badge "Click to edit weight",
  "Regex", "Chunk size", "Character count", "Chunk index", "Prioritize this chunk…", the link label title `${title} (Force|Soft link)` — data + UI),
  placeholders ("Keywords or Regexes", "Comma separated list", "Chunk content...", "Entry Title/Memo", "Group label...").
- BB:3077 copies `data-tooltip-on/off` into `title` after render; CV writes the two titles as literals (CV:695, 705).
- Weight badges / select2 choices in BB get `title` `` `${item.text}\n\nClick to edit` `` (BB:2812, 2830).

---

## 7. Toasts (`#toast-container > .toast`, `.toast-title` / `.toast-message`)
- ST configures toastr with `escapeHtml: true` (ST script.js:348-364): every CK toast is plain text in one text node. CK never overrides
  `escapeHtml`.
- About 145 calls; all literals are in the dictionary (§ "Уведомления …"). Data inside: lorebook / character / collection / pack names,
  counts, `error.message` (often a nested English error such as "Failed to fetch" or "Vectorization failed").
- Titles only at PM:739 (`Saved as ${filename}`), PM:784 ('CarrotKernel Pack Updates'), WT:2240 ('CarrotKernel'), BB:4053 (unreachable).
- PM:784-791 is sticky (`timeOut: 0`, close button, click opens the pack manager); it fires 5 s after startup (IX:7199-7203).
- With an ST dialog open, ST moves the toast container into the dialog (`fixToastrForDialogs`).

---

## 8. Chat (`#chat`)

| Element | Selector / mount | When | Lifecycle |
|---|---|---|---|
| Thinking box | `#chat .mes .mes_block > details.carrot-thinking-details[data-type="carrot-thinking"]` before `.mes_text` (`insertAdjacentHTML('beforebegin')`, IX:1549-1707, 2202-2334) | `CHARACTER_MESSAGE_RENDERED` in display mode "thinking" (IX:6705, 6821), `CHAT_CHANGED` +500 ms restore for every message (IX:6665-6692, 1908-2009), Test Display | never updated in place; removed/re-created by CK |
| Persistent BunnyMoTags block | `#chat .mes .mes_text details.mes_reasoning_details.bunnymo-tags-container` (IX:2960-3247) | `CHARACTER_MESSAGE_RENDERED`, thinking mode, only with ST "Show <tags> in responses" (the regex at IX:3087 matches escaped `&lt;BunnyMoTags&gt;`) | CK rewrites `.mes_text.innerHTML` twice (IX:3010, 3159); not re-created after ST re-renders |
| Cards-mode system message | `#chat > .mes[ch_name="BunnyMoTags"][is_system="true"]` via `chat.push` + `addOneMessage` (IX:2821-2903) | `WORLD_INFO_ACTIVATED` in display mode "cards" | saved with the chat (its text is **chat data**) |
| External cards | `#chat > .bunnymo-external-cards#bunnymo-cards-{N}[data-message-id]` after that `.mes` (CR:373, 408, 478-481) | 200 ms after the system message | persistent until `#chat` is rebuilt; not restored on reload |
| Test Display (cards mode) | `.mes_block > .bmt-system-message-header` + `.bmt-cards-grid` (CR:31-74, 2070-2186) | `#carrot-test-display` only | stacks duplicates |
| RAG button | `#chat .mes[mesid] > div.carrot-rag-fullsheet-button` (FR:3653-3728; absolutely positioned) | RAG on + fullsheet detected: `CHARACTER_MESSAGE_RENDERED`, `CHAT_CHANGED` +500 ms, init +1 s | removed when RAG is off, 2 s after success |
| Baby Bunny message button | `.mes_buttons .extraMesButtons > div.mes_button.CarrotKernel_baby_bunny_button` (title only) in every `.mes` **and in `#message_template`** (BB:3942-4127) | jQuery ready (+500 ms for all), `CHARACTER_MESSAGE_RENDERED`, `USER_MESSAGE_RENDERED`, toggles | the template copy stays: translating its title once covers all clones |

- **Thinking box internals:** `.carrot-thinking-summary .carrot-thinking-header-title` "🥕 BunnyMoTags" (brand); `.carrot-thinking-content` contains an optional
  truncation `div` "`📊 Showing ${max} of ${n} characters`" (IX:1679), an optional `<em>` error "`⚠️ ${reason}`" (IX:1656-1665; reasons embed names),
  and per character `<details open style="…border…">` (IX:1617) with `<summary>` "🏷️ ${name}" (**data**) and `div.character-tags-content`: section `div`
  > `<strong>` "`${emoji} ${sectionName}:`" (UI, fixed list IX:1788-1833: Physical, Dere Types, Core Traits, Social Dynamics, Intimate & Kinks, MBTI Types,
  Communication, Psychology, Leadership, Identity, Other) + row `div`s of category `span` "• ${CAT}: " and value `span` (**data**; "Color Sample" is UI).
  CK binds click handlers on `details[style*="border"] > summary` and finds blocks by `.carrot-thinking-details` — change text only.
- **Persistent block internals:** `summary.mes_reasoning_summary .mes_reasoning_header_block > span` "🏷️ BunnyMoTags Character Data" (UI);
  `details.bunnymo-character-section#bunnymo-char-…` with `<summary>` = text "🎭 ${name}" (**data**) + `<span>` "`(${n} categories)`" (UI+number);
  `div > strong` (category keys, **data**) + `span` (values, **data**). CK reuses ST's reasoning classes: don't identify ST's block by `.mes_reasoning_details` alone.
- **Cards-mode message:** `.mes_text` gets "`🥕 Character Information (${n} character|characters)`" + `div.custom-carrot-summary` "`📋 ${n} character card(s) loaded - visual cards will appear below this message`"
  + hidden `div.custom-carrot-data-anchor` (**JSON — never touch**). DOM translation here is display-only (ST's edit box shows English).
- **External cards internals** (most nodes unclassed, CR:478-993): header "🎭 Character Data", count "`${n} character(s)`", toggle ▼/▲ (title "Toggle card visibility"),
  optional `button.character-selector-btn` (**text and title = character name**), tabs `button.carrot-tab[data-tab] > div > span:nth-child(2)` Personality / Physical / Growth,
  `.carrot-tab-content#carrot-tab-{id}` (ids repeat per container) rebuilt wholesale on selector click (IX:2906-2952). Card name `.bunnymo-character-card > div:nth-child(1) > div`
  (**data**), empty "`No ${tab} data available`", section title div "`${emoji} ${group}`" (UI, fixed groups CR:1121-1141) with title tooltip (CR:1304-1328), tag chips
  `[data-original-tag]` (**data**; text "`${CATEGORY}: ${tag}`" reformatted), toggle `div[title="Click to toggle visibility"]` 👁️ — **CR:1862 finds it by that English title**
  (synchronously while still off-DOM, so a MutationObserver cannot interfere; translating CK source would break it).
- The RAG button labels are set with `.html()` (spinner + " Vectorizing...", " Vectorized!", " Failed" then restore after 2 s, FR:3706-3793); `button.html()` is read back and
  re-inserted (FR:3784-3789), so translation must be idempotent.

---

## 9. Dialogs

**ST popups (DOM, translatable through `dialog.popup .popup-content`):**
- IX:8913-8918 `callGenericPopup(\`Are you sure you want to delete all chunks for "${characterName}"? This cannot be undone.\`, 'confirm', '', { okButton: 'Delete', cancelButton: 'Cancel' })` — live
  (collection delete). Content is a string set as innerHTML of `.popup-content`; the type string 'confirm' is not a `POPUP_TYPE` (ST logs a warning). ST sets
  `data-i18n` on the custom button captions, so ST's i18n may translate "Delete"/"Cancel" itself.
- IX:8469-8474 `callGenericPopup('You have unsaved changes. What would you like to do?', 'confirm', '', { okButton: 'Save', cancelButton: 'Discard' })` — **dead** (unbound by CV:847).
- bunnymo_class.js:252 `new ctx.Popup` — dead file.
- No `Popup.show` anywhere (LC builds its own overlay).

**Native `alert` / `confirm` / `prompt` (not reachable through the DOM; only a `window.*` wrapper could translate them):**

| file:line | call | gist |
|---|---|---|
| IX:8095 | confirm | re-vectorize all collections warning |
| IX:8776 | prompt | custom collection name (default = data) |
| IX:9100, 9139 | alert | 'CarrotKernel is disabled. Please enable it first.' |
| IX:9106 | alert | no lorebooks selected |
| IX:9124 | alert | scan results, assembled at IX:9115-9121 |
| IX:9128 | alert | `Scan failed: ${message}` |
| IX:9144 | alert | no characters scanned |
| IX:147 | prompt | collection name (unreachable) |
| CV:198 | confirm | unsaved changes on close |
| CV:922 | confirm | delete chunk |
| CV:981 | prompt | edit chunk text (default = chunk text) |
| BB:3482 | confirm | `Delete chunk "${name}"?` |
| BB:4042-4049 | confirm | fullsheet detected (unreachable) |
| FR:3741-3744 | prompt | character name for the fullsheet (RAG button) |
| FR:4265 | confirm | regenerate keywords (from CV:941 and BB:3497) |
| TE:686, 943, 1330, 1335, 1340, 1446, 1493, 1515 | confirm/alert/prompt | macro delete / preview / new macro name + validation / duplicate name / delete template / reset template |
| RM:195, 227, 680 | alert | rescan without lorebooks / scan failed / character not found |
| TU:204, 256-258, 269 | alert/confirm | tutorial not found / **every tutorial step** / completed |

The tutorial step text (TU:20-177) is unexported module data shown only through `confirm()`; it is also English-centric post-processed
(TU:239-253 strips `<…>` and breaks lines only before `[A-Z]`).

---

## 10. Re-render frequency (what needs a deep observer)
- **Per keystroke:** Chunk Visualizer search (full list + select2 + async token counts), Lorebook Connections search (full list).
- **Per generation:** WorldBook Tracker `.ck-panel` (1-2 full rebuilds, also while hidden), thinking box / cards / BunnyMoTags block / RAG button /
  Baby Bunny button on each rendered message, Baby Bunny popup auto-open, WI-activated cards system message.
- **Per chat change:** thinking-block restore for every message (+500 ms), RAG buttons for all messages (+500 ms).
- **Per click:** every popup-host view (wholesale), repository manager navigation, pack browser navigation, template editor template change
  (~58 macro cards), chunk card actions.
- **Timers that write UI (one-shot):** IX:603 (+500 ms status), ~10 s settings bind burst, IX:7130 (+2 s pack init failure), IX:7199 (+5 s update toast),
  IX:9330 (+500 ms Baby Bunny buttons), FR:3768/3788 (2 s), CV:316/720 (10 ms select2), TE:1002/1056/1222 (+100/+200 ms), RM:211 (+500 ms),
  RM:219 (+2 s), CR:2031/2060 (auto-remove). **No `setInterval` and no `requestAnimationFrame` anywhere in CK.**

---

## 11. Read-backs and other gotchas
- Never translate: `.carrot-lorebook-name` (search reads `.text()`, IX:9156), `.trigger-tag .tag-text` (BB:2039 → entry keys), any `textarea`
  child text node (BB:1268, 1996, 1215; FR:4272-4276; TE `#prompt`), contenteditable weight badges, `value` / `data-*` attributes (radios IX:390,
  `data-current-character` IX:2915, `data-lorebook`, `data-collection`, `data-tag`, `data-enabled`, `data-hash`, `data-tooltip-*`).
- CK restores saved `.html()` (re-vectorize button IX:8093/8177, RAG button FR:3784, Baby Bunny skip/finalize buttons BB:1869-1881/3574-3612)
  and saved `textContent` (RM Rescan button RM:200/229): restored nodes are new nodes that may already be Russian — the engine must be
  idempotent and must not rely on a per-node cache of the English source for those.
- CK finds elements by inline style or position: `details[style*="border"]` (IX:2255), `[style*="border-top"]` (CV:1019), `find('div').last()`
  (IX:9553), positional tutorial targets — change text and attributes only, never insert wrappers. (The engine's `wrapInlineRuns`
  inserts `span.desru-run` wrappers; none of the known CK lookups depend on those containers, but keep it in mind for `.carrot-tutorial-*`.)
- CR:1862 `querySelector('div[title="Click to toggle visibility"]')` — runs before the node is in the DOM, so harmless for an observer.
- `#carrot-popup-container` gets destroyed by the Move dialog (§3.4); the RM / pack-install close races (§3).
- Data is interpolated unescaped in many places (names, lorebook names, README, entry content, group names): data zones may contain
  child elements — exclude whole subtrees.
- `text-transform: uppercase` on several labels (lorebook statuses, list headings, `.ck-entry__trigger-reason`, `.ck-debug__heading`, RAG
  viewer context span): match DOM text, not rendered capitals.

---

## 12. CSS text the DOM engine cannot reach
- style.css:354-355 `.carrot-disabled .carrot-card:not(.carrot-enable-card)::after { content: "🥕 Enable CarrotKernel to unlock features" }` —
  visible after Master Enable is switched off during the session (also hits the Move dialog's `.carrot-card`). Override with a layout-fix
  style: `content: "🥕 Включите CarrotKernel, чтобы открыть функции"`.
- style.css:4000-4001 `.carrot-pack-container:empty::before` — dead (class unused). Others are symbols (`•`, `.*`) or the numeric tracker badge.

---

## 13. Places where chrome and data share one text node (need templates or must stay English)
- Status panels: `${n} characters indexed`, `From ${n} repositories`, `${n} lorebooks selected`, `${n} characters available`, `Ready to inject ${n} characters` — templates.
- RAG viewer: `${n} tokens` in `.token-value` — template; header/empty state are rich templates per storage level.
- Chunk visualizer: subtitle `${n} chunks`, `${n} chars` stats — templates; modal title (name + `[level]`) — data.
- Baby Bunny: ` of ${n} characters selected`, `${n} characters of data`, `(${n} characters)`, placeholder `Lorebook name for ${name}` — templates.
- Lorebook Connections: star title (two variants with LF) — exact keys; badge/scope labels — exact keys.
- WorldBook Tracker: activation field (one node, position/depth/order/probability with data) and why field `${REASON}: ${desc}` — not in the
  dictionary (each needs per-combination templates; position names would stay English inside a `{pos}` capture); `🔑 TRIGGER KEYS (${n})`,
  `${chars} chars • depth ${d}`, `🥕 Active Entries (${n})`, `📚 ${world} (${n})` (data), titles `Triggered by: ${label}`, `Sticky: …` — templates.
- Repository manager: `${n} repositories • ${m} characters total`, `${n} characters in this repository`, `${n} tag(s)`, `✅ Found ${n} characters`,
  `+ ${n} more characters...`, ` ${name} • ${n} categories` (RM:483) — templates; `🟢 ` + `<strong>name</strong>` + ` - ${n} tags` — fragment template.
- Pack browser: `#carrot-browser-stats` single node with optional parts — templates per combination (included for the common ones);
  `${cleanName} is now available in your lorebooks`, `TRIGGER: ${p}%`, `+ ${n} more entries`, `${n}KB`.
- Cards: `${n} character(s)`, `No ${tab} data available`, `Character ${i}` (fallback name on the selector button — data slot).
- Thinking box: `📊 Showing ${max} of ${n} characters`; error reasons with names; `(${n} categories)` in the BunnyMoTags block.
- Toasts: dozens of templates with names/counts/errors (all in the dictionary as templates).
- Popup host h4 titles: `Character Details - ${name}` — template.

---

## 14. Suggested `CK_UI` (format: `UiMap` in src/translator.js)

A starting point compiled from §1-13; selectors are CSS for `Element.matches` / `closest` (`:has()` works in ST's
Chromium/Firefox targets). Comments say why.

```js
containers: ['body', '#extensions_settings', '#extensions_settings2', '#sheld'],   // as in the current draft
chat: '#chat',
roots: [
    { selector: '#carrot_settings', mode: 'full' },              // also covers #carrot-popup-overlay and #carrot-rag-visualizer-modal
    { selector: '#carrot-main-lorebook-popout', mode: 'full' },  // holds the moved lorebook card body while popped out
    { selector: '.baby-bunny-overlay', mode: 'full' },           // single / batch Baby Bunny popups
    { selector: '#carrot-baby-chunking-modal', mode: 'full' },
    { selector: '.carrot-connection-overlay', mode: 'full' },
    { selector: '.ck-panel', mode: 'full' },
    { selector: '.ck-config-panel', mode: 'full' },
    { selector: '.ck-trigger', mode: 'full' },                   // title only
    { selector: '.bunnymo-tag-popup', mode: 'full' },
    { selector: '#carrot_lorebook_connector_button', mode: 'full' }, // title only; parent is ST's
                                                                 // #avatar_controls .form_create_bottom_buttons_block (add it to containers or attach once)
],
chatRoots: [
    { selector: 'details.carrot-thinking-details', mode: 'full' },
    { selector: 'details.bunnymo-tags-container', mode: 'full' },
    { selector: '.bunnymo-external-cards', mode: 'full' },        // direct child of #chat
    { selector: '.bmt-system-message-header', mode: 'full' },     // Test Display in cards mode
    { selector: '.bmt-cards-grid', mode: 'full' },
    { selector: '.carrot-rag-fullsheet-button', mode: 'full' },
    { selector: '.CarrotKernel_baby_bunny_button', mode: 'full' }, // title only; also translate the copy in #message_template once
    // optional, display-only (it is saved chat text): { selector: '.mes[ch_name="BunnyMoTags"] .custom-carrot-summary', mode: 'full' },
],
chrome: [],
exclude: [
    'input', 'textarea', 'pre', 'script', 'style', '[contenteditable="true"]',
    // settings panel
    '.carrot-format-code', '.carrot-tooltip-example code', '.carrot-slider-icon', '.carrot-lorebook-name',   // .carrot-lorebook-name is read back (IX:9156)
    '#carrot_rag_old_provider', '#carrot_rag_new_provider',
    '#carrot_rag_openai_model', '#carrot_rag_cohere_model', '#carrot_rag_google_model', '#carrot_rag_togetherai_model',
    '#carrot-rag-collections-list div:has(> .carrot-rename-collection-btn) > div:first-child',               // collection display name
    // chunk editors (Chunk Visualizer + Baby Bunny chunking)
    '#carrot-rag-modal-title', '.chunk-keywords-preview:not(.empty)', '.chunk-formatted-display',
    'select.carrot-chunk-keywords option', 'select.chunk-keywords-select option', '.select2-selection__choice',
    '.keyword-weight-badge', '.token-count',
    '.world_entry_edit span[style*="padding: 2px 6px"] > span:not([class])', '.world_entry_edit label.checkbox > span',
    // popup host: repository manager, pack browser, template editor
    '.carrot-repo-file-name', '.carrot-repo-breadcrumb-item[data-repo-nav]', '.carrot-repo-breadcrumb-active:not(:has(i))',
    '.carrot-repo-preview-info > h4', '#carrot-repo-file-list > div[style*="56px"] > span', '.carrot-tag-item',
    '#carrot-characters-list div[style*="font-size: 14px"]',
    '#carrot-breadcrumbs', '.carrot-file-name', '.carrot-file-size', '.carrot-preview-title-text h3', '.carrot-entry-key',
    '.carrot-entry-preview', '.carrot-readme-content', '.carrot-text-content', '.carrot-stat-number',
    '.carrot-install-dialog .carrot-pack-name',
    '#bmt_template_selector option:not([value=""])', '.bmt-macro-description div[style*="monospace"]',
    '.carrot-popup-body > div[style*="pre-wrap"]',                                                            // Template Preview output
    // Baby Bunny popups
    '.trigger-tag', '#tag-preview', '.batch-tag-preview', '.batch-char-header > div:nth-of-type(1)',
    '.batch-char-header > div:nth-of-type(2) > div:first-child',
    '#baby-bunny-existing-lorebook option:not([value=""])', '#batch-existing-lorebook option:not([value=""])',
    // Lorebook Connections
    '.carrot-conn-item > div:nth-child(2) > div:first-child', '.carrot-conn-star',
    // WorldBook Tracker
    '.ck-entry__title', '.ck-header__badge', '.ck-debug__field:has(> span)',          // trigger keys
    '.ck-potato-mode > div > div:first-child',                                           // potato-mode entry titles
    // chat
    '.carrot-thinking-content > details > summary', '.character-tags-content > div > div > span',
    '.bunnymo-character-section > div',
    '.bunnymo-character-card > div:nth-child(1) > div', 'button.character-selector-btn', '[data-original-tag]',
    '.bmt-cards-grid .bunnymo-character-card > div:nth-child(2) > div > div',                               // Test Display: raw categories and tags
],
noCollect: [
    // translated by dictionary hits only — UI words and data share these nodes
    '.carrot-error-details', '.carrot-error-state', '#carrot-rag-chunk-stats', '.chunk-meta-badge', '.chunk-stat__value',
    '.ck-debug__field', '.ck-summary__tag', '.ck-world-header', '.ck-potato-mode > div',
    '.carrot-repo-summary', '.carrot-repo-file-meta', '#carrot-browser-stats', '.carrot-popup-header h4',
    '.carrot-thinking-content > em', '.token-value', '#carrot-rag-collections-list',
],
userOnly: [],
attributes: ['title', 'placeholder', 'aria-label'],
dataAttributes: ['button.character-selector-btn', '.select2-selection__choice', '.chunk-keyword-mini-badge',
    'label.checkbox'],   // titles that are names/keywords (label.checkbox: chunk title + optional "(Force link)")
toastContainer: '#toast-container', toastParts: ['.toast-title', '.toast-message'],
stPopup: 'dialog.popup', stPopupContent: '.popup-content',
layoutFixes: [
    // CSS text the DOM engine cannot reach (§12), only visible after Master Enable is switched off:
    { selector: '.carrot-disabled .carrot-card:not(.carrot-enable-card)::after', style: 'content: "🥕 Включите CarrotKernel, чтобы открыть функции";' },
],
```

Notes on the choices:
- `.ck-world-header` is noCollect rather than excluded: its span is a lorebook name, except the literals "All Entries" / "Unknown",
  which have dictionary keys. Exclude `.ck-world-header > span:not(.ck-header__badge)` instead if a lorebook named like a UI word
  ("Other", "Context"…) is a concern.
- Rich units are checked before exclusion of their children, so `<strong>name</strong>` inside a translated sentence (Move dialog,
  Lorebook Connections header, `<strong>Error:</strong> {message}`) does not need an exclude — the rich templates capture the data.
- `.chunk-keyword-mini-badge` as a dataAttributes element keeps the `"{k} (weight: N)"` title English; drop it from the list to get
  "(вес: N)" — the keyword itself is preserved by the template either way.
- Keywords in chunk cards are lowercase English words that collide with dictionary keys in principle (the dictionary has no
  single lowercase words except "to", "messages", "chars" and the identity "llama.cpp"), so the exclusions above matter more for safety than for noise.

---

## 15. Engine limitations noticed (with the current src/translator.js)

1. ~~Placeholders of form fields are never translated.~~ **Fixed:** the engine now translates `placeholder` / `title` / `aria-label`
   of excluded `input` / `textarea` (never their value or text), for DES and CK alike.
2. ~~An all-inline element with `<br>` is one rich unit.~~ **Fixed:** a rich unit with `<br>` that has no whole-unit match is
   translated line by line (runs between `<br>`).
3. **Template captures stay English.** `{pos}`, `{level}`, `{src}`/`{dst}`, `{logic}`, `{reason}` capture CK's English enum words.
   The dictionary spells out known enum values as separate keys (tracker positions and key logic, storage levels, move/delete
   storage pairs, sticky reasons) and keeps a generic template as fallback.
4. **No "text is data, attributes are UI" mode.** `dataAttributes` covers the opposite case. Elements like the RAG collection id
   (`div:has(> .carrot-rename-collection-btn) + div`, title "Internal database identifier - cannot be changed") or chunk link labels
   must be either excluded (title stays English) or translated by exact hits only.
5. **`{{MACRO_NAME}}` in keys** is parsed as placeholder `{MACRO_NAME}` inside literal braces. It works because the lazy capture
   includes the inner braces ("Copy {{MACRO_NAME}} to clipboard" → "Скопировать {{MACRO_NAME}} в буфер обмена"); keep such values with
   the same `{{…}}` form.
6. **Plural forms after `toLocaleString()`**: in an en-US locale "12,345 tokens" is parsed as 12.345 → the "few" form
   ("12,345 токена"). ru-RU ("12 345") is fine. Affects `.token-value` and `.chunk-stat__value`.
7. **select2**: BB initialises select2 synchronously, copying the English `<select placeholder>` into
   `textarea.select2-search__field[placeholder]` before the observer runs (and that textarea is excluded anyway, see 1). The
   dropdown list is appended to `body` outside every root.
8. **Native dialogs** (§9) and the tutorial steps (only `confirm()`) can be translated only by wrapping `window.alert/confirm/prompt`.
9. **CSS `::after` text** (§12) needs a style override.
10. **`#carrot-popup-container` can be destroyed** (§3.4): roots must be attached to `#carrot-popup-overlay` / `#carrot_settings`,
    never to the container.
11. **Volume**: `.ck-panel` is rebuilt 1-2× per generation even while hidden; the Chunk Visualizer and Lorebook Connections lists are
    rebuilt per keystroke; the template editor rebuilds ~58 macro cards per template change.
12. **Toasts are shared between translators** (first dictionary with a hit wins). 36 keys exist in both dictionaries, 13 of them
    with different wording ("Unknown", "Disabled", "Global", "Other", "Inactive"…), but all are short labels, not toast texts, so
    no CK toast is affected by which dictionary answers first.

---

## 15b. Places CK reads back what the engine may change (re-check if the exclude list is shortened)
- `.carrot-lorebook-name` (`.text()`, IX:9156) — search filter.
- `.trigger-tag .tag-text` (`.text()`, BB:2039) — becomes the lorebook entry keys.
- `textarea` child text nodes (BB:1268, 1996, 1215; FR:4272-4276; TE `#prompt`).
- `.keyword-weight-badge[contenteditable]` (`parseInt(.text())`, CV:809, BB:2874, 2939).
- `div[title="Click to toggle visibility"]` (CR:1862) — queried while still off-DOM, harmless for an observer.
- saved/restored `.html()` / `textContent` / `title` of buttons (IX:8093/8177, FR:3784, BB:1869-1881/3574-3612, RM:200/229) — needs
  idempotent translation (restored nodes may already be Russian).
- `value` / `data-*` everywhere (radios IX:390, `data-current-character` IX:2915, `data-lorebook`, `data-collection`, `data-tag`,
  `data-enabled`, `data-hash`, `data-tooltip-*`).

---

## 16. Dictionary coverage notes (locales/ru.carrotkernel.json)

- 957 entries: 715 exact, 170 templates, 71 rich (innerHTML) keys; grouped by UI area in 38 sections.
- `node tools/check-dictionary.mjs locales/ru.carrotkernel.json` → 0 errors, 0 warnings.
- `node tools/extract-ck-strings.mjs --stale locales/ru.carrotkernel.json` → 0 stale keys.
- `--missing` lists ~120 strings; all of them are deliberate: dead code that the tool cannot name (unbound handlers in
  `bindSettingsEvents`, IX:8446-8575 and 9162-9323; markup built but never inserted, CV:380-429; unreachable code after `return`,
  BB:3996-4070), data and examples (model names, chunk section names, sample outputs), impossible ternary combinations
  (LC:482), map values that only appear inside combined keys (tracker positions, reasons, scope words), titles that CK never renders
  (raw-mode popups), and the skipped prose below.
- Rich keys were round-tripped through Chrome 152's `innerHTML` (attribute order, `&amp;`, `<br/>` → `<br>`, `<`/`>` in attributes):
  identical.
- **Skipped on purpose (licence: long prose / documentation):**
  - tutorials.js step bodies and titles (TU:20-177) — shown only through native `confirm()` anyway;
  - template editor macro documentation: the "Purpose / Perfect For / Use Case" paragraphs of the 7 documented macros and their
    example outputs (TE:727-850), the `macroInfo` descriptions (TE:1112-1156, never displayed), the `#prompt` placeholder (TE:80);
  - the Baby Bunny tutorial popup (BB:3630-3930; never opened by CK);
  - dead generators (IX:4835-6514, IX:8203-8375, RM:528-559/666-674/716-725, WT:1479-1706);
  - example data: SH:808-814 format example, SH:663 example injection code.
  The settings help drawer "How Smart Context Works" (SH:552-583) and the hover tooltip of the AI Injection panel are included:
  they are short settings hints (each ≤ ~230 characters).
