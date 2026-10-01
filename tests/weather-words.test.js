import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DES_WEATHER, desHourOf, desWeatherTypeOf } from '../src/des-adapter.js';
import { DEFAULT_WEATHER_WORDS, addWeatherWords, normalizeWeatherWords, parseWordList, sameWeatherWords } from '../src/lib/weather-words.js';
import { PROMPT_WEATHER_WORDS } from '../src/lib/service-prompt.js';

/** Копия WEATHER_PATTERNS_BY_LANGUAGE из DES 2.6.0 (src/systems/ui/weatherEffects.js). */
function desTable() {
    return {
        en: [
            { id: 'blizzard', patterns: ['blizzard'] },
            { id: 'storm', patterns: ['storm', 'thunder', 'lightning'] },
            { id: 'wind', patterns: ['wind', 'breeze', 'gust', 'gale'] },
            { id: 'snow', patterns: ['snow', 'flurries'] },
            { id: 'rain', patterns: ['rain', 'drizzle', 'shower'] },
            { id: 'mist', patterns: ['mist', 'fog', 'haze'] },
            { id: 'sunny', patterns: ['sunny', 'clear', 'bright'] },
            { id: 'none', patterns: ['cloud', 'overcast', 'indoor', 'inside'] },
        ],
        ru: [
            { id: 'blizzard', patterns: ['метель'] },
            { id: 'storm', patterns: ['гроза', 'буря', 'шторм'] },
            { id: 'wind', patterns: ['ветер', 'ветрено', 'ветерок', 'бриз', 'легкий бриз', 'слегка ветрено', 'легкий ветер', 'шквал,буря'] },
            { id: 'snow', patterns: ['снег', 'снегопад'] },
            { id: 'rain', patterns: ['дождь', 'морось', 'ливень'] },
            { id: 'mist', patterns: ['мгла', 'туман', 'туманно'] },
            { id: 'sunny', patterns: ['солнечно', 'ясно', 'ярко', 'ясное утро', 'ясный день'] },
            { id: 'none', patterns: ['облачно', 'пасмурно', 'в помещении', 'внутри'] },
        ],
    };
}

const FORMS = {
    'дождливо': 'rain', 'моросит': 'rain', 'ливни': 'rain', 'проливной дождь': 'rain',
    'вьюга': 'blizzard', 'пурга': 'blizzard', 'метели': 'blizzard', 'буран': 'blizzard', 'снежная буря': 'blizzard',
    'грозовой фронт': 'storm', 'ураган': 'storm', 'в бурю': 'storm',
    'шквал': 'wind', 'ветреный вечер': 'wind',
    'снежно': 'snow',
    'дымка': 'mist', 'мглистый рассвет': 'mist', 'марево': 'mist',
    'ясный': 'sunny', 'солнечный день': 'sunny', 'безоблачно': 'sunny', 'Звёздная ночь': 'sunny',
};

test('without our words DES misses ordinary Russian forms', () => {
    const table = desTable();
    for (const text of Object.keys(FORMS)) {
        if (['проливной дождь', 'в бурю', 'снежная буря', 'безоблачно'].includes(text)) continue;
        assert.equal(desWeatherTypeOf(text, table), 'none', text);
    }
    // «безоблачно» содержит «облачно», а «снежная буря» — «буря»: без нас это «без эффекта» и «гроза»
    assert.equal(desWeatherTypeOf('безоблачно', table), 'none');
    assert.equal(desWeatherTypeOf('снежная буря', table), 'storm');
});

test('with our words DES picks the right effect', () => {
    const table = desTable();
    addWeatherWords(table[DES_WEATHER.language], DEFAULT_WEATHER_WORDS);
    for (const [text, type] of Object.entries(FORMS)) assert.equal(desWeatherTypeOf(text, table), type, text);
});

test('our words do not catch ordinary text', () => {
    const table = desTable();
    addWeatherWords(table.ru, DEFAULT_WEATHER_WORDS);
    for (const text of ['угрозы нет', 'без солнца', 'дым от костра', 'градусов десять', 'громко', 'облачно', 'пасмурно']) {
        assert.equal(desWeatherTypeOf(text, table), 'none', text);
    }
    // Известное ограничение самого DES: его слово «гроза» сидит внутри «угроза».
    assert.equal(desWeatherTypeOf('угроза', desTable()), 'storm');
});

test('the words we ask the model for work even without our additions', () => {
    const expected = ['blizzard', 'storm', 'wind', 'snow', 'rain', 'mist', 'sunny', 'none', 'none'];
    assert.deepEqual(PROMPT_WEATHER_WORDS.map((word) => desWeatherTypeOf(word, desTable())), expected);
});

test('DES order still decides mixed forecasts', () => {
    const table = desTable();
    addWeatherWords(table.ru, DEFAULT_WEATHER_WORDS);
    assert.equal(desWeatherTypeOf('Ясно, лёгкий ветер', table), 'wind');
    assert.equal(desWeatherTypeOf('Cloudy, дождь', table), 'none');
});

test('undo removes exactly what was added, twice is harmless', () => {
    const table = desTable();
    const original = structuredClone(table);
    const { added, undo } = addWeatherWords(table.ru, { ...DEFAULT_WEATHER_WORDS, rain: ['дождь', 'дожд'] });
    assert.ok(added.length > 10);
    assert.ok(!added.some((entry) => entry.word === 'дождь'), 'слово, которое у DES уже есть, не дописывается');
    undo();
    undo();
    assert.deepEqual(table, original);
});

test('words for a type DES does not have are reported', () => {
    const { missingTypes } = addWeatherWords(desTable().ru, { hail: ['град'], rain: ['дожд'] });
    assert.deepEqual(missingTypes, ['hail']);
});

test('user word lists are cleaned up', () => {
    assert.deepEqual(parseWordList(' дожд, морос;ливн\n\n'), ['дожд', 'морос', 'ливн']);
    const { words, rejected } = normalizeWeatherWords({
        rain: 'Дожд, дожд,  морос ,ли, 123, ливн',
        snow: ['Снеж  ная'],
        hail: ['град'],
        mist: '',
    }, DES_WEATHER.types);
    assert.deepEqual(words, { rain: ['дожд', 'морос', 'ливн'], snow: ['снеж ная'] });
    assert.deepEqual(rejected, ['ли', '123']);
    assert.deepEqual(normalizeWeatherWords(null, DES_WEATHER.types), { words: {}, rejected: [] });
});

test('built-in words survive normalization unchanged', () => {
    const { words, rejected } = normalizeWeatherWords(DEFAULT_WEATHER_WORDS, DES_WEATHER.types);
    assert.deepEqual(rejected, []);
    assert.ok(sameWeatherWords(words, DEFAULT_WEATHER_WORDS));
    assert.ok(!sameWeatherWords(words, { ...DEFAULT_WEATHER_WORDS, rain: ['дожд'] }));
});

test('desHourOf reads time the way DES does', () => {
    assert.equal(desHourOf('19:40'), 19);
    assert.equal(desHourOf('Поздний вечер, 23:10'), 23);
    assert.equal(desHourOf('3 PM'), 15);
    assert.equal(desHourOf('evening'), 19);
    assert.equal(desHourOf('midnight'), 22, 'у DES «night» проверяется раньше «midnight»');
    assert.equal(desHourOf('Вечер'), null);
    assert.equal(desHourOf(''), null);
});
