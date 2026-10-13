document.addEventListener('alpine:init', () => {
    // Instance Chart.js disimpan di luar state Alpine supaya tidak dibungkus proxy reaktif
    let historyChart = null;

    const genId = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Tanggal LOKAL (YYYY-MM-DD). toISOString() memakai UTC, jadi jam 00.00-07.00 WIB hasilnya kemarin.
    const localDateStr = (d = new Date()) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

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
            'modal-debt-pay': false
        },

        // Slider kutipan dashboard (slide aktif dihitung dari jam, bukan dari animasi CSS)
        sliderIndex: 0,

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
        formCategory: { id: null, name: '', type: 'expense', icon: 'fa-utensils' },
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
            this.loadData();
            this.resetFormTx();
            this.startSlider();
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
            localStorage.setItem('finku_database_v1', JSON.stringify(this.db));
            // Grafik ikut diperbarui kalau sedang di tab riwayat
            if (this.activeTab === 'history') this.initHistoryChart();
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
            this.initHistoryChart();
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
            return this.historyFilter !== 'all' || this.searchQuery.trim() !== '';
        },

        resetFilter() {
            this.historyFilter = 'all';
            this.searchQuery = '';
        },

        getGroupedTransactions() {
            const q = this.searchQuery.trim().toLowerCase();
            const list = this.getFilteredMonthTransactions().filter(tx => {
                if (this.historyFilter === 'debt') { if (!tx.debt_id) return false; }
                else if (this.historyFilter !== 'all' && (tx.type !== this.historyFilter || tx.debt_id)) return false;
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
                alert('Nama dompet harus diisi');
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

        deleteAccount(id, skipConfirm = false) {
            if (!id) return;
            const count = this.getAccountTxCount(id);
            const msg = count
                ? `Dompet ini punya ${count} transaksi. Transaksinya tetap tersimpan, tetapi tanpa dompet. Hapus dompet?`
                : 'Hapus dompet ini?';
            if (skipConfirm || confirm(msg)) {
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
                alert('Pilih dompet terlebih dahulu');
                return;
            }
            if (amount <= 0) {
                alert('Nominal harus lebih dari 0');
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
            if (tx.debt_id) { alert('Transaksi ini dibuat otomatis dari catatan utang/piutang. Ubah lewat tab Utang.'); return; }
            if (tx.type === 'transfer') { this.editTransfer(tx); return; }
            this.formTx = { ...tx };
            this.openModal('modal-add-tx');
        },

        // skipConfirm = true dipakai bottom sheet (konfirmasinya sudah ada di sana)
        deleteTransaction(id, skipConfirm = false) {
            if (!skipConfirm && !confirm('Hapus transaksi ini? Saldo dompet akan disesuaikan kembali.')) {
                return null;
            }
            const tx = this.db.transactions.find(t => t.id === id);
            if (!tx) return null;
            if (tx.debt_id) { alert('Transaksi ini dibuat otomatis dari catatan utang/piutang. Hapus atau batalkan lewat tab Utang.'); return null; }

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
                alert('Tambahkan minimal 2 dompet untuk transfer');
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
                alert('Pilih dompet asal dan tujuan');
                return;
            }
            if (f.from_id === f.to_id) {
                alert('Dompet asal dan tujuan tidak boleh sama');
                return;
            }
            if (amount <= 0) {
                alert('Jumlah transfer harus lebih dari 0');
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

        deleteFromDetail() {
            const removed = this.deleteTransaction(this.detailTx.id, true);
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
            if (!person) { alert('Isi nama orangnya dulu'); return; }
            if (amount <= 0) { alert('Nominal harus lebih dari 0'); return; }
            if (f.record && !this.db.accounts.some(a => a.id === f.account_id)) { alert('Pilih dompet terlebih dahulu'); return; }

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
            if (!this.db.accounts.length) { alert('Buat dompet dulu di tab Dompet.'); return; }
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
            if (!this.db.accounts.some(a => a.id === f.account_id)) { alert('Pilih dompet terlebih dahulu'); return; }
            if (amount <= 0) { alert('Nominal harus lebih dari 0'); return; }
            if (amount > d.remaining) { alert('Nominal melebihi sisa (' + this.formatRupiah(d.remaining) + ')'); return; }

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

        removeDebtPayment(d, pay) {
            if (!d || !pay) return;
            if (!confirm('Batalkan cicilan ' + this.formatRupiah(pay.amount) + '? Saldo dompet akan dikembalikan.')) return;
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
            this.formCategory = { id: null, name: '', type: this.catFilter, icon: '' };
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
            this.formCategory = { ...cat };
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
                alert('Nama kategori harus diisi');
                return;
            }

            const editing = !!this.formCategory.id;
            const old = editing ? this.db.categories.find(c => c.id === this.formCategory.id) : null;
            if (editing && !old) return;
            // Jenis tidak bisa diubah saat edit, karena transaksi lama sudah memakai jenis itu
            const type = editing ? old.type : this.formCategory.type;

            const duplicate = this.db.categories.some(c =>
                c.id !== this.formCategory.id && c.type === type && c.name.trim().toLowerCase() === name.toLowerCase());
            if (duplicate) {
                alert('Kategori dengan nama itu sudah ada');
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
            } else {
                this.db.categories.push({
                    id: genId('cat'),
                    name,
                    type,
                    icon: this.formCategory.icon
                });
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
                    this.setDataMsg('ok', 'Berhasil dibagikan.');
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }

            // Cadangan: unduh file lalu buka WhatsApp
            this.downloadBlob(content, name, isJson ? 'text/plain' : 'text/csv');
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
                        this.setDataMsg('ok', 'Berhasil dibagikan. Untuk memulihkan: salin pesan itu lalu tekan "Tempel dari clipboard".');
                        return;
                    } catch (e) {
                        if (e && e.name === 'AbortError') return;
                    }
                }
                // Cadangan: salin ke clipboard lalu buka WhatsApp, user tinggal tempel
                await navigator.clipboard.writeText(code);
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
                this.importJson(json);
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
            reader.onload = () => {
                const text = String(reader.result || '').replace(/^\ufeff/, '');
                try {
                    if (/\.(json|txt)$/i.test(file.name)) this.importJson(text);
                    else if (/\.csv$/i.test(file.name)) this.importCsv(text);
                    else this.setDataMsg('error', 'Format harus .json, .txt (backup) atau .csv');
                } catch (e) {
                    this.setDataMsg('error', e.message || 'Gagal mengimpor file.');
                }
            };
            reader.readAsText(file);
        },

        importJson(text) {
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error('File JSON rusak atau bukan backup Finku.'); }
            const keys = ['accounts', 'transactions', 'debts_receivables', 'categories'];
            if (!data || typeof data !== 'object' || !keys.some(k => Array.isArray(data[k]))) {
                throw new Error('File ini bukan backup Finku.');
            }
            const incoming = {};
            keys.forEach(k => { incoming[k] = Array.isArray(data[k]) ? data[k].filter(x => x && typeof x === 'object') : []; });

            if (this.dataForm.importMode === 'replace') {
                if (!confirm('Semua data saat ini akan diganti dengan isi file. Lanjutkan?')) return;
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
                findings: findings.slice(0, 7), tips: tips.slice(0, 4)
            };
        },

        // ========== GRAFIK RIWAYAT ==========
        initHistoryChart() {
            this.$nextTick(() => {
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

                historyChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Masuk',
                                data: incomeData,
                                borderColor: '#059669',            // emerald-600, sama dengan legenda
                                backgroundColor: 'rgba(5, 150, 105, 0.1)',
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
                                ticks: { font: { size: 10 }, maxRotation: 0 },
                                offset: true
                            },
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    font: { size: 10 },
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
