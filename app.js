/* ═══════════════════════════════════════════════════════════════
   app.js  —  Lógica principal Plataforma Mentoría ACSA
   Área de Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 9 */
/* global firebase, auth, db, COL, UGCS, STANDARDS,
          calcularNivel, fmtFecha, fmtFechaHora, calcularFechasACSA, fmtFechaStr,
          getUser, getPerfil, isAdmin, isUGC,
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

  async mostrarPanelUGC(perfil) {
    document.getElementById('nav-ugc').style.display        = 'block';
    document.getElementById('nav-admin').style.display      = 'none';
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
    badge.textContent = rol === 'admin' ? 'Administrador' : 'Usuario UGC';
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

    document.getElementById('ficha-titulo').textContent   = ugc.denominacion;
    document.getElementById('ficha-subtitulo').textContent = ugc.ubicacion + ' · ' + ugc.ambito_label;

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
          <button class="btn-sm" onclick="App._mostrarInfoUGC(true)">✏️ Editar</button>
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
            <select id="modal-est-estado" style="width:100%;padding:9px 12px;margin-bottom:10px">
              <option value="pendiente" ${d.estado==='pendiente'?'selected':''}>⭕ Pendiente</option>
              ${isAdmin() ? `<option value="cumple" ${d.estado==='cumple'?'selected':''}>✅ Cumple (validado)</option>` : ''}
              <option value="propuesto" ${d.estado==='propuesto'?'selected':''}>⏳ Propuesto a cumple</option>
            </select>
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
            <button class="btn-secondary" onclick="App.cerrarModal('modal-estandar')">Cancelar</button>
            <button class="btn-primary" onclick="App.guardarEstado('${ugcId}','${codigo}')">Guardar</button>
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
      el.innerHTML = `
        <table class="tabla-acreditacion">
          <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>UGC</th><th>Registro</th></tr></thead>
          <tbody>
            ${snap.docs.map(doc => {
              const d = doc.data();
              const selectUGC = `<select onchange="App.asignarUGC('${doc.id}',this.value)" style="padding:5px 8px;font-size:12px"><option value="">— Sin asignar —</option>${UGCS.map(u=>`<option value="${u.id}" ${d.ugc_id===u.id?'selected':''}>${u.denominacion}</option>`).join('')}</select>`;
              const textoAdmin = `<span style="font-size:12px;color:var(--text3);font-style:italic">— Administrador —</span>`;
              const ugcCell = d.rol === 'admin' ? textoAdmin : selectUGC;
              return `
                <tr>
                  <td><strong>${d.nombre}</strong></td>
                  <td><small>${d.email}</small></td>
                  <td>
                    <select onchange="App.cambiarRol('${doc.id}',this.value)" style="padding:5px 8px;font-size:12px">
                      <option value="pendiente" ${d.rol==='pendiente'?'selected':''}>⏳ Pendiente</option>
                      <option value="admin"     ${d.rol==='admin'?'selected':''}>🔑 Admin</option>
                      <option value="ugc"       ${d.rol==='ugc'?'selected':''}>🏥 UGC</option>
                    </select>
                  </td>
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
      if (rol === 'admin') datos.ugc_id = null;   // los admins no pertenecen a ninguna UGC
      await db.collection(COL.usuarios).doc(uid).update(datos);
      App.showToast('✅ Rol actualizado');
      App.cargarUsuarios();   // recargar para que la columna UGC refleje el cambio
    } catch(e) { App.showToast('❌ Error: ' + e.message); }
  },

  async asignarUGC(uid, ugcId) {
    try {
      await db.collection(COL.usuarios).doc(uid).update({ ugc_id: ugcId || null });
      App.showToast('✅ UGC asignada');
    } catch(e) { App.showToast('❌ Error: ' + e.message); }
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

    const seccion = (titulo, icono, items) => `
      <div class="guia-seccion">
        <div class="guia-seccion-titulo">${icono} ${titulo}</div>
        <ul class="guia-lista">${items.map(i => `<li>${i}</li>`).join('')}</ul>
      </div>`;

    const htmlAdmin = `
      <div class="guia-intro">
        <p>Bienvenido/a al panel de <strong>Administrador</strong> de la Plataforma de Mentoría ACSA.
        Desde aquí puedes gestionar todo el proceso de acreditación de las 26 UGCs del Área de Gestión Sanitaria Sur de Córdoba.</p>
      </div>
      ${seccion('Cuadro de Mandos', '📊', [
        'Muestra el resumen global de todas las UGCs: cuántas están en cada fase y cuántos estándares están propuestos pendientes de validación.',
        'Haz clic en cualquier tarjeta de UGC del dashboard para abrir su ficha completa.',
        'Los estándares <em>Propuestos</em> aparecen en la lista inferior; haz clic para revisarlos y validarlos o devolverlos.'
      ])}
      ${seccion('Directorio de UGCs', '🏥', [
        'Lista las 26 UGCs del área con su fase actual de acreditación.',
        'Usa el buscador y los filtros (fase, ámbito) para localizar rápidamente una UGC.',
        'Haz clic en una tarjeta para abrir la <strong>Ficha UGC</strong> con 5 pestañas: Progreso, Estándares, Reuniones, Mensajes e Información.'
      ])}
      ${seccion('Ficha UGC → Estándares', '✅', [
        'Visualiza los 76 estándares del manual ACSA con su estado actual (Pendiente / Propuesto / Cumple).',
        'Haz clic en cualquier estándar para abrirlo: puedes cambiar su estado, leer la evidencia aportada y validarlo como <em>Cumple</em> o devolverlo a <em>Pendiente</em>.',
        'Usa los filtros por grupo, obligatoriedad, criterio y estado para centrarte en lo que necesitas revisar.'
      ])}
      ${seccion('Ficha UGC → Reuniones', '📅', [
        'Crea registros de reuniones de mentoría con fecha, tipo, participantes, acuerdos y tareas asignadas.',
        'Las tareas pueden marcarse como completadas desde la misma ficha.',
        'El botón <em>Informe PDF</em> genera un informe completo de la UGC descargable/imprimible.'
      ])}
      ${seccion('Mensajes', '💬', [
        'Panel centralizado de todos los mensajes recibidos de las UGCs.',
        'Puedes responder directamente desde la plataforma; la UGC recibirá la respuesta en su panel de mensajes.',
        'El icono de campana en el encabezado muestra el número de mensajes no leídos.'
      ])}
      ${seccion('Gestión de Usuarios', '👥', [
        'Lista todos los usuarios registrados con su rol y UGC asignada.',
        'Cambia el rol de un usuario entre <em>Pendiente</em>, <em>Usuario UGC</em> y <em>Administrador</em>.',
        'Asigna la UGC correspondiente a cada usuario de rol <em>ugc</em>.'
      ])}
      ${seccion('Directorio del Área', '📋', [
        'Directorio de contacto del personal del AGS Sur de Córdoba.',
        'Como administrador puedes añadir, editar y eliminar contactos.',
        'Los usuarios UGC pueden consultar el directorio pero no modificarlo.'
      ])}
      ${seccion('Utilidades (solo admin)', '🛠️', [
        '<strong>Importar estándares desde Excel:</strong> Sube el archivo de evidencias descargado de ME_jora C. La utilidad detecta el formato automáticamente, filtra por fechas si es necesario y actualiza masivamente los campos de evidencia y documentos en Firestore.',
        '<strong>Migrar datos entre UGCs:</strong> Copia todos los estándares, reuniones y mensajes de un ID de UGC antiguo a uno nuevo. Útil al reestructurar el directorio de UGCs.'
      ])}
      ${seccion('Buscador de Estándares', '🔍', [
        'Herramienta independiente que muestra los 76 estándares del Manual ACSA para UGC.',
        'Filtra por Bloque, Criterio, Grupo de certificación, Obligatoriedad y Circuito.',
        'Consulta las UGCs que ya han cumplido cada estándar y accede directamente a su evidencia.',
        'El botón <em>← Mentoría</em> te devuelve al Cuadro de Mandos sin pasar por la pantalla de inicio.'
      ])}`;

    const htmlUGC = `
      <div class="guia-intro">
        <p>Bienvenido/a a la Plataforma de Mentoría ACSA. Esta herramienta te ayuda a llevar el seguimiento del proceso de acreditación de tu Unidad de Gestión Clínica y a mantener comunicación con el equipo de Calidad del Área.</p>
      </div>
      ${seccion('Mi Estado', '📊', [
        'Muestra el resumen de progreso de tu UGC: porcentaje de estándares cumplidos por grupo y nivel de certificación alcanzado.',
        'Los niveles son: <em>En Proceso → Avanzado → Óptimo → Excelente</em>, según los umbrales del manual ACSA.',
        'Consulta aquí tu fase actual de acreditación y las fechas clave si ya estás certificado/a.'
      ])}
      ${seccion('Mis Estándares', '✅', [
        'Lista los 76 estándares del Manual ACSA con su estado actual en tu UGC.',
        'Haz clic en cualquier estándar para abrirlo y completar la información: descripción de la evidencia, nombre del documento en ME_jora C y área de mejora.',
        'Cuando una evidencia esté lista, cambia el estado a <em>Propuesto a cumple</em> para que el equipo de Calidad la valide.',
        'Usa los filtros para localizar rápidamente los estándares pendientes u obligatorios.'
      ])}
      ${seccion('Reuniones', '📅', [
        'Consulta el registro de reuniones de mentoría con el equipo de Calidad.',
        'Verás los acuerdos alcanzados y las tareas asignadas a tu UGC.',
        'Puedes marcar tus tareas como completadas directamente desde esta pantalla.'
      ])}
      ${seccion('Mis Mensajes', '💬', [
        'Envía consultas o comunicaciones al equipo de Calidad del Área.',
        'Recibirás las respuestas en este mismo panel.',
        'También puedes contactar directamente por WhatsApp con Rafael o Carlos usando los botones de acceso rápido.'
      ])}
      ${seccion('Directorio del Área', '📋', [
        'Directorio de contacto del personal del AGS Sur de Córdoba: teléfonos, correos y cargos.',
        'Usa el buscador o filtra por categoría para encontrar el contacto que necesitas.'
      ])}
      ${seccion('Buscador de Estándares', '🔍', [
        'Herramienta de consulta de los 76 estándares del Manual ACSA para UGC.',
        'Puedes buscar por texto libre, filtrar por grupo, criterio o bloque.',
        'Consulta qué UGCs del área han acreditado ya cada estándar y qué evidencias presentaron.',
        'El botón <em>← Mentoría</em> te devuelve directamente a tu panel.'
      ])}`;

    cont.innerHTML = `
      <div class="guia-wrapper">
        ${admin ? htmlAdmin : htmlUGC}
      </div>`;
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