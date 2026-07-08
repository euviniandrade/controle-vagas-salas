import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  query,
  collection,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// ── Elements ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const authAlert   = $("authAlert");
const authTabs    = $("authTabs");
const loginForm   = $("loginForm");
const registerForm = $("registerForm");
const forgotForm  = $("forgotForm");
const phoneRecoveryForm = $("phoneRecoveryForm");
const authSuccess = $("authSuccess");
const googleProvider = new GoogleAuthProvider();

// ── Helpers ───────────────────────────────────────────────────────────────────
function showAlert(msg, type = "error") {
  authAlert.textContent = msg;
  authAlert.className = `auth-alert ${type}`;
  authAlert.hidden = false;
  authAlert.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function clearAlert() { authAlert.hidden = true; }

function setLoading(btn, loading) {
  const text = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  if (text) text.hidden = loading;
  if (loader) loader.hidden = !loading;
  btn.disabled = loading;
}

function showForm(form) {
  [loginForm, registerForm, forgotForm, phoneRecoveryForm, authSuccess].forEach(f => {
    if (f) f.hidden = true;
  });
  authTabs.hidden = (form !== loginForm && form !== registerForm);
  if (form) form.hidden = false;
  clearAlert();
}

function showSuccess(title, msg) {
  showForm(authSuccess);
  $("successTitle").textContent = title;
  $("successMsg").textContent = msg;
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

async function saveUserProfile(uid, data) {
  await setDoc(doc(db, "users", uid), {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
authTabs.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    authTabs.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    showForm(tab.dataset.tab === "login" ? loginForm : registerForm);
  });
});

// ── Eye toggle ────────────────────────────────────────────────────────────────
document.querySelectorAll(".eye-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.target);
    input.type = input.type === "password" ? "text" : "password";
    btn.textContent = input.type === "password" ? "👁" : "🙈";
  });
});

// ── Phone formatting ──────────────────────────────────────────────────────────
["regPhone", "recoveryPhone"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("input", e => { e.target.value = formatPhone(e.target.value); });
});

// ── Forgot / back navigation ──────────────────────────────────────────────────
$("forgotPasswordBtn").addEventListener("click", () => showForm(forgotForm));
$("backFromForgot").addEventListener("click", () => showForm(loginForm));
$("showPhoneRecoveryBtn").addEventListener("click", () => showForm(phoneRecoveryForm));
$("backFromPhone").addEventListener("click", () => showForm(forgotForm));

// ── LOGIN ─────────────────────────────────────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert();
  const btn = $("loginBtn");
  setLoading(btn, true);
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
    showSuccess("Acesso confirmado! ✅", "Redirecionando para o painel...");
    setTimeout(() => { window.location.href = "./admin.html"; }, 1200);
  } catch (err) {
    showAlert(friendlyError(err.code));
  } finally {
    setLoading(btn, false);
  }
});

// ── REGISTER ──────────────────────────────────────────────────────────────────
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert();
  const name  = $("regName").value.trim();
  const email = $("regEmail").value.trim();
  const phone = $("regPhone").value.trim();
  const role  = $("regRole").value;
  const pwd   = $("regPassword").value;
  const pwd2  = $("regPassword2").value;

  if (pwd !== pwd2) { showAlert("As senhas não coincidem."); return; }
  if (!role) { showAlert("Selecione sua função."); return; }

  const btn = $("registerBtn");
  setLoading(btn, true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    await updateProfile(cred.user, { displayName: name });
    await saveUserProfile(cred.user.uid, { name, email, phone, role, uid: cred.user.uid });
    showSuccess("Conta criada com sucesso! 🎉", `Bem-vindo(a), ${name.split(" ")[0]}! Seu acesso está ativo.`);
  } catch (err) {
    showAlert(friendlyError(err.code));
  } finally {
    setLoading(btn, false);
  }
});

// ── GOOGLE LOGIN / REGISTER ───────────────────────────────────────────────────
async function handleGoogle() {
  clearAlert();
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    // Check if profile exists; if not, create it
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) {
      await saveUserProfile(user.uid, {
        name: user.displayName || "",
        email: user.email || "",
        phone: "",
        role: "",
        uid: user.uid,
      });
    }
    showSuccess("Acesso com Google confirmado! ✅", "Redirecionando para o painel...");
    setTimeout(() => { window.location.href = "./admin.html"; }, 1200);
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") showAlert(friendlyError(err.code));
  }
}
$("googleLoginBtn").addEventListener("click", handleGoogle);
$("googleRegisterBtn").addEventListener("click", handleGoogle);

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert();
  const email = $("forgotEmail").value.trim();
  const btn = $("forgotBtn");
  setLoading(btn, true);
  try {
    await sendPasswordResetEmail(auth, email);
    showAlert(`Link de recuperação enviado para ${email}. Verifique sua caixa de entrada (e a pasta de spam).`, "success");
  } catch (err) {
    showAlert(friendlyError(err.code));
  } finally {
    setLoading(btn, false);
  }
});

// ── PHONE RECOVERY ────────────────────────────────────────────────────────────
phoneRecoveryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert();
  const phone = $("recoveryPhone").value.trim();
  const btn = $("phoneRecoveryBtn");
  setLoading(btn, true);
  try {
    // Search Firestore for user with this phone
    const q = query(collection(db, "users"), where("phone", "==", phone));
    const snap = await getDocs(q);
    if (snap.empty) {
      showAlert("Nenhuma conta encontrada com esse número de celular. Verifique o número e tente novamente.");
      return;
    }
    const userData = snap.docs[0].data();
    const maskedEmail = maskEmail(userData.email);
    showAlert(
      `Encontramos sua conta! Seu e-mail é: ${maskedEmail}\n\nUse a opção "Esqueci minha senha" com esse e-mail para redefinir sua senha.`,
      "info"
    );
    // Pre-fill the forgot form
    $("forgotEmail").value = userData.email;
  } catch (err) {
    showAlert("Erro ao buscar sua conta. Tente novamente.");
    console.error(err);
  } finally {
    setLoading(btn, false);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskEmail(email) {
  const [local, domain] = email.split("@");
  const masked = local.slice(0, 2) + "***" + local.slice(-1);
  return `${masked}@${domain}`;
}

function friendlyError(code) {
  const map = {
    "auth/user-not-found": "Não encontramos nenhuma conta com esse e-mail.",
    "auth/wrong-password": "Senha incorreta. Tente novamente ou use 'Esqueci minha senha'.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Esse e-mail já está cadastrado. Tente entrar ou recuperar sua senha.",
    "auth/weak-password": "Senha muito fraca. Use pelo menos 6 caracteres.",
    "auth/invalid-email": "Endereço de e-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "auth/network-request-failed": "Erro de conexão. Verifique sua internet.",
    "auth/popup-blocked": "Popup bloqueado pelo navegador. Permita popups para esse site.",
  };
  return map[code] || "Ocorreu um erro. Tente novamente.";
}

// ── Auto-redirect if already logged in ───────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  const params = new URLSearchParams(window.location.search);
  if (user && !params.get("force")) {
    window.location.href = "./admin.html";
  }
});
