require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountPath) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT. Create a .env file and set the path to your Firebase service account JSON.');
}

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error('Firebase service account file not found: ' + serviceAccountPath);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const topics = [
  { id: 'patni_znatsi', title: 'Пътни знаци', description: 'Значение и приложение на основните пътни знаци.', order: 1, active: true },
  { id: 'predimstvo', title: 'Предимство', description: 'Правила за определяне на предимството при различни ситуации.', order: 2, active: true }
];

const images = [
  { id: 'sign_b1', title: 'Пътен знак Б1', type: 'road_sign', fileName: 'B1.svg', storagePath: 'images/road-signs/B1.svg', topicId: 'patni_znatsi', active: true },
  { id: 'sign_b3', title: 'Пътен знак Б3', type: 'road_sign', fileName: 'B3.svg', storagePath: 'images/road-signs/B3.svg', topicId: 'patni_znatsi', active: true }
];

const questions = [
  { id: 'q_sign_b1', text: 'Какво означава показаният пътен знак?', answers: ['Път с предимство', 'Спри! Пропусни движещите се по пътя с предимство', 'Забранено е влизането', 'Край на всички ограничения'], correctAnswer: 1, topicId: 'patni_znatsi', imageId: 'sign_b1', difficulty: 1, lawReference: 'ЗДвП — пътни знаци', active: true },
  { id: 'q_sign_b3', text: 'Какво означава показаният пътен знак?', answers: ['Път с предимство', 'Забранено е изпреварването', 'Задължително движение направо', 'Край на пътя с предимство'], correctAnswer: 0, topicId: 'patni_znatsi', imageId: 'sign_b3', difficulty: 1, lawReference: 'ЗДвП — пътни знаци', active: true }
];

async function writeCollection(name, items) {
  const batch = db.batch();
  for (const item of items) {
    const ref = db.collection(name).doc(item.id);
    batch.set(ref, { ...item, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  console.log('Seeded ' + items.length + ' documents into ' + name);
}

async function main() {
  await writeCollection('topics', topics);
  await writeCollection('images', images);
  await writeCollection('questions', questions);
  console.log('RoadMind seed completed successfully.');
}

main()
  .catch((error) => { console.error('Seed failed:', error); process.exit(1); })
  .finally(async () => { await admin.app().delete(); });