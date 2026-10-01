# SillyTavern - Doom's Enhancement Suite - RU

Надстройка для SillyTavern поверх [Doom's Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite) (DES):
русский интерфейс DES и исправления трекера для ролеплея на русском.

> **Это надстройка, а не форк.** В репозитории нет кода DES, и ни один его файл не меняется.
> DES ставится и обновляется отдельно, из своего репозитория. Надстройка работает с ним
> через DOM, события SillyTavern и публичные экспорты его ES-модулей.

**Статус:** в разработке, этап 1 — скелет. Модули пока заглушки.

## Требования

- SillyTavern 1.19.x;
- установленный и включённый Doom's Enhancement Suite (проверено на 2.6.0). Без DES надстройка тихо ничего не делает.

## Установка

Extensions → Install Extension → URL репозитория:

```
https://github.com/Likerch/SillyTavern-Dooms-Enhancement-Suite-RU
```

Подробная инструкция, описание модулей и «что делать, когда DES обновился» появятся на последнем этапе.

## Разработка

- `vendor/des` — клон DES только для чтения; используется для разведки и не попадает в git.
- `docs/des-recon.md` — разведка DES: селекторы, стейт, точки интеграции.
- `docs/manual-test.md` — чек-лист ручной проверки после каждого этапа.
- `npm test` — тесты чистой логики (Node 20+, без зависимостей).

## Лицензия

[AGPL-3.0-or-later](LICENSE), как и у DES. Doom's Enhancement Suite — © Jordan (DangerDaza);
эта надстройка — отдельная работа © Likerchik.
