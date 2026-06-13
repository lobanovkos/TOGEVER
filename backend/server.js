const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Use polling + websocket. Polling is more reliable through proxies and Russian network filtering.
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 15000,
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), connections: io.engine.clientsCount });
});

app.get('/api/gifs', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ results: [] });
    const response = await fetch(`https://g.tenor.com/v1/search?key=LIVDSRZULELA&q=${encodeURIComponent(q)}&limit=12`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[SERVER] GIF proxy error:', err);
    res.status(500).json({ results: [] });
  }
});

const DIST = path.join(__dirname, '../frontend/dist');
app.use(express.static(DIST));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) res.status(200).json({ status: 'ok' });
  });
});

const socketRooms = new Map();
const roomHistory = new Map(); // Stores chat messages per room

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('join-room', (roomId) => {
    const alreadyInRoom = socket.rooms.has(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const peers = room ? Array.from(room).filter(id => id !== socket.id) : [];

    socket.join(roomId);
    socketRooms.set(socket.id, roomId);

    console.log(`[→] ${socket.id} joined "${roomId}" (peers: ${peers.length}, new: ${!alreadyInRoom})`);

    // Send chat history to the newly joined socket
    socket.emit('chat-history', roomHistory.get(roomId) || []);

    if (!alreadyInRoom) {
      peers.forEach(peerId => io.to(peerId).emit('user-connected', socket.id));
    }
  });

  socket.on('offer',          (p) => io.to(p.target).emit('offer', p));
  socket.on('answer',         (p) => io.to(p.target).emit('answer', p));
  socket.on('ice-candidate',  (p) => io.to(p.target).emit('ice-candidate', { candidate: p.candidate, sender: socket.id }));
  socket.on('stop-screen-share', (p) => io.to(p.target).emit('stop-screen-share'));
  
  socket.on('chat-message', (p) => {
    const roomId = socketRooms.get(socket.id);
    if (roomId) {
      if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
      roomHistory.get(roomId).push(p);
      if (roomHistory.get(roomId).length > 500) roomHistory.get(roomId).shift();
    }
    io.to(p.target).emit('chat-message', p);
  });
  
  socket.on('quality-request',(p) => io.to(p.target).emit('quality-request', p));

  socket.on('disconnect', (reason) => {
    console.log(`[-] ${socket.id} disconnected (${reason})`);
    const roomId = socketRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('user-disconnected', socket.id);
      socketRooms.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍿 TOGEVER running on port ${PORT}`);
});
