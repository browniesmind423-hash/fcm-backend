import dotenv from "dotenv";
import { deleteApp } from "firebase/app";
import { ref, get, remove } from "firebase/database";
import admin from "firebase-admin";

dotenv.config();

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

async function cleanup() {
  console.log("🔍 Starte Cleanup...");

  // ============================
  // 1. Daten laden
  // ============================
  const [sessionsSnap, devicesSnap, ordersSnap] = await Promise.all([
    get(ref(db, "sessions")),
    get(ref(db, "devices")),
    get(ref(db, "orders")), // 🔥 wichtig für Zombie Fix
  ]);

  const sessions = sessionsSnap.val() || {};
  const devices = devicesSnap.val() || {};
  const orders = ordersSnap.val() || {};

  const now = Date.now();
  const SIXTY_MINUTES = 60 * 60 * 1000;
  const activeDeviceIds = new Set();

  // ============================
  // 2. Sessions aufräumen
  // ============================
  for (const [id, session] of Object.entries(sessions)) {
    const expired = session.expiresAt && now > session.expiresAt;
    const pickedUpFlag = session.pickedUp === true;
    const isEmptySession = !session.orderId && !session.deviceId;

    // 🔥 Order laden
    const order = session.orderId ? orders[session.orderId] : null;

    // 🔥 NEU: Order ist abgeholt → Session löschen (egal was pickedUp sagt)
    const orderIsPickedUp =
      order &&
      (order.status === "picked_up" ||
        order.status === "completed" ||
        order.status === "done");

    // 🔥 alte Orders killen
    const orderTooOld =
      session.orderId &&
      !pickedUpFlag &&
      session.orderCreatedAt &&
      now - session.orderCreatedAt > SIXTY_MINUTES;

    // 🔥 FINAL LOGIK
    if (
      expired ||
      pickedUpFlag ||
      isEmptySession ||
      orderTooOld ||
      orderIsPickedUp // 💣 Zombie Killer
    ) {
      console.log("🧹 Lösche Session:", id, {
        expired,
        pickedUpFlag,
        orderTooOld,
        orderIsPickedUp,
      });

      await remove(ref(db, `sessions/${id}`));
      continue;
    }

    // aktive Sessions → deviceId merken
    if (session.deviceId) {
      activeDeviceIds.add(session.deviceId);
    }
  }

  // ============================
  // 3. Devices aufräumen
  // ============================
  for (const [deviceId, device] of Object.entries(devices)) {
    const isUsed = activeDeviceIds.has(deviceId);

    if (!isUsed) {
      console.log("🗑️ Lösche Device ohne aktive Session:", deviceId);
      await remove(ref(db, `devices/${deviceId}`));
    }
  }

  console.log("✨ Cleanup abgeschlossen.");
}

// ============================
// 🚀 Runner (wichtig!)
// ============================
cleanup()
  .then(async () => {
    console.log("✅ Script beendet");

    // Firebase sauber schließen (verhindert hängen!)
    await deleteApp(app);

    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Fehler beim Cleanup:", err);

    try {
      await deleteApp(app);
    } catch {}

    process.exit(1);
  });