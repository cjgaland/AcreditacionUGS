/* ═══════════════════════════════════════════════
   ACSA UGC · Buscador de Estándares
   app.js  —  requires estandares.js loaded first
   ═══════════════════════════════════════════════ */

/* jshint esversion: 6 */
/* global STANDARDS */

'use strict';

/* ── STATE ── */
const state = {
  search:   '',
  bloque:   'all',
  criterio: 'all',
  grupo:    'all',
  oblig:    'all',
  circ:     'all',
  sort:     'default',
  expanded: null,
};

/* ── UTILS ── */
function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(text, q) {
  if (!q || q.length < 2) return esc(text);
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return esc(text).replace(new RegExp(safe, 'gi'), m => `<mark>${m}</mark>`);
}

/* ── SEARCH INDEX ── */
function buildSearchIndex(standards) {
  return standards.map(s => {
    function collect(val) {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string' || typeof val === 'number') return String(val);
      if (Array.isArray(val)) return val.map(collect).join(' ');
      if (typeof val === 'object') return Object.values(val).map(collect).join(' ');
      return '';
    }
    return collect(s).toLowerCase();
  });
}

const SEARCH_INDEX = buildSearchIndex(STANDARDS);

function matchesSearch(s, q, idx) {
  if (!q) return true;
  return idx.includes(q.toLowerCase());
}

/* ── FILTER + SORT ── */
function applyFilters() {
  return STANDARDS.filter((s, i) => {
    if (!matchesSearch(s, state.search, SEARCH_INDEX[i])) return false;
    if (state.bloque   !== 'all' && s.bloque_num   !== +state.bloque)    return false;
    if (state.criterio !== 'all' && s.criterio_num !== +state.criterio)  return false;
    if (state.grupo    !== 'all' && s.grupo        !== state.grupo)      return false;
    if (state.oblig    !== 'all' && s.obligatorio  !== state.oblig)      return false;
    if (state.circ     !== 'all' && (s.circuito || 'NO') !== state.circ) return false;
    return true;
  });
}

function sortResults(arr) {
  const copy = [...arr];
  switch (state.sort) {
    case 'bloque': return copy.sort((a, b) => a.bloque_num - b.bloque_num || a.criterio_num - b.criterio_num || a.orden - b.orden);
    case 'grupo':  return copy.sort((a, b) => ['I','II','III'].indexOf(a.grupo) - ['I','II','III'].indexOf(b.grupo));
    case 'oblig':  return copy.sort((a, b) => (b.obligatorio === 'Si' ? 1 : 0) - (a.obligatorio === 'Si' ? 1 : 0));
    default:       return copy;
  }
}

/* ── CARD BUILDER ── */
function circuitBadge(circ) {
  if (!circ || circ === 'NO') return `<span class="badge badge-circuit-NO">Sin circuito</span>`;
  const cls = circ === 'Soporte' ? 'badge-circuit-P' : 'badge-circuit';
  return `<span class="badge ${cls}">${esc(circ)}</span>`;
}

function buildCard(s) {
  const q   = state.search;
  const exp = state.expanded === s.codigo;

  const ceHtml = (s.criterios_evaluables || []).map((ce, i) => `
    <div class="ce-item">
      <div class="ce-num">${i + 1}</div>
      <div class="ce-text">${highlight(ce.replace(/X$/, ''), q)}</div>
    </div>`).join('');

  const reqHtml = (s.requisitos || []).map((r, i) => `
    <div class="req-item">
      <div class="req-num">R${i + 1}</div>
      <div class="req-text">${highlight(r, q)}</div>
    </div>`).join('');

  return `
<div class="card${exp ? ' expanded' : ''}" data-code="${esc(s.codigo)}">
  <div class="card-header">
    <div class="card-top">
      <span class="card-code">${highlight(s.codigo, q)}</span>
      <div class="card-badges">
        <span class="badge badge-grupo-${esc(s.grupo)}">Grupo ${esc(s.grupo)}</span>
        ${s.obligatorio === 'Si' ? '<span class="badge badge-oblig">Obligatorio</span>' : ''}
        ${circuitBadge(s.circuito)}
      </div>
    </div>
    <div class="card-enunciado">${highlight(s.enunciado, q)}</div>
    <div class="card-meta">
      <span>Bloque ${s.bloque_num} · ${esc(s.bloque_nombre)}</span>
      <span class="meta-sep">|</span>
      <span>C${s.criterio_num} · ${esc(s.criterio_nombre)}</span>
      <span class="meta-sep">|</span>
      <span>Rev. ${s.revision}</span>
      <span class="meta-sep">|</span>
      <span>${s.n_criterios_evaluables} criterio${s.n_criterios_evaluables !== 1 ? 's' : ''} evaluable${s.n_criterios_evaluables !== 1 ? 's' : ''}</span>
    </div>
  </div>

  <div class="card-preview">${highlight(s.proposito, q)}</div>

  <div class="card-body">
    <div class="card-actions">
      <button class="card-btn card-btn-print" data-action="print" data-code="${esc(s.codigo)}" title="Imprimir estándar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Imprimir
      </button>
      <button class="card-btn card-btn-pdf" data-action="pdf" data-code="${esc(s.codigo)}" title="Descargar PDF">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        PDF
      </button>
      <button class="card-btn card-btn-copy" data-action="copy-text" data-code="${esc(s.codigo)}" title="Copiar como texto">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copiar texto
      </button>
      <button class="card-btn card-btn-png" data-action="copy-png" data-code="${esc(s.codigo)}" title="Copiar como imagen PNG">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        Copiar PNG
      </button>
      <button class="card-btn card-btn-close" data-action="close" data-code="${esc(s.codigo)}" title="Cerrar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Cerrar
      </button>
    </div>

    <div class="section-title">🎯 Propósito</div>
    <div class="proposito-text">${highlight(s.proposito, q)}</div>

    <div class="section-title">📋 Criterios Evaluables (${s.n_criterios_evaluables})</div>
    <div class="ce-list">${ceHtml}</div>

    ${reqHtml ? `
    <div class="section-title">✅ Requisitos de Evaluación (${s.requisitos.length})</div>
    <div class="req-list">${reqHtml}</div>` : ''}

    <div class="section-title" style="margin-top:18px">🏥 Estado en las UGCs del Área</div>
    <div class="ugc-status-wrap" id="ugc-status-${esc(s.codigo)}">
      <span class="ugc-status-loading">Consultando Firestore…</span>
    </div>
  </div>
</div>`;
}

/* ── RENDER ── */
function render() {
  const filtered = applyFilters();
  const sorted   = sortResults(filtered);
  const grid     = document.getElementById('cardGrid');

  document.getElementById('resultCount').textContent =
    `Mostrando ${sorted.length} estándar${sorted.length !== 1 ? 'es' : ''}` +
    (filtered.length < STANDARDS.length ? ` de ${STANDARDS.length}` : '');

  if (sorted.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <h3>Sin resultados</h3>
        <p>No se encontraron estándares con los filtros aplicados.<br>Prueba a ampliar los criterios de búsqueda.</p>
      </div>`;
    updateBadge();
    return;
  }

  grid.innerHTML = sorted.map(buildCard).join('');

  if (state.expanded) {
    const el = grid.querySelector(`[data-code="${state.expanded}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cargarEstadosUGC(state.expanded);
  }

  updateBadge();
}

/* ── TOAST ── */
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ── STANDARD → PLAIN TEXT ── */
function standardToText(s) {
  const lines = [];
  lines.push('══════════════════════════════════════════');
  lines.push('ESTÁNDAR: ' + s.codigo);
  lines.push('══════════════════════════════════════════');
  lines.push('Bloque ' + s.bloque_num + ' · ' + s.bloque_nombre);
  lines.push('Criterio ' + s.criterio_num + ' · ' + s.criterio_nombre);
  lines.push('Grupo: ' + s.grupo + ' | Obligatorio: ' + s.obligatorio + ' | Circuito: ' + (s.circuito || 'NO') + ' | Rev. ' + s.revision);
  lines.push('');
  lines.push('ENUNCIADO');
  lines.push(s.enunciado);
  lines.push('');
  lines.push('PROPÓSITO');
  lines.push(s.proposito);
  if (s.criterios_evaluables && s.criterios_evaluables.length) {
    lines.push('');
    lines.push('CRITERIOS EVALUABLES (' + s.criterios_evaluables.length + ')');
    s.criterios_evaluables.forEach((ce, i) => lines.push((i + 1) + '. ' + ce.replace(/X$/, '')));
  }
  if (s.requisitos && s.requisitos.length) {
    lines.push('');
    lines.push('REQUISITOS DE EVALUACIÓN (' + s.requisitos.length + ')');
    s.requisitos.forEach((r, i) => lines.push('R' + (i + 1) + '. ' + r));
  }
  lines.push('');
  lines.push('══════════════════════════════════════════');
  return lines.join('\n');
}

/* ── PRINT ── */
function printCard(code) {
  const s = STANDARDS.find(x => x.codigo === code);
  if (!s) return;
  const txt = standardToText(s).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;');
  const w = window.open('', '_blank', 'width=800,height=700');
  w.document.write('<html><head><title>' + s.codigo + '</title>');
  w.document.write('<style>body{font-family:monospace;font-size:13px;padding:32px;line-height:1.6;color:#1a1814}</style>');
  w.document.write('</head><body>' + txt + '</body></html>');
  w.document.close();
  w.focus();
  w.print();
}

/* ── PDF ── */
function downloadPDF(code) {
  const s = STANDARDS.find(x => x.codigo === code);
  if (!s) return;

  function buildAndSave() {
    /* jshint ignore:start */
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const PW = 170;
    const ML = 20;
    let y = 20;

    function addText(text, opts) {
      const o = Object.assign({ x: ML, size: 10, color: '#1a1814', bold: false }, opts);
      doc.setFontSize(o.size);
      doc.setTextColor(o.color);
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(String(text), PW - (o.x - ML));
      lines.forEach(line => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, o.x, y);
        y += o.size * 0.45;
      });
    }

    function sectionHeader(title, color) {
      y += 4;
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFillColor(color);
      doc.roundedRect(ML, y - 4, PW, 7, 1.5, 1.5, 'F');
      doc.setFontSize(9);
      doc.setTextColor('#ffffff');
      doc.setFont('helvetica', 'bold');
      doc.text(title.toUpperCase(), ML + 4, y + 0.5);
      y += 7;
    }

    function blockText(text, bgColor, borderColor) {
      const lines = doc.splitTextToSize(text.replace(/X$/, ''), PW - 8);
      const h = Math.max(8, lines.length * 5 + 4);
      if (y + h > 275) { doc.addPage(); y = 20; }
      doc.setFillColor(bgColor);
      doc.rect(ML, y, PW, h, 'F');
      doc.setFillColor(borderColor);
      doc.rect(ML, y, 1.5, h, 'F');
      doc.setFontSize(9);
      doc.setTextColor('#1a1814');
      doc.setFont('helvetica', 'normal');
      lines.forEach((line, li) => { doc.text(line, ML + 4, y + 4 + li * 5); });
      y += h + 2;
    }

    doc.setFillColor('#1e5b8c');
    doc.rect(0, 0, 210, 14, 'F');
    doc.setFontSize(9); doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'normal');
    doc.text('Manual de Acreditación ACSA · Unidades de Gestión Clínica', ML, 9);

    y = 22;
    doc.setFillColor('#d6e8f5');
    doc.roundedRect(ML, y - 4, 36, 6, 1.5, 1.5, 'F');
    doc.setFontSize(9); doc.setTextColor('#1e5b8c'); doc.setFont('helvetica', 'bold');
    doc.text(s.codigo, ML + 2, y + 0.2);
    y += 6;

    addText(s.enunciado, { size: 13, bold: true, color: '#1a1814' });
    y += 2;

    const badges = [
      'Bloque ' + s.bloque_num + ' · ' + s.bloque_nombre,
      'C' + s.criterio_num + ' · ' + s.criterio_nombre,
      'Grupo ' + s.grupo,
      s.obligatorio === 'Si' ? 'OBLIGATORIO' : 'No obligatorio',
      'Circuito: ' + (s.circuito || 'Sin circuito'),
      'Rev. ' + s.revision,
    ];
    let bx = ML;
    badges.forEach(b => {
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor('#6b6560');
      const bw = doc.getTextWidth(b) + 6;
      if (bx + bw > ML + PW) { bx = ML; y += 6; }
      doc.setFillColor('#edeae4');
      doc.roundedRect(bx, y - 3.5, bw, 5.5, 1, 1, 'F');
      doc.text(b, bx + 3, y + 0.5);
      bx += bw + 3;
    });
    y += 8;

    sectionHeader('Propósito', '#1e5b8c');
    blockText(s.proposito, '#eef5fb', '#1e5b8c');

    if (s.criterios_evaluables && s.criterios_evaluables.length) {
      sectionHeader('Criterios Evaluables (' + s.criterios_evaluables.length + ')', '#2d7a4f');
      s.criterios_evaluables.forEach((ce, i) => {
        blockText((i + 1) + '.  ' + ce.replace(/X$/, ''), '#f0f8f4', '#2d7a4f');
      });
    }

    if (s.requisitos && s.requisitos.length) {
      sectionHeader('Requisitos de Evaluación (' + s.requisitos.length + ')', '#5c2d7a');
      s.requisitos.forEach((r, i) => {
        blockText('R' + (i + 1) + '.  ' + r.replace(/\n/g, ' '), '#f7f0fd', '#5c2d7a');
      });
    }

    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFontSize(7.5); doc.setTextColor('#9e9890'); doc.setFont('helvetica', 'normal');
      doc.text('Buscador ACSA UGC · ' + s.codigo, ML, 290);
      doc.text('Pág. ' + p + ' / ' + total, 190, 290, { align: 'right' });
    }

    doc.save(s.codigo + '.pdf');
    showToast('📄 PDF descargado: ' + s.codigo + '.pdf');
    /* jshint ignore:end */
  }

  if (window.jspdf) {
    buildAndSave();
  } else {
    showToast('⏳ Cargando generador PDF…');
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload  = buildAndSave;
    script.onerror = () => showToast('❌ No se pudo cargar jsPDF');
    document.head.appendChild(script);
  }
}

/* ── COPY AS TEXT ── */
function copyText(code) {
  const s = STANDARDS.find(x => x.codigo === code);
  if (!s) return;

  const plain = standardToText(s);

  const ceRows = (s.criterios_evaluables || []).map((ce, i) =>
    '<tr><td style="width:24px;font-weight:700;color:#1e5b8c;vertical-align:top;padding:4px 8px 4px 0">' + (i + 1) + '.</td>' +
    '<td style="padding:4px 0;line-height:1.55">' + esc(ce.replace(/X$/, '')) + '</td></tr>'
  ).join('');

  const reqRows = (s.requisitos || []).map((r, i) =>
    '<tr><td style="width:28px;font-weight:700;color:#2d7a4f;vertical-align:top;padding:4px 8px 4px 0">R' + (i + 1) + '.</td>' +
    '<td style="padding:4px 0;line-height:1.55;white-space:pre-wrap">' + esc(r) + '</td></tr>'
  ).join('');

  const fullHtml = [
    '<div style="font-family:Arial,sans-serif;font-size:13px;color:#1a1814;max-width:700px">',
    '<div style="background:#1e5b8c;color:#fff;padding:8px 14px;border-radius:6px 6px 0 0;font-size:11px;font-weight:600;letter-spacing:.5px">MANUAL DE ACREDITACIÓN ACSA · UNIDADES DE GESTIÓN CLÍNICA</div>',
    '<div style="border:1px solid #d8d3c9;border-top:none;padding:16px;border-radius:0 0 6px 6px">',
    '<div style="display:inline-block;background:#d6e8f5;color:#1e5b8c;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;margin-bottom:10px">' + esc(s.codigo) + '</div>',
    '<h2 style="margin:0 0 6px;font-size:15px;color:#1a1814;line-height:1.4">' + esc(s.enunciado) + '</h2>',
    '<p style="margin:0 0 14px;font-size:11px;color:#6b6560">Bloque ' + s.bloque_num + ' · <strong>' + esc(s.bloque_nombre) + '</strong> &nbsp;|&nbsp; C' + s.criterio_num + ' · <strong>' + esc(s.criterio_nombre) + '</strong> &nbsp;|&nbsp; Grupo <strong>' + s.grupo + '</strong> &nbsp;|&nbsp; <strong>' + (s.obligatorio === 'Si' ? '⚠ Obligatorio' : 'No obligatorio') + '</strong> &nbsp;|&nbsp; Circuito: <strong>' + esc(s.circuito || 'Sin circuito') + '</strong> &nbsp;|&nbsp; Rev. ' + s.revision + '</p>',
    '<div style="background:#1e5b8c;color:#fff;font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;padding:5px 10px;border-radius:4px;margin-bottom:6px">Propósito</div>',
    '<p style="margin:0 0 14px;padding:10px;background:#eef5fb;border-left:3px solid #1e5b8c;border-radius:0 4px 4px 0;line-height:1.65;font-size:12.5px">' + esc(s.proposito) + '</p>',
    ceRows ? '<div style="background:#2d7a4f;color:#fff;font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;padding:5px 10px;border-radius:4px;margin-bottom:6px">Criterios Evaluables (' + s.criterios_evaluables.length + ')</div><table style="border-collapse:collapse;width:100%;margin-bottom:14px">' + ceRows + '</table>' : '',
    reqRows ? '<div style="background:#5c2d7a;color:#fff;font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;padding:5px 10px;border-radius:4px;margin-bottom:6px">Requisitos de Evaluación (' + s.requisitos.length + ')</div><table style="border-collapse:collapse;width:100%;margin-bottom:6px">' + reqRows + '</table>' : '',
    '</div></div>',
  ].join('');

  try {
    /* jshint ignore:start */
    const blobHtml  = new Blob([fullHtml], { type: 'text/html' });
    const blobPlain = new Blob([plain],    { type: 'text/plain' });
    navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobPlain })])
      .then(() => showToast('✅ Copiado con formato al portapapeles'))
      .catch(() => {
        navigator.clipboard.writeText(plain)
          .then(() => showToast('✅ Texto copiado al portapapeles'))
          .catch(() => showToast('❌ No se pudo copiar'));
      });
    /* jshint ignore:end */
  } catch(e) {
    navigator.clipboard.writeText(plain)
      .then(() => showToast('✅ Texto copiado al portapapeles'))
      .catch(() => showToast('❌ No se pudo copiar'));
  }
}

/* ── COPY AS PNG ── */
function copyPNG(code) {
  const card = document.querySelector('[data-code="' + code + '"]');
  if (!card) return;

  function doCapture() {
    /* jshint ignore:start */
    const actions = card.querySelector('.card-actions');
    const preview = card.querySelector('.card-preview');
    const prevAct = actions ? actions.style.display : null;
    const prevPre = preview ? preview.style.display : null;
    if (actions) actions.style.display = 'none';
    if (preview) preview.style.display = 'none';

    window.html2canvas(card, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      .then(canvas => {
        if (actions) actions.style.display = prevAct !== null ? prevAct : '';
        if (preview) preview.style.display = prevPre !== null ? prevPre : '';
        canvas.toBlob(blob => {
          if (!blob) { showToast('❌ No se pudo generar la imagen'); return; }
          try {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
              .then(() => showToast('🖼️ Imagen copiada al portapapeles'))
              .catch(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = code + '.png'; a.click(); showToast('🖼️ Imagen descargada como PNG'); });
          } catch(e) {
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = code + '.png'; a.click(); showToast('🖼️ Imagen descargada como PNG');
          }
        }, 'image/png');
      })
      .catch(() => {
        if (actions) actions.style.display = prevAct !== null ? prevAct : '';
        if (preview) preview.style.display = prevPre !== null ? prevPre : '';
        showToast('❌ Error al generar la imagen');
      });
    /* jshint ignore:end */
  }

  if (window.html2canvas) {
    doCapture();
  } else {
    showToast('⏳ Cargando capturador de imagen…');
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload  = doCapture;
    script.onerror = () => showToast('❌ No se pudo cargar html2canvas');
    document.head.appendChild(script);
  }
}

/* ── EVENT DELEGATION ── */
document.getElementById('cardGrid').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (btn) {
    e.stopPropagation();
    const code   = btn.dataset.code;
    const action = btn.dataset.action;
    if      (action === 'close')     { state.expanded = null; render(); }
    else if (action === 'print')     { printCard(code); }
    else if (action === 'pdf')       { downloadPDF(code); }
    else if (action === 'copy-text') { copyText(code); }
    else if (action === 'copy-png')  { copyPNG(code); }
    return;
  }
  const card = e.target.closest('.card');
  if (!card) return;
  const code = card.dataset.code;
  state.expanded = state.expanded === code ? null : code;
  render();
});

/* ── CHIP LOGIC ── */
function bindChips(groupId, stateKey, dataAttr) {
  document.getElementById(groupId).addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#' + groupId + ' .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state[stateKey] = chip.dataset[dataAttr];
    state.expanded  = null;
    render();
  });
}

/* ── SEARCH ── */
function doSearch() {
  state.search   = document.getElementById('searchInput').value.trim();
  state.expanded = null;
  render();
}

// Desktop: fire on every keystroke
document.getElementById('searchInput').addEventListener('input', doSearch);

// Mobile: fire on button tap
document.getElementById('searchBtn').addEventListener('click', doSearch);

// Also fire on Enter key in the input (any device)
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
});

/* ── SORT ── */
document.getElementById('sortSel').addEventListener('change', e => {
  state.sort = e.target.value;
  render();
});

/* ── RESET ── */
document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(state, { search: '', bloque: 'all', criterio: 'all', grupo: 'all', oblig: 'all', circ: 'all', sort: 'default', expanded: null });
  document.getElementById('searchInput').value = '';
  document.getElementById('sortSel').value = 'default';
  document.getElementById('searchInput').blur();
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.chip[data-bloque="all"],.chip[data-criterio="all"],.chip[data-grupo="all"],.chip[data-oblig="all"],.chip[data-circ="all"]')
          .forEach(c => c.classList.add('active'));
  render();
});

/* ── SCROLL TO TOP ── */
const scrollBtn = document.getElementById('scrollTop');

window.addEventListener('scroll', () => {
  scrollBtn.classList.toggle('visible', window.scrollY > 300);
});
document.querySelector('main').addEventListener('scroll', () => {
  scrollBtn.classList.toggle('visible', document.querySelector('main').scrollTop > 300);
});

scrollBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── DRAWER ── */
const drawer   = document.getElementById('filterDrawer');
const overlay  = document.getElementById('drawerOverlay');
const fab      = document.getElementById('filterFab');
const closeBtn = document.getElementById('drawerClose');

function openDrawer() {
  drawer.classList.add('drawer-open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  drawer.classList.remove('drawer-open');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

fab.addEventListener('click', openDrawer);
overlay.addEventListener('click', closeDrawer);
closeBtn.addEventListener('click', closeDrawer);

/* Close drawer when a chip or reset is tapped */
drawer.addEventListener('click', e => {
  if (e.target.closest('.chip') || e.target.closest('.btn-reset')) {
    setTimeout(closeDrawer, 180);
  }
});

/* Show/hide close button inside drawer (CSS hides it on desktop) */
function syncCloseBtn() {
  closeBtn.style.display = window.innerWidth <= 960 ? 'block' : 'none';
}
window.addEventListener('resize', syncCloseBtn);
syncCloseBtn();

/* ── BADGE ── */
function updateBadge() {
  const badge = document.getElementById('fabBadge');
  if (!badge) return;
  const active = ['bloque','criterio','grupo','oblig','circ']
    .filter(k => state[k] !== 'all').length + (state.search ? 1 : 0);
  badge.textContent = active;
  badge.classList.toggle('visible', active > 0);
  fab.style.background = active > 0 ? '#16446a' : '';
}

/* ── INIT ── */
bindChips('bloqueChips',   'bloque',   'bloque');
bindChips('criterioChips', 'criterio', 'criterio');
bindChips('grupoChips',    'grupo',    'grupo');
bindChips('obligChips',    'oblig',    'oblig');
bindChips('circuitoChips', 'circ',     'circ');

document.getElementById('stat-total').textContent = STANDARDS.length;

render();
/* ═══════════════════════════════════════════════════════════════
   ESTADOS POR UGC — integración Firebase
   ═══════════════════════════════════════════════════════════════ */

/* jshint esversion: 8 */
/* global firebase, UGCS */

const _fbConfig = {
  apiKey:            "AIzaSyCb--Ep4Z1SGvCLALoOdWY6qLJN4FWirBM",
  authDomain:        "acsa-ugc-sur-cordoba.firebaseapp.com",
  projectId:         "acsa-ugc-sur-cordoba",
  storageBucket:     "acsa-ugc-sur-cordoba.firebasestorage.app",
  messagingSenderId: "1029063446265",
  appId:             "1:1029063446265:web:096446d58020bed6575c28"
};

let _db   = null;
let _auth = null;

function _initFB() {
  if (_db) return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(_fbConfig);
    _db   = firebase.firestore();
    _auth = firebase.auth();
  } catch (e) { /* Firebase no disponible */ }
}

async function cargarEstadosUGC(codigo) {
  _initFB();
  const container = document.getElementById('ugc-status-' + codigo);
  if (!container) return;

  if (!_db) {
    container.innerHTML = '<span class="ugc-status-msg">Firebase no disponible</span>';
    return;
  }

  const user = _auth ? _auth.currentUser : null;
  if (!user) {
    container.innerHTML = '<span class="ugc-status-msg">Inicia sesión en Mentoría para ver el estado por UGC</span>';
    return;
  }

  container.innerHTML = '<span class="ugc-status-loading">Consultando…</span>';

  try {
    const promises = UGCS.map(u =>
      _db.collection('ugcs').doc(u.id).collection('estandares').doc(codigo).get()
        .then(snap => ({ ugc: u, data: snap.exists ? snap.data() : null }))
        .catch(() => ({ ugc: u, data: null }))
    );

    const resultados = await Promise.all(promises);
    const conEstado  = resultados.filter(r =>
      r.data && (r.data.estado === 'cumple' || r.data.estado === 'propuesto')
    );

    if (!conEstado.length) {
      container.innerHTML = '<span class="ugc-status-msg">Ninguna UGC ha propuesto o acreditado este estándar todavía</span>';
      return;
    }

    const badges = conEstado.map(r => {
      const esCumple = r.data.estado === 'cumple';
      const cls      = esCumple ? 'ugc-badge-cumple' : 'ugc-badge-propuesto';
      const emoji    = esCumple ? '✅' : '⏳';
      const nombre   = r.ugc.denominacion.replace(/^UGC\s+/i, '');
      const url      = '../index.html?ugc=' + encodeURIComponent(r.ugc.id) +
                       '&std=' + encodeURIComponent(codigo) + '&desde=buscador';
      return '<a href="' + url + '" class="ugc-est-badge ' + cls + '" title="Ver evidencias en Mentoría">' +
             emoji + ' ' + nombre + '</a>';
    }).join('');

    container.innerHTML = '<div class="ugc-badges-row">' + badges + '</div>';
  } catch (err) {
    container.innerHTML = '<span class="ugc-status-msg">No disponible (' + err.message + ')</span>';
  }
}
