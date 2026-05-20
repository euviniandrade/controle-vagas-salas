const storageKey = "aps-controle-vagas-v1";
const currentWeek = getIsoWeek(new Date());
const googleScriptUrl = window.APP_CONFIG?.GOOGLE_SCRIPT_URL || "";
const spreadsheetId = window.APP_CONFIG?.SPREADSHEET_ID || "";

const directorUnits = [
  ["Douglas", "CAR"],
  ["Washington", "CAP"],
  ["Anderson", "CAEGW"],
  ["Albert", "CATS"],
  ["Acleto", "CACLI I"],
  ["Uoston", "CACLI II"],
  ["Roberto", "CAEA"],
  ["Allan", "CAIS"],
  ["Josy", "EAP"],
  ["Ednaldo", "EATW"],
  ["Tatiane", "EAA"],
  ["Alessandro", "EAJL"],
  ["Rafael", "EACF"],
  ["Fábio", "EAVB"],
].map(([director, unit]) => ({ director, unit }));

const segments = [
  {
    name: "Educação Infantil",
    prompt: "Agora vamos para a Educação Infantil. Sua unidade oferece Maternal, Pré I ou Pré II?",
    grades: ["Maternal", "Pré I", "Pré II"],
    shifts: ["Manhã", "Tarde"],
    defaultCapacity: 22,
  },
  {
    name: "Contraturno",
    prompt: "A unidade tem contraturno? Pode ser uma sala por faixa ou por projeto.",
    grades: ["Contraturno Infantil", "Contraturno Fund. 1", "Contraturno Fund. 2"],
    shifts: ["Manhã", "Tarde", "Integral"],
    defaultCapacity: 25,
  },
  {
    name: "Fundamental 1",
    prompt: "Vamos para o Fundamental 1. Quais anos existem na unidade?",
    grades: ["1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano"],
    shifts: ["Manhã", "Tarde"],
    defaultCapacity: 32,
  },
  {
    name: "Fundamental 2",
    prompt: "Agora Fundamental 2. Quais anos existem na unidade?",
    grades: ["6º Ano", "7º Ano", "8º Ano", "9º Ano"],
    shifts: ["Manhã", "Tarde"],
    defaultCapacity: 35,
  },
  {
    name: "Ensino Médio",
    prompt: "Por fim, Ensino Médio. A unidade oferece alguma série? Em qual turno?",
    grades: ["1º Ano EM", "2º Ano EM", "3º Ano EM"],
    shifts: ["Manhã", "Tarde", "Noite"],
    defaultCapacity: 38,
  },
];

const state = loadState();
let stepIndex = state.stepIndex || 0;
let editingRoomId = null;
let activeFilter = "all";

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

const steps = [
  {
    key: "director",
    text: "Olá! Vou coletar o mapa de vagas por sala sem deixar você perdido em uma planilha gigante. Para começar, quem é o diretor da unidade?",
    type: "select",
    options: directorUnits.map((item) => item.director),
    onAnswer(value) {
      state.director = value;
      const match = directorUnits.find((item) => item.director === value);
      if (match) state.unit = match.unit;
      return match ? `Perfeito, ${value}. Vou preencher ${match.unit} como unidade, mas você pode ajustar na próxima pergunta.` : `Perfeito, ${value}.`;
    },
  },
  {
    key: "unit",
    text: "Confirme a unidade escolar.",
    type: "select",
    options: directorUnits.map((item) => item.unit),
    onAnswer(value) {
      state.unit = value;
      const match = directorUnits.find((item) => item.unit === value);
      if (match && !state.director) state.director = match.director;
      return `Unidade ${value} selecionada.`;
    },
  },
  {
    key: "hasHighSchool",
    text: "Essa unidade tem Ensino Médio?",
    type: "choice",
    options: ["Sim", "Não", "Somente em um turno"],
    onAnswer(value) {
      state.hasHighSchool = value;
      return value === "Não" ? "Certo. Vou deixar o Ensino Médio como opcional e priorizar os demais segmentos." : "Ótimo. Quando chegarmos no Ensino Médio, vou perguntar por série e turno.";
    },
  },
  {
    key: "weeklyDate",
    text: "Qual é a semana de referência deste levantamento?",
    type: "date",
    onAnswer(value) {
      state.weeklyDate = value;
      state.weekId = getIsoWeek(new Date(`${value}T12:00:00`));
      return `Semana registrada: ${formatDate(value)}.`;
    },
  },
  ...segments.map((segment) => ({
    key: `segment:${segment.name}`,
    text: segment.prompt,
    type: "segment",
    segment,
    skip() {
      return segment.name === "Ensino Médio" && state.hasHighSchool === "Não";
    },
    onAnswer(value) {
      if (value === "Não oferece") {
        state.offeredSegments[segment.name] = false;
        removeRoomsBySegment(segment.name);
        return `${segment.name} marcado como não oferecido.`;
      }
      state.offeredSegments[segment.name] = true;
      createRoomsForSegment(segment, value);
      return `${segment.name} atualizado com ${value.grades.length} série(s), ${value.shifts.length} turno(s) e ${value.letters} sala(s) por combinação.`;
    },
  })),
  {
    key: "finish",
    text: "Pronto. O mapa inicial está montado. Agora ajuste capacidade e alunos atuais em cada sala; eu mantenho as vagas calculadas em tempo real.",
    type: "done",
  },
];

init();

function init() {
  ensureDefaults();
  setupDialogOptions();
  bindEvents();
  initBrainScene();
  renderAll();
  renderCurrentStep();
  lucide.createIcons();
}

function ensureDefaults() {
  state.rooms ||= [];
  state.offeredSegments ||= {};
  state.history ||= [];
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

function renderCurrentStep() {
  while (steps[stepIndex]?.skip?.()) stepIndex += 1;
  const step = steps[stepIndex] || steps.at(-1);
  if (!chatLog.dataset.started) {
    appendAssistant(step.text);
    chatLog.dataset.started = "1";
  }
  renderAnswer(step);
  persist();
}

function renderAnswer(step) {
  sendButton.disabled = step.type === "done";
  if (step.type === "done") {
    answerMount.innerHTML = `<button class="chip selected" type="button" id="restartGuide">Revisar roteiro desde o começo</button>`;
    $("#restartGuide").addEventListener("click", () => {
      stepIndex = 0;
      chatLog.innerHTML = "";
      chatLog.dataset.started = "";
      renderCurrentStep();
    });
    return;
  }
  if (step.type === "select") {
    answerMount.innerHTML = `<select required>${step.options.map((option) => `<option value="${escapeAttr(option)}" ${state[step.key] === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
    return;
  }
  if (step.type === "choice") {
    answerMount.innerHTML = `<div class="chips">${step.options.map((option) => `<button class="chip" type="button" data-value="${escapeAttr(option)}">${escapeHtml(option)}</button>`).join("")}</div><input type="hidden" required />`;
    bindChipChoice();
    return;
  }
  if (step.type === "date") {
    answerMount.innerHTML = `<input type="date" required value="${escapeAttr(state.weeklyDate || new Date().toISOString().slice(0, 10))}" />`;
    return;
  }
  if (step.type === "segment") {
    const segment = step.segment;
    answerMount.innerHTML = `
      <div class="segment-picker">
        <div class="chips" data-kind="grades">
          ${segment.grades.map((grade) => `<button class="chip" type="button" data-value="${escapeAttr(grade)}">${escapeHtml(grade)}</button>`).join("")}
        </div>
        <div class="chips" data-kind="shifts">
          ${segment.shifts.map((shift) => `<button class="chip" type="button" data-value="${escapeAttr(shift)}">${escapeHtml(shift)}</button>`).join("")}
        </div>
        <select data-letters aria-label="Quantidade de salas por combinação">
          <option value="1">1 sala por série/turno</option>
          <option value="2">2 salas por série/turno</option>
          <option value="3">3 salas por série/turno</option>
          <option value="4">4 salas por série/turno</option>
        </select>
        <button class="chip" type="button" data-none>Não oferece</button>
      </div>`;
    answerMount.querySelectorAll(".chips .chip").forEach((button) => button.addEventListener("click", () => button.classList.toggle("selected")));
    answerMount.querySelector("[data-none]").addEventListener("click", () => {
      answerMount.querySelectorAll(".chip").forEach((button) => button.classList.remove("selected"));
      answerMount.querySelector("[data-none]").classList.add("selected");
    });
  }
}

function bindChipChoice() {
  const hidden = answerMount.querySelector("input");
  answerMount.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => {
      answerMount.querySelectorAll(".chip").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      hidden.value = button.dataset.value;
    });
  });
}

function submitAnswer(event) {
  event.preventDefault();
  const step = steps[stepIndex];
  const value = collectValue(step);
  if (!value) return;
  appendUser(formatValue(value));
  const response = step.onAnswer?.(value);
  if (response) appendAssistant(response);
  stepIndex += 1;
  while (steps[stepIndex]?.skip?.()) stepIndex += 1;
  const nextStep = steps[stepIndex];
  if (nextStep) appendAssistant(nextStep.text);
  renderAll();
  renderAnswer(nextStep || steps.at(-1));
  persist();
}

function collectValue(step) {
  if (step.type === "select" || step.type === "date") return answerMount.querySelector("select,input")?.value;
  if (step.type === "choice") return answerMount.querySelector("input")?.value;
  if (step.type === "segment") {
    if (answerMount.querySelector("[data-none]").classList.contains("selected")) return "Não oferece";
    const grades = Array.from(answerMount.querySelectorAll('[data-kind="grades"] .selected')).map((item) => item.dataset.value);
    const shifts = Array.from(answerMount.querySelectorAll('[data-kind="shifts"] .selected')).map((item) => item.dataset.value);
    const letters = Number(answerMount.querySelector("[data-letters]").value || 1);
    if (!grades.length || !shifts.length) return null;
    return { grades, shifts, letters };
  }
  return null;
}

function createRoomsForSegment(segment, value) {
  removeRoomsBySegment(segment.name);
  const letters = ["A", "B", "C", "D"];
  const rooms = [];
  value.grades.forEach((grade) => {
    value.shifts.forEach((shift) => {
      for (let index = 0; index < value.letters; index += 1) {
        rooms.push({
          id: crypto.randomUUID(),
          segment: segment.name,
          grade,
          shift,
          letter: letters[index],
          capacity: segment.defaultCapacity,
          students: 0,
          updatedAt: new Date().toISOString(),
        });
      }
    });
  });
  state.rooms.push(...rooms);
}

function removeRoomsBySegment(segmentName) {
  state.rooms = state.rooms.filter((room) => room.segment !== segmentName);
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

function renderMissionDeck() {
  const step = steps[Math.min(stepIndex, steps.length - 1)] || steps.at(-1);
  const totals = getTotals();
  const progress = Math.round((Math.min(stepIndex, steps.length - 1) / Math.max(steps.length - 1, 1)) * 100);
  if (missionTitle) missionTitle.textContent = step?.title || missionLabel(step);
  if (missionHint) missionHint.textContent = missionLabel(step);
  if (progressText) progressText.textContent = `${progress}%`;
  if (progressBar) progressBar.style.width = `${progress}%`;
  if (resultPreview) resultPreview.textContent = totals.rooms ? `${totals.vacancies} vagas mapeadas` : "Vagas em tempo real";
  stageDots.forEach((dot, index) => dot.classList.toggle("active", index <= Math.min(4, Math.floor(progress / 25))));
}

function missionLabel(step) {
  if (!step) return "Finalizar mapa de vagas";
  if (step.key === "director") return "Escolha o diretor para iniciar o mapa.";
  if (step.key === "unit") return "Confirme a unidade escolar.";
  if (step.key === "hasHighSchool") return "Informe se a unidade oferece Ensino Médio.";
  if (step.key === "weeklyDate") return "Defina a semana de referência.";
  if (step.type === "segment") return `Mapear ${step.segment.name}.`;
  return "Revisar salas, alunos e vagas.";
}

function renderUnit() {
  $("#unitBadge").textContent = state.director ? `Diretor: ${state.director}` : "Unidade não iniciada";
  $("#unitTitle").textContent = state.unit || "Comece pela unidade";
  $("#unitSubtitle").textContent = state.hasHighSchool ? `Ensino Médio: ${state.hasHighSchool}` : "O assistente vai perguntar por diretor, segmentos, turnos e salas.";
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
    roomsList.innerHTML = `<div class="empty-state">Nenhuma sala neste filtro ainda. Use o roteiro ou adicione manualmente.</div>`;
    return;
  }
  roomsList.innerHTML = visible
    .sort(sortRooms)
    .map((room) => {
      const vacancies = Math.max(0, Number(room.capacity || 0) - Number(room.students || 0));
      return `
        <article class="room-item ${vacancies > 0 ? "open" : "full"}">
          <button type="button" data-room-id="${escapeAttr(room.id)}">
            <span class="room-name">${escapeHtml(room.grade)} - ${escapeHtml(room.shift)} ${room.letter ? `- ${escapeHtml(room.letter)}` : ""}</span>
            <span class="room-meta">${escapeHtml(room.segment)} · ${room.students || 0}/${room.capacity || 0} alunos · atualizado ${formatDateTime(room.updatedAt)}</span>
          </button>
          <div class="room-vacancy"><strong>${vacancies}</strong><small>vagas</small></div>
        </article>`;
    })
    .join("");
  roomsList.querySelectorAll("[data-room-id]").forEach((button) => {
    button.addEventListener("click", () => openRoomDialog(button.dataset.roomId));
  });
}

function setupDialogOptions() {
  $("#roomSegment").innerHTML = segments.map((segment) => `<option>${escapeHtml(segment.name)}</option>`).join("");
  $("#roomShift").innerHTML = ["Manhã", "Tarde", "Integral", "Noite"].map((shift) => `<option>${shift}</option>`).join("");
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
  const confirmed = confirm("Deseja remover todas as salas cadastradas nesta unidade?");
  if (!confirmed) return;
  state.rooms = [];
  renderAll();
  persist();
}

function createWeeklySnapshot() {
  const totals = getTotals();
  state.history.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    weekId: state.weekId || currentWeek,
    unit: state.unit,
    director: state.director,
    totals,
    rooms: structuredClone(state.rooms),
  });
  state.weeklyDate = new Date().toISOString().slice(0, 10);
  state.weekId = currentWeek;
  state.rooms = state.rooms.map((room) => ({ ...room, updatedAt: new Date().toISOString() }));
  appendAssistant(`Fechei um registro da semana anterior: ${totals.vacancies} vagas disponíveis em ${totals.rooms} salas. Pode atualizar os alunos desta nova semana.`);
  renderAll();
  persist();
  syncToCloud("weekly-snapshot");
}

function exportCsv() {
  const rows = [
    ["Unidade", "Diretor", "Semana", "Segmento", "Série", "Turno", "Sala", "Capacidade", "Alunos", "Vagas", "Atualizado em"],
    ...state.rooms.sort(sortRooms).map((room) => [
      state.unit || "",
      state.director || "",
      state.weekId || currentWeek,
      room.segment,
      room.grade,
      room.shift,
      room.letter || "",
      room.capacity || 0,
      room.students || 0,
      Math.max(0, Number(room.capacity || 0) - Number(room.students || 0)),
      formatDateTime(room.updatedAt),
    ]),
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
      const imported = JSON.parse(String(reader.result || "{}"));
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, imported);
      ensureDefaults();
      stepIndex = state.stepIndex || 0;
      chatLog.innerHTML = "";
      chatLog.dataset.started = "";
      renderAll();
      renderCurrentStep();
      persist();
    } catch {
      alert("Não consegui ler esse JSON. Confira se é um backup gerado por esta ferramenta.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function appendAssistant(html) {
  appendMessage("assistant", html);
}

function appendUser(text) {
  appendMessage("user", escapeHtml(text));
}

function appendMessage(role, html) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.innerHTML = `<div class="bubble">${html}</div>`;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function persist() {
  state.stepIndex = stepIndex;
  localStorage.setItem(storageKey, JSON.stringify(state));
  saveStatus.textContent = googleReady() ? "Salvo localmente" : "Salvo localmente";
  clearTimeout(persist.timer);
  persist.timer = setTimeout(() => {
    saveStatus.textContent = googleReady() ? "Pronto para sincronizar" : "Salvo localmente";
  }, 1000);
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
    appendAssistant("O banco online já tem planilha criada, mas ainda falta publicar o Apps Script e colar a URL em <strong>config.js</strong>.");
    return;
  }
  saveStatus.textContent = "Sincronizando...";
  const payload = buildCloudPayload(reason);
  try {
    await fetch(googleScriptUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "syncVagas", spreadsheetId, payload }),
    });
    state.lastCloudSync = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify(state));
    saveStatus.textContent = "Sincronizado online";
  } catch {
    saveStatus.textContent = "Falha ao sincronizar";
  }
}

function buildCloudPayload(reason) {
  const totals = getTotals();
  return {
    reason,
    syncedAt: new Date().toISOString(),
    unit: state.unit || "",
    director: state.director || "",
    weekId: state.weekId || currentWeek,
    weeklyDate: state.weeklyDate || "",
    hasHighSchool: state.hasHighSchool || "",
    totals,
    offeredSegments: state.offeredSegments || {},
    rooms: state.rooms || [],
    history: state.history || [],
  };
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function formatValue(value) {
  if (typeof value === "string") return value;
  return `${value.grades.join(", ")} · ${value.shifts.join(", ")} · ${value.letters} sala(s)`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
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
  const segmentOrder = Object.fromEntries(segments.map((segment, index) => [segment.name, index]));
  return (segmentOrder[a.segment] ?? 99) - (segmentOrder[b.segment] ?? 99)
    || a.grade.localeCompare(b.grade, "pt-BR", { numeric: true })
    || a.shift.localeCompare(b.shift, "pt-BR")
    || String(a.letter || "").localeCompare(String(b.letter || ""), "pt-BR");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function slug(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function initBrainScene() {
  if (!brainCanvas) return;
  const ctx = brainCanvas.getContext("2d");
  const points = Array.from({ length: 68 }, (_, index) => {
    const angle = index * 0.62;
    const layer = index % 5;
    const rx = 0.16 + (layer * 0.075) + Math.random() * 0.035;
    const ry = 0.18 + ((4 - layer) * 0.035) + Math.random() * 0.05;
    return {
      angle,
      rx,
      ry,
      speed: 0.00016 + Math.random() * 0.00022,
      phase: Math.random() * Math.PI * 2,
      pulse: Math.random() * 0.8,
    };
  });

  function resize() {
    const rect = brainCanvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    brainCanvas.width = Math.max(1, Math.floor(rect.width * scale));
    brainCanvas.height = Math.max(1, Math.floor(rect.height * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function brainPosition(point, time, rect) {
    const cx = rect.width * 0.54;
    const cy = rect.height * 0.48;
    const wobble = Math.sin(time * point.speed + point.phase) * 16;
    const x = cx + Math.cos(point.angle + wobble * 0.002) * rect.width * point.rx;
    const y = cy + Math.sin(point.angle * 1.18 + wobble * 0.003) * rect.height * point.ry;
    const notch = Math.max(0, 1 - Math.abs((x - cx) / (rect.width * 0.28))) * 16;
    return { x, y: y + Math.sin(point.angle) * notch };
  }

  function draw(time) {
    const rect = brainCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      requestAnimationFrame(draw);
      return;
    }
    ctx.clearRect(0, 0, rect.width, rect.height);
    const progress = Math.min(1, Math.max(0, (stepIndex || 0) / Math.max(steps.length - 1, 1)));
    const positions = points.map((point) => brainPosition(point, time, rect));

    const glow = ctx.createRadialGradient(rect.width * 0.58, rect.height * 0.48, 20, rect.width * 0.58, rect.height * 0.48, rect.width * 0.48);
    glow.addColorStop(0, "rgba(245,189,36,.18)");
    glow.addColorStop(0.42, "rgba(19,124,139,.12)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.lineWidth = 1;
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const distance = Math.hypot(dx, dy);
        if (distance < 86) {
          const alpha = (1 - distance / 86) * (0.16 + progress * 0.16);
          ctx.strokeStyle = `rgba(13,78,99,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(positions[i].x, positions[i].y);
          ctx.lineTo(positions[j].x, positions[j].y);
          ctx.stroke();
        }
      }
    }

    positions.forEach((pos, index) => {
      const pulse = 1 + Math.sin(time * 0.002 + points[index].phase) * 0.35;
      const radius = 2.2 + points[index].pulse * 2.2 + progress * 1.4;
      ctx.beginPath();
      ctx.fillStyle = index % 7 === 0 ? "rgba(245,189,36,.9)" : "rgba(13,78,99,.78)";
      ctx.arc(pos.x, pos.y, radius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,.72)";
      ctx.arc(pos.x - 0.8, pos.y - 0.8, Math.max(1, radius * 0.32), 0, Math.PI * 2);
      ctx.fill();
    });

    const scanX = rect.width * (0.26 + ((time * 0.00008) % 1) * 0.56);
    const beam = ctx.createLinearGradient(scanX - 28, 0, scanX + 28, 0);
    beam.addColorStop(0, "rgba(245,189,36,0)");
    beam.addColorStop(0.5, "rgba(245,189,36,.18)");
    beam.addColorStop(1, "rgba(245,189,36,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(scanX - 28, 0, 56, rect.height);

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}
