const storageKey = "aps-controle-vagas-v15";
const legacyStorageKeys = ["aps-controle-vagas-v1", "aps-controle-vagas-v2", "aps-controle-vagas-v3", "aps-controle-vagas-v4", "aps-controle-vagas-v5", "aps-controle-vagas-v6", "aps-controle-vagas-v7", "aps-controle-vagas-v8", "aps-controle-vagas-v9", "aps-controle-vagas-v10", "aps-controle-vagas-v11", "aps-controle-vagas-v12", "aps-controle-vagas-v13", "aps-controle-vagas-v14"];
const currentWeek = getIsoWeek(new Date());
const googleScriptUrl = window.APP_CONFIG?.GOOGLE_SCRIPT_URL || "";
const spreadsheetId = window.APP_CONFIG?.SPREADSHEET_ID || "";
const unitBlueprints = window.UNIT_BLUEPRINTS || {};

const directorUnits = [
  ["Douglas", "CAR"], ["Washington", "CAP"], ["Anderson", "CAEGW"], ["Albert", "CATS"],
  ["Acleto", "CACLI I"], ["Uoston", "CACLI II"], ["Roberto", "CAEA"], ["Allan", "CAIS"],
  ["Josy", "EAP"], ["Ednaldo", "EATW"], ["Tatiane", "EAA"], ["Alessandro", "EAJL"],
  ["Rafael", "EACF"], ["Fábio", "EAVB"],
].map(([director, unit]) => ({ director, unit }));

const presetContraturnoUnits = new Set(["CAR", "CATS", "CACLI", "CACLI I", "CACLI 1", "CACLI II", "CACLI 2", "CAEA", "CAIS", "EACF", "EAVB"].map(normalizeName));

const unitRuleOverrides = {
  "CAR": { hasContraturno: true },
  "CATS": { hasContraturno: true },
  "CACLI": { hasContraturno: true, aliasOf: "CACLI I" },
  "CACLI I": { hasContraturno: true },
  "CACLI 1": { hasContraturno: true, aliasOf: "CACLI I" },
  "CACLI II": { hasContraturno: true },
  "CACLI 2": { hasContraturno: true, aliasOf: "CACLI II" },
  "CAEA": { hasContraturno: true },
  "CAIS": { hasContraturno: true },
  "EACF": { hasContraturno: true },
  "EAVB": { hasContraturno: true },
};

const segmentPlan = [
  { key: "infantil", name: "Educação Infantil", grades: ["Maternal", "Pré I", "Pré II"], shifts: ["Manhã", "Tarde"], capacity: 22, required: true },
  { key: "contraturno", name: "Contraturno", grades: ["Contraturno Infantil", "Contraturno Fund. 1", "Contraturno Fund. 2"], shifts: ["Manhã", "Tarde", "Integral"], capacity: 25, gatedBy: "hasContraturno" },
  { key: "fund1", name: "Fundamental 1", grades: ["1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano"], shifts: ["Manhã", "Tarde"], capacity: 32 },
  { key: "fund2", name: "Fundamental 2", grades: ["6º Ano", "7º Ano", "8º Ano", "9º Ano"], shifts: ["Manhã", "Tarde"], capacity: 35 },
  { key: "medio", name: "Ensino Médio", grades: ["1º Ano EM", "2º Ano EM", "3º Ano EM"], shifts: ["Manhã", "Tarde"], capacity: 38, gatedBy: "hasHighSchool" },
];

const exitReasons = [
  "Mudança de cidade",
  "Transferência para outra escola",
  "Questão financeira",
  "Transporte ou distância",
  "Adaptação pedagógica",
  "Saúde ou família",
  "Outro motivo",
];

const $ = (selector) => document.querySelector(selector);
const chatLog = $("#chatLog");
const answerForm = $("#answerForm");
const answerMount = $("#answerMount");
const saveStatus = $("#saveStatus");
const sendButton = $("#sendButton");
const roomsList = $("#roomsList");
const controlPanel = $(".control-panel");
const layout = $(".layout");
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
    appendAssistant(currentQuestionPrompt());
    chatLog.dataset.started = "1";
  }
  renderAnswer();
  refreshIcons();
}

function ensureDefaults() {
  state.director ||= "";
  state.unit ||= "";
  state.currentQuestion ||= { type: "director" };
  state.rooms ||= [];
  state.history ||= [];
  state.movements ||= [];
  state.reports ||= [];
  state.submittedAt ||= "";
  state.answers ||= {};
  state.weeklyDate ||= new Date().toISOString().slice(0, 10);
  state.weekId ||= currentWeek;
  const validQuestions = new Set(["director", "unit", "yesno", "blueprintConfirm", "roomCount", "roomStudents", "mixedStudents", "mixedConfirm", "roomCapacity", "review", "dailyRoom", "dailyType", "dailyQty", "dailyReason", "done"]);
  if (!validQuestions.has(state.currentQuestion.type) || state.currentQuestion.segmentKey) {
    state.currentQuestion = { type: "director" };
    delete state.pendingSegment;
  }
  if (state.currentQuestion.type === "yesno" && state.currentQuestion.key === "hasContraturno" && unitHasPresetContraturno(state.unit)) {
    state.answers.hasContraturno = true;
    const blueprint = getCurrentBlueprint();
    state.currentQuestion = blueprint ? { type: "blueprintConfirm" } : { type: "yesno", key: "hasHighSchool" };
    if (blueprint) state.answers.hasHighSchool = Boolean(blueprint.hasHighSchool);
  }
}

function bindEvents() {
  answerForm.addEventListener("submit", submitAnswer);
  answerMount.addEventListener("click", handleAnswerAction);
  $("#addRoomButton").addEventListener("click", () => {
    if (!canEditRooms()) return;
    openRoomDialog();
  });
  $("#clearRoomsButton").addEventListener("click", () => {
    if (!canEditRooms()) return;
    clearRooms();
  });
  $("#newWeekButton").addEventListener("click", createWeeklySnapshot);
  $("#syncCloudButton").addEventListener("click", () => {
    if (!state.submittedAt) {
      appendAssistant("Ainda não enviei nada ao painel administrativo. Primeiro finalize o formulário e confirme o resumo.");
      return;
    }
    syncToCloud("manual");
  });
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#exportJsonButton").addEventListener("click", exportJson);
  $("#importJsonInput").addEventListener("change", importJson);
  $("#clearDataButton").addEventListener("click", clearMyData);
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

function refreshIcons() {
  window.lucide?.createIcons?.();
}

function handleAnswerAction(event) {
  const button = event.target.closest("[data-action]");
  if (button) {
    if (button.dataset.action === "daily-update") startDailyUpdate();
    if (button.dataset.action === "report") generateManualReport();
    if (button.dataset.action === "restart") restartGuide();
    if (button.dataset.action === "confirm-submit") confirmFinalSubmission();
    if (button.dataset.action === "correct-review") explainCorrectionMode();
    if (button.dataset.action === "tutorial") appendAssistant(directorTutorialCard());
    if (button.dataset.action === "fetch-report") fetchAndShowReportLinks();
    if (button.dataset.action === "clear-data") clearMyData();
    return;
  }
  const choice = event.target.closest(".chip[data-value]");
  if (!choice || !answerMount.contains(choice)) return;
  const hidden = answerMount.querySelector("input[type='hidden']");
  if (!hidden) return;
  if (choice.closest(".multi-answer")) {
    choice.classList.toggle("selected");
    hidden.value = selectedChipValues().join("|");
    return;
  }
  answerMount.querySelectorAll(".chip[data-value]").forEach((item) => item.classList.remove("selected"));
  choice.classList.add("selected");
  hidden.value = choice.dataset.value;
  setTimeout(() => answerForm.requestSubmit(), 80);
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
  if (q.type === "review") {
    answerMount.innerHTML = `
      <div class="chips action-chips">
        <button class="chip selected" type="button" data-action="confirm-submit">Confirmar e enviar</button>
        <button class="chip" type="button" data-action="correct-review">Corrigir antes de enviar</button>
      </div>`;
    sendButton.disabled = true;
    return;
  }
  if (q.type === "done") {
    const savedReport = state.latestReport;
    const reportLinksHtml = savedReport && (savedReport.pdfUrl || savedReport.docUrl) ? `
      <div class="done-report-links">
        ${savedReport.pdfUrl ? `<a class="report-link-btn pdf" href="${escapeAttr(savedReport.pdfUrl)}" target="_blank" rel="noopener">📥 Baixar PDF</a>` : ""}
        ${savedReport.docUrl ? `<a class="report-link-btn doc" href="${escapeAttr(savedReport.docUrl)}" target="_blank" rel="noopener">📄 Ver no Google Docs</a>` : ""}
      </div>` : "";
    answerMount.innerHTML = `
      <div class="chips action-chips">
        <button class="chip selected" type="button" data-action="daily-update">Atualizar alunos hoje</button>
        <button class="chip" type="button" data-action="report">📊 Gerar relatório</button>
        <button class="chip" type="button" data-action="fetch-report">📄 Ver PDF no Drive</button>
        <button class="chip" type="button" data-action="tutorial">Ver tutorial</button>
        <button class="chip danger-chip" type="button" data-action="clear-data">🗑️ Apagar meu preenchimento</button>
      </div>
      ${reportLinksHtml}`;
    sendButton.disabled = true;
    return;
  }
  if (q.type === "dailyRoom") {
    answerMount.innerHTML = `<select required>${state.rooms.sort(sortRooms).map((room) => `<option value="${escapeAttr(room.id)}">${escapeHtml(roomLabel(room))} · ${escapeHtml(room.segment)} · ${room.students || 0}/${room.capacity || 0}</option>`).join("")}</select>`;
    return;
  }
  if (q.type === "dailyType") {
    answerMount.innerHTML = choiceButtons(["Entrada", "Saída", "Ajuste do total"]);
    bindSingleChoice();
    return;
  }
  if (q.type === "dailyQty") {
    const label = state.updateFlow?.type === "Ajuste do total" ? "Novo total de alunos" : "Quantidade de alunos";
    answerMount.innerHTML = `<input type="number" min="0" max="120" step="1" required placeholder="${label}" />`;
    return;
  }
  if (q.type === "dailyReason") {
    answerMount.innerHTML = `<select required>${exitReasons.map((reason) => `<option>${escapeHtml(reason)}</option>`).join("")}</select>`;
    return;
  }
  if (q.type === "blueprintConfirm") {
    const bp = getCurrentBlueprint();
    if (!bp) {
      answerMount.innerHTML = choiceButtons(["Confirmar estrutura", "Ajustar manualmente"]);
      bindSingleChoice();
      return;
    }
    const mixed = bp.mixedGroups || [];
    const shiftEmoji = { "Manhã": "🌅", "Tarde": "🌆", "Integral": "🔄" };
    const segEmoji = { "Educação Infantil": "🍎", "Fundamental 1": "📚", "Fundamental 2": "📖", "Ensino Médio": "🎓" };
    const byShift = {};
    (bp.grades || []).forEach((gp) => {
      Object.entries(gp.shifts || {}).forEach(([rawShift, cnt]) => {
        const shift = displayShift(rawShift);
        const segment = displaySegment(gp.segment);
        const grade = displayGrade(gp.grade);
        const key = shift + "||" + grade + "||" + segment;
        if (!byShift[shift]) byShift[shift] = [];
        const mixedNote = (gp.mixedWithByShift && gp.mixedWithByShift[rawShift] && gp.mixedWithByShift[rawShift].note) || gp.note || "";
        byShift[shift].push({ key, grade, segment, count: Number(cnt || 0), mixedNote });
      });
    });
    const shiftOrder = ["Manhã", "Tarde", "Integral"];
    const mixedHtml = mixed.length ? `<div class="cl-mixed">⚠️ <strong>Turmas multisseriadas nesta unidade:</strong><ul>${
      mixed.map((g) => {
        const grades = (g.grades || []).map(displayGrade).join(" + ");
        const shifts = (g.shifts || []).map(displayShift).join(" e ");
        return `<li>• <strong>${escapeHtml(grades)}</strong> — <em>${escapeHtml(shifts)}</em>${g.note ? " — " + escapeHtml(g.note) : ""}</li>`;
      }).join("")
    }</ul></div>` : "";
    const periodsHtml = shiftOrder.filter((s) => byShift[s]).map((shift) => {
      const rows = byShift[shift].map((item) => `
        <div class="cl-row">
          <span class="cl-emoji">${segEmoji[item.segment] || "📋"}</span>
          <span class="cl-grade"><strong>${escapeHtml(item.grade)}</strong>${item.mixedNote ? ` <small>⚠️ ${escapeHtml(item.mixedNote)}</small>` : ""}</span>
          <label class="cl-count">
            <input type="number" class="cl-input" data-key="${escapeAttr(item.key)}" min="0" max="12" step="1" value="${item.count}" />
            <span>turma(s)</span>
          </label>
        </div>`).join("");
      return `<div class="cl-period"><h4>${shiftEmoji[shift] || ""} <strong>${shift}</strong></h4>${rows}</div>`;
    }).join("");
    answerMount.innerHTML = `
      <input type="hidden" id="bpVal" required />
      <div class="blueprint-checklist">
        ${mixedHtml}
        ${periodsHtml}
        <div class="cl-actions">
          <button class="chip selected" type="button" id="bpConfirmBtn">✅ Confirmar estrutura</button>
          <button class="chip" type="button" id="bpManualBtn">✏️ Ajustar manualmente</button>
          <button class="chip chip-back" type="button" id="bpBackBtn">⬅️ Voltar</button>
        </div>
      </div>`;
    document.getElementById("bpConfirmBtn").addEventListener("click", () => {
      const adj = {};
      answerMount.querySelectorAll(".cl-input").forEach((inp) => { adj[inp.dataset.key] = Number(inp.value || 0); });
      document.getElementById("bpVal").value = "confirm:" + JSON.stringify(adj);
      answerForm.dispatchEvent(new Event("submit", { bubbles: true }));
    });
    document.getElementById("bpManualBtn").addEventListener("click", () => {
      document.getElementById("bpVal").value = "manual";
      answerForm.dispatchEvent(new Event("submit", { bubbles: true }));
    });
    document.getElementById("bpBackBtn").addEventListener("click", () => {
      document.getElementById("bpVal").value = "back";
      answerForm.dispatchEvent(new Event("submit", { bubbles: true }));
    });
    return;
  }
  if (q.type === "director") {
    answerMount.innerHTML = `
      <input type="text" required list="directorSuggestions" autocomplete="name" placeholder="Seu nome" />
      <datalist id="directorSuggestions">
        ${directorUnits.map((item) => `<option value="${escapeAttr(item.director)}"></option>`).join("")}
      </datalist>`;
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
    return;
  }
  if (q.type === "mixedStudents") {
    answerMount.innerHTML = `<input type="number" min="0" max="80" step="1" required placeholder="Alunos desta série" />`;
    return;
  }
  if (q.type === "mixedConfirm") {
    answerMount.innerHTML = choiceButtons(["Correto", "Corrigir composição"]);
    bindSingleChoice();
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
  appendUser(formatAnswer(value, q));
  handleAnswer(q, value);
  renderAll();
  renderAnswer();
  persist();
}

function collectValue(q) {
  if (["director", "unit", "roomCount", "roomStudents", "mixedStudents", "roomCapacity", "dailyRoom", "dailyQty", "dailyReason"].includes(q.type)) {
    return answerMount.querySelector("select,input")?.value ?? "";
  }
  if (q.type === "yesno" || q.type === "dailyType" || q.type === "blueprintConfirm" || q.type === "mixedConfirm") return answerMount.querySelector("input")?.value || "";
  return "";
}

function restartGuide() {
  state.currentQuestion = { type: "director" };
  state.rooms = [];
  state.answers = {};
  state.movements = [];
  state.reports = [];
  state.submittedAt = "";
  delete state.updateFlow;
  delete state.pendingSegment;
  delete state.prefillFlow;
  delete state.prefillContraturnoOnly;
  chatLog.innerHTML = "";
  chatLog.dataset.started = "";
  appendAssistant("Vamos recomeçar com uma coleta limpa, uma pergunta por vez. Qual é o seu nome?");
  renderAll();
  renderAnswer();
  persist();
}

function formatAnswer(value, q = state.currentQuestion) {
  if (q.type === "dailyRoom") {
    const room = state.rooms.find((item) => item.id === value);
    return room ? roomLabel(room) : value;
  }
  if (q.type === "blueprintConfirm") {
    if (value === "back") return "⬅️ Voltar";
    return value.startsWith("confirm:") ? "✅ Estrutura confirmada" : "✏️ Ajustar manualmente";
  }
  return Array.isArray(value) ? value.join(", ") : value;
}

function setupDialogOptions() {
  $("#roomSegment").innerHTML = segmentPlan.map((segment) => `<option>${escapeHtml(segment.name)}</option>`).join("");
  $("#roomShift").innerHTML = ["Manhã", "Tarde", "Integral", "Noite"].map((shift) => `<option>${shift}</option>`).join("");
  $("#roomExitReason").innerHTML = `<option value="">Selecione se houve saída</option>${exitReasons.map((reason) => `<option>${escapeHtml(reason)}</option>`).join("")}`;
}

function renderAll() {
  const editable = canEditRooms();
  const submitted = Boolean(state.submittedAt);
  renderUnit();
  renderMetrics();
  renderDecisionPanel();
  renderRooms();
  renderMissionDeck();
  $("#weekLabel").textContent = state.weekId || currentWeek;
  $("#roomsHint").textContent = editable ? "Revise as turmas mapeadas antes do envio final." : "Prévia automática: continue respondendo pelo chat.";
  $("#syncCloudButton").hidden = !submitted;
  $("#newWeekButton").hidden = !submitted;
  controlPanel.classList.toggle("is-empty", !state.rooms.length);
  controlPanel.classList.toggle("guide-active", !editable);
  controlPanel.classList.toggle("guide-complete", editable);
  layout?.classList.toggle("has-results", Boolean(state.rooms.length));
  refreshIcons();
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

function renderDecisionPanel() {
  const mount = $("#decisionPanel");
  if (!mount) return;
  const rule = getUnitRule(state.unit);
  const totals = getTotals();
  const expected = Math.max(Number(rule.expectedRooms || 0), totals.rooms);
  const pending = Math.max(0, expected - totals.rooms);
  const completedPercent = expected ? Math.min(100, Math.round((totals.rooms / expected) * 100)) : 0;
  const openRooms = state.rooms
    .map((room) => ({ ...room, vacancies: Math.max(0, Number(room.capacity || 0) - Number(room.students || 0)) }))
    .sort((a, b) => b.vacancies - a.vacancies);
  const fullRooms = openRooms.filter((room) => Number(room.capacity || 0) > 0 && room.vacancies <= 0).length;
  const topOpportunity = openRooms.find((room) => room.vacancies > 0);
  const segmentFocus = campaignSegmentFocus(state.rooms);
  mount.innerHTML = `
    <div class="decision-head">
      <span>Leitura da campanha</span>
      <strong>${completedPercent}% conferido</strong>
    </div>
    <div class="decision-grid">
      <b>${pending}<small>salas pendentes</small></b>
      <b>${fullRooms}<small>turmas lotadas</small></b>
    </div>
    <p>${topOpportunity ? `Maior oportunidade agora: ${escapeHtml(roomLabel(topOpportunity))}, com ${topOpportunity.vacancies} vaga(s).` : "As oportunidades aparecerão conforme capacidade e alunos forem confirmados."}</p>
    <p>${segmentFocus ? `Segmento com maior espaço para campanha: ${escapeHtml(segmentFocus.segment)}.` : "O foco de campanha será calculado automaticamente."}</p>`;
}

function renderRooms() {
  const editable = canEditRooms();
  const visible = state.rooms.filter((room) => activeFilter === "all" || room.segment === activeFilter);
  if (!visible.length) {
    roomsList.innerHTML = `<div class="empty-state">As salas aparecerão aqui conforme você responder.</div>`;
    return;
  }
  roomsList.innerHTML = visible.sort(sortRooms).map((room) => {
    const vacancies = Math.max(0, Number(room.capacity || 0) - Number(room.students || 0));
    return `
      <article class="room-item ${vacancies > 0 ? "open" : "full"}">
        <button type="button" data-room-id="${escapeAttr(room.id)}" ${editable ? "" : "disabled"}>
          <span class="room-name">${escapeHtml(room.grade)} - ${escapeHtml(room.shift)} ${room.letter ? `- ${escapeHtml(room.letter)}` : ""}</span>
          <span class="room-meta">${escapeHtml(room.segment)} · ${room.students || 0}/${room.capacity || 0} alunos · atualizado ${formatDateTime(room.updatedAt)}</span>
          ${room.mixedWith?.length ? `<span class="room-mixed">Mista com ${escapeHtml(room.mixedWith.join(" + "))}${room.mixedBreakdown ? ` · ${escapeHtml(mixedBreakdownText(room))}` : ""}</span>` : ""}
        </button>
        <div class="room-vacancy"><strong>${vacancies}</strong><small>vagas</small></div>
      </article>`;
  }).join("");
  if (editable) {
    roomsList.querySelectorAll("[data-room-id]").forEach((button) => button.addEventListener("click", () => openRoomDialog(button.dataset.roomId)));
  }
}

function canEditRooms() {
  return ["review", "done"].includes(state.currentQuestion?.type);
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
  $("#roomExitReason").value = "";
  roomDialog.showModal();
  refreshIcons();
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
    const previous = state.rooms[index];
    const difference = Number(payload.students || 0) - Number(previous.students || 0);
    if (difference < 0 && !$("#roomExitReason").value) {
      alert("Informe o motivo da saída para salvar a redução de alunos.");
      return;
    }
    state.rooms[index] = { ...previous, ...payload };
    if (difference !== 0) {
      recordMovement(state.rooms[index], {
        type: difference > 0 ? "Entrada" : "Saída",
        amount: Math.abs(difference),
        previousStudents: Number(previous.students || 0),
        newStudents: Number(payload.students || 0),
        reason: difference < 0 ? $("#roomExitReason").value : "",
        source: "manual",
      });
    }
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
  if (!state.submittedAt) {
    appendAssistant("A nova semana só fica disponível depois que o primeiro preenchimento for confirmado e enviado.");
    return;
  }
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

function appendAssistant(html) {
  compactChatForNextPrompt(html);
  const message = appendMessage("assistant", html);
  maybePolishAssistantMessage(message, html);
}
function appendUser(text) { appendMessage("user", escapeHtml(text)); }
function appendMessage(role, html) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.innerHTML = `<div class="bubble">${html}</div>`;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
  return message;
}

function compactChatForNextPrompt(html) {
  const text = String(html || "");
  const keepHistory = text.includes("<") || state.currentQuestion?.type === "review";
  if (keepHistory) return;
  const messages = Array.from(chatLog.querySelectorAll(".message"));
  const lastUser = [...messages].reverse().find((message) => message.classList.contains("user") && !message.classList.contains("is-archived"));
  let hidden = 0;
  messages.forEach((message) => {
    if (message === lastUser) return;
    if (message.querySelector(".unit-map-card")) return;
    if (!message.classList.contains("is-archived")) hidden += 1;
    message.classList.add("is-archived");
  });
  const archivedTotal = Number(chatLog.dataset.archivedCount || 0) + hidden;
  chatLog.dataset.archivedCount = String(archivedTotal);
  chatLog.classList.toggle("has-archived", archivedTotal > 0);
  chatLog.dataset.archiveLabel = archivedTotal > 1 ? `${archivedTotal} mensagens anteriores ocultas` : "1 mensagem anterior oculta";
}

function maybePolishAssistantMessage(message, html) {
  const text = String(html || "").trim();
  if (!googleReady() || !text || text.includes("<") || text.length > 700) return;
  const bubble = message.querySelector(".bubble");
  if (!bubble) return;
  requestAiCoach(text)
    .then((result) => {
      if (!result?.ok || !result.text) return;
      bubble.textContent = result.text;
      chatLog.scrollTop = chatLog.scrollHeight;
    })
    .catch(() => {});
}

function requestAiCoach(message) {
  return jsonpApi({
    action: "aiCoach",
    message,
    step: state.currentQuestion?.type || "",
    director: state.director || "",
    unit: state.unit || "",
  }, 4200);
}

function jsonpApi(params, timeout = 9000) {
  if (!googleReady()) return Promise.resolve({ ok: false });
  return new Promise((resolve, reject) => {
    const callback = `apsCoach_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(googleScriptUrl);
    url.searchParams.set("api", "1");
    url.searchParams.set("callback", callback);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value ?? ""));
    const script = document.createElement("script");
    const timer = setTimeout(() => cleanup(() => reject(new Error("Tempo esgotado."))), timeout);
    window[callback] = (payload) => cleanup(() => resolve(payload));
    script.onerror = () => cleanup(() => reject(new Error("Falha na IA.")));
    function cleanup(done) {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
      done();
    }
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  saveStatus.textContent = state.submittedAt ? "Salvo e enviado" : "Salvo neste navegador";
  clearTimeout(persist.timer);
  persist.timer = setTimeout(() => { saveStatus.textContent = state.submittedAt ? "Gestão ativa" : "Aguardando confirmação final"; }, 1200);
}

function googleReady() {
  return Boolean(googleScriptUrl && googleScriptUrl.includes("script.google.com"));
}

function scheduleCloudSync(reason) {
  if (!googleReady() || !state.submittedAt) return;
  clearTimeout(scheduleCloudSync.timer);
  scheduleCloudSync.timer = setTimeout(() => syncToCloud(reason), 1400);
}

async function syncToCloud(reason = "manual") {
  if (!googleReady()) {
    saveStatus.textContent = "Banco online não configurado";
    return;
  }
  if (!state.submittedAt) {
    saveStatus.textContent = "Aguardando confirmação final";
    return;
  }
  saveStatus.textContent = "Sincronizando...";
  const payload = buildCloudPayload(reason);
  try {
    await fetch(googleScriptUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "syncVagas", spreadsheetId, payload }) });
    state.lastCloudSync = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify(state));
    saveStatus.textContent = "Sincronizado ✓";
    if (reason === "completed-guide" || reason === "report-generated") {
      setTimeout(() => fetchAndShowReportLinks(true), 3500);
    }
  } catch {
    saveStatus.textContent = "Falha ao sincronizar";
  }
}

function clearMyData() {
  const name = state.director ? `, ${firstName()}` : "";
  if (!confirm(`Apagar todo o preenchimento${name}?\n\nOs dados já enviados ao painel administrativo permanecem salvos. Apenas o rascunho local será removido.`)) return;
  legacyStorageKeys.concat([storageKey, "aps-controle-vagas-legacy-backup"]).forEach((key) => localStorage.removeItem(key));
  location.reload();
}

async function fetchAndShowReportLinks(silent = false) {
  if (!googleReady() || !state.unit) {
    if (!silent) appendAssistant("Não foi possível localizar o relatório. Certifique-se de que o formulário foi enviado e sincronizado.");
    return;
  }
  if (!silent) appendAssistant("🔍 Buscando seu relatório no Google Drive...");
  const data = await jsonpGet({ action: "getLatestReport", unit: state.unit });
  if (!data || !data.ok || (!data.pdfUrl && !data.docUrl)) {
    if (!silent) appendAssistant("O relatório ainda está sendo gerado. Tente novamente em alguns segundos ou acesse o painel do gestor.");
    return;
  }
  state.latestReport = { pdfUrl: data.pdfUrl || "", docUrl: data.docUrl || "", fetchedAt: new Date().toISOString() };
  persist();
  appendAssistant(reportLinksCard(data));
  renderAnswer();
}

function reportLinksCard(links) {
  if (!links || (!links.pdfUrl && !links.docUrl)) return "";
  return `
    <div class="report-links-card">
      <span>📄 Relatório institucional</span>
      <h3>Pronto para download!</h3>
      <p>O relatório da sua unidade foi gerado automaticamente e está salvo no Google Drive da APS. Você pode baixar o PDF ou abrir o documento completo a qualquer momento.</p>
      <div class="report-links-actions">
        ${links.pdfUrl ? `<a class="report-link-btn pdf" href="${escapeAttr(links.pdfUrl)}" target="_blank" rel="noopener">📥 Baixar PDF</a>` : ""}
        ${links.docUrl ? `<a class="report-link-btn doc" href="${escapeAttr(links.docUrl)}" target="_blank" rel="noopener">📄 Abrir no Google Docs</a>` : ""}
      </div>
      <em>Gerado em ${links.createdAt ? new Date(links.createdAt).toLocaleString("pt-BR") : "agora"}</em>
    </div>`;
}

async function jsonpGet(params) {
  return new Promise((resolve) => {
    const cbName = "apsJsonp_" + Date.now();
    const script = document.createElement("script");
    const timeout = setTimeout(() => { delete window[cbName]; resolve(null); try { document.head.removeChild(script); } catch {} }, 12000);
    window[cbName] = (data) => {
      clearTimeout(timeout);
      delete window[cbName];
      try { document.head.removeChild(script); } catch {}
      resolve(data);
    };
    const qs = new URLSearchParams({ api: "1", callback: cbName, ...params });
    script.src = googleScriptUrl + "?" + qs;
    script.onerror = () => { clearTimeout(timeout); delete window[cbName]; resolve(null); };
    document.head.appendChild(script);
  });
}

function buildCloudPayload(reason) {
  const totals = getTotals();
  return { reason, syncedAt: new Date().toISOString(), submittedAt: state.submittedAt || "", unit: state.unit || "", director: state.director || "", weekId: state.weekId || currentWeek, weeklyDate: state.weeklyDate || "", hasHighSchool: state.answers.hasHighSchool ? "Sim" : "Não", blueprint: unitBlueprints[state.unit] || null, totals, rooms: state.rooms || [], history: state.history || [], movements: state.movements || [], reports: state.reports || [] };
}

function loadState() {
  const current = readStoredState(storageKey);

  // Archive legacy keys for safety, then remove them — never migrate forward
  const legacyStates = legacyStorageKeys
    .map((key) => ({ key, state: readStoredState(key) }))
    .filter((item) => item.state && Object.keys(item.state).length);
  if (legacyStates.length) {
    try {
      localStorage.setItem("aps-controle-vagas-legacy-backup", JSON.stringify({
        archivedAt: new Date().toISOString(),
        states: legacyStates,
      }));
    } catch {}
    legacyStates.forEach(({ key }) => localStorage.removeItem(key));
  }

  if (current && getStoredStateScore(current) > 0) return current;
  return {};
}

function readStoredState(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function getStoredStateScore(storedState) {
  const rooms = Array.isArray(storedState?.rooms) ? storedState.rooms : [];
  const reports = Array.isArray(storedState?.reports) ? storedState.reports : [];
  const movements = Array.isArray(storedState?.movements) ? storedState.movements : [];
  const totals = rooms.reduce((sum, room) => sum + Number(room.students || 0) + Number(room.capacity || 0), 0);
  return totals + (rooms.length * 10) + (reports.length * 500) + (movements.length * 200) + (storedState?.submittedAt ? 10000 : 0);
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

function startDailyUpdate() {
  if (!state.rooms.length) {
    appendAssistant("Ainda não há salas cadastradas para atualizar.");
    return;
  }
  state.updateFlow = { startedAt: new Date().toISOString() };
  state.currentQuestion = { type: "dailyRoom" };
  appendAssistant(`${firstName()}, qual sala teve entrada, saída ou ajuste de alunos hoje?`);
  renderAll();
  renderAnswer();
  persist();
}

function selectedUpdateRoom() {
  return state.rooms.find((room) => room.id === state.updateFlow?.roomId);
}

function applyDailyUpdate() {
  const flow = state.updateFlow || {};
  const room = selectedUpdateRoom();
  if (!room) {
    appendAssistant("Não encontrei essa sala. Vamos voltar ao painel concluído.");
    state.currentQuestion = { type: "done" };
    delete state.updateFlow;
    return;
  }
  const previousStudents = Number(room.students || 0);
  let newStudents = previousStudents;
  let movementType = flow.type;
  let amount = Math.max(0, Number(flow.amount || 0));

  if (flow.type === "Entrada") newStudents = previousStudents + amount;
  if (flow.type === "Saída") newStudents = Math.max(0, previousStudents - amount);
  if (flow.type === "Ajuste do total") {
    newStudents = amount;
    movementType = newStudents >= previousStudents ? "Entrada" : "Saída";
    amount = Math.abs(newStudents - previousStudents);
  }

  room.students = newStudents;
  room.updatedAt = new Date().toISOString();
  if (amount > 0) {
    recordMovement(room, {
      type: movementType,
      amount,
      previousStudents,
      newStudents,
      reason: movementType === "Saída" ? flow.reason || "Não informado" : "",
      source: "chat",
    });
  }
  const vacancies = Math.max(0, Number(room.capacity || 0) - Number(room.students || 0));
  appendAssistant(`${roomLabel(room)} atualizado: ${previousStudents} aluno(s) antes, ${newStudents} agora, ${vacancies} vaga(s) disponíveis.`);
  state.currentQuestion = { type: "done" };
  delete state.updateFlow;
  renderAll();
  renderAnswer();
  persist();
  if (state.submittedAt) syncToCloud("daily-movement");
}

function recordMovement(room, details) {
  state.movements.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    unit: state.unit || "",
    director: state.director || "",
    weekId: state.weekId || currentWeek,
    roomId: room.id || "",
    segment: room.segment || "",
    grade: room.grade || "",
    shift: room.shift || "",
    letter: room.letter || "",
    type: details.type,
    amount: Number(details.amount || 0),
    previousStudents: Number(details.previousStudents || 0),
    newStudents: Number(details.newStudents || 0),
    reason: details.reason || "",
    source: details.source || "chat",
  });
  state.movements = state.movements.slice(0, 300);
}

function generateManualReport() {
  const report = addReportSnapshot("manual-report");
  appendAssistant(reportCard(report));
  renderAll();
  renderAnswer();
  persist();
  if (state.submittedAt) syncToCloud("report-generated");
}

function addReportSnapshot(type) {
  const report = buildReportSnapshot(type);
  state.reports = [report, ...(state.reports || []).filter((item) => item.id !== report.id)].slice(0, 30);
  return report;
}

function buildReportSnapshot(type) {
  const totals = getTotals();
  const bySegment = groupTotals(state.rooms, "segment");
  const byShift = groupTotals(state.rooms, "shift");
  const exits = (state.movements || []).filter((movement) => movement.type === "Saída");
  const entries = (state.movements || []).filter((movement) => movement.type === "Entrada");
  const exitReasons = exits.reduce((acc, movement) => {
    const key = movement.reason || "Não informado";
    acc[key] = (acc[key] || 0) + Number(movement.amount || 0);
    return acc;
  }, {});
  const openRooms = [...state.rooms]
    .map((room) => ({ ...room, vacancies: Math.max(0, Number(room.capacity || 0) - Number(room.students || 0)) }))
    .sort((a, b) => b.vacancies - a.vacancies)
    .slice(0, 8);
  const criticalRooms = [...state.rooms]
    .map((room) => ({ ...room, vacancies: Math.max(0, Number(room.capacity || 0) - Number(room.students || 0)) }))
    .filter((room) => Number(room.capacity || 0) > 0 && room.vacancies <= 2)
    .sort((a, b) => a.vacancies - b.vacancies)
    .slice(0, 8);
  const segmentFocus = campaignSegmentFocus(state.rooms);
  return {
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    unit: state.unit || "",
    director: state.director || "",
    weekId: state.weekId || currentWeek,
    totals,
    occupancyRate: totals.capacity ? Math.round((totals.students / totals.capacity) * 100) : 0,
    bySegment,
    byShift,
    movements: { entries: sumMovement(entries), exits: sumMovement(exits), exitReasons },
    openRooms,
    criticalRooms,
    segmentFocus,
  };
}

function groupTotals(rooms, key) {
  return rooms.reduce((acc, room) => {
    const label = room[key] || "-";
    acc[label] ||= { rooms: 0, capacity: 0, students: 0, vacancies: 0 };
    acc[label].rooms += 1;
    acc[label].capacity += Number(room.capacity || 0);
    acc[label].students += Number(room.students || 0);
    acc[label].vacancies += Math.max(0, Number(room.capacity || 0) - Number(room.students || 0));
    return acc;
  }, {});
}

function sumMovement(movements) {
  return movements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
}

function campaignSegmentFocus(rooms) {
  const segments = Object.entries(groupTotals(rooms, "segment"))
    .map(([segment, data]) => ({ segment, ...data }))
    .filter((item) => item.vacancies > 0)
    .sort((a, b) => b.vacancies - a.vacancies);
  return segments[0] || null;
}

function reportCard(report) {
  const segmentRows = Object.entries(report.bySegment).map(([segment, data]) => `<li><strong>${escapeHtml(segment)}</strong><span>${data.vacancies} vagas · ${data.students}/${data.capacity} alunos</span></li>`).join("");
  const openRows = report.openRooms.map((room) => `<li><strong>${escapeHtml(roomLabel(room))}</strong><span>${room.vacancies} vagas</span></li>`).join("");
  const criticalRows = (report.criticalRooms || []).map((room) => `<li><strong>${escapeHtml(roomLabel(room))}</strong><span>${room.vacancies} vaga(s)</span></li>`).join("");
  const recommendation = report.segmentFocus
    ? `Priorize comunicação para ${escapeHtml(report.segmentFocus.segment)}, onde há ${report.segmentFocus.vacancies} vaga(s) abertas.`
    : "Não há foco de campanha com vaga aberta suficiente neste momento.";
  return `
    <div class="report-card">
      <span>Relatório gerado automaticamente</span>
      <h3>${escapeHtml(report.unit || "Unidade")}</h3>
      <p><strong>Resumo executivo:</strong> ${recommendation} Evite impulsionar turmas com 0 a 2 vagas, pois elas exigem acompanhamento individual e não campanha ampla.</p>
      <div class="report-kpis">
        <b>${report.totals.rooms}<small>salas</small></b>
        <b>${report.totals.students}<small>alunos</small></b>
        <b>${report.totals.vacancies}<small>vagas</small></b>
        <b>${report.occupancyRate}%<small>ocupação</small></b>
      </div>
      <ul>${segmentRows || "<li>Sem segmentos registrados.</li>"}</ul>
      <p>Maiores oportunidades: ${openRows ? "" : "nenhuma sala com vaga aberta no momento."}</p>
      ${openRows ? `<ul>${openRows}</ul>` : ""}
      <p>Turmas para proteger de campanha ampla: ${criticalRows ? "" : "nenhuma turma crítica registrada até agora."}</p>
      ${criticalRows ? `<ul>${criticalRows}</ul>` : ""}
      <em>O relatório foi enviado para sincronização e aparecerá no painel administrativo assim que o banco receber os dados.</em>
    </div>`;
}

function reviewChecklistCard(report) {
  return `
    <div class="review-card">
      <h3>Conferência antes do envio</h3>
      <p>Confira se unidade, diretor, salas, alunos e capacidades estão corretos. Nada foi enviado ao painel administrativo ainda.</p>
      <ul>
        <li><strong>Unidade</strong><span>${escapeHtml(report.unit || "-")}</span></li>
        <li><strong>Diretor</strong><span>${escapeHtml(report.director || "-")}</span></li>
        <li><strong>Salas mapeadas</strong><span>${report.totals.rooms}</span></li>
        <li><strong>Vagas disponíveis</strong><span>${report.totals.vacancies}</span></li>
      </ul>
      <em>Se precisar corrigir, escolha “Corrigir antes de enviar” e clique na turma desejada no painel lateral.</em>
    </div>`;
}

function confirmFinalSubmission() {
  state.submittedAt = new Date().toISOString();
  state.currentQuestion = { type: "done" };
  appendAssistant(`Obrigado, ${firstName()}. Recebi a confirmação e agora vou enviar o mapa de vagas para o painel administrativo.`);
  appendAssistant(directorTutorialCard());
  renderAll();
  renderAnswer();
  persist();
  syncToCloud("completed-guide");
}

function explainCorrectionMode() {
  appendAssistant("Perfeito. Use o painel lateral para clicar na turma que precisa de ajuste. Depois que corrigir, clique em “Confirmar e enviar”. O painel administrativo continuará sem receber nada até essa confirmação.");
  renderAll();
  renderAnswer();
}

function directorTutorialCard() {
  return `
    <div class="tutorial-card">
      <span>Guia rápido do gestor</span>
      <h3>Como usar a plataforma no dia a dia</h3>
      <ol>
        <li><strong>Primeiro acesso:</strong> preencha o mapa até o final e confirme o resumo.</li>
        <li><strong>Conta do gestor:</strong> acesse a página do gestor e solicite sua conta com nome, e-mail e unidade.</li>
        <li><strong>Atualização diária:</strong> após o envio, use “Atualizar alunos hoje” para registrar entrada, saída ou ajuste de total.</li>
        <li><strong>Saídas:</strong> sempre informe o motivo. Isso ajuda a APS a acompanhar evasão e agir com rapidez.</li>
        <li><strong>Relatórios:</strong> gere relatórios sempre que quiser uma leitura objetiva da unidade.</li>
      </ol>
      <a href="./admin.html" target="_blank" rel="noopener">Abrir página do gestor</a>
    </div>`;
}

function currentQuestionPrompt() {
  const q = state.currentQuestion || { type: "director" };
  if (q.type === "director") return "Olá! Vou montar o mapa de vagas com você, um passo por vez. Para começar, qual é o seu nome?";
  if (q.type === "unit") return `${firstName()}, confirme a unidade para continuarmos.`;
  if (q.type === "yesno" && q.key === "hasContraturno") return unitHasPresetContraturno(state.unit)
    ? `${firstName()}, o contraturno desta unidade já está confirmado no sistema. Vou seguir para a estrutura.`
    : `${firstName()}, esta unidade possui atendimento de contraturno para registrarmos neste levantamento?`;
  if (q.type === "yesno" && q.key === "hasHighSchool") return "A unidade possui Ensino Médio?";
  if (q.type === "blueprintConfirm") return "Este mapa geral está correto para começarmos a confirmar alunos e capacidade, sala por sala?";
  if (q.type === "roomCount" && state.pendingSegment) return `${firstName()}, ${currentRoomCountText()}`;
  if (q.type === "mixedStudents") return mixedStudentPrompt();
  if (q.type === "mixedConfirm") return mixedConfirmationText();
  if (q.type === "roomStudents" && (state.pendingSegment || state.prefillFlow)) return `Agora ${roomLabel(currentPendingRoom())}: quantos alunos essa turma tem hoje?`;
  if (q.type === "roomCapacity" && (state.pendingSegment || state.prefillFlow)) return `E qual é a capacidade máxima da sala ${roomLabel(currentPendingRoom())}?`;
  if (q.type === "review") return "Confira o resumo antes do envio final. Se estiver correto, confirme para enviar ao painel administrativo.";
  if (q.type === "done") return "Mapa confirmado. Você já pode atualizar entradas e saídas diariamente ou gerar novos relatórios.";
  if (q.type === "dailyRoom") return `${firstName()}, qual sala teve entrada, saída ou ajuste de alunos hoje?`;
  if (q.type === "dailyType") return "Você quer registrar entrada, saída ou ajuste do total?";
  if (q.type === "dailyQty") return "Informe a quantidade de alunos.";
  if (q.type === "dailyReason") return "Qual foi o motivo da saída?";
  return "Vamos continuar de onde paramos.";
}

function currentRoomCountText() {
  const pair = currentPendingPair();
  return `quantas turmas de ${pair.grade} funcionam no turno da ${shiftText(pair.shift)}? Se não tiver, responda 0.`;
}

function handleAnswer(q, value) {
  if (q.type === "dailyRoom") {
    const room = state.rooms.find((item) => item.id === value);
    state.updateFlow = { roomId: value, startedAt: new Date().toISOString() };
    appendAssistant(`Certo. Para ${roomLabel(room)}, você quer registrar entrada, saída ou ajuste do total?`);
    state.currentQuestion = { type: "dailyType" };
    return;
  }
  if (q.type === "dailyType") {
    state.updateFlow.type = value;
    const room = selectedUpdateRoom();
    const text = value === "Ajuste do total"
      ? `Qual é o total correto de alunos em ${roomLabel(room)} hoje?`
      : `Quantos alunos devemos registrar como ${value.toLowerCase()} em ${roomLabel(room)}?`;
    appendAssistant(text);
    state.currentQuestion = { type: "dailyQty" };
    return;
  }
  if (q.type === "dailyQty") {
    const amount = Math.max(0, Number(value || 0));
    state.updateFlow.amount = amount;
    const room = selectedUpdateRoom();
    const current = Number(room.students || 0);
    const willReduce = state.updateFlow.type === "Saída" || (state.updateFlow.type === "Ajuste do total" && amount < current);
    if (willReduce && amount > 0) {
      appendAssistant("Para acompanharmos a evasão com clareza, qual foi o motivo da saída?");
      state.currentQuestion = { type: "dailyReason" };
      return;
    }
    applyDailyUpdate();
    return;
  }
  if (q.type === "dailyReason") {
    state.updateFlow.reason = value;
    applyDailyUpdate();
    return;
  }
  if (q.type === "director") {
    const directorName = String(value || "").trim();
    const match = directorUnits.find((item) => normalizeName(item.director) === normalizeName(directorName));
    state.director = match ? match.director : directorName;
    if (match) state.unit = match.unit;
    appendAssistant(`${state.director}, combinado. Eu vou conduzir tudo turma por turma e deixar o saldo de vagas pronto no final. Confirme a unidade.`);
    state.currentQuestion = { type: "unit" };
    return;
  }
  if (q.type === "unit") {
    state.unit = value;
    state.weeklyDate = new Date().toISOString().slice(0, 10);
    state.weekId = currentWeek;
    const blueprint = getCurrentBlueprint();
    if (blueprint) appendAssistant(unitOverviewCard(blueprint));
    if (unitHasPresetContraturno(state.unit)) {
      appendAssistant(`${firstName()}, esta unidade já consta no sistema da Sistema de Secretaria como unidade com contraturno. Então não vou perguntar se oferece; mais adiante eu vou direto ao ponto para registrar os alunos do contraturno e calcular as vagas corretamente.`);
      advanceAfterContraturno(true);
      return;
    }
    appendAssistant(`${firstName()}, esta unidade não está marcada previamente com contraturno no sistema. Para montar o mapa completo, informe se há atendimento de contraturno para registrarmos neste levantamento.`);
    state.currentQuestion = { type: "yesno", key: "hasContraturno" };
    return;
  }
  if (q.type === "yesno" && q.key === "hasContraturno") {
    if (unitHasPresetContraturno(state.unit)) {
      appendAssistant(`${firstName()}, corrigindo aqui: esta unidade já consta com contraturno no sistema. Vou pular esta pergunta e seguir pela estrutura da unidade.`);
      advanceAfterContraturno(true);
      return;
    }
    advanceAfterContraturno(value === "Sim");
    return;
  }
  if (q.type === "blueprintConfirm") {
    if (value === "back") {
      appendAssistant(`Sem problema, ${firstName()}! Voltando para a seleção de unidade. ⬅️`);
      state.unit = "";
      state.answers = {};
      state.currentQuestion = { type: "unit" };
      renderAll();
      renderAnswer();
      return;
    }
    if (value.startsWith("confirm:")) {
      const adjustments = JSON.parse(value.slice(8));
      startBlueprintCollectionWithAdjustments(adjustments);
      return;
    }
    appendAssistant("Sem problema! Vamos ajustar a estrutura da unidade manualmente, turma por turma. 📋");
    state.rooms = [];
    state.answers.hasHighSchool = Boolean(getCurrentBlueprint()?.hasHighSchool);
    startNextSegment(0);
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
  if (q.type === "mixedStudents") {
    registerMixedStudentCount(value);
    return;
  }
  if (q.type === "mixedConfirm") {
    if (value === "Correto") {
      delete state.mixedStudentFlow;
      askRoomCapacity();
      return;
    }
    const room = currentPendingRoom();
    appendAssistant(`Sem problema, ${firstName()}. Vamos conferir novamente a composição da ${roomLabel(room)} para a campanha ficar precisa.`);
    startMixedStudentFlow(room, true);
    return;
  }
  if (q.type === "roomCapacity") {
    currentPendingRoom().capacity = Number(value || 0);
    currentPendingRoom().updatedAt = new Date().toISOString();
    if (state.prefillFlow) {
      state.rooms.push(currentPendingRoom());
      state.prefillFlow.roomIndex += 1;
      askNextPrefilledRoom();
      return;
    }
    state.pendingSegment.roomIndex += 1;
    if (state.pendingSegment.roomIndex < currentPendingPair().rooms.length) askRoomStudents();
    else advancePair();
  }
}

function getCurrentBlueprint() {
  return unitBlueprints[getCanonicalUnit(state.unit)] || unitBlueprints[state.unit] || null;
}

function advanceAfterContraturno(hasContraturno) {
  state.answers.hasContraturno = hasContraturno;
  const blueprint = getCurrentBlueprint();
  if (blueprint) {
    state.answers.hasHighSchool = Boolean(blueprint.hasHighSchool);
    appendAssistant(blueprintSummaryText(blueprint));
    state.currentQuestion = { type: "blueprintConfirm" };
    return;
  }
  appendAssistant("Agora só mais um filtro: a unidade possui Ensino Médio?");
  state.currentQuestion = { type: "yesno", key: "hasHighSchool" };
}

function blueprintSummaryText(blueprint) {
  if (!blueprint) return "Não encontrei uma estrutura vinculada a esta unidade. Vamos montar manualmente.";
  return `👆 <strong>${firstName()}, veja o mapa acima</strong> — são os dados da sua unidade registrados no <strong>Sistema de Secretaria</strong>.\n\n✅ <strong>Tudo certo?</strong> Clique em <strong>Confirmar estrutura</strong> — é rápido!\n\n✏️ <strong>Alguma informação diferente?</strong> Clique em <strong>Ajustar manualmente</strong> e eu te guio pelos ajustes, um passo de cada vez. <em>É mais simples do que parece! 😊</em>\n\n⬅️ Errou a unidade? Use o botão <strong>Voltar</strong>.`;
}

function unitOverviewCard(blueprint) {
  const segmentRows = blueprintSegmentSummary(blueprint);
  const shifts = blueprintShiftSummary(blueprint);
  const mixed = blueprint.mixedGroups || [];
  const details = directorUnits.find((item) => item.unit === blueprint.unit);
  const mixedList = mixed.length
    ? mixed.map((group) => {
        const grades = (group.grades || []).map(displayGrade).join(" + ");
        const shiftsText = (group.shifts || []).map(displayShift).join(" e ");
        const roomCount = (blueprint.grades || []).filter((g) => (group.grades || []).includes(g.grade) && Object.keys(g.shifts || {}).length).reduce((sum, g) => sum + Object.values(g.shifts || {}).reduce((s, c) => s + Number(c), 0), 0);
        return `<li><strong>⚠️ ${escapeHtml(grades)}</strong><span>${escapeHtml(shiftsText)}${roomCount ? " · " + roomCount + " sala(s)" : ""}</span></li>`;
      }).join("")
    : `<li><strong>Nenhuma turma mista</strong><span>identificada no Sistema de Secretaria</span></li>`;
  const segEmoji = { "Educação Infantil": "🍎", "Fundamental 1": "📚", "Fundamental 2": "📖", "Ensino Médio": "🎓" };
  const segmentCards = segmentRows.filter((row) => row.total > 0).map((row) => `
    <b>
      <span>${segEmoji[row.label] || ""} ${escapeHtml(row.label)}</span>
      <strong>${row.total}</strong><em>salas</em>
      <small>${escapeHtml(row.detail)}</small>
      ${row.grades.length ? `<ul class="seg-grades">${row.grades.map((g) => `<li>${escapeHtml(g.grade)}: <strong>${g.total}</strong></li>`).join("")}</ul>` : ""}
    </b>`).join("");
  return `
    <div class="unit-map-card">
      <span>📋 Mapa geral da unidade — Sistema de Secretaria</span>
      <h3>${escapeHtml(blueprint.unit)}</h3>
      <p>Olá, <strong>${escapeHtml(firstName())}</strong>! Esta unidade tem <strong>${blueprint.totalRooms} sala(s)</strong> previstas para validação. Diretor vinculado: <strong>${escapeHtml(details?.director || state.director || "-")}</strong>.</p>
      <div class="unit-map-kpis">
        ${segmentCards}
      </div>
      <div class="unit-map-split">
        <section>
          <em>🕐 Turnos previstos</em>
          <div class="unit-map-badges">
            ${shifts.map((item) => `<i><strong>${escapeHtml(item.shift)}:</strong> ${item.total} salas</i>`).join("")}
          </div>
        </section>
        <section>
          <em>🔀 Turmas multisseriadas/mistas</em>
          <ul>${mixedList}</ul>
        </section>
      </div>
    </div>`;
}

function blueprintSegmentSummary(blueprint) {
  const labels = ["Educação Infantil", "Fundamental 1", "Fundamental 2", "Ensino Médio"];
  const totals = Object.fromEntries(labels.map((label) => [label, { total: 0, shifts: new Map(), grades: [] }]));
  (blueprint?.grades || []).forEach((gradePlan) => {
    const segment = displaySegment(gradePlan.segment);
    if (!totals[segment]) totals[segment] = { total: 0, shifts: new Map(), grades: [] };
    let gradeTotal = 0;
    Object.entries(gradePlan.shifts || {}).forEach(([shift, count]) => {
      const amount = Number(count || 0);
      const label = displayShift(shift);
      totals[segment].total += amount;
      totals[segment].shifts.set(label, (totals[segment].shifts.get(label) || 0) + amount);
      gradeTotal += amount;
    });
    if (gradeTotal > 0) totals[segment].grades.push({ grade: displayGrade(gradePlan.grade), total: gradeTotal });
  });
  return labels.map((label) => {
    const data = totals[label] || { total: 0, shifts: new Map(), grades: [] };
    const detail = Array.from(data.shifts.entries()).map(([shift, total]) => `${shift}: ${total}`).join(" · ") || "não previsto";
    return { label, total: data.total, detail, grades: data.grades };
  });
}

function blueprintShiftSummary(blueprint) {
  const shifts = new Map();
  (blueprint?.grades || []).forEach((gradePlan) => {
    Object.entries(gradePlan.shifts || {}).forEach(([shift, count]) => {
      const label = displayShift(shift);
      shifts.set(label, (shifts.get(label) || 0) + Number(count || 0));
    });
  });
  return Array.from(shifts.entries()).map(([shift, total]) => ({ shift, total }));
}

function startBlueprintCollection() {
  startBlueprintCollectionWithAdjustments({});
}

function startBlueprintCollectionWithAdjustments(adjustments) {
  const blueprint = getCurrentBlueprint();
  if (!blueprint) {
    startNextSegment(0);
    return;
  }
  state.rooms = [];
  state.prefillFlow = {
    source: blueprint.unit,
    rooms: buildRoomsFromBlueprintAdjusted(blueprint, adjustments),
    roomIndex: 0,
  };
  const total = state.prefillFlow.rooms.length;
  appendAssistant(`✅ **Estrutura confirmada!** Vou seguir pelas **${total} turmas** previstas da unidade **${blueprint.unit}**, período por período.\n\nAssim que você informar os alunos e a capacidade de cada turma, o **Espelho de Salas** ao lado mostrará em tempo real as vagas disponíveis para a campanha. 🎯`);
  askNextPrefilledRoom();
}

function buildRoomsFromBlueprint(blueprint) {
  return buildRoomsFromBlueprintAdjusted(blueprint, {});
}

function buildRoomsFromBlueprintAdjusted(blueprint, adjustments) {
  const rooms = [];
  (blueprint.grades || []).forEach((gradePlan) => {
    Object.entries(gradePlan.shifts || {}).forEach(([rawShift, originalCount]) => {
      const shift = displayShift(rawShift);
      const grade = displayGrade(gradePlan.grade);
      const segment = displaySegment(gradePlan.segment);
      const key = shift + "||" + grade + "||" + segment;
      const count = adjustments[key] !== undefined ? Number(adjustments[key]) : Number(originalCount || 0);
      Array.from({ length: count }).forEach((_, index) => {
        rooms.push({
          id: crypto.randomUUID(),
          segment,
          grade,
          shift,
          letter: String.fromCharCode(65 + index),
          capacity: defaultCapacityForSegment(segment),
          students: 0,
          note: gradePlan.note || "",
          mixedWith: ((gradePlan.mixedWithByShift && gradePlan.mixedWithByShift[rawShift] && gradePlan.mixedWithByShift[rawShift].with) || []).map(displayGrade),
          mixedNote: (gradePlan.mixedWithByShift && gradePlan.mixedWithByShift[rawShift] && gradePlan.mixedWithByShift[rawShift].note) || "",
          updatedAt: new Date().toISOString(),
        });
      });
    });
  });
  return rooms;
}

function askNextPrefilledRoom() {
  const flow = state.prefillFlow;
  if (!flow || flow.roomIndex >= flow.rooms.length) {
    delete state.prefillFlow;
    if (state.answers.hasContraturno) {
      appendAssistant("Estrutura regular concluída. Agora vamos mapear o contraturno informado pela unidade.");
      const contraturnoIndex = segmentPlan.findIndex((segment) => segment.key === "contraturno");
      state.prefillContraturnoOnly = true;
      startNextSegment(contraturnoIndex);
      return;
    }
    finishGuide();
    return;
  }
  askRoomStudents();
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
  appendAssistant(`${firstName()}, ${currentRoomCountText()}`);
  state.currentQuestion = { type: "roomCount" };
}

function askRoomStudents() {
  const room = currentPendingRoom();
  if (room.mixedWith?.length) {
    startMixedStudentFlow(room);
    return;
  }
  appendAssistant(`Agora ${roomLabel(room)}: quantos alunos essa turma tem hoje? Esse número ajuda a campanha a direcionar divulgação somente para as turmas com vaga real.`);
  state.currentQuestion = { type: "roomStudents" };
}

function startMixedStudentFlow(room, reset = false) {
  const grades = [room.grade, ...(room.mixedWith || [])];
  state.mixedStudentFlow = {
    roomId: room.id,
    grades,
    index: 0,
    values: {},
  };
  if (!reset) {
    appendAssistant(`${firstName()}, esta é uma turma multisseriada/mista: ${roomLabel(room)} reúne ${grades.join(" + ")}. Vou separar os alunos por série para que a leitura de vagas fique justa e a próxima campanha seja direcionada com precisão.`);
  }
  askMixedStudentPart();
}

function askMixedStudentPart() {
  const flow = state.mixedStudentFlow;
  const room = currentPendingRoom();
  const grade = flow?.grades?.[flow.index] || room?.grade || "série";
  appendAssistant(mixedStudentPrompt());
  state.currentQuestion = { type: "mixedStudents" };
}

function mixedStudentPrompt() {
  const flow = state.mixedStudentFlow;
  const room = currentPendingRoom();
  const grade = flow?.grades?.[flow.index] || room?.grade || "série";
  return `${firstName()}, quantos alunos de ${grade} estudam na sala ${roomLabel(room)}?`;
}

function registerMixedStudentCount(value) {
  const flow = state.mixedStudentFlow;
  const room = currentPendingRoom();
  if (!flow || !room) {
    currentPendingRoom().students = Number(value || 0);
    askRoomCapacity();
    return;
  }
  const grade = flow.grades[flow.index];
  flow.values[grade] = Math.max(0, Number(value || 0));
  flow.index += 1;
  if (flow.index < flow.grades.length) {
    askMixedStudentPart();
    return;
  }
  room.mixedBreakdown = { ...flow.values };
  room.students = Object.values(flow.values).reduce((sum, amount) => sum + Number(amount || 0), 0);
  appendAssistant(mixedConfirmationText());
  state.currentQuestion = { type: "mixedConfirm" };
}

function mixedConfirmationText() {
  const flow = state.mixedStudentFlow;
  const room = currentPendingRoom();
  const values = flow?.values || room?.mixedBreakdown || {};
  const parts = Object.entries(values).map(([grade, amount]) => `${amount} de ${grade}`);
  const total = Object.values(values).reduce((sum, amount) => sum + Number(amount || 0), 0);
  if (!room || !parts.length) return "A composição da turma multisseriada está correta?";
  return `Então, na sala ${roomLabel(room)}, temos ${total} aluno(s) ao todo, sendo ${parts.join(" e ")}. Está correto?`;
}

function mixedBreakdownText(room) {
  return Object.entries(room.mixedBreakdown || {})
    .map(([grade, amount]) => `${amount} ${grade}`)
    .join(" + ");
}

function askRoomCapacity() {
  const room = currentPendingRoom();
  appendAssistant(`Ótimo. E qual é a capacidade máxima da sala ${roomLabel(room)}? Com isso eu calculo as vagas disponíveis e deixo claro onde a campanha de matrículas deve atuar primeiro.`);
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
    if (state.prefillContraturnoOnly && segment.key === "contraturno") {
      delete state.prefillContraturnoOnly;
      finishGuide();
      return;
    }
    startNextSegment(segmentIndex + 1);
  }
}

function currentPendingPair() {
  return state.pendingSegment.pairs[state.pendingSegment.pairIndex];
}

function currentPendingRoom() {
  if (state.prefillFlow) return state.prefillFlow.rooms[state.prefillFlow.roomIndex];
  return currentPendingPair().rooms[state.pendingSegment.roomIndex];
}

function finishGuide() {
  const totals = getTotals();
  const ending = state.answers.hasHighSchool ? "até o 3º ano do Ensino Médio" : "até o 9º ano";
  appendAssistant(`${firstName()}, mapa concluído ${ending}. Antes de enviar para o painel administrativo, confira o resumo abaixo com calma.`);
  const report = addReportSnapshot("final-guide");
  appendAssistant(`${reportCard(report)}${reviewChecklistCard(report)}`);
  state.currentQuestion = { type: "review" };
}

function calculateProgress() {
  if (state.currentQuestion.type === "review") return 98;
  if (state.currentQuestion.type === "done") return 100;
  if (state.prefillFlow) {
    const total = Math.max(1, state.prefillFlow.rooms.length);
    return Math.min(97, Math.round(28 + (state.prefillFlow.roomIndex / total) * 62));
  }
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
  if (String(state.currentQuestion.type || "").startsWith("daily")) return 100;
  const base = { director: 0, unit: 9, yesno: state.currentQuestion.key === "hasHighSchool" ? 22 : 14, blueprintConfirm: 25, roomCount: 34, roomStudents: 48, roomCapacity: 58 };
  return Math.min(99, base[state.currentQuestion.type] || 10);
}

function missionLabel() {
  const q = state.currentQuestion;
  if (q.type === "director") return { title: "Identificar diretor", hint: "Comece pelo nome de quem está respondendo." };
  if (q.type === "unit") return { title: "Confirmar unidade", hint: "A unidade será vinculada ao diretor." };
  if (q.type === "yesno" && q.key === "hasContraturno") return { title: "Contraturno", hint: "Isso define se o bloco extra entra no roteiro." };
  if (q.type === "yesno" && q.key === "hasHighSchool") return { title: "Ensino Médio", hint: "Se não tiver, a coleta termina no 9º ano." };
  if (q.type === "blueprintConfirm") return { title: "Confirmar estrutura", hint: "Use a base da Sistema de Secretaria por unidade." };
  if (q.type === "roomCount") return { title: "Quantas turmas?", hint: "Informe a quantidade desta série neste turno." };
  if (q.type === "mixedStudents") return { title: "Composição da sala", hint: "Separe os alunos por série da turma mista." };
  if (q.type === "mixedConfirm") return { title: "Confirmar composição", hint: "Valide o total antes da capacidade." };
  if (q.type === "roomStudents") return { title: "Alunos da turma", hint: "Agora entra o número real de alunos." };
  if (q.type === "roomCapacity") return { title: "Capacidade máxima", hint: "Com isso calculamos as vagas disponíveis." };
  if (q.type === "review") return { title: "Conferir resumo", hint: "Nada será enviado antes da sua confirmação." };
  if (q.type === "dailyRoom") return { title: "Atualização diária", hint: "Escolha a sala que teve movimento." };
  if (q.type === "dailyType") return { title: "Entrada ou saída", hint: "Registre o tipo de movimentação." };
  if (q.type === "dailyQty") return { title: "Quantidade", hint: "Informe o número de alunos movimentados." };
  if (q.type === "dailyReason") return { title: "Motivo da saída", hint: "Esse dado orienta ações contra evasão." };
  return { title: "Mapa concluído", hint: "Os dados podem ser sincronizados." };
}

function segmentIntro(segment) {
  if (segment.key === "infantil") return "Educação Infantil é obrigatória no mapa. Vou passar por Maternal, Pré I e Pré II, manhã e tarde, uma turma por vez.";
  if (segment.key === "contraturno") return unitHasPresetContraturno(state.unit)
    ? "Agora entra o contraturno, que já consta para esta unidade. Vou registrar os alunos por bloco e turno para mostrar as vagas reais da campanha."
    : "Agora entra o contraturno informado pela unidade. Vou mapear por bloco e turno; onde não houver turma, responda 0.";
  if (segment.key === "fund1") return "Vamos para o Fundamental 1. Vou seguir do 1º ao 5º ano, manhã e tarde.";
  if (segment.key === "fund2") return "Agora Fundamental 2. Vou seguir do 6º ao 9º ano, manhã e tarde.";
  return "Como a unidade possui Ensino Médio, vamos até o 3º ano EM, manhã e tarde.";
}

function firstName() {
  return state.director ? state.director.split(" ")[0] : "Diretor";
}

function displayShift(value) {
  return String(value || "").replace("Manha", "Manhã");
}

function displayGrade(value) {
  return String(value || "")
    .replace("Pre I", "Pré I")
    .replace("Pre II", "Pré II")
    .replace(/(\d+)o Ano EM/g, "$1º Ano EM")
    .replace(/(\d+)o Ano/g, "$1º Ano");
}

function displaySegment(value) {
  return String(value || "")
    .replace("Educacao Infantil", "Educação Infantil")
    .replace("Ensino Medio", "Ensino Médio");
}

function mixedGroupsText(blueprint) {
  const groups = blueprint?.mixedGroups || [];
  if (!groups.length) return "";
  return groups
    .map((group) => {
      const grades = (group.grades || []).map(displayGrade).join(" + ");
      const shifts = (group.shifts || []).map(displayShift).join(" e ");
      return `${grades}${shifts ? ` (${shifts})` : ""}`;
    })
    .slice(0, 4)
    .join("; ");
}

function defaultCapacityForSegment(segment) {
  const plan = segmentPlan.find((item) => item.name === segment);
  return plan?.capacity || 30;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function unitHasPresetContraturno(unit) {
  return getUnitRule(unit).hasContraturno;
}

function getUnitRule(unit) {
  const normalized = normalizeName(unit);
  const rawKey = Object.keys(unitRuleOverrides).find((key) => normalizeName(key) === normalized);
  const override = rawKey ? unitRuleOverrides[rawKey] : {};
  const canonical = override.aliasOf || unit || "";
  const blueprint = unitBlueprints[canonical] || unitBlueprints[unit] || null;
  return {
    unit: canonical || unit || "",
    hasContraturno: Boolean(override.hasContraturno || presetContraturnoUnits.has(normalized)),
    hasHighSchool: Boolean(blueprint?.hasHighSchool),
    expectedRooms: Number(blueprint?.totalRooms || 0),
    mixedGroups: blueprint?.mixedGroups || [],
    blueprint,
  };
}

function getCanonicalUnit(unit) {
  return getUnitRule(unit).unit || unit;
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


