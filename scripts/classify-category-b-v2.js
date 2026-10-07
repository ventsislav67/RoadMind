const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "..", "seed", "atomic", "lawRules.atomic.json");
const themesPath = path.join(__dirname, "..", "seed", "examThemes.json");
const outputDir = path.join(__dirname, "..", "seed", "classification");

fs.mkdirSync(outputDir, { recursive: true });

const rules = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const themes = JSON.parse(fs.readFileSync(themesPath, "utf8"));

const PRIORITY_SOURCES = {
  zdvp: { baseRelevance: 1.0 },
  ppzdvp: { baseRelevance: 1.0 },
  road_signs: { baseRelevance: 1.0 },
  road_marking: { baseRelevance: 1.0 },
  traffic_lights: { baseRelevance: 1.0 },
  first_aid: { baseRelevance: 0.85 },
  nar37: { baseRelevance: 0.35 },
  nar38: { baseRelevance: 0.50 }
};

const SOURCE_THEME_WEIGHTS = {
  road_signs: {
    theme_04: 8,
    theme_05: 2,
    theme_08: 4,
    theme_12: 1
  },
  road_marking: {
    theme_04: 6,
    theme_05: 5,
    theme_07: 2,
    theme_08: 3,
    theme_12: 2
  },
  traffic_lights: {
    theme_04: 10,
    theme_08: 4
  },
  first_aid: {
    theme_15: 3,
    theme_16: 3,
    theme_18: 10
  },
  nar37: {
    theme_01: 2,
    theme_16: 3
  },
  nar38: {
    theme_16: 5,
    theme_17: 4
  }
};

const EXCLUSION_PATTERNS = {
  // Strong signs that a rule is administrative/internal and should not be
  // shown to a learner as ordinary theory content.
  nar37: [
    "разрешение за обучение",
    "контролна проверка на учебния център",
    "учебен кабинет",
    "учебен автомобил",
    "ръководител на учебната дейност",
    "лиценз",
    "регистър на учебните центрове"
  ],
  nar38: [
    "комисията за изпит",
    "изпитна комисия",
    "протокол",
    "изпитващ",
    "служебен автомобил",
    "организиране на изпита"
  ]
};

const KEYWORDS = {
  theme_01: ["определение", "означава", "пътно превозно средство", "водач", "участник в движението"],
  theme_02: ["път", "улица", "платно", "тротоар", "банкет", "пътен възел"],
  theme_03: ["пешеход", "велосипед", "мотоциклет", "мотопед", "трамва", "релсов", "електрическ", "животн"],
  theme_04: ["светофар", "светлинен сигнал", "пътен знак", "регулировчик", "сигнализация", "регулиране", "маркировка"],
  theme_05: ["лента за движение", "дясната половина", "насрещното движение", "разположение", "еднопосочно"],
  theme_06: ["скорост", "дистанция", "спира", "намали", "спирачен", "видимост", "опасност"],
  theme_07: ["маневра", "завой", "завива", "обратен завой", "престро", "отклонение"],
  theme_08: ["кръстовище", "пътен възел", "тунел", "стеснен участък", "железопътен прелез", "прелез"],
  theme_09: ["автомагистрала", "скоростен път"],
  theme_10: ["спирка", "обществен транспорт", "жилищна зона"],
  theme_11: ["специален автомобил", "велосипедист", "пешеход", "мотопед", "мотоциклетист"],
  theme_12: ["престой", "паркиране", "паркира", "неподвижно моторно превозно средство"],
  theme_13: ["дъжд", "сняг", "лед", "мъгла", "залед", "зима", "хлъзг", "атмосфер"],
  theme_14: ["маршрут", "пътуване", "товар", "почивка"],
  theme_15: ["умора", "сънлив", "бдител", "внимание", "реакция", "психомотор", "алкохол", "наркот"],
  theme_16: ["задължение", "длъжен", "водачът е длъжен", "документ", "свидетелство", "проверка", "представи"],
  theme_17: ["глоба", "санкция", "административно", "наказател", "лишаване от право", "принудителна административна мярка"],
  theme_18: ["пътнотранспортно произшествие", "ПТП", "произшествие", "мястото на произшествието", "аварийна сигнализация"],
  theme_19: ["двигател", "спирачна уредба", "спирачки", "гума", "гуми", "фарове", "светлини", "чистачки", "техническа изправност"]
};

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ѝ/g, "и")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sourcePenalty(rule, haystack) {
  const sourceRules = EXCLUSION_PATTERNS[rule.sourceId] || [];
  let penalty = 0;

  for (const phrase of sourceRules) {
    if (haystack.includes(normalize(phrase))) {
      penalty += 12;
    }
  }

  return penalty;
}

function keywordScore(haystack, keyword) {
  const k = normalize(keyword);

  if (!k || !haystack.includes(k)) {
    return 0;
  }

  if (k.length >= 14) return 7;
  if (k.length >= 9) return 5;
  if (k.length >= 6) return 3;
  return 2;
}

function classify(rule) {
  const haystack = normalize([
    rule.exactText,
    rule.sourceId,
    rule.article
  ].join(" "));

  const source = PRIORITY_SOURCES[rule.sourceId] || {
    baseRelevance: 0.50
  };

  const candidates = themes.map(theme => {
    let score = source.baseRelevance * 2;

    const matchedKeywords = [];

    for (const keyword of KEYWORDS[theme.id] || []) {
      const hit = keywordScore(haystack, keyword);

      if (hit > 0) {
        score += hit;
        matchedKeywords.push(keyword);
      }
    }

    score += (SOURCE_THEME_WEIGHTS[rule.sourceId] || {})[theme.id] || 0;

    score -= sourcePenalty(rule, haystack);

    return {
      themeId: theme.id,
      score,
      matchedKeywords
    };
  });

  candidates.sort((a, b) => b.score - a.score);

  const nonZero = candidates.filter(x => x.score > 2);
  const best = candidates[0];
  const second = candidates[1];

  const topicIds = nonZero
    .filter(x => x.score >= Math.max(5, best.score * 0.62))
    .slice(0, 3)
    .map(x => x.themeId);

  let confidence = "none";
  let reviewStatus = "unclassified";

  if (best.score >= 14 && best.score - second.score >= 4 && topicIds.length > 0) {
    confidence = "high";
    reviewStatus = "auto_suggested";
  } else if (best.score >= 8 && best.score - second.score >= 2 && topicIds.length > 0) {
    confidence = "medium";
    reviewStatus = "needs_review";
  } else if (best.score >= 4 && topicIds.length > 0) {
    confidence = "low";
    reviewStatus = "needs_review";
  }

  // Rules from clearly administrative parts of Nar. 37/38 should not be
  // pushed into a learning theme merely because they contain words like
  // "водач" or "изпит".
  const isAdministrative = sourcePenalty(rule, haystack) > 0;

  if (isAdministrative) {
    confidence = "none";
    reviewStatus = "excluded_administrative_candidate";
    return {
      topicIds: [],
      suggestedTopicId: null,
      confidence,
      reviewStatus,
      matchedKeywords: [],
      score: best.score
    };
  }

  return {
    topicIds,
    suggestedTopicId: topicIds[0] || null,
    confidence,
    reviewStatus,
    matchedKeywords: candidates[0].matchedKeywords,
    score: best.score
  };
}

const classified = [];
const stats = {
  totalRules: rules.length,
  high: 0,
  medium: 0,
  low: 0,
  unclassified: 0,
  administrativeCandidates: 0,
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
    // IMPORTANT: do not pretend every extracted rule belongs to B.
    categoryRelevance: {
      B: false,
      confidence: result.confidence
    },
    topicIds: result.topicIds,
    classification: {
      suggestedTopicId: result.suggestedTopicId,
      confidence: result.confidence,
      reviewStatus: result.reviewStatus,
      matchedKeywords: result.matchedKeywords,
      score: result.score
    },
    verified: false,
    verificationStatus: "needs_legal_verification"
  };

  classified.push(item);

  if (result.reviewStatus === "excluded_administrative_candidate") {
    stats.administrativeCandidates++;
  } else if (result.confidence === "high") {
    stats.high++;
  } else if (result.confidence === "medium") {
    stats.medium++;
  } else if (result.confidence === "low") {
    stats.low++;
  } else {
    stats.unclassified++;
  }

  for (const themeId of result.topicIds) {
    if (stats.byTheme[themeId]) {
      stats.byTheme[themeId].count++;
    }
  }
}

const outputPath = path.join(outputDir, "category-b-rules.classified.v2.json");
const reportPath = path.join(outputDir, "classification-report.v2.json");
const reviewPath = path.join(outputDir, "needs-review.v2.json");

fs.writeFileSync(outputPath, JSON.stringify(classified, null, 2), "utf8");

fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      classifier: "source-aware-multi-topic-conservative-v2",
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
console.log("Administrative candidates: " + stats.administrativeCandidates);
console.log("Output: " + outputPath);
console.log("Report: " + reportPath);
console.log("Review queue: " + reviewPath);
console.log("IMPORTANT: category relevance and legal verification remain separate.");
