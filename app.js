const storageKey = "aps-controle-vagas-v3";
const currentWeek = getIsoWeek(new Date());
const googleScriptUrl = window.APP_CONFIG?.GOOGLE_SCRIPT_URL || "";
const spreadsheetId = window.APP_CONFIG?.SPREADSHEET_ID || "";

const directorUnits = [
  ["Douglas", "CAR"], ["Washington", "CAP"], ["Anderson", "CAEGW"], ["Albert", "CATS"],
  ["Acleto", "CACLI I"], ["Uoston", "CACLI II"], ["Roberto", "CAEA"], ["Allan", "CAIS"],
  ["Josy", "EAP"], ["Ednaldo", "EATW"], ["Tatiane", "EAA"], ["Alessandro", "EAJL"],
  ["Rafael", "EACF"], ["Fábio", "EAVB"],
].map(([director, unit]) => ({ director, unit }));

const segmentPlan = [
  { key: "infantil", name: "Educação Infantil", grades: ["Maternal", "Pré I", "Pré II"], shifts: ["Manhã", "Tarde"], capacity: 22, required: true },
  { key: "contraturno", name: "Contraturno", grades: ["Contraturno Infantil", "Contraturno Fund. 1", "Contraturno Fund. 2"], shifts: ["Manhã", "Tarde", "Integral"], capacity: 25, gatedBy: "hasContraturno" },
  { key: "fund1", name: "Fundamental 1", grades: ["1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano"], shifts: ["Manhã", "Tarde"], capacity: 32 },
  { key: "fund2", name: "Fundamental 2", grades: ["6º Ano", "7º Ano", "8º Ano", "9º Ano"], shifts: ["Manhã", "Tarde"], capacity: 35 },
  { key: "medio", name: "Ensino Médio", grades: ["1º Ano EM", "2º Ano EM", "3º Ano EM"], shifts: ["Manhã", "Tarde"], capacity: 38, gatedBy: "hasHighSchool" },
];

const $ = (selector) => document.querySelector(selector);
const chatLog = $("#chatLog");
const answerForm = $("#answerForm");
const answerMount = $("#answerMount");
const saveStatus = $("#saveStatus");
const sendButton = $("#sendButton");
const roomsList = $("#roomsList");
const controlPanel = $(".control-panel");
const missionTitle = $("#missionTitle");
const missionHint = $("#missionHint");
const progressText = $("#progressText");
const progressBar = $("#progressBar");
const resultPreview = $("#resultPreview");
const roomDialog = $("#roomDialog");
const roomForm = $("#roomForm");
const brainCanvas = $("#brainScene");
const stageDots = Array.from(document.querySelectorAll(".stage-dot"));

const state = loadState();
let editingRoomId = null;
let activeFilter = "all";

init();

function init() {
  ensureDefaults();
  setupDialogOptions();
  bindEvents();
  bindImmersiveShell();
  initBrainScene();
  renderAll();
  if (!chatLog.dataset.started) {
    appendAssistant("Olá! Vou montar o mapa de vagas com você, um passo por vez. Para começar, qual é o seu nome?");
    chatLog.dataset.started = "1";
  }
  renderAnswer();
  lucide.createIcons();
}

function ensureDefaults() {
  state.director ||= "";
  state.unit ||= "";
  state.currentQuestion ||= { type: "director" };
  state.rooms ||= [];
  state.history ||= [];
  state.answers ||= {};
  state.weeklyDate ||= new Date().toISOString().slice(0, 10);
  state.weekId ||= currentWeek;
  const validQuestions = new Set(["director", "unit", "yesno", "roomCount", "roomStudents", "roomCapacity", "done"]);
  if (!validQuestions.has(state.currentQuestion.type) || state.currentQuestion.segmentKey) {
    state.currentQuestion = { type: "director" };
    delete state.pendingSegment;
  }
}

function bindEvents() {
  answerForm.addEventListener("submit", submitAnswer);
  $("#addRoomButton").addEventListener("click", () => openRoomDialog());
  $("#clearRoomsButton").addEventListener("click", clearRooms);
  $("#newWeekButton").addEventListener("click", createWeeklySnapshot);
  $("#syncCloudButton").addEventListener("click", () => syncToCloud("manual"));
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#exportJsonButton").addEventListener("click", exportJson);
  $("#importJsonInput").addEventListener("change", importJson);
  $("#saveRoomButton").addEventListener("click", saveRoomFromDialog);
  $("#deleteRoomButton").addEventListener("click", deleteEditingRoom);
  document.querySelectorAll(".segment-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.segmentFilter;
      document.querySelectorAll(".segment-tab").forEach((item) => item.classList.toggle("active", item === button));
      renderRooms();
    });
  });
}

function bindImmersiveShell() {
  const launch = $("#launchIntro");
  const start = $("#startExperience");
  if (launch && start) {
    start.addEventListener("click", () => {
      launch.classList.add("dismissed");
      setTimeout(() => launch.remove(), 720);
    });
  }
  window.addEventListener("pointermove", (event) => {
    const x = Math.round((event.clientX / Math.max(1, window.innerWidth)) * 100);
    const y = Math.round((event.clientY / Math.max(1, window.innerHeight)) * 100);
    document.documentElement.style.setProperty("--mx", `${x}%`);
    document.documentElement.style.setProperty("--my", `${y}%`);
  }, { passive: true });
  initLaunchCanvas();
}

function initLaunchCanvas() {
  const canvas = $("#launchCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const nodes = Array.from({ length: 120 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00028,
    vy: (Math.random() - 0.5) * 0.00028,
    r: 1.3 + Math.random() * 2.8,
  }));
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * scale);
    canvas.height = Math.floor(window.innerHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function draw(time) {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    nodes.forEach((node) => {
      node.x = (node.x + node.vx + 1) % 1;
      node.y = (node.y + node.vy + 1) % 1;
    });
    const glow = ctx.createRadialGradient(window.innerWidth * 0.5, window.innerHeight * 0.48, 30, window.innerWidth * 0.5, window.innerHeight * 0.48, window.innerWidth * 0.72);
    glow.addColorStop(0, "rgba(25,241,255,.24)");
    glow.addColorStop(0.46, "rgba(255,212,71,.13)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const ax = nodes[i].x * window.innerWidth;
        const ay = nodes[i].y * window.innerHeight;
        const bx = nodes[j].x * window.innerWidth;
        const by = nodes[j].y * window.innerHeight;
        const distance = Math.hypot(ax - bx, ay - by);
        if (distance < 120) {
          ctx.strokeStyle = `rgba(25,241,255,${(1 - distance / 120) * 0.18})`;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }
    nodes.forEach((node, index) => {
      ctx.fillStyle = index % 9 === 0 ? "rgba(255,212,71,.95)" : "rgba(25,241,255,.78)";
      ctx.beginPath();
      ctx.arc(node.x * window.innerWidth, node.y * window.innerHeight, node.r + Math.sin(time * 0.002 + index), 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}

function renderAnswer() {
  const q = state.currentQuestion;
  sendButton.disabled = false;
  if (q.type === "done") {
    answerMount.innerHTML = `<button class="chip selected" id="restartGuide" type="button">Revisar desde o início</button>`;
    sendButton.disabled = true;
    $("#restartGuide").addEventListener("click", restartGuide);
    return;
  }
  if (q.type === "director") {
    answerMount.innerHTML = `<select required>${directorUnits.map((item) => `<option value="${escapeAttr(item.director)}">${escapeHtml(item.director)}</option>`).join("")}</select>`;
    return;
  }
  if (q.type === "unit") {
    answerMount.innerHTML = `<select required>${directorUnits.map((item) => `<option value="${escapeAttr(item.unit)}" ${state.unit === item.unit ? "selected" : ""}>${escapeHtml(item.unit)}</option>`).join("")}</select>`;
    return;
  }
  if (q.type === "yesno") {
    answerMount.innerHTML = choiceButtons(["Sim", "Não"]);
    bindSingleChoice();
    return;
  }
  if (q.type === "roomCount") {
    answerMount.innerHTML = `<input type="number" min="0" max="8" step="1" required placeholder="Quantidade de salas" />`;
    return;
  }
  if (q.type === "roomStudents" || q.type === "roomCapacity") {
    answerMount.innerHTML = `<input type="number" min="0" max="80" step="1" required placeholder="${q.type === "roomStudents" ? "Alunos atuais" : "Capacidade máxima"}" />`;
  }
}

function choiceButtons(options) {
  return `<div class="chips">${options.map((option) => `<button class="chip" type="button" data-value="${escapeAttr(option)}">${escapeHtml(option)}</button>`).join("")}</div><input type="hidden" required />`;
}

function multiButtons(options) {
  return `<div class="chips multi-answer">${options.map((option) => `<button class="chip" type="button" data-value="${escapeAttr(option)}">${escapeHtml(option)}</button>`).join("")}</div><input type="hidden" />`;
}

function bindSingleChoice() {
  const hidden = answerMount.querySelector("input");
  answerMount.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => {
      answerMount.querySelectorAll(".chip").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      hidden.value = button.dataset.value;
    });
  });
}

function bindMultiChoice() {
  const hidden = answerMount.querySelector("input");
  answerMount.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("selected");
      hidden.value = selectedChipValues().join("|");
    });
  });
}

function selectedChipValues() {
  return Array.from(answerMount.querySelectorAll(".chip.selected")).map((button) => button.dataset.value);
}

function submitAnswer(event) {
  event.preventDefault();
  const q = state.currentQuestion;
  const value = collectValue(q);
  if (value === null || value === "") return;
  appendUser(formatAnswer(value));
  handleAnswer(q, value);
  renderAll();
  renderAnswer();
  persist();
}

function collectValue(q) {
  if (["director", "unit", "roomCount", "roomStudents", "roomCapacity"].includes(q.type)) {
    return answerMount.querySelector("select,input")?.value ?? "";
  }
  if (q.type === "yesno") return answerMount.querySelector("input")?.value || "";
  return "";
}

function restartGuide() {
  state.currentQuestion = { type: "director" };
  state.rooms = [];
  state.answers = {};
  delete state.pendingSegment;
  chatLog.innerHTML = "";
  chatLog.dataset.started = "";
  appendAssistant("Vamos recomeçar com uma coleta limpa, uma pergunta por vez. Qual é o seu nome?");
  renderAll();
  renderAnswer();
  persist();
}

function formatAnswer(value) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function setupDialogOptions() {
  $("#roomSegment").innerHTML = segmentPlan.map((segment) => `<option>${escapeHtml(segment.name)}</option>`).join("");
  $("#roomShift").innerHTML = ["Manhã", "Tarde", "Integral", "Noite"].map((shift) => `<option>${shift}</option>`).join("");
}

function renderAll() {
  renderUnit();
  renderMetrics();
  renderRooms();
  renderMissionDeck();
  $("#weekLabel").textContent = state.weekId || currentWeek;
  controlPanel.classList.toggle("is-empty", !state.rooms.length);
  lucide.createIcons();
}

function renderUnit() {
  $("#unitBadge").textContent = state.director ? `Diretor: ${state.director}` : "Unidade não iniciada";
  $("#unitTitle").textContent = state.unit || "Comece pela unidade";
  $("#unitSubtitle").textContent = state.answers.hasHighSchool ? "Ensino Médio: Sim" : "Roteiro em andamento";
}

function renderMissionDeck() {
  const totals = getTotals();
  const progress = calculateProgress();
  const label = missionLabel();
  if (missionTitle) missionTitle.textContent = label.title;
  if (missionHint) missionHint.textContent = label.hint;
  if (progressText) progressText.textContent = `${progress}%`;
  if (progressBar) progressBar.style.width = `${progress}%`;
  if (resultPreview) resultPreview.textContent = totals.rooms ? `${totals.vacancies} vagas mapeadas` : "Vagas em tempo real";
  stageDots.forEach((dot, index) => dot.classList.toggle("active", index <= Math.min(4, Math.floor(progress / 25))));
}

function getTotals() {
  return state.rooms.reduce((acc, room) => {
    acc.rooms += 1;
    acc.capacity += Number(room.capacity || 0);
    acc.students += Number(room.students || 0);
    acc.vacancies += Math.max(0, Number(room.capacity || 0) - Number(room.students || 0));
    return acc;
  }, { rooms: 0, capacity: 0, students: 0, vacancies: 0 });
}

function renderMetrics() {
  const totals = getTotals();
  $("#roomsTotal").textContent = totals.rooms;
  $("#capacityTotal").textContent = totals.capacity;
  $("#studentsTotal").textContent = totals.students;
  $("#vacancyTotal").textContent = totals.vacancies;
  const percent = totals.capacity ? Math.round((totals.vacancies / totals.capacity) * 100) : 0;
  document.querySelector(".health-ring").style.setProperty("--filled", `${percent}%`);
}

function renderRooms() {
  const visible = state.rooms.filter((room) => activeFilter === "all" || room.segment === activeFilter);
  if (!visible.length) {
    roomsList.innerHTML = `<div class="empty-state">As salas aparecerão aqui conforme você responder.</div>`;
    return;
  }
  roomsList.innerHTML = visible.sort(sortRooms).map((room) => {
    const vacancies = Math.max(0, Number(room.capacity || 0) - Number(room.students || 0));
    return `
      <article class="room-item ${vacancies > 0 ? "open" : "full"}">
        <button type="button" data-room-id="${escapeAttr(room.id)}">
          <span class="room-name">${escapeHtml(room.grade)} - ${escapeHtml(room.shift)} ${room.letter ? `- ${escapeHtml(room.letter)}` : ""}</span>
          <span class="room-meta">${escapeHtml(room.segment)} · ${room.students || 0}/${room.capacity || 0} alunos · atualizado ${formatDateTime(room.updatedAt)}</span>
        </button>
        <div class="room-vacancy"><strong>${vacancies}</strong><small>vagas</small></div>
      </article>`;
  }).join("");
  roomsList.querySelectorAll("[data-room-id]").forEach((button) => button.addEventListener("click", () => openRoomDialog(button.dataset.roomId)));
}

function openRoomDialog(roomId = null) {
  editingRoomId = roomId;
  const room = state.rooms.find((item) => item.id === roomId) || {
    segment: activeFilter === "all" ? "Educação Infantil" : activeFilter,
    grade: "",
    shift: "Manhã",
    letter: "A",
    capacity: 30,
    students: 0,
  };
  $("#roomDialogTitle").textContent = roomId ? "Editar sala" : "Adicionar sala";
  $("#deleteRoomButton").hidden = !roomId;
  $("#roomSegment").value = room.segment;
  $("#roomGrade").value = room.grade;
  $("#roomShift").value = room.shift;
  $("#roomLetter").value = room.letter || "";
  $("#roomCapacity").value = room.capacity || 0;
  $("#roomStudents").value = room.students || 0;
  roomDialog.showModal();
  lucide.createIcons();
}

function saveRoomFromDialog() {
  if (!roomForm.reportValidity()) return;
  const payload = {
    segment: $("#roomSegment").value,
    grade: $("#roomGrade").value.trim(),
    shift: $("#roomShift").value,
    letter: $("#roomLetter").value.trim().toUpperCase(),
    capacity: Number($("#roomCapacity").value || 0),
    students: Number($("#roomStudents").value || 0),
    updatedAt: new Date().toISOString(),
  };
  if (editingRoomId) {
    const index = state.rooms.findIndex((room) => room.id === editingRoomId);
    state.rooms[index] = { ...state.rooms[index], ...payload };
  } else {
    state.rooms.push({ id: crypto.randomUUID(), ...payload });
  }
  roomDialog.close();
  renderAll();
  persist();
}

function deleteEditingRoom() {
  if (!editingRoomId) return;
  state.rooms = state.rooms.filter((room) => room.id !== editingRoomId);
  roomDialog.close();
  renderAll();
  persist();
}

function clearRooms() {
  if (!state.rooms.length) return;
  if (!confirm("Deseja remover todas as salas cadastradas nesta unidade?")) return;
  state.rooms = [];
  renderAll();
  persist();
}

function createWeeklySnapshot() {
  const totals = getTotals();
  state.history.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), weekId: state.weekId || currentWeek, unit: state.unit, director: state.director, totals, rooms: structuredClone(state.rooms) });
  state.weeklyDate = new Date().toISOString().slice(0, 10);
  state.weekId = currentWeek;
  state.rooms = state.rooms.map((room) => ({ ...room, updatedAt: new Date().toISOString() }));
  appendAssistant(`Registro semanal fechado: ${totals.vacancies} vagas disponíveis em ${totals.rooms} salas.`);
  renderAll();
  persist();
  syncToCloud("weekly-snapshot");
}

function exportCsv() {
  const rows = [
    ["Unidade", "Diretor", "Semana", "Segmento", "Série", "Turno", "Sala", "Capacidade", "Alunos", "Vagas", "Atualizado em"],
    ...state.rooms.sort(sortRooms).map((room) => [state.unit || "", state.director || "", state.weekId || currentWeek, room.segment, room.grade, room.shift, room.letter || "", room.capacity || 0, room.students || 0, Math.max(0, Number(room.capacity || 0) - Number(room.students || 0)), formatDateTime(room.updatedAt)]),
  ];
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\n");
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `vagas-${slug(state.unit || "unidade")}-${state.weekId || currentWeek}.csv`);
}

function exportJson() {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `backup-vagas-${slug(state.unit || "unidade")}.json`);
}

function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      Object.assign(state, JSON.parse(String(reader.result || "{}")));
      ensureDefaults();
      chatLog.innerHTML = "";
      chatLog.dataset.started = "";
      renderAll();
      renderAnswer();
      persist();
    } catch {
      alert("Não consegui ler esse JSON. Confira se é um backup gerado por esta ferramenta.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function appendAssistant(html) { appendMessage("assistant", html); }
function appendUser(text) { appendMessage("user", escapeHtml(text)); }
function appendMessage(role, html) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.innerHTML = `<div class="bubble">${html}</div>`;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  saveStatus.textContent = "Salvo localmente";
  clearTimeout(persist.timer);
  persist.timer = setTimeout(() => { saveStatus.textContent = googleReady() ? "Pronto para sincronizar" : "Salvo localmente"; }, 1000);
  scheduleCloudSync("autosave");
}

function googleReady() {
  return Boolean(googleScriptUrl && googleScriptUrl.includes("script.google.com"));
}

function scheduleCloudSync(reason) {
  if (!googleReady()) return;
  clearTimeout(scheduleCloudSync.timer);
  scheduleCloudSync.timer = setTimeout(() => syncToCloud(reason), 1400);
}

async function syncToCloud(reason = "manual") {
  if (!googleReady()) {
    saveStatus.textContent = "Banco online não configurado";
    return;
  }
  saveStatus.textContent = "Sincronizando...";
  const payload = buildCloudPayload(reason);
  try {
    await fetch(googleScriptUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "syncVagas", spreadsheetId, payload }) });
    state.lastCloudSync = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify(state));
    saveStatus.textContent = "Sincronizado online";
  } catch {
    saveStatus.textContent = "Falha ao sincronizar";
  }
}

function buildCloudPayload(reason) {
  const totals = getTotals();
  return { reason, syncedAt: new Date().toISOString(), unit: state.unit || "", director: state.director || "", weekId: state.weekId || currentWeek, weeklyDate: state.weeklyDate || "", hasHighSchool: state.answers.hasHighSchool ? "Sim" : "Não", totals, rooms: state.rooms || [], history: state.history || [] };
}

function loadState() {
  try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; }
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function getIsoWeek(date) {
  const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
  return `${temp.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}

function sortRooms(a, b) {
  const order = Object.fromEntries(segmentPlan.map((segment, index) => [segment.name, index]));
  return (order[a.segment] ?? 99) - (order[b.segment] ?? 99) || a.grade.localeCompare(b.grade, "pt-BR", { numeric: true }) || a.shift.localeCompare(b.shift, "pt-BR") || String(a.letter || "").localeCompare(String(b.letter || ""), "pt-BR");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function slug(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase(); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replaceAll("\n", " "); }

function handleAnswer(q, value) {
  if (q.type === "director") {
    state.director = value;
    const match = directorUnits.find((item) => item.director === value);
    if (match) state.unit = match.unit;
    appendAssistant(`${value}, combinado. Eu vou conduzir tudo turma por turma e deixar o saldo de vagas pronto no final. Confirme a unidade.`);
    state.currentQuestion = { type: "unit" };
    return;
  }
  if (q.type === "unit") {
    state.unit = value;
    state.weeklyDate = new Date().toISOString().slice(0, 10);
    state.weekId = currentWeek;
    appendAssistant(`${firstName()}, antes das turmas: a unidade oferece contraturno?`);
    state.currentQuestion = { type: "yesno", key: "hasContraturno" };
    return;
  }
  if (q.type === "yesno" && q.key === "hasContraturno") {
    state.answers.hasContraturno = value === "Sim";
    appendAssistant("Agora só mais um filtro: a unidade possui Ensino Médio?");
    state.currentQuestion = { type: "yesno", key: "hasHighSchool" };
    return;
  }
  if (q.type === "yesno" && q.key === "hasHighSchool") {
    state.answers.hasHighSchool = value === "Sim";
    state.weeklyDate = new Date().toISOString().slice(0, 10);
    state.weekId = currentWeek;
    appendAssistant(`${firstName()}, vamos direto ao ponto. Começaremos pela Educação Infantil, sala por sala.`);
    startNextSegment(0);
    return;
  }
  if (q.type === "roomCount") {
    const count = Math.max(0, Number(value || 0));
    const pending = state.pendingSegment;
    const pair = currentPendingPair();
    pair.count = count;
    pair.rooms = Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      segment: segmentPlan[pending.segmentIndex].name,
      grade: pair.grade,
      shift: pair.shift,
      letter: String.fromCharCode(65 + index),
      capacity: segmentPlan[pending.segmentIndex].capacity,
      students: 0,
      updatedAt: new Date().toISOString(),
    }));
    pending.roomIndex = 0;
    if (count <= 0) {
      appendAssistant(`Perfeito, sem ${pair.grade} no turno da ${shiftText(pair.shift)}. Vou avançar.`);
      advancePair();
    } else {
      appendAssistant(`${count} turma(s) registrada(s). Vou nomear como ${pair.grade} A${count > 1 ? ` até ${pair.grade} ${String.fromCharCode(64 + count)}` : ""}.`);
      askRoomStudents();
    }
    return;
  }
  if (q.type === "roomStudents") {
    currentPendingRoom().students = Number(value || 0);
    askRoomCapacity();
    return;
  }
  if (q.type === "roomCapacity") {
    currentPendingRoom().capacity = Number(value || 0);
    currentPendingRoom().updatedAt = new Date().toISOString();
    state.pendingSegment.roomIndex += 1;
    if (state.pendingSegment.roomIndex < currentPendingPair().rooms.length) askRoomStudents();
    else advancePair();
  }
}

function startNextSegment(index) {
  const nextIndex = segmentPlan.findIndex((segment, segmentIndex) => {
    if (segmentIndex < index) return false;
    if (segment.gatedBy === "hasContraturno" && !state.answers.hasContraturno) return false;
    if (segment.gatedBy === "hasHighSchool" && !state.answers.hasHighSchool) return false;
    return true;
  });
  if (nextIndex === -1) {
    finishGuide();
    return;
  }
  const segment = segmentPlan[nextIndex];
  state.pendingSegment = {
    segmentIndex: nextIndex,
    pairs: segment.grades.flatMap((grade) => segment.shifts.map((shift) => ({ grade, shift, rooms: [] }))),
    pairIndex: 0,
    roomIndex: 0,
  };
  appendAssistant(segmentIntro(segment));
  askRoomCount();
}

function askRoomCount() {
  const pair = currentPendingPair();
  appendAssistant(`${firstName()}, quantas turmas de ${pair.grade} funcionam no turno da ${shiftText(pair.shift)}? Se não tiver, responda 0.`);
  state.currentQuestion = { type: "roomCount" };
}

function askRoomStudents() {
  const room = currentPendingRoom();
  appendAssistant(`Agora ${roomLabel(room)}: quantos alunos essa turma tem hoje?`);
  state.currentQuestion = { type: "roomStudents" };
}

function askRoomCapacity() {
  const room = currentPendingRoom();
  appendAssistant(`E qual é a capacidade máxima da sala ${roomLabel(room)}?`);
  state.currentQuestion = { type: "roomCapacity" };
}

function advancePair() {
  const pending = state.pendingSegment;
  const pair = currentPendingPair();
  state.rooms.push(...(pair.rooms || []));
  pending.pairIndex += 1;
  pending.roomIndex = 0;
  if (pending.pairIndex < pending.pairs.length) {
    askRoomCount();
  } else {
    const segment = segmentPlan[pending.segmentIndex];
    appendAssistant(`${segment.name} concluído. Já estou somando as vagas e avançando para o próximo bloco.`);
    const segmentIndex = pending.segmentIndex;
    delete state.pendingSegment;
    startNextSegment(segmentIndex + 1);
  }
}

function currentPendingPair() {
  return state.pendingSegment.pairs[state.pendingSegment.pairIndex];
}

function currentPendingRoom() {
  return currentPendingPair().rooms[state.pendingSegment.roomIndex];
}

function finishGuide() {
  const totals = getTotals();
  const ending = state.answers.hasHighSchool ? "até o 3º ano do Ensino Médio" : "até o 9º ano";
  appendAssistant(`${firstName()}, mapa concluído ${ending}. Temos ${totals.rooms} sala(s), ${totals.students} aluno(s) e ${totals.vacancies} vaga(s) disponíveis agora.`);
  state.currentQuestion = { type: "done" };
  syncToCloud("completed-guide");
}

function calculateProgress() {
  if (state.currentQuestion.type === "done") return 100;
  if (state.pendingSegment) {
    const availableSegments = segmentPlan.filter((segment) => {
      if (segment.gatedBy === "hasContraturno" && !state.answers.hasContraturno) return false;
      if (segment.gatedBy === "hasHighSchool" && !state.answers.hasHighSchool) return false;
      return true;
    });
    const totalPairs = availableSegments.reduce((sum, segment) => sum + segment.grades.length * segment.shifts.length, 0);
    const completedBefore = availableSegments
      .filter((segment) => segmentPlan.indexOf(segment) < state.pendingSegment.segmentIndex)
      .reduce((sum, segment) => sum + segment.grades.length * segment.shifts.length, 0);
    const completed = completedBefore + state.pendingSegment.pairIndex + Math.min(0.9, (state.pendingSegment.roomIndex || 0) * 0.25);
    return Math.min(99, Math.max(28, Math.round(28 + (completed / Math.max(1, totalPairs)) * 68)));
  }
  const base = { director: 0, unit: 9, yesno: state.currentQuestion.key === "hasHighSchool" ? 22 : 14, roomCount: 34, roomStudents: 48, roomCapacity: 58 };
  return Math.min(99, base[state.currentQuestion.type] || 10);
}

function missionLabel() {
  const q = state.currentQuestion;
  if (q.type === "director") return { title: "Identificar diretor", hint: "Comece pelo nome de quem está respondendo." };
  if (q.type === "unit") return { title: "Confirmar unidade", hint: "A unidade será vinculada ao diretor." };
  if (q.type === "yesno" && q.key === "hasContraturno") return { title: "Contraturno", hint: "Isso define se o bloco extra entra no roteiro." };
  if (q.type === "yesno" && q.key === "hasHighSchool") return { title: "Ensino Médio", hint: "Se não tiver, a coleta termina no 9º ano." };
  if (q.type === "roomCount") return { title: "Quantas turmas?", hint: "Informe a quantidade desta série neste turno." };
  if (q.type === "roomStudents") return { title: "Alunos da turma", hint: "Agora entra o número real de alunos." };
  if (q.type === "roomCapacity") return { title: "Capacidade máxima", hint: "Com isso calculamos as vagas disponíveis." };
  return { title: "Mapa concluído", hint: "Os dados podem ser sincronizados." };
}

function segmentIntro(segment) {
  if (segment.key === "infantil") return "Educação Infantil é obrigatória no mapa. Vou passar por Maternal, Pré I e Pré II, manhã e tarde, uma turma por vez.";
  if (segment.key === "contraturno") return "Agora entra o contraturno. Vou mapear por bloco e turno; onde não houver turma, responda 0.";
  if (segment.key === "fund1") return "Vamos para o Fundamental 1. Vou seguir do 1º ao 5º ano, manhã e tarde.";
  if (segment.key === "fund2") return "Agora Fundamental 2. Vou seguir do 6º ao 9º ano, manhã e tarde.";
  return "Como a unidade possui Ensino Médio, vamos até o 3º ano EM, manhã e tarde.";
}

function firstName() {
  return state.director ? state.director.split(" ")[0] : "Diretor";
}

function shiftText(shift) {
  const lower = String(shift || "").toLowerCase();
  if (lower === "integral") return "integral";
  return lower;
}

function roomLabel(room) {
  return `${room.grade} ${room.letter || ""} - ${room.shift}`.trim();
}

async function initBrainScene() {
  if (!brainCanvas) return;
  try {
    const THREE = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
    initClassroom3d(THREE);
  } catch {
    initClassroomFallback();
  }
}

function initClassroom3d(THREE) {
  const renderer = new THREE.WebGLRenderer({ canvas: brainCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(7.5, 7.2, 9.5);
  camera.lookAt(0, 0, 0);

  const room = new THREE.Group();
  room.rotation.y = -0.52;
  scene.add(room);

  const ambient = new THREE.AmbientLight(0xffffff, 1.7);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  scene.add(ambient, key);

  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: 0x10231f, roughness: 0.75, metalness: 0.1 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x15313a, roughness: 0.55, metalness: 0.18, transparent: true, opacity: 0.82 }),
    desk: new THREE.MeshStandardMaterial({ color: 0xf4c95d, roughness: 0.46, metalness: 0.08 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x18d2cf, roughness: 0.36, metalness: 0.22 }),
    filled: new THREE.MeshStandardMaterial({ color: 0xff6b8f, roughness: 0.4, metalness: 0.18 }),
    board: new THREE.MeshStandardMaterial({ color: 0x193f39, roughness: 0.5, metalness: 0.1 }),
    glowA: new THREE.MeshStandardMaterial({ color: 0x19f1ff, emissive: 0x0b7f8a, emissiveIntensity: 0.7 }),
    glowB: new THREE.MeshStandardMaterial({ color: 0xffd447, emissive: 0x806000, emissiveIntensity: 0.55 }),
  };

  const floor = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.12, 6.6), materials.floor);
  floor.position.y = -0.08;
  room.add(floor);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.8, 0.1), materials.wall);
  backWall.position.set(0, 1.35, -3.35);
  room.add(backWall);

  const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.25, 0.12), materials.board);
  board.position.set(0, 1.55, -3.25);
  room.add(board);

  const teacherDesk = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.25, 0.55), materials.desk);
  teacherDesk.position.set(0, 0.42, -2.35);
  room.add(teacherDesk);

  const deskGeo = new THREE.BoxGeometry(0.56, 0.18, 0.42);
  const seatGeo = new THREE.BoxGeometry(0.42, 0.22, 0.28);
  const deskGroup = new THREE.Group();
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = (col - 2) * 1.15;
      const z = -0.95 + row * 1.02;
      const desk = new THREE.Mesh(deskGeo, (row + col) % 4 === 0 ? materials.filled : materials.desk);
      desk.position.set(x, 0.34, z);
      const seat = new THREE.Mesh(seatGeo, materials.seat);
      seat.position.set(x, 0.24, z + 0.38);
      deskGroup.add(desk, seat);
    }
  }
  room.add(deskGroup);

  const planGroup = new THREE.Group();
  const nodePositions = [
    [-3.2, 2.4, -1.2], [-2.2, 2.85, -.2], [-1.2, 2.35, .8],
    [1.2, 2.75, -1.0], [2.4, 2.4, .2], [3.25, 2.9, 1.15],
  ];
  const nodes = nodePositions.map((position, index) => {
    const node = new THREE.Mesh(new THREE.SphereGeometry(index % 2 ? 0.09 : 0.12, 18, 18), index % 2 ? materials.glowB : materials.glowA);
    node.position.set(...position);
    planGroup.add(node);
    return node;
  });
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8befff, transparent: true, opacity: 0.45 });
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([nodes[index].position, nodes[index + 1].position]);
    planGroup.add(new THREE.Line(geometry, lineMaterial));
  }
  room.add(planGroup);

  const grid = new THREE.GridHelper(8.5, 10, 0x19f1ff, 0x38505a);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  room.add(grid);

  function resize() {
    const rect = brainCanvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate(time) {
    const progress = calculateProgress() / 100;
    room.rotation.y = -0.54 + Math.sin(time * 0.00045) * 0.08;
    room.rotation.x = -0.04 + progress * 0.04;
    deskGroup.children.forEach((item, index) => {
      item.position.y += Math.sin(time * 0.002 + index) * 0.0009;
    });
    planGroup.rotation.y = Math.sin(time * 0.0007) * 0.18;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(animate);
}

function initClassroomFallback() {
  const ctx = brainCanvas.getContext("2d");
  function resize() {
    const rect = brainCanvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    brainCanvas.width = Math.max(1, Math.floor(rect.width * scale));
    brainCanvas.height = Math.max(1, Math.floor(rect.height * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function draw(time) {
    const rect = brainCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { requestAnimationFrame(draw); return; }
    ctx.clearRect(0, 0, rect.width, rect.height);
    const cx = rect.width * 0.62;
    const cy = rect.height * 0.55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.2 + Math.sin(time * 0.0007) * 0.04);
    const floor = ctx.createLinearGradient(-260, -180, 260, 220);
    floor.addColorStop(0, "rgba(25,241,255,.12)");
    floor.addColorStop(1, "rgba(255,212,71,.14)");
    ctx.fillStyle = floor;
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-300, -150);
    ctx.lineTo(220, -220);
    ctx.lineTo(330, 160);
    ctx.lineTo(-220, 230);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const x = -180 + col * 82;
        const y = -70 + row * 60;
        ctx.fillStyle = (row + col) % 4 === 0 ? "rgba(255,107,143,.85)" : "rgba(255,212,71,.9)";
        ctx.fillRect(x, y, 48, 24);
        ctx.fillStyle = "rgba(25,241,255,.8)";
        ctx.fillRect(x + 8, y + 31, 32, 18);
      }
    }
    ctx.restore();
    ctx.fillStyle = "rgba(25,241,255,.8)";
    for (let i = 0; i < 20; i += 1) {
      const angle = i * 0.7 + time * 0.0005;
      const x = rect.width * 0.72 + Math.cos(angle) * (80 + (i % 5) * 22);
      const y = rect.height * 0.34 + Math.sin(angle * 1.2) * (42 + (i % 4) * 18);
      ctx.beginPath();
      ctx.arc(x, y, i % 5 === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}
