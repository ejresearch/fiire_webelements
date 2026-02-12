/* ==================== FIIRE STUDIO JS ==================== */
/* DAW Workspace: Base Samples, Sample Bar, Track Timeline    */
/* Depends on: shared.js (loaded first)                       */

// ==================== REFERENCE AUDIO ====================
let referenceBuffer = null;
let referenceFile = null;
let referenceSource = null;

function handleRefUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  referenceFile = file;

  ensureAudioContext();
  const reader = new FileReader();
  reader.onload = (e) => {
    audioCtx.decodeAudioData(e.target.result).then(buf => {
      referenceBuffer = buf;
      document.getElementById('ref-indicator').classList.remove('hidden');
      document.getElementById('ref-filename').textContent = file.name;
      document.getElementById('ref-duration').textContent = buf.duration.toFixed(1) + 's';
      showToast('Reference audio loaded');
    }).catch(() => {
      showToast('Could not decode audio file');
      removeReference();
    });
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

function playReference() {
  if (!referenceBuffer) return;
  ensureAudioContext();
  if (referenceSource) {
    try { referenceSource.stop(); } catch(e) {}
    referenceSource = null;
    document.querySelector('#ref-play-btn .material-symbols-outlined').textContent = 'play_arrow';
    return;
  }
  referenceSource = audioCtx.createBufferSource();
  referenceSource.buffer = referenceBuffer;
  referenceSource.connect(masterGain);
  referenceSource.onended = () => {
    referenceSource = null;
    document.querySelector('#ref-play-btn .material-symbols-outlined').textContent = 'play_arrow';
  };
  referenceSource.start(0);
  document.querySelector('#ref-play-btn .material-symbols-outlined').textContent = 'stop';
}

function removeReference() {
  if (referenceSource) { try { referenceSource.stop(); } catch(e) {} referenceSource = null; }
  referenceBuffer = null;
  referenceFile = null;
  document.getElementById('ref-indicator').classList.add('hidden');
}

// ==================== MODE / PARAM CONTROLS ====================
function toggleParams() {}

function setVarCount(count, el) {
  state.varCount = count;
  document.querySelectorAll('#varcount-chips .param-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function setGenerateMode(mode) {
  state.generateMode = mode;
  const loopEl = document.getElementById('loop-params');
  const osEl = document.getElementById('oneshot-params');
  if (mode === 'loop') {
    loopEl.style.display = 'flex';
    osEl.style.display = 'none';
  } else {
    loopEl.style.display = 'none';
    osEl.style.display = 'flex';
  }
  document.querySelectorAll('input[name="gen-mode"]').forEach(r => { r.checked = r.value === mode; });
}

function setLength(bars, el) {
  state.selectedBars = bars;
  document.querySelectorAll('#length-chips .param-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function toggleChip(el, containerId) {
  document.querySelectorAll('#' + containerId + ' .param-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function toggleMultiChip(el) {
  el.classList.toggle('active');
}

// ==================== PROMPT BUILDING ====================
function getGenParams() {
  const mode = state.generateMode;
  const styles = [...document.querySelectorAll('#style-chips .param-chip.active')].map(c => resolveChipLabel(c.textContent.trim()));
  const instrument = resolveChipLabel(document.querySelector('#instrument-chips .param-chip.active')?.textContent.trim() || 'DRUMS');
  const energy = resolveChipLabel(document.querySelector('#energy-chips .param-chip.active')?.textContent.trim() || 'MID');
  const prompt = document.getElementById('gen-prompt').value;
  const model = 'eleven_text_to_sound_v2';
  const varCount = state.varCount || 4;

  if (mode === 'loop') {
    const bpmVal = document.getElementById('bpm-input').value;
    const keyVal = document.getElementById('key-select').value;
    return {
      type: 'loop', bpm: bpmVal ? parseInt(bpmVal) : null,
      key: keyVal === 'auto' ? null : keyVal,
      bars: state.selectedBars,
      instrument, energy, styles, prompt, model, varCount
    };
  } else {
    const attack = resolveChipLabel(document.querySelector('#attack-chips .param-chip.active')?.textContent.trim() || 'SNP');
    const timbre = resolveChipLabel(document.querySelector('#timbre-chips .param-chip.active')?.textContent.trim() || 'WRM');
    return {
      type: 'oneshot', tuning: document.getElementById('tuning-select').value,
      attack, timbre, instrument, energy, styles, prompt, model, varCount
    };
  }
}

function buildSfxPrompt(params) {
  const parts = [];
  const inst = params.instrument || 'drums';
  if (params.type === 'loop') {
    if (params.energy) parts.push(params.energy);
    if (params.bpm) parts.push(`${params.bpm} BPM`);
    if (params.key) parts.push(`${params.key}`);
    if (params.styles?.length) parts.push(params.styles.join(', '));
    parts.push(instrumentPromptMap[inst] || 'drum loop');
    if (params.bars) parts.push(`${params.bars} bars`);
  } else {
    if (params.energy) parts.push(params.energy);
    if (params.attack) parts.push(String(params.attack).toLowerCase());
    if (params.timbre) parts.push(String(params.timbre).toLowerCase());
    if (params.styles?.length) parts.push(params.styles.join(', '));
    parts.push(instrumentOneshotMap[inst] || 'one-shot percussion hit');
    if (params.tuning) parts.push(`tuned to ${params.tuning}`);
  }
  if (params.prompt) parts.push(params.prompt);
  if (referenceBuffer) {
    const refDur = referenceBuffer.duration.toFixed(1);
    parts.push(`similar style to reference track (${refDur}s)`);
  }
  return parts.join(', ');
}

function calcDuration(params) {
  if (params.type === 'loop') {
    const bpm = params.bpm || 120;
    const bars = params.bars || 4;
    const secsPerBeat = 60 / bpm;
    return Math.min(30, Math.max(0.5, bars * secsPerBeat * (bpm < 100 ? 2 : 1)));
  }
  return 1.5;
}

// ==================== GENERATION ====================
function setGeneratingUI(active) {
  const btn = document.getElementById('gen-btn');
  const btnText = document.getElementById('gen-btn-text');
  const btnIcon = btn?.querySelector('.material-symbols-outlined');
  if (!btn) return;
  if (active) {
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    btnText.textContent = 'Generating...';
    if (btnIcon) { btnIcon.textContent = 'progress_activity'; btnIcon.classList.add('animate-spin'); }
  } else {
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
    btnText.textContent = 'GENERATE';
    if (btnIcon) { btnIcon.textContent = 'bolt'; btnIcon.classList.remove('animate-spin'); }
  }
}

function generateSamples() {
  if (state.generating) return;
  state.generating = true;
  setGeneratingUI(true);
  const params = getGenParams();
  const useAPI = ELEVENLABS_API_KEY && ELEVENLABS_API_KEY.length > 0;

  document.getElementById('gen-loading').classList.remove('hidden');
  document.getElementById('var-grid').innerHTML = '';

  // Mark which base slot we're generating into
  if (state.inlineGenSlot !== null) {
    const slot = document.querySelector(`.base-slot[data-index="${state.inlineGenSlot}"]`);
    if (slot) slot.classList.add('generating');
  }

  const sessionId = uid('ses');
  const variationIds = [];
  const duration = calcDuration(params);
  const sfxPrompt = buildSfxPrompt(params);
  const isLoop = params.type === 'loop';

  for (let i = 0; i < params.varCount; i++) {
    const id = uid('smp');
    samples[id] = {
      id, type: params.type,
      name: params.type === 'loop' ? `Loop ${Object.keys(samples).length + 1}` : `One-Shot ${Object.keys(samples).length + 1}`,
      status: 'pending',
      duration: Math.round(duration * 100) / 100,
      bpm: params.bpm || null,
      key: params.key || null,
      bars: params.bars || null,
      tuning: params.tuning || null,
      attack: params.attack || null,
      timbre: params.timbre || null,
      style: params.styles || [],
      tags: params.styles ? [...params.styles] : [],
      notes: '',
      effects: {},
      generationSessionId: sessionId,
      variationIndex: i,
      parentSampleId: null,
      modelVersion: useAPI ? 'ElevenLabs SFX v2' : 'Synthetic',
      createdAt: Date.now() - (params.varCount - i) * 100,
      acceptedAt: null,
      favoritedAt: null,
      isFavorite: false,
      isInLibrary: false,
      rejectionFeedback: null,
      waveformData: placeholderWaveform(80),
      projectId: currentProjectId,
    };
    variationIds.push(id);
  }

  sessions[sessionId] = {
    id: sessionId, type: params.type, params,
    variationIds, acceptedCount: 0, rejectedCount: 0,
    createdAt: Date.now(),
    projectId: currentProjectId,
  };

  currentVariations = variationIds;
  saveData();

  if (!useAPI) {
    state.generating = false;
    setGeneratingUI(false);
    renderVariations();
    document.getElementById('gen-loading').classList.add('hidden');
    showToast('No API key — generated synthetic placeholders');
    ensureAudioContext();
    variationIds.forEach(vid => getAudioBuffer(vid));
    if (state.inlineGenSlot !== null) {
      const slot = document.querySelector(`.base-slot[data-index="${state.inlineGenSlot}"]`);
      if (slot) slot.classList.remove('generating');
    }
    return;
  }

  let completed = 0;
  let failed = 0;

  variationIds.forEach((vid, i) => {
    setTimeout(() => {
      callElevenLabsSfx(sfxPrompt, duration, isLoop, params.model)
        .then(pcmData => {
          ensureAudioContext();
          const buf = pcmToAudioBuffer(pcmData, 44100);
          samples[vid].duration = buf.duration;
          cacheAndPersistBuffer(vid, buf);
          saveData();
        })
        .catch(err => {
          console.error(`Generation failed for ${vid}:`, err);
          failed++;
          ensureAudioContext();
          getAudioBuffer(vid);
        })
        .finally(() => {
          completed++;
          if (completed === variationIds.length) {
            state.generating = false;
            setGeneratingUI(false);
            renderVariations();
            document.getElementById('gen-loading').classList.add('hidden');
            if (state.inlineGenSlot !== null) {
              const slot = document.querySelector(`.base-slot[data-index="${state.inlineGenSlot}"]`);
              if (slot) slot.classList.remove('generating');
            }
            if (failed > 0) {
              showToast(`Generated ${completed - failed} samples (${failed} fell back to synthetic)`);
            } else {
              showToast(`Generated ${completed} samples from ElevenLabs!`);
            }
          }
        });
    }, i * 500);
  });
}

// ==================== VARIATIONS ====================
function renderVariations() {
  const container = document.getElementById('var-grid');
  if (!container) return;
  const list = currentVariations.map(id => samples[id]).filter(Boolean);

  if (!list.length) {
    container.innerHTML = '';
    document.getElementById('gen-summary')?.classList.add('hidden');
    return;
  }

  container.className = 'divide-y divide-border';
  container.innerHTML = list.map(s => renderStackRow(s)).join('');

  const kept = list.filter(s => s.status === 'accepted');
  const total = list.length;
  const summaryEl = document.getElementById('gen-summary');
  if (summaryEl && (kept.length > 0 || list.some(s => s.status === 'rejected'))) {
    const lastName = kept.length > 0 ? kept[kept.length - 1].name : '';
    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
      <span class="text-[10px] text-txt-muted">Kept <strong class="text-txt">${kept.length}</strong> of ${total}</span>
      ${kept.length > 0 ? `<button class="flex items-center gap-1 text-[10px] text-brand hover:text-brand-hover font-medium transition-colors" onclick="generateMoreLike('${kept[kept.length - 1].id}')">
        <span class="material-symbols-outlined text-[12px]">refresh</span> More like "${lastName}"
      </button>` : ''}`;
  } else if (summaryEl) {
    summaryEl.classList.add('hidden');
  }

  requestAnimationFrame(() => {
    document.querySelectorAll('.var-waveform').forEach(canvas => {
      const id = canvas.dataset.id;
      const s = samples[id];
      if (s) drawWaveform(canvas, s.waveformData, s.status === 'rejected' ? '#3D3D3D' : '#E85002');
    });
  });
}

function renderStackRow(s) {
  const id = s.id;
  const isPlaying = state.currentSample === id && state.isPlaying;
  const meta = buildSampleMeta(s);
  const typeBadge = s.type === 'loop' ? 'badge-loop' : 'badge-oneshot';

  if (s.status === 'rejected') {
    return `
    <div class="variation-card skipped flex items-center gap-2 px-3 py-1 opacity-35 hover:opacity-50 transition-opacity" data-id="${id}">
      <button class="w-6 h-6 flex items-center justify-center flex-shrink-0" onclick="previewSample('${id}')">
        <span class="material-symbols-outlined text-[16px] text-txt-dim">${isPlaying ? 'pause' : 'play_arrow'}</span>
      </button>
      <canvas class="var-waveform flex-shrink-0 h-6" style="width:80px;" data-id="${id}"></canvas>
      <span class="text-[11px] text-txt-dim flex-shrink-0 w-24 truncate">${s.name}</span>
      <span class="text-[9px] font-mono text-txt-dim flex-shrink-0">${formatTime(s.duration)}</span>
      <button class="text-[10px] text-txt-muted hover:text-txt ml-auto transition-colors uppercase font-bold" onclick="undoSkip('${id}')">UNDO</button>
    </div>`;
  }

  if (s.status === 'accepted') {
    return `
    <div class="variation-card kept flex items-center gap-2 px-3 py-1.5 ${isPlaying ? 'playing' : ''}" data-id="${id}">
      <button class="w-6 h-6 flex items-center justify-center flex-shrink-0 hover:text-brand transition-colors" onclick="previewSample('${id}')">
        <span class="material-symbols-outlined text-[16px] fill-1 ${isPlaying ? 'text-brand' : 'text-txt-muted'}">${isPlaying ? 'pause' : 'play_arrow'}</span>
      </button>
      <canvas class="var-waveform flex-shrink-0 h-6" style="width:80px;" data-id="${id}"></canvas>
      <span class="text-[11px] font-medium flex-shrink-0 w-24 truncate">${s.name}</span>
      <span class="text-[9px] text-txt-dim font-mono flex-shrink-0 w-20">${meta}</span>
      <span class="text-[9px] font-mono text-txt-dim flex-shrink-0 w-8">${formatTime(s.duration)}</span>
      <span class="text-[9px] font-bold uppercase ${typeBadge} px-1 flex-shrink-0">${s.type}</span>
      <span class="material-symbols-outlined text-emerald-400 text-[12px] flex-shrink-0">check_circle</span>
    </div>`;
  }

  // Pending
  return `
    <div class="variation-card flex items-center gap-2 px-3 py-1.5 ${isPlaying ? 'playing' : ''}" data-id="${id}">
      <button class="w-6 h-6 flex items-center justify-center flex-shrink-0 hover:text-brand transition-colors" onclick="previewSample('${id}')">
        <span class="material-symbols-outlined text-[16px] fill-1 ${isPlaying ? 'text-brand' : 'text-txt-muted'}">${isPlaying ? 'pause' : 'play_arrow'}</span>
      </button>
      <canvas class="var-waveform flex-shrink-0 h-6" style="width:80px;" data-id="${id}"></canvas>
      <span class="text-[11px] font-medium flex-shrink-0 w-24 truncate">${s.name}</span>
      <span class="text-[9px] text-txt-dim font-mono flex-shrink-0 w-20">${meta}</span>
      <span class="text-[9px] font-mono text-txt-dim flex-shrink-0 w-8">${formatTime(s.duration)}</span>
      <span class="text-[9px] font-bold uppercase ${typeBadge} px-1 flex-shrink-0">${s.type}</span>
      <div class="flex items-center gap-1 ml-auto flex-shrink-0">
        <button class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/20 transition-colors uppercase" onclick="event.stopPropagation(); keepVariation('${id}')">KEEP</button>
        <button class="px-2 py-0.5 text-txt-dim text-[10px] hover:bg-surface-hi hover:text-txt-muted transition-colors uppercase" onclick="event.stopPropagation(); skipVariation('${id}')">SKIP</button>
      </div>
    </div>`;
}

// ==================== KEEP / SKIP ====================
function keepVariation(id) {
  const s = samples[id];
  if (!s || s.status !== 'pending') return;
  s.status = 'accepted';
  s.acceptedAt = Date.now();
  s.isInLibrary = true;
  const session = sessions[s.generationSessionId];
  if (session) session.acceptedCount++;
  decisions.push({ sampleId: id, action: 'keep', timestamp: Date.now() });

  // Load into the base sample slot if inline generating
  if (state.inlineGenSlot !== null) {
    state.baseSamples[state.inlineGenSlot] = id;
    saveData();
    renderVariations();
    closeInlineGeneration();
    renderBaseSamples();
    renderSampleBar();
    showToast(`Kept & loaded to slot ${state.inlineGenSlot + 1}`);
  } else {
    saveData();
    renderVariations();
    renderSampleBar();
    showToast('Kept — added to library');
  }
}

function skipVariation(id) {
  const s = samples[id];
  if (!s || s.status !== 'pending') return;
  s.status = 'rejected';
  const session = sessions[s.generationSessionId];
  if (session) session.rejectedCount++;
  decisions.push({ sampleId: id, action: 'skip', timestamp: Date.now() });
  saveData();
  renderVariations();
}

function undoSkip(id) {
  const s = samples[id];
  if (!s || s.status !== 'rejected') return;
  s.status = 'pending';
  const session = sessions[s.generationSessionId];
  if (session && session.rejectedCount > 0) session.rejectedCount--;
  decisions.push({ sampleId: id, action: 'unskip', timestamp: Date.now() });
  saveData();
  renderVariations();
}

function generateMoreLike(id) {
  const s = samples[id];
  if (!s) return;
  const prompt = document.getElementById('gen-prompt');
  const meta = buildSampleMeta(s, ' ');
  const styles = s.style && s.style.length ? s.style.join(' ') : '';
  prompt.value = `More like "${s.name}" — ${styles} ${s.type}, ${meta}`.trim();
  generateSamples();
}

// ==================== BASE SAMPLES ====================
function renderBaseSamples() {
  const container = document.getElementById('base-samples-grid');
  if (!container) return;

  const loadedCount = state.baseSamples.filter(Boolean).length;
  const countEl = document.getElementById('base-count');
  if (countEl) countEl.textContent = `${loadedCount} / 12`;

  let html = '';
  for (let i = 0; i < 12; i++) {
    const sampleId = state.baseSamples[i];
    const sample = sampleId ? samples[sampleId] : null;

    if (sample) {
      const meta = buildSampleMeta(sample);
      html += `<div class="base-slot loaded" data-index="${i}" draggable="true" ondragstart="handleSampleDragStart(event, '${sampleId}')" onclick="previewSample('${sampleId}')">
        <div class="slot-actions">
          <button class="w-4 h-4 bg-bg/80 flex items-center justify-center text-txt-dim hover:text-red-400 transition-colors" onclick="event.stopPropagation(); removeFromBaseSamples(${i})" title="Remove">
            <span class="material-symbols-outlined text-[10px]">close</span>
          </button>
        </div>
        <canvas class="slot-waveform w-full" data-id="${sampleId}"></canvas>
        <div class="slot-meta">
          <div class="text-txt truncate">${sample.name}</div>
          <div class="text-txt-dim text-[8px] font-mono mt-0.5">${meta}</div>
        </div>
      </div>`;
    } else {
      html += `<div class="base-slot empty flex items-center justify-center" data-index="${i}" onclick="openInlineGeneration(${i})">
        <span class="material-symbols-outlined text-[20px] text-txt-dim">add</span>
      </div>`;
    }
  }
  container.innerHTML = html;

  // Draw waveforms for loaded slots
  requestAnimationFrame(() => {
    container.querySelectorAll('.slot-waveform').forEach(canvas => {
      const id = canvas.dataset.id;
      const s = samples[id];
      if (s) drawWaveform(canvas, s.waveformData, '#E85002');
    });
  });
}

function addToBaseSamples(sampleId) {
  const emptyIdx = state.baseSamples.indexOf(null);
  if (emptyIdx === -1) {
    showToast('Base samples full (12 max)');
    return;
  }
  state.baseSamples[emptyIdx] = sampleId;
  saveData();
  renderBaseSamples();
}

function removeFromBaseSamples(index) {
  state.baseSamples[index] = null;
  saveData();
  renderBaseSamples();
}

function openNextEmptySlot() {
  const emptyIdx = state.baseSamples.indexOf(null);
  if (emptyIdx === -1) {
    showToast('All slots full');
    return;
  }
  openInlineGeneration(emptyIdx);
}

// ==================== SAMPLE BAR (RACK) ====================
function renderSampleBar() {
  const container = document.getElementById('sample-bar-slots');
  const emptyEl = document.getElementById('bar-empty');
  if (!container) return;

  // Collect favorites + recent accepted, deduplicate, limit to 20
  const projectSamples = Object.values(samples).filter(s =>
    s.projectId === currentProjectId && s.isInLibrary
  );
  const favs = projectSamples.filter(s => s.isFavorite).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
  const recent = projectSamples.filter(s => !s.isFavorite).sort((a, b) => (b.acceptedAt || b.createdAt) - (a.acceptedAt || a.createdAt));
  const combined = [...favs, ...recent].slice(0, 20);

  if (!combined.length) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  container.innerHTML = combined.map(s => {
    const isPlaying = state.currentSample === s.id && state.isPlaying;
    return `<div class="bar-slot ${isPlaying ? 'playing' : ''}" title="${s.name}" draggable="true" ondragstart="handleSampleDragStart(event, '${s.id}')" onclick="previewSample('${s.id}')">
      <canvas class="bar-waveform" data-id="${s.id}" width="36" height="36"></canvas>
    </div>`;
  }).join('');

  requestAnimationFrame(() => {
    container.querySelectorAll('.bar-waveform').forEach(canvas => {
      const id = canvas.dataset.id;
      const s = samples[id];
      if (s) drawMiniWaveform(canvas, s.waveformData, '#E85002');
    });
  });
}

// ==================== INLINE GENERATION ====================
function openInlineGeneration(slotIndex) {
  state.inlineGenSlot = slotIndex;
  currentVariations = [];

  const panel = document.getElementById('inline-gen-panel');
  const backdrop = document.getElementById('inline-gen-backdrop');
  if (!panel || !backdrop) return;

  // Position near the slot
  const slotEl = document.querySelector(`.base-slot[data-index="${slotIndex}"]`);
  if (slotEl) {
    const rect = slotEl.getBoundingClientRect();
    panel.style.left = Math.max(8, rect.left) + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';
  } else {
    panel.style.left = '220px';
    panel.style.top = '200px';
  }

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');

  // Reset gen panel state
  document.getElementById('var-grid').innerHTML = '';
  document.getElementById('gen-loading').classList.add('hidden');
  document.getElementById('gen-summary')?.classList.add('hidden');

  // Focus prompt
  setTimeout(() => document.getElementById('gen-prompt')?.focus(), 50);
}

function closeInlineGeneration() {
  state.inlineGenSlot = null;
  const panel = document.getElementById('inline-gen-panel');
  const backdrop = document.getElementById('inline-gen-backdrop');
  if (panel) panel.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
}

// ==================== TIMELINE RENDERING ====================
const PIXELS_PER_BEAT_BASE = 40;
const TRACK_HEIGHT = 60;
const TRACK_COLORS = ['#E85002', '#3B82F6', '#10B981', '#A855F7', '#F59E0B', '#EC4899', '#06B6D4', '#84CC16'];

function getPixelsPerBeat() {
  return PIXELS_PER_BEAT_BASE * state.timelineZoom;
}

function renderTimeline() {
  renderTimeRuler();
  renderTrackHeaders();
  renderTrackLanes();
  renderTimelineBlocks();
  updatePlayhead();
  updateTimelineEmpty();
}

function renderTimeRuler() {
  const canvas = document.getElementById('ruler-canvas');
  if (!canvas) return;
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = 24;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const ppb = getPixelsPerBeat();
  const beatsPerBar = state.timelineSig[0];
  const scrollX = state.timelineScrollX;
  const totalWidth = canvas.width;

  // Draw bar and beat lines
  const startBeat = Math.floor(scrollX / ppb);
  const endBeat = Math.ceil((scrollX + totalWidth) / ppb) + 1;

  for (let beat = startBeat; beat <= endBeat; beat++) {
    const x = beat * ppb - scrollX;
    if (x < 0 || x > totalWidth) continue;
    const isBarLine = beat % beatsPerBar === 0;
    const barNum = Math.floor(beat / beatsPerBar) + 1;

    ctx.beginPath();
    ctx.moveTo(x, isBarLine ? 0 : 14);
    ctx.lineTo(x, 24);
    ctx.strokeStyle = isBarLine ? '#4A4A4A' : '#2D2D2D';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isBarLine) {
      ctx.fillStyle = '#999';
      ctx.font = '9px SF Mono, Consolas, monospace';
      ctx.fillText(String(barNum), x + 3, 10);
    }
  }
}

function renderTrackHeaders() {
  const container = document.getElementById('track-headers-list');
  if (!container) return;

  container.innerHTML = arrangement.tracks.map((track, i) => {
    const colorIdx = i % TRACK_COLORS.length;
    return `<div class="track-header" data-track="${track.id}">
      <div class="flex items-center gap-1">
        <div class="w-1.5 h-6 flex-shrink-0" style="background: ${TRACK_COLORS[colorIdx]};"></div>
        <input class="track-name flex-1 min-w-0" value="${escapeHtml(track.name)}" onchange="renameTrack('${track.id}', this.value)" spellcheck="false"/>
      </div>
      <div class="track-controls">
        <button class="track-ctrl-btn ${track.muted ? 'active-mute' : ''}" onclick="toggleMuteTrack('${track.id}')">M</button>
        <button class="track-ctrl-btn ${track.solo ? 'active-solo' : ''}" onclick="toggleSoloTrack('${track.id}')">S</button>
        <input type="range" class="track-vol" min="0" max="100" value="${Math.round(track.volume * 100)}" oninput="setTrackVolume('${track.id}', this.value / 100)"/>
        <button class="track-ctrl-btn ml-auto" onclick="deleteTrack('${track.id}')" title="Delete track">
          <span class="material-symbols-outlined text-[10px]">close</span>
        </button>
      </div>
    </div>`;
  }).join('');
}

function renderTrackLanes() {
  const container = document.getElementById('track-lanes');
  if (!container) return;

  const ppb = getPixelsPerBeat();
  const totalBeats = Math.max(64, getLastBlockEnd() + 16);
  const totalWidth = totalBeats * ppb;

  container.style.width = totalWidth + 'px';
  container.style.height = (arrangement.tracks.length * TRACK_HEIGHT) + 'px';

  container.innerHTML = arrangement.tracks.map(track =>
    `<div class="track-lane" data-track="${track.id}" style="height: ${TRACK_HEIGHT}px;"></div>`
  ).join('');

  // Draw grid lines on the grid canvas
  renderGridLines(totalWidth);
}

function renderGridLines(totalWidth) {
  const canvas = document.getElementById('timeline-grid-canvas');
  if (!canvas) return;
  const totalHeight = arrangement.tracks.length * TRACK_HEIGHT;
  canvas.width = totalWidth;
  canvas.height = Math.max(totalHeight, 200);
  canvas.style.width = totalWidth + 'px';
  canvas.style.height = canvas.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const ppb = getPixelsPerBeat();
  const beatsPerBar = state.timelineSig[0];

  const endBeat = Math.ceil(totalWidth / ppb);
  for (let beat = 0; beat <= endBeat; beat++) {
    const x = beat * ppb;
    const isBarLine = beat % beatsPerBar === 0;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.strokeStyle = isBarLine ? 'rgba(61, 61, 61, 0.6)' : 'rgba(45, 45, 45, 0.4)';
    ctx.lineWidth = isBarLine ? 1 : 0.5;
    ctx.stroke();
  }
}

function renderTimelineBlocks() {
  const ppb = getPixelsPerBeat();
  const lanes = document.querySelectorAll('.track-lane');

  // Clear existing blocks from lanes
  lanes.forEach(lane => {
    lane.querySelectorAll('.tl-block').forEach(b => b.remove());
  });

  arrangement.blocks.forEach(block => {
    const lane = document.querySelector(`.track-lane[data-track="${block.trackId}"]`);
    if (!lane) return;

    const left = block.startBeat * ppb;
    const width = block.durationBeats * ppb;
    const selected = state.selectedBlocks.has(block.id);
    const sample = samples[block.sampleId];

    const div = document.createElement('div');
    div.className = `tl-block ${selected ? 'selected' : ''}`;
    div.style.left = left + 'px';
    div.style.width = Math.max(width, 4) + 'px';
    div.dataset.blockId = block.id;
    div.ondblclick = () => previewSample(block.sampleId);
    div.onmousedown = (e) => handleBlockMouseDown(e, block.id);

    const label = sample ? sample.name : 'Unknown';
    div.innerHTML = `<span class="block-label">${escapeHtml(label)}</span>
      <canvas class="block-waveform" data-id="${block.sampleId}"></canvas>
      <div class="block-resize left" onmousedown="event.stopPropagation(); initBlockResize(event, '${block.id}', 'left')"></div>
      <div class="block-resize right" onmousedown="event.stopPropagation(); initBlockResize(event, '${block.id}', 'right')"></div>`;
    lane.appendChild(div);

    // Draw waveform into block canvas
    requestAnimationFrame(() => {
      const wCanvas = div.querySelector('.block-waveform');
      if (wCanvas && sample) {
        wCanvas.width = Math.max(width, 4);
        wCanvas.height = TRACK_HEIGHT - 4;
        drawWaveform(wCanvas, sample.waveformData, 'rgba(232, 80, 2, 0.5)');
      }
    });
  });
}

function updatePlayhead() {
  const el = document.getElementById('playhead');
  if (!el) return;
  const ppb = getPixelsPerBeat();
  const x = state.timelinePlayheadBeat * ppb;
  el.style.left = x + 'px';
  el.style.display = arrangement.tracks.length > 0 ? '' : 'none';

  // Update LCD
  const posEl = document.getElementById('tl-position');
  if (posEl) {
    const beat = state.timelinePlayheadBeat;
    const beatsPerBar = state.timelineSig[0];
    const bar = Math.floor(beat / beatsPerBar) + 1;
    const beatInBar = Math.floor(beat % beatsPerBar) + 1;
    const tick = Math.floor((beat % 1) * 4);
    posEl.textContent = `${bar}.${beatInBar}.${tick}`;
  }
}

function updateTimelineEmpty() {
  const el = document.getElementById('timeline-empty');
  if (el) {
    el.style.display = arrangement.tracks.length === 0 ? '' : 'none';
  }
}

function getLastBlockEnd() {
  if (!arrangement.blocks.length) return 0;
  return Math.max(...arrangement.blocks.map(b => b.startBeat + b.durationBeats));
}

// ==================== TRACK MANAGEMENT ====================
function addTrack(name) {
  const id = 'trk_' + (++trackIdCounter);
  arrangement.tracks.push({
    id,
    name: name || 'Track ' + arrangement.tracks.length,
    volume: 1.0,
    muted: false,
    solo: false,
    order: arrangement.tracks.length,
  });
  saveData();
  renderTimeline();
}

function deleteTrack(trackId) {
  arrangement.tracks = arrangement.tracks.filter(t => t.id !== trackId);
  arrangement.blocks = arrangement.blocks.filter(b => b.trackId !== trackId);
  saveData();
  renderTimeline();
}

function renameTrack(trackId, name) {
  const track = arrangement.tracks.find(t => t.id === trackId);
  if (track) { track.name = name; saveData(); }
}

function toggleMuteTrack(trackId) {
  const track = arrangement.tracks.find(t => t.id === trackId);
  if (track) { track.muted = !track.muted; saveData(); renderTrackHeaders(); }
}

function toggleSoloTrack(trackId) {
  const track = arrangement.tracks.find(t => t.id === trackId);
  if (track) { track.solo = !track.solo; saveData(); renderTrackHeaders(); }
}

function setTrackVolume(trackId, value) {
  const track = arrangement.tracks.find(t => t.id === trackId);
  if (track) { track.volume = value; saveData(); }
}

// ==================== BLOCK MANAGEMENT ====================
function createBlock(opts) {
  const id = 'blk_' + (++blockIdCounter);
  arrangement.blocks.push({
    id,
    trackId: opts.trackId,
    sampleId: opts.sampleId,
    startBeat: opts.startBeat || 0,
    durationBeats: opts.durationBeats || 4,
    offset: 0,
    gain: 1.0,
    loop: false,
  });
  saveData();
  return id;
}

function deleteSelectedBlocks() {
  if (state.selectedBlocks.size === 0) return;
  arrangement.blocks = arrangement.blocks.filter(b => !state.selectedBlocks.has(b.id));
  state.selectedBlocks.clear();
  saveData();
  renderTimeline();
}

function sampleDurationToBeats(durationSec, bpm) {
  const beatsPerSecond = bpm / 60;
  return Math.round(durationSec * beatsPerSecond * 4) / 4;
}

// ==================== DRAG & DROP ====================
function handleSampleDragStart(event, sampleId) {
  event.dataTransfer.setData('application/fiire-sample', sampleId);
  event.dataTransfer.effectAllowed = 'copy';

  // Trigger external drag if available
  if (typeof handleSampleDrag === 'function') {
    handleSampleDrag(event, sampleId);
  }
}

function handleTimelineDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';

  const pos = getDropPosition(event);
  showDropIndicator(pos);
}

function handleTimelineDrop(event) {
  event.preventDefault();
  const sampleId = event.dataTransfer.getData('application/fiire-sample');
  if (!sampleId || !samples[sampleId]) { hideDropIndicator(); return; }

  const pos = getDropPosition(event);
  const snappedBeat = snapToBeat(pos.beat);

  // Auto-create track if needed
  let track = arrangement.tracks[pos.trackIndex];
  if (!track) {
    addTrack(samples[sampleId].name || 'Track');
    track = arrangement.tracks[arrangement.tracks.length - 1];
  }

  const s = samples[sampleId];
  const bpm = state.timelineBPM;
  const durationBeats = s.duration ? sampleDurationToBeats(s.duration, bpm) : 4;

  createBlock({
    trackId: track.id,
    sampleId: sampleId,
    startBeat: snappedBeat,
    durationBeats: Math.max(durationBeats, 0.5),
  });

  hideDropIndicator();
  renderTimeline();
  showToast(`Added "${s.name}" to ${track.name}`);
}

function getDropPosition(event) {
  const content = document.getElementById('track-content');
  if (!content) return { trackIndex: 0, beat: 0 };
  const rect = content.getBoundingClientRect();
  const x = event.clientX - rect.left + content.scrollLeft;
  const y = event.clientY - rect.top + content.scrollTop;
  const ppb = getPixelsPerBeat();
  return {
    trackIndex: Math.max(0, Math.floor(y / TRACK_HEIGHT)),
    beat: Math.max(0, x / ppb),
  };
}

function snapToBeat(beat) {
  const beatsPerBar = state.timelineSig[0];
  if (state.timelineSnap === 'bar') return Math.round(beat / beatsPerBar) * beatsPerBar;
  if (state.timelineSnap === 'beat') return Math.round(beat);
  if (state.timelineSnap === 'half') return Math.round(beat * 2) / 2;
  return beat; // 'off'
}

function showDropIndicator(pos) {
  const el = document.getElementById('drop-indicator');
  if (!el) return;
  const ppb = getPixelsPerBeat();
  const x = snapToBeat(pos.beat) * ppb;
  el.style.left = x + 'px';
  el.style.top = (pos.trackIndex * TRACK_HEIGHT) + 'px';
  el.style.height = TRACK_HEIGHT + 'px';
  el.classList.remove('hidden');
}

function hideDropIndicator() {
  const el = document.getElementById('drop-indicator');
  if (el) el.classList.add('hidden');
}

// ==================== BLOCK INTERACTION ====================
let blockDragState = null;

function handleBlockMouseDown(event, blockId) {
  if (event.button !== 0) return;
  event.preventDefault();

  // Toggle selection
  if (event.shiftKey) {
    if (state.selectedBlocks.has(blockId)) state.selectedBlocks.delete(blockId);
    else state.selectedBlocks.add(blockId);
    renderTimelineBlocks();
    return;
  }

  if (!state.selectedBlocks.has(blockId)) {
    state.selectedBlocks.clear();
    state.selectedBlocks.add(blockId);
    renderTimelineBlocks();
  }

  // Init drag
  const block = arrangement.blocks.find(b => b.id === blockId);
  if (!block) return;
  const ppb = getPixelsPerBeat();

  blockDragState = {
    blockId,
    startMouseX: event.clientX,
    startMouseY: event.clientY,
    startBeat: block.startBeat,
    origTrackId: block.trackId,
    moved: false,
  };

  const onMove = (e) => {
    if (!blockDragState) return;
    const dx = e.clientX - blockDragState.startMouseX;
    const dy = e.clientY - blockDragState.startMouseY;
    if (!blockDragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    blockDragState.moved = true;

    const beatDelta = dx / ppb;
    const trackDelta = Math.round(dy / TRACK_HEIGHT);

    const newBeat = snapToBeat(Math.max(0, blockDragState.startBeat + beatDelta));
    const origIdx = arrangement.tracks.findIndex(t => t.id === blockDragState.origTrackId);
    const newTrackIdx = Math.max(0, Math.min(arrangement.tracks.length - 1, origIdx + trackDelta));

    block.startBeat = newBeat;
    block.trackId = arrangement.tracks[newTrackIdx].id;
    renderTimelineBlocks();
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (blockDragState?.moved) saveData();
    blockDragState = null;
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function initBlockResize(event, blockId, edge) {
  event.preventDefault();
  const block = arrangement.blocks.find(b => b.id === blockId);
  if (!block) return;
  const ppb = getPixelsPerBeat();
  const startX = event.clientX;
  const startBeat = block.startBeat;
  const startDuration = block.durationBeats;

  const onMove = (e) => {
    const dx = e.clientX - startX;
    const beatDelta = dx / ppb;

    if (edge === 'right') {
      block.durationBeats = Math.max(0.25, snapToBeat(startDuration + beatDelta) || (startDuration + beatDelta));
    } else {
      const newStart = Math.max(0, snapToBeat(startBeat + beatDelta));
      const diff = newStart - block.startBeat;
      block.startBeat = newStart;
      block.durationBeats = Math.max(0.25, block.durationBeats - diff);
    }
    renderTimelineBlocks();
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveData();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ==================== TIMELINE TRANSPORT ====================
let timelineEngine = {
  scheduledSources: [],
  startedAtCtxTime: 0,
  startedAtBeat: 0,
  rafId: null,
  scheduleTimerId: null,
  lookAheadMs: 100,
  scheduleIntervalMs: 25,
};

function timelinePlayPause() {
  if (state.timelinePlaying) {
    timelinePause();
  } else {
    timelinePlay();
  }
}

function timelinePlay() {
  if (!arrangement.blocks.length) return;
  ensureAudioContext();
  state.timelinePlaying = true;

  timelineEngine.startedAtCtxTime = audioCtx.currentTime;
  timelineEngine.startedAtBeat = state.timelinePlayheadBeat;
  timelineEngine.scheduledSources = [];

  timelineEngine.scheduleTimerId = setInterval(scheduleBlocks, timelineEngine.scheduleIntervalMs);
  updatePlayheadRAF();

  const btn = document.querySelector('#tl-play .material-symbols-outlined');
  if (btn) btn.textContent = 'pause';
  const loopBtn = document.getElementById('tl-loop');
  if (loopBtn && state.timelineLooping) loopBtn.querySelector('.material-symbols-outlined').classList.add('text-brand');
}

function timelinePause() {
  state.timelinePlaying = false;
  state.timelinePlayheadBeat = getCurrentBeat();

  timelineEngine.scheduledSources.forEach(s => {
    try { s.source.stop(); } catch(e) {}
  });
  timelineEngine.scheduledSources = [];

  clearInterval(timelineEngine.scheduleTimerId);
  cancelAnimationFrame(timelineEngine.rafId);

  const btn = document.querySelector('#tl-play .material-symbols-outlined');
  if (btn) btn.textContent = 'play_arrow';
}

function timelineStop() {
  timelinePause();
  state.timelinePlayheadBeat = 0;
  updatePlayhead();
}

function timelineToggleLoop() {
  state.timelineLooping = !state.timelineLooping;
  const icon = document.querySelector('#tl-loop .material-symbols-outlined');
  if (icon) {
    icon.classList.toggle('text-brand', state.timelineLooping);
    icon.classList.toggle('text-txt-dim', !state.timelineLooping);
  }
}

function setTimelineBPM(value) {
  state.timelineBPM = Math.max(60, Math.min(300, parseInt(value) || 120));
  document.getElementById('tl-bpm').value = state.timelineBPM;
  renderTimeline();
}

function setTimelineSig(value) {
  const parts = value.split('/');
  state.timelineSig = [parseInt(parts[0]) || 4, parseInt(parts[1]) || 4];
  renderTimeline();
}

function cycleSnap() {
  const modes = ['bar', 'beat', 'half', 'off'];
  const labels = ['1 BAR', '1 BEAT', '1/2', 'OFF'];
  const idx = modes.indexOf(state.timelineSnap);
  const next = (idx + 1) % modes.length;
  state.timelineSnap = modes[next];
  const btn = document.getElementById('tl-snap');
  if (btn) {
    btn.textContent = labels[next];
    btn.classList.toggle('active', state.timelineSnap !== 'off');
  }
}

function getCurrentBeat() {
  if (!state.timelinePlaying) return state.timelinePlayheadBeat;
  const elapsed = audioCtx.currentTime - timelineEngine.startedAtCtxTime;
  const beatsPerSecond = state.timelineBPM / 60;
  let beat = timelineEngine.startedAtBeat + elapsed * beatsPerSecond;

  if (state.timelineLooping) {
    const loopLen = state.timelineLoopEnd - state.timelineLoopStart;
    if (loopLen > 0 && beat >= state.timelineLoopEnd) {
      beat = state.timelineLoopStart + ((beat - state.timelineLoopStart) % loopLen);
    }
  }
  return beat;
}

function beatToCtxTime(beat) {
  const beatsPerSecond = state.timelineBPM / 60;
  const beatOffset = beat - timelineEngine.startedAtBeat;
  return timelineEngine.startedAtCtxTime + (beatOffset / beatsPerSecond);
}

function scheduleBlocks() {
  if (!state.timelinePlaying) return;
  const now = audioCtx.currentTime;
  const beatsPerSecond = state.timelineBPM / 60;
  const currentBeat = getCurrentBeat();
  const lookAheadBeats = currentBeat + (timelineEngine.lookAheadMs / 1000) * beatsPerSecond;

  arrangement.blocks.forEach(block => {
    if (timelineEngine.scheduledSources.some(s => s.blockId === block.id && s.endTime > now)) return;

    const blockEnd = block.startBeat + block.durationBeats;
    if (block.startBeat < lookAheadBeats && blockEnd > currentBeat) {
      scheduleBlock(block);
    }
  });

  timelineEngine.scheduledSources = timelineEngine.scheduledSources.filter(s => now < s.endTime + 0.1);
}

function scheduleBlock(block) {
  const sample = samples[block.sampleId];
  if (!sample) return;

  const track = arrangement.tracks.find(t => t.id === block.trackId);
  if (!track || track.muted) return;

  const anySolo = arrangement.tracks.some(t => t.solo);
  if (anySolo && !track.solo) return;

  getAudioBuffer(block.sampleId).then(buffer => {
    if (!buffer || !state.timelinePlaying) return;

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const blockGain = audioCtx.createGain();
    blockGain.gain.value = block.gain * track.volume;
    source.connect(blockGain);
    blockGain.connect(masterGain);

    const startTime = beatToCtxTime(block.startBeat);
    const durationSec = block.durationBeats / (state.timelineBPM / 60);
    const endTime = startTime + durationSec;

    const now = audioCtx.currentTime;
    const offset = Math.max(0, now - startTime);
    const actualStart = Math.max(now, startTime);
    const remaining = durationSec - offset;

    if (remaining <= 0) return;

    source.start(actualStart, block.offset + offset, remaining);

    timelineEngine.scheduledSources.push({
      source, blockId: block.id,
      startTime: actualStart, endTime,
    });
  });
}

function updatePlayheadRAF() {
  if (!state.timelinePlaying) return;
  state.timelinePlayheadBeat = getCurrentBeat();
  updatePlayhead();

  // Auto-scroll
  const content = document.getElementById('track-content');
  if (content) {
    const ppb = getPixelsPerBeat();
    const playheadX = state.timelinePlayheadBeat * ppb;
    const visible = content.clientWidth;
    const scroll = content.scrollLeft;
    if (playheadX > scroll + visible - 60) {
      content.scrollLeft = playheadX - 60;
      state.timelineScrollX = content.scrollLeft;
      renderTimeRuler();
    }
  }

  timelineEngine.rafId = requestAnimationFrame(updatePlayheadRAF);
}

function seekTimeline(event) {
  const ruler = document.getElementById('time-ruler');
  if (!ruler) return;
  const rect = ruler.getBoundingClientRect();
  const x = event.clientX - rect.left + state.timelineScrollX;
  const ppb = getPixelsPerBeat();
  state.timelinePlayheadBeat = Math.max(0, x / ppb);
  updatePlayhead();

  if (state.timelinePlaying) {
    timelinePause();
    timelinePlay();
  }
}

// ==================== CHAT REFINEMENT ====================

const CLAUDE_SYSTEM_PROMPT = `You are FIIRE AI, a music production assistant inside the FIIRE Studio sample generator. Help producers refine their sound generation prompts and suggest optimal parameters.

Available parameters:
- mode: "loop" or "oneshot"
- instrument: one of "drums", "bass", "melodic", "pad", "fx", "vocal"
- genres: array from ["trap", "boombap", "house", "techno", "drum and bass", "ambient", "r&b", "lo-fi", "funk", "afrobeat"]
- energy: one of "low", "mid", "high"
- bpm: number 80-200 (loops only, omit to let AI choose)
- key: musical key like "Cm", "F#", "Am" (loops only, omit to let AI choose)
- bars: one of 2, 4, 8, 16 (loops only)
- attack: one of "Snappy", "Soft", "Transient", "Punchy" (one-shots only)
- timbre: one of "Warm", "Bright", "Dark", "Metallic" (one-shots only)
- tuning: note like "C3", "A4" (one-shots only)

Respond with:
1. A brief explanation (1-2 sentences) of your suggestions — be specific about the sound
2. A JSON block wrapped in \`\`\`json fences with suggested parameters

JSON format (only include params you want to set):
\`\`\`json
{
  "prompt": "refined prompt text for the generator",
  "mode": "loop",
  "instrument": "drums",
  "genres": ["trap"],
  "energy": "high",
  "bpm": 140,
  "key": "Cm",
  "bars": 4
}
\`\`\`

Rules:
- The "prompt" field is required — it's the refined text prompt optimized for an AI sound generator
- Only include other parameters you want to change
- Keep explanations extremely brief (this is a production tool, not a chatbot)
- Be specific about the sound — reference real production techniques and textures`;

function renderParamTags(params) {
  const tags = [];
  if (params.mode) tags.push(params.mode.toUpperCase());
  if (params.instrument) tags.push(params.instrument.toUpperCase());
  if (params.genres) params.genres.forEach(g => tags.push(g.toUpperCase()));
  if (params.energy) tags.push(params.energy.toUpperCase());
  if (params.bpm) tags.push(params.bpm + ' BPM');
  if (params.key) tags.push(params.key);
  if (params.bars) tags.push(params.bars + ' BARS');
  if (params.attack) tags.push(params.attack.toUpperCase());
  if (params.timbre) tags.push(params.timbre.toUpperCase());
  if (params.tuning) tags.push(params.tuning);
  return tags.map(t =>
    `<span class="text-[9px] px-1.5 py-0.5 bg-brand/10 border border-brand/20 text-brand font-bold uppercase">${t}</span>`
  ).join('');
}

function renderChat() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = state.chatMessages.map((msg, i) => {
    if (msg.role === 'user') {
      return `<div class="px-3 py-1.5">
        <span class="section-label">YOU</span>
        <p class="text-[11px] text-txt-muted mt-0.5">${escapeHtml(msg.content)}</p>
      </div>`;
    } else {
      const paramTags = msg.params ? renderParamTags(msg.params) : '';
      return `<div class="px-3 py-2 bg-surface/30">
        <div class="flex items-center justify-between">
          <span class="section-label text-brand">FIIRE AI</span>
          ${msg.params ? `<button class="text-[9px] text-brand hover:text-brand-hover uppercase font-bold tracking-wider" onclick="applyRefinement(${i})">APPLY</button>` : ''}
        </div>
        <p class="text-[11px] text-txt mt-0.5">${escapeHtml(msg.content)}</p>
        ${paramTags ? `<div class="flex flex-wrap gap-1 mt-1.5">${paramTags}</div>` : ''}
      </div>`;
    }
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function selectChipByValue(containerId, value) {
  const chips = document.querySelectorAll('#' + containerId + ' .param-chip');
  chips.forEach(c => {
    const resolved = resolveChipLabel(c.textContent.trim());
    if (resolved.toLowerCase() === value.toLowerCase()) {
      chips.forEach(ch => ch.classList.remove('active'));
      c.classList.add('active');
    }
  });
}

function selectMultiChipByValue(containerId, value) {
  document.querySelectorAll('#' + containerId + ' .param-chip').forEach(c => {
    const resolved = resolveChipLabel(c.textContent.trim());
    if (resolved.toLowerCase() === value.toLowerCase()) {
      c.classList.add('active');
    }
  });
}

function applyRefinement(messageIndex) {
  const msg = state.chatMessages[messageIndex];
  if (!msg || !msg.params) return;
  const p = msg.params;

  if (p.prompt) document.getElementById('gen-prompt').value = p.prompt;
  if (p.mode && (p.mode === 'loop' || p.mode === 'oneshot')) setGenerateMode(p.mode);
  if (p.instrument) selectChipByValue('instrument-chips', p.instrument);

  if (p.genres && Array.isArray(p.genres)) {
    document.querySelectorAll('#style-chips .param-chip').forEach(c => c.classList.remove('active'));
    p.genres.forEach(genre => selectMultiChipByValue('style-chips', genre));
  }

  if (p.energy) selectChipByValue('energy-chips', p.energy);

  if (p.bpm) {
    const bpmSelect = document.getElementById('bpm-input');
    const options = [...bpmSelect.options].map(o => o.value).filter(v => v);
    const closest = options.reduce((prev, curr) =>
      Math.abs(parseInt(curr) - p.bpm) < Math.abs(parseInt(prev) - p.bpm) ? curr : prev
    );
    bpmSelect.value = closest;
  }

  if (p.key) document.getElementById('key-select').value = p.key;

  if (p.bars) {
    const barsBtn = [...document.querySelectorAll('#length-chips .param-chip')]
      .find(c => c.textContent.trim() === String(p.bars));
    if (barsBtn) setLength(p.bars, barsBtn);
  }

  if (p.attack) selectChipByValue('attack-chips', p.attack);
  if (p.timbre) selectChipByValue('timbre-chips', p.timbre);
  if (p.tuning) document.getElementById('tuning-select').value = p.tuning;

  showToast('Parameters updated');
}

function buildChatUserMessage(promptText, params) {
  const parts = [`Current: mode=${params.type}, instrument=${params.instrument || 'drums'}, energy=${params.energy || 'mid'}`];
  if (params.type === 'loop') {
    parts.push(`bpm=${params.bpm || 'auto'}, key=${params.key || 'auto'}, bars=${params.bars || 4}`);
  } else {
    parts.push(`tuning=${params.tuning || 'C3'}, attack=${params.attack || 'Snappy'}, timbre=${params.timbre || 'Warm'}`);
  }
  const genres = params.styles?.length ? params.styles.join(', ') : 'none';
  parts.push(`genres=[${genres}]`);
  return parts.join(', ') + `\n\nUser prompt: "${promptText}"`;
}

function parseClaudeResponse(text) {
  let explanation = text;
  let params = null;
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try { params = JSON.parse(jsonMatch[1].trim()); } catch(e) { console.warn('Failed to parse Claude JSON:', e); }
    explanation = text.substring(0, text.indexOf('```json')).trim();
  }
  return { explanation, params };
}

function callClaudeProxy(userMessage) {
  const messages = [];
  for (const msg of state.chatMessages) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg._fullContent || msg.content });
    } else if (msg.role === 'assistant') {
      let content = msg.content;
      if (msg.params) content += '\n```json\n' + JSON.stringify(msg.params) + '\n```';
      messages.push({ role: 'assistant', content });
    }
  }
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: CLAUDE_API_KEY,
      system: CLAUDE_SYSTEM_PROMPT,
      messages,
    }),
  })
  .then(res => {
    if (!res.ok) return res.json().then(j => { throw new Error(j.error?.message || j.error || `Error ${res.status}`); });
    return res.json();
  })
  .then(data => {
    if (data.error) throw new Error(typeof data.error === 'object' ? data.error.message : data.error);
    return data.content?.[0]?.text || '';
  });
}

function clearChat() {
  state.chatMessages = [];
  const chatMsgs = document.getElementById('chat-messages');
  if (chatMsgs) chatMsgs.innerHTML = '';
}

function refinePrompt() {
  if (state.chatRefining) return;
  if (!CLAUDE_API_KEY) {
    showToast('Set your Claude API key in Settings first');
    openSettingsModal();
    return;
  }
  const promptText = document.getElementById('gen-prompt').value.trim();
  if (!promptText) {
    showToast('Enter a prompt to refine');
    return;
  }

  state.chatRefining = true;
  const params = getGenParams();
  const fullContent = buildChatUserMessage(promptText, params);

  state.chatMessages.push({ role: 'user', content: promptText, params: null, _fullContent: fullContent });
  renderChat();

  callClaudeProxy(fullContent)
    .then(response => {
      const parsed = parseClaudeResponse(response);
      state.chatMessages.push({ role: 'assistant', content: parsed.explanation, params: parsed.params });
      renderChat();
      if (parsed.params) applyRefinement(state.chatMessages.length - 1);
    })
    .catch(err => {
      showToast('Refinement failed: ' + err.message);
      console.error('Claude API error:', err);
    })
    .finally(() => {
      state.chatRefining = false;
    });
}

// ==================== RESIZE HANDLES ====================
(function initResizeHandles() {
  document.querySelectorAll('.resize-handle-h').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const section = document.getElementById('base-samples-section');
      if (!section) return;
      const startY = e.clientY;
      const startHeight = section.offsetHeight;
      handle.classList.add('active');

      const onMove = (e) => {
        const dy = e.clientY - startY;
        section.style.height = Math.max(80, Math.min(400, startHeight + dy)) + 'px';
      };
      const onUp = () => {
        handle.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        renderTimeline(); // reflow
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  // Don't handle when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.key === ' ') {
    e.preventDefault();
    timelinePlayPause();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelectedBlocks();
  } else if (e.key === 'Escape') {
    closeInlineGeneration();
    state.selectedBlocks.clear();
    renderTimelineBlocks();
  }
});

// ==================== ZOOM ====================
document.getElementById('track-content')?.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.timelineZoom = Math.max(0.25, Math.min(4, state.timelineZoom + delta));
    renderTimeline();
  }
}, { passive: false });

// Sync scroll position for ruler
document.getElementById('track-content')?.addEventListener('scroll', (e) => {
  state.timelineScrollX = e.target.scrollLeft;
  state.timelineScrollY = e.target.scrollTop;
  renderTimeRuler();

  // Sync track headers vertical scroll
  const headers = document.getElementById('track-headers');
  if (headers) headers.scrollTop = e.target.scrollTop;
});

// ==================== PAGE CALLBACKS ====================
window.FIIRE_onProjectSwitch = function() {
  renderBaseSamples();
  renderSampleBar();
  renderTimeline();
};

window.FIIRE_onPreviewSample = function() {
  renderBaseSamples();
  renderSampleBar();
};

window.FIIRE_onFavoriteToggle = function() {
  renderSampleBar();
};

window.FIIRE_onNavigate = function() {};

// ==================== INIT ====================
(function initStudio() {
  initNavHighlight();
  renderProjectSwitcher();
  renderBaseSamples();
  renderSampleBar();
  renderTimeline();

  // Check API key
  if (!ELEVENLABS_API_KEY) {
    document.getElementById('api-key-warning')?.classList.remove('hidden');
  }

  // Open a specific sample if navigated from another page
  const pendingSample = localStorage.getItem('fiire_open_sample');
  if (pendingSample) {
    localStorage.removeItem('fiire_open_sample');
    setTimeout(() => previewSample(pendingSample), 100);
  }
})();
