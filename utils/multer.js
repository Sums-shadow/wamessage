const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
   cb(null, path.join(__dirname, '..', 'uploads' ));
  },
  filename: function (req, file, cb) {
    const timestamp = new Date().toISOString().replace(/[-:.]/g, ''); 
    cb(null, timestamp + '-' + file.originalname);
  },
});

const upload = multer({ storage: storage });

module.exports = upload;
