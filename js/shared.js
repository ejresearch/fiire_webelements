// ==================== FIIRE SHARED JS ====================
// Core infrastructure shared across all pages

// ==================== API CONFIG ====================
let ELEVENLABS_API_KEY = localStorage.getItem('fiire_api_key') || '';
let CLAUDE_API_KEY = localStorage.getItem('fiire_claude_key') || '';

// ==================== STATE ====================
const state = {
  currentPage: 'generate',
  generateMode: 'loop',
  isPlaying: false,
  currentSample: null,
  inspectedSample: null,
  currentTime: 0,
  totalTime: 0,
  volume: 66,
  isMuted: false,
  loopPlayback: false,
  progressInterval: null,
  generating: false,
  selectedSamples: new Set(),
  libraryView: 'grid',
  libraryType: 'all',
  selectedBars: 4,
  varCount: 4,
  chatMessages: [],
  chatRefining: false,
  selectedPad: null,
  currentBank: 'A',
  generatingForPad: null,
};

let samples = {};
let sessions = {};
let decisions = [];
let currentVariations = [];
let varIdCounter = 0;

let padAssignments = {
  'A': new Array(24).fill(null),
  'B': new Array(24).fill(null),
  'C': new Array(24).fill(null),
  'D': new Array(24).fill(null),
};

let dnaFiles = [];
let dnaProfile = null;
let globalDnaProfile = null;
let dnaCategoryResults = [];
let projects = {};
let currentProjectId = null;

// ==================== PERSISTENCE ====================
function saveData() {
  try {
    // Sync pads back to project before persisting
    if (currentProjectId && projects[currentProjectId]) {
      projects[currentProjectId].padAssignments = padAssignments;
    }
    localStorage.setItem('fiire_samples', JSON.stringify(samples));
    localStorage.setItem('fiire_sessions', JSON.stringify(sessions));
    localStorage.setItem('fiire_decisions', JSON.stringify(decisions));
    localStorage.setItem('fiire_counters', JSON.stringify({ varIdCounter }));
    localStorage.setItem('fiire_projects', JSON.stringify(projects));
    localStorage.setItem('fiire_current_project', currentProjectId);
  } catch(e) {}
}

function loadData() {
  try {
    const s = localStorage.getItem('fiire_samples'); if (s) samples = JSON.parse(s);
    const ss = localStorage.getItem('fiire_sessions'); if (ss) sessions = JSON.parse(ss);
    const d = localStorage.getItem('fiire_decisions'); if (d) decisions = JSON.parse(d);
    const c = localStorage.getItem('fiire_counters'); if (c) { const p = JSON.parse(c); varIdCounter = p.varIdCounter || 0; }
    const pr = localStorage.getItem('fiire_projects'); if (pr) projects = JSON.parse(pr);
    const cp = localStorage.getItem('fiire_current_project'); if (cp) currentProjectId = cp;
    const pa = localStorage.getItem('fiire_pads'); if (pa) padAssignments = JSON.parse(pa);
    const gd = localStorage.getItem('fiire_dna_global'); if (gd) globalDnaProfile = JSON.parse(gd);
  } catch(e) {}
}

function emptyPads() {
  return { A: new Array(24).fill(null), B: new Array(24).fill(null), C: new Array(24).fill(null), D: new Array(24).fill(null) };
}

function syncPadAssignments() {
  const proj = projects[currentProjectId];
  if (proj && proj.padAssignments) {
    padAssignments = proj.padAssignments;
  } else {
    padAssignments = emptyPads();
  }
}

function migrateToProjects() {
  if (Object.keys(projects).length > 0) return;
  const id = 'proj_default';
  projects[id] = { id, name: 'My Project', createdAt: Date.now(), updatedAt: Date.now(), padAssignments: emptyPads() };
  currentProjectId = id;
  Object.values(samples).forEach(s => { if (!s.projectId) s.projectId = id; });
  Object.values(sessions).forEach(s => { if (!s.projectId) s.projectId = id; });
  saveData();
}

function migratePadsToProjects() {
  const needsMigration = Object.values(projects).some(p => !p.padAssignments);
  if (!needsMigration) return;
  // Read old global pads if they exist
  let oldPads = emptyPads();
  try { const pa = localStorage.getItem('fiire_pads'); if (pa) oldPads = JSON.parse(pa); } catch(e) {}
  Object.values(projects).forEach(p => {
    if (!p.padAssignments) {
      p.padAssignments = (p.id === currentProjectId) ? JSON.parse(JSON.stringify(oldPads)) : emptyPads();
    }
  });
  saveData();
}

function getProjectSampleCount(projectId) {
  return Object.values(samples).filter(s => s.projectId === projectId).length;
}

// ==================== INDEXEDDB AUDIO STORAGE ====================
let audioDB = null;
const AUDIO_DB_NAME = 'fiire_audio';
const AUDIO_STORE = 'buffers';

function openAudioDB() {
  if (audioDB) return Promise.resolve(audioDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUDIO_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
    };
    req.onsuccess = (e) => { audioDB = e.target.result; resolve(audioDB); };
    req.onerror = () => reject(req.error);
  });
}

function saveAudioBlob(sampleId, arrayBuffer) {
  return openAudioDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE, 'readwrite');
      tx.objectStore(AUDIO_STORE).put(arrayBuffer, sampleId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }).catch(() => {});
}

function loadAudioBlob(sampleId) {
  return openAudioDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE, 'readonly');
      const req = tx.objectStore(AUDIO_STORE).get(sampleId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }).catch(() => null);
}

function deleteAudioBlob(sampleId) {
  return openAudioDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_STORE, 'readwrite');
      tx.objectStore(AUDIO_STORE).delete(sampleId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }).catch(() => {});
}

function deleteAudioBlobsForProject(projectId) {
  const ids = Object.values(samples).filter(s => s.projectId === projectId).map(s => s.id);
  return Promise.all(ids.map(id => deleteAudioBlob(id)));
}

// ==================== UTILITIES ====================
function uid(prefix) { return prefix + '_' + (++varIdCounter) + '_' + Date.now().toString(36); }
function formatTime(s) { const m = Math.floor(s/60); const sec = Math.floor(s%60); return m+':'+(sec<10?'0':'')+sec; }
function showToast(msg) { const t = document.getElementById('toast'); if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); } }
function closeModal() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

// ==================== AUDIO ENGINE ====================
let audioCtx = null;
let masterGain = null;
let currentSource = null;
let audioBuffers = {};
let playbackStartTime = 0;
let playbackOffset = 0;

function initAudioContext() {
  if (audioCtx) return audioCtx;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = state.volume / 100;
  masterGain.connect(audioCtx.destination);
  return audioCtx;
}

function ensureAudioContext() {
  initAudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function generateSyntheticAudio(sample) {
  ensureAudioContext();
  const dur = sample.duration || 2;
  const sr = audioCtx.sampleRate;
  const len = Math.ceil(dur * sr);
  const buf = audioCtx.createBuffer(2, len, sr);
  const bpm = sample.bpm || 120;

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (sample.type === 'loop') {
      const beatLen = Math.floor(60 / bpm * sr);
      for (let i = 0; i < len; i++) {
        const posInBeat = i % beatLen;
        const beatFrac = posInBeat / beatLen;
        let val = 0;
        if (beatFrac < 0.06) {
          const env = 1 - beatFrac / 0.06;
          const freq = 55 + 180 * env * env;
          val += Math.sin(2 * Math.PI * freq * i / sr) * env * env * 0.7;
        }
        const halfBeat = i % (beatLen * 2);
        const halfFrac = halfBeat / (beatLen * 2);
        if (halfFrac > 0.49 && halfFrac < 0.54) {
          const t = (halfFrac - 0.49) / 0.05;
          const env = Math.max(0, 1 - t * 1.5);
          val += (Math.random() * 2 - 1) * env * 0.35;
          val += Math.sin(2 * Math.PI * 200 * i / sr) * env * 0.2;
        }
        const eighthLen = Math.floor(beatLen / 2);
        const eighthPos = i % eighthLen;
        const eighthFrac = eighthPos / eighthLen;
        if (eighthFrac < 0.015) {
          const env = 1 - eighthFrac / 0.015;
          val += (Math.random() * 2 - 1) * env * 0.12;
        }
        d[i] = val;
      }
    } else {
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 20);
        const pitch = 180 + 600 * Math.exp(-t * 40);
        d[i] = Math.sin(2 * Math.PI * pitch * t) * env * 0.55
             + (Math.random() * 2 - 1) * env * 0.35;
      }
    }
    if (ch === 1) {
      for (let i = 0; i < len; i++) d[i] *= 0.95 + Math.random() * 0.1;
    }
  }
  return buf;
}

function cacheAndPersistBuffer(sampleId, buf) {
  audioBuffers[sampleId] = buf;
  updateSampleWaveform(sampleId, buf);
  const wav = audioBufferToWav(buf);
  saveAudioBlob(sampleId, wav);
  return buf;
}

function getAudioBuffer(sampleId) {
  if (audioBuffers[sampleId]) return Promise.resolve(audioBuffers[sampleId]);
  const s = samples[sampleId];
  if (!s) return Promise.resolve(null);
  ensureAudioContext();

  return loadAudioBlob(sampleId).then(stored => {
    if (stored) {
      return audioCtx.decodeAudioData(stored).then(buf => {
        audioBuffers[sampleId] = buf;
        updateSampleWaveform(sampleId, buf);
        return buf;
      });
    }
    if (s.audioUrl) {
      return fetch(s.audioUrl)
        .then(r => r.arrayBuffer())
        .then(ab => audioCtx.decodeAudioData(ab))
        .then(buf => cacheAndPersistBuffer(sampleId, buf))
        .catch(() => cacheAndPersistBuffer(sampleId, generateSyntheticAudio(s)));
    }
    return cacheAndPersistBuffer(sampleId, generateSyntheticAudio(s));
  }).catch(() => {
    return cacheAndPersistBuffer(sampleId, generateSyntheticAudio(s));
  });
}

function stopCurrentSource() {
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop(); } catch(e) {}
    try { currentSource.disconnect(); } catch(e) {}
    currentSource = null;
  }
}

function playAudioBuffer(sampleId, offset) {
  offset = offset || 0;
  ensureAudioContext();
  stopCurrentSource();
  return getAudioBuffer(sampleId).then(buf => {
    if (!buf) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = state.loopPlayback;
    src.connect(masterGain);
    playbackStartTime = audioCtx.currentTime;
    playbackOffset = offset;
    state.totalTime = buf.duration;
    src.start(0, offset);
    src.onended = () => {
      if (currentSource === src && !state.loopPlayback) {
        state.isPlaying = false;
        state.currentTime = state.totalTime;
        updatePlayButton();
        stopProgress();
        const el = document.getElementById('player-current-time');
        if (el) el.textContent = formatTime(state.totalTime);
        drawPlayerWaveform(1);
      }
    };
    currentSource = src;
  });
}

function extractPeaks(audioBuffer, barCount) {
  barCount = barCount || 100;
  const chan = audioBuffer.getChannelData(0);
  const len = chan.length;
  const chunkSize = Math.floor(len / barCount);
  const peaks = [];
  let maxPeak = 0;
  for (let i = 0; i < barCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, len);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(chan[j]);
      if (abs > peak) peak = abs;
    }
    peaks.push(peak);
    if (peak > maxPeak) maxPeak = peak;
  }
  if (maxPeak > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / maxPeak;
  }
  return peaks;
}

function updateSampleWaveform(sampleId, audioBuffer) {
  const s = samples[sampleId];
  if (!s) return;
  s.waveformData = extractPeaks(audioBuffer, 80 + Math.floor(Math.random() * 40));
  document.querySelectorAll(`canvas[data-id="${sampleId}"]`).forEach(canvas => {
    if (canvas.classList.contains('var-waveform') || canvas.classList.contains('lib-waveform')) {
      drawWaveform(canvas, s.waveformData, s.status === 'rejected' ? '#444' : '#E85002');
    } else if (canvas.classList.contains('lib-waveform-row')) {
      drawMiniWaveform(canvas, s.waveformData, '#E85002');
    }
  });
}

function getPlaybackTime() {
  if (!audioCtx || !state.isPlaying) return state.currentTime;
  const t = playbackOffset + (audioCtx.currentTime - playbackStartTime);
  if (state.loopPlayback && state.totalTime > 0) return t % state.totalTime;
  return Math.min(t, state.totalTime);
}

// ==================== WAVEFORM RENDERING ====================
function placeholderWaveform(length) {
  const data = [];
  for (let i = 0; i < (length || 80); i++) data.push(0.3);
  return data;
}

function drawWaveform(canvas, data, color, progress) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth * 2;
  const h = canvas.height = canvas.offsetHeight * 2;
  ctx.clearRect(0, 0, w, h);
  const barW = Math.max(2, w / data.length - 1);
  const gap = 1;
  const mid = h / 2;
  for (let i = 0; i < data.length; i++) {
    const x = i * (barW + gap);
    const barH = data[i] * mid * 0.85;
    const pct = x / w;
    if (progress !== undefined && pct <= progress) {
      ctx.fillStyle = color || '#E85002';
    } else {
      ctx.fillStyle = progress !== undefined ? '#333' : (color || '#E85002');
    }
    ctx.fillRect(x, mid - barH, barW, barH * 2);
  }
}

function drawMiniWaveform(canvas, data, color) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width; const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const barW = 2; const gap = 1;
  const mid = h / 2;
  const count = Math.floor(w / (barW + gap));
  const step = Math.max(1, Math.floor(data.length / count));
  ctx.fillStyle = color || '#E85002';
  for (let i = 0; i < count; i++) {
    const val = data[Math.min(i * step, data.length - 1)] || 0.5;
    const barH = val * mid * 0.8;
    ctx.fillRect(i * (barW + gap), mid - barH, barW, barH * 2);
  }
}

// ==================== ELEVENLABS API ====================
function callElevenLabsSfx(prompt, duration, isLoop, modelId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  return fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_44100', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: Math.round(duration * 10) / 10,
      prompt_influence: 0.3,
      loop: isLoop,
      model_id: modelId || 'eleven_text_to_sound_v2',
    }),
    signal: controller.signal,
  }).then(res => {
    clearTimeout(timeoutId);
    if (!res.ok) return res.text().then(t => { throw new Error(`API ${res.status}: ${t}`); });
    return res.arrayBuffer();
  }).catch(err => {
    clearTimeout(timeoutId);
    throw err.name === 'AbortError' ? new Error('Request timed out (30s)') : err;
  });
}

function pcmToAudioBuffer(pcmData, sampleRate) {
  ensureAudioContext();
  const int16 = new Int16Array(pcmData);
  const numSamples = int16.length;
  const buf = audioCtx.createBuffer(1, numSamples, sampleRate || 44100);
  const chan = buf.getChannelData(0);
  for (let i = 0; i < numSamples; i++) {
    chan[i] = int16[i] / 32768;
  }
  return buf;
}

// ==================== SAMPLE METADATA ====================
const chipLabelMap = {
  'SNP': 'Snappy', 'SFT': 'Soft', 'TRN': 'Transient', 'PUN': 'Punchy',
  'WRM': 'Warm', 'BRT': 'Bright', 'DRK': 'Dark', 'MTL': 'Metallic',
  'DRUMS': 'drums', 'BASS': 'bass', 'MELODIC': 'melodic', 'PAD': 'pad', 'FX': 'fx', 'VOCAL': 'vocal',
  'TRAP': 'trap', 'BOOMBAP': 'boombap', 'HOUSE': 'house', 'TECHNO': 'techno',
  'DNB': 'drum and bass', 'AMBIENT': 'ambient', 'R&B': 'r&b', 'LOFI': 'lo-fi',
  'FUNK': 'funk', 'AFRO': 'afrobeat',
  'LOW': 'low energy', 'MID': 'medium energy', 'HIGH': 'high energy',
};
function resolveChipLabel(text) { return chipLabelMap[text] || text; }

const instrumentPromptMap = {
  'drums': 'drum loop', 'bass': 'bass line', 'melodic': 'melodic loop',
  'pad': 'pad texture', 'fx': 'sound effect', 'vocal': 'vocal chop',
};
const instrumentOneshotMap = {
  'drums': 'drum hit', 'bass': 'bass one-shot', 'melodic': 'melodic stab',
  'pad': 'pad one-shot', 'fx': 'sound effect hit', 'vocal': 'vocal one-shot',
};

function buildSampleMeta(s, sep, includeDuration) {
  sep = sep || ' \u00b7 ';
  const parts = [];
  if (s.type === 'loop') {
    if (s.bpm) parts.push(`${s.bpm}`);
    if (s.key) parts.push(s.key);
    if (s.bars) parts.push(`${s.bars}b`);
  } else {
    if (s.tuning) parts.push(s.tuning);
    if (s.attack) parts.push(s.attack);
    if (s.timbre) parts.push(s.timbre);
  }
  if (includeDuration && s.duration) parts.push(formatTime(s.duration));
  return parts.length ? parts.join(sep) : s.type;
}

// ==================== EXPORT / DOWNLOAD ====================
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return arrayBuffer;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSample(id) {
  const s = samples[id];
  if (!s) return;
  ensureAudioContext();
  showToast('Preparing download...');
  getAudioBuffer(id).then(buf => {
    if (!buf) { showToast('No audio to download'); return; }
    const wav = audioBufferToWav(buf);
    const blob = new Blob([wav], { type: 'audio/wav' });
    triggerDownload(blob, sanitizeFilename(s.name) + '.wav');
    showToast('Downloaded ' + s.name + '.wav');
  });
}

// ==================== PROJECTS ====================
let projectDropdownOpen = false;

function toggleProjectDropdown() {
  projectDropdownOpen = !projectDropdownOpen;
  const dd = document.getElementById('project-dropdown');
  const chevron = document.getElementById('project-chevron');
  if (dd) dd.classList.toggle('hidden', !projectDropdownOpen);
  if (chevron) chevron.textContent = projectDropdownOpen ? 'expand_less' : 'expand_more';
  if (projectDropdownOpen) renderProjectList();
}

function closeProjectDropdown() {
  projectDropdownOpen = false;
  const dd = document.getElementById('project-dropdown');
  if (dd) dd.classList.add('hidden');
  const chevron = document.getElementById('project-chevron');
  if (chevron) chevron.textContent = 'expand_more';
  cancelNewProject();
}

function renderProjectSwitcher() {
  const proj = projects[currentProjectId];
  if (!proj) return;
  const nameEl = document.getElementById('project-name');
  if (nameEl) nameEl.textContent = proj.name;
  const count = getProjectSampleCount(currentProjectId);
  const countEl = document.getElementById('project-count');
  if (countEl) countEl.textContent = count + ' sample' + (count !== 1 ? 's' : '');
}

function renderProjectList() {
  const list = document.getElementById('project-list');
  if (!list) return;
  const sorted = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);
  list.innerHTML = sorted.map(p => {
    const count = getProjectSampleCount(p.id);
    const isActive = p.id === currentProjectId;
    return `
      <div class="flex items-center gap-2 px-3 py-2 hover:bg-surface transition-colors cursor-pointer group ${isActive ? 'bg-surface' : ''}" onclick="switchProject('${p.id}')">
        <div class="w-6 h-6 rounded ${isActive ? 'bg-brand/20' : 'bg-bg'} flex items-center justify-center flex-shrink-0">
          ${isActive ? '<span class="material-symbols-outlined text-brand text-[14px]">check</span>' : '<span class="material-symbols-outlined text-txt-dim text-[14px]">folder</span>'}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate ${isActive ? 'text-brand' : ''}">${p.name}</p>
          <p class="text-[10px] text-txt-dim">${count} sample${count !== 1 ? 's' : ''}</p>
        </div>
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="p-1 rounded hover:bg-dk-gray text-txt-dim hover:text-txt" onclick="event.stopPropagation(); renameProjectPrompt('${p.id}')">
            <span class="material-symbols-outlined text-[14px]">edit</span>
          </button>
          ${Object.keys(projects).length > 1 ? `<button class="p-1 rounded hover:bg-dk-gray text-txt-dim hover:text-red-400" onclick="event.stopPropagation(); deleteProjectConfirm('${p.id}')">
            <span class="material-symbols-outlined text-[14px]">delete</span>
          </button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function switchProject(id) {
  if (id === currentProjectId) { closeProjectDropdown(); return; }
  // Save current pads before switching
  if (currentProjectId && projects[currentProjectId]) {
    projects[currentProjectId].padAssignments = padAssignments;
  }
  currentProjectId = id;
  projects[id].updatedAt = Date.now();
  syncPadAssignments();
  currentVariations = [];
  state.currentSample = null;
  state.inspectedSample = null;
  state.selectedPad = null;
  state.currentBank = 'A';
  const playerBar = document.getElementById('player-bar');
  if (playerBar) playerBar.style.display = 'none';
  closeProjectDropdown();
  saveData();
  renderProjectSwitcher();
  // Call page-specific refresh
  if (typeof window.FIIRE_onProjectSwitch === 'function') {
    window.FIIRE_onProjectSwitch();
  }
  showToast('Switched to ' + projects[id].name);
}

function createProject(name) {
  const id = uid('proj');
  projects[id] = { id, name: name || 'Untitled Project', createdAt: Date.now(), updatedAt: Date.now(), padAssignments: emptyPads() };
  saveData();
  switchProject(id);
}

function showNewProjectInput() {
  const row = document.getElementById('new-project-row');
  const inputRow = document.getElementById('new-project-input-row');
  if (row) row.classList.add('hidden');
  if (inputRow) inputRow.classList.remove('hidden');
  const input = document.getElementById('new-project-input');
  if (input) { input.value = ''; input.focus(); }
}

function confirmNewProject() {
  const input = document.getElementById('new-project-input');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  createProject(name);
  cancelNewProject();
}

function cancelNewProject() {
  const row = document.getElementById('new-project-row');
  const inputRow = document.getElementById('new-project-input-row');
  if (row) row.classList.remove('hidden');
  if (inputRow) inputRow.classList.add('hidden');
}

function renameProjectPrompt(id) {
  const p = projects[id];
  if (!p) return;
  const name = prompt('Rename project:', p.name);
  if (name && name.trim()) {
    p.name = name.trim();
    p.updatedAt = Date.now();
    saveData();
    renderProjectSwitcher();
    renderProjectList();
    showToast('Project renamed');
  }
}

function deleteProjectConfirm(id) {
  const p = projects[id];
  if (!p || Object.keys(projects).length <= 1) return;
  document.getElementById('confirm-title').textContent = 'Delete Project';
  document.getElementById('confirm-msg').textContent = `Delete "${p.name}" and all its samples? This can't be undone.`;
  document.getElementById('confirm-action').onclick = () => {
    Object.keys(samples).forEach(sid => { if (samples[sid].projectId === id) { deleteAudioBlob(sid); delete audioBuffers[sid]; delete samples[sid]; } });
    Object.keys(sessions).forEach(sid => { if (sessions[sid].projectId === id) delete sessions[sid]; });
    decisions = decisions.filter(d => samples[d.sampleId]);
    delete projects[id];
    if (currentProjectId === id) {
      currentProjectId = Object.keys(projects)[0];
    }
    saveData();
    closeModal();
    closeProjectDropdown();
    renderProjectSwitcher();
    if (typeof window.FIIRE_onProjectSwitch === 'function') {
      window.FIIRE_onProjectSwitch();
    }
    showToast('Project deleted');
  };
  document.getElementById('confirm-modal').classList.add('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (projectDropdownOpen && !e.target.closest('#project-switcher') && !e.target.closest('#project-dropdown')) {
    closeProjectDropdown();
  }
});

// ==================== NAVIGATION ====================
const PAGE_MAP = {
  'home': 'home.html',
  'studio': 'studio.html',
  'generate': 'studio.html',
  'library': 'studio.html',
  'sounddna': 'sounddna.html',
};

function navigateTo(page) {
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';
  const targetFile = PAGE_MAP[page];
  if (!targetFile) return;

  // If we're already on the target page, handle internally
  if (currentFile === targetFile) {
    // Page-specific internal navigation (e.g., studio tabs)
    if (typeof window.FIIRE_onNavigate === 'function') {
      window.FIIRE_onNavigate(page);
    }
    return;
  }

  // Navigate to different page
  window.location.href = targetFile + (page === 'library' ? '#library' : '');
}

function initNavHighlight() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const pageKey = path.replace('.html', '');
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
    link.classList.add('text-txt-muted');
    if (link.dataset.page === pageKey) {
      link.classList.add('active');
      link.classList.remove('text-txt-muted');
    }
  });
}

// ==================== PLAYBACK ====================
function previewSample(id) {
  const s = samples[id];
  if (!s) return;

  if (state.currentSample === id) { togglePlayPause(); return; }

  state.currentSample = id;
  state.currentTime = 0;
  state.totalTime = s.duration;
  state.isPlaying = true;

  const playerBar = document.getElementById('player-bar');
  if (playerBar) playerBar.style.display = 'block';
  const titleEl = document.getElementById('player-title');
  if (titleEl) titleEl.textContent = s.name;
  const meta = buildSampleMeta(s, ' / ');
  const metaEl = document.getElementById('player-meta');
  if (metaEl) metaEl.textContent = meta;
  const totalEl = document.getElementById('player-total-time');
  if (totalEl) totalEl.textContent = formatTime(s.duration);
  const currentEl = document.getElementById('player-current-time');
  if (currentEl) currentEl.textContent = '0:00';
  updatePlayButton();
  updatePlayerFav();

  playAudioBuffer(id, 0).then(() => {
    startProgress();
    const miniWf = document.getElementById('player-mini-waveform');
    if (miniWf) drawMiniWaveform(miniWf, s.waveformData, '#E85002');
    drawPlayerWaveform();
  });

  document.querySelectorAll('.variation-card').forEach(card => {
    card.classList.toggle('playing', card.dataset.id === id);
  });
  // Page-specific render after preview (e.g., pad grid)
  if (typeof window.FIIRE_onPreviewSample === 'function') {
    window.FIIRE_onPreviewSample(id);
  }
}

function togglePlayPause() {
  if (!state.currentSample) return;
  state.isPlaying = !state.isPlaying;
  updatePlayButton();
  if (state.isPlaying) {
    playAudioBuffer(state.currentSample, state.currentTime);
    startProgress();
  } else {
    state.currentTime = getPlaybackTime();
    stopCurrentSource();
    stopProgress();
  }
}

function updatePlayButton() {
  const btnPlay = document.querySelector('#btn-play .material-symbols-outlined');
  if (btnPlay) btnPlay.textContent = state.isPlaying ? 'pause' : 'play_arrow';
  const inspIcon = document.getElementById('inspector-play-icon');
  if (inspIcon) inspIcon.textContent = state.isPlaying ? 'pause' : 'play_arrow';
}

function startProgress() {
  stopProgress();
  state.progressInterval = setInterval(() => {
    if (!state.isPlaying) return;
    const t = getPlaybackTime();
    state.currentTime = t;
    if (t < state.totalTime || state.loopPlayback) {
      const displayTime = state.loopPlayback ? t % state.totalTime : t;
      const pct = displayTime / state.totalTime;
      const el = document.getElementById('player-current-time');
      if (el) el.textContent = formatTime(displayTime);
      drawPlayerWaveform(pct);
    } else {
      state.isPlaying = false;
      updatePlayButton();
      stopProgress();
      const el = document.getElementById('player-current-time');
      if (el) el.textContent = formatTime(state.totalTime);
      drawPlayerWaveform(1);
    }
  }, 50);
}

function stopProgress() { if (state.progressInterval) { clearInterval(state.progressInterval); state.progressInterval = null; } }

function drawPlayerWaveform(progress) {
  const s = samples[state.currentSample];
  if (!s) return;
  const canvas = document.getElementById('player-waveform');
  if (canvas) drawWaveform(canvas, s.waveformData, '#E85002', progress || 0);
}

function seekSample(e) {
  if (!state.currentSample) return;
  const r = e.currentTarget.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  state.currentTime = p * state.totalTime;
  const el = document.getElementById('player-current-time');
  if (el) el.textContent = formatTime(state.currentTime);
  drawPlayerWaveform(p);
  if (state.isPlaying) {
    playAudioBuffer(state.currentSample, state.currentTime);
  }
}

function toggleLoopPlayback() {
  state.loopPlayback = !state.loopPlayback;
  if (currentSource) currentSource.loop = state.loopPlayback;
  const btnLoop = document.getElementById('btn-loop');
  if (btnLoop) {
    btnLoop.classList.toggle('text-brand', state.loopPlayback);
    btnLoop.classList.toggle('text-txt-muted', !state.loopPlayback);
  }
  const inspBtn = document.getElementById('inspector-loop-btn');
  if (inspBtn) {
    inspBtn.classList.toggle('text-brand', state.loopPlayback);
    inspBtn.classList.toggle('text-txt-muted', !state.loopPlayback);
  }
  showToast(state.loopPlayback ? 'Loop on' : 'Loop off');
}

function setVolume(v) { state.volume = parseInt(v); state.isMuted = false; if (masterGain) masterGain.gain.value = state.volume / 100; updateVolumeIcon(); }
function toggleMute() { state.isMuted = !state.isMuted; const slider = document.getElementById('volume-slider'); if (slider) slider.value = state.isMuted ? 0 : state.volume; if (masterGain) masterGain.gain.value = state.isMuted ? 0 : state.volume / 100; updateVolumeIcon(); }
function updateVolumeIcon() { const i = document.getElementById('volume-icon'); if (!i) return; const v = state.isMuted ? 0 : state.volume; i.textContent = v === 0 ? 'volume_off' : v < 40 ? 'volume_down' : 'volume_up'; }

// ==================== FAVORITES ====================
function toggleSampleFavorite(id) {
  const s = samples[id];
  if (!s) return;
  s.isFavorite = !s.isFavorite;
  s.favoritedAt = s.isFavorite ? Date.now() : null;
  saveData();
  showToast(s.isFavorite ? 'Added to favorites' : 'Removed from favorites');
  // Page-specific re-renders
  if (typeof window.FIIRE_onFavoriteToggle === 'function') {
    window.FIIRE_onFavoriteToggle(id);
  }
  updateInspectorFav();
  updatePlayerFav();
}

function updateInspectorFav() {
  const s = samples[state.inspectedSample];
  const icon = document.getElementById('inspector-fav-icon');
  if (s && icon) {
    icon.classList.toggle('fill-1', s.isFavorite);
    icon.classList.toggle('text-brand', s.isFavorite);
  }
}

function updatePlayerFav() {
  const s = samples[state.currentSample];
  const btn = document.getElementById('player-fav-btn');
  if (s && btn) {
    const icon = btn.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.classList.toggle('fill-1', s.isFavorite);
      btn.classList.toggle('text-brand', s.isFavorite);
      btn.classList.toggle('text-txt-muted', !s.isFavorite);
    }
  }
}

function togglePlayerFav() {
  if (state.currentSample) toggleSampleFavorite(state.currentSample);
}

// ==================== SETTINGS ====================
function openSettingsModal() {
  const input = document.getElementById('settings-api-key');
  if (input) {
    input.value = ELEVENLABS_API_KEY;
    input.type = 'password';
  }
  const eye = document.getElementById('api-key-eye');
  if (eye) eye.textContent = 'visibility_off';
  const status = document.getElementById('api-status');
  if (status) status.innerHTML = ELEVENLABS_API_KEY
    ? '<span class="w-2 h-2 rounded bg-emerald-400 flex-shrink-0"></span><span class="text-xs text-emerald-400 font-medium">Key saved</span>'
    : '<span class="w-2 h-2 rounded bg-txt-dim flex-shrink-0"></span><span class="text-xs text-txt-dim font-medium">No key set</span>';
  const claudeInput = document.getElementById('settings-claude-key');
  if (claudeInput) {
    claudeInput.value = CLAUDE_API_KEY;
    claudeInput.type = 'password';
  }
  const claudeEye = document.getElementById('claude-key-eye');
  if (claudeEye) claudeEye.textContent = 'visibility_off';
  const claudeStatus = document.getElementById('claude-key-status');
  if (claudeStatus) claudeStatus.innerHTML = CLAUDE_API_KEY
    ? '<span class="w-2 h-2 rounded bg-emerald-400 flex-shrink-0"></span><span class="text-xs text-emerald-400 font-medium">Key saved</span>'
    : '<span class="w-2 h-2 rounded bg-txt-dim flex-shrink-0"></span><span class="text-xs text-txt-dim font-medium">No key set</span>';
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('open');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('open');
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('settings-api-key');
  const eye = document.getElementById('api-key-eye');
  if (!input || !eye) return;
  if (input.type === 'password') { input.type = 'text'; eye.textContent = 'visibility'; }
  else { input.type = 'password'; eye.textContent = 'visibility_off'; }
}

function saveApiKey() {
  const input = document.getElementById('settings-api-key');
  const key = input ? input.value.trim() : '';
  ELEVENLABS_API_KEY = key;
  localStorage.setItem('fiire_api_key', key);
  const status = document.getElementById('api-status');
  if (status) status.innerHTML = key
    ? '<span class="w-2 h-2 rounded bg-emerald-400 flex-shrink-0"></span><span class="text-xs text-emerald-400 font-medium">Key saved</span>'
    : '<span class="w-2 h-2 rounded bg-txt-dim flex-shrink-0"></span><span class="text-xs text-txt-dim font-medium">Key removed</span>';
  showToast(key ? 'API key saved' : 'API key removed');
  const warn = document.getElementById('api-key-warning');
  if (warn) warn.classList.toggle('hidden', !!key);
}

function testApiKey() {
  const input = document.getElementById('settings-api-key');
  const key = input ? input.value.trim() : '';
  if (!key) {
    const status = document.getElementById('api-status');
    if (status) status.innerHTML = '<span class="w-2 h-2 rounded bg-red-400 flex-shrink-0"></span><span class="text-xs text-red-400 font-medium">Enter a key first</span>';
    return;
  }
  const btn = document.getElementById('api-test-btn');
  const label = document.getElementById('api-test-label');
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Testing...';

  fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_22050_32', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ text: 'short click', duration_seconds: 0.5, prompt_influence: 0.3, model_id: 'eleven_text_to_sound_v2' }),
  }).then(res => {
    const status = document.getElementById('api-status');
    if (res.ok) {
      if (status) status.innerHTML = '<span class="w-2 h-2 rounded bg-emerald-400 flex-shrink-0"></span><span class="text-xs text-emerald-400 font-medium">Connected!</span>';
      showToast('API key is valid!');
    } else {
      return res.text().then(t => {
        let msg = 'Invalid key';
        try { const j = JSON.parse(t); msg = j.detail?.message || j.detail || msg; } catch(e) {}
        if (status) status.innerHTML = `<span class="w-2 h-2 rounded bg-red-400 flex-shrink-0"></span><span class="text-xs text-red-400 font-medium">${msg}</span>`;
        showToast('API key test failed');
      });
    }
  }).catch(() => {
    const status = document.getElementById('api-status');
    if (status) status.innerHTML = '<span class="w-2 h-2 rounded bg-red-400 flex-shrink-0"></span><span class="text-xs text-red-400 font-medium">Network error</span>';
    showToast('Connection failed');
  }).finally(() => {
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Test Connection';
  });
}

function toggleClaudeKeyVisibility() {
  const input = document.getElementById('settings-claude-key');
  const eye = document.getElementById('claude-key-eye');
  if (!input || !eye) return;
  if (input.type === 'password') { input.type = 'text'; eye.textContent = 'visibility'; }
  else { input.type = 'password'; eye.textContent = 'visibility_off'; }
}

function saveClaudeKey() {
  const input = document.getElementById('settings-claude-key');
  const key = input ? input.value.trim() : '';
  CLAUDE_API_KEY = key;
  localStorage.setItem('fiire_claude_key', key);
  const status = document.getElementById('claude-key-status');
  if (status) status.innerHTML = key
    ? '<span class="w-2 h-2 rounded bg-emerald-400 flex-shrink-0"></span><span class="text-xs text-emerald-400 font-medium">Key saved</span>'
    : '<span class="w-2 h-2 rounded bg-txt-dim flex-shrink-0"></span><span class="text-xs text-txt-dim font-medium">Key removed</span>';
  showToast(key ? 'Claude key saved' : 'Claude key removed');
}

// ==================== DATA MANAGEMENT ====================
function clearAllDataConfirm() {
  closeSettingsModal();
  document.getElementById('confirm-title').textContent = 'Clear All Data';
  document.getElementById('confirm-msg').textContent = 'This will delete all samples, projects, and cached audio. This cannot be undone.';
  document.getElementById('confirm-action').onclick = () => {
    localStorage.removeItem('fiire_samples');
    localStorage.removeItem('fiire_sessions');
    localStorage.removeItem('fiire_decisions');
    localStorage.removeItem('fiire_counters');
    localStorage.removeItem('fiire_projects');
    localStorage.removeItem('fiire_current_project');
    Object.keys(localStorage).filter(k => k.startsWith('fiire_dna_')).forEach(k => localStorage.removeItem(k));
    try { indexedDB.deleteDatabase(AUDIO_DB_NAME); } catch(e) {}
    closeModal();
    showToast('All data cleared \u2014 reloading...');
    setTimeout(() => location.reload(), 1000);
  };
  document.getElementById('confirm-modal').classList.add('open');
}

// ==================== KEYBOARD SHORTCUTS ====================
function getNavigableSamples() {
  return Object.values(samples)
    .filter(s => s.projectId === currentProjectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function navigateSample(direction) {
  const list = getNavigableSamples();
  if (!list.length) return;
  if (!state.currentSample) { previewSample(list[0].id); return; }
  const idx = list.findIndex(s => s.id === state.currentSample);
  const next = idx + direction;
  if (next >= 0 && next < list.length) previewSample(list[next].id);
}

document.addEventListener('keydown', e => {
  if (e.code === 'Escape') { closeModal(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space' && state.currentSample) { e.preventDefault(); togglePlayPause(); }
});

// ==================== LIBRARY ====================
let libraryGlobalMode = false; // Set to true on home page for cross-project library

function openInspector(id) {
  const s = samples[id];
  if (!s) return;
  const panel = document.getElementById('inspector-panel');
  if (!panel) return;
  state.inspectedSample = id;
  panel.style.display = 'flex';
  document.getElementById('inspector-title').textContent = s.name;
  const badge = document.getElementById('inspector-type-badge');
  badge.textContent = s.type === 'loop' ? 'Loop' : 'One-Shot';
  badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase ' + (s.type === 'loop' ? 'badge-loop' : 'badge-oneshot');
  const meta = buildSampleMeta(s, ' / ', true);
  document.getElementById('inspector-meta').textContent = meta;

  requestAnimationFrame(() => {
    drawWaveform(document.getElementById('inspector-waveform'), s.waveformData, '#E85002');
  });

  document.getElementById('inspector-notes').value = s.notes || '';
  updateInspectorFav();
}

function closeInspector() {
  const panel = document.getElementById('inspector-panel');
  if (panel) panel.style.display = 'none';
  state.inspectedSample = null;
}

function playSampleFromInspector() {
  if (state.inspectedSample) previewSample(state.inspectedSample);
}

function updateSampleNotes() {
  const s = samples[state.inspectedSample];
  if (s) { s.notes = document.getElementById('inspector-notes').value; saveData(); }
}

function getLibrarySamples(options) {
  options = options || {};
  let list = Object.values(samples).filter(s => {
    if (!s.isInLibrary || s.status !== 'accepted') return false;
    if (!options.global && s.projectId !== currentProjectId) return false;
    return true;
  });
  const search = (document.getElementById('lib-search')?.value || '').toLowerCase();
  const type = state.libraryType;
  const key = document.getElementById('lib-key-filter')?.value;
  const sort = document.getElementById('lib-sort')?.value;

  const source = document.getElementById('lib-source-filter')?.value;
  if (source && source !== 'all') {
    if (source === 'dna') list = list.filter(s => s.name && s.name.startsWith('DNA '));
    else list = list.filter(s => s.projectId === source);
  }

  if (search) list = list.filter(s => s.name.toLowerCase().includes(search) || s.tags.some(t => t.toLowerCase().includes(search)) || (s.key || '').toLowerCase().includes(search));
  if (type === 'favorites') list = list.filter(s => s.isFavorite);
  else if (type !== 'all') list = list.filter(s => s.type === type);
  if (key && key !== 'all') list = list.filter(s => s.key === key);

  if (sort === 'recent') list.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === 'oldest') list.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'bpm') list.sort((a, b) => (a.bpm || 0) - (b.bpm || 0));
  return list;
}

function renderLibrary(options) {
  options = options || (libraryGlobalMode ? { global: true } : {});
  const list = getLibrarySamples(options);
  const gridEl = document.getElementById('lib-grid');
  const listEl = document.getElementById('lib-list');
  const emptyEl = document.getElementById('lib-empty');

  if (!list.length) {
    gridEl.classList.add('hidden'); listEl.classList.add('hidden'); emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  if (state.libraryView === 'grid') {
    gridEl.classList.remove('hidden'); listEl.classList.add('hidden');
    gridEl.innerHTML = list.map(s => renderSampleCard(s, options)).join('');
    requestAnimationFrame(() => {
      gridEl.querySelectorAll('.lib-waveform').forEach(canvas => {
        const s = samples[canvas.dataset.id];
        if (s) drawWaveform(canvas, s.waveformData, '#E85002');
      });
    });
  } else {
    gridEl.classList.add('hidden'); listEl.classList.remove('hidden');
    document.getElementById('lib-tbody').innerHTML = list.map(s => `
      <tr class="group hover:bg-surface/40 transition-colors cursor-pointer" onclick="previewSample('${s.id}')">
        <td class="px-4 py-3" onclick="event.stopPropagation()"><input type="checkbox" class="rounded border-border" ${state.selectedSamples.has(s.id) ? 'checked' : ''} onchange="toggleSampleSelect('${s.id}')"/></td>
        <td class="px-4 py-3"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded bg-bg overflow-hidden"><canvas class="lib-waveform-row w-full h-full" data-id="${s.id}" width="40" height="40"></canvas></div><span class="font-bold text-sm">${s.name}</span></div></td>
        <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${s.type === 'loop' ? 'badge-loop' : 'badge-oneshot'}">${s.type}</span></td>
        <td class="px-4 py-3 text-sm text-txt-muted">${s.key || '-'}</td>
        <td class="px-4 py-3 text-sm text-txt-muted">${s.bpm || '-'}</td>
        <td class="px-4 py-3 text-sm text-txt-muted font-mono">${formatTime(s.duration)}</td>
        <td class="px-4 py-3 text-right"><div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="p-1.5 hover:bg-dk-gray rounded text-txt-muted hover:text-brand" onclick="event.stopPropagation(); toggleSampleFavorite('${s.id}')"><span class="material-symbols-outlined text-[18px] ${s.isFavorite ? 'fill-1 text-brand' : ''}">favorite</span></button>
          <button class="p-1.5 hover:bg-dk-gray rounded text-txt-muted" onclick="event.stopPropagation(); downloadSample('${s.id}')"><span class="material-symbols-outlined text-[18px]">download</span></button>
          <button class="p-1.5 hover:bg-dk-gray rounded text-txt-muted" onclick="event.stopPropagation(); deleteSampleConfirm('${s.id}')"><span class="material-symbols-outlined text-[18px]">delete</span></button>
        </div></td>
      </tr>`).join('');
    requestAnimationFrame(() => {
      document.querySelectorAll('.lib-waveform-row').forEach(c => {
        const s = samples[c.dataset.id];
        if (s) drawMiniWaveform(c, s.waveformData, '#E85002');
      });
    });
  }
  updateBatchBar();
}

function renderSampleCard(s, options) {
  const meta = buildSampleMeta(s, ' / ');
  const projBadge = options?.global ? '<span class="text-[9px] text-txt-dim">' + (projects[s.projectId]?.name || '') + '</span>' : '';
  return `
    <div class="sample-card group bg-panel p-3 rounded border border-border cursor-pointer ${state.selectedSamples.has(s.id) ? 'selected' : ''}"
         data-id="${s.id}" onclick="previewSample('${s.id}')">
      <div class="relative rounded overflow-hidden mb-3 bg-bg h-24">
        <canvas class="lib-waveform w-full h-full" data-id="${s.id}"></canvas>
        <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <div class="w-10 h-10 bg-brand text-txt rounded flex items-center justify-center">
            <span class="material-symbols-outlined text-[24px] fill-1">play_arrow</span>
          </div>
        </div>
        <span class="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/75 text-[10px] font-mono text-txt rounded">${formatTime(s.duration)}</span>
        <span class="absolute top-2 left-2 px-2 py-0.5 bg-black/70 text-[10px] font-bold rounded uppercase ${s.type === 'loop' ? 'text-brand' : 'text-blue-400'}">${s.type}</span>
      </div>
      <div class="flex items-center justify-between">
        <div class="min-w-0 flex-1">
          <h4 class="font-bold text-sm truncate">${s.name}</h4>
          <p class="text-[10px] text-txt-muted">${meta}</p>
          ${projBadge}
        </div>
        <button class="p-1.5 text-txt-muted hover:text-brand flex-shrink-0" onclick="event.stopPropagation(); toggleSampleFavorite('${s.id}')">
          <span class="material-symbols-outlined text-[18px] ${s.isFavorite ? 'fill-1 text-brand' : ''}">favorite</span>
        </button>
      </div>
    </div>`;
}

function setLibType(type, btn) {
  state.libraryType = type;
  btn.closest('.flex').querySelectorAll('.param-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderLibrary();
}

function setLibView(view) {
  state.libraryView = view;
  document.getElementById('lib-grid-btn').classList.toggle('text-brand', view === 'grid');
  document.getElementById('lib-grid-btn').classList.toggle('text-txt-muted', view !== 'grid');
  document.getElementById('lib-grid-btn').classList.toggle('bg-surface', view === 'grid');
  document.getElementById('lib-grid-btn').classList.toggle('border', view === 'grid');
  document.getElementById('lib-grid-btn').classList.toggle('border-border', view === 'grid');
  document.getElementById('lib-list-btn').classList.toggle('text-brand', view === 'list');
  document.getElementById('lib-list-btn').classList.toggle('text-txt-muted', view !== 'list');
  document.getElementById('lib-list-btn').classList.toggle('bg-surface', view === 'list');
  document.getElementById('lib-list-btn').classList.toggle('border', view === 'list');
  document.getElementById('lib-list-btn').classList.toggle('border-border', view === 'list');
  renderLibrary();
}

function toggleSampleSelect(id) {
  if (state.selectedSamples.has(id)) state.selectedSamples.delete(id);
  else state.selectedSamples.add(id);
  updateBatchBar();
  renderLibrary();
}

function toggleSelectAll(checkbox) {
  const list = getLibrarySamples();
  if (checkbox.checked) list.forEach(s => state.selectedSamples.add(s.id));
  else state.selectedSamples.clear();
  updateBatchBar();
  renderLibrary();
}

function updateBatchBar() {
  const bar = document.getElementById('lib-batch-bar');
  if (!bar) return;
  if (state.selectedSamples.size > 0) {
    bar.classList.remove('hidden');
    document.getElementById('batch-count').textContent = state.selectedSamples.size;
    bar.style.bottom = state.currentSample ? '64px' : '0px';
  } else {
    bar.classList.add('hidden');
  }
}

function favoriteSelected() {
  state.selectedSamples.forEach(id => {
    const s = samples[id]; if (s && !s.isFavorite) { s.isFavorite = true; s.favoritedAt = Date.now(); }
  });
  saveData(); renderLibrary(); showToast(`${state.selectedSamples.size} samples favorited`);
}

function deleteSampleConfirm(id) {
  const s = samples[id]; if (!s) return;
  document.getElementById('confirm-title').textContent = 'Delete Sample';
  document.getElementById('confirm-msg').textContent = `Are you sure you want to delete "${s.name}"?`;
  document.getElementById('confirm-action').onclick = () => { deleteSample(id); closeModal(); };
  document.getElementById('confirm-modal').classList.add('open');
}

function deleteSample(id) {
  delete samples[id];
  delete audioBuffers[id];
  deleteAudioBlob(id);
  state.selectedSamples.delete(id);
  saveData();
  if (state.currentSample === id) { state.currentSample = null; stopCurrentSource(); document.getElementById('player-bar').style.display = 'none'; }
  if (state.inspectedSample === id) closeInspector();
  renderLibrary();
  showToast('Sample deleted');
}

function deleteSelected() {
  if (state.selectedSamples.size === 0) return;
  document.getElementById('confirm-title').textContent = 'Delete Samples';
  document.getElementById('confirm-msg').textContent = `Delete ${state.selectedSamples.size} selected samples?`;
  document.getElementById('confirm-action').onclick = () => {
    state.selectedSamples.forEach(id => { delete samples[id]; delete audioBuffers[id]; deleteAudioBlob(id); });
    state.selectedSamples.clear();
    saveData(); closeModal(); renderLibrary(); showToast('Samples deleted');
  };
  document.getElementById('confirm-modal').classList.add('open');
}

let importSelectedIds = new Set();

function openImportModal() {
  importSelectedIds.clear();
  const select = document.getElementById('import-project-select');
  select.innerHTML = '<option value="">Select a project...</option>';
  Object.values(projects).filter(p => p.id !== currentProjectId).forEach(p => {
    const count = Object.values(samples).filter(s => s.projectId === p.id && s.isInLibrary).length;
    select.innerHTML += `<option value="${p.id}">${p.name} (${count} samples)</option>`;
  });
  document.getElementById('import-sample-list').innerHTML = '<p class="text-sm text-txt-dim text-center py-8">Select a project to see its samples</p>';
  document.getElementById('import-selected-count').textContent = '0';
  document.getElementById('import-modal').classList.add('open');
}

function renderImportList() {
  const projectId = document.getElementById('import-project-select').value;
  const listEl = document.getElementById('import-sample-list');
  importSelectedIds.clear();
  document.getElementById('import-selected-count').textContent = '0';

  if (!projectId) {
    listEl.innerHTML = '<p class="text-sm text-txt-dim text-center py-8">Select a project to see its samples</p>';
    return;
  }

  const projectSamples = Object.values(samples).filter(s => s.projectId === projectId && s.isInLibrary);
  if (!projectSamples.length) {
    listEl.innerHTML = '<p class="text-sm text-txt-dim text-center py-8">No samples in this project</p>';
    return;
  }

  listEl.innerHTML = projectSamples.map(s => {
    const meta = buildSampleMeta(s, ' / ');
    const typeBadge = s.type === 'loop' ? 'badge-loop' : 'badge-oneshot';
    return `
      <label class="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-surface transition-colors cursor-pointer border border-transparent has-[:checked]:border-brand/30 has-[:checked]:bg-brand/5">
        <input type="checkbox" class="rounded border-border text-brand" value="${s.id}" onchange="toggleImportSelect(this)"/>
        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${typeBadge}">${s.type}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${s.name}</p>
          <p class="text-[10px] text-txt-dim">${meta}</p>
        </div>
        <span class="text-[10px] font-mono text-txt-dim">${formatTime(s.duration)}</span>
      </label>`;
  }).join('');
}

function toggleImportSelect(checkbox) {
  if (checkbox.checked) importSelectedIds.add(checkbox.value);
  else importSelectedIds.delete(checkbox.value);
  document.getElementById('import-selected-count').textContent = importSelectedIds.size;
}

function importSelectedSamples() {
  if (!importSelectedIds.size) { showToast('No samples selected'); return; }
  let count = 0;
  importSelectedIds.forEach(originalId => {
    const original = samples[originalId];
    if (!original) return;
    const newId = uid('smp');
    samples[newId] = {
      ...JSON.parse(JSON.stringify(original)),
      id: newId,
      projectId: currentProjectId,
      createdAt: Date.now(),
      waveformData: [...original.waveformData],
    };
    count++;
  });
  importSelectedIds.clear();
  saveData();
  closeModal();
  renderLibrary();
  renderProjectSwitcher();
  showToast(`${count} sample${count !== 1 ? 's' : ''} imported!`);
}

// ==================== INIT ====================
loadData();
migrateToProjects();
migratePadsToProjects();
syncPadAssignments();

// Pre-generate audio on first user interaction
document.addEventListener('click', function initAudioOnGesture() {
  document.removeEventListener('click', initAudioOnGesture);
  ensureAudioContext();
  Object.keys(samples).forEach((sid, i) => {
    setTimeout(() => getAudioBuffer(sid), i * 50);
  });
}, { once: true });
