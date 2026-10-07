const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "..", "seed", "classification", "category-b-rules.classified.v2.json");
const themesPath = path.join(__dirname, "..", "seed", "examThemes.json");
const outputDir = path.join(__dirname, "..", "seed", "classification");

if (!fs.existsSync(inputPath)) throw new Error("Missing v2 classification: " + inputPath);
if (!fs.existsSync(themesPath)) throw new Error("Missing themes: " + themesPath);

const rules = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const themes = JSON.parse(fs.readFileSync(themesPath, "utf8"));

const CORE_SOURCES = new Set([
  "zdvp",
  "ppzdvp",
  "road_signs",
  "road_marking",
  "traffic_lights",
  "first_aid"
]);

const LIMITED_SOURCES = new Set(["nar37", "nar38"]);

const EXAM_THEME_BY_SOURCE = {
  road_signs: ["theme_04", "theme_05", "theme_08", "theme_12"],
  road_marking: ["theme_04", "theme_05", "theme_07", "theme_08", "theme_12"],
  traffic_lights: ["theme_04", "theme_08"],
  first_aid: ["theme_15", "theme_16", "theme_18"],
  nar37: ["theme_01", "theme_16"],
  nar38: ["theme_16", "theme_17"]
};

const ADMIN_PATTERNS = [
  "разрешение за обучение",
  "учебен център",
  "ръководител на учебната дейност",
  "регистър",
  "комисията за изпит",
  "изпитна комисия",
  "протокол",
  "изпитващ",
  "служебен автомобил",
  "разрешение",
  "контролна проверка"
];

const OUT_OF_SCOPE_PATTERNS = [
  "собственикът на пътя",
  "възложител",
  "проектант",
  "строител",
  "пътноподдържащо предприятие",
  "технически контрол",
  "обществена поръчка",
  "административен орган"
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ѝ/g, "и")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function containsAny(text, patterns) {
  return patterns.some(p => text.includes(normalize(p)));
}

function classifyScope(rule) {
  const text = normalize([
    rule.exactText,
    rule.sourceId,
    rule.article,
    rule.paragraph,
    rule.item,
    rule.letter
  ].join(" "));

  if (containsAny(text, ADMIN_PATTERNS)) {
    return {
      scope: "ADMINISTRATIVE",
      relevance: "LOW",
      reason: "Administrative/exam-organisation wording detected"
    };
  }

  if (containsAny(text, OUT_OF_SCOPE_PATTERNS)) {
    return {
      scope: "OUT_OF_SCOPE",
      relevance: "LOW",
      reason: "Infrastructure/administrative wording detected"
    };
  }

  if (rule.sourceId === "nar37" || rule.sourceId === "nar38") {
    return {
      scope: "EXAM_OR_TRAINING_CONTEXT",
      relevance: "REVIEW",
      reason: "Training/exam regulation requires selective inclusion for learner theory"
    };
  }

  if (CORE_SOURCES.has(rule.sourceId)) {
    return {
      scope: "COMMON_ROAD_RULE",
      relevance: "REVIEW",
      reason: "Core road-traffic source; final B relevance depends on content and exam theme"
    };
  }

  if (LIMITED_SOURCES.has(rule.sourceId)) {
    return {
      scope: "EXAM_OR_TRAINING_CONTEXT",
      relevance: "REVIEW",
      reason: "Selective use"
    };
  }

  return {
    scope: "REVIEW",
    relevance: "REVIEW",
    reason: "Source not in the initial scope registry"
  };
}

const result = [];
const stats = {
  total: rules.length,
  CORE_B_CANDIDATE: 0,
  COMMON_ROAD_RULE: 0,
  EXAM_OR_TRAINING_CONTEXT: 0,
  ADMINISTRATIVE: 0,
  OUT_OF_SCOPE: 0,
  REVIEW: 0,
  suggestedByTheme: Object.fromEntries(
    themes.map(t => [t.id, { number: t.number, name: t.name, count: 0 }])
  )
};

for (const rule of rules) {
  const scopeResult = classifyScope(rule);

  let topicIds = Array.isArray(rule.topicIds) ? [...rule.topicIds] : [];

  if (scopeResult.scope === "ADMINISTRATIVE" || scopeResult.scope === "OUT_OF_SCOPE") {
    topicIds = [];
  }

  if (EXAM_THEME_BY_SOURCE[rule.sourceId]) {
    const allowed = new Set(EXAM_THEME_BY_SOURCE[rule.sourceId]);

    topicIds = topicIds.filter(t => allowed.has(t));

    if (topicIds.length === 0 && scopeResult.scope !== "ADMINISTRATIVE") {
      topicIds = EXAM_THEME_BY_SOURCE[rule.sourceId].slice(0, 1);
    }
  }

  const categoryRelevance =
    scopeResult.scope === "COMMON_ROAD_RULE" ||
    scopeResult.scope === "EXAM_OR_TRAINING_CONTEXT";

  const finalReviewStatus =
    scopeResult.scope === "ADMINISTRATIVE"
      ? "excluded_from_learner_core"
      : scopeResult.scope === "OUT_OF_SCOPE"
        ? "excluded_from_learner_core"
        : "needs_manual_legal_review";

  const enriched = {
    ...rule,
    categoryRelevance: {
      B: categoryRelevance,
      confidence: scopeResult.relevance
    },
    topicIds,
    scopeClassification: {
      scope: scopeResult.scope,
      reason: scopeResult.reason
    },
    verified: false,
    verificationStatus: finalReviewStatus
  };

  result.push(enriched);

  stats[scopeResult.scope] = (stats[scopeResult.scope] || 0) + 1;

  for (const themeId of topicIds) {
    if (stats.suggestedByTheme[themeId]) {
      stats.suggestedByTheme[themeId].count++;
    }
  }
}

const candidate = result.filter(
  r =>
    r.categoryRelevance.B === true &&
    r.scopeClassification.scope !== "ADMINISTRATIVE" &&
    r.scopeClassification.scope !== "OUT_OF_SCOPE"
);

stats.CORE_B_CANDIDATE = candidate.length;

const outputPath = path.join(outputDir, "category-b-rules.classified.v3.json");
const reportPath = path.join(outputDir, "classification-report.v3.json");
const candidatePath = path.join(outputDir, "category-b-candidates.v3.json");
const reviewPath = path.join(outputDir, "category-b-review.v3.json");

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), "utf8");
fs.writeFileSync(
  reviewPath,
  JSON.stringify(
    result.filter(r => r.verificationStatus === "needs_manual_legal_review"),
    null,
    2
  ),
  "utf8"
);
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      classifier: "scope-aware-category-b-v3",
      ...stats
    },
    null,
    2
  ),
  "utf8"
);

console.log("Total rules: " + stats.total);
console.log("B candidates: " + stats.CORE_B_CANDIDATE);
console.log("Common road rules: " + stats.COMMON_ROAD_RULE);
console.log("Exam/training context: " + stats.EXAM_OR_TRAINING_CONTEXT);
console.log("Administrative: " + stats.ADMINISTRATIVE);
console.log("Out of scope: " + stats.OUT_OF_SCOPE);
console.log("Review: " + stats.REVIEW);
console.log("Candidate file: " + candidatePath);
console.log("Review file: " + reviewPath);
console.log("Report: " + reportPath);
console.log("IMPORTANT: no rule is legally verified by this classifier.");
