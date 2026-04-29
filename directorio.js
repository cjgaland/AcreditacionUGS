/* ═══════════════════════════════════════════════════════════════
   directorio.js  —  Directorio de personal del Área
   Plataforma Mentoría ACSA · Área Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 9 */
/* global firebase, db, COL, isAdmin, App, escHtml, confirm */

'use strict';

const Directorio = {

  _todos: [],   // caché local de todos los contactos

  /* ── Colores para avatares según inicial del nombre ── */
  _avatarColor(nombre) {
    const colores = ['#1e3a5f','#2d7a4f','#1e5b8c','#b06000','#5c2d7a','#b03030','#2d6a8c','#5a7a2d'];
    const idx = (nombre || '?').charCodeAt(0) % colores.length;
    return colores[idx];
  },

  _iniciales(nombre) {
    const parts = (nombre || '?').trim().split(/\s+/);
    const last  = parts.length > 2 ? parts[2] : parts[parts.length - 1];
    return parts.length > 1 ? (parts[0][0] + last[0]).toUpperCase() : (nombre[0] || '?').toUpperCase();
  },

  /* ══════════════════════════════════════════════════
     CARGAR DESDE FIRESTORE
  ══════════════════════════════════════════════════ */
  async cargar() {
    const el = document.getElementById('directorio-grid');
    if (!el) return;
    el.innerHTML = '<div class="loading">Cargando directorio…</div>';

    try {
      const snap = await db.collection(COL.directorio).get();
      const ordenTipo = { 'Dirección':1, 'Calidad':2, 'UGC Hospitalaria':3, 'UGC Interniveles':4, 'UGC Intercentros':5, 'UGC Primaria':6, 'DCCU':7, 'Servicios':8 };

      Directorio._todos = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const oa = ordenTipo[a.tipo] || 99;
          const ob = ordenTipo[b.tipo] || 99;
          const difTipo = oa - ob;
          return difTipo !== 0 ? difTipo : ((a.orden || 0) - (b.orden || 0));
        });

      // Resetear filtros al cargar
      const searchEl = document.getElementById('directorio-search');
      const tipoEl   = document.getElementById('directorio-filtro-tipo');
      if (searchEl) searchEl.value = '';
      if (tipoEl)   tipoEl.value   = '';

      Directorio.render(Directorio._todos);
    } catch(e) {
      el.innerHTML = '<div class="empty-state"><p>Error al cargar el directorio. Inténtalo de nuevo.</p></div>';
    }
  },

  /* ══════════════════════════════════════════════════
     RENDERIZAR TARJETAS AGRUPADAS POR CATEGORÍA
  ══════════════════════════════════════════════════ */
  render(contactos) {
    const el = document.getElementById('directorio-grid');
    if (!el) return;

    // Mostrar/ocultar botón "Añadir contacto"
    const btnNuevo = document.getElementById('btn-nuevo-contacto');
    if (btnNuevo) btnNuevo.style.display = isAdmin() ? 'flex' : 'none';

    if (!contactos.length) {
      el.innerHTML = '<div class="empty-state"><p>No se encontraron contactos.</p></div>';
      return;
    }

    // Agrupar por tipo respetando el orden de aparición (ya vienen ordenados)
    const grupos = {};
    const ordenGrupos = [];
    contactos.forEach(c => {
      const t = c.tipo || 'Otros';
      if (!grupos[t]) { grupos[t] = []; ordenGrupos.push(t); }
      grupos[t].push(c);
    });

    el.innerHTML = ordenGrupos.map(tipo => {
      const cards = grupos[tipo].map(c => Directorio._tarjetaHtml(c)).join('');
      return `
        <div class="dir-category">
          <div class="dir-category-header">${escHtml(tipo)}</div>
          <div class="dir-cards">${cards}</div>
        </div>`;
    }).join('');
  },

  _tarjetaHtml(c) {
    const color     = Directorio._avatarColor(c.nombre);
    const ic        = Directorio._iniciales(c.nombre);
    const telLimpio = String(c.telefono || '').replace(/\D/g, '');
    const hayTel    = telLimpio.length >= 7;
    const hayEmail  = c.email && c.email.trim();

    // Prefijo internacional: si es 9 dígitos, añadir prefijo español
    const telPref = telLimpio.length === 9 ? '34' + telLimpio : telLimpio;

    const btnLlam = hayTel ? `<a class="dir-btn" href="tel:+${telPref}">📞 Llamar</a>` : '';
    const btnWA   = hayTel ? `<a class="dir-btn dir-btn--wa" href="https://wa.me/${telPref}" target="_blank">💬 WhatsApp</a>` : '';
    const btnMail = hayEmail ? `<a class="dir-btn dir-btn--mail" href="mailto:${escHtml(c.email)}">✉ Email</a>` : '';
    const btnEdit = isAdmin() ? `<button class="dir-btn-edit" onclick="Directorio.abrirEdicion('${c.id}')" title="Editar contacto">✏</button>` : '';

    const cargoTexto = [c.cargo, c.centro].filter(Boolean).join(' · ');

    return `
      <div class="dir-card">
        <div class="dir-card-header">
          <div class="dir-avatar" style="background:${color}">${escHtml(ic)}</div>
          <div class="dir-card-info">
            <strong class="dir-nombre">${escHtml(c.nombre)}</strong>
            <span class="dir-cargo">${escHtml(cargoTexto)}</span>
            ${c.notas ? `<span class="dir-notas">${escHtml(c.notas)}</span>` : ''}
          </div>
          ${btnEdit}
        </div>
        <div class="dir-card-actions">${btnLlam}${btnWA}${btnMail}</div>
      </div>`;
  },

  /* ══════════════════════════════════════════════════
     FILTRAR EN TIEMPO REAL
  ══════════════════════════════════════════════════ */
  filtrar() {
    const q    = (document.getElementById('directorio-search').value || '').toLowerCase().trim();
    const tipo = document.getElementById('directorio-filtro-tipo').value;

    const filtrados = Directorio._todos.filter(c => {
      const coincideTipo = !tipo || c.tipo === tipo;
      const hayQ         = !q;
      const coincideQ    = hayQ || [c.nombre, c.cargo, c.centro, c.notas]
        .some(v => (v || '').toLowerCase().includes(q));
      return coincideTipo && coincideQ;
    });

    Directorio.render(filtrados);
  },

  /* ══════════════════════════════════════════════════
     MODAL — NUEVO CONTACTO
  ══════════════════════════════════════════════════ */
  nuevo() {
    if (!isAdmin()) return;
    document.getElementById('modal-directorio-titulo').textContent = 'Nuevo contacto';
    document.getElementById('dir-id').value       = '';
    document.getElementById('dir-nombre').value   = '';
    document.getElementById('dir-cargo').value    = '';
    document.getElementById('dir-centro').value   = '';
    document.getElementById('dir-tipo').value     = 'Dirección';
    document.getElementById('dir-telefono').value = '';
    document.getElementById('dir-email').value    = '';
    document.getElementById('dir-notas').value    = '';
    document.getElementById('btn-dir-eliminar').style.display = 'none';
    App.abrirModal('modal-directorio');
  },

  /* ══════════════════════════════════════════════════
     MODAL — EDITAR CONTACTO EXISTENTE
  ══════════════════════════════════════════════════ */
  async abrirEdicion(id) {
    if (!isAdmin()) return;
    try {
      const snap = await db.collection(COL.directorio).doc(id).get();
      if (!snap.exists) { App.showToast('⚠️ Contacto no encontrado.'); return; }
      const c = snap.data();
      document.getElementById('modal-directorio-titulo').textContent = 'Editar contacto';
      document.getElementById('dir-id').value       = id;
      document.getElementById('dir-nombre').value   = c.nombre   || '';
      document.getElementById('dir-cargo').value    = c.cargo    || '';
      document.getElementById('dir-centro').value   = c.centro   || '';
      document.getElementById('dir-tipo').value     = c.tipo     || 'Dirección';
      document.getElementById('dir-telefono').value = c.telefono || '';
      document.getElementById('dir-email').value    = c.email    || '';
      document.getElementById('dir-notas').value    = c.notas    || '';
      document.getElementById('btn-dir-eliminar').style.display = 'inline-flex';
      App.abrirModal('modal-directorio');
    } catch(e) {
      App.showToast('⚠️ Error al cargar el contacto.');
    }
  },

  /* ══════════════════════════════════════════════════
     GUARDAR (add si nuevo, update si edición)
  ══════════════════════════════════════════════════ */
  async guardar() {
    if (!isAdmin()) return;
    const id       = document.getElementById('dir-id').value.trim();
    const nombre   = document.getElementById('dir-nombre').value.trim();
    const cargo    = document.getElementById('dir-cargo').value.trim();
    const centro   = document.getElementById('dir-centro').value.trim();
    const tipo     = document.getElementById('dir-tipo').value;
    const telefono = document.getElementById('dir-telefono').value.trim();
    const email    = document.getElementById('dir-email').value.trim();
    const notas    = document.getElementById('dir-notas').value.trim();

    if (!nombre) { App.showToast('⚠️ El nombre es obligatorio.'); return; }

    const data = { nombre, cargo, centro, tipo, telefono, email, notas, orden: 99 };

    try {
      if (id) {
        await db.collection(COL.directorio).doc(id).update(data);
        App.showToast('✅ Contacto actualizado.');
      } else {
        const ts = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection(COL.directorio).add({ ...data, creado_en: ts });
        App.showToast('✅ Contacto añadido.');
      }
      App.cerrarModal('modal-directorio');
      await Directorio.cargar();
    } catch(e) {
      App.showToast('⚠️ Error al guardar. Inténtalo de nuevo.');
    }
  },

  /* ══════════════════════════════════════════════════
     ELIMINAR CONTACTO
  ══════════════════════════════════════════════════ */
  async eliminar(id) {
    if (!isAdmin() || !id) return;
    if (!confirm('¿Eliminar este contacto del directorio? Esta acción no se puede deshacer.')) return;
    try {
      await db.collection(COL.directorio).doc(id).delete();
      App.showToast('🗑 Contacto eliminado.');
      App.cerrarModal('modal-directorio');
      await Directorio.cargar();
    } catch(e) {
      App.showToast('⚠️ Error al eliminar.');
    }
  },

  /* ══════════════════════════════════════════════════
     SEED INICIAL — importar todos los contactos
     Solo usar una vez. El admin lo ejecuta desde
     Utilidades → "Importar directorio".
  ══════════════════════════════════════════════════ */
  async seedInicial() {
    if (!isAdmin()) return;

    // Guardia anti-duplicado: comprobar si ya hay contactos
    try {
      const existing = await db.collection(COL.directorio).limit(1).get();
      if (!existing.empty) {
        App.showToast('⚠️ El directorio ya tiene contactos. Elimínalos todos desde Firestore antes de reimportar.');
        return;
      }
    } catch(e) {
      App.showToast('⚠️ No se pudo verificar el estado del directorio.');
      return;
    }

    if (!confirm('¿Importar todos los contactos del directorio a Firestore?\n\nSolo debe hacerse una vez.')) return;

    const ts = firebase.firestore.FieldValue.serverTimestamp();

    const contactos = [
      // ── DIRECCIÓN DEL ÁREA ──────────────────────────────────────────
      { nombre: 'Pedro Manuel Castro Cobos',       cargo: 'Director Gerente',          centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '669527262', email: 'pedromanuel.castro.sspa@juntadeandalucia.es',           notas: '', orden: 1 },
      { nombre: 'Soledad Delgado Zafra',            cargo: 'Directora Médica',           centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '686906564', email: 'soledad.delgado.sspa@juntadeandalucia.es',               notas: '', orden: 2 },
      { nombre: 'Isabel Orzaez Casado',             cargo: 'Subdirector Médico de Área', centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '670940060', email: 'isabel.orzaez.sspa@juntadeandalucia.es',                 notas: '', orden: 3 },
      { nombre: 'Antonio del Rosal González',       cargo: 'Director Enfermería',        centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '671569496', email: 'antonioj.rosal.sspa@juntadeandalucia.es',                notas: '', orden: 4 },
      { nombre: 'David Ruíz Gutiérrez',             cargo: 'Subdirector Enfermería',     centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '749724',    email: 'david.ruiz.gutierrez.sspa@juntadeandalucia.es',         notas: '', orden: 5 },
      { nombre: 'Francisco Jesús Antúnez Miranda',  cargo: 'Subdirector Enfermería',     centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '671591272', email: 'franciscoj.antunez.sspa@juntadeandalucia.es',           notas: '', orden: 6 },
      { nombre: 'María Rosario Cabezas Robles',     cargo: 'Jefa Bloque Enfermería',     centro: 'AGS Sur de Córdoba', tipo: 'Dirección', telefono: '697955379', email: 'mariar.cabezas.sspa@juntadeandalucia.es',               notas: '', orden: 7 },

      // ── CALIDAD Y SEGURIDAD DEL PACIENTE ────────────────────────────
      { nombre: 'Rafael J. Romero de Castilla Gil', cargo: 'Coordinador Calidad AGSSC',        centro: 'Calidad y Seguridad del Paciente AGSSC', tipo: 'Calidad', telefono: '630417771', email: 'rjavier.romero@sspa.juntadeandalucia.es',                 notas: 'Montilla', orden: 1 },
      { nombre: 'Carlos J. Galán Doval',            cargo: 'Calidad y Seguridad del Paciente', centro: 'Calidad y Seguridad del Paciente AGSSC', tipo: 'Calidad', telefono: '649003421', email: 'carlosjavier.galan.sspa@juntadeandalucia.es',              notas: 'Montilla', orden: 2 },
      { nombre: 'María de la O Granados Roldán',    cargo: 'Calidad',                          centro: 'Calidad y Seguridad del Paciente AGSSC', tipo: 'Calidad', telefono: '671596908', email: 'marial.granados.roldan.sspa@juntadeandalucia.es',          notas: '',          orden: 3 },

      // ── UGC HOSPITALARIAS ────────────────────────────────────────────
      { nombre: 'María Rosario Gómez Espejo',       cargo: 'Supervisor UGC', centro: 'UGC Cuidados Intensivos',                       tipo: 'UGC Hospitalaria', telefono: '671596041', email: 'mrosario.gomez.sspa@juntadeandalucia.es',                     notas: '', orden: 1 },
      { nombre: 'Pedro Lara Aguayo',                 cargo: 'Director UGC',   centro: 'UGC Cuidados Intensivos',                       tipo: 'UGC Hospitalaria', telefono: '661496874', email: 'pedro.lara.sspa@juntadeandalucia.es',                          notas: '', orden: 2 },
      { nombre: 'Silvia Gómez Pino',                 cargo: 'Supervisor UGC', centro: 'UGC Urgencias',                                 tipo: 'UGC Hospitalaria', telefono: '671592309', email: 'silvia.gomez.pino.sspa@juntadeandalucia.es',                   notas: '', orden: 3 },
      { nombre: 'José Antonio Ramirez Lozano',       cargo: 'Director UGC',   centro: 'UGC Urgencias',                                 tipo: 'UGC Hospitalaria', telefono: '671561679', email: 'josea.ramirez.lozano.sspa@juntadeandalucia.es',                notas: '', orden: 4 },
      { nombre: 'Raimundo Tirado Miranda',           cargo: 'Director UGC',   centro: 'UGC Medicina Interna y Especialidades Médicas', tipo: 'UGC Hospitalaria', telefono: '671595465', email: 'raimundo.tirado.sspa@juntadeandalucia.es',                     notas: '', orden: 5 },
      { nombre: 'Manuel Leiva Grande',               cargo: 'Supervisor',     centro: 'UGC Medicina Interna y Especialidades Médicas', tipo: 'UGC Hospitalaria', telefono: '671596040', email: 'manuel.leyva.sspa@juntadeandalucia.es',                        notas: '', orden: 6 },
      { nombre: 'Maria Isabel Lucena Tirado',        cargo: 'Supervisor',     centro: 'UGC Medicina Interna y Especialidades Médicas', tipo: 'UGC Hospitalaria', telefono: '671596049', email: 'mariai.lucena.sspa@juntadeandalucia.es',                       notas: '', orden: 7 },
      { nombre: 'Araceli Pineda Carrera',            cargo: 'Supervisor',     centro: 'UGC Medicina Interna y Especialidades Médicas', tipo: 'UGC Hospitalaria', telefono: '671596044', email: 'maraceli.pineda.sspa@juntadeandalucia.es',                     notas: '', orden: 8 },
      { nombre: 'María Rosario Rodríguez Morales',   cargo: 'Supervisor UGC', centro: 'UGC Laboratorios',                              tipo: 'UGC Hospitalaria', telefono: '758757',    email: 'rosarioma.rodriguez.morales.sspa@juntadeandalucia.es',         notas: '', orden: 9 },
      { nombre: 'Jacinto Carlos Plata Rosales',      cargo: 'Director UGC',   centro: 'UGC Laboratorios',                              tipo: 'UGC Hospitalaria', telefono: '670941748', email: 'jacinto.plata.sspa@juntadeandalucia.es',                       notas: '', orden: 10 },
      { nombre: 'María José Llamas Poyato',          cargo: '',               centro: 'UGC Laboratorios',                              tipo: 'UGC Hospitalaria', telefono: '640381199', email: 'mariaj.llamas.sspa@juntadeandalucia.es',                       notas: '', orden: 11 },
      { nombre: 'Inmaculada Serrano Gómez',          cargo: 'Supervisor UGC', centro: 'UGC Salud Mental',                              tipo: 'UGC Hospitalaria', telefono: '671599964', email: 'inmaculada.serrano.gomez.sspa@juntadeandalucia.es',            notas: '', orden: 12 },

      // ── UGC INTERNIVELES ─────────────────────────────────────────────
      { nombre: 'Beatriz Fuentes Caparrós',          cargo: 'Director UGC',   centro: 'UGC Farmacia (interniveles)',                          tipo: 'UGC Interniveles', telefono: '670945780', email: 'beatriz.fuentes.sspa@juntadeandalucia.es',              notas: '', orden: 1 },
      { nombre: 'Soledad González Moreno',           cargo: 'Supervisor UGC', centro: 'UGC Ginecología y Obstetricia (interniveles)',         tipo: 'UGC Interniveles', telefono: '671596045', email: 'soledad.gonzalez.moreno.sspa@juntadeandalucia.es',      notas: '', orden: 2 },
      { nombre: 'Federico Izquierdo Carrasco',       cargo: 'Director UGC',   centro: 'UGC Ginecología y Obstetricia (interniveles)',         tipo: 'UGC Interniveles', telefono: '671598775', email: 'federico.izquierdo.sspa@juntadeandalucia.es',           notas: '', orden: 3 },
      { nombre: 'Francisco Miguel Perez Fernandez',  cargo: 'Director UGC',   centro: 'UGC Pediatría (interniveles)',                         tipo: 'UGC Interniveles', telefono: '607550926', email: 'franciscom.perez.sspa@juntadeandalucia.es',             notas: '', orden: 4 },
      { nombre: 'Águeda Galisteo Rosa',              cargo: 'Supervisor UGC', centro: 'UGC Pediatría (interniveles)',                         tipo: 'UGC Interniveles', telefono: '671596042', email: 'agueda.galisteo.sspa@juntadeandalucia.es',              notas: '', orden: 5 },
      { nombre: 'María Jesús Serrano Aguilera',      cargo: 'Supervisor UGC', centro: 'UGC Rehabilitación (Interniveles)',                    tipo: 'UGC Interniveles', telefono: '697955670', email: 'mariaj.serrano.sspa@juntadeandalucia.es',               notas: '', orden: 6 },
      { nombre: 'Miguel Giménez Alcántara',          cargo: 'Director UGC',   centro: 'UGC Rehabilitación (Interniveles)',                    tipo: 'UGC Interniveles', telefono: '671595034', email: 'miguel.gimenez.sspa@juntadeandalucia.es',               notas: '', orden: 7 },
      { nombre: 'Francisco Sánchez Quintana',        cargo: 'Director UGC',   centro: 'UGC Radiodiagnóstico y Cáncer de Mama (interniveles)', tipo: 'UGC Interniveles', telefono: '745723',    email: 'francisco.sanchez.q.sspa@juntadeandalucia.es',         notas: '', orden: 8 },
      { nombre: 'Antonia Nieto Villa',               cargo: 'Supervisor UGC', centro: 'UGC Radiodiagnóstico y Cáncer de Mama (interniveles)', tipo: 'UGC Interniveles', telefono: '683551730', email: 'antonia.nieto.villa.sspa@juntadeandalucia.es',         notas: '', orden: 9 },

      // ── UGC INTERCENTROS ─────────────────────────────────────────────
      { nombre: 'Antonio Llergo Muñoz',              cargo: '',                centro: 'UGC Cuidados Paliativos (Intercentros)',  tipo: 'UGC Intercentros', telefono: '742307',    email: 'antonio.llergo.sspa@juntadeandalucia.es',              notas: '', orden: 1 },
      { nombre: 'Susana García Varo',                cargo: 'Enf. paliativos', centro: 'UGC Cuidados Paliativos (Intercentros)',  tipo: 'UGC Intercentros', telefono: '734763',    email: 'susana.garcia.varo.sspa@juntadeandalucia.es',          notas: '', orden: 2 },
      { nombre: 'Francisco José Muñoz del Castillo', cargo: 'Director UGC',   centro: 'UGC Otorrinolaringología (intercentros)', tipo: 'UGC Intercentros', telefono: '697954109', email: 'francisco.munoz.castillo.sspa@juntadeandalucia.es',    notas: '', orden: 3 },

      // ── UGC PRIMARIA ─────────────────────────────────────────────────
      { nombre: 'Jose Maria Alcantara Reyes',        cargo: 'Coordinador UGC', centro: 'UGC Aguilar',                                   tipo: 'UGC Primaria', telefono: '759227',    email: 'josem.alcantara.sspa@juntadeandalucia.es',             notas: '',             orden: 1 },
      { nombre: 'María Carmen Martín Ruiz',          cargo: 'Director UGC',    centro: 'UGC Aguilar',                                   tipo: 'UGC Primaria', telefono: '670940021', email: 'mariac.martin.ruiz.sspa@juntadeandalucia.es',          notas: '',             orden: 2 },
      { nombre: 'Manuel Gutiérrez Cruz',             cargo: 'Director UGC',    centro: 'UGC Baena "Dr. Ignacio Osuna Gómez"',           tipo: 'UGC Primaria', telefono: '670949455', email: 'manuel.gutierrez.cruz.sspa@juntadeandalucia.es',       notas: '',             orden: 3 },
      { nombre: 'Manuel Lara Rodríguez',             cargo: 'Coordinador UGC', centro: 'UGC Benamejí "Francisco Nieto Lucena"',         tipo: 'UGC Primaria', telefono: '759223',    email: 'manuel.lara.rodriguez.sspa@juntadeandalucia.es',       notas: '',             orden: 4 },
      { nombre: 'Antonio Baeza Espejo',              cargo: 'Director UGC',    centro: 'UGC Benamejí "Francisco Nieto Lucena"',         tipo: 'UGC Primaria', telefono: '627421329', email: 'antonio.baeza.sspa@juntadeandalucia.es',               notas: '',             orden: 5 },
      { nombre: 'María Rosario Priego Chacón',       cargo: 'Coordinador UGC', centro: 'UGC Cabra "Matrona Antonia Mesa Fernández"',    tipo: 'UGC Primaria', telefono: '759222',    email: 'mariar.priego.sspa@juntadeandalucia.es',               notas: '',             orden: 6 },
      { nombre: 'Nicomedes Rodríguez Rodríguez',     cargo: 'Director UGC',    centro: 'UGC Cabra "Matrona Antonia Mesa Fernández"',    tipo: 'UGC Primaria', telefono: '670949456', email: 'nicomedes.rodriguez.sspa@juntadeandalucia.es',         notas: '',             orden: 7 },
      { nombre: 'Verónica Jiménez Serrano',          cargo: 'Director UGC',    centro: 'UGC Castro del Río',                            tipo: 'UGC Primaria', telefono: '',          email: 'veronica.jimenez.sspa@juntadeandalucia.es',            notas: '',             orden: 8 },
      { nombre: 'Rafael Ángel Zamora Vizcaíno',      cargo: 'Coordinador UGC', centro: 'UGC Castro del Río',                            tipo: 'UGC Primaria', telefono: '697959220', email: 'rangel.zamora.sspa@juntadeandalucia.es',               notas: '',             orden: 9 },
      { nombre: 'Isabel Alcaide Aguilar',            cargo: 'Coordinador UGC', centro: 'UGC Fernán Núñez "Dª Josefina Carmona"',        tipo: 'UGC Primaria', telefono: '759218',    email: 'isabel.alcaide.sspa@juntadeandalucia.es',              notas: '',             orden: 10 },
      { nombre: 'Irene Martínez Moreno',             cargo: 'Director UGC',    centro: 'UGC Fernán Núñez "Dª Josefina Carmona"',        tipo: 'UGC Primaria', telefono: '671568465', email: 'irene.martinez.moreno.sspa@juntadeandalucia.es',       notas: '',             orden: 11 },
      { nombre: 'María Jesús Valle Cañete',          cargo: 'Coordinador UGC', centro: 'UGC La Rambla',                                 tipo: 'UGC Primaria', telefono: '697959216', email: 'mariaj.valle.canete.sspa@juntadeandalucia.es',         notas: '',             orden: 12 },
      { nombre: 'Antonio Cabezas Jiménez',           cargo: 'Director UGC',    centro: 'UGC La Rambla',                                 tipo: 'UGC Primaria', telefono: '670940061', email: 'antonio.cabezas.jimenez.sspa@juntadeandalucia.es',     notas: '',             orden: 13 },
      { nombre: 'Juan Bautista Guerrero Muñoz',      cargo: 'Director UGC',    centro: 'UGC Lucena',                                    tipo: 'UGC Primaria', telefono: '671562453', email: 'juanb.guerrero.sspa@juntadeandalucia.es',              notas: 'Lucena I y II', orden: 14 },
      { nombre: 'Antonio Rivas Ogalla',              cargo: 'Coordinador UGC', centro: 'UGC Lucena',                                    tipo: 'UGC Primaria', telefono: '',          email: 'antonioj.rivas.sspa@juntadeandalucia.es',              notas: 'Lucena I y II', orden: 15 },
      { nombre: 'Miguel García Jiménez',             cargo: 'Coordinador UGC', centro: 'UGC Montilla',                                  tipo: 'UGC Primaria', telefono: '619205648', email: 'mangel.garcia.jimenez.sspa@juntadeandalucia.es',       notas: '',             orden: 16 },
      { nombre: 'Jose Manuel Recio Ramírez',         cargo: 'Director UGC',    centro: 'UGC Montilla',                                  tipo: 'UGC Primaria', telefono: '670940059', email: 'jmanue.recio.sspa@juntadeandalucia.es',                notas: '',             orden: 17 },
      { nombre: 'Eva Sevilla Gómez',                 cargo: 'Coordinador UGC', centro: 'UGC Priego de Córdoba',                         tipo: 'UGC Primaria', telefono: '764326',    email: 'eva.sevilla.sspa@juntadeandalucia.es',                 notas: '',             orden: 18 },
      { nombre: 'Ana María Baena Angulo',            cargo: 'Director UGC',    centro: 'UGC Priego de Córdoba',                         tipo: 'UGC Primaria', telefono: '671595686', email: 'anam.baena.sspa@juntadeandalucia.es',                  notas: '',             orden: 19 },
      { nombre: 'Miguel Perona Salas',               cargo: 'Director UGC',    centro: 'UGC Protección de la Salud',                    tipo: 'UGC Primaria', telefono: '736231',    email: 'miguel.perona.sspa@juntadeandalucia.es',               notas: '',             orden: 20 },
      { nombre: 'Antonio jesús Rubio Domínguez',     cargo: 'Director UGC',    centro: 'UGC Puente Genil',                              tipo: 'UGC Primaria', telefono: '662973757', email: 'antonioj.rubio.sspa@juntadeandalucia.es',              notas: 'P. Genil I y II', orden: 21 },
      { nombre: 'Esther Cabezas Prieto',             cargo: '',                centro: 'UGC Puente Genil',                              tipo: 'UGC Primaria', telefono: '759210',    email: 'estherm.cabezas.sspa@juntadeandalucia.es',             notas: 'P. Genil I y II', orden: 22 },
      { nombre: 'Maria Jesus Cordoba Arenas',        cargo: 'Coordinador UGC', centro: 'UGC Rute-Iznájar',                              tipo: 'UGC Primaria', telefono: '740020',    email: 'mjesu.cordoba.sspa@juntadeandalucia.es',               notas: '',             orden: 23 },
      { nombre: 'Miguel Angel Fernández Fernández',  cargo: 'Director UGC',    centro: 'UGC Rute-Iznájar',                              tipo: 'UGC Primaria', telefono: '',          email: 'miguel.fernandez.fernandez.sspa@juntadeandalucia.es',  notas: '',             orden: 24 },

      // ── DCCU ─────────────────────────────────────────────────────────
      { nombre: 'Fernando de la Rosa Pons',  cargo: 'Coordinador UGC', centro: 'UGC DCCU Córdoba Sur', tipo: 'DCCU', telefono: '650391311', email: 'fernandoj.rosa.sspa@juntadeandalucia.es', notas: '', orden: 1 },
      { nombre: 'Juan Vicente Soria López',  cargo: 'Director UGC',    centro: 'UGC DCCU Córdoba Sur', tipo: 'DCCU', telefono: '609557449', email: 'juanv.soria.sspa@juntadeandalucia.es',    notas: '', orden: 2 },

      // ── SERVICIOS ────────────────────────────────────────────────────
      { nombre: 'Manuel Galán Eslava', cargo: '', centro: 'Informática', tipo: 'Servicios', telefono: '660758300', email: '', notas: '', orden: 1 },
    ];

    try {
      const batch = db.batch();
      contactos.forEach(c => {
        const ref = db.collection(COL.directorio).doc();
        batch.set(ref, { ...c, creado_en: ts });
      });
      await batch.commit();
      App.showToast('✅ ' + contactos.length + ' contactos importados correctamente.');
      await Directorio.cargar();
    } catch(e) {
      App.showToast('⚠️ Error en la importación: ' + (e.message || e));
    }
  },
};
