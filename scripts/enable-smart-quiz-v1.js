const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server-roadmind.js');
const indexPath = path.join(root, 'src', 'index.html');

if (!fs.existsSync(serverPath)) throw new Error('Липсва server-roadmind.js');
if (!fs.existsSync(indexPath)) throw new Error('Липсва src/index.html');

let server = fs.readFileSync(serverPath, 'utf8');
let index = fs.readFileSync(indexPath, 'utf8');
let serverChanged = false;
let indexChanged = false;

function replaceServerOnce(find, replacement, errorMessage) {
  if (server.includes(replacement)) return;
  if (!server.includes(find)) throw new Error(errorMessage);
  server = server.replace(find, replacement);
  serverChanged = true;
}

replaceServerOnce(
  'const nodemailer = require("nodemailer");',
  'const nodemailer = require("nodemailer");\nconst { MODE_CONFIG, selectQuestions } = require("./lib/quiz-engine");',
  'Не е намерен nodemailer import.'
);

replaceServerOnce(
  'const authScriptPath = path.join(__dirname, "src", "roadmind-auth.js");',
  'const authScriptPath = path.join(__dirname, "src", "roadmind-auth.js");\nconst smartQuizScriptPath = path.join(__dirname, "src", "roadmind-smart-quiz.js");',
  'Не е намерен authScriptPath.'
);

replaceServerOnce(
  'for (const file of [indexPath, resultScriptPath, dashboardScriptPath, authScriptPath]) {',
  'for (const file of [indexPath, resultScriptPath, dashboardScriptPath, authScriptPath, smartQuizScriptPath]) {',
  'Не е намерен списъкът с frontend файлове.'
);

if (!server.includes('async function createSmartQuiz(userId, mode)')) {
  const marker = 'async function loadTestById(testId) {';
  if (!server.includes(marker)) throw new Error('Не е намерен loadTestById marker.');

  const block = `async function loadSmartQuestionBank() {\n  const snapshot = await db.collection("questions").where("category", "==", "B").get();\n  return snapshot.docs\n    .map(doc => ({ id: doc.id, ...doc.data() }))\n    .filter(question => question.active !== false)\n    .filter(question => question.usableForQuiz !== false);\n}\n\nasync function createSmartQuiz(userId, mode) {\n  const normalizedMode = Object.prototype.hasOwnProperty.call(MODE_CONFIG, mode) ? mode : "quick";\n  const config = MODE_CONFIG[normalizedMode];\n  const [questionBank, results] = await Promise.all([\n    loadSmartQuestionBank(),\n    loadUserResults(userId)\n  ]);\n\n  const selection = selectQuestions(questionBank, results, normalizedMode);\n  if (!selection.ok) {\n    const error = fail(409, \`Няма достатъчно уникални въпроси за режим „\${config.title}“.\`);\n    error.available = selection.available;\n    error.required = selection.required;\n    throw error;\n  }\n\n  const suffix = crypto.randomBytes(3).toString("hex");\n  const testId = \`gen_\${String(userId).slice(0, 8)}_\${Date.now()}_\${suffix}\`;\n  const questionIds = selection.questions.map(question => String(question.id));\n  const publicTest = {\n    title: config.title,\n    mode: normalizedMode,\n    category: "B",\n    generated: true,\n    userId,\n    questionIds\n  };\n\n  await db.collection("tests").doc(testId).set({\n    ...publicTest,\n    createdAt: FieldValue.serverTimestamp()\n  });\n\n  return {\n    test: { id: testId, ...publicTest },\n    questions: selection.questions,\n    meta: {\n      mode: normalizedMode,\n      requested: config.count,\n      available: selection.available,\n      adaptive: normalizedMode !== "exam",\n      generatedAt: new Date().toISOString()\n    }\n  };\n}\n\n`;

  server = server.replace(marker, block + marker);
  serverChanged = true;
}

if (!server.includes('url.pathname === "/api/quiz"')) {
  const marker = '    if (req.method === "GET" && url.pathname === "/api/demo-test") {';
  if (!server.includes(marker)) throw new Error('Не е намерен /api/demo-test route marker.');

  const route = `    if (req.method === "GET" && url.pathname === "/api/quiz") {\n      const user = await requireUser(req);\n      const mode = String(url.searchParams.get("mode") || "quick");\n      if (!Object.prototype.hasOwnProperty.call(MODE_CONFIG, mode)) {\n        throw fail(400, "Невалиден режим на тест.");\n      }\n      sendJson(res, 200, await createSmartQuiz(user.uid, mode));\n      return;\n    }\n\n`;

  server = server.replace(marker, route + marker);
  serverChanged = true;
}

if (!server.includes('url.pathname === "/roadmind-smart-quiz.js"')) {
  const marker = '    if (req.method === "GET" && url.pathname === "/roadmind-results.js") {';
  if (!server.includes(marker)) throw new Error('Не е намерен roadmind-results route marker.');

  const route = `    if (req.method === "GET" && url.pathname === "/roadmind-smart-quiz.js") {\n      serveScript(res, smartQuizScriptPath);\n      return;\n    }\n\n`;

  server = server.replace(marker, route + marker);
  serverChanged = true;
}

const oldInjection = '<script src="/roadmind-auth.js"></script>\\n<script src="/roadmind-results.js"></script>\\n<script src="/roadmind-dashboard.js"></script>\\n</body>';
const newInjection = '<script src="/roadmind-auth.js"></script>\\n<script src="/roadmind-smart-quiz.js"></script>\\n<script src="/roadmind-results.js"></script>\\n<script src="/roadmind-dashboard.js"></script>\\n</body>';
if (!server.includes('/roadmind-smart-quiz.js</script>')) {
  if (!server.includes(oldInjection)) throw new Error('Не е намерен HTML script injection block.');
  server = server.replace(oldInjection, newInjection);
  serverChanged = true;
}

const oldErrorBlock = `    sendJson(res, Number(error.status || 500), {\n      ok: false,\n      error: error.message || "Internal server error"\n    });`;
const newErrorBlock = `    const errorPayload = {\n      ok: false,\n      error: error.message || "Internal server error"\n    };\n    if (Number.isFinite(error.available)) errorPayload.available = error.available;\n    if (Number.isFinite(error.required)) errorPayload.required = error.required;\n    sendJson(res, Number(error.status || 500), errorPayload);`;
if (!server.includes('errorPayload.available')) {
  if (!server.includes(oldErrorBlock)) throw new Error('Не е намерен server error response block.');
  server = server.replace(oldErrorBlock, newErrorBlock);
  serverChanged = true;
}

const quickOption = `<div class="test-opt" onclick="startLoading('20 въпроса', 'quick')"><div><div class="t">Бърз тест</div><div class="s">20 въпроса · ~10 мин</div></div><span>→</span></div>`;
const shortOption = `<div class="test-opt" onclick="startLoading('10 въпроса', 'demo')"><div><div class="t">Кратък тест</div><div class="s">10 въпроса · бърза тренировка</div></div><span>→</span></div>`;
if (!index.includes("startLoading('10 въпроса', 'demo')")) {
  if (!index.includes(quickOption)) throw new Error('Не е намерен quick test option в index.html.');
  index = index.replace(quickOption, shortOption + '\n        ' + quickOption);
  indexChanged = true;
}

if (serverChanged) fs.writeFileSync(serverPath, server, 'utf8');
if (indexChanged) fs.writeFileSync(indexPath, index, 'utf8');

console.log('');
console.log('RoadMind Smart Quiz v1');
console.log('----------------------');
console.log(serverChanged ? 'server-roadmind.js: updated' : 'server-roadmind.js: already ready');
console.log(indexChanged ? 'src/index.html: updated' : 'src/index.html: already ready');
console.log('Done.');
