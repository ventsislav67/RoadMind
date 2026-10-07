require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 3000);

const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT;

const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET;

if(!serviceAccountPath){
    throw new Error(
        "Липсва FIREBASE_SERVICE_ACCOUNT в .env"
    );
}

if(!fs.existsSync(serviceAccountPath)){
    throw new Error(
        "Firebase service account файлът не е намерен: " +
        serviceAccountPath
    );
}

if(!bucketName){
    throw new Error(
        "Липсва FIREBASE_STORAGE_BUCKET в .env"
    );
}

const serviceAccount = JSON.parse(
    fs.readFileSync(
        serviceAccountPath,
        "utf8"
    )
);

admin.initializeApp({
    credential:
        admin.credential.cert(
            serviceAccount
        ),
    storageBucket: bucketName
});

const db =
    admin.firestore();

const bucket =
    admin.storage().bucket();

const indexPath =
    path.join(
        __dirname,
        "src",
        "index.html"
    );

if(!fs.existsSync(indexPath)){
    throw new Error(
        "Липсва src/index.html"
    );
}

function sendJson(
    res,
    status,
    data
){
    const body =
        JSON.stringify(data);

    res.writeHead(
        status,
        {
            "Content-Type":
                "application/json; charset=utf-8",
            "Cache-Control":
                "no-store"
        }
    );

    res.end(body);
}

function sendText(
    res,
    status,
    body,
    contentType
){
    res.writeHead(
        status,
        {
            "Content-Type":
                contentType,
            "Cache-Control":
                "no-store"
        }
    );

    res.end(body);
}

function isSafeId(value){
    return /^[a-zA-Z0-9_-]+$/.test(value);
}

async function loadDemoTest(){
    const testRef =
        db
            .collection("tests")
            .doc("demo_test_001");

    const testSnap =
        await testRef.get();

    if(!testSnap.exists){
        throw new Error(
            "tests/demo_test_001 не съществува."
        );
    }

    const test = {
        id: testSnap.id,
        ...testSnap.data()
    };

    const questionIds =
        Array.isArray(test.questionIds)
            ? test.questionIds
            : [];

    if(questionIds.length === 0){
        throw new Error(
            "Демо тестът няма questionIds."
        );
    }

    const refs =
        questionIds.map(id =>
            db
                .collection("questions")
                .doc(String(id))
        );

    const snapshots =
        await db.getAll(...refs);

    const questions = [];

    for(
        let i = 0;
        i < snapshots.length;
        i++
    ){
        const snap =
            snapshots[i];

        if(!snap.exists){
            throw new Error(
                "Липсва question: " +
                questionIds[i]
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

async function loadImage(
    res,
    imageId
){
    if(!isSafeId(imageId)){
        sendText(
            res,
            400,
            "Невалиден imageId.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const imageSnap =
        await db
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

    const image =
        imageSnap.data();

    if(!image.storagePath){
        sendText(
            res,
            500,
            "Липсва storagePath.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const file =
        bucket.file(
            image.storagePath
        );

    const [exists] =
        await file.exists();

    if(!exists){
        sendText(
            res,
            404,
            "Файлът не съществува във Firebase Storage.",
            "text/plain; charset=utf-8"
        );
        return;
    }

    const [buffer] =
        await file.download();

    const extension =
        path
            .extname(
                image.storagePath
            )
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

    res.writeHead(
        200,
        {
            "Content-Type":
                contentType,
            "Cache-Control":
                "public, max-age=3600",
            "Content-Length":
                buffer.length
        }
    );

    res.end(buffer);
}

const server =
    http.createServer(
        async (req, res) => {
            try{
                const url =
                    new URL(
                        req.url,
                        "http://" +
                        (req.headers.host ||
                            "localhost")
                    );

                if(
                    req.method === "GET" &&
                    url.pathname === "/api/health"
                ){
                    sendJson(
                        res,
                        200,
                        {
                            ok: true,
                            service: "RoadMind",
                            firestore: true
                        }
                    );

                    return;
                }

                if(
                    req.method === "GET" &&
                    url.pathname === "/api/demo-test"
                ){
                    const data =
                        await loadDemoTest();

                    sendJson(
                        res,
                        200,
                        data
                    );

                    return;
                }

                if(
                    req.method === "GET" &&
                    url.pathname.startsWith(
                        "/api/images/"
                    )
                ){
                    const imageId =
                        decodeURIComponent(
                            url.pathname.substring(
                                "/api/images/"
                                    .length
                            )
                        );

                    await loadImage(
                        res,
                        imageId
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
                    const html =
                        fs.readFileSync(
                            indexPath,
                            "utf8"
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

                sendJson(
                    res,
                    500,
                    {
                        ok: false,
                        error:
                            error.message ||
                            "Internal server error"
                    }
                );
            }
        }
    );

server.listen(
    PORT,
    () => {
        console.log("");
        console.log(
            "================================="
        );
        console.log(
            "RoadMind REAL DEMO"
        );
        console.log(
            "================================="
        );
        console.log(
            "http://localhost:" +
            PORT
        );
        console.log("");
        console.log(
            "GET /api/health"
        );
        console.log(
            "GET /api/demo-test"
        );
        console.log(
            "GET /api/images/:imageId"
        );
        console.log("");
    }
);

async function shutdown(){
    try{
        await admin
            .app()
            .delete();
    }finally{
        process.exit(0);
    }
}

process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);
