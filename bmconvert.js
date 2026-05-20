const state = {
  file: null,
  parsed: null,
  assetUrls: [],
  renderToken: 0,
  assetRenderToken: 0,
};

const els = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  printBtn: document.getElementById('printBtn'),
  clearBtn: document.getElementById('clearBtn'),
  stats: document.getElementById('stats'),
  boardTitle: document.getElementById('boardTitle'),
  sheetMeta: document.getElementById('sheetMeta'),
  detailGrid: document.getElementById('detailGrid'),
  assetGrid: document.getElementById('assetGrid'),
  pagePanel: document.getElementById('pagePanel'),
  pageGrid: document.getElementById('pageGrid'),
  stringList: document.getElementById('stringList'),
  summaryStack: document.getElementById('summaryStack'),
};

const LABELS = new Set([
  'Root',
  'Media',
  'New Page',
  'Target',
  'CreatedWith',
  'CreatedAt',
  'CreatedBy',
  'ModifiedAt',
  'ModifiedBy',
  'ModifiedWith',
  'ProjectFileType',
  'ContentType',
  'Project',
  'Print',
]);

init();

function init() {
  els.fileInput.addEventListener('change', onFileInput);
  els.printBtn.addEventListener('click', () => window.print());
  els.clearBtn.addEventListener('click', clearState);
  els.assetGrid.addEventListener('click', onAssetGridClick);
  els.pageGrid.addEventListener('click', onPageGridClick);

  setupDropZone();
  renderEmpty();
}

function setupDropZone() {
  const highlight = (on) => els.dropZone.classList.toggle('is-over', on);

  ['dragenter', 'dragover'].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      highlight(true);
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      highlight(false);
    });
  });

  els.dropZone.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await loadFile(file);
    }
  });
}

async function onFileInput(event) {
  const file = event.target.files?.[0];
  if (file) {
    await loadFile(file);
  }
}

async function loadFile(file) {
  clearAssets();
  state.file = file;

  const buffer = await file.arrayBuffer();
  state.parsed = parseBoardmaker(buffer, file.name);
  renderParsed(state.parsed);

  els.printBtn.disabled = false;
  els.clearBtn.disabled = false;
}

function clearState() {
  clearAssets();
  state.file = null;
  state.parsed = null;
  els.fileInput.value = '';
  els.printBtn.disabled = true;
  els.clearBtn.disabled = true;
  renderEmpty();
}

function clearAssets() {
  for (const url of state.assetUrls) {
    URL.revokeObjectURL(url);
  }
  state.assetUrls = [];
}

function renderEmpty() {
  els.boardTitle.textContent = 'Load a Boardmaker file';
  els.sheetMeta.innerHTML = '<div>Waiting for a .bpf or .bm2 upload.</div>';
  els.detailGrid.innerHTML = '<div class="empty-state">No file loaded yet.</div>';
  els.assetGrid.innerHTML = '<div class="empty-state">Embedded images will appear here.</div>';
  els.pagePanel.hidden = true;
  els.pageGrid.innerHTML = '';
  els.stringList.innerHTML = '<div class="empty-state">Visible strings will appear here.</div>';
  els.summaryStack.innerHTML = '<div class="empty-state">No summary yet.</div>';
  els.stats.innerHTML = '';
}

function renderParsed(parsed) {
  const title = parsed.title || stripExt(parsed.name);
  els.boardTitle.textContent = title;
  els.sheetMeta.innerHTML = [
    '<div><strong>File:</strong> ' + escapeHtml(parsed.name) + '</div>',
    '<div><strong>Size:</strong> ' + formatBytes(parsed.size) + '</div>',
    '<div><strong>Images:</strong> ' + parsed.images.length + '</div>',
    '<div><strong>Strings:</strong> ' + parsed.visibleStrings.length + '</div>',
  ].join('');

  els.stats.innerHTML = [
    statCard('Format', parsed.formatName),
    statCard('Project', parsed.metadata.ProjectFileType || 'Unknown'),
    statCard('Content', parsed.metadata.ContentType || 'Unknown'),
    statCard('Created', parsed.metadata.CreatedAt || 'Unknown'),
  ].join('');

  els.detailGrid.innerHTML = buildDetails(parsed);
  els.assetGrid.innerHTML = buildAssets(parsed);
  renderAssetPreviews(parsed);
  els.stringList.innerHTML = buildStringList(parsed.visibleStrings);
  els.summaryStack.innerHTML = buildSummary(parsed);
  if (parsed.pages?.length) {
    els.pagePanel.hidden = false;
    renderBm2Pages(parsed);
  } else {
    els.pagePanel.hidden = true;
    els.pageGrid.innerHTML = '';
  }
}

function onAssetGridClick(event) {
  const button = event.target.closest('[data-asset-index]');
  if (!button || !state.parsed) {
    return;
  }

  const index = Number(button.getAttribute('data-asset-index'));
  const asset = state.parsed.images[index];
  if (asset) {
    const canvas = button.closest('.asset')?.querySelector('canvas');
    if (asset.mimeType === 'image/x-emf' && canvas) {
      downloadCanvasPdf(
        canvas,
        (state.parsed.title || stripExt(state.parsed.name)) + '-asset-' + (index + 1) + '.pdf',
      );
      return;
    }

    downloadAssetPdf(asset, state.parsed.title || stripExt(state.parsed.name), index + 1);
  }
}

function onPageGridClick(event) {
  const button = event.target.closest('[data-page-index]');
  if (!button || !state.parsed) {
    return;
  }

  const index = Number(button.getAttribute('data-page-index'));
  const page = state.parsed.pages?.[index];
  if (!page) {
    return;
  }

  const canvas = button.closest('.page-preview')?.querySelector('canvas');
  if (!canvas) {
    return;
  }

  downloadCanvasPdf(
    canvas,
    (state.parsed.title || stripExt(state.parsed.name)) + '-bm2-page-' + page.index + '.pdf',
  );
}

function parseBoardmaker(buffer, name) {
  const bytes = new Uint8Array(buffer);
  const ext = getFileExtension(name);

  if (ext === 'bm2') {
    return parseBm2(bytes, name);
  }

  const utf16 = [...extractUtf16Strings(bytes, 0), ...extractUtf16Strings(bytes, 1)]
    .sort((a, b) => a.offset - b.offset);

  const metadata = extractMetadata(utf16);
  const images = extractEmbeddedAssets(bytes);
  const visibleStrings = buildVisibleStrings(utf16);
  const title =
    metadata.BoardTitle ||
    metadata.DocumentTitle ||
    metadata.NewPage ||
    stripExt(name);

  return {
    name,
    size: bytes.length,
    title,
    formatName: 'Boardmaker BPF',
    metadata,
    images,
    visibleStrings,
    pages: [],
  };
}

function parseBm2(bytes, name) {
  const pages = extractEmfSegments(bytes);
  const visibleStrings = buildBm2VisibleStrings(bytes);
  const title =
    visibleStrings.find((text) => !['go back', 'next'].includes(text.toLowerCase())) ||
    stripExt(name);

  return {
    name,
    size: bytes.length,
    title,
    formatName: 'Boardmaker BM2',
    metadata: {
      Pages: String(pages.length),
      Container: 'Boardmaker BM2',
    },
    images: [],
    visibleStrings,
    pages,
  };
}

function extractUtf16Strings(bytes, start, minChars = 2) {
  const out = [];
  let i = start;
  let current = [];
  let offset = null;

  while (i + 1 < bytes.length) {
    const ch = bytes[i];
    const nul = bytes[i + 1];
    if (ch >= 32 && ch <= 126 && nul === 0) {
      if (offset === null) {
        offset = i;
      }
      current.push(String.fromCharCode(ch));
    } else {
      if (offset !== null && current.length >= minChars) {
        out.push({ text: current.join(''), offset });
      }
      current = [];
      offset = null;
    }
    i += 2;
  }

  if (offset !== null && current.length >= minChars) {
    out.push({ text: current.join(''), offset });
  }

  return out;
}

function extractMetadata(strings) {
  const metadata = {};
  for (let i = 0; i < strings.length; i += 1) {
    const item = strings[i];
    if (!LABELS.has(item.text)) {
      continue;
    }

    const next = findNextValue(strings, i + 1, item.offset + 220);
    if (next) {
      metadata[item.text] = next.text;
    }
  }

  return metadata;
}

function findNextValue(strings, startIndex, maxOffset) {
  for (let i = startIndex; i < strings.length; i += 1) {
    const candidate = strings[i];
    if (candidate.offset > maxOffset) {
      break;
    }
    if (!LABELS.has(candidate.text) && candidate.text.length > 0) {
      return candidate;
    }
  }
  return null;
}

function buildVisibleStrings(strings) {
  const skip = new Set([
    'Root',
    'Media',
    'New Page',
    'Target',
    'CreatedWith',
    'CreatedAt',
    'CreatedBy',
    'ModifiedAt',
    'ModifiedBy',
    'ModifiedWith',
    'ProjectFileType',
    'ContentType',
    'Project',
    'Print',
  ]);

  return strings
    .map((item) => item.text)
    .filter((text, index, array) => {
      if (skip.has(text)) {
        return false;
      }
      return array.indexOf(text) === index;
    })
    .slice(0, 48);
}

function buildBm2VisibleStrings(bytes) {
  const rawStrings = extractAsciiStrings(bytes)
    .filter((text) => text.length >= 3)
    .filter((text) => !/^arial$/i.test(text))
    .filter((text) => !/^emf$/i.test(text))
    .filter((text) => !/^\s+$/.test(text));

  return [...new Set(rawStrings)].slice(0, 48);
}

function extractAsciiStrings(bytes, minChars = 3) {
  const out = [];
  let current = '';

  for (let i = 0; i < bytes.length; i += 1) {
    const ch = bytes[i];
    if (ch >= 32 && ch <= 126) {
      current += String.fromCharCode(ch);
    } else {
      if (current.length >= minChars) {
        out.push(current);
      }
      current = '';
    }
  }

  if (current.length >= minChars) {
    out.push(current);
  }

  return out;
}

function extractEmfSegments(bytes) {
  const segments = [];
  let searchAt = 0;

  while (searchAt < bytes.length - 8) {
    const start = findMarker(bytes, [0x01, 0x00, 0x00, 0x00, 0x58, 0x00, 0x00, 0x00], searchAt);
    if (start === -1 || start + 88 > bytes.length) {
      break;
    }

    const signatureOffset = start + 40;
    if (
      bytes[signatureOffset] !== 0x20 ||
      bytes[signatureOffset + 1] !== 0x45 ||
      bytes[signatureOffset + 2] !== 0x4d ||
      bytes[signatureOffset + 3] !== 0x46
    ) {
      searchAt = start + 8;
      continue;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset + start, Math.min(bytes.length - start, 108));
    const totalBytes = view.getUint32(48, true);
    const records = view.getUint32(52, true);
    const bounds = {
      left: view.getInt32(8, true),
      top: view.getInt32(12, true),
      right: view.getInt32(16, true),
      bottom: view.getInt32(20, true),
    };
    const device = {
      width: view.getInt32(72, true),
      height: view.getInt32(76, true),
    };

    if (totalBytes < 88 || start + totalBytes > bytes.length + 4) {
      searchAt = start + 8;
      continue;
    }

    const segmentBytes = bytes.slice(start, Math.min(bytes.length, start + totalBytes));
    segments.push({
      index: segments.length + 1,
      start,
      end: start + segmentBytes.length,
      size: segmentBytes.length,
      bounds,
      device,
      records,
      labels: extractBm2Labels(bytes, start, start + segmentBytes.length),
      blob: new Blob([segmentBytes], { type: 'image/x-emf' }),
    });

    searchAt = start + totalBytes;
  }

  return segments;
}

function extractBm2Labels(bytes, start, end) {
  const windowStart = Math.max(0, start - 900);
  const windowEnd = Math.min(bytes.length, end + 900);
  const windowBytes = bytes.slice(windowStart, windowEnd);

  return [...new Set(extractAsciiStrings(windowBytes, 3))]
    .map((text) => text.trim())
    .filter((text) => text.length >= 3)
    .filter((text) => !/^arial$/i.test(text))
    .filter((text) => !/^emf$/i.test(text))
    .filter((text) => !/^[0-9]+$/.test(text))
    .slice(0, 12);
}

async function renderBm2Pages(parsed) {
  const token = ++state.renderToken;
  els.pageGrid.innerHTML = '';

  if (!parsed.pages.length) {
    els.pageGrid.innerHTML = '<div class="empty-state">No EMF page drawings were detected in this .bm2 file.</div>';
    return;
  }

  if (!window.WMFConverter) {
    els.pageGrid.innerHTML = '<div class="empty-state">EMF rendering library failed to load.</div>';
    return;
  }

  const converter = new window.WMFConverter();

  for (const page of parsed.pages) {
    if (token !== state.renderToken) {
      return;
    }

    const figure = document.createElement('figure');
    figure.className = 'page-preview';
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(page.device.width || 800));
    canvas.height = Math.max(1, Math.round(page.device.height || 600));
    const caption = document.createElement('div');
    caption.className = 'page-caption';
    caption.textContent = 'EMF ' + page.index + ' · ' + formatBytes(page.size) + ' · records ' + page.records;
    const actions = document.createElement('div');
    actions.className = 'page-actions';
    const saveButton = document.createElement('button');
    saveButton.className = 'page-button';
    saveButton.type = 'button';
    saveButton.setAttribute('data-page-index', String(page.index - 1));
    saveButton.textContent = 'Save as PDF';
    actions.appendChild(saveButton);
    const note = document.createElement('div');
    note.className = 'page-note';
    note.textContent = 'Rendering...';

    figure.appendChild(actions);
    figure.appendChild(caption);
    figure.appendChild(canvas);
    figure.appendChild(note);
    els.pageGrid.appendChild(figure);

    try {
      await renderEmfSegment(converter, page.blob, canvas);
      if (isCanvasBlank(canvas)) {
        drawBm2Fallback(canvas, page, parsed);
        note.textContent = 'Fallback text preview';
      } else {
        note.textContent = 'Ready to print';
      }
    } catch (error) {
      drawBm2Fallback(canvas, page, parsed);
      note.textContent = 'Could not render this page drawing.';
      console.error(error);
    }
  }
}

function renderEmfSegment(converter, blob, canvas) {
  return new Promise((resolve, reject) => {
    const file = new File([blob], 'segment.emf', { type: 'image/x-emf' });
    try {
      converter.toCanvas(file, canvas, () => resolve());
    } catch (error) {
      reject(error);
    }
  });
}

function isCanvasBlank(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return true;
  }

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255)) {
      return false;
    }
  }
  return true;
}

function drawBm2Fallback(canvas, page, parsed) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = Math.max(2, Math.round(width / 220));
  ctx.strokeRect(1, 1, width - 2, height - 2);

  const title = parsed.title || 'BM2 page';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + Math.max(24, Math.round(width / 18)) + 'px Avenir Next, Segoe UI, sans-serif';
  ctx.fillText(title, width / 2, Math.round(height * 0.12));

  ctx.font = Math.max(14, Math.round(width / 40)) + 'px Avenir Next, Segoe UI, sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.fillText('Fallback preview from extracted BM2 text', width / 2, Math.round(height * 0.18));

  const labels = page.labels?.length ? page.labels : parsed.visibleStrings.slice(0, 6);
  const chips = labels.length ? labels : ['BM2 content detected'];
  const top = Math.round(height * 0.32);
  const chipHeight = Math.max(44, Math.round(height / 9));
  const gap = Math.max(10, Math.round(width / 40));
  const chipWidth = Math.max(120, Math.min(Math.round(width * 0.72), width - 40));
  const x = Math.round((width - chipWidth) / 2);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = Math.max(16, Math.round(width / 28)) + 'px Avenir Next, Segoe UI, sans-serif';

  chips.slice(0, 5).forEach((text, index) => {
    const y = top + index * (chipHeight + gap);
    roundRect(ctx, x, y, chipWidth, chipHeight, 14);
    ctx.fillStyle = '#f3f4f6';
    ctx.fill();
    ctx.strokeStyle = '#d1d5db';
    ctx.stroke();
    ctx.fillStyle = '#152033';
    ctx.fillText(text, width / 2, y + chipHeight / 2);
  });

  ctx.fillStyle = '#6b7280';
  ctx.font = Math.max(12, Math.round(width / 48)) + 'px Avenir Next, Segoe UI, sans-serif';
  ctx.fillText('EMF page ' + page.index + ' · ' + page.records + ' records', width / 2, Math.round(height * 0.9));
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function downloadCanvasPdf(canvas, filename) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) {
    alert('PDF export library failed to load.');
    return;
  }

  const dataUrl = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [canvas.width, canvas.height],
    compress: true,
  });

  pdf.addImage(dataUrl, 'PNG', 0, 0, canvas.width, canvas.height, undefined, 'FAST');
  pdf.save(sanitizeFilename(filename));
}

function extractEmbeddedAssets(bytes) {
  const images = [];
  const candidates = [];

  collectJpegs(bytes, candidates);
  collectPngs(bytes, candidates);
  collectGifs(bytes, candidates);
  collectBmps(bytes, candidates);
  collectWebps(bytes, candidates);
  collectEmfs(bytes, candidates);

  let lastEnd = -1;
  candidates
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((candidate) => {
      if (candidate.end <= candidate.start) {
        return false;
      }
      if (candidate.start < lastEnd) {
        return false;
      }
      lastEnd = candidate.end;
      return true;
    })
    .forEach((candidate, index) => {
      const blob = new Blob([candidate.bytes], { type: candidate.mimeType });
      const url = URL.createObjectURL(blob);
      state.assetUrls.push(url);
      images.push({
        index: index + 1,
        kind: candidate.kind,
        mimeType: candidate.mimeType,
        start: candidate.start,
        end: candidate.end,
        size: candidate.bytes.length,
        blob,
        bytes: candidate.bytes,
        url,
      });
    });

  return images;
}

function collectJpegs(bytes, out) {
  let offset = 0;

  while (offset < bytes.length - 1) {
    const soi = findMarker(bytes, [0xff, 0xd8], offset);
    if (soi === -1) {
      return;
    }

    const eoi = findMarker(bytes, [0xff, 0xd9], soi + 2);
    if (eoi === -1) {
      offset = soi + 2;
      continue;
    }

    const jpegBytes = bytes.slice(soi, eoi + 2);
    const dims = readJpegDimensions(jpegBytes);
    if (dims && jpegBytes.length > 256) {
      out.push({
        kind: 'JPEG',
        mimeType: 'image/jpeg',
        start: soi,
        end: eoi + 2,
        bytes: jpegBytes,
      });
    }

    offset = eoi + 2;
  }
}

function collectPngs(bytes, out) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  let offset = 0;

  while (offset < bytes.length - signature.length) {
    const start = findMarker(bytes, signature, offset);
    if (start === -1) {
      return;
    }

    const end = findPngEnd(bytes, start);
    if (end > start) {
      out.push({
        kind: 'PNG',
        mimeType: 'image/png',
        start,
        end,
        bytes: bytes.slice(start, end),
      });
      offset = end;
      continue;
    }

    offset = start + 1;
  }
}

function collectGifs(bytes, out) {
  const signatures = [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ];
  let offset = 0;

  while (offset < bytes.length - 6) {
    let start = -1;
    for (const signature of signatures) {
      start = findMarker(bytes, signature, offset);
      if (start !== -1) {
        break;
      }
    }
    if (start === -1) {
      return;
    }

    const end = findMarker(bytes, [0x3b], start + 6);
    if (end !== -1 && end > start + 10) {
      out.push({
        kind: 'GIF',
        mimeType: 'image/gif',
        start,
        end: end + 1,
        bytes: bytes.slice(start, end + 1),
      });
      offset = end + 1;
      continue;
    }

    offset = start + 1;
  }
}

function collectBmps(bytes, out) {
  let offset = 0;

  while (offset < bytes.length - 2) {
    const start = findMarker(bytes, [0x42, 0x4d], offset);
    if (start === -1) {
      return;
    }

    if (start + 6 > bytes.length) {
      return;
    }

    const size = readUint32Le(bytes, start + 2);
    if (size > 0 && start + size <= bytes.length) {
      const slice = bytes.slice(start, start + size);
      out.push({
        kind: 'BMP',
        mimeType: 'image/bmp',
        start,
        end: start + size,
        bytes: slice,
      });
      offset = start + size;
      continue;
    }

    offset = start + 2;
  }
}

function collectWebps(bytes, out) {
  let offset = 0;

  while (offset < bytes.length - 12) {
    const start = findMarker(bytes, [0x52, 0x49, 0x46, 0x46], offset);
    if (start === -1) {
      return;
    }

    if (
      start + 12 <= bytes.length &&
      bytes[start + 8] === 0x57 &&
      bytes[start + 9] === 0x45 &&
      bytes[start + 10] === 0x42 &&
      bytes[start + 11] === 0x50
    ) {
      const size = readUint32Le(bytes, start + 4);
      const end = size > 0 ? start + 8 + size : -1;
      if (end > start + 12 && end <= bytes.length) {
        out.push({
          kind: 'WEBP',
          mimeType: 'image/webp',
          start,
          end,
          bytes: bytes.slice(start, end),
        });
        offset = end;
        continue;
      }
    }

    offset = start + 4;
  }
}

function collectEmfs(bytes, out) {
  let offset = 0;

  while (offset < bytes.length - 88) {
    const start = findMarker(bytes, [0x01, 0x00, 0x00, 0x00, 0x58, 0x00, 0x00, 0x00], offset);
    if (start === -1 || start + 88 > bytes.length) {
      return;
    }

    const signatureOffset = start + 40;
    if (
      bytes[signatureOffset] !== 0x20 ||
      bytes[signatureOffset + 1] !== 0x45 ||
      bytes[signatureOffset + 2] !== 0x4d ||
      bytes[signatureOffset + 3] !== 0x46
    ) {
      offset = start + 8;
      continue;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset + start, Math.min(bytes.length - start, 108));
    const totalBytes = view.getUint32(48, true);
    if (totalBytes < 88 || start + totalBytes > bytes.length + 4) {
      offset = start + 8;
      continue;
    }

    out.push({
      kind: 'EMF',
      mimeType: 'image/x-emf',
      start,
      end: start + Math.min(bytes.length - start, totalBytes),
      bytes: bytes.slice(start, Math.min(bytes.length, start + totalBytes)),
    });

    offset = start + totalBytes;
  }
}

function findPngEnd(bytes, start) {
  let offset = start + 8;

  while (offset + 12 <= bytes.length) {
    const length = readUint32Be(bytes, offset);
    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) {
      return -1;
    }
    if (chunkType === 'IEND') {
      return chunkEnd;
    }
    offset = chunkEnd;
  }

  return -1;
}

function readUint32Le(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUint32Be(bytes, offset) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function findMarker(bytes, marker, start) {
  for (let i = start; i < bytes.length - marker.length + 1; i += 1) {
    let match = true;
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }
  return -1;
}

function buildDetails(parsed) {
  const rows = [
    ['File type', parsed.formatName],
    ['Title', parsed.title],
    ['Project file', parsed.metadata.ProjectFileType || 'Unknown'],
    ['Content type', parsed.metadata.ContentType || 'Unknown'],
    ['Target', parsed.metadata.Target || 'Unknown'],
    ['Created with', parsed.metadata.CreatedWith || 'Unknown'],
    ['Created at', parsed.metadata.CreatedAt || 'Unknown'],
    ['Created by', parsed.metadata.CreatedBy || 'Unknown'],
    ['Modified with', parsed.metadata.ModifiedWith || 'Unknown'],
    ['Modified at', parsed.metadata.ModifiedAt || 'Unknown'],
    ['Modified by', parsed.metadata.ModifiedBy || 'Unknown'],
    ['Source file', parsed.metadata.Boardmaker_File_bpf || parsed.name],
  ];

  return rows
    .map(
      ([label, value]) => [
        '<div class="detail">',
        '<span class="detail-label">' + escapeHtml(label) + '</span>',
        '<div class="detail-value">' + escapeHtml(value || 'Unknown') + '</div>',
        '</div>',
      ].join(''),
    )
    .join('');
}

function buildAssets(parsed) {
  if (!parsed.images.length) {
    return '<div class="empty-state">No embedded assets were found in this file.</div>';
  }

  return parsed.images
    .map(
      (asset) => [
        '<figure class="asset">',
        asset.mimeType === 'image/x-emf'
          ? '<canvas class="asset-canvas" data-asset-index="' + (asset.index - 1) + '" width="640" height="480"></canvas>'
          : '<img src="' + asset.url + '" alt="Embedded asset ' + asset.index + '" />',
        '<div class="asset-actions">',
        '<button class="asset-button" type="button" data-asset-index="' + (asset.index - 1) + '">Save as PDF</button>',
        '<span class="asset-caption">' +
          escapeHtml(asset.kind || 'Asset') +
          ' ' +
          asset.index +
          ' · ' +
          formatBytes(asset.size) +
          ' · bytes ' +
          asset.start +
          ' to ' +
          asset.end +
          '</span>',
        '</div>',
        asset.mimeType === 'image/x-emf' ? '<div class="asset-note">Rendering preview...</div>' : '',
        '</figure>',
      ].join(''),
    )
    .join('');
}

async function renderAssetPreviews(parsed) {
  const token = ++state.assetRenderToken;
  const vectorAssets = parsed.images.filter((asset) => asset.mimeType === 'image/x-emf');
  if (!vectorAssets.length) {
    return;
  }

  if (!window.WMFConverter) {
    for (const asset of vectorAssets) {
      const canvas = els.assetGrid.querySelector('canvas[data-asset-index="' + (asset.index - 1) + '"]');
      if (canvas) {
        drawAssetFallback(canvas, asset, parsed, 'EMF rendering library failed to load.');
      }
    }
    return;
  }

  const converter = new window.WMFConverter();
  for (const asset of vectorAssets) {
    if (token !== state.assetRenderToken) {
      return;
    }

    const canvas = els.assetGrid.querySelector('canvas[data-asset-index="' + (asset.index - 1) + '"]');
    if (!canvas) {
      continue;
    }

    const note = canvas.closest('.asset')?.querySelector('.asset-note');
    try {
      const file = new File([asset.blob], 'asset.emf', { type: asset.mimeType });
      await new Promise((resolve, reject) => {
        try {
          converter.toCanvas(file, canvas, () => resolve());
        } catch (error) {
          reject(error);
        }
      });

      if (isCanvasBlank(canvas)) {
        drawAssetFallback(canvas, asset, parsed, 'This asset rendered blank.');
        if (note) note.textContent = 'Fallback preview';
      } else if (note) {
        note.textContent = 'Ready to preview';
      }
    } catch (error) {
      drawAssetFallback(canvas, asset, parsed, 'Could not render this asset.');
      if (note) note.textContent = 'Could not render';
      console.error(error);
    }
  }
}

function buildStringList(strings) {
  if (!strings.length) {
    return '<div class="empty-state">No readable strings were detected.</div>';
  }

  return strings
    .map((text) => '<span class="string-pill">' + escapeHtml(text) + '</span>')
    .join('');
}

function buildSummary(parsed) {
  const entries = [
    ['Boardmaker metadata', Object.keys(parsed.metadata).length + ' fields'],
    ['Visible strings', parsed.visibleStrings.length + ' fragments'],
    ['Embedded assets', parsed.images.length + ' files'],
    ['BM2 pages', parsed.pages?.length || 0],
    ['Print mode', 'Browser print / Save as PDF'],
  ];

  return entries
    .map(
      ([label, value]) => [
        '<div class="summary-item">',
        '<strong>' + escapeHtml(label) + '</strong>',
        '<div>' + escapeHtml(value) + '</div>',
        '</div>',
      ].join(''),
    )
    .join('');
}

function statCard(label, value) {
  return [
    '<div class="stat">',
    '<span class="stat-label">' + escapeHtml(label) + '</span>',
    '<div class="stat-value">' + escapeHtml(value) + '</div>',
    '</div>',
  ].join('');
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

function getFileExtension(name) {
  const match = String(name).match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function downloadAssetPdf(asset, boardTitle, assetNumber) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) {
    alert('PDF export library failed to load.');
    return;
  }

  const dataUrl = await blobToDataUrl(asset.blob);
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  const dims =
    readJpegDimensions(bytes) ||
    readPngDimensions(bytes) ||
    readGifDimensions(bytes) ||
    readBmpDimensions(bytes) ||
    readWebpDimensions(bytes) ||
    { width: 384, height: 512 };
  const pageWidth = 576;
  const pageHeight = 768;
  const margin = 16;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
  const drawWidth = Math.max(1, dims.width * scale);
  const drawHeight = Math.max(1, dims.height * scale);
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;

  const pdf = new jsPDF({
    orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pageWidth, pageHeight],
    compress: true,
  });

  pdf.addImage(dataUrl, assetToPdfFormat(asset), x, y, drawWidth, drawHeight, undefined, 'FAST');
  pdf.save(sanitizeFilename(boardTitle) + '-asset-' + assetNumber + '.pdf');
}

function drawAssetFallback(canvas, asset, parsed, message) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = Math.max(2, Math.round(width / 260));
  ctx.strokeRect(1, 1, width - 2, height - 2);

  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + Math.max(18, Math.round(width / 20)) + 'px Avenir Next, Segoe UI, sans-serif';
  ctx.fillText(asset.kind + ' asset', width / 2, Math.round(height * 0.18));

  ctx.font = Math.max(12, Math.round(width / 40)) + 'px Avenir Next, Segoe UI, sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.fillText(message, width / 2, Math.round(height * 0.28));

  const labels = (parsed.visibleStrings || []).slice(0, 4);
  const chips = [asset.kind, ...labels].filter(Boolean).slice(0, 5);
  const top = Math.round(height * 0.4);
  const chipHeight = Math.max(34, Math.round(height / 12));
  const gap = Math.max(8, Math.round(width / 48));
  const chipWidth = Math.max(120, Math.min(Math.round(width * 0.74), width - 30));
  const x = Math.round((width - chipWidth) / 2);

  ctx.font = Math.max(13, Math.round(width / 32)) + 'px Avenir Next, Segoe UI, sans-serif';
  chips.forEach((text, index) => {
    const y = top + index * (chipHeight + gap);
    roundRect(ctx, x, y, chipWidth, chipHeight, 12);
    ctx.fillStyle = '#f3f4f6';
    ctx.fill();
    ctx.strokeStyle = '#d1d5db';
    ctx.stroke();
    ctx.fillStyle = '#152033';
    ctx.fillText(text, width / 2, y + chipHeight / 2);
  });

  ctx.fillStyle = '#6b7280';
  ctx.font = Math.max(11, Math.round(width / 50)) + 'px Avenir Next, Segoe UI, sans-serif';
  ctx.fillText('Asset ' + asset.index + ' · ' + formatBytes(asset.size), width / 2, Math.round(height * 0.92));
}

function assetToPdfFormat(asset) {
  switch (asset.mimeType) {
    case 'image/png':
      return 'PNG';
    case 'image/gif':
      return 'GIF';
    case 'image/webp':
      return 'WEBP';
    case 'image/bmp':
      return 'BMP';
    default:
      return 'JPEG';
  }
}

function readPngDimensions(bytes) {
  if (bytes.length < 24) {
    return null;
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) {
      return null;
    }
  }

  return {
    width: readUint32Be(bytes, 16),
    height: readUint32Be(bytes, 20),
  };
}

function readGifDimensions(bytes) {
  if (bytes.length < 10) {
    return null;
  }
  const header = String.fromCharCode(...bytes.slice(0, 6));
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return null;
  }
  return {
    width: bytes[6] | (bytes[7] << 8),
    height: bytes[8] | (bytes[9] << 8),
  };
}

function readBmpDimensions(bytes) {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null;
  }
  return {
    width: Math.abs(bytes[18] | (bytes[19] << 8) | (bytes[20] << 16) | (bytes[21] << 24)),
    height: Math.abs(bytes[22] | (bytes[23] << 8) | (bytes[24] << 16) | (bytes[25] << 24)),
  };
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30) {
    return null;
  }
  if (
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
  ) {
    return null;
  }

  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes[26] | (bytes[27] << 8), height: bytes[28] | (bytes[29] << 8) };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  return null;
}

function readJpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }

    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker >= 0xc0 && marker <= 0xc3 && i + 8 < bytes.length) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
    if (i + 4 >= bytes.length) {
      break;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (!length) {
      break;
    }
    i += 2 + length;
  }

  return null;
}

function buildOneImagePdf(imageBytes, imageWidth, imageHeight, options) {
  const pageWidth = options.pageWidth;
  const pageHeight = options.pageHeight;
  const margin = 28;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2 - 28;
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  const drawWidth = Math.max(1, Math.floor(imageWidth * scale));
  const drawHeight = Math.max(1, Math.floor(imageHeight * scale));
  const x = Math.floor((pageWidth - drawWidth) / 2);
  const y = Math.floor((pageHeight - drawHeight) / 2 - 8);

  const contentStream = ['q', drawWidth + ' 0 0 ' + drawHeight + ' ' + x + ' ' + y + ' cm', '/Im0 Do', 'Q'].join('\n');
  const objects = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
  objects.push('<< /Length ' + contentStream.length + ' >>\nstream\n' + contentStream + '\nendstream');
  const imagePrefix = '<< /Type /XObject /Subtype /Image /Width ' + imageWidth + ' /Height ' + imageHeight + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + imageBytes.length + ' >>\nstream\n';
  const imageSuffix = '\nendstream';

  const chunks = [asciiBytes('%PDF-1.4\n')];
  const offsets = [0];
  let position = chunks[0].length;

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(position);
    const body = (i + 1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
    const bodyBytes = asciiBytes(body);
    chunks.push(bodyBytes);
    position += bodyBytes.length;
  }

  const xrefPos = position;
  let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  chunks.push(asciiBytes(xref));
  chunks.push(asciiBytes('5 0 obj\n' + imagePrefix));
  chunks.push(imageBytes);
  chunks.push(asciiBytes(imageSuffix + '\nendobj\n'));
  chunks.push(asciiBytes('trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF'));

  return concatBytes(chunks);
}

function sanitizeFilename(value) {
  return String(value)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'bmconvert-asset';
}

function asciiBytes(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks) {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
