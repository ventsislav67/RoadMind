const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const sourceDir = path.join(__dirname, "..", "official-sources");
const outputDir = path.join(__dirname, "..", "seed", "format-analysis");

fs.mkdirSync(outputDir, { recursive: true });

const documents = [
  ["zdvp", "zdvp.pdf"],
  ["ppzdvp", "ppzdvp.pdf"],
  ["nar37", "nar37.pdf"],
  ["nar38", "nar38.pdf"],
  ["road_signs", "road-signs.pdf"],
  ["road_marking", "road-marking.pdf"],
  ["traffic_lights", "traffic-lights.pdf"],
  ["first_aid", "first-aid.pdf"]
];

function normalize(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sampleLines(text, regex, limit = 30) {
  return [...text.matchAll(regex)]
    .slice(0, limit)
    .map(m => m[0].trim());
}

async function main() {
  const report = [];

  for (const [id, file] of documents) {
    const filePath = path.join(sourceDir, file);

    if (!fs.existsSync(filePath)) {
      report.push({
        id,
        file,
        error: "missing_file"
      });
      continue;
    }

    const data = await pdfParse(
      fs.readFileSync(filePath)
    );

    const text = normalize(data.text);

    report.push({
      id,
      file,
      characters: text.length,
      lines: text.split("\n").length,
      articleMarkers: sampleLines(
        text,
        /(?:^|\n)\s*Чл\.\s*\d+(?:[а-яА-Я])?\./g
      ),
      paragraphMarkers: sampleLines(
        text,
        /(?:^|\n)\s*\(\d+\)\s+/g
      ),
      numberedItems: sampleLines(
        text,
        /(?:^|\n)\s*\d+\.\s+/g
      ),
      letterItems: sampleLines(
        text,
        /(?:^|\n)\s*[а-яА-Я]\)\s+/g
      ),
      visualCodes: sampleLines(
        text,
        /(?:^|\n)\s*[А-ЯA-Z]\s*\d+(?:\.\d+)?\s+/g
      ),
      markingCodes: sampleLines(
        text,
        /(?:^|\n)\s*М\s*\d+(?:\.\d+)?\s+/g
      ),
      trafficSignalCodes: sampleLines(
        text,
        /(?:^|\n)\s*С\s*\d+(?:\.\d+)?\s+/g
      ),
      firstLines: text.split("\n").slice(0, 20),
      lastLines: text.split("\n").slice(-20)
    });
  }

  const outputPath = path.join(
    outputDir,
    "legal-format-report.json"
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        purpose: "Inspect actual extracted formats before V5.2 parsing",
        documents: report
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "Format report: " + outputPath
  );

  for (const doc of report) {
    console.log(
      doc.id +
      ": chars=" +
      (doc.characters || 0) +
      ", articleMarkers=" +
      (doc.articleMarkers || []).length +
      ", paragraphMarkers=" +
      (doc.paragraphMarkers || []).length +
      ", numberedItems=" +
      (doc.numberedItems || []).length +
      ", letterItems=" +
      (doc.letterItems || []).length +
      ", visualCodes=" +
      (doc.visualCodes || []).length +
      ", markingCodes=" +
      (doc.markingCodes || []).length +
      ", trafficSignals=" +
      (doc.trafficSignalCodes || []).length
    );
  }
}

main().catch(error => {
  console.error("Format analysis failed:", error);
  process.exit(1);
});
