const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const multer = require('multer');
//dotenv
require('dotenv').config();

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
// const io = require('socket.io')(server, {
//   path: '/whatsapp/socket.io',
// });
const io = require("socket.io")(server);
// const io = require('socket.io')(server, {
//   cors: {
//     origin : 'https://labreche.ovh/whatsapp',
//     methods: ["GET", "POST"],  
//   },
// });
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




 
app.post("/whatsapp/disconnect",async(req, res)=>{
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
  // console.log(state)
  saveCreds(null);
  setTimeout(() => { 
    connectToWhatsApp();
  },2000);

})
//fungsi suara capital
//const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

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
    } else if ((qr = undefined)) {
      updateQR("loading");
    } else {
      if (update.connection === "open") {
        updateQR("qrscanned");
        return;
      }
    }
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", () => {

  });

  

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
  console.log("SOCKET CONNECTED")
 try {
  soket = socket;
  console.log("SOCKET ",soket)
  // console.log(sock)
  if (sock.user!=undefined) {
    console.log("IS CONNECTeD ", sock.user)
    updateQR("connected");
  } else if (qr) {
    updateQR("qr");
  }
 } catch (error) {
  console.log("SOCKET ERROR ",error)
 }
});


// functions
const isConnected = () => {
  return sock.user;
};

const updateQR = (data) => {
  console.log("DATA ", soket)
  switch (data) {
    case "qr":
      qrcode.toDataURL(qr, (err, url) => {
        console.log("QR URL ",url)
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
      soket?.emit("log", "Registering QR Code , please wait!");
      break;
    default:
      break;
  }
};

 

// Configure Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/') // Ensure this directory exists
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage });

 

// Handle file upload
app.post('/whatsapp/send-file', upload.single('file'), (req, res) => {
  if (req.file) {
    res.json('File uploaded successfully: ' + req.file.filename);
  } else {
    res.status(400).json('No file uploaded.');
  }
});

 
app.post("/whatsapp/send-message", async (req, res) => {
  console.log(req.body);
  const messageBody = req.body.message;
  const number = req.body.number;
  console.log("NUmber ",number)
  console.log("FILES ",req.files)
  console.log("FILE ",req.file)
  let numberWA;
  try {
    if (!req.files) {
      if (!number) {
        res.status(500).json({
          status: false,
          response: "Le numéro WA n'est pas inclus!",
        });
      } else {
        numberWA =  number.substring(1) + "@s.whatsapp.net";
        console.log("NUmberWA ",numberWA)

        // console.log(await sock.onWhatsApp(numberWA));
        if (isConnected) {
          console.log("Is connected")
          const exists = await sock.onWhatsApp(numberWA);
          console.log("EXISTS ",exists)
          if (exists?.jid || (exists && exists[0]?.jid)) {
            sock
              .sendMessage(exists.jid || exists[0].jid, { text: messageBody })
              .then((result) => {
                console.log("Message sent")
                res.status(200).json({
                  status: true,
                  response: result,
                });
              })
              .catch((err) => {
                console.log("ERROR ",err)
                res.status(500).json({
                  status: false,
                  response: err,
                });
              });
          } else {
            console.log(numberWA," n'est pas reportprie")
            res.status(500).json({
              status: false,
              response: `Le numéro ${number} n'est pas répertorié.`,
            });
          }
        } else {
          console.log("Not connected")
          res.status(500).json({
            status: false,
            response: `WhatsApp n'est pas encore connecté.`,
          });
        }
      }
    } else {
      console.log('C\'est un fichier');
      if (!number) {
        res.status(500).json({
          status: false,
          response: "Le numéro WA n'est pas inclus!",
        });
      } else {
        numberWA =  number.substring(1) + "@s.whatsapp.net";

        // Configure multer storage
       

     
          const fileName = req.files ? req.files.file.name : req.body.fileName;
          const filePath =  req.body.filePath;
          console.log("FILE NAME ",fileName)
          console.log("FILE PATH ",filePath)

          if (isConnected) {
            const exists = await sock.onWhatsApp(numberWA);
            if (exists?.jid || (exists && exists[0]?.jid)) {
              const extensionName = path.extname(filePath);
              
              if(extensionName === ".pdf"){
                console.log("Sending pdf file")
                await sock.sendMessage(exists.jid || exists[0].jid, {
                  document: {
                    url: filePath,
                  },
                  caption: messageBody,
                  mimetype: "application/pdf",
                  fileName: fileName,
                })
                .then(async (result) => {
                  console.log("PDF sent ", result)
                  res.status(200).json({
                    status: true,
                    response: result
                  });
                })
                .catch(err => {
                  res.status(500).json({
                    status: false,
                    response: err.message
                  });
                });
              }
              
              if(extensionName === ".xlsx"){
                console.log("Sending xlsx file")
                await sock.sendMessage(exists.jid || exists[0].jid, {
                  document: {
                    url: filePath,
                  },
                  caption: messageBody,
                  mimetype: "application/xlsx", 
                  fileName: fileName,
                })
                .then(async (result) => {
                  console.log("File sent ", result)
                  res.status(200).json({
                    status: true,
                    response: result
                  });
                })
                .catch(err => {
                  res.status(500).json({
                    status: false,
                    response: err.message
                  });
                });
              }
            } else {
              console.log(`Le numéro ${number} n'est pas répertorié.`)
              res.status(500).json({
                status: false,
                response: `Le numéro ${number} n'est pas répertorié.`
              });
            }
          } else {
            console.log("Not connected")
            res.status(500).json({
              status: false,
              response: "WhatsApp n'est pas encore connecté."
            });
          }
      }
    }
  } catch (err) {
    console.log("ERROR ",err)
    res.status(500).json({
      status: false,
      response: err.message
    });
  }
});





// send group message
app.post("/whatsapp/send-group-message", async (req, res) => {
  //console.log(req);
  const pesankirim = req.body.message;
  const id_group = req.body.id_group;
  let exist_idgroup;
  try {
    if (isConnected) {
      if (!req.files) {
        if (!id_group) {
          res.status(500).json({
            status: false,
            response:
              "Le numéro d'identification du groupe n'a pas été inclus!",
          });
        } else {
          let exist_idgroup = await sock.groupMetadata(id_group);
          console.log(exist_idgroup.id);
          console.log("isConnected");
          if (exist_idgroup?.id || (exist_idgroup && exist_idgroup[0]?.id)) {
            sock
              .sendMessage(id_group, { text: pesankirim })
              .then((result) => {
                res.status(200).json({
                  status: true,
                  response: result,
                });
                console.log("bien envoyé");
              })
              .catch((err) => {
                res.status(500).json({
                  status: false,
                  response: err,
                });
                console.log("error 500");
              });
          } else {
            res.status(500).json({
              status: false,
              response: `L'ID de groupe ${id_group} n'est pas répertorié.`,
            });
            console.log(`L'ID de groupe ${id_group} n'est pas répertorié.`);
          }
        }
      } else {
        //console.log('Envoyer des documents');
        if (!id_group) {
          res.status(500).json({
            status: false,
            response: "L'ID de groupe n'est pas inclus!",
          });
        } else {
          exist_idgroup = await sock.groupMetadata(id_group);
          console.log(exist_idgroup.id);
          //console.log('Kirim document ke group'+ exist_idgroup.subject);

          let filesimpan = req.files.file_dikirim;
          var file_ubah_nama = new Date().getTime() + "_" + filesimpan.name;
          //déplacez le fichier dans le répertoire de téléchargement
          filesimpan.mv("./uploads/" + file_ubah_nama);
          let fileDikirim_Mime = filesimpan.mimetype;
          //console.log('Simpan document '+fileDikirim_Mime);
          if (isConnected) {
            if (exist_idgroup?.id || (exist_idgroup && exist_idgroup[0]?.id)) {
              let namafiledikirim = "./uploads/" + file_ubah_nama;
              let extensionName = path.extname(namafiledikirim);
              //console.log(extensionName);
              if (
                extensionName === ".jpeg" ||
                extensionName === ".jpg" ||
                extensionName === ".png" ||
                extensionName === ".gif"
              ) {
                await sock
                  .sendMessage(exist_idgroup.id || exist_idgroup[0].id, {
                    image: {
                      url: namafiledikirim,
                    },
                    caption: pesankirim,
                  })
                  .then(() => {
                    if (fs.existsSync(namafiledikirim)) {
                      fs.unlink(namafiledikirim, (err) => {
                        if (err && err.code == "ENOENT") {
                          // file doens't exist
                          console.info("File doesn't exist, won't remove it.");
                        } else if (err) {
                          console.error(
                            "Error occurred while trying to remove file."
                          );
                        }
                        //console.log('File deleted!');
                      });
                    }
                    res.send({
                      status: true,
                      message: "Success",
                      data: {
                        name: filesimpan.name,
                        mimetype: filesimpan.mimetype,
                        size: filesimpan.size,
                      },
                    });
                  })
                  .catch((err) => {
                    res.status(500).json({
                      status: false,
                      response: err,
                    });
                    console.log("le message n'a pas pu être envoyé");
                  });
              } else if (extensionName === ".mp3" || extensionName === ".ogg") {
                await sock
                  .sendMessage(exist_idgroup.id || exist_idgroup[0].id, {
                    audio: {
                      url: namafiledikirim,
                      caption: pesankirim,
                    },
                    mimetype: "audio/mp4",
                  })
                  .then(() => {
                    if (fs.existsSync(namafiledikirim)) {
                      fs.unlink(namafiledikirim, (err) => {
                        if (err && err.code == "ENOENT") {
                          // file doens't exist
                          console.info("File doesn't exist, won't remove it.");
                        } else if (err) {
                          console.error(
                            "Error occurred while trying to remove file."
                          );
                        }
                        //console.log('File deleted!');
                      });
                    }
                    res.send({
                      status: true,
                      message: "Success",
                      data: {
                        name: filesimpan.name,
                        mimetype: filesimpan.mimetype,
                        size: filesimpan.size,
                      },
                    });
                  })
                  .catch((err) => {
                    res.status(500).json({
                      status: false,
                      response: err,
                    });
                    console.log("le message n'a pas pu être envoyé");
                  });
              } else {
                await sock
                  .sendMessage(exist_idgroup.id || exist_idgroup[0].id, {
                    document: {
                      url: namafiledikirim,
                      caption: pesankirim,
                    },
                    mimetype: fileDikirim_Mime,
                    fileName: filesimpan.name,
                  })
                  .then(() => {
                    if (fs.existsSync(namafiledikirim)) {
                      fs.unlink(namafiledikirim, (err) => {
                        if (err && err.code == "ENOENT") {
                          // file doens't exist
                          console.info("File doesn't exist, won't remove it.");
                        } else if (err) {
                          console.error(
                            "Error occurred while trying to remove file."
                          );
                        }
                        //console.log('File deleted!');
                      });
                    }

                    setTimeout(() => {
                      sock.sendMessage(
                        exist_idgroup.id || exist_idgroup[0].id,
                        { text: pesankirim }
                      );
                    }, 1000);

                    res.send({
                      status: true,
                      message: "Success",
                      data: {
                        name: filesimpan.name,
                        mimetype: filesimpan.mimetype,
                        size: filesimpan.size,
                      },
                    });
                  })
                  .catch((err) => {
                    res.status(500).json({
                      status: false,
                      response: err,
                    });
                    console.log("le message n'a pas pu être envoyé");
                  });
              }
            } else {
              res.status(500).json({
                status: false,
                response: `Le numéro ${number} n'est pas répertorié.`,
              });
            }
          } else {
            res.status(500).json({
              status: false,
              response: `WhatsApp n'est pas encore connecté.`,
            });
          }
        }
      }

      //end is connected
    } else {
      res.status(500).json({
        status: false,
        response: `WhatsApp n'est pas encore connecté.`,
      });
    }

    //end try
  } catch (err) {
    res.status(500).send(err);
  }
});

connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
  server.listen(port, () => {
  console.log("Serveur lancé sur le port : " + port);
});
