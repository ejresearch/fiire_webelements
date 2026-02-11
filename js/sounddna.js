// ==================== FIIRE SOUND DNA JS ====================
// Sound DNA page: upload, analysis, profile, pack generation

let dnaScope = 'global'; // 'global' or 'project'
let globalDnaFiles = [];
let projectDnaFiles = [];

const DNA_PACK_CATEGORIES = [
  { name: 'Drums', icon: 'percussion', count: 4, type: 'loop',
    templates: ['full drum loop with kick snare and hi-hats','kick and percussion pattern','hi-hat and cymbal pattern','snare and clap pattern with ghost notes'] },
  { name: 'Bass', icon: 'graphic_eq', count: 4, type: 'loop',
    templates: ['bass line with rhythmic movement','sub bass pattern','bass stab pattern','bass groove with slides'] },
  { name: 'Melodic', icon: 'piano', count: 4, type: 'loop',
    templates: ['melodic phrase with chord progression','arpeggio pattern','lead melody line','chord pad with movement'] },
  { name: 'Textures', icon: 'waves', count: 4, type: 'oneshot',
    templates: ['atmospheric texture and ambience','impact and riser effect','foley texture and noise','transitional sweep effect'] },
];

const KEY_PROFILES = {
  major: [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
  minor: [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17],
};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ==================== FILE UPLOAD ====================
function handleDnaFileSelect(input) {
  const files = Array.from(input.files || []).filter(f =>
    f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3)$/i)
  ).slice(0, 10);
  if (!files.length) { showToast('No audio files selected'); return; }
  ensureAudioContext();

  files.forEach(file => {
    if (dnaFiles.length >= 10) return;
    if (dnaFiles.find(d => d.name === file.name)) return;
    const entry = { file, name: file.name, buffer: null, analysis: null, status: 'loading' };
    dnaFiles.push(entry);

    const reader = new FileReader();
    reader.onload = e => {
      audioCtx.decodeAudioData(e.target.result.slice(0)).then(buf => {
        entry.buffer = buf;
        entry.status = 'ready';
        renderDnaTrackList();
      }).catch(() => {
        entry.status = 'error';
        renderDnaTrackList();
        showToast('Could not decode ' + file.name);
      });
    };
    reader.readAsArrayBuffer(file);
  });

  if (input.value !== undefined) input.value = '';
  renderDnaTrackList();
}

function initDnaDropZone() {
  const zone = document.getElementById('dna-drop-zone');
  if (!zone || zone._dnaInit) return;
  zone._dnaInit = true;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dna-drop-active'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dna-drop-active'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dna-drop-active');
    if (e.dataTransfer.files.length) handleDnaFileSelect({ files: e.dataTransfer.files });
  });
}

function renderDnaTrackList() {
  const list = document.getElementById('dna-track-list');
  const actions = document.getElementById('dna-track-actions');
  if (!dnaFiles.length) { list.classList.add('hidden'); actions.classList.add('hidden'); return; }

  list.classList.remove('hidden');
  actions.classList.remove('hidden');
  document.getElementById('dna-track-count').textContent = dnaFiles.filter(d => d.status === 'ready' || d.status === 'analyzed').length;

  list.innerHTML = dnaFiles.map((d, i) => {
    const icon = d.status === 'loading' ? 'hourglass_top' : d.status === 'error' ? 'error' : d.status === 'analyzed' ? 'check_circle' : 'audio_file';
    const iconColor = d.status === 'error' ? 'text-red-400' : d.status === 'analyzed' ? 'text-emerald-400' : 'text-txt-dim';
    const dur = d.buffer ? (d.buffer.duration / 60).toFixed(1) + ' min' : '';
    return '<div class="dna-track-item flex items-center gap-3 bg-surface border border-border rounded px-4 py-2.5">' +
      '<span class="material-symbols-outlined ' + iconColor + ' text-[20px]">' + icon + '</span>' +
      '<span class="flex-1 text-sm font-medium truncate">' + d.name + '</span>' +
      '<span class="text-xs text-txt-dim">' + dur + '</span>' +
      '<button class="text-txt-dim hover:text-red-400 transition-colors" onclick="removeDnaTrack(' + i + ')">' +
        '<span class="material-symbols-outlined text-[16px]">close</span>' +
      '</button></div>';
  }).join('');
}

function removeDnaTrack(idx) {
  dnaFiles.splice(idx, 1);
  renderDnaTrackList();
}

function clearDnaTracks() {
  dnaFiles = [];
  dnaProfile = null;
  dnaCategoryResults = [];
  document.getElementById('dna-profile-section').classList.add('hidden');
  document.getElementById('dna-analysis-section').classList.add('hidden');
  document.getElementById('dna-results-section').classList.add('hidden');
  renderDnaTrackList();
}

// ==================== AUDIO ANALYSIS ====================
function detectBPM(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const winSize = 1024, hopSize = 512;
  const numFrames = Math.floor((data.length - winSize) / hopSize);
  if (numFrames < 2) return { bpm: 120, confidence: 0 };

  const energies = [];
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let sum = 0;
    for (let j = start; j < start + winSize; j++) sum += data[j] * data[j];
    energies.push(sum / winSize);
  }

  const onsets = [];
  for (let i = 1; i < energies.length; i++) onsets.push(Math.max(0, energies[i] - energies[i - 1]));

  const mean = onsets.reduce((a, b) => a + b, 0) / onsets.length;
  const threshold = mean * 1.5;
  const peaks = [];
  for (let i = 1; i < onsets.length - 1; i++) {
    if (onsets[i] > threshold && onsets[i] > onsets[i - 1] && onsets[i] > onsets[i + 1]) {
      peaks.push(i * hopSize / sr);
    }
  }
  if (peaks.length < 2) return { bpm: 120, confidence: 0 };

  const iois = [];
  for (let i = 1; i < peaks.length; i++) iois.push(peaks[i] - peaks[i - 1]);

  const bpmCounts = {};
  iois.forEach(ioi => {
    let bpm = Math.round(60 / ioi);
    while (bpm > 200) bpm = Math.round(bpm / 2);
    while (bpm < 60) bpm = bpm * 2;
    bpm = Math.round(bpm);
    bpmCounts[bpm] = (bpmCounts[bpm] || 0) + 1;
  });

  let bestBpm = 120, bestCount = 0;
  Object.entries(bpmCounts).forEach(([b, c]) => {
    const bInt = parseInt(b);
    const cluster = c + (bpmCounts[bInt - 1] || 0) + (bpmCounts[bInt + 1] || 0);
    if (cluster > bestCount) { bestCount = cluster; bestBpm = bInt; }
  });

  return { bpm: bestBpm, confidence: Math.min(1, bestCount / iois.length) };
}

function detectKey(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const fftSize = 4096;
  const numFrames = 8;
  const spacing = Math.max(1, Math.floor((data.length - fftSize) / numFrames));
  const chroma = new Float32Array(12);

  const minBin = Math.ceil(65 * fftSize / sr);
  const maxBin = Math.min(Math.floor(2000 * fftSize / sr), fftSize / 2);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * spacing;
    if (offset + fftSize > data.length) break;
    for (let bin = minBin; bin <= maxBin; bin++) {
      let re = 0, im = 0;
      for (let n = 0; n < fftSize; n++) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * n / (fftSize - 1)));
        const angle = -2 * Math.PI * bin * n / fftSize;
        re += data[offset + n] * w * Math.cos(angle);
        im += data[offset + n] * w * Math.sin(angle);
      }
      const mag = Math.sqrt(re * re + im * im);
      const freq = bin * sr / fftSize;
      const midi = 12 * Math.log2(freq / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag;
    }
  }

  const maxVal = Math.max(...chroma);
  if (maxVal > 0) for (let i = 0; i < 12; i++) chroma[i] /= maxVal;

  let bestKey = 'C', bestCorr = -Infinity;
  for (let root = 0; root < 12; root++) {
    for (const mode of ['major', 'minor']) {
      const profile = KEY_PROFILES[mode];
      let corr = 0;
      for (let i = 0; i < 12; i++) corr += chroma[(root + i) % 12] * profile[i];
      if (corr > bestCorr) {
        bestCorr = corr;
        bestKey = NOTE_NAMES[root] + (mode === 'minor' ? 'm' : '');
      }
    }
  }
  return { key: bestKey, chroma: Array.from(chroma), confidence: bestCorr };
}

function analyzeEnergy(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  let sumSq = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    sumSq += data[i] * data[i];
    if (abs > peak) peak = abs;
  }
  const rms = Math.sqrt(sumSq / data.length);
  const rmsDb = 20 * Math.log10(rms + 1e-10);
  const peakDb = 20 * Math.log10(peak + 1e-10);
  const energyNorm = Math.max(0, Math.min(1, (rmsDb + 40) / 40));
  return {
    rms, rmsDb, peak, peakDb, energyNorm,
    dynamicRange: peakDb - rmsDb,
    label: energyNorm > 0.7 ? 'High' : energyNorm > 0.4 ? 'Medium' : 'Low'
  };
}

async function analyzeSpectrumFast(audioBuffer) {
  const bandDefs = [
    { name: 'sub', freq: 40, type: 'lowpass' },
    { name: 'bass', freq: 150, type: 'bandpass' },
    { name: 'lowMid', freq: 500, type: 'bandpass' },
    { name: 'mid', freq: 2000, type: 'bandpass' },
    { name: 'high', freq: 8000, type: 'bandpass' },
    { name: 'air', freq: 14000, type: 'highpass' },
  ];
  const results = {};
  for (const band of bandDefs) {
    const offCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuffer;
    const filter = offCtx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.freq;
    filter.Q.value = 1;
    src.connect(filter);
    filter.connect(offCtx.destination);
    src.start();
    const rendered = await offCtx.startRendering();
    const ch = rendered.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    results[band.name] = Math.sqrt(sum / ch.length);
  }
  return results;
}

async function analyzeTrack(audioBuffer) {
  const bpm = detectBPM(audioBuffer);
  const key = detectKey(audioBuffer);
  const energy = analyzeEnergy(audioBuffer);
  const spectrum = await analyzeSpectrumFast(audioBuffer);
  return { bpm, key, energy, spectrum, duration: audioBuffer.duration };
}

// ==================== ANALYSIS ORCHESTRATION ====================
function updateDnaProgress(current, total, label) {
  const pct = Math.round((current / total) * 100);
  const labelEl = document.getElementById('dna-progress-label');
  if (labelEl) labelEl.textContent = label;
  const pctEl = document.getElementById('dna-progress-pct');
  if (pctEl) pctEl.textContent = pct + '%';
  const barEl = document.getElementById('dna-progress-bar');
  if (barEl) barEl.style.width = pct + '%';
}

async function analyzeDnaTracks() {
  const ready = dnaFiles.filter(d => d.status === 'ready' && d.buffer);
  if (ready.length < 2) { showToast('Upload at least 2 tracks'); return; }

  document.getElementById('dna-analysis-section').classList.remove('hidden');
  document.getElementById('dna-profile-section').classList.add('hidden');
  document.getElementById('dna-results-section').classList.add('hidden');
  const btn = document.getElementById('dna-analyze-btn');
  btn.disabled = true;
  btn.classList.add('opacity-50');

  for (let i = 0; i < ready.length; i++) {
    updateDnaProgress(i, ready.length, 'Analyzing "' + ready[i].name + '"...');
    try {
      ready[i].analysis = await analyzeTrack(ready[i].buffer);
      ready[i].status = 'analyzed';
    } catch (e) {
      console.error('Analysis failed:', ready[i].name, e);
      ready[i].status = 'error';
    }
    renderDnaTrackList();
    await new Promise(r => setTimeout(r, 50));
  }

  updateDnaProgress(ready.length, ready.length, 'Building profile...');

  const analyzed = dnaFiles.filter(d => d.analysis);
  if (analyzed.length > 0) {
    dnaProfile = buildSoundProfile(analyzed.map(d => d.analysis));
    renderDnaProfile();
    saveDnaProfile();
    dnaFiles.forEach(d => { d.buffer = null; });
  }

  btn.disabled = false;
  btn.classList.remove('opacity-50');
  document.getElementById('dna-analysis-section').classList.add('hidden');
  document.getElementById('dna-progress-container').classList.remove('dna-analyzing');
}

// ==================== SOUND PROFILE ====================
function buildSoundProfile(analyses) {
  const bpms = analyses.map(a => ({ bpm: a.bpm.bpm, confidence: a.bpm.confidence }));
  const weighted = bpms.filter(b => b.confidence > 0.2);
  const avgBpm = weighted.length > 0
    ? Math.round(weighted.reduce((s, b) => s + b.bpm * b.confidence, 0) / weighted.reduce((s, b) => s + b.confidence, 0))
    : 120;
  const bpmRange = { low: Math.min(...bpms.map(b => b.bpm)), high: Math.max(...bpms.map(b => b.bpm)), center: avgBpm };

  const keyCounts = {};
  analyses.forEach(a => { keyCounts[a.key.key] = (keyCounts[a.key.key] || 0) + a.key.confidence; });
  const dominantKey = Object.entries(keyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'C';

  const avgChroma = new Float32Array(12);
  analyses.forEach(a => { for (let i = 0; i < 12; i++) avgChroma[i] += a.key.chroma[i]; });
  for (let i = 0; i < 12; i++) avgChroma[i] /= analyses.length;

  const avgEnergy = analyses.reduce((s, a) => s + a.energy.energyNorm, 0) / analyses.length;
  const avgDynamic = analyses.reduce((s, a) => s + a.energy.dynamicRange, 0) / analyses.length;

  const bandNames = Object.keys(analyses[0].spectrum);
  const avgSpectrum = {};
  bandNames.forEach(name => { avgSpectrum[name] = analyses.reduce((s, a) => s + a.spectrum[name], 0) / analyses.length; });
  const totalSpectrum = Object.values(avgSpectrum).reduce((s, v) => s + v, 0) || 1;
  const normSpectrum = {};
  bandNames.forEach(name => { normSpectrum[name] = avgSpectrum[name] / totalSpectrum; });

  const brightness = (normSpectrum.high + normSpectrum.air) / (normSpectrum.sub + normSpectrum.bass + 0.001);
  const warmth = (normSpectrum.sub + normSpectrum.bass + normSpectrum.lowMid) / (normSpectrum.mid + normSpectrum.high + 0.001);
  const brightnessNorm = Math.min(1, brightness / 2);
  const warmthNorm = Math.min(1, warmth / 3);

  const descriptors = [];
  if (avgBpm <= 80) descriptors.push('Slow');
  else if (avgBpm <= 110) descriptors.push('Mid-Tempo');
  else if (avgBpm <= 135) descriptors.push('Upbeat');
  else descriptors.push('High-Energy');

  if (avgEnergy > 0.7) { descriptors.push('Loud'); descriptors.push('Intense'); }
  else if (avgEnergy > 0.4) descriptors.push('Punchy');
  else { descriptors.push('Soft'); descriptors.push('Subtle'); }

  if (brightnessNorm > 0.6) { descriptors.push('Bright'); descriptors.push('Crispy'); }
  else if (brightnessNorm < 0.3) { descriptors.push('Dark'); descriptors.push('Heavy'); }
  if (warmthNorm > 0.6) { descriptors.push('Warm'); descriptors.push('Full'); }
  else if (warmthNorm < 0.3) { descriptors.push('Thin'); descriptors.push('Airy'); }

  if (normSpectrum.sub > 0.15) descriptors.push('Sub-Heavy');
  if (avgDynamic > 15) descriptors.push('Dynamic');
  else if (avgDynamic < 6) descriptors.push('Compressed');
  if (dominantKey.endsWith('m')) descriptors.push('Minor');
  else descriptors.push('Major');

  const tempoWord = avgBpm <= 90 ? 'Laid-Back' : avgBpm <= 120 ? 'Groovy' : avgBpm <= 140 ? 'Driving' : 'Fast';
  const toneWord = brightnessNorm > 0.5 ? 'Bright' : warmthNorm > 0.5 ? 'Warm' : 'Balanced';
  const energyWord = avgEnergy > 0.6 ? 'Powerful' : avgEnergy > 0.3 ? 'Smooth' : 'Delicate';

  return {
    bpmRange, dominantKey,
    avgChroma: Array.from(avgChroma),
    energy: avgEnergy,
    energyLabel: avgEnergy > 0.7 ? 'High' : avgEnergy > 0.4 ? 'Medium' : 'Low',
    brightness: brightnessNorm,
    warmth: warmthNorm,
    spectrum: normSpectrum,
    dynamicRange: avgDynamic,
    descriptors: [...new Set(descriptors)],
    title: tempoWord + ' ' + toneWord + ' ' + energyWord,
    subtitle: avgBpm + ' BPM / ' + dominantKey + ' / ' + analyses.length + ' tracks analyzed',
    characteristics: {
      'Brightness': brightnessNorm,
      'Warmth': warmthNorm,
      'Energy': avgEnergy,
      'Low End': Math.min(1, (normSpectrum.sub + normSpectrum.bass) * 3),
      'Dynamics': Math.min(1, avgDynamic / 20),
    },
    trackCount: analyses.length,
    createdAt: Date.now(),
  };
}

function saveDnaProfile() {
  if (!dnaProfile) return;
  if (dnaScope === 'global') {
    globalDnaProfile = dnaProfile;
    localStorage.setItem('fiire_dna_global', JSON.stringify(dnaProfile));
  } else {
    if (!currentProjectId) return;
    localStorage.setItem('fiire_dna_' + currentProjectId, JSON.stringify(dnaProfile));
  }
}

function loadDnaProfile() {
  if (dnaScope === 'global') {
    try { return JSON.parse(localStorage.getItem('fiire_dna_global')); } catch(e) { return null; }
  }
  if (!currentProjectId) return null;
  try { return JSON.parse(localStorage.getItem('fiire_dna_' + currentProjectId)); } catch(e) { return null; }
}

// ==================== PROFILE RENDERING ====================
function renderDnaProfile() {
  if (!dnaProfile) return;
  document.getElementById('dna-profile-section').classList.remove('hidden');
  document.getElementById('dna-profile-title').textContent = dnaProfile.title;
  document.getElementById('dna-profile-subtitle').textContent = dnaProfile.subtitle;
  document.getElementById('dna-bpm').textContent = dnaProfile.bpmRange.low + '\u2013' + dnaProfile.bpmRange.high + ' BPM (center: ' + dnaProfile.bpmRange.center + ')';
  document.getElementById('dna-key').textContent = dnaProfile.dominantKey;
  document.getElementById('dna-energy').textContent = dnaProfile.energyLabel;
  document.getElementById('dna-texture').textContent = dnaProfile.brightness > 0.5 ? 'Bright' : dnaProfile.warmth > 0.5 ? 'Warm' : 'Balanced';

  document.getElementById('dna-characteristics').innerHTML = Object.entries(dnaProfile.characteristics).map(([name, value]) =>
    '<div><div class="flex justify-between text-xs mb-1"><span class="text-txt-muted font-medium">' + name + '</span><span class="text-txt-dim">' + Math.round(value * 100) + '%</span></div><div class="dna-bar"><div class="dna-bar-fill" style="width:' + (value * 100) + '%"></div></div></div>'
  ).join('');

  document.getElementById('dna-tags').innerHTML = dnaProfile.descriptors.map(d =>
    '<span class="px-2.5 py-1 bg-brand/10 border border-brand/20 rounded text-xs text-brand font-medium">' + d + '</span>'
  ).join('');
}

function switchDnaScope(scope) {
  // Save current files to the right bucket
  if (dnaScope === 'global') globalDnaFiles = dnaFiles;
  else projectDnaFiles = dnaFiles;

  dnaScope = scope;

  // Restore files for new scope
  dnaFiles = scope === 'global' ? globalDnaFiles : projectDnaFiles;

  // Update tabs
  const tabGlobal = document.getElementById('dna-tab-global');
  const tabProject = document.getElementById('dna-tab-project');
  if (scope === 'global') {
    tabGlobal.className = 'px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b-2 text-brand border-brand transition-colors';
    tabProject.className = 'px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b-2 text-txt-dim border-transparent hover:text-txt-muted transition-colors';
  } else {
    tabProject.className = 'px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b-2 text-brand border-brand transition-colors';
    tabGlobal.className = 'px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b-2 text-txt-dim border-transparent hover:text-txt-muted transition-colors';
  }

  // Update header
  const projName = currentProjectId && projects[currentProjectId] ? projects[currentProjectId].name : 'Project';
  document.getElementById('dna-page-title').textContent = scope === 'global' ? 'Global Sound DNA' : 'Project DNA: ' + projName;
  document.getElementById('dna-page-subtitle').textContent = scope === 'global'
    ? 'Upload your tracks to discover your overall sonic identity across all projects.'
    : 'Upload tracks specific to this project to build a focused sound profile.';

  // Reset UI and reload profile
  dnaProfile = null;
  dnaCategoryResults = [];
  document.getElementById('dna-profile-section').classList.add('hidden');
  document.getElementById('dna-analysis-section').classList.add('hidden');
  document.getElementById('dna-results-section').classList.add('hidden');

  renderSoundDna();
}

function renderSoundDna() {
  const existing = loadDnaProfile();
  if (existing && !dnaProfile) {
    dnaProfile = existing;
    renderDnaProfile();
  }
  renderDnaTrackList();
  initDnaDropZone();
}

// ==================== PROMPT CONSTRUCTION ====================
function buildDnaPrompt(profile, category, templateIndex) {
  const template = category.templates[templateIndex];
  const parts = [template];
  if (category.type === 'loop') parts.push(profile.bpmRange.center + ' BPM');
  parts.push('in ' + profile.dominantKey);

  if (profile.brightness > 0.6) parts.push('bright and airy sound');
  else if (profile.brightness < 0.3) parts.push('dark and heavy sound');
  else if (profile.warmth > 0.6) parts.push('warm and full sound');
  else parts.push('balanced tone');

  if (profile.energy > 0.7) parts.push('high energy loud punchy');
  else if (profile.energy > 0.4) parts.push('moderate energy controlled');
  else parts.push('soft and subtle understated');

  const relevant = profile.descriptors.filter(d => !['Major','Minor'].includes(d)).slice(0, 3);
  if (relevant.length) parts.push(relevant.join(' ').toLowerCase());
  if (profile.spectrum && profile.spectrum.sub > 0.12) parts.push('deep sub bass presence');

  return parts.join(', ');
}

function calcDnaDuration(profile, category) {
  if (category.type === 'loop') {
    const bpm = profile.bpmRange.center;
    return Math.min(22, Math.max(2, 4 * (60 / bpm) * 4));
  }
  return 3;
}

// ==================== PACK GENERATION ====================
async function generateDnaPack() {
  const activeProfile = dnaProfile || (dnaScope === 'project' ? globalDnaProfile : null);
  if (!activeProfile) { showToast('Analyze tracks first'); return; }
  // Use active profile for generation
  dnaProfile = activeProfile;
  if (state.generating) return;
  if (!ELEVENLABS_API_KEY) { showToast('Set your ElevenLabs API key in Settings first'); return; }

  state.generating = true;
  document.getElementById('dna-results-section').classList.remove('hidden');
  document.getElementById('dna-gen-loading').classList.remove('hidden');
  document.getElementById('dna-results-grid').innerHTML = '';
  document.getElementById('dna-results-actions').classList.add('hidden');
  document.getElementById('dna-generate-btn').disabled = true;
  document.getElementById('dna-generate-btn').classList.add('opacity-50');

  const sessionId = uid('ses');
  const allIds = [];
  dnaCategoryResults = [];

  const totalSamples = DNA_PACK_CATEGORIES.reduce((s, c) => s + c.count, 0);
  let completed = 0, failed = 0;

  for (const category of DNA_PACK_CATEGORIES) {
    const catIds = [];
    for (let i = 0; i < category.count; i++) {
      const id = uid('smp');
      const prompt = buildDnaPrompt(dnaProfile, category, i);
      const duration = calcDnaDuration(dnaProfile, category);
      const isLoop = category.type === 'loop';

      samples[id] = {
        id, type: category.type,
        name: 'DNA ' + category.name + ' ' + (i + 1),
        status: 'pending', duration: Math.round(duration * 100) / 100,
        bpm: isLoop ? dnaProfile.bpmRange.center : null, key: dnaProfile.dominantKey,
        bars: isLoop ? 4 : null, tuning: null, attack: null, timbre: null,
        style: dnaProfile.descriptors.slice(0, 3),
        tags: ['Sound DNA', category.name, ...dnaProfile.descriptors.slice(0, 2)],
        notes: 'Generated from Sound DNA profile: ' + dnaProfile.title,
        effects: {}, generationSessionId: sessionId, variationIndex: i,
        parentSampleId: null, modelVersion: 'ElevenLabs SFX v2',
        createdAt: Date.now() - (category.count - i) * 100,
        acceptedAt: null, favoritedAt: null, isFavorite: false, isInLibrary: false,
        rejectionFeedback: null, waveformData: placeholderWaveform(80),
        projectId: currentProjectId, dnaCategory: category.name, dnaPrompt: prompt,
      };
      catIds.push(id);
      allIds.push(id);
    }
    dnaCategoryResults.push({ category, ids: catIds });
  }

  sessions[sessionId] = {
    id: sessionId, type: 'dna-pack',
    params: { type: 'dna-pack', profile: dnaProfile.title, bpm: dnaProfile.bpmRange.center, key: dnaProfile.dominantKey, styles: dnaProfile.descriptors },
    variationIds: allIds, acceptedCount: 0, rejectedCount: 0,
    createdAt: Date.now(), projectId: currentProjectId,
  };

  currentVariations = allIds;
  saveData();

  const queue = [];
  for (const { category, ids } of dnaCategoryResults) {
    for (let i = 0; i < ids.length; i++) {
      const s = samples[ids[i]];
      queue.push({ id: ids[i], prompt: s.dnaPrompt, duration: s.duration, isLoop: category.type === 'loop' });
    }
  }

  let queueIdx = 0;
  function processNext() {
    if (queueIdx >= queue.length) return Promise.resolve();
    const item = queue[queueIdx++];
    return callElevenLabsSfx(item.prompt, item.duration, item.isLoop)
      .then(pcmData => {
        ensureAudioContext();
        const buf = pcmToAudioBuffer(pcmData, 44100);
        samples[item.id].duration = buf.duration;
        cacheAndPersistBuffer(item.id, buf);
        saveData();
      })
      .catch(err => {
        console.error('DNA generation failed for ' + item.id + ':', err);
        failed++;
        ensureAudioContext();
        getAudioBuffer(item.id);
      })
      .finally(() => {
        completed++;
        document.getElementById('dna-gen-progress').textContent = completed + ' of ' + totalSamples + ' samples';
        if (completed === totalSamples) finishDnaGeneration(failed);
        return processNext();
      });
  }

  const workers = [];
  for (let w = 0; w < 2; w++) workers.push(processNext());
  await Promise.all(workers);
}

function finishDnaGeneration(failed) {
  state.generating = false;
  document.getElementById('dna-gen-loading').classList.add('hidden');
  document.getElementById('dna-results-actions').classList.remove('hidden');
  document.getElementById('dna-generate-btn').disabled = false;
  document.getElementById('dna-generate-btn').classList.remove('opacity-50');
  renderDnaResults();
  const total = dnaCategoryResults.reduce((s, c) => s + c.ids.length, 0);
  showToast(failed > 0 ? 'Generated ' + (total - failed) + ' samples (' + failed + ' fell back to synthetic)' : 'Your Sound DNA pack is ready!');
}

function renderDnaResults() {
  const container = document.getElementById('dna-results-grid');
  container.innerHTML = dnaCategoryResults.map(({ category, ids }) => {
    const cards = ids.map(id => {
      const s = samples[id];
      if (!s) return '';
      const isPlaying = state.currentSample === id && state.isPlaying;
      return '<div class="variation-card border border-border rounded p-3 flex items-center gap-3 ' + (isPlaying ? 'playing' : '') + '" data-id="' + id + '">' +
        '<button class="w-8 h-8 rounded bg-surface flex items-center justify-center flex-shrink-0 hover:bg-dk-gray transition-colors" onclick="previewSample(\'' + id + '\')">' +
          '<span class="material-symbols-outlined text-[18px] ' + (isPlaying ? 'text-brand fill-1' : 'text-txt-muted') + '">' + (isPlaying ? 'pause' : 'play_arrow') + '</span>' +
        '</button>' +
        '<canvas class="var-waveform flex-1 h-8 rounded" data-id="' + id + '" width="200" height="32"></canvas>' +
        '<div class="flex items-center gap-1.5 flex-shrink-0"><span class="text-xs text-txt-muted font-medium">' + s.name + '</span><span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ' + (s.type === 'loop' ? 'badge-loop' : 'badge-oneshot') + '">' + s.type + '</span></div>' +
        '<div class="flex items-center gap-1 flex-shrink-0">' +
          '<button class="p-1 rounded hover:bg-surface transition-colors" title="Accept" onclick="acceptDnaSample(\'' + id + '\')">' +
            '<span class="material-symbols-outlined text-[16px] ' + (s.status === 'accepted' ? 'text-emerald-400 fill-1' : 'text-txt-dim') + '">check_circle</span>' +
          '</button>' +
          '<button class="p-1 rounded hover:bg-surface transition-colors" title="Download" onclick="downloadSample(\'' + id + '\')">' +
            '<span class="material-symbols-outlined text-[16px] text-txt-dim">download</span>' +
          '</button>' +
        '</div></div>';
    }).join('');
    return '<div><div class="flex items-center gap-2 mb-2"><span class="material-symbols-outlined text-brand text-[18px]">' + category.icon + '</span><h4 class="text-sm font-bold">' + category.name + '</h4><span class="text-[10px] text-txt-dim">' + ids.length + ' samples</span></div><div class="space-y-1.5">' + cards + '</div></div>';
  }).join('');

  requestAnimationFrame(() => {
    document.querySelectorAll('#dna-results-grid .var-waveform').forEach(canvas => {
      const id = canvas.dataset.id;
      const s = samples[id];
      if (s) drawWaveform(canvas, s.waveformData, s.status === 'rejected' ? '#444' : '#E85002');
    });
  });
}

function acceptDnaSample(id) {
  const s = samples[id];
  if (!s || s.status === 'accepted') return;
  s.status = 'accepted'; s.acceptedAt = Date.now(); s.isInLibrary = true;
  const session = sessions[s.generationSessionId];
  if (session) session.acceptedCount++;
  decisions.push({ sampleId: id, action: 'accept', timestamp: Date.now() });
  saveData(); renderDnaResults();
  showToast(s.name + ' accepted & added to library!');
}

function acceptAllDnaSamples() {
  let count = 0;
  currentVariations.forEach(id => {
    const s = samples[id];
    if (s && s.status !== 'accepted') {
      s.status = 'accepted'; s.acceptedAt = Date.now(); s.isInLibrary = true;
      const session = sessions[s.generationSessionId];
      if (session) session.acceptedCount++;
      decisions.push({ sampleId: id, action: 'accept', timestamp: Date.now() });
      count++;
    }
  });
  saveData(); renderDnaResults();
  showToast(count + ' samples accepted & added to library!');
}

// ==================== PAGE CALLBACKS ====================
window.FIIRE_onProjectSwitch = function() {
  // Reset project-scoped data
  projectDnaFiles = [];
  dnaCategoryResults = [];
  if (dnaScope === 'project') {
    dnaFiles = [];
    dnaProfile = null;
    document.getElementById('dna-profile-section').classList.add('hidden');
    document.getElementById('dna-results-section').classList.add('hidden');
  }
  // Re-render with current scope
  switchDnaScope(dnaScope);
};

// ==================== INIT ====================
(function initSoundDna() {
  initNavHighlight();
  renderProjectSwitcher();
  // Default to global if no global profile yet, otherwise show whichever is missing
  const hasGlobal = !!localStorage.getItem('fiire_dna_global');
  const hasProject = currentProjectId && !!localStorage.getItem('fiire_dna_' + currentProjectId);
  dnaScope = (!hasGlobal) ? 'global' : (!hasProject ? 'project' : 'global');
  switchDnaScope(dnaScope);
})();
