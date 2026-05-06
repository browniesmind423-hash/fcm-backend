import dotenv from "dotenv";
import { initializeApp, deleteApp } from "firebase/app";
import { getDatabase, ref, get, remove } from "firebase/database";

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

  const [sessionsSnap, devicesSnap, ordersSnap] = await Promise.all([
    get(ref(db, "sessions")),
    get(ref(db, "devices")),
    get(ref(db, "orders")),
  ]);

  const sessions = sessionsSnap.val() || {};
  const devices = devicesSnap.val() || {};
  const orders = ordersSnap.val() || {};

  const now = Date.now();
  const SIXTY_MINUTES = 60 * 60 * 1000;
  const activeDeviceIds = new Set();

  const deletePromises = []; // 🔥 parallel deletes

  // ============================
  // Sessions
  // ============================
  for (const [id, session] of Object.entries(sessions)) {
    // 🔥 kaputte/null sessions sofort löschen
    if (!session) {
      console.log("🧹 Lösche kaputte Session:", id);
      deletePromises.push(remove(ref(db, `sessions/${id}`)));
      continue;
    }

    const expired = session.expiresAt && now > session.expiresAt;
    const pickedUpFlag = session.pickedUp === true;
    const isEmptySession = !session.orderId && !session.deviceId;

    const order = session.orderId ? orders[session.orderId] : null;

    const orderIsPickedUp =
      order &&
      (order.status === "picked_up" ||
        order.status === "completed" ||
        order.status === "done");

    const orderTooOld =
      session.orderId &&
      !pickedUpFlag &&
      session.orderCreatedAt &&
      now - session.orderCreatedAt > SIXTY_MINUTES;

    if (
      expired ||
      pickedUpFlag ||
      isEmptySession ||
      orderTooOld ||
      orderIsPickedUp
    ) {
      console.log("🧹 Lösche Session:", id);

      deletePromises.push(remove(ref(db, `sessions/${id}`))); // 🔥 kein await
      continue;
    }

    if (session.deviceId) {
      activeDeviceIds.add(session.deviceId);
    }
  }

  // ============================
  // Devices
  // ============================
  for (const [deviceId, device] of Object.entries(devices)) {
    if (!activeDeviceIds.has(deviceId)) {
      console.log("🗑️ Lösche Device:", deviceId);
      deletePromises.push(remove(ref(db, `devices/${deviceId}`)));
    }
  }

  // 🔥 alles gleichzeitig ausführen
  await Promise.all(deletePromises);

  console.log(`✨ Cleanup abgeschlossen. (${deletePromises.length} Deletes)`);
}

// ============================
// Runner
// ============================
cleanup()
  .then(async () => {
    await deleteApp(app);

    // 🔥 garantiertes Beenden (wichtig für GitHub Actions)
    setTimeout(() => process.exit(0), 500);
  })
  .catch(async (err) => {
    console.error("❌ Fehler:", err);

    try {
      await deleteApp(app);
    } catch {}

    setTimeout(() => process.exit(1), 500);
  });