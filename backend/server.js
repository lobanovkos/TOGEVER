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
  // Increase timeouts so Railway proxy doesn't kill idle WebSocket connections
  pingTimeout: 60000,
  pingInterval: 25000,
  // Allow both websocket and polling so Railway doesn't cut the connection
  transports: ['websocket', 'polling'],
  // Upgrade timeout
  upgradeTimeout: 30000,
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), connections: io.engine.clientsCount });
});

// Serve built frontend
const DIST = path.join(__dirname, '../frontend/dist');
app.use(express.static(DIST));
// SPA fallback (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) res.status(200).json({ status: 'ok' });
  });
});

// Track which room each socket is in (for disconnect cleanup)
const socketRooms = new Map();

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('join-room', (roomId) => {
    // Leave any previous room first
    const prevRoom = socketRooms.get(socket.id);
    if (prevRoom && prevRoom !== roomId) {
      socket.leave(prevRoom);
      socket.to(prevRoom).emit('user-disconnected', socket.id);
    }

    const room = io.sockets.adapter.rooms.get(roomId);
    const peers = room ? Array.from(room).filter(id => id !== socket.id) : [];

    socket.join(roomId);
    socketRooms.set(socket.id, roomId);

    console.log(`[→] ${socket.id} joined room "${roomId}" (${peers.length} peer(s))`);

    // Tell existing peers someone new joined
    peers.forEach(peerId => io.to(peerId).emit('user-connected', socket.id));
  });

  socket.on('offer',          (p) => io.to(p.target).emit('offer', p));
  socket.on('answer',         (p) => io.to(p.target).emit('answer', p));
  socket.on('ice-candidate',  (p) => io.to(p.target).emit('ice-candidate', { candidate: p.candidate, sender: socket.id }));
  socket.on('stop-screen-share', (p) => io.to(p.target).emit('stop-screen-share'));
  socket.on('chat-message',   (p) => io.to(p.target).emit('chat-message', p));
  socket.on('quality-request',(p) => io.to(p.target).emit('quality-request', p));

  socket.on('disconnect', (reason) => {
    console.log(`[-] ${socket.id} disconnected (${reason})`);

    // Only notify peers in the SAME room (not everyone on the server!)
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
