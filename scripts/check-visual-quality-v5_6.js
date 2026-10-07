const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "..", "seed", "visual-final", "visual-rules.v5.5.json");
const outputDir = path.join(__dirname, "..", "seed", "visual-final");

if (!fs.existsSync(inputPath)) {
  throw new Error("Missing V5.5 visual dataset: " + inputPath);
}

const records = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const issues = [];
const seenCodes = new Map();

function addIssue(type, record, message) {
  issues.push({
    type,
    id: record.id,
    sourceId: record.sourceId,
    visualType: record.visualType,
    visualCode: record.visualCode ?? null,
    visualName: record.visualName ?? null,
    message
  });
}

for (const record of records) {
  if (!record.id) addIssue("missing_id", record, "Missing id");
  if (record.country !== "BG") addIssue("wrong_country", record, "Country must be BG");
  if (record.language !== "bg") addIssue("wrong_language", record, "Language must be bg");
  if (!record.exactText || record.exactText.trim().length < 3) {
    addIssue("missing_text", record, "Missing or too-short exactText");
  }
  if (record.verified === true) {
    addIssue("premature_verified", record, "Visual record must remain unverified");
  }

  if (record.visualType === "ROAD_SIGN") {
    const code = String(record.visualCode || "").toUpperCase();

    if (!code) {
      addIssue("sign_missing_code", record, "Road sign is missing visualCode");
    } else {
      if (seenCodes.has(code)) {
        addIssue("duplicate_sign_code", record, "Duplicate road sign code; first seen in " + seenCodes.get(code));
      } else {
        seenCodes.set(code, record.id);
      }
    }

    if (!/^[А-ЯA-Z]\d+(?:\.\d+)?$/.test(code)) {
      addIssue("invalid_sign_code", record, "Unexpected road sign code format");
    }

    if (/\bпо бдс\b|\bбдс\b|\bEN\s*\d{3,}/i.test(record.visualName || "")) {
      addIssue("technical_sign_name", record, "Possible technical-standard text instead of sign name");
    }
  }

  if (record.visualType === "ROAD_MARKING") {
    const code = String(record.visualCode || "");

    if (!/^M\d{1,2}(?:\.\d+)?$/i.test(code)) {
      addIssue("invalid_marking_code", record, "Expected M-code such as M1 or M8.1");
    }
  }

  if (record.visualType === "TRAFFIC_LIGHT") {
    if (!record.visualName) {
      addIssue("traffic_light_missing_name", record, "Traffic light is missing semantic name");
    }
  }
}

const byType = records.reduce((acc, record) => {
  acc[record.visualType] = (acc[record.visualType] || 0) + 1;
  return acc;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  dataset: "visual-rules.v5.5",
  totalRecords: records.length,
  byType,
  issueCount: issues.length,
  issueCounts: issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {}),
  status: issues.length === 0 ? "clean" : "needs_review",
  verifiedCount: records.filter(r => r.verified === true).length
};

fs.writeFileSync(
  path.join(outputDir, "quality-report.v5.6.json"),
  JSON.stringify({ report, issues }, null, 2),
  "utf8"
);

console.log("Visual records checked: " + records.length);
console.log("Road signs: " + (byType.ROAD_SIGN || 0));
console.log("Road marking: " + (byType.ROAD_MARKING || 0));
console.log("Traffic lights: " + (byType.TRAFFIC_LIGHT || 0));
console.log("Issues: " + issues.length);
console.log("Status: " + report.status);
console.log("Report: seed/visual-final/quality-report.v5.6.json");
console.log("IMPORTANT: quality checking is not legal verification.");
