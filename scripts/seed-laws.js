require("dotenv").config();
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountPath) {
    throw new Error(
        "Липсва FIREBASE_SERVICE_ACCOUNT в .env"
    );
}

if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
        `Firebase service account файлът не е намерен: ${serviceAccountPath}`
    );
}

const serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

function loadJson(fileName) {
    const filePath = path.join(__dirname, "..", "seed", fileName);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Файлът не е намерен: ${filePath}`);
    }

    return JSON.parse(
        fs.readFileSync(filePath, "utf8")
    );
}

async function seedCollection(collectionName, data) {
    console.log(`\nЗареждане на: ${collectionName}`);

    if (!Array.isArray(data)) {
        throw new Error(
            `${collectionName} трябва да бъде масив от обекти.`
        );
    }

    const batchSize = 400;

    for (let i = 0; i < data.length; i += batchSize) {
        const batch = db.batch();
        const chunk = data.slice(i, i + batchSize);

        for (const item of chunk) {
            if (!item.id) {
                throw new Error(
                    `Липсва id в ${collectionName}.`
                );
            }

            const ref = db
                .collection(collectionName)
                .doc(String(item.id));

            batch.set(
                ref,
                {
                    ...item,
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
            `Заредени ${i + chunk.length} от ${data.length}`
        );
    }

    console.log(
        `✓ ${collectionName}: ${data.length} документа`
    );
}

async function main() {
    const lawSources = loadJson("lawSources.json");
    const lawRules = loadJson("lawRules.json");
    const categories = loadJson("categories.json");
    const topics = loadJson("topics.json");

    await seedCollection("lawSources", lawSources);
    await seedCollection("lawRules", lawRules);
    await seedCollection("categories", categories);
    await seedCollection("topics", topics);

    console.log("\n=================================");
    console.log("RoadMind legal seed завърши!");
    console.log("=================================");
}

main()
    .catch((error) => {
        console.error("\nГрешка при seed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await admin.app().delete();
    });