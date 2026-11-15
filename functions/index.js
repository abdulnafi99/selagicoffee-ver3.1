/**
 * Selagi Coffee — Cloud Functions
 *
 *  1. adminResetPassword   (callable, admin only)  — temporary / admin-chosen password
 *  2. Automatic push notifications (FCM), sent even when the app is closed:
 *       pushPromotion      promotions/{id} created        → all customers
 *       pushInfoTerkini    infoTerkini/{id} created       → all customers
 *       pushRedeemItem     redeemItems/{id} created       → all customers
 *       pushBroadcast      broadcasts/{id} created        → all, or one customer if `phone` is set
 *       pushPointsAdded    customers/{phone}/points up    → that customer (all their devices)
 *       pushStampReward    customers/{phone}/stampClaims/{id} created → that customer
 *       pushBirthday       every day 09:00 Malaysia time  → customers whose birthday is today
 *
 * Deploy:  firebase deploy --only functions
 * The first deploy asks for APP_URL (your app's full https address, e.g. https://selagicoffee.web.app/).
 * It is saved in functions/.env.<project> and used for the notification icon and click link.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const ADMIN_EMAIL = "admin@selagicoffee.app";
const EMAIL_DOMAIN = "selagicoffee.app";
const TIME_ZONE = "Asia/Kuala_Lumpur";
// Realtime Database triggers must run in the database's region (…firebaseio.com = us-central1).
const DB_REGION = "us-central1";

const APP_URL = defineString("APP_URL", {
  description: "Alamat penuh app (HTTPS) untuk ikon & pautan notifikasi, cth: https://selagicoffee.web.app/",
});

/* ============================================================
   1. ADMIN PASSWORD RESET
   ============================================================ */
// No look-alike characters (0/O, 1/I/L) so it is easy to read out at the counter.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeTempPassword(len = 8) {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/**
 * Admin panel usage (signed in as admin@selagicoffee.app):
 *   const fn = httpsCallable(getFunctions(app, "asia-southeast1"), "adminResetPassword");
 *   const { data } = await fn({ phone: "0123456789", newPassword: "kopi1234" }); // newPassword optional
 *   // without newPassword a random temporary one is returned in data.tempPassword
 *   // and the customer must change it after logging in
 */
exports.adminResetPassword = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth || request.auth.token.email !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Hanya admin boleh reset kata laluan.");
  }

  const phone = String((request.data && request.data.phone) || "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(phone)) {
    throw new HttpsError("invalid-argument", "Nombor telefon tidak sah (10-11 digit).");
  }

  const db = admin.database();
  const customerSnap = await db.ref(`customers/${phone}`).get();
  if (!customerSnap.exists()) {
    throw new HttpsError("not-found", "Pelanggan tidak wujud dalam sistem.");
  }

  const chosen = request.data && typeof request.data.newPassword === "string" ? request.data.newPassword.trim() : "";
  if (chosen && chosen.length < 6) {
    throw new HttpsError("invalid-argument", "Kata laluan baharu perlu sekurang-kurangnya 6 aksara.");
  }
  const email = `${phone}@${EMAIL_DOMAIN}`;
  const tempPassword = chosen || makeTempPassword();
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    // displayName must stay the phone number: the app uses it to find the customer record.
    await admin.auth().updateUser(user.uid, { password: tempPassword, displayName: phone });
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await admin.auth().createUser({ email, password: tempPassword, displayName: phone });
  }
  // Sign the customer out of every device that used the old password.
  await admin.auth().revokeRefreshTokens(user.uid);

  const now = new Date().toISOString();
  const updates = {
    // Admin-chosen password: no forced change. Random temporary one: customer must change it.
    [`customers/${phone}/mustChangePassword`]: chosen ? null : true,
    [`customers/${phone}/tempPasswordSetAt`]: chosen ? null : now,
    [`customers/${phone}/password`]: null, // remove any legacy plaintext password
  };

  // Close this customer's pending reset requests.
  const pending = await db.ref("passwordResetRequests").orderByChild("phone").equalTo(phone).get();
  pending.forEach((s) => {
    if ((s.val() || {}).status === "pending") {
      updates[`passwordResetRequests/${s.key}/status`] = "done";
      updates[`passwordResetRequests/${s.key}/resolvedAt`] = now;
    }
  });

  const logKey = db.ref("passwordResetLogs").push().key;
  updates[`passwordResetLogs/${logKey}`] = {
    phone,
    name: (customerSnap.val() || {}).name || "",
    resetBy: request.auth.token.email,
    resetAt: now,
    mode: chosen ? "admin-set" : "temporary",
    // The temporary password itself is never stored.
  };

  await db.ref().update(updates);
  return { phone, tempPassword, mustChange: !chosen };
});

/* ============================================================
   2. PUSH NOTIFICATIONS
   ============================================================ */
function appUrl() {
  let u = "";
  try { u = String(APP_URL.value() || "").trim(); } catch (e) { u = ""; }
  if (!/^https:\/\//i.test(u)) return "";
  return u.endsWith("/") ? u : u + "/";
}

function clip(text, max = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Drop undefined/empty fields — FCM rejects them. */
function clean(obj) {
  if (Array.isArray(obj) || obj === null || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    const c = clean(v);
    if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
    out[k] = c;
  }
  return out;
}

/**
 * Build a web-push message. The `tag` matches the one the app uses for its own
 * in-app alert, so the phone shows a single notification per event.
 */
function buildMessage(tokens, { title, body, tag, path }) {
  const base = appUrl();
  const link = base ? new URL(path || "", base).href : undefined;
  const icon = base ? new URL("icons/icon-192.png", base).href : undefined;
  return clean({
    tokens,
    notification: { title: clip(title, 80), body: clip(body) },
    data: { title: clip(title, 80), body: clip(body), tag: tag || "", url: link || "" },
    webpush: {
      headers: { Urgency: "high", TTL: String(24 * 60 * 60) },
      notification: { icon, badge: icon, tag, renotify: tag ? true : undefined },
      fcmOptions: link ? { link } : undefined,
    },
  });
}

async function allTokens() {
  const snap = await admin.database().ref("pushTokens").get();
  const out = [];
  snap.forEach((s) => {
    const v = s.val() || {};
    out.push(typeof v.token === "string" && v.token ? v.token : s.key);
  });
  return out;
}

/** Every device of one customer: pushTokens with that phone + customers/{phone}/fcmToken. */
async function tokensForPhone(phone) {
  const db = admin.database();
  const [byPhone, latest] = await Promise.all([
    db.ref("pushTokens").orderByChild("phone").equalTo(phone).get(),
    db.ref(`customers/${phone}/fcmToken`).get(),
  ]);
  const out = [];
  byPhone.forEach((s) => { const v = s.val() || {}; out.push(v.token || s.key); });
  if (typeof latest.val() === "string") out.push(latest.val());
  return out;
}

const DEAD_TOKEN = /registration-token-not-registered|invalid-registration-token|invalid-argument/;

async function removeDeadTokens(tokens) {
  if (!tokens.length) return;
  const db = admin.database();
  const updates = {};
  for (const t of tokens) {
    const rec = (await db.ref(`pushTokens/${t}`).get()).val() || {};
    updates[`pushTokens/${t}`] = null;
    if (rec.phone) {
      const cur = (await db.ref(`customers/${rec.phone}/fcmToken`).get()).val();
      if (cur === t) updates[`customers/${rec.phone}/fcmToken`] = null;
    }
  }
  await db.ref().update(updates);
}

/** Send to many tokens (chunks of 500), clean up dead tokens, return counts. */
async function sendPush(tokens, content) {
  const list = [...new Set((tokens || []).filter((t) => typeof t === "string" && t.length > 20 && !/[.#$\[\]\/]/.test(t)))];
  if (!list.length) {
    logger.info("push: no tokens", { tag: content.tag });
    return { sent: 0, failed: 0 };
  }
  let sent = 0, failed = 0;
  const dead = [];
  for (let i = 0; i < list.length; i += 500) {
    const batch = list.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast(buildMessage(batch, content));
    sent += res.successCount;
    failed += res.failureCount;
    res.responses.forEach((r, j) => {
      const code = (r.error && r.error.code) || "";
      if (!r.success && DEAD_TOKEN.test(code)) dead.push(batch[j]);
    });
  }
  await removeDeadTokens(dead);
  logger.info("push sent", { tag: content.tag, sent, failed, removed: dead.length });
  return { sent, failed };
}

/* ---------- Admin content → everyone ---------- */
exports.pushPromotion = onValueCreated({ ref: "/promotions/{id}", region: DB_REGION }, async (event) => {
  const p = event.data.val() || {};
  await sendPush(await allTokens(), {
    title: "🔥 Promosi Baharu!",
    body: p.title ? (p.desc ? `${p.title} — ${p.desc}` : p.title) : "Tawaran khas baru untuk anda!",
    tag: `promo-${event.params.id}`,
  });
});

exports.pushInfoTerkini = onValueCreated({ ref: "/infoTerkini/{id}", region: DB_REGION }, async (event) => {
  const p = event.data.val() || {};
  await sendPush(await allTokens(), {
    title: "📢 Info Terkini",
    body: p.title ? (p.desc ? `${p.title} — ${p.desc}` : p.title) : "Ada info baru dari Selagi Coffee.",
    tag: `info-${event.params.id}`,
  });
});

exports.pushRedeemItem = onValueCreated({ ref: "/redeemItems/{id}", region: DB_REGION }, async (event) => {
  const p = event.data.val() || {};
  await sendPush(await allTokens(), {
    title: "🎁 Item Tebus Baharu!",
    body: `${p.name || "Ganjaran baru"} — hanya ${p.points || 0} PTS`,
    tag: `redeem-${event.params.id}`,
  });
});

/**
 * Admin sends a custom message by writing broadcasts/{id}:
 *   { title: "...", body: "...", timestamp: "<ISO date>", phone: "0123456789" (optional) }
 * Result is written back as sentAt / sentCount / failedCount.
 */
exports.pushBroadcast = onValueCreated({ ref: "/broadcasts/{id}", region: DB_REGION }, async (event) => {
  const b = event.data.val() || {};
  if (b.sentAt) return; // already processed
  const phone = b.phone ? String(b.phone).replace(/\D/g, "") : "";
  const tokens = phone ? await tokensForPhone(phone) : await allTokens();
  const res = await sendPush(tokens, {
    title: b.title || "📣 Selagi Coffee",
    body: b.body || "",
    tag: `bc-${event.params.id}`,
  });
  await event.data.ref.update({ sentAt: new Date().toISOString(), sentCount: res.sent, failedCount: res.failed });
});

/* ---------- Customer events → that customer only ---------- */
exports.pushPointsAdded = onValueUpdated({ ref: "/customers/{phone}/points", region: DB_REGION }, async (event) => {
  const before = Number(event.data.before.val()) || 0;
  const after = Number(event.data.after.val()) || 0;
  if (after <= before) return;
  await sendPush(await tokensForPhone(event.params.phone), {
    title: "⭐ Point Ditambah!",
    body: `+${after - before} PTS — Jumlah terkini anda ${after} PTS. Terima kasih! ☕`,
    tag: `points-${after}`,
  });
});

exports.pushStampReward = onValueCreated({ ref: "/customers/{phone}/stampClaims/{claimId}", region: DB_REGION }, async (event) => {
  const c = event.data.val() || {};
  if (c.status === "claimed") return;
  const reward = c.reward || (Number(c.milestone) === 10 ? "1 Kopi Percuma" : "Diskaun RM3");
  await sendPush(await tokensForPhone(event.params.phone), {
    title: Number(c.milestone) === 10 ? "☕ Kopi Percuma Dibuka!" : "🎁 Ganjaran Cap Dibuka!",
    body: `Cap ke-${c.milestone || ""}: ${reward}. Tuntut di kaunter — staf akan sahkan dengan PIN.`,
    tag: `claim-${event.params.claimId}`,
  });
});

/* ---------- Daily birthday greeting ---------- */
function todayInMalaysia() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
    .reduce((o, p) => (o[p.type] = p.value, o), {});
  return { year: parts.year, monthDay: `${parts.month}-${parts.day}` };
}

exports.pushBirthday = onSchedule({ schedule: "0 9 * * *", timeZone: TIME_ZONE, region: "asia-southeast1" }, async () => {
  const { year, monthDay } = todayInMalaysia();
  const db = admin.database();
  const snap = await db.ref("customers").get();
  const jobs = [];
  snap.forEach((s) => {
    const c = s.val() || {};
    const bd = String(c.birthdate || "");           // stored as YYYY-MM-DD
    if (bd.length < 10 || bd.slice(5, 10) !== monthDay) return;
    if (String(c.lastBirthdayPush || "") === year) return; // once per year
    const phone = s.key;
    const first = String(c.name || "").trim().split(/\s+/)[0];
    jobs.push((async () => {
      await sendPush(await tokensForPhone(phone), {
        title: `🎂 Selamat Hari Lahir${first ? ", " + first : ""}!`,
        body: "Selagi Coffee mendoakan hari yang manis untuk anda. Singgah untuk secawan kopi ☕",
        tag: `bday-${year}`,
      });
      await db.ref(`customers/${phone}/lastBirthdayPush`).set(year);
    })());
  });
  await Promise.all(jobs);
  logger.info("birthday push done", { monthDay, customers: jobs.length });
});

