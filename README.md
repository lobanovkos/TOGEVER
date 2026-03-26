# 🍿 TOGEVER - P2P Watch Party

A modern, lightning-fast WebRTC Watch Party application that lets you and your friends watch movies and chat together with zero latency. 
Designed specifically to fix the lag and sync issues of existing platforms by creating a direct Peer-to-Peer tunnel between users.

## 🚀 Key Features

*   **P2P Screen & Audio Sharing**: Ultra-low latency streaming using WebRTC. No middleman servers eating up video bitrate.
*   **Voice Chat**: Real-time, echo-cancelled voice communication.
*   **Picture-in-Picture (PiP)**: Keep watching while browsing other tabs or apps.
*   **Cinematic Mode**: Zoom-to-fill features to eliminate black bars and immerse yourself in the movie.
*   **Text Chat**: Integrated real-time messaging so you don't have to switch apps.
*   **Independent Volume Control**: Balance the movie and voice chat perfectly.

## 🛠 Tech Stack

*   **Frontend**: React 18, Vite, Tailwind CSS, Framer Motion, Lucide React.
*   **Backend / Signaling**: Node.js, Express, Socket.IO.
*   **Protocol**: WebRTC (Google STUN).

## 📦 Local Development

1. Clone the repository.
2. Install backend dependencies: `cd backend && npm install`
3. Install frontend dependencies: `cd frontend && npm install`
4. Run the signaling server: `cd backend && node server.js`
5. Start the frontend dev server: `cd frontend && npm run dev`

## ☁️ Deployment (Render / Cloud)

This project is configured as a Monorepo and is ready for 1-click deployment on Render as a **Web Service**.
The backend Express server automatically serves the compiled React frontend payload.

*   **Build Command**: `npm run build` (Automatically fetches sub-dependencies and compiles React)
*   **Start Command**: `npm start` (Runs the backend server)
