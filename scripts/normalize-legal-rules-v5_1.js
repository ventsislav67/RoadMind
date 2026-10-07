const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "..", "seed", "normalized", "rules.v5.json");
const outputDir = path.join(__dirname, "..", "seed", "normalized-v5_1");

if (!fs.existsSync(inputPath)) {
  throw new Error("Missing V5 rules: " + inputPath);
}

fs.mkdirSync(outputDir, { recursive: true });

const rules = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeId(rule, type, code, index) {
  const safe = String(code || index)
    .replace(/[^0-9A-Za-zА-Яа-я.]+/g, "_");

  return rule.id + "-" + type + "-" + safe;
}

function parseSigns(rule) {
  const text = clean(rule.exactText);

  const patterns = [
    /(?:^|\n)\s*([А-ЯA-Z]{1,3}\s*\d+(?:\.\d+)?)\s+([^\n]+?)(?=\n\s*[А-ЯA-Z]{1,3}\s*\d+(?:\.\d+)?\s+|$)/g,
    /(?:^|\n)\s*([А-ЯA-Z]\d+(?:\.\d+)?)\s+([^\n]+?)(?=\n\s*[А-ЯA-Z]\d+(?:\.\d+)?\s+|$)/g
  ];

  let matches = [];

  for (const regex of patterns) {
    const found = [...text.matchAll(regex)];

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
      id: makeId(rule, "sign", code, index + 1),
      visualType: "ROAD_SIGN",
      visualCode: code,
      visualName: name,
      exactText: name,
      normalizedText: name,
      item: code,
      topicIds: ["theme_04"],
      learnerScope: "LEARNER_CORE",
      normalizationStatus: "road_sign_split_v5_1",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentVisualBlockId: rule.id
    };
  });
}

function parseMarkings(rule) {
  if (rule.sourceId !== "road_marking" &&
      rule.sourceId !== "ppzdvp") {
    return null;
  }

  const text = clean(rule.exactText);

  // Handles forms such as:
  // 1. "Единична непрекъсната линия" - М1
  // "Двойна непрекъсната линия" - М2
  const regex =
    /(?:^|\n)\s*(?:\d+[.)]\s*)?[„"«]?([^„"»\n]+?)[”"»]?\s*-\s*(М\s*\d+(?:\.\d+)?)\.?\s*([^\n]*)/gi;

  const matches = [...text.matchAll(regex)];

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match, index) => {
    const name = clean(match[1]);
    const code = match[2].replace(/\s+/g, "");
    const description = clean(match[3]);

    return {
      ...rule,
      id: makeId(rule, "marking", code, index + 1),
      visualType: "ROAD_MARKING",
      visualCode: code,
      visualName: name,
      visualDescription: description || null,
      exactText: clean(
        name +
        " - " +
        code +
        (description ? " " + description : "")
      ),
      normalizedText: name,
      item: code,
      topicIds: ["theme_04", "theme_05"],
      learnerScope: "LEARNER_CORE",
      normalizationStatus: "road_marking_split_v5_1",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentVisualBlockId: rule.id
    };
  });
}

function parseTrafficLights(rule) {
  if (rule.sourceId !== "traffic_lights") {
    return null;
  }

  const text = clean(rule.exactText);

  // Try common enumerated signal sections when a code exists.
  const regex =
    /(?:^|\n)\s*(?:\d+[.)]\s*)?([СC]\s*\d+(?:\.\d+)?)\s+([^\n]+?)(?=\n\s*(?:\d+[.)]\s*)?[СC]\s*\d+(?:\.\d+)?\s+|$)/g;

  const matches = [...text.matchAll(regex)];

  if (matches.length < 2) {
    return null;
  }

  return matches.map((match, index) => {
    const code = match[1].replace(/\s+/g, "");
    const name = clean(match[2]);

    return {
      ...rule,
      id: makeId(rule, "signal", code, index + 1),
      visualType: "TRAFFIC_LIGHT",
      visualCode: code,
      visualName: name,
      exactText: name,
      normalizedText: name,
      item: code,
      topicIds: ["theme_04"],
      learnerScope: "LEARNER_CORE",
      normalizationStatus: "traffic_light_split_v5_1",
      verified: false,
      verificationStatus: "needs_legal_verification",
      parentVisualBlockId: rule.id
    };
  });
}

const output = [];
const review = [];

const stats = {
  inputRules: rules.length,
  outputRules: 0,
  signRecords: 0,
  markingRecords: 0,
  trafficLightRecords: 0,
  unchanged: 0,
  review: 0
};

for (const rule of rules) {
  const signs = parseSigns(rule);

  if (signs) {
    output.push(...signs);
    stats.signRecords += signs.length;
    continue;
  }

  const markings = parseMarkings(rule);

  if (markings) {
    output.push(...markings);
    stats.markingRecords += markings.length;
    continue;
  }

  const lights = parseTrafficLights(rule);

  if (lights) {
    output.push(...lights);
    stats.trafficLightRecords += lights.length;
    continue;
  }

  output.push(rule);
  stats.unchanged++;

  if (
    rule.learnerScope === "REVIEW" ||
    !Array.isArray(rule.topicIds) ||
    rule.topicIds.length === 0
  ) {
    review.push(rule);
  }
}

stats.outputRules = output.length;
stats.review = review.length;

fs.writeFileSync(
  path.join(outputDir, "rules.v5.1.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(outputDir, "review.v5.1.json"),
  JSON.stringify(review, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(outputDir, "report.v5.1.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      normalizer: "visual-structure-aware-v5.1",
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
console.log("Unchanged: " + stats.unchanged);
console.log("Review queue: " + stats.review);
console.log("Output: seed/normalized-v5_1/rules.v5.1.json");
console.log("Review: seed/normalized-v5_1/review.v5.1.json");
console.log("Report: seed/normalized-v5_1/report.v5.1.json");
console.log("IMPORTANT: normalization does not verify legal correctness.");
