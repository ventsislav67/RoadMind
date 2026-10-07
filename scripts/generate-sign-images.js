const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'assets', 'seed-images', 'road-signs');
fs.mkdirSync(outputDir, { recursive: true });

const signs = [
  {
    file: 'B1.svg',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#ffffff"/><polygon points="256,40 472,256 256,472 40,256" fill="#ffffff" stroke="#d32f2f" stroke-width="34"/><text x="256" y="245" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#111111">STOP</text><text x="256" y="305" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#111111">ПРОПУСНИ</text></svg>'
  },
  {
    file: 'B3.svg',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#ffffff"/><polygon points="256,35 477,256 256,477 35,256" fill="#ffd400" stroke="#111111" stroke-width="30"/><polygon points="256,72 440,256 256,440 72,256" fill="#ffffff"/></svg>'
  }
];

for (const sign of signs) {
  fs.writeFileSync(path.join(outputDir, sign.file), sign.svg, 'utf8');
  console.log('Created: ' + sign.file);
}

console.log('Created ' + signs.length + ' seed images in ' + outputDir);