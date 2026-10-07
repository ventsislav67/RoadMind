const fs = require("fs");
const path = require("path");

const inputPath = path.join(
  __dirname,
  "..",
  "seed",
  "normalized",
  "rules.v5.json"
);

const outputDir = path.join(
  __dirname,
  "..",
  "seed",
  "normalized-v5_2"
);

if (!fs.existsSync(inputPath)) {
  throw new Error("Missing V5 rules: " + inputPath);
}

fs.mkdirSync(outputDir, { recursive: true });

const rules = JSON.parse(
  fs.readFileSync(inputPath, "utf8")
);

function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSearch(text) {
  return clean(text)
    .toLowerCase()
    .replace(/ѝ/g, "и");
}

function splitDocumentType(rule) {
  switch (rule.sourceId) {
    case "road_signs":
    case "ppzdvp":
      return "SIGNS_OR_RULES";
    case "road_marking":
      return "MARKING";
    case "traffic_lights":
      return "TRAFFIC_LIGHTS";
    case "zdvp":
    case "nar37":
    case "nar38":
    case "first_aid":
      return "LEGAL_TEXT";
    default:
      return "UNKNOWN";
  }
}

function splitSigns(rule) {
  const text = clean(rule.exactText);

  const patterns = [
    /(?:^|\n)\s*([А-ЯA-Z]\d+(?:\.\d+)?)\s+([^\n]+)/g,
    /(?:^|\n)\s*([А-ЯA-Z]{1,2}\d+(?:\.\d+)?)\s+([^\n]+)/g
  ];

  let matches = [];

  for (const pattern of patterns) {
    const found = [...text.matchAll(pattern)];
    if (found.length > matches.length) {
      matches = found;
    }
  }

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match, index) => {
    const code = match[1].replace(/\s+/g, "");
    const name = clean(match[2]);

    return {
      ...rule,
      id: rule.id + "-sign-" + code.toLowerCase(),
      visualType: "ROAD_SIGN",
      visualCode: code,
      visualName: name,
      exactText: name,
      normalizedText: name,
      item: code,
      topicIds: Array.from(
        new Set([
          ...(rule.topicIds || []),
          "theme_04"
        ])
      ),
      learnerScope: "LEARNER_CORE",
      normalizationType: "ROAD_SIGN",
      normalizationStatus: "v5_2_visual_split",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentVisualBlockId: rule.id,
      visualSourceText: text
    };
  });
}

function splitMarking(rule) {
  const text = clean(rule.exactText);

  const patterns = [
    /(?:^|\n)\s*(М\s*\d+(?:\.\d+)?)\s*[-–:]\s*([^\n]+)/gi,
    /(?:^|\n)\s*([^\n]{3,100}?)\s*[-–:]\s*(М\s*\d+(?:\.\d+)?)/gi
  ];

  let matches = [];

  for (const pattern of patterns) {
    const found = [...text.matchAll(pattern)];
    if (found.length > matches.length) {
      matches = found;
    }
  }

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match, index) => {
    const first = clean(match[1]);
    const second = clean(match[2]);

    const code = /^М/i.test(first)
      ? first.replace(/\s+/g, "")
      : second.replace(/\s+/g, "");

    const name = /^М/i.test(first)
      ? second
      : first;

    return {
      ...rule,
      id: rule.id + "-marking-" + code.toLowerCase() + "-" + index,
      visualType: "ROAD_MARKING",
      visualCode: code,
      visualName: name,
      exactText: code + " " + name,
      normalizedText: name,
      item: code,
      topicIds: Array.from(
        new Set([
          ...(rule.topicIds || []),
          "theme_04",
          "theme_05"
        ])
      ),
      learnerScope: "LEARNER_CORE",
      normalizationType: "ROAD_MARKING",
      normalizationStatus: "v5_2_visual_split",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentVisualBlockId: rule.id,
      visualSourceText: text
    };
  });
}

function splitTrafficLights(rule) {
  const text = clean(rule.exactText);

  const patterns = [
    /(?:^|\n)\s*(С\s*\d+(?:\.\d+)?)\s+([^\n]+)/gi,
    /(?:^|\n)\s*(\d+[.)])\s*([^\n]*(?:червен|жълт|зелен|сигнал)[^\n]*)/gi
  ];

  let matches = [];

  for (const pattern of patterns) {
    const found = [...text.matchAll(pattern)];
    if (found.length > matches.length) {
      matches = found;
    }
  }

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match, index) => {
    const code = match[1].replace(/\s+/g, "");
    const name = clean(match[2]);

    return {
      ...rule,
      id: rule.id + "-signal-" + code.toLowerCase() + "-" + index,
      visualType: "TRAFFIC_LIGHT",
      visualCode: code,
      visualName: name,
      exactText: name,
      normalizedText: name,
      item: code,
      topicIds: Array.from(
        new Set([
          ...(rule.topicIds || []),
          "theme_04"
        ])
      ),
      learnerScope: "LEARNER_CORE",
      normalizationType: "TRAFFIC_LIGHT",
      normalizationStatus: "v5_2_visual_split",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentVisualBlockId: rule.id,
      visualSourceText: text
    };
  });
}

function splitLegalParagraphs(rule) {
  const text = clean(rule.exactText);

  const matches = [
    ...text.matchAll(
      /(?:^|\n)\s*\((\d+)\)\s+/g
    )
  ];

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match, index) => {
    const start = match.index;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index
        : text.length;

    const paragraph = match[1];
    const block = text.slice(start, end).trim();

    return {
      ...rule,
      id: rule.id + "-paragraph-" + paragraph,
      paragraph,
      exactText: block,
      normalizedText: block,
      normalizationType: "LEGAL_PARAGRAPH",
      normalizationStatus: "v5_2_paragraph_split",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentParagraphBlockId: rule.id
    };
  });
}

function classifyFallback(rule) {
  const text = normalizeSearch(rule.exactText);

  if (text.length === 0) {
    return {
      scope: "REVIEW",
      reason: "Empty text"
    };
  }

  if (
    ["nar37", "nar38"].includes(rule.sourceId) &&
    /(изпитна комисия|протокол|изпитващ|учебен център|регистър)/.test(text)
  ) {
    return {
      scope: "ADMINISTRATIVE",
      reason: "Administrative training/exam wording"
    };
  }

  if (
    /(възложител|проектант|строител|обществена поръчка|проектиране)/.test(text)
  ) {
    return {
      scope: "OUT_OF_SCOPE",
      reason: "Infrastructure/procurement wording"
    };
  }

  return {
    scope: rule.learnerScope || "REVIEW",
    reason: "Preserved from V5"
  };
}

const output = [];
const review = [];

const stats = {
  inputRules: rules.length,
  outputRules: 0,
  signRecords: 0,
  markingRecords: 0,
  trafficLightRecords: 0,
  paragraphRecords: 0,
  administrativeReclassified: 0,
  infrastructureReclassified: 0,
  unchanged: 0,
  review: 0
};

for (const rule of rules) {
  let parts = null;

  if (
    rule.sourceId === "road_signs" ||
    (rule.sourceId === "ppzdvp" &&
      /\n\s*[А-ЯA-Z]\d+(?:\.\d+)?\s+/.test(rule.exactText || ""))
  ) {
    parts = splitSigns(rule);
  }

  if (!parts && rule.sourceId === "road_marking") {
    parts = splitMarking(rule);
  }

  if (!parts && rule.sourceId === "traffic_lights") {
    parts = splitTrafficLights(rule);
  }

  if (!parts) {
    parts = splitLegalParagraphs(rule);
  }

  if (parts) {
    output.push(...parts);

    for (const part of parts) {
      if (part.visualType === "ROAD_SIGN") stats.signRecords++;
      else if (part.visualType === "ROAD_MARKING") stats.markingRecords++;
      else if (part.visualType === "TRAFFIC_LIGHT") stats.trafficLightRecords++;
      else if (part.normalizationType === "LEGAL_PARAGRAPH") stats.paragraphRecords++;
    }

    continue;
  }

  const fallback = classifyFallback(rule);

  let normalized = {
    ...rule,
    categoryBRelevance:
      fallback.scope !== "OUT_OF_SCOPE" &&
      fallback.scope !== "ADMINISTRATIVE",
    learnerScope: fallback.scope,
    learnerScopeReason: fallback.reason,
    normalizationType: splitDocumentType(rule),
    normalizationStatus: "v5_2_unchanged",
    verified: false,
    verificationStatus: "needs_legal_verification"
  };

  if (fallback.scope === "ADMINISTRATIVE") {
    stats.administrativeReclassified++;
  } else if (fallback.scope === "OUT_OF_SCOPE") {
    stats.infrastructureReclassified++;
  } else {
    stats.unchanged++;
  }

  output.push(normalized);

  if (
    fallback.scope === "REVIEW" ||
    !normalized.topicIds ||
    normalized.topicIds.length === 0
  ) {
    review.push(normalized);
  }
}

stats.outputRules = output.length;
stats.review = review.length;

fs.writeFileSync(
  path.join(outputDir, "rules.v5.2.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(outputDir, "review.v5.2.json"),
  JSON.stringify(review, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(outputDir, "report.v5.2.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      normalizer: "document-aware-structure-v5.2",
      ...stats
    },
    null,
    2
  ),
  "utf8"
);

console.log("Input rules: " + stats.inputRules);
console.log("Output rules: " + stats.outputRules);
console.log("Sign records created: " + stats.signRecords);
console.log("Marking records created: " + stats.markingRecords);
console.log("Traffic-light records created: " + stats.trafficLightRecords);
console.log("Paragraph records created: " + stats.paragraphRecords);
console.log("Administrative reclassified: " + stats.administrativeReclassified);
console.log("Infrastructure reclassified: " + stats.infrastructureReclassified);
console.log("Unchanged: " + stats.unchanged);
console.log("Review queue: " + stats.review);
console.log("Output: seed/normalized-v5_2/rules.v5.2.json");
console.log("Review: seed/normalized-v5_2/review.v5.2.json");
console.log("Report: seed/normalized-v5_2/report.v5.2.json");
console.log("IMPORTANT: normalization does not verify legal correctness.");
