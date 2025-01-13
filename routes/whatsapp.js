const express = require('express');
const router = express.Router();
const waController = require('../whatsapp'); // Assurez-vous que le chemin est correct
const upload = require('../utils/multer');

// Créer une nouvelle sortie
router.get('/', waController.initFile);

// Lire toutes les sorties
router.get('/scan', waController.scanFile);
router.post('/message',upload.single('data'), waController.sendMessage);
router.post('/disconnect', waController.removeSession);

// Lire une sortie par ID
// router.get('/:id',authenticateToken, sortieController.getSortieById);

// // Mettre à jour une sortie par ID
// router.put('/:id',authenticateToken, sortieController.updateSortie);

// // Supprimer une sortie par ID
// router.delete('/:id',authenticateToken, sortieController.deleteSortie);

module.exports = router;