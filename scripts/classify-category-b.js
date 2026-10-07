const fs = require("fs");
const path = require("path");

const inputPath = path.join(
    __dirname,
    "..",
    "seed",
    "atomic",
    "lawRules.atomic.json"
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
    "classification"
);

fs.mkdirSync(outputDir, { recursive: true });

if (!fs.existsSync(inputPath)) {
    throw new Error("Missing atomic rules: " + inputPath);
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

// Conservative keyword-based classifier.
// It NEVER marks a rule as legally verified.
// It produces a suggested theme, confidence and review status.

const themeKeywords = {
    theme_01: [
        "пътно превозно средство",
        "водач",
        "участник в движението",
        "път",
        "автомобил",
        "ремарке",
        "категория"
    ],
    theme_02: [
        "път",
        "улица",
        "платно за движение",
        "тротоар",
        "банкeт",
        "кръстовище",
        "автомагистрала",
        "скоростен път"
    ],
    theme_03: [
        "пешеход",
        "велосипед",
        "мотопед",
        "мотоциклет",
        "трамва",
        "релсов",
        "индивидуално електрическо",
        "животни"
    ],
    theme_04: [
        "регулировчик",
        "светофар",
        "светлинен сигнал",
        "пътен знак",
        "сигнализация",
        "регулиране"
    ],
    theme_05: [
        "лента",
        "платното",
        "дясната половина",
        "положение",
        "насрещно",
        "еднопосоч"
    ],
    theme_06: [
        "скорост",
        "дистанция",
        "намали",
        "спре",
        "спирачен",
        "видимост",
        "опасност"
    ],
    theme_07: [
        "маневра",
        "завой",
        "завива",
        "обратен завой",
        "престро",
        "смяна на лента",
        "отклонение"
    ],
    theme_08: [
        "кръстовище",
        "пътен възел",
        "тунел",
        "стеснен участък",
        "железопътен прелез",
        "прелез"
    ],
    theme_09: [
        "автомагистрала",
        "скоростен път"
    ],
    theme_10: [
        "спирка",
        "обществен транспорт",
        "жилищна зона"
    ],
    theme_11: [
        "пешеход",
        "велосипедист",
        "мотоциклетист",
        "бавно движещо се",
        "специален автомобил"
    ],
    theme_12: [
        "престой",
        "паркиране",
        "паркира",
        "неподвижно"
    ],
    theme_13: [
        "дъжд",
        "сняг",
        "лед",
        "мъгла",
        "залед",
        "зима",
        "атмосфер",
        "хлъзг"
    ],
    theme_14: [
        "пътуване",
        "маршрут",
        "товар",
        "пътешествие",
        "почивка"
    ],
    theme_15: [
        "умора",
        "сънлив",
        "внимание",
        "бдител",
        "реакция",
        "психомотор",
        "алкохол",
        "наркот"
    ],
    theme_16: [
        "задължен",
        "водачът е длъжен",
        "водач е длъжен",
        "документ",
        "свидетелство",
        "проверка",
        "представи"
    ],
    theme_17: [
        "глоба",
        "глоба с фиш",
        "лишаване от право",
        "административно",
        "наказател",
        "принудителна административна мярка",
        "санкция"
    ],
    theme_18: [
        "пътнотранспортно произшествие",
        "птп",
        "произшествие",
        "мястото на произшествието",
        "аварийна сигнализация"
    ],
    theme_19: [
        "двигател",
        "спирачна уредба",
        "спирачки",
        "гума",
        "гуми",
        "светлини",
        "фарове",
        "чистачки",
        "техническа изправност",
        "оборудване"
    ]
};

const topicBoosts = {
    theme_04: ["road_signs", "traffic_lights"],
    theme_05: ["ppzdvp"],
    theme_06: ["zdvp"],
    theme_08: ["zdvp", "ppzdvp"],
    theme_19: ["technical_inspection"]
};

function normalize(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function scoreRule(rule, themeId) {
    const haystack = normalize(
        [
            rule.exactText,
            rule.title || "",
            rule.sourceId || "",
            rule.article || ""
        ].join(" ")
    );

    let score = 0;
    const matchedKeywords = [];

    for (const keyword of themeKeywords[themeId] || []) {
        const normalizedKeyword = normalize(keyword);

        if (haystack.includes(normalizedKeyword)) {
            score += keyword.length >= 8 ? 3 : 2;
            matchedKeywords.push(keyword);
        }
    }

    const boostedSources = topicBoosts[themeId] || [];

    if (boostedSources.includes(rule.sourceId)) {
        score += 2;
    }

    return {
        score,
        matchedKeywords
    };
}

function classify(rule) {
    const scores = themes.map(theme => {
        const result = scoreRule(rule, theme.id);

        return {
            themeId: theme.id,
            score: result.score,
            matchedKeywords: result.matchedKeywords
        };
    });

    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const second = scores[1];

    let confidence = "low";
    let reviewStatus = "needs_review";

    if (best.score >= 8 && best.score - second.score >= 3) {
        confidence = "high";
        reviewStatus = "auto_suggested";
    } else if (best.score >= 4 && best.score - second.score >= 2) {
        confidence = "medium";
        reviewStatus = "auto_suggested";
    }

    if (best.score === 0) {
        return {
            topicIds: [],
            suggestedTopicId: null,
            confidence: "none",
            reviewStatus: "unclassified",
            matchedKeywords: []
        };
    }

    return {
        topicIds: [best.themeId],
        suggestedTopicId: best.themeId,
        confidence,
        reviewStatus,
        matchedKeywords: best.matchedKeywords
    };
}

const classified = [];
const stats = {
    totalRules: rules.length,
    high: 0,
    medium: 0,
    low: 0,
    unclassified: 0,
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

    const item = {
        ...rule,
        topicIds: result.topicIds,
        classification: {
            suggestedTopicId: result.suggestedTopicId,
            confidence: result.confidence,
            reviewStatus: result.reviewStatus,
            matchedKeywords: result.matchedKeywords
        },
        verified: false,
        verificationStatus: "needs_legal_verification"
    };

    classified.push(item);

    if (result.confidence === "high") stats.high++;
    else if (result.confidence === "medium") stats.medium++;
    else if (result.confidence === "low") stats.low++;
    else stats.unclassified++;

    if (result.suggestedTopicId) {
        stats.byTheme[result.suggestedTopicId].count++;
    }
}

const outputPath = path.join(
    outputDir,
    "category-b-rules.classified.json"
);

const reportPath = path.join(
    outputDir,
    "classification-report.json"
);

const reviewPath = path.join(
    outputDir,
    "needs-review.json"
);

fs.writeFileSync(
    outputPath,
    JSON.stringify(classified, null, 2),
    "utf8"
);

fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            classifier: "keyword-weighted-conservative-v1",
            ...stats
        },
        null,
        2
    ),
    "utf8"
);

fs.writeFileSync(
    reviewPath,
    JSON.stringify(
        classified.filter(
            rule =>
                rule.classification.reviewStatus !== "auto_suggested"
        ),
        null,
        2
    ),
    "utf8"
);

console.log("Rules classified: " + stats.totalRules);
console.log("High confidence: " + stats.high);
console.log("Medium confidence: " + stats.medium);
console.log("Low confidence: " + stats.low);
console.log("Unclassified: " + stats.unclassified);
console.log("Output: " + outputPath);
console.log("Report: " + reportPath);
console.log("Review queue: " + reviewPath);
console.log("IMPORTANT: classification is a suggestion only; verified remains false.");
