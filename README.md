# Cyber Security Awareness Simulation

Simulasi kejutan untuk sharing session. Peserta buka link → main mini-game
tebak-tebakan (tanpa tahu ini bagian dari simulasi) → kapan pun kamu mau,
klik **TRIGGER** di dashboard → layar mereka langsung berubah jadi halaman
"SYSTEM LOCKED" yang dramatis → klik **END** buat langsung buka simulasinya
dan tampilkan halaman edukasi. Kalau kamu lupa klik END, sistem otomatis
membuka simulasi setelah 20 detik sebagai jaring pengaman.

**Etika penggunaan:** kamu yang menjelaskan konteksnya ke peserta secara
manual (sebelum/sesudah), sesuai kebutuhan sesimu. Server tidak pernah minta
atau menyimpan data pribadi/password peserta — seluruh interaksi cuma game
tebak-tebakan dan halaman visual.

## Cara jalanin

1. Pastikan Node.js sudah terpasang (cek: `node -v`).
2. Buka folder ini di terminal, lalu:
   ```
   npm install
   npm start
   ```
3. Buka dashboard host di browser: **http://localhost:3000**
4. Di panel "COMMAND CENTER", copy **LINK PENDAFTARAN** (contoh:
   `http://localhost:3000/join`) dan bagikan satu link itu ke semua
   peserta — mereka isi nama sendiri pas buka, tidak perlu kamu buatkan
   link satu-satu.
   - Kalau device peserta beda WiFi/network dari host, ganti `localhost`
     dengan IP komputer host (cek dengan `ipconfig` / `ifconfig`).
   - "BUAT LINK MANUAL" tetap tersedia kalau suatu saat butuh link khusus
     untuk satu orang tertentu.
5. Begitu peserta mendaftar, mereka otomatis mulai main mini-game dan
   muncul di panel "ACTIVE TARGETS" dengan status **MAIN GAME**.
6. Untuk memicu efek kejut:
   - **⚡ TRIGGER** di sebelah nama → kunci satu orang itu saja.
   - **TRIGGER ALL** → kunci semua yang masih main game, sekaligus.
   - **TRIGGER BERGELOMBANG** → atur jumlah orang per gelombang & jeda
     antar gelombang (mis. 5 orang tiap 2 detik), lalu klik **MULAI** —
     otomatis jalan sendiri tanpa perlu klik satu-satu.
7. Klik **✅ END** / **END ALL** buat langsung membuka simulasinya dan
   menampilkan halaman edukasi. Kalau lupa, otomatis kebuka sendiri
   dalam 20 detik.
8. Setelah sesi, klik **RESET ALL TARGETS** untuk sesi berikutnya.

## Catatan tentang halaman lockout

Halaman "SYSTEM COMPROMISED" menampilkan alamat IP publik asli peserta
(diambil dari layanan publik ipify, sama seperti yang bisa dilihat situs
mana pun yang mereka kunjungi), daftar nama file palsu yang seolah
"terunggah", dan bunyi bip berulang — semuanya visual/animasi saja, tidak
ada file asli yang diakses, diunggah, atau dikirim ke mana pun.

## Struktur file

```
cyber-sim/
├── server.js              # backend Express + Socket.io, state in-memory
├── package.json
└── public/
    ├── host.html           # dashboard kamu (host)
    ├── participant.html    # halaman jebakan sisi peserta
    ├── education.html      # halaman reveal & edukasi setelah "kena"
    └── style.css           # tema visual bersama
```

## Ide pengembangan lanjut

- Ganti skenario "NexaCorp Portal" dengan tema lain (mis. fake e-wallet,
  fake undangan Zoom) — tinggal edit `public/participant.html`.
- Tambah level kesulitan: skenario yang lebih halus untuk peserta yang sudah
  paham dasar.
- Export data ke CSV di endpoint baru `/api/export` kalau perlu laporan file.
- Ganti state in-memory dengan SQLite kalau sesi berjalan lebih dari sekali
  restart server.
