const fs = require("fs");
const path = require("path");

const inputPath = path.join(
    __dirname,
    "..",
    "seed",
    "exam-relevance",
    "exam-relevance.classified.json"
);

const outputDir = path.join(
    __dirname,
    "..",
    "seed",
    "production-candidates"
);

if (!fs.existsSync(inputPath)) {
    throw new Error("Missing exam relevance file: " + inputPath);
}

fs.mkdirSync(outputDir, { recursive: true });

const rules = JSON.parse(
    fs.readFileSync(inputPath, "utf8")
);

const CORE_SOURCES = new Set([
    "zdvp",
    "ppzdvp",
    "road_signs",
    "road_marking",
    "traffic_lights",
    "first_aid"
]);

const LIMITED_SOURCES = new Set([
    "nar37",
    "nar38"
]);

const LEARN_PATTERNS = [
    "водачът трябва",
    "водачът е длъжен",
    "забранено е",
    "предимство",
    "пропуска",
    "скорост",
    "дистанция",
    "маневра",
    "престрояване",
    "завой",
    "паркиране",
    "престой",
    "пешеход",
    "велосипед",
    "светофар",
    "светлинен сигнал",
    "пътен знак",
    "пътна маркировка",
    "железопътен прелез",
    "автомагистрала",
    "скоростен път",
    "пътнотранспортно произшествие",
    "техническа изправност"
];

const EXAM_PATTERNS = [
    "изпит",
    "изпитни",
    "теоретичен",
    "въпрос",
    "оценяване",
    "правилата за движение",
    "пътните знаци",
    "маркировката"
];

const ADMIN_PATTERNS = [
    "регистър",
    "разрешение",
    "учебен център",
    "изпитна комисия",
    "комисия за изпит",
    "протокол",
    "служебен",
    "контролна проверка",
    "организиране на изпита",
    "изпитващ"
];

const TOPIC_PRIORITY = {
    theme_04: ["road_signs", "traffic_lights", "road_marking"],
    theme_05: ["road_marking"],
    theme_06: ["zdvp"],
    theme_07: ["zdvp", "road_marking"],
    theme_08: ["zdvp", "ppzdvp", "road_signs", "traffic_lights"],
    theme_09: ["zdvp", "ppzdvp"],
    theme_12: ["zdvp", "ppzdvp", "road_marking"],
    theme_18: ["zdvp", "first_aid"],
    theme_19: ["ppzdvp", "first_aid"]
};

function normalize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/ѝ/g, "и")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function countHits(text, patterns) {
    return patterns.reduce(
        (count, pattern) =>
            count + (text.includes(normalize(pattern)) ? 1 : 0),
        0
    );
}

function chooseScope(rule) {
    const text = normalize(
        [
            rule.exactText,
            rule.sourceId,
            rule.article,
            rule.paragraph,
            rule.item,
            rule.letter
        ].join(" ")
    );

    const adminHits = countHits(text, ADMIN_PATTERNS);
    const learnHits = countHits(text, LEARN_PATTERNS);
    const examHits = countHits(text, EXAM_PATTERNS);

    const topicIds = Array.isArray(rule.topicIds)
        ? rule.topicIds
        : [];

    const topicCount = topicIds.length;

    if (
        LIMITED_SOURCES.has(rule.sourceId) &&
        adminHits > 0
    ) {
        return {
            scope: "ADMINISTRATIVE",
            score: 0,
            reason: "Administrative wording in training/exam regulation"
        };
    }

    if (
        rule.sourceId === "nar38" &&
        topicIds.includes("theme_17") &&
        examHits === 0
    ) {
        return {
            scope: "GENERAL_REFERENCE",
            score: 2,
            reason: "Potentially relevant legal background, not clearly learner-core"
        };
    }

    let score = 0;

    if (CORE_SOURCES.has(rule.sourceId)) score += 4;
    if (LIMITED_SOURCES.has(rule.sourceId)) score += 1;

    score += learnHits * 2;
    score += examHits;
    score += Math.min(topicCount, 2) * 2;

    for (const topicId of topicIds) {
        const sources = TOPIC_PRIORITY[topicId] || [];

        if (sources.includes(rule.sourceId)) {
            score += 4;
        }
    }

    if (adminHits > 0) {
        score -= adminHits * 5;
    }

    if (
        topicIds.length === 0 &&
        learnHits === 0 &&
        examHits === 0
    ) {
        return {
            scope: "GENERAL_REFERENCE",
            score: Math.max(0, score),
            reason: "No strong learner/exam evidence"
        };
    }

    if (score >= 15) {
        return {
            scope: "LEARNER_CORE",
            score,
            reason: "Strong learner and exam relevance"
        };
    }

    if (score >= 9) {
        return {
            scope: "EXAM_RELEVANT",
            score,
            reason: "Strong exam relevance"
        };
    }

    if (score >= 5) {
        return {
            scope: "LEARN",
            score,
            reason: "Useful learner content"
        };
    }

    return {
        scope: "REVIEW",
        score,
        reason: "Ambiguous relevance"
    };
}

const all = [];
const review = [];
const learnerCore = [];
const examRelevant = [];
const learn = [];
const general = [];
const administrative = [];
const outOfScope = [];

const stats = {
    total: rules.length,
    LEARNER_CORE: 0,
    EXAM_RELEVANT: 0,
    LEARN: 0,
    GENERAL_REFERENCE: 0,
    ADMINISTRATIVE: 0,
    OUT_OF_SCOPE: 0,
    REVIEW: 0,
    byTheme: {}
};

for (const rule of rules) {
    const result = chooseScope(rule);

    const enriched = {
        ...rule,
        learnerScope: result.scope,
        learnerScopeScore: result.score,
        learnerScopeReason: result.reason,
        categoryBRelevance: result.scope !== "OUT_OF_SCOPE",
        verified: false,
        verificationStatus: "needs_legal_verification"
    };

    all.push(enriched);
    stats[result.scope] = (stats[result.scope] || 0) + 1;

    for (const themeId of enriched.topicIds || []) {
        if (!stats.byTheme[themeId]) {
            stats.byTheme[themeId] = 0;
        }

        stats.byTheme[themeId]++;
    }

    if (result.scope === "LEARNER_CORE") learnerCore.push(enriched);
    else if (result.scope === "EXAM_RELEVANT") examRelevant.push(enriched);
    else if (result.scope === "LEARN") learn.push(enriched);
    else if (result.scope === "GENERAL_REFERENCE") general.push(enriched);
    else if (result.scope === "ADMINISTRATIVE") administrative.push(enriched);
    else if (result.scope === "OUT_OF_SCOPE") outOfScope.push(enriched);
    else review.push(enriched);
}

function save(fileName, data) {
    fs.writeFileSync(
        path.join(outputDir, fileName),
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

save("rules.v4.json", all);
save("learner-core.v4.json", learnerCore);
save("exam-relevant.v4.json", examRelevant);
save("learn.v4.json", learn);
save("general-reference.v4.json", general);
save("administrative.v4.json", administrative);
save("review.v4.json", review);
save(
    "report.v4.json",
    {
        generatedAt: new Date().toISOString(),
        classifier: "learner-scope-exam-aware-v4",
        ...stats
    }
);

console.log("Total rules: " + stats.total);
console.log("Learner core: " + stats.LEARNER_CORE);
console.log("Exam relevant: " + stats.EXAM_RELEVANT);
console.log("Learn: " + stats.LEARN);
console.log("General reference: " + stats.GENERAL_REFERENCE);
console.log("Administrative: " + stats.ADMINISTRATIVE);
console.log("Out of scope: " + stats.OUT_OF_SCOPE);
console.log("Review: " + stats.REVIEW);
console.log("Output: seed/production-candidates/");
console.log("IMPORTANT: this is classification only; no legal verification has been performed.");
