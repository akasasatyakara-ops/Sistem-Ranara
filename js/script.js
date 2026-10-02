/* =============================================================
   Sistem Ranara — Logika Halaman Login (hanya Google Sign-In)
   -------------------------------------------------------------
   Cara mengaktifkan Google Sign-In ASLI (opsional):
     1. Buka https://console.cloud.google.com
        → APIs & Services → Credentials → Create credentials
        → OAuth client ID (Web application).
     2. Isi "Authorized JavaScript origins" dengan alamat situs,
        contoh: http://localhost:5500 atau https://situs-anda.vercel.app
     3. Tempel Client ID Anda pada GOOGLE_CLIENT_ID di bawah.
   Tanpa Client ID, halaman berjalan dalam MODE DEMO
   (pemilih akun simulasi) agar tampilan tetap bisa dicoba.

   Catatan: karena ini front-end murni, token dari Google hanya
   didekode di sisi klien untuk menampilkan profil. Untuk produksi,
   kirim token tersebut ke backend agar terverifikasi.
   ============================================================= */

const GOOGLE_CLIENT_ID = ""; // ← tempel Client ID di sini, cth: "1234-abc.apps.googleusercontent.com"

const KUNCI_SESI = "ranara_sesi";

/* Bila database Supabase diisi (js/config.js), login Google juga membuat sesi Supabase */
const db = window.dbKlien;
const MODE_DB = !!window.dbDikonfigurasi;
let nonceMentah = null; // nonce asli (dikirim ke Supabase)
let nonceHash = null;   // hash SHA-256 nonce (dikirim ke Google)
const DURASI_PROSES = 900; // ms, durasi efek "memeriksa akun"

/* Akun simulasi untuk mode demo */
const AKUN_DEMO = [
    { nama: "Dina Rahmawati", email: "dina.rahmawati@gmail.com" },
    { nama: "Budi Santoso",   email: "budi.santoso@gmail.com" },
    { nama: "Sari Puspita",   email: "sari.puspita@gmail.com" },
];

const PALET_WARNA = ["#1a73e8", "#d93025", "#188038", "#e37400", "#9334e6", "#0b8043"];

const LOGO_G =
    '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    "</svg>";

/* ---------- Ambil elemen ---------- */
const $ = (id) => document.getElementById(id);

const el = {
    login: $("tampilan-login"),
    proses: $("tampilan-proses"),
    berhasil: $("tampilan-berhasil"),
    wadahTombol: $("wadah-tombol-google"),
    infoDemo: $("info-demo"),
    foto: $("foto-profil"),
    avatarInisial: $("avatar-inisial"),
    nama: $("nama-pengguna"),
    email: $("email-pengguna"),
    keluar: $("tombol-keluar"),
    modal: $("modal-demo"),
    daftarAkun: $("daftar-akun"),
    tombolAkunLain: $("tombol-akun-lain"),
    form: $("form-akun-lain"),
    inputNama: $("input-nama"),
    inputEmail: $("input-email"),
    galatForm: $("galat-form"),
    tombolBatal: $("tombol-batal"),
    dasbor: $("tombol-dasbor"),
};

/* =============================================================
   Inisialisasi
   ============================================================= */
async function init() {
    el.keluar.addEventListener("click", keluar);
    el.dasbor.addEventListener("click", () => {
        window.location.href = "dashboard.html";
    });
    el.tombolAkunLain.addEventListener("click", bukaFormAkunLain);
    el.tombolBatal.addEventListener("click", kembaliKeDaftar);
    el.form.addEventListener("submit", kirimAkunLain);

    el.modal.addEventListener("click", (e) => {
        if (e.target === el.modal) tutupModal();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !el.modal.hidden) tutupModal();
    });

    // Pulihkan sesi sebelumnya (masih "login" saat halaman dibuka ulang)
    const sesi = muatSesi();
    if (sesi) {
        if (MODE_DB) {
            // Mode database: sesi hanya sah bila sesi Supabase masih berlaku
            const { data } = db ? await db.auth.getSession() : { data: { session: null } };
            if (data.session) tampilkanBerhasil(sesi);
            else hapusSesi();
        } else {
            tampilkanBerhasil(sesi);
        }
    }

    if (MODE_DB && !db) {
        el.infoDemo.textContent = "Gagal memuat Supabase. Periksa koneksi internet lalu muat ulang halaman.";
        el.infoDemo.hidden = false;
    } else if (GOOGLE_CLIENT_ID) {
        await initGoogleAsli();
    } else {
        modeDemo();
    }
}

document.addEventListener("DOMContentLoaded", init);

/* =============================================================
   Mode A — Google Sign-In asli (Google Identity Services)
   ============================================================= */
async function initGoogleAsli() {
    el.infoDemo.hidden = true;
    if (MODE_DB) {
        nonceMentah = buatNonceAcak();
        nonceHash = await sha256Hex(nonceMentah);
    }
    tungguGsi(0);
}

/* Nonce acak + hash SHA-256 (heksadesimal), sesuai syarat Supabase untuk token Google */
function buatNonceAcak() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes));
}

async function sha256Hex(teks) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(teks));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tungguGsi(coba) {
    if (window.google && window.google.accounts && window.google.accounts.id) {
        const opsi = { client_id: GOOGLE_CLIENT_ID, callback: tanganiKredensial };
        if (nonceHash) opsi.nonce = nonceHash;
        google.accounts.id.initialize(opsi);
        google.accounts.id.renderButton(el.wadahTombol, {
            theme: "outline",
            size: "large",
            shape: "pill",
            text: "signin_with",
            logo_alignment: "center",
            width: 320,
        });
    } else if (coba < 60) {
        setTimeout(() => tungguGsi(coba + 1), 100); // tunggu skrip GSI termuat
    } else {
        el.infoDemo.textContent =
            "Gagal memuat Google Sign-In. Periksa koneksi internet Anda lalu muat ulang halaman.";
        el.infoDemo.hidden = false;
    }
}

async function tanganiKredensial(respon) {
    const profil = dekodeJwt(respon.credential);
    mulaiProses();

    if (MODE_DB) {
        // Masuk ke Supabase memakai token Google agar data tersimpan per akun
        const { error } = await db.auth.signInWithIdToken({
            provider: "google",
            token: respon.credential,
            nonce: nonceMentah,
        });
        if (error) {
            console.error(error);
            tampilkan(el.login);
            toast("Gagal masuk ke database: " + error.message);
            return;
        }
    }

    setTimeout(() => {
        const sesi = normalisasi({
            nama: profil.name || "Pengguna Google",
            email: profil.email || "",
            foto: profil.picture || null,
        });
        simpanSesi(sesi);
        tampilkanBerhasil(sesi);
    }, DURASI_PROSES);
}

/* Dekode muatan JWT (base64url) menjadi objek */
function dekodeJwt(token) {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

/* =============================================================
   Mode B — Demo (tanpa Client ID)
   ============================================================= */
function modeDemo() {
    if (MODE_DB) {
        // Database butuh akun Google asli, jadi login simulasi tidak bisa dipakai
        el.infoDemo.textContent =
            "Database aktif, tetapi Client ID Google belum diisi di js/script.js. Isi GOOGLE_CLIENT_ID agar bisa masuk.";
        el.infoDemo.hidden = false;
        return;
    }
    el.infoDemo.hidden = false;
    buatTombolDemo();
    isiDaftarAkun();
}

function buatTombolDemo() {
    el.wadahTombol.innerHTML = "";

    const tombol = document.createElement("button");
    tombol.type = "button";
    tombol.className = "tombol-google-demo";
    tombol.innerHTML = LOGO_G + "<span>Masuk dengan Google</span>";
    tombol.addEventListener("click", bukaModal);

    el.wadahTombol.appendChild(tombol);
}

function isiDaftarAkun() {
    el.daftarAkun.innerHTML = "";

    AKUN_DEMO.forEach((akun) => {
        el.daftarAkun.appendChild(buatBarisAkun(akun));
    });
}

function buatBarisAkun(akun) {
    const baris = document.createElement("button");
    baris.type = "button";
    baris.className = "baris-akun";

    const avatar = document.createElement("span");
    avatar.className = "avatar-mini";
    avatar.style.background = warnaDari(akun.email);
    avatar.textContent = inisialDari(akun.nama);

    const teks = document.createElement("span");
    teks.className = "baris-teks";
    const bNama = document.createElement("span");
    bNama.className = "b-nama";
    bNama.textContent = akun.nama;
    const bEmail = document.createElement("span");
    bEmail.className = "b-email";
    bEmail.textContent = akun.email;
    teks.append(bNama, bEmail);

    baris.append(avatar, teks);
    baris.addEventListener("click", () => pilihAkun(akun));
    return baris;
}

function pilihAkun(akun) {
    tutupModal();
    mulaiProses();
    setTimeout(() => {
        const sesi = normalisasi(akun);
        simpanSesi(sesi);
        tampilkanBerhasil(sesi);
    }, DURASI_PROSES);
}

/* ---------- Modal ---------- */
function bukaModal() {
    kembaliKeDaftar();
    el.modal.hidden = false;
}

function tutupModal() {
    el.modal.hidden = true;
}

function bukaFormAkunLain() {
    el.daftarAkun.hidden = true;
    el.tombolAkunLain.hidden = true;
    el.form.hidden = false;
    el.galatForm.hidden = true;
    el.inputNama.value = "";
    el.inputEmail.value = "";
    el.inputNama.focus();
}

function kembaliKeDaftar() {
    el.form.hidden = true;
    el.daftarAkun.hidden = false;
    el.tombolAkunLain.hidden = false;
    el.galatForm.hidden = true;
}

function kirimAkunLain(e) {
    e.preventDefault();

    const nama = el.inputNama.value.trim();
    const email = el.inputEmail.value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    tandaiInput(el.inputNama, nama.length > 0);
    tandaiInput(el.inputEmail, emailValid);

    if (nama.length === 0 || !emailValid) {
        el.galatForm.textContent =
            nama.length === 0
                ? "Nama tidak boleh kosong."
                : "Format email tidak valid, cth. nama@gmail.com";
        el.galatForm.hidden = false;
        return;
    }

    pilihAkun({ nama, email });
}

function tandaiInput(input, valid) {
    input.classList.toggle("salah", !valid);
}

/* =============================================================
   Tampilan & sesi
   ============================================================= */
function tampilkan(view) {
    [el.login, el.proses, el.berhasil].forEach((v) => {
        if (v) v.hidden = v !== view;
    });
}

function mulaiProses() {
    tampilkan(el.proses);
}

function tampilkanBerhasil(sesi) {
    el.nama.textContent = sesi.nama;
    el.email.textContent = sesi.email;

    if (sesi.foto) {
        el.foto.src = sesi.foto;
        el.foto.hidden = false;
        el.avatarInisial.hidden = true;
    } else {
        el.avatarInisial.textContent = sesi.inisial;
        el.avatarInisial.style.background = sesi.warna;
        el.avatarInisial.hidden = false;
        el.foto.hidden = true;
    }

    tampilkan(el.berhasil);
}

async function keluar() {
    if (MODE_DB && db) await db.auth.signOut();
    hapusSesi();
    if (window.google && window.google.accounts && window.google.accounts.id) {
        google.accounts.id.disableAutoSelect();
    }
    tampilkan(el.login);
    toast("Anda telah keluar.");
}

/* ---------- Util sesi ---------- */
function muatSesi() {
    try {
        const mentah = localStorage.getItem(KUNCI_SESI);
        return mentah ? JSON.parse(mentah) : null;
    } catch {
        return null;
    }
}

function simpanSesi(sesi) {
    try {
        localStorage.setItem(KUNCI_SESI, JSON.stringify(sesi));
    } catch {
        /* penyimpanan tidak tersedia — abaikan */
    }
}

function hapusSesi() {
    try {
        localStorage.removeItem(KUNCI_SESI);
    } catch {
        /* abaikan */
    }
}

/* ---------- Util profil ---------- */
function normalisasi(akun) {
    return {
        nama: akun.nama,
        email: akun.email,
        foto: akun.foto || null,
        inisial: inisialDari(akun.nama),
        warna: "#2563eb", /* biru, sesuai tema sederhana */
    };
}

function inisialDari(nama) {
    const kata = nama.trim().split(/\s+/).filter(Boolean);
    const huruf = kata.slice(0, 2).map((k) => k[0].toUpperCase());
    return huruf.join("") || "?";
}

function warnaDari(teks) {
    let hash = 0;
    for (let i = 0; i < teks.length; i++) {
        hash = (hash * 31 + teks.charCodeAt(i)) >>> 0;
    }
    return PALET_WARNA[hash % PALET_WARNA.length];
}

/* ---------- Toast ---------- */
function toast(pesan) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = pesan;
    document.body.appendChild(t);

    requestAnimationFrame(() => t.classList.add("muncul"));
    setTimeout(() => {
        t.classList.remove("muncul");
        setTimeout(() => t.remove(), 300);
    }, 2600);
}
