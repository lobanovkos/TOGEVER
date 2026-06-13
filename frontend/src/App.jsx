import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  MonitorUp, Mic, MicOff, PhoneOff, Copy, Check, Tv, Loader2,
  MonitorOff, Maximize, ZoomIn, ZoomOut, Settings, MessageCircle,
  Volume2, VolumeX, PictureInPicture, Send, Activity, Wifi, WifiOff, RefreshCw, Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Color helpers ───────────────────────────────────────────────────────────
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

// Metered.ca Dynamic TURN API — credentials are fetched fresh on every load
// Set VITE_METERED_DOMAIN and VITE_METERED_API_KEY in Railway dashboard (Variables tab)
const METERED_DOMAIN  = import.meta.env.VITE_METERED_DOMAIN  || '';
const METERED_API_KEY = import.meta.env.VITE_METERED_API_KEY || '';

// Fallback STUN-only config used before Metered credentials are loaded
const STUN_ONLY = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
];

export default function App() {
  // ── UI State ──────────────────────────────────────────────────────────────
  const [roomId,         setRoomId]         = useState('');
  const [inRoom,         setInRoom]         = useState(false);
  const [copied,         setCopied]         = useState(false);
  const [isConnected,    setIsConnected]    = useState(false);
  const [isMicMuted,     setIsMicMuted]     = useState(true);
  const [isScreenSharing,setIsScreenSharing]= useState(false);
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [reconnecting,   setReconnecting]   = useState(false);
  const [needAudioUnlock,setNeedAudioUnlock]= useState(false);
  const [iceState,       setIceState]       = useState('new');

  // ── Settings State ────────────────────────────────────────────────────────
  const [isZoomed,       setIsZoomed]       = useState(false);
  const [showSettings,   setShowSettings]   = useState(false);
  const [streamQuality,  setStreamQuality]  = useState('1080p');
  const [showStats,      setShowStats]      = useState(false);
  const [autoDowngraded, setAutoDowngraded] = useState(false);
  const [volume,         setVolume]         = useState(1);
  const [brightness,     setBrightness]     = useState(1.0);
  const [remoteMicGain,   setRemoteMicGain]  = useState(1.0);

  // ── Chat State ────────────────────────────────────────────────────────────
  const [isChatOpen,    setIsChatOpen]    = useState(false);
  const [chatMessages,  setChatMessages]  = useState([]);
  const [chatInput,     setChatInput]     = useState('');
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchQuery,setGifSearchQuery]= useState('');
  const [gifs,          setGifs]          = useState([]);

  // ── Network Stats State ───────────────────────────────────────────────────
  const [networkStats, setNetworkStats] = useState({
    fps: 0, bitrate: 0, resolution: 'N/A',
    rtt: 0, packetLoss: 0, jitter: 0,
    connectionType: 'N/A', iceState: 'new',
    totalBytesReceived: 0,
  });

  // ── Refs ──────────────────────────────────────────────────────────────────
  const socketRef         = useRef(null);
  const pcRef             = useRef(null);
  const localStreamRef    = useRef(null);   // MediaStream of local mic/screen tracks added to PC
  const rawMicStreamRef   = useRef(null);   // raw getUserMedia stream (hardware)
  const audioCtxRef       = useRef(null);   // Web Audio context for gain boost
  const gainNodeRef       = useRef(null);   // GainNode — keep alive so GC doesn't kill the track
  const destNodeRef       = useRef(null);   // MediaStreamDestinationNode — keep alive
  const screenStreamRef   = useRef(null);
  const remoteVideoRef    = useRef(null);
  const audioElementsRef  = useRef([]);
  const pendingCandidates = useRef([]);
  const videoContainerRef = useRef(null);
  const chatBottomRef     = useRef(null);
  const signalingQueue    = useRef(Promise.resolve());
  const remoteSocketIdRef = useRef(null);
  const statsBaselineRef  = useRef({ bytesReceived: 0, timestamp: 0 });
  const remoteMicGainRef  = useRef(1.0);   // mirror of remoteMicGain state (for sync callbacks)
  const iceServersRef     = useRef(STUN_ONLY); // populated async from Metered.ca API
  const inRoomRef         = useRef(false);     // mirrors inRoom state for use in socket callbacks
  const roomIdRef         = useRef('');        // mirrors roomId state for reconnect logic

  // Keep refs in sync with state
  useEffect(() => { remoteMicGainRef.current = remoteMicGain; }, [remoteMicGain]);
  useEffect(() => { inRoomRef.current = inRoom; }, [inRoom]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // ── Set custom Hetzner TURN credentials ───────────────────
  useEffect(() => {
    const servers = [
      { urls: 'stun:91.99.127.255:3478' },
      {
        urls: 'turn:91.99.127.255:3478',
        username: 'togever',
        credential: 'togever_super_movie_123'
      },
      {
        urls: 'turn:91.99.127.255:3478?transport=tcp',
        username: 'togever',
        credential: 'togever_super_movie_123'
      }
    ];
    iceServersRef.current = servers;
    console.log('[TOGEVER] Custom Hetzner TURN servers loaded');
  }, []);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chatMessages, isChatOpen]);

  // ── Socket init ───────────────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[TOGEVER] Socket connected', socket.id);
    });

    // RECONNECT only (not initial connect) — safely rejoin room without causing double-join
    socket.io.on('reconnect', () => {
      console.log('[TOGEVER] Socket reconnected');
      if (inRoomRef.current && roomIdRef.current) {
        console.log('[TOGEVER] Auto-rejoining room after reconnect:', roomIdRef.current);
        socket.emit('join-room', roomIdRef.current);
      }
    });

    socket.on('user-connected', (id) => {
      console.log('[TOGEVER] Peer joined:', id);
      setRemoteSocketId(id);
      remoteSocketIdRef.current = id;
      setIsConnected(true);
      // Small delay to let peer also init before we send offer
      // We are the OFFERER — create a data channel to force onnegotiationneeded
      // even when no media tracks are added yet.
      setTimeout(() => {
        const pc = createPeerConnection(id);
        try { pc.createDataChannel('_ch'); } catch (_) {}
      }, 500);
    });

    socket.on('offer', (payload) => {
      signalingQueue.current = signalingQueue.current.then(async () => {
        setRemoteSocketId(payload.caller);
        remoteSocketIdRef.current = payload.caller;
        setIsConnected(true);
        const pc = createPeerConnection(payload.caller);

        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        pendingCandidates.current.forEach(c => pc.addIceCandidate(c).catch(console.error));
        pendingCandidates.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { target: payload.caller, sdp: pc.localDescription });
      }).catch(console.error);
    });

    socket.on('answer', (payload) => {
      signalingQueue.current = signalingQueue.current.then(async () => {
        const pc = pcRef.current;
        if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          pendingCandidates.current.forEach(c => pc.addIceCandidate(c).catch(console.error));
          pendingCandidates.current = [];
        }
      }).catch(console.error);
    });

    socket.on('ice-candidate', async (payload) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const candidate = new RTCIceCandidate(payload.candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          pendingCandidates.current.push(candidate);
        }
      } catch (e) { console.error('[TOGEVER] ICE candidate error:', e); }
    });

    socket.on('stop-screen-share', () => setHasRemoteVideo(false));

    socket.on('quality-request', (payload) => {
      console.log('[TOGEVER] Peer requested quality:', payload.preset);
      const presets = {
        '2K (Ultra)': { scale: 1,    bitrate: 15_000_000 },
        '1080p':      { scale: 1,    bitrate:  8_000_000 },
        '720p':       { scale: 1.5,  bitrate:  2_500_000 },
        '480p':       { scale: 2.25, bitrate:  1_000_000 },
      };
      const params = presets[payload.preset];
      if (params) { setStreamQuality(payload.preset); updateVideoQuality(params); }
    });

    socket.on('chat-message', (payload) => {
      setChatMessages(prev => [
        ...prev,
        { text: payload.text, type: payload.type || 'text', gifUrl: payload.gifUrl, sender: 'peer', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
      setIsChatOpen(true);
    });

    socket.on('user-disconnected', (disconnectedId) => {
      // Only reset if it's actually OUR peer who disconnected, not some random user
      if (disconnectedId && remoteSocketIdRef.current && disconnectedId !== remoteSocketIdRef.current) {
        console.log('[TOGEVER] Ignoring disconnect of non-peer:', disconnectedId);
        return;
      }
      console.log('[TOGEVER] Peer disconnected:', disconnectedId);
      setRemoteSocketId(null);
      setIsConnected(false);
      setHasRemoteVideo(false);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      audioElementsRef.current.forEach(el => { el.pause(); el.srcObject = null; });
      audioElementsRef.current = [];
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    });

    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomFromUrl) setRoomId(roomFromUrl);

    return () => {
      socket.disconnect();
      audioElementsRef.current.forEach(el => { el.pause(); el.srcObject = null; });
      audioElementsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stats polling (always on when connected) ──────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let bytesReceived = 0, fps = 0, resolution = 'N/A';
        let rtt = 0, jitter = 0, packetsReceived = 0, packetsLost = 0;
        let connType = 'N/A';

        stats.forEach(r => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            bytesReceived   = r.bytesReceived  || 0;
            fps             = r.framesPerSecond || 0;
            jitter          = r.jitter ? r.jitter * 1000 : 0;
            packetsReceived = r.packetsReceived || 0;
            packetsLost     = r.packetsLost     || 0;
            if (r.frameWidth && r.frameHeight) resolution = `${r.frameWidth}×${r.frameHeight}`;
          }
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime) {
            rtt = r.currentRoundTripTime * 1000;
          }
          if (r.type === 'local-candidate' && r.candidateType) {
            connType = r.candidateType;
          }
        });

        const prev  = statsBaselineRef.current;
        const now   = performance.now();
        let bitrate = 0;
        if (prev.bytesReceived > 0 && bytesReceived > prev.bytesReceived && now > prev.timestamp) {
          bitrate = parseFloat(((bytesReceived - prev.bytesReceived) * 8 / ((now - prev.timestamp) * 1000)).toFixed(2));
        }
        statsBaselineRef.current = { bytesReceived, timestamp: now };

        const totalPkts   = packetsReceived + packetsLost;
        const packetLoss  = totalPkts > 0 ? parseFloat(((packetsLost / totalPkts) * 100).toFixed(1)) : 0;
        const typeMap     = { host: 'P2P (Direct)', srflx: 'P2P (STUN)', relay: 'Relay (TURN)', prflx: 'P2P (Peer)' };

        setNetworkStats({
          fps: Math.round(fps), bitrate, resolution,
          rtt: Math.round(rtt), packetLoss,
          jitter: parseFloat(jitter.toFixed(1)),
          connectionType: typeMap[connType] || connType,
          iceState: pc.iceConnectionState,
          totalBytesReceived: bytesReceived,
        });

        // Auto quality
        if (bitrate > 0 && bitrate < 1.0 && packetLoss > 3 && !autoDowngraded) {
          setAutoDowngraded(true);
          setStreamQuality('480p');
          updateVideoQuality({ scale: 2.25, bitrate: 1_000_000 });
        }
        if (autoDowngraded && bitrate > 3.0 && packetLoss < 1) {
          setAutoDowngraded(false);
          setStreamQuality('1080p');
          updateVideoQuality({ scale: 1, bitrate: 8_000_000 });
        }
      } catch (_) { /* pc closing */ }
    }, 1000);
    return () => clearInterval(interval);
  }, [autoDowngraded]);

  // ── createPeerConnection ──────────────────────────────────────────────────
  const createPeerConnection = (targetId) => {
    // Return existing PC (avoids duplicates from double-trigger)
    if (pcRef.current && pcRef.current.signalingState !== 'closed') return pcRef.current;

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit('ice-candidate', { target: targetId, candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
      console.log('[TOGEVER] Connection:', pc.connectionState);
      if (pc.connectionState === 'connected')  { setReconnecting(false); }
      if (pc.connectionState === 'failed') {
        setReconnecting(true);
        pc.close();
        pcRef.current = null;
        statsBaselineRef.current = { bytesReceived: 0, timestamp: 0 };
        setTimeout(() => {
          const tid = remoteSocketIdRef.current;
          if (!tid) return;
          const newPc = createPeerConnection(tid);
          localStreamRef.current?.getTracks().forEach(t => {
            try { newPc.addTrack(t, localStreamRef.current); } catch (_) {}
          });
        }, 2000);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[TOGEVER] ICE:', pc.iceConnectionState);
      setIceState(pc.iceConnectionState);
    };

    // Accept data channel from offerer peer (no-op, just prevents errors)
    pc.ondatachannel = () => {};

    // ── Receive remote tracks ──────────────────────────────────────────
    pc.ontrack = (event) => {
      const { track } = event;

      if (track.kind === 'video') {
        if (!remoteVideoRef.current.srcObject) remoteVideoRef.current.srcObject = new MediaStream();
        remoteVideoRef.current.srcObject.addTrack(track);
        setHasRemoteVideo(true);
        track.onmute   = () => setHasRemoteVideo(false);
        track.onunmute = () => setHasRemoteVideo(true);
        track.onended  = () => {
          const v = remoteVideoRef.current?.srcObject;
          if (!v || v.getVideoTracks().filter(t => t.readyState === 'live').length === 0)
            setHasRemoteVideo(false);
        };
        return;
      }

      if (track.kind === 'audio') {
        const audioEl = new Audio();
        audioEl.autoplay = true;

        // Apply GainNode to remote track
        const ctx = new AudioContext();
        audioCtxRef.current = ctx; // Save to close later
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        const gain = ctx.createGain();
        gain.gain.value = remoteMicGainRef.current;
        gainNodeRef.current = gain; // Save for volume adjustments
        
        const dest = ctx.createMediaStreamDestination();
        destNodeRef.current = dest;

        source.connect(gain);
        gain.connect(dest);

        audioEl.srcObject = dest.stream;
        audioEl.volume = volume;
        audioElementsRef.current.push(audioEl);
        audioEl.play().catch(err => {
          console.warn('[TOGEVER] Audio autoplay blocked — showing unlock button:', err);
          setNeedAudioUnlock(true);
        });
        track.onended = () => {
          audioEl.pause();
          audioEl.srcObject = null;
          audioElementsRef.current = audioElementsRef.current.filter(el => el !== audioEl);
          if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
            gainNodeRef.current = null;
            destNodeRef.current = null;
          }
        };
      }
    };

    // ── Negotiation ────────────────────────────────────────────────────
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socketRef.current.emit('offer', { target: targetId, caller: socketRef.current.id, sdp: pc.localDescription });
      } catch (err) { console.error('[TOGEVER] Negotiation error:', err); }
    };

    // Add existing local tracks (e.g. mic already enabled)
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));

    pcRef.current = pc;
    return pc;
  };

  // ── Toggle Mic ────────────────────────────────────────────────────────────
  // Uses Web Audio GainNode for software boost.
  // Important: keep audioCtxRef, gainNodeRef, destNodeRef alive so GC doesn't
  // kill the destination stream track that WebRTC is using.
  const toggleMic = async () => {
    if (isMicMuted) {
      // ── Turn ON ──────────────────────────────────────────────────────────
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  false,  // we control gain ourselves
          }
        });
        rawMicStreamRef.current = rawStream;

        // Get raw mic track
        const rawMicTrack = rawStream.getAudioTracks()[0];

        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        localStreamRef.current.addTrack(rawMicTrack);

        if (pcRef.current) {
          try {
            pcRef.current.addTrack(rawMicTrack, localStreamRef.current);
          } catch (err) {
            console.warn('[TOGEVER] addTrack failed, replaceTrack fallback:', err);
            const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) await sender.replaceTrack(rawMicTrack);
          }
        }

        setIsMicMuted(false);
        console.log('[TOGEVER] Mic ON');
      } catch (err) {
        console.error('[TOGEVER] Mic access error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          alert('Нет доступа к микрофону! Разреши браузеру использовать микрофон в настройках.');
        } else {
          alert(`Ошибка микрофона: ${err.message}`);
        }
      }
    } else {
      // ── Turn OFF ─────────────────────────────────────────────────────────
      // 1. Stop & remove boosted audio tracks from PC
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.stop();
          if (pcRef.current) {
            const sender = pcRef.current.getSenders().find(s => s.track === track);
            if (sender) pcRef.current.removeTrack(sender);
          }
          localStreamRef.current.removeTrack(track);
        });
      }
      // 2. Stop hardware mic
      rawMicStreamRef.current?.getTracks().forEach(t => t.stop());
      rawMicStreamRef.current = null;
      // We removed AudioContext from local mic, so nothing to close here
      setIsMicMuted(true);
      console.log('[TOGEVER] Mic OFF');
    }
  };

  const handleRemoteMicGainChange = (e) => {
    const val = parseFloat(e.target.value);
    setRemoteMicGain(val);
    remoteMicGainRef.current = val;
    if (gainNodeRef.current) gainNodeRef.current.gain.value = val;
  };

  // ── Screen Share ──────────────────────────────────────────────────────────
  const stopScreenSharingLogic = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => {
        track.stop();
        const sender = pcRef.current?.getSenders().find(s => s.track === track);
        if (sender) pcRef.current.removeTrack(sender);
        localStreamRef.current?.removeTrack(track);
      });
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    socketRef.current?.emit('stop-screen-share', { target: remoteSocketIdRef.current });
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always', frameRate: { ideal: 60, max: 60 }, height: { ideal: 1440, max: 1440 }, displaySurface: 'monitor' },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        screenStreamRef.current = stream;

        // Tell encoder: preserve resolution, drop FPS (no macroblocking squares)
        stream.getVideoTracks().forEach(t => { t.contentHint = 'detail'; });

        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        stream.getTracks().forEach(track => {
          localStreamRef.current.addTrack(track);
          if (pcRef.current) pcRef.current.addTrack(track, localStreamRef.current);
          track.onended = () => { if (screenStreamRef.current) stopScreenSharingLogic(); };
        });
        setIsScreenSharing(true);
      } catch (err) {
        if (err.name !== 'NotAllowedError') console.error('[TOGEVER] Screen share error:', err);
      }
    } else {
      stopScreenSharingLogic();
    }
  };

  // ── Room / Utils ──────────────────────────────────────────────────────────
  const joinRoom = (e) => {
    if (e) e.preventDefault();
    const id = roomId || Math.random().toString(36).substring(2, 9);
    setRoomId(id);
    socketRef.current.emit('join-room', id);
    setInRoom(true);
    window.history.pushState({}, '', `?room=${id}`);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    // Stop mic pipeline
    rawMicStreamRef.current?.getTracks().forEach(t => t.stop());
    rawMicStreamRef.current = null;
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; gainNodeRef.current = null; destNodeRef.current = null; }

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    audioElementsRef.current.forEach(el => { el.pause(); el.srcObject = null; });
    audioElementsRef.current = [];

    setInRoom(false); setIsMicMuted(true); setIsScreenSharing(false);

    setIsConnected(false); setRemoteSocketId(null); setHasRemoteVideo(false);
    setChatMessages([]);
    window.history.pushState({}, '', '/');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      videoContainerRef.current?.requestFullscreen().catch(console.error);
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
    } catch (err) { console.error('[TOGEVER] PiP error:', err); }
  };

  const updateVideoQuality = async (paramsObj) => {
    const pc = pcRef.current;
    if (!pc) return;
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].scaleResolutionDownBy = paramsObj.scale;
    if (paramsObj.bitrate) {
      params.encodings[0].maxBitrate = paramsObj.bitrate;
    } else {
      delete params.encodings[0].maxBitrate;
    }
    try { await sender.setParameters(params); } catch (err) { console.error('[TOGEVER] setParameters:', err); }
  };

  const setQuality = (preset) => {
    const presets = {
      '2K (Ultra)': { scale: 1,    bitrate: 15_000_000 },
      '1080p':      { scale: 1,    bitrate:  8_000_000 },
      '720p':       { scale: 1.5,  bitrate:  2_500_000 },
      '480p':       { scale: 2.25, bitrate:  1_000_000 },
    };
    const p = presets[preset];
    if (p) {
      setStreamQuality(preset);
      updateVideoQuality(p);
      if (remoteSocketId) socketRef.current.emit('quality-request', { target: remoteSocketId, preset });
    }
    setShowSettings(false);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = { text: chatInput.trim(), type: 'text', sender: 'me', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setChatMessages(prev => [...prev, msg]);
    socketRef.current.emit('chat-message', { target: remoteSocketId, text: chatInput.trim(), type: 'text' });
    setChatInput('');
  };

  const handleGifSearch = (query) => {
    setGifSearchQuery(query);
    if (!query) { setGifs([]); return; }
    
    if (window.gifTimeout) clearTimeout(window.gifTimeout);
    window.gifTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`https://g.tenor.com/v1/search?key=LIVDSRZULELA&q=${query}&limit=12`);
        const data = await res.json();
        setGifs(data.results || []);
      } catch (err) { console.error('[TOGEVER] GIF fetch error:', err); }
    }, 400);
  };

  const sendGif = (url) => {
    const payload = { target: remoteSocketId, type: 'gif', gifUrl: url };
    socketRef.current.emit('chat-message', payload);
    setChatMessages(prev => [...prev, { ...payload, sender: 'me', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    setShowGifPicker(false);
    setGifSearchQuery('');
    setGifs([]);
  };

  // ── Volume sync to audio elements ─────────────────────────────────────────
  const applyVolume = (val) => {
    setVolume(val);
    if (remoteVideoRef.current) remoteVideoRef.current.volume = val;
    audioElementsRef.current.forEach(el => { el.volume = val; });
  };

  // ── Unlock audio (browser autoplay policy workaround) ────────────────────
  const unlockAudio = () => {
    audioElementsRef.current.forEach(el => el.play().catch(() => {}));
    if (remoteVideoRef.current) remoteVideoRef.current.play().catch(() => {});
    setNeedAudioUnlock(false);
  };

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-purple-500/30 overflow-hidden relative flex flex-col items-center">
      {/* Background blobs */}
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

          {/* ── LOBBY ─────────────────────────────────────────────────────── */}
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

            /* ── ROOM ───────────────────────────────────────────────────── */
            <motion.div
              key="room"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full flex flex-col h-[85vh] bg-black/40 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl"
            >
              {/* ── Top bar ─────────────────────────────────────────────── */}
              <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-white/[0.02] shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full transition-all ${isConnected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)] animate-pulse'}`} />
                  <span className="font-medium text-sm text-neutral-300">
                    {isConnected ? 'Brother Connected' : 'Waiting for Brother...'}
                  </span>
                  {/* ICE state badge — shows actual WebRTC transport status */}
                  {isConnected && (
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      ['connected','completed'].includes(iceState)
                        ? 'bg-green-500/10 text-green-400 border-green-500/30'
                        : iceState === 'checking'
                        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30 animate-pulse'
                        : ['failed','disconnected'].includes(iceState)
                        ? 'bg-red-500/10 text-red-400 border-red-500/30'
                        : 'bg-white/5 text-neutral-500 border-white/10'
                    }`}>
                      ICE: {iceState}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors" onClick={copyLink}>
                  <span className="text-sm font-mono text-neutral-300">Room: {roomId}</span>
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-purple-400" />}
                </div>
              </div>

              {/* ── Main content area ────────────────────────────────────── */}
              <div className="flex-1 overflow-hidden flex relative">

                {/* Video area */}
                <div ref={videoContainerRef} className="flex-1 bg-black flex items-center justify-center overflow-hidden group relative">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    style={{ filter: `brightness(${brightness})` }}
                    className={`w-full h-full transition-all duration-300 ease-in-out ${isZoomed ? 'object-cover' : 'object-contain'} ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
                  />

                  {/* Hover controls overlay */}
                  {hasRemoteVideo && (
                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      <button onClick={togglePiP} className="p-3 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white rounded-xl transition-all" title="Picture in Picture">
                        <PictureInPicture className="w-5 h-5" />
                      </button>
                      <button onClick={() => setIsZoomed(!isZoomed)} className="p-3 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white rounded-xl transition-all" title={isZoomed ? 'Fit to Screen' : 'Fill Screen'}>
                        {isZoomed ? <ZoomOut className="w-5 h-5" /> : <ZoomIn className="w-5 h-5" />}
                      </button>
                      <button onClick={toggleFullscreen} className="p-3 bg-black/50 hover:bg-black/80 backdrop-blur-md text-white rounded-xl transition-all" title="Fullscreen">
                        <Maximize className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {/* ── DEBUG HUD ────────────────────────────────────────── */}
                  <AnimatePresence>
                    {showStats && (
                      <motion.div
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}
                        className="absolute top-4 left-4 z-50 pointer-events-none select-none"
                      >
                        <div className="bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl p-4 min-w-[280px] font-mono text-xs leading-relaxed shadow-2xl">
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
                          <div className="space-y-1.5">
                            {[
                              { label: 'FPS',         val: networkStats.fps,        unit: '',    g: 30, y: 20, hi: true  },
                              { label: 'Bitrate',     val: networkStats.bitrate,    unit: 'Mbps', g: 3,  y: 1,  hi: true  },
                              { label: 'Ping (RTT)',  val: networkStats.rtt,        unit: 'ms',  g: 50, y: 100, hi: false },
                              { label: 'Packet Loss', val: networkStats.packetLoss, unit: '%',   g: 1,  y: 5,   hi: false },
                              { label: 'Jitter',      val: networkStats.jitter,     unit: 'ms',  g: 10, y: 30,  hi: false },
                            ].map(({ label, val, unit, g, y, hi }) => (
                              <div key={label} className="flex items-center justify-between">
                                <span className="text-neutral-500">{label}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`font-bold text-sm ${statusColor(val, g, y, hi)}`}>
                                    {val}<span className="text-[10px] text-neutral-600"> {unit}</span>
                                  </span>
                                  <div className={`w-2 h-2 rounded-full ${dotColor(val, g, y, hi)}`} />
                                </div>
                              </div>
                            ))}

                            <div className="border-t border-white/5 my-1" />
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Resolution</span>
                              <span className="text-purple-400 font-semibold">{networkStats.resolution}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Connection</span>
                              <div className="flex items-center gap-2">
                                {networkStats.connectionType.includes('Relay')
                                  ? <WifiOff className="w-3 h-3 text-yellow-400" />
                                  : <Wifi    className="w-3 h-3 text-green-400"  />}
                                <span className={`font-semibold ${networkStats.connectionType.includes('Relay') ? 'text-yellow-400' : 'text-green-400'}`}>
                                  {networkStats.connectionType}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">ICE State</span>
                              <span className={`font-semibold ${
                                ['connected','completed'].includes(networkStats.iceState) ? 'text-green-400' :
                                networkStats.iceState === 'checking'                      ? 'text-yellow-400' :
                                ['failed','disconnected'].includes(networkStats.iceState) ? 'text-red-400' : 'text-neutral-500'
                              }`}>{networkStats.iceState}</span>
                            </div>
                          </div>

                          {networkStats.connectionType.includes('Relay') && (
                            <div className="mt-3 text-[10px] text-yellow-400 bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/20">
                              ⚠ TURN relay — slower than direct P2P. Check VPN or firewall.
                            </div>
                          )}
                          {networkStats.bitrate > 0 && networkStats.bitrate < 1.0 && (
                            <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                              🔴 Low bandwidth! Video may lag or pixelate.
                            </div>
                          )}
                          {networkStats.packetLoss > 5 && (
                            <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                              🔴 High packet loss ({networkStats.packetLoss}%)! Network unstable.
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

                  {/* Audio unlock banner (browser autoplay policy) */}
                  {needAudioUnlock && !reconnecting && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
                      <button
                        onClick={unlockAudio}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold transition-all animate-bounce"
                      >
                        <Volume2 className="w-5 h-5" />
                        Нажми, чтобы включить звук брата 🔊
                      </button>
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
                </div>{/* end video area */}

                {/* ── Chat Panel ──────────────────────────────────────────── */}
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
                        <button onClick={() => setIsChatOpen(false)} className="text-neutral-500 hover:text-white transition text-xs">✕ Close</button>
                      </div>
                      <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 min-w-[320px]">
                        {chatMessages.length === 0 && (
                          <div className="text-center text-neutral-600 text-sm mt-10">No messages yet. Say hi!</div>
                        )}
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}>
                            <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${msg.sender === 'me' ? 'bg-purple-600 text-white rounded-br-none' : 'bg-zinc-800 text-neutral-200 rounded-bl-none'} ${msg.type === 'gif' ? 'p-1' : ''}`}>
                              {msg.type === 'gif' ? (
                                <img src={msg.gifUrl} alt="GIF" className="rounded-xl w-full max-w-[200px]" />
                              ) : (
                                msg.text
                              )}
                            </div>
                            <span className="text-[10px] text-neutral-500 mt-1">{msg.time}</span>
                          </div>
                        ))}
                        <div ref={chatBottomRef} />
                      </div>
                      <div className="relative border-t border-white/5 bg-black/50">
                        {showGifPicker && (
                          <div className="absolute bottom-[100%] left-0 w-full bg-zinc-900 border-t border-white/10 p-2 z-50 rounded-t-xl">
                            <input 
                              type="text" 
                              placeholder="Search GIFs..." 
                              value={gifSearchQuery} 
                              onChange={(e) => handleGifSearch(e.target.value)}
                              autoFocus
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none mb-2"
                            />
                            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                              {gifs.map(g => (
                                <img 
                                  key={g.id} 
                                  src={g.media[0].tinygif.url} 
                                  alt="gif"
                                  className="w-full h-auto cursor-pointer rounded hover:opacity-80 transition"
                                  onClick={() => sendGif(g.media[0].tinygif.url)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        <form onSubmit={handleSendMessage} className="p-3 flex gap-2 w-[320px]">
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); setShowGifPicker(!showGifPicker); }}
                            className={`p-2 rounded-lg transition text-xs font-bold uppercase tracking-wider ${showGifPicker ? 'bg-purple-600 text-white' : 'bg-white/10 text-neutral-400 hover:text-white hover:bg-white/20'}`}
                          >
                            GIF
                          </button>
                          <input
                            type="text" value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Type a message..."
                            className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-base outline-none focus:ring-2 focus:ring-purple-500"
                          />
                          <button type="submit" className="bg-purple-600 p-2 rounded-lg hover:bg-purple-500 transition">
                            <Send className="w-4 h-4" />
                          </button>
                        </form>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>{/* end main content */}

              {/* ── Controls Bar ─────────────────────────────────────────── */}
              <div className="h-20 bg-black/60 border-t border-white/5 flex items-center px-6 relative shrink-0">

                {/* Volume slider */}
                <div className="flex items-center gap-3 bg-zinc-800/80 rounded-full px-4 py-3 mr-auto">
                  <button onClick={() => applyVolume(volume === 0 ? 1 : 0)}>
                    {volume === 0
                      ? <VolumeX className="w-5 h-5 text-neutral-400" />
                      : <Volume2 className="w-5 h-5 text-neutral-300" />}
                  </button>
                  <input
                    type="range" min="0" max="1" step="0.05" value={volume}
                    onChange={(e) => applyVolume(parseFloat(e.target.value))}
                    className="w-20 lg:w-32 accent-purple-500 cursor-pointer"
                  />
                </div>

                {/* Center controls */}
                <div className="flex items-center gap-4 absolute left-1/2 -translate-x-1/2">
                  <button
                    onClick={toggleMic}
                    title={isMicMuted ? 'Enable Mic' : 'Mute Mic'}
                    className={`p-4 rounded-full transition-all ${isMicMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-600/30 text-green-400 shadow-[0_0_12px_rgba(74,222,128,0.25)] hover:bg-green-600/40'}`}
                  >
                    {isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                  <button
                    onClick={toggleScreenShare}
                    title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                    className={`p-4 rounded-full transition-all ${isScreenSharing ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(147,51,234,0.5)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                  >
                    <MonitorUp className="w-6 h-6" />
                  </button>
                  <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    title="Chat"
                    className={`p-4 rounded-full transition-all ${isChatOpen ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                  >
                    <MessageCircle className="w-6 h-6" />
                  </button>
                </div>

                {/* Right controls */}
                <div className="ml-auto flex items-center gap-4">
                  {/* Debug HUD */}
                  <button
                    onClick={() => setShowStats(!showStats)}
                    title="Toggle Debug HUD"
                    className={`p-4 rounded-full transition-all relative ${showStats ? 'bg-green-600/30 text-green-400 shadow-[0_0_12px_rgba(74,222,128,0.3)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                  >
                    <Activity className="w-6 h-6" />
                    {isConnected && networkStats.bitrate > 0 && (networkStats.bitrate < 1 || networkStats.packetLoss > 5 || networkStats.fps < 15) && !showStats && (
                      <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                    )}
                  </button>

                  {/* Settings gear */}
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    title="Settings"
                    className={`p-4 rounded-full transition-all ${showSettings ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}
                  >
                    <Settings className="w-6 h-6" />
                  </button>

                  {/* Leave */}
                  <button onClick={leaveRoom} className="p-4 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500/80 hover:text-white transition-all">
                    <PhoneOff className="w-6 h-6" />
                  </button>
                </div>

                {/* Settings Panel */}
                <AnimatePresence>
                  {showSettings && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-24 right-10 bg-zinc-900 border border-white/10 p-5 rounded-2xl shadow-2xl flex flex-col gap-5 min-w-[220px] z-50"
                    >
                      {/* Brightness */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sun className="w-3.5 h-3.5 text-yellow-400" />
                            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Brightness</h3>
                          </div>
                          <span className="text-xs text-neutral-500">{brightness.toFixed(1)}×</span>
                        </div>
                        <input
                          type="range" min="0.2" max="3.0" step="0.1" value={brightness}
                          onChange={(e) => setBrightness(parseFloat(e.target.value))}
                          className="w-full accent-yellow-400 cursor-pointer"
                        />
                      </div>

                      {/* Remote Mic Boost */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Mic className="w-3.5 h-3.5 text-green-400" />
                            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Peer Volume</h3>
                          </div>
                          <span className="text-xs text-neutral-500">{remoteMicGain.toFixed(1)}×</span>
                        </div>
                        <input
                          type="range" min="0.0" max="5.0" step="0.1" value={remoteMicGain}
                          onChange={handleRemoteMicGainChange}
                          className="w-full accent-green-500 cursor-pointer"
                        />
                        <span className="text-[10px] text-green-400/70">Boost or mute brother's mic</span>
                      </div>

                      <div className="border-t border-white/10" />

                      {/* Stream Quality */}
                      <div className="flex flex-col gap-2">
                        <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Transmit Quality</h3>
                        <div className="flex flex-col gap-1">
                          {[
                            { label: '2K (Ultra)', desc: 'Max quality' },
                            { label: '1080p',      desc: 'Recommended' },
                            { label: '720p',       desc: 'Balanced' },
                            { label: '480p',       desc: 'Save data' },
                          ].map(({ label, desc }) => (
                            <button
                              key={label}
                              onClick={() => setQuality(label)}
                              className={`text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${streamQuality === label ? 'bg-purple-600 text-white' : 'hover:bg-white/10 text-neutral-300'}`}
                            >
                              <span>{label}</span>
                              <span className={`text-[10px] ${streamQuality === label ? 'text-purple-200' : 'text-neutral-600'}`}>{desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>{/* end controls bar */}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
