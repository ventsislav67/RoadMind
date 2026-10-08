const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "server-demo.js");

if (!fs.existsSync(filePath)) {
  throw new Error("Липсва server-demo.js");
}

let source = fs.readFileSync(filePath, "utf8");
let changed = false;

function replaceOnce(search, replacement, errorMessage) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) {
    if (errorMessage) throw new Error(errorMessage);
    return;
  }
  source = source.replace(search, replacement);
  changed = true;
}

/* Firebase Admin v14 modular migration */
if (!source.includes('require("firebase-admin/app")')) {
  replaceOnce(
    'const admin = require("firebase-admin");',
    `const { initializeApp, cert, deleteApp } = require("firebase-admin/app");\nconst { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");\nconst { getStorage } = require("firebase-admin/storage");\nconst { getAuth } = require("firebase-admin/auth");`,
    "Не е намерен firebase-admin import в server-demo.js"
  );

  const initRegex = /admin\.initializeApp\(\{[\s\S]*?storageBucket:\s*bucketName\s*\}\);\s*const db\s*=\s*admin\.firestore\(\);\s*const bucket\s*=\s*admin\.storage\(\)\.bucket\(\);\s*const auth\s*=\s*admin\.auth\(\);/;
  if (!initRegex.test(source)) {
    throw new Error("Не е намерен Firebase initialization block.");
  }

  source = source.replace(
    initRegex,
    `const firebaseApp = initializeApp({\n  credential: cert(serviceAccount),\n  storageBucket: bucketName\n});\n\nconst db = getFirestore(firebaseApp);\nconst bucket = getStorage(firebaseApp).bucket();\nconst auth = getAuth(firebaseApp);`
  );
  changed = true;
}

source = source.replaceAll("admin.firestore.Timestamp", "Timestamp");
source = source.replaceAll("admin.firestore.FieldValue", "FieldValue");
source = source.replace("await admin.app().delete();", "await deleteApp(firebaseApp);");

/* Add createdAt to the user profile response. */
if (!source.includes("createdAt: timestampToIso(profile.createdAt)")) {
  const oldProfileTail = '    emailVerified: Boolean(userRecord.emailVerified),\n    category: profile.category || "B"\n  };';
  const newProfileTail = '    emailVerified: Boolean(userRecord.emailVerified),\n    category: profile.category || "B",\n    createdAt: timestampToIso(profile.createdAt) || null\n  };';
  replaceOnce(oldProfileTail, newProfileTail, "Не е намерен userProfile return block.");
}

/* Real editable profile endpoint. */
if (!source.includes("async function handleProfileUpdate")) {
  const marker = "function requireAuthConfig() {";
  if (!source.includes(marker)) {
    throw new Error("Не е намерено място за profile update handler.");
  }

  const handler = `async function handleProfileUpdate(userRecord, payload) {\n  const firstName = String(payload.firstName || \"\").trim();\n  const lastName = String(payload.lastName || \"\").trim();\n\n  if (!validName(firstName)) throw fail(400, \"Въведи валидно име.\");\n  if (!validName(lastName)) throw fail(400, \"Въведи валидна фамилия.\");\n\n  const displayName = \`${'${firstName} ${lastName}'}\`.trim();\n\n  const updatedUser = await auth.updateUser(userRecord.uid, { displayName });\n\n  await db.collection(\"users\").doc(userRecord.uid).set({\n    firstName,\n    lastName,\n    displayName,\n    email: updatedUser.email || userRecord.email || \"\",\n    category: \"B\",\n    emailVerified: Boolean(updatedUser.emailVerified),\n    updatedAt: FieldValue.serverTimestamp()\n  }, { merge: true });\n\n  return { ok: true, user: await userProfile(updatedUser) };\n}\n\n`;

  source = source.replace(marker, handler + marker);
  changed = true;
}

if (!source.includes('url.pathname === "/api/auth/profile"')) {
  const meRoute = `    if (req.method === "GET" && url.pathname === "/api/auth/me") {\n      const user = await requireUser(req);\n      sendJson(res, 200, { ok: true, user: await userProfile(user) });\n      return;\n    }`;

  if (!source.includes(meRoute)) {
    throw new Error("Не е намерен /api/auth/me route за profile patch.");
  }

  const profileRoute = `${meRoute}\n\n    if (req.method === "POST" && url.pathname === "/api/auth/profile") {\n      const user = await requireUser(req);\n      sendJson(res, 200, await handleProfileUpdate(user, await readJsonBody(req)));\n      return;\n    }`;

  source = source.replace(meRoute, profileRoute);
  changed = true;
}

if (source.includes("admin.")) {
  console.warn("ВНИМАНИЕ: останаха admin.* референции в server-demo.js.");
}

if (changed) {
  fs.writeFileSync(filePath, source, "utf8");
  console.log("RoadMind server migration/profile patch applied.");
} else {
  console.log("RoadMind server migration/profile patch: already applied.");
}
