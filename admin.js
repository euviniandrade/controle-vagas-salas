const apiUrl = window.APP_CONFIG?.GOOGLE_SCRIPT_URL || "";
const tokenKey = "aps-admin-token";

const $ = (selector) => document.querySelector(selector);
let dashboardData = { units: [], rooms: [], users: [], reports: [], movements: [], evasion: [] };
let refreshTimer = null;
let activeUnit = "all";

initAdmin();

function initAdmin() {
  initBrain();
  $("#loginForm").addEventListener("submit", login);
  $("#refreshButton").addEventListener("click", loadDashboard);
  $("#clearDataAdminButton")?.addEventListener("click", clearAllDataAdmin);
  $("#unitSearch").addEventListener("input", renderDashboard);
  $("#accessForm").addEventListener("submit", createAccessRequest);
  $("#publicAccessButton")?.addEventListener("click", createPublicAccessRequest);
  $("#recoveryButton")?.addEventListener("click", requestPasswordRecovery);
  $("#printUnitBtn")?.addEventListener("click", () => window.print());
  document.querySelector(".unit-filter-btn[data-unit='all']").addEventListener("click", () => selectUnit("all"));
  if (localStorage.getItem(tokenKey)) restoreSession();
}

function selectUnit(unit) {
  activeUnit = unit;
  document.querySelectorAll(".unit-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.unit === unit);
  });
  if (unit === "all") {
    $("#overviewSection").hidden = false;
    $("#unitDetailSection").hidden = true;
    $("#dashboardTitle").textContent = "Resultados consolidados";
  } else {
    $("#overviewSection").hidden = true;
    $("#unitDetailSection").hidden = false;
    renderUnitDetail(unit);
  }
}

const SHIFT_ORDER = ["Manhã", "Tarde", "Integral"];
const SHIFT_EMOJI = { "Manhã": "🌅", "Tarde": "🌆", "Integral": "🔄" };
const SEG_EMOJI = { "Educação Infantil": "🍎", "Fundamental 1": "📚", "Fundamental 2": "📖", "Ensino Médio": "🎓", "Contraturno": "🔄" };

function renderUnitDetail(unitName) {
  const unitData = dashboardData.units.find((u) => u.unit === unitName) || {};
  const rooms = dashboardData.rooms.filter((r) => r.unit === unitName);
  const director = unitData.director || "-";
  const syncDate = unitData.updatedAt ? formatDateTime(unitData.updatedAt) : "—";

  $("#dashboardTitle").textContent = `${unitName}`;

  // KPIs
  const cap = Number(unitData.capacity || 0);
  const stu = Number(unitData.students || 0);
  const vac = Number(unitData.vacancies || 0);
  const occ = cap > 0 ? Math.round((stu / cap) * 100) : 0;
  $("#udRooms").textContent = unitData.totalRooms || rooms.length || 0;
  $("#udCapacity").textContent = cap;
  $("#udStudents").textContent = stu;
  $("#udVacancies").textContent = vac;
  $("#udOccupancy").textContent = `${occ}%`;

  // Director info strip
  const dirStrip = document.getElementById("udDirectorStrip");
  if (dirStrip) {
    dirStrip.innerHTML = `<span>👤 <strong>${escapeHtml(director)}</strong></span><span>📅 Sincronizado: <strong>${escapeHtml(syncDate)}</strong></span><span>🏫 <strong>${escapeHtml(unitName)}</strong></span>`;
  }

  // Segment summary
  const bySeg = {};
  rooms.forEach((r) => {
    const seg = r.segment || "Outros";
    if (!bySeg[seg]) bySeg[seg] = { cap: 0, stu: 0, vac: 0, count: 0 };
    bySeg[seg].cap += Number(r.capacity || 0);
    bySeg[seg].stu += Number(r.students || 0);
    bySeg[seg].vac += Number(r.vacancies || 0);
    bySeg[seg].count += 1;
  });
  const segSummary = document.getElementById("udSegSummary");
  if (segSummary) {
    segSummary.innerHTML = Object.entries(bySeg).map(([seg, d]) => {
      const pct = d.cap > 0 ? Math.round((d.stu / d.cap) * 100) : 0;
      return `<div class="seg-kpi">
        <div class="seg-kpi-label">${SEG_EMOJI[seg] || "📋"} ${escapeHtml(seg)}</div>
        <div class="seg-kpi-nums"><strong>${d.vac}</strong> vagas · ${d.stu}/${d.cap} · ${pct}%</div>
        <div class="seg-kpi-bar-wrap"><div class="seg-kpi-bar" style="width:${pct}%"></div></div>
      </div>`;
    }).join("") || `<div class="empty-state">Nenhum dado disponível.</div>`;
  }

  const body = $("#unitDetailBody");
  if (!rooms.length) {
    body.innerHTML = `<div class="empty-state" style="padding:48px;font-size:1.1rem;text-align:center;">Nenhuma turma sincronizada ainda.<br><small>Peça ao diretor para preencher e sincronizar.</small></div>`;
    return;
  }

  // Group by shift
  const byShift = {};
  rooms.forEach((r) => {
    const s = r.shift || "Outro";
    if (!byShift[s]) byShift[s] = [];
    byShift[s].push(r);
  });
  const shifts = [...SHIFT_ORDER.filter((s) => byShift[s]), ...Object.keys(byShift).filter((s) => !SHIFT_ORDER.includes(s))];

  body.innerHTML = shifts.map((shift) => {
    const shiftRooms = byShift[shift] || [];
    const tCap = shiftRooms.reduce((a, r) => a + Number(r.capacity || 0), 0);
    const tStu = shiftRooms.reduce((a, r) => a + Number(r.students || 0), 0);
    const tVac = shiftRooms.reduce((a, r) => a + Number(r.vacancies || 0), 0);

    const segGroups = {};
    shiftRooms.forEach((r) => {
      const seg = r.segment || "Outros";
      if (!segGroups[seg]) segGroups[seg] = [];
      segGroups[seg].push(r);
    });

    const roomCards = Object.entries(segGroups).map(([seg, segRooms]) => {
      const divider = `<div class="segment-divider">${SEG_EMOJI[seg] || "📋"} ${escapeHtml(seg)}</div>`;
      const cards = segRooms.map((room) => {
        const rCap = Number(room.capacity || 0);
        const rStu = Number(room.students || 0);
        const rVac = Number(room.vacancies || 0);
        const pct = rCap > 0 ? Math.min(100, Math.round((rStu / rCap) * 100)) : 0;
        const barClass = pct >= 100 ? "full" : pct >= 80 ? "warn" : "";
        const vagasClass = rVac > 0 ? "pos" : "zero";
        const label = [room.grade, room.letter].filter(Boolean).join(" – ");
        const rid = `room_${escapeAttr(room.id || (room.grade + room.shift + room.letter))}`;
        return `
          <div class="room-card" data-rid="${rid}" data-room='${JSON.stringify({ grade: room.grade, letter: room.letter, shift: room.shift, segment: room.segment, capacity: rCap, students: rStu, vacancies: rVac }).replace(/'/g,"&#39;")}'>
            <div class="room-card-grade">${escapeHtml(label || "-")}</div>
            <div class="room-card-seg">${escapeHtml(seg)}</div>
            <div class="room-card-bar-wrap"><div class="room-card-bar ${barClass}" style="width:${pct}%"></div></div>
            <div class="room-card-nums"><span>${rStu} alunos / ${rCap} cap.</span><strong>${pct}%</strong></div>
            <div class="room-vagas ${vagasClass}">${rVac > 0 ? `✅ ${rVac} livre(s)` : "🔴 Sem vagas"}</div>
            <div class="room-card-cta">🪑 Ver mapa de cadeiras</div>
          </div>`;
      }).join("");
      return divider + `<div class="rooms-grid">${cards}</div>`;
    }).join("");

    return `
      <div class="shift-block">
        <div class="shift-block-header">
          <h3>${SHIFT_EMOJI[shift] || "📋"} ${escapeHtml(shift)}</h3>
          <div class="shift-badge">
            <span class="shift-stat">${shiftRooms.length} sala(s)</span>
            <span class="shift-stat">${tStu}/${tCap} alunos</span>
            <span class="shift-stat vagas">🎯 ${tVac} vaga(s)</span>
          </div>
        </div>
        ${roomCards}
      </div>`;
  }).join("");

  // Bind room card clicks
  body.querySelectorAll(".room-card").forEach((card) => {
    card.addEventListener("click", () => {
      try { openSeatModal(JSON.parse(card.dataset.room.replace(/&#39;/g, "'"))); } catch {}
    });
  });
}

// ── Seat Map Modal ──
function openSeatModal(room) {
  const existing = document.getElementById("seatModal");
  if (existing) existing.remove();

  const cap = Number(room.capacity || 0);
  const stu = Number(room.students || 0);
  const vac = Number(room.vacancies || 0);
  const pct = cap > 0 ? Math.round((stu / cap) * 100) : 0;
  const label = [room.grade, room.letter].filter(Boolean).join(" – ");

  const modal = document.createElement("div");
  modal.id = "seatModal";
  modal.className = "seat-modal-overlay";
  modal.innerHTML = `
    <div class="seat-modal">
      <button class="seat-modal-close" id="closeSeatModal">✕</button>
      <div class="seat-modal-header">
        <div>
          <p class="eyebrow">${escapeHtml(room.segment || "")} · ${escapeHtml(room.shift || "")}</p>
          <h2>${escapeHtml(label)}</h2>
        </div>
        <div class="seat-modal-kpis">
          <div class="sm-kpi"><span>Capacidade</span><strong>${cap}</strong></div>
          <div class="sm-kpi"><span>Alunos</span><strong>${stu}</strong></div>
          <div class="sm-kpi hot"><span>Vagas</span><strong>${vac}</strong></div>
          <div class="sm-kpi"><span>Ocupação</span><strong>${pct}%</strong></div>
        </div>
      </div>
      <div class="seat-legend">
        <span><i class="seat-ico occupied"></i> Ocupada (${stu})</span>
        <span><i class="seat-ico available"></i> Disponível (${vac})</span>
      </div>
      <div class="classroom-view">
        <div class="blackboard">📋 Quadro</div>
        <div class="teacher-desk">🪑 Professor</div>
        ${buildSeatGrid(cap, stu)}
      </div>
      <div class="seat-modal-footer">
        <p>Legenda: cadeiras <strong style="color:#4dffb8">verdes</strong> = vagas disponíveis · cadeiras <strong style="color:#4a5568">cinzas</strong> = alunos matriculados</p>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("closeSeatModal").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

function buildSeatGrid(capacity, occupied) {
  if (capacity <= 0) return `<div class="seat-empty">Capacidade não informada</div>`;
  const cols = capacity <= 20 ? 4 : capacity <= 36 ? 6 : capacity <= 48 ? 8 : 10;
  const seats = Array.from({ length: capacity }, (_, i) => {
    const isOcc = i < occupied;
    return `<div class="seat ${isOcc ? "occupied" : "available"}" title="${isOcc ? "Ocupada" : "Disponível"}">
      ${seatSvg(isOcc)}
    </div>`;
  });
  // Group into rows with aisle
  const rows = [];
  for (let i = 0; i < seats.length; i += cols) {
    const half = Math.ceil(cols / 2);
    const rowSeats = seats.slice(i, i + cols);
    const left = rowSeats.slice(0, half).join("");
    const right = rowSeats.slice(half).join("");
    rows.push(`<div class="seat-row">${left}<div class="seat-aisle"></div>${right}</div>`);
  }
  return `<div class="seat-grid">${rows.join("")}</div>`;
}

function seatSvg(occupied) {
  const color = occupied ? "#2d3748" : "#4dffb8";
  const shade = occupied ? "#1a202c" : "#00c97a";
  return `<svg viewBox="0 0 32 36" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="10" width="28" height="18" rx="3" fill="${color}" stroke="${shade}" stroke-width="1.5"/>
    <rect x="6" y="28" width="4" height="6" rx="1.5" fill="${shade}"/>
    <rect x="22" y="28" width="4" height="6" rx="1.5" fill="${shade}"/>
    <rect x="2" y="6" width="28" height="8" rx="3" fill="${shade}"/>
  </svg>`;
}

function buildUnitFilterButtons(units) {
  const container = $("#unitFilterButtons");
  container.innerHTML = units.map((u) => `
    <button class="unit-filter-btn" data-unit="${escapeAttr(u.unit)}" type="button">${escapeHtml(u.unit)}</button>`).join("");
  container.querySelectorAll(".unit-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectUnit(btn.dataset.unit));
  });
}

async function login(event) {
  event.preventDefault();
  setLoginStatus("Validando acesso...");
  try {
    const result = await api("adminLogin", {
      email: $("#adminEmail").value.trim(),
      password: $("#adminPassword").value,
    });
    if (!result.ok) throw new Error(result.error || "Login não autorizado.");
    localStorage.setItem(tokenKey, result.token);
    setLoginStatus("Carregando painel...");
    if (await loadDashboard()) showDashboard();
  } catch (error) {
    setLoginStatus(error.message || "Não foi possível entrar.");
  }
}

function showDashboard() {
  $("#loginView").hidden = true;
  $("#dashboardView").hidden = false;
  setLoginStatus("");
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadDashboard, 30000);
}

function showLogin(message = "") {
  clearInterval(refreshTimer);
  $("#dashboardView").hidden = true;
  $("#loginView").hidden = false;
  if (message) setLoginStatus(message);
}

async function restoreSession() {
  showLogin("Validando sessão salva...");
  if (await loadDashboard()) showDashboard();
}

async function loadDashboard() {
  const button = $("#refreshButton");
  if (button) button.textContent = "Atualizando...";
  try {
    const result = await api("adminDashboard", { token: localStorage.getItem(tokenKey) || "" });
    if (!result.ok) throw new Error(result.error || "Falha ao ler dados.");
    dashboardData = result.data || dashboardData;
    renderDashboard();
    return true;
  } catch (error) {
    if (String(error.message || "").includes("Sessão")) {
      localStorage.removeItem(tokenKey);
      showLogin(error.message || "Sessão expirada. Faça login novamente.");
    }
    setLoginStatus(error.message || "Falha ao carregar painel.");
    return false;
  } finally {
    if (button) button.textContent = "Atualizar dados";
  }
}

async function requestPasswordRecovery() {
  const status = $("#recoveryStatus");
  const email = $("#recoveryEmail").value.trim();
  if (!email) {
    status.textContent = "Informe o email para recuperar o acesso.";
    return;
  }
  status.textContent = "Enviando instruções...";
  try {
    const result = await api("forgotPassword", { email });
    if (!result.ok) throw new Error(result.error || "Não consegui enviar a recuperação.");
    $("#recoveryEmail").value = "";
    status.textContent = "Se o email estiver cadastrado, as instruções foram enviadas.";
  } catch (error) {
    status.textContent = error.message || "Falha ao solicitar recuperação.";
  }
}

async function createAccessRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = await api("requestAccess", {
    name: $("#accessName").value.trim(),
    email: $("#accessEmail").value.trim(),
    unit: $("#accessUnit").value.trim(),
  });
  if (result.ok) {
    form.reset();
    await loadDashboard();
  }
}

async function clearAllDataAdmin() {
  const btn = $("#clearDataAdminButton");
  if (!confirm("⚠️ ATENÇÃO: isso apagará TODOS os registros de salas, unidades, movimentações, evasão e relatórios da planilha.\n\nEssa ação não pode ser desfeita. Confirmar?")) return;
  btn.textContent = "Limpando...";
  btn.disabled = true;
  try {
    const result = await api("clearAllData", { token: localStorage.getItem(tokenKey) || "" });
    if (!result.ok) throw new Error(result.error || "Falha ao limpar dados.");
    alert(`✅ Dados limpos com sucesso!\nAbas limpas: ${(result.cleared || []).join(", ")}`);
    await loadDashboard();
  } catch (error) {
    alert("Erro ao limpar: " + error.message);
  } finally {
    btn.textContent = "🗑️ Limpar todos os dados";
    btn.disabled = false;
  }
}

async function createPublicAccessRequest() {
  const status = $("#publicAccessStatus");
  status.textContent = "Enviando solicitação...";
  try {
    const result = await api("requestAccess", {
      name: $("#publicAccessName").value.trim(),
      email: $("#publicAccessEmail").value.trim(),
      unit: $("#publicAccessUnit").value.trim(),
    });
    if (!result.ok) throw new Error(result.error || "Não consegui registrar a solicitação.");
    $("#publicAccessName").value = "";
    $("#publicAccessEmail").value = "";
    $("#publicAccessUnit").value = "";
    status.textContent = "Solicitação enviada. A liberação será feita pela administração.";
  } catch (error) {
    status.textContent = error.message || "Falha ao solicitar acesso.";
  }
}

function renderDashboard() {
  const units = dashboardData.units || [];
  buildUnitFilterButtons(units);
  if (activeUnit !== "all") {
    selectUnit(activeUnit);
    return;
  }
  const rooms = dashboardData.rooms || [];
  const users = dashboardData.users || [];
  const reports = dashboardData.reports || [];
  const movements = dashboardData.movements || [];
  const evasion = dashboardData.evasion || movements.filter((movement) => movement.type === "Saída");
  const totals = units.reduce((acc, unit) => {
    acc.units += 1;
    acc.rooms += Number(unit.totalRooms || 0);
    acc.capacity += Number(unit.capacity || 0);
    acc.students += Number(unit.students || 0);
    acc.vacancies += Number(unit.vacancies || 0);
    return acc;
  }, { units: 0, rooms: 0, capacity: 0, students: 0, vacancies: 0 });
  const movementTotals = movements.reduce((acc, movement) => {
    if (movement.type === "Entrada") acc.entries += Number(movement.amount || 0);
    if (movement.type === "Saída") {
      acc.exits += Number(movement.amount || 0);
      const reason = movement.reason || "Não informado";
      acc.reasons[reason] = (acc.reasons[reason] || 0) + Number(movement.amount || 0);
    }
    return acc;
  }, { entries: 0, exits: 0, reasons: {} });

  $("#totalUnits").textContent = totals.units;
  $("#totalRooms").textContent = totals.rooms;
  $("#totalCapacity").textContent = totals.capacity;
  $("#totalStudents").textContent = totals.students;
  $("#totalVacancies").textContent = totals.vacancies;
  $("#totalEntries").textContent = movementTotals.entries;
  $("#totalExits").textContent = movementTotals.exits;
  $("#evasionRate").textContent = totals.students ? `${Math.round((movementTotals.exits / totals.students) * 1000) / 10}%` : "0%";

  const campaignFocus = [...units]
    .filter((unit) => Number(unit.vacancies || 0) > 0)
    .sort((a, b) => Number(b.vacancies || 0) - Number(a.vacancies || 0))
    .slice(0, 6);
  const safeSet = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  safeSet("campaignFocusList", campaignFocus.length
    ? campaignFocus.map((unit) => `<div class="reason-item"><strong>${escapeHtml(unit.unit || "-")}</strong><span>${escapeHtml(unit.vacancies || 0)} vaga(s)</span></div>`).join("")
    : `<div class="empty-state">Nenhuma unidade com vaga aberta sincronizada ainda.</div>`);

  const exitsByUnit = movements.reduce((acc, movement) => {
    if (movement.type === "Saída") acc[movement.unit || "-"] = (acc[movement.unit || "-"] || 0) + Number(movement.amount || 0);
    return acc;
  }, {});
  const riskUnits = Object.entries(exitsByUnit)
    .map(([unit, exits]) => ({ unit, exits, vacancies: Number((units.find((item) => item.unit === unit) || {}).vacancies || 0) }))
    .sort((a, b) => b.exits - a.exits || a.vacancies - b.vacancies)
    .slice(0, 6);
  safeSet("riskUnitsList", riskUnits.length
    ? riskUnits.map((item) => `<div class="reason-item"><strong>${escapeHtml(item.unit)}</strong><span>${escapeHtml(item.exits)} saída(s)</span></div>`).join("")
    : `<div class="empty-state">Sem risco de evasão registrado até agora.</div>`);

  const query = ($("#unitSearch") || {}).value?.trim().toLowerCase() || "";
  const filteredUnits = units.filter((unit) => `${unit.unit} ${unit.director}`.toLowerCase().includes(query));
  safeSet("unitTable", table([
    ["Unidade", "Diretor", "Salas", "Capacidade", "Alunos", "Vagas"],
    ...filteredUnits.map((unit) => [
      escapeHtml(unit.unit || "-"),
      escapeHtml(unit.director || "-"),
      escapeHtml(unit.totalRooms || 0),
      escapeHtml(unit.capacity || 0),
      escapeHtml(unit.students || 0),
      `<strong>${escapeHtml(unit.vacancies || 0)}</strong><small>${escapeHtml(unit.week || "")}</small>`,
    ]),
  ]);

  const roomsTable = $("#roomsTable");
  if (roomsTable) roomsTable.innerHTML = table([
    ["Unidade", "Turma", "Segmento", "Cap.", "Alunos", "Vagas"],
    ...rooms.slice(0, 450).map((room) => [
      escapeHtml(room.unit || "-"),
      escapeHtml(`${room.grade || "-"} · ${room.shift || "-"} ${room.letter || ""}`),
      escapeHtml(room.segment || "-"),
      escapeHtml(room.capacity || 0),
      escapeHtml(room.students || 0),
      `<strong>${escapeHtml(room.vacancies || 0)}</strong>`,
    ]),
  ]);

  safeSet("usersList", users.length
    ? users.map((user) => `<div class="user-pill"><strong>${escapeHtml(user.name || user.email || "-")}</strong><span>${escapeHtml(user.email || "")}</span><span>${escapeHtml(user.unit || "")} · <b class="status-ok">${escapeHtml(user.status || "Pendente")}</b></span></div>`).join("")
    : `<div class="empty-state">Nenhum usuário cadastrado ainda.</div>`);

  safeSet("reasonList", Object.keys(movementTotals.reasons).length
    ? Object.entries(movementTotals.reasons).sort((a, b) => b[1] - a[1]).map(([reason, total]) => `<div class="reason-item"><strong>${escapeHtml(reason)}</strong><span>${escapeHtml(total)} saída(s)</span></div>`).join("")
    : `<div class="empty-state">Sem saídas registradas até agora.</div>`);

  const periodTotals = summarizeEvasionPeriods(evasion);
  safeSet("evasionPeriodList", periodTotals.length
    ? periodTotals.map((item) => `<div class="reason-item"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.total)} saída(s)</span></div>`).join("")
    : `<div class="empty-state">Os comparativos semanais, mensais e anuais começam a partir dos próximos registros.</div>`);

  safeSet("reportsTable", table([
    ["Unidade", "Diretor", "Criado em", "Vagas", "Ocupação", "Drive"],
    ...reports.slice(0, 120).map((report) => [
      escapeHtml(report.unit || "-"),
      escapeHtml(report.director || "-"),
      escapeHtml(formatDateTime(report.createdAt)),
      `<strong>${escapeHtml(report.vacancies || 0)}</strong>`,
      escapeHtml(`${report.occupancyRate || 0}%`),
      report.docUrl ? `<a href="${escapeAttr(report.docUrl)}" target="_blank" rel="noopener">Abrir</a>` : `<span>Aguardando Drive</span>`,
    ]),
  ]);
}

function summarizeEvasionPeriods(evasion) {
  const buckets = {};
  evasion.forEach((item) => {
    const date = new Date(item.createdAt || Date.now());
    const week = item.weekKey || item.week || "Semana atual";
    const month = item.monthKey || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const year = item.yearKey || String(date.getFullYear());
    const amount = Number(item.amount || 0);
    buckets[`Semana ${week}`] = (buckets[`Semana ${week}`] || 0) + amount;
    buckets[`Mês ${month}`] = (buckets[`Mês ${month}`] || 0) + amount;
    buckets[`Ano ${year}`] = (buckets[`Ano ${year}`] || 0) + amount;
  });
  return Object.entries(buckets)
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 9);
}

function table(rows) {
  if (rows.length <= 1) return `<div class="empty-state">Sem dados sincronizados ainda.</div>`;
  return rows.map((row, index) => `<div class="data-row ${index === 0 ? "head" : ""}">${row.map((cell) => `<span>${index === 0 ? escapeHtml(cell) : cell}</span>`).join("")}</div>`).join("");
}

function api(action, params = {}) {
  if (!apiUrl || !apiUrl.includes("script.google.com")) {
    return Promise.reject(new Error("URL do Apps Script não configurada."));
  }
  return new Promise((resolve, reject) => {
    const callback = `apsAdmin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(apiUrl);
    url.searchParams.set("api", "1");
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callback);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value ?? ""));
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo esgotado ao falar com o banco."));
    }, 14000);
    window[callback] = (payload) => {
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Não consegui acessar o Apps Script."));
    };
    function cleanup() {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

function setLoginStatus(text) {
  $("#loginStatus").textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function formatDateTime(value) {
  if (!value) return "-";
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); } catch { return String(value); }
}

function initBrain() {
  const canvas = $("#adminBrain");
  const ctx = canvas.getContext("2d");
  const nodes = Array.from({ length: 130 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - .5) * .00025,
    vy: (Math.random() - .5) * .00025,
    r: 1.2 + Math.random() * 2.8,
  }));
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * scale);
    canvas.height = Math.floor(innerHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function draw(time) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const gradient = ctx.createRadialGradient(innerWidth * .62, innerHeight * .42, 20, innerWidth * .62, innerHeight * .42, innerWidth * .68);
    gradient.addColorStop(0, "rgba(25,241,255,.2)");
    gradient.addColorStop(.42, "rgba(255,212,71,.12)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    nodes.forEach((node) => {
      node.x = (node.x + node.vx + 1) % 1;
      node.y = (node.y + node.vy + 1) % 1;
    });
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const ax = nodes[i].x * innerWidth;
        const ay = nodes[i].y * innerHeight;
        const bx = nodes[j].x * innerWidth;
        const by = nodes[j].y * innerHeight;
        const distance = Math.hypot(ax - bx, ay - by);
        if (distance < 118) {
          ctx.strokeStyle = `rgba(25,241,255,${(1 - distance / 118) * .18})`;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }
    nodes.forEach((node, index) => {
      const pulse = Math.sin(time * .002 + index) * .6;
      ctx.fillStyle = index % 8 === 0 ? "rgba(255,212,71,.9)" : "rgba(25,241,255,.7)";
      ctx.beginPath();
      ctx.arc(node.x * innerWidth, node.y * innerHeight, node.r + pulse, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  resize();
  addEventListener("resize", resize);
  requestAnimationFrame(draw);
}
