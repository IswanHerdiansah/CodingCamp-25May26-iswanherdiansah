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
  getDatabase, ref, set, get, push, remove, update, onValue, off
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

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* ── i18n ────────────────────────────────────────────────── */
const LANG = {
  id: {
    nav_transaksi:'Transaksi', nav_rekening:'Rekening', nav_rekap:'Rekap', nav_setting:'Setting',
    pemasukan:'Pemasukan', pengeluaran:'Pengeluaran', selisih:'Selisih', riwayat:'Riwayat',
    total_saldo:'Total Saldo', tambah_rekening:'Tambah Rekening', bulanan:'Bulanan',
    warna_tema:'Warna Tema', pengingat:'Pengingat', pengingat_desc:'Notifikasi harian',
    hapus_semua:'Hapus Semua Data', tambah_transaksi:'Tambah Transaksi',
    pindah_saldo:'Pindah Saldo', tanggal:'Tanggal', jam:'Jam', rekening:'Rekening',
    tujuan_rekening:'Tujuan Rekening', jumlah:'Jumlah (Rp)', judul:'Judul',
    kategori:'Kategori', keterangan:'Keterangan', simpan:'Simpan', batal:'Batal',
    nama_rekening:'Nama Rekening', saldo_awal:'Saldo (Rp)', tidak_ada_data:'Tidak ada data',
  },
  en: {
    nav_transaksi:'Transactions', nav_rekening:'Accounts', nav_rekap:'Report', nav_setting:'Settings',
    pemasukan:'Income', pengeluaran:'Expense', selisih:'Balance', riwayat:'History',
    total_saldo:'Total Balance', tambah_rekening:'Add Account', bulanan:'Monthly',
    warna_tema:'Theme Color', pengingat:'Reminder', pengingat_desc:'Daily notification',
    hapus_semua:'Delete All Data', tambah_transaksi:'Add Transaction',
    pindah_saldo:'Transfer', tanggal:'Date', jam:'Time', rekening:'Account',
    tujuan_rekening:'Destination Account', jumlah:'Amount (Rp)', judul:'Title',
    kategori:'Category', keterangan:'Notes', simpan:'Save', batal:'Cancel',
    nama_rekening:'Account Name', saldo_awal:'Balance (Rp)', tidak_ada_data:'No data',
  }
};
let currentLang = localStorage.getItem('bv_lang') || 'id';
function t(key) { return LANG[currentLang][key] || key; }
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

/* ── State ───────────────────────────────────────────────── */
let uid          = null;
let transactions = [];   // [{id, type, amount, category, judul, rekening, tujuan, keterangan, date}]
let rekening     = {};   // {id: {nama, saldo, icon}}
let settings     = {};
let dbListeners  = [];
let chart        = null;
let rekapChart   = null;
let rekapViewYear  = new Date().getFullYear();
let rekapViewMonth = new Date().getMonth();
let editTxId     = null;
let editRekId    = null;
let currentTxType = 'expense';
let calcTarget   = null;  // 'tx' | 'rek'
let calcExpr     = '';

/* ── Category icon map ───────────────────────────────────── */
const CAT_ICON = {
  'Gaji Bulanan':'💼','Freelance':'💻','Sampingan':'🔧','Jualan':'🛍',
  'Tabungan':'🏦','Makanan':'🍔','Transportasi':'🚌','Hiburan':'🎉',
  'Kesehatan':'💊','Belanja':'🛒','Tagihan':'📋','Lainnya':'📦',
  'income':'📈','expense':'📉','transfer':'🔄',
};
function getCatIcon(tx) {
  if (tx.type === 'transfer') return '🔄';
  return CAT_ICON[tx.kategori] || CAT_ICON[tx.judul] || (tx.type==='income'?'📈':'📉');
}
  {nama:'Dana',       icon:'💙'}, {nama:'GoPay',    icon:'💚'},
  {nama:'Mandiri',    icon:'🏦'}, {nama:'BCA',       icon:'🔵'},
  {nama:'BRI',        icon:'🔴'}, {nama:'Jago',      icon:'🐆'},
  {nama:'OVO',        icon:'💜'}, {nama:'Jenius',    icon:'⚡'},
  {nama:'Uang Tunai', icon:'💵'},
];

/* ── Utils ───────────────────────────────────────────────── */
const KEY_THEME = 'bv_theme';
const lsGet = (k,fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const lsSet = (k,v)  => localStorage.setItem(k, JSON.stringify(v));

function fmt(v) {
  return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0}).format(v);
}
function fmtSigned(v) {
  const s = fmt(Math.abs(v));
  return v >= 0 ? `+${s}` : `-${s}`;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function todayStr() { return new Date().toISOString().slice(0,10); }
function nowTimeStr() { return new Date().toTimeString().slice(0,5); }
function dateLabel(ts) {
  return new Date(ts).toLocaleDateString(currentLang === 'id' ? 'id-ID' : 'en-US',
    {weekday:'long',day:'numeric',month:'long',year:'numeric'});
}

/* ── Toast ───────────────────────────────────────────────── */
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'●'}[type]||'●'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(()=>el.remove(),300); }, 3000);
}

/* ── DB helpers ──────────────────────────────────────────── */
const uRef  = path => ref(db, `users/${uid}/${path}`);
const dbSet = async (p,v) => set(uRef(p), v);
const dbGet = async p => { const s=await get(uRef(p)); return s.exists()?s.val():null; };
const dbPush= async (p,v) => push(uRef(p), v);
const dbDel = async p => remove(uRef(p));
const dbUpd = async (p,v) => update(uRef(p), v);
function dbOn(path, cb) { const r=uRef(path); onValue(r,cb); dbListeners.push(r); }
function dbOff() { dbListeners.forEach(r=>off(r)); dbListeners=[]; }

/* ── Theme ───────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeIcon').textContent = theme==='dark'?'☀️':'🌙';
  const ts = document.getElementById('themeToggleSetting');
  if (ts) ts.classList.toggle('on', theme==='dark');
  document.getElementById('themeDesc').textContent = theme==='dark'
    ? (currentLang==='id'?'Mode Gelap':'Dark Mode')
    : (currentLang==='id'?'Mode Terang':'Light Mode');
  lsSet(KEY_THEME, theme);
  if (rekapChart) renderRekapChart();
}
document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');
});

/* ── Auth ────────────────────────────────────────────────── */
document.getElementById('tabLogin').addEventListener('click',    ()=>switchTab('login'));
document.getElementById('tabRegister').addEventListener('click', ()=>switchTab('register'));

function switchTab(tab) {
  const isL = tab==='login';
  document.getElementById('tabLogin').classList.toggle('active',isL);
  document.getElementById('tabRegister').classList.toggle('active',!isL);
  document.getElementById('panelLogin').classList.toggle('hidden',!isL);
  document.getElementById('panelRegister').classList.toggle('hidden',isL);
  clearAuthErr();
}
function clearAuthErr() {
  ['loginEmailError','loginPasswordError','loginGlobalError',
   'regDisplayNameError','regEmailError','regPasswordError','regPasswordConfirmError','regGlobalError']
    .forEach(id=>{const e=document.getElementById(id);if(e)e.textContent='';});
  ['loginEmail','loginPassword','regDisplayName','regEmail','regPassword','regPasswordConfirm']
    .forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove('is-invalid');});
}
function setAuthErr(inp,err,msg) {
  document.getElementById(inp)?.classList.add('is-invalid');
  const e=document.getElementById(err); if(e) e.textContent=msg;
}
['toggleLoginPwd','toggleRegPwd','toggleRegPwdConfirm'].forEach(id=>{
  const btn=document.getElementById(id);
  if(!btn) return;
  const targets={'toggleLoginPwd':'loginPassword','toggleRegPwd':'regPassword','toggleRegPwdConfirm':'regPasswordConfirm'};
  btn.addEventListener('click',()=>{const i=document.getElementById(targets[id]);i.type=i.type==='password'?'text':'password';});
});

document.getElementById('registerForm').addEventListener('submit', async e=>{
  e.preventDefault(); clearAuthErr();
  const dn=document.getElementById('regDisplayName').value.trim();
  const em=document.getElementById('regEmail').value.trim();
  const pw=document.getElementById('regPassword').value;
  const cf=document.getElementById('regPasswordConfirm').value;
  let ok=true;
  if(!dn){setAuthErr('regDisplayName','regDisplayNameError','Nama tampilan wajib diisi.');ok=false;}
  if(!em||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){setAuthErr('regEmail','regEmailError','Email tidak valid.');ok=false;}
  if(!pw||pw.length<6){setAuthErr('regPassword','regPasswordError','Minimal 6 karakter.');ok=false;}
  if(pw&&cf!==pw){setAuthErr('regPasswordConfirm','regPasswordConfirmError','Kata sandi tidak cocok.');ok=false;}
  if(!ok) return;
  document.getElementById('authLoading').classList.remove('hidden');
  document.getElementById('btnLogin').disabled=document.getElementById('btnRegister').disabled=true;
  try {
    const cred=await createUserWithEmailAndPassword(auth,em,pw);
    await updateProfile(cred.user,{displayName:dn});
    uid=cred.user.uid;
    await dbSet('profile/displayName',dn);
    toast('Akun berhasil dibuat!','success');
  } catch(err) {
    document.getElementById('authLoading').classList.add('hidden');
    document.getElementById('btnLogin').disabled=document.getElementById('btnRegister').disabled=false;
    const m={'auth/email-already-in-use':'Email sudah digunakan.'};
    document.getElementById('regGlobalError').textContent=m[err.code]||'Gagal membuat akun.';
    toast('Gagal membuat akun.','error');
  }
});

document.getElementById('loginForm').addEventListener('submit', async e=>{
  e.preventDefault(); clearAuthErr();
  const em=document.getElementById('loginEmail').value.trim();
  const pw=document.getElementById('loginPassword').value;
  let ok=true;
  if(!em){setAuthErr('loginEmail','loginEmailError','Email wajib diisi.');ok=false;}
  if(!pw){setAuthErr('loginPassword','loginPasswordError','Kata sandi wajib diisi.');ok=false;}
  if(!ok) return;
  document.getElementById('authLoading').classList.remove('hidden');
  document.getElementById('btnLogin').disabled=document.getElementById('btnRegister').disabled=true;
  try {
    await signInWithEmailAndPassword(auth,em,pw);
    toast('Selamat datang!','success');
  } catch(err) {
    document.getElementById('authLoading').classList.add('hidden');
    document.getElementById('btnLogin').disabled=document.getElementById('btnRegister').disabled=false;
    document.getElementById('loginGlobalError').textContent='Email atau kata sandi salah.';
    toast('Login gagal.','error');
  }
});

document.getElementById('btnLogout').addEventListener('click', async ()=>{
  dbOff(); await signOut(auth); toast('Sampai jumpa!','info');
});

/* ── Auth State ──────────────────────────────────────────── */
onAuthStateChanged(auth, async user=>{
  if (user) {
    uid = user.uid;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('appLoading').classList.remove('hidden');
    const name = user.displayName || user.email.split('@')[0];
    document.getElementById('userNameDisplay').textContent = name;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
    applyTheme(lsGet(KEY_THEME,'light'));
    applyI18n();
    await loadData();
    document.getElementById('appLoading').classList.add('hidden');
    initSettings();
    initAmountInputs();
    initExportDropdown();
    renderAll();
  } else {
    uid=null; dbOff(); transactions=[]; rekening={};
    if(chart){chart.destroy();chart=null;}
    if(rekapChart){rekapChart.destroy();rekapChart=null;}
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('authLoading').classList.add('hidden');
    document.getElementById('btnLogin').disabled=document.getElementById('btnRegister').disabled=false;
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    clearAuthErr(); switchTab('login');
  }
});

/* ── Load Data ───────────────────────────────────────────── */
async function loadData() {
  const [txSnap, rekSnap] = await Promise.all([dbGet('transactions'), dbGet('rekening')]);
  transactions = txSnap ? Object.entries(txSnap).map(([id,v])=>({id,...v})) : [];
  rekening     = rekSnap || {};

  // Seed rekening default jika kosong
  if (Object.keys(rekening).length === 0) {
    for (const r of DEFAULT_REKENING) {
      const ref = await dbPush('rekening', {nama:r.nama, icon:r.icon, saldo:0});
      rekening[ref.key] = {nama:r.nama, icon:r.icon, saldo:0};
    }
  }

  dbOn('transactions', snap=>{
    const raw=snap.val()||{};
    transactions=Object.entries(raw).map(([id,v])=>({id,...v}));
    renderAll();
  });
  dbOn('rekening', snap=>{
    rekening=snap.val()||{};
    renderAll();
  });
}

/* ── Navigation ──────────────────────────────────────────── */
document.querySelectorAll('.nav-item[data-page]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
    // Resize chart after tab becomes visible
    if(btn.dataset.page==='rekap'){
      setTimeout(()=>{ if(rekapChart) rekapChart.resize(); }, 50);
    }
  });
});

/* ── Render All ──────────────────────────────────────────── */
function renderAll() {
  renderSummaryBar();
  renderTxList();
  renderRekeningPage();
  renderRekapChart();
  renderRekapMonthly();
}

/* ── Summary Bar ─────────────────────────────────────────── */
function renderSummaryBar() {
  const income  = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  document.getElementById('totalIncome').textContent  = fmt(income);
  document.getElementById('totalExpense').textContent = fmt(expense);
  document.getElementById('totalDiff').textContent    = fmt(income - expense);
}

/* ── Transaction List ────────────────────────────────────── */
function getFilteredTx() {
  const q = (document.getElementById('searchInput')?.value||'').toLowerCase();
  const from = document.getElementById('exportFrom')?.value;
  const to   = document.getElementById('exportTo')?.value;
  return transactions.filter(t=>{
    if(q && !t.judul?.toLowerCase().includes(q) && !t.kategori?.toLowerCase().includes(q) && !t.keterangan?.toLowerCase().includes(q) && !t.rekening?.toLowerCase().includes(q)) return false;
    if(from && new Date(t.date) < new Date(from)) return false;
    if(to   && new Date(t.date) > new Date(to+'T23:59:59')) return false;
    return true;
  }).sort((a,b)=>b.date-a.date);
}

function renderTxList() {
  const list  = document.getElementById('txList');
  const empty = document.getElementById('txEmpty');
  const txs   = getFilteredTx();
  Array.from(list.children).forEach(c=>{ if(!c.classList.contains('empty-state')) c.remove(); });
  if(txs.length===0){ empty.style.display='flex'; return; }
  empty.style.display='none';

  const groups={};
  txs.forEach(t=>{
    const dk=dateLabel(t.date);
    if(!groups[dk]) groups[dk]={txs:[],income:0,expense:0};
    groups[dk].txs.push(t);
    if(t.type==='income') groups[dk].income+=t.amount;
    else if(t.type==='expense') groups[dk].expense+=t.amount;
  });

  let delay=0;
  Object.entries(groups).forEach(([dk,g])=>{
    const hdr=document.createElement('div');
    hdr.className='tx-date-header';
    const net=g.income-g.expense;
    hdr.innerHTML=`<span>${escHtml(dk)}</span><span class="tx-date-total">${fmtSigned(net)}</span>`;
    list.insertBefore(hdr, empty);

    g.txs.forEach(t=>{
      const icon = getCatIcon(t);
      const sign = t.type==='income'?'+':t.type==='expense'?'-':'';
      const rekNama = t.rekening || '';
      const tujuan  = t.tujuan   || '';
      const sub = t.type==='transfer'
        ? `${rekNama} → ${tujuan}`
        : `${rekNama}${t.kategori?' · '+t.kategori:''}`;
      const el=document.createElement('div');
      el.className=`tx-item ${t.type}`;
      el.dataset.id=t.id;
      el.style.animationDelay=`${delay*25}ms`;
      delay++;
      el.innerHTML=`
        <div class="tx-icon">${icon}</div>
        <div class="tx-info">
          <div class="tx-title">${escHtml(t.judul||t.kategori||t.type)}</div>
          <div class="tx-sub">${escHtml(sub)}</div>
        </div>
        <div class="tx-amount">${sign}${fmt(t.amount)}</div>`;
      el.addEventListener('click',()=>openEditTx(t.id));
      list.insertBefore(el, empty);
    });
  });
}

document.getElementById('searchInput').addEventListener('input', renderTxList);

/* ── Rekening Page ───────────────────────────────────────── */
function renderRekeningPage() {
  const total = Object.values(rekening).reduce((s,r)=>s+(r.saldo||0),0);
  document.getElementById('totalSaldo').textContent = fmt(total);
  const list = document.getElementById('rekeningList');
  list.innerHTML='';
  Object.entries(rekening).forEach(([id,r])=>{
    const el=document.createElement('div');
    el.className='rek-item';
    el.innerHTML=`
      <div class="rek-icon">${r.icon||'🏦'}</div>
      <div class="rek-info">
        <div class="rek-name">${escHtml(r.nama)}</div>
        <div class="rek-saldo">Saldo</div>
      </div>
      <div class="rek-amount">${fmt(r.saldo||0)}</div>`;
    el.addEventListener('click',()=>openEditRek(id));
    list.appendChild(el);
  });
}

/* ── Rekap Page ──────────────────────────────────────────── */
function renderRekapPage() {
  renderRekapChart();
  renderRekapMonthly();
}

function renderRekapChart() {
  const canvas = document.getElementById('rekapChart');
  const empty  = document.getElementById('rekapChartEmpty');
  const legend = document.getElementById('rekapLegend');

  // Aggregate by category (expense only)
  const totals={};
  transactions.filter(t=>t.type==='expense').forEach(t=>{
    const k = (t.kategori && t.kategori.trim()) ? t.kategori : (t.judul && t.judul.trim() ? t.judul : 'Lainnya');
    totals[k]=(totals[k]||0)+t.amount;
  });
  const cats=Object.keys(totals);
  empty.classList.toggle('hidden', cats.length>0);

  const COLORS=['#4f6ef7','#10b981','#f59e0b','#ef4444','#a855f7','#3b82f6','#f97316','#06b6d4','#84cc16','#ec4899'];
  const colors=cats.map((_,i)=>COLORS[i%COLORS.length]);
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const tooltipBg=isDark?'#1c1b1a':'#141210';

  // Period label
  if(transactions.length>0){
    const dates=transactions.map(t=>t.date).sort();
    const from=new Date(dates[0]).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
    const to  =new Date(dates[dates.length-1]).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
    document.getElementById('rekapPeriod').textContent=`${from} – ${to}`;
  }

  if(rekapChart){
    rekapChart.data.labels=cats;
    rekapChart.data.datasets[0].data=cats.map(c=>totals[c]);
    rekapChart.data.datasets[0].backgroundColor=colors;
    rekapChart.data.datasets[0].borderColor=isDark?'#1a1d27':'#fff';
    rekapChart.options.plugins.tooltip.backgroundColor=tooltipBg;
    rekapChart.update();
  } else {
    rekapChart=new Chart(canvas,{
      type:'doughnut',
      data:{labels:cats,datasets:[{data:cats.map(c=>totals[c]),backgroundColor:colors,
        borderColor:isDark?'#1a1d27':'#fff',borderWidth:3,hoverOffset:10}]},
      options:{responsive:true,maintainAspectRatio:true,cutout:'65%',
        plugins:{legend:{display:false},tooltip:{
          callbacks:{label(ctx){
            const tot=ctx.dataset.data.reduce((a,b)=>a+b,0);
            const pct=tot>0?((ctx.parsed/tot)*100).toFixed(1):0;
            return ` ${fmt(ctx.parsed)} (${pct}%)`;
          }},
          backgroundColor:tooltipBg,titleColor:'#fff',bodyColor:'#aaa',padding:12,cornerRadius:10,
        }},animation:{duration:500,easing:'easeInOutQuart'}},
    });
  }

  legend.innerHTML='';
  const totalAll=cats.reduce((s,c)=>s+totals[c],0);
  cats.forEach((cat,i)=>{
    const pct=totalAll>0?((totals[cat]/totalAll)*100).toFixed(1):0;
    const el=document.createElement('div');
    el.className='legend-item';
    el.innerHTML=`<span class="legend-dot" style="background:${colors[i]}"></span><span>${escHtml(cat)}: <strong>${fmt(totals[cat])}</strong> (${pct}%)</span>`;
    legend.appendChild(el);
  });
}

function renderRekapMonthly() {
  const MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('rekapMonthLabel').textContent=`${MONTHS[rekapViewMonth]} ${rekapViewYear}`;
  const monthTx=transactions.filter(t=>{
    const d=new Date(t.date);
    return d.getFullYear()===rekapViewYear && d.getMonth()===rekapViewMonth;
  });
  const grid=document.getElementById('rekapMonthlyGrid');
  grid.innerHTML='';
  if(monthTx.length===0){grid.innerHTML='<div class="summary-empty">Tidak ada data bulan ini.</div>';return;}
  const income =monthTx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense=monthTx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const selisih=income-expense;
  const transfer=monthTx.filter(t=>t.type==='transfer').reduce((s,t)=>s+t.amount,0);
  const items=[
    {label:t('pemasukan'),value:fmt(income),sub:`${monthTx.filter(x=>x.type==='income').length} transaksi`,total:false},
    {label:t('pengeluaran'),value:fmt(expense),sub:`${monthTx.filter(x=>x.type==='expense').length} transaksi`,total:false},
    {label:t('selisih'),value:fmt(selisih),sub:'',total:true},
    {label:'Pindah Saldo',value:fmt(transfer),sub:`${monthTx.filter(x=>x.type==='transfer').length} transaksi`,total:false},
  ];
  items.forEach((item,i)=>{
    const el=document.createElement('div');
    el.className='rekap-card'+(item.total?' total':'');
    el.style.animationDelay=`${i*60}ms`;
    el.innerHTML=`<div class="rc-label">${item.label}</div><div class="rc-value">${item.value}</div>${item.sub?`<div class="rc-sub">${item.sub}</div>`:''}`;
    grid.appendChild(el);
  });
}

document.getElementById('rekapPrevMonth').addEventListener('click',()=>{
  rekapViewMonth--; if(rekapViewMonth<0){rekapViewMonth=11;rekapViewYear--;} renderRekapMonthly();
});
document.getElementById('rekapNextMonth').addEventListener('click',()=>{
  rekapViewMonth++; if(rekapViewMonth>11){rekapViewMonth=0;rekapViewYear++;} renderRekapMonthly();
});

/* ── Bottom Sheet: Add Type ──────────────────────────────── */
document.getElementById('btnOpenAdd').addEventListener('click',()=>{
  openSheet('sheetAddType');
});
document.querySelectorAll('.add-type-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    closeSheet('sheetAddType');
    openTxForm(btn.dataset.type, null);
  });
});

/* ── TX Form ─────────────────────────────────────────────── */
function openTxForm(type, txId) {
  currentTxType = type;
  editTxId = txId;
  const titles={income:t('pemasukan'),expense:t('pengeluaran'),transfer:t('pindah_saldo')};
  document.getElementById('txFormTitle').textContent = (txId?'Edit ':'Tambah ')+titles[type];

  // Show/hide fields
  const isTransfer = type==='transfer';
  document.getElementById('txTujuanWrap').classList.toggle('hidden', !isTransfer);
  document.getElementById('txJudulWrap').classList.toggle('hidden', isTransfer);
  document.getElementById('txKategoriWrap').classList.toggle('hidden', isTransfer);
  document.getElementById('btnDeleteTx').classList.toggle('hidden', !txId);

  // Populate rekening selects
  populateRekeningSelect('txRekening');
  populateRekeningSelect('txTujuan');

  // Set defaults or existing values
  if(txId) {
    const tx=transactions.find(x=>x.id===txId);
    if(tx){
      document.getElementById('txDate').value = new Date(tx.date).toISOString().slice(0,10);
      document.getElementById('txTime').value = new Date(tx.date).toTimeString().slice(0,5);
      document.getElementById('txAmount').value = tx.amount;
      document.getElementById('txRekening').value = tx.rekening||'';
      document.getElementById('txTujuan').value = tx.tujuan||'';
      document.getElementById('txJudul').value = tx.judul||'';
      document.getElementById('txKategori').value = tx.kategori||'';
      document.getElementById('txKeterangan').value = tx.keterangan||'';
    }
  } else {
    document.getElementById('txDate').value = todayStr();
    document.getElementById('txTime').value = nowTimeStr();
    document.getElementById('txAmount').value = '';
    document.getElementById('txJudul').value = '';
    document.getElementById('txKategori').value = '';
    document.getElementById('txKeterangan').value = '';
  }
  calcTarget='tx'; calcExpr='';
  document.getElementById('calcPanel').classList.add('hidden');
  document.getElementById('calcDisplay').textContent='0';
  openSheet('sheetTxForm');
}

function populateRekeningSelect(selId) {
  const sel=document.getElementById(selId);
  sel.innerHTML='<option value="">— Pilih rekening —</option>';
  Object.entries(rekening).forEach(([id,r])=>{
    const opt=document.createElement('option');
    opt.value=r.nama; opt.textContent=`${r.icon||'🏦'} ${r.nama}`;
    sel.appendChild(opt);
  });
}

document.getElementById('btnTxBack').addEventListener('click',()=>{
  closeSheet('sheetTxForm'); openSheet('sheetAddType');
});
document.getElementById('btnTxClose').addEventListener('click',()=>closeSheet('sheetTxForm'));

document.getElementById('btnSaveTx').addEventListener('click', async ()=>{
  const date = document.getElementById('txDate').value;
  const time = document.getElementById('txTime').value;
  const amount = parseFloat(document.getElementById('txAmount').value.replace(/\D/g,''))||0;
  const rekNama = document.getElementById('txRekening').value;
  const tujuan  = document.getElementById('txTujuan').value;
  const judul   = document.getElementById('txJudul').value;
  const kategori= document.getElementById('txKategori').value;
  const ket     = document.getElementById('txKeterangan').value;

  if(!amount||amount<=0){ document.getElementById('txAmountError').textContent='Masukkan jumlah yang valid.'; return; }
  document.getElementById('txAmountError').textContent='';

  const ts = new Date(`${date}T${time||'00:00'}`).getTime();
  const data = { type:currentTxType, amount, rekening:rekNama, tujuan, judul, kategori, keterangan:ket, date:ts };

  try {
    if(editTxId) {
      await dbUpd(`transactions/${editTxId}`, data);
      toast('Transaksi diperbarui','success');
    } else {
      await dbPush('transactions', data);
      // Update saldo rekening
      await updateRekeningBalance(rekNama, tujuan, currentTxType, amount);
      toast('Transaksi disimpan','success');
    }
    closeSheet('sheetTxForm');
    // Auto reset form
    document.getElementById('txAmount').value = '';
    document.getElementById('txJudul').value = '';
    document.getElementById('txKategori').value = '';
    document.getElementById('txKeterangan').value = '';
    document.getElementById('calcPanel').classList.add('hidden');
  } catch(err){ toast('Gagal menyimpan.','error'); }
});

async function updateRekeningBalance(rekNama, tujuan, type, amount) {
  const entries=Object.entries(rekening);
  if(type==='income'){
    const found=entries.find(([,r])=>r.nama===rekNama);
    if(found) await dbUpd(`rekening/${found[0]}`,{saldo:(found[1].saldo||0)+amount});
  } else if(type==='expense'){
    const found=entries.find(([,r])=>r.nama===rekNama);
    if(found) await dbUpd(`rekening/${found[0]}`,{saldo:(found[1].saldo||0)-amount});
  } else if(type==='transfer'){
    const from=entries.find(([,r])=>r.nama===rekNama);
    const to  =entries.find(([,r])=>r.nama===tujuan);
    if(from) await dbUpd(`rekening/${from[0]}`,{saldo:(from[1].saldo||0)-amount});
    if(to)   await dbUpd(`rekening/${to[0]}`,  {saldo:(to[1].saldo||0)+amount});
  }
}

document.getElementById('btnDeleteTx').addEventListener('click',()=>{
  showConfirm('Hapus transaksi ini?', async ()=>{
    await dbDel(`transactions/${editTxId}`);
    closeSheet('sheetTxForm');
    toast('Transaksi dihapus','info');
  });
});

function openEditTx(id) { const tx=transactions.find(x=>x.id===id); if(tx) openTxForm(tx.type,id); }

/* ── Rekening Form ───────────────────────────────────────── */
document.getElementById('btnAddRekening').addEventListener('click',()=>openEditRek(null));

function openEditRek(id) {
  editRekId=id;
  document.getElementById('rekeningFormTitle').textContent = id?'Edit Rekening':'Tambah Rekening';
  document.getElementById('btnDeleteRek').style.display = id?'':'none';
  if(id && rekening[id]){
    document.getElementById('rekNama').value  = rekening[id].nama||'';
    document.getElementById('rekSaldo').value = rekening[id].saldo||0;
  } else {
    document.getElementById('rekNama').value  = '';
    document.getElementById('rekSaldo').value = '';
  }
  // Riwayat rekening
  const histList=document.getElementById('rekHistoryList');
  histList.innerHTML='';
  if(id){
    const rekNama=rekening[id]?.nama;
    const txs=transactions.filter(t=>t.rekening===rekNama||t.tujuan===rekNama).sort((a,b)=>b.date-a.date).slice(0,10);
    if(txs.length===0){histList.innerHTML='<div class="empty-state sm"><p>Belum ada transaksi</p></div>';}
    else txs.forEach(t=>{
      const el=document.createElement('div');
      el.className=`tx-item ${t.type}`;
      el.innerHTML=`<div class="tx-icon">${t.type==='income'?'📈':t.type==='expense'?'📉':'🔄'}</div><div class="tx-info"><div class="tx-title">${escHtml(t.judul||t.kategori||t.type)}</div><div class="tx-sub">${new Date(t.date).toLocaleDateString('id-ID')}</div></div><div class="tx-amount">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>`;
      histList.appendChild(el);
    });
  } else {
    histList.innerHTML='<div class="empty-state sm"><p>Belum ada transaksi</p></div>';
  }
  calcTarget='rek'; calcExpr='';
  document.getElementById('calcPanelRek').classList.add('hidden');
  document.getElementById('calcDisplayRek').textContent='0';
  openSheet('sheetRekening');
}

document.getElementById('btnRekBack').addEventListener('click',()=>closeSheet('sheetRekening'));
document.getElementById('btnRekClose').addEventListener('click',()=>closeSheet('sheetRekening'));

document.getElementById('btnSaveRek').addEventListener('click', async ()=>{
  const nama  = document.getElementById('rekNama').value.trim();
  const saldo = parseFloat(document.getElementById('rekSaldo').value.replace(/\D/g,''))||0;
  if(!nama){ document.getElementById('rekNamaError').textContent='Nama rekening wajib diisi.'; return; }
  document.getElementById('rekNamaError').textContent='';
  const data={nama, saldo, icon: getRekIcon(nama)};
  try {
    if(editRekId) await dbUpd(`rekening/${editRekId}`, data);
    else await dbPush('rekening', data);
    closeSheet('sheetRekening');
    toast(editRekId?'Rekening diperbarui':'Rekening ditambahkan','success');
  } catch(err){ toast('Gagal menyimpan.','error'); }
});

document.getElementById('btnDeleteRek').addEventListener('click',()=>{
  showConfirm('Apakah Anda yakin akan menghapus rekening ini?', async ()=>{
    await dbDel(`rekening/${editRekId}`);
    closeSheet('sheetRekening');
    toast('Rekening dihapus','info');
  });
});

function getRekIcon(nama) {
  const map={dana:'💙',gopay:'💚',mandiri:'🏦',bca:'🔵',bri:'🔴',jago:'🐆',ovo:'💜',jenius:'⚡','uang tunai':'💵'};
  return map[nama.toLowerCase()]||'🏦';
}

/* ── Calculator ──────────────────────────────────────────── */
function initCalc(panelId, displayId, targetInputId, btnId) {
  const panel   = document.getElementById(panelId);
  const display = document.getElementById(displayId);
  const input   = document.getElementById(targetInputId);
  const btn     = document.getElementById(btnId);
  let expr = '';

  btn.addEventListener('click',()=>panel.classList.toggle('hidden'));

  panel.querySelectorAll('.calc-btn[data-val]').forEach(b=>{
    b.addEventListener('click',()=>{
      expr += b.dataset.val;
      display.textContent = expr || '0';
    });
  });
  panel.querySelector('[id^="calcClear"]').addEventListener('click',()=>{ expr=''; display.textContent='0'; });
  panel.querySelector('[id^="calcBackspace"]').addEventListener('click',()=>{ expr=expr.slice(0,-1); display.textContent=expr||'0'; });
  panel.querySelector('[id^="calcOk"]').addEventListener('click',()=>{
    try {
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict";return ('+expr+')')();
      const val = Math.round(result);
      input.value = new Intl.NumberFormat('id-ID').format(val);
      display.textContent = new Intl.NumberFormat('id-ID').format(val);
      expr = String(val);
      panel.classList.add('hidden');
    } catch{ display.textContent='Error'; expr=''; }
  });
}
initCalc('calcPanel',    'calcDisplay',    'txAmount',  'btnCalc');
initCalc('calcPanelRek', 'calcDisplayRek', 'rekSaldo',  'btnRekCalc');

/* ── Voice Input ─────────────────────────────────────────── */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
document.querySelectorAll('.btn-mic').forEach(btn=>{
  if(!SpeechRecognition){ btn.style.display='none'; return; }
  btn.addEventListener('click',()=>{
    const targetId = btn.dataset.target;
    const input    = document.getElementById(targetId);
    const rec      = new SpeechRecognition();
    rec.lang = currentLang==='id'?'id-ID':'en-US';
    rec.interimResults = false;
    btn.classList.add('listening');
    rec.start();
    rec.onresult = e=>{ input.value=e.results[0][0].transcript; btn.classList.remove('listening'); };
    rec.onerror  = ()=>{ btn.classList.remove('listening'); toast('Mikrofon tidak tersedia','error'); };
    rec.onend    = ()=>btn.classList.remove('listening');
  });
});

/* ── Sheet helpers ───────────────────────────────────────── */
function openSheet(id)  { document.getElementById(id).classList.add('open'); }
function closeSheet(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.sheet-backdrop').forEach(bd=>{
  bd.addEventListener('click',e=>{ if(e.target===bd) bd.classList.remove('open'); });
});

/* ── Confirm Dialog ──────────────────────────────────────── */
let confirmCallback = null;
function showConfirm(msg, cb) {
  document.getElementById('confirmMsg').textContent = msg;
  confirmCallback = cb;
  document.getElementById('confirmDialog').classList.remove('hidden');
}
document.getElementById('confirmCancel').addEventListener('click',()=>{
  document.getElementById('confirmDialog').classList.add('hidden'); confirmCallback=null;
});
document.getElementById('confirmOk').addEventListener('click',()=>{
  document.getElementById('confirmDialog').classList.add('hidden');
  if(confirmCallback) confirmCallback();
  confirmCallback=null;
});

/* ── Export Excel ────────────────────────────────────────── */
document.getElementById('btnExportExcel').addEventListener('click',()=>{
  const txs = getFilteredTx();
  if(!txs.length){ toast('Tidak ada data untuk diekspor','error'); return; }
  const rows = txs.map(t=>({
    Tanggal: new Date(t.date).toLocaleDateString('id-ID'),
    Jam:     new Date(t.date).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}),
    Jenis:   t.type==='income'?'Pemasukan':t.type==='expense'?'Pengeluaran':'Pindah Saldo',
    Judul:   t.judul||'',
    Kategori:t.kategori||'',
    Rekening:t.rekening||'',
    Tujuan:  t.tujuan||'',
    Jumlah:  t.amount,
    Keterangan:t.keterangan||'',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transaksi');
  XLSX.writeFile(wb, `dompet-transaksi-${todayStr()}.xlsx`);
  toast('Excel berhasil diunduh','success');
});

/* ── Export PDF ──────────────────────────────────────────── */
document.getElementById('btnExportPdf').addEventListener('click',()=>{
  const txs = getFilteredTx();
  if(!txs.length){ toast('Tidak ada data untuk diekspor','error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text('Laporan Transaksi — Dompet', 14, 16);
  doc.setFontSize(9);
  doc.text(`Diekspor: ${new Date().toLocaleDateString('id-ID')}`, 14, 22);
  const rows = txs.map(t=>[
    new Date(t.date).toLocaleDateString('id-ID'),
    t.type==='income'?'Pemasukan':t.type==='expense'?'Pengeluaran':'Pindah Saldo',
    t.judul||t.kategori||'-',
    t.rekening||'-',
    fmt(t.amount),
    t.keterangan||'-',
  ]);
  doc.autoTable({
    head:[['Tanggal','Jenis','Judul/Kategori','Rekening','Jumlah','Keterangan']],
    body: rows,
    startY: 28,
    styles:{fontSize:8},
    headStyles:{fillColor:[79,110,247]},
  });
  doc.save(`dompet-transaksi-${todayStr()}.pdf`);
  toast('PDF berhasil diunduh','success');
});

/* ── Settings ────────────────────────────────────────────── */
function initSettings() {
  // Theme toggle
  const ts=document.getElementById('themeToggleSetting');
  ts.classList.toggle('on', lsGet(KEY_THEME,'light')==='dark');
  ts.addEventListener('click',()=>{
    const isDark=document.documentElement.getAttribute('data-theme')==='dark';
    applyTheme(isDark?'light':'dark');
  });

  // Lang toggle
  const lt=document.getElementById('langToggle');
  lt.classList.toggle('on', currentLang==='en');
  document.getElementById('langDesc').textContent = currentLang==='id'?'Indonesia':'English';
  lt.addEventListener('click',()=>{
    currentLang = currentLang==='id'?'en':'id';
    localStorage.setItem('bv_lang', currentLang);
    lt.classList.toggle('on', currentLang==='en');
    document.getElementById('langDesc').textContent = currentLang==='id'?'Indonesia':'English';
    applyI18n();
    renderAll();
  });

  // Reminder toggle
  const rt=document.getElementById('reminderToggle');
  const remOn=lsGet('bv_reminder',false);
  rt.classList.toggle('on', remOn);
  rt.addEventListener('click',()=>{
    const on=!rt.classList.contains('on');
    rt.classList.toggle('on',on);
    lsSet('bv_reminder',on);
    if(on && 'Notification' in window){
      Notification.requestPermission().then(p=>{
        if(p==='granted') toast('Pengingat diaktifkan','success');
        else toast('Izin notifikasi ditolak','error');
      });
    }
  });

  // Delete all
  document.getElementById('btnDeleteAll').addEventListener('click',()=>{
    showConfirm('Hapus semua data transaksi? Tindakan ini tidak dapat dibatalkan.', async ()=>{
      await dbSet('transactions', null);
      toast('Semua data dihapus','info');
    });
  });
}

/* ── Init ────────────────────────────────────────────────── */
applyTheme(lsGet(KEY_THEME,'light'));

/* ── Amount input: ketik langsung + format ribuan ────────── */
function setupAmountInput(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;

  inp.addEventListener('input', () => {
    const pos = inp.selectionStart;
    const raw = inp.value.replace(/\D/g, '');
    if (!raw) { inp.value = ''; return; }
    inp.value = new Intl.NumberFormat('id-ID').format(parseInt(raw, 10));
  });

  inp.addEventListener('focus', () => {
    const raw = inp.value.replace(/\D/g, '');
    inp.value = raw || '';
  });

  inp.addEventListener('blur', () => {
    const raw = inp.value.replace(/\D/g, '');
    if (!raw) { inp.value = ''; return; }
    inp.value = new Intl.NumberFormat('id-ID').format(parseInt(raw, 10));
  });
}

function initAmountInputs() {
  setupAmountInput('txAmount');
  setupAmountInput('rekSaldo');
}

/* ── Export dropdown ─────────────────────────────────────── */
function initExportDropdown() {
  const toggle   = document.getElementById('btnExportToggle');
  const dropdown = document.getElementById('exportDropdown');
  if (!toggle || !dropdown) return;

  // Set default dates
  const ef = document.getElementById('exportFrom');
  const et = document.getElementById('exportTo');
  if (ef && !ef.value) ef.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  if (et && !et.value) et.value = todayStr();
  if (ef) ef.addEventListener('change', renderTxList);
  if (et) et.addEventListener('change', renderTxList);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== toggle) {
      dropdown.classList.remove('open');
    }
  });
}
