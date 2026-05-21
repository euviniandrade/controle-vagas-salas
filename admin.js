const apiUrl = window.APP_CONFIG?.GOOGLE_SCRIPT_URL || "";
const tokenKey = "aps-admin-token";

const $ = (selector) => document.querySelector(selector);
let dashboardData = { units: [], rooms: [], users: [], reports: [], movements: [], evasion: [] };
let refreshTimer = null;

initAdmin();

function initAdmin() {
  initBrain();
  $("#loginForm").addEventListener("submit", login);
  $("#refreshButton").addEventListener("click", loadDashboard);
  $("#unitSearch").addEventListener("input", renderDashboard);
  $("#accessForm").addEventListener("submit", createAccessRequest);
  $("#publicAccessButton")?.addEventListener("click", createPublicAccessRequest);
  if (localStorage.getItem(tokenKey)) showDashboard();
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
    showDashboard();
  } catch (error) {
    setLoginStatus(error.message || "Não foi possível entrar.");
  }
}

function showDashboard() {
  $("#loginView").hidden = true;
  $("#dashboardView").hidden = false;
  loadDashboard();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadDashboard, 30000);
}

async function loadDashboard() {
  const button = $("#refreshButton");
  button.textContent = "Atualizando...";
  try {
    const result = await api("adminDashboard", { token: localStorage.getItem(tokenKey) || "" });
    if (!result.ok) throw new Error(result.error || "Falha ao ler dados.");
    dashboardData = result.data || dashboardData;
    renderDashboard();
  } catch (error) {
    if (String(error.message || "").includes("Sessão")) {
      localStorage.removeItem(tokenKey);
      $("#dashboardView").hidden = true;
      $("#loginView").hidden = false;
    }
    setLoginStatus(error.message || "Falha ao carregar painel.");
  } finally {
    button.textContent = "Atualizar dados";
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

  const query = $("#unitSearch").value.trim().toLowerCase();
  const filteredUnits = units.filter((unit) => `${unit.unit} ${unit.director}`.toLowerCase().includes(query));
  $("#unitTable").innerHTML = table([
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

  $("#roomsTable").innerHTML = table([
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

  $("#usersList").innerHTML = users.length
    ? users.map((user) => `<div class="user-pill"><strong>${escapeHtml(user.name || user.email || "-")}</strong><span>${escapeHtml(user.email || "")}</span><span>${escapeHtml(user.unit || "")} · <b class="status-ok">${escapeHtml(user.status || "Pendente")}</b></span></div>`).join("")
    : `<div class="empty-state">Nenhum usuário cadastrado ainda.</div>`;

  $("#reasonList").innerHTML = Object.keys(movementTotals.reasons).length
    ? Object.entries(movementTotals.reasons).sort((a, b) => b[1] - a[1]).map(([reason, total]) => `<div class="reason-item"><strong>${escapeHtml(reason)}</strong><span>${escapeHtml(total)} saída(s)</span></div>`).join("")
    : `<div class="empty-state">Sem saídas registradas até agora.</div>`;

  const periodTotals = summarizeEvasionPeriods(evasion);
  $("#evasionPeriodList").innerHTML = periodTotals.length
    ? periodTotals.map((item) => `<div class="reason-item"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.total)} saída(s)</span></div>`).join("")
    : `<div class="empty-state">Os comparativos semanais, mensais e anuais começam a partir dos próximos registros.</div>`;

  $("#reportsTable").innerHTML = table([
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
