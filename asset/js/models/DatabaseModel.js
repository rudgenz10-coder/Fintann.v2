class DatabaseModel {
    constructor() {
        this.storageKey = 'finku_database_v1';
        this.init();
    }

    init() {
        if (!localStorage.getItem(this.storageKey)) {
            const initialData = {
                accounts: [
                    { id: "acc_1", name: "Dompet Tunai", balance: 500000 },
                    { id: "acc_2", name: "Bank BCA", balance: 2500000 }
                ],
                transactions: [
                    { id: "tx_1", account_id: "acc_1", type: "expense", amount: 25000, category: "Makanan", description: "Beli nasi goreng", date: new Date().toISOString().split('T')[0] },
                    { id: "tx_2", account_id: "acc_2", type: "income", amount: 3500000, category: "Gaji", description: "Gaji bulanan", date: new Date().toISOString().split('T')[0] }
                ],
                debts_receivables: [
                    { id: "debt_1", account_id: "acc_1", type: "utang", person: "Mas Agus", amount: 100000, remaining: 100000, status: "unpaid", created_at: new Date().toISOString() }
                ],
                categories: [
                    { id: "cat_1", name: "Makanan", type: "expense", icon: "fa-utensils" },
                    { id: "cat_2", name: "Belanja", type: "expense", icon: "fa-bag-shopping" },
                    { id: "cat_3", name: "Gaji", type: "income", icon: "fa-money-check-dollar" },
                    { id: "cat_4", name: "Transport", type: "expense", icon: "fa-bus" }
                ]
            };
            this.save(initialData);
        }
    }

    getData() {
        return JSON.parse(localStorage.getItem(this.storageKey));
    }

    save(data) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
    }
}
