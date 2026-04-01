import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { MonitorUp, Mic, MicOff, PhoneOff, Copy, Check, Tv, Loader2, MonitorOff, Maximize, ZoomIn, ZoomOut, Settings, MessageCircle, Volume2, VolumeX, PictureInPicture, Send, Activity, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Helper: color class by threshold ───
// higherIsBetter=true  → value >= green is good (FPS, Bitrate)
// higherIsBetter=false → value <= green is good (RTT, Packet Loss, Jitter)
const statusColor = (value, greenThresh, yellowThresh, higherIsBetter = true) => {
  if (value === null || value === undefined) return 'text-neutral-500';
  if (higherIsBetter) {
    if (value >= greenThresh) return 'text-green-400';
    if (value >= yellowThresh) return 'text-yellow-400';
    return 'text-red-400';
  } else {
    if (value <= greenThresh) return 'text-green-400';
    if (value <= yellowThresh) return 'text-yellow-400';
    return 'text-red-400';
  }
};

const dotColor = (value, greenThresh, yellowThresh, higherIsBetter = true) => {
  if (value === null || value === undefined) return 'bg-neutral-500';
  if (higherIsBetter) {
    if (value >= greenThresh) return 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]';
    if (value >= yellowThresh) return 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.6)]';
    return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]';
  } else {
    if (value <= greenThresh) return 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]';
    if (value <= yellowThresh) return 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.6)]';
    return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]';
  }
};

const SOCKET_SERVER_URL = import.meta.env.DEV ? 'http://localhost:5000' : '/';

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const [isMicMuted, setIsMicMuted] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  // Enhancement States
  const [isZoomed, setIsZoomed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [streamQuality, setStreamQuality] = useState('1080p');
  const [showStats, setShowStats] = useState(false);
  const [networkStats, setNetworkStats] = useState({
    fps: 0, bitrate: 0, resolution: 'N/A',
    rtt: 0, packetLoss: 0, jitter: 0,
    connectionType: 'N/A', iceState: 'new',
    totalBytesReceived: 0,
  });
  const [autoDowngraded, setAutoDowngraded] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // New Features States
  const [volume, setVolume] = useState(1);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  const socketRef = useRef();
  const pcRef = useRef();
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const audioElementsRef = useRef([]);
  const pendingCandidates = useRef([]);
  const videoContainerRef = useRef(null);
  const chatBottomRef = useRef(null);
  const signalingQueue = useRef(Promise.resolve());
  const remoteSocketIdRef = useRef(null);
  const statsBaselineRef = useRef({ bytesReceived: 0, timestamp: 0 });

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL);

    socketRef.current.on('connect', () => console.log('Socket connected'));

    socketRef.current.on('user-connected', (id) => {
      setRemoteSocketId(id);
      remoteSocketIdRef.current = id;
      setIsConnected(true);
      setTimeout(() => createPeerConnection(id), 500);
    });

    socketRef.current.on('offer', (payload) => {
      signalingQueue.current = signalingQueue.current.then(async () => {
        setRemoteSocketId(payload.caller);
        remoteSocketIdRef.current = payload.caller;
        setIsConnected(true);
        const pc = createPeerConnection(payload.caller);
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }).catch(() => { })
          ]);
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        pendingCandidates.current.forEach(c => pc.addIceCandidate(c).catch(console.error));
        pendingCandidates.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit('answer', { target: payload.caller, sdp: pc.localDescription });
      }).catch(console.error);
    });

    socketRef.current.on('answer', (payload) => {
      signalingQueue.current = signalingQueue.current.then(async () => {
        if (pcRef.current && pcRef.current.signalingState !== "stable") {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          pendingCandidates.current.forEach(c => pcRef.current.addIceCandidate(c).catch(console.error));
          pendingCandidates.current = [];
        }
      }).catch(console.error);
    });

    socketRef.current.on('ice-candidate', async (payload) => {
      if (pcRef.current) {
        try {
          const candidate = new RTCIceCandidate(payload.candidate);
          if (pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(candidate);
          } else {
            pendingCandidates.current.push(candidate);
          }
        } catch (e) {
          console.error("Error handling ice candidate:", e);
        }
      }
    });

    socketRef.current.on('stop-screen-share', () => setHasRemoteVideo(false));

    // Quality request from peer (they want us to change our sending quality)
    socketRef.current.on('quality-request', (payload) => {
      console.log('[TOGEVER] Peer requested quality:', payload.preset);
      const presets = {
        '2K (Ultra)': { scale: 1, bitrate: 15000000 },
        '1080p': { scale: 1, bitrate: 8000000 },
        '720p': { scale: 1.5, bitrate: 2500000 },
        '480p': { scale: 2.25, bitrate: 1000000 },
      };
      const params = presets[payload.preset];
      if (params) {
        setStreamQuality(payload.preset);
        updateVideoQuality(params);
      }
    });

    socketRef.current.on('chat-message', (payload) => {
      setChatMessages(prev => [...prev, { text: payload.text, sender: 'peer', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      setIsChatOpen(true);
    });

    socketRef.current.on('user-disconnected', () => {
      setRemoteSocketId(null);
      setIsConnected(false);
      setHasRemoteVideo(false);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      audioElementsRef.current.forEach(el => { el.srcObject = null; });
      audioElementsRef.current = [];
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) setRoomId(roomFromUrl);

    return () => {
      socketRef.current.disconnect();
      audioElementsRef.current.forEach(el => { el.srcObject = null; });
      audioElementsRef.current = [];
    };
  }, []);

  // ─── Stats collection: ALWAYS runs when connected (fixes empty-data-on-first-open bug) ───
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!pcRef.current) return;

      try {
        const stats = await pcRef.current.getStats();
        let currentBytesReceived = 0;
        let currentFps = 0;
        let currentResolution = 'N/A';
        let currentRtt = 0;
        let currentPacketLoss = 0;
        let currentJitter = 0;
        let currentConnectionType = 'N/A';
        let packetsReceived = 0;
        let packetsLost = 0;

        stats.forEach(report => {
          // Video inbound stats (FPS, resolution, packets)
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            currentBytesReceived = report.bytesReceived || 0;
            currentFps = report.framesPerSecond || 0;
            // Fix: read resolution from inbound-rtp directly (report.type='track' is deprecated)
            if (report.frameWidth && report.frameHeight) {
              currentResolution = `${report.frameWidth}x${report.frameHeight}`;
            }
            currentJitter = report.jitter ? (report.jitter * 1000) : 0; // convert to ms
            packetsReceived = report.packetsReceived || 0;
            packetsLost = report.packetsLost || 0;
          }
          // Candidate pair stats (RTT, connection type)
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            currentRtt = report.currentRoundTripTime ? (report.currentRoundTripTime * 1000) : 0; // convert to ms
          }
          // Local candidate (connection type: host/srflx/relay)
          if (report.type === 'local-candidate' && report.candidateType) {
            currentConnectionType = report.candidateType;
          }
        });

        // Calculate bitrate from delta
        const prev = statsBaselineRef.current;
        let bitrateMbps = 0;
        const now = performance.now();
        if (prev.bytesReceived > 0 && currentBytesReceived > prev.bytesReceived) {
          const timeDiffMs = now - prev.timestamp;
          if (timeDiffMs > 0) {
            const bytesDiff = currentBytesReceived - prev.bytesReceived;
            bitrateMbps = parseFloat(((bytesDiff * 8) / (timeDiffMs * 1000)).toFixed(2));
          }
        }
        statsBaselineRef.current = { bytesReceived: currentBytesReceived, timestamp: now };

        // Packet loss %
        const totalPackets = packetsReceived + packetsLost;
        currentPacketLoss = totalPackets > 0 ? parseFloat(((packetsLost / totalPackets) * 100).toFixed(1)) : 0;

        // Map connection type to human-readable
        const typeMap = { host: 'P2P (Direct)', srflx: 'P2P (STUN)', relay: 'Relay (TURN)', prflx: 'P2P (Peer)' };
        const connectionLabel = typeMap[currentConnectionType] || currentConnectionType;

        setNetworkStats({
          fps: Math.round(currentFps),
          bitrate: bitrateMbps,
          resolution: currentResolution,
          rtt: Math.round(currentRtt),
          packetLoss: currentPacketLoss,
          jitter: parseFloat(currentJitter.toFixed(1)),
          connectionType: connectionLabel,
          iceState: pcRef.current ? pcRef.current.iceConnectionState : 'closed',
          totalBytesReceived: currentBytesReceived,
        });

        // Auto-downgrade quality if network is bad
        if (bitrateMbps > 0 && bitrateMbps < 1.0 && currentPacketLoss > 3 && !autoDowngraded) {
          console.warn('[TOGEVER] Bad network detected, auto-downgrading to 480p');
          setAutoDowngraded(true);
          setStreamQuality('480p');
          updateVideoQuality({ scale: 2.25, bitrate: 1000000 });
        }
        // Auto-upgrade back when network recovers
        if (autoDowngraded && bitrateMbps > 3.0 && currentPacketLoss < 1) {
          console.log('[TOGEVER] Network recovered, restoring quality to 1080p');
          setAutoDowngraded(false);
          setStreamQuality('1080p');
          updateVideoQuality({ scale: 1, bitrate: 8000000 });
        }
      } catch (e) {
        // Silently ignore stats errors (PC might be closing)
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [autoDowngraded]);

  const createPeerConnection = (targetId) => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.rs:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.rs:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.rs:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) socketRef.current.emit('ice-candidate', { target: targetId, candidate: event.candidate });
    };

    // ─── Connection state monitoring + auto-reconnect ───
    pc.onconnectionstatechange = () => {
      console.log('[TOGEVER] Connection state:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.warn('[TOGEVER] Connection failed! Attempting reconnect...');
        setReconnecting(true);
        // Close old PC and create new one
        pc.close();
        pcRef.current = null;
        statsBaselineRef.current = { bytesReceived: 0, timestamp: 0 };
        // Reconnect after a short delay
        setTimeout(() => {
          const tid = remoteSocketIdRef.current;
          if (tid) {
            const newPc = createPeerConnection(tid);
            // Re-add existing tracks
            if (localStreamRef.current) {
              localStreamRef.current.getTracks().forEach(track => {
                try { newPc.addTrack(track, localStreamRef.current); } catch(e) {}
              });
            }
            setReconnecting(false);
          }
        }, 2000);
      }
      if (pc.connectionState === 'connected') {
        setReconnecting(false);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[TOGEVER] ICE state:', pc.iceConnectionState);
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        if (!remoteVideoRef.current.srcObject) remoteVideoRef.current.srcObject = new MediaStream();
        remoteVideoRef.current.srcObject.addTrack(event.track);
        setHasRemoteVideo(true);
        event.track.onmute = () => setHasRemoteVideo(false);
        event.track.onunmute = () => setHasRemoteVideo(true);
        event.track.onended = () => {
          if (!remoteVideoRef.current.srcObject || remoteVideoRef.current.srcObject.getVideoTracks().filter(t => t.readyState === 'live').length === 0) {
            setHasRemoteVideo(false);
          }
        };
      } else if (event.track.kind === 'audio') {
        const audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.srcObject = new MediaStream([event.track]);
        audioEl.volume = remoteVideoRef.current ? remoteVideoRef.current.volume : 1;
        audioElementsRef.current.push(audioEl);

        event.track.onended = () => {
          audioEl.srcObject = null;
          audioElementsRef.current = audioElementsRef.current.filter(el => el !== audioEl);
        };
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('offer', { target: targetId, caller: socketRef.current.id, sdp: pc.localDescription });
      } catch (err) { }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    pcRef.current = pc;
    return pc;
  };

  const joinRoom = (e) => {
    if (e) e.preventDefault();
    const generatedRoomId = roomId || Math.random().toString(36).substring(2, 9);
    setRoomId(generatedRoomId);
    socketRef.current.emit('join-room', generatedRoomId);
    setInRoom(true);
    window.history.pushState({}, '', `?room=${generatedRoomId}`);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    audioElementsRef.current.forEach(el => { el.srcObject = null; });
    audioElementsRef.current = [];

    setInRoom(false);
    setIsMicMuted(true);
    setIsScreenSharing(false);
    setIsConnected(false);
    setRemoteSocketId(null);
    setHasRemoteVideo(false);
    setChatMessages([]);
    window.history.pushState({}, '', '/');
  };

  const toggleMic = async () => {
    if (isMicMuted) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        localStreamRef.current.addTrack(track);
        if (pcRef.current) pcRef.current.addTrack(track, localStreamRef.current);
        setIsMicMuted(false);
      } catch (e) {
        console.error("Mic error:", e);
        alert("ОШИБКА: Браузер запретил доступ к микрофону! Зайди в Системные Настройки Mac OS -> Конфиденциальность -> Микрофон и разреши браузеру использовать микрофон.");
      }
    } else {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.stop();
          if (pcRef.current) {
            const sender = pcRef.current.getSenders().find(s => s.track === track);
            if (sender) pcRef.current.removeTrack(sender);
          }
          localStreamRef.current.removeTrack(track);
        });
        setIsMicMuted(true);
      }
    }
  };

  const stopScreenSharingLogic = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => {
        track.stop();
        if (pcRef.current) {
          const sender = pcRef.current.getSenders().find(s => s.track === track);
          if (sender) pcRef.current.removeTrack(sender);
        }
        if (localStreamRef.current) localStreamRef.current.removeTrack(track);
      });
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    socketRef.current.emit('stop-screen-share', { target: remoteSocketId });
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            cursor: "always", 
            frameRate: { ideal: 60, max: 60 },
            height: { ideal: 1440, max: 1440 },
            displaySurface: "monitor" 
          },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        screenStreamRef.current = stream;
        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        stream.getTracks().forEach(track => {
          localStreamRef.current.addTrack(track);
          if (pcRef.current) pcRef.current.addTrack(track, localStreamRef.current);
          track.onended = () => {
            if (screenStreamRef.current) stopScreenSharingLogic();
          };
        });
        setIsScreenSharing(true);
      } catch (e) { }
    } else {
      stopScreenSharingLogic();
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      videoContainerRef.current?.requestFullscreen().catch(e => console.error(e));
    } else {
      document.exitFullscreen();
    }
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (remoteVideoRef.current && hasRemoteVideo) {
        await remoteVideoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.error("PiP error:", e);
    }
  };

  const updateVideoQuality = async (paramsObj) => {
    if (!pcRef.current) return;
    const senders = pcRef.current.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      const params = videoSender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].scaleResolutionDownBy = paramsObj.scale;

      if (paramsObj.bitrate) {
        params.encodings[0].maxBitrate = paramsObj.bitrate;
      } else {
        if (params.encodings[0].maxBitrate) delete params.encodings[0].maxBitrate;
      }
      try {
        await videoSender.setParameters(params);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const setQuality = (preset) => {
    setStreamQuality(preset);
    const presets = {
      '2K (Ultra)': { scale: 1, bitrate: 15000000 },
      '1080p': { scale: 1, bitrate: 8000000 },
      '720p': { scale: 1.5, bitrate: 2500000 },
      '480p': { scale: 2.25, bitrate: 1000000 },
    };
    const params = presets[preset];
    if (params) {
      updateVideoQuality(params);
      // Also request the peer to change their sending quality (works for receiver too)
      if (remoteSocketId) {
        socketRef.current.emit('quality-request', { target: remoteSocketId, preset });
      }
    }
    setShowSettings(false);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = { text: chatInput.trim(), sender: 'me', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setChatMessages(prev => [...prev, msg]);
    socketRef.current.emit('chat-message', { target: remoteSocketId, text: chatInput.trim() });
    setChatInput('');
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-purple-500/30 overflow-hidden relative flex flex-col items-center">
      <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-purple-600/20 blur-[150px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40vw] h-[40vw] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />

      <header className="w-full max-w-6xl mx-auto p-6 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-tr from-purple-500 to-blue-500 p-2 rounded-xl">
            <Tv className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">
            TOGEVER
          </h1>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 flex items-center justify-center z-10 relative">
        <AnimatePresence mode="wait">
          {!inRoom ? (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-white/5 border border-white/10 backdrop-blur-xl rounded-3xl p-8 shadow-2xl"
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-semibold mb-2">Watch Party</h2>
                <p className="text-neutral-400">Create or join a room to sync up your screens and voices.</p>
              </div>

              <form onSubmit={joinRoom} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-2">Room Code</label>
                  <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Enter code or leave blank to create"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all text-white placeholder-neutral-600"
                  />
                </div>

                <button type="submit" className="w-full bg-white text-black font-semibold rounded-xl py-3 hover:bg-neutral-200 transition-colors">
                  {roomId ? 'Join Room' : 'Create New Room'}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="room"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full flex flex-col h-[85vh] bg-black/40 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-white/[0.02] shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)] animate-pulse'}`} />
                  <span className="font-medium text-sm text-neutral-300">
                    {isConnected ? 'Brother Connected' : 'Waiting for Brother...'}
                  </span>
                </div>

                <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors" onClick={copyLink}>
                  <span className="text-sm font-mono text-neutral-300">Room: {roomId}</span>
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-purple-400" />}
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex relative">
                {/* Video Area */}
                <div ref={videoContainerRef} className="flex-1 bg-black flex items-center justify-center overflow-hidden group relative">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={`w-full h-full transition-all duration-300 ease-in-out ${isZoomed ? 'object-cover' : 'object-contain'} ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
                  />

                  {hasRemoteVideo && (
                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      <button onClick={togglePiP} className="p-3 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white rounded-xl transition-all" title="Picture in Picture">
                        <PictureInPicture className="w-5 h-5" />
                      </button>
                      <button onClick={() => setIsZoomed(!isZoomed)} className="p-3 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white rounded-xl transition-all" title={isZoomed ? "Fit to Screen" : "Fill Screen (Crop edges)"}>
                        {isZoomed ? <ZoomOut className="w-5 h-5" /> : <ZoomIn className="w-5 h-5" />}
                      </button>
                      <button onClick={toggleFullscreen} className="p-3 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white rounded-xl transition-all" title="Toggle Fullscreen">
                        <Maximize className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {/* ═══════ DEBUG HUD OVERLAY ═══════ */}
                  <AnimatePresence>
                    {showStats && (
                      <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.25 }}
                        className="absolute top-4 left-4 z-50 pointer-events-none select-none"
                      >
                        <div className="bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl p-4 min-w-[280px] font-mono text-xs leading-relaxed shadow-2xl">
                          {/* Header */}
                          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
                            <Activity className="w-4 h-4 text-purple-400" />
                            <span className="font-sans font-semibold text-sm text-neutral-200 tracking-wide">TOGEVER Debug</span>
                            {reconnecting && (
                              <span className="ml-auto flex items-center gap-1 text-yellow-400">
                                <RefreshCw className="w-3 h-3 animate-spin" /> Reconnecting...
                              </span>
                            )}
                            {autoDowngraded && (
                              <span className="ml-auto text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full border border-orange-500/30">AUTO 480p</span>
                            )}
                          </div>

                          {/* Stats Grid */}
                          <div className="space-y-1.5">
                            {/* FPS */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">FPS</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${statusColor(networkStats.fps, 30, 20, true)}`}>{networkStats.fps}</span>
                                <div className={`w-2 h-2 rounded-full ${dotColor(networkStats.fps, 30, 20, true)}`} />
                              </div>
                            </div>

                            {/* Bitrate */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Bitrate</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${statusColor(networkStats.bitrate, 3, 1, true)}`}>{networkStats.bitrate} <span className="text-[10px] text-neutral-600">Mbps</span></span>
                                <div className={`w-2 h-2 rounded-full ${dotColor(networkStats.bitrate, 3, 1, true)}`} />
                              </div>
                            </div>

                            {/* Resolution */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Resolution</span>
                              <span className="text-purple-400 font-semibold">{networkStats.resolution}</span>
                            </div>

                            {/* Divider */}
                            <div className="border-t border-white/5 my-1" />

                            {/* RTT / Ping */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Ping (RTT)</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${statusColor(networkStats.rtt, 50, 100, false)}`}>{networkStats.rtt} <span className="text-[10px] text-neutral-600">ms</span></span>
                                <div className={`w-2 h-2 rounded-full ${dotColor(networkStats.rtt, 50, 100, false)}`} />
                              </div>
                            </div>

                            {/* Packet Loss */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Packet Loss</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${statusColor(networkStats.packetLoss, 1, 5, false)}`}>{networkStats.packetLoss}<span className="text-[10px] text-neutral-600">%</span></span>
                                <div className={`w-2 h-2 rounded-full ${dotColor(networkStats.packetLoss, 1, 5, false)}`} />
                              </div>
                            </div>

                            {/* Jitter */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Jitter</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-sm ${statusColor(networkStats.jitter, 10, 30, false)}`}>{networkStats.jitter} <span className="text-[10px] text-neutral-600">ms</span></span>
                                <div className={`w-2 h-2 rounded-full ${dotColor(networkStats.jitter, 10, 30, false)}`} />
                              </div>
                            </div>

                            {/* Divider */}
                            <div className="border-t border-white/5 my-1" />

                            {/* Connection Type */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Connection</span>
                              <div className="flex items-center gap-2">
                                {networkStats.connectionType.includes('Relay') ? (
                                  <WifiOff className="w-3 h-3 text-yellow-400" />
                                ) : (
                                  <Wifi className="w-3 h-3 text-green-400" />
                                )}
                                <span className={`font-semibold ${networkStats.connectionType.includes('Relay') ? 'text-yellow-400' : 'text-green-400'}`}>
                                  {networkStats.connectionType}
                                </span>
                              </div>
                            </div>

                            {/* ICE State */}
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">ICE State</span>
                              <span className={`font-semibold ${
                                networkStats.iceState === 'connected' || networkStats.iceState === 'completed' ? 'text-green-400' :
                                networkStats.iceState === 'checking' ? 'text-yellow-400' :
                                networkStats.iceState === 'failed' || networkStats.iceState === 'disconnected' ? 'text-red-400' :
                                'text-neutral-500'
                              }`}>{networkStats.iceState}</span>
                            </div>
                          </div>

                          {/* Warnings */}
                          {networkStats.connectionType.includes('Relay') && (
                            <div className="mt-3 text-[10px] text-yellow-400 bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/20">
                              ⚠ TURN relay — slower than direct P2P. Check VPN or firewall.
                            </div>
                          )}
                          {networkStats.bitrate > 0 && networkStats.bitrate < 1.0 && (
                            <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                              🔴 Low bandwidth! Video may be pixelated or laggy.
                            </div>
                          )}
                          {networkStats.packetLoss > 5 && (
                            <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                              🔴 High packet loss ({networkStats.packetLoss}%)! Network is unstable.
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Reconnecting overlay */}
                  {reconnecting && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-40 pointer-events-none">
                      <RefreshCw className="w-10 h-10 text-yellow-400 animate-spin mb-4" />
                      <p className="text-yellow-400 text-lg font-semibold">Reconnecting...</p>
                      <p className="text-neutral-500 text-sm mt-1">Connection lost, trying to restore</p>
                    </div>
                  )}

                  {!isConnected && !reconnecting && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 pointer-events-none bg-black">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p>Send the link so your brother can join</p>
                    </div>
                  )}

                  {isConnected && !hasRemoteVideo && !isScreenSharing && !reconnecting && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-600 bg-black pointer-events-none">
                      <MonitorOff className="w-12 h-12 mb-4 opacity-50" />
                      <p>Waiting for someone to share their screen...</p>
                    </div>
                  )}

                  {isConnected && isScreenSharing && !hasRemoteVideo && !reconnecting && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-purple-400 bg-black pointer-events-none">
                      <MonitorUp className="w-16 h-16 mb-4 animate-pulse opacity-80" />
                      <p className="text-xl font-semibold">You are sharing your screen</p>
                      <p className="text-neutral-500 text-sm mt-2">Your brother is watching</p>
                    </div>
                  )}
                </div>

                {/* Chat Panel */}
                <AnimatePresence>
                  {isChatOpen && (
                    <motion.div
                      className="w-80 bg-black/80 border-l border-white/5 flex flex-col z-20 backdrop-blur-md"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 320, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                    >
                      <div className="p-4 border-b border-white/5 font-semibold flex items-center justify-between">
                        <span className="text-neutral-200">Chat</span>
                      </div>
                      <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 min-w-[320px]">
                        {chatMessages.length === 0 && (
                          <div className="text-center text-neutral-600 text-sm mt-10">No messages yet. Say hi!</div>
                        )}
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}>
                            <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${msg.sender === 'me' ? 'bg-purple-600 text-white rounded-br-none' : 'bg-zinc-800 text-neutral-200 rounded-bl-none'}`}>
                              {msg.text}
                            </div>
                            <span className="text-[10px] text-neutral-500 mt-1">{msg.time}</span>
                          </div>
                        ))}
                        <div ref={chatBottomRef} />
                      </div>
                      <form onSubmit={handleSendMessage} className="p-3 border-t border-white/5 bg-black/50 flex gap-2 w-[320px]">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Type a message..."
                          className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-base outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <button type="submit" className="bg-purple-600 p-2 rounded-lg hover:bg-purple-500 transition"><Send className="w-4 h-4" /></button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Controls Bar */}
              <div className="h-20 bg-black/60 border-t border-white/5 flex items-center px-6 relative shrink-0">

                {/* Volume Control */}
                <div className="flex items-center gap-3 bg-zinc-800/80 rounded-full px-4 py-3 mr-auto">
                  <button onClick={() => {
                    const newVol = volume === 0 ? 1 : 0;
                    setVolume(newVol);
                    if (remoteVideoRef.current) remoteVideoRef.current.volume = newVol;
                    audioElementsRef.current.forEach(el => el.volume = newVol);
                  }}>
                    {volume === 0 ? <VolumeX className="w-5 h-5 text-neutral-400" /> : <Volume2 className="w-5 h-5 text-neutral-300" />}
                  </button>
                  <input
                    type="range" min="0" max="1" step="0.05" value={volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      if (remoteVideoRef.current) remoteVideoRef.current.volume = val;
                      audioElementsRef.current.forEach(el => el.volume = val);
                    }}
                    className="w-20 lg:w-32 accent-purple-500 cursor-pointer"
                  />
                </div>

                {/* Center Controls */}
                <div className="flex items-center gap-4 absolute left-1/2 -translate-x-1/2">
                  <button onClick={toggleMic} className={`p-4 rounded-full transition-all ${isMicMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                    {isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                  <button onClick={toggleScreenShare} className={`p-4 rounded-full transition-all ${isScreenSharing ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(147,51,234,0.5)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                    <MonitorUp className="w-6 h-6" />
                  </button>
                  <button onClick={() => setIsChatOpen(!isChatOpen)} className={`p-4 rounded-full transition-all ${isChatOpen ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                    <MessageCircle className="w-6 h-6" />
                  </button>
                </div>

                {/* Right Controls */}
                <div className="ml-auto flex items-center gap-4">
                  <button onClick={() => setShowStats(!showStats)} className={`p-4 rounded-full transition-all relative ${showStats ? 'bg-green-600/30 text-green-400 shadow-[0_0_12px_rgba(74,222,128,0.3)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`} title="Toggle Debug HUD">
                    <Activity className="w-6 h-6" />
                    {/* Mini indicator dot when stats show problems */}
                    {isConnected && networkStats.bitrate > 0 && (networkStats.bitrate < 1 || networkStats.packetLoss > 5 || networkStats.fps < 15) && !showStats && (
                      <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                    )}
                  </button>
                  <button onClick={() => setShowSettings(!showSettings)} className={`p-4 rounded-full transition-all ${showSettings ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                    <Settings className="w-6 h-6" />
                  </button>
                  <button onClick={leaveRoom} className="p-4 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500/80 hover:text-white transition-all">
                    <PhoneOff className="w-6 h-6" />
                  </button>
                </div>

                <AnimatePresence>
                  {showSettings && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-24 right-10 bg-zinc-900 border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-3 min-w-[200px]"
                    >
                      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Transmit Quality</h3>
                      <div className="flex flex-col gap-1">
                        {['2K (Ultra)', '1080p', '720p', '480p'].map(q => (
                          <button
                            key={q}
                            onClick={() => setQuality(q)}
                            className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${streamQuality === q ? 'bg-purple-600 text-white' : 'hover:bg-white/10 text-neutral-300'}`}
                          >
                            {q} {q === '2K (Ultra)' && '(Max)'} {q === '1080p' && '(Good)'} {q === '480p' && '(Save Data)'}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Old stats popup removed — now it's an HUD overlay on the video */}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
