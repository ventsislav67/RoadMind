require("dotenv").config();
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountPath) {
  throw new Error("Липсва FIREBASE_SERVICE_ACCOUNT в .env");
}

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error("Firebase service account файлът не е намерен: " + serviceAccountPath);
}

const serviceAccount = JSON.parse(
  fs.readFileSync(serviceAccountPath, "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const productionPath = path.join(
  __dirname,
  "..",
  "seed",
  "production",
  "lawRules.production-candidates.v6.json"
);

const visualPath = path.join(
  __dirname,
  "..",
  "seed",
  "visual-final",
  "visual-rules.v5.5.json"
);

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("Файлът не е намерен: " + filePath);
  }

  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

async function seedCollection(name, data) {
  if (!Array.isArray(data)) {
    throw new Error(name + " трябва да е масив.");
  }

  const batchSize = 400;

  console.log("\nЗареждане на: " + name);

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = db.batch();
    const chunk = data.slice(i, i + batchSize);

    for (const item of chunk) {
      if (!item.id) {
        throw new Error("Липсва id в " + name);
      }

      const ref = db
        .collection(name)
        .doc(String(item.id));

      batch.set(
        ref,
        {
          ...item,
          usableForTutor:
            item.verified === true,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        },
        {
          merge: true
        }
      );
    }

    await batch.commit();

    console.log(
      "Заредени " +
        Math.min(i + chunk.length, data.length) +
        " от " +
        data.length
    );
  }

  console.log(
    "✓ " + name + ": " + data.length + " документа"
  );
}

async function main() {
  const productionRules =
    loadJson(productionPath);

  const visualRules =
    loadJson(visualPath);

  // Keep one canonical lawRules collection.
  // Visual records receive type=VISUAL_RULE.
  const merged = [
    ...productionRules,
    ...visualRules
  ];

  const unique = [];
  const ids = new Set();

  for (const item of merged) {
    if (ids.has(String(item.id))) {
      continue;
    }

    ids.add(String(item.id));
    unique.push(item);
  }

  await seedCollection(
    "lawRules",
    unique
  );

  console.log(
    "\n✓ Всички production candidate правила са записани като lawRules."
  );

  console.log(
    "✓ Непроверените записи НЕ са достъпни за AI Tutor: usableForTutor=false."
  );

  console.log(
    "\nВАЖНО: нито един запис не се маркира като verified от този seed."
  );
}

main()
  .catch(error => {
    console.error("\nГрешка при production seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await admin.app().delete();
  });
