/* ============================================================
   Dashboard de Investigadores - Conexión Google Sheets
   ============================================================ */

// === URL CSV pública ===
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRB4gvGNHeT4raBftEY72XEqOmtCFnNoGuE2X7zHQeeogSFG0wwOUJx6JS9SJpZNxH0CkYr4fBxuwO9/pub?output=csv';

// === Configuración de la hoja ===
const CONFIG = {
  nombreCol: 0,
  publicaciones: [
    { col: 1, year: 2023 },
    { col: 2, year: 2024 },
    { col: 3, year: 2025 },
    { col: 4, year: 2026 },
    { col: 5, year: 2027 },
  ],
  proyectos: [
    { col: 6, label: '2023-2024' },
    { col: 7, label: '2024-2025' },
    { col: 8, label: '2025-2026' },
    { col: 9, label: '2026-2027' },
  ],
};

// === Paleta vibrante para gráficos ===
const PALETTE = {
  primary: ['#6366f1', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e', '#14b8a6'],
  gradient: (ctx, area) => {
    const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, 'rgba(99, 102, 241, 0.6)');
    g.addColorStop(1, 'rgba(236, 72, 153, 0.1)');
    return g;
  },
};

/* ========== Utilidades ========== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const fmt = (n) => Number(n || 0).toLocaleString('es-ES');
const showToast = (msg, type = '') => {
  const t = $('#toast');
  t.textContent = (type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : '') + msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = 'toast'), 3500);
};
const escape = (s) =>
  String(s || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));

const showError = (msg) => {
  $('#errorBanner').style.display = 'flex';
  $('#errorMsg').innerHTML = msg;
};

/* ========== CSV Parser ========== */
function decodeText(text) {
  // Google Sheets a veces sirve Latin1 mal etiquetado — intentar reparar
  try {
    // Si tiene caracteres UTF-8 mal decodificados (Ã­, Ã±, etc), re-decodificar
    if (/[ÃÂ]/.test(text)) {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch (e) {}
  return text;
}

function parseCSV(text) {
  text = decodeText(text);
  const rows = [];
  let cur = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

/* ========== Fetch con múltiples estrategias (CORS-safe) ========== */
async function fetchCSV() {
  // Estrategia 1: fetch directo
  try {
    const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
    if (res.ok) return await res.text();
  } catch (e) {
    console.warn('Fetch directo falló:', e.message);
  }

  // Estrategia 2: proxy CORS público
  const proxies = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];
  for (const wrap of proxies) {
    try {
      const res = await fetch(wrap(SHEET_CSV_URL), { cache: 'no-store' });
      if (res.ok) return await res.text();
    } catch (e) {
      console.warn('Proxy falló:', e.message);
    }
  }
  throw new Error('No se pudo cargar el sheet desde ningún origen');
}

/* ========== Fetch & Normalize ========== */
async function fetchData() {
  const text = await fetchCSV();
  const rows = parseCSV(text).filter((r) => r.some((c) => c && c.trim() !== ''));
  if (rows.length < 2) throw new Error('El sheet no contiene datos');

  return rows.slice(1).map((r, i) => {
    const nombre = (r[CONFIG.nombreCol] || '').trim();
    if (!nombre) return null;
    const pubPorAnio = {};
    let totalPub = 0;
    CONFIG.publicaciones.forEach(({ col, year }) => {
      const v = parseFloat((r[col] || '0').toString().replace(',', '.'));
      const n = isNaN(v) ? 0 : v;
      pubPorAnio[year] = n;
      totalPub += n;
    });
    const proyectos = [];
    const proyectosPorBienio = {};
    CONFIG.proyectos.forEach(({ col, label }) => {
      const np = (r[col] || '').trim();
      proyectosPorBienio[label] = np || null;
      if (np) proyectos.push({ bienio: label, nombre: np });
    });
    return {
      id: i, nombre, totalPub, pubPorAnio, proyectos, proyectosPorBienio,
      numProyectos: proyectos.length,
    };
  }).filter(Boolean);
}

/* ========== Charts ========== */
const charts = {};
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      padding: 12,
      titleFont: { size: 12, weight: '700' },
      bodyFont: { size: 12 },
      cornerRadius: 8,
      displayColors: true,
      boxWidth: 8, boxHeight: 8,
    },
  },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
    y: { grid: { color: '#f1f5f9', borderDash: [4, 4] }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
  },
};

function renderCharts(data) {
  // Top investigadores — score combinado: publicaciones totales + proyectos
  const scored = data.map((d) => ({ ...d, score: d.totalPub + d.numProyectos }));
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 10);
  const topLabels = top.map((d) => d.nombre.length > 18 ? d.nombre.slice(0, 17) + '…' : d.nombre);

  if (charts.ranking) charts.ranking.destroy();
  charts.ranking = new Chart($('#chartRanking'), {
    type: 'bar',
    data: {
      labels: topLabels,
      datasets: [{
        data: top.map((d) => d.score),
        backgroundColor: top.map((_, i) => PALETTE.primary[i % PALETTE.primary.length]),
        borderRadius: 8, maxBarThickness: 24,
        borderSkipped: false,
      }],
    },
    options: { ...chartDefaults, indexAxis: 'y' },
  });

  // Publicaciones por año (línea con área degradada)
  const pubAnual = {};
  CONFIG.publicaciones.forEach(({ year }) => (pubAnual[year] = 0));
  data.forEach((d) => Object.keys(d.pubPorAnio).forEach((y) => (pubAnual[y] = (pubAnual[y] || 0) + d.pubPorAnio[y])));
  const years = Object.keys(pubAnual).sort();
  if (charts.pubAnio) charts.pubAnio.destroy();
  charts.pubAnio = new Chart($('#chartPubAnio'), {
    type: 'bar',
    data: {
      labels: years,
      datasets: [{
        data: years.map((y) => pubAnual[y]),
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea: a } = ctx.chart;
          if (!a) return '#6366f1';
          const g = c.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, '#6366f1');
          g.addColorStop(1, '#ec4899');
          return g;
        },
        borderRadius: 10, maxBarThickness: 60, borderSkipped: false,
      }],
    },
    options: chartDefaults,
  });

  // Proyectos por bienio (línea)
  const proyPorBienio = {};
  CONFIG.proyectos.forEach(({ label }) => (proyPorBienio[label] = 0));
  data.forEach((d) => {
    CONFIG.proyectos.forEach(({ label }) => {
      if ((d.proyectosPorBienio[label] || '').trim()) proyPorBienio[label]++;
    });
  });
  const bienios = Object.keys(proyPorBienio);
  if (charts.proyAnio) charts.proyAnio.destroy();
  charts.proyAnio = new Chart($('#chartProyAnio'), {
    type: 'line',
    data: {
      labels: bienios,
      datasets: [{
        data: bienios.map((b) => proyPorBienio[b]),
        borderColor: '#10b981',
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea: a } = ctx.chart;
          if (!a) return 'rgba(16, 185, 129, 0.2)';
          const g = c.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, 'rgba(16, 185, 129, 0.5)');
          g.addColorStop(1, 'rgba(16, 185, 129, 0)');
          return g;
        },
        fill: true, tension: 0.4, pointRadius: 6,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#10b981', pointBorderWidth: 3,
        pointHoverRadius: 8,
        borderWidth: 3,
      }],
    },
    options: chartDefaults,
  });

  // Distribución de proyectos (dona)
  const proyectosCount = {};
  data.forEach((d) => d.proyectos.forEach((p) => {
    proyectosCount[p.nombre] = (proyectosCount[p.nombre] || 0) + 1;
  }));
  const topProyectos = Object.entries(proyectosCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (charts.proyDist) charts.proyDist.destroy();
  charts.proyDist = new Chart($('#chartProyDist'), {
    type: 'doughnut',
    data: {
      labels: topProyectos.map(([n]) => n.length > 24 ? n.slice(0, 23) + '…' : n),
      datasets: [{
        data: topProyectos.map(([, c]) => c),
        backgroundColor: PALETTE.primary,
        borderWidth: 3, borderColor: '#fff',
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: { position: 'right', labels: { color: '#475569', font: { size: 11, weight: '500' }, boxWidth: 12, boxHeight: 12, padding: 10, usePointStyle: true } },
        tooltip: chartDefaults.plugins.tooltip,
      },
    },
  });
}

/* ========== KPIs ========== */
function renderKPIs(data) {
  const totalPub = data.reduce((s, d) => s + d.totalPub, 0);
  const totalProy = data.reduce((s, d) => s + d.numProyectos, 0);
  const activos = data.filter((d) => d.totalPub > 0).length;
  $('#kpi-investigadores').textContent = fmt(data.length);
  $('#kpi-activos').textContent = fmt(activos);
  $('#kpi-publicaciones').textContent = fmt(totalPub);
  $('#kpi-proyectos').textContent = fmt(totalProy);
}

/* ========== Tabla ========== */
function renderTable(data) {
  const tbody = $('#rankingBody');
  // Ranking 2026: ordenar por publicaciones del año 2026 (desc)
  const sorted = [...data].sort((a, b) => {
    const pa = a.pubPorAnio[2026] || 0;
    const pb = b.pubPorAnio[2026] || 0;
    if (pb !== pa) return pb - pa;
    // Desempate por total acumulado, luego alfabético
    if (b.totalPub !== a.totalPub) return b.totalPub - a.totalPub;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
  tbody.innerHTML = sorted.map((d, i) => {
    const rankCls = i === 0 ? 'top-1' : i === 1 ? 'top-2' : i === 2 ? 'top-3' : '';
    const pub2026 = d.pubPorAnio[2026] || 0;
    return `
      <tr data-search="${(d.nombre + ' ' + d.proyectos.map((p) => p.nombre).join(' ')).toLowerCase()}">
        <td><span class="rank ${rankCls}">${i + 1}</span></td>
        <td><strong>${escape(d.nombre)}</strong></td>
        <td class="num"><strong>${fmt(d.totalPub)}</strong></td>
        <td class="num">${fmt(d.numProyectos)}</td>
        <td class="num">${fmt(pub2026)}</td>
      </tr>
    `;
  }).join('');
}

/* ========== Top 10 Bars ========== */
function renderBars(data, field, containerId) {
  const top = [...data].sort((a, b) => b[field] - a[field]).slice(0, 10);
  const max = Math.max(...top.map((d) => d[field]), 1);
  const container = $(containerId);
  container.innerHTML = top.map((d) => `
    <div class="bar-row">
      <span class="bar-label" title="${escape(d.nombre)}">${escape(d.nombre)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(d[field] / max) * 100}%"></div></div>
      <span class="bar-value">${fmt(d[field])}</span>
    </div>
  `).join('') || '<p class="empty">Sin datos</p>';
}

/* ========== Detalle de proyectos ========== */
function renderProyectosDetalle(data) {
  const container = $('#proyectosDetalle');
  const sorted = [...data].sort((a, b) => b.numProyectos - a.numProyectos);
  container.innerHTML = sorted.map((d) => {
    const tags = d.proyectos.length
      ? d.proyectos.map((p) => `<span class="tag" title="${escape(p.nombre)} · ${escape(p.bienio)}">${escape(p.bienio)} · ${escape(p.nombre)}</span>`).join('')
      : '<span class="tag empty">Sin proyectos</span>';
    return `
      <div class="detail-row">
        <div class="detail-name">
          <strong>${escape(d.nombre)}</strong>
          <span class="detail-count">${d.numProyectos} proyecto${d.numProyectos === 1 ? '' : 's'}</span>
        </div>
        <div class="tags">${tags}</div>
      </div>
    `;
  }).join('');
}

/* ========== Búsqueda ========== */
function bindSearch() {
  $('#searchInput').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    $$('#rankingBody tr').forEach((tr) => {
      tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
  });
}

/* ========== Skeletons ========== */
function showSkeletons() {
  ['#kpi-investigadores', '#kpi-activos', '#kpi-publicaciones', '#kpi-proyectos'].forEach((sel) => {
    const el = $(sel);
    if (el) { el.classList.add('skeleton'); el.textContent = '0000'; }
  });
}
function hideSkeletons() {
  document.querySelectorAll('.skeleton').forEach((el) => el.classList.remove('skeleton'));
}

/* ============================================================
   Sync en tiempo real — polling adaptativo + hash de cambios
   ============================================================ */

// Estado del último contenido conocido (para detectar diffs)
let lastHash = null;
let lastData = null;
let lastTotals = null;
let changeCount = 0;
let consecutiveNoChange = 0;
let pollTimer = null;
let isFetching = false;
let isFirstLoad = true;

// Intervalos de polling (ms)
const POLL_FAST = 4000;   // 4s cuando hay cambios recientes
const POLL_SLOW = 30000;  // 30s cuando todo está estable
let currentPollDelay = POLL_FAST;

// Estado de conexión
const ConnState = { LIVE: 'live', RETRY: 'retry', OFFLINE: 'offline' };
let connState = ConnState.LIVE;
let consecutiveErrors = 0;

function quickHash(text) {
  // Hash ligero (FNV-1a simplificado). Suficiente para detectar diffs en CSV.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 16777619) | 0;
  }
  return (h >>> 0).toString(16) + ':' + text.length;
}

function totalsOf(data) {
  // Huella compacta de los valores que muestran los KPIs/tabla.
  // Si esto cambia, repintamos; si no, saltamos el repintado (barato).
  const totalPub = data.reduce((s, d) => s + d.totalPub, 0);
  const totalProy = data.reduce((s, d) => s + d.numProyectos, 0);
  const activos = data.filter((d) => d.totalPub > 0).length;
  const top = [...data].sort((a, b) => b.totalPub - a.totalPub).slice(0, 5)
    .map((d) => `${d.nombre}:${d.totalPub}:${d.numProyectos}`).join('|');
  return `${data.length}:${totalPub}:${totalProy}:${activos}::${top}`;
}

function setConnState(state) {
  if (state === connState) return;
  connState = state;
  const el = $('#lastUpdate');
  if (!el) return;
  el.classList.remove('state-live', 'state-retry', 'state-offline');
  if (state === ConnState.LIVE) {
    el.classList.add('state-live');
    el.innerHTML = `<span class="status-dot live"></span> En vivo · <span class="last-time">${lastTimeText()}</span>`;
  } else if (state === ConnState.RETRY) {
    el.classList.add('state-retry');
    el.innerHTML = `<span class="status-dot retry"></span> Reintentando…`;
  } else {
    el.classList.add('state-offline');
    el.innerHTML = `<span class="status-dot offline"></span> Sin conexión`;
  }
}

function lastTimeText() {
  return `Actualizado ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function flashChangedKPIs(newTotals) {
  // Compara KPIs anteriores con nuevos y marca los que cambiaron.
  if (!lastTotals) return;
  const map = [
    { sel: '#kpi-investigadores', key: 'investigadores' },
    { sel: '#kpi-activos',        key: 'activos' },
    { sel: '#kpi-publicaciones',  key: 'publicaciones' },
    { sel: '#kpi-proyectos',      key: 'proyectos' },
  ];
  const [count, pub, proy, act] = lastTotals.split(':');
  const prev = { investigadores: count, activos: act, publicaciones: pub, proyectos: proy };
  const [nCount, nPub, nProy, nAct] = newTotals.split(':');
  const next = { investigadores: nCount, activos: nAct, publicaciones: nPub, proyectos: nProy };
  map.forEach(({ sel, key }) => {
    if (prev[key] !== next[key]) {
      const el = $(sel);
      if (el) {
        el.classList.remove('kpi-flash');
        // Forzar reflow para reiniciar la animación
        void el.offsetWidth;
        el.classList.add('kpi-flash');
      }
    }
  });
}

/* ========== Init ========== */
async function loadDashboard(silent = true) {
  if (isFetching) return; // evitar solapamientos
  isFetching = true;
  const btn = $('#refreshBtn');

  if (!silent) {
    btn.classList.add('spinning');
    $('#errorBanner').style.display = 'none';
    showSkeletons();
  }

  try {
    const text = await fetchCSV();
    const hash = quickHash(text);

    // Sin cambios desde el último poll → solo actualizar tiempo si es necesario
    if (hash === lastHash) {
      consecutiveNoChange++;
      // Si llevamos 3 polls sin cambios, bajamos a polling lento
      if (consecutiveNoChange >= 3 && currentPollDelay !== POLL_SLOW) {
        currentPollDelay = POLL_SLOW;
        scheduleNextPoll();
      }
      consecutiveErrors = 0;
      setConnState(ConnState.LIVE);
      if (!silent) hideSkeletons();
      return;
    }

    // Hay cambios → repintar
    const rows = parseCSV(text).filter((r) => r.some((c) => c && c.trim() !== ''));
    if (rows.length < 2) throw new Error('El sheet no contiene datos');

    const data = rows.slice(1).map((r, i) => {
      const nombre = (r[CONFIG.nombreCol] || '').trim();
      if (!nombre) return null;
      const pubPorAnio = {};
      let totalPub = 0;
      CONFIG.publicaciones.forEach(({ col, year }) => {
        const v = parseFloat((r[col] || '0').toString().replace(',', '.'));
        const n = isNaN(v) ? 0 : v;
        pubPorAnio[year] = n;
        totalPub += n;
      });
      const proyectos = [];
      const proyectosPorBienio = {};
      CONFIG.proyectos.forEach(({ col, label }) => {
        const np = (r[col] || '').trim();
        proyectosPorBienio[label] = np || null;
        if (np) proyectos.push({ bienio: label, nombre: np });
      });
      return {
        id: i, nombre, totalPub, pubPorAnio, proyectos, proyectosPorBienio,
        numProyectos: proyectos.length,
      };
    }).filter(Boolean);

    // Detección de cambios finos para el feedback visual
    const newTotals = totalsOf(data);
    flashChangedKPIs(newTotals);

    renderKPIs(data);
    renderCharts(data);
    renderTable(data);
    renderBars(data, 'totalPub', '#barsPublicaciones');
    renderBars(data, 'numProyectos', '#barsProyectos');
    renderProyectosDetalle(data);
    hideSkeletons();

    lastHash = hash;
    lastData = data;
    lastTotals = newTotals;
    consecutiveNoChange = 0;
    consecutiveErrors = 0;

    // Si estábamos en polling lento, volvemos a rápido
    if (currentPollDelay !== POLL_FAST) {
      currentPollDelay = POLL_FAST;
      scheduleNextPoll();
    }

    if (isFirstLoad) {
      showToast(`${data.length} investigadores cargados`, 'success');
      isFirstLoad = false;
    } else {
      changeCount++;
      updateChangeBadge();
      showToast('🔄 Datos actualizados', 'success');
    }

    const el = $('#lastUpdate');
    if (el) {
      el.classList.remove('state-retry', 'state-offline');
      el.classList.add('state-live');
      el.innerHTML = `<span class="status-dot live"></span> En vivo · <span class="last-time">${lastTimeText()}</span>`;
    }
    setConnState(ConnState.LIVE);
  } catch (err) {
    consecutiveErrors++;
    console.warn('Sync error:', err.message);
    hideSkeletons();

    if (consecutiveErrors >= 2) {
      setConnState(ConnState.OFFLINE);
      if (!silent) {
        showToast(err.message, 'error');
        showError(`Si abriste el archivo con doble click, el navegador bloquea la carga. <strong>Solución:</strong> sirve la carpeta con un servidor local (<code>python -m http.server 8000</code>) o usa <code>npx serve</code>.`);
      }
    } else {
      setConnState(ConnState.RETRY);
    }
    // Forzar reintento rápido tras error
    currentPollDelay = POLL_FAST;
    scheduleNextPoll();
  } finally {
    isFetching = false;
    btn.classList.remove('spinning');
  }
}

function updateChangeBadge() {
  const el = $('#changeBadge');
  if (!el) return;
  if (changeCount > 0) {
    el.textContent = changeCount;
    el.style.display = 'inline-grid';
  } else {
    el.style.display = 'none';
  }
}

function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await loadDashboard(true);
    if (currentPollDelay === POLL_FAST) scheduleNextPoll();
  }, currentPollDelay);
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  // Primera carga inmediata
  loadDashboard(false).then(() => scheduleNextPoll());
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

document.addEventListener('DOMContentLoaded', () => {
  bindSearch();
  startPolling();
  $('#refreshBtn').addEventListener('click', () => {
    changeCount = 0;
    updateChangeBadge();
    currentPollDelay = POLL_FAST;
    loadDashboard(false).then(() => scheduleNextPoll());
  });

  // Pausar/reanudar según visibilidad de la pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      // Al volver, hacer un fetch inmediato para mostrar datos frescos
      startPolling();
    }
  });
});
