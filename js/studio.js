/* ==================== FIIRE STUDIO JS ==================== */
/* Generate, Library, Pad Grid, Inspector, Chat Refinement    */
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
      document.getElementById('ref-upload-btn').classList.add('border-brand', 'text-brand');
      document.getElementById('ref-upload-btn').classList.remove('border-border', 'text-txt-dim');
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
  document.getElementById('ref-upload-btn').classList.remove('border-brand', 'text-brand');
  document.getElementById('ref-upload-btn').classList.add('border-border', 'text-txt-dim');
}

// ==================== MODE / PARAM CONTROLS ====================
function toggleParams() {
  // No-op: params are always visible in the toolbar now
}

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
  const btnIcon = btn.querySelector('.material-symbols-outlined');
  if (active) {
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    btnText.textContent = 'Generating...';
    btnIcon.textContent = 'progress_activity';
    btnIcon.classList.add('animate-spin');
  } else {
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
    btnText.textContent = 'Generate';
    btnIcon.textContent = 'bolt';
    btnIcon.classList.remove('animate-spin');
  }
}

function generateSamples() {
  if (state.generating) return;
  clearChat();
  state.generating = true;
  setGeneratingUI(true);
  const params = getGenParams();
  const useAPI = ELEVENLABS_API_KEY && ELEVENLABS_API_KEY.length > 0;

  state.generatingForPad = state.selectedPad !== null
    ? { bank: state.currentBank, index: state.selectedPad }
    : null;

  document.getElementById('gen-loading').classList.remove('hidden');
  document.getElementById('gen-empty').classList.add('hidden');
  document.getElementById('var-grid').innerHTML = '';
  const drawer = document.getElementById('variations-drawer');
  if (drawer) drawer.classList.remove('collapsed');

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
    document.getElementById('gen-var-count').textContent = variationIds.length + ' variations';
    showToast('No API key — generated synthetic placeholders');
    ensureAudioContext();
    variationIds.forEach(vid => getAudioBuffer(vid));
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
            document.getElementById('gen-var-count').textContent = variationIds.length + ' variations';
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
  const emptyEl = document.getElementById('gen-empty');
  const drawer = document.getElementById('variations-drawer');
  const list = currentVariations.map(id => samples[id]).filter(Boolean);

  if (!list.length) {
    container.innerHTML = '';
    emptyEl.classList.remove('hidden');
    if (drawer) drawer.classList.add('collapsed');
    document.getElementById('gen-summary').classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  if (drawer) drawer.classList.remove('collapsed');
  document.getElementById('gen-var-count').textContent = list.length + ' variation' + (list.length !== 1 ? 's' : '');

  container.className = 'divide-y divide-border';
  container.innerHTML = list.map(s => renderStackRow(s)).join('');

  const kept = list.filter(s => s.status === 'accepted');
  const total = list.length;
  const summaryEl = document.getElementById('gen-summary');
  if (kept.length > 0 || list.some(s => s.status === 'rejected')) {
    const lastName = kept.length > 0 ? kept[kept.length - 1].name : '';
    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
      <span class="text-[10px] text-txt-muted">Kept <strong class="text-txt">${kept.length}</strong> of ${total}</span>
      ${kept.length > 0 ? `<button class="flex items-center gap-1 text-[10px] text-brand hover:text-brand-hover font-medium transition-colors" onclick="generateMoreLike('${kept[kept.length - 1].id}')">
        <span class="material-symbols-outlined text-[12px]">refresh</span> More like "${lastName}"
      </button>` : ''}`;
  } else {
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
      <div class="flex items-center gap-0.5 ml-auto flex-shrink-0">
        <button class="p-1 text-txt-dim hover:text-txt transition-colors" onclick="event.stopPropagation(); toggleSampleFavorite('${id}')">
          <span class="material-symbols-outlined text-[12px] ${s.isFavorite ? 'fill-1 text-brand' : ''}">${s.isFavorite ? 'favorite' : 'favorite_border'}</span>
        </button>
        <button class="p-1 text-txt-dim hover:text-txt transition-colors" onclick="event.stopPropagation(); downloadSample('${id}')">
          <span class="material-symbols-outlined text-[12px]">download</span>
        </button>
        <button class="p-1 text-txt-dim hover:text-txt transition-colors" onclick="event.stopPropagation(); openInspector('${id}')">
          <span class="material-symbols-outlined text-[12px]">info</span>
        </button>
      </div>
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

// ==================== PAD GRID ====================
function renderPadGrid() {
  const container = document.getElementById('pad-grid');
  if (!container) return;
  const bank = state.currentBank;
  const pads = padAssignments[bank];

  let html = '';
  for (let i = 0; i < 24; i++) {
    const sampleId = pads[i];
    const sample = sampleId ? samples[sampleId] : null;
    const isSelected = state.selectedPad === i;
    const isPlaying = sample && state.currentSample === sampleId && state.isPlaying;
    const padLabel = bank + String(i + 1).padStart(2, '0');

    if (sample) {
      const cls = ['pad', 'loaded', 'flex', 'flex-col', 'items-center', 'justify-center', 'p-2', 'aspect-square'];
      if (isSelected) cls.push('selected');
      if (isPlaying) cls.push('active');
      html += `<div class="${cls.join(' ')}" onclick="selectPad(${i})" ondblclick="previewPadSample(${i})">
        <span class="pad-label text-[9px] font-bold text-txt-dim">${padLabel}</span>
        <span class="pad-icon material-symbols-outlined text-[22px] text-txt-dim">${getPadIcon(sample)}</span>
        <span class="pad-name text-[7px] font-bold uppercase text-txt-dim mt-auto truncate w-full text-center">${sample.name}</span>
      </div>`;
    } else {
      const cls = ['pad', 'empty', 'flex', 'items-center', 'justify-center', 'aspect-square'];
      if (isSelected) cls.push('selected');
      html += `<div class="${cls.join(' ')}" onclick="selectPad(${i})">
        <span class="pad-add-icon material-symbols-outlined text-[18px]">add</span>
      </div>`;
    }
  }
  container.innerHTML = html;
  updatePadInfo();
}

function getPadIcon(sample) {
  if (!sample) return 'add';
  const name = (sample.name || '').toLowerCase();
  if (name.includes('kick')) return 'equalizer';
  if (name.includes('snare') || name.includes('clap')) return 'waves';
  if (name.includes('hat')) return 'blur_on';
  if (name.includes('bass')) return 'music_note';
  if (name.includes('vocal')) return 'voice_selection';
  if (name.includes('fx') || name.includes('riser')) return 'flare';
  if (name.includes('pad')) return 'grain';
  if (sample.type === 'loop') return 'graphic_eq';
  return 'audio_file';
}

function selectPad(index) {
  state.selectedPad = state.selectedPad === index ? null : index;
  renderPadGrid();
  const sampleId = padAssignments[state.currentBank][index];
  if (sampleId && samples[sampleId]) {
    openInspector(sampleId);
  } else {
    closeInspector();
  }
}

function previewPadSample(index) {
  const sampleId = padAssignments[state.currentBank][index];
  if (sampleId) {
    previewSample(sampleId);
    renderPadGrid();
  }
}

function updatePadInfo() {
  const el = document.getElementById('pad-info');
  if (!el) return;
  if (state.selectedPad !== null) {
    const padLabel = state.currentBank + String(state.selectedPad + 1).padStart(2, '0');
    const sampleId = padAssignments[state.currentBank][state.selectedPad];
    const sample = sampleId ? samples[sampleId] : null;
    el.textContent = sample ? `${padLabel}: ${sample.name}` : `${padLabel}: EMPTY`;
  } else {
    const loadedCount = padAssignments[state.currentBank].filter(Boolean).length;
    el.textContent = `BANK ${state.currentBank} — ${loadedCount}/24`;
  }
  const targetEl = document.getElementById('gen-target-pad');
  if (targetEl) {
    if (state.selectedPad !== null) {
      const padLabel = state.currentBank + String(state.selectedPad + 1).padStart(2, '0');
      targetEl.textContent = '-> ' + padLabel;
    } else {
      targetEl.textContent = '';
    }
  }
}

function switchBank(bank) {
  state.currentBank = bank;
  state.selectedPad = null;
  document.querySelectorAll('.bank-tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent.trim() === bank);
  });
  renderPadGrid();
  closeInspector();
}

function loadToPad(padIndex, sampleId) {
  padAssignments[state.currentBank][padIndex] = sampleId;
  saveData();
  renderPadGrid();
  const padLabel = state.currentBank + String(padIndex + 1).padStart(2, '0');
  showToast(`Loaded to ${padLabel}`);
}

function clearPad(padIndex) {
  padAssignments[state.currentBank][padIndex] = null;
  saveData();
  renderPadGrid();
}

function transportPlay() {
  if (state.selectedPad !== null) {
    const sampleId = padAssignments[state.currentBank][state.selectedPad];
    if (sampleId) {
      previewSample(sampleId);
      renderPadGrid();
    }
  }
}

function transportStop() {
  if (state.isPlaying) {
    stopCurrentSource();
    state.isPlaying = false;
    state.currentSample = null;
    updatePlayButton();
    stopProgress();
    renderPadGrid();
  }
}

function toggleDrawer() {
  const drawer = document.getElementById('variations-drawer');
  if (drawer) drawer.classList.toggle('collapsed');
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

  if (state.generatingForPad !== null) {
    const { bank, index } = state.generatingForPad;
    padAssignments[bank][index] = id;
    state.generatingForPad = null;
    renderPadGrid();
    const padLabel = bank + String(index + 1).padStart(2, '0');
    saveData();
    renderVariations();
    showToast(`Kept & loaded to ${padLabel}`);
  } else {
    saveData();
    renderVariations();
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

function useStarterPrompt(el) {
  document.getElementById('gen-prompt').value = el.textContent;
  generateSamples();
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

// Library, Inspector, and Import functions moved to shared.js

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

function setRefiningUI(active) {
  const btn = document.getElementById('refine-btn');
  const btnText = document.getElementById('refine-btn-text');
  if (active) {
    btn.disabled = true;
    btn.classList.add('opacity-60');
    btnText.textContent = 'REFINING...';
  } else {
    btn.disabled = false;
    btn.classList.remove('opacity-60');
    btnText.textContent = 'REFINE';
  }
}

function clearChat() {
  state.chatMessages = [];
  const chatArea = document.getElementById('chat-area');
  if (chatArea) chatArea.classList.add('hidden');
  const chatMsgs = document.getElementById('chat-messages');
  if (chatMsgs) chatMsgs.innerHTML = '';
  if (currentVariations.length) {
    renderVariations();
  } else {
    const emptyEl = document.getElementById('gen-empty');
    if (emptyEl) emptyEl.classList.remove('hidden');
  }
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
  setRefiningUI(true);

  const params = getGenParams();
  const fullContent = buildChatUserMessage(promptText, params);

  state.chatMessages.push({ role: 'user', content: promptText, params: null, _fullContent: fullContent });
  renderChat();

  document.getElementById('chat-area').classList.remove('hidden');
  document.getElementById('gen-empty').classList.add('hidden');
  document.getElementById('chat-loading').classList.remove('hidden');

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
      setRefiningUI(false);
      document.getElementById('chat-loading').classList.add('hidden');
    });
}

// ==================== STUDIO VIEW TABS ====================
function showStudioView(view) {
  const genPage = document.getElementById('page-generate');
  const libPage = document.getElementById('page-library');
  const genTab = document.getElementById('tab-generate');
  const libTab = document.getElementById('tab-library');

  if (view === 'library') {
    if (genPage) genPage.classList.add('hidden');
    if (libPage) libPage.classList.remove('hidden');
    if (genTab) { genTab.classList.remove('text-brand', 'border-brand'); genTab.classList.add('text-txt-dim', 'border-transparent'); }
    if (libTab) { libTab.classList.add('text-brand', 'border-brand'); libTab.classList.remove('text-txt-dim', 'border-transparent'); }
    state.currentPage = 'library';
    renderLibrary();
  } else {
    if (genPage) genPage.classList.remove('hidden');
    if (libPage) libPage.classList.add('hidden');
    if (genTab) { genTab.classList.add('text-brand', 'border-brand'); genTab.classList.remove('text-txt-dim', 'border-transparent'); }
    if (libTab) { libTab.classList.remove('text-brand', 'border-brand'); libTab.classList.add('text-txt-dim', 'border-transparent'); }
    state.currentPage = 'generate';
    renderVariations();
  }
}

// ==================== PAGE CALLBACKS ====================
window.FIIRE_onProjectSwitch = function() {
  renderVariations();
  renderPadGrid();
  renderLibrary();
};

window.FIIRE_onPreviewSample = function() {
  renderVariations();
  renderPadGrid();
};

window.FIIRE_onFavoriteToggle = function() {
  if (state.currentPage === 'generate') renderVariations();
  if (state.currentPage === 'library') renderLibrary();
};

window.FIIRE_onNavigate = function(page) {
  if (page === 'library') showStudioView('library');
  else if (page === 'generate') showStudioView('generate');
};

// ==================== INIT ====================
(function initStudio() {
  initNavHighlight();
  renderProjectSwitcher();
  renderVariations();
  renderPadGrid();

  // Check hash for library tab
  if (window.location.hash === '#library') {
    showStudioView('library');
  } else {
    showStudioView('generate');
  }
})();
