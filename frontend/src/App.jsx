import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { MonitorUp, Mic, MicOff, PhoneOff, Copy, Check, Tv, Loader2, MonitorOff, Maximize, ZoomIn, ZoomOut, Settings, MessageCircle, Volume2, VolumeX, PictureInPicture, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

  // New Features States
  const [volume, setVolume] = useState(1);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  const socketRef = useRef();
  const pcRef = useRef();
  const localStreamRef = useRef(null); 
  const remoteVideoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const chatBottomRef = useRef(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL);

    socketRef.current.on('connect', () => console.log('Socket connected'));

    socketRef.current.on('user-connected', (id) => {
      setRemoteSocketId(id);
      setIsConnected(true);
      setTimeout(() => createPeerConnection(id), 500);
    });

    socketRef.current.on('offer', async (payload) => {
      setRemoteSocketId(payload.caller);
      setIsConnected(true);
      const pc = createPeerConnection(payload.caller);
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('answer', { target: payload.caller, sdp: pc.localDescription });
    });

    socketRef.current.on('answer', async (payload) => {
      if (pcRef.current && pcRef.current.signalingState !== "stable") {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      }
    });

    socketRef.current.on('ice-candidate', async (payload) => {
      if (pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) {
          console.error("Error adding ice candidate:", e);
        }
      }
    });

    socketRef.current.on('stop-screen-share', () => setHasRemoteVideo(false));

    socketRef.current.on('chat-message', (payload) => {
      setChatMessages(prev => [...prev, { text: payload.text, sender: 'peer', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
      setIsChatOpen(true);
    });

    socketRef.current.on('user-disconnected', () => {
      setRemoteSocketId(null);
      setIsConnected(false);
      setHasRemoteVideo(false);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) setRoomId(roomFromUrl);

    return () => socketRef.current.disconnect();
  }, []);

  const createPeerConnection = (targetId) => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.onicecandidate = (event) => {
      if (event.candidate) socketRef.current.emit('ice-candidate', { target: targetId, candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      if (!remoteVideoRef.current.srcObject) remoteVideoRef.current.srcObject = new MediaStream();
      remoteVideoRef.current.srcObject.addTrack(event.track);
      if (event.track.kind === 'video') {
         setHasRemoteVideo(true);
         event.track.onmute = () => setHasRemoteVideo(false);
         event.track.onunmute = () => setHasRemoteVideo(true);
         event.track.onended = () => setHasRemoteVideo(false);
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('offer', { target: targetId, caller: socketRef.current.id, sdp: pc.localDescription });
      } catch (err) {}
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
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
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

  const stopScreenSharingLogic = (track) => {
    track.stop();
    if (pcRef.current) {
      const sender = pcRef.current.getSenders().find(s => s.track === track);
      if (sender) pcRef.current.removeTrack(sender);
    }
    if (localStreamRef.current) localStreamRef.current.removeTrack(track);
    if (!localStreamRef.current || localStreamRef.current.getVideoTracks().length === 0) {
      setIsScreenSharing(false);
      socketRef.current.emit('stop-screen-share', { target: remoteSocketId });
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always", frameRate: 60, displaySurface: "monitor" },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
        });
        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        stream.getTracks().forEach(track => {
          localStreamRef.current.addTrack(track);
          if (pcRef.current) pcRef.current.addTrack(track, localStreamRef.current);
          track.onended = () => stopScreenSharingLogic(track);
        });
        setIsScreenSharing(true);
      } catch (e) {}
    } else {
       if (localStreamRef.current) {
         localStreamRef.current.getVideoTracks().forEach(track => stopScreenSharingLogic(track));
       }
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
    if (preset === '1080p') updateVideoQuality({ scale: 1, bitrate: null });
    if (preset === '720p') updateVideoQuality({ scale: 1.5, bitrate: 2500000 });
    if (preset === '480p') updateVideoQuality({ scale: 2.25, bitrate: 1000000 });
    setShowSettings(false);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = { text: chatInput.trim(), sender: 'me', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
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
                  
                  {!isConnected && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 pointer-events-none bg-black">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p>Send the link so your brother can join</p>
                    </div>
                  )}
                  
                  {isConnected && !hasRemoteVideo && !isScreenSharing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-600 bg-black pointer-events-none">
                       <MonitorOff className="w-12 h-12 mb-4 opacity-50" />
                       <p>Waiting for someone to share their screen...</p>
                    </div>
                  )}

                  {isConnected && isScreenSharing && !hasRemoteVideo && (
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
                          className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <button type="submit" className="bg-purple-600 p-2 rounded-lg hover:bg-purple-500 transition"><Send className="w-4 h-4"/></button>
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
                        if(remoteVideoRef.current) remoteVideoRef.current.volume = newVol;
                    }}>
                       {volume === 0 ? <VolumeX className="w-5 h-5 text-neutral-400" /> : <Volume2 className="w-5 h-5 text-neutral-300" />}
                    </button>
                    <input 
                       type="range" min="0" max="1" step="0.05" value={volume} 
                       onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVolume(val);
                          if(remoteVideoRef.current) remoteVideoRef.current.volume = val;
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
                           {['1080p', '720p', '480p'].map(q => (
                              <button 
                                 key={q} 
                                 onClick={() => setQuality(q)}
                                 className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${streamQuality === q ? 'bg-purple-600 text-white' : 'hover:bg-white/10 text-neutral-300'}`}
                              >
                                {q} {q === '1080p' && '(Best)'} {q === '480p' && '(Save Data)'}
                              </button>
                           ))}
                        </div>
                     </motion.div>
                   )}
                 </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
