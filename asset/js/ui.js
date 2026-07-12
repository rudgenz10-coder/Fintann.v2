// ==========================================================================
// ANTARMUKA PENGGUNA (ui.js) - FINCO MULTI-WALLET EKOSISTEM
// ==========================================================================
window.currentTxTypeFilter = 'all'; 

const ui = {
    txPageState: {
        currentDate: new Date(), 
        activeChartInstance: null
    },
    currentDebtTabState: 0, 
    selectedDebtId: null,

    switchTab(tabId, element) {
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        const targetTab = document.getElementById(`tab-${tabId}`);
        if (targetTab) targetTab.classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        if (element) element.classList.add('active');

        this.renderAllTabs();
        if (tabId === 'kategori') {
            if (typeof window.renderDaftarKategori === 'function') window.renderDaftarKategori();
        } else if (tabId === 'dashboard') {
            if (typeof window.renderQuickActions === 'function') window.renderQuickActions();
        }
    },

    openModal(id) {
        this.populateAccountSelects(); 
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('open');
    },

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('open');
    },

    showToast(message) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerText = message;
        container.appendChild(toast);
        
        setTimeout(() => { toast.classList.add('show'); }, 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.remove(); }, 300);
        }, 2500);
    },

    populateAccountSelects() {
    const ids = ['utang-account-id', 'debt-account-id', 'utang-dompet']; // Masukkan semua kemungkinan ID
    ids.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.innerHTML = '<option value="" disabled selected>Pilih Dompet</option>';
            app.accounts.forEach(acc => {
                select.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
            });
        }
    });
},

    // FIX BUG 1, 6 & 7: Pengelompokan harian, filter instan Maroon & perbaikan kalkulasi data
    renderTransactionsTab() {
        const container = document.getElementById('tx-page-list') || document.getElementById('tx-grouped-history-container');
        if (!container) return;

        const curDate = this.txPageState.currentDate;
        const year = curDate.getFullYear();
        const month = curDate.getMonth();

        const labelBulan = document.getElementById('tx-month-label') || document.getElementById('tx-label-waktu-utama');
        if (labelBulan) {
            const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            labelBulan.innerText = `${namaBulan[month]} ${year}`;
        }

        const listTransaksi = (typeof app !== 'undefined' ? app.transactions : []) || [];
        const accounts = (typeof app !== 'undefined' ? app.accounts : []) || [];
        const categories = (typeof storage !== 'undefined' ? storage.loadData().categories : []) || [];

        // Filter berdasarkan waktu & kategori filter Maroon instan
        const filtered = listTransaksi.filter(t => {
            if (!t.date) return false;
            const d = new Date(t.date);
            const matchMonth = d.getFullYear() === year && d.getMonth() === month;
            if (!matchMonth) return false;

            if (window.currentTxTypeFilter && window.currentTxTypeFilter !== 'all') {
                return t.type === window.currentTxTypeFilter;
            }
            return true;
        });

        this.syncFilterButtonStyles();

        if (filtered.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:30px 0; font-size:13px;">Tidak ada transaksi.</p>`;
            this._destroyAndClearChart();
            return;
        }

        // Urutkan transaksi terbaru di atas
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        let totalIn = 0;
        let totalOut = 0;
        let catMap = {};

        // Kalkulasi rekap global bulan berjalan
        filtered.forEach(t => {
            if (t.type === 'income') totalIn += t.amount;
            if (t.type === 'expense') {
                totalOut += t.amount;
                const masterCat = categories.find(c => c.id === t.category || c.name === t.category);
                const nameKey = masterCat ? masterCat.name : t.category;
                catMap[nameKey] = (catMap[nameKey] || 0) + t.amount;
            }
        });

        // FIX BUG 6: Kelompokkan transaksi per tanggal hari
        const groupedByDay = {};
        filtered.forEach(t => {
            const dateStr = t.date || new Date().toISOString().split('T')[0];
            if (!groupedByDay[dateStr]) groupedByDay[dateStr] = [];
            groupedByDay[dateStr].push(t);
        });

        const sortedDates = Object.keys(groupedByDay).sort((a, b) => new Date(b) - new Date(a));

        container.innerHTML = sortedDates.map(dateStr => {
            const dayTransactions = groupedByDay[dateStr];
            const cleanHeaderDate = ui._formatHariTanggalLengkap(dateStr);

            const itemsHTML = dayTransactions.map(t => {
                const wallet = accounts.find(a => a.id === t.account_id);
                const namaDompet = wallet ? wallet.name : 'Unknown';
                return this._generateTransactionRowHTML(t, namaDompet);
            }).join('');

            return `
                <div class="day-group-box" style="margin-bottom: 18px;">
                    <div class="day-badge-header" style="font-size: 11px; font-weight: 700; color: #800020; background: rgba(128,0,0,0.06); padding: 4px 10px; border-radius: 6px; margin-bottom: 8px; display: inline-block;">
                        ${cleanHeaderDate}
                    </div>
                    ${itemsHTML}
                </div>
            `;
        }).join('');

        const elIn = document.getElementById('tx-rekap-income');
        const elOut = document.getElementById('tx-rekap-expense');
        if (elIn) elIn.innerText = `Rp ${totalIn.toLocaleString('id-ID')}`;
        if (elOut) elOut.innerText = `Rp ${totalOut.toLocaleString('id-ID')}`;

        this._renderChartDonut(catMap);
    },

        // FIX BUG 3 (RADAR VERSION): Otomatis melacak wadah transaksi di homepage berdasarkan ID, Class, atau Teks Judul
        // FIX FINAL: Langsung mengunci id="list-transaksi-limit" sesuai HTML kamu
    renderDashboardRecentTransactions() {
        const container = document.getElementById('list-transaksi-limit');
        
        // Jika elemen belum mendarat di DOM, hentikan proses agar tidak eror
        if (!container) return;

        const listTransaksi = (typeof app !== 'undefined' ? app.transactions : []) || [];
        const accounts = (typeof app !== 'undefined' ? app.accounts : []) || [];

        // Urutkan 5 transaksi terbaru (Aman dari bug penanggalan HP)
        const latestTransactions = [...listTransaksi]
            .sort((a, b) => {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                if (timeB !== timeA) return timeB - timeA;
                return b.id.localeCompare(a.id);
            })
            .slice(0, 5);

        if (latestTransactions.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-size:13px; padding:20px 0;">Belum ada riwayat transaksi.</p>`;
            return;
        }

        // Render baris transaksi memakai 'this' agar aman dari urutan load file script
        container.innerHTML = latestTransactions.map(t => {
            const wallet = accounts.find(a => a.id === t.account_id);
            const namaDompet = wallet ? wallet.name : 'Unknown';
            return this._generateTransactionRowHTML(t, namaDompet);
        }).join('');
    },

    syncFilterButtonStyles() {
        const buttons = document.querySelectorAll('[id^="filter-tx-"], .tx-filter-btn, .filter-pill-tx');
        buttons.forEach(btn => {
            const typeAttr = btn.getAttribute('data-type') || btn.id.replace('filter-tx-', '');
            if (typeAttr === window.currentTxTypeFilter) {
                btn.style.background = '#800020';
                btn.style.color = '#ffffff';
                btn.style.borderColor = '#800020';
            } else {
                btn.style.background = 'var(--bg-card)';
                btn.style.color = 'var(--text-muted)';
                btn.style.borderColor = 'var(--border)';
            }
        });
    },

    _generateTransactionRowHTML(t, namaDompet) {
        const categories = (typeof storage !== 'undefined' ? storage.loadData().categories : []) || [];
        const masterCat = categories.find(c => c.id === t.category || c.name === t.category);
        
        const iconClass = masterCat ? masterCat.icon : 'fa-tags';
        const namaTeksKategori = masterCat ? masterCat.name : t.category;
        
        const isIncome = t.type === 'income';
        const sign = isIncome ? '+' : '-';
        const nominalColor = isIncome ? 'color: var(--success);' : 'color: var(--danger);';

        return `
            <div class="transaction-item" onclick="window.showTransactionReceipt('${t.id}')" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.04); background: var(--bg-card); margin-bottom: 6px; border-radius: 12px; cursor: pointer;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="background-color: var(--primary-light); color: var(--primary); width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0;">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 13px; font-weight: 700; color: var(--text-main);">${namaTeksKategori}</h4>
                        <p style="margin: 2px 0 0 0; font-size: 11px; color: var(--text-muted); line-height: 1.3;">
                            ${t.description || namaTeksKategori} <span style="color: var(--primary); font-weight:600;">(${namaDompet})</span>
                        </p>
                    </div>
                </div>
                <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;" onclick="event.stopPropagation();">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 13px; font-weight: 700; ${nominalColor}">${sign}Rp ${t.amount.toLocaleString('id-ID')}</span>
                        <i class="fa-solid fa-pen-to-square" onclick="window.openEditTransactionModal('${t.id}')" style="color: var(--text-muted); cursor:pointer; font-size: 13px;"></i>
                        <i class="fa-solid fa-circle-xmark" onclick="if(confirm('Hapus transaksi ini?')) { app.deleteData('transaksi', '${t.id}'); }" style="color: #ccc; cursor:pointer; font-size: 14px;"></i>
                    </div>
                </div>
            </div>
        `;
    },

    changeTxMonth(offset) {
        this.txPageState.currentDate.setMonth(this.txPageState.currentDate.getMonth() + offset);
        this.renderTransactionsTab();
    },

    renderDebtsTab() {
        const container = document.getElementById('page-utang');
    if (!container) return;

    const listUtang = (typeof app !== 'undefined' ? app.debts_receivables : []) || [];
    const accounts = (typeof app !== 'undefined' ? app.accounts : []) || [];
    
    // PERBAIKAN DI SINI: Samakan dengan value di <select> HTML Anda
    const targetType = this.currentDebtTabState === 0 ? 'debt' : 'receivable'; 
    
    const filtered = listUtang.filter(d => d.type === targetType);

    if (filtered.length === 0) {
        // Tampilkan teks yang sesuai dengan jenisnya
        const label = targetType === 'debt' ? 'Utang' : 'Piutang';
        container.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:30px 0; font-size:13px;">Tidak ada data ${label}.</p>`;
        return;
    }

        container.innerHTML = filtered.map(d => {
            const wallet = accounts.find(a => a.id === d.account_id);
            const namaDompet = wallet ? wallet.name : 'Unknown';
            const persenLunas = ((d.amount - d.remaining) / d.amount) * 100;
            const isLunas = d.status === 'paid' || d.remaining <= 0;

            return `
                <div class="debt-card-item" style="background: var(--bg-card); padding: 14px; border-radius: 16px; margin-bottom: 10px; border: 1px solid var(--border); position: relative;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                        <div>
                            <h4 style="margin:0; font-size:14px; font-weight:700; color:var(--text-main);">${d.person}</h4>
                            <span style="font-size:11px; color:var(--text-muted);">Dompet: ${namaDompet}</span>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:13px; font-weight:700; color:var(--primary);">Rp ${d.remaining.toLocaleString('id-ID')}</span>
                            <span style="display:block; font-size:10px; color:var(--text-muted);">Total: Rp ${d.amount.toLocaleString('id-ID')}</span>
                        </div>
                    </div>
                    <div style="width:100%; height:6px; background:#eee; border-radius:10px; overflow:hidden; margin-bottom:4px;">
                        <div style="width: ${persenLunas}%; height:100%; background: ${isLunas ? 'var(--success)' : 'var(--accent-pink)'}; transition: width 0.3s;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                        <span style="color:${isLunas ? 'var(--success)' : 'orange'}; font-weight:600;">${isLunas ? 'LUNAS' : 'BELUM LUNAS'}</span>
                        <div style="display:flex; gap:10px;">
                            ${!isLunas ? `<button onclick="window.openCicilanModal('${d.id}')" style="background:var(--primary-light); color:var(--primary); border:none; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer;">Cicil</button>` : ''}
                            <button onclick="if(confirm('Hapus catatan ini?')) { app.deleteData('utang', '${d.id}'); }" style="background:none; border:none; color:var(--danger); font-size:11px; cursor:pointer;"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    switchDebtTab(index) {
        this.currentDebtTabState = index;
        document.querySelectorAll('.debt-tab-btn').forEach((btn, idx) => {
            if (idx === index) {
                btn.classList.add('active');
                btn.style.borderBottom = '2px solid var(--primary)';
                btn.style.color = 'var(--primary)';
            } else {
                btn.classList.remove('active');
                btn.style.borderBottom = '2px solid transparent';
                btn.style.color = 'var(--text-muted)';
            }
        });
        this.renderDebtsTab();
    },

    renderAllTabs() {
        this.renderTransactionsTab();
        this.renderDebtsTab();
        this.renderDashboardRecentTransactions();
    },

    // FIX BUG 1 & 2: Validasi mutlak menghentikan eksekusi penyimpanan ilegal
    handleFormSubmit(event, type) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        if (type === 'dompet') {
            const nameEl = document.getElementById('wallet-name') || document.getElementById('dompet-nama');
            const name = nameEl ? nameEl.value.trim() : '';
            const editId = document.getElementById('edit-wallet-id')?.value;

            // FIX BUG 1: Kunci pengaman agar nama dompet tidak terisi kosong/hilang
            if (!name) {
                alert("Nama dompet tidak boleh kosong!");
                return false;
            }

            if (editId) {
                const wallet = app.accounts.find(a => a.id === editId);
                if (wallet) {
                    wallet.name = name;
                }
                this.showToast("Berhasil memperbarui data dompet!");
            } else {
                app.addData('dompet', { name, balance: 0 });
                this.showToast("Berhasil menambah dompet baru!");
            }
            
            const editIdInput = document.getElementById('edit-wallet-id');
            if (editIdInput) editIdInput.value = '';
            this.closeModal('modal-dompet');
            
            const f = document.getElementById('form-dompet');
            if (f) f.reset();
            app.sync();
        }

        else if (type === 'transaksi') {
            const account_id = (document.getElementById('tx-account-id') || document.getElementById('transaksi-dompet'))?.value;
            const typeTx = (document.getElementById('tx-jenis') || document.getElementById('transaksi-jenis'))?.value;
            const amount = parseFloat((document.getElementById('tx-nominal') || document.getElementById('transaksi-nominal'))?.value);
            const category = (document.getElementById('tx-keterangan') || document.getElementById('transaksi-kategori'))?.value;
            const description = (document.getElementById('tx-deskripsi-tambahan') || document.getElementById('transaksi-deskripsi'))?.value;
            const dateValue = (document.getElementById('tx-date') || document.getElementById('transaksi-tanggal'))?.value;
            const editTxId = document.getElementById('edit-tx-id')?.value;

            // FIX BUG 2: Jika terdeteksi melanggar batas, paksa return false & hancurkan proses kelanjutan form
            if (isNaN(amount) || amount <= 0) {
                alert("Nominal harus valid dan lebih dari nol!");
                return false;
            }

            if (editTxId) {
                const targetTx = app.transactions.find(t => t.id === editTxId);
                if (targetTx) {
                    const oldAcc = app.accounts.find(a => a.id === targetTx.account_id);
                    if (oldAcc) {
                        if (targetTx.type === 'income') oldAcc.balance -= targetTx.amount;
                        else oldAcc.balance += targetTx.amount;
                    }

                    targetTx.account_id = account_id;
                    targetTx.type = typeTx;
                    targetTx.amount = amount;
                    targetTx.category = category;
                    targetTx.description = description;
                    targetTx.date = dateValue;

                    const newAcc = app.accounts.find(a => a.id === account_id);
                    if (newAcc) {
                        if (typeTx === 'income') newAcc.balance += amount;
                        else newAcc.balance -= amount;
                    }
                }
                document.getElementById('edit-tx-id').value = '';
                this.showToast("Berhasil mengubah catatan transaksi!");
            } else {
                app.addData('transaksi', { account_id, type: typeTx, amount, category, description, date: dateValue });
                this.showToast("Berhasil mencatat transaksi baru!");
            }

            this.closeModal('modal-transaksi');
            const f = document.getElementById('form-transaksi') || document.getElementById('form-tambah-transaksi');
            if (f) f.reset();
            app.sync();
        }

        else if (type === 'kategori') {
            const name = (document.getElementById('cat-name') || document.getElementById('kategori-nama'))?.value;
            const typeCat = (document.getElementById('cat-type') || document.getElementById('kategori-jenis'))?.value;
            const icon = typeof selectedIconClass !== 'undefined' ? selectedIconClass : 'fa-tags';
            const editCatId = document.getElementById('edit-cat-id')?.value;

            if (!name) return false;

            if (editCatId) {
                const targetCat = app.categories.find(c => c.id === editCatId);
                if (targetCat) {
                    targetCat.name = name;
                    targetCat.type = typeCat;
                    targetCat.icon = icon;
                }
                document.getElementById('edit-cat-id').value = '';
                this.showToast("Kategori berhasil diupdate!");
            } else {
                app.addData('kategori', { name, type: typeCat, icon });
                this.showToast("Kategori baru berhasil dibuat!");
            }

            this.closeModal('modal-kategori');
            const f = document.getElementById('form-kategori') || document.getElementById('form-tambah-kategori');
            if (f) f.reset();
            app.sync();
        }

                else if (type === 'utang') {
            // Gunakan ID yang persis sama dengan index.html
            const person = document.getElementById('utang-nama')?.value;
            const account_id = document.getElementById('utang-account-id')?.value;
            const typeDebt = document.getElementById('utang-jenis')?.value;
            const amount = parseFloat(document.getElementById('utang-nominal')?.value);

            // Log untuk memastikan data terbaca
            console.log("Input Debug:", { person, account_id, typeDebt, amount });

            // Cek apakah data valid
            if (!person || !account_id || isNaN(amount) || amount <= 0) {
                alert("Mohon lengkapi data utang dengan benar!");
                return false;
            }

            app.addData('utang', { person, account_id, type: typeDebt, amount });
            this.showToast(`Berhasil mencatat data ${typeDebt === 'debt' ? 'Utang' : 'Piutang'}!`);

            this.closeModal('modal-utang');
            document.getElementById('form-utang').reset();
            
            // Refresh list dan sinkronisasi
            if (typeof this.renderUtangList === 'function') this.renderUtangList();
            app.sync();
        }

    },

    handleCicilanSubmit(event) {
        event.preventDefault();
        const amtInput = parseFloat(document.getElementById('cicil-amount').value);
        if (isNaN(amtInput) || amtInput <= 0 || !this.selectedDebtId) return;

        const listUtang = (typeof app !== 'undefined' ? app.debts_receivables : []) || [];
        const item = listUtang.find(d => d.id === this.selectedDebtId);
        if (!item) return;

        if (amtInput > item.remaining) {
            alert("Nominal pembayaran cicilan melampaui sisa tagihan!");
            return;
        }

        item.remaining -= amtInput;
        if (item.remaining <= 0) {
            item.status = 'paid';
        }

        const accounts = (typeof app !== 'undefined' ? app.accounts : []) || [];
        const wallet = accounts.find(a => a.id === item.account_id);
        if (wallet) {
            if (item.type === 'utang') wallet.balance -= amtInput;
            else wallet.balance += amtInput;
        }

        if (typeof app !== 'undefined') {
            app.transactions.push({
                id: "tx_" + Date.now(),
                account_id: item.account_id,
                type: item.type === 'utang' ? 'expense' : 'income',
                amount: amtInput,
                category: item.type === 'utang' ? 'Bayar Utang' : 'Penagihan Piutang',
                description: `Cicilan pembayaran oleh/kepada ${item.person}`,
                date: new Date().toISOString().split('T')[0]
            });
        }

        this.showToast("Cicilan berhasil dibayarkan!");
        this.closeModal('modal-cicilan');
        document.getElementById('form-cicilan').reset();
        this.selectedDebtId = null;
        app.sync();
    },
  // Tambahkan fungsi ini di dalam objek ui { ... }
renderUtangList() {
    const container = document.getElementById('list-utang');
    if (!container) return;

    // Debugging: Pastikan data terdeteksi
    console.log("Data utang yang akan dirender:", app.debts_receivables);

    container.innerHTML = ''; // Reset kontainer

    if (app.debts_receivables.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999; margin-top:20px;">Belum ada catatan utang/piutang.</p>';
        return;
    }

    app.debts_receivables.forEach(item => {
        const isPaid = item.status === 'paid';
        const statusColor = isPaid ? '#4caf50' : '#f44336';
        
        const card = document.createElement('div');
        card.style.cssText = "background:white; padding:16px; border-radius:12px; margin-bottom:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);";
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong style="font-size:16px;">${item.person}</strong><br>
                    <small style="color:#666;">${item.type === 'debt' ? 'Utang' : 'Piutang'}</small>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:bold; color:${statusColor};">Rp ${parseInt(item.remaining).toLocaleString('id-ID')}</div>
                    ${!isPaid ? `<button onclick="ui.openCicilanModal('${item.id}')" style="background:var(--primary); color:white; border:none; padding:4px 10px; border-radius:6px; cursor:pointer; margin-top:4px;">Bayar</button>` : '<span style="color:#4caf50; font-size:12px; font-weight:bold;">LUNAS</span>'}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
},


    // FIX BUG 4: Gambar ke elemen canvas mana pun yang aktif dan tersedia di dokumen
        // REFACTOR: Mengubah Pie menjadi Scrollable Line Chart dari Tanggal 1 s/d Akhir Bulan
    _renderChartDonut(catMap) {
        this._destroyAndClearChart();

        const ctx = document.getElementById('transactionPageChart');
        if (!ctx) return;

        const curDate = this.txPageState.currentDate;
        const year = curDate.getFullYear();
        const month = curDate.getMonth();

        // 1. Hitung jumlah tanggal maksimum di bulan yang sedang aktif dipilih
        const jumlahHari = new Date(year, month + 1, 0).getDate();

        // 2. Buat array label angka tanggal murni ("1", "2", "3", ... "31")
        const labelsTanggal = [];
        const dataPemasukan = Array(jumlahHari).fill(0);
        const dataPengeluaran = Array(jumlahHari).fill(0);

        for (let i = 1; i <= jumlahHari; i++) {
            labelsTanggal.push(`${i}`);
        }

        // 3. Ambil data transaksi real-time untuk dipetakan ke koordinat tanggal murni
        const listTransaksi = (typeof app !== 'undefined' ? app.transactions : []) || [];
        
        listTransaksi.forEach(t => {
            if (!t.date) return;
            const d = new Date(t.date);
            // Pastikan tahun dan bulan transaksi cocok dengan slider aktif
            if (d.getFullYear() === year && d.getMonth() === month) {
                const tglIndex = d.getDate() - 1; // dapatkan indeks array posisi tanggal (0-30)
                if (tglIndex >= 0 && tglIndex < jumlahHari) {
                    if (t.type === 'income') {
                        dataPemasukan[tglIndex] += t.amount;
                    } else if (t.type === 'expense') {
                        dataPengeluaran[tglIndex] += t.amount;
                    }
                }
            }
        });

        // 4. Inisialisasi Line Chart menggunakan Chart.js dengan palet khas FinKu Maroon
        this.txPageState.activeChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labelsTanggal,
                datasets: [
                    {
                        label: 'Pengeluaran',
                        data: dataPengeluaran,
                        borderColor: '#800020', // Maroon Utama
                        backgroundColor: 'rgba(128, 0, 32, 0.05)', // Background fill tipis di bawah garis
                        borderWidth: 3,
                        tension: 0.3, // Membuat lekukan garis menjadi smooth melengkung
                        fill: true,
                        pointBackgroundColor: '#800020',
                        pointRadius: 3
                    },
                    {
                        label: 'Pemasukan',
                        data: dataPemasukan,
                        borderColor: '#10b981', // Hijau Sukses
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        fill: false,
                        pointBackgroundColor: '#10b981',
                        pointRadius: 2
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
                    legend: {
                        position: 'top',
                        labels: { font: { size: 11, family: "'DM Sans', sans-serif" }, color: 'var(--text-main)' }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false }, // Hapus garis vertikal abu-abu agar clean
                        ticks: {
                            color: 'var(--text-muted)',
                            font: { size: 11 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0, 0, 0, 0.03)' },
                        ticks: {
                            color: 'var(--text-muted)',
                            font: { size: 10 },
                            callback: function(value) {
                                // Mempersingkat nominal ribuan di sumbu Y (misal 500k daripada 500.000)
                                if (value >= 1000000) return (value / 1000000) + 'M';
                                if (value >= 1000) return (value / 1000) + 'k';
                                return value;
                            }
                        }
                    }
                }
            }
        });

        // AUTO SCROLL: Otomatis menggeser chart ke ujung kanan (tanggal terbaru) begitu halaman dimuat
        setTimeout(() => {
            const wrapper = document.querySelector('.chart-scroll-wrapper');
            if (wrapper) wrapper.scrollLeft = wrapper.scrollWidth;
        }, 300);
    },

    _destroyAndClearChart() {
        if (this.txPageState.activeChartInstance) {
            this.txPageState.activeChartInstance.destroy();
            this.txPageState.activeChartInstance = null;
        }
    },

    _formatHariTanggalLengkap(dateString) {
        if (!dateString) return '-';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return dateString;
        const opsi = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        return d.toLocaleDateString('id-ID', opsi);
    }
};

// FIX BUG 7: Trigger eksekusi filter instan otomatis tanpa tombol tambahan
window.filterTransactionType = function(type) {
    window.currentTxTypeFilter = type;
    ui.renderTransactionsTab();
};

window.openCicilanModal = function(id) {
    ui.selectedDebtId = id;
    ui.openModal('modal-cicilan');
};

// FIX BUG 8: Deklarasikan fungsi pembuka data edit transaksi agar tidak memicu eror gaib
window.openEditTransactionModal = function(id) {
    const listTransaksi = (typeof app !== 'undefined' ? app.transactions : []) || [];
    const tx = listTransaksi.find(t => t.id === id);
    if (!tx) return;

    ui.openModal('modal-transaksi');

    const modalTitle = document.getElementById('modal-transaksi-title');
    if (modalTitle) modalTitle.innerText = "Edit Transaksi";

    let editTxId = document.getElementById('edit-tx-id');
    if (!editTxId) {
        editTxId = document.createElement('input');
        editTxId.type = 'hidden';
        editTxId.id = 'edit-tx-id';
        const formTx = document.getElementById('form-transaksi') || document.getElementById('form-tambah-transaksi');
        if (formTx) formTx.appendChild(editTxId);
    }
    editTxId.value = tx.id;

    const selectDompet = document.getElementById('tx-account-id') || document.getElementById('transaksi-dompet');
    const selectJenis = document.getElementById('tx-jenis') || document.getElementById('transaksi-jenis');
    const inputNominal = document.getElementById('tx-nominal') || document.getElementById('transaksi-nominal');
    const inputDate = document.getElementById('tx-date') || document.getElementById('transaksi-tanggal');
    const inputDesc = document.getElementById('tx-deskripsi-tambahan') || document.getElementById('transaksi-deskripsi');

    if (selectDompet) selectDompet.value = tx.account_id;
    if (selectJenis) {
        selectJenis.value = tx.type;
        if (typeof window.updateModalCategoryOptions === 'function') window.updateModalCategoryOptions();
    }
    
    const selectKeterangan = document.getElementById('tx-keterangan') || document.getElementById('transaksi-kategori');
    if (selectKeterangan) selectKeterangan.value = tx.category;
    if (inputNominal) inputNominal.value = tx.amount;
    if (inputDate) inputDate.value = tx.date;
    if (inputDesc) inputDesc.value = tx.description || '';
};

// FIX BUG 5: Bongkar ID kategori di dalam struk receipt murni untuk menampilkan nama teks aslinya
window.showTransactionReceipt = function(txId) {
    let currentData = (typeof app !== 'undefined') ? app : storage.loadData();
    const tx = currentData.transactions.find(t => t.id === txId);
    if (!tx) return;
    
    const acc = currentData.accounts.find(a => a.id === tx.account_id);
    const categories = currentData.categories || [];
    
    // Cari nama asli kategori, jika tidak ketemu gunakan isi default tx.category
    const masterCat = categories.find(c => c.id === tx.category || c.name === tx.category);
    const namaKategoriAsli = masterCat ? masterCat.name : tx.category;

    const receiptContent = document.getElementById('receipt-content');
    if (receiptContent) {
        receiptContent.innerHTML = `
            <div style="text-align: center; margin-bottom: 14px;">
                <h4 style="color: #800020; font-size: 18px; margin: 0; font-weight:700;">FinKu Struk</h4>
                <small style="color: var(--text-muted); font-size:11px;">${tx.date}</small>
            </div>
            <div style="border-top: 1px dashed var(--border); margin: 10px 0;"></div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size:13px;">
                <span style="color: var(--text-muted);">Jenis:</span>
                <span style="font-weight: 600; color: ${tx.type === 'income' ? 'var(--success)' : 'var(--danger)'};">${tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size:13px;">
                <span style="color: var(--text-muted);">Dompet:</span>
                <span style="color: var(--text-main); font-weight: 500;">${acc ? acc.name : 'Utama'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size:13px;">
                <span style="color: var(--text-muted);">Kategori:</span>
                <span style="color: var(--text-main); font-weight: 500;">${namaKategoriAsli}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size:13px;">
                <span style="color: var(--text-muted);">Deskripsi:</span>
                <span style="color: var(--text-main); font-weight: 500;">${tx.description || '-'}</span>
            </div>
            <div style="border-top: 1px dashed var(--border); margin: 10px 0;"></div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding-top:4px;">
                <span style="font-weight: 700; color: var(--text-main); font-size:13px;">Total:</span>
                <span style="font-size: 16px; font-weight: 700; color: #800020;">Rp ${tx.amount.toLocaleString('id-ID')}</span>
            </div>
        `;
        ui.openModal('modal-struk');
    }
};

// Amankan seluruh event submit murni form HTML
document.addEventListener('submit', (e) => {
    const id = e.target.id;
    if (id === 'form-kategori' || id === 'form-tambah-kategori') {
        ui.handleFormSubmit(e, 'kategori');
    } else if (id === 'form-transaksi' || id === 'form-tambah-transaksi') {
        ui.handleFormSubmit(e, 'transaksi');
    } else if (id === 'form-dompet') {
        ui.handleFormSubmit(e, 'dompet');
    } else if (id === 'form-utang' || id === 'form-utang-piutang') {
        ui.handleFormSubmit(e, 'utang');
    } else if (id === 'form-cicilan') {
        ui.handleCicilanSubmit(e);
    }
});

window.addEventListener('DOMContentLoaded', () => {
    ui.populateAccountSelects();
});

// Pemicu otomatis begitu seluruh halaman dan script ui.js selesai dimuat
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof ui !== 'undefined' && typeof ui.renderDashboardRecentTransactions === 'function') {
            ui.renderDashboardRecentTransactions();
        }
    }, 100); // Delay 100ms agar data dari storage & app.js terisi sempurna dulu
});
