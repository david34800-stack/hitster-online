# Hitster Online — Multijoueur en temps réel

Chaque joueur joue sur son propre téléphone ou tablette, connecté à la même partie via un code à 4 lettres.

---

## 🏗️ Architecture

```
hitster-online/
├── server/
│   ├── server.js        ← Serveur Node.js (WebSocket + Express)
│   └── package.json
└── client/
    ├── index.html       ← Application web complète (HTML/CSS/JS)
    └── data.js          ← ~1100 chansons
```

**Flux de données :**
```
Téléphone A ──WebSocket──┐
Téléphone B ──WebSocket──┤── Serveur Node.js ── État partagé de la partie
Téléphone C ──WebSocket──┘
```

---

## 🚀 Lancer le serveur

### Prérequis
- **Node.js 18+** : https://nodejs.org

### En local (test sur le même WiFi)
```bash
cd server/
npm install
npm start
```
Le serveur démarre sur `http://localhost:3000`

Les joueurs sur le **même réseau WiFi** ouvrent :
```
http://[IP-de-votre-machine]:3000
```
(Trouver votre IP : `ipconfig` sur Windows, `ifconfig` sur Mac/Linux)

### En ligne (joueurs à distance)

#### Option A — Render.com (gratuit, recommandé)
1. Créer un compte sur https://render.com
2. **New → Web Service**
3. Connecter ton repo GitHub (ou uploader les fichiers)
4. Configurer :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Root Directory** : `server`
5. Copier l'URL générée (ex: `https://hitster-online.onrender.com`)
6. Mettre à jour la ligne dans `client/index.html` si besoin

#### Option B — Railway.app
```bash
npm install -g railway
cd server/
railway login
railway init
railway up
```

#### Option C — VPS (Scaleway, OVH, etc.)
```bash
# Sur le VPS
node server.js &

# Avec PM2 (redémarrage automatique)
npm install -g pm2
pm2 start server.js --name hitster
pm2 save
```

---

## 🎮 Comment jouer

1. **L'hôte** ouvre l'URL du jeu, entre son prénom, clique **"Créer une partie"**
2. Un **code à 4 lettres** s'affiche (ex: `AB3X`)
3. Les **autres joueurs** ouvrent la même URL, entrent leur prénom et le code
4. L'hôte clique **"Démarrer"** quand tout le monde est connecté
5. Chaque joueur joue **sur son propre écran** à tour de rôle

---

## 🔧 Fonctionnement

| Action | Où ça se passe |
|---|---|
| Pioche d'une chanson | Serveur (évite les doublons) |
| Lecture audio (iTunes) | Client (chaque téléphone joue l'audio) |
| Placement d'une carte | Client → Serveur → Tous les clients |
| Blind test | Client → Serveur (jetons/jokers synchronisés) |
| Scores & frises | Synchronisés en temps réel sur tous les écrans |

---

## ⚠️ Notes importantes

- Le serveur **Render gratuit** se met en veille après 15 min d'inactivité → premier chargement lent (~30 sec)
- Les chansons sont envoyées par l'hôte au démarrage (≈ 200 Ko)
- Connexion Internet requise pour les extraits audio iTunes
- Compatible iPhone (Safari), Android (Chrome), tablette
