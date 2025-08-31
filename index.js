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
  const snapshot = await db.ref("messages").once("value");
  const messages = snapshot.val();
  let targetPrompt = "";

  if (!messages) {
    return { error: "No messages found" };
  }

  const messagesList = Object.values(messages);
  const messagesText = messagesList
    .map((msg) => {
      return `${msg.username} (${new Date(msg.timestamp).toLocaleString()}): ${
        msg.message
      }`;
    })
    .join("\n");

  // CONDITIONAL PROMPT BASED ON "/PROMPT" OR A NORMAL MESSAGE
  if (prompt.toLowerCase().startsWith("/prompt")) {
    targetPrompt = `Hola, eres un asistente que lee mensajes de un chat y responde una pregunta
    Responde en este formato JSON:
    {
      "params": {"user": el usuario que envió el mensaje, "date": la fecha en que el usuario envió el mensaje},
      "answer": la respuesta a la pregunta del usuario,
    }
      
      El mensaje del usuario es: ${prompt}.`;
  } else {
    targetPrompt = `Hola, eres un asistente que lee mensajes de un chat y decide si debe ejecutar una acción. Las acciones posibles son:
    1 - saveOffUser: Esta acción se va a ejecutar cuando haya algun mensaje que contenga "no voy a estar" o "voy a estar off"
    2 - ninguna 

    Responde en formato JSON según el evento. Si el tool es saveOffUser:
    {
      "tool": "saveOffUser", 
      "params": {"user": "Usuario", "date": "el dia en el que no va a estar el usuario", "reason": "la razón por la que el usuario no estará, si es que la hay"},
      "answer" "none",
    }

        El mensaje es: ${prompt}.
        `;
  }

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

app.post("/messages", async (req, res) => {
  const { username, message, userID, date } = req.body;

  if (!username || !message || !userID || !date) {
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
      username: username,
      timestamp: date,
    });

    // 2 - SENDING THE MESSAGE TO THE LLM IN BACKGROUND
     if(username.toLowerCase() === 'ai'){
      // THIS PREVENTS AN INFINITE LOOP, SENDING TO LLM PROCESSOR IT'S OWN RESPONSES
      return res.status(201).send();
    }
    const result = await handlePrompt(message);
    const answer = JSON.parse(result.answer).answer;
    let parsedResponse = {
      success: true,
    };
    if (answer != "none") {
      parsedResponse = { ...parsedResponse, answer: answer };
    }
    console.log('backend response: ', parsedResponse);
    return res.status(201).json(parsedResponse);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Failed to save message" });
  }
});
