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

// ---------- TODO ----------

// RECEIVE JWT TOKEN TO SEND THE REQUEST TO THE API

// --------------------------

async function handleSaveWorkedTimeTool(payload) {
  const workedTimeInMinutes = payload.workedTime * 60;
  console.log("payload: ", payload);
  console.log("workedtime: ", workedTimeInMinutes);

  // 1 - OBTAIN TOKEN FROM EXTERNAL API

  const response = await fetch(`${process.env.EXTERNAL_API_URL_1}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "grava",
      password: "grava",
    }),
  });

  const { token } = await response.json();

  // 2 - GET OBJECTIVES BY PERSON ID 18 (ME)

  // https://api.horas.dev.grava.io/api/objectives?personId=18

  const objectivesByPersonId = await fetch(
    `${process.env.EXTERNAL_API_URL_1}/api/objectives?personId=18`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  ).then((res) => res.json());

  console.log(JSON.stringify(objectivesByPersonId));

  // 3 - ASK LLM TO SEARCH INTO THE OBJECTIVES THE MATCHING ONE IF ANY, COMING FROM THE INITIAL PROMPT

  const foundObjectiveWithJs = objectivesByPersonId.find((objective) =>
    objective.title
      .trim()
      .toLowerCase()
      .includes(payload.objectiveName.trim().toLowerCase())
  );

  // IF NOT FOUND, MAKE THE LLM TO ANSWER A NOTFOUND MSG

  console.log("found objective by JS: ", foundObjectiveWithJs);

  findObjectivePrompt = ` Eres un asistente que busca coincidencias entre textos, ya sea una coincidencia exacta o una parecida, o que el texto esté contenido dentro del nombre de la tarea dentro del listado de tareas.

Te voy a dar un listado de tareas en formato JSON donde cada tarea tiene un campo "title", y te voy a dar un texto que quiero que busques dentro de ese JSON

Listado de tareas:
###
${JSON.stringify(objectivesByPersonId)}
###

Texto de búsqueda:
###
${payload.objectiveName}
###

Responde ÚNICAMENTE en formato JSON válido, sin explicaciones ni código adicional.

Si encontraste coincidencia:
{
  "success": "true",
  "objective": {el objetivo encontrado sin alterar ninguno de sus campos}
}

Si no encontraste coincidencia:
{
  "success": "false",
  "objective": "none"
}
  en este ultimo caso en donde no encuentres coincidencia, quiero que seas mas detallado, en que lista de elementos buscaste y que cosa buscaste
  `;

  const foundObjective = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral",
      prompt: findObjectivePrompt,
      stream: false,
    }),
  });

  const foundObjectiveParsed = await foundObjective.json();

  console.log(JSON.parse(foundObjectiveParsed.response));

  // --------------------------------------------------------------------------------------------------------------------------------------------------
  // TEST SEND A MESSAGE TO DB IN AN IMPERATIVE WAY TO ADITIONALLY INFORM THE USER THAT THE WORKED TIME WAS SAVED IN A FOUND OBJECTIVE WITH JS LOGIC ---
    const messagesRef = db.ref("messages");
    const newMessageRef = messagesRef.push();
    await newMessageRef.set({
      message: `Listo! se cargaron ${payload.workedTime} horas al objetivo ${foundObjectiveWithJs}`,
      userID,
      date,
      username: username,
      timestamp: date,
    });

  // --------------------------------------------------------------------------------------------------------------------------------------------------
  
  // 4 - IF EVERYTHING IS OKAY, FIRE THE REQUEST TO SAVE WORKED TIME

  const date = new Date();
  const todayUTC = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

  // 5 - FINALLY SAVE WORKED TIME

  // const saveWorkedTime = await fetch(
  //   `${process.env.EXTERNAL_API_URL_1}/api/workedTimes`,
  //   {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       Authorization: `Bearer ${token}`,
  //     },
  //     body: JSON.stringify({
  //       date: todayUTC,
  //       entries: [
  //         {
  //           projectId: 77,
  //           minutes: workedTimeInMinutes,
  //           objectiveId: "3",
  //         },
  //       ],
  //     }),
  //   }
  // );
}

async function handleTool(tool, payload) {
  console.log('entro al handletool');
  switch (tool) {
    case "saveOffUser":
      console.log("fire save off user tool");
      break;
    case "saveWorkedTime":
      await handleSaveWorkedTimeTool(payload);
      break;
    default:
      console.log("none");
      break;
  }
}

async function handlePrompt(prompt, username) {
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
    targetPrompt = `Hola, eres un asistente que lee mensajes de un chat y responde una pregunta y en algunos casos decides si debes ejecutar alguna acción.
    Responde únicamente con un JSON válido sin incluir "//". 

    Si el usuario envia un mensaje que termina con un "?" entonces es una pregunta normal y debes responder solo en este formato JSON
      {
        "params": {"user": el usuario que envió el mensaje, "date": la fecha en que el usuario envió el mensaje},
        "answer": la respuesta a la pregunta del usuario,
      }

    Si el mensaje contiene algo como:
    - "Cargame "x" horas al objetivo "(nombre objetivo)" donde "x" es la cantidad de horas que el usuario pidió que le cargues, entonces responde solo en
    este formato JSON:
      {
        "tool": "saveWorkedTime",
        "params": {"user": ${username}, "objectiveName": "el nombre del objetivo", "workedTime": "la cantidad de horas que el usuario pidió"},
        "answer": La respuesta al usuario si hubo exito al cargar las horas,
      }
    
      
      El mensaje del usuario es: ${prompt}.`;
  } else {
    targetPrompt = `Hola, eres un asistente que lee mensajes de un chat y decide si debe ejecutar una acción. Las acciones posibles son:
    1 - saveOffUser: Esta acción se va a ejecutar cuando haya algun mensaje que contenga "no voy a estar" o "voy a estar off"
    2 - ninguna 

    Responde en formato JSON según el evento:
    
    - Si el tool es saveOffUser:
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
    if (username.toLowerCase() === "ai") {
      return res.status(201).send();
    }
    const result = await handlePrompt(message, username);

    console.log("result: ", result);

    const answer = JSON.parse(result.answer).answer;
    const tool = JSON.parse(result.answer).tool;
    const params = JSON.parse(result.answer).params;

    if (tool != null) {
      await handleTool(tool, params);
    }

    let parsedResponse = {
      success: true,
    };
    if (answer != "none") {
      parsedResponse = { ...parsedResponse, answer: answer };
      console.log("parsedResponse: ", parsedResponse);
    }
    // console.log("backend response: ", parsedResponse);
    return res.status(201).json(parsedResponse);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Failed to save message" });
  }
});
