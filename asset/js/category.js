// ==========================================================================
// CATEGORY MANAGEMENT LOGIC & FILTERS (category.js)
// ==========================================================================

window.currentCategoryFilter = 'all';

const kustomIcons = [
    "fa-utensils", "fa-burger", "fa-coffee", "fa-ice-cream", "fa-apple-whole",
    "fa-bag-shopping", "fa-shirt", "fa-glasses", "fa-cart-shopping", "fa-store",
    "fa-motorcycle", "fa-car", "fa-bus", "fa-plane", "fa-gas-pump", "fa-train",
    "fa-house", "fa-bolt", "fa-droplet", "fa-wifi", "fa-tv", "fa-couch",
    "fa-money-check-dollar", "fa-wallet", "fa-credit-card", "fa-money-bill-wave", "fa-chart-line",
    "fa-gamepad", "fa-film", "fa-music", "fa-ticket", "fa-book", "fa-dumbbell",
    "fa-heart-pulse", "fa-capsules", "fa-stethoscope", "fa-user-doctor", "fa-hospital",
    "fa-gift", "fa-cake-candles", "fa-tags", "fa-crown", "fa-trophy", "fa-award",
    "fa-graduation-cap", "fa-briefcase", "fa-hammer", "fa-wrench", "fa-screwdriver",
    "fa-mobile-screen-button", "fa-laptop", "fa-headphones", "fa-camera"
];

let selectedIconClass = "fa-tags";

function renderIconPicker() {
    const pickerContainer = document.getElementById('icon-picker-list');
    if (!pickerContainer) return;

    pickerContainer.innerHTML = kustomIcons.map(icon => `
        <div class="icon-option ${icon === selectedIconClass ? 'active' : ''}" 
             onclick="selectCategoryIcon('${icon}')" 
             style="display: flex; align-items: center; justify-content: center; padding: 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.05); cursor: pointer; font-size: 16px; background: ${icon === selectedIconClass ? 'var(--primary-light)' : 'var(--bg-card)'}; color: ${icon === selectedIconClass ? 'var(--primary)' : 'var(--text-main)'};">
            <i class="fa-solid ${icon}"></i>
        </div>
    `).join('');
}

function selectCategoryIcon(iconClass) {
    selectedIconClass = iconClass;
    const previewIcon = document.querySelector('#icon-preview i');
    if (previewIcon) {
        previewIcon.className = `fa-solid ${iconClass}`;
    }
    renderIconPicker();
}

window.filterCategoryList = function(type) {
    window.currentCategoryFilter = type;
    
    document.querySelectorAll('.filter-pill, [id^="filter-cat-"]').forEach(btn => {
        btn.style.background = 'var(--bg-card)';
        btn.style.color = 'var(--text-muted)';
        btn.style.borderColor = 'var(--border)';
    });

    const activeBtn = document.getElementById(`filter-cat-${type}`);
    if (activeBtn) {
        // FIX BUG 9: Ubah background filter kategori aktif menjadi Maroon
        activeBtn.style.background = '#800020';
        activeBtn.style.color = '#ffffff';
        activeBtn.style.borderColor = '#800020';
    }

    window.renderDaftarKategori();
};

window.setCategoryFilter = function(type) {
    window.filterCategoryList(type);
};

window.renderDaftarKategori = function() {
    const container = document.getElementById('list-kategori');
    if (!container) return;

    let categoriesList = [];
    if (typeof app !== 'undefined' && app.categories) {
        categoriesList = app.categories;
    } else if (typeof storage !== 'undefined') {
        categoriesList = storage.loadData().categories || [];
    }

    if (categoriesList.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-size:13px; padding: 20px 0;">Belum ada data kategori.</p>`;
        return;
    }

    const filtered = categoriesList.filter(cat => {
        if (window.currentCategoryFilter === 'all') return true;
        return cat.type === window.currentCategoryFilter;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-size:13px; padding: 20px 0;">Kategori tidak ditemukan.</p>`;
        return;
    }

    container.innerHTML = filtered.map(cat => {
        const isIncome = cat.type === 'income';
        const badgeColor = isIncome ? 'var(--success)' : 'var(--danger)';
        const labelText = isIncome ? 'Pemasukan' : 'Pengeluaran';

        return `
            <div class="item-card" style="border-left: 5px solid ${badgeColor}; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-card); padding: 12px 16px; border-radius: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div class="item-info" style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 40px; height: 40px; background-color: var(--primary-light); color: var(--primary); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 16px;">
                        <i class="fa-solid ${cat.icon || 'fa-tags'}"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 14px; font-weight: 700; color: var(--text-main);">${cat.name}</h4>
                        <span style="font-size: 11px; color: ${badgeColor}; font-weight: 600;">${labelText}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button onclick="window.openEditKategori('${cat.id}')" style="background:none; border:none; color:var(--text-muted); padding:8px; cursor:pointer; font-size:14px;"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="if(confirm('Hapus kategori ini?')) { app.deleteData('kategori', '${cat.id}'); }" style="background:none; border:none; color:var(--danger); padding:8px; cursor:pointer; font-size:14px;"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `;
    }).join('');
};

window.openEditKategori = function(id) {
    const categoriesList = (typeof app !== 'undefined' ? app.categories : storage.loadData().categories) || [];
    const cat = categoriesList.find(c => c.id === id);
    if (!cat) return;

    const titleEl = document.getElementById('modal-kategori-title');
    if (titleEl) titleEl.innerText = "Edit Kategori";
    
    let editIdInput = document.getElementById('edit-cat-id');
    if (!editIdInput) {
        editIdInput = document.createElement('input');
        editIdInput.type = 'hidden';
        editIdInput.id = 'edit-cat-id';
        const formKategori = document.getElementById('form-kategori') || document.getElementById('form-tambah-kategori');
        if (formKategori) formKategori.appendChild(editIdInput);
    }
    editIdInput.value = cat.id;

    const inputName = document.getElementById('cat-name') || document.getElementById('kategori-nama');
    const inputType = document.getElementById('cat-type') || document.getElementById('kategori-jenis');
    if (inputName) inputName.value = cat.name;
    if (inputType) inputType.value = cat.type;
    
    selectCategoryIcon(cat.icon || 'fa-tags');
    if (typeof ui !== 'undefined') ui.openModal('modal-kategori');
};

window.openModalKategori = function() {
    const titleEl = document.getElementById('modal-kategori-title');
    if (titleEl) titleEl.innerText = "Tambah Kategori Baru";
    const editIdInput = document.getElementById('edit-cat-id');
    if (editIdInput) editIdInput.value = '';
    
    const formKategori = document.getElementById('form-kategori') || document.getElementById('form-tambah-kategori');
    if (formKategori) formKategori.reset();
    selectCategoryIcon('fa-tags');
    if (typeof ui !== 'undefined') ui.openModal('modal-kategori');
};

window.openQuickTransaction = function(type, categoryId) {
    if (typeof app !== 'undefined' && app.accounts.length === 0) {
        alert("Silahkan buat dompet/akun terlebih dahulu!");
        return;
    }

    if (typeof ui !== 'undefined') ui.openModal('modal-transaksi');

    const modalTitle = document.getElementById('modal-transaksi-title');
    if (modalTitle) modalTitle.innerText = "Catat Transaksi";
    
    const editTxId = document.getElementById('edit-tx-id');
    if (editTxId) editTxId.value = '';

    const selectJenis = document.getElementById('tx-jenis') || document.getElementById('transaksi-jenis');
    if (selectJenis) selectJenis.value = type;

    window.updateModalCategoryOptions();

    const selectKeterangan = document.getElementById('tx-keterangan') || document.getElementById('transaksi-kategori');
    if (selectKeterangan) selectKeterangan.value = categoryId;

    const inputDate = document.getElementById('tx-date') || document.getElementById('transaksi-tanggal');
    if (inputDate) inputDate.value = new Date().toISOString().split('T')[0];
    
    const nominal = document.getElementById('tx-nominal') || document.getElementById('transaksi-nominal');
    if (nominal) nominal.value = '';
    const desc = document.getElementById('tx-deskripsi-tambahan') || document.getElementById('transaksi-deskripsi');
    if (desc) desc.value = '';
};

window.renderQuickActions = function() {
    const incomeList = document.getElementById('quick-income-list');
    const expenseList = document.getElementById('quick-expense-list');
    if (!incomeList || !expenseList) return;

    let categoriesList = [];
    if (typeof app !== 'undefined' && app.categories) {
        categoriesList = app.categories;
    } else if (typeof storage !== 'undefined') {
        categoriesList = storage.loadData().categories || [];
    }

    const masterIncomes = categoriesList.filter(cat => cat.type === 'income');
    incomeList.innerHTML = masterIncomes.map(cat => `
        <div class="btn-wrapper" onclick="window.openQuickTransaction('income', '${cat.id}')" style="cursor: pointer; text-align: center; display: inline-block;">
            <button class="scroll-item quick-in" style="pointer-events: none;">
                <i class="fa-solid ${cat.icon || 'fa-tags'}"></i>
            </button>
            <span style="display: block; font-size: 11px; margin-top: 4px; color: var(--text-main); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65px;">${cat.name}</span>
        </div>
    `).join('');

    const masterExpenses = categoriesList.filter(cat => cat.type === 'expense');
    expenseList.innerHTML = masterExpenses.map(cat => `
        <div class="btn-wrapper" onclick="window.openQuickTransaction('expense', '${cat.id}')" style="cursor: pointer; text-align: center; display: inline-block;">
            <button class="scroll-item quick-out" style="pointer-events: none;">
                <i class="fa-solid ${cat.icon || 'fa-tags'}"></i>
            </button>
            <span style="display: block; font-size: 11px; margin-top: 4px; color: var(--text-main); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65px;">${cat.name}</span>
        </div>
    `).join('');
};

window.updateModalCategoryOptions = function() {
    const selectJenis = document.getElementById('tx-jenis') || document.getElementById('transaksi-jenis');
    const selectKeterangan = document.getElementById('tx-keterangan') || document.getElementById('transaksi-kategori');
    if (!selectJenis || !selectKeterangan) return;

    const type = selectJenis.value;
    let categoriesList = [];
    if (typeof app !== 'undefined' && app.categories) {
        categoriesList = app.categories;
    } else if (typeof storage !== 'undefined') {
        categoriesList = storage.loadData().categories || [];
    }

    const filtered = categoriesList.filter(cat => cat.type === type);
    selectKeterangan.innerHTML = filtered.map(cat => `
        <option value="${cat.id}">${cat.name}</option>
    `).join('');
};

window.addEventListener('DOMContentLoaded', () => {
    renderIconPicker();
    window.renderDaftarKategori();
    window.renderQuickActions();
    
    const selectJenis = document.getElementById('tx-jenis') || document.getElementById('transaksi-jenis');
    if (selectJenis) {
        selectJenis.addEventListener('change', window.updateModalCategoryOptions);
    }
});
