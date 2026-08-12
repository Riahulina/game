// server.js
// ─────────────────────────────────────────────────────────────────────────
// Simulasi Cyber Security Awareness — SERVER
//
// PENTING (baca sebelum pakai):
// - Alat ini untuk SHARING SESSION / demo edukasi. Peserta harus tahu (atau
//   sudah diberi tahu oleh fasilitator) bahwa mereka sedang ikut simulasi.
// - Server ini TIDAK PERNAH menyimpan password asli yang diketik peserta.
//   Yang dicatat hanya: apakah peserta mengetik sesuatu di kolom password
//   (boolean), bukan isinya. Lihat komentar di public/participant.html.
// - Jangan gunakan untuk menargetkan orang yang tidak tahu/tidak setuju.
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

// Buka localhost:3000 langsung diarahkan ke dashboard host
app.get("/", (req, res) => res.redirect("/host.html"));

// ── In-memory state (cukup untuk sesi sharing/demo, reset tiap restart) ──
const participants = new Map();
// participant record shape:
// { id, name, status: 'invited'|'joined'|'locked'|'revealed',
//   joinedAt, lastEventAt, events: [{type, at}], lockTimer }

const THREAT_STAGES = ["invited", "joined", "locked", "revealed"];
const AUTO_REVEAL_MS = 20000; // jaring pengaman: auto-reveal kalau host lupa klik "End"

function broadcastState() {
  io.to("hosts").emit("state:update", {
    participants: Array.from(participants.values()),
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
    threatIndex: total === 0 ? 0 : Math.round(((locked + revealed) / total) * 100),
  };
}

function logEvent(id, type, meta = {}) {
  const p = participants.get(id);
  if (!p) return;
  p.events.push({ type, at: Date.now(), ...meta });
  p.lastEventAt = Date.now();
  broadcastState();
}

// ── REST: fasilitator membuat link peserta baru dari host dashboard ──
app.post("/api/participants", (req, res) => {
  const { name } = req.body;
  const id = nanoid(8);
  participants.set(id, {
    id,
    name: name && name.trim() ? name.trim() : `Peserta-${id}`,
    status: "invited",
    joinedAt: null,
    lastEventAt: Date.now(),
    events: [{ type: "invited", at: Date.now() }],
  });
  broadcastState();
  res.json({ id, link: `/p/${id}` });
});

app.post("/api/reset", (req, res) => {
  participants.forEach((p) => p.lockTimer && clearTimeout(p.lockTimer));
  participants.clear();
  broadcastState();
  res.json({ ok: true });
});

// Peserta buka link unik → serve halaman jebakan
app.get("/p/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "participant.html"));
});

// Link pendaftaran mandiri: satu link dibagikan ke semua, peserta isi nama sendiri
app.get("/join", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "participant.html"));
});

// ── Socket.io: realtime channel ──

function triggerParticipant(p) {
  if (!p || p.status !== "joined") return;
  p.status = "locked";
  logEvent(p.id, "attack_triggered");
  io.to(`p:${p.id}`).emit("attack:trigger");

  if (p.lockTimer) clearTimeout(p.lockTimer);
  p.lockTimer = setTimeout(() => {
    if (p.status === "locked") {
      p.status = "revealed";
      logEvent(p.id, "auto_revealed");
      io.to(`p:${p.id}`).emit("attack:end");
    }
  }, AUTO_REVEAL_MS);
}

function endParticipant(p) {
  if (!p || p.status !== "locked") return;
  if (p.lockTimer) clearTimeout(p.lockTimer);
  p.status = "revealed";
  logEvent(p.id, "host_revealed");
  io.to(`p:${p.id}`).emit("attack:end");
}

io.on("connection", (socket) => {
  socket.on("host:subscribe", () => {
    socket.join("hosts");
    socket.emit("state:update", {
      participants: Array.from(participants.values()),
      stats: computeStats(),
    });
  });

  // Pendaftaran mandiri lewat link /join — peserta isi nama sendiri
  socket.on("participant:register", ({ name }, callback) => {
    const id = nanoid(8);
    const p = {
      id,
      name: name && name.trim() ? name.trim() : `Peserta-${id}`,
      status: "joined",
      joinedAt: Date.now(),
      lastEventAt: Date.now(),
      events: [{ type: "invited", at: Date.now() }],
    };
    participants.set(id, p);
    socket.data.participantId = id;
    socket.join(`p:${id}`);
    logEvent(id, "self_registered");
    if (typeof callback === "function") callback({ id });
  });

  socket.on("participant:hello", ({ id }) => {
    const p = participants.get(id);
    if (!p) {
      socket.emit("participant:invalid");
      return;
    }
    socket.data.participantId = id;
    socket.join(`p:${id}`);
    if (p.status === "invited") p.status = "joined";
    if (!p.joinedAt) p.joinedAt = Date.now();
    logEvent(id, "page_opened");
    // Kalau peserta reload halaman saat sedang 'locked', langsung kirim ulang
    // status lock supaya layar lockout muncul lagi (bukan balik ke game).
    if (p.status === "locked") socket.emit("attack:trigger");
  });

  // Host memicu "serangan" ke satu peserta tertentu, atau semua ('all')
  socket.on("host:trigger_attack", ({ id }) => {
    const targets = id === "all"
      ? Array.from(participants.values()).filter((p) => p.status === "joined")
      : [participants.get(id)].filter(Boolean);
    targets.forEach(triggerParticipant);
  });

  // Host memicu serangan bergelombang: N orang setiap interval detik
  socket.on("host:trigger_wave", ({ batchSize, intervalMs }) => {
    const size = Math.max(1, parseInt(batchSize, 10) || 5);
    const gap = Math.max(500, parseInt(intervalMs, 10) || 2000);
    const targets = Array.from(participants.values()).filter((p) => p.status === "joined");

    let i = 0;
    function fireNext() {
      const batch = targets.slice(i, i + size);
      if (batch.length === 0) return;
      batch.forEach(triggerParticipant);
      i += size;
      if (i < targets.length) setTimeout(fireNext, gap);
    }
    fireNext();
  });

  // Host mengakhiri "serangan" lebih cepat (tombol END)
  socket.on("host:end_attack", ({ id }) => {
    const targets = id === "all"
      ? Array.from(participants.values()).filter((p) => p.status === "locked")
      : [participants.get(id)].filter(Boolean);
    targets.forEach(endParticipant);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cyber awareness sim jalan di http://localhost:${PORT}`);
  console.log(`Dashboard host  : http://localhost:${PORT}/host.html`);
});
