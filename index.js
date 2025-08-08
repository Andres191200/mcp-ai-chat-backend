console.log('starting server...');
const PORT = 3000;

const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

app.get("/", (req,res) => {
    res.send('Server started');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
})

admin.initializeApp({
  credential: admin.credential.cert(require("./firebase-key.json")),
  databaseURL: "https://mcp-chat-52e15-default-rtdb.firebaseio.com",
});

const db = admin.database();

app.post("/prompt", async (req, res) => {
  const { prompt } = req.body;

  try {
    const snapshot = await db.ref("messages").once("value");
    const messages = snapshot.val();

    if (!messages) return res.status(404).json({ error: "No messages found" });

    const messagesList = Object.values(messages);
    console.log(messagesList);

    messagesList.filter((message) => message === "invocar a ollama");

    const prompt = `Hola, estos son los mensajes de los usuarios en un chat: 
        ${messagesList.join("\n")}}

        Y ahora te pregunto sobre esos mensajes: ${question}.
        Respondé de forma clara y concisa por favor.
        `;

    //TODO: CALL OLLAMA

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral",
        prompt,
        // STREAM FALSE FOR NOW
        stream: false,
      }),
    });
    const data = await response.json();
    return res.json({ answer: data.response.trim() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
