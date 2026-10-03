document.addEventListener('alpine:init', () => {
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
        
        modals: {
            'modal-add-account': false,
            'modal-add-tx': false,
            'modal-add-debt': false,
            'modal-add-category': false,
            'modal-receipt': false
        },

        formAccount: { id: null, name: '', balance: '' },
        formTx: { id: null, account_id: '', type: 'expense', amount: '', category: '', description: '', date: '' },
        formDebt: { id: null, type: 'utang', person: '', amount: '' },
        formCategory: { id: null, name: '', type: 'expense', icon: 'fa-utensils' },
        selectedReceipt: {},

        iconList: [
            'fa-utensils', 'fa-bag-shopping', 'fa-money-check-dollar', 'fa-bus', 
            'fa-house', 'fa-bolt', 'fa-film', 'fa-graduation-cap', 'fa-heart-pulse', 'fa-gift'
        ],

        init() {
            this.loadData();
            const today = new Date().toISOString().split('T')[0];
            this.formTx.date = today;
            if (this.db.accounts.length > 0 && !this.formTx.account_id) {
                this.formTx.account_id = this.db.accounts[0].id;
            }
        },

        loadData() {
            const raw = localStorage.getItem('finku_database_v1');
            if (raw) {
                try {
                    this.db = JSON.parse(raw);
                } catch (e) {
                    this.initDefaultData();
                }
            } else {
                this.initDefaultData();
            }
        },

                initDefaultData() {
            this.db = {
                accounts: [
                    { id: "acc_1", name: "Dompet Tunai", balance: 500000 },
                    { id: "acc_2", name: "Bank BCA", balance: 2500000 }
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
            localStorage.setItem('finku_database_v1', JSON.stringify(this.db));
        },

        formatRupiah(num) {
            return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num || 0);
        },
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


        openModal(modalName, defaultType = null) {
            if (modalName === 'modal-add-tx' && defaultType) {
                this.formTx.type = defaultType;
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
                this.formAccount = { id: null, name: '', balance: '' };
            }
            if (modalName === 'modal-add-tx') {
                this.formTx = { 
                    id: null, 
                    account_id: this.db.accounts[0]?.id || '', 
                    type: 'expense', 
                    amount: '', 
                    category: this.db.categories.filter(c => c.type === 'expense')[0]?.name || '', 
                    description: '', 
                    date: new Date().toISOString().split('T')[0] 
                };
            }
        },

        getAccountName(id) {
            const acc = this.db.accounts.find(a => a.id === id);
            return acc ? acc.name : 'Dompet';
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

        // DIPERBAIKI: Mengurutkan transaksi berdasarkan input terbaru secara aman
        getRecentTransactions() {
            if (!this.db.transactions || this.db.transactions.length === 0) return [];
            return [...this.db.transactions]
                .reverse()
                .slice(0, 5);
        },

        getCurrentMonthLabel() {
            return this.currentDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        },

        changeMonth(direction) {
            const newDate = new Date(this.currentDate);
            newDate.setMonth(newDate.getMonth() + direction);
            this.currentDate = newDate;
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

                        getGroupedTransactions() {
            const groups = {};
            // Ambil transaksi bulan ini (urutan dari lama ke baru)
            const list = this.getFilteredMonthTransactions(); 
            
            list.forEach(tx => {
                if (!groups[tx.date]) groups[tx.date] = [];
                groups[tx.date].push(tx);
            });

            // Urutkan tanggal dari yang terbaru ke terlama, 
            // dan urutkan transaksi di dalam tanggal tersebut dari yang terbaru ke terlama
            return Object.keys(groups)
                .sort((a, b) => new Date(b) - new Date(a))
                .map(date => ({
                    date: date,
                    transactions: groups[date].reverse()
                }));
        },

        getFilteredCategories() {
            return this.db.categories.filter(c => c.type === this.catFilter);
        },

        saveAccount() {
            if (this.formAccount.id) {
                const idx = this.db.accounts.findIndex(a => a.id === this.formAccount.id);
                if (idx !== -1) {
                    this.db.accounts[idx] = { ...this.formAccount, balance: Number(this.formAccount.balance) };
                }
            } else {
                const newAcc = { 
                    id: 'acc_' + Date.now(), 
                    name: this.formAccount.name, 
                    balance: Number(this.formAccount.balance) 
                };
                this.db.accounts.push(newAcc);
            }
            this.persist();
            this.closeModal('modal-add-account');
        },

        editAccount(acc) {
            this.formAccount = { ...acc };
            this.openModal('modal-add-account');
        },

        deleteAccount(id) {
            if (confirm('Hapus dompet ini?')) {
                this.db.accounts = this.db.accounts.filter(a => a.id !== id);
                this.persist();
            }
        },

        saveTransaction() {
            const amount = Number(this.formTx.amount);
            const accIndex = this.db.accounts.findIndex(a => a.id === this.formTx.account_id);

            if (accIndex !== -1 && !this.formTx.id) {
                if (this.formTx.type === 'expense') {
                    this.db.accounts[accIndex].balance -= amount;
                } else {
                    this.db.accounts[accIndex].balance += amount;
                }
            }

            if (this.formTx.id) {
                const idx = this.db.transactions.findIndex(t => t.id === this.formTx.id);
                if (idx !== -1) {
                    this.db.transactions[idx] = { ...this.formTx, amount };
                }
            } else {
                const newTx = { id: 'tx_' + Date.now(), ...this.formTx, amount };
                this.db.transactions.push(newTx);
            }
            this.persist();
            this.closeModal('modal-add-tx');
        },

        editTransaction(tx) {
            this.formTx = { ...tx };
            this.openModal('modal-add-tx');
        },

                deleteTransaction(id) {
            if (confirm('Hapus transaksi ini? Saldo dompet akan disesuaikan kembali.')) {
                // Cari data transaksi yang akan dihapus
                const txToDelete = this.db.transactions.find(t => t.id === id);
                
                if (txToDelete) {
                    // Cari dompet terkait
                    const accIndex = this.db.accounts.findIndex(a => a.id === txToDelete.account_id);
                    
                    if (accIndex !== -1) {
                        const amount = Number(txToDelete.amount);
                        // Kembalikan saldo berdasarkan jenis transaksi
                        if (txToDelete.type === 'expense') {
                            this.db.accounts[accIndex].balance += amount; // Saldo dikembalikan karena pengeluaran dibatalkan
                        } else if (txToDelete.type === 'income') {
                            this.db.accounts[accIndex].balance -= amount; // Saldo dikurangi karena pemasukan dibatalkan
                        }
                    }
                }

                // Hapus transaksi dari daftar
                this.db.transactions = this.db.transactions.filter(t => t.id !== id);
                this.persist();
            }
        },


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

                saveCategory() {
            // Cek apakah form memiliki ID (Artinya sedang mode Edit)
            if (this.formCategory.id) {
                const idx = this.db.categories.findIndex(c => c.id === this.formCategory.id);
                if (idx !== -1) {
                    this.db.categories[idx] = { ...this.formCategory };
                }
            } else {
                // Jika ID kosong/null, WAJIB buat objek baru dengan ID baru!
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

        showReceipt(tx) {
            this.selectedReceipt = tx;
            this.openModal('modal-receipt');
        },

              // Tambahkan properti ini di dalam return AppController()
        historyChartInstance: null,

        // Tambahkan fungsi ini di dalam AppController()
        initHistoryChart() {
    this.$nextTick(() => {
        const canvas = document.getElementById('historyChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        // Hancurkan chart lama jika sudah ada agar tidak numpuk/bug
        if (this.historyChartInstance) {
            this.historyChartInstance.destroy();
        }

        // Ambil semua transaksi bulan aktif
        const txs = this.getFilteredMonthTransactions();
        
        // Buat daftar tanggal unik dalam bulan tersebut (diurutkan dari awal ke akhir bulan)
        const daysInMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0).getDate();
        const labels = [];
        const incomeData = [];
        const expenseData = [];

        for (let i = 1; i <= daysInMonth; i++) {
            const dayStr = String(i).padStart(2, '0');
            const monthStr = String(this.currentDate.getMonth() + 1).padStart(2, '0');
            const yearStr = this.currentDate.getFullYear();
            const fullDate = `${yearStr}-${monthStr}-${dayStr}`;

            labels.push(i); // Label angka tanggal (1, 2, 3...)

            // Hitung total pemasukan di tanggal tersebut
            const totalInc = txs
                .filter(t => t.date === fullDate && t.type === 'income')
                .reduce((sum, t) => sum + Number(t.amount), 0);
            incomeData.push(totalInc);

            // Hitung total pengeluaran di tanggal tersebut
            const totalExp = txs
                .filter(t => t.date === fullDate && t.type === 'expense')
                .reduce((sum, t) => sum + Number(t.amount), 0);
            expenseData.push(totalExp);
        }

        // Render Line Chart menggunakan Chart.js
        this.historyChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Masuk',
                        data: incomeData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3
                    },
                    {
                        label: 'Keluar',
                        data: expenseData,
                        borderColor: '#f43f5e',
                        backgroundColor: 'rgba(244, 63, 94, 0.1)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { font: { size: 10 }, boxWidth: 12 }
                    }
                },
                scales: {
                    x: { 
                        grid: { 
                            display: false 
                        }, 
                        ticks: { 
                            font: { size: 9 },
                            maxRotation: 0 // Mencegah label tanggal miring
                        },
                        // Properti untuk memberi ruang/jarak di sumbu X
                        offset: true 
                    },
                    y: { 
                        ticks: { 
                            font: { size: 9 }, 
                            callback: (val) => val >= 1000 ? (val/1000) + 'K' : val 
                        } 
                    }
                }
            }
        });
    });
}


    }));
});
