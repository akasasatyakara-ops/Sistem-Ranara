/* Membuat klien Supabase bila konfigurasi diisi (dipakai index & dashboard) */
(function () {
    const cfg = window.RANARA_CONFIG || {};
    window.dbDikonfigurasi = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
    window.dbKlien = window.dbDikonfigurasi && window.supabase
        ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
        : null;
})();
