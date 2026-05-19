const state = {
  file: null,
  parsed: null,
  assetUrls: [],
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
  els.sheetMeta.innerHTML = '<div>Waiting for a .bpf upload.</div>';
  els.detailGrid.innerHTML = '<div class="empty-state">No file loaded yet.</div>';
  els.assetGrid.innerHTML = '<div class="empty-state">Embedded images will appear here.</div>';
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
  els.stringList.innerHTML = buildStringList(parsed.visibleStrings);
  els.summaryStack.innerHTML = buildSummary(parsed);
}

function parseBoardmaker(buffer, name) {
  const bytes = new Uint8Array(buffer);
  const utf16 = [...extractUtf16Strings(bytes, 0), ...extractUtf16Strings(bytes, 1)]
    .sort((a, b) => a.offset - b.offset);

  const metadata = extractMetadata(utf16);
  const images = extractJpegs(bytes);
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

function extractJpegs(bytes) {
  const images = [];
  let offset = 0;
  let index = 0;

  while (offset < bytes.length - 1) {
    const soi = findMarker(bytes, [0xff, 0xd8], offset);
    if (soi === -1) {
      break;
    }
    const eoi = findMarker(bytes, [0xff, 0xd9], soi + 2);
    if (eoi === -1) {
      break;
    }

    const blob = new Blob([bytes.slice(soi, eoi + 2)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    state.assetUrls.push(url);
    images.push({
      index: index + 1,
      start: soi,
      end: eoi + 2,
      size: eoi - soi + 2,
      url,
    });

    offset = eoi + 2;
    index += 1;
  }

  return images;
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
    return '<div class="empty-state">No embedded JPEGs were found in this file.</div>';
  }

  return parsed.images
    .map(
      (asset) => [
        '<figure class="asset">',
        '<img src="' + asset.url + '" alt="Embedded image ' + asset.index + '" />',
        '<figcaption class="asset-caption">',
        'Image ' +
          asset.index +
          ' · ' +
          formatBytes(asset.size) +
          ' · bytes ' +
          asset.start +
          ' to ' +
          asset.end,
        '</figcaption>',
        '</figure>',
      ].join(''),
    )
    .join('');
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
    ['Embedded images', parsed.images.length + ' JPEGs'],
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
