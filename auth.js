/* ═══════════════════════════════════════════════════════════════
   auth.js  —  Autenticación Email + Contraseña
   Plataforma Mentoría ACSA · Área Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 8 */
/* global firebase, auth, db, COL, App */

'use strict';

// ── Dominio permitido ────────────────────────────────────────────
const DOMINIO_PERMITIDO = '@juntadeandalucia.es';

// ── Usuario activo en sesión ─────────────────────────────────────
let currentUser   = null;
let currentPerfil = null;

// ═════════════════════════════════════════════════════════════════
//   LOGIN / REGISTRO / RECUPERACIÓN
// ═════════════════════════════════════════════════════════════════

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { mostrarErrorLogin('Introduce tu correo y contraseña.'); return; }
  if (!email.endsWith(DOMINIO_PERMITIDO)) {
    mostrarErrorLogin(`Solo se permiten cuentas <strong>${DOMINIO_PERMITIDO}</strong>`);
    return;
  }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    mostrarErrorLogin(_traducirError(err.code));
  }
}

async function registrar() {
  const email  = document.getElementById('login-email').value.trim();
  const pass   = document.getElementById('login-pass').value;
  const pass2  = document.getElementById('login-pass2').value;
  const nombre = document.getElementById('login-nombre').value.trim();
  if (!nombre)  { mostrarErrorLogin('Introduce tu nombre completo.'); return; }
  if (!email)   { mostrarErrorLogin('Introduce tu correo corporativo.'); return; }
  if (!email.endsWith(DOMINIO_PERMITIDO)) {
    mostrarErrorLogin(`Solo se permiten cuentas <strong>${DOMINIO_PERMITIDO}</strong>`);
    return;
  }
  if (pass.length < 6) { mostrarErrorLogin('La contraseña debe tener al menos 6 caracteres.'); return; }
  if (pass !== pass2)  { mostrarErrorLogin('Las contraseñas no coinciden.'); return; }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: nombre });
  } catch (err) {
    mostrarErrorLogin(_traducirError(err.code));
  }
}

async function recuperarPassword() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { mostrarErrorLogin('Introduce tu correo para recibir el enlace.'); return; }
  try {
    await auth.sendPasswordResetEmail(email);
    mostrarInfoLogin(`Correo de recuperación enviado a <strong>${email}</strong>. Revisa también el spam.`);
  } catch (err) {
    mostrarErrorLogin(_traducirError(err.code));
  }
}

async function logout() {
  if (_unsubPerfilListener) { _unsubPerfilListener(); _unsubPerfilListener = null; }
  _cancelarListeners();
  try {
    await auth.signOut();
  } catch(e) { /* silencioso: de todas formas limpiamos el estado local */ }
  currentUser   = null;
  currentPerfil = null;
  mostrarPantallaLogin();
}

// ═════════════════════════════════════════════════════════════════
//   OBSERVER
// ═════════════════════════════════════════════════════════════════

auth.onAuthStateChanged(async user => {
  if (!user) {
    if (_unsubPerfilListener) { _unsubPerfilListener(); _unsubPerfilListener = null; }
    currentUser = null; currentPerfil = null; mostrarPantallaLogin(); return;
  }

  if (!user.email.endsWith(DOMINIO_PERMITIDO)) {
    await auth.signOut();
    mostrarErrorLogin(`Acceso restringido al dominio ${DOMINIO_PERMITIDO}.`);
    return;
  }

  currentUser = user;

  try {
    const ref  = db.collection(COL.usuarios).doc(user.uid);
    const snap = await ref.get();

    if (snap.exists) {
      currentPerfil = snap.data();
    } else {
      const nuevoPerfil = {
        uid:               user.uid,
        nombre:            user.displayName || user.email,
        email:             user.email,
        rol:               'pendiente',
        ugc_id:            null,
        cargo:             '',
        telefono_whatsapp: '',
        creado_en:         firebase.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(nuevoPerfil);
      currentPerfil = nuevoPerfil;
    }

    ocultarPantallaLogin();
    gestionarRol(currentPerfil);

    if (_unsubPerfilListener) { _unsubPerfilListener(); _unsubPerfilListener = null; }
    _unsubPerfilListener = db.collection(COL.usuarios).doc(user.uid)
      .onSnapshot(snap => {
        if (!snap.exists) return;
        const nuevo = snap.data();
        const cambio = nuevo.rol !== currentPerfil.rol || nuevo.ugc_id !== currentPerfil.ugc_id;
        currentPerfil = nuevo;
        if (cambio) gestionarRol(currentPerfil);
      });

  } catch (err) {
    console.error('Error cargando perfil:', err);
    mostrarErrorLogin('Error al cargar tu perfil. Contacta con el administrador.');
    await auth.signOut();
  }
});

// ═════════════════════════════════════════════════════════════════
//   ROL
// ═════════════════════════════════════════════════════════════════

function gestionarRol(perfil) {
  switch (perfil.rol) {
    case 'admin':     App.mostrarPanelAdmin(perfil);    break;
    case 'ugc':       App.mostrarPanelUGC(perfil);      break;
    case 'pendiente': mostrarPantallaPendiente(perfil); break;
    default:
      mostrarErrorLogin('Rol no reconocido. Contacta con el administrador.');
      auth.signOut();
  }
}

// ═════════════════════════════════════════════════════════════════
//   MODOS FORMULARIO
// ═════════════════════════════════════════════════════════════════

function setModo(modo) {
  document.getElementById('error-login').innerHTML = '';

  const rowNombre   = document.getElementById('row-nombre');
  const rowPass2    = document.getElementById('row-pass2');
  const btnLogin    = document.getElementById('btn-login');
  const btnReg      = document.getElementById('btn-registrar');
  const btnRec      = document.getElementById('btn-recuperar');
  const linkReg     = document.getElementById('link-registro');
  const linkLogin   = document.getElementById('link-login');
  const linkRec     = document.getElementById('link-recuperar');
  const titulo      = document.getElementById('login-titulo');

  [rowNombre,rowPass2,btnLogin,btnReg,btnRec,linkReg,linkLogin,linkRec].forEach(el => { if(el) el.style.display='none'; });

  if (modo === 'login') {
    if(titulo)    titulo.textContent      = 'Iniciar sesión';
    if(btnLogin)  btnLogin.style.display  = 'flex';
    if(linkReg)   linkReg.style.display   = 'block';
    if(linkRec)   linkRec.style.display   = 'block';
  } else if (modo === 'registro') {
    if(titulo)     titulo.textContent      = 'Crear cuenta';
    if(rowNombre)  rowNombre.style.display = 'block';
    if(rowPass2)   rowPass2.style.display  = 'block';
    if(btnReg)     btnReg.style.display    = 'flex';
    if(linkLogin)  linkLogin.style.display = 'block';
  } else if (modo === 'recuperar') {
    if(titulo)     titulo.textContent     = 'Recuperar contraseña';
    if(btnRec)     btnRec.style.display   = 'flex';
    if(linkLogin)  linkLogin.style.display= 'block';
  }
}

// ═════════════════════════════════════════════════════════════════
//   GETTERS
// ═════════════════════════════════════════════════════════════════

function getUser()   { return currentUser;   }
function getPerfil() { return currentPerfil; }
function isAdmin()   { return currentPerfil && currentPerfil.rol === 'admin'; }
function isUGC()     { return currentPerfil && currentPerfil.rol === 'ugc';   }

// ═════════════════════════════════════════════════════════════════
//   UI
// ═════════════════════════════════════════════════════════════════

function mostrarPantallaLogin() {
  document.getElementById('screen-login').style.display   = 'flex';
  document.getElementById('screen-app').style.display     = 'none';
  document.getElementById('screen-pending').style.display = 'none';
  document.getElementById('error-login').innerHTML        = '';
  setModo('login');
}

function ocultarPantallaLogin() {
  document.getElementById('screen-login').style.display   = 'none';
  document.getElementById('screen-app').style.display     = 'block';
  document.getElementById('screen-pending').style.display = 'none';
}

function mostrarErrorLogin(msg) {
  document.getElementById('error-login').innerHTML = `<div class="login-error">⚠️ ${msg}</div>`;
}

function mostrarInfoLogin(msg) {
  document.getElementById('error-login').innerHTML = `<div class="login-info">ℹ️ ${msg}</div>`;
}

function mostrarPantallaPendiente(perfil) {
  document.getElementById('screen-login').style.display   = 'none';
  document.getElementById('screen-app').style.display     = 'none';
  document.getElementById('screen-pending').style.display = 'flex';
  document.getElementById('pending-email').textContent    = perfil.email;
}

async function comprobarEstadoPendiente() {
  if (!currentUser) return;
  const statusEl = document.getElementById('pending-status');
  if (statusEl) statusEl.textContent = 'Comprobando…';
  try {
    const snap = await db.collection(COL.usuarios).doc(currentUser.uid).get();
    if (!snap.exists) { if (statusEl) statusEl.textContent = 'No se encontró tu cuenta.'; return; }
    currentPerfil = snap.data();
    if (currentPerfil.rol !== 'pendiente') {
      ocultarPantallaLogin();
      gestionarRol(currentPerfil);
    } else {
      if (statusEl) statusEl.textContent = 'Tu cuenta sigue pendiente de activación.';
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = 'Error al comprobar. Inténtalo de nuevo.';
  }
}

// ═════════════════════════════════════════════════════════════════
//   NOTIFICACIONES
// ═════════════════════════════════════════════════════════════════

let _unsubNotifUGC      = null;
let _unsubNotifAdmin    = null;
let _unsubPerfilListener = null;

function _cancelarListeners() {
  if (_unsubNotifUGC)   { _unsubNotifUGC();   _unsubNotifUGC   = null; }
  if (_unsubNotifAdmin) { _unsubNotifAdmin(); _unsubNotifAdmin = null; }
}

function _actualizarBadge(n) {
  ['notif-badge','nav-badge-mensajes','nav-badge-mis-mensajes'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) { el.textContent = n > 9 ? '9+' : String(n); el.style.display = 'flex'; }
    else       { el.style.display = 'none'; }
  });
}

function iniciarListenerNotificaciones(ugcId) {
  if (!ugcId) return;
  _cancelarListeners();
  _unsubNotifUGC = db.collection(COL.ugcs).doc(ugcId)
    .collection('mensajes')
    .where('para', '==', ugcId)
    .where('leido', '==', false)
    .onSnapshot(snap => _actualizarBadge(snap.size));
}

function iniciarListenerNotificacionesAdmin() {
  _cancelarListeners();
  _unsubNotifAdmin = db.collectionGroup('mensajes')
    .where('para', '==', 'admin')
    .where('leido', '==', false)
    .onSnapshot(snap => _actualizarBadge(snap.size));
}

// ═════════════════════════════════════════════════════════════════
//   HELPERS
// ═════════════════════════════════════════════════════════════════

function abrirWhatsApp(telefono, nombreUGC, texto) {
  const tel = String(telefono).replace(/\D/g, '');
  const msg = encodeURIComponent(texto || `Hola, soy de la ${nombreUGC}. Os contacto desde la plataforma de mentoría ACSA.`);
  window.open(`https://wa.me/${tel}?text=${msg}`, '_blank');
}

function _traducirError(code) {
  const errores = {
    'auth/user-not-found':         'No existe ninguna cuenta con ese correo.',
    'auth/wrong-password':         'Contraseña incorrecta.',
    'auth/invalid-credential':     'Correo o contraseña incorrectos.',
    'auth/email-already-in-use':   'Ya existe una cuenta con ese correo.',
    'auth/weak-password':          'La contraseña debe tener al menos 6 caracteres.',
    'auth/invalid-email':          'El formato del correo no es válido.',
    'auth/too-many-requests':      'Demasiados intentos. Espera unos minutos o recupera tu contraseña.',
    'auth/network-request-failed': 'Error de red. Comprueba tu conexión.',
  };
  return errores[code] || `Error inesperado (${code}). Contacta con el administrador.`;
}