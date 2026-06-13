const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Health check endpoint — Railway uses this to verify the server is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connections: io.engine.clientsCount, uptime: process.uptime() });
});

// Serve static files from the built React app
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Catch-all: return index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Increase timeouts for unstable connections (Russia ↔ Finland)
  pingTimeout: 30000,
  pingInterval: 10000,
});

io.on('connection', (socket) => {
  console.log(`[+] User connected: ${socket.id}`);

  socket.on('join-room', (roomId) => {
    // Find peers already in this room (before joining)
    const room = io.sockets.adapter.rooms.get(roomId);
    const peersInRoom = room ? Array.from(room).filter(id => id !== socket.id) : [];

    socket.join(roomId);
    console.log(`[→] ${socket.id} joined room "${roomId}" (${peersInRoom.length} peer(s) already there)`);

    // Notify existing peers that someone new joined
    peersInRoom.forEach(peerId => {
      io.to(peerId).emit('user-connected', socket.id);
    });
  });

  socket.on('offer', (payload) => {
    io.to(payload.target).emit('offer', payload);
  });

  socket.on('answer', (payload) => {
    io.to(payload.target).emit('answer', payload);
  });

  socket.on('ice-candidate', (incoming) => {
    io.to(incoming.target).emit('ice-candidate', {
      candidate: incoming.candidate,
      sender: socket.id
    });
  });

  socket.on('stop-screen-share', (payload) => {
    io.to(payload.target).emit('stop-screen-share');
  });

  socket.on('chat-message', (payload) => {
    io.to(payload.target).emit('chat-message', payload);
  });

  socket.on('quality-request', (payload) => {
    io.to(payload.target).emit('quality-request', payload);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[-] User disconnected: ${socket.id} (reason: ${reason})`);
    socket.broadcast.emit('user-disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍿 TOGEVER signaling server running on port ${PORT}`);
});
