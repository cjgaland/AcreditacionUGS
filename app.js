/* ═══════════════════════════════════════════════════════════════
   app.js  —  Lógica principal Plataforma Mentoría ACSA
   Área de Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 9 */
/* global firebase, auth, db, COL, UGCS, STANDARDS,
          calcularNivel, fmtFecha, fmtFechaHora, calcularFechasACSA, fmtFechaStr,
          getUser, getPerfil, isAdmin, isUGC, isGestor,
          logout, abrirWhatsApp,
          iniciarListenerNotificaciones,
          iniciarListenerNotificacionesAdmin,
          Directorio, Utilidades, normalizarDocs, confirm */

'use strict';

function _buildSearchIdx(standards) {
  function collect(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    if (Array.isArray(val)) return val.map(collect).join(' ');
    if (typeof val === 'object') return Object.values(val).map(collect).join(' ');
    return '';
  }
  return standards.map(s => collect(s).toLowerCase());
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Normaliza docs separados por • a uno por línea
function normalizarDocs(str) {
  if (!str) return '';
  if (str.includes('•')) {
    return str.split('•').map(s => s.trim()).filter(Boolean).join('\n');
  }
  return str;
}

/* ══════════════════════════════════════════════════════
   APP — objeto principal
══════════════════════════════════════════════════════ */
const App = {

  /* Estado local */
  _currentView:  '',
  _ugcActual:    null,
  _sidebarOpen:  false,
  _userMenuOpen: false,
  _infoUGCData:  null,
  _estandaresAdminData:    null,
  _estandaresAdminFiltros: { q: '', oblig: '', grupo: '', criterio: '', estado: '' },
  _estandaresAdminIdx:     [],
  _misEstandaresData:    null,
  _misEstandaresFiltros: { q: '', oblig: '', grupo: '', criterio: '', estado: '' },
  _misEstandaresIdx:     [],

  /* ── Inicialización tras login ──────────────────── */
  async mostrarPanelAdmin(perfil) {
    document.getElementById('nav-admin').style.display      = 'block';
    document.getElementById('nav-ugc').style.display        = 'none';
    document.getElementById('nav-gestor').style.display     = 'none';
    document.getElementById('nav-utilidades').style.display = 'block';
    document.getElementById('userName').textContent         = perfil.nombre;
    document.getElementById('userEmail').textContent        = perfil.email;
    document.getElementById('userRol').textContent          = '🔑 Administrador';
    App._setUserAvatar(perfil);
    App._setRolBadge('admin');
    iniciarListenerNotificacionesAdmin();
    await App._sincronizarUGCs();
    const _dp = new URLSearchParams(window.location.search);
    const _deepUgc = _dp.get('ugc');
    const _deepStd = _dp.get('std');
    if (_deepUgc && _deepStd && UGCS.find(u => u.id === _deepUgc)) {
      await App.abrirFichaUGC(_deepUgc);
      await App.abrirModalEstandar(_deepStd, _deepUgc);
    } else {
      App.navigate('dashboard');
    }
  },

  async mostrarPanelGestor(perfil) {
    document.getElementById('nav-gestor').style.display     = 'block';
    document.getElementById('nav-admin').style.display      = 'none';
    document.getElementById('nav-ugc').style.display        = 'none';
    document.getElementById('nav-utilidades').style.display = 'none';
    document.getElementById('userName').textContent         = perfil.nombre;
    document.getElementById('userEmail').textContent        = perfil.email;
    document.getElementById('userRol').textContent          = '👁 Gestor';
    App._setUserAvatar(perfil);
    App._setRolBadge('gestor');
    iniciarListenerNotificacionesAdmin();
    await App._sincronizarUGCs();
    App.navigate('dashboard');
  },

  async mostrarPanelUGC(perfil) {
    document.getElementById('nav-ugc').style.display        = 'block';
    document.getElementById('nav-admin').style.display      = 'none';
    document.getElementById('nav-gestor').style.display     = 'none';
    document.getElementById('nav-utilidades').style.display = 'none';
    document.getElementById('userName').textContent         = perfil.nombre;
    document.getElementById('userEmail').textContent        = perfil.email;
    document.getElementById('userRol').textContent          = `🏥 ${perfil.cargo || 'UGC'}`;
    App._setUserAvatar(perfil);
    App._setRolBadge('ugc');
    iniciarListenerNotificaciones(perfil.ugc_id);
    await App._sincronizarUGCs(perfil.ugc_id);
    const _dp2 = new URLSearchParams(window.location.search);
    const _deepUgc2 = _dp2.get('ugc');
    const _deepStd2 = _dp2.get('std');
    if (_deepStd2 && _deepUgc2 === perfil.ugc_id) {
      App.navigate('mis-estandares');
      await App.abrirModalEstandar(_deepStd2, perfil.ugc_id);
    } else {
      App.navigate('mi-estado');
    }
  },

  async _sincronizarUGCs(ugcId) {
    try {
      if (ugcId) {
        // Usuario UGC: solo puede leer su propio documento
        const snap = await db.collection(COL.ugcs).doc(ugcId).get();
        if (snap.exists) {
          const ugc = UGCS.find(u => u.id === ugcId);
          if (ugc) Object.assign(ugc, snap.data());
        }
      } else {
        // Admin: sincroniza todos los documentos de ugcs que existan en Firestore
        const snap = await db.collection(COL.ugcs).get();
        snap.forEach(doc => {
          if (!doc.exists) return;
          const ugc = UGCS.find(u => u.id === doc.id);
          if (ugc) Object.assign(ugc, doc.data());
        });
      }
    } catch(e) { /* si falla, la app sigue con los datos estáticos */ }
  },

  _setUserAvatar(perfil) {
    const photo    = document.getElementById('userPhoto');
    const initials = document.getElementById('userInitials');
    const user     = getUser();
    if (user && user.photoURL) {
      photo.src = user.photoURL;
      photo.style.display = 'block';
      initials.style.display = 'none';
    } else {
      const parts = (perfil.nombre || perfil.email).split(' ');
      initials.textContent = parts.length > 1 ? parts[0][0] + parts[1][0] : (perfil.nombre || '?')[0];
      initials.style.display = 'flex';
    }
  },

  _setRolBadge(rol) {
    const badge = document.getElementById('user-role-badge');
    if (!badge) return;
    const labels = { admin: 'Administrador', ugc: 'Usuario UGC', gestor: 'Gestor' };
    badge.textContent = labels[rol] || rol;
    badge.className   = 'role-badge role-badge--' + rol;
  },

  /* ── Navegación ─────────────────────────────────── */
  navigate(view) {
    // Ocultar todas las vistas
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    // Desactivar nav items
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Mostrar vista
    const el = document.getElementById('view-' + view);
    if (el) el.style.display = 'block';

    // Activar nav item
    const navEl = document.querySelector(`[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');

    App._currentView = view;
    App.closeSidebar();

    // Cargar datos de la vista
    switch (view) {
      case 'dashboard':      App.cargarDashboard();     break;
      case 'ugcs-list':      App.cargarListaUGCs();     break;
      case 'mensajes-admin': App.cargarMensajesAdmin(); break;
      case 'usuarios':       App.cargarUsuarios();      break;
      case 'mi-estado':      App.cargarMiEstado();      break;
      case 'mis-estandares': App.cargarMisEstandares(); break;
      case 'reuniones':      App.cargarReuniones();     break;
      case 'mis-mensajes':   App.cargarMisMensajes();   break;
      case 'directorio':     Directorio.cargar();       break;
      case 'utilidades':     Utilidades.cargar();       break;
      case 'guia':           App.cargarGuia();          break;
    }
  },

  verMensajes() {
    if (isAdmin()) App.navigate('mensajes-admin');
    else           App.navigate('mis-mensajes');
  },

  /* ── Sidebar ────────────────────────────────────── */
  toggleSidebar() {
    if (App._sidebarOpen) { App.closeSidebar(); } else { App.openSidebar(); }
  },
  openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
    App._sidebarOpen = true;
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
    App._sidebarOpen = false;
  },

  /* ── User menu ──────────────────────────────────── */
  toggleUserMenu() {
    const dd = document.getElementById('userDropdown');
    App._userMenuOpen = !App._userMenuOpen;
    dd.classList.toggle('open', App._userMenuOpen);
  },

  toggleTheme() {
    const dark = document.body.classList.toggle('dark-mode');
    document.getElementById('theme-icon-sun').style.display  = dark ? '' : 'none';
    document.getElementById('theme-icon-moon').style.display = dark ? 'none' : '';
    try { localStorage.setItem('tema', dark ? 'dark' : 'light'); } catch(e) {}
  },

  _aplicarTemaGuardado() {
    let dark = false;
    try { dark = localStorage.getItem('tema') === 'dark'; } catch(e) {}
    if (dark) {
      document.body.classList.add('dark-mode');
      const s = document.getElementById('theme-icon-sun');
      const m = document.getElementById('theme-icon-moon');
      if (s) s.style.display = '';
      if (m) m.style.display = 'none';
    }
  },

  /* ── Tabs ───────────────────────────────────────── */
  switchTab(btn, tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    btn.classList.add('active');
    const el = document.getElementById('tab-' + tabName);
    if (el) el.style.display = 'block';
    // Cargar contenido del tab
    if (tabName === 'estandares' && App._ugcActual)  App.cargarEstandaresUGC(App._ugcActual);
    if (tabName === 'reuniones'  && App._ugcActual)  App.cargarReunionesUGC(App._ugcActual);
    if (tabName === 'mensajes-ugc' && App._ugcActual) App.cargarMensajesUGC(App._ugcActual);
    if (tabName === 'info-ugc'   && App._ugcActual)  App.cargarInfoUGC(App._ugcActual);
  },

  /* ══════════════════════════════════════════════════
     CUADRO DE MANDOS (ADMIN)
  ══════════════════════════════════════════════════ */
  async cargarDashboard() {
    // KPIs rápidos desde UGCS estático
    const activas = UGCS.filter(u => u.fase && u.fase !== 'Sin solicitar');
    document.getElementById('kpi-activas').textContent = activas.length;

    // Tabla de UGCs activas
    const tablaEl = document.getElementById('tabla-ugcs-activas');
    if (!activas.length) {
      tablaEl.innerHTML = '<div class="empty-state"><p>No hay UGCs en proceso activo.</p></div>';
    } else {
      tablaEl.innerHTML = `
        <div style="overflow-x:auto">
        <table class="tabla-acreditacion">
          <thead><tr>
            <th>Unidad</th><th>Fase</th><th>Estado</th><th>Nivel</th>
          </tr></thead>
          <tbody>
            ${activas.map(u => `
              <tr id="dash-row-${u.id}" onclick="App.abrirFichaUGC('${u.id}')">
                <td><strong>${u.denominacion}</strong><br><small style="color:var(--text3)">${u.ubicacion}</small></td>
                <td>${App._faseBadge(u.fase)}</td>
                <td><small>${u.estado_fase || '—'}</small></td>
                <td id="dash-nivel-${u.id}"><span style="color:var(--text3)">—</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>`;

      // Cargar nivel de cada UGC activa en paralelo
      activas.forEach(u => App._cargarNivelDashboard(u.id));
    }

    // KPI: reuniones este mes (collectionGroup → 1 sola consulta)
    try {
      const inicioMes = firebase.firestore.Timestamp.fromDate(
        new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      );
      const reunSnap = await db.collectionGroup('reuniones')
        .where('fecha', '>=', inicioMes).get();
      document.getElementById('kpi-reuniones').textContent = reunSnap.size;
    } catch(e) {
      document.getElementById('kpi-reuniones').textContent = '—';
    }

    // Propuestos pendientes — query por UGC activa (evita índice collectionGroup)
    try {
      const propuestosEl = document.getElementById('lista-propuestos');
      const snaps = await Promise.all(
        activas.map(u => db.collection(COL.ugcs).doc(u.id)
          .collection('estandares').where('estado', '==', 'propuesto').get())
      );

      const allDocs = [];
      snaps.forEach((snap, i) => {
        snap.forEach(doc => allDocs.push({ doc, ugcId: activas[i].id }));
      });
      allDocs.sort((a, b) => {
        const ta = a.doc.data().propuesto_en ? a.doc.data().propuesto_en.toMillis() : 0;
        const tb = b.doc.data().propuesto_en ? b.doc.data().propuesto_en.toMillis() : 0;
        return tb - ta;
      });

      if (!allDocs.length) {
        propuestosEl.innerHTML = '<div class="empty-state"><p>✅ No hay estándares pendientes de validación.</p></div>';
      } else {
        propuestosEl.innerHTML = allDocs.slice(0, 20).map(({ doc, ugcId }) => {
          const d = doc.data();
          const ugc = UGCS.find(u => u.id === ugcId);
          const est = (typeof STANDARDS !== 'undefined') ? STANDARDS.find(s => s.codigo === doc.id) : null;
          return `
            <div class="estandar-item" style="margin-bottom:8px">
              <div class="est-estado-dot dot-propuesto"></div>
              <div class="est-info">
                <span class="est-codigo">${doc.id}</span>
                <div class="est-enunciado">${est ? est.enunciado : doc.id}</div>
                <small style="color:var(--text2)">${ugc ? ugc.denominacion : ugcId} · Propuesto ${fmtFecha(d.propuesto_en)}</small>
                ${d.evidencia_texto ? `<div style="font-size:12px;color:var(--text2);margin-top:4px">"${escHtml(d.evidencia_texto.substring(0,100))}${d.evidencia_texto.length>100?'…':''}"</div>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn-success" onclick="App.validarEstandar('${ugcId}','${doc.id}',true)">✅ Validar</button>
                <button class="btn-danger"  onclick="App.validarEstandar('${ugcId}','${doc.id}',false)">❌ Rechazar</button>
              </div>
            </div>`;
        }).join('');
      }
    } catch(e) {
      document.getElementById('lista-propuestos').innerHTML =
        '<div class="empty-state"><p>Error al cargar propuestas.</p></div>';
    }

    // Mensajes sin leer
    try {
      const msgSnap = await db.collectionGroup('mensajes')
        .where('para', '==', 'admin').where('leido', '==', false).get();
      document.getElementById('kpi-mensajes-pend').textContent = msgSnap.size;
    } catch(e) {
      document.getElementById('kpi-mensajes-pend').textContent = '—';
    }

    // Panel de alertas de certificación
    const alertasEl = document.getElementById('panel-alertas-cert');
    if (alertasEl) {
      const ugcsAlerta = UGCS.filter(u => {
        if (!u.fase || u.fase === 'Sin solicitar') return false;
        if (u.fase === 'Pendiente de estabilización') return true;
        if (u.fase === 'Autoevaluación' && u.fecha_inicio_fase) {
          const dias = Math.round((new Date() - new Date(u.fecha_inicio_fase + 'T00:00:00')) / 86400000);
          if (dias > 300) return true;
        }
        const fechaCertStr = u.fecha_certificacion || u.fecha_fin;
        if (fechaCertStr && ['Seguimiento', 'Recertificación'].includes(u.fase)) {
          const f = calcularFechasACSA(fechaCertStr);
          if (f && (f.diasHastaVenc < 365 || (f.diasHastaSeg < 90 && f.diasHastaVenc > 0))) return true;
        }
        return false;
      });
      document.getElementById('kpi-alertas').textContent = ugcsAlerta.length;
      if (!ugcsAlerta.length) {
        alertasEl.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:13px">✅ Sin alertas de certificación activas.</div>';
      } else {
        alertasEl.innerHTML = ugcsAlerta.map(u => `
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px">${escHtml(u.denominacion)} ${App._faseBadge(u.fase)}</div>
              ${App._alertasCertHtml(u)}
            </div>
            <button class="btn-sm" style="flex-shrink:0;margin-top:2px" onclick="App.abrirFichaUGC('${u.id}')">Ver →</button>
          </div>`).join('');
      }
    }
  },

  async _cargarNivelDashboard(ugcId) {
    if (!document.getElementById('dash-nivel-' + ugcId)) return;
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId).collection('estandares').get();
      const el = document.getElementById('dash-nivel-' + ugcId);
      if (!el) return;
      if (snap.empty || typeof STANDARDS === 'undefined') { el.innerHTML = '<span style="color:var(--text3)">Sin datos</span>'; return; }
      const estadosMap = {};
      snap.forEach(doc => { estadosMap[doc.id] = doc.data().estado || 'pendiente'; });
      const lista = STANDARDS.map(s => ({ ...s, estado: estadosMap[s.codigo] || 'pendiente' }));
      const { nivel, color } = calcularNivel(lista);
      el.innerHTML = `<span style="font-size:12px;font-weight:700;color:${color}">${nivel}</span>`;
    } catch(e) {
      const el = document.getElementById('dash-nivel-' + ugcId);
      if (el) el.innerHTML = '<span style="color:var(--text3)">—</span>';
    }
  },

  /* ══════════════════════════════════════════════════
     DIRECTORIO UGCs (ADMIN)
  ══════════════════════════════════════════════════ */
  cargarListaUGCs() {
    App._renderUGCsGrid(UGCS);
  },

  filtrarUGCs() {
    const q      = document.getElementById('ugc-search').value.toLowerCase();
    const fase   = document.getElementById('ugc-filtro-fase').value;
    const ambito = document.getElementById('ugc-filtro-ambito').value;

    const filtradas = UGCS.filter(u => {
      if (fase   && u.fase   !== fase)   return false;
      if (ambito && u.ambito !== ambito) return false;
      if (q && !`${u.denominacion} ${u.ubicacion} ${u.codigo_acsa || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    App._renderUGCsGrid(filtradas);
  },

  _renderUGCsGrid(lista) {
    const el = document.getElementById('ugcs-grid');
    if (!lista.length) {
      el.innerHTML = '<div class="empty-state"><h3>Sin resultados</h3><p>Prueba a cambiar los filtros.</p></div>';
      return;
    }
    el.innerHTML = lista.map(u => {
      const cardCls = App._faseCardCls(u.fase);
      return `
      <div class="ugc-card ${cardCls}" onclick="App.abrirFichaUGC('${u.id}')">
        <div class="ugc-card-top">
          <div>
            <div class="ugc-nombre">${u.denominacion}</div>
            <div class="ugc-ubicacion">${u.ubicacion}</div>
          </div>
          <span class="ugc-ambito-tag">${u.ambito_label}</span>
        </div>
        ${u.direccion ? `<div style="font-size:11px;color:var(--text3);margin-bottom:8px">📍 ${u.direccion}</div>` : ''}
        <div class="ugc-fase-row">
          ${App._faseBadge(u.fase)}
          ${u.codigo_acsa ? `<span style="font-size:11px;color:var(--text3)">${u.codigo_acsa}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  _faseBadge(fase) {
    const clases = {
      'Sin solicitar':                'fase-sin',
      'Solicitud de Certificación':   'fase-activa',
      'Autoevaluación':               'fase-activa',
      'Evaluación':                   'fase-eval',
      'Pendiente de estabilización':  'fase-estab',
      'Seguimiento':                  'fase-activa',
      'Recertificación':              'fase-recert',
    };
    const cls = clases[fase] || 'fase-sin';
    return `<span class="fase-badge ${cls}">${fase || 'Sin solicitar'}</span>`;
  },

  _faseCardCls(fase) {
    const mapa = {
      'Sin solicitar':               '',
      'Solicitud de Certificación':  'ugc-card-solicitud',
      'Autoevaluación':              'ugc-card-autoev',
      'Evaluación':                  'ugc-card-eval',
      'Pendiente de estabilización': 'ugc-card-estab',
      'Seguimiento':                 'ugc-card-seguim',
      'Recertificación':             'ugc-card-recert',
    };
    return mapa[fase] || '';
  },

  _alertasCertHtml(ugc) {
    const alertas = [];

    // Pendiente de estabilización (máx. 6 meses)
    if (ugc.fase === 'Pendiente de estabilización' && ugc.fecha_inicio_fase) {
      const inicio = new Date(ugc.fecha_inicio_fase + 'T00:00:00');
      const diasPasados   = Math.round((new Date() - inicio) / 86400000);
      const diasRestantes = 180 - diasPasados;
      if (diasRestantes < 0) {
        alertas.push({ c: '#b03030', i: '🔴', t: `Plazo de estabilización vencido hace ${Math.abs(diasRestantes)} días. Contactar con ACSA urgentemente.` });
      } else {
        alertas.push({ c: '#b06000', i: '⏳', t: `Pendiente de estabilización: ${diasRestantes} días restantes para subsanar obligatorios (máx. 6 meses).` });
      }
    }

    // Autoevaluación muy larga (máx. 12 meses)
    if (ugc.fase === 'Autoevaluación' && ugc.fecha_inicio_fase) {
      const inicio = new Date(ugc.fecha_inicio_fase + 'T00:00:00');
      const dias   = Math.round((new Date() - inicio) / 86400000);
      if (dias > 300) {
        const meses = Math.round(dias / 30);
        alertas.push({ c: '#b06000', i: '⚠️', t: `Autoevaluación en curso hace ${meses} meses (máximo: 12). Planificar visita de evaluación.` });
      }
    }

    // Alertas por fecha de certificación
    const fechaCertStr = ugc.fecha_certificacion || ugc.fecha_fin;
    if (fechaCertStr && ['Seguimiento', 'Recertificación'].includes(ugc.fase)) {
      const f = calcularFechasACSA(fechaCertStr);
      if (f) {
        const { diasHastaVenc, diasHastaSeg, seg, venc } = f;
        const strVenc = fmtFechaStr(venc.toISOString().split('T')[0]);
        const strSeg  = fmtFechaStr(seg.toISOString().split('T')[0]);
        if (diasHastaVenc < 0) {
          alertas.push({ c: '#b03030', i: '🔴', t: `Certificado VENCIDO hace ${Math.abs(diasHastaVenc)} días (venció: ${strVenc}).` });
        } else if (diasHastaVenc < 90) {
          alertas.push({ c: '#b03030', i: '🔴', t: `Vence en ${diasHastaVenc} días (${strVenc}). Renovación urgente.` });
        } else if (diasHastaVenc < 365) {
          const meses = Math.round(diasHastaVenc / 30);
          alertas.push({ c: '#b06000', i: '⚠️', t: `Vence el ${strVenc} (en ${meses} meses). Iniciar proceso de renovación con ACSA.` });
        }
        if (diasHastaSeg < 0 && diasHastaVenc > 0) {
          alertas.push({ c: '#1e5b8c', i: '📋', t: `Visita de seguimiento (2,5 años) pendiente desde ${strSeg}. Coordinar con ACSA.` });
        } else if (diasHastaSeg >= 0 && diasHastaSeg < 90) {
          alertas.push({ c: '#1e5b8c', i: '📋', t: `Visita de seguimiento próxima: ${strSeg} (en ${diasHastaSeg} días).` });
        }
      }
    }

    if (!alertas.length) return '';
    return `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
      ${alertas.map(a =>
        `<div style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;background:${a.c}18;border-left:3px solid ${a.c};border-radius:0 6px 6px 0;font-size:13px;color:${a.c}">
          <span style="flex-shrink:0">${a.i}</span><span>${a.t}</span>
        </div>`
      ).join('')}
    </div>`;
  },

  /* ══════════════════════════════════════════════════
     FICHA UGC (ADMIN)
  ══════════════════════════════════════════════════ */
  async abrirFichaUGC(ugcId) {
    App._ugcActual = ugcId;
    const ugc = UGCS.find(u => u.id === ugcId);
    if (!ugc) return;

    document.getElementById('ficha-titulo').textContent    = ugc.denominacion;
    document.getElementById('ficha-subtitulo').textContent = ugc.ubicacion + ' · ' + ugc.ambito_label;

    // Modo gestor: ocultar controles de gestión
    const modoLectura = isGestor();
    const btnNuevaReunion = document.querySelector('#view-ficha-ugc .btn-secondary');
    if (btnNuevaReunion) btnNuevaReunion.style.display = modoLectura ? 'none' : '';
    const tabMsgs = document.querySelector('#view-ficha-ugc .tab[data-tab="mensajes-ugc"]');
    if (tabMsgs) tabMsgs.style.display = modoLectura ? 'none' : '';

    // Mostrar vista ficha
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById('view-ficha-ugc').style.display = 'block';

    // Resetear tabs al primero (estándares)
    document.querySelectorAll('#view-ficha-ugc .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#view-ficha-ugc .tab-content').forEach(t => t.style.display = 'none');
    const tabBtn = document.querySelector('#view-ficha-ugc .tab[data-tab="estandares"]');
    if (tabBtn) tabBtn.classList.add('active');
    const tabEl = document.getElementById('tab-estandares');
    if (tabEl) tabEl.style.display = 'block';

    // Cargar progreso
    await App._cargarProgresoUGC(ugcId, 'ficha-progreso');

    // Cargar estándares del tab activo
    App.cargarEstandaresUGC(ugcId);
  },

  async _cargarProgresoUGC(ugcId, elId) {
    const el = document.getElementById(elId);
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('estandares').get();

      // Combinar con STANDARDS para tener grupo y obligatorio
      const estadosMap = {};
      snap.forEach(doc => { estadosMap[doc.id] = doc.data().estado || 'pendiente'; });

      const estandaresConEstado = (typeof STANDARDS !== 'undefined') ? STANDARDS.map(s => ({ ...s, estado: estadosMap[s.codigo] || 'pendiente' })) : [];

      const nivel = estandaresConEstado.length ? calcularNivel(estandaresConEstado) : { nivel: 'Sin datos', color: '#9e9890', pctOblig: 0, pctGI: 0, pctGII: 0, pctGIII: 0, cumpleObligatorios: 0, totalObligatorios: 31, cumpleGI: 0, totalGI: 19, cumpleGII: 0, totalGII: 18, cumpleGIII: 0, totalGIII: 8 };

      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <span class="progreso-nivel" style="background:${nivel.color}20;color:${nivel.color}">
            🏆 ${nivel.nivel}
          </span>
          <small style="color:var(--text2)">${snap.size} estándares registrados de 76</small>
        </div>
        <div class="progreso-barras">
          ${App._barraProgreso('Obligatorios', nivel.cumpleObligatorios, nivel.totalObligatorios, '#b03030', nivel.pctOblig)}
          ${App._barraProgreso('Grupo I',  nivel.cumpleGI,   nivel.totalGI,   '#2d7a4f', nivel.pctGI)}
          ${App._barraProgreso('Grupo II', nivel.cumpleGII,  nivel.totalGII,  '#1e5b8c', nivel.pctGII)}
          ${App._barraProgreso('Grupo III',nivel.cumpleGIII, nivel.totalGIII, '#5c2d7a', nivel.pctGIII)}
        </div>
        ${App._roadmapHtml(nivel)}`;
    } catch(e) {
      el.innerHTML = '<p style="color:var(--text2);font-size:13px">Error al cargar progreso.</p>';
    }
  },

  _barraProgreso(label, cumple, total, color, pct) {
    return `
      <div class="progreso-row">
        <div class="progreso-label">
          <span>${label}</span>
          <span style="color:${color};font-weight:700">${cumple}/${total} · ${pct}%</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
  },

  _roadmapHtml(nv) {
    if (nv.nivel === 'Excelente') {
      return `<div class="roadmap-card" style="border-color:#5c2d7a">
        <div class="roadmap-titulo" style="color:#5c2d7a">🏆 Nivel máximo alcanzado</div>
        <p style="color:var(--text2);font-size:13px;margin:4px 0 0">La UGC ha completado todos los requisitos de certificación ACSA.</p>
      </div>`;
    }

    const pasos = [];
    let siguiente = '';
    let color = '#9e9890';

    if (nv.nivel === 'En Proceso') {
      siguiente = 'Avanzado'; color = '#2d7a4f';
      const faltanOblig = nv.totalObligatorios - nv.cumpleObligatorios;
      const sOb = faltanOblig > 1 ? 's' : '';
      const txOb = `<strong>${faltanOblig} obligatorio${sOb} pendiente${sOb}</strong> (${nv.cumpleObligatorios}/${nv.totalObligatorios})`;
      pasos.push(faltanOblig > 0 ? `<li>✗ ${txOb}</li>` : '<li>✅ Todos los obligatorios cumplidos</li>');
      const minGI = Math.ceil(nv.totalGI * 0.70);
      const faltanGI = Math.max(0, minGI - nv.cumpleGI);
      const sGI1 = faltanGI > 1 ? 'es' : '';
      const txGI1 = `<strong>${faltanGI} estándar${sGI1} más de Grupo I</strong> (${nv.cumpleGI}/${nv.totalGI} · mínimo 70% = ${minGI})`;
      pasos.push(faltanGI > 0 ? `<li>✗ ${txGI1}</li>` : '<li>✅ Grupo I al 70% cumplido</li>');
    } else if (nv.nivel === 'Avanzado') {
      siguiente = 'Óptimo'; color = '#1e5b8c';
      const faltanGI = nv.totalGI - nv.cumpleGI;
      const sGI2 = faltanGI > 1 ? 'es' : '';
      const txGI2 = `<strong>${faltanGI} estándar${sGI2} de Grupo I</strong> pendientes (${nv.cumpleGI}/${nv.totalGI})`;
      pasos.push(faltanGI > 0 ? `<li>✗ ${txGI2}</li>` : '<li>✅ Grupo I al 100% cumplido</li>');
      const minGII = Math.ceil(nv.totalGII * 0.40);
      const faltanGII = Math.max(0, minGII - nv.cumpleGII);
      const sGII1 = faltanGII > 1 ? 'es' : '';
      const txGII1 = `<strong>${faltanGII} estándar${sGII1} más de Grupo II</strong> (${nv.cumpleGII}/${nv.totalGII} · mínimo 40% = ${minGII})`;
      pasos.push(faltanGII > 0 ? `<li>✗ ${txGII1}</li>` : '<li>✅ Grupo II al 40% cumplido</li>');
    } else if (nv.nivel === 'Óptimo') {
      siguiente = 'Excelente'; color = '#5c2d7a';
      const faltanGII = nv.totalGII - nv.cumpleGII;
      const sGII2 = faltanGII > 1 ? 'es' : '';
      const txGII2 = `<strong>${faltanGII} estándar${sGII2} de Grupo II</strong> pendientes (${nv.cumpleGII}/${nv.totalGII})`;
      pasos.push(faltanGII > 0 ? `<li>✗ ${txGII2}</li>` : '<li>✅ Grupo II al 100% cumplido</li>');
      const minGIII = Math.ceil(nv.totalGIII * 0.40);
      const faltanGIII = Math.max(0, minGIII - nv.cumpleGIII);
      const sGIII = faltanGIII > 1 ? 'es' : '';
      const txGIII = `<strong>${faltanGIII} estándar${sGIII} más de Grupo III</strong> (${nv.cumpleGIII}/${nv.totalGIII} · mínimo 40% = ${minGIII})`;
      pasos.push(faltanGIII > 0 ? `<li>✗ ${txGIII}</li>` : '<li>✅ Grupo III al 40% cumplido</li>');
    }

    return `<div class="roadmap-card" style="border-color:${color}">
      <div class="roadmap-titulo" style="color:${color}">Hoja de ruta → ${siguiente}</div>
      <ul class="roadmap-lista">${pasos.join('')}</ul>
    </div>`;
  },

  async cargarEstandaresUGC(ugcId) {
    const el = document.getElementById('tab-estandares');
    if (!el) return;
    el.innerHTML = '<div class="loading">Cargando estándares…</div>';

    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId).collection('estandares').get();
      const estadosMap = {};
      snap.forEach(doc => { estadosMap[doc.id] = doc.data(); });

      if (typeof STANDARDS === 'undefined') {
        el.innerHTML = '<div class="empty-state"><p>STANDARDS no disponible.</p></div>';
        return;
      }

      App._estandaresAdminIdx = _buildSearchIdx(STANDARDS);

      App._estandaresAdminData    = { ugcId, estadosMap };
      App._estandaresAdminFiltros = { q: '', oblig: '', grupo: '', criterio: '', estado: '' };

      // Criterios únicos ordenados por bloque y número de criterio
      const criterios = [...new Map(
        STANDARDS.map(s => [`${s.bloque_num}_${s.criterio_num}`, s])
      ).values()].sort((a, b) => a.bloque_num - b.bloque_num || a.criterio_num - b.criterio_num);

      el.innerHTML = `
        <div class="filter-bar" style="margin-bottom:4px">
          <div class="search-wrap-m">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" id="eaf-search" placeholder="Buscar en cualquier campo…" oninput="App.filtrarEstandaresAdmin()">
          </div>
          <select id="eaf-oblig" onchange="App.filtrarEstandaresAdmin()">
            <option value="">Oblig. / No oblig.</option>
            <option value="Si">Solo obligatorios</option>
            <option value="No">No obligatorios</option>
          </select>
          <select id="eaf-grupo" onchange="App.filtrarEstandaresAdmin()">
            <option value="">Todos los grupos</option>
            <option value="I">Grupo I</option>
            <option value="II">Grupo II</option>
            <option value="III">Grupo III</option>
          </select>
          <select id="eaf-criterio" onchange="App.filtrarEstandaresAdmin()">
            <option value="">Todos los criterios</option>
            ${criterios.map(s => `<option value="${s.bloque_num}_${s.criterio_num}">B${s.bloque_num}·C${s.criterio_num} · ${escHtml(s.criterio_nombre)}</option>`).join('')}
          </select>
          <select id="eaf-estado" onchange="App.filtrarEstandaresAdmin()">
            <option value="">Todos los estados</option>
            <option value="cumple">✅ Cumple</option>
            <option value="propuesto">⏳ Propuesto</option>
            <option value="pendiente">⭕ Pendiente</option>
          </select>
        </div>
        <div id="eaf-count" style="font-size:12px;color:var(--text3);padding:4px 0 8px"></div>
        <div id="eaf-list"></div>`;

      App._renderEstandaresAdmin();
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar estándares.</p></div>';
    }
  },

  filtrarEstandaresAdmin() {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    App._estandaresAdminFiltros = {
      q:        g('eaf-search').toLowerCase(),
      oblig:    g('eaf-oblig'),
      grupo:    g('eaf-grupo'),
      criterio: g('eaf-criterio'),
      estado:   g('eaf-estado'),
    };
    App._renderEstandaresAdmin();
  },

  _renderEstandaresAdmin() {
    const listEl  = document.getElementById('eaf-list');
    const countEl = document.getElementById('eaf-count');
    if (!listEl || !App._estandaresAdminData) return;

    const { ugcId, estadosMap } = App._estandaresAdminData;
    const { q, oblig, grupo, criterio, estado } = App._estandaresAdminFiltros;

    const filtered = STANDARDS.filter((s, i) => {
      if (oblig    && s.obligatorio !== oblig)                               return false;
      if (grupo    && s.grupo       !== grupo)                               return false;
      if (criterio && `${s.bloque_num}_${s.criterio_num}` !== criterio)      return false;
      const st = (estadosMap[s.codigo] || {}).estado || 'pendiente';
      if (estado   && st !== estado)                                          return false;
      if (q        && !App._estandaresAdminIdx[i].includes(q))               return false;
      return true;
    });

    if (countEl) {
      const cumpleN = filtered.filter(s => (estadosMap[s.codigo] || {}).estado === 'cumple').length;
      countEl.textContent = `${filtered.length} de ${STANDARDS.length} estándares · ${cumpleN} cumplidos`;
    }

    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-state"><p>Sin resultados con estos filtros.</p></div>';
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const st       = estadosMap[s.codigo] || { estado: 'pendiente' };
      const estVal   = st.estado || 'pendiente';
      const dotClass = { cumple: 'dot-cumple', propuesto: 'dot-propuesto', pendiente: 'dot-pendiente' }[estVal] || 'dot-pendiente';
      const bdgClass = `badge-${estVal}`;
      const bdgLabel = { cumple: '✅ Cumple', propuesto: '⏳ Propuesto', pendiente: '⭕ Pendiente' }[estVal] || '⭕ Pendiente';
      return `
        <div class="estandar-item est-item-${estVal}" onclick="App.abrirModalEstandar('${s.codigo}','${ugcId}')">
          <div class="est-estado-dot ${dotClass}"></div>
          <div class="est-info">
            <span class="est-codigo">${s.codigo}</span>
            <div class="est-enunciado">${escHtml(s.enunciado)}</div>
            <small style="color:var(--text3)">B${s.bloque_num} · ${escHtml(s.criterio_nombre)}</small>
          </div>
          <div class="est-badges">
            <span class="badge badge-g${s.grupo}">G${s.grupo}</span>
            ${s.obligatorio === 'Si' ? '<span class="badge badge-oblig">Oblig.</span>' : ''}
            <span class="badge ${bdgClass}">${bdgLabel}</span>
          </div>
        </div>`;
    }).join('');
  },

  async cargarReunionesUGC(ugcId) {
    const el = document.getElementById('tab-reuniones');
    if (!el) return;
    el.innerHTML = '<div class="loading">Cargando reuniones…</div>';
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('reuniones').orderBy('fecha', 'desc').get();
      if (snap.empty) {
        el.innerHTML = '<div class="empty-state"><h3>Sin reuniones</h3><p>Crea la primera reunión de mentoría.</p></div>';
        return;
      }
      el.innerHTML = snap.docs.map(doc => {
        const d = doc.data();
        const tareas = (d.tareas || []).map((t, idx) => `
          <div class="tarea-item ${t.completada ? 'done' : ''}">
            <input type="checkbox" class="tarea-check" ${t.completada?'checked':''} onchange="App.toggleTarea('${ugcId}','${doc.id}',${idx},this.checked)">
            <span>${escHtml(t.descripcion)}</span>
            ${t.responsable ? `<span style="color:var(--text3)">— ${escHtml(t.responsable)}</span>` : ''}
            ${t.plazo ? `<span style="color:var(--amber);margin-left:auto">${fmtFecha({toDate:()=>new Date(t.plazo)})}</span>` : ''}
          </div>`).join('');
        return `
          <div class="reunion-card">
            <div class="reunion-head">
              <span class="reunion-fecha">${fmtFecha(d.fecha)}</span>
              <span class="reunion-tipo">${escHtml(d.tipo || '')}</span>
              ${isAdmin() ? `<button class="btn-danger btn-sm" style="margin-left:auto" onclick="App.eliminarReunion('${ugcId}','${doc.id}')">🗑 Eliminar</button>` : ''}
            </div>
            ${d.acuerdos ? `<div class="reunion-acuerdos">${escHtml(d.acuerdos)}</div>` : ''}
            ${tareas ? `<div class="tareas-list">${tareas}</div>` : ''}
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar reuniones.</p></div>';
    }
  },

  async eliminarReunion(ugcId, reunionId) {
    if (!confirm('¿Eliminar esta reunión y todas sus tareas? Esta acción no se puede deshacer.')) return;
    try {
      await db.collection(COL.ugcs).doc(ugcId).collection('reuniones').doc(reunionId).delete();
      App.showToast('✅ Reunión eliminada');
      App.cargarReunionesUGC(ugcId);
    } catch(e) {
      App.showToast('❌ Error al eliminar: ' + e.message);
    }
  },

  _agruparHilos(docs) {
    const map = new Map();
    docs.forEach(doc => {
      const d      = doc.data();
      const hiloId = d.hilo_id || doc.id;
      // Capturar ugcId del path: ugcs/{ugcId}/mensajes/{msgId}
      const pathParts = doc.ref.path.split('/');
      const ugcId = pathParts.length >= 2 ? pathParts[1] : null;
      if (!map.has(hiloId)) map.set(hiloId, { id: hiloId, msgs: [] });
      map.get(hiloId).msgs.push({ id: doc.id, _ugcId: ugcId, ...d });
    });
    map.forEach(h => h.msgs.sort((a, b) => {
      const ta = a.fecha && a.fecha.toDate ? a.fecha.toDate().getTime() : 0;
      const tb = b.fecha && b.fecha.toDate ? b.fecha.toDate().getTime() : 0;
      return ta - tb;
    }));
    return [...map.values()].sort((a, b) => {
      const last = h => h.msgs[h.msgs.length - 1];
      const ta = last(a).fecha && last(a).fecha.toDate ? last(a).fecha.toDate().getTime() : 0;
      const tb = last(b).fecha && last(b).fecha.toDate ? last(b).fecha.toDate().getTime() : 0;
      return tb - ta;
    });
  },

  _msgHtml(m) {
    const esAdm = m.de_rol === 'admin';
    return `
      <div class="hilo-msg ${esAdm ? 'hilo-msg-admin' : ''}">
        <div class="mensaje-head">
          <span class="mensaje-de">${esAdm ? '🔑 ' : '🏥 '}${escHtml(m.de_nombre || m.de_uid)}</span>
          <span class="mensaje-date">${fmtFechaHora(m.fecha)}</span>
          ${m.tipo && !m.hilo_id ? `<span class="mensaje-tipo">${escHtml(m.tipo)}</span>` : ''}
        </div>
        ${m.estandar_ref ? `<div class="mensaje-estandar">📎 ${escHtml(m.estandar_ref)}</div>` : ''}
        <div class="mensaje-texto">${escHtml(m.texto)}</div>
      </div>`;
  },

  async cargarMensajesUGC(ugcId) {
    const el = document.getElementById('tab-mensajes-ugc');
    if (!el) return;
    el.innerHTML = '<div class="loading">Cargando mensajes…</div>';
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('mensajes').orderBy('fecha', 'asc').limit(60).get();
      if (snap.empty) {
        el.innerHTML = '<div class="empty-state"><p>Sin mensajes en esta unidad.</p></div>';
        return;
      }
      const hilos = App._agruparHilos(snap.docs);
      el.innerHTML = hilos.map(hilo => {
        const [first, ...replies] = hilo.msgs;
        const tieneNoLeido = hilo.msgs.some(m => !m.leido);
        return `
          <div class="hilo-card ${tieneNoLeido ? 'unread' : ''}">
            ${App._msgHtml(first)}
            ${replies.length ? `<div class="hilo-replies">${replies.map(r => App._msgHtml(r)).join('')}</div>` : ''}
            <div class="mensaje-actions">
              ${tieneNoLeido ? `<button class="btn-sm" onclick="App.marcarHiloLeido('${ugcId}','${hilo.id}','ugc')">Marcar leído</button>` : ''}
              <button class="btn-sm" onclick="App.toggleReplyForm('${hilo.id}')">💬 Responder</button>
              ${isAdmin() ? `<button class="btn-danger btn-sm" onclick="App.eliminarMensaje('${ugcId}','${first.id}','ugc')">🗑</button>` : ''}
            </div>
            <div class="hilo-reply-form" id="reply-form-${hilo.id}" style="display:none">
              <textarea id="reply-text-${hilo.id}" rows="3" placeholder="Escribe tu respuesta…"></textarea>
              <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">
                <button class="btn-secondary btn-sm" onclick="App.toggleReplyForm('${hilo.id}')">Cancelar</button>
                <button class="btn-primary" onclick="App.enviarRespuestaAdmin('${ugcId}','${hilo.id}')">Enviar respuesta</button>
              </div>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar mensajes.</p></div>';
    }
  },

  toggleReplyForm(hiloId) {
    const form = document.getElementById(`reply-form-${hiloId}`);
    if (!form) return;
    const visible = form.style.display !== 'none';
    form.style.display = visible ? 'none' : 'block';
    if (!visible) { const ta = document.getElementById(`reply-text-${hiloId}`); if(ta) ta.focus(); }
  },

  async enviarRespuestaAdmin(ugcId, hiloId) {
    const ta     = document.getElementById(`reply-text-${hiloId}`);
    const texto  = ta ? ta.value.trim() : '';
    if (!texto) { App.showToast('Escribe una respuesta antes de enviar'); return; }
    const perfil = getPerfil();
    const msg = {
      de_uid:      getUser().uid,
      de_nombre:   perfil.nombre,
      de_rol:      'admin',
      para:        ugcId,
      tipo:        'respuesta',
      texto,
      hilo_id:     hiloId,
      estandar_ref: null,
      fecha:       firebase.firestore.FieldValue.serverTimestamp(),
      leido:       false,
    };
    try {
      await db.collection(COL.ugcs).doc(ugcId).collection('mensajes').add(msg);
      App.showToast('✅ Respuesta enviada');
      App.cargarMensajesUGC(ugcId);
    } catch(e) {
      App.showToast('❌ Error al responder: ' + e.message);
    }
  },

  async marcarHiloLeido(ugcId, hiloId, origen) {
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('mensajes')
        .where('hilo_id', '==', hiloId).get();
      const batch = db.batch();
      // marcar el mensaje raíz también
      batch.update(db.collection(COL.ugcs).doc(ugcId).collection('mensajes').doc(hiloId), { leido: true });
      snap.forEach(doc => batch.update(doc.ref, { leido: true }));
      await batch.commit();
      if (origen === 'ugc')   App.cargarMensajesUGC(ugcId);
      else if (origen === 'admin') App.cargarMensajesAdmin();
      else App.cargarMisMensajes();
    } catch(e) { /* silencioso */ }
  },

  async eliminarMensaje(ugcId, msgId, origen) {
    if (!confirm('¿Eliminar este mensaje? Esta acción no se puede deshacer.')) return;
    try {
      await db.collection(COL.ugcs).doc(ugcId).collection('mensajes').doc(msgId).delete();
      App.showToast('✅ Mensaje eliminado');
      if (origen === 'admin') App.cargarMensajesAdmin();
      else App.cargarMensajesUGC(ugcId);
    } catch(e) {
      App.showToast('❌ Error al eliminar: ' + e.message);
    }
  },

  async cargarInfoUGC(ugcId) {
    const ugc = UGCS.find(u => u.id === ugcId);
    const el  = document.getElementById('tab-info-ugc');
    if (!el || !ugc) return;
    el.innerHTML = '<div class="loading">Cargando…</div>';

    let ugcFs = {};
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId).get();
      if (snap.exists) ugcFs = snap.data();
    } catch(e) {}

    let responsables = [];
    try {
      const snap = await db.collection(COL.usuarios).where('ugc_id', '==', ugcId).get();
      snap.forEach(doc => responsables.push({ uid: doc.id, ...doc.data() }));
    } catch(e) {}

    App._infoUGCData = { ugc, ugcFs, responsables };
    App._mostrarInfoUGC(false);
    App.cargarHistorialFases(ugcId);
  },

  _mostrarInfoUGC(editMode) {
    const el = document.getElementById('tab-info-ugc');
    if (!el || !App._infoUGCData) return;
    const { ugc, ugcFs, responsables } = App._infoUGCData;
    const ugcId = ugc.id;
    const v = campo => (ugcFs[campo] !== undefined && ugcFs[campo] !== null) ? ugcFs[campo] : (ugc[campo] || '');

    const faseOpts = ['Sin solicitar','Solicitud de Certificación','Autoevaluación','Evaluación','Pendiente de estabilización','Seguimiento','Recertificación']
      .map(f => `<option value="${f}" ${ugc.fase===f?'selected':''}>${f}</option>`).join('');

    const respHtml = responsables.length ?
      responsables.map(r => `
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;min-width:160px">
              <div style="font-size:13px;font-weight:600">${escHtml(r.nombre)}</div>
              <div style="font-size:11px;color:var(--text3)">${escHtml(r.cargo || '—')}</div>
            </div>
            ${r.email ? `<a href="mailto:${escHtml(r.email)}" style="font-size:12px;color:var(--accent2)">${escHtml(r.email)}</a>` : ''}
            ${r.telefono_whatsapp ? `<a href="https://wa.me/34${r.telefono_whatsapp}" target="_blank" class="btn-wa-sm">📱 ${escHtml(String(r.telefono_whatsapp))}</a>` : ''}
          </div>`).join('')
      : `<p style="font-size:13px;color:var(--text3);padding:8px 0">Ningún usuario asignado a esta UGC.
           <button class="btn-link" onclick="App.navigate('usuarios')" style="font-size:13px;color:var(--accent2);background:none;border:none;cursor:pointer;text-decoration:underline">Ir a Gestión de Usuarios →</button>
         </p>`;

    if (editMode) {
      el.innerHTML = `
        <div style="margin-bottom:24px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h4 style="font-size:13px;font-weight:600;margin:0">Editar información</h4>
            <div style="display:flex;gap:8px">
              <button class="btn-primary" onclick="App.guardarInfoUGC('${ugcId}')">Guardar cambios</button>
              <button class="btn-secondary" onclick="App._mostrarInfoUGC(false)">Cancelar</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
            ${App._inputField('Denominación', 'ei-nombre',    v('denominacion') || ugc.denominacion)}
            ${App._inputField('Código ACSA',  'ei-codigo',    v('codigo_acsa')  || ugc.codigo_acsa)}
            ${App._inputField('Ubicación',    'ei-ubicacion', v('ubicacion')    || ugc.ubicacion)}
            ${App._inputField('Dirección',    'ei-direccion', v('direccion'))}
            ${App._inputField('Teléfono',     'ei-telefono',  v('telefono1'))}
            ${App._inputField('Correo',       'ei-correo',    v('correo'))}
            ${App._inputField('Web',          'ei-web',       v('web'))}
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px">Responsables del proyecto</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
              ${App._inputField('Director/a UGC',           'ei-director',    v('director_nombre'))}
              ${App._inputField('Responsable del proyecto',  'ei-responsable', v('responsable_proyecto_nombre'))}
              ${App._inputField('Tipo de proyecto',          'ei-tipo-proy',   v('tipo_proyecto'))}
            </div>
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px">Ciclo completo de acreditación ACSA</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
              ${App._dateField('Solicitud',                'ei-fecha-solic',   v('fecha_solicitud'))}
              ${App._dateField('Autoevaluación desde',     'ei-autoev-desde',  v('fecha_autoevaluacion_desde'))}
              ${App._dateField('Autoevaluación hasta',     'ei-autoev-hasta',  v('fecha_autoevaluacion_hasta'))}
              ${App._dateField('Evaluación prevista',      'ei-fecha-prev',    v('fecha_prevista'))}
              ${App._dateField('Resp. Solicitante desde',  'ei-resp-desde',    v('fecha_resp_solicitante_desde'))}
              ${App._dateField('Resp. Solicitante hasta',  'ei-resp-hasta',    v('fecha_resp_solicitante_hasta'))}
              ${App._dateField('Certificación',            'ei-fecha-cert',    v('fecha_certificacion') || ugc.fecha_fin || '')}
              <div>
                <label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:4px">Nivel certificado</label>
                <select id="ei-nivel-cert" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
                  <option value="">— Sin certificar —</option>
                  ${['Avanzado','Óptimo','Excelente'].map(n => `<option value="${n}" ${v('nivel_certificado')===n?'selected':''}>${n}</option>`).join('')}
                </select>
              </div>
              ${App._dateField('Seguimiento (visita real)', 'ei-fecha-seg',    v('fecha_seguimiento'))}
              ${App._dateField('Apercibimiento desde',     'ei-aperc-desde',  v('fecha_apercibimiento_desde'))}
              ${App._dateField('Apercibimiento hasta',     'ei-aperc-hasta',  v('fecha_apercibimiento_hasta'))}
            </div>
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Otras ubicaciones</div>
            <textarea id="ei-otras-ubic" rows="4" placeholder="Una ubicación por línea…" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box">${escHtml((Array.isArray(v('otras_ubicaciones')) ? v('otras_ubicaciones') : []).join('\n'))}</textarea>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">Una ubicación por línea</div>
          </div>
          <div style="margin-top:12px">
            <label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:4px">Observaciones</label>
            <textarea id="ei-observaciones" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;resize:vertical">${escHtml(v('observaciones'))}</textarea>
          </div>
        </div>
        <div style="padding-top:16px;border-top:1px solid var(--border)">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:10px">👤 Responsables de la unidad</h4>
          ${respHtml}
        </div>`;
    } else {
      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
          <h4 style="font-size:13px;font-weight:600;margin:0">Información de la unidad</h4>
          ${isGestor() ? '' : `<button class="btn-sm" onclick="App._mostrarInfoUGC(true)">✏️ Editar</button>`}
        </div>
        ${App._alertasCertHtml({ ...ugc, ...ugcFs })}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;padding:8px 0">
          ${App._infoRow('ID',          ugc.id)}
          ${App._infoRow('Código ACSA', v('codigo_acsa') || ugc.codigo_acsa || '—')}
          ${App._infoRow('Ámbito',      ugc.ambito_label)}
          ${App._infoRow('Denominación',v('denominacion') || ugc.denominacion)}
          ${App._infoRow('Ubicación',   v('ubicacion')    || ugc.ubicacion)}
          ${App._infoRow('Fase',        ugc.fase)}
          ${App._infoRow('Estado',      ugc.estado_fase || '—')}
          ${ugc.fecha_inicio_fase ? App._infoRow('Inicio fase actual', fmtFechaStr(ugc.fecha_inicio_fase) + ` (${Math.round((new Date() - new Date(ugc.fecha_inicio_fase + 'T00:00:00')) / 86400000)} días)`) : ''}
          ${v('fecha_prevista') ? App._infoRow('Evaluación prevista', fmtFechaStr(v('fecha_prevista'))) : ''}
          ${App._infoRow('Dirección',   v('direccion') || ugc.direccion || '—')}
          ${App._infoRow('Teléfono',    v('telefono1')  || ugc.telefono1 || '—')}
          ${App._infoRow('Correo',      v('correo')     || ugc.correo   || '—')}
          ${(v('web') || ugc.web) ? `<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Web</label><a href="${escHtml(v('web')||ugc.web)}" target="_blank" style="color:var(--accent2);font-size:13px">${escHtml(v('web')||ugc.web)}</a></div>` : ''}
          ${(v('observaciones')||ugc.observaciones) ? App._infoRow('Observaciones', v('observaciones')||ugc.observaciones) : ''}
        </div>
        ${(() => {
          const fechaCertStr = v('fecha_certificacion') || ugc.fecha_fin;
          const tieneNuevasFechas = v('fecha_solicitud') || v('fecha_autoevaluacion_desde') ||
            v('fecha_resp_solicitante_desde') || v('fecha_seguimiento') || v('fecha_apercibimiento_desde');

          let html = '<div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:8px">';
          html += '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px">Ciclo completo de acreditación ACSA</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">';

          if (v('tipo_proyecto')) html += App._infoRow('Tipo', v('tipo_proyecto'));
          if (v('fecha_solicitud'))               html += App._infoRow('Solicitud',               fmtFechaStr(v('fecha_solicitud')));
          if (v('fecha_autoevaluacion_desde'))     html += App._infoRow('Autoevaluación desde',    fmtFechaStr(v('fecha_autoevaluacion_desde')));
          if (v('fecha_autoevaluacion_hasta'))     html += App._infoRow('Autoevaluación hasta',    fmtFechaStr(v('fecha_autoevaluacion_hasta')));
          if (v('fecha_prevista'))                 html += App._infoRow('Evaluación prevista',     fmtFechaStr(v('fecha_prevista')));
          if (v('fecha_resp_solicitante_desde'))   html += App._infoRow('Resp. Solicitante desde', fmtFechaStr(v('fecha_resp_solicitante_desde')));
          if (v('fecha_resp_solicitante_hasta'))   html += App._infoRow('Resp. Solicitante hasta', fmtFechaStr(v('fecha_resp_solicitante_hasta')));

          if (fechaCertStr) {
            html += App._infoRow('Certificación', fmtFechaStr(fechaCertStr));
            if (v('nivel_certificado')) html += App._infoRow('Nivel certificado', v('nivel_certificado'));
            if (v('fecha_seguimiento')) {
              html += App._infoRow('Seguimiento (real)', fmtFechaStr(v('fecha_seguimiento')));
            } else {
              const f = calcularFechasACSA(fechaCertStr);
              if (f) html += App._infoRow('Seguimiento (calc.)', fmtFechaStr(f.seg.toISOString().split('T')[0]));
            }
            if (v('fecha_apercibimiento_desde'))  html += App._infoRow('Apercibimiento desde', fmtFechaStr(v('fecha_apercibimiento_desde')));
            if (v('fecha_apercibimiento_hasta'))  html += App._infoRow('Apercibimiento hasta', fmtFechaStr(v('fecha_apercibimiento_hasta')));
            const fACSA = calcularFechasACSA(fechaCertStr);
            if (fACSA) {
              html += App._infoRow('Inicio renovación (~4 a.)', fmtFechaStr(fACSA.renovar.toISOString().split('T')[0]));
              html += App._infoRow('Vencimiento (5 años)',       fmtFechaStr(fACSA.venc.toISOString().split('T')[0]));
            }
          } else if (!tieneNuevasFechas) {
            html += '<div style="font-size:12px;color:var(--text3);padding:4px 0">Sin fechas registradas. Importa la Ficha de Proyecto PDF o edita manualmente.</div>';
          }

          html += '</div></div>';
          return html;
        })()}

        ${(() => {
          const dir = v('director_nombre');
          const res = v('responsable_proyecto_nombre');
          if (!dir && !res) return '';
          return `<div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px">Responsables del proyecto</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
              ${dir ? App._infoRow('Director/a UGC', dir) : ''}
              ${res ? App._infoRow('Responsable del proyecto', res) : ''}
            </div>
          </div>`;
        })()}

        ${(() => {
          const ubics = Array.isArray(v('otras_ubicaciones')) ? v('otras_ubicaciones') : [];
          if (!ubics.length) return '';
          return `<div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Otras ubicaciones (${ubics.length})</div>
            <ul style="margin:0;padding-left:18px">
              ${ubics.map(u => `<li style="font-size:13px;padding:2px 0">${escHtml(u)}</li>`).join('')}
            </ul>
          </div>`;
        })()}

        ${(() => {
          const hist = Array.isArray(ugcFs.historico_certificaciones) ? ugcFs.historico_certificaciones : [];
          if (!hist.length) return '';
          return `<div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Histórico de certificaciones</div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead><tr style="background:var(--surface)">
                  <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Código</th>
                  <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Estado</th>
                  <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Fase</th>
                  <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Obtención</th>
                  <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Vencimiento</th>
                </tr></thead>
                <tbody>${hist.map(h => `<tr>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:monospace">${escHtml(h.codigo)}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${escHtml(h.estado)}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${escHtml(h.fase)}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${fmtFechaStr(h.fecha_obtencion)}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${fmtFechaStr(h.fecha_vencimiento)}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>`;
        })()}

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:12px">Cambiar fase del proceso</h4>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <select id="nueva-fase-sel" style="padding:8px 12px">${faseOpts}</select>
            <button class="btn-primary" onclick="App.guardarFaseUGC('${ugcId}')">Guardar fase</button>
          </div>
        </div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:10px">👤 Responsables de la unidad</h4>
          ${respHtml}
        </div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:10px">📋 Historial de fases</h4>
          <div id="historial-fases-list"><div class="loading">Cargando…</div></div>
        </div>`;
    }
  },

  _inputField(label, id, value) {
    return `<div>
      <label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:4px">${label}</label>
      <input type="text" id="${id}" value="${escHtml(value || '')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
    </div>`;
  },

  _dateField(label, id, value) {
    return `<div>
      <label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:4px">${label}</label>
      <input type="date" id="${id}" value="${escHtml(value || '')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
    </div>`;
  },

  async guardarInfoUGC(ugcId) {
    const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const otrasRaw = g('ei-otras-ubic');
    const otras = otrasRaw ? otrasRaw.split('\n').map(l => l.trim()).filter(l => l.length > 0) : null;
    const data = {
      denominacion:                  g('ei-nombre'),
      codigo_acsa:                   g('ei-codigo'),
      ubicacion:                     g('ei-ubicacion'),
      direccion:                     g('ei-direccion'),
      telefono1:                     g('ei-telefono'),
      correo:                        g('ei-correo'),
      web:                           g('ei-web'),
      observaciones:                 g('ei-observaciones'),
      tipo_proyecto:                 g('ei-tipo-proy')     || null,
      director_nombre:              g('ei-director')      || null,
      responsable_proyecto_nombre:  g('ei-responsable')   || null,
      fecha_certificacion:           g('ei-fecha-cert')   || null,
      nivel_certificado:             g('ei-nivel-cert')   || null,
      fecha_prevista:                g('ei-fecha-prev')   || null,
      fecha_solicitud:               g('ei-fecha-solic')  || null,
      fecha_autoevaluacion_desde:    g('ei-autoev-desde') || null,
      fecha_autoevaluacion_hasta:    g('ei-autoev-hasta') || null,
      fecha_resp_solicitante_desde:  g('ei-resp-desde')   || null,
      fecha_resp_solicitante_hasta:  g('ei-resp-hasta')   || null,
      fecha_seguimiento:             g('ei-fecha-seg')    || null,
      fecha_apercibimiento_desde:    g('ei-aperc-desde')  || null,
      fecha_apercibimiento_hasta:    g('ei-aperc-hasta')  || null,
      otras_ubicaciones:             otras,
    };
    try {
      await db.collection(COL.ugcs).doc(ugcId).set(data, { merge: true });
      const ugc = UGCS.find(u => u.id === ugcId);
      if (ugc) Object.assign(ugc, data);
      if (App._infoUGCData) Object.assign(App._infoUGCData.ugcFs, data);
      App._mostrarInfoUGC(false);
      App.showToast('✅ Información guardada correctamente');
    } catch(e) {
      App.showToast('❌ Error al guardar: ' + e.message);
    }
  },

  _infoRow(label, value) {
    return `<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">${label}</label><span style="font-size:13px;font-weight:500">${escHtml(String(value))}</span></div>`;
  },

  async guardarFaseUGC(ugcId) {
    const fase = document.getElementById('nueva-fase-sel').value;
    const ugc  = UGCS.find(u => u.id === ugcId);
    const faseAnterior = ugc ? ugc.fase : '';
    const hoy = new Date().toISOString().split('T')[0];
    try {
      await db.collection(COL.ugcs).doc(ugcId).set({ fase, fecha_inicio_fase: hoy }, { merge: true });
      await db.collection(COL.ugcs).doc(ugcId).collection('historial_fases').add({
        fase_anterior: faseAnterior,
        fase_nueva:    fase,
        fecha:         firebase.firestore.FieldValue.serverTimestamp(),
        cambiado_por:  getUser().email,
      });
      if (ugc) { ugc.fase = fase; ugc.fecha_inicio_fase = hoy; }
      if (App._infoUGCData) {
        App._infoUGCData.ugc.fase = fase;
        App._infoUGCData.ugc.fecha_inicio_fase = hoy;
      }
      App.showToast('✅ Fase actualizada correctamente');
      App._mostrarInfoUGC(false);
      App.cargarHistorialFases(ugcId);
    } catch(e) {
      App.showToast('❌ Error al guardar la fase');
    }
  },

  /* ══════════════════════════════════════════════════
     MODAL ESTÁNDAR
  ══════════════════════════════════════════════════ */
  async abrirModalEstandar(codigo, ugcId) {
    const est = typeof STANDARDS !== 'undefined' ? STANDARDS.find(s => s.codigo === codigo) : null;
    if (!est) return;

    const overlay = document.getElementById('modal-estandar');
    const content = document.getElementById('modal-estandar-content');

    content.innerHTML = '<div class="loading">Cargando…</div>';
    overlay.classList.add('open');

    try {
      const doc = await db.collection(COL.ugcs).doc(ugcId).collection('estandares').doc(codigo).get();
      const d = doc.exists ? doc.data() : { estado: 'pendiente', evidencia_texto: '', documento_mejora_c: '' };
      App._modalEstadoInicial = d.estado || 'pendiente';

      content.innerHTML = `
          <div class="modal-est-codigo">${est.codigo}</div>
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <span class="badge badge-g${est.grupo}">Grupo ${est.grupo}</span>
            ${est.obligatorio === 'Si' ? '<span class="badge badge-oblig">Obligatorio</span>' : ''}
            <span class="badge badge-${d.estado || 'pendiente'}">${{cumple:'✅ Cumple',propuesto:'⏳ Propuesto',pendiente:'⭕ Pendiente'}[d.estado]||'Pendiente'}</span>
          </div>
          <div class="modal-est-enunciado">${escHtml(est.enunciado)}</div>
          <div class="modal-est-proposito">${escHtml(est.proposito)}</div>

          ${est.criterios_evaluables && est.criterios_evaluables.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Criterios evaluables</div>
            ${est.criterios_evaluables.map((ce,i)=>`
              <div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:11px;font-weight:700;color:var(--accent2);min-width:20px">${i+1}.</span>
                <span style="font-size:13px;color:var(--text2);line-height:1.5">${escHtml(ce.replace(/X$/,''))}</span>
              </div>`).join('')}
          </div>` : ''}

          <div class="evidencia-block">
            <label>Estado del estándar</label>
            ${isGestor() ? `<div style="padding:9px 12px;margin-bottom:10px;background:var(--surface2);border-radius:var(--radius-sm);font-size:13px;color:var(--text2)">Modo solo lectura — vista de Gestor</div>` : `
            <select id="modal-est-estado" style="width:100%;padding:9px 12px;margin-bottom:10px">
              <option value="pendiente" ${d.estado==='pendiente'?'selected':''}>⭕ Pendiente</option>
              ${isAdmin() ? `<option value="cumple" ${d.estado==='cumple'?'selected':''}>✅ Cumple (validado)</option>` : ''}
              <option value="propuesto" ${d.estado==='propuesto'?'selected':''}>⏳ Propuesto a cumple</option>
            </select>`}
            <label>Evidencia / descripción</label>
            <div class="campo-expand-wrap">
              <textarea class="campo-expandible" id="modal-est-evidencia" rows="4" data-expanded="0"
                placeholder="Describe brevemente la evidencia disponible en MejoraC…">${escHtml(d.evidencia_texto || '')}</textarea>
              <button class="campo-expand-btn" type="button" aria-label="Expandir"
                onclick="App._expandirCampo('modal-est-evidencia',this)" title="Expandir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </div>
            <label>Nombre del documento/s en Mejora C</label>
            <div class="campo-expand-wrap">
              <textarea class="campo-expandible" id="modal-est-documento" rows="4" data-expanded="0"
                placeholder="Un documento por línea: PLAN_CALIDAD_2025.pdf">${escHtml(normalizarDocs(d.documento_mejora_c))}</textarea>
              <button class="campo-expand-btn" type="button" aria-label="Expandir"
                onclick="App._expandirCampo('modal-est-documento',this)" title="Expandir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </div>
            <label>Área de mejora identificada</label>
            <div class="campo-expand-wrap">
              <textarea class="campo-expandible" id="modal-est-mejora" rows="4" data-expanded="0"
                placeholder="Describe qué se puede mejorar en relación a este estándar…">${escHtml(d.area_mejora || '')}</textarea>
              <button class="campo-expand-btn" type="button" aria-label="Expandir"
                onclick="App._expandirCampo('modal-est-mejora',this)" title="Expandir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </div>
          </div>

          ${d.validado_en ? `<div style="font-size:11px;color:var(--green);margin-bottom:14px">✅ Validado el ${fmtFecha(d.validado_en)}</div>` : ''}

          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button class="btn-secondary" onclick="App.cerrarModal('modal-estandar')">Cerrar</button>
            ${isGestor() ? '' : `<button class="btn-primary" onclick="App.guardarEstado('${ugcId}','${codigo}')">Guardar</button>`}
          </div>`;
    } catch(e) {
      content.innerHTML = '<div class="empty-state"><p>Error al cargar el estándar.</p></div>';
    }
  },

  async guardarEstado(ugcId, codigo) {
    const estado    = document.getElementById('modal-est-estado').value;
    const evidencia = document.getElementById('modal-est-evidencia').value.trim();
    const documento = document.getElementById('modal-est-documento').value.trim();
    const mejoraEl  = document.getElementById('modal-est-mejora');
    const mejora    = mejoraEl ? mejoraEl.value.trim() : '';
    const perfil    = getPerfil();

    const data = {
      estado,
      evidencia_texto:    evidencia,
      documento_mejora_c: documento,
      area_mejora:        mejora,
      actualizado_por:    getUser().uid,
      actualizado_en:     firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (estado === 'propuesto' && App._modalEstadoInicial !== 'propuesto') {
      data.propuesto_en = firebase.firestore.FieldValue.serverTimestamp();
    }
    if (estado === 'cumple' && isAdmin()) {
      data.validado_en  = firebase.firestore.FieldValue.serverTimestamp();
      data.validado_por = getUser().uid;
    }

    try {
      await db.collection(COL.ugcs).doc(ugcId)
        .collection('estandares').doc(codigo).set(data, { merge: true });

      // Si la UGC propone, notificar a admins
      if (estado === 'propuesto' && !isAdmin()) {
        await App._notificarAdmins(ugcId, codigo, perfil);
      }

      App.cerrarModal('modal-estandar');
      App.showToast('✅ Estado guardado correctamente');

      // Actualizar en caché local y re-renderizar sin resetear filtros
      if (App._estandaresAdminData && App._estandaresAdminData.ugcId === ugcId) {
        App._estandaresAdminData.estadosMap[codigo] = { ...App._estandaresAdminData.estadosMap[codigo], ...data };
        App._renderEstandaresAdmin();
        await App._cargarProgresoUGC(ugcId, 'ficha-progreso');
      } else if (App._misEstandaresData && App._misEstandaresData.ugcId === ugcId) {
        App._misEstandaresData.estadosMap[codigo] = { ...App._misEstandaresData.estadosMap[codigo], ...data };
        App._renderMisEstandares();
      } else if (App._ugcActual) {
        App.cargarEstandaresUGC(App._ugcActual);
      } else {
        App.cargarMisEstandares();
      }
    } catch(e) {
      App.showToast('❌ Error al guardar: ' + e.message);
    }
  },

  async validarEstandar(ugcId, codigo, aprobar) {
    const accion = aprobar ? 'validar como ✅ Cumple' : 'devolver a ⭕ Pendiente';
    if (!confirm(`¿${accion} el estándar ${codigo}?`)) return;
    const data = {
      estado: aprobar ? 'cumple' : 'pendiente',
      validado_en:  firebase.firestore.FieldValue.serverTimestamp(),
      validado_por: getUser().uid,
    };
    try {
      await db.collection(COL.ugcs).doc(ugcId)
        .collection('estandares').doc(codigo).update(data);

      // Notificar a la UGC
      await App._notificarUGC(ugcId, codigo, aprobar);

      App.showToast(aprobar ? '✅ Estándar validado como cumple' : '↩️ Estándar devuelto a pendiente');
      App.cargarDashboard();
    } catch(e) {
      App.showToast('❌ Error: ' + e.message);
    }
  },

  /* ══════════════════════════════════════════════════
     MENSAJES
  ══════════════════════════════════════════════════ */
  async cargarMensajesAdmin(verHistorial) {
    const el = document.getElementById('mensajes-admin-list');
    el.innerHTML = '<div class="loading">Cargando mensajes…</div>';

    // Cabecera con pestañas Activos / Historial
    const tabActivo = !verHistorial;
    const tabsHtml = `
      <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border)">
        <button onclick="App.cargarMensajesAdmin(false)" class="btn-tab ${tabActivo ? 'btn-tab-active' : ''}">
          📬 Activos
        </button>
        <button onclick="App.cargarMensajesAdmin(true)" class="btn-tab ${!tabActivo ? 'btn-tab-active' : ''}">
          📂 Historial
        </button>
      </div>`;

    try {
      // Usar collectionGroup sin orderBy para evitar índice compuesto
      // y filtrar/ordenar en el cliente
      const snap = await db.collectionGroup('mensajes')
        .where('para', '==', 'admin')
        .limit(300).get();

      // Ordenar por fecha descendente en el cliente
      const docs = snap.docs.slice().sort((a, b) => {
        const ta = a.data().fecha ? a.data().fecha.toMillis() : 0;
        const tb = b.data().fecha ? b.data().fecha.toMillis() : 0;
        return tb - ta;
      });

      if (!docs.length) {
        el.innerHTML = tabsHtml + '<div class="empty-state"><h3>Sin mensajes</h3></div>';
        return;
      }

      const hilos = App._agruparHilos(docs);

      // Filtrar según pestaña: Activos = algún msg no leído
      const hilosFiltrados = verHistorial
        ? hilos.filter(h => h.msgs.every(m => m.leido))
        : hilos.filter(h => h.msgs.some(m => !m.leido));

      if (!hilosFiltrados.length) {
        const txt = verHistorial ? 'No hay mensajes en el historial.' : 'Sin mensajes pendientes. Ve al Historial para ver mensajes pasados.';
        el.innerHTML = tabsHtml + `<div class="empty-state"><p>${txt}</p></div>`;
        return;
      }

      el.innerHTML = tabsHtml + hilosFiltrados.map(hilo => {
        const [first, ...replies] = hilo.msgs;
        const ugcId = hilo.msgs.reduce((id, m) => id || m._ugcId, null) || first._ugcId;
        const ugc   = UGCS.find(u => u.id === ugcId);
        const tieneNoLeido = hilo.msgs.some(m => !m.leido);
        return `
          <div class="hilo-card ${tieneNoLeido ? 'unread' : ''}">
            <div class="hilo-msg">
              <div class="mensaje-head">
                <span class="mensaje-de">🏥 ${escHtml(first.de_nombre || first.de_uid)} · <strong>${ugc ? escHtml(ugc.denominacion) : escHtml(ugcId || '—')}</strong></span>
                <span class="mensaje-date">${fmtFechaHora(first.fecha)}</span>
                ${first.tipo ? `<span class="mensaje-tipo">${escHtml(first.tipo)}</span>` : ''}
              </div>
              ${first.estandar_ref ? `<div class="mensaje-estandar">📎 ${escHtml(first.estandar_ref)}</div>` : ''}
              <div class="mensaje-texto">${escHtml(first.texto)}</div>
            </div>
            ${replies.length ? `<div class="hilo-replies">${replies.map(r => App._msgHtml(r)).join('')}</div>` : ''}
            <div class="mensaje-actions">
              ${tieneNoLeido ? `<button class="btn-sm" onclick="App.marcarHiloLeido('${escHtml(ugcId)}','${hilo.id}','admin')">✓ Marcar leído</button>` : ''}
              ${ugcId ? `<button class="btn-sm" onclick="App.abrirFichaUGC('${escHtml(ugcId)}')">Ver UGC →</button>` : ''}
              <button class="btn-danger btn-sm" onclick="App.eliminarMensajeAdmin('${escHtml(ugcId)}','${first.id}')">🗑 Borrar</button>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      console.error('cargarMensajesAdmin:', e);
      el.innerHTML = tabsHtml + `<div class="empty-state"><p>Error al cargar mensajes: ${escHtml(e.message)}</p></div>`;
    }
  },

  async eliminarMensajeAdmin(ugcId, msgId) {
    if (!ugcId || !msgId) { App.showToast('No se puede identificar el mensaje'); return; }
    if (!confirm('¿Eliminar este mensaje? Esta acción no se puede deshacer.')) return;
    try {
      const batch = db.batch();
      // Borrar el mensaje raíz
      batch.delete(db.collection(COL.ugcs).doc(ugcId).collection('mensajes').doc(msgId));
      // Borrar respuestas del mismo hilo
      const repliesSnap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('mensajes').where('hilo_id', '==', msgId).get();
      repliesSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      App.showToast('✅ Mensaje eliminado');
      App.cargarMensajesAdmin();
    } catch(e) {
      App.showToast('❌ Error al eliminar: ' + e.message);
    }
  },

  iniciarRespuestaUGC(hiloId) {
    const inp   = document.getElementById('msg-hilo-id');
    const ind   = document.getElementById('msg-respondiendo');
    const titulo = document.getElementById('msg-compose-titulo');
    if (inp)   inp.value = hiloId;
    if (ind)   ind.style.display = 'flex';
    if (titulo) titulo.textContent = 'Responder';
    const compose = document.querySelector('.mensaje-compose');
    if (compose) compose.scrollIntoView({ behavior: 'smooth' });
    const ta = document.getElementById('msg-texto');
    if (ta) { ta.focus(); }
  },

  cancelarRespuesta() {
    const inp   = document.getElementById('msg-hilo-id');
    const ind   = document.getElementById('msg-respondiendo');
    const titulo = document.getElementById('msg-compose-titulo');
    if (inp)   inp.value = '';
    if (ind)   ind.style.display = 'none';
    if (titulo) titulo.textContent = 'Nuevo mensaje';
  },

  async enviarMensaje() {
    const perfil = getPerfil();
    const ugcId  = perfil.ugc_id;
    if (!ugcId) { App.showToast('Tu cuenta no tiene una UGC asignada. Contacta con el administrador.'); return; }
    const tipo   = document.getElementById('msg-tipo').value;
    const texto  = document.getElementById('msg-texto').value.trim();
    const estRef = document.getElementById('msg-estandar').value.trim();
    const hiloId = (document.getElementById('msg-hilo-id') || {}).value || null;

    if (!texto) { App.showToast('Escribe un mensaje antes de enviar'); return; }

    const msg = {
      de_uid:      getUser().uid,
      de_nombre:   perfil.nombre,
      de_rol:      'ugc',
      para:        'admin',
      tipo,
      texto,
      hilo_id:      hiloId || null,
      estandar_ref: estRef || null,
      fecha:       firebase.firestore.FieldValue.serverTimestamp(),
      leido:       false,
    };

    try {
      await db.collection(COL.ugcs).doc(ugcId).collection('mensajes').add(msg);
      document.getElementById('msg-texto').value    = '';
      document.getElementById('msg-estandar').value = '';
      App.cancelarRespuesta();
      App.showToast('✅ Mensaje enviado');
      App.cargarMisMensajes();
    } catch(e) {
      App.showToast('❌ Error al enviar: ' + e.message);
    }
  },

  /* ══════════════════════════════════════════════════
     VISTAS UGC
  ══════════════════════════════════════════════════ */
  async cargarMiEstado() {
    const perfil = getPerfil();
    const ugcId  = perfil.ugc_id;
    if (!ugcId) {
      document.getElementById('mi-ugc-nombre').textContent = 'Sin unidad asignada';
      document.getElementById('mi-progreso-card').innerHTML = '<div class="empty-state"><p>Tu cuenta aún no tiene una unidad asignada. Contacta con el administrador.</p></div>';
      document.getElementById('mis-tareas-list').innerHTML   = '';
      document.getElementById('mis-reuniones-resumen').innerHTML = '';
      return;
    }
    const ugc    = UGCS.find(u => u.id === ugcId);
    if (ugc) document.getElementById('mi-ugc-nombre').textContent = ugc.denominacion + ' · ' + ugc.fase;

    await App._cargarProgresoUGC(ugcId, 'mi-progreso-card');

    // Fechas clave del ciclo de certificación
    const fechasEl = document.getElementById('mi-fechas-body');
    if (fechasEl && ugc) {
      const alertasHtml = App._alertasCertHtml(ugc);
      const fechaCertStr = ugc.fecha_certificacion || ugc.fecha_fin;
      let cicloHtml = '';
      if (fechaCertStr) {
        const f = calcularFechasACSA(fechaCertStr);
        if (f) {
          const strSeg  = fmtFechaStr(f.seg.toISOString().split('T')[0]);
          const strVenc = fmtFechaStr(f.venc.toISOString().split('T')[0]);
          const strRen  = fmtFechaStr(f.renovar.toISOString().split('T')[0]);
          cicloHtml = `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:${alertasHtml ? '12px' : '0'}">
              <div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Certificación</label><span style="font-size:13px;font-weight:500">${fmtFechaStr(fechaCertStr)}</span></div>
              ${ugc.nivel_certificado ? `<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Nivel</label><span style="font-size:13px;font-weight:600">${escHtml(ugc.nivel_certificado)}</span></div>` : ''}
              <div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Seguimiento</label><span style="font-size:13px;font-weight:500">${strSeg}</span></div>
              <div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Inicio renovación</label><span style="font-size:13px;font-weight:500">${strRen}</span></div>
              <div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Vencimiento</label><span style="font-size:13px;font-weight:500">${strVenc}</span></div>
            </div>`;
        }
      } else if (ugc.fase === 'Autoevaluación' && ugc.fecha_inicio_fase) {
        const dias = Math.round((new Date() - new Date(ugc.fecha_inicio_fase + 'T00:00:00')) / 86400000);
        const meses = Math.round(dias / 30);
        cicloHtml = `<div style="font-size:13px;color:var(--text2)">📅 En Autoevaluación desde ${fmtFechaStr(ugc.fecha_inicio_fase)} (${meses} meses · máx. 12)</div>`;
      }
      if (ugc.fecha_prevista) {
        cicloHtml += `<div style="font-size:13px;color:var(--text2);margin-top:8px">📋 Evaluación prevista: <strong>${fmtFechaStr(ugc.fecha_prevista)}</strong></div>`;
      }
      fechasEl.innerHTML = alertasHtml + cicloHtml || '<div style="font-size:13px;color:var(--text3)">Sin fechas clave registradas. El administrador puede añadirlas en la ficha de tu unidad.</div>';
    }

    // Tareas pendientes
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('reuniones').orderBy('fecha', 'desc').limit(5).get();
      const tareasEl = document.getElementById('mis-tareas-list');
      const reunEl   = document.getElementById('mis-reuniones-resumen');

      const todasTareas = [];
      snap.forEach(doc => {
        (doc.data().tareas || []).forEach(t => {
          if (!t.completada) todasTareas.push(t);
        });
      });

      tareasEl.innerHTML = todasTareas.length ? todasTareas.map(t => `
            <div class="tarea-item">
              <span>📌 ${t.descripcion}</span>
              ${t.responsable ? `<span style="color:var(--text3)">— ${t.responsable}</span>` : ''}
              ${t.plazo ? `<span style="color:var(--amber);margin-left:auto">⏰ ${t.plazo}</span>` : ''}
            </div>`).join('') : '<div style="padding:16px;color:var(--text3);font-size:13px">✅ No hay tareas pendientes</div>';

      reunEl.innerHTML = snap.empty ? '<div style="padding:16px;color:var(--text3);font-size:13px">Sin reuniones registradas</div>' : snap.docs.slice(0,3).map(doc => {
            const d = doc.data();
            return `<div class="tarea-item"><span>📅 ${fmtFecha(d.fecha)}</span><span style="color:var(--text3)">${d.tipo||''}</span></div>`;
          }).join('');
    } catch(e) { /* silencioso */ }
  },

  async cargarMisEstandares() {
    const perfil = getPerfil();
    const ugcId  = perfil.ugc_id;
    const wrap   = document.getElementById('mis-estandares-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="loading">Cargando…</div>';

    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId).collection('estandares').get();
      const estadosMap = {};
      snap.forEach(doc => { estadosMap[doc.id] = doc.data(); });

      if (typeof STANDARDS === 'undefined') { wrap.innerHTML = '<p>STANDARDS no cargado.</p>'; return; }

      App._misEstandaresIdx = _buildSearchIdx(STANDARDS);

      App._misEstandaresData    = { ugcId, estadosMap };
      App._misEstandaresFiltros = { q: '', oblig: '', grupo: '', criterio: '', estado: '' };

      const criterios = [...new Map(
        STANDARDS.map(s => [`${s.bloque_num}_${s.criterio_num}`, s])
      ).values()].sort((a, b) => a.bloque_num - b.bloque_num || a.criterio_num - b.criterio_num);

      wrap.innerHTML = `
        <div class="filter-bar" style="margin-bottom:4px">
          <div class="search-wrap-m">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" id="mef-search" placeholder="Buscar en cualquier campo…" oninput="App.filtrarMisEstandares()">
          </div>
          <select id="mef-oblig" onchange="App.filtrarMisEstandares()">
            <option value="">Oblig. / No oblig.</option>
            <option value="Si">Solo obligatorios</option>
            <option value="No">No obligatorios</option>
          </select>
          <select id="mef-grupo" onchange="App.filtrarMisEstandares()">
            <option value="">Todos los grupos</option>
            <option value="I">Grupo I</option>
            <option value="II">Grupo II</option>
            <option value="III">Grupo III</option>
          </select>
          <select id="mef-criterio" onchange="App.filtrarMisEstandares()">
            <option value="">Todos los criterios</option>
            ${criterios.map(s => `<option value="${s.bloque_num}_${s.criterio_num}">B${s.bloque_num}·C${s.criterio_num} · ${escHtml(s.criterio_nombre)}</option>`).join('')}
          </select>
          <select id="mef-estado" onchange="App.filtrarMisEstandares()">
            <option value="">Todos los estados</option>
            <option value="cumple">✅ Cumple</option>
            <option value="propuesto">⏳ Propuesto</option>
            <option value="pendiente">⭕ Pendiente</option>
          </select>
        </div>
        <div id="mef-count" style="font-size:12px;color:var(--text3);padding:4px 0 8px"></div>
        <div id="mef-list"></div>`;

      App._renderMisEstandares();
    } catch(e) {
      wrap.innerHTML = '<div class="empty-state"><p>Error al cargar estándares.</p></div>';
    }
  },

  filtrarMisEstandares() {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    App._misEstandaresFiltros = {
      q:        g('mef-search').toLowerCase(),
      oblig:    g('mef-oblig'),
      grupo:    g('mef-grupo'),
      criterio: g('mef-criterio'),
      estado:   g('mef-estado'),
    };
    App._renderMisEstandares();
  },

  _renderMisEstandares() {
    const listEl  = document.getElementById('mef-list');
    const countEl = document.getElementById('mef-count');
    if (!listEl || !App._misEstandaresData) return;

    const { ugcId, estadosMap } = App._misEstandaresData;
    const { q, oblig, grupo, criterio, estado } = App._misEstandaresFiltros;

    const filtered = STANDARDS.filter((s, i) => {
      if (oblig    && s.obligatorio !== oblig)                          return false;
      if (grupo    && s.grupo       !== grupo)                          return false;
      if (criterio && `${s.bloque_num}_${s.criterio_num}` !== criterio) return false;
      const st = (estadosMap[s.codigo] || {}).estado || 'pendiente';
      if (estado   && st !== estado)                                     return false;
      if (q        && !App._misEstandaresIdx[i].includes(q))            return false;
      return true;
    });

    if (countEl) {
      const cumpleN = filtered.filter(s => (estadosMap[s.codigo] || {}).estado === 'cumple').length;
      countEl.textContent = `${filtered.length} de ${STANDARDS.length} estándares · ${cumpleN} cumplidos`;
    }

    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-state"><p>Sin resultados con estos filtros.</p></div>';
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const st       = estadosMap[s.codigo] || { estado: 'pendiente' };
      const estVal   = st.estado || 'pendiente';
      const dotClass = { cumple: 'dot-cumple', propuesto: 'dot-propuesto', pendiente: 'dot-pendiente' }[estVal] || 'dot-pendiente';
      const bdgClass = `badge-${estVal}`;
      const bdgLabel = { cumple: '✅ Cumple', propuesto: '⏳ Propuesto', pendiente: '⭕ Pendiente' }[estVal] || '⭕ Pendiente';
      return `
        <div class="estandar-item est-item-${estVal}" onclick="App.abrirModalEstandar('${s.codigo}','${ugcId}')">
          <div class="est-estado-dot ${dotClass}"></div>
          <div class="est-info">
            <span class="est-codigo">${s.codigo}</span>
            <div class="est-enunciado">${escHtml(s.enunciado)}</div>
            <small style="color:var(--text3)">B${s.bloque_num} · ${escHtml(s.criterio_nombre)}</small>
          </div>
          <div class="est-badges">
            <span class="badge badge-g${s.grupo}">G${s.grupo}</span>
            ${s.obligatorio === 'Si' ? '<span class="badge badge-oblig">Oblig.</span>' : ''}
            <span class="badge ${bdgClass}">${bdgLabel}</span>
          </div>
        </div>`;
    }).join('');
  },

  async cargarReuniones() {
    const perfil = getPerfil();
    const ugcId  = perfil.ugc_id;
    const el     = document.getElementById('reuniones-list');
    if (!el) return;
    el.innerHTML = '<div class="loading">Cargando reuniones…</div>';
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('reuniones').orderBy('fecha', 'desc').get();
      if (snap.empty) {
        el.innerHTML = '<div class="empty-state"><h3>Sin reuniones</h3><p>El equipo de mentoría registrará aquí las reuniones de seguimiento.</p></div>';
        return;
      }
      el.innerHTML = snap.docs.map(doc => {
        const d = doc.data();
        const tareas = (d.tareas || []).map((t, i) => `
          <div class="tarea-item ${t.completada ? 'done' : ''}">
            <input type="checkbox" class="tarea-check" ${t.completada ? 'checked' : ''} onchange="App.toggleTarea('${ugcId}','${doc.id}',${i},this.checked)">
            <span>${escHtml(t.descripcion)}</span>
            ${t.responsable ? `<span style="color:var(--text3)">— ${escHtml(t.responsable)}</span>` : ''}
            ${t.plazo ? `<span style="color:var(--amber);margin-left:auto">${fmtFecha({toDate:()=>new Date(t.plazo)})}</span>` : ''}
          </div>`).join('');
        return `
          <div class="reunion-card">
            <div class="reunion-head">
              <span class="reunion-fecha">${fmtFecha(d.fecha)}</span>
              <span class="reunion-tipo">${escHtml(d.tipo || '')}</span>
            </div>
            ${d.acuerdos ? `<div class="reunion-acuerdos">${escHtml(d.acuerdos)}</div>` : ''}
            ${tareas ? `<div class="tareas-list">${tareas}</div>` : ''}
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar reuniones.</p></div>';
    }
  },

  async cargarMisMensajes(verHistorial) {
    const perfil = getPerfil();
    const ugcId  = perfil.ugc_id;
    const el     = document.getElementById('mis-mensajes-list');
    el.innerHTML = '<div class="loading">Cargando mensajes…</div>';

    const tabActivo = !verHistorial;
    const tabsHtml = `
      <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border)">
        <button onclick="App.cargarMisMensajes(false)" class="btn-tab ${tabActivo ? 'btn-tab-active' : ''}">
          📬 Activos
        </button>
        <button onclick="App.cargarMisMensajes(true)" class="btn-tab ${!tabActivo ? 'btn-tab-active' : ''}">
          📂 Historial
        </button>
      </div>`;

    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('mensajes').orderBy('fecha', 'asc').limit(200).get();

      if (snap.empty) {
        el.innerHTML = tabsHtml + '<div class="empty-state"><h3>Sin mensajes</h3><p>Usa el formulario para contactar con el equipo de mentoría.</p></div>';
        return;
      }

      const hilos = App._agruparHilos(snap.docs);

      // Activos = algún mensaje no leído de admin; Historial = todos leídos
      const hilosFiltrados = verHistorial
        ? hilos.filter(h => h.msgs.every(m => !m.leido || m.de_rol !== 'admin' || m.leido))
        : hilos.filter(h => h.msgs.some(m => !m.leido));

      // Si historial, mostrar todos; si activos, mostrar pendientes
      const hilosMostrar = verHistorial ? hilos : hilosFiltrados;

      if (!hilosMostrar.length) {
        el.innerHTML = tabsHtml + '<div class="empty-state"><h3>Sin mensajes</h3><p>Usa el formulario para contactar con el equipo de mentoría.</p></div>';
        return;
      }

      el.innerHTML = tabsHtml + hilosMostrar.map(hilo => {
        const [first, ...replies] = hilo.msgs;
        const tieneNoLeido = hilo.msgs.some(m => !m.leido && m.de_rol === 'admin');
        return `
          <div class="hilo-card ${tieneNoLeido ? 'unread' : ''}">
            ${App._msgHtml(first)}
            ${replies.length ? `<div class="hilo-replies">${replies.map(r => App._msgHtml(r)).join('')}</div>` : ''}
            <div class="mensaje-actions">
              ${tieneNoLeido ? `<button class="btn-sm" onclick="App.marcarHiloLeido('${ugcId}','${hilo.id}','mis')">✓ Marcar leído</button>` : ''}
              <button class="btn-sm" onclick="App.iniciarRespuestaUGC('${hilo.id}')">💬 Responder</button>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      console.error('cargarMisMensajes:', e);
      el.innerHTML = tabsHtml + `<div class="empty-state"><p>Error al cargar mensajes: ${escHtml(e.message)}</p></div>`;
    }
  },

  /* ══════════════════════════════════════════════════
     USUARIOS (ADMIN)
  ══════════════════════════════════════════════════ */
  async cargarUsuarios() {
    const el = document.getElementById('usuarios-list');
    el.innerHTML = '<div class="loading">Cargando usuarios…</div>';
    try {
      const snap = await db.collection(COL.usuarios).orderBy('creado_en', 'desc').get();
      if (snap.empty) {
        el.innerHTML = '<div class="empty-state"><p>Sin usuarios registrados.</p></div>';
        return;
      }
      const FUNCIONES = ['Director/a de UGC','Responsable de Proyecto','Director y Responsable','Miembro UGC'];
      el.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <button class="btn-primary" onclick="App.crearUsuario()">➕ Añadir usuario</button>
        </div>
        <table class="tabla-acreditacion">
          <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Función</th><th>UGC</th><th>Registro</th></tr></thead>
          <tbody>
            ${snap.docs.map(doc => {
              const d = doc.data();
              const selectUGC = `<select onchange="App.asignarUGC('${doc.id}',this.value)" style="padding:5px 8px;font-size:12px"><option value="">— Sin asignar —</option>${UGCS.map(u=>`<option value="${u.id}" ${d.ugc_id===u.id?'selected':''}>${u.denominacion}</option>`).join('')}</select>`;
              const textoSinUGC = `<span style="font-size:12px;color:var(--text3);font-style:italic">—</span>`;
              const ugcCell = (d.rol === 'admin' || d.rol === 'gestor') ? textoSinUGC : selectUGC;
              const selectFuncion = `<select onchange="App.asignarFuncion('${doc.id}',this.value)" style="padding:5px 8px;font-size:12px"><option value="">— Sin definir —</option>${FUNCIONES.map(f=>`<option value="${f}" ${d.funcion===f?'selected':''}>${f}</option>`).join('')}</select>`;
              return `
                <tr>
                  <td><strong>${escHtml(d.nombre)}</strong></td>
                  <td><small>${escHtml(d.email)}</small></td>
                  <td>
                    <select onchange="App.cambiarRol('${doc.id}',this.value)" style="padding:5px 8px;font-size:12px">
                      <option value="pendiente" ${d.rol==='pendiente'?'selected':''}>⏳ Pendiente</option>
                      <option value="admin"     ${d.rol==='admin'?'selected':''}>🔑 Admin</option>
                      <option value="gestor"    ${d.rol==='gestor'?'selected':''}>👁 Gestor</option>
                      <option value="ugc"       ${d.rol==='ugc'?'selected':''}>🏥 UGC</option>
                    </select>
                  </td>
                  <td>${selectFuncion}</td>
                  <td>${ugcCell}</td>
                  <td><small style="color:var(--text3)">${d.creado_en ? fmtFecha(d.creado_en) : '—'}</small></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar usuarios: ' + e.message + '</p></div>';
    }
  },

  async cambiarRol(uid, rol) {
    try {
      const datos = { rol };
      if (rol === 'admin' || rol === 'gestor') datos.ugc_id = null;
      await db.collection(COL.usuarios).doc(uid).update(datos);
      App.showToast('✅ Rol actualizado');
      App.cargarUsuarios();
    } catch(e) { App.showToast('❌ Error: ' + e.message); }
  },

  async asignarUGC(uid, ugcId) {
    try {
      await db.collection(COL.usuarios).doc(uid).update({ ugc_id: ugcId || null });
      App.showToast('✅ UGC asignada');
    } catch(e) { App.showToast('❌ Error: ' + e.message); }
  },

  async asignarFuncion(uid, funcion) {
    try {
      await db.collection(COL.usuarios).doc(uid).update({ funcion: funcion || null });
      App.showToast('✅ Función actualizada');
    } catch(e) { App.showToast('❌ Error: ' + e.message); }
  },

  crearUsuario() {
    document.getElementById('nuevo-usuario-nombre').value  = '';
    document.getElementById('nuevo-usuario-email').value   = '';
    document.getElementById('nuevo-usuario-rol').value     = 'ugc';
    document.getElementById('nuevo-usuario-funcion').value = '';
    document.getElementById('nuevo-usuario-ugc-row').style.display = 'block';
    document.getElementById('nuevo-usuario-error').textContent = '';
    // Rellenar select de UGCs
    const selUGC = document.getElementById('nuevo-usuario-ugc');
    selUGC.innerHTML = '<option value="">— Seleccionar UGC —</option>' +
      UGCS.map(u => `<option value="${u.id}">${escHtml(u.denominacion)}</option>`).join('');
    App.abrirModal('modal-nuevo-usuario');
  },

  async guardarNuevoUsuario() {
    const nombre  = document.getElementById('nuevo-usuario-nombre').value.trim();
    const email   = document.getElementById('nuevo-usuario-email').value.trim();
    const rol     = document.getElementById('nuevo-usuario-rol').value;
    const ugcId   = document.getElementById('nuevo-usuario-ugc').value || null;
    const funcion = document.getElementById('nuevo-usuario-funcion').value || null;
    const errEl   = document.getElementById('nuevo-usuario-error');
    errEl.textContent = '';

    if (!nombre) { errEl.textContent = 'Introduce el nombre completo.'; return; }
    if (!email)  { errEl.textContent = 'Introduce el correo corporativo.'; return; }
    if (!email.endsWith('@juntadeandalucia.es')) {
      errEl.textContent = 'Solo se permiten cuentas @juntadeandalucia.es.'; return;
    }
    if (rol === 'ugc' && !ugcId) { errEl.textContent = 'Selecciona la UGC para este usuario.'; return; }

    const btn = document.getElementById('btn-guardar-nuevo-usuario');
    btn.disabled = true;
    btn.textContent = 'Creando…';

    try {
      // 1. Crear usuario en Firebase Auth sin afectar la sesión actual
      const apiKey = firebase.app().options.apiKey;
      const tmpPass = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + 'Aa1!';
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: tmpPass, displayName: nombre, returnSecureToken: false })
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        const msgs = {
          'EMAIL_EXISTS': 'Ya existe una cuenta con ese correo.',
          'INVALID_EMAIL': 'El formato del correo no es válido.',
          'WEAK_PASSWORD : Password should be at least 6 characters': 'Contraseña interna muy débil.'
        };
        errEl.textContent = msgs[data.error && data.error.message] || ('Error: ' + (data.error && data.error.message));
        btn.disabled = false; btn.textContent = 'Crear usuario'; return;
      }
      const uid = data.localId;

      // 2. Crear perfil en Firestore
      await db.collection(COL.usuarios).doc(uid).set({
        uid, nombre, email,
        rol, ugc_id: (rol === 'ugc') ? ugcId : null,
        funcion: funcion || null,
        cargo: '', telefono_whatsapp: '',
        creado_en: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // 3. Auto-añadir al directorio del área
      try {
        await db.collection(COL.directorio).add({
          nombre, email, cargo: '', telefono: '',
          tipo: 'Personal', orden: 999,
          creado_en: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch(_e) { /* no bloquea si falla */ }

      // 4. Enviar email de establecimiento de contraseña
      try { await auth.sendPasswordResetEmail(email); } catch(_e) { /* no bloquea */ }

      App.cerrarModal('modal-nuevo-usuario');
      App.showToast('✅ Usuario creado y enlace de acceso enviado por correo');
      App.cargarUsuarios();

    } catch(e) {
      errEl.textContent = 'Error inesperado: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Crear usuario';
    }
  },

  /* ══════════════════════════════════════════════════
     REUNIONES — Nueva reunión
  ══════════════════════════════════════════════════ */
  nuevaReunion() {
    document.getElementById('reunion-fecha').value        = new Date().toISOString().split('T')[0];
    document.getElementById('reunion-participantes').value = '';
    document.getElementById('reunion-acuerdos').value     = '';
    document.getElementById('tareas-container').innerHTML  = App._tareaRowHTML();
    App.abrirModal('modal-reunion');
  },

  addTareaRow(btn) {
    const container = document.getElementById('tareas-container');
    const div = document.createElement('div');
    div.className = 'tarea-row';
    div.innerHTML = App._tareaRowHTML();
    container.appendChild(div);
  },

  _tareaRowHTML() {
    return `<div class="tarea-row">
      <input type="text" placeholder="Descripción tarea" class="tarea-desc" style="padding:7px 10px">
      <input type="text" placeholder="Responsable"       class="tarea-resp" style="padding:7px 10px">
      <input type="date"                                  class="tarea-plazo" style="padding:7px 10px">
      <button onclick="App.addTareaRow(this)" style="width:32px;height:32px;background:var(--green-light);color:var(--green);border:none;border-radius:6px;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer">+</button>
    </div>`;
  },

  async guardarReunion() {
    const ugcId = App._ugcActual || getPerfil().ugc_id;
    const fecha = document.getElementById('reunion-fecha').value;
    if (!fecha) { App.showToast('⚠️ Selecciona una fecha para la reunión'); return; }
    const tipo  = document.getElementById('reunion-tipo').value;
    const partic= document.getElementById('reunion-participantes').value;
    const acuerdos = document.getElementById('reunion-acuerdos').value;

    const tareas = [];
    document.querySelectorAll('.tarea-row').forEach(row => {
      const desc = row.querySelector('.tarea-desc').value.trim();
      const resp = row.querySelector('.tarea-resp') ? row.querySelector('.tarea-resp').value.trim() : '';
      const plazo= row.querySelector('.tarea-plazo') ? row.querySelector('.tarea-plazo').value : '';
      if (desc) tareas.push({ descripcion: desc, responsable: resp, plazo, completada: false });
    });

    try {
      await db.collection(COL.ugcs).doc(ugcId).collection('reuniones').add({
        fecha: firebase.firestore.Timestamp.fromDate(new Date(fecha)),
        tipo, acuerdos,
        participantes: partic.split(',').map(p => p.trim()).filter(Boolean),
        tareas,
        creado_por: getUser().uid,
        creado_en:  firebase.firestore.FieldValue.serverTimestamp(),
      });
      App.cerrarModal('modal-reunion');
      App.showToast('✅ Reunión guardada');
      if (App._ugcActual) App.cargarReunionesUGC(App._ugcActual);
    } catch(e) {
      App.showToast('❌ Error: ' + e.message);
    }
  },

  async toggleTarea(ugcId, reunionId, idx, completada) {
    try {
      const ref  = db.collection(COL.ugcs).doc(ugcId).collection('reuniones').doc(reunionId);
      const snap = await ref.get();
      if (!snap.exists) return;
      const tareas = (snap.data().tareas || []).map((t, i) => i === idx ? { ...t, completada } : t);
      await ref.update({ tareas });
    } catch(e) { /* silencioso */ }
  },

  /* ══════════════════════════════════════════════════
     NOTIFICACIONES INTERNAS
  ══════════════════════════════════════════════════ */
  async _notificarAdmins(ugcId, codigo, perfil) {
    const ugc = UGCS.find(u => u.id === ugcId);
    await db.collection(COL.ugcs).doc(ugcId).collection('mensajes').add({
      de_uid:      getUser().uid,
      de_nombre:   perfil.nombre,
      de_rol:      'ugc',
      para:        'admin',
      tipo:        'propuesta',
      texto:       `📋 El estándar ${codigo} ha sido propuesto como cumple.\nUnidad: ${ugc ? ugc.denominacion : ugcId}`,
      estandar_ref: codigo,
      fecha:       firebase.firestore.FieldValue.serverTimestamp(),
      leido:       false,
    });
  },

  async _notificarUGC(ugcId, codigo, aprobado) {
    const perfil = getPerfil();
    await db.collection(COL.ugcs).doc(ugcId).collection('mensajes').add({
      de_uid:      getUser().uid,
      de_nombre:   perfil.nombre,
      de_rol:      'admin',
      para:        ugcId,
      tipo:        aprobado ? 'validacion' : 'devolucion',
      texto:       aprobado ? `✅ El estándar ${codigo} ha sido VALIDADO como cumple. ¡Enhorabuena!` : `↩️ El estándar ${codigo} ha sido devuelto a pendiente. Revisa los requisitos y vuelve a proponer cuando tengas las evidencias.`,
      estandar_ref: codigo,
      fecha:       firebase.firestore.FieldValue.serverTimestamp(),
      leido:       false,
    });
  },

  /* ══════════════════════════════════════════════════
     INFORME UGC
  ══════════════════════════════════════════════════ */
  async generarInforme() {
    const ugcId = App._ugcActual;
    if (!ugcId) return;
    const ugc = UGCS.find(u => u.id === ugcId);
    const snap = await db.collection(COL.ugcs).doc(ugcId).collection('estandares').get();
    const estadosMap = {};
    snap.forEach(doc => { estadosMap[doc.id] = doc.data(); });

    const estandaresConEstado = typeof STANDARDS !== 'undefined' ? STANDARDS.map(s => ({ ...s, estado: estadosMap[s.codigo] ? estadosMap[s.codigo].estado : 'pendiente' })) : [];
    const nivel = calcularNivel(estandaresConEstado);
    const fecha = new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' });

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Informe ${ugc ? ugc.denominacion : ugcId}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #1a2332; padding: 32px; max-width: 800px; margin: 0 auto; }
      h1 { color: #1e3a5f; font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 13px; font-weight: normal; color: #5a6a7a; margin-bottom: 24px; }
      .meta { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 24px; font-size: 11px; color: #5a6a7a; }
      .nivel { display: inline-block; padding: 6px 16px; border-radius: 999px; font-weight: 700; font-size: 14px; margin-bottom: 20px; }
      .barra-wrap { margin-bottom: 10px; }
      .barra-label { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: #5a6a7a; margin-bottom: 3px; }
      .barra { height: 10px; background: #e8edf2; border-radius: 999px; overflow: hidden; }
      .barra-fill { height: 100%; border-radius: 999px; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 11px; }
      th { background: #e8edf2; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #5a6a7a; }
      td { padding: 8px 10px; border-bottom: 1px solid #e8edf2; vertical-align: top; }
      tr:last-child td { border-bottom: none; }
      .cumple    { color: #2d7a4f; font-weight: 700; }
      .propuesto { color: #b06000; font-weight: 700; }
      .pendiente { color: #9e9890; }
      .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e8edf2; font-size: 10px; color: #9e9890; text-align: center; }
    </style>
    </head><body>
    <h1>Informe de Estado de Acreditación ACSA</h1>
    <h2>${ugc ? ugc.denominacion : ugcId} · ${ugc ? ugc.ubicacion : ''}</h2>
    <div class="meta">
      <span>📅 Fecha del informe: ${fecha}</span>
      <span>🔖 Fase: ${ugc ? ugc.fase : '—'}</span>
      ${ugc && ugc.codigo_acsa ? `<span>📋 Código ACSA: ${ugc.codigo_acsa}</span>` : ''}
    </div>
    <div class="nivel" style="background:${nivel.color}20;color:${nivel.color}">🏆 Nivel actual: ${nivel.nivel}</div>
    <div class="barra-wrap">
      <div class="barra-label"><span>Obligatorios</span><span>${nivel.cumpleObligatorios}/${nivel.totalObligatorios} · ${nivel.pctOblig}%</span></div>
      <div class="barra"><div class="barra-fill" style="width:${nivel.pctOblig}%;background:#b03030"></div></div>
    </div>
    <div class="barra-wrap">
      <div class="barra-label"><span>Grupo I</span><span>${nivel.cumpleGI}/${nivel.totalGI} · ${nivel.pctGI}%</span></div>
      <div class="barra"><div class="barra-fill" style="width:${nivel.pctGI}%;background:#2d7a4f"></div></div>
    </div>
    <div class="barra-wrap">
      <div class="barra-label"><span>Grupo II</span><span>${nivel.cumpleGII}/${nivel.totalGII} · ${nivel.pctGII}%</span></div>
      <div class="barra"><div class="barra-fill" style="width:${nivel.pctGII}%;background:#1e5b8c"></div></div>
    </div>
    <div class="barra-wrap">
      <div class="barra-label"><span>Grupo III</span><span>${nivel.cumpleGIII}/${nivel.totalGIII} · ${nivel.pctGIII}%</span></div>
      <div class="barra"><div class="barra-fill" style="width:${nivel.pctGIII}%;background:#5c2d7a"></div></div>
    </div>
    <table>
      <thead><tr><th>Código</th><th>Enunciado</th><th>Grupo</th><th>Obligatorio</th><th>Estado</th><th>Evidencia</th></tr></thead>
      <tbody>
        ${estandaresConEstado.map(s => {
          const st = estadosMap[s.codigo];
          return `<tr>
            <td><strong>${s.codigo}</strong></td>
            <td>${escHtml(s.enunciado)}</td>
            <td>G${s.grupo}</td>
            <td>${s.obligatorio}</td>
            <td class="${s.estado}">${{cumple:'✅ Cumple',propuesto:'⏳ Propuesto',pendiente:'⭕ Pendiente'}[s.estado]||'—'}</td>
            <td>${st && st.documento_mejora_c ? st.documento_mejora_c.split('\n').map(l => l.trim()).filter(Boolean).join(' • ') : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="footer">Área de Gestión Sanitaria Sur de Córdoba · Área de Calidad y Seguridad del Paciente · Generado el ${fecha}</div>
    </body></html>`;

    App._mostrarInformeEnApp('Informe de acreditación', html);
  },

  /* ══════════════════════════════════════════════════
     HISTORIAL DE FASES
  ══════════════════════════════════════════════════ */
  async cargarHistorialFases(ugcId) {
    const el = document.getElementById('historial-fases-list');
    if (!el) return;
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('historial_fases').orderBy('fecha', 'desc').limit(20).get();
      if (snap.empty) {
        el.innerHTML = '<div style="font-size:13px;color:var(--text3)">Sin historial registrado (se guardará automáticamente a partir de ahora).</div>';
        return;
      }
      el.innerHTML = snap.docs.map(doc => {
        const d = doc.data();
        return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="color:var(--text3);min-width:120px">${fmtFechaHora(d.fecha)}</span>
          <span>${escHtml(d.fase_anterior || '—')}</span>
          <span style="color:var(--text3)">→</span>
          <strong>${escHtml(d.fase_nueva)}</strong>
          ${d.cambiado_por ? `<span style="color:var(--text3);margin-left:auto;font-size:11px">${escHtml(d.cambiado_por)}</span>` : ''}
        </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div style="font-size:13px;color:var(--text3)">Error al cargar historial.</div>';
    }
  },

  /* ══════════════════════════════════════════════════
     INFORME GLOBAL (ADMIN)
  ══════════════════════════════════════════════════ */
  generarInformeGlobal() {
    const fecha = new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' });
    const ugcsActivas = UGCS.filter(u => u.fase && u.fase !== 'Sin solicitar');
    const todasUGCs   = UGCS;

    const filaUGC = u => {
      const fechaCertStr = u.fecha_certificacion || u.fecha_fin;
      const f = fechaCertStr ? calcularFechasACSA(fechaCertStr) : null;
      const strVenc = f ? fmtFechaStr(f.venc.toISOString().split('T')[0]) : '—';
      const strSeg  = f ? fmtFechaStr(f.seg.toISOString().split('T')[0])  : '—';
      let alerta = '';
      if (f) {
        if (f.diasHastaVenc < 0)         alerta = '🔴 VENCIDO';
        else if (f.diasHastaVenc < 90)   alerta = '🔴 Vence en ' + f.diasHastaVenc + 'd';
        else if (f.diasHastaVenc < 365)  alerta = '⚠️ Renovar en ' + Math.round(f.diasHastaVenc/30) + 'm';
        else if (f.diasHastaSeg < 0)     alerta = '📋 Seguim. pendiente';
        else if (f.diasHastaSeg < 90)    alerta = '📋 Seguim. en ' + f.diasHastaSeg + 'd';
      }
      if (u.fase === 'Pendiente de estabilización') alerta = '⏳ Estabilización';
      return `<tr>
        <td><strong>${escHtml(u.denominacion)}</strong><br><small style="color:#5a6a7a">${escHtml(u.ubicacion)}</small></td>
        <td>${escHtml(u.fase || 'Sin solicitar')}</td>
        <td>${escHtml(u.nivel_certificado || '—')}</td>
        <td>${fechaCertStr ? fmtFechaStr(fechaCertStr) : '—'}</td>
        <td>${strSeg}</td>
        <td>${strVenc}</td>
        <td>${alerta}</td>
      </tr>`;
    };

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Informe Global Acreditación ACSA</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #1a2332; padding: 24px; max-width: 1100px; margin: 0 auto; }
      h1 { color: #1e3a5f; font-size: 16px; margin-bottom: 4px; }
      h2 { font-size: 12px; font-weight: normal; color: #5a6a7a; margin-bottom: 8px; }
      .meta { font-size: 10px; color: #5a6a7a; margin-bottom: 20px; }
      .resumen { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
      .kpi { background: #e8edf2; border-radius: 8px; padding: 10px 18px; text-align: center; }
      .kpi-val { font-size: 22px; font-weight: 700; color: #1e3a5f; }
      .kpi-lbl { font-size: 10px; color: #5a6a7a; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #e8edf2; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: #5a6a7a; }
      td { padding: 7px 8px; border-bottom: 1px solid #e8edf2; vertical-align: top; }
      tr:last-child td { border-bottom: none; }
      .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e8edf2; font-size: 9px; color: #9e9890; text-align: center; }
    </style>
    </head><body>
    <h1>Informe Global de Acreditación ACSA</h1>
    <h2>Área de Gestión Sanitaria Sur de Córdoba</h2>
    <div class="meta">📅 Generado el ${fecha}</div>
    <div class="resumen">
      <div class="kpi"><div class="kpi-val">${todasUGCs.length}</div><div class="kpi-lbl">Total UGCs</div></div>
      <div class="kpi"><div class="kpi-val">${ugcsActivas.length}</div><div class="kpi-lbl">En proceso activo</div></div>
      <div class="kpi"><div class="kpi-val">${UGCS.filter(u=>u.fase==='Seguimiento').length}</div><div class="kpi-lbl">En seguimiento</div></div>
      <div class="kpi"><div class="kpi-val">${UGCS.filter(u=>u.fase==='Recertificación').length}</div><div class="kpi-lbl">En recertificación</div></div>
    </div>
    <table>
      <thead><tr><th>Unidad</th><th>Fase</th><th>Nivel cert.</th><th>Certificación</th><th>Seguimiento</th><th>Vencimiento</th><th>Alerta</th></tr></thead>
      <tbody>${todasUGCs.map(filaUGC).join('')}</tbody>
    </table>
    <div class="footer">Plataforma Mentoría ACSA · Área Calidad y Seguridad del Paciente · Generado el ${fecha}</div>
    </body></html>`;

    App._mostrarInformeEnApp('Informe global ACSA', html);
  },

  /* ══════════════════════════════════════════════════
     OVERLAY INFORME (PWA-safe)
  ══════════════════════════════════════════════════ */
  // ══════════════════════════════════════════════════
  //   GUÍA DE USO
  // ══════════════════════════════════════════════════
  cargarGuia() {
    const admin = isAdmin();
    const sub   = document.getElementById('guia-subtitulo');
    const cont  = document.getElementById('guia-contenido');
    if (!cont) return;
    if (sub) sub.textContent = admin ? 'Manual del Administrador' : 'Manual del Usuario UGC';

    const sec = (titulo, icono, cuerpo) => `
      <div class="guia-seccion">
        <div class="guia-seccion-titulo"><span>${icono}</span>${titulo}</div>
        ${cuerpo}
      </div>`;

    const steps = (...items) => `<div class="guia-steps">${items.map((t,i) =>
      `<div class="guia-step"><div class="guia-step-num">${i+1}</div><div class="guia-step-text">${t}</div></div>`
    ).join('')}</div>`;

    const lista = (...items) => `<ul class="guia-lista">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

    const tip = t => `<div class="guia-tip">💡 ${t}</div>`;

    /* ─── TABS ADMIN ─── */
    const tabsAdmin = [
      { id: 'inicio',     label: 'Inicio',       icon: '🏠' },
      { id: 'ugcs',       label: 'UGCs',         icon: '🏥' },
      { id: 'estandares', label: 'Estándares',   icon: '✅' },
      { id: 'mensajes',   label: 'Mensajes',     icon: '💬' },
      { id: 'usuarios',   label: 'Usuarios',     icon: '👥' },
      { id: 'utilidades', label: 'Utilidades',   icon: '🛠️' },
      { id: 'herramientas', label: 'Herramientas', icon: '🔧' },
    ];

    const panelAdminInicio = `
      <div class="guia-hero">
        <h3>Panel de Administración · Mentoría ACSA</h3>
        <p>Bienvenido/a al panel de <strong>Administrador</strong> de la Plataforma de Mentoría ACSA. Desde aquí gestionas todo el proceso de acreditación de las UGCs del Área de Gestión Sanitaria Sur de Córdoba: seguimiento de estándares, reuniones, mensajería y gestión de usuarios.</p>
        <div class="guia-hero-chips">
          <span class="guia-hero-chip">76 estándares ACSA</span>
          <span class="guia-hero-chip">29 UGCs</span>
          <span class="guia-hero-chip">3 niveles de certificación</span>
        </div>
      </div>
      <div class="guia-cards">
        <div class="guia-card" onclick="App._guiaTab('ugcs')"><div class="guia-card-icon">🏥</div><div class="guia-card-label">Directorio de UGCs</div><div class="guia-card-desc">Fichas completas con progreso y estándares</div></div>
        <div class="guia-card" onclick="App._guiaTab('estandares')"><div class="guia-card-icon">✅</div><div class="guia-card-label">Estándares</div><div class="guia-card-desc">Validar, devolver y seguir el avance</div></div>
        <div class="guia-card" onclick="App._guiaTab('mensajes')"><div class="guia-card-icon">💬</div><div class="guia-card-label">Mensajes</div><div class="guia-card-desc">Comunicación con todas las UGCs</div></div>
        <div class="guia-card" onclick="App._guiaTab('usuarios')"><div class="guia-card-icon">👥</div><div class="guia-card-label">Usuarios</div><div class="guia-card-desc">Roles y asignación de UGCs</div></div>
        <div class="guia-card" onclick="App._guiaTab('utilidades')"><div class="guia-card-icon">🛠️</div><div class="guia-card-label">Utilidades</div><div class="guia-card-desc">Importar datos y migrar UGCs</div></div>
        <div class="guia-card" onclick="App._guiaTab('herramientas')"><div class="guia-card-icon">🔧</div><div class="guia-card-label">Herramientas</div><div class="guia-card-desc">Buscador y acceso externo</div></div>
      </div>
      ${sec('Niveles de certificación ACSA', '🏅', `
        <table class="guia-table">
          <tr><th>Nivel</th><th>Requisitos</th></tr>
          <tr><td><strong>Avanzado</strong></td><td>100% estándares obligatorios + ≥ 70% Grupo I</td></tr>
          <tr><td><strong>Óptimo</strong></td><td>100% Grupo I + ≥ 40% Grupo II</td></tr>
          <tr><td><strong>Excelente</strong></td><td>100% Grupo I + 100% Grupo II + ≥ 40% Grupo III</td></tr>
        </table>
        ${tip('El Cuadro de Mandos muestra en tiempo real cuántas UGCs han alcanzado cada nivel.')}
      `)}`;

    const panelAdminUGCs = `
      ${sec('Cuadro de Mandos', '📊', `
        ${lista(
          'Muestra el resumen global: UGCs por fase, estándares <em>Propuestos</em> pendientes de validación y nivel de progreso global.',
          'Las tarjetas de UGC tienen un color diferente según su fase activa (solicitud, autoevaluación, evaluación…).',
          'Los estándares en estado <em>Propuesto</em> aparecen en la lista inferior del dashboard: haz clic en cualquiera para revisarlo.'
        )}
        ${tip('Puedes acceder a la Ficha UGC desde el dashboard haciendo clic directamente en la tarjeta.')}
      `)}
      ${sec('Directorio de UGCs', '🏥', `
        ${lista(
          'Lista las 29 UGCs del área con su fase actual de acreditación y nombre completo.',
          'Usa el buscador por nombre y los filtros de <strong>Fase</strong> y <strong>Ámbito</strong> (Atención Primaria / Hospital) para localizar rápidamente una UGC.',
          'Haz clic en una tarjeta para abrir la <strong>Ficha UGC</strong> con 5 pestañas: Progreso, Estándares, Reuniones, Mensajes e Información.'
        )}
      `)}
      ${sec('Ficha UGC · Pestaña Progreso', '📈', `
        ${lista(
          'Muestra el porcentaje de estándares cumplidos desglosado por Grupo (GIO (Obligatorios), GI, GII, GIII).',
          'Indica el nivel de certificación alcanzado: <em>En proceso → Avanzado → Óptimo → Excelente</em>.',
          'Botón <strong>Generar informe PDF</strong>: crea un informe completo de la UGC, imprimible desde el navegador.'
        )}
      `)}
      ${sec('Ficha UGC · Pestaña Información', 'ℹ️', `
        ${lista(
          'Contiene los datos del ciclo de acreditación: tipo de proyecto, director, responsable, fechas de cada fase (solicitud, autoevaluación, evaluación, seguimiento, apercibimiento, fin de certificación).',
          'También muestra las ubicaciones del centro, otras ubicaciones vinculadas y el histórico de certificaciones anteriores.',
          'El botón <strong>Editar</strong> permite modificar todos estos campos directamente desde la plataforma.'
        )}
        ${tip('Al importar desde ME_jora C (Utilidades → Importar Proyecto), estos campos se completan automáticamente.')}
      `)}`;

    const panelAdminEstandares = `
      ${sec('Flujo de validación de estándares', '🔄', `
        ${steps(
          'La UGC completa la evidencia de un estándar y cambia su estado a <strong>Propuesto a cumple</strong>.',
          'El estándar aparece resaltado en la ficha (color morado) y en el Cuadro de Mandos del administrador.',
          'El administrador abre el estándar, revisa la evidencia y el documento de ME_jora C.',
          'Si la evidencia es correcta: cambia el estado a <strong>Cumple</strong> (verde). Si no: lo devuelve a <strong>Pendiente</strong> con un comentario.'
        )}
      `)}
      ${sec('Filtros de estándares', '🔍', `
        ${lista(
          '<strong>Grupo:</strong> GIO (Obligatorios) · GI · GII · GIII.',
          '<strong>Obligatoriedad:</strong> Solo obligatorios / todos.',
          '<strong>Criterio:</strong> filtra por criterio ACSA específico.',
          '<strong>Estado:</strong> Pendiente / Propuesto / Cumple.',
          '<strong>Texto libre:</strong> busca por código o descripción del estándar.'
        )}
      `)}
      ${sec('Estados de los estándares', '🏷️', `
        <table class="guia-table">
          <tr><th>Estado</th><th>Significado</th><th>Quién lo cambia</th></tr>
          <tr><td>⬜ Pendiente</td><td>Sin evidencia aportada</td><td>Admin o UGC</td></tr>
          <tr><td>🟣 Propuesto</td><td>Evidencia aportada, pendiente de validar</td><td>UGC (o Admin)</td></tr>
          <tr><td>✅ Cumple</td><td>Validado por el equipo de Calidad</td><td>Solo Admin</td></tr>
        </table>
      `)}`;

    const panelAdminMensajes = `
      ${sec('Panel de mensajes centralizado', '📥', `
        ${lista(
          'Muestra los mensajes de <strong>todas las UGCs</strong> agrupados por hilo (mensaje original + respuestas).',
          'La pestaña <strong>Activos</strong> muestra los hilos con mensajes no leídos; la pestaña <strong>Historial</strong>, los ya leídos.',
          'El número rojo en el icono de campana del encabezado indica el total de mensajes no leídos.'
        )}
      `)}
      ${sec('Responder y gestionar mensajes', '✉️', `
        ${steps(
          'Haz clic en un hilo para ver el mensaje original y todas las respuestas.',
          'Escribe tu respuesta en el campo de texto y pulsa <strong>Enviar</strong>.',
          'La UGC recibirá la respuesta en su panel de <em>Mis Mensajes</em>.',
          'Para eliminar un hilo completo (mensaje + respuestas), usa el botón 🗑️ que aparece junto al hilo.'
        )}
        ${tip('También puedes enviar un mensaje a una UGC desde la pestaña <em>Mensajes</em> dentro de su Ficha UGC.')}
      `)}`;

    const panelAdminUsuarios = `
      ${sec('Roles de usuario', '🔐', `
        <table class="guia-table">
          <tr><th>Rol</th><th>Acceso</th></tr>
          <tr><td><span class="gbadge gbadge-admin">Admin</span></td><td>Acceso completo: cuadro de mandos, todas las UGCs, validar estándares, gestionar usuarios y utilidades.</td></tr>
          <tr><td><span class="gbadge gbadge-ugc">UGC</span></td><td>Solo su propia UGC: estándares, reuniones y mensajes.</td></tr>
          <tr><td><span class="gbadge gbadge-pend">Pendiente</span></td><td>Pantalla de espera. No puede acceder a la app hasta que se le asigne un rol.</td></tr>
        </table>
      `)}
      ${sec('Gestión de usuarios', '⚙️', `
        ${steps(
          'Ve a <strong>Usuarios</strong> en el sidebar para ver todos los registrados.',
          'Haz clic en el selector de rol junto a un usuario para cambiarlo entre <em>Pendiente</em>, <em>Usuario UGC</em> y <em>Administrador</em>.',
          'Si cambias a un usuario a rol <em>UGC</em>, aparece un selector con la lista de las 29 UGCs para asignarle la suya.',
          'Al asignar rol <em>Admin</em>, la UGC asignada se borra automáticamente.'
        )}
        ${tip('El primer administrador debe crearse manualmente en la consola de Firestore: ve a /usuarios/{uid} y cambia el campo <code>rol</code> a <em>admin</em>.')}
      `)}`;

    const panelAdminUtilidades = `
      ${sec('Importar Proyectos de ME_jora C (PDF)', '📄', `
        ${steps(
          'Ve a <strong>Utilidades</strong> en el sidebar (solo visible para administradores).',
          'En el panel de la derecha, arrastra el PDF de la Ficha de Proyecto descargado desde ME_jora C, o haz clic para seleccionarlo.',
          'La plataforma extrae automáticamente: tipo de proyecto, director, responsable, fechas del ciclo, ubicaciones y datos de certificación.',
          'Revisa la vista previa. Si hay varias grafías de una misma ubicación, elige la canónica con los botones de selección.',
          'Selecciona la UGC de destino en el selector y pulsa <strong>Importar Proyecto</strong>.'
        )}
        ${tip('Los campos existentes en Firestore se combinan (merge) con los nuevos datos: nada se borra.')}
      `)}
      ${sec('Importar evidencias desde Excel', '📊', `
        ${steps(
          'Descarga el Excel de seguimiento desde ME_jora C.',
          'En el panel de la izquierda de Utilidades, arrastra el archivo .xlsx o haz clic para seleccionarlo.',
          'Ajusta el filtro de fechas si solo quieres importar evidencias de un periodo concreto.',
          'Revisa la tabla de vista previa y pulsa <strong>Importar evidencias</strong>.'
        )}
      `)}
      ${sec('Migrar datos entre UGCs', '🔀', `
        ${lista(
          'Copia todos los estándares, reuniones y mensajes de un ID de UGC antiguo a un ID nuevo.',
          'Útil cuando se reestructura el directorio de UGCs o se corrige un identificador erróneo.',
          'Introduce el ID origen y el ID destino en los campos correspondientes y pulsa <strong>Migrar</strong>.'
        )}
        ${tip('Esta operación no elimina los datos del origen. Verifica el resultado antes de borrar la UGC antigua.')}
      `)}`;

    const panelAdminHerramientas = `
      ${sec('Buscador de Estándares ACSA', '🔍', `
        ${lista(
          'Herramienta independiente (accesible también sin login) que muestra los 76 estándares del Manual ACSA para UGC.',
          'Filtra por Bloque, Criterio, Grupo de certificación, Obligatoriedad y Circuito.',
          'Consulta las UGCs que ya han cumplido cada estándar y accede directamente a su evidencia desde aquí.',
          'El botón <em>← Mentoría</em> devuelve al panel de administración directamente, sin pasar por el login.'
        )}
      `)}
      ${sec('Portal ME_jora C', '🔗', `
        ${lista(
          'Acceso directo al portal externo de ME_jora C de la ACSA.',
          'Desde allí puedes descargar el PDF de la Ficha de Proyecto y el Excel de seguimiento de estándares.',
          'Se abre en una nueva pestaña del navegador.'
        )}
      `)}
      ${sec('Modo oscuro', '🌙', `
        ${lista(
          'Haz clic en el icono de luna/sol en el encabezado para alternar entre el tema claro y el oscuro.',
          'La preferencia se guarda en el navegador y se aplica automáticamente en cada visita.'
        )}
      `)}`;

    /* ─── TABS UGC ─── */
    const tabsUGC = [
      { id: 'inicio',      label: 'Inicio',       icon: '🏠' },
      { id: 'estado',      label: 'Mi Estado',    icon: '📊' },
      { id: 'estandares',  label: 'Estándares',   icon: '✅' },
      { id: 'reuniones',   label: 'Reuniones',    icon: '📅' },
      { id: 'mensajes',    label: 'Mensajes',     icon: '💬' },
      { id: 'herramientas',label: 'Herramientas', icon: '🔧' },
    ];

    const panelUGCInicio = `
      <div class="guia-hero">
        <h3>Plataforma de Mentoría ACSA · Tu UGC</h3>
        <p>Bienvenido/a a la plataforma de seguimiento de acreditación ACSA. Aquí llevarás el registro de tus estándares, consultarás las reuniones de mentoría y te comunicarás con el equipo de Calidad del Área.</p>
        <div class="guia-hero-chips">
          <span class="guia-hero-chip">76 estándares</span>
          <span class="guia-hero-chip">Comunicación directa</span>
          <span class="guia-hero-chip">Seguimiento en tiempo real</span>
        </div>
      </div>
      <div class="guia-cards">
        <div class="guia-card" onclick="App._guiaTab('estado')"><div class="guia-card-icon">📊</div><div class="guia-card-label">Mi Estado</div><div class="guia-card-desc">Progreso y nivel de certificación</div></div>
        <div class="guia-card" onclick="App._guiaTab('estandares')"><div class="guia-card-icon">✅</div><div class="guia-card-label">Estándares</div><div class="guia-card-desc">Registrar evidencias y proponer cumplimiento</div></div>
        <div class="guia-card" onclick="App._guiaTab('reuniones')"><div class="guia-card-icon">📅</div><div class="guia-card-label">Reuniones</div><div class="guia-card-desc">Acuerdos y tareas de mentoría</div></div>
        <div class="guia-card" onclick="App._guiaTab('mensajes')"><div class="guia-card-icon">💬</div><div class="guia-card-label">Mensajes</div><div class="guia-card-desc">Comunicación con el equipo de Calidad</div></div>
      </div>`;

    const panelUGCEstado = `
      ${sec('Mi Estado · Resumen de progreso', '📊', `
        ${lista(
          'Muestra el porcentaje de estándares cumplidos en tu UGC, desglosado por grupo: <strong>GIO (Obligatorios)</strong>, <strong>Grupo I</strong>, <strong>Grupo II</strong> y <strong>Grupo III</strong>.',
          'El nivel de certificación actual aparece destacado: <em>En proceso → Avanzado → Óptimo → Excelente</em>.',
          'Si ya tienes certificación, verás las fechas clave del ciclo y el nivel alcanzado.'
        )}
        ${tip('El nivel <em>Avanzado</em> requiere el 100% de los estándares obligatorios y al menos el 70% del Grupo I.')}
      `)}
      ${sec('Niveles de certificación ACSA', '🏅', `
        <table class="guia-table">
          <tr><th>Nivel</th><th>Requisitos</th></tr>
          <tr><td><strong>Avanzado</strong></td><td>100% obligatorios + ≥ 70% Grupo I</td></tr>
          <tr><td><strong>Óptimo</strong></td><td>100% Grupo I + ≥ 40% Grupo II</td></tr>
          <tr><td><strong>Excelente</strong></td><td>100% Grupo I + 100% Grupo II + ≥ 40% Grupo III</td></tr>
        </table>
      `)}`;

    const panelUGCEstandares = `
      ${sec('Cómo registrar una evidencia', '📝', `
        ${steps(
          'Ve a <strong>Mis Estándares</strong> en el menú lateral.',
          'Usa los filtros para localizar el estándar que quieres trabajar (por grupo, estado, criterio o texto libre).',
          'Haz clic en el estándar para abrirlo.',
          'Escribe en <strong>Descripción de la evidencia</strong> cómo habéis implementado este criterio en tu unidad.',
          'Anota el nombre del documento en ME_jora C en el campo <strong>Documento de mejora</strong>.',
          'Cuando la evidencia esté lista, cambia el estado a <strong>Propuesto a cumple</strong> y guarda.',
          'El equipo de Calidad recibirá la propuesta y la validará.'
        )}
      `)}
      ${sec('Estados de los estándares', '🏷️', `
        <table class="guia-table">
          <tr><th>Estado</th><th>Significado</th></tr>
          <tr><td>⬜ Pendiente</td><td>Aún no has aportado evidencia para este estándar.</td></tr>
          <tr><td>🟣 Propuesto</td><td>Has propuesto la evidencia. Está pendiente de revisión por el equipo de Calidad.</td></tr>
          <tr><td>✅ Cumple</td><td>El equipo de Calidad ha validado tu evidencia. ¡Estándar superado!</td></tr>
        </table>
        ${tip('Mientras un estándar está en estado <em>Propuesto</em> no puedes modificarlo. Si necesitas cambiarlo, contacta con el equipo de Calidad.')}
      `)}
      ${sec('Filtros disponibles', '🔍', `
        ${lista(
          '<strong>Grupo:</strong> GIO (Obligatorios), GI, GII, GIII.',
          '<strong>Estado:</strong> Pendiente / Propuesto / Cumple.',
          '<strong>Obligatorios:</strong> muestra solo los estándares imprescindibles para la certificación.',
          '<strong>Texto libre:</strong> busca por código o palabras clave del estándar.'
        )}
      `)}`;

    const panelUGCReuniones = `
      ${sec('Reuniones de mentoría', '📅', `
        ${lista(
          'El equipo de Calidad registra las reuniones de mentoría con la fecha, tipo (inicial, seguimiento, evaluación), participantes y acuerdos.',
          'Cada reunión puede incluir <strong>tareas asignadas</strong> con descripción, responsable y plazo.',
          'Puedes marcar tus tareas como <strong>completadas</strong> directamente desde esta pantalla haciendo clic en el checkbox.'
        )}
        ${tip('Las reuniones son creadas por el equipo de Calidad. Si detectas algún error en los datos, comunícalo por mensajes.')}
      `)}`;

    const panelUGCMensajes = `
      ${sec('Enviar un mensaje', '✉️', `
        ${steps(
          'Ve a <strong>Mis Mensajes</strong> en el menú lateral.',
          'Haz clic en <strong>Nuevo mensaje</strong>.',
          'Escribe tu consulta o comunicación en el campo de texto.',
          'Pulsa <strong>Enviar</strong>. El equipo de Calidad recibirá el mensaje en su panel.'
        )}
      `)}
      ${sec('Recibir respuestas', '📩', `
        ${lista(
          'Las respuestas del equipo de Calidad aparecen en la pestaña <strong>Activos</strong> de Mis Mensajes.',
          'Un punto rojo en el icono de campana indica que tienes mensajes sin leer.',
          'La pestaña <strong>Historial</strong> guarda los mensajes ya leídos para futuras consultas.'
        )}
      `)}
      ${sec('Contacto por WhatsApp', '📱', `
        ${lista(
          'En la pantalla de <em>Mis Mensajes</em> encontrarás botones de acceso rápido a WhatsApp del equipo de Calidad.',
          'Estos botones abren directamente la conversación con el número correspondiente.'
        )}
        ${tip('El WhatsApp es para consultas urgentes o coordinación rápida. Para el seguimiento formal, usa el sistema de mensajes de la plataforma.')}
      `)}`;

    const panelUGCHerramientas = `
      ${sec('Buscador de Estándares ACSA', '🔍', `
        ${lista(
          'Herramienta de consulta de los 76 estándares del Manual ACSA para UGC.',
          'Busca por texto libre, filtra por grupo, criterio o bloque de certificación.',
          'Consulta qué otras UGCs del área han superado ya cada estándar y qué evidencias presentaron — muy útil como referencia.',
          'El botón <em>← Mentoría</em> te devuelve directamente a tu panel, sin necesidad de volver a hacer login.'
        )}
      `)}
      ${sec('Modo oscuro', '🌙', `
        ${lista(
          'Haz clic en el icono de luna/sol en el encabezado para alternar entre el tema claro y el oscuro.',
          'La preferencia se guarda en el navegador y se aplica automáticamente en cada visita.'
        )}
      `)}
      ${sec('Directorio del Área', '📋', `
        ${lista(
          'Directorio de contacto del personal del AGS Sur de Córdoba: teléfonos, correos y cargos.',
          'Usa el buscador para encontrar el contacto que necesitas.'
        )}
      `)}`;

    /* ─── RENDER ─── */
    const tabs    = admin ? tabsAdmin : tabsUGC;
    const panels  = admin
      ? { inicio: panelAdminInicio, ugcs: panelAdminUGCs, estandares: panelAdminEstandares, mensajes: panelAdminMensajes, usuarios: panelAdminUsuarios, utilidades: panelAdminUtilidades, herramientas: panelAdminHerramientas }
      : { inicio: panelUGCInicio, estado: panelUGCEstado, estandares: panelUGCEstandares, reuniones: panelUGCReuniones, mensajes: panelUGCMensajes, herramientas: panelUGCHerramientas };

    const tabBar  = `<div class="guia-tabs">${tabs.map((t,i) =>
      `<button class="guia-tab${i===0?' active':''}" onclick="App._guiaTab('${t.id}')">
        <span class="guia-tab-icon">${t.icon}</span>${t.label}
       </button>`
    ).join('')}</div>`;

    const panelsHtml = tabs.map((t,i) =>
      `<div class="guia-panel${i===0?' active':''}" id="guia-panel-${t.id}">${panels[t.id]||''}</div>`
    ).join('');

    const icoDown = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const btnAdmin = admin ? `<button class="guia-btn-pdf guia-btn-pdf-admin" onclick="App.descargarManualAdmin()">${icoDown} Guía de Administrador (PDF)</button>` : '';
    const descarga = `<div class="guia-descarga-btns"><button class="guia-btn-pdf" onclick="App.descargarManualUsuario()">${icoDown} Guía de Usuario (PDF)</button>${btnAdmin}</div>`;

    cont.innerHTML = `<div class="guia-wrapper">${descarga}${tabBar}${panelsHtml}</div>`;
  },

  _guiaTab(id) {
    document.querySelectorAll('.guia-tab').forEach(b => {
      b.classList.toggle('active', b.getAttribute('onclick').includes(`'${id}'`));
    });
    document.querySelectorAll('.guia-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'guia-panel-' + id);
    });
  },

  descargarManualUsuario() {
    App._mostrarInformeEnApp('Guía de Usuario · Plataforma Mentoría ACSA', App._htmlManual(false));
  },

  descargarManualAdmin() {
    App._mostrarInformeEnApp('Guía de Administrador · Plataforma Mentoría ACSA', App._htmlManual(true));
  },

  _htmlManual(esAdmin) {
    const fecha = new Date().toLocaleDateString('es-ES', {day:'2-digit', month:'long', year:'numeric'});
    const rolLabel = esAdmin ? 'Manual del Administrador' : 'Manual del Usuario UGC';

    /* ── helpers internos ──────────────────────────────────────── */
    const ico = (path, sz) => `<svg width="${sz||24}" height="${sz||24}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${path}</svg>`;

    let _sn = 0;
    const secc = (icoPath, tit, sub, body) => {
      _sn++;
      const num = _sn < 10 ? '0' + _sn : String(_sn);
      return `<div class="sec sec-break">
        <div class="sec-hdr">
          <div class="sec-ico">${ico(icoPath, 26)}</div>
          <div class="sec-hdr-txt"><div class="sec-tit">${tit}</div><div class="sec-sub">${sub}</div></div>
          <div class="sec-num">${num}</div>
        </div>
        <div class="sec-body">${body}</div>
      </div>`;
    };

    const blk = (tit, body) => `<div class="blk"><h3 class="blk-tit">${tit}</h3>${body}</div>`;

    const steps = (...items) => `<div class="steps">${items.map((t,i) =>
      `<div class="step"><div class="step-n">${i+1}</div><div class="step-t">${t}</div></div>`
    ).join('')}</div>`;

    const lista = (...items) => `<ul class="gl">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

    const tbl = (heads, rows) => `<table class="gt"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    const tip  = t => `<div class="tip">💡 <strong>Consejo:</strong> ${t}</div>`;
    const warn = t => `<div class="warn">⚠️ <strong>Importante:</strong> ${t}</div>`;
    const nota = t => `<div class="nota">📌 ${t}</div>`;

    /* ── CSS ───────────────────────────────────────────────────── */
    const css = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap');
      @page { margin: 2.2cm 2.8cm; }
      *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:'DM Sans',Arial,sans-serif; color:#1a2332; background:#fff; font-size:11pt; line-height:1.65; }
      h1,h2,h3,h4 { font-weight:700; }
      strong { color:#1e3a5f; }
      em { font-style:italic; }
      code { font-family:monospace; font-size:9.5pt; background:#f0f4f8; padding:1px 5px; border-radius:4px; color:#1e5b8c; }

      /* ── PORTADA ── */
      .cover {
        min-height:100vh; width:100%;
        background:linear-gradient(140deg,#1e3a5f 0%,#1a5490 55%,#1e8aab 100%);
        color:#fff; display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        padding:70px 80px 50px; page-break-after:always; text-align:center;
      }
      .cover-emblem {
        width:88px; height:88px;
        background:rgba(255,255,255,.18); border:2px solid rgba(255,255,255,.35);
        border-radius:22px; display:flex; align-items:center; justify-content:center;
        margin-bottom:28px;
      }
      .cover-area { font-size:11pt; opacity:.75; margin-bottom:10px; letter-spacing:.04em; }
      .cover-title { font-size:28pt; font-weight:700; line-height:1.2; margin-bottom:6px; }
      .cover-divider { width:60px; height:3px; background:rgba(255,255,255,.5); border-radius:2px; margin:22px auto; }
      .cover-badge {
        display:inline-block; background:rgba(255,255,255,.2);
        border:1.5px solid rgba(255,255,255,.45);
        border-radius:30px; padding:9px 28px;
        font-size:13pt; font-weight:600; margin-bottom:18px;
      }
      .cover-desc { font-size:11pt; opacity:.78; max-width:520px; line-height:1.7; margin-bottom:40px; }
      .cover-icons-grid {
        display:grid; grid-template-columns:repeat(4,1fr);
        gap:18px; width:100%; max-width:580px; margin-bottom:50px;
      }
      .cig { display:flex; flex-direction:column; align-items:center; gap:9px; }
      .cig-box {
        width:62px; height:62px;
        background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.28);
        border-radius:14px; display:flex; align-items:center; justify-content:center;
      }
      .cig-lbl { font-size:8.5pt; opacity:.78; text-align:center; line-height:1.3; }
      .cover-foot { font-size:9pt; opacity:.55; margin-top:auto; }
      .cover-foot span { display:block; margin-top:4px; }

      /* ── ÍNDICE ── */
      .toc { page-break-before:always; padding-bottom:30px; }
      .toc-title { font-size:20pt; color:#1e3a5f; margin-bottom:28px; padding-bottom:12px; border-bottom:3px solid #1e5b8c; }
      .toc-item { display:flex; align-items:baseline; padding:7px 0; border-bottom:1px dotted #d0dce8; }
      .toc-n { font-weight:700; color:#1e5b8c; width:32px; flex-shrink:0; font-size:11pt; }
      .toc-l { flex:1; font-size:11pt; color:#1a2332; }
      .toc-s { padding:4px 0 4px 32px; border-bottom:1px dotted #e8f0f8; }
      .toc-s .toc-l { font-size:10pt; color:#5a6a7a; }

      /* ── SECCIONES ── */
      .sec { margin-bottom:36px; }
      .sec-break { page-break-before:always; }
      .sec-hdr {
        background:linear-gradient(135deg,#1e3a5f 0%,#1e5b8c 100%);
        color:#fff; border-radius:10px; padding:18px 22px;
        margin-bottom:22px; display:flex; align-items:center; gap:16px;
      }
      .sec-ico {
        width:50px; height:50px; min-width:50px;
        background:rgba(255,255,255,.18); border-radius:12px;
        display:flex; align-items:center; justify-content:center;
      }
      .sec-hdr-txt { flex:1; }
      .sec-tit { font-size:15pt; font-weight:700; line-height:1.2; }
      .sec-sub { font-size:9.5pt; opacity:.78; margin-top:3px; }
      .sec-num { font-size:32pt; font-weight:700; opacity:.25; line-height:1; }
      .sec-body { padding:0 2px; }

      /* ── BLOQUES ── */
      .blk { margin-bottom:20px; }
      .blk-tit {
        font-size:12pt; color:#1e3a5f; font-weight:700;
        padding:8px 14px; margin-bottom:12px;
        border-left:4px solid #1e5b8c;
        background:#f0f6fb; border-radius:0 6px 6px 0;
      }
      .blk p { font-size:11pt; color:#2a3a4a; line-height:1.7; margin-bottom:10px; }

      /* ── PASOS ── */
      .steps { display:flex; flex-direction:column; gap:10px; margin:10px 0 14px; }
      .step { display:flex; gap:13px; align-items:flex-start; }
      .step-n {
        width:26px; height:26px; min-width:26px;
        background:#1e5b8c; color:#fff; border-radius:50%;
        font-size:10pt; font-weight:700;
        display:flex; align-items:center; justify-content:center;
      }
      .step-t { font-size:11pt; color:#2a3a4a; line-height:1.65; padding-top:3px; }

      /* ── LISTAS ── */
      .gl { list-style:none; padding:0; margin:10px 0 14px; display:flex; flex-direction:column; gap:6px; }
      .gl li { padding:6px 0 6px 22px; position:relative; font-size:11pt; color:#2a3a4a; line-height:1.6; border-bottom:1px solid #f0f4f8; }
      .gl li::before { content:'›'; position:absolute; left:5px; color:#1e5b8c; font-weight:700; font-size:14pt; line-height:1; }

      /* ── TABLAS ── */
      .gt { width:100%; border-collapse:collapse; margin:12px 0 16px; font-size:10.5pt; }
      .gt th { background:#1e3a5f; color:#fff; padding:10px 13px; text-align:left; font-weight:600; }
      .gt td { padding:9px 13px; border-bottom:1px solid #e0e8f0; color:#2a3a4a; vertical-align:top; }
      .gt tr:nth-child(even) td { background:#f5f8fb; }
      .gt .bnd { display:inline-block; padding:3px 10px; border-radius:12px; font-size:9pt; font-weight:700; }
      .bnd-a { background:#fde0e0; color:#b03030; }
      .bnd-u { background:#d5ede0; color:#2d7a4f; }
      .bnd-p { background:#fdefd3; color:#b06000; }

      /* ── CAJAS ── */
      .tip  { background:#d6e8f5; border-left:4px solid #1e5b8c; border-radius:8px; padding:11px 15px; margin:14px 0; font-size:10.5pt; color:#1e3a5f; line-height:1.6; }
      .warn { background:#fdefd3; border-left:4px solid #b06000; border-radius:8px; padding:11px 15px; margin:14px 0; font-size:10.5pt; color:#6b3800; line-height:1.6; }
      .nota { background:#f0f4f8; border-left:4px solid #5a6a7a; border-radius:8px; padding:11px 15px; margin:14px 0; font-size:10.5pt; color:#2a3a4a; line-height:1.6; }

      /* ── INTRO SUB-PORTADA ── */
      .intro-hero {
        background:linear-gradient(135deg,#1e3a5f 0%,#1e5b8c 100%);
        color:#fff; border-radius:10px; padding:26px 28px; margin-bottom:24px;
      }
      .intro-hero h2 { font-size:16pt; margin-bottom:8px; }
      .intro-hero p { font-size:11pt; opacity:.85; line-height:1.7; }

      /* ── PRINT ── */
      @media print {
        .cover { min-height:100vh; }
        .sec-break { page-break-before:always; }
      }
    `;

    /* ── PORTADA ───────────────────────────────────────────────── */
    const coverDesc = esAdmin
      ? 'Administración completa del proceso de acreditación ACSA: seguimiento de las 29 UGCs, validación de estándares, mensajería, gestión de usuarios e importación de datos desde ME_jora C.'
      : 'Seguimiento del proceso de acreditación ACSA de tu Unidad de Gestión Clínica: registro de evidencias, comunicación con el equipo de Calidad y consulta del progreso.';

    const cigData = [
      { path: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>', lbl: 'Cuadro de Mandos' },
      { path: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>', lbl: 'Directorio UGCs' },
      { path: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', lbl: 'Estándares ACSA' },
      { path: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', lbl: 'Reuniones' },
      { path: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', lbl: 'Mensajes' },
      { path: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', lbl: 'Usuarios' },
      { path: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8.5" cy="11" r="2.5"/><path d="M14 9h4M14 13h4M5 17c0-1.66 1.57-3 3.5-3s3.5 1.34 3.5 3"/>', lbl: 'Directorio Área' },
      { path: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', lbl: 'Buscador' },
    ];

    const cover = `
      <div class="cover">
        <div class="cover-emblem">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="20" y="6" width="8" height="36" rx="3" fill="white"/>
            <rect x="6" y="20" width="36" height="8" rx="3" fill="white"/>
          </svg>
        </div>
        <div class="cover-area">Área de Gestión Sanitaria Sur de Córdoba · Área de Calidad y Seguridad del Paciente</div>
        <h1 class="cover-title">Plataforma de Mentoría ACSA</h1>
        <div class="cover-divider"></div>
        <div class="cover-badge">${rolLabel}</div>
        <p class="cover-desc">${coverDesc}</p>
        <div class="cover-icons-grid">
          ${cigData.map(c => `<div class="cig"><div class="cig-box">${ico(c.path, 30)}</div><div class="cig-lbl">${c.lbl}</div></div>`).join('')}
        </div>
        <div class="cover-foot">
          Plataforma Mentoría ACSA &mdash; AGS Sur de Córdoba
          <span>Generado el ${fecha}</span>
        </div>
      </div>`;

    /* ── ÍNDICE ────────────────────────────────────────────────── */
    const tocItems = [
      ['1', 'Introducción y Acceso a la Plataforma'],
      ['2', 'Interfaz y Navegación'],
      ['3', 'Mi Estado · Progreso de Acreditación'],
      ['4', 'Mis Estándares · Registro de Evidencias'],
      ['5', 'Reuniones y Tareas de Mentoría'],
      ['6', 'Mensajes · Comunicación con el Equipo de Calidad'],
      ['7', 'Directorio del Área'],
      ['8', 'Herramientas Complementarias'],
    ];
    const tocAdmin = [
      ['A', 'Cuadro de Mandos'],
      ['B', 'Directorio de UGCs y Ficha UGC'],
      ['C', 'Validación de Estándares'],
      ['D', 'Gestión de Mensajes (Administrador)'],
      ['E', 'Gestión de Usuarios y Roles'],
      ['F', 'Utilidades: Importación y Migración de Datos'],
    ];
    const allToc = esAdmin ? [...tocItems, ...tocAdmin] : tocItems;
    const toc = `
      <div class="toc">
        <h2 class="toc-title">Índice de Contenidos</h2>
        ${allToc.map(([n,l]) => `<div class="toc-item"><div class="toc-n">${n}</div><div class="toc-l">${l}</div></div>`).join('')}
      </div>`;

    /* ── SECCIONES COMUNES (usuario + admin) ──────────────────── */
    const ICO = {
      login:    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      nav:      '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
      estado:   '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
      estand:   '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
      reunion:  '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      mensaje:  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      direct:   '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8.5" cy="11" r="2.5"/><path d="M14 9h4M14 13h4M5 17c0-1.66 1.57-3 3.5-3s3.5 1.34 3.5 3"/>',
      tools:    '<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41M2 12h2M20 12h2"/>',
      dash:     '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
      ugcs:     '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
      check:    '<polyline points="20 6 9 17 4 12"/>',
      usuarios: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      util:     '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    };

    const s1 = secc(ICO.login, 'Introducción y Acceso', 'Registro, inicio de sesión y recuperación de contraseña', `
      ${blk('¿Qué es la Plataforma de Mentoría ACSA?', `<p>La Plataforma de Mentoría ACSA es una herramienta web desarrollada para el <strong>Área de Gestión Sanitaria Sur de Córdoba</strong> que facilita el seguimiento del proceso de acreditación ACSA de las Unidades de Gestión Clínica (UGC). Permite registrar evidencias de estándares, coordinar reuniones de mentoría y mantener comunicación directa entre las UGCs y el equipo de Calidad.</p>`)}
      ${blk('Requisitos de acceso', `
        ${lista(
          'Disponer de un correo corporativo <strong>@juntadeandalucia.es</strong> — es el único dominio permitido.',
          'Acceso a internet desde cualquier navegador moderno (Chrome, Firefox, Edge, Safari).',
          'La plataforma es compatible con dispositivos móviles y tabletas.'
        )}
        ${warn('No es posible registrarse ni iniciar sesión con cuentas de correo personales (Gmail, Outlook, etc.).')}
      `)}
      ${blk('Crear una cuenta nueva', `
        ${steps(
          'Accede a la plataforma y haz clic en <strong>¿Primera vez? Crear una cuenta</strong>.',
          'Introduce tu nombre completo, correo corporativo (@juntadeandalucia.es) y elige una contraseña de al menos 6 caracteres.',
          'Pulsa <strong>Crear cuenta</strong>. Verás una pantalla de espera indicando que tu solicitud está siendo revisada.',
          'Un administrador asignará tu rol y tu UGC. Recibirás acceso en cuanto lo haga.'
        )}
        ${nota('Puedes usar el icono del ojo junto al campo de contraseña para mostrar u ocultar los caracteres mientras escribes.')}
      `)}
      ${blk('Iniciar sesión', `
        ${steps(
          'Introduce tu correo corporativo y contraseña.',
          'Pulsa <strong>Entrar</strong> o presiona la tecla <kbd>Intro</kbd>.',
          'Si tus credenciales son correctas accederás directamente a tu panel.'
        )}
      `)}
      ${blk('Recuperar la contraseña', `
        ${steps(
          'En la pantalla de login, haz clic en <strong>¿Olvidaste tu contraseña? Recuperarla</strong>.',
          'Introduce tu correo corporativo y pulsa <strong>Enviar enlace de recuperación</strong>.',
          'Revisa tu bandeja de entrada (incluyendo la carpeta de spam).',
          'Haz clic en el enlace del correo de Firebase para establecer una nueva contraseña.'
        )}
      `)}
    `);

    const s2 = secc(ICO.nav, 'Interfaz y Navegación', 'Encabezado, barra lateral y elementos de la interfaz', `
      ${blk('Encabezado de la aplicación', `
        ${lista(
          '<strong>Botón de menú (☰):</strong> abre y cierra la barra lateral de navegación. En móvil es el único modo de acceder al menú.',
          '<strong>Icono de luna / sol:</strong> alterna entre el tema oscuro y el tema claro. La preferencia se guarda y se aplica automáticamente en la siguiente visita.',
          '<strong>Icono de campana:</strong> muestra el número de mensajes no leídos. Al pulsarlo accedes directamente al panel de mensajes.',
          '<strong>Avatar (iniciales del usuario):</strong> despliega el menú de cuenta con tu nombre, correo, rol, acceso al Buscador de Estándares y el botón de cerrar sesión.'
        )}
      `)}
      ${blk('Barra lateral de navegación', `
        ${lista(
          'Está organizada por secciones según tu rol (Administración / Mi Unidad / Área / Herramientas).',
          'La sección activa aparece resaltada en azul.',
          'En móvil puedes cerrarla tocando fuera del menú o el mismo botón ☰.'
        )}
      `)}
      ${blk('Modo oscuro', `
        <p>Haz clic en el icono de <strong>luna</strong> (tema claro) o <strong>sol</strong> (tema oscuro) en la esquina superior derecha. El cambio es inmediato y se recuerda entre sesiones.</p>
        ${tip('El modo oscuro reduce la fatiga visual en entornos con poca luz y es especialmente útil en dispositivos móviles.')}
      `)}
    `);

    const s3 = secc(ICO.estado, 'Mi Estado · Progreso de Acreditación', 'Resumen de avance y niveles de certificación', `
      ${blk('¿Qué muestra esta pantalla?', `
        <p>La pantalla <strong>Mi Estado</strong> ofrece una visión global del progreso de tu UGC en el proceso de acreditación ACSA. Incluye el porcentaje de estándares superados por grupo, el nivel de certificación alcanzado y, si ya estás certificado/a, las fechas del ciclo activo.</p>
      `)}
      ${blk('Grupos de estándares', `
        ${tbl(['Grupo', 'Descripción', 'Nº estándares'],
          [
            ['GIO (Obligatorios)', 'Estándares imprescindibles para cualquier nivel de certificación.', '31'],
            ['Grupo I (GI)', 'Estándares adicionales para niveles Avanzado y superiores.', '19'],
            ['Grupo II (GII)', 'Estándares para nivel Óptimo y Excelente.', '18'],
            ['Grupo III (GIII)', 'Estándares para nivel Excelente.', '8'],
          ]
        )}
        ${nota('Total: 76 estándares en el Manual ACSA para UGC.')}
      `)}
      ${blk('Niveles de certificación', `
        ${tbl(['Nivel', 'Requisitos para alcanzarlo'],
          [
            ['En proceso', 'Aún no se han completado los requisitos del nivel Avanzado.'],
            ['Avanzado', '100% de los estándares obligatorios (GIO) + ≥ 70% del Grupo I.'],
            ['Óptimo', '100% Grupo I + ≥ 40% del Grupo II.'],
            ['Excelente', '100% Grupo I + 100% Grupo II + ≥ 40% del Grupo III.'],
          ]
        )}
        ${tip('El Buscador de Estándares te muestra qué estándares han superado ya otras UGCs del área, lo que puede servirte de referencia y ejemplo.')}
      `)}
    `);

    const s4 = secc(ICO.estand, 'Mis Estándares · Registro de Evidencias', 'Cómo completar, proponer y gestionar estándares', `
      ${blk('¿Qué es un estándar ACSA?', `
        <p>Cada estándar define un criterio de calidad que tu UGC debe demostrar que cumple mediante una <strong>evidencia</strong>: descripción de cómo lo implementáis en la práctica y, opcionalmente, el nombre del documento de mejora correspondiente en ME_jora C.</p>
      `)}
      ${blk('Estados posibles de un estándar', `
        ${tbl(['Estado', 'Significado', 'Quién puede cambiarlo'],
          [
            ['⬜ Pendiente', 'Aún no se ha aportado evidencia.', 'UGC o Administrador'],
            ['🟣 Propuesto', 'La UGC ha aportado evidencia y solicita validación.', 'UGC (a Propuesto) · Admin (a Cumple o Pendiente)'],
            ['✅ Cumple', 'Validado por el equipo de Calidad del Área.', 'Solo Administrador'],
          ]
        )}
        ${warn('Una vez que un estándar está en estado <strong>Propuesto</strong>, no puedes modificarlo. Si necesitas hacer cambios, comunícalo al equipo de Calidad a través de Mensajes.')}
      `)}
      ${blk('Cómo registrar una evidencia paso a paso', `
        ${steps(
          'Accede a <strong>Mis Estándares</strong> desde el menú lateral.',
          'Usa los filtros (Grupo, Estado, Obligatoriedad, Texto libre) para localizar el estándar que deseas trabajar.',
          'Haz clic sobre el estándar para abrirlo en un panel de detalle.',
          'En el campo <strong>Descripción de la evidencia</strong>, redacta cómo habéis implantado este criterio en vuestra unidad. Sé específico/a y concreto/a.',
          'En el campo <strong>Documento de mejora en ME_jora C</strong>, anota el nombre exacto del documento subido a la plataforma ME_jora C.',
          'Cuando la evidencia esté lista, cambia el estado a <strong>Propuesto a cumple</strong>.',
          'Haz clic en <strong>Guardar</strong>. El equipo de Calidad recibirá la propuesta para su revisión.'
        )}
        ${tip('Puedes guardar la descripción en estado Pendiente y continuar editándola en visitas posteriores, antes de cambiar a Propuesto.')}
      `)}
      ${blk('Filtros disponibles', `
        ${lista(
          '<strong>Grupo:</strong> filtra por GIO, GI, GII o GIII para centrarte en los estándares que necesitas alcanzar para el siguiente nivel.',
          '<strong>Estado:</strong> Pendiente / Propuesto / Cumple. Muy útil para ver solo los que aún requieren tu atención.',
          '<strong>Solo obligatorios:</strong> muestra únicamente los 31 estándares imprescindibles.',
          '<strong>Criterio y Bloque:</strong> filtrado por criterios ACSA específicos.',
          '<strong>Búsqueda por texto:</strong> escribe el código del estándar (ej: <code>OC1.1</code>) o palabras clave para localizarlo rápidamente.'
        )}
      `)}
    `);

    const s5 = secc(ICO.reunion, 'Reuniones y Tareas de Mentoría', 'Consulta de reuniones, acuerdos y seguimiento de tareas', `
      ${blk('¿Qué son las reuniones de mentoría?', `
        <p>El equipo de Calidad del Área realiza reuniones periódicas con cada UGC para revisar el avance del proceso de acreditación. Cada reunión queda registrada en la plataforma con su fecha, tipo, participantes, acuerdos alcanzados y tareas asignadas.</p>
      `)}
      ${blk('Tipos de reunión', `
        ${tbl(['Tipo', 'Descripción'],
          [
            ['Reunión inicial', 'Primera reunión de presentación del proceso de acreditación y planificación.'],
            ['Seguimiento', 'Revisión periódica del avance de los estándares y resolución de dudas.'],
            ['Evaluación final', 'Revisión del cumplimiento de todos los estándares antes de la evaluación ACSA.'],
          ]
        )}
      `)}
      ${blk('Gestionar tus tareas', `
        ${steps(
          'Accede a <strong>Reuniones</strong> desde el menú lateral.',
          'Selecciona la reunión que deseas consultar para ver el detalle completo.',
          'En la sección <strong>Tareas asignadas</strong> verás las tareas con su descripción, responsable y plazo.',
          'Cuando hayas completado una tarea, marca el checkbox a su izquierda. El cambio se guarda automáticamente.'
        )}
        ${tip('Las reuniones son creadas y editadas por el equipo de Calidad. Si detectas algún error en los datos de una reunión, comunícalo a través de Mensajes.')}
      `)}
    `);

    const s6 = secc(ICO.mensaje, 'Mensajes · Comunicación con el Equipo de Calidad', 'Envío, recepción y gestión de mensajes', `
      ${blk('Panel de mensajes', `
        <p>El sistema de mensajería de la plataforma permite la comunicación formal entre tu UGC y el equipo de Calidad del Área. Los mensajes quedan registrados y son accesibles desde ambas partes en cualquier momento.</p>
        ${lista(
          'La pestaña <strong>Activos</strong> muestra los hilos con mensajes recientes o no leídos.',
          'La pestaña <strong>Historial</strong> guarda las conversaciones ya leídas para consultas futuras.',
          'Un <strong>punto rojo</strong> en el icono de campana del encabezado indica mensajes sin leer.'
        )}
      `)}
      ${blk('Enviar un mensaje nuevo', `
        ${steps(
          'Ve a <strong>Mis Mensajes</strong> en el menú lateral.',
          'Haz clic en <strong>Nuevo mensaje</strong>.',
          'Selecciona el tipo de consulta y redacta tu mensaje.',
          'Pulsa <strong>Enviar</strong>. El equipo de Calidad lo recibirá en su panel.'
        )}
      `)}
      ${blk('Recibir y leer respuestas', `
        ${steps(
          'Cuando el equipo de Calidad responda, aparecerá un indicador en el icono de campana.',
          'Accede a <strong>Mis Mensajes → Activos</strong> para ver la respuesta.',
          'Haz clic en el hilo del mensaje para leer la conversación completa.',
          'El mensaje pasará automáticamente a la pestaña Historial tras ser leído.'
        )}
      `)}
      ${blk('Contacto por WhatsApp', `
        <p>En la pantalla de Mis Mensajes encontrarás botones de acceso rápido al WhatsApp del equipo de Calidad. Úsalos para consultas urgentes o coordinación rápida.</p>
        ${nota('Para el seguimiento formal del proceso de acreditación, utiliza preferentemente el sistema de mensajes de la plataforma, ya que queda registrado.')}
      `)}
    `);

    const s7 = secc(ICO.direct, 'Directorio del Área', 'Contactos del personal del AGS Sur de Córdoba', `
      ${blk('¿Qué contiene el directorio?', `
        <p>El <strong>Directorio del Área</strong> recoge los datos de contacto del personal del Área de Gestión Sanitaria Sur de Córdoba: nombre, cargo, unidad, teléfono y correo electrónico.</p>
      `)}
      ${blk('Cómo buscar un contacto', `
        ${lista(
          '<strong>Buscador:</strong> escribe el nombre, cargo o unidad del contacto que necesitas.',
          '<strong>Filtro por categoría:</strong> selecciona el tipo de personal (directivo, técnico, UGC, etc.).',
          '<strong>Botones de contacto directo:</strong> algunos contactos incluyen botones para llamar o enviar un correo directamente desde la plataforma.'
        )}
      `)}
    `);

    const s8 = secc(ICO.tools, 'Herramientas Complementarias', 'Buscador de estándares, ME_jora C y configuración', `
      ${blk('Buscador de Estándares ACSA', `
        <p>Herramienta independiente que muestra los <strong>76 estándares del Manual ACSA para UGC</strong> con toda su información: criterio, grupo, obligatoriedad, circuito y descripción completa.</p>
        ${lista(
          'Filtra por Bloque, Criterio, Grupo de certificación, Obligatoriedad y Circuito.',
          'Consulta qué UGCs del área han superado ya cada estándar y qué evidencias presentaron — <strong>excelente referencia</strong> para redactar las tuyas.',
          'Genera un PDF o PNG del estándar para compartirlo.',
          'El botón <em>← Mentoría</em> te devuelve a tu panel sin pasar por el login.'
        )}
        ${tip('Accede al Buscador desde el menú lateral o desde el menú de usuario (avatar). También está disponible sin login en la página de inicio de la plataforma.')}
      `)}
      ${blk('Portal ME_jora C', `
        <p>Desde el menú lateral puedes acceder directamente al <strong>portal externo de ME_jora C</strong> de la ACSA, donde se gestionan los documentos de mejora y el expediente de acreditación.</p>
        ${nota('ME_jora C es una plataforma externa de la ACSA, independiente de esta plataforma de mentoría. Las credenciales de acceso son distintas.')}
      `)}
      ${blk('Configuración personal', `
        ${lista(
          '<strong>Cambiar contraseña:</strong> usa la opción de recuperación de contraseña en la pantalla de login.',
          '<strong>Tema oscuro / claro:</strong> icono de luna/sol en el encabezado.',
          '<strong>Cerrar sesión:</strong> menú de usuario (avatar) → Cerrar sesión.'
        )}
      `)}
    `);

    const seccionesUsuario = s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8;

    /* ── SECCIONES ADMIN ──────────────────────────────────────── */
    const seccionesAdmin = esAdmin ? (
      secc(ICO.dash, 'Cuadro de Mandos', 'Visión global del proceso de acreditación de todas las UGCs', `
        ${blk('¿Qué muestra el cuadro de mandos?', `
          <p>El <strong>Cuadro de Mandos</strong> es la pantalla principal del administrador. Ofrece una visión global del estado de acreditación de las 29 UGCs del Área de Gestión Sanitaria Sur de Córdoba en tiempo real.</p>
          ${lista(
            'Tarjetas con el nombre y fase actual de cada UGC. El color del borde indica la fase activa (solicitud, autoevaluación, evaluación, establecimiento, seguimiento, recertificación).',
            'Contador de estándares en estado <strong>Propuesto</strong> pendientes de validación en todo el área.',
            'Lista de los estándares propuestos más recientes: haz clic en cualquiera para abrirlo y validarlo directamente.'
          )}
        `)}
        ${blk('Acceso rápido a fichas UGC', `
          <p>Desde el cuadro de mandos puedes acceder a la ficha de cualquier UGC haciendo clic en su tarjeta. Esto te llevará directamente a la pestaña de <strong>Progreso</strong> de esa UGC.</p>
          ${tip('Usa el buscador y los filtros del Directorio de UGCs cuando necesites localizar una UGC específica por nombre, fase o ámbito.')}
        `)}
      `) +
      secc(ICO.ugcs, 'Directorio de UGCs y Ficha UGC', 'Gestión completa del seguimiento por unidad', `
        ${blk('Directorio de UGCs', `
          <p>Lista completa de las 29 UGCs del área con su fase actual de acreditación, ámbito (Atención Primaria / Hospital) y nombre completo. Dispone de buscador y filtros por fase y ámbito.</p>
        `)}
        ${blk('Ficha UGC · Pestaña Progreso', `
          ${lista(
            'Porcentaje de estándares cumplidos desglosado por grupo (GIO, GI, GII, GIII).',
            'Nivel de certificación actual y requisitos para el siguiente nivel.',
            'Botón <strong>Generar informe PDF</strong>: crea un informe completo de la UGC con todos sus datos, estándares, reuniones y mensajes.'
          )}
        `)}
        ${blk('Ficha UGC · Pestaña Estándares', `
          ${lista(
            'Lista completa de los 76 estándares con el estado actual en esta UGC.',
            'Los estándares en estado <strong>Propuesto</strong> aparecen resaltados en morado — son los que requieren tu revisión.',
            'Haz clic en cualquier estándar para abrirlo, leer la evidencia y validarla o devolverla a Pendiente.',
            'Los filtros son idénticos a los del panel de usuario.'
          )}
        `)}
        ${blk('Ficha UGC · Pestaña Reuniones', `
          ${steps(
            'Haz clic en <strong>Nueva reunión</strong> para registrar una reunión de mentoría.',
            'Completa la fecha, tipo, participantes y acuerdos alcanzados.',
            'Añade las tareas asignadas: descripción, responsable y plazo.',
            'Guarda la reunión. Quedará visible para el responsable de la UGC.'
          )}
        `)}
        ${blk('Ficha UGC · Pestaña Información', `
          <p>Recoge todos los datos del ciclo de acreditación de la UGC: tipo de proyecto, director clínico, responsable del proyecto, 11 fechas clave del ciclo (solicitud, autoevaluación desde/hasta, respuesta al solicitante desde/hasta, seguimiento, apercibimiento desde/hasta, fin de certificación), ubicaciones del centro y histórico de certificaciones.</p>
          ${steps(
            'Haz clic en <strong>Editar</strong> para modificar los datos.',
            'Completa o actualiza los campos necesarios.',
            'Pulsa <strong>Guardar cambios</strong>.'
          )}
          ${tip('Al importar desde ME_jora C (Utilidades → Importar Proyecto), estos campos se completan automáticamente con los datos del PDF.')}
        `)}
      `) +
      secc(ICO.check, 'Validación de Estándares', 'Proceso de revisión y validación de evidencias propuestas', `
        ${blk('Flujo de validación', `
          ${steps(
            'La UGC registra su evidencia y cambia el estado del estándar a <strong>Propuesto a cumple</strong>.',
            'El estándar aparece resaltado en morado en la ficha UGC y en el Cuadro de Mandos.',
            'El administrador accede a la ficha UGC → pestaña Estándares → hace clic en el estándar propuesto.',
            'Lee la descripción de la evidencia y el nombre del documento en ME_jora C.',
            'Si la evidencia es correcta: cambia el estado a <strong>Cumple</strong> y guarda.',
            'Si la evidencia es insuficiente: cambia el estado a <strong>Pendiente</strong>, añade un comentario explicando qué falta y guarda.',
            'La UGC podrá ver el cambio de estado y el comentario en su panel de estándares.'
          )}
        `)}
        ${blk('Criterios de validación recomendados', `
          ${lista(
            'La evidencia describe <strong>cómo</strong> se implementa el criterio en la práctica clínica, no solo que se hace.',
            'El documento en ME_jora C existe y está accesible en la plataforma ACSA.',
            'La evidencia es específica de la UGC, no una descripción genérica.',
            'Si aplica un protocolo de área, la UGC debe demostrar que lo ha adaptado o adoptado en su unidad.'
          )}
          ${tip('Puedes usar el Buscador de Estándares para ver las evidencias validadas de otras UGCs como referencia de calidad.')}
        `)}
      `) +
      secc(ICO.mensaje, 'Gestión de Mensajes (Administrador)', 'Panel centralizado de comunicaciones con todas las UGCs', `
        ${blk('Panel centralizado de mensajes', `
          <p>El panel de mensajes del administrador agrupa todas las comunicaciones de las 29 UGCs. Los mensajes se organizan en <strong>hilos</strong> (mensaje original + todas las respuestas).</p>
          ${lista(
            'Pestaña <strong>Activos:</strong> hilos con mensajes no leídos, ordenados por fecha (más recientes primero).',
            'Pestaña <strong>Historial:</strong> hilos ya leídos para consultas futuras.',
            'El número en el icono de campana indica el total de mensajes no leídos en toda la plataforma.'
          )}
        `)}
        ${blk('Responder a una UGC', `
          ${steps(
            'Ve a <strong>Mensajes</strong> en el menú lateral.',
            'Selecciona el hilo de la UGC que deseas responder.',
            'Lee el mensaje original y el historial de la conversación.',
            'Escribe tu respuesta en el campo de texto y pulsa <strong>Enviar</strong>.',
            'La UGC recibirá la respuesta en su panel de Mis Mensajes y verá el indicador de mensaje no leído.'
          )}
          ${tip('También puedes iniciar una conversación con una UGC desde la pestaña Mensajes dentro de su Ficha UGC.')}
        `)}
        ${blk('Eliminar un hilo de mensajes', `
          <p>Para eliminar un hilo completo (mensaje original + todas sus respuestas), haz clic en el icono 🗑️ junto al hilo en la lista. Esta acción es definitiva y no tiene marcha atrás.</p>
          ${warn('Solo el administrador puede eliminar hilos de mensajes. Una vez eliminados no pueden recuperarse.')}
        `)}
      `) +
      secc(ICO.usuarios, 'Gestión de Usuarios y Roles', 'Administración de accesos y asignación de UGCs', `
        ${blk('Roles disponibles', `
          ${tbl(['Rol', 'Acceso a la plataforma'],
            [
              ['<span class="bnd bnd-a">Admin</span>', 'Acceso completo: cuadro de mandos, todas las UGCs, validar estándares, mensajes de todas las UGCs, gestión de usuarios y utilidades.'],
              ['<span class="bnd bnd-u">UGC</span>', 'Solo su propia UGC: Mi Estado, Mis Estándares, Reuniones, Mis Mensajes y Directorio.'],
              ['<span class="bnd bnd-p">Pendiente</span>', 'Pantalla de espera. No puede acceder a la aplicación hasta que el administrador le asigne un rol.'],
            ]
          )}
        `)}
        ${blk('Gestionar usuarios', `
          ${steps(
            'Ve a <strong>Usuarios</strong> en el menú lateral.',
            'Verás la lista de todos los usuarios registrados con su nombre, correo, rol actual y UGC asignada.',
            'Para cambiar el rol: haz clic en el selector junto al usuario y elige el nuevo rol.',
            'Si asignas rol <strong>UGC</strong>, aparece un selector con la lista de las 29 UGCs para asignarle la suya.',
            'Si asignas rol <strong>Admin</strong>, la UGC asignada se borra automáticamente.',
            'Los cambios se guardan automáticamente en cuanto seleccionas el nuevo valor.'
          )}
          ${warn('Al cambiar el rol de un usuario a Admin, asegúrate de que es una persona de confianza con responsabilidades de gestión del proceso de acreditación.')}
        `)}
        ${blk('Primer administrador', `
          <p>El primer administrador no puede ser creado desde la propia plataforma (ya que necesita que un admin lo active). Para configurar el primer admin:</p>
          ${steps(
            'Crea la cuenta desde la pantalla de login con el correo corporativo.',
            'Accede a la <strong>consola de Firebase</strong> (console.firebase.google.com).',
            'Ve a <strong>Firestore Database → /usuarios/{uid}</strong> donde uid es el identificador del usuario recién creado.',
            'Edita el campo <code>rol</code> y cambia su valor de <em>pendiente</em> a <em>admin</em>.',
            'A partir de ese momento el usuario tendrá acceso completo de administrador.'
          )}
        `)}
      `) +
      secc(ICO.util, 'Utilidades: Importación y Migración de Datos', 'Herramientas exclusivas para administradores', `
        ${blk('Importar Ficha de Proyecto desde PDF (ME_jora C)', `
          <p>Permite importar automáticamente los datos del ciclo de acreditación de una UGC directamente desde el PDF de la <strong>Ficha de Proyecto</strong> descargado de ME_jora C.</p>
          ${steps(
            'Ve a <strong>Utilidades</strong> en el menú lateral (solo visible para administradores).',
            'En el panel derecho <em>Importar PDF de Ficha de Proyecto</em>, arrastra el archivo PDF o haz clic para seleccionarlo.',
            'La plataforma extrae automáticamente: tipo de proyecto, director clínico, responsable del proyecto, las 11 fechas del ciclo, las ubicaciones del centro y los datos de certificación.',
            'Si existen varias grafías de una misma ubicación (ej: "C.S. Castro del Río" y "Centro de Salud de Castro"), aparecerán agrupadas con botones de selección para elegir la canónica.',
            'Selecciona la UGC de destino en el selector desplegable.',
            'Pulsa <strong>Importar Proyecto</strong>. Los datos se combinarán con los existentes (operación merge: nada se borra).'
          )}
          ${tip('Descarga la Ficha de Proyecto desde ME_jora C en formato PDF imprimible. La plataforma reconoce el formato estándar de la ACSA.')}
        `)}
        ${blk('Importar evidencias desde Excel (ME_jora C)', `
          <p>Permite actualizar masivamente los campos de evidencia de los estándares de una UGC usando el archivo Excel de seguimiento descargado de ME_jora C.</p>
          ${steps(
            'En el panel izquierdo <em>Importar estándares desde Excel</em>, arrastra el archivo .xlsx o haz clic para seleccionarlo.',
            'Si necesitas filtrar por fechas, ajusta el rango Desde / Hasta (el campo Desde es opcional).',
            'Revisa la tabla de vista previa con los estándares que se importarán.',
            'Pulsa <strong>Importar evidencias</strong>. Los campos de evidencia y documento se actualizarán en Firestore.'
          )}
          ${warn('La importación sobreescribe los campos de evidencia existentes. Revisa la vista previa antes de confirmar.')}
        `)}
        ${blk('Migrar datos entre UGCs', `
          <p>Copia todos los estándares, reuniones y mensajes de un ID de UGC a otro. Útil cuando se corrige un identificador erróneo o se reestructura el directorio.</p>
          ${steps(
            'Introduce el ID de UGC <strong>origen</strong> (el que tiene los datos).',
            'Introduce el ID de UGC <strong>destino</strong> (el nuevo identificador).',
            'Pulsa <strong>Migrar</strong>. Los datos se copian al destino.'
          )}
          ${nota('Esta operación no elimina los datos del origen. Verifica que la migración fue correcta antes de eliminar la UGC antigua.')}
        `)}
      `)
    ) : '';

    /* ── DOCUMENTO FINAL ──────────────────────────────────────── */
    const intro = esAdmin ? `
      <div class="intro-hero sec-break">
        <h2>Secciones de Usuario</h2>
        <p>Las secciones 1 a 8 describen las funcionalidades disponibles para todos los usuarios con rol UGC. Como administrador tienes acceso a todas estas funciones además de las secciones específicas de administración.</p>
      </div>` : '';

    const introAdmin = esAdmin ? `
      <div class="intro-hero sec-break">
        <h2>Secciones de Administración</h2>
        <p>Las secciones A a F describen las funcionalidades exclusivas del rol de administrador: gestión global de UGCs, validación de estándares, comunicaciones centralizadas, gestión de usuarios e importación de datos.</p>
      </div>` : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${rolLabel} · Plataforma Mentoría ACSA</title>
  <style>${css}</style>
</head>
<body>
  ${cover}
  ${toc}
  ${intro}
  ${seccionesUsuario}
  ${introAdmin}
  ${seccionesAdmin}
</body>
</html>`;
  },

  _mostrarInformeEnApp(titulo, html) {
    const overlay = document.getElementById('overlay-informe');
    const iframe  = document.getElementById('informe-iframe');
    const tituloEl = document.getElementById('overlay-informe-titulo');
    if (tituloEl) tituloEl.textContent = titulo || '';
    iframe.srcdoc = html;
    overlay.style.display = 'flex';
  },

  imprimirInforme() {
    const iframe = document.getElementById('informe-iframe');
    if (iframe && iframe.contentWindow) iframe.contentWindow.print();
  },

  cerrarInforme() {
    const overlay = document.getElementById('overlay-informe');
    overlay.style.display = 'none';
    document.getElementById('informe-iframe').srcdoc = '';
  },

  /* ══════════════════════════════════════════════════
     MODALES
  ══════════════════════════════════════════════════ */
  abrirModal(id) {
    document.getElementById(id).classList.add('open');
  },
  cerrarModal(id) {
    document.getElementById(id).classList.remove('open');
  },

  _expandirCampo(fieldId, btn) {
    const ta = document.getElementById(fieldId);
    if (!ta) return;
    const expanded = ta.dataset.expanded === '1';
    const poly = btn.querySelector('polyline');

    if (expanded) {
      // Contraer → vuelve a la altura compacta (4 filas), elimina alto fijo
      ta.style.height = '';
      ta.rows = 4;
      ta.dataset.expanded = '0';
      if (poly) poly.setAttribute('points', '6 9 12 15 18 9');
      btn.title = 'Expandir';
      btn.setAttribute('aria-label', 'Expandir');
    } else {
      // Expandir → medir scrollHeight real (funciona también con texto sin saltos de línea)
      ta.style.height = 'auto';
      const alto = Math.min(Math.max(ta.scrollHeight, 96), 480); // límites: 96px–480px
      ta.style.height = alto + 'px';
      ta.dataset.expanded = '1';
      if (poly) poly.setAttribute('points', '18 15 12 9 6 15');
      btn.title = 'Contraer';
      btn.setAttribute('aria-label', 'Contraer');
    }
  },

  /* ══════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════ */
  showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2800);
  },
};

/* ── Cerrar user menu al clicar fuera ── */
document.addEventListener('click', e => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('userDropdown').classList.remove('open');
    App._userMenuOpen = false;
  }
});