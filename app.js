const storageKey = "aps-controle-vagas-v2";
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
  { key: "infantil", name: "Educação Infantil", grades: ["Maternal", "Pré I", "Pré II"], shifts: ["Manhã", "Tarde"], capacity: 22 },
  { key: "contraturno", name: "Contraturno", grades: ["Contraturno Infantil", "Contraturno Fund. 1", "Contraturno Fund. 2"], shifts: ["Manhã", "Tarde", "Integral"], capacity: 25, gatedBy: "hasContraturno" },
  { key: "fund1", name: "Fundamental 1", grades: ["1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano"], shifts: ["Manhã", "Tarde"], capacity: 32 },
  { key: "fund2", name: "Fundamental 2", grades: ["6º Ano", "7º Ano", "8º Ano", "9º Ano"], shifts: ["Manhã", "Tarde"], capacity: 35 },
  { key: "medio", name: "Ensino Médio", grades: ["1º Ano EM", "2º Ano EM", "3º Ano EM"], shifts: ["Manhã", "Tarde", "Noite"], capacity: 38, gatedBy: "hasHighSchool" },
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
  if (q.type === "date") {
    answerMount.innerHTML = `<input type="date" required value="${escapeAttr(state.weeklyDate)}" />`;
    return;
  }
  if (q.type === "yesno") {
    answerMount.innerHTML = choiceButtons(["Sim", "Não"]);
    bindSingleChoice();
    return;
  }
  if (q.type === "gradeSelect") {
    answerMount.innerHTML = multiButtons(q.options);
    bindMultiChoice();
    return;
  }
  if (q.type === "shiftSelect") {
    answerMount.innerHTML = multiButtons(q.options);
    bindMultiChoice();
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
  if (["director", "unit", "date", "roomCount", "roomStudents", "roomCapacity"].includes(q.type)) {
    return answerMount.querySelector("select,input")?.value ?? "";
  }
  if (q.type === "yesno") return answerMount.querySelector("input")?.value || "";
  if (q.type === "gradeSelect" || q.type === "shiftSelect") return selectedChipValues();
  return "";
}

function handleAnswer(q, value) {
  if (q.type === "director") {
    state.director = value;
    const match = directorUnits.find((item) => item.director === value);
    if (match) state.unit = match.unit;
    appendAssistant(`${value}, perfeito. Agora confirme a unidade para eu vincular este mapa corretamente.`);
    state.currentQuestion = { type: "unit" };
    return;
  }
  if (q.type === "unit") {
    state.unit = value;
    appendAssistant("A unidade tem contraturno? Responda apenas Sim ou Não.");
    state.currentQuestion = { type: "yesno", key: "hasContraturno" };
    return;
  }
  if (q.type === "yesno" && q.key === "hasContraturno") {
    state.answers.hasContraturno = value === "Sim";
    appendAssistant("A unidade possui Ensino Médio?");
    state.currentQuestion = { type: "yesno", key: "hasHighSchool" };
    return;
  }
  if (q.type === "yesno" && q.key === "hasHighSchool") {
    state.answers.hasHighSchool = value === "Sim";
    appendAssistant("Qual é a semana de referência deste levantamento?");
    state.currentQuestion = { type: "date" };
    return;
  }
  if (q.type === "date") {
    state.weeklyDate = value;
    state.weekId = getIsoWeek(new Date(`${value}T12:00:00`));
    startNextSegment(0);
    return;
  }
  if (q.type === "yesno" && q.segmentKey) {
    if (value === "Não") {
      startNextSegment(q.segmentIndex + 1);
    } else {
      const segment = segmentPlan[q.segmentIndex];
      appendAssistant(`Quais séries de ${segment.name} existem na unidade? Marque somente as que existem.`);
      state.currentQuestion = { type: "gradeSelect", segmentIndex: q.segmentIndex, options: segment.grades };
    }
    return;
  }
  if (q.type === "gradeSelect") {
    if (!value.length) return;
    const segment = segmentPlan[q.segmentIndex];
    state.pendingSegment = { segmentIndex: q.segmentIndex, grades: value, shifts: [], pairs: [], pairIndex: 0, roomIndex: 0 };
    appendAssistant(`Em quais turnos essas turmas de ${segment.name} funcionam?`);
    state.currentQuestion = { type: "shiftSelect", segmentIndex: q.segmentIndex, options: segment.shifts };
    return;
  }
  if (q.type === "shiftSelect") {
    if (!value.length) return;
    const pending = state.pendingSegment;
    pending.shifts = value;
    pending.pairs = pending.grades.flatMap((grade) => pending.shifts.map((shift) => ({ grade, shift })));
    askRoomCount();
    return;
  }
  if (q.type === "roomCount") {
    const count = Number(value || 0);
    const pending = state.pendingSegment;
    const pair = pending.pairs[pending.pairIndex];
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
      advancePair();
    } else {
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
  appendAssistant(`Vamos por partes: sua escola tem salas de ${segment.name}?`);
  state.currentQuestion = { type: "yesno", segmentKey: segment.key, segmentIndex: nextIndex };
}

function askRoomCount() {
  const pair = currentPendingPair();
  appendAssistant(`Quantas salas de ${pair.grade} - ${pair.shift} existem?`);
  state.currentQuestion = { type: "roomCount" };
}

function askRoomStudents() {
  const room = currentPendingRoom();
  appendAssistant(`Quantos alunos existem em ${room.grade} - ${room.shift} - ${room.letter}?`);
  state.currentQuestion = { type: "roomStudents" };
}

function askRoomCapacity() {
  const room = currentPendingRoom();
  appendAssistant(`Qual é a capacidade máxima de ${room.grade} - ${room.shift} - ${room.letter}?`);
  state.currentQuestion = { type: "roomCapacity" };
}

function advancePair() {
  const pending = state.pendingSegment;
  const pair = currentPendingPair();
  state.rooms.push(...(pair.rooms || []));
  pending.pairIndex += 1;
  if (pending.pairIndex < pending.pairs.length) askRoomCount();
  else {
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
  appendAssistant(`Mapa concluído. Temos ${totals.rooms} sala(s) e ${totals.vacancies} vaga(s) disponíveis no momento.`);
  state.currentQuestion = { type: "done" };
  syncToCloud("completed-guide");
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

function calculateProgress() {
  if (state.currentQuestion.type === "done") return 100;
  const base = { director: 0, unit: 8, yesno: 16, date: 28, gradeSelect: 42, shiftSelect: 52, roomCount: 64, roomStudents: 74, roomCapacity: 84 };
  return Math.min(99, base[state.currentQuestion.type] || 10);
}

function missionLabel() {
  const q = state.currentQuestion;
  if (q.type === "director") return { title: "Identificar diretor", hint: "Comece pelo nome de quem está respondendo." };
  if (q.type === "unit") return { title: "Confirmar unidade", hint: "A unidade será vinculada ao diretor." };
  if (q.type === "yesno") return { title: "Decisão rápida", hint: "Responda sim ou não para seguir." };
  if (q.type === "date") return { title: "Definir semana", hint: "Isso ajuda na atualização semanal." };
  if (q.type === "gradeSelect") return { title: "Selecionar séries", hint: "Marque apenas o que existe na escola." };
  if (q.type === "shiftSelect") return { title: "Selecionar turnos", hint: "Manhã, tarde, integral ou noite." };
  if (q.type === "roomCount") return { title: "Quantificar salas", hint: "Informe quantas salas existem nesta combinação." };
  if (q.type === "roomStudents") return { title: "Alunos atuais", hint: "Agora entra o número real da turma." };
  if (q.type === "roomCapacity") return { title: "Capacidade máxima", hint: "Com isso calculamos as vagas." };
  return { title: "Mapa concluído", hint: "Os dados podem ser sincronizados." };
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

function initBrainScene() {
  if (!brainCanvas) return;
  const ctx = brainCanvas.getContext("2d");
  const points = Array.from({ length: 86 }, (_, index) => ({ angle: index * 0.52, rx: 0.16 + (index % 6) * 0.062 + Math.random() * 0.03, ry: 0.16 + ((5 - index % 6) * 0.03) + Math.random() * 0.05, speed: 0.00016 + Math.random() * 0.00022, phase: Math.random() * Math.PI * 2, pulse: Math.random() * 0.8 }));
  function resize() {
    const rect = brainCanvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    brainCanvas.width = Math.max(1, Math.floor(rect.width * scale));
    brainCanvas.height = Math.max(1, Math.floor(rect.height * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function position(point, time, rect) {
    const cx = rect.width * 0.55;
    const cy = rect.height * 0.48;
    const wobble = Math.sin(time * point.speed + point.phase) * 18;
    return { x: cx + Math.cos(point.angle + wobble * 0.002) * rect.width * point.rx, y: cy + Math.sin(point.angle * 1.18 + wobble * 0.003) * rect.height * point.ry };
  }
  function draw(time) {
    const rect = brainCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { requestAnimationFrame(draw); return; }
    ctx.clearRect(0, 0, rect.width, rect.height);
    const progress = calculateProgress() / 100;
    const positions = points.map((point) => position(point, time, rect));
    const glow = ctx.createRadialGradient(rect.width * 0.58, rect.height * 0.48, 20, rect.width * 0.58, rect.height * 0.48, rect.width * 0.55);
    glow.addColorStop(0, "rgba(25,241,255,.22)");
    glow.addColorStop(0.42, "rgba(255,212,71,.12)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const distance = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
        if (distance < 82) {
          ctx.strokeStyle = `rgba(25,241,255,${(1 - distance / 82) * (0.14 + progress * 0.2)})`;
          ctx.beginPath();
          ctx.moveTo(positions[i].x, positions[i].y);
          ctx.lineTo(positions[j].x, positions[j].y);
          ctx.stroke();
        }
      }
    }
    positions.forEach((pos, index) => {
      const radius = 2 + points[index].pulse * 2 + progress * 1.4;
      ctx.beginPath();
      ctx.fillStyle = index % 7 === 0 ? "rgba(255,212,71,.95)" : "rgba(25,241,255,.72)";
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}
