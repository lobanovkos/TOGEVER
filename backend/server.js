const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../frontend/dist')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // For MVP, we allow all origins
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
    // Notify other users in the room
    socket.to(roomId).emit('user-connected', socket.id);
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    socket.broadcast.emit('user-disconnected', socket.id);
  });
});



const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT} (bind 0.0.0.0)`);
});
