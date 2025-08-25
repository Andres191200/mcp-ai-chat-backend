console.log("starting server...");
const PORT = 3000;

const cors = require("cors");
const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(express.json());

const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

app.get("/", (req, res) => {
  res.send("Server started");
});

app.use(cors({ origin: "http://localhost:5173" }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

async function handlePrompt(prompt) {
  // Obtener mensajes
  const snapshot = await db.ref("messages").once("value");
  const messages = snapshot.val();
  if (!messages) {
    return { error: "No messages found" };
  }

  const messagesList = Object.values(messages);
  const messagesText = messagesList
    .map((msg) => {
      return `${msg.userName} (${new Date(msg.timestamp).toLocaleString()}): ${
        msg.message
      }`;
    })
    .join("\n");

  const targetPrompt = `Hola, eres un asistente que lee mensajes de un chat y decide si debe ejecutar una acción. Las acciones posibles son:
    1 - saveOffUser(usuario, fecha, descripción). Esta acción se va a ejecutar cuando haya algun mensaje que contenga "no voy a estar" o "voy a estar off". La descripción va a ser el motivo por el que no esté el usuario, si es que lo aclara
    2 - ninguna (si no hay accion que ejecutar de las anteriormente mencionadas).

    Responde en formato JSON según el evento y con este formato. Por ejemplo si el tool es saveOffUser:
    {
      "tool": "saveOffUser", 
      "params": {"user": "Usuario", "date": "el dia en el que no va a estar el usuario", "reason": "la razón por la que el usuario no estará, si es que la hay"}
      "answer" "none"
    }
    Pero si no hay ningún evento que ejecutar, entonces responde con:
    {
      "tool": "none", 
      "params": "none"
      "answer": "aqui coloca la respuesta que le des al usuario en formato humano"
    }
        Los mensajes del chat son estos: ${messagesText}

        Y la pregunta o el mensaje es: ${prompt}.
        `;

  // Llamar a Ollama
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
  return { answer: data.response?.trim() };
}

app.post("/prompt", async (req, res) => {
  console.log("Asking LLM...");
  const { prompt } = req.body;
  try {
    const result = await handlePrompt(prompt);

    if (result.error) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/messages", async (req, res) => {
  const { userName, message, userID, date } = req.body;
  let isAIresponse = false;

  if (!userName || !message || !userID || !date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // CALLING LLM TO CHECK EVERY USER INCOMING MESSAGE
  try {
    // 1 - SAVING IN DB FIRST TO PREVENT STUCK THE MESSAGE THROUGH LLM TIMING RESPONSE
    const messagesRef = db.ref("messages");
    const newMessageRef = messagesRef.push();
    await newMessageRef.set({
      message,
      userID,
      date,
      username: isAIresponse ? "AI" : userName,
      timestamp: date,
    });
    console.log("MESSAGE SAVED SUCCESSFULLY");

    // 2 - SENDING THE MESSAGE TO THE LLM IN BACKGROUND
    console.log('SENDING THE RESPONSE TO THE LLM');
    const result = await handlePrompt(message);
    console.log("Respuesta del LLM:", result.answer);
    
    return res.json({ success: true });
  } catch (error) {
    console.log("ERROR SAVING MESSAGE");
    return res.status(500).json({ error: "Failed to save message" });
  }
});
