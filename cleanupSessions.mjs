import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
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

  // ============================
  // 1. Sessions laden
  // ============================
  const sessionsRef = ref(db, "sessions");
  const sessionsSnap = await get(sessionsRef);
  const sessions = sessionsSnap.val() || {};

  // ============================
  // 2. Devices laden
  // ============================
  const devicesRef = ref(db, "devices");
  const devicesSnap = await get(devicesRef);
  const devices = devicesSnap.val() || {};

  const now = Date.now();
  const SIXTY_MINUTES = 60 * 60 * 1000;
  const activeDeviceIds = new Set();

  // ============================
  // 3. Sessions aufräumen
  // ============================
  for (const [id, session] of Object.entries(sessions)) {
    const expired = session.expiresAt && now > session.expiresAt;
    const pickedUp = session.pickedUp === true;
    const isEmptySession = !session.orderId && !session.deviceId;

    // 🔥 NEUE REGEL: Order älter als 60 Minuten und nicht abgeholt
    const orderTooOld =
      session.orderId &&
      !session.pickedUp &&
      session.orderCreatedAt &&
      now - session.orderCreatedAt > SIXTY_MINUTES;

    if (expired || pickedUp || isEmptySession || orderTooOld) {
      console.log("🧹 Lösche Session:", id);
      await remove(ref(db, `sessions/${id}`));
      continue;
    }

    // aktive Sessions → deviceId merken
    if (session.deviceId) {
      activeDeviceIds.add(session.deviceId);
    }
  }

  // ============================
  // 4. Devices aufräumen
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

cleanup().catch((err) => {
  console.error("❌ Fehler beim Cleanup:", err);
  process.exit(1);
});
