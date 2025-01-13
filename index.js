require('dotenv').config();
const http = require('http');
const debug = require('debug')('blog-api:server');

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cors = require('cors');
 
const port = normalizePort(process.env.PORT || '3050');
// routers
 
const waController = require('./whatsapp'); // Assurez-vous que le chemin est correct
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);
const waRouter = require('./routes/whatsapp');
 


app.set('port', port);
 
//launch whatsapp
waController.launch().then(() => console.log('Whatsapp launched')).catch((err) => console.log(err));

io.on("connection", waController.startSocket);

 

app.use(cors());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
 console.log("CORS ALLOWED")
 next()
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/uploads')));

// app.use(express.static(path.join(__dirname, 'public','qavah')));

app.get('/test', (req, res) => {
  res.json({ message: 'Hello World here' });
}
);
 
app.use('/whatsapp', waRouter);
 
app.use("/whatsapp/assets", express.static(__dirname + "/client/assets"));
 
  








function normalizePort(val) {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

function onListening() {
  const addr = server.address();
  const bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  debug('Listening on2 ' + bind);
  console.log(' Listening on ' + bind);
  console.log('http://localhost:' + addr.port);
  console.log("addr : ", addr);
}

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}




server.listen(port);
server.on('error', onError);
server.on('listening', onListening);


 
