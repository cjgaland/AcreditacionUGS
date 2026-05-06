/* ═══════════════════════════════════════════════════════════════
   utilidades.js  —  Módulo Utilidades (solo admin)
   Plataforma Mentoría ACSA · Área Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 9 */
/* global firebase, db, COL, UGCS, XLSX, App */

'use strict';

const Utilidades = (() => {

  // ── Estado interno ────────────────────────────────────────────
  let _filas    = [];   // filas normalizadas listas para importar
  let _rawRows  = [];   // filas originales del Excel (para re-filtrar)
  let _esRaw    = false;
  let _fileName = '';

  // ── Patrón código + tipo en columna EV/AM ────────────────────
  const RE_EVAM = /^(ES \d \d{2}\.\d{2}_\d{2})(EV|AM)([\s\S]*)$/;

  // ──────────────────────────────────────────────────────────────
  // cargar()  —  punto de entrada al navegar a la vista
  // ──────────────────────────────────────────────────────────────
  function cargar() {
    _resetImportador();

    // Selector importador
    const sel = document.getElementById('util-ugc');
    if (sel) {
      sel.innerHTML = '<option value="">— Selecciona una UGC —</option>' +
        UGCS.map(u => `<option value="${u.id}">${u.denominacion}</option>`).join('');
    }

    // Selector destino migración
    const selDest = document.getElementById('mig-destino');
    if (selDest) {
      selDest.innerHTML = '<option value="">— Selecciona UGC destino —</option>' +
        UGCS.map(u => `<option value="${u.id}">${u.id} · ${u.denominacion}</option>`).join('');
    }

    // Mostrar log de migración
    const log = document.getElementById('mig-log');
    if (log) log.style.display = 'block';

    // Prefijar fecha "Hasta" al día de hoy (modificable por el usuario)
    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    const hastaInp = document.getElementById('util-fecha-hasta');
    if (hastaInp) hastaInp.value = `${yyyy}-${mm}-${dd}`;
  }

  // ──────────────────────────────────────────────────────────────
  // _resetImportador()
  // ──────────────────────────────────────────────────────────────
  function _resetImportador() {
    _filas   = [];
    _rawRows = [];
    _esRaw   = false;
    _fileName = '';

    const prev = document.getElementById('util-preview');
    if (prev) prev.innerHTML = '';

    const btn = document.getElementById('util-btn-importar');
    if (btn) { btn.style.display = 'none'; btn.disabled = false; btn.textContent = '⬆ Importar a Firestore'; }

    const fileInp = document.getElementById('util-file');
    if (fileInp) fileInp.value = '';

    const info = document.getElementById('util-file-info');
    if (info) info.textContent = '';

    // El bloque de fechas permanece SIEMPRE visible (lo gestiona cargar())
    const fDesde = document.getElementById('util-fecha-desde');
    const fHasta = document.getElementById('util-fecha-hasta');
    if (fDesde) fDesde.value = '';
    if (fHasta) fHasta.value = '';

    const badge = document.getElementById('util-formato-badge');
    if (badge) badge.textContent = '';
  }

  // ──────────────────────────────────────────────────────────────
  // leerExcel(inputEl)
  // ──────────────────────────────────────────────────────────────
  function leerExcel(inputEl) {
    if (!inputEl.files || !inputEl.files.length) return;
    const file = inputEl.files[0];
    _fileName = file.name;

    const info = document.getElementById('util-file-info');
    if (info) info.textContent = 'Leyendo ' + file.name + '…';

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        _procesarFilas(rows);
      } catch (err) {
        App.showToast('Error al leer el archivo: ' + err.message);
        const info2 = document.getElementById('util-file-info');
        if (info2) info2.textContent = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ──────────────────────────────────────────────────────────────
  // _procesarFilas(rows)  —  detecta formato y encauza
  // ──────────────────────────────────────────────────────────────
  function _procesarFilas(rows) {
    if (!rows.length) {
      App.showToast('El archivo está vacío o no tiene datos legibles');
      return;
    }

    _rawRows = rows;
    const claves = Object.keys(rows[0]);
    _esRaw = _detectarFormatoRaw(claves);

    if (_esRaw) {
      const badge = document.getElementById('util-formato-badge');
      if (badge) {
        badge.textContent = '✅ Formato ME_jora C original detectado · ' + rows.length + ' registros totales';
      }

      const info = document.getElementById('util-file-info');
      if (info) info.textContent = _fileName;

      _procesarConFiltro();

    } else {
      // Formato ya transformado
      _procesarFormatoTransformado(rows);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // _detectarFormatoRaw(claves)
  // ──────────────────────────────────────────────────────────────
  function _detectarFormatoRaw(claves) {
    const low = claves.map(k => k.toLowerCase().replace(/\s/g, ''));
    return low.some(k => k.includes('ev/am') || k.includes('ev / am'));
  }

  // ──────────────────────────────────────────────────────────────
  // aplicarFiltro()  —  llamado desde los onchange de fechas
  // ──────────────────────────────────────────────────────────────
  function aplicarFiltro() {
    if (!_esRaw || !_rawRows.length) return;
    _procesarConFiltro();
  }

  // ──────────────────────────────────────────────────────────────
  // _procesarConFiltro()  —  transforma el formato crudo ME_jora C
  // ──────────────────────────────────────────────────────────────
  function _procesarConFiltro() {
    const desdeStr = (document.getElementById('util-fecha-desde') || {}).value || '';
    const hastaStr = (document.getElementById('util-fecha-hasta') || {}).value || '';

    const desde = desdeStr ? new Date(desdeStr + 'T00:00:00') : null;
    const hasta = hastaStr ? new Date(hastaStr + 'T23:59:59') : null;

    // Detectar columnas del formato crudo
    const claveDoc   = _detectarCol(_rawRows, ['documento']);
    const claveFecha = _detectarCol(_rawRows, ['fecha']);
    const claveUser  = _detectarCol(_rawRows, ['usuario']);
    const claveEvAm  = _detectarCol(_rawRows, ['ev / am', 'ev/am', 'ev   am', 'ev / am', 'ev ', 'am']);

    if (!claveEvAm) {
      App.showToast('No se encontró la columna «EV / AM» en el archivo');
      return;
    }

    const mapa = {};
    let totalFiltradas = 0;

    for (const row of _rawRows) {
      const evam = String(row[claveEvAm] || '').trim();
      const m = evam.match(RE_EVAM);
      if (!m) continue;

      // Filtro de fechas
      if (desde || hasta) {
        const fechaStr = String(row[claveFecha] || '').trim();
        const fecha    = _parseFecha(fechaStr);
        if (fecha) {
          if (desde && fecha < desde) continue;
          if (hasta && fecha > hasta) continue;
        }
      }

      totalFiltradas++;
      const codigo    = m[1];
      const tipo      = m[2];    // 'EV' o 'AM'
      const texto     = m[3].trim();
      const docRaw    = String(row[claveDoc]  || '').trim();
      const docLimpio = _limpiarNombreDoc(docRaw);
      const usuario   = String(row[claveUser] || '').trim();

      if (!mapa[codigo]) {
        mapa[codigo] = { codigo, usuario, docs: [], evidencia: '', area_mejora: '' };
      }
      if (docLimpio && !mapa[codigo].docs.includes(docLimpio)) {
        mapa[codigo].docs.push(docLimpio);
      }
      if (tipo === 'EV' && texto) { mapa[codigo].evidencia   = texto; }
      if (tipo === 'AM' && texto) { mapa[codigo].area_mejora = texto; }
    }

    _filas = Object.values(mapa).map(e => ({
      codigo:      e.codigo,
      documento:   e.docs.join('\n'),
      evidencia:   e.evidencia,
      area_mejora: e.area_mejora,
    }));

    const badge = document.getElementById('util-formato-badge');
    if (badge) {
      const filtroTexto = (desde || hasta) ? ' (filtrado por fecha)' : '';
      badge.textContent = '✅ Formato ME_jora C original · ' +
        _rawRows.length + ' registros totales · ' +
        totalFiltradas + ' tras filtro → ' +
        _filas.length + ' estándares únicos' + filtroTexto;
    }

    _mostrarPreview();
  }

  // ──────────────────────────────────────────────────────────────
  // _procesarFormatoTransformado(rows)  —  formato ya agrupado
  // ──────────────────────────────────────────────────────────────
  function _procesarFormatoTransformado(rows) {
    const claveEst  = _detectarCol(rows, ['estándar', 'estandar', 'standard', 'código', 'codigo', 'es ']);
    const claveDocs = _detectarCol(rows, ['documentos aportados', 'documentos', 'docs', 'documento']);
    const claveEvid = _detectarCol(rows, ['evidencias', 'evidencia']);

    if (!claveEst) {
      App.showToast('No se encontró la columna de estándares (Estándar / Código)');
      return;
    }

    _filas = rows
      .map(r => ({
        codigo:      String(r[claveEst]  || '').trim(),
        documento:   String(r[claveDocs] || '').trim(),
        evidencia:   String(r[claveEvid] || '').trim(),
        area_mejora: '',
      }))
      .filter(r => r.codigo.length > 0);

    if (!_filas.length) {
      App.showToast('No se encontraron filas con código de estándar');
      return;
    }

    const info = document.getElementById('util-file-info');
    if (info) info.textContent = _fileName + ' · ' + _filas.length + ' estándares (formato transformado)';

    _mostrarPreview();
  }

  // ──────────────────────────────────────────────────────────────
  // _limpiarNombreDoc(str)  —  quita prefijos de tamaño y número
  // ──────────────────────────────────────────────────────────────
  function _limpiarNombreDoc(str) {
    if (!str) return '';
    // Quitar "(X Mb.)" o "(X Kb.)" al inicio (puede usar non-breaking space  )
    let clean = str.replace(/^\(\d+[ \s]*[MKGmkg][bBiI]+\.\)\s*/u, '');
    // Quitar número inicial tipo "1 " o "2  "
    clean = clean.replace(/^\d+\s+/, '');
    return clean.trim();
  }

  // ──────────────────────────────────────────────────────────────
  // _parseFecha(str)  —  DD/MM/YYYY → Date
  // ──────────────────────────────────────────────────────────────
  function _parseFecha(str) {
    if (!str) return null;
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // ──────────────────────────────────────────────────────────────
  // _detectarCol(rows, candidatos)
  // ──────────────────────────────────────────────────────────────
  function _detectarCol(rows, candidatos) {
    if (!rows.length) return null;
    const claves    = Object.keys(rows[0]);
    const clavesLow = claves.map(k => k.toLowerCase().trim());
    for (const cand of candidatos) {
      const idx = clavesLow.findIndex(k => k.includes(cand));
      if (idx !== -1) return claves[idx];
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────
  // _mostrarPreview()
  // ──────────────────────────────────────────────────────────────
  function _mostrarPreview() {
    const prev = document.getElementById('util-preview');
    if (!prev) return;

    if (!_filas.length) {
      prev.innerHTML = '<p style="color:var(--text3);text-align:center;padding:16px">No hay datos que mostrar con los filtros actuales.</p>';
      const btn = document.getElementById('util-btn-importar');
      if (btn) btn.style.display = 'none';
      return;
    }

    const tieneAM = _filas.some(r => r.area_mejora);

    const tbody = _filas.map(r => {
      const codHtml  = _escHtml(r.codigo);
      const docHtml  = r.documento ? 
        r.documento.split('\n').map(l => `<div style="white-space:nowrap;font-size:11px">• ${_escHtml(l.trim())}</div>`).join('')
        : '<span style="color:var(--text3)">—</span>';
      const evCorto  = r.evidencia.length > 80 ? r.evidencia.substring(0, 80) + '…' : r.evidencia;
      const evHtml   = evCorto ? _escHtml(evCorto) : '<span style="color:var(--text3)">—</span>';
      const amCorto  = r.area_mejora.length > 60 ? r.area_mejora.substring(0, 60) + '…' : r.area_mejora;
      const amHtml   = amCorto ? _escHtml(amCorto) : '<span style="color:var(--text3)">—</span>';

      const amCell = tieneAM ? `<td style="font-size:12px">${amHtml}</td>` : '';
      return `<tr>
        <td style="font-family:monospace;font-size:12px;white-space:nowrap">${codHtml}</td>
        <td style="font-size:12px">${docHtml}</td>
        <td style="font-size:12px">${evHtml}</td>
        ${amCell}
      </tr>`;
    }).join('');

    const thAM = tieneAM ? '<th>Área de mejora</th>' : '';

    prev.innerHTML = `
      <p style="font-size:13px;color:var(--text2);margin-bottom:8px">
        Vista previa · <strong>${_filas.length} estándares</strong> serán actualizados en Firestore
      </p>
      <div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border)">
        <table class="tabla-acreditacion" style="margin:0">
          <thead>
            <tr>
              <th>Código</th>
              <th>Documentos aportados</th>
              <th>Evidencia</th>
              ${thAM}
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;

    const btn = document.getElementById('util-btn-importar');
    if (btn) btn.style.display = 'inline-flex';
  }

  // ──────────────────────────────────────────────────────────────
  // _escHtml(str)
  // ──────────────────────────────────────────────────────────────
  function _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ──────────────────────────────────────────────────────────────
  // importar()  —  escribe en Firestore con batch
  // ──────────────────────────────────────────────────────────────
  async function importar() {
    const ugcId  = document.getElementById('util-ugc').value;
    const estado = document.getElementById('util-estado').value;

    if (!ugcId) { App.showToast('Selecciona una UGC antes de importar'); return; }
    if (!_filas.length) { App.showToast('No hay datos para importar'); return; }

    const btn = document.getElementById('util-btn-importar');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }

    try {
      const BATCH_MAX = 400;
      let batch = db.batch();
      let ops   = 0;
      let total = 0;

      for (const fila of _filas) {
        const ref  = db.collection(COL.ugcs).doc(ugcId)
                       .collection('estandares').doc(fila.codigo);
        const data = {
          actualizado_en:  firebase.firestore.FieldValue.serverTimestamp(),
          actualizado_por: 'Importación Excel',
        };

        if (fila.documento)   data.documento_mejora_c = fila.documento;
        if (fila.evidencia)   data.evidencia_texto    = fila.evidencia;
        if (fila.area_mejora) data.area_mejora        = fila.area_mejora;
        if (estado !== 'mantener') data.estado        = estado;

        batch.set(ref, data, { merge: true });
        ops++;
        total++;

        if (ops >= BATCH_MAX) {
          await batch.commit();
          batch = db.batch();
          ops   = 0;
        }
      }

      if (ops > 0) await batch.commit();

      App.showToast('✅ ' + total + ' estándares importados correctamente');
      _resetImportador();

    } catch (err) {
      App.showToast('❌ Error en la importación: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Importar a Firestore'; }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // migrarUGC()  —  copia subcol. estandares/reuniones/mensajes
  //                 de una UGC origen a una UGC destino
  // ──────────────────────────────────────────────────────────────
  async function migrarUGC() {
    const origenId  = document.getElementById('mig-origen').value;
    const destinoId = document.getElementById('mig-destino').value;

    if (!origenId)  { App.showToast('Selecciona la UGC de origen');  return; }
    if (!destinoId) { App.showToast('Selecciona la UGC de destino'); return; }
    if (origenId === destinoId) { App.showToast('Origen y destino no pueden ser iguales'); return; }

    const btn = document.getElementById('mig-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Migrando…'; }

    const log = document.getElementById('mig-log');
    if (log) log.innerHTML = '';

    function addLog(msg) {
      if (!log) return;
      const p = document.createElement('p');
      p.style.cssText = 'margin:2px 0;font-size:12px;font-family:monospace';
      p.textContent = msg;
      log.appendChild(p);
    }

    try {
      const COLECCIONES = ['estandares', 'reuniones', 'mensajes'];
      let totalDocs = 0;

      for (const colNombre of COLECCIONES) {
        const snap = await db.collection(COL.ugcs).doc(origenId)
                             .collection(colNombre).get();
        if (snap.empty) { addLog('  · ' + colNombre + ': vacía, omitida'); continue; }

        const BATCH_MAX = 400;
        let batch = db.batch();
        let ops   = 0;
        let count = 0;

        for (const docSnap of snap.docs) {
          const ref = db.collection(COL.ugcs).doc(destinoId)
                        .collection(colNombre).doc(docSnap.id);
          batch.set(ref, docSnap.data(), { merge: true });
          ops++;
          count++;
          totalDocs++;

          if (ops >= BATCH_MAX) {
            await batch.commit();
            batch = db.batch();
            ops   = 0;
          }
        }

        if (ops > 0) await batch.commit();
        addLog('  ✅ ' + colNombre + ': ' + count + ' documentos copiados');
      }

      addLog('');
      addLog('✅ Migración completada — ' + totalDocs + ' documentos en total');
      addLog('⚠️  Los datos del origen (' + origenId + ') NO han sido eliminados.');
      App.showToast('✅ Migración completada: ' + totalDocs + ' documentos');

    } catch (err) {
      addLog('❌ Error: ' + err.message);
      App.showToast('❌ Error en la migración: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Ejecutar migración'; }
    }
  }

  // ── API pública ───────────────────────────────────────────────
  return { cargar, leerExcel, aplicarFiltro, importar, migrarUGC };

})();