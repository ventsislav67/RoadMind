const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "server-demo.js");

if (!fs.existsSync(filePath)) {
  throw new Error("Липсва server-demo.js");
}

let source = fs.readFileSync(filePath, "utf8");

if (source.includes('require("firebase-admin/app")')) {
  console.log("Firebase Admin v14 migration: already applied.");
  process.exit(0);
}

const oldImport = 'const admin = require("firebase-admin");';
const newImports = `const { initializeApp, cert, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");`;

if (!source.includes(oldImport)) {
  throw new Error("Не е намерен старият firebase-admin import в server-demo.js");
}

source = source.replace(oldImport, newImports);

const oldInit = `admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: bucketName
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const auth = admin.auth();`;

const newInit = `const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: bucketName
});

const db = getFirestore(firebaseApp);
const bucket = getStorage(firebaseApp).bucket();
const auth = getAuth(firebaseApp);`;

if (!source.includes(oldInit)) {
  throw new Error("Не е намерен старият Firebase initialization block.");
}

source = source.replace(oldInit, newInit);
source = source.replaceAll("admin.firestore.Timestamp", "Timestamp");
source = source.replaceAll("admin.firestore.FieldValue", "FieldValue");
source = source.replace(
  "await admin.app().delete();",
  "await deleteApp(firebaseApp);"
);

if (source.includes("admin.")) {
  console.warn("ВНИМАНИЕ: останаха admin.* референции. Провери server-demo.js.");
}

fs.writeFileSync(filePath, source, "utf8");
console.log("Firebase Admin v14 migration applied to server-demo.js.");
