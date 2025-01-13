const {
    default: makeWASocket,
    MessageType,
    MessageOptions,
    Mimetype,
    DisconnectReason,
    BufferJSON,
    AnyMessageContent,
    delay,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    MessageRetryMap,
    useMultiFileAuthState,
    msgRetryCounterMap,
  } = require("@whiskeysockets/baileys");
  //import os
  const { exec } = require('child_process');
  
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
  const port = process.env.PORT || 8002;
  const qrcode = require("qrcode");
  
  
  app.get("/scan", (req, res) => {
    res.sendFile("./client/server.html", {
      root: __dirname,
    });
  });


  exports.scanFile = async (req, res) => {
    res.sendFile("./client/server.html", {
        root: __dirname,
      });
     
    };

    exports.startSocket = async (socket) => {
      console.log("START SOCKET")
        soket = socket;
        // console.log(sock)
        if(isConnected()==-1){
           setTimeout(() => {
            connectToWhatsApp();
           }
              ,2000);
            
        }
        if (isConnected()) {
            // console.log("CONNECTED ",sock.user)
          updateQR("connected");
        } else if (qr) {
            console.log("NOT CONNECTED")
          updateQR("qr");
        }
    };



    exports.removeSession = async (req, res) => {
         
            //delete baileys_auth_info folder
            const pathBaileys = path.join(__dirname,  "baileys_auth_info");
            const os = require('os');
            const platform = os.platform();
            const deleteCommand = platform === 'win32' ? 'rmdir /s /q baileys_auth_info' : 'rm -rf baileys_auth_info';
            
            exec(deleteCommand, async(error, stdout, stderr) => {
              if (error) {
                  console.error(`Error: ${error.message}`);
                  return;
              }
              if (stderr) {
                  console.error(`Stderr: ${stderr}`);
                  return;
              }
              console.log(`Folder deleted successfully: ${stdout}`);
              const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
              saveCreds(null);
              setTimeout(() => {
                // startSocket(socket)//
                //reload socket 
                connectToWhatsApp();
             },2000);
    
                
          });
           
    };


    const deletCred=async(cb)=>{
      console.log("DELETING CREDENTIALS")
        
        //delete credential
        //get path baileys_auth_info
        const pathBaileys = path.join(__dirname,  "baileys_auth_info");
        //check if folder exist
        if(fs.existsSync(pathBaileys)){
          console.log("PATH Existe",pathBaileys)
        }else{
          console.log("PATH NOT FOUND")
        }
       
    }
    exports.launch = async (req, res) => {
        setTimeout(() => {
            connectToWhatsApp();
        },2000);
        // res.json({ message: "WhatsApp connecté!" });
    };

  
    exports.initFile = async (req, res) => {
        res.sendFile("./client/index.html", {
            root: __dirname,
          });
    };


  let sock;
  let qr;
  let soket;
  let essaie=0;
  
  async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
    let { version, isLatest } = await fetchLatestBaileysVersion();
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
      console.log("UPDATE ",update)
      if (connection === "close") {
        let reason = new Boom(lastDisconnect.error).output;
          console.log("Connexion fermée", reason);
          if(reason.statusCode==440 || reason.statusCode==401 || reason.statusCode==503){
            console.log(essaie," Il y a conflit ",reason.statusCode)
            //delete credential
           if(essaie<3){
            essaie++;
            setTimeout(() => {
              connectToWhatsApp();
            },1500);
          }else{
            deletCred(()=>console.log("Session supprimée!"));
            essaie=0;
          }
          return;
        }
          setTimeout(() => {
            connectToWhatsApp();
          },1500);
      
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
    
  }
  
 
  
  // functions
  const isConnected = () => {
    // console.log("IS CONNECTED", sock); 
  try {
      return sock.user;
      
  } catch (error) {
      console.log("ERROR ",error)
      return -1;
  }  };
  
  const updateQR = (data) => {
    switch (data) {
      case "qr":
        qrcode.toDataURL(qr, (err, url) => {
          soket?.emit("qr", url);
          soket?.emit("log", "QR Code received, please scan!");
        });
        break;
      case "connected":
        soket?.emit("qrstatus", "https://firebasestorage.googleapis.com/v0/b/goodvibes-event.appspot.com/o/whatsapp%2Fcheck.svg?alt=media&token=80e3d5e7-cff9-48ae-86dc-2a0a600b940c");
        soket?.emit("log", "WhatsApp connecté!");
        break;
      case "qrscanned":
        soket?.emit("qrstatus", "https://firebasestorage.googleapis.com/v0/b/goodvibes-event.appspot.com/o/whatsapp%2Fcheck.svg?alt=media&token=80e3d5e7-cff9-48ae-86dc-2a0a600b940c");
        soket?.emit("log", "Le QR Code a été scanné!");
        break;
      case "loading":
        soket?.emit("qrstatus", "https://firebasestorage.googleapis.com/v0/b/goodvibes-event.appspot.com/o/whatsapp%2Floader.gif?alt=media&token=b1d4209a-0588-4a83-85af-07c6d54b54c4");
        soket?.emit("log", "Registering QR Code , please wait!");
        break;
      default:
        break;
    }
  };
  
 







  // send text message to wa user
 exports.sendMessage= async (req, res) => {
//  launch().then(() => console.log('Whatsapp launched')).catch((err) => console.log(err));

    console.log(req.body);
    const messageBody = req.body.message;
    const number = req.body.number;
    const fichier = req.files;
  console.log("NUmber ",number)
    let numberWA;
    try {
      if (!req.file) {
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
              console.log("Not connected n'est pas reportprie")
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
        //console.log('Kirim document');
        if (!number) {
          res.status(500).json({
            status: false,
            response: "Le numéro WA n'est pas inclus!",
          });
        } else {
          numberWA =  number.substring(1) + "@s.whatsapp.net";


       const fileName= req.file.filename==undefined?req.file.name:req.file.filename;
 
// Define the target path
const targetPath = req.body.pathLta;

// Copy the file to the target path
 
// console.log("TARGET PATH ",sock)
 
          if (isConnected) {
            console.log("Is connected")
            const exists = await sock.onWhatsApp(numberWA);
  console.log("EXISTS ",exists)
            if (exists?.jid || (exists && exists[0]?.jid)) {
              let fileNameUploaded = req.body.pathLta;
              let extensionName = path.extname(fileNameUploaded);
              if(extensionName === ".pdf"){
                console.log("Sendding pdf file")
                await sock.sendMessage(exists.jid || exists[0].jid, {
                  document: {
                    url: fileNameUploaded,
                  },
                  caption: messageBody,

                  mimetype: "application/pdf",
                  fileName: fileName,
                })
                .then(async (result) => {
                  
                
                console.log("PDF sent ",result)
                  //  return res.send({
                //     status: true,
                //     message: "Success",
                //     data: {
                //       name: req.file.filename,
                //       mimetype: req.file.mimetype,
                //       size: req.file.size,
                //     },
                //   });
                })
              }
              if(extensionName === ".xlsx"){
                console.log("Sendding xlsx file ")
                await sock.sendMessage(exists.jid || exists[0].jid, {
                  document: {
                    url: fileNameUploaded,
                  },
                  caption: messageBody,

                  mimetype: "application/xlsx",
                  fileName: fileName,
                })
                .then(async (result) => {
                  
                
                console.log("File sent ",result)
                 
                })
              }
               
            } else {
              console.log(`Le numéro ${number} n'est pas répertorié.`)
           
            }
          } else {
            console.log("Not connected")
            
          }
        }
      }
    } catch (err) {
      console.log("ERROR ",err)
    }
  };















 
 