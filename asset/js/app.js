// ==========================================================================
// CORE LOGIC APLIKASI (app.js) - FINCO LOGIK MANAGEMENT SYSTEM
// ==========================================================================
const app = {
    accounts: [],
    debts_receivables: [],
    transactions: [],
    categories: [], 
    activeAccountIndex: 0, 

    init() {
        const data = storage.loadData();
        this.accounts = data.accounts || [];
        this.debts_receivables = data.debts_receivables || [];
        this.transactions = data.transactions || [];
        this.categories = data.categories || []; 
        
        const savedIndex = localStorage.getItem('finku_active_wallet_idx');
        if (savedIndex !== null && parseInt(savedIndex) < this.accounts.length) {
            this.activeAccountIndex = parseInt(savedIndex);
        } else {
            this.activeAccountIndex = 0;
        }

        this.updateDashboardView();
        if (typeof ui !== 'undefined') {
            ui.renderAllTabs();
            // Memastikan dropdown dompet terisi saat load
            if (typeof ui.populateAccountSelects === 'function') ui.populateAccountSelects();
        }

        if (typeof window.renderDaftarKategori === 'function') window.renderDaftarKategori();
        if (typeof window.renderQuickActions === 'function') window.renderQuickActions();
    },

    sync() {
        storage.saveData({
            accounts: this.accounts,
            debts_receivables: this.debts_receivables,
            transactions: this.transactions,
            categories: this.categories 
        });

        if (this.activeAccountIndex >= this.accounts.length) {
            this.activeAccountIndex = Math.max(0, this.accounts.length - 1);
        }
        localStorage.setItem('finku_active_wallet_idx', this.activeAccountIndex);

        this.updateDashboardView();
        
        if (typeof ui !== 'undefined') {
            ui.renderAllTabs();
            if (typeof ui.populateAccountSelects === 'function') ui.populateAccountSelects();
        }
    },

    // FUNGSI BARU: Hitung total transaksi dompet aktif
    getSummaryByActiveAccount() {
        const activeWallet = this.accounts[this.activeAccountIndex];
        if (!activeWallet) return { income: 0, expense: 0 };

        const filtered = this.transactions.filter(t => t.account_id === activeWallet.id);
        return filtered.reduce((acc, t) => {
            if (t.type === 'income') acc.income += parseFloat(t.amount || 0);
            else if (t.type === 'expense') acc.expense += parseFloat(t.amount || 0);
            return acc;
        }, { income: 0, expense: 0 });
    },

    updateDashboardView() {
        const elNamaRekening = document.getElementById('nama-rekening');
        const elTotalSaldo = document.getElementById('total-saldo');
        const elIncome = document.getElementById('dash-pemasukan');
        const elExpense = document.getElementById('dash-pengeluaran');

        if (this.accounts.length === 0) {
            if (elNamaRekening) elNamaRekening.innerText = "Belum Ada Dompet";
            if (elTotalSaldo) elTotalSaldo.innerText = "Rp 0";
            if (elIncome) elIncome.innerText = "Rp 0";
            if (elExpense) elExpense.innerText = "Rp 0";
            return;
        }

        if (this.activeAccountIndex >= this.accounts.length || this.activeAccountIndex < 0) this.activeAccountIndex = 0;

        const activeWallet = this.accounts[this.activeAccountIndex];
        const summary = this.getSummaryByActiveAccount(); // Panggil kalkulasi
        
        if (elNamaRekening) elNamaRekening.innerText = activeWallet.name;
        if (elIncome) elIncome.innerText = `Rp ${summary.income.toLocaleString('id-ID')}`;
        if (elExpense) elExpense.innerText = `Rp ${summary.expense.toLocaleString('id-ID')}`;

        if (elTotalSaldo) {
            const isHidden = localStorage.getItem('finku_saldo_hidden') === 'true';
            elTotalSaldo.innerText = isHidden ? "******" : `Rp ${activeWallet.balance.toLocaleString('id-ID')}`;
            const eyeIcon = document.getElementById('eye-icon');
            if (eyeIcon) eyeIcon.className = isHidden ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
        }

        setTimeout(() => {
            if (typeof ui !== 'undefined' && typeof ui.renderDashboardRecentTransactions === 'function') {
                ui.renderDashboardRecentTransactions();
            }
        }, 50);
    },

    addData(type, payload) {
        const timestampId = `${type}_${Date.now()}`;
        const newData = { id: timestampId, ...payload };

        if (type === 'dompet') {
            this.accounts.push(newData);
            this.activeAccountIndex = this.accounts.length - 1; 
        } else if (type === 'transaksi') {
            newData.amount = parseFloat(newData.amount);
            this.transactions.push(newData);
            const target = this.accounts.find(a => a.id === payload.account_id);
            if (target) payload.type === 'income' ? target.balance += newData.amount : target.balance -= newData.amount;
        } else if (type === 'utang') {
            newData.amount = parseFloat(newData.amount);
            newData.remaining = newData.amount;
            newData.status = 'unpaid';
            newData.created_at = new Date().toISOString();
            this.debts_receivables.push(newData);
        }

        this.sync();
        return true;
    },

    deleteData(type, id) {
        if (type === 'dompet') {
            this.accounts = this.accounts.filter(a => a.id !== id);
            this.transactions = this.transactions.filter(t => t.account_id !== id);
            if (this.activeAccountIndex >= this.accounts.length) this.activeAccountIndex = 0;
        } else if (type === 'transaksi') {
            const tx = this.transactions.find(t => t.id === id);
            if (tx) {
                const target = this.accounts.find(a => a.id === tx.account_id);
                if (target) tx.type === 'income' ? target.balance -= tx.amount : target.balance += tx.amount;
            }
            this.transactions = this.transactions.filter(t => t.id !== id);
        }
        this.sync();
    }
};

// ==========================================================================
// WINDOW EVENT LISTENERS & UI HELPERS
// ==========================================================================
window.slideWallet = function(direction) {
    if (app.accounts.length === 0) return;
    app.activeAccountIndex = direction === 'next' 
        ? (app.activeAccountIndex + 1) % app.accounts.length 
        : (app.activeAccountIndex - 1 + app.accounts.length) % app.accounts.length;
    
    app.sync();
};

function initAutoSlider() {
    const slides = document.querySelectorAll('.slide-img');
    const quoteElement = document.querySelector('.slider-quotes p'); // Selector diperbaiki
    if (slides.length === 0) return;

    let currentSlideIndex = 0;
    const financialQuotes = [
        "Atur uang kamuu, atau uang yang akan mengatur kamuu.",
        "Setiap rupiah yang dihemat adalah fondasi masa depan kamuu.",
        "Disiplin adalah jembatan antara tujuan dan pencapaian.",
        "Kekayaan sejati bukanlah tentang seberapa banyak barang yang kamu beli.",
        "Investasi terbaik adalah investasi pada pengelolaan finansial yang bijak.",
        "Jangan menabung sisa, tapi sisihkan sebelum belanja.",
        "Kebebasan finansial dimulai dari catatan yang rapi.",
      "Tabung dulu baru belanja yaa cantikk.",
      "Kekayaan bukan tentang penghasilan, tapi simpanan"
    ];

    setInterval(() => {
        slides[currentSlideIndex].classList.remove('active');
        currentSlideIndex = (currentSlideIndex + 1) % slides.length;
        slides[currentSlideIndex].classList.add('active');

        if (quoteElement) {
            quoteElement.style.opacity = 0;
            setTimeout(() => {
                quoteElement.innerText = financialQuotes[currentSlideIndex % financialQuotes.length];
                quoteElement.style.opacity = 1;
            }, 300);
        }
    }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    app.init();
    initAutoSlider();
});


