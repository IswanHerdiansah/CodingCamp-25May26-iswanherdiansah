/* ============================================================
   Expense & Budget Visualizer — app.js
   Vanilla JS · LocalStorage · Chart.js
   ============================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────
const STORAGE_KEY = 'budget_visualizer_transactions';

const CATEGORY_META = {
  Food:      { emoji: '🍔', color: '#f97316', cssClass: 'food' },
  Transport: { emoji: '🚌', color: '#3b82f6', cssClass: 'transport' },
  Fun:       { emoji: '🎉', color: '#a855f7', cssClass: 'fun' },
};

// ── State ────────────────────────────────────────────────────
let transactions = loadTransactions();
let chart = null;

// ── DOM refs ─────────────────────────────────────────────────
const form            = document.getElementById('transactionForm');
const inputName       = document.getElementById('itemName');
const inputAmount     = document.getElementById('amount');
const inputCategory   = document.getElementById('category');
const nameError       = document.getElementById('nameError');
const amountError     = document.getElementById('amountError');
const categoryError   = document.getElementById('categoryError');
const totalBalanceEl  = document.getElementById('totalBalance');
const transactionList = document.getElementById('transactionList');
const emptyState      = document.getElementById('emptyState');
const transactionCount= document.getElementById('transactionCount');
const chartCanvas     = document.getElementById('spendingChart');
const chartEmpty      = document.getElementById('chartEmpty');
const chartLegend     = document.getElementById('chartLegend');

// ── LocalStorage helpers ─────────────────────────────────────
function loadTransactions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

// ── Validation ───────────────────────────────────────────────
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
    nameError.textContent = 'Item name is required.';
    valid = false;
  }

  const parsedAmount = parseFloat(amount);
  if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
    inputAmount.classList.add('is-invalid');
    amountError.textContent = 'Enter a valid amount greater than 0.';
    valid = false;
  }

  if (!category) {
    inputCategory.classList.add('is-invalid');
    categoryError.textContent = 'Please select a category.';
    valid = false;
  }

  return valid;
}

// ── Form submit ──────────────────────────────────────────────
form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearErrors();

  const name     = inputName.value;
  const amount   = inputAmount.value;
  const category = inputCategory.value;

  if (!validate(name, amount, category)) return;

  const transaction = {
    id:       crypto.randomUUID(),
    name:     name.trim(),
    amount:   parseFloat(parseFloat(amount).toFixed(2)),
    category,
    date:     new Date().toISOString(),
  };

  transactions.unshift(transaction); // newest first
  saveTransactions();
  render();

  // Reset form
  form.reset();
  inputName.focus();
});

// ── Delete ───────────────────────────────────────────────────
function deleteTransaction(id) {
  const item = document.querySelector(`[data-id="${id}"]`);
  if (item) {
    item.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    item.style.opacity = '0';
    item.style.transform = 'translateX(12px)';
    setTimeout(() => {
      transactions = transactions.filter(t => t.id !== id);
      saveTransactions();
      render();
    }, 180);
  }
}

// ── Render ───────────────────────────────────────────────────
function render() {
  renderBalance();
  renderList();
  renderChart();
}

function renderBalance() {
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  totalBalanceEl.textContent = formatCurrency(total);
}

function renderList() {
  const count = transactions.length;
  transactionCount.textContent = `${count} item${count !== 1 ? 's' : ''}`;

  // Remove existing transaction items (keep emptyState node)
  Array.from(transactionList.children).forEach(child => {
    if (!child.classList.contains('empty-state')) child.remove();
  });

  if (count === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  transactions.forEach(t => {
    const meta = CATEGORY_META[t.category];
    const item = document.createElement('div');
    item.className = 'transaction-item';
    item.dataset.id = t.id;

    item.innerHTML = `
      <div class="item-icon ${meta.cssClass}" aria-hidden="true">${meta.emoji}</div>
      <div class="item-details">
        <div class="item-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
        <div class="item-category ${meta.cssClass}">${t.category}</div>
      </div>
      <div class="item-amount">${formatCurrency(t.amount)}</div>
      <button class="btn-delete" aria-label="Delete ${escapeHtml(t.name)}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    `;

    item.querySelector('.btn-delete').addEventListener('click', () => deleteTransaction(t.id));
    transactionList.appendChild(item);
  });
}

function renderChart() {
  // Aggregate totals per category
  const totals = {};
  transactions.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const categories = Object.keys(totals);
  const hasData = categories.length > 0;

  // Toggle empty message
  if (hasData) {
    chartEmpty.classList.add('hidden');
  } else {
    chartEmpty.classList.remove('hidden');
  }

  const labels  = categories;
  const data    = categories.map(c => totals[c]);
  const colors  = categories.map(c => CATEGORY_META[c].color);

  if (chart) {
    // Update existing chart
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].backgroundColor = colors;
    chart.data.datasets[0].borderColor = colors.map(c => c);
    chart.update();
  } else {
    // Create chart
    chart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
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
            backgroundColor: '#1e2235',
            titleColor: '#fff',
            bodyColor: '#d1d5db',
            padding: 10,
            cornerRadius: 8,
          },
        },
        animation: { duration: 350, easing: 'easeInOutQuart' },
      },
    });
  }

  // Custom legend
  chartLegend.innerHTML = '';
  categories.forEach(cat => {
    const meta  = CATEGORY_META[cat];
    const total = totals[cat];
    const item  = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${meta.color}"></span>
      <span>${cat}: <strong>${formatCurrency(total)}</strong></span>
    `;
    chartLegend.appendChild(item);
  });
}

// ── Utilities ────────────────────────────────────────────────
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Init ─────────────────────────────────────────────────────
render();
