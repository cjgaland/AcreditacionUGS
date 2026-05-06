/* ═══════════════════════════════════════════════════════════════
   utilidades.js  —  Módulo Utilidades (solo admin)
   Plataforma Mentoría ACSA · Área Gestión Sanitaria Sur de Córdoba
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 9 */
/* global firebase, db, COL, UGCS, XLSX, App, getUser, pdfjsLib */

'use strict';

const Utilidades = (() => {

  // ── Estado interno — Excel ────────────────────────────────────
  let _filas    = [];
  let _rawRows  = [];
  let _esRaw    = false;
  let _fileName = '';

  // ── Estado interno — PDF ──────────────────────────────────────
  let _pdfData     = null;
  let _pdfFileName = '';
  let _ubicGrupos  = [];

  // ── Patrón código + tipo en columna EV/AM ────────────────────
  const RE_EVAM = /^(ES \d \d{2}\.\d{2}_\d{2})(EV|AM)([\s\S]*)$/;

  // Inicializar worker PDF.js cuando esté disponible
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ──────────────────────────────────────────────────────────────
  // cargar()  —  punto de entrada al navegar a la vista
  // ──────────────────────────────────────────────────────────────
  function cargar() {
    _resetImportador();

    const sel = document.getElementById('util-ugc');
    if (sel) {
      sel.innerHTML = '<option value="">— Selecciona una UGC —</option>' +
        UGCS.map(u => `<option value="${u.id}">${u.denominacion}</option>`).join('');
    }

    const selDest = document.getElementById('mig-destino');
    if (selDest) {
      selDest.innerHTML = '<option value="">— Selecciona UGC destino —</option>' +
        UGCS.map(u => `<option value="${u.id}">${u.id} · ${u.denominacion}</option>`).join('');
    }

    const log = document.getElementById('mig-log');
    if (log) log.style.display = 'block';

    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd   = String(hoy.getDate()).padStart(2, '0');
    const hastaInp = document.getElementById('util-fecha-hasta');
    if (hastaInp) hastaInp.value = `${yyyy}-${mm}-${dd}`;
  }

  // ──────────────────────────────────────────────────────────────
  // _resetImportador()
  // ──────────────────────────────────────────────────────────────
  function _resetImportador() {
    _filas = []; _rawRows = []; _esRaw = false; _fileName = '';
    _pdfData = null; _pdfFileName = ''; _ubicGrupos = [];

    ['util-preview', 'util-pdf-preview'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    const btn = document.getElementById('util-btn-importar');
    if (btn) {
      btn.style.display = 'none';
      btn.disabled = false;
      btn.textContent = '⬆ Importar estándares';
    }
    const btnPdf = document.getElementById('util-btn-importar-pdf');
    if (btnPdf) {
      btnPdf.style.display = 'none';
      btnPdf.disabled = false;
      btnPdf.textContent = '⬆ Importar datos del proyecto';
    }

    ['util-file', 'util-pdf-file'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['util-file-info', 'util-pdf-file-info'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    ['util-dropzone-excel', 'util-dropzone-pdf'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('drag-over');
    });

    const fDesde = document.getElementById('util-fecha-desde');
    const fHasta = document.getElementById('util-fecha-hasta');
    if (fDesde) fDesde.value = '';
    if (fHasta) fHasta.value = '';

    const badge = document.getElementById('util-formato-badge');
    if (badge) badge.textContent = '';
  }

  // ──────────────────────────────────────────────────────────────
  // Drag & Drop
  // ──────────────────────────────────────────────────────────────
  function dragOver(evt, tipo) {
    evt.preventDefault();
    const id = tipo === 'excel' ? 'util-dropzone-excel' : 'util-dropzone-pdf';
    const el = document.getElementById(id);
    if (el) el.classList.add('drag-over');
  }

  function dragLeave(evt, tipo) {
    const id = tipo === 'excel' ? 'util-dropzone-excel' : 'util-dropzone-pdf';
    const el = document.getElementById(id);
    if (el) el.classList.remove('drag-over');
  }

  function drop(evt, tipo) {
    evt.preventDefault();
    dragLeave(evt, tipo);
    const file = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0];
    if (!file) return;
    if (tipo === 'excel') {
      leerExcel({ files: [file] });
    } else {
      leerPDF({ files: [file] });
    }
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
  // leerPDF(inputEl)
  // ──────────────────────────────────────────────────────────────
  async function leerPDF(inputEl) {
    if (!inputEl.files || !inputEl.files.length) return;
    if (typeof pdfjsLib === 'undefined') {
      App.showToast('❌ PDF.js no disponible. Recarga la página e inténtalo de nuevo.');
      return;
    }
    const file = inputEl.files[0];
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      App.showToast('Por favor selecciona un archivo PDF (.pdf)');
      return;
    }
    _pdfFileName = file.name;
    const infoEl = document.getElementById('util-pdf-file-info');
    if (infoEl) infoEl.textContent = 'Leyendo ' + file.name + '…';

    try {
      const text = await _extraerTextoPDF(file);
      _pdfData = _parsearFichaPDF(text);

      if (_pdfData.otras_ubicaciones && _pdfData.otras_ubicaciones.length) {
        _ubicGrupos = _agruparUbicaciones(_pdfData.otras_ubicaciones);
      } else {
        _ubicGrupos = [];
      }

      if (infoEl) infoEl.textContent = file.name;
      _mostrarPreviewPDF();
    } catch (err) {
      App.showToast('❌ Error al leer el PDF: ' + err.message);
      if (infoEl) infoEl.textContent = '';
    }
  }

  // ──────────────────────────────────────────────────────────────
  // _extraerTextoPDF(file) → Promise<string>
  // Reconstruye líneas agrupando por posición Y (de arriba a abajo)
  // ──────────────────────────────────────────────────────────────
  async function _extraerTextoPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const paginas = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc   = await page.getTextContent();

      const mapa = {};
      for (const item of tc.items) {
        const y = Math.round(item.transform[5]);
        if (!mapa[y]) mapa[y] = [];
        mapa[y].push({ x: item.transform[4], str: item.str });
      }

      const ys    = Object.keys(mapa).map(Number).sort((a, b) => b - a);
      const lineas = ys.map(y =>
        mapa[y].sort((a, b) => a.x - b.x).map(it => it.str).join(' ')
      );
      paginas.push(lineas.join('\n'));
    }

    return paginas.join('\n');
  }

  // ──────────────────────────────────────────────────────────────
  // _parsearFichaPDF(text)  —  extrae campos del texto del PDF
  // ──────────────────────────────────────────────────────────────
  function _parsearFichaPDF(text) {

    function ext(re) {
      const m = text.match(re);
      return m ? m[1].trim() : '';
    }

    function toIso(str) {
      if (!str) return '';
      const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : '';
    }

    function extFecha(etiqueta) {
      const re = new RegExp(etiqueta + '[\\s\\S]{0,40}?(\\d{1,2}\\/\\d{1,2}\\/\\d{4})', 'i');
      const m = text.match(re);
      return m ? toIso(m[1]) : '';
    }

    function extRango(etiqueta) {
      const re = new RegExp(
        etiqueta + '[\\s\\S]{0,60}?(\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s*[-–]\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4})',
        'i'
      );
      const m = text.match(re);
      return m ? [toIso(m[1]), toIso(m[2])] : ['', ''];
    }

    // Campos básicos
    const codigoRaw = ext(/C[oó]digo\s*[:\-]?\s*(\S+)/);
    const codigo    = (codigoRaw && !codigoRaw.startsWith('http')) ? codigoRaw : '';
    const estado    = ext(/Estado\s*[:\-]?\s*([^\n\r\t]{2,30})/);
    const tipo      = ext(/Tipo\s*[:\-]?\s*([^\n\r\t]{2,30})/);
    const nivelCert = ext(/Nivel\s+de\s+certificaci[oó]n\s*[:\-]?\s*([^\n\r\t]{2,30})/i);
    const manualAmb = ext(/Manual\s+y\s+[aá]mbito\s*[:\-]?\s*([^\n\r]{5,})/i);

    let ambito = '';
    let ambitoLabel = '';
    const ma = (manualAmb || '').toLowerCase();
    if (ma.includes('primaria'))       { ambito = 'AP';        ambitoLabel = 'Atención Primaria'; }
    else if (ma.includes('hospital'))  { ambito = 'HOSP';      ambitoLabel = 'Hospitalaria'; }
    else if (ma.includes('urgencias')) { ambito = 'Urgencias'; ambitoLabel = 'Urgencias'; }

    // Fechas del ciclo
    const fechaSolicitud = extFecha('Solicitud');
    const [autoDesde, autoHasta] = extRango('Autoevaluaci[oó]n');
    const fechaEvaluacion = extFecha('Evaluaci[oó]n');
    const [respDesde, respHasta] = extRango('Resp\\.?\\s+solicitante\\s*\\(Autoevaluaci');
    const fechaCert = extFecha('Certificaci[oó]n');
    const fechaSeguimiento = extFecha('Seguimiento');
    const [apercDesde, apercHasta] = extRango('Apercibimiento');
    const fechaFinCert = extFecha('Fin\\s+certificaci[oó]n');

    // Responsables
    const director    = ext(/Director[a]?\s+(?:de\s+)?UGC\s*[:\-]?\s*([^\n\r\t]{3,60})/i);
    const responsable = ext(/Responsable\s+del\s+proyecto[^\n\r:]*[:\-]?\s*([^\n\r\t]{3,60})/i);

    // Localización
    const direccion = ext(/Direcci[oó]n\s*[:\-]?\s*([^\n\r\t]{3,80})/i);
    const localidad = ext(/Localidad\s*[:\-]?\s*([^\n\r\t]{3,60})/i);
    const cp        = ext(/C\.?P\.?\s*[:\-]?\s*(\d{5})/i);
    const telefono  = ext(/Tel[eé]fono\s*[:\-]?\s*([\d\s\-\.]{7,15})/i);

    let dirCompleta = direccion;
    if (localidad && !dirCompleta.includes(localidad.split(',')[0])) {
      dirCompleta = dirCompleta + (dirCompleta ? ', ' : '') + localidad;
    }
    if (cp && !dirCompleta.includes(cp)) {
      dirCompleta = dirCompleta + (dirCompleta ? ' · CP ' : 'CP ') + cp;
    }

    // Otras ubicaciones: bloque entre la cabecera y la siguiente sección
    const otras = [];
    const mUbic = text.match(/Otras\s+ubicaciones\s*\n?([\s\S]*?)(?:Hist[oó]rico|Responsable\s+del|$)/i);
    if (mUbic) {
      const lineas = mUbic[1].split('\n').map(l => l.trim()).filter(l => l.length > 4);
      for (const l of lineas) {
        if (/^(hist[oó]rico|responsable)/i.test(l)) break;
        if (/^[A-ZÁÉÍÓÚÜÑ]/i.test(l) && !otras.includes(l)) otras.push(l);
      }
    }

    // Histórico de certificaciones
    const historico = [];
    const mHist = text.match(/Hist[oó]rico\s+de\s+certificaciones\s*\n?([\s\S]*)$/i);
    if (mHist) {
      const RE_FECHA = /(\d{1,2}\/\d{1,2}\/\d{4})/g;
      const lineas = mHist[1].split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const l of lineas) {
        const mCod = l.match(/^(\d{4}\/\d{3,4}(?:_\w+)?)/);
        if (!mCod) continue;
        const fechas = [];
        let mf;
        RE_FECHA.lastIndex = 0;
        while ((mf = RE_FECHA.exec(l)) !== null) fechas.push(toIso(mf[1]));
        const mEstado = l.match(/(Vigente|Vencido|Abandonado|En\s+proceso)/i);
        const mFase   = l.match(/(Finalizado|Autoevaluaci[oó]n|Evaluaci[oó]n|Solicitud|Seguimiento)/i);
        historico.push({
          codigo:            mCod[1],
          estado:            mEstado ? mEstado[1] : '',
          fase:              mFase   ? mFase[1]   : '',
          fecha_obtencion:   fechas[0] || '',
          fecha_vencimiento: fechas[1] || '',
        });
      }
    }

    return {
      codigo_acsa:                  codigo,
      tipo_proyecto:                tipo,
      estado_proyecto:              estado,
      nivel_certificado:            nivelCert,
      ambito,
      ambito_label:                 ambitoLabel,
      fecha_solicitud:              fechaSolicitud,
      fecha_autoevaluacion_desde:   autoDesde,
      fecha_autoevaluacion_hasta:   autoHasta,
      fecha_prevista:               fechaEvaluacion,
      fecha_resp_solicitante_desde: respDesde,
      fecha_resp_solicitante_hasta: respHasta,
      fecha_certificacion:          fechaCert,
      fecha_seguimiento:            fechaSeguimiento,
      fecha_apercibimiento_desde:   apercDesde,
      fecha_apercibimiento_hasta:   apercHasta,
      fecha_fin_certificacion:      fechaFinCert,
      director_nombre:              director,
      responsable_proyecto_nombre:  responsable,
      direccion:                    dirCompleta,
      telefono1:                    (telefono || '').replace(/\s/g, ''),
      otras_ubicaciones:            otras,
      historico_certificaciones:    historico,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // _normalizarUbicacion(str)
  // ──────────────────────────────────────────────────────────────
  function _normalizarUbicacion(str) {
    return str.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\bcentro\s+de\s+salud\b/g, 'cs')
      .replace(/\bconsultorio\s+local\b/g, 'consult')
      .replace(/\bconsultorio\b/g, 'consult')
      .replace(/\bde\b|\bdel\b|\bla\b|\bel\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ──────────────────────────────────────────────────────────────
  // _agruparUbicaciones(lista)
  // Devuelve [{variantes: [...], recomendada: '...'}]
  // ──────────────────────────────────────────────────────────────
  function _agruparUbicaciones(lista) {
    const normals   = lista.map(u => _normalizarUbicacion(u));
    const asignadas = new Array(lista.length).fill(false);
    const grupos    = [];

    for (let i = 0; i < lista.length; i++) {
      if (asignadas[i]) continue;
      const grupo = [i];
      for (let j = i + 1; j < lista.length; j++) {
        if (asignadas[j]) continue;
        const ni = normals[i];
        const nj = normals[j];
        const tokI = ni.split(' ').filter(t => t.length > 2);
        const tokJ = nj.split(' ').filter(t => t.length > 2);
        const iEnJ = tokI.length > 0 && tokI.every(t => nj.includes(t));
        const jEnI = tokJ.length > 0 && tokJ.every(t => ni.includes(t));
        if (iEnJ || jEnI) { grupo.push(j); asignadas[j] = true; }
      }
      asignadas[i] = true;
      const variantes  = grupo.map(idx => lista[idx]);
      const recomendada = variantes.reduce((a, b) => a.length >= b.length ? a : b);
      grupos.push({ variantes, recomendada });
    }
    return grupos;
  }

  // ──────────────────────────────────────────────────────────────
  // _mostrarPreviewPDF()
  // ──────────────────────────────────────────────────────────────
  function _mostrarPreviewPDF() {
    const prev = document.getElementById('util-pdf-preview');
    if (!prev || !_pdfData) return;
    const d = _pdfData;

    // Zona de deduplicación de ubicaciones
    let ubicHtml = '';
    if (_ubicGrupos.length > 0) {
      const hayDups = _ubicGrupos.some(g => g.variantes.length > 1);
      if (hayDups) {
        ubicHtml = `
          <div style="margin-top:10px;padding:12px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px">
            <div style="font-size:12px;font-weight:700;color:#b45309;margin-bottom:10px">
              ⚠️ Se detectaron posibles duplicados. Selecciona qué nombre conservar en cada grupo:
            </div>
            ${_ubicGrupos.map((g, gi) => {
              if (g.variantes.length === 1) {
                return `<div style="font-size:12px;padding:3px 0;color:var(--text2)">✅ ${_escHtml(g.variantes[0])}</div>`;
              }
              return `<div style="padding:8px 10px;margin:4px 0;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
                <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Grupo ${gi+1} — ¿cuál conservar?</div>
                ${g.variantes.map(vr => `
                  <label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer">
                    <input type="radio" name="ubic-grupo-${gi}" value="${_escHtml(vr)}" ${vr===g.recomendada?'checked':''}>
                    ${_escHtml(vr)}
                    ${vr===g.recomendada ? '<span style="font-size:10px;color:var(--green);margin-left:4px">(recomendada)</span>' : ''}
                  </label>`).join('')}
              </div>`;
            }).join('')}
          </div>`;
      } else {
        ubicHtml = `<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--text2)">
          ${_ubicGrupos.map(g => `<li>${_escHtml(g.variantes[0])}</li>`).join('')}
        </ul>`;
      }
    }

    // Tabla histórico
    let histHtml = '';
    if (d.historico_certificaciones && d.historico_certificaciones.length) {
      histHtml = `<div style="overflow-x:auto;margin-top:6px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--surface2)">
              <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Código</th>
              <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Estado</th>
              <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Fase</th>
              <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Obtención</th>
              <th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left">Vencimiento</th>
            </tr>
          </thead>
          <tbody>
            ${d.historico_certificaciones.map(h => `
              <tr>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:monospace">${_escHtml(h.codigo)}</td>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${_escHtml(h.estado)}</td>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${_escHtml(h.fase)}</td>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${_fmtIsoDisplay(h.fecha_obtencion)}</td>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${_fmtIsoDisplay(h.fecha_vencimiento)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    prev.innerHTML = `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px;margin-top:12px">
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px">
          Vista previa · <strong>Ficha de Proyecto PDF</strong>
          <span style="font-size:11px;color:var(--text3);margin-left:8px">${_escHtml(_pdfFileName)}</span>
        </p>

        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Datos del proyecto</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-bottom:14px">
          ${_prevRow('Código ACSA',          d.codigo_acsa)}
          ${_prevRow('Estado',               d.estado_proyecto)}
          ${_prevRow('Tipo',                 d.tipo_proyecto)}
          ${_prevRow('Nivel certificación',  d.nivel_certificado)}
          ${_prevRow('Ámbito',               d.ambito_label)}
        </div>

        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Ciclo de fechas</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:14px">
          ${_prevRow('Solicitud',                d.fecha_solicitud,              true)}
          ${_prevRow('Autoevaluación desde',     d.fecha_autoevaluacion_desde,   true)}
          ${_prevRow('Autoevaluación hasta',     d.fecha_autoevaluacion_hasta,   true)}
          ${_prevRow('Evaluación (visita)',       d.fecha_prevista,               true)}
          ${_prevRow('Resp. Solicitante desde',   d.fecha_resp_solicitante_desde, true)}
          ${_prevRow('Resp. Solicitante hasta',   d.fecha_resp_solicitante_hasta, true)}
          ${_prevRow('Certificación',             d.fecha_certificacion,          true)}
          ${_prevRow('Seguimiento',               d.fecha_seguimiento,            true)}
          ${_prevRow('Apercibimiento desde',      d.fecha_apercibimiento_desde,   true)}
          ${_prevRow('Apercibimiento hasta',      d.fecha_apercibimiento_hasta,   true)}
          ${_prevRow('Fin certificación',         d.fecha_fin_certificacion,      true)}
        </div>

        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Responsables</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:14px">
          ${_prevRow('Director/a UGC',           d.director_nombre)}
          ${_prevRow('Responsable del proyecto',  d.responsable_proyecto_nombre)}
        </div>

        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Localización</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:14px">
          ${_prevRow('Dirección',  d.direccion)}
          ${_prevRow('Teléfono',   d.telefono1)}
        </div>

        ${d.otras_ubicaciones && d.otras_ubicaciones.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:4px">
          Otras ubicaciones <span style="font-weight:400;text-transform:none">(${d.otras_ubicaciones.length} detectadas)</span>
        </div>
        ${ubicHtml}` : ''}

        ${d.historico_certificaciones && d.historico_certificaciones.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);margin:14px 0 4px">
          Histórico de certificaciones <span style="font-weight:400;text-transform:none">(${d.historico_certificaciones.length} registros)</span>
        </div>
        ${histHtml}` : ''}

        <div style="margin-top:14px;font-size:11px;color:var(--text3)">
          ⚠️ Solo se sobrescribirán los campos con valor. Los campos vacíos no modifican datos existentes.
        </div>
      </div>`;

    const btn = document.getElementById('util-btn-importar-pdf');
    if (btn) btn.style.display = 'inline-flex';
  }

  function _prevRow(label, val, esFecha) {
    const display = esFecha
      ? _fmtIsoDisplay(val)
      : (_escHtml(val || '') || '<span style="color:var(--text3)">—</span>');
    return `<div>
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;color:var(--text3);margin-bottom:2px">${label}</div>
      <div style="font-size:12px;font-weight:500">${display}</div>
    </div>`;
  }

  function _fmtIsoDisplay(str) {
    if (!str) return '<span style="color:var(--text3)">—</span>';
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : _escHtml(str);
  }

  // ──────────────────────────────────────────────────────────────
  // _resolverUbicaciones()  —  lee selección del usuario
  // ──────────────────────────────────────────────────────────────
  function _resolverUbicaciones() {
    const resultado = [];
    _ubicGrupos.forEach((g, gi) => {
      if (g.variantes.length === 1) {
        resultado.push(g.variantes[0]);
      } else {
        const radio = document.querySelector(`input[name="ubic-grupo-${gi}"]:checked`);
        resultado.push(radio ? radio.value : g.recomendada);
      }
    });
    return resultado;
  }

  // ──────────────────────────────────────────────────────────────
  // importarProyecto()  —  escribe datos del PDF en /ugcs/{ugcId}
  // ──────────────────────────────────────────────────────────────
  async function importarProyecto() {
    const ugcId = document.getElementById('util-ugc').value;
    if (!ugcId) { App.showToast('Selecciona una UGC antes de importar'); return; }
    if (!_pdfData)  { App.showToast('No hay datos de PDF para importar'); return; }

    const btn = document.getElementById('util-btn-importar-pdf');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }

    try {
      const d = _pdfData;
      const ubicacionesFinales = _resolverUbicaciones();

      const data = {};
      const _set = (key, val) => { if (val) data[key] = val; };

      _set('codigo_acsa',                   d.codigo_acsa);
      _set('tipo_proyecto',                 d.tipo_proyecto);
      _set('estado_proyecto',               d.estado_proyecto);
      _set('nivel_certificado',             d.nivel_certificado);
      _set('fecha_solicitud',               d.fecha_solicitud);
      _set('fecha_autoevaluacion_desde',    d.fecha_autoevaluacion_desde);
      _set('fecha_autoevaluacion_hasta',    d.fecha_autoevaluacion_hasta);
      _set('fecha_prevista',                d.fecha_prevista);
      _set('fecha_resp_solicitante_desde',  d.fecha_resp_solicitante_desde);
      _set('fecha_resp_solicitante_hasta',  d.fecha_resp_solicitante_hasta);
      _set('fecha_certificacion',           d.fecha_certificacion);
      _set('fecha_seguimiento',             d.fecha_seguimiento);
      _set('fecha_apercibimiento_desde',    d.fecha_apercibimiento_desde);
      _set('fecha_apercibimiento_hasta',    d.fecha_apercibimiento_hasta);
      _set('fecha_fin_certificacion',       d.fecha_fin_certificacion);
      _set('director_nombre',              d.director_nombre);
      _set('responsable_proyecto_nombre',  d.responsable_proyecto_nombre);
      _set('direccion',                    d.direccion);
      _set('telefono1',                    d.telefono1);

      if (ubicacionesFinales.length > 0) data.otras_ubicaciones = ubicacionesFinales;
      if (d.historico_certificaciones && d.historico_certificaciones.length) {
        data.historico_certificaciones = d.historico_certificaciones;
      }

      await db.collection(COL.ugcs).doc(ugcId).set(data, { merge: true });

      const ugc = UGCS.find(u => u.id === ugcId);
      if (ugc) Object.assign(ugc, data);

      const n = Object.keys(data).length;
      App.showToast(`✅ Datos del proyecto importados (${n} campos actualizados)`);

      _pdfData = null; _pdfFileName = ''; _ubicGrupos = [];
      const prev = document.getElementById('util-pdf-preview');
      if (prev) prev.innerHTML = '';
      const infoEl = document.getElementById('util-pdf-file-info');
      if (infoEl) infoEl.textContent = '';
      const pdfInput = document.getElementById('util-pdf-file');
      if (pdfInput) pdfInput.value = '';
      if (btn) { btn.style.display = 'none'; }

    } catch (err) {
      App.showToast('❌ Error al importar: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Importar datos del proyecto'; }
    }
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
      _procesarFormatoTransformado(rows);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // _detectarFormatoRaw(claves)
  // ──────────────────────────────────────────────────────────────
  function _detectarFormatoRaw(claves) {
    const low = claves.map(k => k.toLowerCase().replace(/\s/g, ''));
    return low.some(k => k.includes('ev/am') || k.includes('ev / am'));
  }

  // ──────────────────────────────────────────────────────────────
  // aplicarFiltro()  —  llamado desde los onchange de fechas
  // ──────────────────────────────────────────────────────────────
  function aplicarFiltro() {
    if (!_esRaw || !_rawRows.length) return;
    _procesarConFiltro();
  }

  // ──────────────────────────────────────────────────────────────
  // _procesarConFiltro()
  // ──────────────────────────────────────────────────────────────
  function _procesarConFiltro() {
    const desdeStr = (document.getElementById('util-fecha-desde') || {}).value || '';
    const hastaStr = (document.getElementById('util-fecha-hasta') || {}).value || '';

    const desde = desdeStr ? new Date(desdeStr + 'T00:00:00') : null;
    const hasta = hastaStr ? new Date(hastaStr + 'T23:59:59') : null;

    const claveDoc   = _detectarCol(_rawRows, ['documento']);
    const claveFecha = _detectarCol(_rawRows, ['fecha']);
    const claveUser  = _detectarCol(_rawRows, ['usuario']);
    const claveEvAm  = _detectarCol(_rawRows, ['ev / am', 'ev/am', 'ev   am', 'ev / am', 'ev ', 'am']);

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
      const tipo      = m[2];
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
  // _procesarFormatoTransformado(rows)
  // ──────────────────────────────────────────────────────────────
  function _procesarFormatoTransformado(rows) {
    const claveEst    = _detectarCol(rows, ['estándar', 'estandar', 'standard', 'código', 'codigo', 'es ']);
    const claveDocs   = _detectarCol(rows, ['documentos aportados', 'documentos', 'docs', 'documento']);
    const claveEvid   = _detectarCol(rows, ['evidencias', 'evidencia']);
    const claveAM     = _detectarCol(rows, ['área de mejora', 'areas de mejora', 'mejora']);
    const claveEstado = _detectarCol(rows, ['estado']);

    if (!claveEst) {
      App.showToast('No se encontró la columna de estándares (Estándar / Código)');
      return;
    }

    const RE_COD = /^(ES \d \d{2}\.\d{2}_\d{2})/;
    const MAPA_ESTADO = {
      'cumple':             'cumple',
      'propuesto':          'propuesto',
      'propuesto a cumple': 'propuesto',
      'pendiente':          'pendiente',
    };

    _filas = rows
      .map(r => {
        const codigoRaw = String(r[claveEst] || '').trim();
        const mCod      = codigoRaw.match(RE_COD);
        const codigo    = mCod ? mCod[1] : codigoRaw;
        const estadoRaw = claveEstado ? String(r[claveEstado] || '').trim().toLowerCase() : '';
        const estadoExcel = MAPA_ESTADO[estadoRaw] || '';
        return {
          codigo,
          documento:   String(r[claveDocs] || '').trim(),
          evidencia:   String(r[claveEvid]  || '').trim(),
          area_mejora: String(r[claveAM]    || '').trim(),
          estadoExcel,
        };
      })
      .filter(r => r.codigo.length > 0);

    if (!_filas.length) {
      App.showToast('No se encontraron filas con código de estándar');
      return;
    }

    const info = document.getElementById('util-file-info');
    if (info) {
      const tieneEstado = _filas.some(f => f.estadoExcel);
      const sufijo = tieneEstado ? ' · con columna Estado' : '';
      info.textContent = _fileName + ' · ' + _filas.length + ' estándares (formato transformado)' + sufijo;
    }

    _mostrarPreview();
  }

  // ──────────────────────────────────────────────────────────────
  // _limpiarNombreDoc(str)
  // ──────────────────────────────────────────────────────────────
  function _limpiarNombreDoc(str) {
    if (!str) return '';
    let clean = str.replace(/^\(\d+[ \s]*[MKGmkg][bBiI]+\.\)\s*/u, '');
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
  // _mostrarPreview()  —  para el Excel
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
      const codHtml = _escHtml(r.codigo);
      const docHtml = r.documento
        ? r.documento.split('\n').map(l => `<div style="white-space:nowrap;font-size:11px">• ${_escHtml(l.trim())}</div>`).join('')
        : '<span style="color:var(--text3)">—</span>';
      const evCorto = r.evidencia.length > 80 ? r.evidencia.substring(0, 80) + '…' : r.evidencia;
      const evHtml  = evCorto ? _escHtml(evCorto) : '<span style="color:var(--text3)">—</span>';
      const amCorto = r.area_mejora.length > 60 ? r.area_mejora.substring(0, 60) + '…' : r.area_mejora;
      const amHtml  = amCorto ? _escHtml(amCorto) : '<span style="color:var(--text3)">—</span>';
      const amCell  = tieneAM ? `<td style="font-size:12px">${amHtml}</td>` : '';
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
  // importar()  —  escribe estándares Excel en Firestore
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

        const estadoAplicar = (estado === 'excel') ? (fila.estadoExcel || null)
          : (estado !== 'mantener') ? estado : null;

        if (estadoAplicar) {
          data.estado = estadoAplicar;
          if (estadoAplicar === 'cumple') {
            data.validado_en  = firebase.firestore.FieldValue.serverTimestamp();
            data.validado_por = getUser() ? getUser().uid : 'Importación Excel';
          }
        }

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

      const _etqEstado = { cumple: '✅ Cumple', propuesto: '⏳ Propuesto',
        mantener: 'estado sin cambiar', excel: 'estado desde Excel' };
      App.showToast('✅ ' + total + ' estándares importados · ' + (_etqEstado[estado] || estado));
      _resetImportador();

    } catch (err) {
      App.showToast('❌ Error en la importación: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Importar estándares'; }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // migrarUGC()
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
          ops++; count++; totalDocs++;
          if (ops >= BATCH_MAX) { await batch.commit(); batch = db.batch(); ops = 0; }
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
  return {
    cargar,
    leerExcel,
    leerPDF,
    aplicarFiltro,
    importar,
    importarProyecto,
    migrarUGC,
    dragOver,
    dragLeave,
    drop,
  };

})();
