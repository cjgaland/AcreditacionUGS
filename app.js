/* ═══════════════════════════════════════════════════════════════
   app.js  —  Lógica principal Plataforma Mentoría ACSA
   Área de Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 9 */
/* global firebase, auth, db, COL, UGCS, STANDARDS,
          calcularNivel, fmtFecha, fmtFechaHora,
          getUser, getPerfil, isAdmin, isUGC,
          logout, abrirWhatsApp,
          iniciarListenerNotificaciones,
          iniciarListenerNotificacionesAdmin,
          confirm */

'use strict';

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    document.getElementById('nav-admin').style.display = 'block';
    document.getElementById('nav-ugc').style.display   = 'none';
    document.getElementById('userName').textContent    = perfil.nombre;
    document.getElementById('userEmail').textContent   = perfil.email;
    document.getElementById('userRol').textContent     = '🔑 Administrador';
    App._setUserAvatar(perfil);
    iniciarListenerNotificacionesAdmin();
    await App._sincronizarUGCs();
    App.navigate('dashboard');
  },

  async mostrarPanelUGC(perfil) {
    document.getElementById('nav-ugc').style.display   = 'block';
    document.getElementById('nav-admin').style.display = 'none';
    document.getElementById('userName').textContent    = perfil.nombre;
    document.getElementById('userEmail').textContent   = perfil.email;
    document.getElementById('userRol').textContent     = `🏥 ${perfil.cargo || 'UGC'}`;
    App._setUserAvatar(perfil);
    iniciarListenerNotificaciones(perfil.ugc_id);
    await App._sincronizarUGCs(perfil.ugc_id);
    App.navigate('mi-estado');
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
        <table class="tabla-acreditacion">
          <thead><tr>
            <th>Unidad</th><th>Fase</th><th>Estado</th><th>Nivel</th><th></th>
          </tr></thead>
          <tbody>
            ${activas.map(u => `
              <tr id="dash-row-${u.id}">
                <td><strong>${u.denominacion}</strong><br><small style="color:var(--text3)">${u.ubicacion}</small></td>
                <td>${App._faseBadge(u.fase)}</td>
                <td><small>${u.estado_fase || '—'}</small></td>
                <td id="dash-nivel-${u.id}"><span style="color:var(--text3)">—</span></td>
                <td><button class="btn-sm" onclick="App.abrirFichaUGC('${u.id}')">Ver →</button></td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      // Cargar nivel de cada UGC activa en paralelo
      activas.forEach(u => App._cargarNivelDashboard(u.id));
    }

    // KPI: reuniones este mes (consulta individual por UGC, sin índice collectionGroup)
    try {
      const ahora     = new Date();
      const inicioMes = firebase.firestore.Timestamp.fromDate(
        new Date(ahora.getFullYear(), ahora.getMonth(), 1)
      );
      let totalReuniones = 0;
      await Promise.all(UGCS.map(u =>
        db.collection(COL.ugcs).doc(u.id).collection('reuniones')
          .where('fecha', '>=', inicioMes)
          .get()
          .then(s => { totalReuniones += s.size; })
          .catch(() => {})
      ));
      document.getElementById('kpi-reuniones').textContent = totalReuniones;
    } catch(e) {
      document.getElementById('kpi-reuniones').textContent = '—';
    }

    // Propuestos pendientes
    try {
      const propuestosEl = document.getElementById('lista-propuestos');
      const snap = await db.collectionGroup('estandares')
        .where('estado', '==', 'propuesto')
        .orderBy('propuesto_en', 'desc')
        .limit(20)
        .get();

      if (snap.empty) {
        propuestosEl.innerHTML = '<div class="empty-state"><p>✅ No hay estándares pendientes de validación.</p></div>';
      } else {
        propuestosEl.innerHTML = snap.docs.map(doc => {
          const d = doc.data();
          const path = doc.ref.path.split('/');
          const ugcId = path[1];
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
  },

  async _cargarNivelDashboard(ugcId) {
    const el = document.getElementById('dash-nivel-' + ugcId);
    if (!el) return;
    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId).collection('estandares').get();
      if (snap.empty || typeof STANDARDS === 'undefined') { el.innerHTML = '<span style="color:var(--text3)">Sin datos</span>'; return; }
      const estadosMap = {};
      snap.forEach(doc => { estadosMap[doc.id] = doc.data().estado || 'pendiente'; });
      const lista = STANDARDS.map(s => ({ ...s, estado: estadosMap[s.codigo] || 'pendiente' }));
      const { nivel, color } = calcularNivel(lista);
      el.innerHTML = `<span style="font-size:12px;font-weight:700;color:${color}">${nivel}</span>`;
    } catch(e) {
      el.innerHTML = '<span style="color:var(--text3)">—</span>';
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
      if (q && !`${u.denominacion} ${u.ubicacion}`.toLowerCase().includes(q)) return false;
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
    el.innerHTML = lista.map(u => `
      <div class="ugc-card" onclick="App.abrirFichaUGC('${u.id}')">
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
      </div>`).join('');
  },

  _faseBadge(fase) {
    const clases = {
      'Sin solicitar':           'fase-sin',
      'Solicitud de Certificación': 'fase-activa',
      'Autoevaluación':          'fase-activa',
      'Evaluación':              'fase-eval',
      'Seguimiento':             'fase-activa',
      'Recertificación':         'fase-recert',
    };
    const cls = clases[fase] || 'fase-sin';
    return `<span class="fase-badge ${cls}">${fase || 'Sin solicitar'}</span>`;
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
      pasos.push(faltanOblig > 0 ? 
        `<li>✗ <strong>${faltanOblig} obligatorio${faltanOblig > 1 ? 's' : ''} pendiente${faltanOblig > 1 ? 's' : ''}</strong> (${nv.cumpleObligatorios}/${nv.totalObligatorios})</li>`
        : '<li>✅ Todos los obligatorios cumplidos</li>');
      const minGI = Math.ceil(nv.totalGI * 0.70);
      const faltanGI = Math.max(0, minGI - nv.cumpleGI);
      pasos.push(faltanGI > 0 ? 
        `<li>✗ <strong>${faltanGI} estándar${faltanGI > 1 ? 'es' : ''} más de Grupo I</strong> (${nv.cumpleGI}/${nv.totalGI} · mínimo 70% = ${minGI})</li>`
        : '<li>✅ Grupo I al 70% cumplido</li>');
    } else if (nv.nivel === 'Avanzado') {
      siguiente = 'Óptimo'; color = '#1e5b8c';
      const faltanGI = nv.totalGI - nv.cumpleGI;
      pasos.push(faltanGI > 0 ? 
        `<li>✗ <strong>${faltanGI} estándar${faltanGI > 1 ? 'es' : ''} de Grupo I</strong> pendientes (${nv.cumpleGI}/${nv.totalGI})</li>`
        : '<li>✅ Grupo I al 100% cumplido</li>');
      const minGII = Math.ceil(nv.totalGII * 0.40);
      const faltanGII = Math.max(0, minGII - nv.cumpleGII);
      pasos.push(faltanGII > 0 ? 
        `<li>✗ <strong>${faltanGII} estándar${faltanGII > 1 ? 'es' : ''} más de Grupo II</strong> (${nv.cumpleGII}/${nv.totalGII} · mínimo 40% = ${minGII})</li>`
        : '<li>✅ Grupo II al 40% cumplido</li>');
    } else if (nv.nivel === 'Óptimo') {
      siguiente = 'Excelente'; color = '#5c2d7a';
      const faltanGII = nv.totalGII - nv.cumpleGII;
      pasos.push(faltanGII > 0 ? 
        `<li>✗ <strong>${faltanGII} estándar${faltanGII > 1 ? 'es' : ''} de Grupo II</strong> pendientes (${nv.cumpleGII}/${nv.totalGII})</li>`
        : '<li>✅ Grupo II al 100% cumplido</li>');
      const minGIII = Math.ceil(nv.totalGIII * 0.40);
      const faltanGIII = Math.max(0, minGIII - nv.cumpleGIII);
      pasos.push(faltanGIII > 0 ? 
        `<li>✗ <strong>${faltanGIII} estándar${faltanGIII > 1 ? 'es' : ''} más de Grupo III</strong> (${nv.cumpleGIII}/${nv.totalGIII} · mínimo 40% = ${minGIII})</li>`
        : '<li>✅ Grupo III al 40% cumplido</li>');
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

      // Índice de búsqueda completo (igual que el buscador independiente)
      App._estandaresAdminIdx = STANDARDS.map(s => {
        function collect(val) {
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' || typeof val === 'number') return String(val);
          if (Array.isArray(val)) return val.map(collect).join(' ');
          if (typeof val === 'object') return Object.values(val).map(collect).join(' ');
          return '';
        }
        return collect(s).toLowerCase();
      });

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
      countEl.textContent = `${filtered.length} de 76 estándares · ${cumpleN} cumplidos`;
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
        <div class="estandar-item" onclick="App.abrirModalEstandar('${s.codigo}','${ugcId}')">
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
      if (!map.has(hiloId)) map.set(hiloId, { id: hiloId, msgs: [] });
      map.get(hiloId).msgs.push({ id: doc.id, ...d });
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
      if (origen === 'ugc') App.cargarMensajesUGC(ugcId);
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
  },

  _mostrarInfoUGC(editMode) {
    const el = document.getElementById('tab-info-ugc');
    if (!el || !App._infoUGCData) return;
    const { ugc, ugcFs, responsables } = App._infoUGCData;
    const ugcId = ugc.id;
    const v = campo => (ugcFs[campo] !== undefined && ugcFs[campo] !== null) ? ugcFs[campo] : (ugc[campo] || '');

    const faseOpts = ['Sin solicitar','Solicitud de Certificación','Autoevaluación','Evaluación','Seguimiento','Recertificación']
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
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;padding:8px 0">
          ${App._infoRow('ID',          ugc.id)}
          ${App._infoRow('Código ACSA', v('codigo_acsa') || ugc.codigo_acsa || '—')}
          ${App._infoRow('Ámbito',      ugc.ambito_label)}
          ${App._infoRow('Denominación',v('denominacion') || ugc.denominacion)}
          ${App._infoRow('Ubicación',   v('ubicacion')    || ugc.ubicacion)}
          ${App._infoRow('Fase',        ugc.fase)}
          ${App._infoRow('Estado',      ugc.estado_fase || '—')}
          ${App._infoRow('Dirección',   v('direccion') || ugc.direccion || '—')}
          ${App._infoRow('Teléfono',    v('telefono1')  || ugc.telefono1 || '—')}
          ${App._infoRow('Correo',      v('correo')     || ugc.correo   || '—')}
          ${(v('web') || ugc.web) ? `<div><label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:3px">Web</label><a href="${escHtml(v('web')||ugc.web)}" target="_blank" style="color:var(--accent2);font-size:13px">${escHtml(v('web')||ugc.web)}</a></div>` : ''}
          ${(v('observaciones')||ugc.observaciones) ? App._infoRow('Observaciones', v('observaciones')||ugc.observaciones) : ''}
        </div>
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
        </div>`;
    }
  },

  _inputField(label, id, value) {
    return `<div>
      <label style="font-size:11px;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:4px">${label}</label>
      <input type="text" id="${id}" value="${escHtml(value || '')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box">
    </div>`;
  },

  async guardarInfoUGC(ugcId) {
    const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const data = {
      denominacion:  g('ei-nombre'),
      codigo_acsa:   g('ei-codigo'),
      ubicacion:     g('ei-ubicacion'),
      direccion:     g('ei-direccion'),
      telefono1:     g('ei-telefono'),
      correo:        g('ei-correo'),
      web:           g('ei-web'),
      observaciones: g('ei-observaciones'),
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
    try {
      await db.collection(COL.ugcs).doc(ugcId).set({ fase }, { merge: true });
      const ugc = UGCS.find(u => u.id === ugcId);
      if (ugc) ugc.fase = fase;
      if (App._infoUGCData) App._infoUGCData.ugc.fase = fase;
      App.showToast('✅ Fase actualizada correctamente');
    } catch(e) {
      App.showToast('❌ Error al guardar la fase');
    }
  },

  /* ══════════════════════════════════════════════════
     MODAL ESTÁNDAR
  ══════════════════════════════════════════════════ */
  abrirModalEstandar(codigo, ugcId) {
    const est = typeof STANDARDS !== 'undefined' ? STANDARDS.find(s => s.codigo === codigo) : null;
    if (!est) return;

    const overlay = document.getElementById('modal-estandar');
    const content = document.getElementById('modal-estandar-content');

    // Cargar estado actual
    db.collection(COL.ugcs).doc(ugcId).collection('estandares').doc(codigo).get()
      .then(doc => {
        const d = doc.exists ? doc.data() : { estado: 'pendiente', evidencia_texto: '', documento_mejora_c: '' };

        content.innerHTML = `
          <div class="modal-est-codigo">${est.codigo}</div>
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <span class="badge badge-g${est.grupo}">Grupo ${est.grupo}</span>
            ${est.obligatorio === 'Si' ? '<span class="badge badge-oblig">Obligatorio</span>' : ''}
            <span class="badge badge-${d.estado || 'pendiente'}">${{cumple:'✅ Cumple',propuesto:'⏳ Propuesto',pendiente:'⭕ Pendiente'}[d.estado]||'Pendiente'}</span>
          </div>
          <div class="modal-est-enunciado">${est.enunciado}</div>
          <div class="modal-est-proposito">${est.proposito}</div>

          ${est.criterios_evaluables && est.criterios_evaluables.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Criterios evaluables</div>
            ${est.criterios_evaluables.map((ce,i)=>`
              <div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:11px;font-weight:700;color:var(--accent2);min-width:20px">${i+1}.</span>
                <span style="font-size:13px;color:var(--text2);line-height:1.5">${ce.replace(/X$/,'')}</span>
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
            <textarea id="modal-est-evidencia" rows="3" placeholder="Describe brevemente la evidencia disponible en MejoraC…">${d.evidencia_texto || ''}</textarea>
            <label>Nombre del documento en MejoraC</label>
            <input type="text" id="modal-est-documento" placeholder="Ej: PLAN_CALIDAD_2025.pdf" value="${d.documento_mejora_c || ''}">
          </div>

          ${d.validado_en ? `<div style="font-size:11px;color:var(--green);margin-bottom:14px">✅ Validado el ${fmtFecha(d.validado_en)}</div>` : ''}

          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button class="btn-secondary" onclick="App.cerrarModal('modal-estandar')">Cancelar</button>
            <button class="btn-primary" onclick="App.guardarEstado('${ugcId}','${codigo}')">Guardar</button>
          </div>`;

        overlay.classList.add('open');
      });
  },

  async guardarEstado(ugcId, codigo) {
    const estado     = document.getElementById('modal-est-estado').value;
    const evidencia  = document.getElementById('modal-est-evidencia').value.trim();
    const documento  = document.getElementById('modal-est-documento').value.trim();
    const perfil     = getPerfil();

    const data = {
      estado,
      evidencia_texto:    evidencia,
      documento_mejora_c: documento,
      actualizado_por:    getUser().uid,
      actualizado_en:     firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (estado === 'propuesto') {
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
  async cargarMensajesAdmin() {
    const el = document.getElementById('mensajes-admin-list');
    el.innerHTML = '<div class="loading">Cargando mensajes…</div>';
    try {
      const snap = await db.collectionGroup('mensajes')
        .where('para', '==', 'admin')
        .orderBy('fecha', 'desc').limit(50).get();

      if (snap.empty) {
        el.innerHTML = '<div class="empty-state"><h3>Sin mensajes</h3></div>';
        return;
      }
      el.innerHTML = snap.docs.map(doc => {
        const d = doc.data();
        const path = doc.ref.path.split('/');
        const ugcId = path[1];
        const ugc = UGCS.find(u => u.id === ugcId);
        return `
          <div class="hilo-card ${!d.leido ? 'unread' : ''}">
            <div class="hilo-msg">
              <div class="mensaje-head">
                <span class="mensaje-de">🏥 ${escHtml(d.de_nombre || d.de_uid)} · <strong>${ugc ? ugc.denominacion : ugcId}</strong></span>
                <span class="mensaje-date">${fmtFechaHora(d.fecha)}</span>
                ${d.tipo ? `<span class="mensaje-tipo">${escHtml(d.tipo)}</span>` : ''}
              </div>
              ${d.estandar_ref ? `<div class="mensaje-estandar">📎 ${escHtml(d.estandar_ref)}</div>` : ''}
              <div class="mensaje-texto">${escHtml(d.texto)}</div>
            </div>
            <div class="mensaje-actions">
              ${!d.leido ? `<button class="btn-sm" onclick="App.marcarLeido('${ugcId}','${doc.id}')">Marcar leído</button>` : ''}
              <button class="btn-sm" onclick="App.abrirFichaUGC('${ugcId}')">Ver conversación →</button>
              <button class="btn-danger btn-sm" onclick="App.eliminarMensaje('${ugcId}','${doc.id}','admin')">🗑</button>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar mensajes.</p></div>';
    }
  },

  async marcarLeido(ugcId, msgId) {
    try {
      await db.collection(COL.ugcs).doc(ugcId)
        .collection('mensajes').doc(msgId)
        .update({ leido: true });
    } catch(e) { /* silencioso */ }
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
    const ugc    = UGCS.find(u => u.id === ugcId);
    if (ugc) document.getElementById('mi-ugc-nombre').textContent = ugc.denominacion + ' · ' + ugc.fase;

    await App._cargarProgresoUGC(ugcId, 'mi-progreso-card');

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

      App._misEstandaresIdx = STANDARDS.map(s => {
        function collect(val) {
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' || typeof val === 'number') return String(val);
          if (Array.isArray(val)) return val.map(collect).join(' ');
          if (typeof val === 'object') return Object.values(val).map(collect).join(' ');
          return '';
        }
        return collect(s).toLowerCase();
      });

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
      countEl.textContent = `${filtered.length} de 76 estándares · ${cumpleN} cumplidos`;
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
        <div class="estandar-item" onclick="App.abrirModalEstandar('${s.codigo}','${ugcId}')">
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
        const tareas = (d.tareas || []).map(t => `
          <div class="tarea-item ${t.completada ? 'done' : ''}">
            <input type="checkbox" class="tarea-check" ${t.completada ? 'checked' : ''} onchange="App.toggleTarea('${ugcId}','${doc.id}',${(d.tareas||[]).indexOf(t)},this.checked)">
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

  async cargarMisMensajes() {
    const perfil = getPerfil();
    const ugcId  = perfil.ugc_id;
    const el     = document.getElementById('mis-mensajes-list');
    el.innerHTML = '<div class="loading">Cargando mensajes…</div>';

    try {
      const snap = await db.collection(COL.ugcs).doc(ugcId)
        .collection('mensajes').orderBy('fecha', 'asc').limit(60).get();

      if (snap.empty) {
        el.innerHTML = '<div class="empty-state"><h3>Sin mensajes</h3><p>Usa el formulario para contactar con el equipo de mentoría.</p></div>';
        return;
      }

      const hilos = App._agruparHilos(snap.docs);
      el.innerHTML = hilos.map(hilo => {
        const [first, ...replies] = hilo.msgs;
        const tieneNoLeido = hilo.msgs.some(m => !m.leido && m.de_rol === 'admin');
        return `
          <div class="hilo-card ${tieneNoLeido ? 'unread' : ''}">
            ${App._msgHtml(first)}
            ${replies.length ? `<div class="hilo-replies">${replies.map(r => App._msgHtml(r)).join('')}</div>` : ''}
            <div class="mensaje-actions">
              ${tieneNoLeido ? `<button class="btn-sm" onclick="App.marcarHiloLeido('${ugcId}','${hilo.id}','mis')">Marcar leído</button>` : ''}
              <button class="btn-sm" onclick="App.iniciarRespuestaUGC('${hilo.id}')">💬 Responder</button>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar mensajes.</p></div>';
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
          <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>UGC</th><th>Acciones</th></tr></thead>
          <tbody>
            ${snap.docs.map(doc => {
              const d = doc.data();
              const ugc = d.ugc_id ? UGCS.find(u => u.id === d.ugc_id) : null;
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
                  <td>
                    <select onchange="App.asignarUGC('${doc.id}',this.value)" style="padding:5px 8px;font-size:12px">
                      <option value="">— Sin asignar —</option>
                      ${UGCS.map(u=>`<option value="${u.id}" ${d.ugc_id===u.id?'selected':''}>${u.denominacion}</option>`).join('')}
                    </select>
                  </td>
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
      await db.collection(COL.usuarios).doc(uid).update({ rol });
      App.showToast('✅ Rol actualizado');
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

    const w = window.open('', '_blank', 'width=800,height=700');
    const fecha = new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' });

    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
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
            <td>${s.enunciado}</td>
            <td>G${s.grupo}</td>
            <td>${s.obligatorio}</td>
            <td class="${s.estado}">${{cumple:'✅ Cumple',propuesto:'⏳ Propuesto',pendiente:'⭕ Pendiente'}[s.estado]||'—'}</td>
            <td>${st && st.documento_mejora_c ? st.documento_mejora_c : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="footer">Área de Gestión Sanitaria Sur de Córdoba · Área de Calidad y Seguridad del Paciente · Generado el ${fecha}</div>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
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