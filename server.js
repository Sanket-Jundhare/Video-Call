const crypto = require("crypto");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 4e5, // SDP, chat, and screenshot-consent previews (capped at ~250 KB)
    pingInterval: 10000,
    pingTimeout: 15000
    // No CORS: the client is served from this same origin.
});

app.disable("x-powered-by");

app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(self), microphone=(self), display-capture=(self)"
    });
    next();
});

app.use(express.static(path.join(__dirname, "public")));

/* code => { code, limit, hostToken, members: Set<socketId>, grace } */
const rooms = new Map();
const MIN_LIMIT = 2;
const MAX_LIMIT = 6;
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/* ---------- helpers ---------- */

function tokensEqual(a, b) {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    if (!left.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function normalizeCode(raw) {
    if (typeof raw !== "string") return "";
    let text = raw.trim().toLowerCase();
    try {
        if (text.includes("://")) {
            const room = new URL(text).searchParams.get("room");
            if (room) text = room.trim().toLowerCase();
        }
    } catch (err) { /* not a url */ }
    const query = text.match(/[?&]room=([a-z0-9-]+)/);
    if (query) text = query[1];
    return text.replace(/[^a-z0-9]/g, "").slice(0, 16);
}

function validCode(code) {
    return /^[a-z0-9]{6,16}$/.test(code);
}

function validToken(token) {
    return typeof token === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(token);
}

function randomCode() {
    const bytes = crypto.randomBytes(8);
    let code = "";
    for (let i = 0; i < bytes.length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return code;
}

function clampLimit(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < MIN_LIMIT || n > MAX_LIMIT) return 0;
    return n;
}

function allowRoomAttempt(socket) {
    const now = Date.now();
    const w = socket.data.roomTries || (socket.data.roomTries = []);
    while (w.length && now - w[0] > 30000) w.shift();
    if (w.length >= 12) return false;
    w.push(now);
    return true;
}

function roomPayload(room, socket) {
    return {
        code: room.code,
        limit: room.limit,
        count: room.members.size,
        peers: [...room.members].filter((id) => id !== socket.id),
        host: tokensEqual(room.hostToken, socket.data.hostToken)
    };
}

function clearGrace(room) {
    if (room.grace) {
        clearTimeout(room.grace);
        room.grace = null;
    }
}

function leaveRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.data.roomId = null;
    socket.leave(roomId);

    const room = rooms.get(roomId);
    if (!room) return;

    const wasMember = room.members.delete(socket.id);
    if (!wasMember) return;

    socket.to(roomId).emit("peer-left", { id: socket.id });
    console.log(`[PEER LEFT] ${room.members.size}/${room.limit} left in room`);

    if (room.members.size === 0) {
        clearGrace(room);
        room.grace = setTimeout(() => {
            const current = rooms.get(room.code);
            if (current === room && current.members.size === 0) {
                rooms.delete(room.code);
                console.log("[ROOM CLOSED]");
            }
        }, 20000);
    }
}

function addMember(socket, room) {
    clearGrace(room);
    if (socket.data.roomId && socket.data.roomId !== room.code) leaveRoom(socket);
    if (socket.data.roomId === room.code && room.members.has(socket.id)) {
        socket.emit("room-joined", roomPayload(room, socket));
        return;
    }
    if (room.members.size >= room.limit) {
        socket.emit("room-error", { reason: "full", message: "That room is full." });
        return;
    }
    room.members.add(socket.id);
    socket.data.roomId = room.code;
    socket.join(room.code);
    console.log(`[ROOM JOIN] ${room.members.size}/${room.limit}`);
    socket.emit("room-joined", roomPayload(room, socket));
    socket.to(room.code).emit("peer-joined", { id: socket.id });
}

function relayToPeer(socket, to, event, payload) {
    const room = rooms.get(socket.data.roomId);
    if (!room || typeof to !== "string" || !room.members.has(to) || to === socket.id) return;
    io.to(to).emit(event, payload);
}

function validDescription(d) {
    return (
        d &&
        typeof d === "object" &&
        (d.type === "offer" || d.type === "answer") &&
        typeof d.sdp === "string" &&
        d.sdp.length < 100000
    );
}

// max 15 chat messages per 5 seconds per socket
function allowChat(socket) {
    const now = Date.now();
    const w = socket.data.msgTimes || (socket.data.msgTimes = []);
    while (w.length && now - w[0] > 5000) w.shift();
    if (w.length >= 15) return false;
    w.push(now);
    return true;
}

// Capture consent is separate so a busy chat cannot silently drop a screenshot or recording request.
function allowCapture(socket) {
    const now = Date.now();
    const w = socket.data.capTimes || (socket.data.capTimes = []);
    while (w.length && now - w[0] > 10000) w.shift();
    if (w.length >= 8) return false;
    w.push(now);
    return true;
}

function shortId(id) {
    return typeof id === "string" && id.length > 0 && id.length <= 40;
}

/* ---------- sockets ---------- */

io.on("connection", (socket) => {
    console.log(`[CONNECTED] ${socket.id}`);

    socket.on("create-room", (msg) => {
        try {
            if (!allowRoomAttempt(socket)) {
                socket.emit("room-error", { reason: "rate", message: "Too many attempts. Wait a moment." });
                return;
            }
            const body = msg && typeof msg === "object" ? msg : {};
            const limit = clampLimit(body.limit);
            if (!limit) {
                socket.emit("room-error", { reason: "limit", message: "Choose a room limit from 2 to 6." });
                return;
            }
            if (!validToken(body.token)) {
                socket.emit("room-error", { reason: "token", message: "Could not create a secure room. Refresh and try again." });
                return;
            }

            let code = "";
            if (body.random) {
                for (let i = 0; i < 5; i++) {
                    const next = randomCode();
                    if (!rooms.has(next)) { code = next; break; }
                }
                if (!code) {
                    socket.emit("room-error", { reason: "busy", message: "Could not make a code. Try again." });
                    return;
                }
            } else {
                code = normalizeCode(body.code);
                if (!validCode(code)) {
                    socket.emit("room-error", { reason: "code", message: "Use 6–16 letters or numbers for your code." });
                    return;
                }
                if (rooms.has(code)) {
                    socket.emit("room-error", { reason: "taken", message: "That code is already in use. Pick another, or use a random code." });
                    return;
                }
            }

            const room = { code, limit, hostToken: body.token, members: new Set(), grace: null };
            rooms.set(code, room);
            socket.data.hostToken = body.token;
            console.log("[ROOM CREATED]");
            addMember(socket, room);
        } catch (err) {
            console.error("create-room error", err);
            socket.emit("room-error", { reason: "error", message: "Could not create the room." });
        }
    });

    socket.on("join-room", (msg) => {
        try {
            if (!allowRoomAttempt(socket)) {
                socket.emit("room-error", { reason: "rate", message: "Too many attempts. Wait a moment." });
                return;
            }
            const body = typeof msg === "string" ? { code: msg } : (msg && typeof msg === "object" ? msg : {});
            const code = normalizeCode(body.code);
            if (!validCode(code)) {
                socket.emit("room-error", { reason: "code", message: "Enter a room code or paste the room link." });
                return;
            }
            const room = rooms.get(code);
            if (!room) {
                socket.emit("room-error", { reason: "missing", message: "No room with that code. Ask the host for a new link." });
                return;
            }
            if (validToken(body.token) && tokensEqual(room.hostToken, body.token)) socket.data.hostToken = body.token;
            else socket.data.hostToken = "";
            addMember(socket, room);
        } catch (err) {
            console.error("join-room error", err);
            socket.emit("room-error", { reason: "error", message: "Could not join the room." });
        }
    });

    socket.on("leave-room", () => leaveRoom(socket));

    /* Signaling: always use the room the SERVER put the socket in,
       never a roomId supplied by the client. */
    socket.on("offer", (msg) => {
        if (!msg || !validDescription(msg)) return;
        relayToPeer(socket, msg.to, "offer", { from: socket.id, type: msg.type, sdp: msg.sdp });
    });

    socket.on("answer", (msg) => {
        if (!msg || !validDescription(msg)) return;
        relayToPeer(socket, msg.to, "answer", { from: socket.id, type: msg.type, sdp: msg.sdp });
    });

    socket.on("ice-candidate", (msg) => {
        const candidate = msg && msg.candidate;
        if (!candidate || typeof candidate !== "object") return;
        if (typeof candidate.candidate !== "string" || candidate.candidate.length > 2000) return;
        relayToPeer(socket, msg.to, "ice-candidate", {
            from: socket.id,
            candidate: {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
                usernameFragment: candidate.usernameFragment
            }
        });
    });

    /* Chat / media-state fallback relay (used when the P2P data channel isn't open) */
    socket.on("peer-msg", (m) => {
        const roomId = socket.data.roomId;
        if (!roomId || !m || typeof m !== "object") return;

        let out = null;
        switch (m.type) {
            case "msg":
                if (typeof m.id === "string" && m.id.length <= 40 && typeof m.text === "string") {
                    const text = m.text.trim().slice(0, 500);
                    if (text && allowChat(socket)) out = { type: "msg", id: m.id, text };
                }
                break;
            case "ack":
                if (typeof m.id === "string" && m.id.length <= 40) out = { type: "ack", id: m.id };
                break;
            case "media":
                out = { type: "media", cam: !!m.cam, mic: !!m.mic };
                break;

            /* ---- capture consent (screenshot / recording) ---- */
            case "ss-req":
                if (
                    shortId(m.id) &&
                    typeof m.thumb === "string" &&
                    m.thumb.startsWith("data:image/jpeg;base64,") &&
                    m.thumb.length < 250000 &&
                    allowCapture(socket)
                ) {
                    out = { type: "ss-req", id: m.id, thumb: m.thumb };
                }
                break;
            case "ss-res":
                if (shortId(m.id)) out = { type: "ss-res", id: m.id, allow: !!m.allow };
                break;
            case "ss-done":
                if (shortId(m.id)) out = { type: "ss-done", id: m.id };
                break;
            case "ss-alert":
                if (allowCapture(socket)) out = { type: "ss-alert" };
                break;
            case "rec-req":
                if (shortId(m.id) && allowCapture(socket)) out = { type: "rec-req", id: m.id };
                break;
            case "rec-res":
                if (shortId(m.id)) out = { type: "rec-res", id: m.id, allow: !!m.allow };
                break;
            case "rec-stop":
                out = { type: "rec-stop" };
                break;
        }
        if (out) socket.to(roomId).emit("peer-msg", Object.assign({ from: socket.id }, out));
    });

    socket.on("disconnect", () => {
        console.log(`[DISCONNECTED] ${socket.id}`);
        leaveRoom(socket);
    });
});

/* ---------- HTTP endpoints ---------- */

// STUN alone fails on many mobile networks (CGNAT). Set TURN_URL / TURN_USER / TURN_PASS
// in the environment to add a TURN server, e.g. TURN_URL="turn:turn.example.com:3478,turns:turn.example.com:5349"
app.get("/ice-config", (req, res) => {
    const iceServers = [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
    ];
    if (process.env.TURN_URL) {
        iceServers.push({
            urls: process.env.TURN_URL.split(",").map((s) => s.trim()).filter(Boolean),
            username: process.env.TURN_USER || "",
            credential: process.env.TURN_PASS || ""
        });
    }
    res.set("Cache-Control", "no-store");
    res.json({ iceServers });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", rooms: rooms.size, uptime: process.uptime() });
});

/* ---------- start ---------- */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`
==================================
PrivateCall Pro Running
==================================
Local:  http://localhost:${PORT}
Health: http://localhost:${PORT}/health
==================================
`);
});

function shutdown() {
    console.log("Shutting down...");
    io.close(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);