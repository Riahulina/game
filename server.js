// server.js
// ─────────────────────────────────────────────────────────────────────────
// Simulasi Cyber Security Awareness — SERVER
//
// PENTING:
// - Alat ini untuk SHARING SESSION / demo edukasi.
// - Peserta harus tahu bahwa mereka sedang ikut simulasi.
// - Server tidak menyimpan password asli peserta.
// ─────────────────────────────────────────────────────────────────────────

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.redirect("/join"));

app.get("/p/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "participant.html"));
});

app.get("/join", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "participant.html"));
});

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

const participants = new Map();

const THREAT_STAGES = ["invited", "joined", "locked", "revealed"];

const AUTO_REVEAL_MS = 20000;

// Password host
const HOST_PASSWORD = process.env.HOST_PASSWORD || "game123";

// ─────────────────────────────────────────────────────────────────────────
// STATE / STATS
// ─────────────────────────────────────────────────────────────────────────

function broadcastState() {
  const safeParticipants = Array.from(participants.values()).map((p) => {
    // Jangan kirim object timer ke browser
    const { lockTimer, ...safeParticipant } = p;

    return safeParticipant;
  });

  io.to("hosts").emit("state:update", {
    participants: safeParticipants,
    stats: computeStats(),
  });
}

function computeStats() {
  const list = Array.from(participants.values());

  const locked = list.filter((p) => p.status === "locked").length;

  const revealed = list.filter((p) => p.status === "revealed").length;

  const total = list.length;

  return {
    total,
    locked,
    revealed,

    active: list.filter((p) => p.status !== "invited").length,

    threatIndex:
      total === 0 ? 0 : Math.round(((locked + revealed) / total) * 100),
  };
}

function logEvent(id, type, meta = {}) {
  const p = participants.get(id);

  if (!p) return;

  const now = Date.now();

  p.events.push({
    type,
    at: now,
    ...meta,
  });

  p.lastEventAt = now;

  broadcastState();
}

// ─────────────────────────────────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────────────────────────────────

// Host membuat link peserta manual
app.post("/api/participants", (req, res) => {
  if (req.headers["x-host-token"] !== HOST_PASSWORD) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { name } = req.body;

  const id = nanoid(8);

  participants.set(id, {
    id,

    name: name && name.trim() ? name.trim() : `Peserta-${id}`,

    status: "invited",

    joinedAt: null,

    lastEventAt: Date.now(),

    attackId: null,

    lockTimer: null,

    events: [
      {
        type: "invited",
        at: Date.now(),
      },
    ],
  });

  broadcastState();

  res.json({
    id,
    link: `/p/${id}`,
  });
});

// Reset semua peserta
app.post("/api/reset", (req, res) => {
  if (req.headers["x-host-token"] !== HOST_PASSWORD) {
    return res.status(401).json({ error: "unauthorized" });
  }

  participants.forEach((p) => {
    if (p.lockTimer) {
      clearTimeout(p.lockTimer);
      p.lockTimer = null;
    }
  });

  participants.clear();

  broadcastState();

  res.json({
    ok: true,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ATTACK CONTROL
// ─────────────────────────────────────────────────────────────────────────

function triggerParticipant(p) {
  if (!p) return;

  if (p.status !== "joined") return;

  // Hapus timer sebelumnya
  if (p.lockTimer) {
    clearTimeout(p.lockTimer);
    p.lockTimer = null;
  }

  // Setiap serangan punya ID sendiri
  const attackId = nanoid(6);

  p.status = "locked";
  p.attackId = attackId;

  logEvent(p.id, "attack_triggered");

  // Kirim hanya ke device peserta tersebut
  io.to(`p:${p.id}`).emit("attack:trigger", {
    attackId,
  });

  // Auto unlock setelah 20 detik
  p.lockTimer = setTimeout(() => {
    const current = participants.get(p.id);

    if (!current) return;

    // Pastikan masih attack session yang sama
    if (current.status !== "locked" || current.attackId !== attackId) {
      return;
    }

    current.status = "revealed";
    current.attackId = null;
    current.lockTimer = null;

    logEvent(current.id, "auto_revealed");

    io.to(`p:${current.id}`).emit("attack:end", {
      attackId,
    });
  }, AUTO_REVEAL_MS);
}

function endParticipant(p) {
  if (!p) return;

  if (p.status !== "locked") return;

  const attackId = p.attackId;

  // Hentikan auto reveal
  if (p.lockTimer) {
    clearTimeout(p.lockTimer);
    p.lockTimer = null;
  }

  p.status = "revealed";
  p.attackId = null;

  logEvent(p.id, "host_revealed");

  // Kirim END ke device peserta
  io.to(`p:${p.id}`).emit("attack:end", {
    attackId,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  // ───────────────────────────────────────────────────────────────────────
  // HOST LOGIN / SUBSCRIBE
  // ───────────────────────────────────────────────────────────────────────

  socket.on("host:subscribe", ({ token } = {}) => {
    if (token !== HOST_PASSWORD) {
      socket.emit("host:unauthorized");

      return;
    }

    socket.data.isHost = true;

    socket.join("hosts");

    socket.emit("state:update", {
      participants: Array.from(participants.values()).map((p) => {
        const { lockTimer, ...safeParticipant } = p;

        return safeParticipant;
      }),

      stats: computeStats(),
    });

    console.log("[HOST] connected:", socket.id);
  });

  function requireHost() {
    return socket.data.isHost === true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PESERTA DAFTAR SENDIRI
  // ───────────────────────────────────────────────────────────────────────

  socket.on("participant:register", ({ name } = {}, callback) => {
    const id = nanoid(8);

    const now = Date.now();

    const p = {
      id,

      name: name && name.trim() ? name.trim() : `Peserta-${id}`,

      status: "joined",

      joinedAt: now,

      lastEventAt: now,

      // ID attack milik peserta
      attackId: null,

      lockTimer: null,

      events: [
        {
          type: "invited",
          at: now,
        },
      ],
    };

    participants.set(id, p);

    socket.data.participantId = id;

    socket.join(`p:${id}`);

    logEvent(id, "self_registered");

    if (typeof callback === "function") {
      callback({
        id,
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // PESERTA BUKA LINK
  // ───────────────────────────────────────────────────────────────────────

  socket.on("participant:hello", ({ id } = {}) => {
    const p = participants.get(id);

    if (!p) {
      socket.emit("participant:invalid");

      return;
    }

    socket.data.participantId = id;

    socket.join(`p:${id}`);

    if (p.status === "invited") {
      p.status = "joined";
    }

    if (!p.joinedAt) {
      p.joinedAt = Date.now();
    }

    logEvent(id, "page_opened");

    // Jika reload saat sedang LOCKED
    if (p.status === "locked") {
      socket.emit("attack:trigger", {
        attackId: p.attackId,
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // HOST: TRIGGER
  // ───────────────────────────────────────────────────────────────────────

  socket.on("host:trigger_attack", ({ id } = {}) => {
    console.log("[HOST] trigger_attack:", id, "isHost:", socket.data.isHost);

    if (!requireHost()) {
      console.log("[HOST] trigger ditolak");

      return;
    }

    let targets;

    if (id === "all") {
      targets = Array.from(participants.values()).filter(
        (p) => p.status === "joined",
      );
    } else {
      const participant = participants.get(id);

      targets = participant ? [participant] : [];
    }

    console.log(
      "[HOST] trigger targets:",
      targets.map((p) => `${p.name}:${p.id}:${p.status}`),
    );

    targets.forEach(triggerParticipant);
  });

  // ───────────────────────────────────────────────────────────────────────
  // HOST: TRIGGER WAVE
  // ───────────────────────────────────────────────────────────────────────

  socket.on("host:trigger_wave", ({ batchSize, intervalMs } = {}) => {
    console.log("[HOST] trigger_wave:", batchSize, intervalMs);

    if (!requireHost()) {
      console.log("[HOST] wave ditolak");

      return;
    }

    const size = Math.max(1, parseInt(batchSize, 10) || 5);

    const gap = Math.max(500, parseInt(intervalMs, 10) || 2000);

    const targets = Array.from(participants.values()).filter(
      (p) => p.status === "joined",
    );

    let i = 0;

    function fireNext() {
      const batch = targets.slice(i, i + size);

      if (batch.length === 0) {
        return;
      }

      console.log(
        "[HOST] wave targets:",
        batch.map((p) => `${p.name}:${p.id}`),
      );

      batch.forEach(triggerParticipant);

      i += size;

      if (i < targets.length) {
        setTimeout(fireNext, gap);
      }
    }

    fireNext();
  });

  // ───────────────────────────────────────────────────────────────────────
  // HOST: END ATTACK
  // ───────────────────────────────────────────────────────────────────────

  socket.on("host:end_attack", ({ id } = {}) => {
    console.log("[HOST] end_attack:", id, "isHost:", socket.data.isHost);

    if (!requireHost()) {
      console.log("[HOST] END ditolak");

      return;
    }

    let targets;

    if (id === "all") {
      targets = Array.from(participants.values()).filter(
        (p) => p.status === "locked",
      );
    } else {
      const participant = participants.get(id);

      targets = participant ? [participant] : [];
    }

    console.log(
      "[HOST] END targets:",
      targets.map((p) => `${p.name}:${p.id}:${p.status}`),
    );

    targets.forEach(endParticipant);
  });

  // ───────────────────────────────────────────────────────────────────────
  // DISCONNECT
  // ───────────────────────────────────────────────────────────────────────

  socket.on("disconnect", () => {
    console.log("[SOCKET] disconnected:", socket.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Cyber awareness sim jalan di http://localhost:${PORT}`);

  console.log(`Dashboard host  : http://localhost:${PORT}/host.html`);
});
