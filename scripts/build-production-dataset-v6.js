const fs = require("fs");
const path = require("path");

const rulesPath = path.join(__dirname, "..", "seed", "normalized-v5_2", "rules.v5.2.json");
const visualPath = path.join(__dirname, "..", "seed", "visual-final", "visual-rules.v5.5.json");
const themesPath = path.join(__dirname, "..", "seed", "examThemes.json");

const outputDir = path.join(__dirname, "..", "seed", "production");
fs.mkdirSync(outputDir, { recursive: true });

for (const file of [rulesPath, visualPath, themesPath]) {
  if (!fs.existsSync(file)) {
    throw new Error("Missing input: " + file);
  }
}

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const visuals = JSON.parse(fs.readFileSync(visualPath, "utf8"));
const themes = JSON.parse(fs.readFileSync(themesPath, "utf8"));

const sourceUrls = {
  zdvp: "https://www.sars.gov.bg/download/закон-за-движение-по-пътищата/",
  ppzdvp: "https://www.sars.gov.bg/download/правилник-за-прилагане-на-закона-за-дв/",
  nar37: "https://www.rta.government.bg/upload/642/n37.pdf",
  nar38: "https://rta.government.bg/upload/13049/n38.pdf",
  road_signs: "https://www.sars.gov.bg/wp-content/uploads/2024/07/НАРЕДБА-№-РД-02-21-1-ОТ-23-НОЕМВРИ-2023-Г.-ЗА-СИГНАЛИЗАЦИЯ-НА-ПЪТИЩАТА-С-ПЪТНИ-ЗНАЦИ.pdf",
  road_marking: "https://www.sars.gov.bg/download/наредба-№-2-от-17-януари-2001-г-за-сигнализация-на-пътищата-с-пътна-маркировка/",
  traffic_lights: "https://www.sars.gov.bg/wp-content/uploads/2025/10/РД-02-21-2.pdf",
  first_aid: "https://www.sars.gov.bg/bългарско-законодателство/"
};

function makeLegalReference(rule) {
  return {
    sourceId: rule.sourceId,
    sourceUrl: sourceUrls[rule.sourceId] || null,
    article: rule.article || null,
    paragraph: rule.paragraph || null,
    item: rule.item || null,
    letter: rule.letter || null
  };
}

function scopeOf(rule) {
  if (rule.learnerScope === "ADMINISTRATIVE") return "ADMINISTRATIVE";
  if (rule.learnerScope === "OUT_OF_SCOPE") return "OUT_OF_SCOPE";
  if (rule.examRelevance?.status === "suggested") return "EXAM_RELEVANT";
  if (rule.learnerScope === "LEARNER_CORE") return "LEARNER_CORE";
  if (rule.learnerScope === "EXAM_RELEVANT") return "EXAM_RELEVANT";
  if (rule.learnerScope === "LEARN") return "LEARN";
  return "GENERAL_REFERENCE";
}

const finalRules = [];
const seen = new Set();

for (const rule of rules) {
  const scope = scopeOf(rule);

  const record = {
    id: rule.id,
    type: "LAW_RULE",
    country: "BG",
    language: "bg",
    sourceId: rule.sourceId,
    article: rule.article || null,
    paragraph: rule.paragraph || null,
    item: rule.item || null,
    letter: rule.letter || null,
    exactText: rule.exactText,
    normalizedText: rule.normalizedText || rule.exactText,
    topicIds: Array.isArray(rule.topicIds) ? rule.topicIds : [],
    categoryBRelevant: scope !== "OUT_OF_SCOPE" && scope !== "ADMINISTRATIVE",
    learnerScope: scope,
    legalReference: makeLegalReference(rule),
    active: rule.active !== false,
    verified: false,
    verificationStatus: "needs_legal_verification",
    normalizationStatus: rule.normalizationStatus || null,
    parentArticleId: rule.parentArticleId || null
  };

  if (!seen.has(record.id)) {
    finalRules.push(record);
    seen.add(record.id);
  }
}

for (const visual of visuals) {
  const record = {
    id: visual.id,
    type: "VISUAL_RULE",
    country: "BG",
    language: "bg",
    sourceId: visual.sourceId,
    article: null,
    paragraph: null,
    item: visual.item || null,
    letter: null,
    exactText: visual.exactText,
    normalizedText: visual.normalizedText || visual.exactText,
    topicIds: Array.isArray(visual.topicIds) ? visual.topicIds : [],
    categoryBRelevant: visual.categoryBRelevance !== false,
    learnerScope: visual.learnerScope || "LEARNER_CORE",
    visualType: visual.visualType,
    visualCode: visual.visualCode || null,
    visualName: visual.visualName || null,
    legalReference: {
      sourceId: visual.sourceId,
      sourceUrl: sourceUrls[visual.sourceId] || null
    },
    active: true,
    verified: false,
    verificationStatus: "needs_legal_verification",
    normalizationStatus: visual.normalizationType || null,
    parentVisualBlockId: visual.parentVisualBlockId || null
  };

  if (!seen.has(record.id)) {
    finalRules.push(record);
    seen.add(record.id);
  }
}

const byScope = {};
const byType = {};
const byTheme = {};

for (const theme of themes) {
  byTheme[theme.id] = {
    number: theme.number,
    name: theme.name,
    count: 0
  };
}

for (const record of finalRules) {
  byScope[record.learnerScope] = (byScope[record.learnerScope] || 0) + 1;
  byType[record.type] = (byType[record.type] || 0) + 1;

  for (const themeId of record.topicIds) {
    if (byTheme[themeId]) {
      byTheme[themeId].count++;
    }
  }
}

const learnerCore = finalRules.filter(r =>
  r.categoryBRelevant &&
  r.learnerScope === "LEARNER_CORE"
);

const examRelevant = finalRules.filter(r =>
  r.categoryBRelevant &&
  r.learnerScope === "EXAM_RELEVANT"
);

const learn = finalRules.filter(r =>
  r.categoryBRelevant &&
  r.learnerScope === "LEARN"
);

const review = finalRules.filter(r =>
  r.verificationStatus === "needs_legal_verification"
);

const report = {
  generatedAt: new Date().toISOString(),
  merger: "RoadMind V6 production candidate merger",
  lawRulesInput: rules.length,
  visualRulesInput: visuals.length,
  finalRecords: finalRules.length,
  byScope,
  byType,
  byTheme,
  learnerCore: learnerCore.length,
  examRelevant: examRelevant.length,
  learn: learn.length,
  reviewForLegalVerification: review.length,
  verifiedCount: finalRules.filter(r => r.verified === true).length,
  note: "This is a production candidate dataset. No record has been legally verified by this script."
};

function save(file, data) {
  fs.writeFileSync(
    path.join(outputDir, file),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

save("lawRules.production-candidates.v6.json", finalRules);
save("learner-core.v6.json", learnerCore);
save("exam-relevant.v6.json", examRelevant);
save("learn.v6.json", learn);
save("legal-review.v6.json", review);
save("report.v6.json", report);

console.log("Law rules input: " + rules.length);
console.log("Visual rules input: " + visuals.length);
console.log("Final records: " + finalRules.length);
console.log("Learner core: " + learnerCore.length);
console.log("Exam relevant: " + examRelevant.length);
console.log("Learn: " + learn.length);
console.log("Legal review queue: " + review.length);
console.log("Verified: " + report.verifiedCount);
console.log("Output: seed/production/");
