// ============================================================
// firebase-messaging-sw.js
// WAJIB di root folder — SAMA TEMPAT dengan index.html
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBeg1YlG6KSxTxxaZa_Lsa6JEf90xK3gUg",
    authDomain: "upgradeui.firebaseapp.com",
    databaseURL: "https://upgradeui-default-rtdb.firebaseio.com",
    projectId: "upgradeui",
    storageBucket: "upgradeui.firebasestorage.app",
    messagingSenderId: "668987120251",
    appId: "1:668987120251:web:2f7c4a59d5b74f315620de"
});

const messaging = firebase.messaging();

const ICON_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQKNTcswI0MKvgwch0V6Lal3qR08ozQYkBACiB7xYPitnVeS5yWka1j3Zg&s=10';

// ============================================================
// NOTIFIKASI BACKGROUND (bila app TERTUTUP / di belakang)
// ============================================================
messaging.onBackgroundMessage((payload) => {
    console.log('📩 [SW] Background message diterima:', payload);

    // ⚠️ PENTING: Jika payload ada "notification", Firebase SDK sudah
    // auto-paparkan notifikasi. Kita SKIP supaya tak duplicate.
    if (payload.notification) {
        console.log('ℹ️ [SW] Payload ada "notification" — biar SDK handle sendiri');
        return;
    }

    // Handle DATA-ONLY payload (paling reliable bila app closed)
    const data  = payload.data || {};
    const title = data.title || 'Selagi Coffee';
    const body  = data.body  || 'Ada info baru dari Selagi Coffee ☕';

    const notifOptions = {
        body: body,
        icon: ICON_URL,
        badge: ICON_URL,
        tag: data.tag || ('selagi-' + Date.now()),
        renotify: true,
        requireInteraction: false,
        data: {
            url: data.url || self.location.origin
        }
    };

    // ✅ WAJIB: event.waitUntil supaya SW tak mati sebelum notif dipaparkan
    return self.registration.showNotification(title, notifOptions);
});

// ============================================================
// BILA USER KLIK NOTIFIKASI — buka / fokus app
// ============================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) ||
                      self.location.origin;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Kalau ada tab app dah terbuka — fokus pada tab tu
            for (const client of clientList) {
                if ('focus' in client) {
                    client.focus();
                    if ('navigate' in client) client.navigate(targetUrl);
                    return;
                }
            }
            // Kalau tak, buka tab baru
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// ============================================================
// ACTIVATE & INSTALL
// ============================================================
self.addEventListener('activate', (event) => {
    console.log('✅ [SW] firebase-messaging-sw.js aktif');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('install', (event) => {
    console.log('📦 [SW] firebase-messaging-sw.js dipasang');
    self.skipWaiting();
});
