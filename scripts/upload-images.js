require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

if (!serviceAccountPath || !bucketName) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_STORAGE_BUCKET in .env');
}

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error('Firebase service account file not found: ' + serviceAccountPath);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: bucketName });

const bucket = admin.storage().bucket();
const sourceDir = path.join(__dirname, '..', 'assets', 'seed-images', 'road-signs');

const uploads = [
  { file: 'B1.svg', destination: 'images/road-signs/B1.svg' },
  { file: 'B3.svg', destination: 'images/road-signs/B3.svg' }
];

async function main() {
  for (const item of uploads) {
    const source = path.join(sourceDir, item.file);
    if (!fs.existsSync(source)) throw new Error('Image not found: ' + source);
    await bucket.upload(source, { destination: item.destination, metadata: { contentType: 'image/svg+xml', cacheControl: 'public,max-age=3600' } });
    console.log('Uploaded: ' + item.file + ' -> ' + item.destination);
  }
  console.log('Image upload completed successfully.');
}

main()
  .catch((error) => { console.error('Upload failed:', error); process.exit(1); })
  .finally(async () => { await admin.app().delete(); });