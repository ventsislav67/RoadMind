# RoadMind — Firebase структура

## Firestore

Началната версия използва:

- `users`
- `topics`
- `questions`
- `tests`
- `results`
- `images`

## Връзка между въпрос и изображение

Въпросът пази `imageId`, а `images` пази информацията за файла.

~~~text
questions/q_sign_b1
        │
        └── imageId: sign_b1
                    │
                    ▼
              images/sign_b1
                    │
                    └── storagePath: images/road-signs/B1.svg
~~~

Самият файл се съхранява във Firebase Storage.

## Локална подготовка

1. Инсталирай зависимостите: `npm install`
2. Създай Firebase service account.
3. Запази JSON файла извън GitHub.
4. Копирай `.env.example` като `.env`.
5. Попълни `FIREBASE_SERVICE_ACCOUNT` и `FIREBASE_STORAGE_BUCKET`.

## Команди

~~~bash
node scripts/generate-sign-images.js
node scripts/upload-images.js
node scripts/seed-firestore.js
~~~

Никога не качвай service account JSON файла в GitHub.