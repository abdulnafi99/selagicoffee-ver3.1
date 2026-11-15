# Selagi Coffee — Cloud Functions

## Fungsi
| Fungsi | Bila jalan | Hantar kepada |
|---|---|---|
| `pushPromotion` | Admin tambah `promotions/{id}` | Semua pelanggan |
| `pushInfoTerkini` | Admin tambah `infoTerkini/{id}` | Semua pelanggan |
| `pushRedeemItem` | Admin tambah `redeemItems/{id}` | Semua pelanggan |
| `pushBroadcast` | Admin tambah `broadcasts/{id}` | Semua, atau seorang jika ada `phone` |
| `pushPointsAdded` | `customers/{phone}/points` bertambah | Pelanggan itu (semua peranti) |
| `pushStampReward` | Ganjaran cap ke-5 / ke-10 dibuka | Pelanggan itu |
| `pushBirthday` | Setiap hari 9:00 pagi (waktu Malaysia) | Pelanggan yang hari lahir hari ini |
| `adminResetPassword` | Dipanggil dari panel admin | — |

## Deploy (sekali sahaja)
Perlukan pelan **Blaze** di Firebase.
```bash
npm i -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only database,functions
```
Kali pertama, CLI akan tanya **APP_URL** — masukkan alamat penuh app anda (https), contoh `https://selagicoffee.web.app/`.
Ia disimpan dalam `functions/.env.upgradeui`. Untuk tukar nanti, edit fail itu dan deploy semula.

## Hantar mesej sendiri (broadcast)
Tambah rekod baru di `broadcasts` (Console → Realtime Database → Data, atau dari panel admin):
```json
{ "title": "📣 Hari Ini Sahaja", "body": "Diskaun 20% semua minuman!", "timestamp": "2026-11-15T09:00:00.000Z" }
```
Tambah `"phone": "0123456789"` untuk hantar kepada seorang pelanggan sahaja.
Selepas dihantar, rekod itu dikemas kini dengan `sentAt`, `sentCount` dan `failedCount`.

## Semak log
```bash
firebase functions:log
```
Token peranti yang sudah tidak sah dibuang secara automatik dari `pushTokens`.
