/* ============================================================
   Dompet — Visualisasi Anggaran
   Firebase Auth + Realtime Database
   ============================================================ */
'use strict';

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
let dbListeners      = [];

/* ── Utils ───────────────────────────────────────────────── */
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

/* ── Toast ───────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: '●' };
  el.innerHTML = `<span>${icons[type]||'●'}</span><span>${msg}</span>`;
  const c = document.getElementById('toastContainer');
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

/* ── Ripple ──────────────────────────────────────────────── */
function addRipple(btn) {
  btn.addEventListener('click', function(e) {
    const r    = document.createElement('span');
    r.className = 'ripple';
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    this.appendChild(r);
    setTimeout(() => r.remove(), 600);
  });
}

/* ── DB helpers ──────────────────────────────────────────── */
const userRef  = (path) => ref(db, `users/${currentUID}/${path}`);
async function dbSet(path, value)  { await set(userRef(path), value); }
async function dbGet(path)         { const s = await get(userRef(path)); return s.exists() ? s.val() : null; }
async function dbPush(path, value) { return await push(userRef(path), value); }
async function dbRemove(path)      { await remove(userRef(path)); }
function dbListen(path, cb) {
  const r = userRef(path);
  onValue(r, cb);
  dbListeners.push(r);
}
function dbUnlistenAll() { dbListeners.forEach(r => off(r)); dbListeners = []; }

/* ── UI helpers ──────────────────────────────────────────── */
const authScreen  = document.getElementById('authScreen');
const appWrapper  = document.getElementById('appWrapper');
const authLoading = document.getElementById('authLoading');
const appLoading  = document.getElementById('appLoading');

function showAuthLoading(text='Memuat…') { authLoading.classList.remove('hidden'); document.getElementById('authLoadingText').textContent = text; }
function hideAuthLoading() { authLoading.classList.add('hidden'); }
function showAppLoading()  { appLoading.classList.remove('hidden'); }
function hideAppLoading()  { appLoading.classList.add('hidden'); }
function setAuthBtnDisabled(d) { document.getElementById('btnLogin').disabled = d; document.getElementById('btnRegister').disabled = d; }

/* ── Tabs ────────────────────────────────────────────────── */
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

/* ── Toggle password ─────────────────────────────────────── */
function bindEye(btnId, inputId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
}
bindEye('toggleLoginPwd',      'loginPassword');
bindEye('toggleRegPwd',        'regPassword');
bindEye('toggleRegPwdConfirm', 'regPasswordConfirm');

/* ── Register ────────────────────────────────────────────── */
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthErrors();
  const displayName = document.getElementById('regDisplayName').value.trim();
  const email       = document.getElementById('regEmail').value.trim();
  const password    = document.getElementById('regPassword').value;
  const confirm     = document.getElementById('regPasswordConfirm').value;
  let valid = true;

  if (!displayName) { setAuthError('regDisplayName','regDisplayNameError','Nama tampilan wajib diisi.'); valid=false; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthError('regEmail','regEmailError','Masukkan email yang valid.'); valid=false; }
  if (!password || password.length < 6) { setAuthError('regPassword','regPasswordError','Minimal 6 karakter.'); valid=false; }
  if (password && confirm !== password) { setAuthError('regPasswordConfirm','regPasswordConfirmError','Kata sandi tidak cocok.'); valid=false; }
  if (!valid) return;

  showAuthLoading('Membuat akun…'); setAuthBtnDisabled(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    currentUID = cred.user.uid;
    await dbSet('profile/displayName', displayName);
    toast('Akun berhasil dibuat!', 'success');
  } catch(err) {
    hideAuthLoading(); setAuthBtnDisabled(false);
    const msgs = { 'auth/email-already-in-use':'Email sudah digunakan.', 'auth/weak-password':'Kata sandi terlalu lemah.' };
    document.getElementById('regGlobalError').textContent = msgs[err.code] || 'Gagal membuat akun.';
    toast('Gagal membuat akun.', 'error');
  }
});

/* ── Login ───────────────────────────────────────────────── */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthErrors();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  let valid = true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthError('loginEmail','loginEmailError','Masukkan email yang valid.'); valid=false; }
  if (!password) { setAuthError('loginPassword','loginPasswordError','Kata sandi wajib diisi.'); valid=false; }
  if (!valid) return;

  showAuthLoading('Masuk…'); setAuthBtnDisabled(true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    toast('Selamat datang!', 'success');
  } catch(err) {
    hideAuthLoading(); setAuthBtnDisabled(false);
    document.getElementById('loginGlobalError').textContent = 'Email atau kata sandi salah.';
    toast('Login gagal.', 'error');
  }
});

/* ── Auth state observer ─────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUID = user.uid;
    authScreen.classList.add('hidden');
    appWrapper.classList.remove('hidden');
    showAppLoading();

    const name = user.displayName || user.email.split('@')[0];
    document.getElementById('userNameDisplay').textContent = name;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();

    await loadData();
    hideAppLoading();
    applyTheme(lsGet(KEY_THEME, 'light'));
    setupRipples();
  } else {
    currentUID = null;
    dbUnlistenAll();
    transactions = []; customCategories = {}; spendLimit = 0;
    if (chart) { chart.destroy(); chart = null; }
    appWrapper.classList.add('hidden');
    authScreen.classList.remove('hidden');
    hideAuthLoading(); setAuthBtnDisabled(false);
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    clearAuthErrors(); switchTab('login');
  }
});

/* ── Load data + realtime listeners ─────────────────────── */
async function loadData() {
  const [cats, lim] = await Promise.all([dbGet('categories'), dbGet('spendLimit')]);
  customCategories = cats || {};
  spendLimit = lim || 0;
  if (spendLimit) document.getElementById('spendLimit').value = spendLimit;
  populateCategorySelect();

  dbListen('transactions', snap => {
    const raw = snap.val() || {};
    transactions = Object.entries(raw).map(([id, v]) => ({ id, ...v }));
    render();
  });
  dbListen('categories', snap => {
    customCategories = snap.val() || {};
    populateCategorySelect();
    render();
  });
  dbListen('spendLimit', snap => {
    spendLimit = snap.val() || 0;
    render();
  });
}

/* ── Logout ──────────────────────────────────────────────── */
document.getElementById('btnLogout').addEventListener('click', async () => {
  dbUnlistenAll();
  await signOut(auth);
  toast('Sampai jumpa!', 'info');
});

/* ── Theme ───────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
  lsSet(KEY_THEME, theme);
  if (chart) renderChart();
}
document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

/* ── Sort ────────────────────────────────────────────────── */
document.getElementById('sortSelect').addEventListener('change', (e) => { sortOrder = e.target.value; renderList(); });

function getSorted() {
  const arr = [...transactions];
  switch(sortOrder) {
    case 'date-asc':     return arr.sort((a,b) => a.date - b.date);
    case 'amount-desc':  return arr.sort((a,b) => b.amount - a.amount);
    case 'amount-asc':   return arr.sort((a,b) => a.amount - b.amount);
    case 'category-asc': return arr.sort((a,b) => a.category.localeCompare(b.category));
    default:             return arr.sort((a,b) => b.date - a.date);
  }
}

/* ── Month nav ───────────────────────────────────────────── */
document.getElementById('prevMonth').addEventListener('click', () => {
  viewMonth--; if(viewMonth < 0) { viewMonth=11; viewYear--; } renderSummary();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  viewMonth++; if(viewMonth > 11) { viewMonth=0; viewYear++; } renderSummary();
});

/* ── Add transaction ─────────────────────────────────────── */
document.getElementById('transactionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameVal = document.getElementById('itemName').value.trim();
  const amtVal  = parseFloat(document.getElementById('amount').value);
  const catVal  = document.getElementById('category').value;
  const limVal  = parseFloat(document.getElementById('spendLimit').value) || 0;
  let valid = true;

  ['nameError','amountError','categoryError'].forEach(id => document.getElementById(id).textContent = '');
  ['itemName','amount','category'].forEach(id => document.getElementById(id).classList.remove('is-invalid'));

  if (!nameVal)          { document.getElementById('nameError').textContent='Nama item wajib diisi.';     document.getElementById('itemName').classList.add('is-invalid'); valid=false; }
  if (!amtVal||amtVal<=0){ document.getElementById('amountError').textContent='Masukkan jumlah yang valid.'; document.getElementById('amount').classList.add('is-invalid');   valid=false; }
  if (!catVal)           { document.getElementById('categoryError').textContent='Pilih kategori.';        document.getElementById('category').classList.add('is-invalid'); valid=false; }
  if (!valid) return;

  const btn = document.getElementById('btnAddTx');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    await dbPush('transactions', { name: nameVal, amount: amtVal, category: catVal, date: Date.now() });
    if (limVal !== spendLimit) await dbSet('spendLimit', limVal);
    document.getElementById('transactionForm').reset();
    toast(`✓ ${nameVal} ditambahkan`, 'success');
  } catch(err) {
    toast('Gagal menyimpan transaksi.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Tambah Transaksi';
  }
});

/* ── Delete ──────────────────────────────────────────────── */
async function deleteTransaction(id) {
  const item = document.querySelector(`.transaction-item[data-id="${id}"]`);
  if (item) {
    item.style.transition = 'all .25s ease';
    item.style.opacity = '0';
    item.style.transform = 'translateX(20px) scale(.95)';
    await new Promise(r => setTimeout(r, 250));
  }
  try {
    await dbRemove(`transactions/${id}`);
    toast('Transaksi dihapus', 'info');
  } catch(err) { toast('Gagal menghapus.', 'error'); }
}

/* ── Modal kategori kustom ───────────────────────────────── */
const modalBackdrop = document.getElementById('modalBackdrop');
const openModalFn   = () => { modalBackdrop.classList.add('open'); modalBackdrop.setAttribute('aria-hidden','false'); document.getElementById('customCatName').focus(); };
const closeModalFn  = () => { modalBackdrop.classList.remove('open'); modalBackdrop.setAttribute('aria-hidden','true'); };

document.getElementById('openAddCategory').addEventListener('click', openModalFn);
document.getElementById('closeModal').addEventListener('click', closeModalFn);
document.getElementById('cancelModal').addEventListener('click', closeModalFn);
modalBackdrop.addEventListener('click', (e) => { if(e.target === modalBackdrop) closeModalFn(); });
document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeModalFn(); });

document.getElementById('saveCategory').addEventListener('click', async () => {
  const name  = document.getElementById('customCatName').value.trim();
  const emoji = document.getElementById('customCatEmoji').value.trim() || '📦';
  const color = document.getElementById('customCatColor').value;
  const errEl = document.getElementById('customCatError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Nama kategori wajib diisi.'; return; }
  if (BUILTIN_CATEGORIES[name] || customCategories[name]) { errEl.textContent = 'Kategori sudah ada.'; return; }
  await dbSet(`categories/${name}`, { emoji, color });
  document.getElementById('category').value = name;
  closeModalFn();
  toast(`Kategori "${name}" ditambahkan`, 'success');
});

function addCategoryOption(name, emoji) {
  const sel = document.getElementById('category');
  if (document.querySelector(`#category option[value="${CSS.escape(name)}"]`)) return;
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = `${emoji} ${name}`;
  sel.appendChild(opt);
}

function populateCategorySelect() {
  const sel = document.getElementById('category');
  Array.from(sel.options).forEach(opt => { if(opt.value && !BUILTIN_CATEGORIES[opt.value]) opt.remove(); });
  Object.entries(customCategories).forEach(([name, meta]) => addCategoryOption(name, meta.emoji));
}

function allCategories() {
  const custom = {};
  Object.entries(customCategories).forEach(([n,m]) => { custom[n]={...m,cssClass:'custom'}; });
  return { ...BUILTIN_CATEGORIES, ...custom };
}
function getMeta(cat) {
  return allCategories()[cat] || { emoji:'📦', color:'#6b7280', cssClass:'custom' };
}

/* ── Ripple setup ────────────────────────────────────────── */
function setupRipples() {
  document.querySelectorAll('.btn-add').forEach(addRipple);
}

/* ============================================================
   RENDER
   ============================================================ */
function render() { renderBalance(); renderList(); renderChart(); renderSummary(); updateSpendBar(); }

/* ── Balance ─────────────────────────────────────────────── */
function renderBalance() {
  const total = transactions.reduce((s,t) => s+t.amount, 0);
  const el    = document.getElementById('totalBalance');
  const next  = formatCurrency(total);
  if (el.textContent !== next) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    el.textContent = next;
  }
}

/* ── Spend limit progress bar ────────────────────────────── */
function updateSpendBar() {
  const wrap = document.getElementById('spendLimitBarWrap');
  if (!spendLimit) { wrap.classList.remove('visible'); return; }
  wrap.classList.add('visible');
  const total = transactions.reduce((s,t) => s+t.amount, 0);
  const pct   = Math.min((total / spendLimit) * 100, 100);
  const fill  = document.getElementById('spendLimitFill');
  fill.style.width = pct + '%';
  fill.className   = 'spend-limit-fill' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '');
  document.getElementById('spendLimitUsed').textContent = formatCurrency(total);
  document.getElementById('spendLimitMax').textContent  = formatCurrency(spendLimit);
}

/* ── Transaction list ────────────────────────────────────── */
function renderList() {
  const sorted = getSorted();
  const count  = sorted.length;
  const list   = document.getElementById('transactionList');
  const empty  = document.getElementById('emptyState');

  document.getElementById('transactionCount').textContent = `${count} item`;
  Array.from(list.children).forEach(c => { if(!c.classList.contains('empty-state')) c.remove(); });

  if (count === 0) { empty.style.display='flex'; return; }
  empty.style.display = 'none';

  const groups = {};
  sorted.forEach(t => {
    const dateKey = new Date(t.date).toLocaleDateString('id-ID', {
      weekday:'long', day:'numeric', month:'long', year:'numeric'
    });
    if (!groups[dateKey]) groups[dateKey] = { transactions:[], total:0 };
    groups[dateKey].transactions.push(t);
    groups[dateKey].total += t.amount;
  });

  let delay = 0;
  Object.entries(groups).forEach(([dateLabel, group]) => {
    const header = document.createElement('div');
    header.className = 'date-group-header';
    header.innerHTML = `<span class="date-group-label">${dateLabel}</span><span class="date-group-total">${formatCurrency(group.total)}</span>`;
    list.appendChild(header);

    group.transactions.forEach(t => {
      const meta      = getMeta(t.category);
      const overLimit = spendLimit > 0 && t.amount > spendLimit;
      const item      = document.createElement('div');
      item.className  = 'transaction-item' + (overLimit ? ' over-limit' : '');
      item.dataset.id = t.id;
      item.style.animationDelay = `${delay * 30}ms`;
      delay++;

      const iconStyle = meta.cssClass==='custom' ? `style="background:${hexToRgba(meta.color,0.1)}"` : '';
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

/* ── Chart ───────────────────────────────────────────────── */
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
  const tooltipBg = isDark ? '#1c1b1a' : '#141210';

  if (chart) {
    chart.data.labels = cats;
    chart.data.datasets[0].data = cats.map(c=>totals[c]);
    chart.data.datasets[0].backgroundColor = colors;
    chart.data.datasets[0].borderColor = isDark ? '#1c1b1a' : '#ffffff';
    chart.options.plugins.tooltip.backgroundColor = tooltipBg;
    chart.update();
  } else {
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: cats,
        datasets: [{ data: cats.map(c=>totals[c]), backgroundColor: colors,
          borderColor: isDark ? '#1c1b1a' : '#ffffff', borderWidth: 3, hoverOffset: 10 }]
      },
      options: {
        responsive: true, maintainAspectRatio: true, cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label(ctx) {
              const tot=ctx.dataset.data.reduce((a,b)=>a+b,0);
              const pct=tot>0?((ctx.parsed/tot)*100).toFixed(1):0;
              return ` ${formatCurrency(ctx.parsed)}  (${pct}%)`;
            }},
            backgroundColor: tooltipBg, titleColor:'#fff',
            bodyColor:'#aaa', padding:12, cornerRadius:10, boxPadding:4,
          }
        },
        animation: { duration:500, easing:'easeInOutQuart' }
      },
    });
  }

  legend.innerHTML = '';
  cats.forEach(cat => {
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<span class="legend-dot" style="background:${getMeta(cat).color}"></span><span>${escapeHtml(cat)}: <strong>${formatCurrency(totals[cat])}</strong></span>`;
    legend.appendChild(el);
  });
}

/* ── Monthly summary ─────────────────────────────────────── */
function renderSummary() {
  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni',
                  'Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('monthLabel').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const monthTx = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear()===viewYear && d.getMonth()===viewMonth;
  });

  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = '';

  if (monthTx.length===0) { grid.innerHTML='<div class="summary-empty">Tidak ada transaksi bulan ini.</div>'; return; }

  const total = monthTx.reduce((s,t)=>s+t.amount,0);
  appendSummaryItem(grid,'Total',formatCurrency(total),`${monthTx.length} transaksi`,true);

  const byCat = {};
  monthTx.forEach(t => { if(!byCat[t.category]) byCat[t.category]={sum:0,count:0}; byCat[t.category].sum+=t.amount; byCat[t.category].count++; });
  Object.entries(byCat).sort((a,b)=>b[1].sum-a[1].sum).forEach(([cat,{sum,count}], i) => {
    const el = appendSummaryItem(grid,`${getMeta(cat).emoji} ${cat}`,formatCurrency(sum),`${count} item`,false);
    el.style.animationDelay = `${(i+1)*60}ms`;
  });
}

function appendSummaryItem(parent, label, value, sub, isTotal) {
  const el = document.createElement('div');
  el.className = 'summary-item' + (isTotal ? ' summary-total' : '');
  el.innerHTML = `<div class="summary-item-label">${escapeHtml(label)}</div><div class="summary-item-value">${value}</div><div class="summary-item-count">${sub}</div>`;
  parent.appendChild(el);
  return el;
}

/* ── Init tema ───────────────────────────────────────────── */
applyTheme(lsGet(KEY_THEME, 'light'));
