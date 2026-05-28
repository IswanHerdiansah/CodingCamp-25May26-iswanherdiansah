/* ============================================================
   Visualisasi Pengeluaran & Anggaran — app.js

   Sistem autentikasi:
   • Daftar / Masuk dengan nama pengguna & kata sandi
   • Kata sandi di-hash dengan SHA-256 (Web Crypto API)
     → tidak pernah disimpan sebagai teks biasa
   • Setiap pengguna punya namespace LocalStorage sendiri
   • Sesi disimpan di sessionStorage (hilang saat tab ditutup)

   Fitur aplikasi:
   ✔ Tambah / hapus transaksi
   ✔ Penyimpanan LocalStorage per pengguna
   ✔ Grafik donat
   ✔ Total pengeluaran
   ✔ Kategori kustom
   ✔ Ringkasan bulanan
   ✔ Urutkan transaksi
   ✔ Sorot melebihi batas
   ✔ Mode gelap / terang
   ============================================================ */

'use strict';

/* ── Kunci penyimpanan global ─────────────────────────────── */
const KEY_USERS   = 'bv_users';          // { username: { hash } }
const KEY_SESSION = 'bv_session';        // sessionStorage: username aktif
const KEY_THEME   = 'bv_theme';          // localStorage: preferensi tema

/* ── Kunci penyimpanan per pengguna ──────────────────────── */
const userKey = (username, suffix) => `bv_u_${username}_${suffix}`;

/* ── Kategori bawaan ─────────────────────────────────────── */
const BUILTIN_CATEGORIES = {
  Makanan:      { emoji: '🍔', color: '#f97316', cssClass: 'food' },
  Transportasi: { emoji: '🚌', color: '#3b82f6', cssClass: 'transport' },
  Hiburan:      { emoji: '🎉', color: '#a855f7', cssClass: 'fun' },
};

/* ── Status aplikasi ─────────────────────────────────────── */
let currentUser      = null;   // string: nama pengguna yang sedang login
let transactions     = [];
let customCategories = {};
let spendLimit       = 0;
let sortOrder        = 'date-desc';
let viewYear         = new Date().getFullYear();
let viewMonth        = new Date().getMonth();
let chart            = null;

/* ============================================================
   UTILITAS UMUM
   ============================================================ */
function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', minimumFractionDigits: 0,
  }).format(value);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── SHA-256 via Web Crypto API ──────────────────────────── */
async function sha256(text) {
  const buf    = await crypto.subtle.digest('SHA-256',
                   new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================================
   AUTENTIKASI
   ============================================================ */
const authScreen  = document.getElementById('authScreen');
const appWrapper  = document.getElementById('appWrapper');

/* Tab Masuk / Daftar */
const tabLogin    = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const panelLogin  = document.getElementById('panelLogin');
const panelRegister = document.getElementById('panelRegister');

tabLogin.addEventListener('click', () => switchTab('login'));
tabRegister.addEventListener('click', () => switchTab('register'));

function switchTab(tab) {
  const isLogin = tab === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  panelLogin.classList.toggle('hidden', !isLogin);
  panelRegister.classList.toggle('hidden', isLogin);
  clearAuthErrors();
}

function clearAuthErrors() {
  ['loginUsernameError','loginPasswordError','loginGlobalError',
   'regUsernameError','regPasswordError','regPasswordConfirmError','regGlobalError']
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  ['loginUsername','loginPassword','regUsername','regPassword','regPasswordConfirm']
    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('is-invalid'); });
}

/* ── Tampilkan / sembunyikan kata sandi ─────────────────── */
function bindEyeToggle(btnId, inputId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
}
bindEyeToggle('toggleLoginPwd',       'loginPassword');
bindEyeToggle('toggleRegPwd',         'regPassword');
bindEyeToggle('toggleRegPwdConfirm',  'regPasswordConfirm');

/* ── Formulir Daftar ─────────────────────────────────────── */
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthErrors();

  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regPasswordConfirm').value;
  let valid = true;

  if (!username) {
    setAuthError('regUsername', 'regUsernameError', 'Nama pengguna wajib diisi.');
    valid = false;
  } else if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    setAuthError('regUsername', 'regUsernameError',
      'Hanya huruf, angka, dan _ (3–32 karakter).');
    valid = false;
  }

  if (!password) {
    setAuthError('regPassword', 'regPasswordError', 'Kata sandi wajib diisi.');
    valid = false;
  } else if (password.length < 6) {
    setAuthError('regPassword', 'regPasswordError', 'Minimal 6 karakter.');
    valid = false;
  }

  if (password && confirm !== password) {
    setAuthError('regPasswordConfirm', 'regPasswordConfirmError',
      'Kata sandi tidak cocok.');
    valid = false;
  }

  if (!valid) return;

  const users = lsGet(KEY_USERS, {});
  if (users[username.toLowerCase()]) {
    document.getElementById('regGlobalError').textContent =
      'Nama pengguna sudah digunakan. Silakan pilih yang lain.';
    return;
  }

  const hash = await sha256(password);
  users[username.toLowerCase()] = { hash, displayName: username };
  lsSet(KEY_USERS, users);

  // Langsung masuk setelah daftar
  startSession(username);
});

/* ── Formulir Masuk ──────────────────────────────────────── */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthErrors();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  let valid = true;

  if (!username) {
    setAuthError('loginUsername', 'loginUsernameError', 'Nama pengguna wajib diisi.');
    valid = false;
  }
  if (!password) {
    setAuthError('loginPassword', 'loginPasswordError', 'Kata sandi wajib diisi.');
    valid = false;
  }
  if (!valid) return;

  const users = lsGet(KEY_USERS, {});
  const record = users[username.toLowerCase()];

  if (!record) {
    document.getElementById('loginGlobalError').textContent =
      'Nama pengguna tidak ditemukan.';
    return;
  }

  const hash = await sha256(password);
  if (hash !== record.hash) {
    document.getElementById('loginGlobalError').textContent =
      'Kata sandi salah.';
    setAuthError('loginPassword', 'loginPasswordError', '');
    return;
  }

  startSession(record.displayName);
});

function setAuthError(inputId, errorId, msg) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errorId);
  if (inp) inp.classList.add('is-invalid');
  if (err) err.textContent = msg;
}

/* ── Sesi ────────────────────────────────────────────────── */
function startSession(username) {
  currentUser = username;
  sessionStorage.setItem(KEY_SESSION, username);
  loadUserData();
  showApp();
}

function showApp() {
  authScreen.classList.add('hidden');
  appWrapper.classList.remove('hidden');

  // Tampilkan nama & avatar
  document.getElementById('userNameDisplay').textContent = currentUser;
  document.getElementById('userAvatar').textContent = currentUser.charAt(0).toUpperCase();

  applyTheme(lsGet(KEY_THEME, 'light'));
  populateCategorySelect();
  render();
}

function loadUserData() {
  transactions     = lsGet(userKey(currentUser, 'transactions'), []);
  customCategories = lsGet(userKey(currentUser, 'categories'),   {});
  spendLimit       = lsGet(userKey(currentUser, 'limit'),        0);
  // Reset chart agar tidak bocor antar pengguna
  if (chart) { chart.destroy(); chart = null; }
  sortOrder  = 'date-desc';
  viewYear   = new Date().getFullYear();
  viewMonth  = new Date().getMonth();
}

function saveUserData(suffix, value) {
  lsSet(userKey(currentUser, suffix), value);
}

/* ── Tombol Keluar ───────────────────────────────────────── */
document.getElementById('btnLogout').addEventListener('click', () => {
  sessionStorage.removeItem(KEY_SESSION);
  currentUser = null;
  transactions = [];
  customCategories = {};
  spendLimit = 0;
  if (chart) { chart.destroy(); chart = null; }

  // Reset formulir kategori
  const catSel = document.getElementById('category');
  Array.from(catSel.options).forEach(opt => {
    if (opt.value && !BUILTIN_CATEGORIES[opt.value]) opt.remove();
  });
  catSel.value = '';

  appWrapper.classList.add('hidden');
  authScreen.classList.remove('hidden');
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
  clearAuthErrors();
  switchTab('login');
});

/* ── Cek sesi yang sudah ada ─────────────────────────────── */
const savedSession = sessionStorage.getItem(KEY_SESSION);
if (savedSession) {
  const users = lsGet(KEY_USERS, {});
  if (users[savedSession.toLowerCase()]) {
    startSession(users[savedSession.toLowerCase()].displayName);
  }
}

/* ============================================================
   TEMA
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
  lsSet(KEY_THEME, theme);
  if (chart) renderChart();
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ============================================================
   BATAS PENGELUARAN
   ============================================================ */
const inputLimit = document.getElementById('spendLimit');

inputLimit.addEventListener('change', () => {
  const val = parseFloat(inputLimit.value);
  spendLimit = (!isNaN(val) && val > 0) ? val : 0;
  saveUserData('limit', spendLimit);
  renderList();
});

/* ============================================================
   VALIDASI FORMULIR TRANSAKSI
   ============================================================ */
const nameError     = document.getElementById('nameError');
const amountError   = document.getElementById('amountError');
const categoryError = document.getElementById('categoryError');
const inputName     = document.getElementById('itemName');
const inputAmount   = document.getElementById('amount');
const inputCategory = document.getElementById('category');

function clearErrors() {
  [inputName, inputAmount, inputCategory].forEach(el => el.classList.remove('is-invalid'));
  nameError.textContent = '';
  amountError.textContent = '';
  categoryError.textContent = '';
}

function validate(name, amount, category) {
  let valid = true;
  if (!name.trim()) {
    inputName.classList.add('is-invalid');
    nameError.textContent = 'Nama item wajib diisi.';
    valid = false;
  }
  const parsed = parseFloat(amount);
  if (!amount || isNaN(parsed) || parsed <= 0) {
    inputAmount.classList.add('is-invalid');
    amountError.textContent = 'Masukkan jumlah yang valid (lebih dari 0).';
    valid = false;
  }
  if (!category) {
    inputCategory.classList.add('is-invalid');
    categoryError.textContent = 'Silakan pilih kategori.';
    valid = false;
  }
  return valid;
}

/* ============================================================
   FORMULIR TAMBAH TRANSAKSI
   ============================================================ */
document.getElementById('transactionForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentUser) return;
  clearErrors();

  const name     = inputName.value;
  const amount   = inputAmount.value;
  const category = inputCategory.value;

  if (!validate(name, amount, category)) return;

  transactions.unshift({
    id:       crypto.randomUUID(),
    name:     name.trim(),
    amount:   parseFloat(parseFloat(amount).toFixed(2)),
    category,
    date:     new Date().toISOString(),
  });

  saveUserData('transactions', transactions);
  render();
  document.getElementById('transactionForm').reset();
  inputLimit.value = spendLimit || '';
  inputName.focus();
});

/* ============================================================
   HAPUS TRANSAKSI
   ============================================================ */
function deleteTransaction(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  el.style.opacity = '0';
  el.style.transform = 'translateX(14px)';
  setTimeout(() => {
    transactions = transactions.filter(t => t.id !== id);
    saveUserData('transactions', transactions);
    render();
  }, 180);
}

/* ============================================================
   URUTAN
   ============================================================ */
document.getElementById('sortSelect').addEventListener('change', (e) => {
  sortOrder = e.target.value;
  renderList();
});

function getSorted() {
  const list = [...transactions];
  switch (sortOrder) {
    case 'date-asc':     return list.sort((a, b) => new Date(a.date) - new Date(b.date));
    case 'amount-desc':  return list.sort((a, b) => b.amount - a.amount);
    case 'amount-asc':   return list.sort((a, b) => a.amount - b.amount);
    case 'category-asc': return list.sort((a, b) => a.category.localeCompare(b.category));
    default:             return list;
  }
}

/* ============================================================
   NAVIGASI BULAN
   ============================================================ */
document.getElementById('prevMonth').addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderSummary();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderSummary();
});

/* ============================================================
   MODAL KATEGORI KUSTOM
   ============================================================ */
const modalBackdrop  = document.getElementById('modalBackdrop');
const customCatName  = document.getElementById('customCatName');
const customCatEmoji = document.getElementById('customCatEmoji');
const customCatColor = document.getElementById('customCatColor');
const customCatError = document.getElementById('customCatError');

function openModal() {
  customCatName.value  = '';
  customCatEmoji.value = '';
  customCatColor.value = '#10b981';
  customCatError.textContent = '';
  modalBackdrop.setAttribute('aria-hidden', 'false');
  modalBackdrop.classList.add('open');
  customCatName.focus();
}

function closeModalFn() {
  modalBackdrop.classList.remove('open');
  modalBackdrop.setAttribute('aria-hidden', 'true');
}

document.getElementById('openAddCategory').addEventListener('click', openModal);
document.getElementById('closeModal').addEventListener('click', closeModalFn);
document.getElementById('cancelModal').addEventListener('click', closeModalFn);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModalFn(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModalFn(); });

document.getElementById('saveCategory').addEventListener('click', () => {
  const name  = customCatName.value.trim();
  const emoji = customCatEmoji.value.trim() || '📦';
  const color = customCatColor.value;
  customCatError.textContent = '';

  if (!name) {
    customCatError.textContent = 'Nama kategori wajib diisi.';
    customCatName.focus();
    return;
  }
  if (allCategories()[name]) {
    customCatError.textContent = 'Kategori dengan nama ini sudah ada.';
    customCatName.focus();
    return;
  }

  customCategories[name] = { emoji, color };
  saveUserData('categories', customCategories);
  addCategoryOption(name, emoji);
  inputCategory.value = name;
  closeModalFn();
});

function addCategoryOption(name, emoji) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = `${emoji} ${name}`;
  inputCategory.appendChild(opt);
}

function populateCategorySelect() {
  Array.from(inputCategory.options).forEach(opt => {
    if (opt.value && !BUILTIN_CATEGORIES[opt.value]) opt.remove();
  });
  Object.entries(customCategories).forEach(([name, meta]) => {
    addCategoryOption(name, meta.emoji);
  });
}

/* ============================================================
   KATEGORI HELPER
   ============================================================ */
function allCategories() {
  const custom = {};
  Object.entries(customCategories).forEach(([name, meta]) => {
    custom[name] = { ...meta, cssClass: 'custom' };
  });
  return { ...BUILTIN_CATEGORIES, ...custom };
}

function getMeta(categoryName) {
  return allCategories()[categoryName] || { emoji: '📦', color: '#6b7280', cssClass: 'custom' };
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  renderBalance();
  renderList();
  renderChart();
  renderSummary();
}

/* ── Saldo ───────────────────────────────────────────────── */
function renderBalance() {
  const total = transactions.reduce((s, t) => s + t.amount, 0);
  document.getElementById('totalBalance').textContent = formatCurrency(total);
}

/* ── Daftar transaksi ────────────────────────────────────── */
function renderList() {
  const sorted = getSorted();
  const count  = sorted.length;
  const transactionList  = document.getElementById('transactionList');
  const emptyState       = document.getElementById('emptyState');
  const transactionCount = document.getElementById('transactionCount');

  transactionCount.textContent = `${count} item`;

  Array.from(transactionList.children).forEach(child => {
    if (!child.classList.contains('empty-state')) child.remove();
  });

  if (count === 0) { emptyState.style.display = 'flex'; return; }
  emptyState.style.display = 'none';

  sorted.forEach(t => {
    const meta      = getMeta(t.category);
    const overLimit = spendLimit > 0 && t.amount > spendLimit;

    const item = document.createElement('div');
    item.className = 'transaction-item' + (overLimit ? ' over-limit' : '');
    item.dataset.id = t.id;

    const iconStyle = meta.cssClass === 'custom'
      ? `style="background:${hexToRgba(meta.color, 0.12)}"` : '';
    const catStyle  = meta.cssClass === 'custom'
      ? `style="color:${meta.color}"` : '';

    item.innerHTML = `
      <div class="item-icon ${meta.cssClass}" ${iconStyle} aria-hidden="true">${meta.emoji}</div>
      <div class="item-details">
        <div class="item-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
        <div class="item-category ${meta.cssClass}" ${catStyle}>${escapeHtml(t.category)}</div>
      </div>
      ${overLimit ? '<span class="over-limit-badge">⚠ Melebihi batas</span>' : ''}
      <div class="item-amount">${formatCurrency(t.amount)}</div>
      <button class="btn-delete" aria-label="Hapus ${escapeHtml(t.name)}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>`;

    item.querySelector('.btn-delete').addEventListener('click', () => deleteTransaction(t.id));
    transactionList.appendChild(item);
  });
}

/* ── Grafik ──────────────────────────────────────────────── */
function renderChart() {
  const chartCanvas = document.getElementById('spendingChart');
  const chartEmpty  = document.getElementById('chartEmpty');
  const chartLegend = document.getElementById('chartLegend');

  const totals = {};
  transactions.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const categories = Object.keys(totals);
  chartEmpty.classList.toggle('hidden', categories.length > 0);

  const labels = categories;
  const data   = categories.map(c => totals[c]);
  const colors = categories.map(c => getMeta(c).color);

  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const tooltipBg = isDark ? '#22263a' : '#1e2235';

  if (chart) {
    chart.data.labels                              = labels;
    chart.data.datasets[0].data                   = data;
    chart.data.datasets[0].backgroundColor        = colors;
    chart.options.plugins.tooltip.backgroundColor = tooltipBg;
    chart.update();
  } else {
    chart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderColor: 'transparent',
                     borderWidth: 3, hoverOffset: 8 }],
      },
      options: {
        responsive: true, maintainAspectRatio: true, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return ` ${formatCurrency(ctx.parsed)}  (${pct}%)`;
              },
            },
            backgroundColor: tooltipBg, titleColor: '#fff',
            bodyColor: '#d1d5db', padding: 10, cornerRadius: 8,
          },
        },
        animation: { duration: 350, easing: 'easeInOutQuart' },
      },
    });
  }

  chartLegend.innerHTML = '';
  categories.forEach(cat => {
    const meta  = getMeta(cat);
    const el    = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `
      <span class="legend-dot" style="background:${meta.color}"></span>
      <span>${escapeHtml(cat)}: <strong>${formatCurrency(totals[cat])}</strong></span>`;
    chartLegend.appendChild(el);
  });
}

/* ── Ringkasan bulanan ───────────────────────────────────── */
function renderSummary() {
  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni',
                  'Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('monthLabel').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const monthTx = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });

  const summaryGrid = document.getElementById('summaryGrid');
  summaryGrid.innerHTML = '';

  if (monthTx.length === 0) {
    summaryGrid.innerHTML = '<div class="summary-empty">Tidak ada transaksi bulan ini.</div>';
    return;
  }

  const total = monthTx.reduce((s, t) => s + t.amount, 0);
  appendSummaryItem(summaryGrid, 'Total', formatCurrency(total),
    `${monthTx.length} transaksi`, true);

  const byCategory = {};
  monthTx.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = { sum: 0, count: 0 };
    byCategory[t.category].sum   += t.amount;
    byCategory[t.category].count += 1;
  });

  Object.entries(byCategory)
    .sort((a, b) => b[1].sum - a[1].sum)
    .forEach(([cat, { sum, count }]) => {
      const meta = getMeta(cat);
      appendSummaryItem(summaryGrid, `${meta.emoji} ${cat}`,
        formatCurrency(sum), `${count} item`, false);
    });
}

function appendSummaryItem(parent, label, value, sub, isTotal) {
  const el = document.createElement('div');
  el.className = 'summary-item' + (isTotal ? ' summary-total' : '');
  el.innerHTML = `
    <div class="summary-item-label">${escapeHtml(label)}</div>
    <div class="summary-item-value">${value}</div>
    <div class="summary-item-count">${sub}</div>`;
  parent.appendChild(el);
}

/* ── Inisialisasi tema (sebelum login) ───────────────────── */
applyTheme(lsGet(KEY_THEME, 'light'));
