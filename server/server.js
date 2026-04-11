// ============================================================
// Hitster Online — Serveur WebSocket
// Node.js + ws + express
// ============================================================

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Servir les fichiers statiques du client
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.static(path.join(process.cwd(), 'client')));

// ────────────────────────────────────────────────────────────
// UTILITAIRES
// ────────────────────────────────────────────────────────────
function genCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg, excludeWs = null) {
  room.players.forEach(p => {
    if (p.ws !== excludeWs) send(p.ws, msg);
  });
}

function broadcastAll(room, msg) {
  room.players.forEach(p => send(p.ws, msg));
}

// ────────────────────────────────────────────────────────────
// ÉTAT DES SALLES
// ────────────────────────────────────────────────────────────
// rooms[code] = {
//   code, hostId, players[], playlist[], state: 'lobby'|'playing'|'finished',
//   gameState: { joueurs[], joueurActuelIndex, chansonActuelle, numeroTour,
//                maxSlots, pendingVictoryCheck, cartesDejaVisualisees[] }
// }
const rooms = {};

function getRoom(code) { return rooms[code]; }

function createGameState(joueurs, playlist) {
  const maxSlots = 10;
  // Donner à chaque joueur une carte de départ (position centrale 5)
  const shuffled = shuffle(playlist);
  joueurs.forEach(j => {
    const c = shuffled.shift();
    j.cartesPlacees = new Array(maxSlots).fill(null);
    j.cartesPlacees[5] = c || null;
    j.score = c ? 1 : 0;
    j.jetons = 0;
    j.jokers = 0;
    j._starterYear = c ? c.annee : Number.MAX_SAFE_INTEGER;
  });
  // Celui qui a la chanson la plus ancienne commence
  const minYear = Math.min(...joueurs.map(j => j._starterYear));
  const starterIndex = joueurs.findIndex(j => j._starterYear === minYear);
  joueurs.forEach(j => delete j._starterYear);

  // Chanson courante pour le premier joueur
  const chansonActuelle = shuffled.shift() || null;

  return {
    joueurs,
    joueurActuelIndex: starterIndex,
    starterIndex,
    chansonActuelle,
    playlist: shuffled,
    numeroTour: 1,
    maxSlots,
    pendingVictoryCheck: false,
    cartesDejaVisualisees: joueurs
      .map(j => j.cartesPlacees[5])
      .filter(Boolean)
      .map(c => `${c.artiste}|${c.titre}`),
    gameTermine: false,
    aReponduBlind: false,
    revealYear: false,
  };
}

// ────────────────────────────────────────────────────────────
// LOGIQUE JEU (côté serveur)
// ────────────────────────────────────────────────────────────
function placementValide(index, chanson, slots, maxSlots) {
  const gauche = [...slots].slice(0, index).filter(Boolean);
  const droite = [...slots].slice(index + 1).filter(Boolean);
  const maxG = gauche.length ? Math.max(...gauche.map(c => c.annee)) : -Infinity;
  const minD = droite.length ? Math.min(...droite.map(c => c.annee)) : Infinity;
  return chanson.annee >= maxG && chanson.annee <= minD;
}

function compterCartes(joueur) {
  return (joueur.cartesPlacees || []).filter(Boolean).length;
}

function verifierVictoire(gs) {
  const gagnants = gs.joueurs.filter(j => compterCartes(j) >= gs.maxSlots);
  if (!gagnants.length) return null;
  if (gagnants.length === 1) return gagnants[0];
  // Égalité — prolongation
  gs.maxSlots += 1;
  gs.joueurs.forEach(j => {
    while (j.cartesPlacees.length < gs.maxSlots) j.cartesPlacees.push(null);
  });
  return null; // pas encore de gagnant
}

// ────────────────────────────────────────────────────────────
// ENVOI DE L'ÉTAT COMPLET À TOUS
// ────────────────────────────────────────────────────────────
function broadcastGameState(room) {
  const gs = room.gameState;
  room.players.forEach(p => {
    // Chaque joueur reçoit l'état complet MAIS la chanson courante
    // n'est visible qu'au joueur actif (le reste reçoit null)
    const isActive = gs.joueurs[gs.joueurActuelIndex]?.id === p.id;
    send(p.ws, {
      type: 'GAME_STATE',
      gameState: {
        ...gs,
        // Masquer la chanson aux joueurs non-actifs
        chansonActuelle: isActive ? gs.chansonActuelle : null,
        // Toujours envoyer le titre/artiste/année APRÈS placement pour tous
      },
      myPlayerId: p.id,
    });
  });
}

// ────────────────────────────────────────────────────────────
// HANDLERS WebSocket
// ────────────────────────────────────────────────────────────
wss.on('connection', ws => {
  ws.id = Math.random().toString(36).substring(2, 10);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Créer une salle ──────────────────────────────────
      case 'CREATE_ROOM': {
        let code;
        do { code = genCode(); } while (rooms[code]);
        rooms[code] = {
          code,
          hostId: ws.id,
          players: [],
          state: 'lobby',
          gameState: null,
          songsData: msg.songsData || [], // le client envoie les chansons
        };
        rooms[code].players.push({
          id: ws.id, ws,
          name: msg.playerName || 'Joueur 1',
          ready: false,
        });
        ws.roomCode = code;
        send(ws, { type: 'ROOM_CREATED', code, playerId: ws.id });
        send(ws, { type: 'LOBBY_UPDATE', players: rooms[code].players.map(p => ({ id: p.id, name: p.name, ready: p.ready })), hostId: rooms[code].hostId });
        console.log(`Salle créée: ${code} par ${msg.playerName}`);
        break;
      }

      // ── Rejoindre une salle ──────────────────────────────
      case 'JOIN_ROOM': {
        const room = getRoom(msg.code);
        if (!room) { send(ws, { type: 'ERROR', message: 'Salle introuvable.' }); return; }
        if (room.state !== 'lobby') { send(ws, { type: 'ERROR', message: 'La partie a déjà commencé.' }); return; }
        if (room.players.length >= 8) { send(ws, { type: 'ERROR', message: 'Salle pleine (8 joueurs max).' }); return; }

        room.players.push({ id: ws.id, ws, name: msg.playerName || `Joueur ${room.players.length + 1}`, ready: false });
        ws.roomCode = msg.code;
        send(ws, { type: 'ROOM_JOINED', code: msg.code, playerId: ws.id });
        broadcastAll(room, {
          type: 'LOBBY_UPDATE',
          players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
          hostId: room.hostId,
        });
        console.log(`${msg.playerName} a rejoint ${msg.code}`);
        break;
      }

      // ── Démarrer la partie (hôte seulement) ─────────────
      case 'START_GAME': {
        const room = getRoom(ws.roomCode);
        if (!room || room.hostId !== ws.id) return;
        if (room.players.length < 2) { send(ws, { type: 'ERROR', message: 'Il faut au moins 2 joueurs.' }); return; }

        room.state = 'playing';
        const joueurs = room.players.map(p => ({ id: p.id, name: p.name, score: 0, cartesPlacees: [], jetons: 0, jokers: 0 }));
        room.gameState = createGameState(joueurs, room.songsData);

        broadcastAll(room, { type: 'GAME_STARTED' });
        broadcastGameState(room);
        console.log(`Partie démarrée: ${room.code}`);
        break;
      }

      // ── Placer une carte ─────────────────────────────────
      case 'PLACE_CARD': {
        const room = getRoom(ws.roomCode);
        if (!room || room.state !== 'playing') return;
        const gs = room.gameState;
        const joueur = gs.joueurs.find(j => j.id === ws.id);
        if (!joueur || gs.joueurs[gs.joueurActuelIndex].id !== ws.id) return;
        if (!gs.chansonActuelle) return;

        const { index } = msg;
        const slots = joueur.cartesPlacees;
        let success = false;

        if (placementValide(index, gs.chansonActuelle, slots, gs.maxSlots)) {
          joueur.cartesPlacees[index] = gs.chansonActuelle;
          joueur.score = Math.min(gs.maxSlots, (joueur.score || 0) + 1);
          success = true;
        }

        // Révéler la chanson à tous
        broadcastAll(room, {
          type: 'CARD_PLACED',
          playerId: ws.id,
          playerName: joueur.name,
          chanson: gs.chansonActuelle,
          index,
          success,
        });

        gs.aReponduBlind = true;
        gs.chansonActuelle = null;

        // Vérifier victoire
        if (success) {
          const gagnant = verifierVictoire(gs);
          if (gagnant) {
            gs.gameTermine = true;
            broadcastAll(room, { type: 'GAME_OVER', winner: gagnant.name, joueurs: gs.joueurs });
            room.state = 'finished';
            return;
          }
        }

        broadcastGameState(room);
        break;
      }

      // ── Répondre au blind test ───────────────────────────
      case 'BLIND_ANSWER': {
        const room = getRoom(ws.roomCode);
        if (!room || room.state !== 'playing') return;
        const gs = room.gameState;
        const joueur = gs.joueurs.find(j => j.id === ws.id);
        if (!joueur || gs.joueurs[gs.joueurActuelIndex].id !== ws.id) return;
        if (gs.aReponduBlind) return;

        gs.aReponduBlind = true;
        if (msg.correct) {
          joueur.jetons = (joueur.jetons || 0) + 1;
          if (joueur.jetons >= 3) {
            joueur.jokers = (joueur.jokers || 0) + Math.floor(joueur.jetons / 3);
            joueur.jetons = joueur.jetons % 3;
          }
        }
        broadcastGameState(room);
        break;
      }

      // ── Utiliser un joker ────────────────────────────────
      case 'USE_JOKER': {
        const room = getRoom(ws.roomCode);
        if (!room || room.state !== 'playing') return;
        const gs = room.gameState;
        const joueur = gs.joueurs.find(j => j.id === ws.id);
        if (!joueur || gs.joueurs[gs.joueurActuelIndex].id !== ws.id) return;
        if ((joueur.jokers || 0) <= 0 || !gs.chansonActuelle) return;

        joueur.jokers -= 1;
        gs.revealYear = true;
        broadcastGameState(room);
        break;
      }

      // ── Joueur suivant ───────────────────────────────────
      case 'NEXT_PLAYER': {
        const room = getRoom(ws.roomCode);
        if (!room || room.state !== 'playing') return;
        const gs = room.gameState;
        if (gs.joueurs[gs.joueurActuelIndex].id !== ws.id) return;

        // Avancer au joueur suivant
        const prevIndex = gs.joueurActuelIndex;
        gs.joueurActuelIndex = (gs.joueurActuelIndex + 1) % gs.joueurs.length;

        // Nouveau tour ?
        if (gs.joueurActuelIndex === gs.starterIndex) {
          gs.numeroTour += 1;
        }

        // Piocher une chanson pour le joueur suivant
        gs.chansonActuelle = gs.playlist.shift() || null;
        gs.aReponduBlind = false;
        gs.revealYear = false;

        if (gs.chansonActuelle) {
          gs.cartesDejaVisualisees.push(`${gs.chansonActuelle.artiste}|${gs.chansonActuelle.titre}`);
        }

        broadcastGameState(room);
        break;
      }

      // ── Demande audio (info seulement, l'audio est géré côté client) ──
      case 'PING': {
        send(ws, { type: 'PONG' });
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = getRoom(ws.roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== ws.id);
    if (room.players.length === 0) {
      delete rooms[ws.roomCode];
      console.log(`Salle ${ws.roomCode} supprimée (vide)`);
      return;
    }
    // Si l'hôte quitte, le prochain joueur devient hôte
    if (room.hostId === ws.id && room.players.length > 0) {
      room.hostId = room.players[0].id;
    }
    broadcastAll(room, {
      type: 'LOBBY_UPDATE',
      players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
      hostId: room.hostId,
    });
    if (room.state === 'playing' && room.gameState) {
      // Retirer le joueur de l'état de jeu
      room.gameState.joueurs = room.gameState.joueurs.filter(j => j.id !== ws.id);
      if (room.gameState.joueurs.length < 2) {
        broadcastAll(room, { type: 'ERROR', message: 'Pas assez de joueurs pour continuer.' });
        room.state = 'lobby';
      } else {
        if (room.gameState.joueurActuelIndex >= room.gameState.joueurs.length) {
          room.gameState.joueurActuelIndex = 0;
        }
        broadcastGameState(room);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────
// DÉMARRAGE
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Hitster Online — Serveur démarré sur le port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});
