const fs = require("fs");
const path = require("path");

const inputFile = path.join(__dirname, "..", "seed", "extracted", "lawRules.extracted.json");
const outputDir = path.join(__dirname, "..", "seed", "atomic");

if (!fs.existsSync(inputFile)) {
  throw new Error("Missing extracted file: " + inputFile);
}

fs.mkdirSync(outputDir, { recursive: true });

const sourceRules = JSON.parse(fs.readFileSync(inputFile, "utf8"));

function clean(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(articleText) {
  const text = clean(articleText);

  // Start markers: "(1)", "(2)", "(3)" etc.
  const matches = [...text.matchAll(/(?:^|\n)\s*\((\d+)\)\s*/g)];

  if (matches.length === 0) {
    return [{ paragraph: null, text }];
  }

  const result = [];

  const prefix = text.slice(0, matches[0].index).trim();
  if (prefix) {
    result.push({ paragraph: null, text: prefix });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const paragraph = matches[i][1];
    const block = text.slice(start, end).trim();

    result.push({
      paragraph,
      text: block
    });
  }

  return result;
}

function splitItems(paragraphText) {
  const text = clean(paragraphText);

  // Numbered items such as "1. ... 2. ..." when they are line-oriented.
  const matches = [...text.matchAll(/(?:^|\n)\s*(\d+)\.\s+/g)];

  if (matches.length <= 1) {
    return [{ item: null, text }];
  }

  const result = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;

    result.push({
      item: matches[i][1],
      text: text.slice(start, end).trim()
    });
  }

  return result;
}

function splitLetters(itemText) {
  const text = clean(itemText);

  // Lettered sub-points only when they start a new line.
  const matches = [...text.matchAll(/(?:^|\n)\s*([а-яА-Я])\)\s+/g)];

  if (matches.length <= 1) {
    return [{ letter: null, text }];
  }

  const result = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;

    result.push({
      letter: matches[i][1],
      text: text.slice(start, end).trim()
    });
  }

  return result;
}

function makeId(sourceId, article, paragraph, item, letter, index) {
  const safe = value =>
    value === null || value === undefined
      ? "x"
      : String(value).replace(/[^0-9a-zA-Zа-яА-Я]+/g, "_");

  return [
    sourceId,
    "art", safe(article),
    "par", safe(paragraph),
    "item", safe(item),
    "let", safe(letter),
    String(index)
  ].join("-");
}

const atomic = [];
const documentStats = {};

for (const articleRule of sourceRules) {
  const sourceId = articleRule.sourceId;
  documentStats[sourceId] ??= {
    sourceId,
    sourceArticles: 0,
    atomicRules: 0,
    ambiguousArticles: 0
  };

  documentStats[sourceId].sourceArticles++;

  const paragraphs = splitParagraphs(articleRule.exactText);
  let producedForArticle = 0;

  for (const paragraphPart of paragraphs) {
    const items = splitItems(paragraphPart.text);

    for (const itemPart of items) {
      const letters = splitLetters(itemPart.text);

      for (const letterPart of letters) {
        const exactText = clean(letterPart.text);

        if (!exactText) continue;

        const record = {
          id: makeId(
            sourceId,
            articleRule.article,
            paragraphPart.paragraph,
            itemPart.item,
            letterPart.letter,
            atomic.length + 1
          ),
          sourceId,
          country: "BG",
          language: "bg",
          categoryIds: ["B"],
          article: articleRule.article,
          paragraph: paragraphPart.paragraph,
          item: itemPart.item,
          letter: letterPart.letter,
          exactText,
          active: true,
          verified: false,
          verificationStatus: "needs_verification",
          parentArticleId: articleRule.id,
          extractionSource: "seed/extracted/lawRules.extracted.json"
        };

        atomic.push(record);
        producedForArticle++;
      }
    }
  }

  // If an article contained a complex structure that did not split cleanly,
  // flag it for review instead of pretending the parser is authoritative.
  if (producedForArticle <= 1 && /\(\d+\)|\d+\.\s+|[а-яА-Я]\)\s+/.test(articleRule.exactText)) {
    documentStats[sourceId].ambiguousArticles++;
  }

  documentStats[sourceId].atomicRules += producedForArticle;
}

const allOutput = path.join(outputDir, "lawRules.atomic.json");
fs.writeFileSync(allOutput, JSON.stringify(atomic, null, 2), "utf8");

const statsOutput = path.join(outputDir, "extraction-stats.json");
fs.writeFileSync(
  statsOutput,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalSourceArticles: sourceRules.length,
      totalAtomicRules: atomic.length,
      documents: Object.values(documentStats)
    },
    null,
    2
  ),
  "utf8"
);

for (const stat of Object.values(documentStats)) {
  console.log(
    stat.sourceId +
      ": " +
      stat.sourceArticles +
      " article blocks -> " +
      stat.atomicRules +
      " atomic rules; review flags: " +
      stat.ambiguousArticles
  );
}

console.log("\nTotal atomic rules: " + atomic.length);
console.log("Output: " + allOutput);
console.log("Stats: " + statsOutput);
console.log("IMPORTANT: records remain verified=false until legal verification is completed.");
