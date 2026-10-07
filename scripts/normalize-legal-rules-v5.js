const fs = require("fs");
const path = require("path");

const inputPath = path.join(
  __dirname,
  "..",
  "seed",
  "classification",
  "rules.v4.json"
);

const outputDir = path.join(
  __dirname,
  "..",
  "seed",
  "normalized"
);

if (!fs.existsSync(inputPath)) {
  throw new Error("Missing v4 rules: " + inputPath);
}

fs.mkdirSync(outputDir, { recursive: true });

const rules = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const SIGN_LINE = /(?:^|\n)\s*([А-ЯA-Z]{1,3}\d+(?:\.\d+)?)\s+(.+?)(?=\n\s*[А-ЯA-Z]{1,3}\d+(?:\.\d+)?\s+|$)/g;
const MARKING_LINE = /(?:^|\n)\s*((?:М|M)\s*\d+(?:\.\d+)?)\s+(.+?)(?=\n\s*(?:М|M)\s*\d+(?:\.\d+)?\s+|$)/g;

const ADMIN_PHRASES = [
  "изпитна комисия",
  "комисията за изпит",
  "изпитващ",
  "протокол",
  "регистър на учебните центрове",
  "учебен център",
  "разрешение за обучение",
  "контролна проверка",
  "организиране на изпита",
  "служебен автомобил",
  "административен орган",
  "длъжностно лице",
  "разрешение за провеждане"
];

const INFRA_PHRASES = [
  "възложител",
  "проектант",
  "строител",
  "пътноподдържащо",
  "обществена поръчка",
  "проектиране",
  "строителство на пътя"
];

function normalizeSpace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSearch(text) {
  return normalizeSpace(text)
    .toLowerCase()
    .replace(/ѝ/g, "и");
}

function stripLegalChangeNotes(text) {
  return normalizeSpace(
    text
      .replace(
        /\((?:изм\.|доп\.|отм\.|нов|изм\. и доп\.|доп\. - ДВ|изм\. - ДВ)[^)]*\)/gi,
        " "
      )
  );
}

function isAdministrative(rule) {
  const text = normalizeSearch(rule.exactText);
  return ADMIN_PHRASES.some(p => text.includes(p));
}

function isInfrastructure(rule) {
  const text = normalizeSearch(rule.exactText);
  return INFRA_PHRASES.some(p => text.includes(p));
}

function createBaseRecord(rule, overrides = {}) {
  return {
    ...rule,
    exactText: normalizeSpace(overrides.exactText ?? rule.exactText),
    normalizedText: stripLegalChangeNotes(
      overrides.exactText ?? rule.exactText
    ),
    sourceId: rule.sourceId,
    article: rule.article ?? null,
    paragraph: rule.paragraph ?? null,
    item: overrides.item ?? rule.item ?? null,
    letter: overrides.letter ?? rule.letter ?? null,
    topicIds: overrides.topicIds ?? rule.topicIds ?? [],
    learnerScope: overrides.learnerScope ?? rule.learnerScope ?? "REVIEW",
    verified: false,
    verificationStatus: "needs_legal_verification",
    normalizationStatus: overrides.normalizationStatus ?? "normalized"
  };
}

function splitVisualBlock(rule, regex, visualType) {
  const matches = [...String(rule.exactText || "").matchAll(regex)];

  if (matches.length < 2) {
    return null;
  }

  return matches.map((m, index) => {
    const code = m[1].replace(/\s+/g, "");
    const name = normalizeSpace(m[2]);

    return createBaseRecord(rule, {
      id: rule.id + "-visual-" + code.toLowerCase(),
      exactText: name,
      item: code,
      topicIds:
        visualType === "sign"
          ? ["theme_04"]
          : ["theme_04", "theme_05"],
      learnerScope: "LEARNER_CORE",
      normalizationStatus: visualType + "_split"
    });
  });
}

function splitByInternalParagraphs(rule) {
  const text = normalizeSpace(rule.exactText);
  const matches = [...text.matchAll(/(?:^|\n)\s*\((\d+)\)\s+/g)];

  if (matches.length < 2) {
    return null;
  }

  return matches.map((m, index) => {
    const start = m.index;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index
        : text.length;

    const paragraph = m[1];
    const block = text.slice(start, end).trim();

    return createBaseRecord(rule, {
      id: rule.id + "-p" + paragraph,
      exactText: block,
      paragraph,
      normalizationStatus: "paragraph_split"
    });
  });
}

const output = [];
const review = [];
const stats = {
  inputRules: rules.length,
  outputRules: 0,
  signBlocksSplit: 0,
  markingBlocksSplit: 0,
  paragraphBlocksSplit: 0,
  administrativeReclassified: 0,
  infrastructureReclassified: 0,
  unchanged: 0,
  review: 0
};

for (const rule of rules) {
  const text = String(rule.exactText || "");

  const signParts = splitVisualBlock(
    rule,
    SIGN_LINE,
    "sign"
  );

  if (signParts) {
    output.push(...signParts);
    stats.signBlocksSplit += signParts.length;
    continue;
  }

  const markingParts = splitVisualBlock(
    rule,
    MARKING_LINE,
    "marking"
  );

  if (markingParts) {
    output.push(...markingParts);
    stats.markingBlocksSplit += markingParts.length;
    continue;
  }

  const paragraphs = splitByInternalParagraphs(rule);

  if (paragraphs) {
    output.push(...paragraphs);
    stats.paragraphBlocksSplit += paragraphs.length;
    continue;
  }

  const admin = isAdministrative(rule);
  const infrastructure = isInfrastructure(rule);

  if (admin && (rule.sourceId === "nar37" || rule.sourceId === "nar38")) {
    const normalized = createBaseRecord(rule, {
      topicIds: [],
      learnerScope: "ADMINISTRATIVE",
      normalizationStatus: "administrative_reclassified"
    });

    output.push(normalized);
    stats.administrativeReclassified++;
    continue;
  }

  if (infrastructure) {
    const normalized = createBaseRecord(rule, {
      topicIds: [],
      learnerScope: "OUT_OF_SCOPE",
      normalizationStatus: "infrastructure_reclassified"
    });

    output.push(normalized);
    stats.infrastructureReclassified++;
    continue;
  }

  const normalized = createBaseRecord(rule, {
    normalizationStatus: "unchanged"
  });

  output.push(normalized);
  stats.unchanged++;

  if (
    normalized.learnerScope === "REVIEW" ||
    normalized.topicIds.length === 0
  ) {
    review.push(normalized);
    stats.review++;
  }
}

stats.outputRules = output.length;

fs.writeFileSync(
  path.join(outputDir, "rules.v5.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(outputDir, "review.v5.json"),
  JSON.stringify(review, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(outputDir, "report.v5.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      normalizer: "structure-aware-v5",
      ...stats
    },
    null,
    2
  ),
  "utf8"
);

console.log("Input rules: " + stats.inputRules);
console.log("Output rules: " + stats.outputRules);
console.log("Sign records created: " + stats.signBlocksSplit);
console.log("Marking records created: " + stats.markingBlocksSplit);
console.log("Paragraph records created: " + stats.paragraphBlocksSplit);
console.log("Administrative reclassified: " + stats.administrativeReclassified);
console.log("Infrastructure reclassified: " + stats.infrastructureReclassified);
console.log("Unchanged: " + stats.unchanged);
console.log("Review queue: " + stats.review);
console.log("Output: seed/normalized/rules.v5.json");
console.log("Review: seed/normalized/review.v5.json");
console.log("Report: seed/normalized/report.v5.json");
console.log("IMPORTANT: normalization does not verify legal correctness.");
