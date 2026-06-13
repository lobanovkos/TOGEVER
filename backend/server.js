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
  pingTimeout: 30000,
  pingInterval: 10000,
});

// ── Health check (must be defined after io so io.engine exists) ───────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// ── Serve built frontend ───────────────────────────────────────────────────────
const DIST = path.join(__dirname, '../frontend/dist');
app.use(express.static(DIST));
// SPA fallback — must be LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) res.status(200).json({ status: 'ok' }); // graceful fallback if dist not built yet
  });
});

// ── WebRTC Signaling ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('join-room', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const peers = room ? Array.from(room).filter(id => id !== socket.id) : [];
    socket.join(roomId);
    console.log(`[→] ${socket.id} joined room "${roomId}" (${peers.length} peer(s))`);
    peers.forEach(peerId => io.to(peerId).emit('user-connected', socket.id));
  });

  socket.on('offer',         (p) => io.to(p.target).emit('offer', p));
  socket.on('answer',        (p) => io.to(p.target).emit('answer', p));
  socket.on('ice-candidate', (p) => io.to(p.target).emit('ice-candidate', { candidate: p.candidate, sender: socket.id }));
  socket.on('stop-screen-share', (p) => io.to(p.target).emit('stop-screen-share'));
  socket.on('chat-message',  (p) => io.to(p.target).emit('chat-message', p));
  socket.on('quality-request',(p) => io.to(p.target).emit('quality-request', p));

  socket.on('disconnect', (reason) => {
    console.log(`[-] ${socket.id} disconnected (${reason})`);
    socket.broadcast.emit('user-disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍿 TOGEVER running on port ${PORT}`);
});
