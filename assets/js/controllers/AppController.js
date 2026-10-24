document.addEventListener('alpine:init', () => {
    // Instance Chart.js disimpan di luar state Alpine supaya tidak dibungkus proxy reaktif
    let historyChart = null;
    let categoryChart = null;

    const APP_VERSION = '1.0.0';

    const genId = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Tanggal LOKAL (YYYY-MM-DD). toISOString() memakai UTC, jadi jam 00.00-07.00 WIB hasilnya kemarin.
    const localDateStr = (d = new Date()) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    // ===== Parser kalimat transaksi berbahasa Indonesia (murni kode, tanpa API) =====
    // "beli nasi goreng dua puluh lima ribu kemarin pakai BCA" -> { type, amount, category, accountId, date, description }
    const VoiceParser = (() => {
        const UNITS = { nol: 0, kosong: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
        const SCALE = { ribu: 1e3, rb: 1e3, k: 1e3, juta: 1e6, jt: 1e6, miliar: 1e9, milyar: 1e9 };
        const SE_SCALE = { seribu: 1e3, sejuta: 1e6, semiliar: 1e9, semilyar: 1e9 };
        const SLANG = { goceng: 5000, ceban: 10000, noban: 20000, gocap: 50000 };
        const BASE_WORDS = new Set(['sepuluh', 'sebelas', 'belas', 'puluh', 'seratus', 'ratus', 'setengah', 'stengah']);
        const MONEY_PREV = new Set(['rp', 'rupiah', 'seharga', 'sebesar', 'senilai', 'sejumlah', 'sebanyak']);
        const QTY_UNITS = new Set(['kilo', 'kg', 'gram', 'liter', 'buah', 'biji', 'porsi', 'bungkus', 'gelas', 'botol', 'orang', 'pcs',
            'potong', 'piring', 'mangkuk', 'lembar', 'butir', 'bulan', 'hari', 'minggu', 'tahun', 'jam', 'menit', 'kali', 'x', 'unit', 'paket']);
        const MONTHS = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11 };
        const FILLER = new Set(['catat', 'mencatat', 'tolong', 'dong', 'deh', 'masukkan', 'masukin', 'tambahkan', 'tambah', 'input', 'sebesar', 'seharga', 'senilai', 'sejumlah', 'rupiah', 'rp', 'perak']);
        const PREPS = new Set(['pakai', 'pake', 'dari', 'via', 'lewat', 'dengan', 'melalui', 'di', 'ke']);
        const ACCOUNT_STOP = new Set(['dompet', 'bank', 'rekening', 'kartu', 'akun', 'utama', 'saya', 'ku']);
        const ACCOUNT_ALIAS = { cash: 'tunai', kontan: 'tunai', tunai: 'cash' };

        const INCOME = { gaji: 3, gajian: 3, digaji: 3, bonus: 3, thr: 3, upah: 3, honor: 3, komisi: 3, dividen: 3, cashback: 3, refund: 3,
            terima: 2, menerima: 2, diterima: 2, dapat: 2, dapet: 2, pemasukan: 3, pendapatan: 3, untung: 2, jual: 2, menjual: 2, terjual: 2,
            kiriman: 2, transferan: 2, bayaran: 2, masuk: 1 };
        const EXPENSE = { beli: 3, membeli: 3, bayar: 3, membayar: 3, belanja: 3, keluar: 2, pengeluaran: 3, habis: 1, makan: 2, minum: 2, isi: 1,
            topup: 2, sewa: 1, cicil: 2, cicilan: 2, donasi: 2, sedekah: 2, infaq: 2, parkir: 2, ongkos: 2, biaya: 2, tagihan: 2, langganan: 2,
            servis: 2, service: 2, jajan: 2, traktir: 2, bensin: 1 };

        // Petunjuk kategori: kalau nama kategori user memuat salah satu "stems", kata-kata di "words" mengarah ke sana
        const CAT_HINTS = [
            { stems: ['makan', 'minum', 'kuliner', 'jajan', 'konsumsi', 'dapur'], words: ['makan', 'makanan', 'minum', 'nasi', 'ayam', 'bakso', 'mie', 'soto', 'sate', 'kopi', 'teh', 'jajan', 'sarapan', 'resto', 'restoran', 'warteg', 'cafe', 'kafe', 'snack', 'roti', 'gorengan', 'martabak', 'pizza', 'burger', 'lunch', 'dinner', 'sayur', 'buah', 'lauk', 'galon', 'gas'] },
            { stems: ['transport', 'bensin', 'kendara', 'otomotif', 'bbm', 'perjalanan', 'angkut', 'mobil', 'motor', 'ojek', 'mudik', 'ongkos'], words: ['bensin', 'benzin', 'pertamax', 'pertalite', 'pertamina', 'dexlite', 'solar', 'bbm', 'spbu', 'shell', 'ojek', 'gojek', 'grab', 'maxim', 'indrive', 'ojol', 'parkir', 'tol', 'etoll', 'bus', 'busway', 'transjakarta', 'krl', 'mrt', 'lrt', 'kereta', 'angkot', 'taksi', 'taxi', 'travel', 'tiket', 'bengkel', 'servis', 'oli', 'ban', 'tambal', 'cuci'] },
            { stems: ['belanja', 'shopping', 'pakaian', 'fashion'], words: ['belanja', 'baju', 'celana', 'sepatu', 'sandal', 'tas', 'kaos', 'jaket', 'kemeja', 'kosmetik', 'skincare', 'shopee', 'tokopedia', 'lazada', 'tiktok'] },
            { stems: ['tagihan', 'utilitas', 'listrik', 'rumah', 'kos', 'sewa', 'internet', 'pulsa', 'langganan'], words: ['listrik', 'token', 'pln', 'air', 'pdam', 'internet', 'wifi', 'indihome', 'pulsa', 'kuota', 'kos', 'kontrakan', 'sewa', 'cicilan', 'tagihan', 'langganan', 'iuran'] },
            { stems: ['kesehatan', 'medis', 'obat', 'sehat'], words: ['obat', 'dokter', 'apotek', 'klinik', 'vitamin', 'periksa', 'berobat', 'rumah', 'bpjs'] },
            { stems: ['hiburan', 'rekreasi', 'liburan', 'wisata'], words: ['nonton', 'bioskop', 'film', 'game', 'netflix', 'spotify', 'konser', 'liburan', 'wisata', 'hotel', 'karaoke', 'youtube'] },
            { stems: ['pendidikan', 'sekolah', 'kuliah', 'belajar'], words: ['sekolah', 'spp', 'kuliah', 'buku', 'kursus', 'les', 'ukt', 'seragam'] },
            { stems: ['gaji', 'pendapatan', 'salary', 'penghasilan'], words: ['gaji', 'gajian', 'upah', 'honor'] },
            { stems: ['bonus', 'tambahan', 'lain', 'hadiah'], words: ['bonus', 'thr', 'komisi', 'cashback', 'hadiah', 'refund'] },
            { stems: ['investasi', 'tabungan', 'saham'], words: ['saham', 'reksadana', 'emas', 'kripto', 'crypto', 'tabung', 'nabung', 'investasi', 'dividen'] },
            { stems: ['donasi', 'sosial', 'zakat', 'amal'], words: ['donasi', 'sedekah', 'zakat', 'infaq', 'amal'] },
        ];

        const tokenize = (text) => (String(text || '').toLowerCase().match(/\d+(?:[.,]\d+)*|[a-z]+/g) || []);
        const isNumBase = (w) => /^\d/.test(w) || w in UNITS || BASE_WORDS.has(w) || w in SE_SCALE || w in SLANG;
        const hasWord = (list, w) => list.indexOf(w) !== -1;

        const digitValue = (w, next) => {
            const nextIsScale = next in SCALE;
            if (/^\d{1,3}(\.\d{3})+$/.test(w)) return Number(w.replace(/\./g, ''));                     // 25.000
            if (/^\d{1,3}(,\d{3})+$/.test(w) && !nextIsScale) return Number(w.replace(/,/g, ''));       // 25,000
            if (/[.,]/.test(w)) return parseFloat(w.replace(',', '.'));                                  // 1,5
            return Number(w);
        };

        const evalRun = (toks) => {
            let total = 0, cur = 0, last = 0, hasScale = false, lastScale = 0;
            for (let i = 0; i < toks.length; i++) {
                const w = toks[i];
                if (/^\d/.test(w)) { const v = digitValue(w, toks[i + 1]); cur += v; last = v; continue; }
                if (w in UNITS) { cur += UNITS[w]; last = UNITS[w]; continue; }
                if (w === 'sepuluh') { cur += 10; last = 0; continue; }
                if (w === 'sebelas') { cur += 11; last = 0; continue; }
                if (w === 'belas') { cur += 10; last = 0; continue; }
                if (w === 'puluh') { cur = last ? cur - last + last * 10 : cur + 10; last = 0; continue; }
                if (w === 'seratus') { cur += 100; last = 0; continue; }
                if (w === 'ratus') { cur = last ? cur - last + last * 100 : cur + 100; last = 0; continue; }
                if (w === 'setengah' || w === 'stengah') { cur += 0.5; last = 0; continue; }
                if (w in SE_SCALE) { total += SE_SCALE[w]; hasScale = true; lastScale = SE_SCALE[w]; continue; }
                if (w in SCALE) { total += (cur || 1) * SCALE[w]; cur = 0; last = 0; hasScale = true; lastScale = SCALE[w]; continue; }
                if (w in SLANG) { total += SLANG[w]; hasScale = true; lastScale = 1e3; continue; }
            }
            // "dua juta lima ratus" dalam percakapan berarti 2,5 juta
            if (lastScale === 1e6 && cur >= 100 && cur < 1000 && cur % 100 === 0) total += cur * 1000;
            else total += cur;
            return { value: Math.round(total), hasScale };
        };

        const findAmount = (tokens) => {
            const runs = [];
            let run = null;
            tokens.forEach((w, i) => {
                if (isNumBase(w) || (w in SCALE && run)) { if (!run) run = { s: i, e: i }; run.e = i; }
                else if (run) { runs.push(run); run = null; }
            });
            if (run) runs.push(run);

            const cands = runs.map(r => {
                const { value, hasScale } = evalRun(tokens.slice(r.s, r.e + 1));
                const prev = tokens[r.s - 1], next = tokens[r.e + 1];
                return {
                    ...r, value,
                    hint: hasScale || MONEY_PREV.has(prev) || next === 'rupiah' || next === 'perak',
                    qty: QTY_UNITS.has(next),
                    isDate: prev === 'tanggal' || prev === 'tgl'
                };
            }).filter(c => c.value > 0 && !c.isDate);

            let pool = cands.filter(c => c.hint);
            if (!pool.length) pool = cands.filter(c => !c.qty && c.value >= 1000);
            if (!pool.length) return null;
            return pool.sort((a, b) => b.value - a.value)[0];
        };

        const detectType = (tokens) => {
            let inc = 0, exp = 0;
            tokens.forEach(w => { if (INCOME[w]) inc += INCOME[w]; if (EXPENSE[w]) exp += EXPENSE[w]; });
            return inc > exp ? 'income' : 'expense';
        };

        const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

        // Mengembalikan { date, remove:Set<index> }
        const findDate = (tokens, now) => {
            const remove = new Set();
            let date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const shift = (n) => { date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n); };
            for (let i = 0; i < tokens.length; i++) {
                const w = tokens[i];
                if (w === 'kemarin') {
                    remove.add(i);
                    if (tokens[i + 1] === 'lusa' || tokens[i + 1] === 'dulu') { remove.add(i + 1); shift(2); } else shift(1);
                } else if (w === 'tadi' || w === 'barusan') {
                    remove.add(i);
                    if (['pagi', 'siang', 'sore', 'malam'].includes(tokens[i + 1])) remove.add(i + 1);
                } else if (w === 'hari' && tokens[i + 1] === 'ini') { remove.add(i); remove.add(i + 1); }
                else if ((w === 'tanggal' || w === 'tgl') && /^\d{1,2}$/.test(tokens[i + 1] || '')) {
                    const day = Number(tokens[i + 1]);
                    remove.add(i); remove.add(i + 1);
                    let month = now.getMonth(), year = now.getFullYear();
                    if (tokens[i + 2] in MONTHS) { month = MONTHS[tokens[i + 2]]; remove.add(i + 2); if (month > now.getMonth()) year -= 1; }
                    else if (day > now.getDate()) { month -= 1; if (month < 0) { month = 11; year -= 1; } }
                    const d = new Date(year, month, day);
                    if (d.getMonth() === month) date = d; // tanggal yang tidak ada (mis. 31 Februari) diabaikan
                }
            }
            return { date: ymd(date), remove };
        };

        // Kata umum yang tidak boleh dijadikan petunjuk kategori saat belajar dari riwayat
        const STOP_LEARN = new Set(['beli', 'membeli', 'bayar', 'membayar', 'isi', 'mengisi', 'buat', 'untuk', 'dan', 'di', 'ke', 'dari', 'pakai', 'pake',
            'yang', 'ini', 'itu', 'tadi', 'kemarin', 'lusa', 'hari', 'bulan', 'minggu', 'lalu', 'catat', 'tolong', 'dong', 'deh', 'uang', 'dapat',
            'terima', 'rupiah', 'ribu', 'juta', 'sudah', 'udah', 'lagi', 'saja', 'aja', 'dengan', 'via', 'lewat', 'tanggal', 'pagi', 'siang', 'sore',
            'malam', 'cicilan', 'ke', 'nya', 'saya', 'aku']);
        const GENERIC_CATS = ['lainnya', 'lain-lain', 'lain lain', 'lain', 'umum', 'other', 'others', 'misc', 'tak terduga', 'serba-serbi'];

        // Salah dengar satu huruf ("bensing", "benzin") dianggap sama dengan kata aslinya (kata minimal 5 huruf)
        const near = (a, b) => {
            if (a === b) return true;
            if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
            const s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
            return s.slice(i) === l.slice(i + 1);
        };

        // Belajar dari transaksi lama: kata di keterangan -> kategori yang dulu dipakai pengguna sendiri
        const learnIndex = (history, cats) => {
            const names = new Set(cats.map(c => c.name));
            const idx = {};
            (history || []).forEach(h => {
                if (!h || !names.has(h.category)) return;
                new Set(tokenize(h.description)).forEach(w => {
                    if (w.length < 3 || /^\d/.test(w) || STOP_LEARN.has(w) || isNumBase(w)) return;
                    if (!idx[w]) idx[w] = {};
                    idx[w][h.category] = (idx[w][h.category] || 0) + 1;
                });
            });
            return idx;
        };

        const pickCategory = (tokens, text, cats, history) => {
            const learned = learnIndex(history, cats);
            const uniq = Array.from(new Set(tokens.filter(t => t.length >= 3 && !/^\d/.test(t) && !STOP_LEARN.has(t))));
            let best = null, bestScore = 0;
            cats.forEach(c => {
                const name = String(c.name || '').toLowerCase();
                if (!name) return;
                let score = 0;
                const nameWords = name.match(/[a-z]{3,}/g) || [];
                if (name.length >= 3 && new RegExp('(^|[^a-z])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(text)) score += 10;
                nameWords.forEach(nw => { if (tokens.some(t => t.length >= 4 && (nw.startsWith(t) || t.startsWith(nw) || near(t, nw)))) score += 4; });
                CAT_HINTS.forEach(g => {
                    if (g.stems.some(s => name.includes(s)) && g.words.some(w => tokens.some(t => t === w || near(t, w)))) score += 5;
                });
                uniq.forEach(t => { const v = learned[t] && learned[t][c.name]; if (v) score += Math.min(v, 3) * 2; });
                if (score > bestScore) { bestScore = score; best = c; }
            });
            if (bestScore >= 4) return best.name;
            // Tidak ada yang cocok: pakai kategori umum bila pengguna punya ("Lainnya", dst.), kalau tidak biarkan kosong
            const generic = cats.find(c => GENERIC_CATS.includes(String(c.name || '').trim().toLowerCase()));
            return generic ? generic.name : '';
        };

        const pickAccount = (tokens, accounts) => {
            let best = null, bestLen = 0, hitIdx = -1;
            accounts.forEach(a => {
                const words = (String(a.name || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !ACCOUNT_STOP.has(w));
                words.forEach(w => {
                    const alias = ACCOUNT_ALIAS[w];
                    const i = tokens.findIndex(t => t === w || (alias && t === alias));
                    if (i !== -1 && w.length > bestLen) { best = a; bestLen = w.length; hitIdx = i; }
                });
            });
            return best ? { account: best, index: hitIdx } : null;
        };

        const parse = (text, ctx) => {
            const raw = String(text || '').trim();
            const tokens = tokenize(raw);
            const now = ctx.now || new Date();
            const removed = new Set();

            const amountRun = findAmount(tokens);
            let amount = 0;
            if (amountRun) {
                amount = amountRun.value;
                for (let i = amountRun.s; i <= amountRun.e; i++) removed.add(i);
                if (MONEY_PREV.has(tokens[amountRun.s - 1])) removed.add(amountRun.s - 1);
                if (tokens[amountRun.e + 1] === 'rupiah' || tokens[amountRun.e + 1] === 'perak') removed.add(amountRun.e + 1);
            }

            const type = detectType(tokens);
            const dt = findDate(tokens, now);
            dt.remove.forEach(i => removed.add(i));

            const acc = pickAccount(tokens, ctx.accounts || []);
            if (acc) {
                removed.add(acc.index);
                let j = acc.index - 1;
                if (j >= 0 && ACCOUNT_STOP.has(tokens[j])) { removed.add(j); j--; }
                if (j >= 0 && PREPS.has(tokens[j])) removed.add(j);
            }

            const category = pickCategory(tokens, tokens.join(' '), (ctx.categories || []).filter(c => c.type === type), ctx.history || []);

            const words = tokens.filter((w, i) => !removed.has(i) && !FILLER.has(w));
            while (words.length && (words[0] === 'pengeluaran' || words[0] === 'pemasukan')) words.shift();
            let description = words.join(' ').trim();
            description = description ? description.charAt(0).toUpperCase() + description.slice(1) : '';

            return {
                type, amount, category, description, date: dt.date,
                accountId: acc ? acc.account.id : (ctx.defaultAccountId || ''),
                found: { amount: amount > 0, category: !!category, account: !!acc }
            };
        };

        return { parse, pickCategory, tokenize };
    })();

    // ===== x-dialog: perilaku dialog yang benar untuk modal dan bottom sheet =====
    // Dipasang pada pembungkus yang punya x-show. Menambah role="dialog", aria-modal, nama dari judul,
    // memindahkan fokus ke dalam dialog saat dibuka, menahan Tab di dalamnya, dan mengembalikan fokus
    // ke tombol pemicu saat ditutup. Pembuka/penutupnya boleh siapa saja (cukup x-show berubah).
    Alpine.directive('dialog', (el, _d, { cleanup }) => {
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('tabindex', '-1');

        let open = false, prevFocus = null;
        const isOpen = () => el.style.display !== 'none';

        const focusables = () => Array.from(el.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(n => n.getClientRects().length > 0);

        const sync = () => {
            const now = isOpen();
            if (now === open) return;
            open = now;
            if (now) {
                prevFocus = document.activeElement;
                // Tunggu satu frame: isi dialog (x-if, judul dinamis) baru selesai tergambar
                requestAnimationFrame(() => {
                    const h = el.querySelector('h3, h4');
                    const name = (h && h.textContent.trim()) || el.getAttribute('data-title') || 'Dialog';
                    el.setAttribute('aria-label', name);
                    // Fokus ke pembungkus (bukan kolom input) agar keyboard HP tidak langsung muncul
                    try { el.focus({ preventScroll: true }); } catch (e) {}
                });
            } else {
                const p = prevFocus;
                prevFocus = null;
                if (p && p.isConnected && typeof p.focus === 'function') { try { p.focus({ preventScroll: true }); } catch (e) {} }
            }
        };

        const onKey = (e) => {
            if (e.key !== 'Tab' || !open) return;
            const list = focusables();
            if (!list.length) { e.preventDefault(); el.focus(); return; }
            const first = list[0], last = list[list.length - 1], active = document.activeElement;
            if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        };

        const mo = new MutationObserver(sync); // x-show mengubah style.display
        mo.observe(el, { attributes: true, attributeFilter: ['style'] });
        el.addEventListener('keydown', onKey);
        cleanup(() => { mo.disconnect(); el.removeEventListener('keydown', onKey); });
    });

    // ===== x-money: kolom nominal dengan pemisah ribuan otomatis =====
    // Dipakai sebagai pengganti x-model: <input type="text" inputmode="numeric" x-money="form.amount">
    // - Tampilan: 15.000.000   - Nilai di data: "15000000" (hanya angka, tanpa titik)
    // - Modifier .negative mengizinkan tanda minus di depan (mis. saldo overdraft)
    Alpine.directive('money', (el, { expression, modifiers }, { evaluateLater, effect, cleanup }) => {
        const allowNeg = modifiers.includes('negative');
        const MAX_DIGITS = 15;
        const getVal = evaluateLater(expression);
        const setVal = evaluateLater(expression + ' = __v');

        // Nilai dari data (angka, "1500000", atau "1.500.000") menjadi string angka murni
        const normalize = (v) => {
            if (v === null || v === undefined || v === '') return '';
            if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
            let s = String(v).trim();
            if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
            else if (/^-?\d+\.\d+$/.test(s)) s = String(Math.round(Number(s)));
            return clean(s);
        };
        // Ketikan pengguna: buang semua selain angka (minus hanya di awal bila diizinkan)
        const clean = (s) => {
            const neg = allowNeg && /^\s*-/.test(s);
            let d = s.replace(/\D/g, '').slice(0, MAX_DIGITS).replace(/^0+(?=\d)/, '');
            return d ? (neg ? '-' : '') + d : (neg ? '-' : '');
        };
        const format = (d) => {
            if (!d || d === '-') return d;
            const neg = d[0] === '-';
            return (neg ? '-' : '') + (neg ? d.slice(1) : d).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        };

        const onInput = () => {
            const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
            const sig = el.value.slice(0, caret).replace(/[^\d-]/g, '').length; // karakter bermakna di kiri kursor
            const raw = clean(el.value);
            const shown = format(raw);
            if (el.value !== shown) {
                el.value = shown;
                let pos = 0, count = 0;
                while (pos < shown.length && count < sig) { if (/[\d-]/.test(shown[pos])) count++; pos++; }
                try { el.setSelectionRange(pos, pos); } catch (e) {}
            }
            setVal(() => {}, { scope: { __v: raw } });
        };

        // Tempel "Rp 1.500.000,00": desimal dibuang, titik ribuan diabaikan
        const onPaste = (e) => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text');
            if (text == null) return;
            e.preventDefault();
            let t = String(text).replace(/rp/ig, '').replace(/\s/g, '');
            t = t.replace(/,\d{1,2}$/, '');
            if (!/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\.\d{1,2}$/, '');
            const s = el.selectionStart == null ? el.value.length : el.selectionStart;
            const en = el.selectionEnd == null ? s : el.selectionEnd;
            el.setRangeText(t.replace(/[^\d-]/g, ''), s, en, 'end');
            onInput();
        };

        el.addEventListener('input', onInput);
        el.addEventListener('paste', onPaste);
        cleanup(() => { el.removeEventListener('input', onInput); el.removeEventListener('paste', onPaste); });

        // Data berubah dari luar (reset form, tombol "Isi sisa", edit): perbarui tampilan
        effect(() => {
            getVal((v) => {
                const shown = format(normalize(v));
                if (el.value !== shown) el.value = shown;
            });
        });
    });

    const localStorageSafeDate = () => localDateStr();

    Alpine.data('AppController', () => ({
        activeAccountIndex: 0,
        showSaldo: true,

        db: {
            accounts: [],
            transactions: [],
            debts_receivables: [],
            categories: []
        },
        activeTab: 'dashboard',
        catFilter: 'expense',
        currentDate: new Date(),

        // State halaman riwayat
        historyFilter: 'all',   // 'all' | 'income' | 'expense' | 'debt'
        searchQuery: '',
        detailTx: null,         // transaksi yang dibuka di bottom sheet
        confirmDelete: false,
        undoTx: null,           // transaksi yang baru dihapus
        undoTimer: null,

        modals: {
            'modal-add-account': false,
            'modal-add-tx': false,
            'modal-add-debt': false,
            'modal-add-category': false,
            'modal-receipt': false,
            'modal-adjust': false,
            'modal-transfer': false,
            'modal-data': false,
            'modal-insight': false,
            'modal-debt-pay': false,
            'modal-add-goal': false,
            'modal-goal-deposit': false,
            'modal-voice': false
        },

        // Slider kutipan dashboard (slide aktif dihitung dari jam, bukan dari animasi CSS)
        sliderIndex: 0,

        // Catat dengan suara (Web Speech API)
        // status: idle | listening | result | error | unsupported
        voice: { status: 'idle', transcript: '', interim: '', error: '', typed: '', draft: null },

        // Diagram kategori di Riwayat: 'expense' | 'income'; categoryFilter = nama kategori yang sedang disaring ('' = semua)
        catChartType: 'expense',
        catSlide: 0,          // slide daftar kategori yang sedang terlihat (mulai 0)
        catSheet: null,       // kategori yang rinciannya dibuka: { name, type }
        catSheetLimit: 30,    // jumlah transaksi yang ditampilkan di rincian (bertambah lewat tombol)
        categoryFilter: '',

        // Halaman riwayat transaksi yang sedang dibuka (mulai dari 1)
        historyPage: 1,

        // Pengaturan (disimpan per perangkat, tidak ikut backup data)
        appVersion: APP_VERSION,
        settings: { hideBalance: false, backupReminder: true, backupIntervalDays: 7, historyPageSize: 20, historyView: 'line' },
        settingsReturnTab: 'dashboard',

        // Pemberitahuan & dialog konfirmasi dalam aplikasi (pengganti alert/confirm bawaan browser)
        toastMsg: { text: '', type: 'error' },
        confirmDlg: { open: false, title: '', message: '', confirmText: 'Ya', cancelText: 'Batal', danger: false, requireText: '', typed: '' },

        // Tema: 'light' | 'dark' | 'system'
        theme: 'system',
        darkOn: false,
        themeToast: '',

        // Pengaman data
        lastBackupAt: null,
        backupSnoozeUntil: 0,
        storagePersisted: null,

        // Target tabungan
        formGoal: { id: null, name: '', target: '', deadline: '', saved: '' },
        formGoalDeposit: { mode: 'deposit', amount: '', date: '', note: '' },
        goalSheetId: null,
        confirmDeleteGoal: false,
        depositGoalId: null,

        // Analisis keuangan
        insight: { empty: true },

        // Import & Ekspor
        dataForm: { period: 'month', importMode: 'merge', importText: '' },
        dataMsg: { type: '', text: '' },

        formAccount: { id: null, name: '', initial_balance: '' },
        formAdjust: { account_id: null, actual: '', note: '' },
        formTransfer: { id: null, from_id: '', to_id: '', amount: '', date: '', note: '' },
        walletSheetId: null,        // dompet yang dibuka di bottom sheet (tab Dompet)
        confirmDeleteWallet: false,
        formTx: { id: null, account_id: '', type: 'expense', amount: '', category: '', description: '', date: '' },
        formDebt: { id: null, type: 'utang', person: '', amount: '', account_id: '', date: '', due_date: '', note: '', record: true },
        formDebtPay: { amount: '', account_id: '', date: '', note: '' },
        debtFilter: 'all',
        debtSheetId: null,          // catatan yang dibuka di bottom sheet (tab Utang)
        confirmDeleteDebt: false,
        payDebtId: null,
        formCategory: { id: null, name: '', type: 'expense', icon: 'fa-utensils', budget: '' },
        selectedReceipt: {},

        // Kategori: bottom sheet aksi
        catSheetId: null,
        confirmDeleteCat: false,

        // Ikon kategori dibedakan per jenis (masing-masing 25, tanpa duplikat karena dipakai sebagai key)
        iconsExpense: [
            'fa-utensils', 'fa-cart-shopping', 'fa-bag-shopping', 'fa-car', 'fa-motorcycle',
            'fa-gas-pump', 'fa-bus', 'fa-house', 'fa-bolt', 'fa-wifi',
            'fa-phone', 'fa-droplet', 'fa-heart-pulse', 'fa-pills', 'fa-shirt',
            'fa-film', 'fa-gamepad', 'fa-graduation-cap', 'fa-book', 'fa-gift',
            'fa-mug-hot', 'fa-baby', 'fa-paw', 'fa-plane', 'fa-screwdriver-wrench'
        ],
        iconsIncome: [
            'fa-money-check-dollar', 'fa-money-bill-wave', 'fa-sack-dollar', 'fa-coins', 'fa-wallet',
            'fa-piggy-bank', 'fa-briefcase', 'fa-building', 'fa-user-tie', 'fa-laptop-code',
            'fa-chart-line', 'fa-arrow-trend-up', 'fa-percent', 'fa-hand-holding-dollar', 'fa-handshake',
            'fa-store', 'fa-trophy', 'fa-award', 'fa-gift', 'fa-house-chimney',
            'fa-key', 'fa-seedling', 'fa-file-invoice-dollar', 'fa-landmark', 'fa-rotate-left'
        ],

        // ========== INIT & DATA ==========
        init() {
            this.initTheme();
            this.loadSettings();
            this.loadData();
            this.resetFormTx();
            this.startSlider();
            try {
                this.lastBackupAt = localStorage.getItem('finku_last_backup') || null;
                this.backupSnoozeUntil = Number(localStorage.getItem('finku_backup_snooze')) || 0;
            } catch (e) {}
            this.requestPersistentStorage();

            // Hasil pencarian/filter berbeda, jadi halaman lama tidak berarti lagi
            if (typeof this.$watch === 'function') {
                this.$watch('searchQuery', () => { this.historyPage = 1; });
                this.$watch('historyFilter', () => { this.historyPage = 1; });
            }
        },

        loadData() {
            const raw = localStorage.getItem('finku_database_v1');
            let parsed = null;
            if (raw) {
                try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
            }
            if (parsed) {
                this.db = parsed;
                this.normalizeData();
            } else {
                this.initDefaultData();
            }
        },

        // Melengkapi data lama: array yang hilang dan transaksi dengan id null
        normalizeData() {
            this.db.accounts ||= [];
            this.db.transactions ||= [];
            this.db.debts_receivables ||= [];
            this.db.categories ||= [];

            let changed = false;
            this.db.transactions.forEach(tx => {
                if (!tx.id) {
                    tx.id = genId('tx');
                    changed = true;
                }
            });

            // Migrasi: dulu hanya `balance` yang disimpan. Saldo awal dihitung mundur dari saldo
            // tersimpan supaya angka di layar tidak berubah.
            this.db.accounts.forEach(acc => {
                if (acc.initial_balance === undefined || acc.initial_balance === null) {
                    let income = 0, expense = 0;
                    this.db.transactions.forEach(t => {
                        if (t.account_id !== acc.id) return;
                        if (t.type === 'income') income += Number(t.amount) || 0;
                        else if (t.type === 'expense') expense += Number(t.amount) || 0;
                    });
                    acc.initial_balance = (Number(acc.balance) || 0) - income + expense;
                    changed = true;
                }
            });

            // Bersihkan kategori utang/piutang bentukan versi sebelumnya (kecuali dipakai transaksi biasa)
            const autoNames = ['Utang', 'Piutang', 'Bayar Utang', 'Terima Piutang'];
            const before = this.db.categories.length;
            this.db.categories = this.db.categories.filter(c =>
                !autoNames.includes(c.name) ||
                this.db.transactions.some(t => !t.debt_id && t.category === c.name && t.type === c.type));
            if (this.db.categories.length !== before) changed = true;

            // Catatan utang/piutang lama: pastikan punya daftar cicilan & sisa yang konsisten
            this.db.debts_receivables.forEach(d => {
                if (!Array.isArray(d.payments)) { d.payments = []; changed = true; }
                d.amount = Number(d.amount) || 0;
                const rem = Number(d.remaining ?? d.amount);
                const fixed = d.status === 'paid' ? 0 : Math.min(Math.max(rem, 0), d.amount);
                if (d.remaining !== fixed) { d.remaining = fixed; changed = true; }
                const st = fixed <= 0 ? 'paid' : 'unpaid';
                if (d.status !== st) { d.status = st; changed = true; }
                if (d.tx_id === undefined) { d.tx_id = null; changed = true; }
            });

            // Target tabungan & anggaran: pastikan bentuk data benar
            if (!Array.isArray(this.db.goals)) { this.db.goals = []; changed = true; }
            this.db.goals.forEach(g => {
                if (!Array.isArray(g.contributions)) { g.contributions = []; changed = true; }
                g.target = Number(g.target) || 0;
            });
            this.db.categories.forEach(c => {
                if (c.budget === undefined) return;
                const b = Math.round(Number(c.budget) || 0);
                if (c.type !== 'expense' || b <= 0) { delete c.budget; changed = true; }
                else if (c.budget !== b) { c.budget = b; changed = true; }
            });

            this.recalcBalances();
            if (changed) this.persist();
        },

        initDefaultData() {
            this.db = {
                accounts: [
                    { id: "acc_1", name: "Dompet Tunai", initial_balance: 540000 },
                    { id: "acc_2", name: "Bank BCA", initial_balance: 0 }
                ],
                transactions: [
                    { id: "tx_1", account_id: "acc_1", type: "expense", amount: 25000, category: "Makanan", description: "Beli nasi goreng", date: "2026-08-18" },
                    { id: "tx_2", account_id: "acc_2", type: "income", amount: 3000000, category: "Gaji", description: "Gaji bulanan", date: "2026-08-17" },
                    { id: "tx_3", account_id: "acc_1", type: "expense", amount: 15000, category: "Belanja", description: "Beli bensin", date: "2026-08-16" }
                ],
                debts_receivables: [],
                goals: [],
                categories: [
                    { id: "cat_1", name: "Makanan", type: "expense", icon: "fa-utensils" },
                    { id: "cat_2", name: "Belanja", type: "expense", icon: "fa-bag-shopping" },
                    { id: "cat_3", name: "Gaji", type: "income", icon: "fa-money-check-dollar" }
                ]
            };
            this.persist();
        },

        persist() {
            this.recalcBalances();
            if (this.activeTab === 'history') this.refreshHistoryCharts();
            localStorage.setItem('finku_database_v1', JSON.stringify(this.db));
            // Grafik ikut diperbarui kalau sedang di tab riwayat
            if (this.activeTab === 'history') this.refreshHistoryCharts();
        },

        // ========== FORMAT ==========
        formatRupiah(num) {
            return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num || 0);
        },

        // Catatan: di Indonesia "M" berarti miliar, jadi "Rp 1,5M" untuk 1,5 juta menyesatkan.
        formatK(num) {
            const n = Number(num) || 0;
            if (n >= 1000000000) {
                return 'Rp ' + (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
            }
            if (n >= 1000000) {
                return 'Rp ' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            }
            if (n >= 1000) {
                return 'Rp ' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
            }
            return 'Rp ' + n;
        },

        // Format singkat gaya Indonesia: Rp 12,5 jt / Rp 1,2 M (miliar)
        formatRupiahShort(num) {
            const n = Number(num) || 0;
            const abs = Math.abs(n);
            const f = (v, s) => 'Rp ' + v.toFixed(1).replace('.', ',').replace(/,0$/, '') + ' ' + s;
            if (abs >= 1e9) return f(n / 1e9, 'M');
            if (abs >= 1e6) return f(n / 1e6, 'jt');
            return this.formatRupiah(n);
        },

        formatDateLabel(dateStr) {
            if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
            const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
            const date = new Date(y, m - 1, d);
            const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diff = Math.round((today - date) / 86400000);
            const base = `${hari[date.getDay()]} ${d} ${bulan[m - 1]}`;
            if (diff === 0) return 'Hari ini • ' + base;
            if (diff === 1) return 'Kemarin • ' + base;
            return base;
        },

        // Tanggal singkat untuk daftar ringkas, mis. "4 Okt"
        formatDateShort(dateStr) {
            if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr || '';
            const [, m, d] = dateStr.slice(0, 10).split('-').map(Number);
            const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            return `${d} ${bln[m - 1]}`;
        },

        // ========== MODAL & FORM ==========
        resetFormTx(type = 'expense') {
            this.formTx = {
                id: null,
                account_id: this.db.accounts[0]?.id || '',
                type: type,
                amount: '',
                category: this.db.categories.find(c => c.type === type)?.name || '',
                description: '',
                date: localDateStr()
            };
        },

        openModal(modalName, defaultType = null) {
            if (modalName === 'modal-add-tx' && defaultType) {
                this.resetFormTx(defaultType);
            }
            this.modals[modalName] = true;
        },

        openModalWithCategory(modalName, type, categoryName) {
            this.formTx.type = type;
            this.formTx.category = categoryName;
            this.openModal(modalName);
        },

        closeModal(modalName) {
            this.modals[modalName] = false;
            if (modalName === 'modal-data') this.dataMsg = { type: '', text: '' };
            if (modalName === 'modal-voice') this.abortVoice();
            if (modalName === 'modal-add-account') {
                this.formAccount = { id: null, name: '', initial_balance: '' };
            }
            if (modalName === 'modal-add-tx') {
                this.resetFormTx();
            }
            if (modalName === 'modal-adjust') {
                this.formAdjust = { account_id: null, actual: '', note: '' };
            }
            if (modalName === 'modal-transfer') {
                this.formTransfer = { id: null, from_id: '', to_id: '', amount: '', date: '', note: '' };
            }
        },

        // SESUAIKAN: nama tab Kategori harus sama dengan yang dipakai di navigasi bawah
        goToCategories() {
            this.activeTab = 'categories';
        },

        // ========== HELPER TAMPILAN ==========
        getAccountName(id) {
            const acc = this.db.accounts.find(a => a.id === id);
            return acc ? acc.name : 'Tanpa dompet';
        },

        getCategoryIcon(catName) {
            const cat = this.db.categories.find(c => c.name === catName);
            return cat ? cat.icon : 'fa-circle-dot';
        },

        getTotalIncome() {
            return this.db.transactions
                .filter(t => t.type === 'income' && !t.debt_id)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getTotalExpense() {
            return this.db.transactions
                .filter(t => t.type === 'expense' && !t.debt_id)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        // SALDO = saldo awal + total pemasukan - total pengeluaran dompet itu.
        // Saldo tidak pernah diubah langsung oleh transaksi, jadi tidak bisa tidak sinkron.
        getAccountBalance(acc) {
            if (!acc) return 0;
            let balance = Number(acc.initial_balance) || 0;
            this.db.transactions.forEach(t => {
                if (t.type === 'transfer') {
                    const amt = Number(t.amount) || 0;
                    if (t.account_id === acc.id) balance -= amt;      // dompet asal
                    if (t.to_account_id === acc.id) balance += amt;   // dompet tujuan
                    return;
                }
                if (t.account_id !== acc.id) return;
                if (t.type === 'income') balance += Number(t.amount) || 0;
                else if (t.type === 'expense') balance -= Number(t.amount) || 0;
                else if (t.type === 'adjustment') balance += Number(t.amount) || 0; // amount sudah bertanda (+/-)
            });
            return balance;
        },

        getAccountBalanceById(id) {
            return this.getAccountBalance(this.db.accounts.find(a => a.id === id));
        },

        // `balance` di data hanya salinan turunan (untuk kode lama yang masih membacanya)
        recalcBalances() {
            this.db.accounts.forEach(a => { a.balance = this.getAccountBalance(a); });
        },

        // Total saldo semua dompet (baris kecil di kartu saldo)
        getTotalBalance() {
            return this.db.accounts.reduce((sum, a) => sum + this.getAccountBalance(a), 0);
        },

        // Ringkasan per dompet (dipakai kartu Total Masuk/Keluar di dashboard)
        getWalletIncome(accId) {
            return this.db.transactions
                .filter(t => t.type === 'income' && !t.debt_id && t.account_id === accId)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getWalletExpense(accId) {
            return this.db.transactions
                .filter(t => t.type === 'expense' && !t.debt_id && t.account_id === accId)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getRecentTransactions() {
            if (!this.db.transactions || this.db.transactions.length === 0) return [];
            return [...this.db.transactions].reverse().slice(0, 5);
        },

        // ========== RIWAYAT: BULAN ==========
        getCurrentMonthLabel() {
            return this.currentDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        },

        // Tidak bisa maju melewati bulan berjalan
        canGoNext() {
            const now = new Date();
            const c = this.currentDate;
            return c.getFullYear() < now.getFullYear()
                || (c.getFullYear() === now.getFullYear() && c.getMonth() < now.getMonth());
        },

        changeMonth(direction) {
            if (direction > 0 && !this.canGoNext()) return;
            const d = this.currentDate;
            // Pakai tanggal 1 supaya tidak loncat bulan (mis. 31 Okt + 1 bulan = 1 Des)
            this.currentDate = new Date(d.getFullYear(), d.getMonth() + direction, 1);
            this.historyPage = 1;
            this.resetCatSlider();
            this.refreshHistoryCharts();
        },

        getFilteredMonthTransactions() {
            const year = this.currentDate.getFullYear();
            const month = String(this.currentDate.getMonth() + 1).padStart(2, '0');
            return this.db.transactions.filter(t => t.date && t.date.startsWith(`${year}-${month}`));
        },

        getFilteredMonthlyIncome() {
            return this.getFilteredMonthTransactions()
                .filter(t => t.type === 'income' && !t.debt_id)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getFilteredMonthlyExpense() {
            return this.getFilteredMonthTransactions()
                .filter(t => t.type === 'expense' && !t.debt_id)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getMonthNet() {
            return this.getFilteredMonthlyIncome() - this.getFilteredMonthlyExpense();
        },

        // ========== RIWAYAT: FILTER & GRUP ==========
        hasActiveFilter() {
            return this.historyFilter !== 'all' || this.searchQuery.trim() !== '' || !!this.categoryFilter;
        },

        resetFilter() {
            this.historyFilter = 'all';
            this.searchQuery = '';
            this.categoryFilter = '';
            this.historyPage = 1;
        },

        // Semua grup hari untuk bulan, filter, dan pencarian saat ini (belum dipotong per halaman)
        getAllGroupedTransactions() {
            const q = this.searchQuery.trim().toLowerCase();
            const list = this.getFilteredMonthTransactions().filter(tx => {
                if (this.historyFilter === 'debt') { if (!tx.debt_id) return false; }
                else if (this.historyFilter !== 'all' && (tx.type !== this.historyFilter || tx.debt_id)) return false;
                if (this.categoryFilter && ((tx.category || '').trim() || 'Tanpa kategori') !== this.categoryFilter) return false;
                if (!q) return true;
                return (tx.description || '').toLowerCase().includes(q)
                    || (tx.category || '').toLowerCase().includes(q);
            });

            const groups = {};
            list.forEach(tx => {
                const key = (tx.date || 'Lainnya').slice(0, 10);
                if (!groups[key]) groups[key] = [];
                groups[key].push(tx);
            });

            return Object.keys(groups)
                .sort((a, b) => b.localeCompare(a))
                .map(date => {
                    const txs = groups[date].slice().reverse();
                    // Koreksi saldo tidak dihitung sebagai pemasukan/pengeluaran
                    const total = txs.reduce((sum, t) => {
                        if (t.debt_id) return sum; // utang/piutang bukan pemasukan/pengeluaran
                        if (t.type === 'income') return sum + Number(t.amount);
                        if (t.type === 'expense') return sum - Number(t.amount);
                        return sum;
                    }, 0);
                    return { date, transactions: txs, total };
                });
        },

        getFilteredCategories() {
            return this.db.categories.filter(c => c.type === this.catFilter);
        },

        // ========== AKUN ==========
        saveAccount() {
            const name = (this.formAccount.name || '').trim();
            if (!name) {
                this.notify('Nama dompet harus diisi');
                return;
            }
            const initial = Number(this.formAccount.initial_balance) || 0;

            if (this.formAccount.id) {
                const idx = this.db.accounts.findIndex(a => a.id === this.formAccount.id);
                if (idx !== -1) {
                    // Yang bisa diubah hanya nama dan saldo awal; saldo sekarang ikut terhitung otomatis
                    this.db.accounts[idx] = { ...this.db.accounts[idx], name, initial_balance: initial };
                }
            } else {
                this.db.accounts.push({
                    id: genId('acc'),
                    name,
                    initial_balance: initial
                });
            }
            this.persist();
            this.closeModal('modal-add-account');
        },

        editAccount(acc) {
            if (!acc) return;
            this.formAccount = { id: acc.id, name: acc.name, initial_balance: acc.initial_balance };
            this.openModal('modal-add-account');
        },

        async deleteAccount(id, skipConfirm = false) {
            if (!id) return;
            const count = this.getAccountTxCount(id);
            const msg = count
                ? `Dompet ini punya ${count} transaksi. Transaksinya tetap tersimpan, tetapi tanpa dompet. Hapus dompet?`
                : 'Hapus dompet ini?';
            if (skipConfirm || await this.askConfirm({ title: 'Hapus dompet?', message: msg, confirmText: 'Hapus', danger: true })) {
                this.db.accounts = this.db.accounts.filter(a => a.id !== id);
                // Jaga index dompet aktif supaya tidak melewati batas
                this.activeAccountIndex = Math.max(0, Math.min(this.activeAccountIndex, this.db.accounts.length - 1));
                this.persist();
            }
        },

        // ========== TRANSAKSI ==========
        saveTransaction() {
            // Bersihkan titik ribuan dari format string (mis. "1.500.000" menjadi 1500000)
            const rawAmount = typeof this.formTx.amount === 'string'
                ? this.formTx.amount.replace(/\./g, '')
                : this.formTx.amount;
            const amount = Number(rawAmount) || 0;

            const accIndex = this.db.accounts.findIndex(a => a.id === this.formTx.account_id);

            // Validasi di awal, sebelum ada data yang diubah
            if (!this.formTx.account_id || accIndex === -1) {
                this.notify('Pilih dompet terlebih dahulu');
                return;
            }
            if (amount <= 0) {
                this.notify('Nominal harus lebih dari 0');
                return;
            }

            if (this.formTx.id) {
                // === MODE EDIT ===
                const oldIdx = this.db.transactions.findIndex(t => t.id === this.formTx.id);
                if (oldIdx !== -1) {
                    this.db.transactions[oldIdx] = { ...this.formTx, amount };
                }
            } else {
                // === TAMBAH BARU === (id di akhir supaya tidak tertimpa formTx.id)
                this.db.transactions.push({ ...this.formTx, id: genId('tx'), amount });
            }

            this.persist();
            this.closeModal('modal-add-tx'); // closeModal sudah mereset form
        },

        editTransaction(tx) {
            if (!tx || tx.type === 'adjustment') return; // koreksi hanya bisa dihapus
            if (tx.debt_id) { this.notify('Transaksi ini dibuat otomatis dari catatan utang/piutang. Ubah lewat tab Utang.', 'info'); return; }
            if (tx.type === 'transfer') { this.editTransfer(tx); return; }
            this.formTx = { ...tx };
            this.openModal('modal-add-tx');
        },

        // skipConfirm = true dipakai bottom sheet (konfirmasinya sudah ada di sana)
        async deleteTransaction(id, skipConfirm = false) {
            if (!skipConfirm && !(await this.askConfirm({ title: 'Hapus transaksi?', message: 'Saldo dompet akan disesuaikan kembali.', confirmText: 'Hapus', danger: true }))) {
                return null;
            }
            const tx = this.db.transactions.find(t => t.id === id);
            if (!tx) return null;
            if (tx.debt_id) { this.notify('Transaksi ini dibuat otomatis dari catatan utang/piutang. Hapus atau batalkan lewat tab Utang.', 'info'); return null; }

            this.db.transactions = this.db.transactions.filter(t => t.id !== id);
            this.persist();
            return tx;
        },

        // ========== TAMPILAN TRANSAKSI (income / expense / adjustment) ==========
        txAmountText(tx) {
            const n = Number(tx?.amount) || 0;
            if (tx?.type === 'income') return '+ ' + this.formatRupiah(n);
            if (tx?.type === 'expense') return '- ' + this.formatRupiah(n);
            if (tx?.type === 'adjustment') return (n >= 0 ? '+ ' : '- ') + this.formatRupiah(Math.abs(n));
            return this.formatRupiah(n);
        },

        txAmountClass(tx) {
            if (tx?.debt_id) return 'text-blue-600';
            if (tx?.type === 'income') return 'text-emerald-600';
            if (tx?.type === 'adjustment') return 'text-neutral-600';
            if (tx?.type === 'transfer') return 'text-neutral-700';
            return 'text-neutral-900';
        },

        txIconClass(tx) {
            if (tx?.debt_id) return 'bg-blue-50 text-blue-600';
            if (tx?.type === 'income') return 'bg-emerald-50 text-emerald-600';
            if (tx?.type === 'adjustment') return 'bg-neutral-100 text-neutral-600';
            if (tx?.type === 'transfer') return 'bg-sky-50 text-sky-600';
            return 'bg-rose-50 text-rose-600';
        },

        txBarClass(tx) {
            if (tx?.debt_id) return 'bg-blue-500';
            if (tx?.type === 'income') return 'bg-emerald-500';
            if (tx?.type === 'adjustment') return 'bg-neutral-400';
            if (tx?.type === 'transfer') return 'bg-sky-400';
            return 'bg-rose-500';
        },

        txIcon(tx) {
            if (tx?.type === 'adjustment') return 'fa-scale-balanced';
            if (tx?.type === 'transfer') return 'fa-right-left';
            if (tx?.debt_id) return this.debtTxIcon(tx);
            return this.getCategoryIcon(tx?.category);
        },

        // Transfer: "Tunai → BCA". Lainnya: nama dompet.
        txWalletLabel(tx) {
            if (tx?.type === 'transfer') {
                return this.getAccountName(tx.account_id) + ' → ' + this.getAccountName(tx.to_account_id);
            }
            return this.getAccountName(tx?.account_id);
        },

        txSubtitle(tx) {
            if (tx?.type === 'transfer') return this.txWalletLabel(tx);
            return (tx?.category || '') + ' • ' + this.getAccountName(tx?.account_id);
        },

        // ========== SESUAIKAN SALDO ==========
        openAdjust(accId = null) {
            const acc = accId
                ? this.db.accounts.find(a => a.id === accId)
                : this.db.accounts[this.activeAccountIndex];
            if (!acc) return;
            this.formAdjust = { account_id: acc.id, actual: '', note: '' };
            this.modals['modal-adjust'] = true;
        },

        // Selisih = saldo sebenarnya - saldo di aplikasi (positif = saldo naik)
        getAdjustDiff() {
            const raw = this.formAdjust.actual;
            if (raw === '' || raw === null || raw === undefined) return 0;
            const actual = Number(raw);
            if (isNaN(actual)) return 0;
            return Math.round(actual - this.getAccountBalanceById(this.formAdjust.account_id));
        },

        adjustDiffLabel() {
            const d = this.getAdjustDiff();
            if (d === 0) return 'Belum ada selisih';
            return (d > 0 ? '+ ' : '- ') + this.formatRupiah(Math.abs(d));
        },

        saveAdjust() {
            const diff = this.getAdjustDiff();
            if (diff === 0) return;
            if (!this.db.accounts.some(a => a.id === this.formAdjust.account_id)) return;

            this.db.transactions.push({
                id: genId('tx'),
                account_id: this.formAdjust.account_id,
                type: 'adjustment',
                amount: diff, // bertanda: + saldo naik, - saldo turun
                category: 'Koreksi',
                description: (this.formAdjust.note || '').trim() || 'Koreksi saldo',
                date: localDateStr()
            });
            this.persist();
            this.closeModal('modal-adjust');
        },

        // ========== TAB DOMPET ==========
        getAccountTxCount(id) {
            return this.db.transactions.filter(t => t.account_id === id || t.to_account_id === id).length;
        },

        walletSheetAcc() {
            return this.db.accounts.find(a => a.id === this.walletSheetId) || null;
        },

        openWalletSheet(acc) {
            this.walletSheetId = acc.id;
            this.confirmDeleteWallet = false;
        },

        closeWalletSheet() {
            this.walletSheetId = null;
            this.confirmDeleteWallet = false;
        },

        walletSheetAction(kind) {
            const acc = this.walletSheetAcc();
            this.closeWalletSheet();
            if (!acc) return;
            if (kind === 'transfer') this.openTransfer(acc.id);
            else if (kind === 'adjust') this.openAdjust(acc.id);
            else if (kind === 'edit') this.editAccount(acc);
        },

        deleteWalletFromSheet() {
            const id = this.walletSheetId;
            this.closeWalletSheet();
            this.deleteAccount(id, true);
        },

        // ========== TRANSFER ANTAR DOMPET ==========
        openTransfer(fromId = null) {
            if (this.db.accounts.length < 2) {
                this.notify('Tambahkan minimal 2 dompet untuk transfer');
                return;
            }
            const from = fromId || this.db.accounts[this.activeAccountIndex]?.id || this.db.accounts[0].id;
            const to = this.db.accounts.find(a => a.id !== from)?.id || '';
            this.formTransfer = { id: null, from_id: from, to_id: to, amount: '', date: localDateStr(), note: '' };
            this.modals['modal-transfer'] = true;
        },

        editTransfer(tx) {
            this.formTransfer = {
                id: tx.id,
                from_id: tx.account_id,
                to_id: tx.to_account_id,
                amount: tx.amount,
                date: tx.date,
                note: tx.description === 'Transfer' ? '' : (tx.description || '')
            };
            this.modals['modal-transfer'] = true;
        },

        swapTransfer() {
            const f = this.formTransfer;
            [f.from_id, f.to_id] = [f.to_id, f.from_id];
        },

        // Kalau dompet asal diganti jadi sama dengan tujuan, tujuan dipindah ke dompet lain
        onTransferFromChange() {
            const f = this.formTransfer;
            if (f.to_id === f.from_id) {
                f.to_id = this.db.accounts.find(a => a.id !== f.from_id)?.id || '';
            }
        },

        getTransferAmount() {
            const n = Number(this.formTransfer.amount);
            return isNaN(n) ? 0 : Math.round(n);
        },

        // Saldo dompet asal yang tersedia. Saat edit, jumlah transfer lama dikembalikan dulu.
        getTransferAvailable() {
            const f = this.formTransfer;
            let available = this.getAccountBalanceById(f.from_id);
            if (f.id) {
                const orig = this.db.transactions.find(t => t.id === f.id);
                if (orig && orig.account_id === f.from_id) available += Number(orig.amount) || 0;
            }
            return available;
        },

        // Kekurangan saldo (0 kalau cukup). Hanya peringatan, transfer tetap boleh disimpan.
        transferShortfall() {
            const amount = this.getTransferAmount();
            if (amount <= 0) return 0;
            return Math.max(0, amount - this.getTransferAvailable());
        },

        canSaveTransfer() {
            const f = this.formTransfer;
            return this.db.accounts.some(a => a.id === f.from_id)
                && this.db.accounts.some(a => a.id === f.to_id)
                && f.from_id !== f.to_id
                && this.getTransferAmount() > 0;
        },

        saveTransfer() {
            const f = this.formTransfer;
            const amount = this.getTransferAmount();

            if (!this.db.accounts.some(a => a.id === f.from_id) || !this.db.accounts.some(a => a.id === f.to_id)) {
                this.notify('Pilih dompet asal dan tujuan');
                return;
            }
            if (f.from_id === f.to_id) {
                this.notify('Dompet asal dan tujuan tidak boleh sama');
                return;
            }
            if (amount <= 0) {
                this.notify('Jumlah transfer harus lebih dari 0');
                return;
            }

            const data = {
                type: 'transfer',
                account_id: f.from_id,
                to_account_id: f.to_id,
                amount,
                category: 'Transfer',
                description: (f.note || '').trim() || 'Transfer',
                date: f.date || localDateStr()
            };

            if (f.id) {
                const idx = this.db.transactions.findIndex(t => t.id === f.id);
                if (idx !== -1) this.db.transactions[idx] = { ...this.db.transactions[idx], ...data };
            } else {
                this.db.transactions.push({ id: genId('tx'), ...data });
            }

            this.persist();
            this.closeModal('modal-transfer');
        },

        // ========== BOTTOM SHEET DETAIL & URUNGKAN ==========
        openDetail(tx) {
            this.detailTx = tx;
            this.confirmDelete = false;
        },

        closeDetail() {
            this.detailTx = null;
            this.confirmDelete = false;
        },

        editFromDetail() {
            const tx = this.detailTx;
            this.closeDetail();
            this.editTransaction(tx);
        },

        async deleteFromDetail() {
            const removed = await this.deleteTransaction(this.detailTx.id, true);
            this.closeDetail();
            if (!removed) return;
            this.undoTx = { ...removed };
            clearTimeout(this.undoTimer);
            this.undoTimer = setTimeout(() => { this.undoTx = null; }, 5000);
        },

        undoDelete() {
            const tx = this.undoTx;
            if (!tx) return;
            this.db.transactions.push(tx);
            this.persist();
            this.undoTx = null;
            clearTimeout(this.undoTimer);
        },

        showReceipt(tx) {
            this.selectedReceipt = tx;
            this.openModal('modal-receipt');
        },

        // ========== UTANG PIUTANG ==========
        // Setiap utang/piutang & cicilan otomatis tercatat sebagai transaksi (saldo dompet ikut berubah).
        // Kategori utang/piutang tidak masuk daftar kategori (seperti transfer): hanya label di transaksi.
        debtTxIcon(tx) {
            return ({
                'Utang': 'fa-hand-holding-dollar',
                'Terima Piutang': 'fa-coins',
                'Piutang': 'fa-handshake',
                'Bayar Utang': 'fa-money-bill-transfer'
            })[tx?.category] || 'fa-handshake';
        },

        getDebtTotals() {
            const t = { utang: 0, piutang: 0, utangCount: 0, piutangCount: 0 };
            this.db.debts_receivables.forEach(d => {
                if (d.status === 'paid') return;
                t[d.type] += Number(d.remaining) || 0;
                t[d.type + 'Count']++;
            });
            return t;
        },

        getDebtCounts() {
            const list = this.db.debts_receivables;
            return {
                all: list.length,
                utang: list.filter(d => d.type === 'utang' && d.status !== 'paid').length,
                piutang: list.filter(d => d.type === 'piutang' && d.status !== 'paid').length,
                paid: list.filter(d => d.status === 'paid').length
            };
        },

        getFilteredDebts() {
            const f = this.debtFilter;
            const list = this.db.debts_receivables.filter(d => {
                if (f === 'paid') return d.status === 'paid';
                if (f === 'utang' || f === 'piutang') return d.type === f && d.status !== 'paid';
                return true;
            });
            // Belum lunas dulu (yang jatuh tempo paling dekat di atas), lalu yang sudah lunas
            return list.slice().sort((a, b) => {
                if ((a.status === 'paid') !== (b.status === 'paid')) return a.status === 'paid' ? 1 : -1;
                if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
                if (a.due_date) return -1;
                if (b.due_date) return 1;
                return (b.created_at || '').localeCompare(a.created_at || '');
            });
        },

        debtPct(d) {
            if (!d || !(Number(d.amount) > 0)) return 0;
            return Math.round(((d.amount - d.remaining) / d.amount) * 100);
        },

        debtSubtitle(d) {
            const n = (d.payments || []).length;
            return (d.type === 'utang' ? 'Utang' : 'Piutang') + (n ? ' • ' + n + ' cicilan' : ' • belum dicicil');
        },

        dueInfo(d) {
            if (!d || d.status === 'paid' || !d.due_date) return null;
            const today = new Date(localDateStr() + 'T00:00:00');
            const due = new Date(d.due_date + 'T00:00:00');
            const days = Math.round((due - today) / 86400000);
            if (isNaN(days)) return null;
            if (days < 0) return { tone: 'bad', text: 'Terlambat ' + (-days) + ' hari' };
            if (days === 0) return { tone: 'warn', text: 'Jatuh tempo hari ini' };
            if (days <= 7) return { tone: 'warn', text: 'Jatuh tempo ' + days + ' hari lagi' };
            return { tone: 'info', text: 'Jatuh tempo ' + this.formatDateShort(d.due_date) };
        },

        debtSheetItem() {
            return this.db.debts_receivables.find(d => d.id === this.debtSheetId) || null;
        },
        openDebtSheet(d) { this.debtSheetId = d.id; this.confirmDeleteDebt = false; },
        closeDebtSheet() { this.debtSheetId = null; this.confirmDeleteDebt = false; },

        openAddDebt(type = 'utang') {
            this.formDebt = {
                id: null, type, person: '', amount: '',
                account_id: this.db.accounts[0]?.id || '',
                date: localDateStr(), due_date: '', note: '',
                record: this.db.accounts.length > 0
            };
            this.openModal('modal-add-debt');
        },

        saveDebt() {
            const f = this.formDebt;
            const person = (f.person || '').trim();
            const amount = Math.round(Number(f.amount) || 0);
            if (!person) { this.notify('Isi nama orangnya dulu'); return; }
            if (amount <= 0) { this.notify('Nominal harus lebih dari 0'); return; }
            if (f.record && !this.db.accounts.some(a => a.id === f.account_id)) { this.notify('Pilih dompet terlebih dahulu'); return; }

            const isUtang = f.type === 'utang';
            const debt = {
                id: genId('debt'), type: f.type, person, amount, remaining: amount, status: 'unpaid',
                account_id: f.record ? f.account_id : null,
                date: f.date || localDateStr(), due_date: f.due_date || '', note: (f.note || '').trim(),
                tx_id: null, payments: [], created_at: new Date().toISOString()
            };

            if (f.record) {
                const tx = {
                    id: genId('tx'), debt_id: debt.id, account_id: f.account_id,
                    type: isUtang ? 'income' : 'expense', amount,
                    category: isUtang ? 'Utang' : 'Piutang',
                    description: (isUtang ? 'Pinjam dari ' : 'Pinjamkan ke ') + person,
                    date: debt.date
                };
                this.db.transactions.push(tx);
                debt.tx_id = tx.id;
            }

            this.db.debts_receivables.push(debt);
            this.persist();
            this.closeModal('modal-add-debt');
        },

        // ----- Cicilan -----
        payDebtItem() {
            return this.db.debts_receivables.find(d => d.id === this.payDebtId) || null;
        },

        openDebtPay(d, full = false) {
            if (!d || d.status === 'paid') return;
            if (!this.db.accounts.length) { this.notify('Buat dompet dulu di tab Dompet.'); return; }
            const acc = this.db.accounts.some(a => a.id === d.account_id) ? d.account_id : this.db.accounts[0].id;
            this.payDebtId = d.id;
            this.formDebtPay = { amount: full ? String(d.remaining) : '', account_id: acc, date: localDateStr(), note: '' };
            this.closeDebtSheet();
            this.openModal('modal-debt-pay');
        },

        debtPayShortfall() {
            const d = this.payDebtItem();
            if (!d || d.type !== 'utang') return 0; // hanya bayar utang yang mengeluarkan uang dari dompet
            const amount = Number(this.formDebtPay.amount) || 0;
            const acc = this.db.accounts.find(a => a.id === this.formDebtPay.account_id);
            if (!acc || amount <= 0) return 0;
            return Math.max(0, amount - this.getAccountBalance(acc));
        },

        saveDebtPayment() {
            const d = this.payDebtItem();
            const f = this.formDebtPay;
            if (!d) return;
            const amount = Math.round(Number(f.amount) || 0);
            if (!this.db.accounts.some(a => a.id === f.account_id)) { this.notify('Pilih dompet terlebih dahulu'); return; }
            if (amount <= 0) { this.notify('Nominal harus lebih dari 0'); return; }
            if (amount > d.remaining) { this.notify('Nominal melebihi sisa (' + this.formatRupiah(d.remaining) + ')'); return; }

            const isUtang = d.type === 'utang';
            const lunas = amount === d.remaining;
            const note = (f.note || '').trim();
            const label = lunas ? 'Pelunasan' : 'Cicilan ke-' + (d.payments.length + 1);
            const tx = {
                id: genId('tx'), debt_id: d.id, account_id: f.account_id,
                type: isUtang ? 'expense' : 'income', amount,
                category: isUtang ? 'Bayar Utang' : 'Terima Piutang',
                description: label + (isUtang ? ' utang ke ' : ' piutang dari ') + d.person + (note ? ' - ' + note : ''),
                date: f.date || localDateStr()
            };
            this.db.transactions.push(tx);
            d.payments.push({ id: genId('pay'), amount, date: tx.date, account_id: f.account_id, tx_id: tx.id, note });
            d.remaining -= amount;
            if (d.remaining <= 0) { d.remaining = 0; d.status = 'paid'; }

            this.persist();
            this.closeModal('modal-debt-pay');
            this.debtSheetId = d.id; // kembali ke detail supaya riwayat cicilan langsung terlihat
        },

        async removeDebtPayment(d, pay) {
            if (!d || !pay) return;
            if (!(await this.askConfirm({ title: 'Batalkan cicilan?', message: 'Cicilan ' + this.formatRupiah(pay.amount) + ' akan dibatalkan dan saldo dompet dikembalikan.', confirmText: 'Batalkan cicilan', cancelText: 'Kembali', danger: true }))) return;
            this.db.transactions = this.db.transactions.filter(t => t.id !== pay.tx_id);
            d.payments = d.payments.filter(p => p.id !== pay.id);
            d.remaining = Math.min(d.amount, d.remaining + pay.amount);
            d.status = d.remaining > 0 ? 'unpaid' : 'paid';
            this.persist();
        },

        // withTx = true: transaksi terkait ikut dihapus (saldo dompet kembali seperti sebelum dicatat)
        deleteDebt(id, withTx = true) {
            if (withTx) this.db.transactions = this.db.transactions.filter(t => t.debt_id !== id);
            else this.db.transactions.forEach(t => { if (t.debt_id === id) delete t.debt_id; });
            this.db.debts_receivables = this.db.debts_receivables.filter(d => d.id !== id);
            this.closeDebtSheet();
            this.persist();
        },

        // ========== KATEGORI ==========
        // Transaksi menyimpan kategori sebagai NAMA, jadi jumlah pemakaian dihitung dari nama + jenis.
        getCategoryTxCount(cat) {
            return this.db.transactions.filter(t => !t.debt_id && t.category === cat.name && t.type === cat.type).length;
        },

        getCategoryTypeCount(type) {
            return this.db.categories.filter(c => c.type === type).length;
        },

        // Form baru memakai jenis dari tab yang sedang dibuka
        openAddCategory() {
            this.formCategory = { id: null, name: '', type: this.catFilter, icon: '', budget: '' };
            this.formCategory.icon = this.categoryIcons()[0];
            this.openModal('modal-add-category');
        },

        // Ikon yang ditawarkan mengikuti jenis kategori. Saat edit, ikon lama tetap ditampilkan
        // walau di luar daftar, supaya pilihan user tidak hilang.
        categoryIcons() {
            const base = this.formCategory.type === 'income' ? this.iconsIncome : this.iconsExpense;
            const cur = this.formCategory.icon;
            return (this.formCategory.id && cur && !base.includes(cur)) ? [cur, ...base] : base;
        },

        // Ganti jenis saat membuat kategori baru: ikon ikut diganti kalau tidak cocok dengan jenis baru
        setCategoryType(type) {
            if (this.formCategory.id) return;
            this.formCategory.type = type;
            const list = type === 'income' ? this.iconsIncome : this.iconsExpense;
            if (!list.includes(this.formCategory.icon)) this.formCategory.icon = list[0];
        },

        catSheetCat() {
            return this.db.categories.find(c => c.id === this.catSheetId) || null;
        },

        openCatSheet(cat) {
            this.catSheetId = cat.id;
            this.confirmDeleteCat = false;
        },

        closeCatSheet() {
            this.catSheetId = null;
            this.confirmDeleteCat = false;
        },

        editCatFromSheet() {
            const cat = this.catSheetCat();
            this.closeCatSheet();
            if (!cat) return;
            this.formCategory = { ...cat, budget: cat.budget ? String(cat.budget) : '' };
            this.openModal('modal-add-category');
        },

        deleteCatFromSheet() {
            const id = this.catSheetId;
            this.closeCatSheet();
            this.deleteCategory(id);
        },

        saveCategory() {
            const name = (this.formCategory.name || '').trim();
            if (!name) {
                this.notify('Nama kategori harus diisi');
                return;
            }

            // Anggaran bulanan hanya untuk kategori pengeluaran
            const budget = this.formCategory.type === 'expense' ? Math.max(0, Math.round(Number(this.formCategory.budget) || 0)) : 0;

            const editing = !!this.formCategory.id;
            const old = editing ? this.db.categories.find(c => c.id === this.formCategory.id) : null;
            if (editing && !old) return;
            // Jenis tidak bisa diubah saat edit, karena transaksi lama sudah memakai jenis itu
            const type = editing ? old.type : this.formCategory.type;

            const duplicate = this.db.categories.some(c =>
                c.id !== this.formCategory.id && c.type === type && c.name.trim().toLowerCase() === name.toLowerCase());
            if (duplicate) {
                this.notify('Kategori dengan nama itu sudah ada');
                return;
            }

            if (editing) {
                // Ganti nama: transaksi lama ikut diperbarui supaya tidak kehilangan kategorinya
                if (old.name !== name) {
                    this.db.transactions.forEach(t => {
                        if (!t.debt_id && t.category === old.name && t.type === old.type) t.category = name;
                    });
                }
                Object.assign(old, { name, icon: this.formCategory.icon });
                if (budget > 0) old.budget = budget; else delete old.budget;
            } else {
                const cat = { id: genId('cat'), name, type, icon: this.formCategory.icon };
                if (budget > 0) cat.budget = budget;
                this.db.categories.push(cat);
                this.catFilter = type; // langsung tampil di tab yang sesuai
            }

            this.persist();
            this.closeModal('modal-add-category');
        },

        deleteCategory(id) {
            this.db.categories = this.db.categories.filter(c => c.id !== id);
            this.persist();
        },


        // ========== IMPORT & EKSPOR ==========
        setDataMsg(type, text) {
            this.dataMsg = { type, text };
        },

        getExportTransactions() {
            const list = this.dataForm.period === 'all'
                ? [...this.db.transactions]
                : this.getFilteredMonthTransactions();
            return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        },

        exportPeriodLabel() {
            return this.dataForm.period === 'all' ? 'Semua waktu' : this.getCurrentMonthLabel();
        },

        buildWaText(maxRows) {
            const txs = this.getExportTransactions();
            let income = 0, expense = 0;
            txs.forEach(t => {
                if (t.debt_id) return;
                if (t.type === 'income') income += Number(t.amount) || 0;
                else if (t.type === 'expense') expense += Number(t.amount) || 0;
            });

            const lines = [];
            lines.push('*Laporan Keuangan Finku*');
            lines.push('Periode: ' + this.exportPeriodLabel());
            lines.push('');
            lines.push('Pemasukan: ' + this.formatRupiah(income));
            lines.push('Pengeluaran: ' + this.formatRupiah(expense));
            lines.push('Selisih: ' + this.formatRupiah(income - expense));
            lines.push('');
            lines.push('*Saldo Dompet*');
            this.db.accounts.forEach(a => lines.push('- ' + a.name + ': ' + this.formatRupiah(this.getAccountBalance(a))));
            lines.push('Total: ' + this.formatRupiah(this.getTotalBalance()));

            if (txs.length) {
                lines.push('');
                lines.push('*Transaksi (' + txs.length + ')*');
                txs.slice(0, maxRows).forEach(t => {
                    const sign = t.debt_id ? '~' : (t.type === 'income' ? '+' : (t.type === 'expense' ? '-' : '~'));
                    lines.push(this.formatDateShort(t.date) + ' | ' + (t.category || '-') + ' | ' + sign + this.formatRupiah(t.amount)
                        + (t.description ? ' (' + t.description + ')' : ''));
                });
                if (txs.length > maxRows) lines.push('...dan ' + (txs.length - maxRows) + ' transaksi lainnya');
            }
            return lines.join('\n');
        },

        sendToWhatsApp() {
            // Tanpa nomor: WhatsApp meminta user memilih kontak
            let rows = 30, text = this.buildWaText(rows), url;
            do {
                url = 'https://wa.me/?text=' + encodeURIComponent(text);
                if (url.length <= 6000 || rows <= 0) break;
                rows -= 5;
                text = this.buildWaText(Math.max(rows, 0));
            } while (true);
            window.open(url, '_blank', 'noopener');
            this.setDataMsg('ok', 'WhatsApp dibuka. Pilih kontak lalu tekan kirim.');
        },

        downloadBlob(content, filename, mime) {
            const blob = new Blob([content], { type: mime });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },

        csvCell(v) {
            let s = String(v ?? '');
            // Cegah formula injection saat dibuka di Excel/Sheets
            if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
            return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        },

        buildCsv() {
            const header = ['tanggal', 'tipe', 'jumlah', 'kategori', 'keterangan', 'dompet', 'dompet_tujuan'];
            const rows = this.getExportTransactions().map(t => [
                t.date, t.type, t.amount, t.category, t.description,
                this.getAccountName(t.account_id),
                t.type === 'transfer' ? this.getAccountName(t.to_account_id) : ''
            ]);
            return '\ufeff' + [header, ...rows].map(r => r.map(c => this.csvCell(c)).join(',')).join('\r\n');
        },

        exportFileName(ext) {
            return 'finku-' + localStorageSafeDate() + '.' + ext;
        },

        // Kirim file lewat menu bagikan HP (pilih WhatsApp lalu pilih kontak)
        async shareFile(kind) {
            const isJson = kind === 'json';
            const content = isJson ? JSON.stringify(this.db, null, 2) : this.buildCsv();
            const name = this.exportFileName(isJson ? 'json' : 'csv');
            const mime = isJson ? 'application/json' : 'text/csv';
            const file = new File([content], name, { type: isJson ? 'text/plain' : mime });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], title: 'Data Finku' });
                    this.setDataMsg('ok', 'Pilih WhatsApp lalu pilih kontak tujuan.');
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }
            this.downloadBlob(content, name, mime);
            this.setDataMsg('ok', 'Browser ini belum bisa membagikan file langsung, jadi file diunduh. Kirim manual lewat WhatsApp.');
        },

        // Satu klik: file (CSV / backup) langsung terlampir di menu bagikan HP.
        // User memilih aplikasi (WhatsApp, dll) lalu kontak tujuan.
        async sendFileToWhatsApp(kind) {
            const isJson = kind === 'json';
            const content = isJson ? JSON.stringify(this.db, null, 2) : this.buildCsv();
            // Chrome HP hanya mengizinkan share file berekstensi tertentu (.csv, .txt, dll), .json ditolak.
            // Maka backup dibagikan sebagai .txt (isi tetap JSON, bisa di-import kembali).
            const name = isJson ? this.exportFileName('txt').replace('finku-', 'finku-backup-') : this.exportFileName('csv');
            const file = new File([content], name, { type: isJson ? 'text/plain' : 'text/csv' });
            const title = isJson ? 'Backup Finku' : 'Data Finku';

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], title, text: title + ' (' + name + ')' });
                    if (isJson) this.markBackupDone();
                    this.setDataMsg('ok', 'Berhasil dibagikan.');
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }

            // Cadangan: unduh file lalu buka WhatsApp
            this.downloadBlob(content, name, isJson ? 'text/plain' : 'text/csv');
            if (isJson) this.markBackupDone();
            const waUrl = 'https://wa.me/?text=' + encodeURIComponent(title + ' (' + name + ')');
            if (!window.open(waUrl, '_blank')) window.location.href = waUrl;
            this.setDataMsg('ok', 'File diunduh dan WhatsApp dibuka. Tekan ikon klip lalu pilih file ' + name + ' dari Unduhan.');
        },

        // ----- Backup sebagai teks (tanpa file) -----
        bytesToB64(bytes) {
            let s = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return btoa(s);
        },

        async encodeBackup() {
            let bytes = new TextEncoder().encode(JSON.stringify(this.db));
            let prefix = 'FINKU0:';
            if (typeof CompressionStream !== 'undefined') {
                const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
                bytes = new Uint8Array(await new Response(stream).arrayBuffer());
                prefix = 'FINKU1:';
            }
            return prefix + this.bytesToB64(bytes);
        },

        async decodeBackup(text) {
            text = String(text || '').trim();
            if (text.startsWith('{')) return text; // JSON mentah
            const m = text.match(/FINKU([01]):([A-Za-z0-9+/=]+)/);
            if (!m) throw new Error('Kode backup tidak dikenali. Salin seluruh pesan backup dari WhatsApp.');
            let bytes;
            try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); }
            catch (e) { throw new Error('Kode backup rusak atau terpotong. Salin ulang seluruh pesannya.'); }
            if (m[1] === '1') {
                if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum mendukung kode backup terkompres. Gunakan file backup.');
                try {
                    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
                    return await new Response(stream).text();
                } catch (e) { throw new Error('Kode backup rusak atau terpotong. Salin ulang seluruh pesannya.'); }
            }
            return new TextDecoder().decode(bytes);
        },

        async shareBackupText() {
            try {
                const code = await this.encodeBackup();
                if (code.length > 60000) {
                    this.setDataMsg('error', 'Data terlalu besar untuk dikirim sebagai teks. Gunakan tombol Backup Data (file).');
                    return;
                }
                if (navigator.share) {
                    try {
                        await navigator.share({ text: code });
                        this.markBackupDone();
                        this.setDataMsg('ok', 'Berhasil dibagikan. Untuk memulihkan: salin pesan itu lalu tekan "Tempel dari clipboard".');
                        return;
                    } catch (e) {
                        if (e && e.name === 'AbortError') return;
                    }
                }
                // Cadangan: salin ke clipboard lalu buka WhatsApp, user tinggal tempel
                await navigator.clipboard.writeText(code);
                this.markBackupDone();
                const waUrl = 'https://wa.me/';
                if (!window.open(waUrl, '_blank')) window.location.href = waUrl;
                this.setDataMsg('ok', 'Kode backup disalin. Di WhatsApp pilih kontak lalu tempel (paste) dan kirim.');
            } catch (e) {
                this.setDataMsg('error', 'Gagal membuat kode backup.');
            }
        },

        async importFromText(text) {
            try {
                const json = await this.decodeBackup(text);
                await this.importJson(json);
                this.dataForm.importText = '';
            } catch (e) {
                this.setDataMsg('error', e.message || 'Gagal mengimpor kode backup.');
            }
        },

        async importFromClipboard() {
            let text = '';
            try { text = await navigator.clipboard.readText(); }
            catch (e) {
                this.setDataMsg('error', 'Browser tidak mengizinkan membaca clipboard. Tempel kode di kolom di bawah.');
                return;
            }
            if (!text.trim()) {
                this.setDataMsg('error', 'Clipboard kosong. Salin dulu pesan backup dari WhatsApp.');
                return;
            }
            await this.importFromText(text);
        },

        downloadFile(kind) {
            const isJson = kind === 'json';
            this.downloadBlob(isJson ? JSON.stringify(this.db, null, 2) : this.buildCsv(),
                this.exportFileName(isJson ? 'json' : 'csv'), isJson ? 'application/json' : 'text/csv');
            if (isJson) this.markBackupDone();
            this.setDataMsg('ok', 'File berhasil diunduh.');
        },

        // ----- Import -----
        handleImportFile(event) {
            const file = event.target.files && event.target.files[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                this.setDataMsg('error', 'File terlalu besar (maksimal 5 MB).');
                return;
            }
            const reader = new FileReader();
            reader.onerror = () => this.setDataMsg('error', 'File tidak bisa dibaca.');
            reader.onload = async () => {
                const text = String(reader.result || '').replace(/^\ufeff/, '');
                try {
                    if (/\.(json|txt)$/i.test(file.name)) await this.importJson(text);
                    else if (/\.csv$/i.test(file.name)) this.importCsv(text);
                    else this.setDataMsg('error', 'Format harus .json, .txt (backup) atau .csv');
                } catch (e) {
                    this.setDataMsg('error', e.message || 'Gagal mengimpor file.');
                }
            };
            reader.readAsText(file);
        },

        async importJson(text) {
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error('File JSON rusak atau bukan backup Finku.'); }
            const keys = ['accounts', 'transactions', 'debts_receivables', 'categories', 'goals'];
            if (!data || typeof data !== 'object' || !keys.some(k => Array.isArray(data[k]))) {
                throw new Error('File ini bukan backup Finku.');
            }
            const incoming = {};
            keys.forEach(k => { incoming[k] = Array.isArray(data[k]) ? data[k].filter(x => x && typeof x === 'object') : []; });

            if (this.dataForm.importMode === 'replace') {
                if (!(await this.askConfirm({ title: 'Ganti semua data?', message: 'Semua data saat ini akan diganti dengan isi file. Sebaiknya backup dulu.', confirmText: 'Ganti semua', danger: true }))) return;
                this.db = incoming;
                this.normalizeData();
                this.persist();
                this.setDataMsg('ok', 'Data diganti: ' + incoming.transactions.length + ' transaksi, ' + incoming.accounts.length + ' dompet.');
                return;
            }

            let added = 0;
            keys.forEach(k => {
                const ids = new Set(this.db[k].map(x => x.id));
                incoming[k].forEach(item => {
                    if (item.id && ids.has(item.id)) return;
                    if (!item.id) item.id = genId(k.slice(0, 3));
                    this.db[k].push(item);
                    ids.add(item.id);
                    if (k === 'transactions') added++;
                });
            });
            this.normalizeData();
            this.persist();
            this.setDataMsg('ok', 'Berhasil digabung: ' + added + ' transaksi baru.');
        },

        parseCsv(text) {
            // Pemisah otomatis: koma atau titik koma (Excel Indonesia)
            const first = text.split(/\r?\n/)[0] || '';
            const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
            const rows = [];
            let row = [], cell = '', q = false;
            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                if (q) {
                    if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
                    else if (c === '"') q = false;
                    else cell += c;
                } else if (c === '"') q = true;
                else if (c === sep) { row.push(cell); cell = ''; }
                else if (c === '\n' || c === '\r') {
                    if (c === '\r' && text[i + 1] === '\n') i++;
                    row.push(cell); cell = '';
                    if (row.some(x => x.trim() !== '')) rows.push(row);
                    row = [];
                } else cell += c;
            }
            row.push(cell);
            if (row.some(x => x.trim() !== '')) rows.push(row);
            return rows;
        },

        importCsv(text) {
            const rows = this.parseCsv(text);
            if (rows.length < 2) throw new Error('CSV kosong.');
            const head = rows[0].map(h => h.trim().toLowerCase());
            const col = (...names) => head.findIndex(h => names.includes(h));
            const iDate = col('tanggal', 'date'), iType = col('tipe', 'type'), iAmt = col('jumlah', 'amount', 'nominal');
            const iCat = col('kategori', 'category'), iDesc = col('keterangan', 'description', 'deskripsi');
            const iAcc = col('dompet', 'account'), iTo = col('dompet_tujuan', 'to_account');
            if (iDate < 0 || iType < 0 || iAmt < 0) {
                throw new Error('Kolom wajib: tanggal, tipe, jumlah. Opsional: kategori, keterangan, dompet, dompet_tujuan.');
            }

            const typeMap = { income: 'income', pemasukan: 'income', masuk: 'income', expense: 'expense', pengeluaran: 'expense', keluar: 'expense', transfer: 'transfer' };
            const findOrCreateAccount = (name) => {
                name = (name || '').trim() || 'Dompet Impor';
                let acc = this.db.accounts.find(a => a.name.toLowerCase() === name.toLowerCase());
                if (!acc) {
                    acc = { id: genId('acc'), name, initial_balance: 0 };
                    this.db.accounts.push(acc);
                }
                return acc;
            };

            let ok = 0, skipped = 0;
            rows.slice(1).forEach(r => {
                const type = typeMap[(r[iType] || '').trim().toLowerCase()];
                const date = (r[iDate] || '').trim();
                const amount = Number(String(r[iAmt] || '').replace(/[^\d.-]/g, '')) || 0;
                if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(date) || amount <= 0) { skipped++; return; }

                const acc = findOrCreateAccount(iAcc >= 0 ? r[iAcc] : '');
                const tx = {
                    id: genId('tx'), account_id: acc.id, type, amount, date,
                    category: ((iCat >= 0 ? r[iCat] : '') || '').trim() || (type === 'transfer' ? 'Transfer' : 'Lainnya'),
                    description: ((iDesc >= 0 ? r[iDesc] : '') || '').trim()
                };
                if (type === 'transfer') {
                    const to = findOrCreateAccount(iTo >= 0 ? r[iTo] : '');
                    if (to.id === acc.id) { skipped++; return; }
                    tx.to_account_id = to.id;
                } else if (!this.db.categories.some(c => c.name.toLowerCase() === tx.category.toLowerCase() && c.type === type)) {
                    this.db.categories.push({ id: genId('cat'), name: tx.category, type, icon: type === 'income' ? 'fa-money-bill-wave' : 'fa-wallet' });
                }
                this.db.transactions.push(tx);
                ok++;
            });

            if (!ok) throw new Error('Tidak ada baris valid. Format tanggal harus YYYY-MM-DD dan tipe income/expense/transfer.');
            this.persist();
            this.setDataMsg('ok', ok + ' transaksi diimpor' + (skipped ? ', ' + skipped + ' baris dilewati.' : '.'));
        },

        // ========== RIWAYAT: DIAGRAM KATEGORI & PERBANDINGAN BULAN ==========
        monthKeyOf(date) {
            return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
        },

        // Warna irisan menurut urutan (6 warna berbeda). Kategori yang digabung sebagai "Lainnya" berwarna abu-abu.
        // Palet gelap lebih terang agar tetap terbaca di latar gelap.
        categoryPalette() {
            return this.darkOn
                ? ['#f08ca3', '#fbbf24', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6']
                : ['#800020', '#d97706', '#0d9488', '#2563eb', '#7c3aed', '#db2777'];
        },

        // Selisih angka dibanding bulan lalu, lengkap dengan nada (baik/buruk bergantung jenisnya:
        // pengeluaran naik = buruk, pemasukan/selisih naik = baik)
        deltaInfo(kind, cur, prev) {
            if (!prev && !cur) return { text: '—', tone: 'neutral' };
            if (!prev) return { text: 'Baru', tone: 'neutral' };
            const diff = cur - prev;
            if (diff === 0) return { text: 'Tetap', tone: 'neutral' };
            const up = diff > 0;
            const pct = Math.round((Math.abs(diff) / Math.abs(prev)) * 100);
            if (pct === 0) return { text: 'Tetap', tone: 'neutral' }; // selisih terlalu kecil untuk disebut naik/turun
            const good = kind === 'expense' ? !up : up;
            return { text: (up ? '▲ ' : '▼ ') + pct + '%', tone: good ? 'good' : 'bad' };
        },

        // Pengeluaran / pemasukan per kategori untuk bulan yang dilihat, dibandingkan dengan bulan sebelumnya.
        // Utang/piutang tidak dihitung (perpindahan uang, bukan penghasilan atau belanja).
        getCategoryBreakdown(type) {
            type = type || this.catChartType;
            const cur = this.monthKeyOf(this.currentDate);
            const prev = this.monthKeyOf(new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1));
            const sums = {}, prevSums = {};
            let total = 0, prevTotal = 0;
            this.db.transactions.forEach(t => {
                if (t.type !== type || t.debt_id || !t.date) return;
                const name = (t.category || '').trim() || 'Tanpa kategori';
                const amt = Number(t.amount) || 0;
                if (t.date.startsWith(cur)) { sums[name] = (sums[name] || 0) + amt; total += amt; }
                else if (t.date.startsWith(prev)) { prevSums[name] = (prevSums[name] || 0) + amt; prevTotal += amt; }
            });

            const rows = Object.keys(sums)
                .map(name => ({ name, amount: sums[name], prevAmount: prevSums[name] || 0 }))
                .sort((a, b) => b.amount - a.amount);

            const palette = this.categoryPalette();
            const gray = '#9ca3af';
            const merge = rows.length > 6; // lebih dari 6: donat menampilkan 5 teratas + "Lainnya"
            const pctOf = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

            // Daftar lengkap: semua kategori, urut dari terbesar. Yang digabung di donat berwarna abu-abu.
            const items = rows.map((r, i) => {
                const cat = this.db.categories.find(c => c.name === r.name && c.type === type);
                return {
                    ...r,
                    pct: pctOf(r.amount),
                    color: merge && i >= 5 ? gray : palette[i],
                    icon: cat && cat.icon ? cat.icon : 'fa-tag',
                    delta: this.deltaInfo(type, r.amount, r.prevAmount)
                };
            });

            // Irisan donat
            let slices = items;
            if (merge) {
                const rest = items.slice(5);
                const amount = rest.reduce((s, r) => s + r.amount, 0), prevAmount = rest.reduce((s, r) => s + r.prevAmount, 0);
                slices = items.slice(0, 5).concat([{
                    name: 'Lainnya', other: true, count: rest.length, amount, prevAmount,
                    pct: pctOf(amount), color: gray, icon: 'fa-ellipsis', delta: this.deltaInfo(type, amount, prevAmount)
                }]);
            }
            return { type, total, prevTotal, items, slices, delta: this.deltaInfo(type, total, prevTotal) };
        },

        catChartAria() {
            const b = this.getCategoryBreakdown();
            if (!b.items.length) return 'Belum ada data kategori bulan ini';
            return 'Diagram donat ' + (b.type === 'income' ? 'pemasukan' : 'pengeluaran') + ' per kategori: ' +
                b.slices.map(i => i.name + ' ' + i.pct + ' persen').join(', ');
        },

        // Satu kartu, dua tampilan: grafik garis (arus kas harian) atau donat (per kategori). Pilihan diingat.
        setHistoryView(view) {
            if (view !== 'line' && view !== 'donut') return;
            if (this.settings.historyView === view) return;
            this.settings.historyView = view;
            this.saveSettings();
            this.resetCatSlider();
            this.refreshHistoryCharts(); // hanya tampilan aktif yang digambar
        },

        setCatChartType(type) {
            if (type !== 'expense' && type !== 'income') return;
            this.catChartType = type;
            this.resetCatSlider();
            this.initCategoryChart();
        },

        // Menyaring daftar riwayat di bawah ke satu kategori (dipakai tombol "Lihat di daftar riwayat")
        filterByCategory(item) {
            if (!item || item.other) return;
            this.historyFilter = this.catChartType;
            this.categoryFilter = item.name;
            this.searchQuery = '';
            this.historyPage = 1;
            this.$nextTick && this.$nextTick(() => {
                const el = document.getElementById('history-list');
                if (!el) return;
                const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            });
        },

        // ----- Daftar kategori sebagai slide (geser ke samping) -----
        getCategorySlides() {
            const items = this.getCategoryBreakdown().items;
            const SIZE = 3;
            const slides = [];
            for (let i = 0; i < items.length; i += SIZE) slides.push(items.slice(i, i + SIZE));
            return slides;
        },

        onCatSlideScroll(e) {
            const el = e && e.target;
            if (!el || !el.clientWidth) return;
            const idx = Math.round(el.scrollLeft / el.clientWidth);
            if (idx !== this.catSlide) this.catSlide = idx;
        },

        goCatSlide(i) {
            const el = document.getElementById('catSlider');
            const max = Math.max(0, this.getCategorySlides().length - 1);
            const target = Math.min(Math.max(0, i), max);
            this.catSlide = target;
            if (!el) return;
            const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            el.scrollTo({ left: target * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
        },

        // Data atau bulan berubah: kembali ke slide pertama
        resetCatSlider() {
            this.catSlide = 0;
            this.$nextTick && this.$nextTick(() => {
                const el = document.getElementById('catSlider');
                if (el) el.scrollLeft = 0;
            });
        },

        // ----- Rincian transaksi satu kategori (bulan yang dilihat) -----
        openCategorySheet(item) {
            if (!item || item.other) return;
            this.catSheet = { name: item.name, type: this.catChartType };
            this.catSheetLimit = 30;
        },

        closeCategorySheet() {
            this.catSheet = null;
        },

        showMoreCategoryTx() {
            this.catSheetLimit += 30;
        },

        filterFromCategorySheet() {
            const s = this.catSheet;
            if (!s) return;
            this.closeCategorySheet();
            this.filterByCategory({ name: s.name });
        },

        getCategorySheet() {
            const s = this.catSheet;
            if (!s) return null;
            const cur = this.monthKeyOf(this.currentDate);
            const prev = this.monthKeyOf(new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1));
            const rows = [];
            let total = 0, prevTotal = 0;
            this.db.transactions.forEach((t, idx) => {
                if (t.type !== s.type || t.debt_id || !t.date) return;
                if (((t.category || '').trim() || 'Tanpa kategori') !== s.name) return;
                const amt = Number(t.amount) || 0;
                if (t.date.startsWith(cur)) { rows.push({ t, idx }); total += amt; }
                else if (t.date.startsWith(prev)) prevTotal += amt;
            });
            // Terbaru dulu; pada tanggal yang sama, yang dicatat paling akhir di atas (sama seperti daftar riwayat)
            rows.sort((a, b) => b.t.date.localeCompare(a.t.date) || b.idx - a.idx);
            const cat = this.db.categories.find(c => c.name === s.name && c.type === s.type);
            return {
                name: s.name, type: s.type,
                icon: cat && cat.icon ? cat.icon : 'fa-tag',
                count: rows.length, total, prevTotal,
                delta: this.deltaInfo(s.type, total, prevTotal),
                txs: rows.slice(0, this.catSheetLimit).map(r => r.t),
                hasMore: rows.length > this.catSheetLimit
            };
        },

        clearCategoryFilter() {
            this.categoryFilter = '';
            this.historyPage = 1;
        },

        refreshHistoryCharts() {
            this.initHistoryChart();
            this.initCategoryChart();
        },

        initCategoryChart() {
            this.$nextTick(() => {
                const canvas = document.getElementById('categoryChart');
                if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
                if (this.settings.historyView !== 'donut') return;
                if (!canvas || typeof Chart === 'undefined') return;

                const b = this.getCategoryBreakdown();
                if (!b.items.length) return;

                const dark = this.darkOn;
                const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
                const fmt = (n) => this.formatRupiah(n);
                const totalLabel = this.formatRupiahShort(b.total);

                // Teks total di tengah lubang donat
                const centerText = {
                    id: 'centerText',
                    afterDraw(chart) {
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return;
                        const cx = (chartArea.left + chartArea.right) / 2, cy = (chartArea.top + chartArea.bottom) / 2;
                        ctx.save();
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = dark ? '#a99da2' : '#737373';
                        ctx.font = '600 11px system-ui, sans-serif';
                        ctx.fillText('Total', cx, cy - 11);
                        ctx.fillStyle = dark ? '#f6eff1' : '#171717';
                        ctx.font = '800 17px system-ui, sans-serif';
                        ctx.fillText(totalLabel, cx, cy + 9);
                        ctx.restore();
                    }
                };

                categoryChart = new Chart(canvas.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: b.slices.map(i => i.name),
                        datasets: [{
                            data: b.slices.map(i => i.amount),
                            backgroundColor: b.slices.map(i => i.color),
                            borderColor: dark ? '#1f1a1d' : '#ffffff',
                            borderWidth: 2,
                            hoverOffset: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '68%',
                        animation: reduce ? false : { duration: 600 },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (c) => ' ' + c.label + ': ' + fmt(c.parsed) + ' (' + (b.total ? Math.round((c.parsed / b.total) * 100) : 0) + '%)'
                                }
                            }
                        }
                    },
                    plugins: [centerText]
                });
            });
        },

        // ========== RIWAYAT: PAGINATION ==========
        historyTotalCount() {
            return this.getAllGroupedTransactions().reduce((n, g) => n + g.transactions.length, 0);
        },

        historyTotalPages() {
            return Math.max(1, Math.ceil(this.historyTotalCount() / this.settings.historyPageSize));
        },

        // Halaman aktif yang sudah dipastikan valid (mis. setelah transaksi terakhir di halaman terakhir dihapus)
        historyCurrentPage() {
            return Math.min(Math.max(1, Number(this.historyPage) || 1), this.historyTotalPages());
        },

        // Grup hari untuk halaman aktif. Total harian tetap total SELURUH hari itu, walau transaksinya terbagi dua halaman.
        getGroupedTransactions() {
            const all = this.getAllGroupedTransactions();
            const size = this.settings.historyPageSize;
            const total = all.reduce((n, g) => n + g.transactions.length, 0);
            const page = Math.min(Math.max(1, Number(this.historyPage) || 1), Math.max(1, Math.ceil(total / size)));
            const start = (page - 1) * size, end = start + size;

            const out = [];
            let idx = 0;
            all.forEach(g => {
                const gs = idx, ge = idx + g.transactions.length;
                idx = ge;
                if (ge <= start || gs >= end) return;
                const from = Math.max(start, gs) - gs, to = Math.min(end, ge) - gs;
                out.push({ ...g, transactions: g.transactions.slice(from, to), partial: (to - from) < g.transactions.length });
            });
            return out;
        },

        // "21–40 dari 87"
        historyRangeText() {
            const total = this.historyTotalCount();
            if (!total) return '';
            const size = this.settings.historyPageSize, page = this.historyCurrentPage();
            return (page - 1) * size + 1 + '–' + Math.min(page * size, total) + ' dari ' + total;
        },

        // Tombol nomor halaman ringkas: 1 … 4 5 6 … 20
        historyPageItems() {
            const total = this.historyTotalPages(), cur = this.historyCurrentPage();
            if (total <= 5) return Array.from({ length: total }, (_, i) => ({ k: 'p' + (i + 1), page: i + 1, label: String(i + 1) }));
            const pages = new Set([1, total, cur - 1, cur, cur + 1]);
            if (cur <= 2) { pages.add(2); pages.add(3); }
            if (cur >= total - 1) { pages.add(total - 1); pages.add(total - 2); }
            const sorted = Array.from(pages).filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
            const items = [];
            sorted.forEach((p, i) => {
                if (i > 0 && p - sorted[i - 1] > 1) items.push({ k: 'gap' + p, page: null, label: '…' });
                items.push({ k: 'p' + p, page: p, label: String(p) });
            });
            return items;
        },

        goHistoryPage(n) {
            const target = Math.min(Math.max(1, Number(n) || 1), this.historyTotalPages());
            if (target === this.historyCurrentPage()) return;
            this.historyPage = target;
            // Kembali ke awal daftar supaya pembaca tidak berada di tengah halaman baru
            this.$nextTick && this.$nextTick(() => {
                const el = document.getElementById('history-list');
                if (!el) return;
                const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            });
        },

        // ========== PENGAMAN DATA ==========
        async requestPersistentStorage() {
            try {
                if (navigator.storage && navigator.storage.persisted) {
                    this.storagePersisted = await navigator.storage.persisted();
                    if (!this.storagePersisted && navigator.storage.persist) {
                        this.storagePersisted = await navigator.storage.persist();
                    }
                }
            } catch (e) {}
        },

        markBackupDone() {
            this.lastBackupAt = new Date().toISOString();
            this.backupSnoozeUntil = 0;
            try {
                localStorage.setItem('finku_last_backup', this.lastBackupAt);
                localStorage.removeItem('finku_backup_snooze');
            } catch (e) {}
        },

        daysSinceBackup() {
            if (!this.lastBackupAt) return null;
            const t = new Date(this.lastBackupAt).getTime();
            return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
        },

        backupStatusText() {
            const d = this.daysSinceBackup();
            if (d === null) return 'Belum pernah backup';
            if (d === 0) return 'Hari ini';
            return d + ' hari lalu';
        },

        // Sudah waktunya backup menurut batas yang dipilih di Pengaturan
        backupDue() {
            const d = this.daysSinceBackup();
            return d === null || d >= this.settings.backupIntervalDays;
        },

        needsBackupReminder() {
            if (!this.settings.backupReminder) return false;
            if (this.db.transactions.length < 5) return false; // data masih sedikit, belum perlu
            if (Date.now() < this.backupSnoozeUntil) return false;
            return this.backupDue();
        },

        snoozeBackup() {
            this.backupSnoozeUntil = Date.now() + 86400000; // ingatkan lagi besok
            try { localStorage.setItem('finku_backup_snooze', String(this.backupSnoozeUntil)); } catch (e) {}
        },

        // ========== ANGGARAN PER KATEGORI ==========
        getBudgetSpent(catName, monthKey) {
            const mk = monthKey || localDateStr().slice(0, 7);
            return this.db.transactions
                .filter(t => t.type === 'expense' && !t.debt_id && t.category === catName && t.date && t.date.startsWith(mk))
                .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        },

        getBudgetInfo(cat, monthKey) {
            const limit = Number(cat?.budget) || 0;
            const spent = limit > 0 ? this.getBudgetSpent(cat.name, monthKey) : 0;
            const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
            const over = spent > limit && limit > 0;
            return {
                cat, limit, spent, pct, over,
                remaining: Math.max(0, limit - spent),
                level: over ? 'over' : (pct >= 80 ? 'warn' : 'ok')
            };
        },

        getBudgetCategories() {
            return this.db.categories
                .filter(c => c.type === 'expense' && Number(c.budget) > 0)
                .map(c => this.getBudgetInfo(c))
                .sort((a, b) => b.pct - a.pct);
        },

        // Petunjuk anggaran langsung di form transaksi: user tahu dampaknya sebelum menyimpan
        txBudgetHint() {
            const f = this.formTx;
            if (f.type !== 'expense' || !f.category) return null;
            const cat = this.db.categories.find(c => c.type === 'expense' && c.name === f.category);
            if (!cat || !(Number(cat.budget) > 0)) return null;

            const amount = Number(String(f.amount ?? '').replace(/\./g, '')) || 0;
            const mk = (f.date || localDateStr()).slice(0, 7);
            let spent = this.getBudgetSpent(cat.name, mk);
            if (f.id) { // saat edit, transaksi ini sudah ikut terhitung
                const old = this.db.transactions.find(t => t.id === f.id);
                if (old && old.type === 'expense' && !old.debt_id && old.category === cat.name && (old.date || '').startsWith(mk)) {
                    spent -= Number(old.amount) || 0;
                }
            }
            const limit = Number(cat.budget);
            const after = spent + amount;
            const fmt = (n) => this.formatRupiah(Math.round(n));

            if (after > limit) {
                return { level: 'over', text: 'Melebihi anggaran ' + cat.name + ' sebesar ' + fmt(after - limit) + ' (anggaran ' + fmt(limit) + ').' };
            }
            const level = after >= limit * 0.8 ? 'warn' : 'ok';
            return {
                level,
                text: (amount > 0 ? 'Sisa anggaran ' + cat.name + ' setelah ini: ' : 'Sisa anggaran ' + cat.name + ' bulan ini: ') + fmt(limit - after)
            };
        },

        // ========== TARGET TABUNGAN ==========
        // Setoran bersifat penanda dana (tidak mengubah saldo dompet): uang tetap di dompetmu,
        // Finku mencatat berapa yang sudah kamu sisihkan untuk tiap target.
        getGoalSaved(g) {
            return (g?.contributions || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
        },
        goalPct(g) {
            if (!g || !(g.target > 0)) return 0;
            return Math.max(0, Math.min(100, Math.round((this.getGoalSaved(g) / g.target) * 100)));
        },
        goalRemaining(g) { return Math.max(0, (g?.target || 0) - this.getGoalSaved(g)); },
        goalDone(g) { return !!g && g.target > 0 && this.getGoalSaved(g) >= g.target; },
        getTotalGoalSaved() { return this.db.goals.reduce((s, g) => s + this.getGoalSaved(g), 0); },

        goalSheetItem() { return this.db.goals.find(g => g.id === this.goalSheetId) || null; },
        openGoalSheet(g) { this.goalSheetId = g.id; this.confirmDeleteGoal = false; },
        closeGoalSheet() { this.goalSheetId = null; this.confirmDeleteGoal = false; },
        depositGoalItem() { return this.db.goals.find(g => g.id === this.depositGoalId) || null; },

        // Rata-rata sisa (pemasukan - pengeluaran) dari maksimal 3 bulan terakhir yang sudah selesai
        avgMonthlySurplus() {
            const now = new Date();
            const vals = [];
            for (let k = 1; k <= 3; k++) {
                const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
                const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                let inc = 0, exp = 0, any = false;
                this.db.transactions.forEach(t => {
                    if (t.debt_id || !t.date || !t.date.startsWith(key)) return;
                    if (t.type === 'income') { inc += Number(t.amount) || 0; any = true; }
                    else if (t.type === 'expense') { exp += Number(t.amount) || 0; any = true; }
                });
                if (any) vals.push(inc - exp);
            }
            if (!vals.length) return null;
            return { value: vals.reduce((a, b) => a + b, 0) / vals.length, months: vals.length };
        },

        goalEstimate(g) {
            if (!g) return [];
            const fmt = (n) => this.formatRupiah(Math.round(n));
            if (this.goalDone(g)) return [{ tone: 'good', text: 'Target tercapai. Selamat!' }];

            const out = [];
            const rem = this.goalRemaining(g);
            const today = new Date(localDateStr() + 'T00:00:00');
            let deadlineDate = null;

            if (g.deadline) {
                deadlineDate = new Date(g.deadline + 'T00:00:00');
                const days = Math.round((deadlineDate - today) / 86400000);
                if (days < 0) {
                    out.push({ tone: 'bad', text: 'Tenggat sudah lewat ' + (-days) + ' hari. Sisa ' + fmt(rem) + '.' });
                } else {
                    const months = Math.max(1, Math.ceil(days / 30.44));
                    out.push({ tone: 'info', text: 'Agar tepat waktu, sisihkan ' + fmt(rem / months) + ' per bulan (' + months + ' bulan lagi).' });
                }
            }

            const s = this.avgMonthlySurplus();
            if (!s) {
                out.push({ tone: 'info', text: 'Belum cukup data transaksi bulan-bulan sebelumnya untuk membuat perkiraan.' });
            } else if (s.value <= 0) {
                out.push({ tone: 'warn', text: 'Rata-rata sisa bulananmu belum positif, jadi target sulit tercapai. Kurangi pengeluaran dulu.' });
            } else {
                const need = Math.ceil(rem / s.value);
                if (need > 600) {
                    out.push({ tone: 'warn', text: 'Dengan rata-rata sisa ' + fmt(s.value) + ' per bulan, target ini masih sangat lama tercapai.' });
                } else {
                    const eta = new Date(today.getFullYear(), today.getMonth() + need, 1);
                    const label = eta.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                    let tone = 'info', extra = '';
                    if (deadlineDate && eta > deadlineDate) { tone = 'warn'; extra = ' Itu melewati tenggat.'; }
                    out.push({ tone, text: 'Dengan rata-rata sisa ' + fmt(s.value) + ' per bulan, perkiraan tercapai sekitar ' + label + ' (' + need + ' bulan).' + extra });
                }
            }
            return out;
        },

        openAddGoal(g = null) {
            this.formGoal = g
                ? { id: g.id, name: g.name, target: String(g.target), deadline: g.deadline || '', saved: '' }
                : { id: null, name: '', target: '', deadline: '', saved: '' };
            if (g) this.closeGoalSheet();
            this.openModal('modal-add-goal');
        },

        saveGoal() {
            const f = this.formGoal;
            const name = (f.name || '').trim();
            const target = Math.round(Number(f.target) || 0);
            if (!name) { this.notify('Isi nama targetnya dulu'); return; }
            if (target <= 0) { this.notify('Nominal target harus lebih dari 0'); return; }

            if (f.id) {
                const g = this.db.goals.find(x => x.id === f.id);
                if (!g) return;
                Object.assign(g, { name, target, deadline: f.deadline || '' });
            } else {
                const g = { id: genId('goal'), name, target, deadline: f.deadline || '', created_at: new Date().toISOString(), contributions: [] };
                const saved = Math.round(Number(f.saved) || 0);
                if (saved > 0) g.contributions.push({ id: genId('gc'), amount: saved, date: localDateStr(), note: 'Dana awal' });
                this.db.goals.push(g);
            }
            this.persist();
            this.closeModal('modal-add-goal');
        },

        openGoalDeposit(g, mode = 'deposit') {
            if (!g) return;
            this.depositGoalId = g.id;
            this.formGoalDeposit = { mode, amount: '', date: localDateStr(), note: '' };
            this.closeGoalSheet();
            this.openModal('modal-goal-deposit');
        },

        saveGoalDeposit() {
            const g = this.depositGoalItem();
            const f = this.formGoalDeposit;
            if (!g) return;
            const amount = Math.round(Number(f.amount) || 0);
            if (amount <= 0) { this.notify('Nominal harus lebih dari 0'); return; }
            const saved = this.getGoalSaved(g);
            if (f.mode === 'withdraw' && amount > saved) { this.notify('Penarikan melebihi dana terkumpul (' + this.formatRupiah(saved) + ')'); return; }

            g.contributions.push({
                id: genId('gc'), amount: f.mode === 'withdraw' ? -amount : amount,
                date: f.date || localDateStr(), note: (f.note || '').trim()
            });
            this.persist();
            this.closeModal('modal-goal-deposit');
            this.goalSheetId = g.id; // kembali ke detail supaya riwayat langsung terlihat
        },

        async removeGoalContribution(g, c) {
            if (!g || !c) return;
            if (this.getGoalSaved(g) - (Number(c.amount) || 0) < 0) {
                this.notify('Tidak bisa dibatalkan karena dana terkumpul jadi minus. Batalkan penarikan terkait dulu.');
                return;
            }
            if (!(await this.askConfirm({ title: 'Batalkan catatan?', message: 'Catatan ' + this.formatRupiah(Math.abs(c.amount)) + ' akan dihapus dari riwayat target.', confirmText: 'Batalkan catatan', cancelText: 'Kembali', danger: true }))) return;
            g.contributions = g.contributions.filter(x => x.id !== c.id);
            this.persist();
        },

        deleteGoal(id) {
            this.db.goals = this.db.goals.filter(g => g.id !== id);
            this.closeGoalSheet();
            this.persist();
        },

        // ========== CATAT DENGAN SUARA ==========
        // Memakai Web Speech API milik browser (SpeechRecognition). Audio diproses oleh layanan pengenalan suara
        // browser (mis. Google di Chrome), bukan oleh Finku. Hasilnya SELALU ditampilkan untuk dicek sebelum disimpan.
        voiceSupported() {
            return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        },

        voiceErrorText(code) {
            return ({
                'no-speech': 'Tidak ada suara yang terdengar. Coba lagi dan bicara lebih dekat ke mikrofon.',
                'audio-capture': 'Mikrofon tidak ditemukan. Periksa apakah perangkatmu punya mikrofon yang aktif.',
                'not-allowed': 'Izin mikrofon ditolak. Aktifkan izin mikrofon untuk situs ini di pengaturan browser, lalu coba lagi.',
                'service-not-allowed': 'Browser tidak mengizinkan pengenalan suara di sini. Pastikan situs dibuka lewat HTTPS.',
                'network': 'Pengenalan suara butuh koneksi internet. Periksa jaringanmu lalu coba lagi.',
                'language-not-supported': 'Bahasa Indonesia belum didukung oleh pengenalan suara di perangkat ini.'
            })[code] || 'Pengenalan suara gagal. Coba lagi, atau ketik kalimatnya di bawah.';
        },

        openVoice() {
            this.abortVoice();
            const ok = this.voiceSupported();
            this.voice = { status: ok ? 'idle' : 'unsupported', transcript: '', interim: '', error: '', typed: '', draft: null };
            this.openModal('modal-voice');
            if (ok) this.startVoice(); // dipanggil dari ketukan pengguna, jadi izin mikrofon boleh diminta
        },

        startVoice() {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) { this.voice.status = 'unsupported'; return; }
            this.abortVoice();

            const rec = new SR();
            rec.lang = 'id-ID';
            rec.interimResults = true;
            rec.continuous = false;
            rec.maxAlternatives = 3;
            this._rec = rec;
            this._voiceAlts = [];
            this._voiceError = null;
            this.voice = { ...this.voice, status: 'listening', transcript: '', interim: '', error: '', draft: null };

            rec.onresult = (ev) => {
                let interim = '', finalAlts = null;
                for (let i = ev.resultIndex; i < ev.results.length; i++) {
                    const r = ev.results[i];
                    if (r.isFinal) finalAlts = Array.from(r).map(a => a.transcript);
                    else interim += r[0].transcript;
                }
                if (finalAlts) { this._voiceAlts = finalAlts; this.voice.transcript = finalAlts[0].trim(); this.voice.interim = ''; }
                else this.voice.interim = interim.trim();
            };
            rec.onerror = (ev) => { this._voiceError = ev && ev.error; };
            rec.onend = () => {
                if (this._rec !== rec) return; // sudah dibatalkan atau diganti sesi baru
                this._rec = null;
                clearTimeout(this._voiceTimer);
                const err = this._voiceError;
                this._voiceError = null;
                const alts = this._voiceAlts.length ? this._voiceAlts : (this.voice.interim ? [this.voice.interim] : []);
                if (err && err !== 'aborted' && !(err === 'no-speech' && alts.length)) {
                    this.voice = { ...this.voice, status: 'error', error: this.voiceErrorText(err) };
                } else if (!alts.length) {
                    this.voice = { ...this.voice, status: 'error', error: this.voiceErrorText('no-speech') };
                } else {
                    this.applyVoiceAlternatives(alts);
                }
            };

            try { rec.start(); }
            catch (e) { this._rec = null; this.voice = { ...this.voice, status: 'error', error: this.voiceErrorText('') }; return; }
            // Pengaman: berhenti sendiri setelah 15 detik
            this._voiceTimer = setTimeout(() => { if (this._rec === rec) { try { rec.stop(); } catch (e) {} } }, 15000);
        },

        stopVoice() {
            if (this._rec) { try { this._rec.stop(); } catch (e) {} } // onend akan memproses hasilnya
        },

        abortVoice() {
            const r = this._rec;
            this._rec = null; // onend sesi lama diabaikan
            clearTimeout(this._voiceTimer);
            if (r) { try { r.abort(); } catch (e) {} }
        },

        // Transaksi lama (keterangan + kategori) dipakai untuk belajar kebiasaan penamaan pengguna sendiri
        voiceHistory() {
            return this.db.transactions
                .filter(t => !t.debt_id && t.description && t.category && (t.type === 'income' || t.type === 'expense'))
                .slice(-600)
                .map(t => ({ description: t.description, category: t.category, type: t.type }));
        },

        parseVoiceText(text) {
            const defaultAcc = this.db.accounts[this.activeAccountIndex] || this.db.accounts[0];
            return VoiceParser.parse(text, {
                categories: this.db.categories,
                accounts: this.db.accounts,
                defaultAccountId: defaultAcc ? defaultAcc.id : '',
                history: this.voiceHistory(),
                now: new Date()
            });
        },

        // Pengenal suara memberi beberapa kemungkinan kalimat: pilih yang nominalnya berhasil terbaca
        applyVoiceAlternatives(alts) {
            const parsed = alts.map(t => ({ t, p: this.parseVoiceText(t) }));
            const chosen = parsed.find(x => x.p.amount > 0) || parsed[0];
            const p = chosen.p;
            this.voice = {
                ...this.voice, status: 'result', transcript: chosen.t.trim(), interim: '', error: '',
                draft: {
                    type: p.type, amount: p.amount ? String(p.amount) : '', category: p.category,
                    account_id: p.accountId, date: p.date, description: p.description,
                    found: p.found
                }
            };
        },

        parseTypedVoice() {
            const t = (this.voice.typed || '').trim();
            if (!t) { this.notify('Ketik kalimat transaksinya dulu, contoh: beli kopi 20 ribu'); return; }
            this.abortVoice();
            this.applyVoiceAlternatives([t]);
        },

        voiceCategories() {
            const type = this.voice.draft ? this.voice.draft.type : 'expense';
            return this.db.categories.filter(c => c.type === type);
        },

        setVoiceType(type) {
            const d = this.voice.draft;
            if (!d || d.type === type) return;
            d.type = type;
            const tokens = VoiceParser.tokenize(this.voice.transcript);
            d.category = VoiceParser.pickCategory(tokens, tokens.join(' '), this.voiceCategories(), this.voiceHistory());
        },

        saveVoiceDraft() {
            const d = this.voice.draft;
            if (!d) return;
            const amount = Math.round(Number(String(d.amount || '').replace(/\./g, '')) || 0);
            if (!this.db.accounts.length) { this.notify('Buat dompet dulu di tab Dompet.'); return; }
            if (amount <= 0) { this.notify('Nominal belum terisi. Isi jumlahnya dulu.'); return; }
            if (!d.category) { this.notify('Pilih kategorinya dulu.'); return; }

            const before = this.db.transactions.length;
            this.formTx = {
                id: null, account_id: d.account_id || this.db.accounts[0].id, type: d.type, amount: String(amount),
                category: d.category, description: (d.description || '').trim(), date: d.date || localDateStr()
            };
            this.saveTransaction(); // memakai validasi & penyimpanan yang sama dengan formulir biasa
            if (this.db.transactions.length > before) {
                this.closeModal('modal-voice');
                this.notify((d.type === 'income' ? 'Pemasukan ' : 'Pengeluaran ') + this.formatRupiah(amount) + ' tersimpan', 'success');
            }
        },

        // ========== PENGATURAN ==========
        loadSettings() {
            const s = { hideBalance: false, backupReminder: true, backupIntervalDays: 7, historyPageSize: 20, historyView: 'line' };
            try {
                const saved = JSON.parse(localStorage.getItem('finku_settings') || 'null');
                if (saved && typeof saved === 'object') {
                    if (typeof saved.hideBalance === 'boolean') s.hideBalance = saved.hideBalance;
                    if (typeof saved.backupReminder === 'boolean') s.backupReminder = saved.backupReminder;
                    if ([7, 14, 30].includes(Number(saved.backupIntervalDays))) s.backupIntervalDays = Number(saved.backupIntervalDays);
                    if ([10, 20, 50].includes(Number(saved.historyPageSize))) s.historyPageSize = Number(saved.historyPageSize);
                    if (saved.historyView === 'line' || saved.historyView === 'donut') s.historyView = saved.historyView;
                }
            } catch (e) {}
            this.settings = s;
            this.showSaldo = !s.hideBalance;
        },

        saveSettings() {
            try { localStorage.setItem('finku_settings', JSON.stringify(this.settings)); } catch (e) {}
        },

        onHideBalanceChange() {
            this.saveSettings();
            this.showSaldo = !this.settings.hideBalance; // langsung terlihat hasilnya
        },

        setHistoryPageSize(n) {
            if (![10, 20, 50].includes(n)) return;
            this.settings.historyPageSize = n;
            this.historyPage = 1;
            this.saveSettings();
        },

        setBackupInterval(days) {
            if (![7, 14, 30].includes(days)) return;
            this.settings.backupIntervalDays = days;
            this.saveSettings();
        },

        openSettings() {
            if (this.activeTab !== 'settings') this.settingsReturnTab = this.activeTab;
            this.activeTab = 'settings';
            window.scrollTo({ top: 0 });
        },

        closeSettings() {
            this.activeTab = this.settingsReturnTab && this.settingsReturnTab !== 'settings' ? this.settingsReturnTab : 'dashboard';
            window.scrollTo({ top: 0 });
        },

        formatBytes(n) {
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
            return (n / 1024 / 1024).toFixed(2).replace('.', ',') + ' MB';
        },

        dataStatRows() {
            let bytes = 0;
            try { bytes = new Blob([localStorage.getItem('finku_database_v1') || '']).size; } catch (e) {}
            return [
                { k: 'tx', label: 'Transaksi', value: String(this.db.transactions.length) },
                { k: 'acc', label: 'Dompet', value: String(this.db.accounts.length) },
                { k: 'cat', label: 'Kategori', value: String(this.db.categories.length) },
                { k: 'debt', label: 'Utang & piutang', value: String(this.db.debts_receivables.length) },
                { k: 'goal', label: 'Target tabungan', value: String(this.db.goals.length) },
                { k: 'size', label: 'Ukuran data', value: this.formatBytes(bytes) }
            ];
        },

        // Hapus semua data: dua langkah (peringatan + harus mengetik HAPUS), lalu mulai dari awal yang bersih
        async resetAllData() {
            const ok = await this.askConfirm({
                title: 'Hapus semua data?',
                message: 'Semua transaksi, dompet, utang, dan target di perangkat ini akan dihapus dan tidak bisa dikembalikan. Sebaiknya backup dulu.',
                confirmText: 'Hapus semua', cancelText: 'Batal', danger: true, requireText: 'HAPUS'
            });
            if (!ok) return;

            this.db = {
                accounts: [],
                transactions: [],
                debts_receivables: [],
                goals: [],
                categories: [
                    { id: genId('cat'), name: 'Makanan', type: 'expense', icon: 'fa-utensils' },
                    { id: genId('cat'), name: 'Belanja', type: 'expense', icon: 'fa-bag-shopping' },
                    { id: genId('cat'), name: 'Gaji', type: 'income', icon: 'fa-money-check-dollar' }
                ]
            };
            this.activeAccountIndex = 0;
            this.undoTx = null;
            this.detailTx = null;
            this.insight = { empty: true };
            Object.keys(this.modals).forEach(k => { this.modals[k] = false; });
            this.lastBackupAt = null;
            this.backupSnoozeUntil = 0;
            try { localStorage.removeItem('finku_last_backup'); localStorage.removeItem('finku_backup_snooze'); } catch (e) {}
            this.persist();
            this.activeTab = 'dashboard';
            window.scrollTo({ top: 0 });
            this.notify('Semua data sudah dihapus. Kamu bisa mulai dari awal.', 'success');
        },

        // ========== PEMBERITAHUAN & KONFIRMASI ==========
        // type: 'error' (validasi) | 'info' | 'success'
        notify(text, type = 'error') {
            this.toastMsg = { text, type };
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { this.toastMsg = { text: '', type }; }, type === 'error' ? 4500 : 3000);
        },

        dismissToast() {
            clearTimeout(this._toastTimer);
            this.toastMsg = { text: '', type: this.toastMsg.type };
        },

        // Dipakai dengan: if (!(await this.askConfirm({ ... }))) return;
        // requireText: pengguna harus mengetik kata itu dulu (untuk tindakan yang tidak bisa dibatalkan)
        askConfirm({ title = 'Yakin?', message = '', confirmText = 'Ya', cancelText = 'Batal', danger = false, requireText = '' } = {}) {
            // Jika masih ada dialog terbuka, anggap dibatalkan agar tidak ada janji yang menggantung
            if (this._confirmResolve) this._confirmResolve(false);
            this._confirmPrevFocus = document.activeElement; // kembalikan fokus ke tombol pemicu saat dialog ditutup
            this.confirmDlg = { open: true, title, message, confirmText, cancelText, danger, requireText, typed: '' };
            return new Promise(resolve => { this._confirmResolve = resolve; });
        },

        confirmReady() {
            const r = this.confirmDlg.requireText;
            return !r || this.confirmDlg.typed.trim().toUpperCase() === r.toUpperCase();
        },

        resolveConfirm(value) {
            if (!this.confirmDlg.open) return;
            if (value && !this.confirmReady()) return; // kata konfirmasi belum diketik
            this.confirmDlg = { ...this.confirmDlg, open: false };
            const r = this._confirmResolve;
            this._confirmResolve = null;
            if (r) r(!!value);
            const prev = this._confirmPrevFocus;
            this._confirmPrevFocus = null;
            if (prev && typeof prev.focus === 'function') { try { prev.focus(); } catch (e) {} }
        },

        // Fokus keyboard berputar di dalam dialog (Tab / Shift+Tab) dan tidak lari ke halaman di belakangnya
        trapConfirmTab(e) {
            const els = Array.from(e.currentTarget.querySelectorAll('button'));
            if (!els.length) return;
            const first = els[0], last = els[els.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        },

        // ========== TEMA TERANG / GELAP ==========
        initTheme() {
            try {
                const t = localStorage.getItem('finku_theme');
                if (t === 'light' || t === 'dark' || t === 'system') this.theme = t;
            } catch (e) {}
            this.applyTheme();

            // Mode "Otomatis": ikuti perubahan tema perangkat secara langsung
            const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
            if (mq) {
                const onChange = () => { if (this.theme === 'system') this.applyTheme(); };
                if (mq.addEventListener) mq.addEventListener('change', onChange);
                else if (mq.addListener) mq.addListener(onChange);
            }
        },

        applyTheme() {
            const sys = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
            const dark = this.theme === 'dark' || (this.theme === 'system' && sys);
            this.darkOn = dark;
            document.documentElement.classList.toggle('dark', dark);
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', dark ? '#121012' : '#800020');
            // Grafik memakai warna sendiri, gambar ulang agar ikut berganti
            if (this.activeTab === 'history') this.refreshHistoryCharts();
        },

        // Pilih tema langsung (bukan berputar), supaya semua pilihan terlihat dan satu ketukan cukup.
        // Animasi: lingkaran warna melebar dari titik ketukan (View Transitions) bila didukung browser,
        // jika tidak, perubahan warna dihaluskan dengan transisi CSS. Dilewati bila "kurangi gerakan" aktif.
        setTheme(mode, ev) {
            if (!['light', 'dark', 'system'].includes(mode) || mode === this.theme) return;
            this.theme = mode;
            try { localStorage.setItem('finku_theme', mode); } catch (e) {}

            const root = document.documentElement;
            const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

            if (!reduce && typeof document.startViewTransition === 'function') {
                const w = window.innerWidth || 400, h = window.innerHeight || 800;
                const x = ev && ev.clientX != null ? ev.clientX : w - 40;
                const y = ev && ev.clientY != null ? ev.clientY : 40;
                const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
                const transition = document.startViewTransition(() => { this.applyTheme(); });
                transition.ready.then(() => {
                    root.animate(
                        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
                        { duration: 520, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
                    );
                }).catch(() => {});
            } else if (!reduce) {
                root.classList.add('theme-anim');
                this.applyTheme();
                setTimeout(() => root.classList.remove('theme-anim'), 450);
            } else {
                this.applyTheme();
            }
            this.showThemeToast();
        },

        showThemeToast() {
            this.themeToast = ({ light: 'Mode terang', dark: 'Mode gelap', system: 'Mengikuti perangkat' })[this.theme] || '';
            clearTimeout(this._themeToastTimer);
            this._themeToastTimer = setTimeout(() => { this.themeToast = ''; }, 1600);
        },

        themeLabel() { return ({ light: 'Terang', dark: 'Gelap', system: 'Otomatis' })[this.theme] || 'Otomatis'; },
        themeIcon() { return ({ light: 'fa-sun', dark: 'fa-moon', system: 'fa-circle-half-stroke' })[this.theme] || 'fa-circle-half-stroke'; },

        // ========== SLIDER KUTIPAN ==========
        // Slide aktif = f(jam perangkat), jadi:
        // - pindah tab / section disembunyikan lalu dibuka lagi: slide tetap berlanjut, tidak mulai dari awal
        // - muat ulang halaman atau kembali dari background: tetap sinkron dengan jam
        // Bukan animasi CSS, karena animasi CSS selalu restart setiap elemen tampil kembali (display:none).
        startSlider() {
            if (this._sliderStarted) return;
            this._sliderStarted = true;

            const SLIDE_MS = 4000;
            const count = document.querySelectorAll('.slide-item').length || 1;
            const current = () => Math.floor(Date.now() / SLIDE_MS) % count;
            this.sliderIndex = current();

            // Pengguna yang meminta "kurangi gerakan": jangan berputar otomatis
            const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduce || count < 2) return;

            // Jadwalkan tepat di batas slide berikutnya (tidak melayang seperti setInterval)
            const schedule = () => {
                const wait = SLIDE_MS - (Date.now() % SLIDE_MS) + 30;
                setTimeout(() => { this.sliderIndex = current(); schedule(); }, wait);
            };
            schedule();

            // Timer ditahan browser saat tab di background: sinkronkan lagi begitu kembali
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.sliderIndex = current();
            });
        },

        // ========== ANALISIS & SARAN KEUANGAN (murni perhitungan, tanpa API) ==========
        openInsight() {
            this.insight = this.buildInsight();
            this.openModal('modal-insight');
        },

        buildInsight() {
            const fmt = (n) => this.formatRupiah(Math.round(n));
            const y = this.currentDate.getFullYear();
            const m = this.currentDate.getMonth();
            const key = (yy, mm) => yy + '-' + String(mm + 1).padStart(2, '0');
            const monthTx = (yy, mm) => this.db.transactions.filter(t => !t.debt_id && t.date && t.date.startsWith(key(yy, mm)));
            const sum = (list, type) => list.filter(t => t.type === type).reduce((s, t) => s + (Number(t.amount) || 0), 0);

            const cur = monthTx(y, m);
            const income = sum(cur, 'income');
            const expense = sum(cur, 'expense');
            const monthLabel = this.getCurrentMonthLabel();
            if (income === 0 && expense === 0) return { empty: true, monthLabel };

            const net = income - expense;
            const savingsRate = income > 0 ? (net / income) * 100 : null;

            const p1 = new Date(y, m - 1, 1), p2 = new Date(y, m - 2, 1);
            const prev1 = monthTx(p1.getFullYear(), p1.getMonth());
            const prevIncome = sum(prev1, 'income');
            const prevExpense = sum(prev1, 'expense');
            const prev2Expense = sum(monthTx(p2.getFullYear(), p2.getMonth()), 'expense');

            // Waktu: bulan berjalan diproyeksikan, bulan lalu dihitung penuh
            const now = new Date();
            const isCurrent = y === now.getFullYear() && m === now.getMonth();
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            const elapsed = isCurrent ? now.getDate() : daysInMonth;
            const daysLeft = isCurrent ? daysInMonth - elapsed : 0;
            const dailyAvg = elapsed > 0 ? expense / elapsed : 0;
            const projected = isCurrent ? dailyAvg * daysInMonth : expense;

            // Kategori pengeluaran
            const expenses = cur.filter(t => t.type === 'expense');
            const byCat = {};
            expenses.forEach(t => { const c = t.category || 'Lainnya'; byCat[c] = (byCat[c] || 0) + (Number(t.amount) || 0); });
            const cats = Object.entries(byCat)
                .map(([name, amount]) => ({ name, amount, pct: expense > 0 ? (amount / expense) * 100 : 0 }))
                .sort((a, b) => b.amount - a.amount);
            const topCat = cats[0] || null;

            // Pola hari
            const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            const byDay = [0, 0, 0, 0, 0, 0, 0];
            expenses.forEach(t => { const d = new Date(t.date.slice(0, 10) + 'T00:00:00'); if (!isNaN(d)) byDay[d.getDay()] += Number(t.amount) || 0; });
            const topDayIdx = byDay.indexOf(Math.max(...byDay));
            const biggest = expenses.reduce((b, t) => (!b || Number(t.amount) > Number(b.amount)) ? t : b, null);

            // Dana darurat: saldo dibanding rata-rata pengeluaran bulanan
            // Pakai bulan yang sudah selesai; proyeksi bulan berjalan tidak dipakai agar saran tidak membengkak
            const done = [prevExpense, prev2Expense].filter(v => v > 0);
            const basis = done.length ? done : (expense > 0 ? [expense] : []);
            const avgMonthly = basis.length ? basis.reduce((a, b) => a + b, 0) / basis.length : 0;
            const balance = Math.max(this.getTotalBalance(), 0);
            const runway = avgMonthly > 0 ? balance / avgMonthly : null;

            // Utang piutang
            const open = (type) => (this.db.debts_receivables || [])
                .filter(d => d.type === type && d.status !== 'paid')
                .reduce((s, d) => s + (Number(d.remaining ?? d.amount) || 0), 0);
            const utang = open('utang');
            const piutang = open('piutang');

            // ----- Skor 0-100 -----
            let score = 50;
            if (income > 0) {
                if (savingsRate >= 30) score += 30;
                else if (savingsRate >= 20) score += 24;
                else if (savingsRate >= 10) score += 14;
                else if (savingsRate >= 0) score += 6;
                else score -= savingsRate < -30 ? 25 : 15;
            } else score -= 20;
            if (prevExpense > 0) {
                const ch = ((expense - prevExpense) / prevExpense) * 100;
                if (!isCurrent || elapsed >= 10) {
                    const cmp = isCurrent ? ((projected - prevExpense) / prevExpense) * 100 : ch;
                    if (cmp > 20) score -= 8; else if (cmp < -10) score += 6;
                }
            }
            if (runway !== null) {
                if (runway >= 6) score += 12; else if (runway >= 3) score += 8; else if (runway >= 1) score += 2; else score -= 8;
            }
            if (utang === 0) score += 4; else if (utang > balance) score -= 10;
            score = Math.max(0, Math.min(100, Math.round(score)));

            let grade, color;
            if (score >= 80) { grade = 'Sangat sehat'; color = 'emerald'; }
            else if (score >= 65) { grade = 'Sehat'; color = 'emerald'; }
            else if (score >= 45) { grade = 'Cukup'; color = 'amber'; }
            else if (score >= 30) { grade = 'Perlu perhatian'; color = 'orange'; }
            else { grade = 'Rawan'; color = 'rose'; }

            // ----- Temuan -----
            const findings = [];
            const add = (tone, icon, title, text) => findings.push({ tone, icon, title, text });

            if (income === 0) {
                add('bad', 'fa-triangle-exclamation', 'Belum ada pemasukan tercatat', 'Pengeluaran ' + fmt(expense) + ' belum diimbangi pemasukan. Pastikan gaji atau pendapatan sudah dicatat.');
            } else if (net >= 0) {
                add('good', 'fa-circle-check', 'Arus kas positif', 'Kamu menyisihkan ' + fmt(net) + ' (' + Math.round(savingsRate) + '% dari pemasukan).');
            } else {
                add('bad', 'fa-circle-exclamation', 'Pengeluaran melebihi pemasukan', 'Defisit ' + fmt(-net) + '. Pengeluaran sudah ' + Math.round((expense / income) * 100) + '% dari pemasukan.');
            }

            if (isCurrent && expense > 0 && elapsed >= 7) {
                let t = 'Rata-rata pengeluaran ' + fmt(dailyAvg) + ' per hari. Dengan pola ini, total bulan ini sekitar ' + fmt(projected) + '.';
                let tone = 'info';
                if (income > 0 && projected > income) { tone = 'warn'; t += ' Itu melebihi pemasukan sekitar ' + fmt(projected - income) + '.'; }
                add(tone, 'fa-chart-line', 'Proyeksi akhir bulan', t);
                const left = income - expense;
                if (daysLeft > 0 && left > 0) {
                    add('info', 'fa-gauge-high', 'Batas aman harian', 'Sisa ' + daysLeft + ' hari. Agar tidak defisit, jaga pengeluaran maksimal ' + fmt(left / daysLeft) + ' per hari.');
                } else if (daysLeft > 0 && left <= 0 && income > 0) {
                    add('bad', 'fa-hand', 'Anggaran bulan ini habis', 'Pemasukan bulan ini sudah terpakai semua dan masih ada ' + daysLeft + ' hari. Tahan pengeluaran yang tidak mendesak.');
                }
            }

            if (prevExpense > 0 && expense > 0 && (!isCurrent || elapsed >= 10)) {
                const base = isCurrent ? projected : expense;
                const ch = ((base - prevExpense) / prevExpense) * 100;
                const label = isCurrent ? 'diperkirakan ' : '';
                if (ch >= 10) add('warn', 'fa-arrow-trend-up', 'Pengeluaran naik', 'Pengeluaran ' + label + 'naik ' + Math.round(ch) + '% dibanding bulan lalu (' + fmt(prevExpense) + ').');
                else if (ch <= -10) add('good', 'fa-arrow-trend-down', 'Pengeluaran turun', 'Pengeluaran ' + label + 'turun ' + Math.round(-ch) + '% dibanding bulan lalu. Pertahankan.');
                else add('info', 'fa-equals', 'Pengeluaran stabil', 'Hampir sama dengan bulan lalu (' + fmt(prevExpense) + ').');
            }

            if (topCat && expenses.length >= 3) {
                const heavy = topCat.pct >= 40;
                add(heavy ? 'warn' : 'info', 'fa-tags', 'Kategori terbesar: ' + topCat.name,
                    fmt(topCat.amount) + ' (' + Math.round(topCat.pct) + '% dari pengeluaran).' + (heavy ? ' Porsinya cukup dominan.' : ''));
            }

            // Anggaran per kategori (bulan yang sedang dilihat)
            const overB = [], nearB = [];
            this.db.categories.filter(c => c.type === 'expense' && Number(c.budget) > 0).forEach(c => {
                const spent = byCat[c.name] || 0;
                if (spent > c.budget) overB.push({ c, spent });
                else if (spent >= c.budget * 0.8) nearB.push({ c, spent });
            });
            overB.forEach(o => add('bad', 'fa-ban', 'Anggaran ' + o.c.name + ' terlampaui',
                'Terpakai ' + fmt(o.spent) + ' dari anggaran ' + fmt(o.c.budget) + ' (lebih ' + fmt(o.spent - o.c.budget) + ').'));
            nearB.forEach(o => add('warn', 'fa-gauge-high', 'Anggaran ' + o.c.name + ' hampir habis',
                'Sudah ' + Math.round((o.spent / o.c.budget) * 100) + '% terpakai, sisa ' + fmt(o.c.budget - o.spent) + '.'));

            if (biggest && expenses.length >= 4 && Number(biggest.amount) >= expense * 0.3) {
                add('info', 'fa-receipt', 'Satu pengeluaran besar', fmt(biggest.amount) + (biggest.description ? ' untuk "' + biggest.description + '"' : ' di ' + (biggest.category || 'Lainnya'))
                    + ' mencakup ' + Math.round((Number(biggest.amount) / expense) * 100) + '% pengeluaran bulan ini.');
            }

            if (expenses.length >= 8 && byDay[topDayIdx] > 0) {
                add('info', 'fa-calendar-day', 'Hari paling boros', 'Pengeluaran terbanyak terjadi pada hari ' + dayNames[topDayIdx] + ' (' + fmt(byDay[topDayIdx]) + ').');
            }

            if (runway !== null) {
                const r = runway.toFixed(1).replace('.', ',');
                if (runway < 1) add('bad', 'fa-life-ring', 'Dana darurat tipis', 'Saldo totalmu hanya cukup untuk sekitar ' + Math.max(1, Math.round(runway * 30)) + ' hari pengeluaran.');
                else if (runway < 3) add('warn', 'fa-life-ring', 'Dana darurat belum ideal', 'Saldo totalmu cukup untuk sekitar ' + r + ' bulan pengeluaran. Idealnya 3 sampai 6 bulan.');
                else add('good', 'fa-shield-halved', 'Dana darurat aman', 'Saldo totalmu cukup untuk sekitar ' + r + ' bulan pengeluaran.');
            }

            if (utang > 0) add(utang > balance ? 'bad' : 'warn', 'fa-hand-holding-dollar', 'Ada utang belum lunas', 'Sisa utang ' + fmt(utang) + (utang > balance ? ', lebih besar dari total saldo.' : '.'));
            if (piutang > 0) add('info', 'fa-user-clock', 'Ada piutang belum kembali', fmt(piutang) + ' masih ada di orang lain.');

            // ----- Saran -----
            const tips = [];
            if (overB.length) {
                tips.push('Tahan pengeluaran kategori ' + overB.map(o => o.c.name).join(', ') + ' sampai akhir bulan, atau naikkan anggarannya bila memang perlu.');
            }
            if (net < 0 && topCat) {
                tips.push('Mulai dari kategori ' + topCat.name + '. Memangkas 15% saja menghemat sekitar ' + fmt(topCat.amount * 0.15) + '.');
            }
            if (income > 0 && savingsRate !== null && savingsRate < 20) {
                tips.push('Targetkan menabung 20% dari pemasukan (' + fmt(income * 0.2) + '). Sisihkan di awal bulan, bukan dari sisa.');
            }
            if (runway !== null && runway < 3) {
                tips.push('Bangun dana darurat bertahap hingga minimal ' + fmt(avgMonthly * 3) + ' (3 bulan pengeluaran).');
            }
            if (utang > 0) {
                tips.push('Prioritaskan melunasi utang ' + fmt(utang) + ' lebih dulu, terutama yang berbunga.');
            }
            if (piutang > 0) {
                tips.push('Tagih piutang ' + fmt(piutang) + ' untuk menambah kas.');
            }
            if (topCat && topCat.pct >= 40 && net >= 0) {
                tips.push('Pengeluaran bertumpu di ' + topCat.name + '. Tetapkan batas bulanan agar tidak melebar.');
            }
            if (net >= 0 && savingsRate !== null && savingsRate >= 20) {
                tips.push('Kondisi bagus. Alihkan sebagian surplus ke tabungan atau investasi supaya tidak habis tanpa terasa.');
            }
            if (!tips.length) tips.push('Terus catat setiap transaksi agar analisis makin akurat.');

            return {
                empty: false, monthLabel, score, grade, color,
                income, expense, net, savingsRate: savingsRate === null ? null : Math.round(savingsRate),
                cats: cats.slice(0, 4).map(c => ({ ...c, pct: Math.round(c.pct) })),
                findings: findings.slice(0, 8), tips: tips.slice(0, 4)
            };
        },

        // ========== GRAFIK RIWAYAT ==========
        initHistoryChart() {
            this.$nextTick(() => {
                if (this.settings.historyView !== 'line') {
                    if (historyChart) { historyChart.destroy(); historyChart = null; }
                    return;
                }
                const canvas = document.getElementById('historyChart');
                if (!canvas) return;
                const ctx = canvas.getContext('2d');

                // Hancurkan chart lama supaya tidak numpuk
                if (historyChart) {
                    historyChart.destroy();
                    historyChart = null;
                }

                const txs = this.getFilteredMonthTransactions();
                const year = this.currentDate.getFullYear();
                const month = this.currentDate.getMonth();
                const daysInMonth = new Date(year, month + 1, 0).getDate();

                const labels = [];
                const incomeData = [];
                const expenseData = [];

                for (let i = 1; i <= daysInMonth; i++) {
                    const fullDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                    labels.push(i);

                    incomeData.push(txs
                        .filter(t => !t.debt_id && t.date === fullDate && t.type === 'income')
                        .reduce((sum, t) => sum + Number(t.amount), 0));

                    expenseData.push(txs
                        .filter(t => !t.debt_id && t.date === fullDate && t.type === 'expense')
                        .reduce((sum, t) => sum + Number(t.amount), 0));
                }

                const dark = this.darkOn;
                const tickColor = dark ? '#a99da2' : '#6b7280';
                const gridColor = dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

                historyChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Masuk',
                                data: incomeData,
                                borderColor: dark ? '#10b981' : '#059669',   // emerald, sama dengan legenda
                                backgroundColor: dark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(5, 150, 105, 0.1)',
                                tension: 0.3,
                                fill: true,
                                pointRadius: 3,
                                pointHoverRadius: 6,
                                pointHitRadius: 20
                            },
                            {
                                label: 'Keluar',
                                data: expenseData,
                                borderColor: '#f43f5e',            // rose-500, sama dengan legenda
                                backgroundColor: 'rgba(244, 63, 94, 0.1)',
                                tension: 0.3,
                                fill: true,
                                pointRadius: 3,
                                pointHoverRadius: 6,
                                pointHitRadius: 20
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false
                        },
                        plugins: {
                            legend: { display: false }, // legenda sudah ada di HTML
                            tooltip: {
                                padding: 10,
                                titleFont: { size: 12 },
                                bodyFont: { size: 12 },
                                callbacks: {
                                    title: (items) => 'Tanggal ' + items[0].label,
                                    label: (c) => c.dataset.label + ': ' + this.formatRupiah(c.parsed.y)
                                }
                            }
                        },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { font: { size: 10 }, maxRotation: 0, color: tickColor },
                                offset: true
                            },
                            y: {
                                beginAtZero: true,
                                grid: { color: gridColor },
                                ticks: {
                                    font: { size: 10 },
                                    color: tickColor,
                                    callback: (val) => {
                                        if (val >= 1000000) return (val / 1000000) + ' jt';
                                        if (val >= 1000) return (val / 1000) + ' rb';
                                        return val;
                                    }
                                }
                            }
                        }
                    }
                });
            });
        }
    }));
});
