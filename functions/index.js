/**
 * Selagi Coffee — admin password reset with a temporary password.
 *
 * Browsers can only change the *signed-in* user's own password, so setting a
 * password for another customer must happen here with the Admin SDK.
 *
 * Admin panel usage (signed in as admin@selagicoffee.app):
 *   import { getFunctions, httpsCallable } from ".../firebase-functions.js";
 *   const fn = httpsCallable(getFunctions(app, "asia-southeast1"), "adminResetPassword");
 *   const { data } = await fn({ phone: "0123456789", newPassword: "kopi1234" }); // newPassword optional
 *   // without newPassword a random temporary one is returned in data.tempPassword
 *   // and the customer must change it after logging in
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const ADMIN_EMAIL = "admin@selagicoffee.app";
const EMAIL_DOMAIN = "selagicoffee.app";
// No look-alike characters (0/O, 1/I/L) so it is easy to read out at the counter.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeTempPassword(len = 8) {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

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
