/*
 * SillyTavern - Doom's Enhancement Suite - RU
 * Надстройка над Doom's Enhancement Suite: русский интерфейс и исправления трекера
 * для русского ролеплея. DES не изменяется: это отдельное расширение, а не форк.
 *
 * Copyright (C) 2026 Likerchik. AGPL-3.0-or-later, см. LICENSE.
 */
import { start } from './src/core.js';

// Zero crash policy: ни одна ошибка надстройки не должна долетать до SillyTavern.
start().catch((error) => console.error('[DES-RU] Надстройка не запустилась', error));
