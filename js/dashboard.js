/* =============================================================
   Sistem Ranara — Dashboard Pelaporan
   -------------------------------------------------------------
   Mengikuti konsep laporan Excel (cth. Laporan SMKN 7):
     - 5%              = PAGU × 5%
     - PPN 12%         = diinput manual
     - PPH 22          = diinput manual
     - Jumlah Pajak    = PPN 12% + PPH 22
     - Setelah Pajak   = PAGU − Jumlah Pajak
     - Jumlah Diterima = Setelah Pajak − 5%
     - Saldo Bersih    = akumulasi 5% dari setiap laporan (berjalan per baris)

   Fitur: tambah, ubah (edit), hapus, filter per CV/PT atau per
   tahun, pencarian, pratinjau perhitungan, serta ekspor laporan
   ke Excel (.xlsx) dan PDF bergaya invoice.
   Data tersimpan di database Supabase (tabel "laporan") bila js/config.js
   sudah diisi; bila belum, data disimpan di localStorage (KUNCI_DATA).
   ============================================================= */

const KUNCI_SESI = "ranara_sesi";
const KUNCI_DATA = "ranara_laporan";
const TARIF_PERSEN = 0.05; // 5% dari PAGU

/* Mode database: aktif bila URL & kunci Supabase diisi di js/config.js */
const MODE_DB = !!window.dbDikonfigurasi;
const db = window.dbKlien;

/* ---------- Ambil elemen ---------- */
const $ = (id) => document.getElementById(id);

const el = {
    nama: $("nama-pengguna"),
    email: $("email-pengguna"),
    foto: $("foto-profil"),
    avatarInisial: $("avatar-inisial"),
    keluar: $("tombol-keluar"),

    totalPagu: $("total-pagu"),
    totalPajak: $("total-pajak"),
    totalPersen: $("total-persen"),
    totalDiterima: $("total-diterima"),

    judulForm: $("judul-form"),
    subForm: $("sub-form"),
    form: $("form-laporan"),
    tanggal: $("input-tanggal"),
    uraian: $("input-uraian"),
    cv: $("input-cv"),
    pagu: $("input-pagu"),
    ppn: $("input-ppn"),
    pph: $("input-pph"),
    keterangan: $("input-keterangan"),
    galatForm: $("galat-form"),
    batal: $("tombol-batal"),
    simpan: $("tombol-simpan"),

    pratinjauPersen: $("pratinjau-persen"),
    pratinjauPajak: $("pratinjau-pajak"),
    pratinjauSetelah: $("pratinjau-setelah"),
    pratinjauDiterima: $("pratinjau-diterima"),

    cari: $("input-cari"),
    filterCv: $("filter-cv"),
    filterTahun: $("filter-tahun"),
    tombolExcel: $("tombol-excel"),
    tombolPdf: $("tombol-pdf"),

    tabel: $("tabel-laporan"),
    isiTabel: $("isi-tabel"),
    pesanKosong: $("pesan-kosong"),

    modal: $("modal-hapus"),
    detailHapus: $("detail-hapus"),
    batalHapus: $("tombol-batal-hapus"),
    yaHapus: $("tombol-ya-hapus"),
};

let daftarLaporan = [];     // seluruh laporan
let idSedangDiedit = null;  // id laporan yang sedang diubah (null = mode tambah)
let idSedangDihapus = null; // id laporan yang menunggu konfirmasi hapus
let kataKunci = "";         // kata kunci pencarian
let nilaiFilterCv = "semua";   // filter CV/PT ("semua" = tanpa filter)
let nilaiFilterTahun = "semua"; // filter tahun ("semua" = tanpa filter)

/* =============================================================
   Inisialisasi
   ============================================================= */
async function init() {
    const sesi = muatSesi();
    if (!sesi) {
        // Belum masuk — kembalikan ke halaman login
        window.location.replace("index.html");
        return;
    }

    if (MODE_DB) {
        if (!db) {
            toast("Gagal memuat Supabase. Periksa koneksi internet lalu muat ulang.");
            return;
        }
        // Mode database membutuhkan sesi Supabase yang masih berlaku
        const { data } = await db.auth.getSession();
        if (!data.session) {
            hapusSesi();
            window.location.replace("index.html");
            return;
        }
    }
    tampilkanPengguna(sesi);

    el.keluar.addEventListener("click", keluar);
    el.form.addEventListener("submit", simpanLaporan);
    el.batal.addEventListener("click", batalEdit);

    // Input uang: rapikan format & perbarui pratinjau perhitungan
    [el.pagu, el.ppn, el.pph].forEach((input) => {
        input.addEventListener("input", () => {
            formatInputUang(input);
            perbaruiPratinjau();
        });
    });

    el.cari.addEventListener("input", () => {
        kataKunci = el.cari.value.trim();
        render();
    });

    el.filterCv.addEventListener("change", () => {
        nilaiFilterCv = el.filterCv.value;
        render();
    });

    el.filterTahun.addEventListener("change", () => {
        nilaiFilterTahun = el.filterTahun.value;
        render();
    });

    el.tombolExcel.addEventListener("click", eksporExcel);
    el.tombolPdf.addEventListener("click", eksporPdf);

    el.batalHapus.addEventListener("click", tutupModalHapus);
    el.yaHapus.addEventListener("click", hapusLaporan);
    el.modal.addEventListener("click", (e) => {
        if (e.target === el.modal) tutupModalHapus();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !el.modal.hidden) tutupModalHapus();
    });

    el.tanggal.value = tanggalHariIni();
    perbaruiPratinjau();

    el.tabel.hidden = true;
    el.pesanKosong.textContent = "Memuat data…";
    el.pesanKosong.hidden = false;
    daftarLaporan = await muatSemua();
    render();
}

document.addEventListener("DOMContentLoaded", init);

/* =============================================================
   Perhitungan (konsep sama seperti laporan Excel)
   ============================================================= */
function hitung(pagu, ppn, pph) {
    const persen = Math.round(pagu * TARIF_PERSEN);
    const pajak = ppn + pph;
    const setelah = pagu - pajak;
    return {
        persen: persen,
        pajak: pajak,
        setelah: setelah,
        diterima: setelah - persen,
    };
}

/* Jumlahkan seluruh angka dari kumpulan laporan */
function ringkas(data) {
    const t = { pagu: 0, persen: 0, ppn: 0, pph22: 0, pajak: 0, setelah: 0, diterima: 0 };
    data.forEach((l) => {
        const r = hitung(l.pagu, l.ppn, l.pph22);
        t.pagu += l.pagu;
        t.persen += r.persen;
        t.ppn += l.ppn;
        t.pph22 += l.pph22;
        t.pajak += r.pajak;
        t.setelah += r.setelah;
        t.diterima += r.diterima;
    });
    return t;
}

/* Saldo Bersih: 5% tiap laporan ditambahkan berurutan menurut tanggal,
   dan dimulai dari nol lagi di setiap tahun. Jadi ekspor tahun 2024 hanya
   berisi akumulasi 5% tahun 2024. Urutan hasil sama dengan urutan data. */
function hitungSaldo(data) {
    const berjalan = {}; // tahun -> akumulasi
    return data.map((l) => {
        const tahun = (l.tanggal || "").slice(0, 4);
        berjalan[tahun] = (berjalan[tahun] || 0) + hitung(l.pagu, l.ppn, l.pph22).persen;
        return berjalan[tahun];
    });
}

/* Perbarui kotak "Perhitungan Otomatis" sesuai isi formulir */
function perbaruiPratinjau() {
    const pagu = ambilAngka(el.pagu);
    const ppn = ambilAngka(el.ppn);
    const pph = ambilAngka(el.pph);
    const r = hitung(pagu, ppn, pph);

    const kosong = !pagu && !ppn && !pph;
    el.pratinjauPersen.textContent = kosong ? "—" : formatRupiah(r.persen);
    el.pratinjauPajak.textContent = kosong ? "—" : formatRupiah(r.pajak);
    el.pratinjauSetelah.textContent = kosong ? "—" : formatRupiah(r.setelah);
    el.pratinjauDiterima.textContent = kosong ? "—" : formatRupiah(r.diterima);
}

/* =============================================================
   Tambah / Ubah laporan
   ============================================================= */
async function simpanLaporan(e) {
    e.preventDefault();

    const tanggal = el.tanggal.value;
    const uraian = el.uraian.value.trim();
    const cv = el.cv.value.trim();
    const pagu = ambilAngka(el.pagu);
    const ppn = ambilAngka(el.ppn);
    const pph = ambilAngka(el.pph);
    const keterangan = el.keterangan.value.trim();

    const tanggalValid = !!tanggal;
    const paguValid = pagu > 0;
    tandaiInput(el.tanggal, tanggalValid);
    tandaiInput(el.pagu, paguValid);

    if (!tanggalValid || !paguValid) {
        el.galatForm.textContent = !tanggalValid
            ? "Tanggal wajib diisi."
            : "PAGU harus berupa angka lebih dari 0.";
        el.galatForm.hidden = false;
        return;
    }

    const nilai = { tanggal: tanggal, uraian: uraian, cv: cv, pagu: pagu, ppn: ppn, pph22: pph, keterangan: keterangan };

    el.simpan.disabled = true;
    try {
        if (idSedangDiedit) {
            if (MODE_DB) {
                const { error } = await db.from("laporan").update(nilai).eq("id", idSedangDiedit);
                if (error) throw error;
            }
            const laporan = daftarLaporan.find((l) => l.id === idSedangDiedit);
            if (laporan) Object.assign(laporan, nilai);
            toast("Laporan berhasil diperbarui.");
        } else {
            let baru;
            if (MODE_DB) {
                const { data, error } = await db.from("laporan").insert(nilai).select().single();
                if (error) throw error;
                baru = dariBaris(data);
            } else {
                baru = { id: buatId(), ...nilai, dibuat: Date.now() };
            }
            daftarLaporan.push(baru);
            toast("Laporan berhasil dicatat.");
        }
    } catch (err) {
        console.error(err);
        toast("Gagal menyimpan: " + (err.message || err));
        el.simpan.disabled = false;
        return;
    }
    el.simpan.disabled = false;

    simpanData();
    resetForm();
    render();
}

/* Isi formulir dengan laporan yang akan diubah */
function mulaiEdit(laporan) {
    idSedangDiedit = laporan.id;

    el.judulForm.textContent = "Ubah Laporan";
    el.subForm.textContent = "Perbaiki rincian laporan yang dipilih.";
    el.tanggal.value = laporan.tanggal || tanggalHariIni();
    el.uraian.value = laporan.uraian || "";
    el.cv.value = laporan.cv || "";
    el.pagu.value = laporan.pagu.toLocaleString("id-ID");
    el.ppn.value = laporan.ppn.toLocaleString("id-ID");
    el.pph.value = laporan.pph22.toLocaleString("id-ID");
    el.keterangan.value = laporan.keterangan || "";
    el.simpan.textContent = "Simpan Perubahan";
    el.batal.hidden = false;
    el.galatForm.hidden = true;

    perbaruiPratinjau();
    el.form.scrollIntoView({ behavior: "smooth", block: "start" });
    render(); // tandai baris yang sedang diedit
}

function batalEdit() {
    resetForm();
    render();
}

/* Kembalikan formulir ke mode tambah */
function resetForm() {
    idSedangDiedit = null;
    el.form.reset(); // mengembalikan CV ke nilai bawaan
    el.tanggal.value = tanggalHariIni();
    el.judulForm.textContent = "Tambah Laporan";
    el.subForm.textContent = "Isi rincian dan pajaknya.";
    el.simpan.textContent = "Simpan";
    el.batal.hidden = true;
    el.galatForm.hidden = true;
    tandaiInput(el.tanggal, true);
    tandaiInput(el.pagu, true);
    perbaruiPratinjau();
}

/* =============================================================
   Hapus laporan
   ============================================================= */
function bukaModalHapus(laporan) {
    idSedangDihapus = laporan.id;
    const r = hitung(laporan.pagu, laporan.ppn, laporan.pph22);
    el.detailHapus.textContent =
        (laporan.tanggal ? formatTanggal(laporan.tanggal) : "Tanpa tanggal") + "\n" +
        (laporan.uraian || "Tanpa uraian belanja") + "\n" +
        (laporan.cv || "") + "\n" +
        "Jumlah diterima: " + formatRupiah(r.diterima) + "\n\n" +
        "Laporan yang dihapus tidak dapat dikembalikan.";
    el.modal.hidden = false;
    el.yaHapus.focus();
}

function tutupModalHapus() {
    el.modal.hidden = true;
    idSedangDihapus = null;
}

async function hapusLaporan() {
    if (!idSedangDihapus) return;
    const id = idSedangDihapus;

    el.yaHapus.disabled = true;
    if (MODE_DB) {
        const { error } = await db.from("laporan").delete().eq("id", id);
        if (error) {
            console.error(error);
            toast("Gagal menghapus: " + error.message);
            el.yaHapus.disabled = false;
            return;
        }
    }
    el.yaHapus.disabled = false;

    daftarLaporan = daftarLaporan.filter((l) => l.id !== id);

    // Jika laporan yang dihapus sedang diedit, batalkan pengubahan
    if (idSedangDiedit === id) resetForm();

    tutupModalHapus();
    simpanData();
    render();
    toast("Laporan berhasil dihapus.");
}

/* =============================================================
   Tampilan tabel, ringkasan, dan filter
   ============================================================= */

/* Laporan yang sedang tampil: hasil pencarian + filter CV + filter tahun */
function laporanTersaring() {
    return daftarLaporan
        .filter((l) => {
            if (nilaiFilterCv !== "semua" && l.cv !== nilaiFilterCv) return false;
            if (nilaiFilterTahun !== "semua" && (l.tanggal || "").slice(0, 4) !== nilaiFilterTahun) return false;
            const teks = (l.uraian + " " + l.cv + " " + l.keterangan).toLowerCase();
            return teks.includes(kataKunci.toLowerCase());
        })
        .sort((a, b) =>
            (a.tanggal || "").localeCompare(b.tanggal || "") || a.dibuat - b.dibuat
        ); // urut menurut tanggal, lalu urutan pencatatan
}

function render() {
    const terlihat = laporanTersaring();

    el.isiTabel.replaceChildren();
    const saldo = hitungSaldo(terlihat);
    terlihat.forEach((laporan, i) => {
        el.isiTabel.appendChild(buatBaris(laporan, i + 1, saldo[i]));
    });

    const adaData = terlihat.length > 0;
    el.tabel.hidden = !adaData;
    el.pesanKosong.hidden = adaData;
    if (!adaData) {
        const adaSaringan = kataKunci || nilaiFilterCv !== "semua" || nilaiFilterTahun !== "semua";
        el.pesanKosong.textContent = adaSaringan
            ? "Tidak ada laporan yang cocok dengan pencarian atau filter."
            : "Belum ada laporan.\nGunakan formulir untuk mencatat laporan pertama Anda.";
    }

    // Ringkasan dihitung dari seluruh data (bukan hasil filter/pencarian)
    const t = ringkas(daftarLaporan);
    el.totalPagu.textContent = formatRupiah(t.pagu);
    el.totalPajak.textContent = formatRupiah(t.pajak);
    el.totalPersen.textContent = formatRupiah(t.persen);
    el.totalDiterima.textContent = formatRupiah(t.diterima);

    isiPilihanFilter();
}

/* Isi pilihan dropdown filter dari data yang ada */
function isiPilihanFilter() {
    const daftarCv = [...new Set(daftarLaporan.map((l) => l.cv).filter(Boolean))].sort();
    const daftarTahun = [...new Set(daftarLaporan.map((l) => (l.tanggal || "").slice(0, 4)).filter(Boolean))]
        .sort()
        .reverse();

    nilaiFilterCv = isiPilih(el.filterCv, daftarCv, "Semua CV / PT", nilaiFilterCv);
    nilaiFilterTahun = isiPilih(el.filterTahun, daftarTahun, "Semua Tahun", nilaiFilterTahun);
}

/* Bangun isi <select>; kembalikan nilai efektif setelah diisi */
function isiPilih(select, daftarNilai, labelSemua, nilaiSekarang) {
    select.replaceChildren();

    const opSemua = document.createElement("option");
    opSemua.value = "semua";
    opSemua.textContent = labelSemua;
    select.appendChild(opSemua);

    daftarNilai.forEach((nilai) => {
        const opsi = document.createElement("option");
        opsi.value = nilai;
        opsi.textContent = nilai;
        select.appendChild(opsi);
    });

    // Pertahankan pilihan lama bila masih tersedia di data
    const efektif = daftarNilai.includes(nilaiSekarang) ? nilaiSekarang : "semua";
    select.value = efektif;
    return efektif;
}

/* Bangun satu baris tabel untuk sebuah laporan */
function buatBaris(laporan, nomor, saldoBersih) {
    const baris = document.createElement("tr");
    if (laporan.id === idSedangDiedit) baris.classList.add("sedang-diedit");

    const r = hitung(laporan.pagu, laporan.ppn, laporan.pph22);

    const selNo = document.createElement("td");
    selNo.className = "sel-no";
    selNo.textContent = String(nomor);

    const selTanggal = document.createElement("td");
    selTanggal.className = "sel-tanggal";
    selTanggal.textContent = laporan.tanggal ? formatTanggal(laporan.tanggal) : "—";

    const selUraian = document.createElement("td");
    selUraian.className = "sel-uraian";
    if (laporan.uraian) {
        selUraian.textContent = laporan.uraian;
    } else {
        selUraian.textContent = "—";
        selUraian.classList.add("redup");
    }

    const selCv = document.createElement("td");
    selCv.className = "sel-cv";
    selCv.textContent = laporan.cv || "—";

    const selPagu = document.createElement("td");
    selPagu.className = "sel-uang";
    selPagu.textContent = formatRupiah(laporan.pagu);

    const selPersen = document.createElement("td");
    selPersen.className = "sel-uang";
    selPersen.textContent = formatRupiah(r.persen);

    const selPpn = document.createElement("td");
    selPpn.className = "sel-uang";
    selPpn.textContent = formatRupiah(laporan.ppn);

    const selPph = document.createElement("td");
    selPph.className = "sel-uang";
    selPph.textContent = formatRupiah(laporan.pph22);

    const selPajak = document.createElement("td");
    selPajak.className = "sel-uang";
    selPajak.textContent = formatRupiah(r.pajak);

    const selSetelah = document.createElement("td");
    selSetelah.className = "sel-uang";
    selSetelah.textContent = formatRupiah(r.setelah);

    const selDiterima = document.createElement("td");
    selDiterima.className = "sel-diterima";
    selDiterima.textContent = formatRupiah(r.diterima);

    const selSaldo = document.createElement("td");
    selSaldo.className = "sel-diterima";
    selSaldo.textContent = formatRupiah(saldoBersih);

    const selKeterangan = document.createElement("td");
    selKeterangan.className = "sel-keterangan";
    if (laporan.keterangan) {
        selKeterangan.textContent = laporan.keterangan;
    } else {
        selKeterangan.textContent = "—";
        selKeterangan.classList.add("redup");
    }

    const selAksi = document.createElement("td");
    selAksi.className = "sel-aksi";
    selAksi.append(
        buatTombolAksi("Ubah", "tombol-ubah", () => mulaiEdit(laporan)),
        buatTombolAksi("Hapus", "tombol-hapus", () => bukaModalHapus(laporan))
    );

    baris.append(selNo, selTanggal, selUraian, selCv, selPagu, selPersen, selPpn, selPph,
        selPajak, selSetelah, selDiterima, selSaldo, selKeterangan, selAksi);
    return baris;
}

function buatTombolAksi(teks, kelas, aksi) {
    const tombol = document.createElement("button");
    tombol.type = "button";
    tombol.className = "tombol-aksi " + kelas;
    tombol.textContent = teks;
    tombol.addEventListener("click", aksi);
    return tombol;
}

/* =============================================================
   Ekspor — Excel (.xlsx) & PDF bergaya invoice
   Ekspor memuat data yang sedang tampil (pencarian + filter).
   ============================================================= */
/* Susun workbook Excel dengan format "Laporan Keuangan" (buku besar):
   TANGGAL | Uraian / Keterangan | CV | 5% | PPN 12% | PPH 22 | Setelah Pajak |
   Anggaran | Masuk | KELUAR | SALDO
     - Masuk  = 5% dari PAGU
     - Anggaran = Jumlah Diterima (Setelah Pajak − 5%)
     - KELUAR = Anggaran
     - SALDO  = akumulasi Masuk (5%) berjalan, mulai dari nol tiap tahun */
function bangunWorkbook(ExcelJS, data) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BUKU BESAR", { views: [{ state: "frozen", ySplit: 4 }] });

    const FORMAT_RP = "[$Rp-421]#,##0";
    const FORMAT_TGL = "[$-421]dd\\ mmmm\\ yyyy;@";
    const tipis = { style: "thin", color: { argb: "FF000000" } };
    const garis = { top: tipis, left: tipis, bottom: tipis, right: tipis };
    const NAMA_FONT = "Calibri";

    ws.columns = [
        { width: 19 }, { width: 44 }, { width: 24 }, { width: 14 }, { width: 14 },
        { width: 13 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
    ];

    // Judul (A1:K2)
    const tahunData = [...new Set(data.map((l) => (l.tanggal || "").slice(0, 4)).filter(Boolean))].sort();
    const teksTahun = tahunData.length === 0 ? "" :
        tahunData.length === 1 ? tahunData[0] : tahunData[0] + " - " + tahunData[tahunData.length - 1];
    ws.mergeCells("A1:K1");
    ws.mergeCells("A2:K2");
    ws.getCell("A1").value = "LAPORAN KEUANGAN";
    ws.getCell("A2").value = "TAHUN " + teksTahun;
    ["A1", "A2"].forEach((k) => {
        ws.getCell(k).font = { name: NAMA_FONT, size: 10, bold: true };
        ws.getCell(k).alignment = { horizontal: "center" };
    });

    // Kepala tabel (baris 4)
    const kepala = ["TANGGAL", "Uraian / Keterangan", "CV", 0.05, "PPN 12%", "PPH 22",
        "Setelah Pajak", "Anggaran", "Masuk", "KELUAR", "SALDO"];
    const barisKepala = ws.getRow(4);
    kepala.forEach((nilai, i) => {
        const sel = barisKepala.getCell(i + 1);
        sel.value = nilai;
        if (i === 3) sel.numFmt = "0%"; // kolom 5%
        sel.font = { name: NAMA_FONT, size: 10, bold: true };
        sel.alignment = { horizontal: "center", vertical: "middle" };
        sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
        sel.border = garis;
    });
    barisKepala.height = 15;

    // Isi: satu baris per laporan
    const saldo = hitungSaldo(data);
    const jumlah = { persen: 0, ppn: 0, pph22: 0, setelah: 0, anggaran: 0 };
    data.forEach((l, i) => {
        const r = hitung(l.pagu, l.ppn, l.pph22);
        const anggaran = r.diterima;
        const uraian = [l.uraian, l.keterangan].filter(Boolean).join(" — ");
        let tgl = "";
        if (l.tanggal) {
            const [y, m, d] = l.tanggal.split("-").map(Number);
            tgl = new Date(Date.UTC(y, m - 1, d));
        }
        const nilai = [tgl, uraian, l.cv || "", r.persen, l.ppn, l.pph22, r.setelah,
            anggaran, r.persen, anggaran, saldo[i]];
        const baris = ws.getRow(5 + i);
        nilai.forEach((v, k) => {
            const sel = baris.getCell(k + 1);
            sel.value = v;
            sel.font = { name: NAMA_FONT, size: 10 };
            sel.border = garis;
            if (k === 0) { sel.numFmt = FORMAT_TGL; sel.alignment = { horizontal: "left" }; }
            else if (k <= 2) { sel.alignment = { horizontal: "left", vertical: "top", wrapText: true }; }
            else { sel.numFmt = FORMAT_RP; sel.alignment = { horizontal: "right" }; }
        });
        jumlah.persen += r.persen;
        jumlah.ppn += l.ppn;
        jumlah.pph22 += l.pph22;
        jumlah.setelah += r.setelah;
        jumlah.anggaran += anggaran;
    });

    // Baris JUMLAH
    const barisJumlah = ws.getRow(5 + data.length);
    const nilaiJumlah = ["", "JUMLAH", "", jumlah.persen, jumlah.ppn, jumlah.pph22, jumlah.setelah,
        jumlah.anggaran, jumlah.persen, jumlah.anggaran, ""];
    nilaiJumlah.forEach((v, k) => {
        const sel = barisJumlah.getCell(k + 1);
        sel.value = v;
        sel.font = { name: NAMA_FONT, size: 10, bold: true };
        sel.border = garis;
        sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
        if (k === 1) sel.alignment = { horizontal: "center" };
        else if (k >= 3) { sel.numFmt = FORMAT_RP; sel.alignment = { horizontal: "right" }; }
    });

    return wb;
}

async function eksporExcel() {
    const data = laporanTersaring();
    if (data.length === 0) {
        toast("Tidak ada laporan untuk diekspor.");
        return;
    }
    if (typeof ExcelJS === "undefined") {
        toast("Pustaka ekspor belum termuat. Periksa koneksi internet lalu muat ulang.");
        return;
    }

    try {
        const wb = bangunWorkbook(ExcelJS, data);
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = namaFile("xlsx");
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Laporan diekspor ke Excel.");
    } catch (err) {
        console.error(err);
        toast("Gagal membuat berkas Excel.");
    }
}

function eksporPdf() {
    const data = laporanTersaring();
    if (data.length === 0) {
        toast("Tidak ada laporan untuk diekspor.");
        return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        toast("Pustaka ekspor belum termuat. Periksa koneksi internet lalu muat ulang.");
        return;
    }

    const doc = bangunPdf(window.jspdf.jsPDF, data);
    doc.save(namaFile("pdf"));
    toast("Laporan diekspor ke PDF.");
}

/* Susun dokumen PDF "Laporan Keuangan" — kolom sama dengan ekspor Excel:
   TANGGAL | Uraian / Keterangan | CV | 5% | PPN 12% | PPH 22 | Setelah Pajak |
   Anggaran | Masuk | KELUAR | SALDO */
function bangunPdf(jsPDF, data) {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const lebar = doc.internal.pageSize.getWidth();
    const tinggi = doc.internal.pageSize.getHeight();
    const M = 14; // margin kiri/kanan

    const BIRU = [37, 99, 235];
    const BIRU_TUA = [29, 78, 216];
    const BIRU_MUDA = [239, 246, 255];
    const HIJAU = [22, 163, 74];
    const MERAH = [220, 38, 38];
    const TEKS = [30, 41, 59];
    const REDUP = [100, 116, 139];

    const t = ringkas(data);
    const saldo = hitungSaldo(data);
    const tahunData = [...new Set(data.map((l) => (l.tanggal || "").slice(0, 4)).filter(Boolean))].sort();
    const teksTahun = tahunData.length === 0 ? "" :
        tahunData.length === 1 ? tahunData[0] : tahunData[0] + " - " + tahunData[tahunData.length - 1];

    // --- Pita kepala ---
    doc.setFillColor(...BIRU);
    doc.rect(0, 0, lebar, 26, "F");
    doc.setFillColor(...BIRU_TUA);
    doc.rect(0, 26, lebar, 1.2, "F");

    // Logo "R"
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, 6, 14, 14, 3, 3, "F");
    doc.setTextColor(...BIRU);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("R", M + 7, 16.2, { align: "center" });

    // Judul
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("LAPORAN KEUANGAN", M + 19, 12.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Sistem Ranara  |  Tahun " + teksTahun + "  |  " + deskripsiFilter(), M + 19, 18.5);

    // Info dokumen (kanan)
    doc.setFontSize(8.5);
    doc.text("No. Dokumen", lebar - M, 9.5, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(nomorDokumen(), lebar - M, 14.5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Diekspor " + formatTanggal(tanggalHariIni()), lebar - M, 20, { align: "right" });

    // --- Kartu ringkasan ---
    const kartu = [
        { judul: "JUMLAH LAPORAN", nilai: String(data.length), warna: BIRU },
        { judul: "TOTAL MASUK (5%)", nilai: formatRupiah(t.persen), warna: HIJAU },
        { judul: "TOTAL KELUAR (ANGGARAN)", nilai: formatRupiah(t.diterima), warna: MERAH },
        { judul: "SALDO BERSIH", nilai: formatRupiah(t.persen), warna: BIRU_TUA },
    ];
    const jarak = 6;
    const lebarKartu = (lebar - 2 * M - 3 * jarak) / 4;
    const yKartu = 33;
    const tinggiKartu = 19;

    kartu.forEach((k, i) => {
        const x = M + i * (lebarKartu + jarak);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, yKartu, lebarKartu, tinggiKartu, 2.5, 2.5, "FD");
        doc.setFillColor(...k.warna);
        doc.roundedRect(x, yKartu, 2.2, tinggiKartu, 1.1, 1.1, "F");
        doc.setTextColor(...REDUP);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text(k.judul, x + 6, yKartu + 6.5);
        doc.setTextColor(...k.warna);
        doc.setFontSize(13);
        doc.text(k.nilai, x + 6, yKartu + 14.5);
    });

    // --- Tabel ---
    const kepala = [["TANGGAL", "Uraian / Keterangan", "CV", "5%", "PPN 12%", "PPH 22",
        "Setelah Pajak", "Anggaran", "Masuk", "KELUAR", "SALDO"]];

    const isi = data.map((l, i) => {
        const r = hitung(l.pagu, l.ppn, l.pph22);
        const uraian = [l.uraian, l.keterangan].filter(Boolean).join(" — ") || "-";
        return [l.tanggal ? formatTanggal(l.tanggal) : "-", uraian, l.cv || "-",
            angka(r.persen), angka(l.ppn), angka(l.pph22), angka(r.setelah),
            angka(r.diterima), angka(r.persen), angka(r.diterima), angka(saldo[i])];
    });
    isi.push(["", "JUMLAH", "", angka(t.persen), angka(t.ppn), angka(t.pph22), angka(t.setelah),
        angka(t.diterima), angka(t.persen), angka(t.diterima), ""]);

    doc.autoTable({
        head: kepala,
        body: isi,
        startY: yKartu + tinggiKartu + 7,
        margin: { top: 14, left: M, right: M, bottom: 14 },
        theme: "grid",
        rowPageBreak: "avoid", // satu baris tidak terpotong di pergantian halaman
        styles: {
            fontSize: 7.5, cellPadding: 2, textColor: TEKS, overflow: "linebreak",
            lineColor: [226, 232, 240], lineWidth: 0.2, valign: "middle",
        },
        headStyles: {
            fillColor: BIRU, textColor: 255, fontSize: 7.5, fontStyle: "bold",
            halign: "center", lineColor: BIRU,
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 22 },
            1: { cellWidth: "auto" },
            2: { cellWidth: 28 },
            3: { cellWidth: 19, halign: "right" },
            4: { cellWidth: 20, halign: "right" },
            5: { cellWidth: 17, halign: "right" },
            6: { cellWidth: 23, halign: "right" },
            7: { cellWidth: 23, halign: "right" },
            8: { cellWidth: 19, halign: "right", textColor: HIJAU, fontStyle: "bold" },
            9: { cellWidth: 23, halign: "right", textColor: MERAH, fontStyle: "bold" },
            10: { cellWidth: 22, halign: "right", fontStyle: "bold", textColor: BIRU_TUA },
        },
        didParseCell: (d) => {
            if (d.section === "head") {
                // Kepala Masuk berwarna hijau, KELUAR berwarna merah
                if (d.column.index === 8) d.cell.styles.fillColor = HIJAU;
                if (d.column.index === 9) d.cell.styles.fillColor = MERAH;
            }
            if (d.section === "body" && d.row.index === data.length) {
                d.cell.styles.fontStyle = "bold";
                d.cell.styles.fillColor = BIRU_MUDA;
                if (d.column.index === 1) d.cell.styles.halign = "center";
            }
        },
        didDrawPage: () => {
            doc.setDrawColor(226, 232, 240);
            doc.line(M, tinggi - 11, lebar - M, tinggi - 11);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(...REDUP);
            doc.text("Sistem Ranara — dokumen dibuat otomatis. Angka dalam Rupiah (Rp).", M, tinggi - 6.5);
            doc.text("Halaman " + doc.internal.getCurrentPageInfo().pageNumber,
                lebar - M, tinggi - 6.5, { align: "right" });
        },
    });

    return doc;
}

/* ---------- Util ekspor ---------- */

/* Nama berkas ekspor, cth. Laporan_Ranara_PT-Akasa_20261002.xlsx */
function namaFile(ekstensi) {
    const bagian = ["Laporan_Ranara"];
    if (nilaiFilterCv !== "semua") bagian.push(slug(nilaiFilterCv));
    if (nilaiFilterTahun !== "semua") bagian.push(nilaiFilterTahun);
    const d = new Date();
    bagian.push(d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0"));
    return bagian.join("_") + "." + ekstensi;
}

/* Ubah teks menjadi aman untuk nama berkas */
function slug(teks) {
    return teks.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        .toLowerCase().slice(0, 40) || "data";
}

/* Uraikan filter aktif untuk judul/keterangan ekspor */
function deskripsiFilter() {
    const bagian = [];
    if (nilaiFilterCv !== "semua") bagian.push(nilaiFilterCv);
    if (nilaiFilterTahun !== "semua") bagian.push("Tahun " + nilaiFilterTahun);
    if (kataKunci) bagian.push("pencarian \u201C" + kataKunci + "\u201D");
    return bagian.length > 0 ? bagian.join(" — ") : "Semua data";
}

/* Nomor dokumen otomatis, cth. LRN-20261002-4821 */
function nomorDokumen() {
    const d = new Date();
    return "LRN-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0") + "-" + String(Date.now()).slice(-4);
}

/* Angka dengan pemisah ribuan (tanpa "Rp", untuk tabel PDF) */
function angka(n) {
    return n.toLocaleString("id-ID");
}

/* =============================================================
   Data (localStorage)
   ============================================================= */
function muatData() {
    try {
        const mentah = localStorage.getItem(KUNCI_DATA);
        const data = mentah ? JSON.parse(mentah) : [];
        if (!Array.isArray(data)) return [];
        // Data lama (versi sebelumnya) belum memiliki tanggal —
        // isi dengan tanggal pembuatannya agar filter tahun tetap bekerja
        return data.map((l) => ({
            ...l,
            tanggal: l.tanggal || (l.dibuat ? new Date(l.dibuat).toISOString().slice(0, 10) : ""),
        }));
    } catch {
        return [];
    }
}

/* Muat semua laporan: dari Supabase (mode database) atau localStorage */
async function muatSemua() {
    if (!MODE_DB) return muatData();

    const { data, error } = await db.from("laporan")
        .select("*")
        .order("tanggal", { ascending: true })
        .order("dibuat", { ascending: true });
    if (error) {
        console.error(error);
        toast("Gagal memuat data: " + error.message);
        return [];
    }

    const hasil = data.map(dariBaris);
    // Database masih kosong: pindahkan data lama dari localStorage (sekali saja)
    return hasil.length === 0 ? pindahkanDataLama() : hasil;
}

/* Baris database -> objek laporan yang dipakai di halaman */
function dariBaris(b) {
    return {
        id: b.id,
        tanggal: b.tanggal,
        uraian: b.uraian || "",
        cv: b.cv || "",
        pagu: Number(b.pagu),
        ppn: Number(b.ppn),
        pph22: Number(b.pph22),
        keterangan: b.keterangan || "",
        dibuat: Date.parse(b.dibuat),
    };
}

/* Salin laporan lama di localStorage ke database (hanya bila database masih kosong) */
async function pindahkanDataLama() {
    const lama = muatData();
    if (lama.length === 0) return [];

    const baris = lama.map((l) => ({
        tanggal: l.tanggal,
        uraian: l.uraian || "",
        cv: l.cv || "",
        pagu: l.pagu,
        ppn: l.ppn,
        pph22: l.pph22,
        keterangan: l.keterangan || "",
        dibuat: new Date(l.dibuat || Date.now()).toISOString(),
    }));

    const { data, error } = await db.from("laporan").insert(baris).select();
    if (error) {
        console.error(error);
        toast("Data lama belum bisa dipindahkan: " + error.message);
        return [];
    }
    toast(data.length + " laporan lama dipindahkan ke database.");
    return data.map(dariBaris).sort((x, y) =>
        (x.tanggal || "").localeCompare(y.tanggal || "") || x.dibuat - y.dibuat);
}

function simpanData() {
    if (MODE_DB) return; // data sudah tersimpan di database
    try {
        localStorage.setItem(KUNCI_DATA, JSON.stringify(daftarLaporan));
    } catch {
        /* penyimpanan tidak tersedia — abaikan */
    }
}

function buatId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/* =============================================================
   Pengguna & sesi
   ============================================================= */
function muatSesi() {
    try {
        const mentah = localStorage.getItem(KUNCI_SESI);
        return mentah ? JSON.parse(mentah) : null;
    } catch {
        return null;
    }
}

function hapusSesi() {
    try {
        localStorage.removeItem(KUNCI_SESI);
    } catch {
        /* abaikan */
    }
}

function tampilkanPengguna(sesi) {
    el.nama.textContent = sesi.nama || "Pengguna";
    el.email.textContent = sesi.email || "";

    if (sesi.foto) {
        el.foto.src = sesi.foto;
        el.foto.hidden = false;
        el.avatarInisial.hidden = true;
    } else {
        el.avatarInisial.textContent = inisialDari(sesi.nama || "Pengguna");
        el.avatarInisial.hidden = false;
        el.foto.hidden = true;
    }
}

async function keluar() {
    if (MODE_DB && db) await db.auth.signOut();
    hapusSesi();
    window.location.replace("index.html");
}

/* =============================================================
   Util
   ============================================================= */
function tanggalHariIni() {
    const sekarang = new Date();
    const bulan = String(sekarang.getMonth() + 1).padStart(2, "0");
    const hari = String(sekarang.getDate()).padStart(2, "0");
    return sekarang.getFullYear() + "-" + bulan + "-" + hari;
}

function formatRupiah(nilai) {
    return "Rp " + nilai.toLocaleString("id-ID");
}

function formatTanggal(iso) {
    if (!iso) return "—";
    return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

/* Rapikan penulisan angka uang saat diketik: hanya angka + pemisah ribuan */
function formatInputUang(input) {
    const angkaMurni = input.value.replace(/\D/g, "");
    input.value = angkaMurni ? Number(angkaMurni).toLocaleString("id-ID") : "";
}

/* Ambil nilai angka dari input (buang pemisah ribuan) */
function ambilAngka(input) {
    return Number(input.value.replace(/\D/g, "")) || 0;
}

function tandaiInput(input, valid) {
    input.classList.toggle("salah", !valid);
}

function inisialDari(nama) {
    const kata = nama.trim().split(/\s+/).filter(Boolean);
    const huruf = kata.slice(0, 2).map((k) => k[0].toUpperCase());
    return huruf.join("") || "?";
}

/* ---------- Toast ---------- */
function toast(pesan) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = pesan;
    document.body.appendChild(t);

    requestAnimationFrame(() => t.classList.add("muncul"));
    setTimeout(() => {
        t.classList.remove("muncul");
        setTimeout(() => t.remove(), 300);
    }, 2600);
}
