"use strict";

/* =========================================================
   PrivateCall Pro — client
   ========================================================= */

const socket = io({ reconnectionDelayMax: 4000 });
const $ = (id) => document.getElementById(id);

const el = {
  app: $("app"),
  joinScreen: $("joinScreen"), callScreen: $("callScreen"),
  joinForm: $("joinForm"), roomInput: $("roomInput"), joinBtn: $("joinBtn"), joinBtnText: $("joinBtnText"),
  modeCreate: $("modeCreate"), modeJoin: $("modeJoin"),
  createPane: $("createPane"), joinPane: $("joinPane"),
  ownCode: $("ownCode"), ownCodeRow: $("ownCodeRow"),
  roomLimit: $("roomLimit"), createBtn: $("createBtn"), createBtnText: $("createBtnText"),
  remoteGrid: $("remoteGrid"), mainTile: $("mainTile"), mainBadge: $("mainBadge"),
  serverStatus: $("serverStatus"), status: $("status"), quality: $("connectionQuality"),
  roomName: $("roomName"), timer: $("callTimer"),
  localVideo: $("localVideo"), remoteVideo: $("remoteVideo"), remoteWrap: $("remoteWrap"),
  remotePlaceholder: $("remotePlaceholder"), remotePlaceholderText: $("remotePlaceholderText"),
  inviteLink: $("inviteLink"),
  pip: $("localVideoCard"), pipOff: $("pipOff"), videoSection: $("videoSection"),
  copyBtn: $("copyBtn"), devicesBtn: $("devicesBtn"), flipBtn: $("flipBtn"),
  fitBtn: $("fitBtn"), fullscreenBtn: $("fullscreenBtn"),
  deviceBar: $("deviceBar"), cameraSelect: $("cameraSelect"), micSelect: $("micSelect"),
  micBtn: $("toggleMic"), camBtn: $("toggleCamera"), shareBtn: $("shareScreenBtn"),
  chatBtn: $("chatToggleBtn"), endBtn: $("endCallBtn"),
  micLabel: $("micLabel"), camLabel: $("camLabel"), shareLabel: $("shareLabel"),
  chatUnread: $("chatUnread"), chatPanel: $("chatPanel"), chatCloseBtn: $("chatCloseBtn"),
  chatMessages: $("chatMessages"), chatInput: $("chatInput"), chatSendBtn: $("chatSendBtn"),
  chatEmojiBtn: $("chatEmojiBtn"), emojiPicker: $("emojiPicker"), chatSub: $("chatSub"),
  toast: $("toast"),
  brightness: $("brightness"), contrast: $("contrast"), saturate: $("saturate"),
  brightnessVal: $("brightnessVal"), contrastVal: $("contrastVal"), saturateVal: $("saturateVal"),
  filterChips: $("filterChips"), autoLight: $("autoLight"), qualitySelect: $("qualitySelect"),
  resetLookBtn: $("resetLook"), shotBtn: $("shotBtn"), recBtn: $("recBtn"),
  consent: $("consent"), consentTitle: $("consentTitle"), consentText: $("consentText"),
  consentImg: $("consentImg"), consentFull: $("consentFull"), consentTimer: $("consentTimer"),
  consentDeny: $("consentDeny"), consentAllow: $("consentAllow"),
  lightbox: $("lightbox"), lightboxImg: $("lightboxImg"), lightboxClose: $("lightboxClose"),
  recBanner: $("recBanner"), recText: $("recText"), recStopBtn: $("recStopBtn"),
  remoteShield: $("remoteShield"), pipShield: $("pipShield"), watermark: $("callWatermark"),
};

const DEFAULT_ICE = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

const state = {
  roomId: null, inCall: false, joining: false,
  peers: new Map(), roomLimit: 4, isHost: false, hostToken: "",
  announcedRoom: false, announcedConnect: false, recreateTried: false,
  localStream: null, screenStream: null,
  pc: null, dc: null, remoteStream: null,
  pendingCandidates: [],
  isInitiator: false, peerPresent: false,
  hasCam: false, hasMic: false, camOn: false, micOn: false,
  facing: "user",
  remote: { connected: false, cam: true },
  timerInterval: null, seconds: 0,
  statsInterval: null, lastStats: null, lastPoorToast: 0,
  restartTimer: null, wakeLock: null, iceConfig: null,
};

const chatInitialHTML = el.chatMessages.innerHTML;
const chat = { open: false, unread: 0, pending: new Map(), seen: new Set() };

const look = { brightness: 100, contrast: 100, saturate: 100, filter: "none", auto: false };
let autoMul = 1;
let lookCanvas = null, lookCtx = null, lookStream = null, lookRaf = 0, lookGen = 0, lookSample = null, lookFrames = 0;
let syncingVideo = false, syncVideoAgain = false;
let localRecording = false, peerRecording = false;
let shotAsk = null, recAskId = null, recAskTimer = 0, dialog = null;
let sharedAudio = null, rec = null, recChunks = [], recSave = true, recAudio = null, recCanvasStream = null, recRAF = 0, recGen = 0;
let lastProtectAt = 0, shieldTimer = 0, shieldForPrint = false;

/* =========================================================
   UI helpers
   ========================================================= */

let toastTimer = null;
function toast(msg, type = "info") {
  el.toast.textContent = msg;
  el.toast.className = "toast show " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 3000);
}

function setBadge(badge, text, online) {
  const t = badge.querySelector(".status-text");
  if (t) t.textContent = text;
  badge.classList.toggle("online", !!online);
  badge.classList.toggle("offline", !online);
}
const setStatus = (text, online = false) => setBadge(el.status, text, online);
const setServerStatus = (online) => setBadge(el.serverStatus, online ? "Server online" : "Connecting…", online);

function updateQuality(q) {
  el.quality.hidden = false;
  el.quality.classList.remove("excellent", "good", "poor");
  el.quality.classList.add(q);
  el.quality.querySelector(".quality-text").textContent =
    q === "excellent" ? "Excellent" : q === "good" ? "Good" : "Poor";
}

function formatTime(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function startTimer() {
  if (state.timerInterval) return; // keep counting through short reconnects
  state.seconds = 0;
  el.timer.textContent = "00:00";
  state.timerInterval = setInterval(() => {
    state.seconds++;
    el.timer.textContent = formatTime(state.seconds);
  }, 1000);
}
function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.seconds = 0;
  el.timer.textContent = "00:00";
}

function eachPeer() {
  return [...state.peers.values()];
}
function primaryPeer() {
  return state.peers.values().next().value || null;
}
function refreshPresence() {
  const list = eachPeer();
  state.peerPresent = list.length > 0;
  state.remote.connected = list.some((entry) => entry.connected);
  state.remote.cam = list.some((entry) => entry.connected && entry.cam) || !state.remote.connected;
  state.dc = list.map((entry) => entry.dc).find((dc) => dc && dc.readyState === "open") || null;
  if (el.remoteWrap) el.remoteWrap.dataset.count = String(list.length);
  list.forEach(markTile);
  updateRemoteView();
  updateChatSub();
}
function markTile(entry) {
  if (entry.badge) entry.badge.textContent = !entry.connected ? "Connecting…" : entry.cam ? "" : "Camera off";
  if (entry.video) entry.video.classList.toggle("cam-off", !!(entry.connected && !entry.cam));
}
function updateRemoteView() {
  const n = state.peers.size;
  const limit = state.roomLimit || 2;
  let mode = "waiting";
  let text = `Waiting for people · 1/${limit}`;
  if (n > 0 && !state.remote.connected) { mode = "connecting"; text = "Connecting…"; }
  else if (n > 0 && !state.remote.cam) { mode = "camoff"; text = "Camera is off"; }
  else if (n > 0) mode = "live";
  const showPlaceholder = mode !== "live" && !(mode === "camoff" && n > 1);
  el.remotePlaceholder.classList.toggle("hidden", !showPlaceholder);
  el.remotePlaceholder.dataset.mode = mode;
  el.remotePlaceholderText.textContent = mode === "live" ? "" : text;
}

function syncControlUI() {
  const set = (btn, label, active, on, off, available) => {
    btn.dataset.active = String(active);
    btn.disabled = !available;
    label.textContent = !available ? off : active ? on : off;
  };
  set(el.micBtn, el.micLabel, state.micOn, "Mic", state.hasMic ? "Muted" : "No mic", state.hasMic);
  set(el.camBtn, el.camLabel, state.camOn, "Camera", state.hasCam ? "Off" : "No cam", state.hasCam);
  el.pipOff.hidden = state.camOn || !!state.screenStream;
  const sharing = !!state.screenStream;
  el.shareBtn.classList.toggle("on", sharing);
  el.shareLabel.textContent = sharing ? "Stop" : "Share";
  const mirror = !sharing && state.facing === "user";
  el.localVideo.classList.toggle("no-mirror", !mirror);
}

/* =========================================================
   ICE config (STUN + optional TURN from server)
   ========================================================= */

async function loadIceConfig() {
  if (state.iceConfig) return state.iceConfig;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch("/ice-config", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      state.iceConfig = { iceServers: data.iceServers, iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" };
    }
  } catch (err) {
    console.warn("ice-config failed, using default STUN", err);
  }
  if (!state.iceConfig) state.iceConfig = DEFAULT_ICE;
  return state.iceConfig;
}

/* =========================================================
   Media
   ========================================================= */

function audioConstraints(deviceId) {
  const a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) a.deviceId = { exact: deviceId };
  return a;
}
const QUALITY = {
  hd: { width: 1920, height: 1080, fps: 30, maxBitrate: 2500000 },
  std: { width: 1280, height: 720, fps: 24, maxBitrate: 1500000 },
  data: { width: 854, height: 480, fps: 20, maxBitrate: 600000 },
};
function qualityPreset(level) {
  const key = level || (el.qualitySelect && el.qualitySelect.value) || "std";
  return QUALITY[key] || QUALITY.std;
}
function videoConstraints(deviceId, exactFacing, level) {
  const q = qualityPreset(level);
  const v = {
    width: { ideal: q.width },
    height: { ideal: q.height },
    frameRate: { ideal: q.fps, max: 30 },
  };
  if (deviceId) v.deviceId = { exact: deviceId };
  else v.facingMode = exactFacing ? { exact: state.facing } : { ideal: state.facing };
  return v;
}

function mediaErrorMessage(err) {
  switch (err && err.name) {
    case "NotAllowedError":
    case "SecurityError": return "Camera/mic blocked. Allow access in your browser settings.";
    case "NotFoundError": return "No camera or microphone found.";
    case "NotReadableError": return "Camera or mic is being used by another app.";
    default: return "Could not access camera or microphone.";
  }
}

async function startMedia() {
  stopLocalMedia();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Camera needs HTTPS (or localhost). Joining without camera.", "error");
    syncControlUI();
    return false;
  }

  const selected = (el.qualitySelect && el.qualitySelect.value) || "std";
  const order = [];
  [selected, "hd", "std", "data"].forEach((level) => { if (!order.includes(level)) order.push(level); });
  const attempts = order.map((level) => ({
    level,
    constraints: { audio: audioConstraints(), video: videoConstraints(null, false, level) },
  }));
  attempts.push({ level: null, constraints: { audio: audioConstraints(), video: false } });
  attempts.push({ level: null, constraints: { audio: false, video: videoConstraints(null, false, "data") } });

  let lastErr = null;
  let usedLevel = null;
  for (const attempt of attempts) {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      usedLevel = attempt.level;
      break;
    } catch (err) {
      lastErr = err;
      console.warn("getUserMedia failed", err.name);
      if (err.name === "NotAllowedError" || err.name === "SecurityError") break;
    }
  }

  const s = state.localStream;
  state.hasCam = !!(s && s.getVideoTracks().length);
  state.hasMic = !!(s && s.getAudioTracks().length);
  state.camOn = state.hasCam;
  state.micOn = state.hasMic;
  el.localVideo.srcObject = s || null;
  if (state.hasCam) applyAutoCamera(s.getVideoTracks()[0]);
  syncControlUI();

  if (!s) { toast(mediaErrorMessage(lastErr), "error"); return false; }
  if (usedLevel && state.hasCam && el.qualitySelect && usedLevel !== selected) {
    el.qualitySelect.value = usedLevel;
  }
  try { await el.localVideo.play(); } catch (e) { /* autoplay already requested */ }
  if (!state.hasCam) toast("Joined without camera", "info");
  else if (!state.hasMic) toast("Joined without microphone", "info");
  else if (usedLevel && usedLevel !== selected) {
    const names = { hd: "HD 1080p", std: "720p", data: "480p" };
    toast(`Using ${names[usedLevel] || usedLevel} — higher quality wasn't available`, "info");
  }
  return true;
}

function stopLocalMedia() {
  if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  state.hasCam = state.hasMic = state.camOn = state.micOn = false;
  el.localVideo.srcObject = null;
}

/* Ask the camera for continuous auto focus, auto exposure and auto white balance
   so it adapts to changing light. Only applies modes the device reports as supported
   (Chrome/Android/desktop; iOS Safari already auto-adjusts on its own). */
async function applyAutoCamera(track) {
  if (!track || track.kind !== "video" || !track.getCapabilities) return;
  try {
    const caps = track.getCapabilities();
    const adv = {};
    ["focusMode", "exposureMode", "whiteBalanceMode"].forEach((k) => {
      if (Array.isArray(caps[k]) && caps[k].includes("continuous")) adv[k] = "continuous";
    });
    if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
  } catch (err) {
    console.warn("auto camera modes not applied", err);
  }
}

function senderFor(kind, pc) {
  const conn = pc || (primaryPeer() && primaryPeer().pc);
  if (!conn) return null;
  const t = conn.getTransceivers().find((x) => x.receiver && x.receiver.track && x.receiver.track.kind === kind);
  if (!t || t.direction === "recvonly" || t.direction === "inactive") return null;
  return t.sender;
}

async function switchDevice(kind, deviceId, exactFacing = false) {
  if (!state.localStream) { toast("Rejoin the call to use this device", "info"); return false; }
  try {
    const constraints = kind === "video"
      ? { video: videoConstraints(deviceId, exactFacing) }
      : { audio: audioConstraints(deviceId) };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = s.getTracks()[0];
    const old = state.localStream.getTracks().find((t) => t.kind === kind);
    if (old) { state.localStream.removeTrack(old); old.stop(); }
    state.localStream.addTrack(newTrack);
    newTrack.enabled = kind === "video" ? state.camOn : state.micOn;
    if (kind === "video") applyAutoCamera(newTrack);

    if (kind === "video") {
      applyCamEnabled();
      if (!state.screenStream) {
        await syncOutboundVideo();
        el.localVideo.srcObject = state.localStream;
      }
    } else {
      for (const entry of state.peers.values()) {
        const sender = senderFor("audio", entry.pc);
        if (sender) await sender.replaceTrack(newTrack);
      }
    }
    syncControlUI();
    await loadDevices();
    return true;
  } catch (err) {
    console.error("switchDevice", err);
    toast("Could not switch device", "error");
    return false;
  }
}

async function loadDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const cams = list.filter((d) => d.kind === "videoinput");
    const mics = list.filter((d) => d.kind === "audioinput");
    const curCam = state.localStream?.getVideoTracks()[0]?.getSettings().deviceId;
    const curMic = state.localStream?.getAudioTracks()[0]?.getSettings().deviceId;

    const fill = (sel, devs, name, current) => {
      sel.replaceChildren();
      if (!devs.length) { sel.add(new Option(`No ${name.toLowerCase()} found`, "")); sel.disabled = true; return; }
      sel.disabled = false;
      devs.forEach((d, i) => sel.add(new Option(d.label || `${name} ${i + 1}`, d.deviceId)));
      if (current) sel.value = current;
    };
    fill(el.cameraSelect, cams, "Camera", curCam);
    fill(el.micSelect, mics, "Microphone", curMic);

    el.flipBtn.hidden = !(cams.length > 1 && window.matchMedia("(pointer:coarse)").matches);
  } catch (err) {
    console.warn("enumerateDevices", err);
  }
}

/* =========================================================
   Peer connection
   ========================================================= */

function takeTile() {
  const main = el.mainTile;
  if (main && !main.dataset.used) {
    main.dataset.used = "1";
    main.hidden = false;
    return { box: main, video: el.remoteVideo, badge: el.mainBadge };
  }
  const box = document.createElement("div");
  box.className = "remote-tile";
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.className = "remote-video";
  const badge = document.createElement("div");
  badge.className = "tile-badge";
  box.append(video, badge);
  el.remoteGrid.appendChild(box);
  return { box, video, badge };
}
function closeEntry(entry) {
  clearTimeout(entry.restartTimer);
  if (entry.dc) {
    entry.dc.onopen = entry.dc.onclose = entry.dc.onmessage = null;
    try { entry.dc.close(); } catch (e) {}
  }
  const pc = entry.pc;
  pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = pc.ondatachannel = null;
  try { pc.close(); } catch (e) {}
  if (entry.video) entry.video.srcObject = null;
  if (entry.box && entry.box.id === "mainTile") {
    entry.box.hidden = true;
    delete entry.box.dataset.used;
    if (entry.badge) entry.badge.textContent = "";
    if (entry.video) entry.video.classList.remove("cam-off");
  } else if (entry.box) entry.box.remove();
}
function teardownPeer() {
  for (const entry of eachPeer()) closeEntry(entry);
  state.peers.clear();
  stopStats();
  state.remote.connected = false;
  state.remote.cam = true;
  state.peerPresent = false;
  state.announcedConnect = false;
  state.dc = null;
  el.quality.hidden = true;
  if (el.remoteWrap) el.remoteWrap.dataset.count = "0";
  updateChatSub();
}
function outboundTracks() {
  const audioTrack = state.localStream && state.localStream.getAudioTracks()[0];
  const videoTrack = state.screenStream
    ? state.screenStream.getVideoTracks()[0]
    : (!lookIsDefault() ? ensureLookTrack() : cameraTrack());
  return [audioTrack, videoTrack].filter(Boolean);
}
function ensurePeer(peerId, offering) {
  if (!peerId || peerId === socket.id || state.peers.has(peerId)) return state.peers.get(peerId) || null;
  const pc = new RTCPeerConnection(state.iceConfig || DEFAULT_ICE);
  const tile = takeTile();
  const entry = {
    id: peerId, pc, dc: null, offering: !!offering, polite: !offering,
    connected: false, cam: true, pending: [], restartTimer: null,
    video: tile.video, badge: tile.badge, box: tile.box,
  };
  state.peers.set(peerId, entry);
  const kinds = new Set();
  outboundTracks().forEach((track) => {
    pc.addTrack(track);
    kinds.add(track.kind);
  });
  ["audio", "video"].forEach((kind) => {
    if (!kinds.has(kind)) pc.addTransceiver(kind, { direction: "recvonly" });
  });
  pc.ontrack = (e) => {
    if (!state.peers.has(peerId)) return;
    let stream = entry.video.srcObject;
    if (!(stream instanceof MediaStream)) {
      stream = new MediaStream();
      entry.video.srcObject = stream;
    }
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
    entry.video.play().catch(() => {});
    refreshPresence();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("ice-candidate", { to: peerId, candidate: e.candidate.toJSON() });
  };
  pc.ondatachannel = (e) => setupDataChannel(entry, e.channel);
  pc.onconnectionstatechange = () => onPeerState(entry);
  if (offering) {
    setupDataChannel(entry, pc.createDataChannel("chat"));
    createOffer(entry, false);
  }
  refreshPresence();
  return entry;
}
function onPeerState(entry) {
  if (!state.peers.has(entry.id)) return;
  const failed = entry.pc.connectionState === "disconnected" || entry.pc.connectionState === "failed";
  if (entry.pc.connectionState === "connected") {
    clearTimeout(entry.restartTimer);
    entry.connected = true;
    startTimer();
    startStats();
    tuneSenders();
    sendMediaState();
    if (!state.announcedConnect) {
      state.announcedConnect = true;
      toast("Call connected", "success");
    }
  } else if (failed) {
    entry.connected = false;
    if (entry.offering) scheduleIceRestart(entry, entry.pc.connectionState === "failed" ? 0 : 2500);
  }
  refreshPresence();
  if (!state.inCall) return;
  if (!state.peerPresent) setStatus(`Waiting · 1/${state.roomLimit}`, false);
  else setStatus(state.remote.connected ? "Connected" : "Connecting…", !!state.remote.connected);
}
function removePeer(id) {
  const entry = state.peers.get(id);
  if (!entry) return;
  const last = state.peers.size === 1;
  const wasRecording = last && localRecording;
  closeEntry(entry);
  state.peers.delete(id);
  if (last) {
    onSessionReset(true);
    stopTimer();
  }
  refreshPresence();
  if (state.inCall && !state.peerPresent) setStatus(`Waiting · 1/${state.roomLimit}`, false);
  toast(wasRecording ? "Everyone else left · recording saved" : last ? "Everyone else left" : "Someone left the call", "info");
}
function scheduleIceRestart(entry, delay) {
  if (!entry.offering) return;
  clearTimeout(entry.restartTimer);
  entry.restartTimer = setTimeout(() => {
    if (state.peers.get(entry.id) !== entry) return;
    if (entry.pc.connectionState === "disconnected" || entry.pc.connectionState === "failed") createOffer(entry, true);
  }, delay);
}
async function createOffer(entry, iceRestart = false) {
  const pc = entry && entry.pc;
  if (!pc) return;
  if (!iceRestart && pc.signalingState !== "stable" && pc.signalingState !== "have-local-offer") return;
  try {
    const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await pc.setLocalDescription(offer);
    socket.emit("offer", { to: entry.id, type: offer.type, sdp: offer.sdp });
  } catch (err) {
    console.error("createOffer", err);
  }
}
async function flushCandidates(entry) {
  if (!entry) return;
  const list = entry.pending.splice(0);
  for (const candidate of list) {
    try { await entry.pc.addIceCandidate(candidate); } catch (err) { console.warn("addIceCandidate", err); }
  }
}
async function handleOffer(from, offer) {
  try {
    let entry = state.peers.get(from);
    if (!entry) entry = ensurePeer(from, false);
    if (!entry) return;
    const pc = entry.pc;
    if (pc.signalingState === "have-local-offer") {
      if (!entry.polite) return;
      await pc.setLocalDescription({ type: "rollback" });
    }
    await pc.setRemoteDescription(offer);
    await flushCandidates(entry);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { to: from, type: answer.type, sdp: answer.sdp });
  } catch (err) {
    console.error("handleOffer", err);
  }
}
async function handleAnswer(from, answer) {
  const entry = state.peers.get(from);
  if (!entry || entry.pc.signalingState !== "have-local-offer") return;
  try {
    await entry.pc.setRemoteDescription(answer);
    await flushCandidates(entry);
  } catch (err) {
    console.error("handleAnswer", err);
  }
}
async function handleRemoteCandidate(from, candidate) {
  let entry = state.peers.get(from);
  if (!entry) entry = ensurePeer(from, false);
  if (!entry) return;
  if (entry.pc.remoteDescription) {
    try { await entry.pc.addIceCandidate(candidate); } catch (err) { console.warn("addIceCandidate", err); }
  } else entry.pending.push(candidate);
}

/* ---------- quality: bitrate caps + stats ---------- */

async function tuneSenders() {
  for (const entry of eachPeer()) {
  for (const s of entry.pc.getSenders()) {
    if (!s.track) continue;
    try {
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      if (s.track.kind === "video") {
        const q = qualityPreset();
        p.encodings[0].maxBitrate = state.screenStream ? 2500000 : q.maxBitrate;
        p.encodings[0].maxFramerate = state.screenStream ? 30 : q.fps;
        p.degradationPreference = state.screenStream ? "maintain-resolution" : "maintain-framerate";
      } else {
        p.encodings[0].maxBitrate = 48000;
      }
      await s.setParameters(p);
    } catch (e) { /* not supported everywhere */ }
    }
  }
}

function startStats() {
  stopStats();
  state.statsInterval = setInterval(pollStats, 4000);
  pollStats();
}
function stopStats() {
  clearInterval(state.statsInterval);
  state.statsInterval = null;
  state.lastStats = null;
}

async function pollStats() {
  const entries = eachPeer().filter((entry) => entry.connected);
  if (!entries.length) return;
  try {
    let rtt = null, lost = 0, recv = 0;
    for (const entry of entries) {
      const stats = await entry.pc.getStats();
      let selectedId = null;
      stats.forEach((r) => {
        if (r.type === "transport" && r.selectedCandidatePairId) selectedId = r.selectedCandidatePairId;
      });
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && typeof r.currentRoundTripTime === "number") {
          const chosen = selectedId ? r.id === selectedId : (r.selected || (r.nominated && r.state === "succeeded"));
          if (chosen) rtt = rtt === null ? r.currentRoundTripTime * 1000 : Math.max(rtt, r.currentRoundTripTime * 1000);
        }
        if (r.type === "inbound-rtp" && r.kind === "video") {
          lost += r.packetsLost || 0;
          recv += r.packetsReceived || 0;
        }
      });
    }
    let lossPct = 0;
    const prev = state.lastStats;
    if (prev) {
      const dl = Math.max(0, lost - prev.lost), dr = Math.max(0, recv - prev.recv);
      if (dl + dr > 0) lossPct = (dl / (dl + dr)) * 100;
    }
    state.lastStats = { lost, recv };
    if (rtt === null) return;

    const r = rtt;
    let q = "poor";
    if (r < 120 && lossPct < 2) q = "excellent";
    else if (r < 300 && lossPct < 6) q = "good";
    updateQuality(q);

    if (q === "poor" && Date.now() - state.lastPoorToast > 30000) {
      state.lastPoorToast = Date.now();
      toast("Weak connection — video quality may drop", "error");
    }
  } catch (err) {
    console.warn("getStats", err);
  }
}

/* =========================================================
   Peer messaging: chat + media state
   (data channel first, socket relay as fallback)
   ========================================================= */

function setupDataChannel(entry, dc) {
  entry.dc = dc;
  dc.onopen = () => { refreshPresence(); sendMediaState(); };
  dc.onclose = () => refreshPresence();
  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg && typeof msg === "object") msg.from = entry.id;
      handlePeerMsg(msg);
    } catch (err) { /* ignore junk */ }
  };
}

function sendPeer(obj) {
  const entries = eachPeer();
  const allOpen = entries.length > 0 && entries.every((entry) => entry.dc && entry.dc.readyState === "open");
  if (allOpen) {
    const payload = JSON.stringify(obj);
    entries.forEach((entry) => { try { entry.dc.send(payload); } catch (e) {} });
    return true;
  }
  if (state.peerPresent && socket.connected) {
    socket.emit("peer-msg", obj);
    return true;
  }
  return false;
}

function sendMediaState() {
  sendPeer({ type: "media", cam: state.camOn || !!state.screenStream, mic: state.micOn });
}

function handlePeerMsg(m) {
  if (!m || typeof m !== "object") return;
  switch (m.type) {
    case "msg":
      if (typeof m.id === "string" && typeof m.text === "string") receiveMessage(m.id, m.text.slice(0, 500));
      break;
    case "ack":
      if (typeof m.id === "string") markDelivered(m.id);
      break;
    case "media":
      if (m.from && state.peers.has(m.from)) {
        const entry = state.peers.get(m.from);
        entry.cam = !!m.cam;
        markTile(entry);
      }
      refreshPresence();
      break;
    case "ss-req":
      onShotRequest(m.id, m.thumb);
      break;
    case "ss-res":
      onShotResponse(m.id, !!m.allow);
      break;
    case "ss-done":
      appendSys("They saved the screenshot you approved.", true);
      toast("They saved the screenshot", "info");
      break;
    case "ss-alert":
      raiseShield(false);
      appendSys("The other person may have taken a screenshot.", true);
      toast("The other person may have taken a screenshot", "error");
      break;
    case "rec-req":
      onRecRequest(m.id);
      break;
    case "rec-res":
      onRecResponse(m.id, !!m.allow);
      break;
    case "rec-stop":
      onRecStop();
      break;
  }
}

function updateChatSub() {
  if (!state.inCall) return;
  if (!state.peerPresent) el.chatSub.textContent = "Available when someone joins";
  else if (eachPeer().some((entry) => entry.dc && entry.dc.readyState === "open")) el.chatSub.textContent = "Direct · encrypted";
  else el.chatSub.textContent = "Connecting…";
}

/* =========================================================
   Chat UI
   ========================================================= */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function openChat() {
  chat.open = true;
  el.chatPanel.classList.add("open");
  chat.unread = 0;
  el.chatUnread.style.display = "none";
  el.chatBtn.classList.add("on");
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  if (window.matchMedia("(pointer:fine)").matches) setTimeout(() => el.chatInput.focus(), 50);
}
function closeChat() {
  chat.open = false;
  el.chatPanel.classList.remove("open");
  el.emojiPicker.hidden = true;
  el.chatBtn.classList.remove("on");
}

function appendBubble(side, text, id) {
  const div = document.createElement("div");
  div.className = "chat-bubble " + (side === "me" ? "bubble-me" : "bubble-them");
  if (id) div.dataset.id = id;

  if (side === "them") {
    const s = document.createElement("div");
    s.className = "bubble-sender";
    s.textContent = "Participant";
    div.appendChild(s);
  }
  const t = document.createElement("div");
  t.className = "bubble-text";
  t.textContent = text; // textContent: no HTML injection possible
  div.appendChild(t);

  const meta = document.createElement("div");
  meta.className = "bubble-meta";
  const time = document.createElement("span");
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  meta.appendChild(time);

  let ticks = null;
  if (side === "me") {
    ticks = document.createElement("span");
    ticks.className = "bubble-ticks";
    ticks.textContent = "…";
    meta.appendChild(ticks);
  }
  div.appendChild(meta);

  el.chatMessages.appendChild(div);
  while (el.chatMessages.children.length > 202) el.chatMessages.removeChild(el.chatMessages.children[2]);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  return ticks;
}

function markDelivered(id) {
  const p = chat.pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  p.ticks.textContent = "✓✓";
  p.ticks.classList.remove("failed");
  chat.pending.delete(id);
}
function markFailed(id) {
  const p = chat.pending.get(id);
  if (!p) return;
  p.ticks.textContent = "!";
  p.ticks.classList.add("failed");
  p.ticks.title = "Not delivered";
  chat.pending.delete(id);
}

function sendChat() {
  const text = el.chatInput.value.trim();
  if (!text) return;
  if (!state.peerPresent) {
    toast("Chat works once someone else has joined", "info");
    return;
  }
  const id = uid();
  const ok = sendPeer({ type: "msg", id, text: text.slice(0, 500) });
  const ticks = appendBubble("me", text, id);
  if (ok) {
    chat.pending.set(id, { ticks, timer: setTimeout(() => markFailed(id), 10000) });
  } else {
    ticks.textContent = "!";
    ticks.classList.add("failed");
    ticks.title = "Not delivered";
  }
  el.chatInput.value = "";
  el.emojiPicker.hidden = true;
  el.chatInput.focus();
}

function receiveMessage(id, text) {
  sendPeer({ type: "ack", id }); // always ack, even duplicates
  if (chat.seen.has(id)) return;
  chat.seen.add(id);
  appendBubble("them", text, id);
  if (!chat.open) {
    chat.unread++;
    el.chatUnread.textContent = chat.unread > 9 ? "9+" : String(chat.unread);
    el.chatUnread.style.display = "flex";
  }
}

function resetChat() {
  chat.pending.forEach((p) => clearTimeout(p.timer));
  chat.pending.clear();
  chat.seen.clear();
  chat.unread = 0;
  el.chatUnread.style.display = "none";
  el.chatMessages.innerHTML = chatInitialHTML;
  el.chatInput.value = "";
  closeChat();
}

el.chatBtn.addEventListener("click", () => (chat.open ? closeChat() : openChat()));
el.chatCloseBtn.addEventListener("click", closeChat);
el.chatSendBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep keyboard open on mobile
el.chatSendBtn.addEventListener("click", sendChat);
el.chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});
el.chatEmojiBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  el.emojiPicker.hidden = !el.emojiPicker.hidden;
});
el.emojiPicker.addEventListener("click", (e) => {
  e.stopPropagation();
  const span = e.target.closest("[data-emoji]");
  if (!span) return;
  el.chatInput.value += span.dataset.emoji;
  el.chatInput.focus();
});

/* =========================================================
   Controls
   ========================================================= */

el.micBtn.addEventListener("click", () => {
  const track = state.localStream && state.localStream.getAudioTracks()[0];
  if (!track) return toast("Microphone not available", "error");
  state.micOn = !state.micOn;
  track.enabled = state.micOn;
  syncControlUI();
  sendMediaState();
});

el.camBtn.addEventListener("click", () => {
  const track = state.localStream && state.localStream.getVideoTracks()[0];
  if (!track) return toast("Camera not available", "error");
  state.camOn = !state.camOn;
  applyCamEnabled();
  syncControlUI();
  sendMediaState();
});

el.flipBtn.addEventListener("click", async () => {
  const prev = state.facing;
  state.facing = prev === "user" ? "environment" : "user";
  const ok = await switchDevice("video", null, true);
  if (!ok) state.facing = prev;
  syncControlUI();
});

el.cameraSelect.addEventListener("change", () => {
  if (el.cameraSelect.value) switchDevice("video", el.cameraSelect.value);
});
el.micSelect.addEventListener("change", () => {
  if (el.micSelect.value) switchDevice("audio", el.micSelect.value);
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => { if (state.inCall) loadDevices(); });
}

/* ---------- screen share ---------- */

async function startScreenShare() {
  if (!state.peerPresent) return toast("Screen sharing isn't available until someone joins", "error");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
  } catch (err) {
    if (err && err.name !== "NotAllowedError") toast("Could not share screen", "error");
    return;
  }

  const track = stream.getVideoTracks()[0];
  let needOffer = false;
  try {
    track.contentHint = "detail";
    let replaced = false;
    for (const entry of eachPeer()) {
      let sender = senderFor("video", entry.pc);
      if (!sender) {
        const got = ensureSendableVideo(entry.pc);
        if (!got) continue;
        sender = got.sender;
        needOffer = needOffer || got.renegotiate;
      }
      await sender.replaceTrack(track);
      replaced = true;
    }
    if (!replaced) {
      stream.getTracks().forEach((t) => t.stop());
      return toast("Screen sharing isn't available in this call", "error");
    }
    stopLookPipeline();
    state.screenStream = stream;
    el.localVideo.srcObject = stream;
    el.localVideo.style.filter = "";
    track.onended = () => stopScreenShare();
    syncControlUI();
    tuneSenders();
    sendMediaState();
    if (needOffer) await renegotiate();
    toast("Screen sharing started", "success");
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    console.error("startScreenShare", err);
    toast("Could not share screen", "error");
  }
}

async function stopScreenShare(silent = false) {
  const stream = state.screenStream;
  if (!stream) return;
  state.screenStream = null;
  stream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  el.localVideo.srcObject = state.localStream;
  try {
    if (!cameraTrack()) {
      for (const entry of eachPeer()) {
        const sender = senderFor("video", entry.pc);
        if (!sender) continue;
        await sender.replaceTrack(null);
        const tr = entry.pc.getTransceivers().find((t) => t.sender === sender);
        if (tr) tr.direction = "recvonly";
      }
      if (!silent) await renegotiate();
    } else {
      await syncOutboundVideo();
    }
  } catch (e) { /* sender may already be closed */ }
  syncControlUI();
  if (!silent) {
    tuneSenders();
    sendMediaState();
    toast("Screen sharing stopped", "info");
  }
}

el.shareBtn.addEventListener("click", () => (state.screenStream ? stopScreenShare() : startScreenShare()));

/* ---------- misc buttons ---------- */

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) {}
    ta.remove();
    return ok;
  }
}

function roomLink() {
  if (!state.roomId) return "";
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
}
function showInviteLink() {
  if (!el.inviteLink) return;
  const link = roomLink();
  el.inviteLink.hidden = !link;
  el.inviteLink.textContent = link;
}
async function shareRoomLink() {
  const link = roomLink();
  if (!link) return;
  if (navigator.share && window.matchMedia("(pointer:coarse)").matches) {
    try { await navigator.share({ title: "Join my call", url: link }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  (await copyText(link)) ? toast("Invite link copied", "success") : toast("Could not copy link", "error");
}
el.copyBtn.addEventListener("click", shareRoomLink);
if (el.inviteLink) el.inviteLink.addEventListener("click", shareRoomLink);

el.devicesBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = el.deviceBar.classList.toggle("open");
  el.devicesBtn.setAttribute("aria-expanded", String(open));
  if (open) loadDevices();
});
el.deviceBar.addEventListener("click", (e) => e.stopPropagation());

document.addEventListener("click", () => {
  el.deviceBar.classList.remove("open");
  el.devicesBtn.setAttribute("aria-expanded", "false");
  el.emojiPicker.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (state.inCall && captureKey(e)) {
    if (e.key !== "PrintScreen") e.preventDefault();
    protectCapture();
  }
  if (e.key !== "Escape") return;
  if (!el.lightbox.hidden) { closeLightbox(); return; }
  if (!el.consent.hidden) { respondConsent(false); return; }
  el.deviceBar.classList.remove("open");
  el.devicesBtn.setAttribute("aria-expanded", "false");
  el.emojiPicker.hidden = true;
});
document.addEventListener("keyup", (e) => {
  if (state.inCall && e.key === "PrintScreen") protectCapture();
});
window.addEventListener("beforeprint", () => { if (state.inCall) protectCapture("print"); });
window.addEventListener("afterprint", () => lowerShield(true));

el.fitBtn.addEventListener("click", () => el.remoteWrap.classList.toggle("fill"));
el.remoteWrap.addEventListener("dblclick", () => el.remoteWrap.classList.toggle("fill"));

el.fullscreenBtn.addEventListener("click", async () => {
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) await root.requestFullscreen();
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else toast("Fullscreen isn't supported on this browser", "info");
    } else {
      await document.exitFullscreen();
    }
  } catch (err) { console.warn("fullscreen", err); }
});

el.endBtn.addEventListener("click", () => endCall());

/* ---------- draggable PiP (mouse + touch) ---------- */

(function initPip() {
  const pip = el.pip;
  let drag = null;

  function place(x, y) {
    const host = el.videoSection.getBoundingClientRect();
    const maxX = host.width - pip.offsetWidth - 8;
    const maxY = host.height - pip.offsetHeight - 8;
    pip.style.left = Math.max(8, Math.min(maxX, x)) + "px";
    pip.style.top = Math.max(8, Math.min(maxY, y)) + "px";
    pip.style.right = "auto";
    pip.style.bottom = "auto";
  }

  pip.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const r = pip.getBoundingClientRect();
    const host = el.videoSection.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, hx: host.left, hy: host.top };
    pip.setPointerCapture(e.pointerId);
  });
  pip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    place(e.clientX - drag.hx - drag.dx, e.clientY - drag.hy - drag.dy);
  });
  const end = () => { drag = null; };
  pip.addEventListener("pointerup", end);
  pip.addEventListener("pointercancel", end);

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (pip.style.left) place(parseFloat(pip.style.left), parseFloat(pip.style.top));
    }).observe(el.videoSection);
  }
})();

/* ---------- keep screen awake ---------- */

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
    }
  } catch (e) { /* not critical */ }
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.inCall) requestWakeLock();
});

/* =========================================================
   Join / leave
   ========================================================= */

let lobbyMode = "create";

function setLobbyMode(mode) {
  lobbyMode = mode === "join" ? "join" : "create";
  const creating = lobbyMode === "create";
  el.createPane.hidden = !creating;
  el.joinPane.hidden = creating;
  el.modeCreate.classList.toggle("active", creating);
  el.modeJoin.classList.toggle("active", !creating);
  el.modeCreate.setAttribute("aria-selected", String(creating));
  el.modeJoin.setAttribute("aria-selected", String(!creating));
}
function syncCodeMode() {
  const own = document.querySelector('input[name="codeMode"]:checked');
  el.ownCodeRow.hidden = !own || own.value !== "own";
}
function makeHostToken() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function codeFromText(raw) {
  const text = String(raw || "").trim();
  try {
    if (text.includes("://")) {
      const room = new URL(text).searchParams.get("room");
      if (room) return room.trim();
    }
  } catch (e) { /* not a url */ }
  const match = text.match(/[?&]room=([^&\s]+)/i);
  if (match) {
    try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
  }
  return text;
}
function savedTokenFor(code) {
  try {
    const saved = JSON.parse(sessionStorage.getItem("pc-room") || "null");
    const normalized = String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (saved && String(saved.code || "").toLowerCase() === normalized) return saved.token || "";
  } catch (e) { /* ignore */ }
  return "";
}
function rememberRoom() {
  try {
    sessionStorage.setItem("pc-room", JSON.stringify({
      code: state.roomId,
      limit: state.roomLimit,
      token: state.isHost ? state.hostToken : ""
    }));
  } catch (e) { /* private mode */ }
}
async function beginCall() {
  await Promise.all([startMedia(), loadIceConfig()]);
  state.inCall = true;
  el.app.classList.add("in-call");
  el.joinScreen.classList.add("hidden");
  el.callScreen.classList.add("active");
  updateRemoteView();
  setStatus("Joining…", false);
  updateChatSub();
  requestWakeLock();
  loadDevices();
}
async function createRoom() {
  if (state.joining || state.inCall) return;
  const picked = document.querySelector('input[name="codeMode"]:checked');
  const random = !picked || picked.value === "random";
  const limit = Number(el.roomLimit.value);
  const code = random ? "" : el.ownCode.value.trim();
  if (!random && !/^[a-z0-9]{6,16}$/i.test(code)) {
    toast("Use 6–16 letters or numbers", "error");
    el.ownCode.focus();
    return;
  }
  state.hostToken = makeHostToken();
  state.joining = true;
  el.createBtn.disabled = true;
  el.createBtnText.textContent = "Creating…";
  try {
    await beginCall();
    socket.emit("create-room", { code, limit, random, token: state.hostToken });
  } catch (err) {
    console.error("create error", err);
    endCall("Could not create the room");
  } finally {
    state.joining = false;
    el.createBtn.disabled = false;
    el.createBtnText.textContent = "Create room";
  }
}
async function joinRoom() {
  if (state.joining || state.inCall) return;
  const code = codeFromText(el.roomInput.value);
  if (!code) {
    toast("Enter a room code or paste the room link", "error");
    el.roomInput.focus();
    return;
  }
  state.hostToken = savedTokenFor(code);
  state.joining = true;
  el.joinBtn.disabled = true;
  el.joinBtnText.textContent = "Joining…";
  try {
    await beginCall();
    socket.emit("join-room", { code, token: state.hostToken });
  } catch (err) {
    console.error("join error", err);
    endCall("Could not join the room");
  } finally {
    state.joining = false;
    el.joinBtn.disabled = false;
    el.joinBtnText.textContent = "Join room";
  }
}

el.modeCreate.addEventListener("click", () => setLobbyMode("create"));
el.modeJoin.addEventListener("click", () => setLobbyMode("join"));
document.querySelectorAll('input[name="codeMode"]').forEach((input) => {
  input.addEventListener("change", syncCodeMode);
});
el.joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (lobbyMode === "create") createRoom();
  else joinRoom();
});

function onRoomJoined(info) {
  if (!info || typeof info.code !== "string") return;
  state.roomId = info.code;
  state.roomLimit = info.limit || state.roomLimit;
  state.isHost = !!info.host;
  el.roomName.textContent = info.host ? `${info.code} · host` : info.code;
  setWatermark(info.code);
  rememberRoom();
  showInviteLink();
  const ids = new Set(Array.isArray(info.peers) ? info.peers : []);
  for (const id of [...state.peers.keys()]) if (!ids.has(id)) removePeer(id);
  ids.forEach((id) => ensurePeer(id, false));
  refreshPresence();
  if (!state.peerPresent) setStatus(`Waiting · 1/${state.roomLimit}`, false);
  if (!state.announcedRoom) {
    state.announcedRoom = true;
    if (info.host && !state.peerPresent) toast("Room ready. Copy the link to invite people.", "success");
  }
}
function onRoomError(err) {
  const message = (err && err.message) || "Could not enter that room";
  if (state.inCall && state.isHost && err && err.reason === "missing" && !state.recreateTried) {
    state.recreateTried = true;
    socket.emit("create-room", {
      code: state.roomId,
      limit: state.roomLimit,
      random: false,
      token: state.hostToken
    });
    return;
  }
  endCall(message);
}

function endCall(message) {
  const wasRecording = !!(state.inCall && localRecording);
  if (state.inCall) onSessionReset(true);
  if (state.roomId) socket.emit("leave-room");

  state.inCall = false;
  state.roomId = null;
  state.peerPresent = false;
  state.isHost = false;
  state.announcedRoom = false;
  state.announcedConnect = false;
  state.recreateTried = false;

  stopScreenShare(true);
  stopLookPipeline();
  teardownPeer();
  stopTimer();
  stopLocalMedia();
  releaseWakeLock();
  resetChat();
  syncControlUI();
  setWatermark("");
  showInviteLink();
  closeSharedAudio();

  el.deviceBar.classList.remove("open");
  el.app.classList.remove("in-call");
  el.callScreen.classList.remove("active");
  el.joinScreen.classList.remove("hidden");
  setStatus("Offline", false);
  updateRemoteView();

  const base = message || "Call ended";
  toast(wasRecording ? `${base} · recording saved` : base, "info");
}

/* =========================================================
   Socket events
   ========================================================= */

socket.on("connect", () => {
  setServerStatus(true);
  if (state.inCall && state.roomId) {
    const wasRecording = onSessionReset(true);
    teardownPeer();
    setStatus("Reconnecting…", false);
    if (wasRecording) toast("Reconnecting… recording saved", "info");
    socket.emit("join-room", { code: state.roomId, token: state.hostToken });
  }
});

socket.on("disconnect", () => {
  setServerStatus(false);
  if (state.inCall) setStatus("Server connection lost…", false);
});

socket.on("room-joined", onRoomJoined);
socket.on("room-error", onRoomError);

socket.on("peer-joined", (msg) => {
  if (!msg || typeof msg.id !== "string") return;
  ensurePeer(msg.id, true);
  toast("Someone joined", "success");
  refreshPresence();
});

socket.on("offer", (msg) => { if (msg && msg.from) handleOffer(msg.from, msg); });
socket.on("answer", (msg) => { if (msg && msg.from) handleAnswer(msg.from, msg); });
socket.on("ice-candidate", (msg) => { if (msg && msg.from && msg.candidate) handleRemoteCandidate(msg.from, msg.candidate); });
socket.on("peer-msg", handlePeerMsg);

socket.on("peer-left", (msg) => {
  if (msg && typeof msg.id === "string") removePeer(msg.id);
});

/* =========================================================
   Camera look, capture consent, screenshot protection
   ========================================================= */

const FILTERS = {
  none: "",
  warm: "sepia(0.28) hue-rotate(-12deg)",
  cool: "hue-rotate(18deg)",
  vivid: "saturate(1.35) contrast(1.06)",
  soft: "contrast(0.92) brightness(1.04)",
  night: "brightness(1.28) contrast(1.12) saturate(0.75)",
  vintage: "sepia(0.4) contrast(0.92)",
  bw: "grayscale(1) contrast(1.05)",
};

function cameraTrack() {
  return (state.localStream && state.localStream.getVideoTracks()[0]) || null;
}
function lookIsDefault() {
  return look.brightness === 100 && look.contrast === 100 && look.saturate === 100 && look.filter === "none" && !look.auto;
}
function filterString() {
  const b = (look.brightness / 100) * (look.auto ? autoMul : 1);
  const c = look.contrast / 100;
  const s = look.saturate / 100;
  return `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)}) saturate(${s.toFixed(3)}) ${FILTERS[look.filter] || ""}`.trim();
}
function applyLookCss() {
  if (!el.localVideo) return;
  el.localVideo.style.filter = state.screenStream || lookIsDefault() ? "" : filterString();
}
function applyCamEnabled() {
  const cam = cameraTrack();
  if (cam) cam.enabled = state.camOn;
  const out = lookStream && lookStream.getVideoTracks()[0];
  if (out && !state.screenStream) out.enabled = state.camOn;
}

function stopLookPipeline() {
  lookGen++;
  cancelAnimationFrame(lookRaf);
  lookRaf = 0;
  if (lookStream) {
    lookStream.getTracks().forEach((t) => t.stop());
    lookStream = null;
  }
  lookCanvas = null;
  lookCtx = null;
}
function ensureLookTrack() {
  const existing = lookStream && lookStream.getVideoTracks()[0];
  if (existing && existing.readyState === "live") return existing;
  try {
    lookCanvas = document.createElement("canvas");
    lookCanvas.width = 1280;
    lookCanvas.height = 720;
    lookCtx = lookCanvas.getContext("2d", { alpha: false });
    lookStream = lookCanvas.captureStream(30);
    const track = lookStream.getVideoTracks()[0];
    track.enabled = state.camOn;
    const gen = lookGen;
    if (!lookRaf) lookRaf = requestAnimationFrame(() => drawLook(gen));
    return track;
  } catch (err) {
    console.warn("look pipeline", err);
    stopLookPipeline();
    return cameraTrack();
  }
}
function drawLook(gen) {
  if (gen !== lookGen) return;
  lookRaf = requestAnimationFrame(() => drawLook(gen));
  const video = el.localVideo;
  const ctx = lookCtx;
  if (!ctx || !video || state.screenStream) return;
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (!w || !h) return;
  if (lookCanvas.width !== w || lookCanvas.height !== h) {
    lookCanvas.width = w;
    lookCanvas.height = h;
  }
  const out = lookStream && lookStream.getVideoTracks()[0];
  if (out) out.enabled = state.camOn;
  if (!state.camOn) {
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (look.auto) sampleAutoLight(video);
  ctx.filter = filterString();
  ctx.drawImage(video, 0, 0, w, h);
}
function sampleAutoLight(video) {
  if ((lookFrames++ % 12) !== 0) return;
  try {
    if (!lookSample) {
      lookSample = document.createElement("canvas");
      lookSample.width = 24;
      lookSample.height = 14;
    }
    const sctx = lookSample.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(video, 0, 0, 24, 14);
    const data = sctx.getImageData(0, 0, 24, 14).data;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 16) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++;
    }
    const luma = sum / Math.max(1, n);
    const desired = Math.min(1.65, Math.max(0.7, 120 / Math.max(18, luma)));
    autoMul += (desired - autoMul) * 0.2;
    applyLookCss();
  } catch (err) {
    look.auto = false;
    if (el.autoLight) el.autoLight.checked = false;
    console.warn("auto light", err);
  }
}
async function syncOutboundOnce() {
  if (!state.inCall || state.screenStream || !state.peers.size) return;
  if (lookIsDefault()) {
    const cam = cameraTrack();
    for (const entry of eachPeer()) {
      const sender = senderFor("video", entry.pc);
      if (sender && sender.track !== cam) await sender.replaceTrack(cam);
    }
    stopLookPipeline();
    return;
  }
  const track = ensureLookTrack();
  if (!track) return;
  track.enabled = state.camOn;
  for (const entry of eachPeer()) {
    const sender = senderFor("video", entry.pc);
    if (sender && sender.track !== track) await sender.replaceTrack(track);
  }
  applyCamEnabled();
}
async function syncOutboundVideo() {
  applyLookCss();
  if (syncingVideo) { syncVideoAgain = true; return; }
  syncingVideo = true;
  try {
    do {
      syncVideoAgain = false;
      await syncOutboundOnce();
    } while (syncVideoAgain);
  } catch (err) {
    console.warn("syncOutboundVideo", err);
  } finally {
    syncingVideo = false;
  }
}
function ensureSendableVideo(pc) {
  if (!pc) return null;
  const tr = pc.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === "video");
  if (!tr) return null;
  const wasRecv = tr.direction === "recvonly" || tr.direction === "inactive";
  if (wasRecv) tr.direction = "sendrecv";
  return { sender: tr.sender, renegotiate: wasRecv };
}
async function renegotiate() {
  if (!state.peerPresent) return;
  for (const entry of eachPeer()) {
    if (entry.pc.signalingState === "stable") await createOffer(entry, false);
  }
}
async function applyQuality() {
  const q = qualityPreset();
  const track = cameraTrack();
  if (track) {
    try {
      await track.applyConstraints({
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: q.fps, max: 30 },
      });
    } catch (err) {
      toast("This camera can't use that quality", "error");
    }
  }
  tuneSenders();
}
function bindLook() {
  const bindRange = (input, out, key) => {
    input.addEventListener("input", () => {
      look[key] = Number(input.value);
      out.textContent = input.value + "%";
      syncOutboundVideo();
    });
  };
  bindRange(el.brightness, el.brightnessVal, "brightness");
  bindRange(el.contrast, el.contrastVal, "contrast");
  bindRange(el.saturate, el.saturateVal, "saturate");
  el.filterChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    look.filter = btn.dataset.filter || "none";
    el.filterChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === btn));
    syncOutboundVideo();
  });
  el.autoLight.addEventListener("change", () => {
    look.auto = el.autoLight.checked;
    if (!look.auto) autoMul = 1;
    syncOutboundVideo();
  });
  el.qualitySelect.addEventListener("change", () => applyQuality());
  el.resetLookBtn.addEventListener("click", () => {
    look.brightness = look.contrast = look.saturate = 100;
    look.filter = "none";
    look.auto = false;
    autoMul = 1;
    el.brightness.value = el.contrast.value = el.saturate.value = "100";
    el.brightnessVal.textContent = el.contrastVal.textContent = el.saturateVal.textContent = "100%";
    el.autoLight.checked = false;
    el.filterChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === "none"));
    syncOutboundVideo();
  });
  applyLookCss();
}

function setWatermark(roomId) {
  el.watermark.replaceChildren();
  if (!roomId) return;
  const label = "PrivateCall · " + String(roomId).slice(0, 24);
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.textContent = label;
    el.watermark.appendChild(s);
  }
}
function appendSys(text, notify) {
  const div = document.createElement("div");
  div.className = "chat-sys-note";
  div.textContent = text;
  el.chatMessages.appendChild(div);
  while (el.chatMessages.children.length > 202) el.chatMessages.removeChild(el.chatMessages.children[2]);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  if (notify && !chat.open) {
    chat.unread++;
    el.chatUnread.textContent = chat.unread > 9 ? "9+" : String(chat.unread);
    el.chatUnread.style.display = "flex";
  }
}
function safeFilePart(value) {
  return String(value || "call").replace(/[^a-z0-9_-]+/gi, "").slice(0, 40) || "call";
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function dataUrlToBlob(url) {
  const comma = url.indexOf(",");
  const meta = url.slice(0, comma);
  const b64 = url.slice(comma + 1);
  const mime = (meta.match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function validId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 40;
}
function validThumb(thumb) {
  return typeof thumb === "string" &&
    thumb.startsWith("data:image/jpeg;base64,") &&
    thumb.length > 32 && thumb.length < 250000;
}
function frameToJpeg(video) {
  let w = video.videoWidth;
  let h = video.videoHeight;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const label = "PrivateCall · " + String(state.roomId || "").slice(0, 24);
  let url = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = w;
    canvas.height = h;
    ctx.filter = "none";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.32);
    for (let y = -h; y <= h; y += 72) {
      for (let x = -w; x <= w; x += 240) ctx.fillText(label, x, y);
    }
    ctx.restore();
    let q = 0.72;
    url = canvas.toDataURL("image/jpeg", q);
    while (url.length > 220000 && q > 0.4) {
      q -= 0.08;
      url = canvas.toDataURL("image/jpeg", q);
    }
    if (validThumb(url)) return url;
    w = Math.max(320, Math.round(w * 0.75));
    h = Math.max(180, Math.round(h * 0.75));
  }
  return validThumb(url) ? url : "";
}

function closeDevicePanel() {
  el.deviceBar.classList.remove("open");
  el.devicesBtn.setAttribute("aria-expanded", "false");
}
function requireLivePeer() {
  if (!state.peerPresent || !state.remote.connected) {
    toast("Wait until the call is connected", "info");
    return false;
  }
  return true;
}
function closeLightbox() {
  el.lightbox.hidden = true;
  el.lightboxImg.removeAttribute("src");
}
function openLightbox() {
  const src = el.consentImg.getAttribute("src") || "";
  if (!validThumb(src)) return;
  el.lightboxImg.src = src;
  el.lightbox.hidden = false;
}
function hideConsent() {
  el.consent.hidden = true;
  el.consentImg.removeAttribute("src");
  el.consentImg.hidden = true;
  el.consentFull.hidden = true;
  el.consentTimer.textContent = "";
}
function armConsent() {
  if (!dialog) return;
  el.consentTimer.textContent = `Auto-denies in ${dialog.left}s`;
  dialog.timer = setTimeout(() => {
    if (!dialog) return;
    dialog.left -= 1;
    if (dialog.left <= 0) respondConsent(false);
    else armConsent();
  }, 1000);
}
function openConsent(next) {
  if (dialog) clearTimeout(dialog.timer);
  dialog = next;
  dialog.left = 20;
  el.consentTitle.textContent = next.title;
  el.consentText.textContent = next.text;
  if (next.thumb) {
    el.consentImg.src = next.thumb;
    el.consentImg.hidden = false;
    el.consentFull.hidden = false;
  } else {
    el.consentImg.hidden = true;
    el.consentFull.hidden = true;
  }
  el.consent.hidden = false;
  el.consentAllow.focus();
  armConsent();
  closeDevicePanel();
}
function respondConsent(allow) {
  if (!dialog) return;
  clearTimeout(dialog.timer);
  const d = dialog;
  dialog = null;
  hideConsent();
  closeLightbox();
  if (d.kind === "shot") {
    sendPeer({ type: "ss-res", id: d.id, allow: !!allow });
    return;
  }
  sendPeer({ type: "rec-res", id: d.id, allow: !!allow });
  if (allow) {
    peerRecording = true;
    updateRecUi();
    appendSys("You allowed recording. Stop it any time from the red banner.", true);
  }
}
function dismissDialog(notify) {
  if (!dialog) return;
  if (notify) { respondConsent(false); return; }
  clearTimeout(dialog.timer);
  dialog = null;
  hideConsent();
  closeLightbox();
}

function requestShot() {
  if (shotAsk) return;
  if (!requireLivePeer()) return;
  if (!state.remote.cam) return toast("Their camera is off, so there's nothing to capture", "info");
  const video = eachPeer().map((entry) => entry.video).find((item) => item && item.readyState >= 2 && item.videoWidth) || el.remoteVideo;
  if (video.readyState < 2 || !video.videoWidth) return toast("Their video isn't ready yet", "info");
  const url = frameToJpeg(video);
  if (!validThumb(url)) return toast("Couldn't prepare a preview small enough to send", "error");
  const id = uid();
  if (!sendPeer({ type: "ss-req", id, thumb: url })) return toast("Couldn't send the screenshot request", "error");
  shotAsk = { id, url, timer: setTimeout(() => finishShot(id, false, "Screenshot request timed out"), 20000) };
  el.shotBtn.disabled = true;
  el.shotBtn.textContent = "Waiting…";
  closeDevicePanel();
  toast("Waiting for their approval", "info");
}
function finishShot(id, allow, message) {
  if (!shotAsk || shotAsk.id !== id) return;
  clearTimeout(shotAsk.timer);
  const url = shotAsk.url;
  shotAsk = null;
  el.shotBtn.disabled = false;
  el.shotBtn.textContent = "📸 Screenshot";
  if (!allow) { if (message) toast(message, "info"); return; }
  try {
    downloadBlob(dataUrlToBlob(url), `privatecall-${safeFilePart(state.roomId)}-${stamp()}.jpg`);
    sendPeer({ type: "ss-done", id });
    toast("Screenshot saved", "success");
  } catch (err) {
    console.error("screenshot", err);
    toast("Couldn't save the screenshot", "error");
  }
}
function onShotRequest(id, thumb) {
  if (!validId(id) || !validThumb(thumb) || dialog) {
    if (validId(id)) sendPeer({ type: "ss-res", id, allow: false });
    return;
  }
  openConsent({
    kind: "shot",
    id,
    thumb,
    title: "Screenshot request",
    text: "They want to save this image of your video. Allowing covers this one image only.",
  });
}
function onShotResponse(id, allow) {
  if (!shotAsk || id !== shotAsk.id) return;
  finishShot(id, allow, allow ? "" : "Screenshot was denied");
}

function updateRecUi() {
  const on = localRecording || peerRecording;
  el.recBanner.hidden = !on;
  if (localRecording) el.recText.textContent = "You are recording this call";
  else if (peerRecording) el.recText.textContent = "This call is being recorded";
  el.recBtn.disabled = !!recAskId;
  el.recBtn.classList.toggle("danger", localRecording);
  el.recBtn.textContent = localRecording ? "⏹ Stop" : (recAskId ? "Waiting…" : "⏺ Record");
}
function clearRecAsk() {
  clearTimeout(recAskTimer);
  recAskId = null;
}
function recorderMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  return mimeType ? { mimeType, videoBitsPerSecond: 2000000 } : { videoBitsPerSecond: 2000000 };
}
function cleanupRecorder() {
  recGen++;
  cancelAnimationFrame(recRAF);
  recRAF = 0;
  if (recAudio) {
    recAudio.sources.forEach((s) => { try { s.disconnect(); } catch (e) {} });
    recAudio = null;
  }
  if (recCanvasStream) {
    recCanvasStream.getTracks().forEach((t) => t.stop());
    recCanvasStream = null;
  }
  rec = null;
  recChunks = [];
}
function closeSharedAudio() {
  if (rec && rec.state !== "inactive") return;
  if (sharedAudio && sharedAudio.state !== "closed") sharedAudio.close().catch(() => {});
  sharedAudio = null;
}
async function warmAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    if (!sharedAudio || sharedAudio.state === "closed") sharedAudio = new AC();
    if (sharedAudio.state === "suspended") await sharedAudio.resume();
    return sharedAudio;
  } catch (err) {
    console.warn("audio context", err);
    return null;
  }
}
function paintRec(ctx, canvas) {
  const remotes = eachPeer().map((entry) => entry.video).filter((video) => video && video.readyState >= 2 && video.videoWidth);
  const remote = remotes[0] || el.remoteVideo;
  const local = el.localVideo;
  let w = (remotes.length > 1 ? 1280 : (remote.videoWidth || 1280));
  let h = (remotes.length > 1 ? 720 : (remote.videoHeight || 720));
  const scale = Math.min(1, 1280 / w, 720 / h);
  w = Math.max(2, Math.round(w * scale));
  h = Math.max(2, Math.round(h * scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.filter = "none";
  ctx.fillStyle = "#071014";
  ctx.fillRect(0, 0, w, h);
  if (remotes.length > 1) {
    const cols = remotes.length <= 4 ? 2 : 3;
    const rows = Math.ceil(remotes.length / cols);
    const cw = w / cols;
    const ch = h / rows;
    remotes.forEach((video, i) => {
      ctx.drawImage(video, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
    });
  } else if (remote.readyState >= 2 && state.remote.cam) {
    ctx.drawImage(remote, 0, 0, w, h);
  }
  const pipW = Math.max(80, Math.round(w * 0.22));
  const pipH = Math.round(pipW * 0.75);
  const px = w - pipW - 12;
  const py = h - pipH - 12;
  ctx.fillStyle = "#101b1f";
  ctx.fillRect(px, py, pipW, pipH);
  if (local.readyState >= 2 && (state.camOn || state.screenStream)) {
    ctx.save();
    ctx.filter = state.screenStream ? "none" : filterString();
    if (!state.screenStream && state.facing === "user") {
      ctx.translate(px + pipW, py);
      ctx.scale(-1, 1);
      ctx.drawImage(local, 0, 0, pipW, pipH);
    } else {
      ctx.drawImage(local, px, py, pipW, pipH);
    }
    ctx.restore();
  }
}
function startRecorder() {
  if (localRecording) return;
  if (!window.MediaRecorder) {
    sendPeer({ type: "rec-stop" });
    toast("Recording isn't supported in this browser", "error");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { alpha: false });
  let stream;
  try {
    stream = canvas.captureStream(30);
  } catch (err) {
    sendPeer({ type: "rec-stop" });
    toast("Couldn't start recording", "error");
    return;
  }
  if (sharedAudio && sharedAudio.state === "running") {
    try {
      const dest = sharedAudio.createMediaStreamDestination();
      const sources = [];
      [state.localStream, state.remoteStream].forEach((media) => {
        if (!media || !media.getAudioTracks().length) return;
        const src = sharedAudio.createMediaStreamSource(media);
        src.connect(dest);
        sources.push(src);
      });
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      recAudio = { sources };
    } catch (err) {
      console.warn("record audio", err);
    }
  }
  recChunks = [];
  recSave = true;
  const gen = ++recGen;
  try {
    rec = new MediaRecorder(stream, recorderMime());
  } catch (err) {
    try { rec = new MediaRecorder(stream); }
    catch (e2) {
      stream.getTracks().forEach((t) => t.stop());
      if (recAudio) recAudio.sources.forEach((s) => { try { s.disconnect(); } catch (e) {} });
      recAudio = null;
      sendPeer({ type: "rec-stop" });
      toast("Couldn't start recording", "error");
      return;
    }
  }
  recCanvasStream = stream;
  paintRec(ctx, canvas);
  rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = () => {
    const chunks = recChunks.slice();
    const mime = rec.mimeType || "video/webm";
    const save = recSave;
    cleanupRecorder();
    if (save && chunks.length) {
      const blob = new Blob(chunks, { type: mime });
      if (blob.size) {
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `privatecall-${safeFilePart(state.roomId)}-${stamp()}.${ext}`);
      }
    }
    if (!state.inCall) closeSharedAudio();
    updateRecUi();
  };
  const draw = () => {
    if (gen !== recGen) return;
    recRAF = requestAnimationFrame(draw);
    paintRec(ctx, canvas);
  };
  try {
    rec.start(1000);
  } catch (err) {
    cleanupRecorder();
    sendPeer({ type: "rec-stop" });
    toast("Couldn't start recording", "error");
    return;
  }
  recRAF = requestAnimationFrame(draw);
  localRecording = true;
  updateRecUi();
  appendSys("Recording started. Either person can stop it.", false);
  toast("Recording started", "success");
}
function stopRecording(save) {
  recSave = !!save;
  localRecording = false;
  if (rec && rec.state !== "inactive") {
    try { rec.stop(); }
    catch (err) { cleanupRecorder(); }
  } else {
    cleanupRecorder();
  }
  updateRecUi();
}
async function requestRec() {
  if (localRecording) {
    sendPeer({ type: "rec-stop" });
    stopRecording(true);
    toast("Recording saved", "info");
    return;
  }
  if (recAskId) return;
  if (!window.MediaRecorder) return toast("Recording isn't supported in this browser", "error");
  if (!requireLivePeer()) return;
  await warmAudio();
  const id = uid();
  if (!sendPeer({ type: "rec-req", id })) return toast("Couldn't send the recording request", "error");
  recAskId = id;
  recAskTimer = setTimeout(() => {
    if (recAskId !== id) return;
    recAskId = null;
    updateRecUi();
    toast("Recording request timed out", "info");
  }, 20000);
  updateRecUi();
  closeDevicePanel();
  toast("Waiting for their approval", "info");
}
function onRecRequest(id) {
  if (!validId(id) || dialog) {
    if (validId(id)) sendPeer({ type: "rec-res", id, allow: false });
    return;
  }
  openConsent({
    kind: "rec",
    id,
    title: "Recording request",
    text: "They want to record this call, including video and audio. You can stop the recording at any time.",
  });
}
function onRecResponse(id, allow) {
  if (!recAskId || id !== recAskId) return;
  clearTimeout(recAskTimer);
  recAskId = null;
  updateRecUi();
  if (!allow) return toast("Recording was denied", "info");
  startRecorder();
}
function onRecStop() {
  const was = localRecording;
  if (was) stopRecording(true);
  const show = was || peerRecording;
  peerRecording = false;
  updateRecUi();
  if (show) toast(was ? "Recording saved" : "Recording stopped", "info");
}
function userStopRec() {
  sendPeer({ type: "rec-stop" });
  const was = localRecording;
  if (was) stopRecording(true);
  peerRecording = false;
  updateRecUi();
  toast(was ? "Recording saved" : "Recording stopped", "info");
}
function onSessionReset(saveRecording) {
  const was = localRecording;
  dismissDialog(true);
  if (shotAsk) finishShot(shotAsk.id, false, "");
  clearRecAsk();
  peerRecording = false;
  if (was) stopRecording(!!saveRecording);
  updateRecUi();
  lowerShield(true);
  closeLightbox();
  return was;
}

function captureKey(e) {
  if (e.key === "PrintScreen") return true;
  const cmd = e.metaKey || e.ctrlKey;
  return cmd && e.shiftKey && ["3", "4", "5", "s", "S"].includes(e.key);
}
function raiseShield(forPrint) {
  el.remoteShield.hidden = false;
  el.pipShield.hidden = false;
  document.body.classList.add("shielded");
  shieldForPrint = !!forPrint;
  clearTimeout(shieldTimer);
  shieldTimer = setTimeout(() => lowerShield(!!forPrint), forPrint ? 60000 : 2800);
}
function lowerShield(force) {
  if (shieldForPrint && !force) return;
  shieldForPrint = false;
  clearTimeout(shieldTimer);
  el.remoteShield.hidden = true;
  el.pipShield.hidden = true;
  document.body.classList.remove("shielded");
}
function protectCapture(reason) {
  if (!state.inCall) return;
  raiseShield(reason === "print");
  const now = Date.now();
  if (now - lastProtectAt < 4000) return;
  lastProtectAt = now;
  sendPeer({ type: "ss-alert" });
  appendSys("Screenshot attempt detected. The other person was notified.", true);
  toast("Screenshot blocked. The other person was notified.", "info");
}
function bindCapture() {
  el.shotBtn.addEventListener("click", requestShot);
  el.recBtn.addEventListener("click", requestRec);
  el.consentDeny.addEventListener("click", () => respondConsent(false));
  el.consentAllow.addEventListener("click", () => respondConsent(true));
  el.consentFull.addEventListener("click", openLightbox);
  el.lightboxClose.addEventListener("click", closeLightbox);
  el.lightbox.addEventListener("click", (e) => { if (e.target === el.lightbox) closeLightbox(); });
  el.recStopBtn.addEventListener("click", userStopRec);
}

bindLook();
bindCapture();

/* =========================================================
   Init
   ========================================================= */

window.addEventListener("load", () => {
  setServerStatus(socket.connected);
  setStatus("Offline", false);
  loadIceConfig(); // warm up

  if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) el.shareBtn.hidden = true;

  // Invite link: pre-fill only. Joining needs a user tap anyway
  // (browsers require a gesture for camera prompts and audio playback).
  const room = new URLSearchParams(location.search).get("room");
  if (room) {
    setLobbyMode("join");
    el.roomInput.value = room.slice(0, 200);
    el.joinBtn.focus();
  } else {
    setLobbyMode("create");
  }
});

window.addEventListener("pagehide", () => {
  if (state.roomId) socket.emit("leave-room");
});