import express from "express";
import fetch from "node-fetch";
import pkg from "google-auth-library";
const { google } = pkg;

const app = express();
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
  const { token, title, body } = req.body;

  try {
    const accessToken = await getAccessToken();

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
            notification: { title, body },
          },
        }),
      }
    );

    const data = await response.json();
    res.status(response.ok ? 200 : 400).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "FCM send failed" });
  }
});

app.listen(3000, () => console.log("Server läuft auf Port 3000"));
