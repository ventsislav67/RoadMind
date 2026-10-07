const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const sourceDir = path.join(__dirname, "..", "official-sources");
const outputDir = path.join(__dirname, "..", "seed", "normalized-v5_3");

fs.mkdirSync(outputDir, { recursive: true });

const documents = [
  ["road_signs", "road-signs.pdf"],
  ["road_marking", "road-marking.pdf"],
  ["traffic_lights", "traffic-lights.pdf"]
];

function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeId(prefix, value, index) {
  return (
    prefix +
    "-" +
    String(value || index)
      .replace(/\s+/g, "")
      .replace(/[^0-9A-Za-zА-Яа-я.]+/g, "_") +
    "-" +
    index
  );
}

function unique(records) {
  const seen = new Set();
  return records.filter(record => {
    const key = [
      record.visualType,
      record.visualCode,
      record.visualName,
      record.exactText
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractRoadSigns(text) {
  const lines = text
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const match = line.match(
      /^([А-ЯA-Z]\d+(?:\.\d+)?)\s+(.+)$/
    );

    if (!match) {
      continue;
    }

    const code = match[1];
    let name = match[2].trim();

    // Do not accept obvious references to another sign or technical standards.
    if (
      /^(EN|БДС|ISO)\b/i.test(name) ||
      /\bпо БДС\b/i.test(name)
    ) {
      continue;
    }

    // Some descriptions are wrapped to the next line. Join only when
    // the next line does not start a new coded record.
    while (
      i + 1 < lines.length &&
      !/^[А-ЯA-Z]\d+(?:\.\d+)?\s+/.test(lines[i + 1]) &&
      lines[i + 1].length > 2 &&
      !/^(Чл\.|\(|Раздел|Глава|Приложение)/.test(lines[i + 1])
    ) {
      const next = lines[i + 1];

      if (
        /^(М|Р|D|RW|mm|m|km|\d)/i.test(next) &&
        next.length < 18
      ) {
        break;
      }

      name += " " + next;
      i++;

      if (name.length > 220) {
        break;
      }
    }

    records.push({
      id: makeId("sign", code, records.length + 1),
      sourceId: "road_signs",
      country: "BG",
      language: "bg",
      visualType: "ROAD_SIGN",
      visualCode: code,
      visualName: clean(name),
      exactText: clean(name),
      normalizedText: clean(name),
      topicIds: ["theme_04"],
      categoryBRelevance: true,
      learnerScope: "LEARNER_CORE",
      verified: false,
      verificationStatus: "needs_legal_verification",
      normalizationType: "ROAD_SIGN_V5_3",
      sourceOrigin: "official-sources/road-signs.pdf"
    });
  }

  return unique(records);
}

function extractMarkings(text) {
  const records = [];
  const lines = text
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  // The document uses the real marking identifiers M1, M2 ... M20.
  // We collect every line where an M-code is introduced, then continue
  // the description until the next M-code or structural heading.
  const codeRegex = /\bМ\s*(\d+(?:\.\d+)?)\b/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const match = line.match(
      /\bМ\s*(\d+(?:\.\d+)?)\b\s*(?:[-–:]|\.\s+)?(.*)$/i
    );

    if (!match) {
      continue;
    }

    const code = "M" + match[1];
    let description = clean(match[2]);

    while (
      i + 1 < lines.length &&
      !/\bМ\s*\d+(?:\.\d+)?\b/i.test(lines[i + 1]) &&
      !/^Чл\./.test(lines[i + 1]) &&
      !/^Раздел/.test(lines[i + 1]) &&
      !/^Приложение/.test(lines[i + 1])
    ) {
      description +=
        (description ? " " : "") +
        clean(lines[i + 1]);

      i++;

      if (description.length > 500) {
        break;
      }
    }

    if (!description) {
      description = "Пътна маркировка " + code;
    }

    records.push({
      id: makeId("marking", code, records.length + 1),
      sourceId: "road_marking",
      country: "BG",
      language: "bg",
      visualType: "ROAD_MARKING",
      visualCode: code,
      visualName: description,
      exactText: description,
      normalizedText: description,
      topicIds: ["theme_04", "theme_05"],
      categoryBRelevance: true,
      learnerScope: "LEARNER_CORE",
      verified: false,
      verificationStatus: "needs_legal_verification",
      normalizationType: "ROAD_MARKING_V5_3",
      sourceOrigin: "official-sources/road-marking.pdf"
    });
  }

  return unique(records);
}

function extractTrafficLights(text) {
  const cleanText = clean(text);

  const records = [];

  const sections = [
    {
      key: "red",
      label: "Червен сигнал",
      patterns: [
        /червен[ао]?\s+светлин[ао]/i,
        /червена\s+светлина/i
      ],
      topicIds: ["theme_04"]
    },
    {
      key: "yellow",
      label: "Жълт сигнал",
      patterns: [
        /жълт[ао]?\s+светлин[ао]/i,
        /жълта\s+светлина/i
      ],
      topicIds: ["theme_04"]
    },
    {
      key: "green",
      label: "Зелен сигнал",
      patterns: [
        /зелен[ао]?\s+светлин[ао]/i,
        /зелена\s+светлина/i
      ],
      topicIds: ["theme_04"]
    },
    {
      key: "flashing_yellow",
      label: "Мигащ жълт сигнал",
      patterns: [
        /мигащ[ао]?\s+жълт/i
      ],
      topicIds: ["theme_04", "theme_08"]
    },
    {
      key: "green_arrow",
      label: "Зелен светлинен сигнал със стрелка",
      patterns: [
        /зелена\s+светлина.*стрелк/i,
        /стрелк.*зелена\s+светлина/i
      ],
      topicIds: ["theme_04", "theme_07", "theme_08"]
    }
  ];

  for (const section of sections) {
    let bestMatch = null;

    for (const pattern of section.patterns) {
      const match = cleanText.match(pattern);

      if (match) {
        if (!bestMatch || match.index < bestMatch.index) {
          bestMatch = match;
        }
      }
    }

    if (!bestMatch) {
      continue;
    }

    const start = bestMatch.index;

    // Take a bounded context block. This is deliberately not called an
    // exact legal rule yet; the exactText remains the source text fragment.
    const nextPositions = sections
      .map(s => s.patterns
        .map(p => cleanText.match(p))
        .filter(Boolean)
        .map(m => m.index)
      )
      .flat()
      .filter(index => index > start)
      .sort((a, b) => a - b);

    const end =
      nextPositions.length > 0
        ? Math.min(nextPositions[0], start + 1600)
        : Math.min(cleanText.length, start + 1600);

    const context = cleanText
      .slice(start, end)
      .trim();

    records.push({
      id: "traffic-light-" + section.key,
      sourceId: "traffic_lights",
      country: "BG",
      language: "bg",
      visualType: "TRAFFIC_LIGHT",
      visualCode: null,
      visualName: section.label,
      exactText: context,
      normalizedText: context,
      topicIds: section.topicIds,
      categoryBRelevance: true,
      learnerScope: "LEARNER_CORE",
      verified: false,
      verificationStatus: "needs_legal_verification",
      normalizationType: "TRAFFIC_LIGHT_V5_3",
      sourceOrigin: "official-sources/traffic-lights.pdf"
    });
  }

  return unique(records);
}

async function main() {
  const all = [];
  const report = {
    generatedAt: new Date().toISOString(),
    normalizer: "document-specific-v5.3",
    documents: {}
  };

  for (const [sourceId, fileName] of documents) {
    const filePath = path.join(sourceDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error("Missing official source: " + filePath);
    }

    const data = await pdfParse(
      fs.readFileSync(filePath)
    );

    const text = clean(data.text);

    let records = [];

    if (sourceId === "road_signs") {
      records = extractRoadSigns(text);
    } else if (sourceId === "road_marking") {
      records = extractMarkings(text);
    } else if (sourceId === "traffic_lights") {
      records = extractTrafficLights(text);
    }

    all.push(...records);

    report.documents[sourceId] = {
      file: fileName,
      characters: text.length,
      records: records.length
    };

    console.log(
      sourceId + ": " + records.length + " visual records"
    );
  }

  fs.writeFileSync(
    path.join(outputDir, "visual-rules.v5.3.json"),
    JSON.stringify(all, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(outputDir, "report.v5.3.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log("");
  console.log("Total visual records: " + all.length);
  console.log(
    "Output: seed/normalized-v5_3/visual-rules.v5.3.json"
  );
  console.log(
    "Report: seed/normalized-v5_3/report.v5.3.json"
  );
  console.log(
    "IMPORTANT: visual extraction is not legal verification."
  );
}

main().catch(error => {
  console.error("V5.3 failed:", error);
  process.exit(1);
});
