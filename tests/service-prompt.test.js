import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DES_WEATHER, desForecastField, desTimeField } from '../src/des-adapter.js';
import { TIME_PLACEHOLDER_RU, WEATHER_INSTRUCTION_RU, replaceExact } from '../src/lib/service-prompt.js';

/** Кусок шаблона, как его собирает DES 2.6.0 (jsonPromptHelpers.js) без своей инструкции погоды. */
const desInstruction = `${DES_WEATHER.instructionPrefix}Valid forecast values (use one of these exactly): "blizzard", "storm", "wind", "inside"`;
const template = [
    '{',
    '  "date": {"value": "Weekday, Month, Year"},',
    `  ${desTimeField()},`,
    '  "location": {"value": "Location"},',
    `  "weather": {"emoji": "WeatherEmoji", ${desForecastField(desInstruction)}}`,
    '}',
].join('\n');

test('the stock DES pieces are found in the template', () => {
    assert.ok(template.includes('"time": {"start": "TimeStart", "end": "TimeEnd"}'));
    assert.ok(template.includes(`"forecast": "SINGLE keyword only. Valid forecast values`));
});

test('the weather instruction is swapped for the Russian one', () => {
    const result = replaceExact(template, desForecastField(desInstruction), desForecastField(WEATHER_INSTRUCTION_RU));
    assert.equal(result.replaced, 1);
    assert.ok(result.text.includes(`"forecast": "${WEATHER_INSTRUCTION_RU}"}`));
    assert.ok(!result.text.includes('SINGLE keyword only'));
    assert.ok(!WEATHER_INSTRUCTION_RU.includes('"'), 'инструкция стоит внутри кавычек JSON-шаблона');
});

test('the time template asks for hours and minutes', () => {
    const result = replaceExact(template, desTimeField(), desTimeField(TIME_PLACEHOLDER_RU, TIME_PLACEHOLDER_RU));
    assert.equal(result.replaced, 1);
    assert.ok(result.text.includes('"time": {"start": "ЧЧ:ММ", "end": "ЧЧ:ММ"}'));
});

test('nothing changes when the piece is not there', () => {
    const custom = template.replace(desInstruction, 'одно слово');
    const result = replaceExact(custom, desForecastField(desInstruction), desForecastField(WEATHER_INSTRUCTION_RU));
    assert.deepEqual(result, { text: custom, replaced: 0 });
    assert.deepEqual(replaceExact(null, 'a', 'b'), { text: null, replaced: 0 });
    assert.deepEqual(replaceExact('abc', '', 'x'), { text: 'abc', replaced: 0 });
});
