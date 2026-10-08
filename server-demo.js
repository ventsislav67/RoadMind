require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 3000);
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY || "";
const authCodeSecret = process.env.AUTH_CODE_SECRET || "";
const sessionDays = Math.max(1, Math.min(14, Number(process.env.SESSION_DAYS || 5)));

if (!serviceAccountPath) throw new Error("Липсва FIREBASE_SERVICE_ACCOUNT в .env");
if (!fs.existsSync(serviceAccountPath)) throw new Error("Firebase service account файлът не е намерен: " + serviceAccountPath);
if (!bucketName) throw new Error("Липсва FIREBASE_STORAGE_BUCKET в .env");

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: bucketName
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const auth = admin.auth();

const indexPath = path.join(__dirname, "src", "index.html");
const resultScriptPath = path.join(__dirname, "src", "roadmind-results.js");
const dashboardScriptPath = path.join(__dirname, "src", "roadmind-dashboard.js");
const authScriptPath = path.join(__dirname, "src", "roadmind-auth.js");

for (const file of [indexPath, resultScriptPath, dashboardScriptPath, authScriptPath]) {
  if (!fs.existsSync(file)) throw new Error("Липсва файл: " + file);
}

const smtpConfigured = Boolean(
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

const mailer = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isSafeId(value) {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validName(value) {
  return String(value || "").trim().length >= 2 && String(value || "").trim().length <= 40;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8) throw fail(400, "Паролата трябва да е поне 8 символа.");
  if (password.length > 128) throw fail(400, "Паролата е прекалено дълга.");
  return password;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;
      if (size > 100000) {
        reject(fail(413, "Request body is too large."));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        reject(fail(400, "Невалиден JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const parts = [
    `rm_session=${encodeURIComponent(value || "")}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.round(maxAgeSeconds || 0))}`
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function requireUser(req) {
  const sessionCookie = parseCookies(req).rm_session;
  if (!sessionCookie) throw fail(401, "Трябва да влезеш в профила си.");

  try {
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const userRecord = await auth.getUser(decoded.uid);
    if (userRecord.disabled) throw fail(401, "Профилът е деактивиран.");
    return userRecord;
  } catch (error) {
    if (error.status) throw error;
    throw fail(401, "Сесията е изтекла. Влез отново.");
  }
}

async function userProfile(userRecord) {
  const snap = await db.collection("users").doc(userRecord.uid).get();
  const profile = snap.exists ? snap.data() : {};
  const displayParts = String(userRecord.displayName || "").trim().split(/\s+/).filter(Boolean);

  return {
    uid: userRecord.uid,
    email: userRecord.email || profile.email || "",
    firstName: profile.firstName || displayParts[0] || "",
    lastName: profile.lastName || displayParts.slice(1).join(" ") || "",
    displayName: userRecord.displayName || profile.displayName || "",
    emailVerified: Boolean(userRecord.emailVerified),
    category: profile.category || "B"
  };
}

function requireAuthConfig() {
  if (!firebaseWebApiKey) throw fail(500, "Липсва FIREBASE_WEB_API_KEY в .env.");
}

function requireEmailConfig() {
  if (!authCodeSecret) throw fail(500, "Липсва AUTH_CODE_SECRET в .env.");
  if (!mailer) throw fail(500, "SMTP настройките не са попълнени в .env.");
}

function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function digest(value, context) {
  return crypto
    .createHmac("sha256", authCodeSecret)
    .update(`${context}:${value}`)
    .digest("hex");
}

function safeEqualHex(a, b) {
  try {
    const aBuffer = Buffer.from(String(a), "hex");
    const bBuffer = Buffer.from(String(b), "hex");
    return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
  } catch (_) {
    return false;
  }
}

function codeDocId(purpose, uid) {
  return `${purpose}_${uid}`;
}

async function sendCodeEmail(email, code, purpose, firstName = "") {
  requireEmailConfig();
  const registration = purpose === "verify_email";
  const subject = registration
    ? "RoadMind — код за потвърждение"
    : "RoadMind — код за нова парола";
  const title = registration ? "Потвърди своя имейл" : "Смяна на парола";
  const intro = registration
    ? "Използвай този код, за да завършиш регистрацията си в RoadMind."
    : "Използвай този код, за да продължиш със задаването на нова парола.";

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    text: `${firstName ? `Здравей, ${firstName}!\n\n` : ""}${intro}\n\nКод: ${code}\n\nКодът е валиден 10 минути. Ако не си поискал това действие, игнорирай имейла.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#151926;">
        <div style="font-size:22px;font-weight:800;margin-bottom:8px;">RoadMind</div>
        <h2 style="margin:18px 0 8px;">${title}</h2>
        <p>${firstName ? `Здравей, ${firstName}! ` : ""}${intro}</p>
        <div style="font-size:34px;letter-spacing:8px;font-weight:800;background:#f2f5fb;border-radius:14px;padding:18px;text-align:center;margin:24px 0;">${code}</div>
        <p style="color:#667085;font-size:13px;">Кодът е валиден 10 минути. Ако не си поискал това действие, просто игнорирай този имейл.</p>
      </div>
    `
  });
}

async function issueEmailCode({ uid, email, purpose, firstName = "", lastName = "" }) {
  requireEmailConfig();
  const ref = db.collection("emailCodes").doc(codeDocId(purpose, uid));
  const existing = await ref.get();

  if (existing.exists) {
    const sentAt = existing.data().sentAt;
    const sentMs = sentAt && typeof sentAt.toMillis === "function" ? sentAt.toMillis() : 0;
    if (sentMs && Date.now() - sentMs < 45000) {
      throw fail(429, "Изчакай малко преди да поискаш нов код.");
    }
  }

  const code = randomCode();
  const data = {
    uid,
    email,
    purpose,
    firstName,
    lastName,
    codeHash: digest(code, `${purpose}:${email}`),
    attempts: 0,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await ref.set(data, { merge: false });

  try {
    await sendCodeEmail(email, code, purpose, firstName);
  } catch (error) {
    await ref.delete().catch(() => {});
    throw fail(500, "Имейлът с кода не можа да бъде изпратен. Провери SMTP настройките.");
  }
}

async function verifyEmailCode({ uid, email, purpose, code }) {
  if (!/^\d{6}$/.test(String(code || ""))) throw fail(400, "Въведи валиден 6-цифрен код.");

  const ref = db.collection("emailCodes").doc(codeDocId(purpose, uid));
  const snap = await ref.get();
  if (!snap.exists) throw fail(400, "Кодът е невалиден или вече е използван.");

  const data = snap.data();
  const expiresMs = data.expiresAt && typeof data.expiresAt.toMillis === "function"
    ? data.expiresAt.toMillis()
    : 0;

  if (!expiresMs || Date.now() > expiresMs) {
    await ref.delete().catch(() => {});
    throw fail(400, "Кодът е изтекъл. Поискай нов код.");
  }

  const attempts = Number(data.attempts || 0);
  if (attempts >= 5) {
    await ref.delete().catch(() => {});
    throw fail(429, "Твърде много грешни опити. Поискай нов код.");
  }

  const expected = digest(String(code), `${purpose}:${email}`);
  if (!safeEqualHex(expected, data.codeHash)) {
    await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
    throw fail(400, "Кодът не е правилен.");
  }

  return { ref, data };
}

async function handleRegisterStart(payload) {
  requireEmailConfig();
  const email = normalizeEmail(payload.email);
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  const password = validatePassword(payload.password);

  if (!validEmail(email)) throw fail(400, "Въведи валиден имейл.");
  if (!validName(firstName)) throw fail(400, "Въведи валидно име.");
  if (!validName(lastName)) throw fail(400, "Въведи валидна фамилия.");

  let user;
  try {
    user = await auth.getUserByEmail(email);
    if (!user.disabled && user.emailVerified) {
      throw fail(409, "Този имейл вече е регистриран.");
    }

    await auth.updateUser(user.uid, {
      password,
      displayName: `${firstName} ${lastName}`,
      disabled: true
    });
    user = await auth.getUser(user.uid);
  } catch (error) {
    if (error.status) throw error;
    if (error.code === "auth/user-not-found") {
      user = await auth.createUser({
        email,
        password,
        displayName: `${firstName} ${lastName}`,
        emailVerified: false,
        disabled: true
      });
    } else {
      throw error;
    }
  }

  await issueEmailCode({
    uid: user.uid,
    email,
    purpose: "verify_email",
    firstName,
    lastName
  });

  return { ok: true };
}

async function handleRegisterVerify(payload) {
  requireEmailConfig();
  const email = normalizeEmail(payload.email);
  if (!validEmail(email)) throw fail(400, "Въведи валиден имейл.");

  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) throw fail(400, "Регистрацията не е намерена.");

  const verified = await verifyEmailCode({
    uid: user.uid,
    email,
    purpose: "verify_email",
    code: payload.code
  });

  const firstName = String(verified.data.firstName || "").trim();
  const lastName = String(verified.data.lastName || "").trim();

  await auth.updateUser(user.uid, {
    disabled: false,
    emailVerified: true,
    displayName: `${firstName} ${lastName}`.trim()
  });

  await db.collection("users").doc(user.uid).set({
    email,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`.trim(),
    category: "B",
    emailVerified: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await verified.ref.delete();
  return { ok: true };
}

async function firebasePasswordSignIn(email, password) {
  requireAuthConfig();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseWebApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const code = data?.error?.message || "AUTH_FAILED";
    const friendly = {
      EMAIL_NOT_FOUND: "Грешен имейл или парола.",
      INVALID_PASSWORD: "Грешен имейл или парола.",
      INVALID_LOGIN_CREDENTIALS: "Грешен имейл или парола.",
      USER_DISABLED: "Профилът още не е потвърден или е деактивиран.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Твърде много опити. Опитай отново след малко."
    }[code] || "Входът не беше успешен.";
    throw fail(401, friendly);
  }

  return data;
}

async function handleLogin(payload, res) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  if (!validEmail(email) || !password) throw fail(400, "Попълни имейл и парола.");

  const signIn = await firebasePasswordSignIn(email, password);
  const expiresIn = sessionDays * 24 * 60 * 60 * 1000;
  const sessionCookie = await auth.createSessionCookie(signIn.idToken, { expiresIn });
  setSessionCookie(res, sessionCookie, expiresIn / 1000);

  const userRecord = await auth.getUser(signIn.localId);
  return { ok: true, user: await userProfile(userRecord) };
}

async function handlePasswordStart(payload) {
  requireEmailConfig();
  const email = normalizeEmail(payload.email);
  if (!validEmail(email)) return { ok: true };

  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user || user.disabled || !user.emailVerified) return { ok: true };

  const profile = await userProfile(user);
  await issueEmailCode({
    uid: user.uid,
    email,
    purpose: "reset_password",
    firstName: profile.firstName,
    lastName: profile.lastName
  });

  return { ok: true };
}

async function handlePasswordVerify(payload) {
  requireEmailConfig();
  const email = normalizeEmail(payload.email);
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user || user.disabled || !user.emailVerified) throw fail(400, "Кодът е невалиден или изтекъл.");

  const verified = await verifyEmailCode({
    uid: user.uid,
    email,
    purpose: "reset_password",
    code: payload.code
  });

  const resetToken = crypto.randomBytes(32).toString("base64url");
  await db.collection("passwordResetSessions").doc(user.uid).set({
    uid: user.uid,
    email,
    tokenHash: digest(resetToken, `reset-session:${user.uid}`),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await verified.ref.delete();
  return { ok: true, resetToken };
}

async function handlePasswordReset(payload, res) {
  requireEmailConfig();
  const email = normalizeEmail(payload.email);
  const newPassword = validatePassword(payload.newPassword);
  const resetToken = String(payload.resetToken || "");
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) throw fail(400, "Сесията за нова парола е невалидна.");

  const ref = db.collection("passwordResetSessions").doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) throw fail(400, "Сесията за нова парола е изтекла.");

  const data = snap.data();
  const expiresMs = data.expiresAt && typeof data.expiresAt.toMillis === "function"
    ? data.expiresAt.toMillis()
    : 0;
  const expected = digest(resetToken, `reset-session:${user.uid}`);

  if (!expiresMs || Date.now() > expiresMs || !safeEqualHex(expected, data.tokenHash)) {
    await ref.delete().catch(() => {});
    throw fail(400, "Сесията за нова парола е невалидна или изтекла.");
  }

  await auth.updateUser(user.uid, { password: newPassword });
  await auth.revokeRefreshTokens(user.uid);
  await ref.delete();
  setSessionCookie(res, "", 0);
  return { ok: true };
}

async function loadTestById(testId) {
  const snap = await db.collection("tests").doc(String(testId)).get();
  if (!snap.exists) throw fail(404, "Тестът не съществува: " + testId);
  return { id: snap.id, ...snap.data() };
}

async function loadDemoTest() {
  const test = await loadTestById("demo_test_001");
  const questionIds = Array.isArray(test.questionIds) ? test.questionIds : [];
  if (!questionIds.length) throw fail(500, "Демо тестът няма questionIds.");

  const refs = questionIds.map(id => db.collection("questions").doc(String(id)));
  const snapshots = await db.getAll(...refs);
  const questions = [];

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.exists) throw fail(500, "Липсва question: " + questionIds[i]);
    questions.push({ id: snap.id, ...snap.data() });
  }

  return { test, questions };
}

async function loadImage(res, imageId) {
  if (!isSafeId(imageId)) {
    sendText(res, 400, "Невалиден imageId.", "text/plain; charset=utf-8");
    return;
  }

  const imageSnap = await db.collection("images").doc(imageId).get();
  if (!imageSnap.exists) {
    sendText(res, 404, "Изображението не е намерено.", "text/plain; charset=utf-8");
    return;
  }

  const image = imageSnap.data();
  if (!image.storagePath) {
    sendText(res, 500, "Липсва storagePath.", "text/plain; charset=utf-8");
    return;
  }

  const file = bucket.file(image.storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    sendText(res, 404, "Файлът не съществува във Firebase Storage.", "text/plain; charset=utf-8");
    return;
  }

  const [buffer] = await file.download();
  const ext = path.extname(image.storagePath).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  };

  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
    "Content-Length": buffer.length
  });
  res.end(buffer);
}

function clampTimeMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 30 * 60 * 1000);
}

async function saveResult(payload, userId) {
  const testId = String(payload.testId || "demo_test_001");
  const test = await loadTestById(testId);
  const allowedQuestionIds = new Set(
    Array.isArray(test.questionIds) ? test.questionIds.map(String) : []
  );

  const submittedAnswers = Array.isArray(payload.answers) ? payload.answers : [];
  if (!submittedAnswers.length) throw fail(400, "Липсват отговори за запис.");

  const safeAnswers = submittedAnswers
    .filter(answer => answer && allowedQuestionIds.has(String(answer.questionId)))
    .map(answer => ({
      questionId: String(answer.questionId),
      selectedAnswer: Number(answer.selectedAnswer),
      timeMs: clampTimeMs(answer.timeMs)
    }));

  if (!safeAnswers.length) throw fail(400, "Няма валидни отговори за този тест.");

  const refs = safeAnswers.map(answer => db.collection("questions").doc(answer.questionId));
  const snapshots = await db.getAll(...refs);

  const answerResults = [];
  const topicResults = {};
  let correct = 0;
  let answeredTimeMs = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const submitted = safeAnswers[i];
    if (!snap.exists) throw fail(500, "Липсва question: " + submitted.questionId);

    const question = snap.data();
    const correctAnswer = Number(question.correctAnswer);
    const isCorrect = submitted.selectedAnswer === correctAnswer;
    if (isCorrect) correct++;
    answeredTimeMs += submitted.timeMs;

    const topicIds = Array.isArray(question.topicIds) ? question.topicIds.map(String) : [];
    for (const topicId of topicIds) {
      if (!topicResults[topicId]) {
        topicResults[topicId] = { correct: 0, wrong: 0, total: 0, percentage: 0 };
      }
      topicResults[topicId].total++;
      if (isCorrect) topicResults[topicId].correct++;
      else topicResults[topicId].wrong++;
    }

    answerResults.push({
      questionId: submitted.questionId,
      selectedAnswer: submitted.selectedAnswer,
      correctAnswer,
      isCorrect,
      timeMs: submitted.timeMs,
      topicIds,
      lawRuleIds: Array.isArray(question.lawRuleIds) ? question.lawRuleIds : []
    });
  }

  for (const value of Object.values(topicResults)) {
    value.percentage = value.total ? Math.round((value.correct / value.total) * 100) : 0;
  }

  const total = answerResults.length;
  const wrong = total - correct;
  const percentage = total ? Math.round((correct / total) * 100) : 0;
  const averageTimeMs = total ? Math.round(answeredTimeMs / total) : 0;
  const durationMs = clampTimeMs(payload.durationMs);

  const resultData = {
    userId,
    testId,
    testTitle: test.title || null,
    mode: String(payload.mode || "demo"),
    category: test.category || "B",
    score: correct,
    correct,
    wrong,
    total,
    percentage,
    durationMs,
    averageTimeMs,
    topicResults,
    answers: answerResults,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const ref = await db.collection("results").add(resultData);
  return {
    id: ref.id,
    ...resultData,
    createdAt: new Date().toISOString()
  };
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value._seconds)) return value._seconds * 1000;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function timestampToIso(value) {
  const ms = timestampToMillis(value);
  return ms ? new Date(ms).toISOString() : null;
}

async function loadUserResults(userId) {
  if (!isSafeId(userId)) throw fail(400, "Невалиден userId.");
  const snapshot = await db.collection("results").where("userId", "==", userId).get();
  const rows = snapshot.docs.map(doc => {
    const data = doc.data();
    return { id: doc.id, ...data, _createdMs: timestampToMillis(data.createdAt) };
  });
  rows.sort((a, b) => b._createdMs - a._createdMs);
  return rows;
}

function sofiaDateKey(ms) {
  if (!ms) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftDateKey(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function streakStats(results) {
  const days = [...new Set(results.map(r => sofiaDateKey(r._createdMs)).filter(Boolean))].sort();
  if (!days.length) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] === shiftDateKey(days[i - 1], 1)) run++;
    else run = 1;
    longest = Math.max(longest, run);
  }

  const set = new Set(days);
  const today = sofiaDateKey(Date.now());
  const yesterday = shiftDateKey(today, -1);
  let cursor = set.has(today) ? today : set.has(yesterday) ? yesterday : null;
  let current = 0;
  while (cursor && set.has(cursor)) {
    current++;
    cursor = shiftDateKey(cursor, -1);
  }
  return { current, longest };
}

function longestCorrectStreak(results) {
  const chronological = results.slice().sort((a, b) => a._createdMs - b._createdMs);
  let best = 0;
  let current = 0;
  for (const result of chronological) {
    const answers = Array.isArray(result.answers) ? result.answers : [];
    for (const answer of answers) {
      if (answer.isCorrect === true) {
        current++;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
  }
  return best;
}

function buildDashboard(results, userId) {
  const totalAttempts = results.length;
  const totalAnsweredQuestions = results.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const totalCorrectAnswers = results.reduce((sum, r) => sum + Number(r.correct || 0), 0);
  const overallAccuracy = totalAnsweredQuestions
    ? Math.round((totalCorrectAnswers / totalAnsweredQuestions) * 100)
    : 0;

  const percentages = results.map(r => Number(r.percentage || 0)).filter(Number.isFinite);
  const averagePercentage = percentages.length
    ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
    : 0;
  const bestPercentage = percentages.length ? Math.max(...percentages) : 0;
  const recentForReady = results.slice(0, 10);
  const readyScore = recentForReady.length
    ? Math.round(recentForReady.reduce((sum, r) => sum + Number(r.percentage || 0), 0) / recentForReady.length)
    : 0;

  const answerTimes = [];
  for (const result of results) {
    for (const answer of Array.isArray(result.answers) ? result.answers : []) {
      const timeMs = Number(answer.timeMs || 0);
      if (Number.isFinite(timeMs) && timeMs > 0) answerTimes.push(timeMs);
    }
  }
  const averageAnswerTimeMs = answerTimes.length
    ? Math.round(answerTimes.reduce((a, b) => a + b, 0) / answerTimes.length)
    : 0;

  const topicTotals = {};
  for (const result of results) {
    const topicResults = result.topicResults && typeof result.topicResults === "object"
      ? result.topicResults
      : {};
    for (const [topicId, value] of Object.entries(topicResults)) {
      if (!topicTotals[topicId]) topicTotals[topicId] = { correct: 0, wrong: 0, total: 0, percentage: 0 };
      topicTotals[topicId].correct += Number(value.correct || 0);
      topicTotals[topicId].wrong += Number(value.wrong || 0);
      topicTotals[topicId].total += Number(value.total || 0);
    }
  }
  for (const value of Object.values(topicTotals)) {
    value.percentage = value.total ? Math.round((value.correct / value.total) * 100) : 0;
  }

  const weakTopics = Object.entries(topicTotals)
    .filter(([, value]) => value.total > 0)
    .map(([topicId, value]) => ({ topicId, ...value }))
    .sort((a, b) => a.percentage - b.percentage || b.total - a.total)
    .slice(0, 4);

  const history = results.slice(0, 10).map(result => ({
    id: result.id,
    testId: result.testId || null,
    testTitle: result.testTitle || "Листовка",
    mode: result.mode || "demo",
    correct: Number(result.correct || 0),
    wrong: Number(result.wrong || 0),
    total: Number(result.total || 0),
    percentage: Number(result.percentage || 0),
    averageTimeMs: Number(result.averageTimeMs || 0),
    durationMs: Number(result.durationMs || 0),
    createdAt: timestampToIso(result.createdAt)
  }));

  const progression = results.slice(0, 10).reverse().map(result => ({
    id: result.id,
    percentage: Number(result.percentage || 0),
    createdAt: timestampToIso(result.createdAt)
  }));

  const streak = streakStats(results);
  const demoExamAttempts = results.filter(r => String(r.mode || "") === "exam").length;
  const perfectExamCount = results.filter(r => String(r.mode || "") === "exam" && Number(r.percentage || 0) === 100).length;
  const correctStreak = longestCorrectStreak(results);
  const xp = totalCorrectAnswers * 10 + totalAttempts * 20 + streak.current * 25;
  const level = Math.max(1, Math.floor(xp / 250) + 1);

  return {
    userId,
    readyScore,
    totalAttempts,
    totalAnsweredQuestions,
    totalCorrectAnswers,
    overallAccuracy,
    streakDays: streak.current,
    longestStreakDays: streak.longest,
    longestCorrectStreak: correctStreak,
    demoExamAttempts,
    perfectExamCount,
    xp,
    level,
    averagePercentage,
    bestPercentage,
    averageAnswerTimeMs,
    weakTopics,
    history,
    progression
  };
}

async function loadDashboard(userId) {
  return buildDashboard(await loadUserResults(userId), userId);
}

function serveScript(res, filePath) {
  sendText(res, 200, fs.readFileSync(filePath, "utf8"), "application/javascript; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "RoadMind",
        firestore: true,
        smtpConfigured,
        authConfigured: Boolean(firebaseWebApiKey && authCodeSecret)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const user = await requireUser(req);
      sendJson(res, 200, { ok: true, user: await userProfile(user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register/start") {
      sendJson(res, 200, await handleRegisterStart(await readJsonBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register/verify") {
      sendJson(res, 200, await handleRegisterVerify(await readJsonBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      sendJson(res, 200, await handleLogin(await readJsonBody(req), res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      setSessionCookie(res, "", 0);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/start") {
      sendJson(res, 200, await handlePasswordStart(await readJsonBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/verify") {
      sendJson(res, 200, await handlePasswordVerify(await readJsonBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/password/reset") {
      sendJson(res, 200, await handlePasswordReset(await readJsonBody(req), res));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/demo-test") {
      await requireUser(req);
      sendJson(res, 200, await loadDemoTest());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/results") {
      const user = await requireUser(req);
      const result = await saveResult(await readJsonBody(req), user.uid);
      sendJson(res, 201, { ok: true, result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      const user = await requireUser(req);
      sendJson(res, 200, await loadDashboard(user.uid));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/images/")) {
      await requireUser(req);
      const imageId = decodeURIComponent(url.pathname.substring("/api/images/".length));
      await loadImage(res, imageId);
      return;
    }

    if (req.method === "GET" && url.pathname === "/roadmind-auth.js") {
      serveScript(res, authScriptPath);
      return;
    }

    if (req.method === "GET" && url.pathname === "/roadmind-results.js") {
      serveScript(res, resultScriptPath);
      return;
    }

    if (req.method === "GET" && url.pathname === "/roadmind-dashboard.js") {
      serveScript(res, dashboardScriptPath);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      let html = fs.readFileSync(indexPath, "utf8");
      html = html.replace(
        "</body>",
        '<script src="/roadmind-auth.js"></script>\n<script src="/roadmind-results.js"></script>\n<script src="/roadmind-dashboard.js"></script>\n</body>'
      );
      sendText(res, 200, html, "text/html; charset=utf-8");
      return;
    }

    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (error) {
    console.error("Request error:", error);
    sendJson(res, Number(error.status || 500), {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("=================================");
  console.log("RoadMind REAL DEMO + AUTH");
  console.log("=================================");
  console.log("http://localhost:" + PORT);
  console.log("");
  console.log("Auth configured: " + Boolean(firebaseWebApiKey && authCodeSecret));
  console.log("SMTP configured: " + smtpConfigured);
  console.log("");
});

async function shutdown() {
  try {
    await admin.app().delete();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
