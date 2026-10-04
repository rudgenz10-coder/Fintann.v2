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
        historyFilter: 'all',   // 'all' | 'income' | 'expense'
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
            'modal-receipt': false
        },

        formAccount: { id: null, name: '', initial_balance: '' },
        formTx: { id: null, account_id: '', type: 'expense', amount: '', category: '', description: '', date: '' },
        formDebt: { id: null, type: 'utang', person: '', amount: '' },
        formCategory: { id: null, name: '', type: 'expense', icon: 'fa-utensils' },
        selectedReceipt: {},

        iconList: [
            'fa-utensils', 'fa-bag-shopping', 'fa-money-check-dollar', 'fa-bus',
            'fa-house', 'fa-bolt', 'fa-film', 'fa-graduation-cap', 'fa-heart-pulse', 'fa-gift'
        ],

        // ========== INIT & DATA ==========
        init() {
            this.loadData();
            this.resetFormTx();
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
            if (modalName === 'modal-add-account') {
                this.formAccount = { id: null, name: '', initial_balance: '' };
            }
            if (modalName === 'modal-add-tx') {
                this.resetFormTx();
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
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getTotalExpense() {
            return this.db.transactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        // SALDO = saldo awal + total pemasukan - total pengeluaran dompet itu.
        // Saldo tidak pernah diubah langsung oleh transaksi, jadi tidak bisa tidak sinkron.
        getAccountBalance(acc) {
            if (!acc) return 0;
            let balance = Number(acc.initial_balance) || 0;
            this.db.transactions.forEach(t => {
                if (t.account_id !== acc.id) return;
                if (t.type === 'income') balance += Number(t.amount) || 0;
                else if (t.type === 'expense') balance -= Number(t.amount) || 0;
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
                .filter(t => t.type === 'income' && t.account_id === accId)
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getWalletExpense(accId) {
            return this.db.transactions
                .filter(t => t.type === 'expense' && t.account_id === accId)
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
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + Number(t.amount), 0);
        },

        getFilteredMonthlyExpense() {
            return this.getFilteredMonthTransactions()
                .filter(t => t.type === 'expense')
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
                if (this.historyFilter !== 'all' && tx.type !== this.historyFilter) return false;
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
                    const total = txs.reduce((sum, t) =>
                        sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);
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

        deleteAccount(id) {
            if (!id) return;
            const count = this.db.transactions.filter(t => t.account_id === id).length;
            const msg = count
                ? `Dompet ini punya ${count} transaksi. Transaksinya tetap tersimpan, tetapi tanpa dompet. Hapus dompet?`
                : 'Hapus dompet ini?';
            if (confirm(msg)) {
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

            this.db.transactions = this.db.transactions.filter(t => t.id !== id);
            this.persist();
            return tx;
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
        saveDebt() {
            const newDebt = {
                id: 'debt_' + Date.now(),
                ...this.formDebt,
                amount: Number(this.formDebt.amount),
                remaining: Number(this.formDebt.amount),
                status: 'unpaid',
                created_at: new Date().toISOString()
            };
            this.db.debts_receivables.push(newDebt);
            this.persist();
            this.closeModal('modal-add-debt');
        },

        toggleDebtStatus(id) {
            const debt = this.db.debts_receivables.find(d => d.id === id);
            if (debt) {
                debt.status = debt.status === 'paid' ? 'unpaid' : 'paid';
                debt.remaining = debt.status === 'paid' ? 0 : debt.amount;
                this.persist();
            }
        },

        deleteDebt(id) {
            this.db.debts_receivables = this.db.debts_receivables.filter(d => d.id !== id);
            this.persist();
        },

        // ========== KATEGORI ==========
        saveCategory() {
            if (this.formCategory.id) {
                const idx = this.db.categories.findIndex(c => c.id === this.formCategory.id);
                if (idx !== -1) {
                    this.db.categories[idx] = { ...this.formCategory };
                }
            } else {
                const newCat = {
                    id: 'cat_' + Date.now(),
                    name: this.formCategory.name,
                    type: this.formCategory.type,
                    icon: this.formCategory.icon
                };
                this.db.categories.push(newCat);
            }

            this.persist();
            this.closeModal('modal-add-category');
        },

        deleteCategory(id) {
            this.db.categories = this.db.categories.filter(c => c.id !== id);
            this.persist();
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
                        .filter(t => t.date === fullDate && t.type === 'income')
                        .reduce((sum, t) => sum + Number(t.amount), 0));

                    expenseData.push(txs
                        .filter(t => t.date === fullDate && t.type === 'expense')
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
