require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const outputDir = path.join(__dirname, '..', 'official-sources');
fs.mkdirSync(outputDir, { recursive: true });

const sources = [
  { id: 'zdvp', file: 'zdvp.pdf', url: 'https://www.sars.gov.bg/wp-content/uploads/2026/02/%D0%97%D0%94%D0%B2%D0%9F.pdf' },
  { id: 'ppzdvp', file: 'ppzdvp.pdf', url: 'https://www.sars.gov.bg/wp-content/uploads/documents/test/Pravilnik-za-prilagane-na-zakona-za-dvizhenieto-po-patishtata.pdf' },
  { id: 'nar37', file: 'nar37.pdf', url: 'https://www.rta.government.bg/upload/12972/N37.pdf' },
  { id: 'nar38', file: 'nar38.pdf', url: 'https://rta.government.bg/upload/12973/N38.pdf' },
  { id: 'road_signs', file: 'road-signs.pdf', url: 'https://www.sars.gov.bg/wp-content/uploads/2024/07/%D0%9D%D0%90%D0%A0%D0%95%D0%94%D0%91%D0%90-%E2%84%96-%D0%A0%D0%94-02-21-1-%D0%9E%D0%A2-23-%D0%9D%D0%9E%D0%95%D0%9C%D0%92%D0%A0%D0%98-2023-%D0%93.-%D0%97%D0%90-%D0%A1%D0%98%D0%93%D0%9D%D0%90%D0%9B%D0%98%D0%97%D0%90%D0%A6%D0%98%D0%AF-%D0%9D%D0%90-%D0%9F%D0%AA%D0%A2%D0%98%D0%A9%D0%90%D0%A2%D0%90-%D0%A1-%D0%9F%D0%AA%D0%A2%D0%9D%D0%98-%D0%97%D0%9D%D0%90%D0%A6%D0%98.pdf' },
  { id: 'road_marking', file: 'road-marking.pdf', url: 'https://www.sars.gov.bg/wp-content/uploads/documents/test/Naredba-No-2-ot-17-yanuari-2001-g.-za-signalizatsiya.pdf' },
  { id: 'traffic_lights', file: 'traffic-lights.pdf', url: 'https://www.sars.gov.bg/wp-content/uploads/2025/10/%D0%A0%D0%94-02-21-2.pdf' },
  { id: 'first_aid', file: 'first-aid.pdf', url: 'https://www.sars.gov.bg/wp-content/uploads/documents/test/Naredba-No-24-ot-2-dekemvri-2002-g.-za-usloviyata.pdf' }
];

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'RoadMind/1.0' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return download(response.headers.location, destination).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error('HTTP ' + response.statusCode + ' while downloading ' + url));
      }
      const output = fs.createWriteStream(destination);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function main() {
  for (const source of sources) {
    const destination = path.join(outputDir, source.file);
    console.log('Downloading ' + source.id + '...');
    await download(source.url, destination);
    console.log('OK: ' + destination);
  }
  console.log('All official source files downloaded.');
}

main().catch(error => {
  console.error('Download failed:', error.message);
  process.exit(1);
});