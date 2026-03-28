const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const multer = require('multer');
require('dotenv').config();
const fetch = require('node-fetch'); // Ajouté pour les requêtes API

const log = (pino = require("pino"));
const { session } = { session: "baileys_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();

// enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 3050;
const qrcode = require("qrcode");

app.use("/whatsapp/assets", express.static(__dirname + "/client/assets"));

app.get("/whatsapp/scan", (req, res) => {
  res.sendFile("./client/server.html", {
    root: __dirname,
  });
});

app.get("/whatsapp", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

app.post("/whatsapp/disconnect", async (req, res) => {
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
  saveCreds(null);
  setTimeout(() => { 
    connectToWhatsApp();
  }, 2000);
  res.json({ status: true, message: "Déconnexion en cours..." });
});

// Fonction pour envoyer aux abonnés RDC
app.post("/whatsapp/send-to-subscribers-rdc", async (req, res) => {
  try {
    const messageBody = req.body.message;
    
    if (!isConnected()) {
      return res.status(500).json({
        status: false,
        response: "WhatsApp n'est pas encore connecté."
      });
    }

    if (!messageBody) {
      return res.status(400).json({
        status: false,
        response: "Le message est requis"
      });
    }

    // Récupérer les numéros depuis l'API
    const response = await fetch('https://ach.simply-pay.info/api/phone-number', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }

    const phoneNumbers = await response.json();
    
    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res.status(500).json({
        status: false,
        response: "Format de données invalide reçu de l'API"
      });
    }

    // Envoyer les messages
    const results = [];
    for (const number of phoneNumbers) {
      try {
        if (!number) continue;
        
        // Formatage spécifique pour la RDC (conservation du +243)
        let formattedNumber = number.trim();
        
        // Supprimer les espaces et caractères spéciaux
        formattedNumber = formattedNumber.replace(/\D/g, '');
        
        // Si le numéro commence par 243 (sans +), on ajoute le +
        if (formattedNumber.startsWith('243') && formattedNumber.length === 12) {
          formattedNumber = '+' + formattedNumber;
        }
        // Si le numéro commence par 0, on remplace par +243
        else if (formattedNumber.startsWith('0') && formattedNumber.length === 10) {
          formattedNumber = '+243' + formattedNumber.substring(1);
        }
        // Si le numéro a 9 chiffres (sans indicatif), on ajoute +243
        else if (formattedNumber.length === 9) {
          formattedNumber = '+243' + formattedNumber;
        }
        
        const numberWA = formattedNumber + "@s.whatsapp.net";
        const exists = await sock.onWhatsApp(numberWA);

        if (exists?.jid || (exists && exists[0]?.jid)) {
          const jid = exists.jid || exists[0].jid;
          await sock.sendMessage(jid, { text: messageBody });
          results.push({
            number: formattedNumber,
            status: "success",
            jid: jid
          });
        } else {
          results.push({
            number: formattedNumber,
            status: "not_registered",
            error: `Le numéro ${formattedNumber} n'est pas répertorié sur WhatsApp`
          });
        }
      } catch (err) {
        results.push({
          number: number,
          status: "error",
          error: err.message
        });
      }
      // Pause pour éviter le flood
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.status(200).json({
      status: true,
      total: phoneNumbers.length,
      sent: results.filter(r => r.status === "success").length,
      failed: results.filter(r => r.status !== "success").length,
      details: results
    });

  } catch (err) {
    console.error("Erreur lors de l'envoi aux abonnés:", err);
    res.status(500).json({
      status: false,
      response: err.message
    });
  }
});

let sock;
let qr;
let soket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
  let { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: log({ level: "silent" }),
    version,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
  });
  
  sock.multi = true;
  
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output;
      console.log("reason", reason);
      connectToWhatsApp();
    } else if (connection === "open") {
      console.log("opened connection");
    }
    
    if (update.qr) {
      qr = update.qr;
      updateQR("qr");
    } else if (!qr) {
      updateQR("loading");
    } else {
      if (update.connection === "open") {
        updateQR("qrscanned");
      }
    }
  });
  
  sock.ev.on("creds.update", saveCreds);
  
  sock.ev.on("messages.upsert", () => {});
  
  sock.ev.on("messages.ack", (m) => {
    console.log("ack", m);
  });
  
  sock.ev.on("messages.received", (m) => {
    console.log("received", m);
  });
  
  sock.ev.on("group-participants.update", (m) => {
    console.log("statusUpdate", m);
  });
}

io.on("connection", async (socket) => {
  console.log("SOCKET CONNECTED");
  try {
    soket = socket;
    if (sock.user != undefined) {
      updateQR("connected");
    } else if (qr) {
      updateQR("qr");
    }
  } catch (error) {
    console.log("SOCKET ERROR ", error);
  }
});

function isConnected() {
  return sock && sock.user;
}

function updateQR(data) {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qr, (err, url) => {
        soket?.emit("qr", url);
        soket?.emit("log", "QR Code received, please scan!");
      });
      break;
    case "connected":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", "WhatsApp connecté!");
      break;
    case "qrscanned":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", "Le QR Code a été scanné!");
      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      soket?.emit("log", "Registering QR Code, please wait!");
      break;
    default:
      break;
  }
}

// Configuration Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage });

// Démarrer le serveur
connectToWhatsApp().catch((err) => console.log("unexpected error: " + err));
server.listen(port, () => {
  console.log("Serveur lancé sur le port : " + port);
});