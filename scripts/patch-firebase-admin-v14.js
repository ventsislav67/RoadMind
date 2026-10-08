const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "server-demo.js");

if (!fs.existsSync(filePath)) {
  throw new Error("Липсва server-demo.js");
}

let source = fs.readFileSync(filePath, "utf8");
const original = source;

const modularImports = `const { initializeApp, cert, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");`;

if (!source.includes('require("firebase-admin/app")')) {
  if (source.includes('const admin = require("firebase-admin");')) {
    source = source.replace(
      'const admin = require("firebase-admin");',
      modularImports
    );
  } else {
    throw new Error("Не е намерен firebase-admin import в server-demo.js");
  }
}

if (source.includes("admin.initializeApp(")) {
  source = source.replace(
    /admin\.initializeApp\(\{\s*credential:\s*admin\.credential\.cert\(serviceAccount\),\s*storageBucket:\s*bucketName\s*\}\);/m,
    `const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: bucketName
});`
  );
}

source = source.replace(
  /const\s+db\s*=\s*admin\.firestore\(\);/g,
  "const db = getFirestore(firebaseApp);"
);

source = source.replace(
  /const\s+bucket\s*=\s*admin\.storage\(\)\.bucket\(\);/g,
  "const bucket = getStorage(firebaseApp).bucket();"
);

source = source.replace(
  /const\s+auth\s*=\s*admin\.auth\(\);/g,
  "const auth = getAuth(firebaseApp);"
);

source = source.replaceAll("admin.firestore.Timestamp", "Timestamp");
source = source.replaceAll("admin.firestore.FieldValue", "FieldValue");
source = source.replaceAll("admin.firestore.FieldValue.serverTimestamp()", "FieldValue.serverTimestamp()");
source = source.replaceAll("admin.firestore.FieldValue.increment(", "FieldValue.increment(");

source = source.replace(
  /await\s+admin\.app\(\)\.delete\(\);/g,
  "await deleteApp(firebaseApp);"
);

const incompatible = [
  "admin.initializeApp(",
  "admin.credential.",
  "admin.firestore(",
  "admin.storage(",
  "admin.auth(",
  "admin.firestore.",
  "admin.app()"
].filter(token => source.includes(token));

if (!source.includes("const firebaseApp = initializeApp(")) {
  throw new Error(
    "Не успях да мигрирам Firebase initialization към modular API."
  );
}

if (incompatible.length) {
  throw new Error(
    "Останаха несъвместими Firebase Admin v14 референции: " +
    incompatible.join(", ")
  );
}

if (source === original) {
  console.log("Firebase Admin v14 migration: already applied.");
  process.exit(0);
}

fs.writeFileSync(filePath, source, "utf8");
console.log("Firebase Admin v14 migration applied to server-demo.js.");
