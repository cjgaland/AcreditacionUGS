/* ═══════════════════════════════════════════════════════════════
   firebase.js  —  Configuración Firebase
   Plataforma Mentoría ACSA · Área Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 8 */
/* global firebase */

// ── NOTA: CDNs que debes incluir en el HTML ANTES de este fichero ──
// <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
// ──────────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            "AIzaSyCb--Ep4Z1SGvCLALoOdWY6qLJN4FWirBM",
  authDomain:        "acsa-ugc-sur-cordoba.firebaseapp.com",
  projectId:         "acsa-ugc-sur-cordoba",
  storageBucket:     "acsa-ugc-sur-cordoba.firebasestorage.app",
  messagingSenderId: "1029063446265",
  appId:             "1:1029063446265:web:096446d58020bed6575c28"
};

// ── Inicialización ───────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();

// ── Colecciones principales ──────────────────────────────────────
const COL = {
  ugcs:       'ugcs',
  usuarios:   'usuarios',
  directorio: 'directorio',
};

// Sub-colecciones dentro de cada UGC:
//   ugcs/{ugcId}/estandares/{codigoEstandar}
//   ugcs/{ugcId}/reuniones/{reunionId}
//   ugcs/{ugcId}/mensajes/{mensajeId}

// ── Umbrales de certificación ACSA ──────────────────────────────
const UMBRALES = {
  // Estándares del manual UGC (Manual 5)
  total:       76,
  obligatorios: 31,   // estándares con obligatorio = 'Si'
  grupoI:       19,   // no obligatorios grupo I
  grupoII:      18,
  grupoIII:      8,

  // Requisitos por nivel
  avanzado: {
    // ≥70% de GI incluyendo TODOS los obligatorios
    pctGI: 0.70,
    obligatorios: 1.00,   // 100% de obligatorios
  },
  optimo: {
    pctGI:  1.00,   // 100% GI
    pctGII: 0.40,   // ≥40% GII
  },
  excelente: {
    pctGI:   1.00,
    pctGII:  1.00,
    pctGIII: 0.40,
  },
};

// ── Helper: calcular nivel de certificación ──────────────────────
// estandares = array de objetos { codigo, grupo, obligatorio, estado }
function calcularNivel(estandares) {
  const cumple = e => e.estado === 'cumple';

  const obligatorios = estandares.filter(e => e.obligatorio === 'Si');
  const gII          = estandares.filter(e => e.grupo === 'II');
  const gIII         = estandares.filter(e => e.grupo === 'III');
  const todosGI      = estandares.filter(e => e.grupo === 'I');

  const pctOblig  = obligatorios.length ? obligatorios.filter(cumple).length / obligatorios.length : 0;
  const pctGI     = todosGI.length      ? todosGI.filter(cumple).length      / todosGI.length      : 0;
  const pctGII    = gII.length          ? gII.filter(cumple).length           / gII.length          : 0;
  const pctGIII   = gIII.length         ? gIII.filter(cumple).length          / gIII.length         : 0;

  const todosObligCumplen = pctOblig === 1.0;

  let nivel = 'En Proceso';
  let color = '#9e9890';   // gris

  if (todosObligCumplen && pctGI >= UMBRALES.avanzado.pctGI) {
    nivel = 'Avanzado';
    color = '#2d7a4f';   // verde
  }
  if (pctGI === 1.0 && pctGII >= UMBRALES.optimo.pctGII) {
    nivel = 'Óptimo';
    color = '#1e5b8c';   // azul
  }
  if (pctGI === 1.0 && pctGII === 1.0 && pctGIII >= UMBRALES.excelente.pctGIII) {
    nivel = 'Excelente';
    color = '#5c2d7a';   // morado
  }

  return {
    nivel, color,
    pctOblig:  Math.round(pctOblig  * 100),
    pctGI:     Math.round(pctGI     * 100),
    pctGII:    Math.round(pctGII    * 100),
    pctGIII:   Math.round(pctGIII   * 100),
    cumpleObligatorios: obligatorios.filter(cumple).length,
    totalObligatorios:  obligatorios.length,
    cumpleGI:  todosGI.filter(cumple).length,
    totalGI:   todosGI.length,
    cumpleGII: gII.filter(cumple).length,
    totalGII:  gII.length,
    cumpleGIII:gIII.filter(cumple).length,
    totalGIII: gIII.length,
  };
}

// ── Helper: timestamp legible ────────────────────────────────────
function fmtFecha(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtFechaHora(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Helper: certificación ACSA — calcula fechas clave a partir de la fecha de cert. ─
function calcularFechasACSA(fechaStr) {
  if (!fechaStr) return null;
  const cert = new Date(fechaStr.includes('T') ? fechaStr : fechaStr + 'T00:00:00');
  if (isNaN(cert.getTime())) return null;
  const hoy  = new Date();
  const seg  = new Date(cert); seg.setMonth(seg.getMonth() + 30);   // 2,5 años
  const venc = new Date(cert); venc.setFullYear(venc.getFullYear() + 5);
  const renovar = new Date(venc); renovar.setFullYear(renovar.getFullYear() - 1);
  const diasHastaVenc = Math.round((venc - hoy) / 86400000);
  const diasHastaSeg  = Math.round((seg  - hoy) / 86400000);
  return { cert, seg, venc, renovar, diasHastaVenc, diasHastaSeg };
}

// ── Helper: formatea cadena YYYY-MM-DD a dd/mm/aaaa ────────────────────────────────
function fmtFechaStr(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') ? str : str + 'T00:00:00');
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}