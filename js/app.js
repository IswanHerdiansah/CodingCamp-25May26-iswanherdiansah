/* ============================================================
   Visualisasi Pengeluaran & Anggaran — app.js
   Firebase Authentication + Realtime Database
   Data tersimpan di cloud → bisa login dari device manapun
   ============================================================ */

'use strict';

/* ── Firebase config ─────────────────────────────────────── */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getDatabase, ref, set, get, push, remove, onValue, off
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey:            'AIzaSyDG8ckz6TaxUIwP_-ontwvFVfxH17vMvtI',
  authDomain:        'budget-visualizer-59dae.firebaseapp.com',
  databaseURL:       'https://budget-visualizer-59dae-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'budget-visualizer-59dae',
  storageBucket:     'budget-visualizer-59dae.firebasestorage.app',
  messagingSenderId: '101826051807',
  appId:             '1:101826051807:web:0e6e2f651d6ac3100b736a',
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getDatabase(firebaseApp);

/* ── Kategori bawaan ─────────────────────────────────────── */
const BUILTIN_CATEGORIES = {
  Makanan:      { emoji: '🍔', color: '#f97316', cssClass: 'food' },
  Transportasi: { emoji: '🚌', color: '#3b82f6', cssClass: 'transport' },
  Hiburan:      { emoji: '🎉', color: '#a855f7', cssClass: 'fun' },
};

/* ── State ───────────────────────────────────────────────── */
let currentUID       = null;
let transactions     = [];
let customCategories = {};
let spendLimit       = 0;
let sortOrder        = 'date-desc';
let viewYear         = new Date().getFullYear();
let viewMonth        = new Date().getMonth();
let chart            = null;
let dbListeners      = [];   // untuk unsubscribe saat logout

/* ── Utilitas ────────────────────────────────────────────── */
const KEY_THEME = 'bv_theme';
const lsGet = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const lsSet = (k, v)  => localStorage.setItem(k, JSON.stringify(v));

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function formatCurrency(v) {
  return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(v);
}
function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ── DB helpers ──────────────────────────────────────────── */
const userRef  = (path) => ref(db, `users/${currentUID}/${path}`);

async function dbSet(path, value)   { await set(userRef(path), value); }
async function dbGet(path)          { const s = await get(userRef(path)); return s.exists() ? s.val() : null; }
async function dbPush(path, value)  { return await push(userRef(path), value); }
async function dbRemove(path)       { await remove(userRef(path)); }

function dbListen(path, cb) {
  const r = userRef(path);
  onValue(r, cb);
  dbListeners.push(r);
}
function dbUnlistenAll() {
  dbListeners.forEach(r => off(r));
  dbListeners = [];
}

/* ============================================================
   UI HELPERS
   ============================================================ */
const authScreen  = document.getElementById('authScreen');
const appWrapper  = document.getElementById('appWrapper');
const authLoading = document.getElementById('authLoading');
const appLoading  = document.getElementById('appLoading');

function showAuthLoading(text = 'Memuat…') {
  authLoading.classList.remove('hidden');
  document.getElementById('authLoadingText').textContent = text;
}
function hideAuthLoading() { authLoading.classList.add('hidden'); }

function showAppLoading()  { appLoading.classList.remove('hidden'); }
function hideAppLoading()  { appLoading.classList.add('hidden'); }

function setAuthBtnDisabled(disabled) {
  document.getElementById('btnLogin').disabled    = disabled;
  document.getElementById('btnRegister').disabled = disabled;
}

/* ── Tab Masuk / Daftar ──────────────────────────────────── */
document.getElementById('tabLogin').addEventListener('click',    () => switchTab('login'));
document.getElementById('tabRegister').addEventListener('click', () => switchTab('register'));

function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
  document.getElementById('panelLogin').classList.toggle('hidden', !isLogin);
  document.getElementById('panelRegister').classList.toggle('hidden', isLogin);
  clearAuthErrors();
}

function clearAuthErrors() {
  ['loginEmailError','loginPasswordError','loginGlobalError',
   'regDisplayNameError','regEmailError','regPasswordError','regPasswordConfirmError','regGlobalError']
    .forEach(id => { const el=document.getElementById(id); if(el) el.textContent=''; });
  ['loginEmail','loginPassword','regDisplayName','regEmail','regPassword','regPasswordConfirm']
    .forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('is-invalid'); });
}

function setAuthError(inputId, errorId, msg) {
  const inp=document.getElementById(inputId), err=document.getElementById(errorId);
  if(inp) inp.classList.add('is-invalid');
  if(err) err.textContent = msg;
}

/* ── Toggle tampilkan kata sandi ─────────────────────────── */
function bindEye(btnId, inputId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
}
bindEye('toggleLoginPwd',      'loginPassword');
bindEye('toggleRegPwd',        'regPassword');
bindEye('toggleRegPwdConfirm', 'regPasswordConfirm');

/* ============================================================
   AUTENTIKASI — DAFTAR
   ============================================================ */
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthErrors();

  const displayName = document.getElementById('regDisplayName').value.trim();
  const email       = document.getElementById('regEmail').value.trim();
  const password    = document.getElementById('regPassword').value;
  const confirm     = document.getElementById('regPasswordConfirm').value;
  let valid = true;

  if (!displayName) {
    setAuthError('regDisplayName','regDisplayNameError','Nama tampilan wajib diisi.'); valid=false;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setAuthError('regEmail','regEmailError','Masukkan email yang valid.'); valid=false;
  }
  if (!password || password.length < 6) {
    setAuthError('regPassword','regPasswordError','Minimal 6 karakter.'); valid=false;
  }
  if (password && confirm !== password) {
    setAuthError('regPasswordConfirm','regPasswordConfirmError','Kata sandi tidak cocok.'); valid=false;
  }
  if (!valid) return;

  showAuthLoading('Membuat akun…');
  setAuthBtnDisabled(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    // simpan displayName ke DB juga
    currentUID = cred.user.uid;
    await dbSet('profile/displayName', displayName);
  } catch (err) {
    hideAuthLoading();
    setAuthBtnDisabled(false);
    const msg = err.code === 'auth/email-already-in-use'
      ? 'Email sudah digunakan. Silakan masuk atau pakai email lain.'
      : `Gagal membuat akun: ${err.message}`;
    document.getElementById('regGlobalError').textContent = msg;
  }
});

/* ============================================================
   AUTENTIKASI — MASUK
   ============================================================ */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthErrors();

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  let valid = true;

  if (!email) { setAuthError('loginEmail','loginEmailError','Email wajib diisi.'); valid=false; }
  if (!password) { setAuthError('loginPassword','loginPasswordError','Kata sandi wajib diisi.'); valid=false; }
  if (!valid) return;

  showAuthLoading('Masuk…');
  setAuthBtnDisabled(true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    hideAuthLoading();
    setAuthBtnDisabled(false);
    const code = err.code;
    const msg =
      code === 'auth/user-not-found'   ? 'Email tidak terdaftar.' :
      code === 'auth/wrong-password'   ? 'Kata sandi salah.' :
      code === 'auth/invalid-credential' ? 'Email atau kata sandi salah.' :
      code === 'auth/too-many-requests'  ? 'Terlalu banyak percobaan. Coba lagi nanti.' :
      `Gagal masuk: ${err.message}`;
    document.getElementById('loginGlobalError').textContent = msg;
  }
});

/* ── Tombol Keluar ───────────────────────────────────────── */
document.getElementById('btnLogout').addEventListener('click', async () => {
  dbUnlistenAll();
  await signOut(auth);
});

/* ============================================================
   AUTH STATE OBSERVER — inti sinkronisasi
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  hideAuthLoading();
  setAuthBtnDisabled(false);

  if (user) {
    /* ── Login berhasil ── */
    currentUID = user.uid;
    const displayName = user.displayName || user.email.split('@')[0];

    authScreen.classList.add('hidden');
    appWrapper.classList.remove('hidden');
    showAppLoading();

    document.getElementById('userNameDisplay').textContent = displayName;
    document.getElementById('userAvatar').textContent = displayName.charAt(0).toUpperCase();

    applyTheme(lsGet(KEY_THEME, 'light'));

    // Reset state
    transactions = []; customCategories = {}; spendLimit = 0;
    sortOrder = 'date-desc';
    viewYear  = new Date().getFullYear();
    viewMonth = new Date().getMonth();
    if (chart) { chart.destroy(); chart = null; }

    // Muat data dari DB lalu pasang listener realtime
    await loadAllUserData();
    hideAppLoading();
    populateCategorySelect();
    render();
    attachRealtimeListeners();

  } else {
    /* ── Logout ── */
    currentUID = null;
    transactions = []; customCategories = {}; spendLimit = 0;
    if (chart) { chart.destroy(); chart = null; }

    // Reset kategori select
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
  }
});

/* ── Muat semua data pengguna dari DB ────────────────────── */
async function loadAllUserData() {
  const [txSnap, catSnap, limitSnap] = await Promise.all([
    dbGet('transactions'),
    dbGet('categories'),
    dbGet('settings/spendLimit'),
  ]);

  // Transaksi: DB menyimpan sebagai object {id: {...}}
  transactions = txSnap
    ? Object.entries(txSnap).map(([id, val]) => ({ id, ...val }))
        .sort((a,b) => new Date(b.date) - new Date(a.date))
    : [];

  customCategories = catSnap || {};
  spendLimit       = limitSnap || 0;

  const limitInput = document.getElementById('spendLimit');
  if (limitInput) limitInput.value = spendLimit || '';
}

/* ── Listener realtime (sinkron antar device) ────────────── */
function attachRealtimeListeners() {
  // Transaksi
  dbListen('transactions', (snap) => {
    const val = snap.val();
    transactions = val
      ? Object.entries(val).map(([id, v]) => ({ id, ...v }))
          .sort((a,b) => new Date(b.date) - new Date(a.date))
      : [];
    render();
  });

  // Kategori kustom
  dbListen('categories', (snap) => {
    customCategories = snap.val() || {};
    populateCategorySelect();
    renderChart();
  });

  // Batas pengeluaran
  dbListen('settings/spendLimit', (snap) => {
    spendLimit = snap.val() || 0;
    const limitInput = document.getElementById('spendLimit');
    if (limitInput && document.activeElement !== limitInput) {
      limitInput.value = spendLimit || '';
    }
    renderList();
  });
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
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

/* ============================================================
   BATAS PENGELUARAN
   ============================================================ */
document.getElementById('spendLimit').addEventListener('change', async (e) => {
  const val = parseFloat(e.target.value);
  spendLimit = (!isNaN(val) && val > 0) ? val : 0;
  if (currentUID) await dbSet('settings/spendLimit', spendLimit);
  renderList();
});

/* ============================================================
   VALIDASI TRANSAKSI
   ============================================================ */
const inputName     = document.getElementById('itemName');
const inputAmount   = document.getElementById('amount');
const inputCategory = document.getElementById('category');
const nameError     = document.getElementById('nameError');
const amountError   = document.getElementById('amountError');
const categoryError = document.getElementById('categoryError');

function clearErrors() {
  [inputName, inputAmount, inputCategory].forEach(el => el.classList.remove('is-invalid'));
  nameError.textContent = amountError.textContent = categoryError.textContent = '';
}

function validate(name, amount, category) {
  let valid = true;
  if (!name.trim()) {
    inputName.classList.add('is-invalid'); nameError.textContent = 'Nama item wajib diisi.'; valid=false;
  }
  const parsed = parseFloat(amount);
  if (!amount || isNaN(parsed) || parsed <= 0) {
    inputAmount.classList.add('is-invalid'); amountError.textContent = 'Masukkan jumlah yang valid (lebih dari 0).'; valid=false;
  }
  if (!category) {
    inputCategory.classList.add('is-invalid'); categoryError.textContent = 'Silakan pilih kategori.'; valid=false;
  }
  return valid;
}

/* ============================================================
   TAMBAH TRANSAKSI
   ============================================================ */
document.getElementById('transactionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUID) return;
  clearErrors();

  const name     = inputName.value;
  const amount   = inputAmount.value;
  const category = inputCategory.value;
  if (!validate(name, amount, category)) return;

  const tx = {
    name:     name.trim(),
    amount:   parseFloat(parseFloat(amount).toFixed(2)),
    category,
    date:     new Date().toISOString(),
  };

  await dbPush('transactions', tx);   // realtime listener akan update UI otomatis
  document.getElementById('transactionForm').reset();
  document.getElementById('spendLimit').value = spendLimit || '';
  inputName.focus();
});

/* ============================================================
   HAPUS TRANSAKSI
   ============================================================ */
async function deleteTransaction(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    el.style.opacity = '0'; el.style.transform = 'translateX(14px)';
  }
  await dbRemove(`transactions/${id}`);
}

/* ============================================================
   URUTAN
   ============================================================ */
document.getElementById('sortSelect').addEventListener('change', (e) => {
  sortOrder = e.target.value; renderList();
});

function getSorted() {
  const list = [...transactions];
  switch (sortOrder) {
    case 'date-asc':     return list.sort((a,b) => new Date(a.date)-new Date(b.date));
    case 'amount-desc':  return list.sort((a,b) => b.amount-a.amount);
    case 'amount-asc':   return list.sort((a,b) => a.amount-b.amount);
    case 'category-asc': return list.sort((a,b) => a.category.localeCompare(b.category));
    default:             return list;
  }
}

/* ============================================================
   NAVIGASI BULAN
   ============================================================ */
document.getElementById('prevMonth').addEventListener('click', () => {
  viewMonth--; if (viewMonth < 0) { viewMonth=11; viewYear--; } renderSummary();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  viewMonth++; if (viewMonth > 11) { viewMonth=0; viewYear++; } renderSummary();
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
  customCatName.value=''; customCatEmoji.value=''; customCatColor.value='#10b981';
  customCatError.textContent='';
  modalBackdrop.setAttribute('aria-hidden','false');
  modalBackdrop.classList.add('open');
  customCatName.focus();
}
function closeModalFn() {
  modalBackdrop.classList.remove('open');
  modalBackdrop.setAttribute('aria-hidden','true');
}

document.getElementById('openAddCategory').addEventListener('click', openModal);
document.getElementById('closeModal').addEventListener('click', closeModalFn);
document.getElementById('cancelModal').addEventListener('click', closeModalFn);
modalBackdrop.addEventListener('click', (e) => { if(e.target===modalBackdrop) closeModalFn(); });
document.addEventListener('keydown', (e) => { if(e.key==='Escape') closeModalFn(); });

document.getElementById('saveCategory').addEventListener('click', async () => {
  const name  = customCatName.value.trim();
  const emoji = customCatEmoji.value.trim() || '📦';
  const color = customCatColor.value;
  customCatError.textContent = '';

  if (!name) { customCatError.textContent='Nama kategori wajib diisi.'; customCatName.focus(); return; }
  if (allCategories()[name]) { customCatError.textContent='Kategori ini sudah ada.'; customCatName.focus(); return; }

  await dbSet(`categories/${name}`, { emoji, color });
  inputCategory.value = name;
  closeModalFn();
});

function addCategoryOption(name, emoji) {
  if (document.querySelector(`#category option[value="${CSS.escape(name)}"]`)) return;
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = `${emoji} ${name}`;
  inputCategory.appendChild(opt);
}

function populateCategorySelect() {
  Array.from(inputCategory.options).forEach(opt => {
    if (opt.value && !BUILTIN_CATEGORIES[opt.value]) opt.remove();
  });
  Object.entries(customCategories).forEach(([name, meta]) => addCategoryOption(name, meta.emoji));
}

/* ── Kategori helper ─────────────────────────────────────── */
function allCategories() {
  const custom = {};
  Object.entries(customCategories).forEach(([n,m]) => { custom[n]={...m,cssClass:'custom'}; });
  return { ...BUILTIN_CATEGORIES, ...custom };
}
function getMeta(cat) {
  return allCategories()[cat] || { emoji:'📦', color:'#6b7280', cssClass:'custom' };
}

/* ============================================================
   RENDER
   ============================================================ */
function render() { renderBalance(); renderList(); renderChart(); renderSummary(); }

function renderBalance() {
  const total = transactions.reduce((s,t) => s+t.amount, 0);
  document.getElementById('totalBalance').textContent = formatCurrency(total);
}

function renderList() {
  const sorted = getSorted();
  const count  = sorted.length;
  const list   = document.getElementById('transactionList');
  const empty  = document.getElementById('emptyState');

  document.getElementById('transactionCount').textContent = `${count} item`;
  Array.from(list.children).forEach(c => { if(!c.classList.contains('empty-state')) c.remove(); });

  if (count === 0) { empty.style.display='flex'; return; }
  empty.style.display = 'none';

  // Kelompokkan per tanggal
  const groups = {};
  sorted.forEach(t => {
    const dateKey = new Date(t.date).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    if (!groups[dateKey]) groups[dateKey] = { transactions: [], total: 0, rawDate: t.date };
    groups[dateKey].transactions.push(t);
    groups[dateKey].total += t.amount;
  });

  Object.entries(groups).forEach(([dateLabel, group]) => {
    // Header tanggal
    const header = document.createElement('div');
    header.className = 'date-group-header';
    header.innerHTML = `
      <span class="date-group-label">${dateLabel}</span>
      <span class="date-group-total">${formatCurrency(group.total)}</span>
    `;
    list.appendChild(header);

    // Transaksi dalam grup ini
    group.transactions.forEach(t => {
      const meta      = getMeta(t.category);
      const overLimit = spendLimit > 0 && t.amount > spendLimit;
      const item      = document.createElement('div');
      item.className  = 'transaction-item' + (overLimit ? ' over-limit' : '');
      item.dataset.id = t.id;

      const iconStyle = meta.cssClass==='custom' ? `style="background:${hexToRgba(meta.color,0.12)}"` : '';
      const catStyle  = meta.cssClass==='custom' ? `style="color:${meta.color}"` : '';

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
      list.appendChild(item);
    });
  });
}

function renderChart() {
  const canvas = document.getElementById('spendingChart');
  const empty  = document.getElementById('chartEmpty');
  const legend = document.getElementById('chartLegend');
  const totals = {};
  transactions.forEach(t => { totals[t.category] = (totals[t.category]||0) + t.amount; });
  const cats   = Object.keys(totals);
  empty.classList.toggle('hidden', cats.length > 0);
  const colors    = cats.map(c => getMeta(c).color);
  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const tooltipBg = isDark ? '#22263a' : '#1e2235';

  if (chart) {
    chart.data.labels = cats;
    chart.data.datasets[0].data = cats.map(c=>totals[c]);
    chart.data.datasets[0].backgroundColor = colors;
    chart.options.plugins.tooltip.backgroundColor = tooltipBg;
    chart.update();
  } else {
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: cats.map(c=>totals[c]), backgroundColor: colors,
              borderColor:'transparent', borderWidth:3, hoverOffset:8 }] },
      options: { responsive:true, maintainAspectRatio:true, cutout:'62%',
        plugins: { legend:{display:false},
          tooltip: { callbacks: { label(ctx) {
            const tot=ctx.dataset.data.reduce((a,b)=>a+b,0);
            const pct=tot>0?((ctx.parsed/tot)*100).toFixed(1):0;
            return ` ${formatCurrency(ctx.parsed)}  (${pct}%)`;
          }}, backgroundColor:tooltipBg, titleColor:'#fff', bodyColor:'#d1d5db', padding:10, cornerRadius:8 }},
        animation:{duration:350,easing:'easeInOutQuart'} },
    });
  }
  legend.innerHTML = '';
  cats.forEach(cat => {
    const el = document.createElement('div'); el.className='legend-item';
    el.innerHTML=`<span class="legend-dot" style="background:${getMeta(cat).color}"></span>
      <span>${escapeHtml(cat)}: <strong>${formatCurrency(totals[cat])}</strong></span>`;
    legend.appendChild(el);
  });
}

function renderSummary() {
  const MONTHS=['Januari','Februari','Maret','April','Mei','Juni',
                'Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('monthLabel').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  const monthTx = transactions.filter(t => {
    const d=new Date(t.date); return d.getFullYear()===viewYear && d.getMonth()===viewMonth;
  });
  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = '';
  if (monthTx.length===0) { grid.innerHTML='<div class="summary-empty">Tidak ada transaksi bulan ini.</div>'; return; }
  const total = monthTx.reduce((s,t)=>s+t.amount,0);
  appendSummaryItem(grid,'Total',formatCurrency(total),`${monthTx.length} transaksi`,true);
  const byCat={};
  monthTx.forEach(t => { if(!byCat[t.category]) byCat[t.category]={sum:0,count:0}; byCat[t.category].sum+=t.amount; byCat[t.category].count++; });
  Object.entries(byCat).sort((a,b)=>b[1].sum-a[1].sum).forEach(([cat,{sum,count}]) => {
    appendSummaryItem(grid,`${getMeta(cat).emoji} ${cat}`,formatCurrency(sum),`${count} item`,false);
  });
}

function appendSummaryItem(parent,label,value,sub,isTotal) {
  const el=document.createElement('div');
  el.className='summary-item'+(isTotal?' summary-total':'');
  el.innerHTML=`<div class="summary-item-label">${escapeHtml(label)}</div>
    <div class="summary-item-value">${value}</div>
    <div class="summary-item-count">${sub}</div>`;
  parent.appendChild(el);
}

/* ── Init tema sebelum login ─────────────────────────────── */
applyTheme(lsGet(KEY_THEME, 'light'));
