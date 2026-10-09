require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const root = path.join(__dirname, '..');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
const questionPath = path.join(root, 'seed', 'question-bank-v1.json');
const lawRulesPath = path.join(root, 'seed', 'lawRules.json');

if (!serviceAccountPath) throw new Error('Липсва FIREBASE_SERVICE_ACCOUNT в .env');
if (!fs.existsSync(serviceAccountPath)) throw new Error('Firebase service account файлът не е намерен: ' + serviceAccountPath);
if (!fs.existsSync(questionPath)) throw new Error('Липсва seed/question-bank-v1.json');
if (!fs.existsSync(lawRulesPath)) throw new Error('Липсва seed/lawRules.json');

const questions = JSON.parse(fs.readFileSync(questionPath, 'utf8'));
const lawRules = JSON.parse(fs.readFileSync(lawRulesPath, 'utf8'));
const knownRuleIds = new Set(lawRules.map(rule => String(rule.id)));

function validateQuestion(question, ids) {
  if (!question || typeof question !== 'object') throw new Error('Невалиден question record.');
  if (!/^qb_v1_\d{3}$/.test(String(question.id || ''))) throw new Error('Невалиден question id: ' + question.id);
  if (ids.has(question.id)) throw new Error('Дублиран question id: ' + question.id);
  ids.add(question.id);

  if (!String(question.text || '').trim()) throw new Error('Липсва text при ' + question.id);
  if (!Array.isArray(question.answers) || question.answers.length < 2) throw new Error('Невалидни answers при ' + question.id);
  if (!Number.isInteger(Number(question.correctAnswer))) throw new Error('Невалиден correctAnswer при ' + question.id);
  if (Number(question.correctAnswer) < 0 || Number(question.correctAnswer) >= question.answers.length) throw new Error('correctAnswer е извън answers при ' + question.id);
  if (!Array.isArray(question.topicIds) || !question.topicIds.length) throw new Error('Липсват topicIds при ' + question.id);
  if (String(question.category || '') !== 'B') throw new Error('Невалидна category при ' + question.id);
  if (!question.sourceRuleId || !knownRuleIds.has(String(question.sourceRuleId))) {
    throw new Error('Невалиден sourceRuleId при ' + question.id + ': ' + question.sourceRuleId);
  }
}

const ids = new Set();
questions.forEach(question => validateQuestion(question, ids));

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

async function main() {
  console.log('RoadMind Question Bank v1');
  console.log('-------------------------');
  console.log('Validated questions: ' + questions.length);

  let written = 0;
  const chunkSize = 400;

  for (let offset = 0; offset < questions.length; offset += chunkSize) {
    const chunk = questions.slice(offset, offset + chunkSize);
    const batch = db.batch();

    for (const question of chunk) {
      const ref = db.collection('questions').doc(question.id);
      batch.set(ref, {
        ...question,
        bankVersion: 'v1',
        seededAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    await batch.commit();
    written += chunk.length;
    console.log('Written: ' + written + '/' + questions.length);
  }

  console.log('Done. Firestore questions now include Question Bank v1.');
  console.log('Note: reviewStatus=needs_consolidation_check means these are development questions pending final legal review.');
}

main()
  .catch(error => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await deleteApp(app).catch(() => {});
  });
