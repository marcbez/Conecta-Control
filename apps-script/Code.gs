/**
 * Conecta Control — fonte central da homologação das 54 atividades do Anexo III.
 *
 * Cada marcação vira uma linha na aba "homologacoes", com o usuário
 * autenticado e a data do servidor. O estado de uma atividade é a última
 * linha registrada para o seu ID. O progresso é calculado aqui, com os pesos
 * do Anexo III, e não no navegador.
 *
 * Toda chamada é um POST com corpo JSON (text/plain) e exige usuário e token.
 * Implantação e cadastro de acessos: apps-script/README.md.
 */

const ABA_EVENTOS = 'homologacoes';
const CABECALHO = ['timestamp', 'usuario', 'nome', 'atividade', 'acao', 'progresso_pct', 'concluidas', 'observacao'];
const LIMITE_HISTORICO = 200;
const LIMITE_LEGADO = 90;

// Pesos do Anexo III, em % do contrato. Somam 100.
const PESOS = {
  'M1-01': 3, 'M1-02': 3, 'M1-03': 3, 'M1-04': 2, 'M1-05': 2, 'M1-06': 2,
  'M2-01': 2, 'M2-02': 2, 'M2-03': 1, 'M2-04': 3, 'M2-05': 1, 'M2-06': 3,
  'M2-07': 3, 'M3-01': 5, 'M3-02': 3, 'M3-03': 3, 'M3-04': 4, 'M4-01': 2,
  'M4-02': 3, 'M4-03': 2, 'M4-04': 2, 'M4-05': 2, 'M4-06': 2, 'M4-07': 2,
  'M5-01': 2, 'M5-02': 0.8, 'M5-03': 1, 'M5-04': 1, 'M5-05': 0.5, 'M5-06': 0.4,
  'M5-07': 0.3, 'M5-08': 2, 'M5-09': 1, 'M5-10': 1, 'M5-11': 2, 'M5-12': 1,
  'M5-13': 1, 'M5-14': 1, 'M5-15': 1, 'M5-16': 1.5, 'M5-17': 1, 'M5-18': 1.5,
  'M6-01': 3, 'M6-02': 3, 'M6-03': 2, 'M6-04': 2, 'M7-01': 1.5, 'M7-02': 1.5,
  'M7-03': 1.5, 'M7-04': 1, 'M7-05': 0.5, 'M7-06': 1.5, 'M7-07': 1, 'M7-08': 1.5
};

// ---------------------------------------------------------------- API web

function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return respond_({ ok: false, error: 'Pedido inválido.' });
  }
  try {
    const user = authenticate_(request.user, request.token);
    if (!user) return respond_({ ok: false, code: 'auth', error: 'Usuário ou token inválido.' });
    switch (request.action) {
      case 'whoami':
        return respond_({ ok: true, user: publicUser_(user) });
      case 'state':
        return respond_(Object.assign({ ok: true, user: publicUser_(user) }, readState_()));
      case 'mark':
        return respond_(mark_(user, request));
      default:
        return respond_({ ok: false, error: 'Ação desconhecida.' });
    }
  } catch (error) {
    return respond_({ ok: false, error: 'Falha na fonte central: ' + error.message });
  }
}

function doGet() {
  // Sem token não há leitura nem gravação, e o token não viaja na URL.
  return respond_({ ok: false, code: 'method', error: 'Use POST com usuário e token.' });
}

function respond_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- homologação

function mark_(user, request) {
  if (!user.canMark) return { ok: false, code: 'forbidden', error: 'Seu acesso é somente leitura.' };
  const id = String(request.activityId || '');
  if (!Object.prototype.hasOwnProperty.call(PESOS, id)) return { ok: false, error: 'Atividade desconhecida: ' + id };
  if (typeof request.done !== 'boolean') return { ok: false, error: 'Informe done: true ou false.' };
  const note = String(request.note || '').slice(0, 300);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = readState_();
    const wasDone = Boolean(current.state[id] && current.state[id].done);
    if (wasDone === request.done) {
      // Repetir a mesma marcação não gera linha nova.
      return Object.assign({ ok: true, unchanged: true, user: publicUser_(user) }, current);
    }
    const done = Object.keys(current.state).filter((key) => current.state[key].done && key !== id);
    if (request.done) done.push(id);
    eventsSheet_().appendRow([
      new Date(), user.id, safeCell_(user.name), id, request.done ? 'concluida' : 'reaberta',
      progressOf_(done), done.length, safeCell_(note)
    ]);
    return Object.assign({ ok: true, user: publicUser_(user) }, readState_());
  } finally {
    lock.releaseLock();
  }
}

function readState_() {
  const sheet = eventsSheet_();
  const count = sheet.getLastRow() - 1;
  const rows = count > 0 ? sheet.getRange(2, 1, count, CABECALHO.length).getValues() : [];
  const state = {};
  const history = [];
  rows.forEach((row) => {
    const event = {
      timestamp: isoDate_(row[0]), user: String(row[1]), name: String(row[2]), activity: String(row[3]),
      action: String(row[4]), progress: Number(row[5]) || 0, completed: Number(row[6]) || 0, note: String(row[7] || '')
    };
    if (!Object.prototype.hasOwnProperty.call(PESOS, event.activity)) return;
    state[event.activity] = { done: event.action === 'concluida', by: event.user, name: event.name, at: event.timestamp };
    history.push(event);
  });
  const done = Object.keys(state).filter((id) => state[id].done);
  return {
    state: state,
    progress: progressOf_(done),
    completed: done.length,
    history: history.slice(-LIMITE_HISTORICO),
    legacy: readLegacy_()
  };
}

function progressOf_(ids) {
  return Math.round(ids.reduce((sum, id) => sum + (PESOS[id] || 0), 0) * 100) / 100;
}

// Histórico da versão anterior (aba indicada em ABA_HISTORICO_ANTIGO), só leitura.
function readLegacy_() {
  const name = PropertiesService.getScriptProperties().getProperty('ABA_HISTORICO_ANTIGO');
  if (!name) return [];
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(String);
  return values.slice(1).slice(-LIMITE_LEGADO).map((row) => {
    const item = { legacy: true };
    header.forEach((key, index) => { if (key) item[key] = row[index] instanceof Date ? row[index].toISOString() : row[index]; });
    return item;
  });
}

// ---------------------------------------------------------------- acessos

function authenticate_(id, token) {
  if (!id || !token) return null;
  const key = String(id).trim().toLowerCase();
  const user = readUsers_()[key];
  if (!user || user.hash !== sha256_(String(token))) return null;
  return Object.assign({ id: key }, user);
}

function publicUser_(user) {
  return { id: user.id, name: user.name, canMark: Boolean(user.canMark) };
}

function readUsers_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('USUARIOS') || '{}');
}

function writeUsers_(users) {
  PropertiesService.getScriptProperties().setProperty('USUARIOS', JSON.stringify(users));
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map((b) => ((b & 0xff) + 0x100).toString(16).slice(1)).join('');
}

/** Cria ou renova o acesso e devolve o token. Só o hash fica salvo. */
function createToken_(id, name, canMark) {
  const key = String(id || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(key)) throw new Error('Usuário inválido: use letras minúsculas, números, ponto, hífen ou sublinhado.');
  if (!String(name || '').trim()) throw new Error('Informe o nome da pessoa.');
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const users = readUsers_();
  users[key] = { name: String(name).trim(), canMark: canMark === true, hash: sha256_(token), createdAt: new Date().toISOString() };
  writeUsers_(users);
  return token;
}

function revokeUser_(id) {
  const users = readUsers_();
  const key = String(id || '').trim().toLowerCase();
  if (!users[key]) return false;
  delete users[key];
  writeUsers_(users);
  return true;
}

function listUsers_() {
  const users = readUsers_();
  return Object.keys(users).map((key) => `${key} · ${users[key].name} · ${users[key].canMark ? 'homologa' : 'somente leitura'}`);
}

// Menu na planilha (script vinculado à planilha).
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Conecta Control')
    .addItem('Gerar ou renovar token de acesso', 'menuGerarToken')
    .addItem('Revogar acesso', 'menuRevogarAcesso')
    .addItem('Listar acessos', 'menuListarAcessos')
    .addToUi();
}

function menuGerarToken() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Novo acesso', 'Usuário (ex.: marcelo):', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const name = ui.prompt('Novo acesso', 'Nome que aparece nas homologações:', ui.ButtonSet.OK_CANCEL);
  if (name.getSelectedButton() !== ui.Button.OK) return;
  const canMark = ui.alert('Novo acesso', 'Esta pessoa pode marcar e desmarcar atividades?\n(Não = somente leitura)', ui.ButtonSet.YES_NO) === ui.Button.YES;
  const token = createToken_(id.getResponseText(), name.getResponseText(), canMark);
  ui.alert('Token gerado', `Usuário: ${id.getResponseText().trim().toLowerCase()}\nToken: ${token}\n\nCopie agora e entregue só a essa pessoa. Ele não será mostrado de novo; um token anterior do mesmo usuário deixa de valer.`, ui.ButtonSet.OK);
}

function menuRevogarAcesso() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Revogar acesso', 'Usuário:', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  ui.alert(revokeUser_(id.getResponseText()) ? 'Acesso revogado.' : 'Usuário não encontrado.');
}

function menuListarAcessos() {
  SpreadsheetApp.getUi().alert('Acessos', listUsers_().join('\n') || 'Nenhum acesso cadastrado.', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------------------------------------------------------------- planilha

function spreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Defina SPREADSHEET_ID nas propriedades do script.');
  return SpreadsheetApp.openById(id);
}

function eventsSheet_() {
  const book = spreadsheet_();
  let sheet = book.getSheetByName(ABA_EVENTOS);
  if (!sheet) {
    sheet = book.insertSheet(ABA_EVENTOS);
    sheet.appendRow(CABECALHO);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isoDate_(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

// Impede que texto vindo do navegador vire fórmula na planilha.
function safeCell_(text) {
  const value = String(text || '');
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}
