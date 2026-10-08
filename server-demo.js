require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3000);

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

if(!serviceAccountPath){
    throw new Error("Липсва FIREBASE_SERVICE_ACCOUNT в .env");
}

if(!fs.existsSync(serviceAccountPath)){
    throw new Error(
        "Firebase service account файлът не е намерен: " +
        serviceAccountPath
    );
}

if(!bucketName){
    throw new Error("Липсва FIREBASE_STORAGE_BUCKET в .env");
}

const serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: bucketName
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const indexPath = path.join(
    __dirname,
    "src",
    "index.html"
);

const resultScriptPath = path.join(
    __dirname,
    "src",
    "roadmind-results.js"
);

const dashboardScriptPath = path.join(
    __dirname,
    "src",
    "roadmind-dashboard.js"
);

if(!fs.existsSync(indexPath)){
    throw new Error("Липсва src/index.html");
}

if(!fs.existsSync(resultScriptPath)){
    throw new Error("Липсва src/roadmind-results.js");
}

if(!fs.existsSync(dashboardScriptPath)){
    throw new Error("Липсва src/roadmind-dashboard.js");
}

function sendJson(res, status, data){
    const body = JSON.stringify(data);

    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(body);
}

function sendText(res, status, body, contentType){
    res.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
    });

    res.end(body);
}

function isSafeId(value){
    return /^[a-zA-Z0-9_-]+$/.test(value);
}

async function readJsonBody(req){
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;

        req.on("data", chunk => {
            size += chunk.length;

            if(size > 100000){
                reject(new Error("Request body is too large."));
                req.destroy();
                return;
            }

            body += chunk.toString("utf8");
        });

        req.on("end", () => {
            try{
                resolve(body ? JSON.parse(body) : {});
            }catch(error){
                reject(new Error("Невалиден JSON body."));
            }
        });

        req.on("error", reject);
    });
}

async function loadTestById(testId){
    const testSnap = await db
        .collection("tests")
        .doc(String(testId))
        .get();

    if(!testSnap.exists){
        throw new Error(
            "Тестът не съществува: " + testId
        );
    }

    return {
        id: testSnap.id,
        ...testSnap.data()
    };
}

async function loadDemoTest(){
    const test = await loadTestById("demo_test_001");

    const questionIds = Array.isArray(test.questionIds)
        ? test.questionIds
        : [];

    if(questionIds.length === 0){
        throw new Error("Демо тестът няма questionIds.");
    }

    const refs = questionIds.map(id =>
        db
            .collection("questions")
            .doc(String(id))
    );

    const snapshots = await db.getAll(...refs);
    const questions = [];

    for(let i = 0; i < snapshots.length; i++){
        const snap = snapshots[i];

        if(!snap.exists){
            throw new Error(
                "Липсва question: " + questionIds[i]
            );
        }

        questions.push({
            id: snap.id,
            ...snap.data()
        });
    }

    return {
        test,
        questions
    };
}

async function loadImage(res, imageId){
    if(!isSafeId(imageId)){
        sendText(
            res,
            400,
            "Невалиден imageId.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const imageSnap = await db
        .collection("images")
        .doc(imageId)
        .get();

    if(!imageSnap.exists){
        sendText(
            res,
            404,
            "Изображението не е намерено.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const image = imageSnap.data();

    if(!image.storagePath){
        sendText(
            res,
            500,
            "Липсва storagePath.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const file = bucket.file(image.storagePath);
    const [exists] = await file.exists();

    if(!exists){
        sendText(
            res,
            404,
            "Файлът не съществува във Firebase Storage.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const [buffer] = await file.download();

    const extension = path
        .extname(image.storagePath)
        .toLowerCase();

    const contentTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".svg": "image/svg+xml"
    };

    const contentType =
        contentTypes[extension] ||
        "application/octet-stream";

    res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Content-Length": buffer.length
    });

    res.end(buffer);
}

function clampTimeMs(value){
    const n = Number(value);

    if(!Number.isFinite(n) || n < 0){
        return 0;
    }

    return Math.min(
        Math.round(n),
        30 * 60 * 1000
    );
}

async function saveResult(payload){
    const testId = String(
        payload.testId || "demo_test_001"
    );

    const test = await loadTestById(testId);

    const allowedQuestionIds = new Set(
        Array.isArray(test.questionIds)
            ? test.questionIds.map(String)
            : []
    );

    const submittedAnswers = Array.isArray(payload.answers)
        ? payload.answers
        : [];

    if(submittedAnswers.length === 0){
        throw new Error("Липсват отговори за запис.");
    }

    const safeAnswers = submittedAnswers
        .filter(answer =>
            answer &&
            allowedQuestionIds.has(
                String(answer.questionId)
            )
        )
        .map(answer => ({
            questionId: String(answer.questionId),
            selectedAnswer: Number(answer.selectedAnswer),
            timeMs: clampTimeMs(answer.timeMs)
        }));

    if(safeAnswers.length === 0){
        throw new Error(
            "Няма валидни отговори за този тест."
        );
    }

    const refs = safeAnswers.map(answer =>
        db
            .collection("questions")
            .doc(answer.questionId)
    );

    const snapshots = await db.getAll(...refs);

    const answerResults = [];
    const topicResults = {};
    let correct = 0;
    let answeredTimeMs = 0;

    for(let i = 0; i < snapshots.length; i++){
        const snap = snapshots[i];
        const submitted = safeAnswers[i];

        if(!snap.exists){
            throw new Error(
                "Липсва question: " +
                submitted.questionId
            );
        }

        const question = snap.data();
        const correctAnswer = Number(question.correctAnswer);
        const isCorrect = submitted.selectedAnswer === correctAnswer;

        if(isCorrect){
            correct++;
        }

        answeredTimeMs += submitted.timeMs;

        const topicIds = Array.isArray(question.topicIds)
            ? question.topicIds.map(String)
            : [];

        for(const topicId of topicIds){
            if(!topicResults[topicId]){
                topicResults[topicId] = {
                    correct: 0,
                    wrong: 0,
                    total: 0,
                    percentage: 0
                };
            }

            topicResults[topicId].total++;

            if(isCorrect){
                topicResults[topicId].correct++;
            }else{
                topicResults[topicId].wrong++;
            }
        }

        answerResults.push({
            questionId: submitted.questionId,
            selectedAnswer: submitted.selectedAnswer,
            correctAnswer,
            isCorrect,
            timeMs: submitted.timeMs,
            topicIds,
            lawRuleIds: Array.isArray(question.lawRuleIds)
                ? question.lawRuleIds
                : []
        });
    }

    for(const value of Object.values(topicResults)){
        value.percentage = value.total
            ? Math.round(
                (value.correct / value.total) * 100
            )
            : 0;
    }

    const total = answerResults.length;
    const wrong = total - correct;
    const percentage = total
        ? Math.round((correct / total) * 100)
        : 0;

    const averageTimeMs = total
        ? Math.round(answeredTimeMs / total)
        : 0;

    const durationMs = clampTimeMs(
        payload.durationMs
    );

    const resultData = {
        userId: "demo_user",
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

    const resultRef = await db
        .collection("results")
        .add(resultData);

    return {
        id: resultRef.id,
        userId: "demo_user",
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
        answers: answerResults
    };
}

function timestampToMillis(value){
    if(!value){
        return 0;
    }

    if(typeof value.toMillis === "function"){
        return value.toMillis();
    }

    if(Number.isFinite(value._seconds)){
        return value._seconds * 1000;
    }

    const date = new Date(value);
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function timestampToIso(value){
    const ms = timestampToMillis(value);
    return ms ? new Date(ms).toISOString() : null;
}

async function loadUserResults(userId){
    if(!isSafeId(userId)){
        throw new Error("Невалиден userId.");
    }

    const snapshot = await db
        .collection("results")
        .where("userId", "==", userId)
        .get();

    const rows = snapshot.docs.map(doc => {
        const data = doc.data();

        return {
            id: doc.id,
            ...data,
            _createdMs: timestampToMillis(data.createdAt)
        };
    });

    rows.sort((a, b) => b._createdMs - a._createdMs);
    return rows;
}

function buildDashboard(results){
    const totalAttempts = results.length;

    const allPercentages = results
        .map(result => Number(result.percentage || 0))
        .filter(Number.isFinite);

    const averagePercentage = allPercentages.length
        ? Math.round(
            allPercentages.reduce((sum, value) => sum + value, 0) /
            allPercentages.length
        )
        : 0;

    const bestPercentage = allPercentages.length
        ? Math.max(...allPercentages)
        : 0;

    const recentForReady = results.slice(0, 10);

    const readyScore = recentForReady.length
        ? Math.round(
            recentForReady.reduce(
                (sum, result) => sum + Number(result.percentage || 0),
                0
            ) / recentForReady.length
        )
        : 0;

    const answerTimes = [];

    for(const result of results){
        const answers = Array.isArray(result.answers)
            ? result.answers
            : [];

        for(const answer of answers){
            const timeMs = Number(answer.timeMs || 0);
            if(Number.isFinite(timeMs) && timeMs > 0){
                answerTimes.push(timeMs);
            }
        }
    }

    const averageAnswerTimeMs = answerTimes.length
        ? Math.round(
            answerTimes.reduce((sum, value) => sum + value, 0) /
            answerTimes.length
        )
        : 0;

    const topicTotals = {};

    for(const result of results){
        const topicResults = result.topicResults &&
            typeof result.topicResults === "object"
                ? result.topicResults
                : {};

        for(const [topicId, value] of Object.entries(topicResults)){
            if(!topicTotals[topicId]){
                topicTotals[topicId] = {
                    correct: 0,
                    wrong: 0,
                    total: 0,
                    percentage: 0
                };
            }

            topicTotals[topicId].correct += Number(value.correct || 0);
            topicTotals[topicId].wrong += Number(value.wrong || 0);
            topicTotals[topicId].total += Number(value.total || 0);
        }
    }

    for(const value of Object.values(topicTotals)){
        value.percentage = value.total
            ? Math.round((value.correct / value.total) * 100)
            : 0;
    }

    const weakTopics = Object.entries(topicTotals)
        .filter(([, value]) => value.total > 0)
        .map(([topicId, value]) => ({
            topicId,
            ...value
        }))
        .sort((a, b) => {
            if(a.percentage !== b.percentage){
                return a.percentage - b.percentage;
            }
            return b.total - a.total;
        })
        .slice(0, 4);

    const history = results.slice(0, 5).map(result => ({
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

    const progression = results
        .slice(0, 8)
        .reverse()
        .map(result => ({
            id: result.id,
            percentage: Number(result.percentage || 0),
            createdAt: timestampToIso(result.createdAt)
        }));

    const latest = results[0]
        ? {
            id: results[0].id,
            percentage: Number(results[0].percentage || 0),
            correct: Number(results[0].correct || 0),
            total: Number(results[0].total || 0),
            createdAt: timestampToIso(results[0].createdAt)
        }
        : null;

    return {
        userId: "demo_user",
        readyScore,
        totalAttempts,
        averagePercentage,
        bestPercentage,
        averageAnswerTimeMs,
        weakTopics,
        history,
        progression,
        latest
    };
}

async function loadDashboard(userId){
    const results = await loadUserResults(userId);
    const dashboard = buildDashboard(results);
    dashboard.userId = userId;
    return dashboard;
}

const server = http.createServer(
    async (req, res) => {
        try{
            const url = new URL(
                req.url,
                "http://" +
                    (req.headers.host || "localhost")
            );

            if(
                req.method === "GET" &&
                url.pathname === "/api/health"
            ){
                sendJson(res, 200, {
                    ok: true,
                    service: "RoadMind",
                    firestore: true
                });
                return;
            }

            if(
                req.method === "GET" &&
                url.pathname === "/api/demo-test"
            ){
                const data = await loadDemoTest();

                sendJson(res, 200, data);
                return;
            }

            if(
                req.method === "POST" &&
                url.pathname === "/api/results"
            ){
                const payload = await readJsonBody(req);
                const result = await saveResult(payload);

                sendJson(res, 201, {
                    ok: true,
                    result
                });
                return;
            }

            if(
                req.method === "GET" &&
                url.pathname === "/api/dashboard"
            ){
                const userId = String(
                    url.searchParams.get("userId") || "demo_user"
                );

                const dashboard = await loadDashboard(userId);
                sendJson(res, 200, dashboard);
                return;
            }

            if(
                req.method === "GET" &&
                url.pathname.startsWith("/api/images/")
            ){
                const imageId = decodeURIComponent(
                    url.pathname.substring(
                        "/api/images/".length
                    )
                );

                await loadImage(res, imageId);
                return;
            }

            if(
                req.method === "GET" &&
                url.pathname === "/roadmind-results.js"
            ){
                const script = fs.readFileSync(
                    resultScriptPath,
                    "utf8"
                );

                sendText(
                    res,
                    200,
                    script,
                    "application/javascript; charset=utf-8"
                );
                return;
            }

            if(
                req.method === "GET" &&
                url.pathname === "/roadmind-dashboard.js"
            ){
                const script = fs.readFileSync(
                    dashboardScriptPath,
                    "utf8"
                );

                sendText(
                    res,
                    200,
                    script,
                    "application/javascript; charset=utf-8"
                );
                return;
            }

            if(
                req.method === "GET" &&
                (
                    url.pathname === "/" ||
                    url.pathname === "/index.html"
                )
            ){
                let html = fs.readFileSync(
                    indexPath,
                    "utf8"
                );

                html = html.replace(
                    "</body>",
                    '<script src="/roadmind-results.js"></script>\n' +
                    '<script src="/roadmind-dashboard.js"></script>\n' +
                    '</body>'
                );

                sendText(
                    res,
                    200,
                    html,
                    "text/html; charset=utf-8"
                );
                return;
            }

            sendText(
                res,
                404,
                "Not found",
                "text/plain; charset=utf-8"
            );
        }catch(error){
            console.error(
                "Request error:",
                error
            );

            sendJson(res, 500, {
                ok: false,
                error:
                    error.message ||
                    "Internal server error"
            });
        }
    }
);

server.listen(PORT, () => {
    console.log("");
    console.log("=================================");
    console.log("RoadMind REAL DEMO");
    console.log("=================================");
    console.log("http://localhost:" + PORT);
    console.log("");
    console.log("GET  /api/health");
    console.log("GET  /api/demo-test");
    console.log("GET  /api/dashboard?userId=demo_user");
    console.log("GET  /api/images/:imageId");
    console.log("POST /api/results");
    console.log("");
});

async function shutdown(){
    try{
        await admin.app().delete();
    }finally{
        process.exit(0);
    }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
