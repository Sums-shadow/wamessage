# Wamessage

Wamessage est un service basé sur Bailey pour créer un bot WhatsApp, automatiser les tâches, faire du cron job, et gérer ses messages WhatsApp.

## Fonctionnalités

- 🤖 Création de bots WhatsApp
- ⚙️ Automatisation des tâches
- ⏰ Gestion des tâches planifiées (cron jobs)
- 💬 Gestion complète des messages WhatsApp

## Installation

### Prérequis

Assurez-vous d'avoir les éléments suivants installés sur votre système :

- **Node.js** (version 16 ou supérieure)
- **Express.js**
- **MongoDB**
- **Baileys** (WhatsApp Web API)

### Étapes d'installation

1. **Installer Node.js**
   ```bash
   # Téléchargez et installez Node.js depuis https://nodejs.org/
   node --version
   npm --version
   ```

2. **Installer MongoDB**
   ```bash
   # Sur Ubuntu/Debian
   sudo apt-get install mongodb
   
   # Ou utilisez MongoDB Atlas pour une solution cloud
   ```

3. **Cloner le projet et installer les dépendances**
   ```bash
   git clone <votre-repo>
   cd wamessage
   npm install
   ```

4. **Installer les dépendances principales**
   ```bash
   npm install express mongodb @whiskeysockets/baileys
   ```

5. **Configuration**
   - Configurez votre base de données MongoDB
   - Configurez les paramètres de connexion WhatsApp
   - Définissez vos tâches cron selon vos besoins

6. **Démarrer le service**
   ```bash
   npm start
   ```

## Technologies utilisées

- **Node.js** - Runtime JavaScript
- **Express.js** - Framework web
- **MongoDB** - Base de données NoSQL
- **Baileys (@whiskeysockets/baileys)** - API WhatsApp Web

## Utilisation

Une fois installé et configuré, Wamessage vous permettra de :

- Connecter votre compte WhatsApp
- Créer des réponses automatiques
- Planifier l'envoi de messages
- Gérer vos contacts et conversations
- Automatiser diverses tâches liées à WhatsApp

## Support

Pour toute question ou problème, n'hésitez pas à ouvrir une issue dans ce repository.
