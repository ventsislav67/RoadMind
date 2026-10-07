const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const sourceDir = path.join(__dirname, "..", "official-sources");
const outputDir = path.join(__dirname, "..", "seed", "visual-final");

fs.mkdirSync(outputDir, { recursive: true });

const sources = {
  road_signs: "road-signs.pdf",
  road_marking: "road-marking.pdf",
  traffic_lights: "traffic-lights.pdf"
};

function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function uniqueBy(records, keyFn) {
  const seen = new Set();
  const out = [];

  for (const record of records) {
    const key = keyFn(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }

  return out;
}

function extractMarkings(text) {
  const compact = clean(text);
  const records = [];

  // The marking document does not consistently present M-codes at line start.
  // Therefore we detect the code anywhere in the text and capture a bounded
  // sentence/context around it. We only accept the official M1-M20 range.
  const regex = /\bМ\s*(\d{1,2}(?:\.\d+)?)\b/gi;

  const matches = [...compact.matchAll(regex)];

  for (const match of matches) {
    const numeric = match[1];
    const number = Number(numeric);

    if (!Number.isFinite(number) || number < 1 || number > 20) {
      continue;
    }

    const code = "M" + numeric;

    const start = Math.max(0, match.index - 180);
    const end = Math.min(
      compact.length,
      match.index + match[0].length + 420
    );

    let context = compact.slice(start, end).trim();

    const nextCode = context.search(
      new RegExp("\\bМ\\s*(?:[1-9]|1\\d|20)(?:\\.\d+)?\\b", "i")
    );

    if (nextCode > 30) {
      context = context.slice(0, nextCode).trim();
    }

    records.push({
      sourceId: "road_marking",
      country: "BG",
      language: "bg",
      visualType: "ROAD_MARKING",
      visualCode: code,
      visualName: "Пътна маркировка " + code,
      exactText: context,
      normalizedText: context,
      categoryBRelevance: true,
      learnerScope: "LEARNER_CORE",
      topicIds: ["theme_04", "theme_05"],
      verified: false,
      verificationStatus: "needs_legal_verification",
      normalizationType: "ROAD_MARKING_V5_4",
      sourceOrigin: "official-sources/road-marking.pdf"
    });
  }

  return uniqueBy(records, r => r.visualCode + "|" + r.exactText.slice(0, 160))
    .sort((a, b) => {
      const na = Number(a.visualCode.slice(1));
      const nb = Number(b.visualCode.slice(1));
      return na - nb;
    })
    .map((r, index) => ({
      id: "road-marking-" + r.visualCode.toLowerCase() + "-" + (index + 1),
      ...r
    }));
}

function extractTrafficLights(text) {
  const compact = clean(text);

  const definitions = [
    ["red", "Червен светлинен сигнал", /червен[а-я]*\s+светлин[а-я]*/i],
    ["yellow", "Жълт светлинен сигнал", /жълт[а-я]*\s+светлин[а-я]*/i],
    ["green", "Зелен светлинен сигнал", /зелен[а-я]*\s+светлин[а-я]*/i],
    ["flashing-yellow", "Мигащ жълт светлинен сигнал", /мигащ[а-я\s-]*жълт/i],
    ["arrow", "Светлинен сигнал със стрелка", /светлин[а-я\s-]*стрелк/i]
  ];

  const records = [];

  for (const [id, name, pattern] of definitions) {
    const match = compact.match(pattern);

    if (!match) continue;

    const start = Math.max(0, match.index - 120);
    const end = Math.min(compact.length, match.index + 850);
    const context = compact.slice(start, end).trim();

    records.push({
      id: "traffic-light-" + id,
      sourceId: "traffic_lights",
      country: "BG",
      language: "bg",
      visualType: "TRAFFIC_LIGHT",
      visualCode: null,
      visualName: name,
      exactText: context,
      normalizedText: context,
      categoryBRelevance: true,
      learnerScope: "LEARNER_CORE",
      topicIds: ["theme_04"],
      verified: false,
      verificationStatus: "needs_legal_verification",
      normalizationType: "TRAFFIC_LIGHT_V5_4",
      sourceOrigin: "official-sources/traffic-lights.pdf"
    });
  }

  return records;
}

function extractSignDefinitions(text) {
  const compact = clean(text);

  const regex =
    /\b([А-ЯA-Z]\d+(?:\.\d+)?)\s+([^.;]{3,180}?)(?=(?:\s+[А-ЯA-Z]\d+(?:\.\d+)?\s+)|[.;]|$)/g;

  const records = [];

  for (const match of compact.matchAll(regex)) {
    const code = match[1];
    const name = clean(match[2]);

    // Restrict to Bulgarian sign families, avoiding technical "R2", Cxxx etc.
    if (!/^[А-Я](?:\d+)(?:\.\d+)?$/i.test(code)) continue;
    if (code.startsWith("Р")) continue;
    if (code.startsWith("С")) continue;

    if (name.length < 3) continue;

    records.push({
      id: "road-sign-" + code.toLowerCase() + "-" + (records.length + 1),
      sourceId: "road_signs",
      country: "BG",
      language: "bg",
      visualType: "ROAD_SIGN",
      visualCode: code,
      visualName: name,
      exactText: name,
      normalizedText: name,
      categoryBRelevance: true,
      learnerScope: "LEARNER_CORE",
      topicIds: ["theme_04"],
      verified: false,
      verificationStatus: "needs_legal_verification",
      normalizationType: "ROAD_SIGN_V5_4",
      sourceOrigin: "official-sources/road_signs.pdf"
    });
  }

  return uniqueBy(records, r => r.visualCode + "|" + r.visualName);
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    normalizer: "visual-normalizer-v5.4",
    records: []
  };

  for (const [sourceId, file] of Object.entries(sources)) {
    const filePath = path.join(sourceDir, file);

    if (!fs.existsSync(filePath)) {
      throw new Error("Missing official source: " + filePath);
    }

    const data = await pdfParse(fs.readFileSync(filePath));
    const text = data.text || "";

    let records = [];

    if (sourceId === "road_marking") {
      records = extractMarkings(text);
    } else if (sourceId === "traffic_lights") {
      records = extractTrafficLights(text);
    } else if (sourceId === "road_signs") {
      records = extractSignDefinitions(text);
    }

    result.records.push(...records);

    console.log(sourceId + ": " + records.length + " records");
  }

  const outputPath = path.join(
    outputDir,
    "visual-rules.v5.4.json"
  );

  const reportPath = path.join(
    outputDir,
    "report.v5.4.json"
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(result.records, null, 2),
    "utf8"
  );

  const counts = result.records.reduce((acc, item) => {
    acc[item.visualType] = (acc[item.visualType] || 0) + 1;
    return acc;
  }, {});

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: result.generatedAt,
        normalizer: result.normalizer,
        totalRecords: result.records.length,
        counts,
        verifiedCount: 0,
        output: outputPath,
        important:
          "Visual normalization does not verify legal correctness."
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log("Total visual records: " + result.records.length);
  console.log("Output: " + outputPath);
  console.log("Report: " + reportPath);
  console.log(
    "IMPORTANT: visual normalization does not verify legal correctness."
  );
}

main().catch(error => {
  console.error("V5.4 failed:", error);
  process.exit(1);
});
