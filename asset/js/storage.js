const storage = {
    KEY: 'finku_multi_wallet_data',

    // Mengambil data dari localStorage atau memberikan struktur default jika kosong
        // Mengambil data dari localStorage atau memberikan struktur default jika kosong
    loadData() {
        const raw = localStorage.getItem(this.KEY);
        if (!raw) {
            return {
                accounts: [
                    { id: "acc_1", name: "Dompet Tunai", balance: 500000 },
                    { id: "acc_2", name: "Bank BCA", balance: 2500000 }
                ],
                debts_receivables: [],
                transactions: [],
                // TAMBAHKAN KATEGORI DEFAULT DI SINI
                categories: [
                    { id: "cat_1", name: "Makanan", type: "expense", icon: "fa-utensils" },
                    { id: "cat_2", name: "Belanja", type: "expense", icon: "fa-bag-shopping" },
                    { id: "cat_3", name: "Gaji", type: "income", icon: "fa-money-check-dollar" },
                    { id: "cat_4", name: "Transfer", type: "income", icon: "fa-arrow-right-to-bracket" }
                ]
            };
        }
        
        // Jembatan pengaman: jika data lama sudah ada tapi belum punya array categories
        const parsed = JSON.parse(raw);
        if (!parsed.categories) {
            parsed.categories = [
                { id: "cat_1", name: "Makanan", type: "expense", icon: "fa-utensils" },
                { id: "cat_2", name: "Belanja", type: "expense", icon: "fa-bag-shopping" },
                { id: "cat_3", name: "Gaji", type: "income", icon: "fa-money-check-dollar" }
            ];
            this.saveData(parsed);
        }
        
        return parsed;
    },


    // Menyimpan data kembali ke localStorage
    saveData(data) {
        localStorage.setItem(this.KEY, JSON.stringify(data));
    },

    // Fitur Ekspor ke file JSON
    exportData() {
        const data = this.loadData();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `FinKu_Backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    },

    // Fitur Impor dari file JSON
    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.accounts && parsed.transactions && parsed.debts_receivables) {
                    this.saveData(parsed);
                    alert("Data berhasil diimpor! Aplikasi akan dimuat ulang.");
                    window.location.reload();
                } else {
                    alert("Format file JSON tidak sesuai standar FinKu.");
                }
            } catch (err) {
                alert("Gagal membaca file JSON. Pastikan file tidak rusak.");
            }
        };
        reader.readAsText(file);
    },

    // Reset total
    resetAllData() {
        if (confirm("Apakah kamu yakin ingin menghapus semua dompet dan data transaksi? Tindakan ini tidak bisa dibatalkan.")) {
            localStorage.removeItem(this.KEY);
            window.location.reload();
        }
    }
};
