const fs = require("fs");
const path = require("path");

const inputPath = path.join(
    __dirname,
    "..",
    "seed",
    "classification",
    "category-b-rules.classified.v3.json"
);

const themesPath = path.join(
    __dirname,
    "..",
    "seed",
    "examThemes.json"
);

const outputDir = path.join(
    __dirname,
    "..",
    "seed",
    "exam-relevance"
);

fs.mkdirSync(outputDir, { recursive: true });

if (!fs.existsSync(inputPath)) {
    throw new Error("Missing v3 classification: " + inputPath);
}

if (!fs.existsSync(themesPath)) {
    throw new Error("Missing exam themes: " + themesPath);
}

const rules = JSON.parse(
    fs.readFileSync(inputPath, "utf8")
);

const themes = JSON.parse(
    fs.readFileSync(themesPath, "utf8")
);

const THEME_KEYWORDS = {
    theme_01: [
        "определение",
        "означава",
        "пътно превозно средство",
        "водач",
        "участник в движението",
        "моторно превозно средство",
        "ремарке"
    ],
    theme_02: [
        "път",
        "улица",
        "пътна мрежа",
        "платно за движение",
        "тротоар",
        "банкет",
        "лента за движение",
        "автомагистрала",
        "скоростен път"
    ],
    theme_03: [
        "пешеходец",
        "велосипедист",
        "велосипед",
        "мотопед",
        "мотоциклет",
        "трамвай",
        "релсово",
        "електрическо",
        "животно",
        "специален автомобил"
    ],
    theme_04: [
        "светофар",
        "светлинен сигнал",
        "пътен знак",
        "регулировчик",
        "сигнализация",
        "регулиране",
        "пътна маркировка",
        "сигнал"
    ],
    theme_05: [
        "дясната половина",
        "положение",
        "лента",
        "насрещното движение",
        "еднопосочно движение",
        "движение в лента"
    ],
    theme_06: [
        "скорост",
        "дистанция",
        "намаляване на скоростта",
        "спиране",
        "спирачен",
        "видимост",
        "опасност",
        "скоростен режим"
    ],
    theme_07: [
        "маневра",
        "завой",
        "обратен завой",
        "престрояване",
        "престрои",
        "отклонение",
        "смяна на лента"
    ],
    theme_08: [
        "кръстовище",
        "пътен възел",
        "тунел",
        "стеснен участък",
        "железопътен прелез",
        "прелез",
        "преминаване през"
    ],
    theme_09: [
        "автомагистрала",
        "скоростен път"
    ],
    theme_10: [
        "спирка",
        "редовните линии",
        "обществен транспорт",
        "жилищна зона"
    ],
    theme_11: [
        "специални правила",
        "пешеходец",
        "велосипедист",
        "велосипед",
        "мотоциклетист",
        "мопед",
        "специален автомобил"
    ],
    theme_12: [
        "престой",
        "паркиране",
        "паркира",
        "неподвижно моторно превозно средство",
        "спиране за престой"
    ],
    theme_13: [
        "дъжд",
        "сняг",
        "залед",
        "лед",
        "мъгла",
        "хлъзг",
        "зим",
        "атмосферни условия",
        "намалена видимост"
    ],
    theme_14: [
        "маршрут",
        "пътуване",
        "организация на пътуването",
        "товар",
        "почивка",
        "планиране"
    ],
    theme_15: [
        "умора",
        "сънлив",
        "бдител",
        "внимание",
        "реакция",
        "психомотор",
        "алкохол",
        "наркот",
        "разсейване"
    ],
    theme_16: [
        "задължен",
        "длъжен",
        "задължение",
        "документ",
        "свидетелство",
        "представи",
        "спре",
        "провери",
        "водачът е длъжен"
    ],
    theme_17: [
        "глоба",
        "санкция",
        "административнонаказател",
        "наказателна отговорност",
        "лишаване от право",
        "принудителна административна мярка",
        "нарушение"
    ],
    theme_18: [
        "пътнотранспортно произшествие",
        "птп",
        "произшествие",
        "аварийна сигнализация",
        "мястото на произшествието",
        "пострадал"
    ],
    theme_19: [
        "двигател",
        "спирачна уредба",
        "спирачки",
        "гума",
        "гуми",
        "фарове",
        "светлини",
        "чистачки",
        "техническа изправност",
        "оборудване",
        "двигателно масло"
    ]
};

const SOURCE_THEME_RULES = {
    road_signs: {
        only: ["theme_04", "theme_05", "theme_08", "theme_10", "theme_12"],
        boost: 8
    },
    road_marking: {
        only: ["theme_04", "theme_05", "theme_07", "theme_08", "theme_12"],
        boost: 8
    },
    traffic_lights: {
        only: ["theme_04", "theme_08", "theme_10"],
        boost: 10
    },
    first_aid: {
        only: ["theme_15", "theme_16", "theme_18"],
        boost: 10
    },
    nar37: {
        only: ["theme_01", "theme_16"],
        boost: 3
    },
    nar38: {
        only: ["theme_16", "theme_17"],
        boost: 4
    }
};

const ADMINISTRATIVE_PATTERNS = [
    "изпитна комисия",
    "комисията за изпит",
    "протокол",
    "изпитващ",
    "регистър на учебни",
    "учебен център",
    "разрешение за обучение",
    "контролна проверка",
    "организиране на изпита",
    "служебен автомобил"
];

function normalize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/ѝ/g, "и")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function scoreTheme(rule, themeId) {
    const text = normalize([
        rule.exactText,
        rule.article,
        rule.paragraph,
        rule.item,
        rule.letter
    ].join(" "));

    let score = 0;
    const matched = [];

    for (const keyword of THEME_KEYWORDS[themeId] || []) {
        const normalized = normalize(keyword);

        if (!normalized || !text.includes(normalized)) {
            continue;
        }

        const weight =
            normalized.length >= 16 ? 6 :
            normalized.length >= 10 ? 4 :
            3;

        score += weight;
        matched.push(keyword);
    }

    const sourceRule = SOURCE_THEME_RULES[rule.sourceId];

    if (sourceRule?.only.includes(themeId)) {
        score += sourceRule.boost;
    }

    return {
        score,
        matched
    };
}

function classify(rule) {
    const allowedThemes = SOURCE_THEME_RULES[rule.sourceId]?.only || themes.map(t => t.id);

    const candidates = allowedThemes.map(themeId => {
        const result = scoreTheme(rule, themeId);

        return {
            themeId,
            score: result.score,
            matchedKeywords: result.matched
        };
    });

    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0] || {
        themeId: null,
        score: 0,
        matchedKeywords: []
    };

    const second = candidates[1] || {
        score: 0
    };

    const sourceText = normalize(rule.exactText);

    const administrative =
        ADMINISTRATIVE_PATTERNS.some(
            pattern => sourceText.includes(normalize(pattern))
        );

    if (administrative && (rule.sourceId === "nar37" || rule.sourceId === "nar38")) {
        return {
            examRelevant: false,
            relevanceStatus: "administrative_review",
            confidence: "none",
            themeIds: [],
            matchedKeywords: [],
            score: best.score
        };
    }

    if (best.score < 6) {
        return {
            examRelevant: false,
            relevanceStatus: "needs_review",
            confidence: "low",
            themeIds: [],
            matchedKeywords: best.matchedKeywords,
            score: best.score
        };
    }

    if (best.score >= 16 && best.score - second.score >= 5) {
        return {
            examRelevant: true,
            relevanceStatus: "suggested",
            confidence: "high",
            themeIds: [best.themeId],
            matchedKeywords: best.matchedKeywords,
            score: best.score
        };
    }

    if (best.score >= 9 && best.score - second.score >= 2) {
        const multi = candidates
            .filter(c => c.score >= Math.max(9, best.score * 0.70))
            .slice(0, 2)
            .map(c => c.themeId);

        return {
            examRelevant: true,
            relevanceStatus: "needs_review",
            confidence: "medium",
            themeIds: multi,
            matchedKeywords: best.matchedKeywords,
            score: best.score
        };
    }

    return {
        examRelevant: true,
        relevanceStatus: "needs_review",
        confidence: "low",
        themeIds: [best.themeId],
        matchedKeywords: best.matchedKeywords,
        score: best.score
    };
}

const output = [];
const review = [];

const stats = {
    total: rules.length,
    high: 0,
    medium: 0,
    low: 0,
    notRelevant: 0,
    administrativeReview: 0,
    byTheme: {}
};

for (const theme of themes) {
    stats.byTheme[theme.id] = {
        number: theme.number,
        name: theme.name,
        count: 0
    };
}

for (const rule of rules) {
    const result = classify(rule);

    const record = {
        ...rule,
        examRelevance: {
            category: "B",
            examRelevant: result.examRelevant,
            confidence: result.confidence,
            status: result.relevanceStatus
        },
        topicIds: result.themeIds,
        classification: {
            ...(rule.classification || {}),
            examRelevant: result.examRelevant,
            examConfidence: result.confidence,
            examStatus: result.relevanceStatus,
            examScore: result.score,
            matchedKeywords: result.matchedKeywords
        },
        verified: false,
        verificationStatus: "needs_legal_verification"
    };

    output.push(record);

    if (result.examRelevant) {
        if (result.confidence === "high") stats.high++;
        else if (result.confidence === "medium") stats.medium++;
        else stats.low++;

        for (const themeId of result.themeIds) {
            if (stats.byTheme[themeId]) {
                stats.byTheme[themeId].count++;
            }
        }
    } else {
        stats.notRelevant++;

        if (result.relevanceStatus === "administrative_review") {
            stats.administrativeReview++;
        }
    }

    if (result.relevanceStatus !== "suggested") {
        review.push(record);
    }
}

const candidateRules = output.filter(
    rule =>
        rule.examRelevance.examRelevant === true &&
        rule.examRelevance.confidence !== "low"
);

fs.writeFileSync(
    path.join(outputDir, "exam-relevance.classified.json"),
    JSON.stringify(output, null, 2),
    "utf8"
);

fs.writeFileSync(
    path.join(outputDir, "exam-relevance.candidates.json"),
    JSON.stringify(candidateRules, null, 2),
    "utf8"
);

fs.writeFileSync(
    path.join(outputDir, "exam-relevance.review.json"),
    JSON.stringify(review, null, 2),
    "utf8"
);

fs.writeFileSync(
    path.join(outputDir, "exam-relevance.report.json"),
    JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            classifier: "exam-relevance-source-aware-v1",
            ...stats
        },
        null,
        2
    ),
    "utf8"
);

console.log("Total rules: " + stats.total);
console.log("High confidence: " + stats.high);
console.log("Medium confidence: " + stats.medium);
console.log("Low confidence: " + stats.low);
console.log("Not exam relevant / review: " + stats.notRelevant);
console.log("Administrative review candidates: " + stats.administrativeReview);
console.log("Candidate file: seed/exam-relevance/exam-relevance.candidates.json");
console.log("Review queue: seed/exam-relevance/exam-relevance.review.json");
console.log("Report: seed/exam-relevance/exam-relevance.report.json");
console.log("IMPORTANT: exam relevance is a classification suggestion; legal verification remains separate.");
