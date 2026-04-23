import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import pkg from "google-auth-library";
const { google } = pkg;

const app = express();
app.use(cors({
  origin: "https://italiaria-72bdb.web.app"
}));
app.use(express.json());

const SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"];

async function getAccessToken() {
  const client = new google.auth.JWT(
    process.env.CLIENT_EMAIL,
    null,
    process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
    SCOPES
  );
  const token = await client.authorize();
  return token.access_token;
}

app.post("/send", async (req, res) => {
  const { sessionId, title, body } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  try {
    // 🔥 Session laden
    const snap = await db.ref(`sessions/${sessionId}`).once("value");

    if (!snap.exists()) {
      return res.status(404).json({ error: "Session not found" });
    }

    const sessionData = snap.val();
    const token = sessionData.fcmToken;

    if (!token) {
      return res.status(400).json({ error: "No token available" });
    }

    // =========================
    // 🔥 NEU: ORDER STATUS LADEN
    // =========================
    let finalTitle = title;
    let finalBody = body;

    if (sessionData.orderId) {
      const orderSnap = await db.ref(`orders/${sessionData.orderId}`).once("value");

      if (orderSnap.exists()) {
        const order = orderSnap.val();

        if (order.status === "fertig") {
          finalTitle = "🍕 Fertig!";
          finalBody = "Deine Bestellung ist abholbereit";
        }

        if (order.status === "abgeholt") {
          finalTitle = "✅ Abgeholt";
          finalBody = "Guten Appetit!";
        }
      }
    }

    // 🔥 FCM Auth
    const accessToken = await getAccessToken();

    // 🔥 Push senden
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${process.env.PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: finalTitle,
              body: finalBody,
            },

            // 🔥 NEU: DATA PAYLOAD für Service Worker
            data: {
              status: sessionData.orderId ? "update" : "unknown"
            }
          },
        }),
      }
    );

    const data = await response.json();

    // 🔥 Token invalid → entfernen
    if (data.error?.status === "NOT_FOUND" || data.error?.status === "INVALID_ARGUMENT") {
      await db.ref(`sessions/${sessionId}`).update({
        fcmToken: null
      });
    }

    res.status(response.ok ? 200 : 400).json(data);

  } catch (err) {
    console.error("❌ Send error:", err);
    res.status(500).json({ error: "FCM send failed" });
  }
});

app.listen(3000, () => console.log("Server läuft auf Port 3000"));