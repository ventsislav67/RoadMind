const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const sourceDir = path.join(__dirname, "..", "official-sources");
const outputDir = path.join(__dirname, "..", "seed", "visual-final");

fs.mkdirSync(outputDir, { recursive: true });

function cleanLine(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function makeBase(id, sourceId, type, code, name, exactText, topics) {
  return {
    id,
    sourceId,
    country: "BG",
    language: "bg",
    visualType: type,
    visualCode: code || null,
    visualName: name,
    exactText,
    normalizedText: exactText,
    categoryBRelevance: true,
    learnerScope: "LEARNER_CORE",
    topicIds: topics,
    verified: false,
    verificationStatus: "needs_legal_verification",
    normalizationType: "V5_5_DOCUMENT_SPECIFIC",
    sourceOrigin: "official-sources/" + (
      sourceId === "road_signs" ? "road-signs.pdf" :
      sourceId === "road_marking" ? "road-marking.pdf" :
      "traffic-lights.pdf"
    )
  };
}

function extractSigns(rawText) {
  const lines = normalizeText(rawText)
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Do not use \\b around Cyrillic. JavaScript word-boundary is ASCII-centric.
    const match = line.match(
      /^([А-ЯA-Z]\d+(?:\.\d+)?)\s+(.+)$/
    );

    if (!match) continue;

    const code = match[1];
    let name = match[2];

    // Exclude technical references accidentally beginning with a letter+number.
    if (/^(?:по БДС|БДС|EN\s)/i.test(name)) continue;

    // Join wrapped description lines, but stop at headings or another sign code.
    while (i + 1 < lines.length) {
      const next = lines[i + 1];

      if (/^([А-ЯA-Z]\d+(?:\.\d+)?)\s+/.test(next)) {
        break;
      }

      if (/^(Чл\.|Глава|Раздел|Приложение|Таблица)\b/i.test(next)) {
        break;
      }

      // Avoid swallowing unrelated technical rows.
      if (
        /^(?:М\d+|С\d+|Р\d+|[A-Z]\d{3,})\b/i.test(next) &&
        next.length < 80
      ) {
        break;
      }

      name += " " + next;
      i++;

      if (name.length > 240) break;
    }

    name = cleanLine(name);

    if (name.length < 3) continue;

    records.push(
      makeBase(
        "sign-" + code.toLowerCase(),
        "road_signs",
        "ROAD_SIGN",
        code,
        name,
        name,
        ["theme_04"]
      )
    );
  }

  const seen = new Set();
  return records.filter(record => {
    if (seen.has(record.visualCode)) return false;
    seen.add(record.visualCode);
    return true;
  });
}

function extractMarkings(rawText) {
  const text = normalizeText(rawText).replace(/\n/g, " ");
  const regex = /М\s*(\d{1,2}(?:\.\d+)?)\b/gi;
  const matches = [...text.matchAll(regex)];

  const records = [];
  const seen = new Set();

  for (const match of matches) {
    const number = Number(match[1]);

    if (!Number.isFinite(number) || number < 1 || number > 20) {
      continue;
    }

    const code = "M" + match[1];

    if (seen.has(code)) continue;
    seen.add(code);

    const start = Math.max(0, match.index - 180);
    const end = Math.min(
      text.length,
      match.index + match[0].length + 450
    );

    let context = text.slice(start, end).trim();

    // Prefer text starting at the sentence/statement containing the code.
    const localStart = Math.max(
      context.lastIndexOf(". ", 180) + 2,
      context.lastIndexOf(": ", 180) + 2
    );

    if (localStart > 2 && localStart < 180) {
      context = context.slice(localStart).trim();
    }

    records.push(
      makeBase(
        "road-marking-" + code.toLowerCase(),
        "road_marking",
        "ROAD_MARKING",
        code,
        "Пътна маркировка " + code,
        context,
        ["theme_04", "theme_05"]
      )
    );
  }

  return records;
}

function extractTrafficLights(rawText) {
  const text = normalizeText(rawText);

  const definitions = [
    {
      id: "red",
      name: "Червен светлинен сигнал",
      pattern: /червен[а-я]*\s+светлин[а-я]*/i,
      topics: ["theme_04"]
    },
    {
      id: "yellow",
      name: "Жълт светлинен сигнал",
      pattern: /жълт[а-я]*\s+светлин[а-я]*/i,
      topics: ["theme_04"]
    },
    {
      id: "green",
      name: "Зелен светлинен сигнал",
      pattern: /зелен[а-я]*\s+светлин[а-я]*/i,
      topics: ["theme_04"]
    },
    {
      id: "flashing-yellow",
      name: "Мигащ жълт светлинен сигнал",
      pattern: /мигащ[а-я\s-]*жълт/i,
      topics: ["theme_04", "theme_08"]
    },
    {
      id: "arrow",
      name: "Светлинен сигнал със стрелка",
      pattern: /светлин[а-я\s-]*стрелк/i,
      topics: ["theme_04", "theme_07", "theme_08"]
    }
  ];

  const records = [];

  for (const item of definitions) {
    const match = text.match(item.pattern);
    if (!match) continue;

    const start = Math.max(0, match.index - 120);
    const end = Math.min(text.length, match.index + 900);
    const context = text.slice(start, end).trim();

    records.push(
      makeBase(
        "traffic-light-" + item.id,
        "traffic_lights",
        "TRAFFIC_LIGHT",
        null,
        item.name,
        context,
        item.topics
      )
    );
  }

  return records;
}

async function parsePdf(file) {
  const fullPath = path.join(sourceDir, file);

  if (!fs.existsSync(fullPath)) {
    throw new Error("Missing official source: " + fullPath);
  }

  const data = await pdfParse(fs.readFileSync(fullPath));
  return data.text || "";
}

async function main() {
  const signsText = await parsePdf("road-signs.pdf");
  const markingText = await parsePdf("road-marking.pdf");
  const lightsText = await parsePdf("traffic-lights.pdf");

  const signs = extractSigns(signsText);
  const markings = extractMarkings(markingText);
  const lights = extractTrafficLights(lightsText);

  const all = [...signs, ...markings, ...lights];

  const report = {
    generatedAt: new Date().toISOString(),
    normalizer: "V5.5-document-specific-visual",
    counts: {
      roadSigns: signs.length,
      roadMarking: markings.length,
      trafficLights: lights.length,
      total: all.length
    },
    expectedRanges: {
      roadSigns: "Do not treat as an exact count; PDF may contain repeated references and annexes.",
      roadMarking: "M1-M20 identifiers are the target range; descriptions still require legal verification.",
      trafficLights: "Signals are modeled by semantic signal type because the PDF does not expose a stable C-code taxonomy."
    },
    verifiedCount: 0,
    warning: "Extraction/normalization is not legal verification."
  };

  fs.writeFileSync(
    path.join(outputDir, "visual-rules.v5.5.json"),
    JSON.stringify(all, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(outputDir, "report.v5.5.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log("road_signs: " + signs.length + " records");
  console.log("road_marking: " + markings.length + " records");
  console.log("traffic_lights: " + lights.length + " records");
  console.log("");
  console.log("Total visual records: " + all.length);
  console.log(
    "Output: seed/visual-final/visual-rules.v5.5.json"
  );
  console.log(
    "Report: seed/visual-final/report.v5.5.json"
  );
  console.log(
    "IMPORTANT: visual normalization does not verify legal correctness."
  );
}

main().catch(error => {
  console.error("V5.5 failed:", error);
  process.exit(1);
});
