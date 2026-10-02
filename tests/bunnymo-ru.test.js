import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECTOR_STEMS_RU, ROBOTIC_STEMS_RU, stemsKey } from '../src/lib/bunnymo-ru.js';
import { compileKey } from '../src/lib/regex-keys.js';

const key = (stems) => {
    const regex = compileKey(stemsKey(stems));
    assert.ok(regex, 'ST must accept the key');
    return regex;
};

test('every detector key is a valid ST regex key', () => {
    for (const [name, stems] of Object.entries(DETECTOR_STEMS_RU)) assert.ok(compileKey(stemsKey(stems)), name);
    assert.ok(compileKey(stemsKey(ROBOTIC_STEMS_RU)));
});

test('detectors fire on Russian prose', () => {
    const cases = {
        jealousy: ['Она ревновала его к каждой.', 'Зависть жгла изнутри.'],
        arousal: ['Он был возбуждён.', 'Дыхание стало прерывистым и сбивчивым дыханием'],
        trauma: ['Её накрыла паника.', 'Ему было больно.', 'Флешбэк вернул её в подвал.'],
        conflict: ['— Ты меня бесишь!', 'Они снова поссорились.', 'Он злится.'],
        attachment: ['Не уходи, пожалуйста.', 'Ей было одиноко.'],
        flirting: ['Она игриво подмигнула.', 'Он явно флиртовал.'],
        boundary: ['Хватит. Не трогай меня.', 'Это нарушает моё личное пространство.'],
    };
    for (const [name, sentences] of Object.entries(cases)) {
        const regex = key(DETECTOR_STEMS_RU[name]);
        for (const sentence of sentences) assert.ok(regex.test(sentence), `${name}: ${sentence}`);
    }
});

test('detectors do not fire inside other words', () => {
    assert.ok(!key(DETECTOR_STEMS_RU.trauma).test('Это больше не повторится.'));
    assert.ok(!key(DETECTOR_STEMS_RU.conflict).test('Он любит спорт и заплатил залог.'));
    assert.ok(!key(DETECTOR_STEMS_RU.boundary).test('На столе стопка книг.'));
    assert.ok(!key(DETECTOR_STEMS_RU.jealousy).test('Ей повезло.'));
});

test('the anti-clanker key catches robotic Russian, not normal speech', () => {
    const regex = key(ROBOTIC_STEMS_RU);
    assert.ok(regex.test('Запрос принят. Выполняю протокол.'));
    assert.ok(regex.test('Это оптимальное решение согласно инструкции.'));
    assert.ok(!regex.test('— Пойдём домой, — тихо сказала она.'));
    for (const text of ['Калибрую сенсоры.', 'Протокол активирован.', 'Входные данные получены.', 'Задача с наивысшим приоритетом.',
        'Следую инструкциям.', 'Модуль памяти отключён.']) {
        assert.ok(regex.test(text), text);
    }
});

test('detectors still fire on real triggers phrased in everyday Russian', () => {
    const cases = {
        jealousy: ['Её неуверенность росла.', 'Я не уверена в себе.'],
        arousal: ['Я хочу тебя.', 'Её охватила истома.', 'Она жаждала его прикосновений.'],
        trauma: ['Он ранен.', 'Я разбита.', 'Её сковал страх.', 'Полон страхов.', 'Это ужасно!', 'Боль пронзила плечо.'],
        conflict: ['Началась драка.', 'Спор затянулся.'],
        attachment: ['Ты бросил меня!', 'Она чувствовала себя покинутой.', 'Не покидай меня.', 'Он привязался к ней.'],
        flirting: ['Её манящий взгляд.', 'Она поманила его пальцем.'],
        boundary: ['Стоп!', 'Ты переходишь все границы.', 'Уважай мои границы.', 'Хватит меня трогать.', 'Без моего согласия — нет.',
            'Так нельзя.', 'Я уважаю тебя.', 'Я на пределе.'],
        sex: ['Её оргазм.', 'Он кончил.', 'Его член.'],
    };
    for (const [name, sentences] of Object.entries(cases)) {
        const regex = key(DETECTOR_STEMS_RU[name]);
        for (const sentence of sentences) assert.ok(regex.test(sentence), `${name}: ${sentence}`);
    }
});

test('detectors and the anti-clanker stay quiet on everyday words', () => {
    const everyday = ['дракон', 'драконы', 'драконица', 'страховка', 'больница', 'больничный', 'бросил мяч', 'граница королевства',
        'в пределах города', 'стопа', 'нельзя', 'член совета', 'члены экипажа', 'Маня пришла', 'калибр пули', 'приоритет', 'спорынья',
        'раненько', 'Ей хватит денег', 'он согласился', 'уважаемый господин', 'желание помочь', 'жажда', 'ужасно рад', 'разбитая чашка',
        'предельно ясно', 'судебный протокол', 'данные', 'по данным разведки', 'модуль', 'инструкция по сборке', 'Он покинул комнату.',
        'Его привязали к стулу.', 'Всё кончилось.', 'Время кончается.', 'Хочу тебя спросить.', 'Хочу его увидеть.', 'неуверенно улыбнулась'];
    for (const [name, stems] of [...Object.entries(DETECTOR_STEMS_RU), ['robotic', ROBOTIC_STEMS_RU]]) {
        const regex = key(stems);
        for (const text of everyday) assert.ok(!regex.test(text), `${name}: ${text}`);
    }
});

test('Russian detector keys do not fire inside tags either', () => {
    assert.ok(!key(DETECTOR_STEMS_RU.jealousy).test('<TRAIT:ревнивая>'));
    assert.ok(key(DETECTOR_STEMS_RU.jealousy).test('<i>ревнивая</i>'));
});
