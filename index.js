console.log("starting server...");
const PORT = 3000;

const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server started");
});

app.use(cors({ origin: "http://localhost:5173" }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

admin.initializeApp({
  credential: admin.credential.cert(require("./firebase-key.json")),
  databaseURL: process.env.DATABASE_URL,
});

const db = admin.database();

app.post("/prompt", async (req, res) => {
  const { prompt } = req.body;
  try {
    const snapshot = await db.ref("messages").once("value");
    const messages = snapshot.val();

    console.log('Pregunta: ', req.body.prompt);

    if (!messages) return res.status(404).json({ error: "No messages found" });

    const messagesList = Object.values(messages);

    const messagesText = messagesList
      .map((msg) => {
        return `${msg.userName} (${new Date(
          msg.timestamp
        ).toLocaleString()}): ${msg.message}`;
      })
      .join("\n");

    const targetPrompt = `Hola, eres un asistente que lee mensajes de un chat y decide si debe ejecutar una acción. Las acciones posibles son:
    1 - saveOffUser(usuario, fecha, descripción). Esta acción se va a ejecutar cuando haya algun mensaje que contenga "no voy a estar" o "voy a estar off". La descripción va a ser el motivo por el que no esté el usuario, si es que lo aclara
    2 - ninguna (si no hay accion que ejecutar) 

    Responde en formato JSON según el evento y con este formato. Por ejemplo si el tool es saveOffUser:
    {
      "tool": "saveOffUser", "params": {"user": "Usuario", "date": "la fecha en la que no va a estar el usuario", "reason": "No estará por vacaciones el dia 18 de agosto"}
    }
        Los mensajes del chat son estos: ${messagesText}

        Y la pregunta es: ${prompt}.
        `;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral",
        prompt: targetPrompt,
        stream: false,
      }),
    });

    const data = await response.json();
    console.log("RESPUESTA DE OLLAMA:");
    console.log(data);

    return res.json({ answer: data.response.trim() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
