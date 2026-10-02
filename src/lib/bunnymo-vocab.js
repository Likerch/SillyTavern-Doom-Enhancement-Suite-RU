// Словарь машинного слоя BunnyMo: русские ключи тегов и частые русские значения → английские.
//
// Паки BunnyMo срабатывают по точному английскому тегу (<SPECIES:ELF>), CarrotKernel и DES тоже ждут
// английские ключи. Если модель всё же напишет тег по-русски, нормализатор вернёт английский.
// Значения здесь — только частые; редкие подбираются транслитом по словарю паков (bunnymo-normalize.js).

/** Русский ключ тега (верхний регистр, пробелы → «_») → английский. */
export const TAG_KEYS_RU = Object.freeze({
    ИМЯ: 'Name', ЖАНР: 'GENRE', ВИД: 'SPECIES', РАСА: 'SPECIES', ПОЛ: 'GENDER', ВОЗРАСТ: 'AGE',
    ЦВЕТ_ВОЛОС: 'HAIRCOLOR', ВОЛОСЫ: 'HAIRCOLOR', ЦВЕТ_ГЛАЗ: 'EYECOLOR', ГЛАЗА: 'EYECOLOR',
    ЦВЕТ_КОЖИ: 'SKINCOLOR', КОЖА: 'SKINCOLOR', ШРИФТ: 'FONT', ЦВЕТ_ШРИФТА: 'FONT',
    ТЕЛОСЛОЖЕНИЕ: 'BUILD', СЛОЖЕНИЕ: 'BUILD', КОМПЛЕКЦИЯ: 'BUILD', СТИЛЬ: 'STYLE',
    ДЕРЕ: 'DERE', ЧЕРТА: 'TRAIT', ЧЕРТЫ: 'TRAIT', ПРИВЯЗАННОСТЬ: 'ATTACHMENT', ПРИВЯЗАНОСТЬ: 'ATTACHMENT',
    КОНФЛИКТ: 'CONFLICT', ГРАНИЦЫ: 'BOUNDARIES', ГРАНИЦА: 'BOUNDARIES', ФЛИРТ: 'FLIRTING',
    ОРИЕНТАЦИЯ: 'ORIENTATION', ВЛАСТЬ: 'POWER', ДОМИНИРОВАНИЕ: 'POWER', КИНК: 'KINK', ФЕТИШ: 'KINK',
    ХИМИЯ: 'CHEMISTRY', ВОЗБУЖДЕНИЕ: 'AROUSAL', ТРАВМА: 'TRAUMA', РЕВНОСТЬ: 'JEALOUSY',
    ПСИХИКА: 'BSM', БСМ: 'BSM', ДИАГНОЗ: 'BSM', РАССТРОЙСТВО: 'BSM', ПСИХИЧЕСКОЕ: 'MENTAL',
    СОСТОЯНИЕ: 'CONDITION', ЗАБОЛЕВАНИЕ: 'CONDITION', БОЛЕЗНЬ: 'CONDITION', ЛЕКАРСТВО: 'MED', ЛЕКАРСТВА: 'MED',
    ПРЕПАРАТ: 'MED', МЕД: 'MED', РЕК: 'REC', НАРКОТИК: 'REC', НАРКОТИКИ: 'REC', ЛИНГ: 'LING', РЕЧЬ: 'LING',
    РЕШЕНИЯ: 'DECISION', РЕШЕНИЕ: 'DECISION', УТЕШЕНИЕ: 'COMFORT', КОМФОРТ: 'COMFORT', ПОРОК: 'VICE', ПОРОКИ: 'VICE',
    ВЕРНОСТЬ: 'LOYALTY', ЛОЯЛЬНОСТЬ: 'LOYALTY', ДОВЕРИЕ: 'TRUST', МАСКА: 'MASK', АРХЕТИП: 'ARCHETYPE', ТЕГ: 'TAG',
    СТИХИЯ: 'BENDER', БОЖЕСТВО: 'DIVINE', ДОМЕН: 'DOMAIN', СФЕРА: 'DOMAIN',
});

/** Русские обёртки блоков (открывающий и закрывающий тег) → английские. */
export const WRAPPERS_RU = Object.freeze({
    ФИЗИЧЕСКОЕ: 'PHYSICAL', ФИЗИЧЕСКИЕ: 'PHYSICAL', ВНЕШНОСТЬ: 'PHYSICAL', ЛИЧНОСТЬ: 'PERSONALITY', ХАРАКТЕР: 'PERSONALITY',
    ЗДОРОВЬЕ: 'HEALTH', ЖАНР: 'Genre', ЛИНГВИСТИКА: 'Linguistics', ПСИХИЧЕСКОЕ_ЗДОРОВЬЕ: 'MentalHealth', ПСИХИКА: 'MentalHealth',
    ФИЗИЧЕСКИЕ_СОСТОЯНИЯ: 'PhysicalConditions', СОСТОЯНИЯ: 'PhysicalConditions', ЛЕКАРСТВА: 'Medications', МЕДИКАМЕНТЫ: 'Medications',
    БАННИМОТЕГИ: 'BunnymoTags', БАННИМО_ТЕГИ: 'BunnymoTags', ТЕГИ_БАННИМО: 'BunnymoTags',
});

/**
 * Частые русские значения → английские. Ключ — значение в нижнем регистре, ё → е, пробелы и дефисы → «_».
 * Прилагательные (черты, речь) — основой без окончания: «спокойн» ловит «спокойный», «спокойная», «спокойное».
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const VALUES_RU = Object.freeze({
    GENDER: {
        мужской: 'MALE', мужчина: 'MALE', парень: 'MALE', м: 'MALE', муж: 'MALE',
        женский: 'FEMALE', женщина: 'FEMALE', девушка: 'FEMALE', ж: 'FEMALE', жен: 'FEMALE',
        небинарный: 'NONBINARY', небинарная: 'NONBINARY', небинарное: 'NONBINARY', агендер: 'AGENDER', гендерфлюид: 'GENDERFLUID',
    },
    SPECIES: {
        человек: 'HUMAN', люди: 'HUMAN', эльф: 'ELF', эльфийка: 'ELF', темный_эльф: 'DARK_ELF', дроу: 'DROW', полуэльф: 'HALF_ELF',
        гном: 'DWARF', дворф: 'DWARF', дварф: 'DWARF', гномик: 'GNOME', орк: 'ORC', орчиха: 'ORC', полуорк: 'HALF_ORC',
        гоблин: 'GOBLIN', хобгоблин: 'HOBGOBLIN', хоббит: 'HALFLING', полурослик: 'HALFLING', вампир: 'VAMPIRE', вампирша: 'VAMPIRE',
        оборотень: 'WEREWOLF', вервольф: 'WEREWOLF', волколак: 'WEREWOLF', демон: 'DEMON', демоница: 'DEMON', дьявол: 'DEVIL', черт: 'DEVIL',
        ангел: 'ANGEL', падший_ангел: 'FALLEN_ANGEL', дракон: 'DRAGON', драконица: 'DRAGON', драконорожденный: 'DRAGONBORN',
        кицунэ: 'KITSUNE', кицуне: 'KITSUNE', лисица_оборотень: 'KITSUNE', кошкодевочка: 'CATFOLK', кошколюд: 'CATFOLK', неко: 'CATFOLK',
        лисолюд: 'FOXFOLK', фея: 'FAIRY', пикси: 'PIXIE', русалка: 'MERFOLK', русал: 'MERFOLK', тритон: 'MERFOLK', сирена: 'SIREN',
        нага: 'NAGA', ламия: 'LAMIA', гарпия: 'HARPY', кентавр: 'CENTAUR', минотавр: 'MINOTAUR', фавн: 'FAUN', сатир: 'SATYR',
        дриада: 'DRYAD', нимфа: 'NYMPH', суккуб: 'SUCCUBUS', суккубша: 'SUCCUBUS', инкуб: 'INCUBUS', призрак: 'GHOST', привидение: 'GHOST',
        дух: 'SPIRIT', лич: 'LICH', зомби: 'ZOMBIE', нежить: 'UNDEAD', голем: 'GOLEM', андроид: 'ANDROID', робот: 'ROBOT', киборг: 'CYBORG',
        великан: 'GIANT', гигант: 'GIANT', циклоп: 'CYCLOPS', горгона: 'GORGON', медуза: 'MEDUSA', тифлинг: 'TIEFLING', аасимар: 'AASIMAR',
        ящеролюд: 'LIZARDFOLK', людоящер: 'LIZARDFOLK', кобольд: 'KOBOLD', подменыш: 'CHANGELING', мимик: 'MIMIC', слизь: 'SLIME', слайм: 'SLIME',
        арахна: 'ARACHNE', паучиха: 'ARACHNE', полубог: 'DEMIGOD', полубогиня: 'DEMIGOD', нефилим: 'NEPHILIM', они: 'ONI', тэнгу: 'TENGU',
        екай: 'YOKAI', каппа: 'KAPPA', мико: 'MIKO', дуллахан: 'DULLAHAN', ведьма: 'WITCH', маг: 'MAGE',
    },
    GENRE: {
        фэнтези: 'FANTASY', фентези: 'FANTASY', темное_фэнтези: 'DARK_FANTASY', городское_фэнтези: 'URBAN_FANTASY',
        романтика: 'ROMANCE', роман: 'ROMANCE', любовный_роман: 'ROMANCE', драма: 'DRAMA', комедия: 'COMEDY', черная_комедия: 'DARK_COMEDY',
        ужасы: 'HORROR', хоррор: 'HORROR', мистика: 'SUPERNATURAL', сверхъестественное: 'SUPERNATURAL', детектив: 'MYSTERY', тайна: 'MYSTERY',
        приключения: 'ADVENTURE', боевик: 'ACTION', экшен: 'ACTION', экшн: 'ACTION', триллер: 'THRILLER', психологический_триллер: 'PSYCHOLOGICAL',
        научная_фантастика: 'SCIENCE_FICTION', фантастика: 'SCIENCE_FICTION', космоопера: 'SPACE_OPERA', киберпанк: 'CYBERPUNK',
        стимпанк: 'STEAMPUNK', постапокалипсис: 'APOCALYPTIC', апокалипсис: 'APOCALYPTIC', антиутопия: 'DYSTOPIAN', дистопия: 'DYSTOPIAN',
        повседневность: 'SLICE_OF_LIFE', слайс_оф_лайф: 'SLICE_OF_LIFE', исекай: 'ISEKAI', историческое: 'HISTORICAL', исторический: 'HISTORICAL',
        средневековье: 'MEDIEVAL', вестерн: 'WESTERN', криминал: 'CRIME', ограбление: 'HEIST', военное: 'MILITARY', супергерои: 'SUPERHERO',
        эротика: 'EROTIC', взросление: 'COMING_OF_AGE', от_врагов_к_возлюбленным: 'ENEMIES_TO_LOVERS', враги_в_возлюбленные: 'ENEMIES_TO_LOVERS',
        путешествие_во_времени: 'TIME_TRAVEL', академия: 'ACADEMIA', школа: 'ACADEMIA', королевская_семья: 'ROYALTY', викторианская_эпоха: 'VICTORIAN',
    },
    TRAIT: {
        спокойн: 'CALM', холодн: 'COLD', высокомерн: 'ARROGANT', надменн: 'ARROGANT', застенчив: 'SHY', робк: 'TIMID', добр: 'KIND',
        жесток: 'CRUEL', злобн: 'MALICIOUS', хитр: 'CUNNING', умн: 'INTELLIGENT', любопытн: 'CURIOUS', храбр: 'BRAVE', смел: 'BOLD',
        трусл: 'COWARDLY', верн: 'LOYAL', преданн: 'DEVOTED', ленив: 'LAZY', амбициозн: 'AMBITIOUS', честолюбив: 'AMBITIOUS',
        упрям: 'STUBBORN', импульсивн: 'IMPULSIVE', вспыльчив: 'HOT_TEMPERED', тревожн: 'ANXIOUS', циничн: 'CYNICAL', саркастичн: 'SARCASTIC',
        игрив: 'PLAYFUL', весел: 'CHEERFUL', жизнерадостн: 'CHEERFUL', мрачн: 'GLOOMY', меланхоличн: 'MELANCHOLIC', заботлив: 'CARING',
        ласков: 'AFFECTIONATE', нежн: 'GENTLE', властн: 'DOMINANT', покорн: 'SUBMISSIVE', ревнив: 'JEALOUS', собственническ: 'POSSESSIVE',
        гордый: 'PROUD', горд: 'PROUD', тщеславн: 'VAIN', эгоистичн: 'SELFISH', щедр: 'GENEROUS', честн: 'HONEST', лжив: 'DISHONEST',
        манипулятивн: 'MANIPULATIVE', харизматичн: 'CHARISMATIC', обаятельн: 'CHARMING', загадочн: 'MYSTERIOUS', таинственн: 'MYSTERIOUS',
        замкнут: 'RESERVED', отстраненн: 'ALOOF', дружелюбн: 'FRIENDLY', общительн: 'OUTGOING', серьезн: 'SERIOUS', ответственн: 'RESPONSIBLE',
        безрассудн: 'RECKLESS', осторожн: 'CAUTIOUS', терпелив: 'PATIENT', нетерпелив: 'IMPATIENT', мстительн: 'VENGEFUL', жадн: 'GREEDY',
        хаотичн: 'CHAOTIC', благородн: 'NOBLE', дисциплинированн: 'DISCIPLINED', перфекционист: 'PERFECTIONIST', прямолинейн: 'BLUNT',
        мечтательн: 'DREAMY', романтичн: 'ROMANTIC', наивн: 'NAIVE', невинн: 'INNOCENT', параноидальн: 'PARANOID', одержим: 'OBSESSIVE',
        прилипчив: 'CLINGY', зависим: 'DEPENDENT', независим: 'INDEPENDENT', бунтарск: 'REBELLIOUS', дерзк: 'SASSY', грубоват: 'CRUDE',
        груб: 'RUDE', вежлив: 'POLITE', элегантн: 'ELEGANT', энергичн: 'ENERGETIC', апатичн: 'APATHETIC', депрессивн: 'DEPRESSED',
    },
    LING: {
        формальн: 'FORMAL', официальн: 'FORMAL', разговорн: 'CASUAL', непринужденн: 'CASUAL', уличн: 'STREET', грубоват: 'CRUDE', груб: 'CRUDE',
        саркастичн: 'SARCASTIC', прямолинейн: 'BLUNT', робк: 'TIMID', заикающ: 'STUTTERING', заикание: 'STUTTERING', детск: 'CHILDLIKE',
        старческ: 'ELDERLY', королевск: 'ROYAL', аристократичн: 'ROYAL', загадочн: 'CRYPTIC', туманн: 'CRYPTIC', технич: 'TECHNICAL',
        многословн: 'VERBOSE', бессвязн: 'RAMBLING', быстр: 'RAPIDFIRE', сонн: 'SLEEPY', пьян: 'DRUNK', дик: 'FERAL', властн: 'COMMANDING',
        командн: 'COMMANDING', агрессивн: 'AGGRESSIVE', соблазнительн: 'SUGGESTIVE', кокетлив: 'SUGGESTIVE', оптимистичн: 'OPTIMISTIC',
        циничн: 'CYNICAL', идеалистичн: 'IDEALISTIC', немой: 'MUTE', немая: 'MUTE', бандитск: 'GANGSTER', протяжн: 'DRAWLING', южн: 'SOUTHERN',
    },
    BSM: {
        депрессия: 'DEPRESSION', тревожность: 'GAD', тревожное_расстройство: 'GAD', генерализованное_тревожное_расстройство: 'GAD',
        социальная_тревожность: 'SOCIAL_ANXIETY', социофобия: 'SOCIAL_ANXIETY', птср: 'PTSD', окр: 'OCD', биполярное_расстройство: 'BIPOLAR',
        биполярка: 'BIPOLAR', прл: 'BPD', пограничное_расстройство: 'BPD', нарциссизм: 'NPD', нарциссическое_расстройство: 'NPD',
        шизофрения: 'SCHIZOPHRENIA', шизоидное_расстройство: 'SCHIZOID', бессонница: 'INSOMNIA', анорексия: 'ANOREXIA', булимия: 'BULIMIA',
        амнезия: 'AMNESIA', психопатия: 'PSYCHOPATHY', социопатия: 'SOCIOPATHY', дри: 'DID', диссоциативное_расстройство: 'DID',
        деперсонализация: 'DPDR', паранойя: 'PARANOID_PD', алкоголизм: 'ALCOHOLISM', зависимость: 'SUBSTANCE_USE', лудомания: 'GAMBLING',
        клептомания: 'KLEPTOMANIA', пиромания: 'PYROMANIA', нарколепсия: 'NARCOLEPSY', ночные_кошмары: 'NIGHT_TERRORS',
        стокгольмский_синдром: 'STOCKHOLM', вина_выжившего: 'SURVIVORS_GUILT', избирательный_мутизм: 'SELECTIVE_MUTISM', накопительство: 'HOARDING',
    },
    CONDITION: {
        слепота: 'BLIND', слепой: 'BLIND', слепая: 'BLIND', глухота: 'DEAF', глухой: 'DEAF', глухая: 'DEAF', немота: 'MUTE', немой: 'MUTE', немая: 'MUTE',
        инвалидное_кресло: 'WHEELCHAIR', коляска: 'WHEELCHAIR', колясочник: 'WHEELCHAIR', трость: 'CANE', ходунки: 'WALKER',
        ампутация: 'AMPUTEE', ампутант: 'AMPUTEE', ожоги: 'BURNS', эпилепсия: 'EPILEPSY', диабет: 'DIABETES', рак: 'CANCER', артрит: 'ARTHRITIS',
        деменция: 'DEMENTIA', кома: 'COMA', альбинизм: 'ALBINISM', витилиго: 'VITILIGO', вич: 'HIV', чмт: 'TBI', черепно_мозговая_травма: 'TBI',
        синдром_туретта: 'TOURETTES', туретт: 'TOURETTES', волчанка: 'LUPUS', эндометриоз: 'ENDO', менопауза: 'MENOPAUSE',
        послеродовое_состояние: 'POSTPARTUM', пересадка: 'TRANSPLANT', трансплантация: 'TRANSPLANT', гепатит: 'HEPATITIS', герпес: 'HERPES',
    },
    MED: {
        инсулин: 'INSULIN', ингалятор: 'INHALER', литий: 'LITHIUM', химиотерапия: 'CHEMO', противозачаточные: 'BIRTH_CONTROL',
        гормоны: 'HRT', гормональная_терапия: 'HRT', метадон: 'METHADONE', адреналин: 'EPIPEN', эпипен: 'EPIPEN',
    },
    REC: {
        кокаин: 'COCAINE', героин: 'HEROIN', фентанил: 'FENTANYL', метамфетамин: 'METH', мет: 'METH', трава: 'WEED', марихуана: 'WEED',
        травка: 'WEED', никотин: 'NICOTINE', сигареты: 'NICOTINE', крэк: 'CRACK', опиоиды: 'OPIOID',
    },
    ORIENTATION: {
        гетеро: 'HETEROSEXUAL', гетеросексуал: 'HETEROSEXUAL', гетеросексуальная: 'HETEROSEXUAL', гетеросексуальный: 'HETEROSEXUAL',
        гей: 'GAY', гомосексуал: 'HOMOSEXUAL', лесбиянка: 'LESBIAN', би: 'BISEXUAL', бисексуал: 'BISEXUAL', бисексуальная: 'BISEXUAL',
        бисексуальный: 'BISEXUAL', пан: 'PANSEXUAL', пансексуал: 'PANSEXUAL', асексуал: 'ASEXUAL', асексуальная: 'ASEXUAL', асексуальный: 'ASEXUAL',
        демисексуал: 'DEMISEXUAL',
    },
    POWER: {
        доминант: 'DOMINANT', доминантка: 'DOMINANT', доминирующий: 'DOMINANT', доминирующая: 'DOMINANT', сабмиссив: 'SUBMISSIVE',
        покорный: 'SUBMISSIVE', покорная: 'SUBMISSIVE', саба: 'SUBMISSIVE', свитч: 'SWITCH', универсал: 'SWITCH',
    },
});
