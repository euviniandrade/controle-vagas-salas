const DEFAULT_SPREADSHEET_ID = "1uEWisJkkBssaPGmVqImE9vx-_fSitPuD91c8wup9L1Y";

const ADMIN_EMAIL = "engenhariatotal.vinicius@gmail.com";
const ADMIN_PASSWORD = "APS@2026";
const GEMINI_MODEL = "gemini-2.5-flash";

const HEADERS = {
  Unidades: ["Atualizado em", "Unidade", "Diretor", "Semana", "Tem Ensino Medio", "Total de salas", "Capacidade total", "Alunos atuais", "Vagas disponiveis", "Payload JSON"],
  Salas: ["Atualizado em", "Unidade", "Diretor", "Semana", "Segmento", "Serie", "Turno", "Sala", "Capacidade", "Alunos", "Vagas", "ID da sala", "Tem Ensino Medio", "Payload JSON"],
  HistoricoSemanal: ["Registrado em", "Semana", "Unidade", "Diretor", "Total de salas", "Capacidade total", "Alunos atuais", "Vagas disponiveis", "Historico ID", "Payload JSON"],
  SalasPrevistas: ["Atualizado em", "Unidade", "Serie", "Segmento", "Turno", "Quantidade prevista", "Tem Ensino Medio", "Observacao", "Origem", "Payload JSON"],
  Movimentacoes: ["Registrado em", "Tipo", "Unidade", "Diretor", "Semana", "ID da sala", "Segmento", "Serie", "Turno", "Sala", "Quantidade", "Alunos antes", "Alunos depois", "Motivo", "Origem", "Payload JSON"],
  Evasao: ["Registrado em", "Unidade", "Diretor", "Semana", "Serie", "Turno", "Sala", "Quantidade", "Motivo", "Comparativo semana", "Comparativo mes", "Comparativo ano", "Payload JSON"],
  PesquisasPais: ["Recebido em", "Unidade", "Responsavel", "Aluno", "Turma", "Pergunta", "Resposta", "Canal", "Payload JSON"],
  Relatorios: ["Criado em", "Unidade", "Diretor", "Semana", "Relatorio ID", "Tipo", "Total de salas", "Capacidade total", "Alunos atuais", "Vagas disponiveis", "Ocupacao %", "Entradas", "Saidas", "Doc URL", "PDF URL", "Resumo JSON"],
  Eventos: ["Recebido em", "Tipo", "Unidade", "Diretor", "Semana", "Total de salas", "Vagas", "Payload JSON"],
  Usuarios: ["Criado em", "Nome", "Email", "Unidade", "Status", "Perfil", "Atualizado em"],
};

function doGet(event) {
  if (!event || !event.parameter || event.parameter.api !== "1") {
    const template = HtmlService.createTemplateFromFile("Index");
    template.scriptUrl = ScriptApp.getService().getUrl();
    template.spreadsheetId = DEFAULT_SPREADSHEET_ID;
    return template
      .evaluate()
      .setTitle("Controle de Vagas por Sala - APS")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return jsonp(routeApi(event.parameter || {}), event.parameter.callback);
}

function routeApi(params) {
  try {
    const action = params.action || "health";
    if (action === "health") return { ok: true, app: "controle-vagas-salas", time: new Date().toISOString() };
    if (action === "adminLogin") return adminLogin(params);
    if (action === "adminDashboard") return adminDashboard(params);
    if (action === "requestAccess") return requestAccess(params);
    if (action === "forgotPassword") return forgotPassword(params);
    if (action === "aiCoach") return aiCoach(params);
    if (action === "getLatestReport") return getLatestReport(params);
    return { ok: false, error: "Acao nao reconhecida." };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function aiCoach(params) {
  const baseText = String(params.message || "").trim();
  if (!baseText || baseText.length > 800) return { ok: false, error: "Mensagem invalida." };
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) return { ok: false, error: "Gemini nao configurado." };

  const prompt = [
    "Reescreva a mensagem abaixo para um diretor escolar brasileiro.",
    "Mantenha exatamente a mesma intenção, os mesmos nomes de turma, turno, unidade e números.",
    "Não invente dados, não acrescente perguntas extras e não mude a regra do formulário.",
    "Use português do Brasil, tom institucional, claro, acolhedor e objetivo.",
    "Responda apenas com a mensagem final, sem aspas e sem markdown.",
    "",
    "Contexto:",
    "Etapa: " + String(params.step || ""),
    "Diretor: " + String(params.director || ""),
    "Unidade: " + String(params.unit || ""),
    "",
    "Mensagem:",
    baseText,
  ].join("\n");

  const response = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent", {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 160 },
    }),
  });
  const code = response.getResponseCode();
  const body = JSON.parse(response.getContentText() || "{}");
  if (code < 200 || code >= 300) return { ok: false, error: body.error && body.error.message || "Falha no Gemini." };
  const text = body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts && body.candidates[0].content.parts[0] && body.candidates[0].content.parts[0].text;
  if (!text) return { ok: false, error: "Gemini sem resposta." };
  return { ok: true, text: String(text).trim().slice(0, 700) };
}

function adminLogin(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const password = String(params.password || "");
  if (email !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD) {
    return { ok: false, error: "Email ou senha invalidos." };
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("admin:" + token, email, 21600);
  return { ok: true, token: token, email: email };
}

function forgotPassword(params) {
  const email = String(params.email || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Informe o email." };
  const ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  ensureSheets(ss);
  appendRows(ss.getSheetByName("Eventos"), [[
    new Date(),
    "forgot-password",
    "",
    email,
    "",
    0,
    0,
    safeJson({ email: email, requestedAt: new Date().toISOString() }),
  ]]);

  if (email === ADMIN_EMAIL.toLowerCase()) {
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: "Recuperacao de senha - Controle de Vagas APS",
      body: [
        "Solicitacao de recuperacao recebida.",
        "",
        "Email: " + ADMIN_EMAIL,
        "Senha administrativa atual: " + ADMIN_PASSWORD,
        "",
        "Se voce nao solicitou isso, revise o acesso ao Apps Script.",
      ].join("\n"),
    });
  } else {
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: "Solicitacao de recuperacao de acesso - Controle de Vagas APS",
      body: "O email " + email + " solicitou recuperacao de acesso ao painel.",
    });
  }
  return { ok: true };
}

function requireAdmin(token) {
  const email = CacheService.getScriptCache().get("admin:" + String(token || ""));
  if (!email) throw new Error("Sessao expirada. Faca login novamente.");
  return email;
}

function adminDashboard(params) {
  requireAdmin(params.token);
  const ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  ensureSheets(ss);
  return {
    ok: true,
    data: {
      units: getUnits(ss.getSheetByName("Unidades")),
      rooms: getRooms(ss.getSheetByName("Salas")),
      users: getUsers(ss.getSheetByName("Usuarios")),
      reports: getReports(ss.getSheetByName("Relatorios")),
      movements: getMovements(ss.getSheetByName("Movimentacoes")),
      evasion: getEvasion(ss.getSheetByName("Evasao")),
    },
  };
}

function getLatestReport(params) {
  const unit = String(params.unit || "").trim();
  if (!unit) return { ok: false, error: "Informe a unidade." };
  const ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  ensureSheets(ss);
  const rows = readRows(ss.getSheetByName("Relatorios"));
  const unitRows = rows.filter(function(row) {
    return String(row[1] || "") === unit && (row[13] || row[14]);
  });
  if (!unitRows.length) return { ok: true, pdfUrl: "", docUrl: "", unit: unit };
  unitRows.sort(function(a, b) { return new Date(b[0]) - new Date(a[0]); });
  var latest = unitRows[0];
  return { ok: true, unit: unit, docUrl: latest[13] || "", pdfUrl: latest[14] || "", createdAt: valueToString(latest[0]) };
}

function requestAccess(params) {
  const name = String(params.name || "").trim();
  const email = String(params.email || "").trim().toLowerCase();
  const unit = String(params.unit || "").trim();
  if (!name || !email || !unit) return { ok: false, error: "Informe nome, email e unidade." };
  const ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  ensureSheets(ss);
  const sheet = ss.getSheetByName("Usuarios");
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][2] || "").toLowerCase() === email) {
      sheet.getRange(index + 1, 1, 1, 7).setValues([[values[index][0] || new Date(), name, email, unit, values[index][4] || "Pendente", values[index][5] || "Diretor", new Date()]]);
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow([new Date(), name, email, unit, "Pendente", "Diretor", new Date()]);
  return { ok: true, created: true };
}

function syncVagas(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
    ensureSheets(ss);
    syncPayload(ss, payload || {});
    return { ok: true, syncedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  } finally {
    lock.releaseLock();
  }
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = parseBody(event);
    const spreadsheetId = body.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    const payload = body.payload || {};
    const ss = SpreadsheetApp.openById(spreadsheetId);
    ensureSheets(ss);
    syncPayload(ss, payload);
    return json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function parseBody(event) {
  const raw = event && event.postData && event.postData.contents ? event.postData.contents : "{}";
  return JSON.parse(raw);
}

function ensureSheets(ss) {
  Object.keys(HEADERS).forEach((name) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = HEADERS[name];
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const needsHeader = headers.some((header, index) => current[index] !== header);
    if (needsHeader) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground("#0d4e63")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  });
}

function syncPayload(ss, payload) {
  if (!payload || !payload.submittedAt) return;
  const unit = payload.unit || "";
  const director = payload.director || "";
  const totals = payload.totals || {};
  const receivedAt = new Date();
  const snapshotJson = safeJson(payload);

  upsertUnit(ss.getSheetByName("Unidades"), [
    receivedAt,
    unit,
    director,
    payload.weekId || "",
    payload.hasHighSchool || "",
    totals.rooms || 0,
    totals.capacity || 0,
    totals.students || 0,
    totals.vacancies || 0,
    snapshotJson,
  ]);

  replaceRowsForUnit(ss.getSheetByName("Salas"), unit, 2, (payload.rooms || []).map((room) => [
    room.updatedAt ? new Date(room.updatedAt) : receivedAt,
    unit,
    director,
    payload.weekId || "",
    room.segment || "",
    room.grade || "",
    room.shift || "",
    room.letter || "",
    Number(room.capacity || 0),
    Number(room.students || 0),
    Math.max(0, Number(room.capacity || 0) - Number(room.students || 0)),
    room.id || "",
    payload.hasHighSchool || "",
    safeJson(room),
  ]));

  replaceRowsForUnit(ss.getSheetByName("SalasPrevistas"), unit, 2, blueprintRows(payload, receivedAt));

  replaceRowsForUnit(ss.getSheetByName("HistoricoSemanal"), unit, 3, (payload.history || []).map((item) => [
    item.createdAt ? new Date(item.createdAt) : receivedAt,
    item.weekId || "",
    item.unit || unit,
    item.director || director,
    item.totals && item.totals.rooms || 0,
    item.totals && item.totals.capacity || 0,
    item.totals && item.totals.students || 0,
    item.totals && item.totals.vacancies || 0,
    item.id || "",
    safeJson(item),
  ]));

  replaceRowsForUnit(ss.getSheetByName("Movimentacoes"), unit, 3, (payload.movements || []).map((movement) => [
    movement.createdAt ? new Date(movement.createdAt) : receivedAt,
    movement.type || "",
    unit,
    director,
    movement.weekId || payload.weekId || "",
    movement.roomId || "",
    movement.segment || "",
    movement.grade || "",
    movement.shift || "",
    movement.letter || "",
    Number(movement.amount || 0),
    Number(movement.previousStudents || 0),
    Number(movement.newStudents || 0),
    movement.reason || "",
    movement.source || "",
    safeJson(movement),
  ]));

  replaceRowsForUnit(ss.getSheetByName("Evasao"), unit, 2, (payload.movements || [])
    .filter((movement) => isExitMovement(movement))
    .map((movement) => [
      movement.createdAt ? new Date(movement.createdAt) : receivedAt,
      unit,
      director,
      movement.weekId || payload.weekId || "",
      movement.grade || "",
      movement.shift || "",
      movement.letter || "",
      Number(movement.amount || 0),
      movement.reason || "Nao informado",
      movement.weekId || payload.weekId || "",
      Utilities.formatDate(movement.createdAt ? new Date(movement.createdAt) : receivedAt, Session.getScriptTimeZone(), "yyyy-MM"),
      Utilities.formatDate(movement.createdAt ? new Date(movement.createdAt) : receivedAt, Session.getScriptTimeZone(), "yyyy"),
      safeJson(movement),
    ]));

  replaceReportRowsForUnit(ss, payload, receivedAt);

  appendRows(ss.getSheetByName("Eventos"), [[
    receivedAt,
    payload.reason || "sync",
    unit,
    director,
    payload.weekId || "",
    totals.rooms || 0,
    totals.vacancies || 0,
    snapshotJson,
  ]]);
}

function blueprintRows(payload, receivedAt) {
  const blueprint = payload.blueprint || {};
  const unit = payload.unit || blueprint.unit || "";
  if (!blueprint.grades || !blueprint.grades.length) return [];
  const rows = [];
  blueprint.grades.forEach((item) => {
    Object.keys(item.shifts || {}).forEach((shift) => {
      rows.push([
        receivedAt,
        unit,
        item.grade || "",
        item.segment || "",
        shift || "",
        Number(item.shifts[shift] || 0),
        blueprint.hasHighSchool ? "Sim" : "Nao",
        item.note || "",
        "Sistema de Secretaria da Educação",
        safeJson(item),
      ]);
    });
  });
  return rows;
}

function isExitMovement(movement) {
  return normalizeText(movement && movement.type) === "saida";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function replaceReportRowsForUnit(ss, payload, receivedAt) {
  const reports = payload.reports || [];
  const sheet = ss.getSheetByName("Relatorios");
  const existing = getReportLinkMap(sheet);
  const rows = reports.map((report) => {
    const totals = report.totals || {};
    let links = existing[report.id] || {};
    if (!links.docUrl && report.id) {
      links = createDriveReport(payload, report);
    }
    return [
      report.createdAt ? new Date(report.createdAt) : receivedAt,
      report.unit || payload.unit || "",
      report.director || payload.director || "",
      report.weekId || payload.weekId || "",
      report.id || "",
      report.type || "",
      totals.rooms || 0,
      totals.capacity || 0,
      totals.students || 0,
      totals.vacancies || 0,
      report.occupancyRate || 0,
      report.movements && report.movements.entries || 0,
      report.movements && report.movements.exits || 0,
      links.docUrl || "",
      links.pdfUrl || "",
      safeJson(report),
    ];
  });
  replaceRowsForUnit(sheet, payload.unit || "", 2, rows);
}

function getReportLinkMap(sheet) {
  const map = {};
  const values = readRows(sheet);
  values.forEach((row) => {
    if (row[4]) map[row[4]] = { docUrl: row[13] || "", pdfUrl: row[14] || "" };
  });
  return map;
}

function createDriveReport(payload, report) {
  const folder = getOrCreateFolder("Controle de Vagas por Sala - Relatorios");
  const totals = report.totals || {};
  const name = ["Relatorio de Vagas", report.unit || payload.unit || "Unidade", report.weekId || payload.weekId || "", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmm")].join(" - ");
  const doc = DocumentApp.create(name);
  const body = doc.getBody();
  body.appendParagraph("Controle de Vagas por Sala").setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph((report.unit || payload.unit || "") + " | Diretor: " + (report.director || payload.director || "")).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph("Gerado em " + Utilities.formatDate(new Date(report.createdAt || new Date()), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
  body.appendParagraph("Resumo executivo").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const focus = report.segmentFocus || {};
  if (focus.segment) {
    body.appendParagraph("Recomendacao de campanha: priorizar " + focus.segment + ", com " + String(focus.vacancies || 0) + " vaga(s) abertas. Evitar campanha ampla para turmas com 0 a 2 vagas.");
  } else {
    body.appendParagraph("Recomendacao de campanha: aguardar novas vagas abertas antes de acionar campanha ampla.");
  }
  body.appendTable([
    ["Salas", "Capacidade", "Alunos", "Vagas", "Ocupacao"],
    [String(totals.rooms || 0), String(totals.capacity || 0), String(totals.students || 0), String(totals.vacancies || 0), String(report.occupancyRate || 0) + "%"],
  ]);
  appendObjectTable(body, "Vagas por segmento", report.bySegment || {});
  appendObjectTable(body, "Vagas por turno", report.byShift || {});
  appendOpenRooms(body, report.openRooms || []);
  appendCriticalRooms(body, report.criticalRooms || []);
  appendExitReasons(body, report.movements && report.movements.exitReasons || {});
  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (error) {}
  const pdf = folder.createFile(file.getBlob().getAs(MimeType.PDF).setName(name + ".pdf"));
  return { docUrl: file.getUrl(), pdfUrl: pdf.getUrl() };
}

function appendObjectTable(body, title, data) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [["Bloco", "Salas", "Capacidade", "Alunos", "Vagas"]];
  Object.keys(data).forEach((key) => {
    const item = data[key] || {};
    rows.push([key, String(item.rooms || 0), String(item.capacity || 0), String(item.students || 0), String(item.vacancies || 0)]);
  });
  if (rows.length === 1) rows.push(["Sem dados", "0", "0", "0", "0"]);
  body.appendTable(rows);
}

function appendOpenRooms(body, rooms) {
  body.appendParagraph("Maiores oportunidades por sala").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [["Turma", "Segmento", "Alunos", "Capacidade", "Vagas"]];
  rooms.forEach((room) => rows.push([
    [room.grade || "", room.shift || "", room.letter || ""].filter(Boolean).join(" - "),
    room.segment || "",
    String(room.students || 0),
    String(room.capacity || 0),
    String(room.vacancies || 0),
  ]));
  if (rows.length === 1) rows.push(["Sem vagas abertas", "-", "0", "0", "0"]);
  body.appendTable(rows);
}

function appendCriticalRooms(body, rooms) {
  body.appendParagraph("Turmas para proteger de campanha ampla").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [["Turma", "Segmento", "Alunos", "Capacidade", "Vagas"]];
  rooms.forEach((room) => rows.push([
    [room.grade || "", room.shift || "", room.letter || ""].filter(Boolean).join(" - "),
    room.segment || "",
    String(room.students || 0),
    String(room.capacity || 0),
    String(room.vacancies || 0),
  ]));
  if (rows.length === 1) rows.push(["Sem turma critica", "-", "0", "0", "0"]);
  body.appendTable(rows);
}

function appendExitReasons(body, reasons) {
  body.appendParagraph("Motivos de saida").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [["Motivo", "Quantidade"]];
  Object.keys(reasons).forEach((reason) => rows.push([reason, String(reasons[reason] || 0)]));
  if (rows.length === 1) rows.push(["Sem saidas registradas", "0"]);
  body.appendTable(rows);
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function getUnits(sheet) {
  return readRows(sheet).map((row) => ({
    updatedAt: valueToString(row[0]),
    unit: row[1] || "",
    director: row[2] || "",
    week: row[3] || "",
    hasHighSchool: row[4] || "",
    totalRooms: row[5] || 0,
    capacity: row[6] || 0,
    students: row[7] || 0,
    vacancies: row[8] || 0,
  }));
}

function getRooms(sheet) {
  return readRows(sheet).map((row) => ({
    updatedAt: valueToString(row[0]),
    unit: row[1] || "",
    director: row[2] || "",
    week: row[3] || "",
    segment: row[4] || "",
    grade: row[5] || "",
    shift: row[6] || "",
    letter: row[7] || "",
    capacity: row[8] || 0,
    students: row[9] || 0,
    vacancies: row[10] || 0,
    id: row[11] || "",
  }));
}

function getReports(sheet) {
  return readRows(sheet).map((row) => ({
    createdAt: valueToString(row[0]),
    unit: row[1] || "",
    director: row[2] || "",
    week: row[3] || "",
    id: row[4] || "",
    type: row[5] || "",
    totalRooms: row[6] || 0,
    capacity: row[7] || 0,
    students: row[8] || 0,
    vacancies: row[9] || 0,
    occupancyRate: row[10] || 0,
    entries: row[11] || 0,
    exits: row[12] || 0,
    docUrl: row[13] || "",
    pdfUrl: row[14] || "",
  })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getMovements(sheet) {
  return readRows(sheet).map((row) => ({
    createdAt: valueToString(row[0]),
    type: row[1] || "",
    unit: row[2] || "",
    director: row[3] || "",
    week: row[4] || "",
    roomId: row[5] || "",
    segment: row[6] || "",
    grade: row[7] || "",
    shift: row[8] || "",
    letter: row[9] || "",
    amount: row[10] || 0,
    previousStudents: row[11] || 0,
    newStudents: row[12] || 0,
    reason: row[13] || "",
    source: row[14] || "",
  })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getEvasion(sheet) {
  return readRows(sheet).map((row) => ({
    createdAt: valueToString(row[0]),
    unit: row[1] || "",
    director: row[2] || "",
    week: row[3] || "",
    grade: row[4] || "",
    shift: row[5] || "",
    letter: row[6] || "",
    amount: row[7] || 0,
    reason: row[8] || "",
    weekKey: row[9] || "",
    monthKey: row[10] || "",
    yearKey: row[11] || "",
  })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getUsers(sheet) {
  return readRows(sheet).map((row) => ({
    createdAt: valueToString(row[0]),
    name: row[1] || "",
    email: row[2] || "",
    unit: row[3] || "",
    status: row[4] || "",
    role: row[5] || "",
    updatedAt: valueToString(row[6]),
  }));
}

function readRows(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= 1 || lastColumn < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
}

function upsertUnit(sheet, row) {
  const unit = row[1];
  const values = sheet.getDataRange().getValues();
  let targetRow = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index][1] === unit) {
      targetRow = index + 1;
      break;
    }
  }
  if (!targetRow) targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  sheet.autoResizeColumns(1, row.length);
}

function replaceRowsForUnit(sheet, unit, unitColumn, rows) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), unitColumn)).getValues();
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (values[index][unitColumn - 1] === unit) sheet.deleteRow(index + 2);
    }
  }
  appendRows(sheet, rows);
}

function appendRows(sheet, rows) {
  if (!rows || !rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.autoResizeColumns(1, rows[0].length);
}

function safeJson(value) {
  return JSON.stringify(value || {}).slice(0, 45000);
}

function valueToString(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") return value.toISOString();
  return String(value || "");
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp(payload, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(String(callback).replace(/[^\w$]/g, "") + "(" + JSON.stringify(payload) + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json(payload);
}
