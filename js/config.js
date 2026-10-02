/* =============================================================
   Sistem Ranara — Konfigurasi database (Supabase)
   Isi dua nilai di bawah dari: Supabase → Project Settings → API
     SUPABASE_URL      : "Project URL"
     SUPABASE_ANON_KEY : "anon public" key (aman ada di front-end,
                          data tetap dilindungi aturan RLS di supabase.sql)
   Biarkan kosong untuk memakai penyimpanan localStorage (tanpa database).
   ============================================================= */
window.RANARA_CONFIG = {
    SUPABASE_URL: "",       // cth. "https://zrlcvftrgakhgczyruxb.supabase.co"
    SUPABASE_ANON_KEY: "",  // cth. "sb_publishable_DzCbc38s4WyX8lG2Ogp4UA_JW66WtiW"
};
