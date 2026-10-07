const fs = require('fs');
const path = require('path');

const input = path.join(__dirname, '..', 'seed', 'atomic', 'lawRules.atomic.json');
const outputDir = path.join(__dirname, '..', 'seed', 'validation');
fs.mkdirSync(outputDir, { recursive: true });

if (!fs.existsSync(input)) throw new Error('Missing: ' + input);

const rules = JSON.parse(fs.readFileSync(input, 'utf8'));
const issues = [];
const bySource = new Map();
const byArticle = new Map();

function issue(type, rule, message) {
  issues.push({ type, ruleId: rule.id, sourceId: rule.sourceId, article: rule.article, paragraph: rule.paragraph, item: rule.item, letter: rule.letter, message });
}

for (const rule of rules) {
  if (!rule.id) issue('missing_id', rule, 'Missing rule id');
  if (!rule.sourceId) issue('missing_source', rule, 'Missing sourceId');
  if (rule.country !== 'BG') issue('wrong_country', rule, 'Rule is not marked BG');
  if (rule.language !== 'bg') issue('wrong_language', rule, 'Rule is not marked bg');
  if (!Array.isArray(rule.categoryIds) || !rule.categoryIds.includes('B')) issue('missing_category_B', rule, 'Rule is not linked to category B');
  if (!rule.exactText || rule.exactText.length < 5) issue('empty_text', rule, 'Exact text is empty or too short');
  if (!rule.article) issue('missing_article', rule, 'Article is missing');
  if (rule.verified === true) issue('premature_verified', rule, 'Extracted record is already marked verified');

  if (!bySource.has(rule.sourceId)) bySource.set(rule.sourceId, 0);
  bySource.set(rule.sourceId, bySource.get(rule.sourceId) + 1);

  const articleKey = rule.sourceId + '::' + rule.article;
  if (!byArticle.has(articleKey)) byArticle.set(articleKey, []);
  byArticle.get(articleKey).push(rule);
}

for (const [key, rows] of byArticle) {
  const paragraphNumbers = rows.map(x => x.paragraph).filter(x => x !== null && x !== undefined).map(Number).filter(Number.isFinite);
  if (paragraphNumbers.length > 1) {
    const unique = [...new Set(paragraphNumbers)].sort((a,b)=>a-b);
    for (let i=1; i<=unique[unique.length-1]; i++) {
      if (!unique.includes(i)) {
        const rule = rows[0];
        issue('paragraph_gap', rule, 'Possible paragraph-number gap inside article: ' + i);
        break;
      }
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  totalRules: rules.length,
  issueCount: issues.length,
  sourceCounts: Object.fromEntries(bySource),
  issueCounts: issues.reduce((acc, x) => { acc[x.type]=(acc[x.type]||0)+1; return acc; }, {}),
  verifiedTrueCount: rules.filter(x => x.verified === true).length,
  status: issues.length === 0 ? 'structurally_clean' : 'needs_review'
};

fs.writeFileSync(path.join(outputDir, 'validation-report.json'), JSON.stringify({summary, issues}, null, 2), 'utf8');
console.log('Rules checked: ' + summary.totalRules);
console.log('Issues: ' + summary.issueCount);
console.log('Report: seed/validation/validation-report.json');
console.log('Status: ' + summary.status);