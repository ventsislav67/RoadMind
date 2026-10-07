const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const sourceDir = path.join(__dirname, '..', 'official-sources');
const outputDir = path.join(__dirname, '..', 'seed', 'extracted');
fs.mkdirSync(outputDir, { recursive: true });

const documents = [
  ['zdvp', 'zdvp.pdf'],
  ['ppzdvp', 'ppzdvp.pdf'],
  ['nar37', 'nar37.pdf'],
  ['nar38', 'nar38.pdf'],
  ['road_signs', 'road-signs.pdf'],
  ['road_marking', 'road-marking.pdf'],
  ['traffic_lights', 'traffic-lights.pdf'],
  ['first_aid', 'first-aid.pdf']
];

function normalize(text) {
  return text.replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractArticles(text) {
  const clean = normalize(text);
  const regex = /(?:^|\n)(Чл\.\s*\d+(?:[а-яА-Я])?\.)/g;
  const matches = Array.from(clean.matchAll(regex));
  const result = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + (matches[i][0].startsWith('\n') ? 1 : 0);
    const end = i + 1 < matches.length ? matches[i + 1].index : clean.length;
    const block = clean.slice(start, end).trim();
    const heading = block.match(/^Чл\.\s*(\d+(?:[а-яА-Я])?)\./);
    if (!heading) continue;
    result.push({ article: heading[1], exactText: block });
  }
  return result;
}

async function main() {
  const all = [];
  for (const [sourceId, fileName] of documents) {
    const filePath = path.join(sourceDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error('Missing source file: ' + filePath);
    const data = await pdfParse(fs.readFileSync(filePath));
    const articles = extractArticles(data.text);
    const rules = articles.map((item, index) => ({
      id: sourceId + '-art-' + item.article.replace(/[^0-9а-яА-Я]/g, '_') + '-' + (index + 1),
      sourceId, country: 'BG', language: 'bg', categoryIds: ['B'],
      article: item.article, paragraph: null, item: null, letter: null,
      granularity: 'article', exactText: item.exactText,
      active: true, verified: false, verificationStatus: 'needs_verification',
      extractedAt: new Date().toISOString()
    }));
    fs.writeFileSync(path.join(outputDir, sourceId + '.json'), JSON.stringify(rules, null, 2), 'utf8');
    all.push(...rules);
    console.log(sourceId + ': ' + rules.length + ' article records');
  }
  fs.writeFileSync(path.join(outputDir, 'lawRules.extracted.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log('Total extracted: ' + all.length);
  console.log('IMPORTANT: extracted records are not automatically verified.');
}

main().catch(error => {
  console.error('Extraction failed:', error);
  process.exit(1);
});