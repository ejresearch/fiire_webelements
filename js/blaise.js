/* ==================== BLAISE — FIIRE AI Chat Bubble ==================== */
/* Self-injecting floating chat widget available on every page             */
/* Depends on: shared.js (loaded first)                                    */

(function initBlaise() {

const BLAISE_SYSTEM_PROMPT = `You are Blaise, a creative music production AI inside FIIRE. You help producers brainstorm AND generate samples directly in conversation.

You know about:
- Music production across all genres (trap, boombap, house, techno, DNB, ambient, R&B, lo-fi, funk, afrobeat, etc.)
- Sound design concepts (textures, timbres, layering, processing)
- Song structure, arrangement, and workflow
- Sample selection and curation strategies
- The FIIRE Studio tools: AI sample generation (loops & one-shots), Sound DNA profiling, pad grid arrangement

You can generate samples directly in conversation. When the user describes a sound or you think a sample would help the conversation, include a prompt block. The system will automatically generate the audio and play it inline. Be proactive — if the user says "I need a dark 808 pattern", don't just describe it, generate it.

Format prompt blocks like this:

\`\`\`prompt
{
  "text": "detailed descriptive prompt for the sound generator",
  "mode": "loop or oneshot",
  "bpm": 120,
  "duration": 4
}
\`\`\`

Prompt block rules:
- "text" should be vivid and specific — describe the texture, character, rhythm, genre, and energy
- "mode" is "loop" for rhythmic/melodic patterns, "oneshot" for single hits/stabs/fx
- "bpm" is optional, include for loops (60-180 range)
- "duration" in seconds — loops: 2-8s, oneshots: 0.5-2s
- You can include multiple prompt blocks in one message to give the user options
- After generating, ask what they think — refine based on feedback

Rules:
- Be conversational but concise — this is a creative tool, not a lecture
- Ask clarifying questions when direction is vague
- Suggest specific, actionable ideas (not generic advice)
- When suggesting sounds, be precise about textures and characteristics
- Be proactive about generating — drop samples when the idea is clear enough
- Build on the user's existing Sound DNA profile when relevant
- Reference specific details from the active project context provided below`;

// ==================== PROJECT CONTEXT ====================
function buildProjectContext() {
  const parts = [];

  // Current project
  const proj = currentProjectId && projects[currentProjectId];
  if (proj) {
    parts.push(`Active project: "${proj.name}"`);
  }

  // Sample inventory for this project
  const projSamples = Object.values(samples).filter(s => s.projectId === currentProjectId);
  if (projSamples.length) {
    const byType = {};
    projSamples.forEach(s => {
      const cat = s.instrument || s.category || 'unknown';
      byType[cat] = (byType[cat] || 0) + 1;
    });
    const summary = Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ');
    parts.push(`Samples in project: ${projSamples.length} total (${summary})`);

    // Recent samples (last 5)
    const recent = projSamples.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    const names = recent.map(s => s.name || s.prompt || 'untitled').join(', ');
    parts.push(`Recent samples: ${names}`);
  } else {
    parts.push('No samples generated yet in this project.');
  }

  // Sound DNA profiles
  function formatDna(profile) {
    const bits = [];
    if (profile.bpmRange) bits.push(`BPM: ${profile.bpmRange.low}-${profile.bpmRange.high} (center ${profile.bpmRange.center})`);
    if (profile.dominantKey) bits.push(`Key: ${profile.dominantKey}`);
    if (profile.energyLabel) bits.push(`Energy: ${profile.energyLabel}`);
    if (profile.title) bits.push(`Character: ${profile.title}`);
    if (profile.descriptors?.length) bits.push(`Descriptors: ${profile.descriptors.join(', ')}`);
    return bits.join(' | ');
  }
  if (globalDnaProfile) {
    parts.push(`Global Sound DNA: ${formatDna(globalDnaProfile)}`);
  }
  // Project-specific DNA (loaded from localStorage for current project)
  let projDna = null;
  if (currentProjectId) {
    try { projDna = JSON.parse(localStorage.getItem('fiire_dna_' + currentProjectId)); } catch(e) {}
  }
  if (projDna) {
    parts.push(`Project Sound DNA: ${formatDna(projDna)}`);
  } else if (globalDnaProfile) {
    parts.push('No project-specific Sound DNA — using global profile as reference.');
  }

  // Current page context
  const page = window.location.pathname.split('/').pop() || '';
  if (page.includes('home')) parts.push('User is on the Home dashboard (global library, projects).');
  else if (page.includes('studio')) parts.push('User is currently on the Studio page (generate/library).');
  else if (page.includes('sounddna')) parts.push('User is currently on the Sound DNA page.');
  else if (page.includes('onboarding')) parts.push('User is on the onboarding/welcome page.');

  if (!parts.length) return '';
  return '\n\n--- CURRENT PROJECT CONTEXT ---\n' + parts.join('\n');
}

let blazeMessages = [];
let blazeRefining = false;
let blazeOpen = false;
// Track generated samples by message index + prompt index
let blazeGeneratedSamples = {};

// ==================== SAMPLE GENERATION ====================
function blazeGenerateSample(promptData, msgIndex, promptIndex) {
  const key = msgIndex + '_' + promptIndex;
  if (blazeGeneratedSamples[key]) return; // Already generating/generated

  if (!ELEVENLABS_API_KEY) {
    showToast('Set your ElevenLabs API key in Settings to generate samples');
    if (typeof openSettingsModal === 'function') openSettingsModal();
    return;
  }

  blazeGeneratedSamples[key] = { status: 'generating' };
  renderMessages();

  const isLoop = promptData.mode === 'loop';
  const duration = promptData.duration || (isLoop ? 4 : 1.5);
  const prompt = promptData.text;

  ensureAudioContext();

  callElevenLabsSfx(prompt, duration, isLoop)
    .then(pcmData => {
      const buf = pcmToAudioBuffer(pcmData, 44100);
      const id = uid('smp');
      samples[id] = {
        id, type: isLoop ? 'loop' : 'oneshot',
        name: prompt.slice(0, 40) + (prompt.length > 40 ? '...' : ''),
        status: 'accepted',
        duration: buf.duration,
        bpm: promptData.bpm || null,
        key: null,
        bars: null,
        tags: [],
        notes: 'Generated by Blaise',
        effects: {},
        modelVersion: 'ElevenLabs SFX v2',
        createdAt: Date.now(),
        isFavorite: false,
        isInLibrary: true,
        waveformData: placeholderWaveform(80),
        projectId: currentProjectId,
      };
      cacheAndPersistBuffer(id, buf);
      saveData();

      blazeGeneratedSamples[key] = { status: 'ready', sampleId: id };
      renderMessages();
    })
    .catch(err => {
      console.error('Blaise generation error:', err);
      blazeGeneratedSamples[key] = { status: 'error', error: err.message };
      renderMessages();
    });
}

function blazePlaySample(sampleId) {
  if (typeof previewSample === 'function') {
    previewSample(sampleId);
  }
}

// ==================== INJECT HTML ====================
const bubbleHTML = `
<div id="blaise-bubble" class="blaise-bubble" onclick="window._blazeToggle()">
  <span class="material-symbols-outlined text-[20px] fill-1">auto_awesome</span>
</div>
<div id="blaise-panel" class="blaise-panel">
  <div class="blaise-resize-handle" id="blaise-resize"></div>
  <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-panel">
    <div class="flex items-center gap-1.5">
      <span class="material-symbols-outlined text-brand text-[14px]">auto_awesome</span>
      <span class="text-[11px] font-bold uppercase tracking-wider">Blaise</span>
    </div>
    <div class="flex items-center gap-1">
      <button class="text-[9px] text-txt-dim hover:text-txt uppercase font-bold tracking-wider" onclick="window._blazeClear()">Clear</button>
      <button class="w-5 h-5 flex items-center justify-center text-txt-dim hover:text-txt" onclick="window._blazeToggle()">
        <span class="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  </div>
  <div id="blaise-messages" class="flex-1 overflow-y-auto px-3 py-3"></div>
  <div id="blaise-loading" class="hidden flex items-center gap-2 px-3 py-1.5">
    <div class="flex items-end gap-[1px]">
      <span class="gen-loading-bar"></span><span class="gen-loading-bar"></span><span class="gen-loading-bar"></span>
    </div>
    <span class="text-txt-muted text-[10px]">Thinking...</span>
  </div>
  <div class="flex items-center gap-2 px-3 py-2 border-t border-border bg-panel">
    <input id="blaise-input" class="flex-1 bg-[#1A1A1A] border border-[#3D3D3D] rounded-full px-3 py-1 text-[11px] text-txt placeholder:text-txt-dim focus:outline-none focus:border-[#E85002]" placeholder="Ask Blaise..." type="text"
           onkeydown="if(event.key==='Enter') window._blazeSend()"/>
    <button id="blaise-send-btn" class="bg-brand hover:bg-brand-hover text-txt font-bold w-7 h-7 rounded-full text-[10px] transition-all flex items-center justify-center flex-shrink-0" onclick="window._blazeSend()">
      <span class="material-symbols-outlined text-[12px]">send</span>
    </button>
  </div>
</div>`;

// Inject into body
const wrapper = document.createElement('div');
wrapper.innerHTML = bubbleHTML;
while (wrapper.firstChild) {
  document.body.appendChild(wrapper.firstChild);
}

// ==================== RENDER ====================
function renderMessages() {
  const container = document.getElementById('blaise-messages');
  if (!container) return;

  if (!blazeMessages.length) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-6 text-center">
        <span class="material-symbols-outlined text-3xl text-txt-dim mb-2">auto_awesome</span>
        <p class="text-[11px] font-bold mb-1">Hey, I'm Blaise</p>
        <p class="text-[10px] text-txt-muted mb-4 max-w-[240px]">Your production partner. Describe a sound and I'll generate it. Let's make something.</p>
        <div class="flex flex-col gap-1 w-full">
          <button class="text-left bg-surface border border-border px-3 py-1.5 text-[10px] text-txt-muted hover:text-txt hover:border-brand/30 transition-all" onclick="window._blazeStarter(this)">I need drums for a dark trap beat</button>
          <button class="text-left bg-surface border border-border px-3 py-1.5 text-[10px] text-txt-muted hover:text-txt hover:border-brand/30 transition-all" onclick="window._blazeStarter(this)">Help me build a lo-fi sample pack</button>
          <button class="text-left bg-surface border border-border px-3 py-1.5 text-[10px] text-txt-muted hover:text-txt hover:border-brand/30 transition-all" onclick="window._blazeStarter(this)">Ambient textures for a film score</button>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = blazeMessages.map((msg, msgIndex) => {
    if (msg.role === 'user') {
      return `<div class="flex justify-end mb-2">
        <div class="max-w-[85%] bg-surface border border-border px-3 py-1.5 rounded-full">
          <p class="text-[10px] text-txt">${escapeHtml(msg.content)}</p>
        </div>
      </div>`;
    } else {
      let content = escapeHtml(msg.content);
      let promptIndex = 0;
      // Render prompt blocks with inline generation
      content = content.replace(/```prompt\s*([\s\S]*?)```/g, (match, json) => {
        const pi = promptIndex++;
        try {
          const p = JSON.parse(json.trim());
          const key = msgIndex + '_' + pi;
          const gen = blazeGeneratedSamples[key];
          const pJson = escapeHtml(JSON.stringify(p));

          const shortName = (p.text || 'Sample').slice(0, 30) + ((p.text || '').length > 30 ? '...' : '');

          if (gen && gen.status === 'generating') {
            return `<div class="inline-flex items-center gap-1.5 mt-1 mb-0.5 px-2 py-1 bg-bg border border-border/50 rounded-full">
              <div class="flex items-end gap-[1px]"><span class="gen-loading-bar" style="height:8px;width:1.5px"></span><span class="gen-loading-bar" style="height:8px;width:1.5px"></span><span class="gen-loading-bar" style="height:8px;width:1.5px"></span></div>
              <span class="text-[9px] text-txt-muted truncate">${escapeHtml(shortName)}</span>
            </div>`;
          } else if (gen && gen.status === 'ready') {
            const s = samples[gen.sampleId];
            const name = s ? escapeHtml(s.name).slice(0, 30) + (s.name.length > 30 ? '...' : '') : shortName;
            return `<button class="inline-flex items-center gap-1.5 mt-1 mb-0.5 px-2 py-1 bg-bg border border-brand/30 rounded-full hover:border-brand transition-colors cursor-pointer" onclick="window._blazePlay('${gen.sampleId}')">
              <span class="text-[9px] text-txt truncate">${name}</span>
              <span class="material-symbols-outlined text-[12px] fill-1 text-brand">play_arrow</span>
            </button>`;
          } else if (gen && gen.status === 'error') {
            return `<button class="inline-flex items-center gap-1.5 mt-1 mb-0.5 px-2 py-1 bg-bg border border-red-500/30 rounded-full hover:border-red-500 transition-colors cursor-pointer" onclick="window._blazeRetryGen(${msgIndex}, ${pi})">
              <span class="text-[9px] text-red-400 truncate">${escapeHtml(shortName)}</span>
              <span class="material-symbols-outlined text-[10px] text-red-400">refresh</span>
            </button>`;
          } else {
            if (ELEVENLABS_API_KEY) {
              setTimeout(() => blazeGenerateSample(p, msgIndex, pi), pi * 600);
              return `<div class="inline-flex items-center gap-1.5 mt-1 mb-0.5 px-2 py-1 bg-bg border border-border/50 rounded-full">
                <div class="flex items-end gap-[1px]"><span class="gen-loading-bar" style="height:8px;width:1.5px"></span><span class="gen-loading-bar" style="height:8px;width:1.5px"></span><span class="gen-loading-bar" style="height:8px;width:1.5px"></span></div>
                <span class="text-[9px] text-txt-muted truncate">${escapeHtml(shortName)}</span>
              </div>`;
            } else {
              return `<button class="inline-flex items-center gap-1.5 mt-1 mb-0.5 px-2 py-1 bg-bg border border-border/50 rounded-full hover:border-brand transition-colors cursor-pointer" onclick="window._blazeManualGen(${msgIndex}, ${pi})">
                <span class="text-[9px] text-txt-muted truncate">${escapeHtml(shortName)}</span>
                <span class="material-symbols-outlined text-[10px] text-brand">play_arrow</span>
              </button>`;
            }
          }
        } catch(e) {
          return match;
        }
      });
      return `<div class="flex justify-start mb-2">
        <div class="max-w-[85%]">
          <span class="text-[8px] font-bold text-brand uppercase tracking-wider">BLAISE</span>
          <div class="text-[10px] text-txt leading-relaxed whitespace-pre-wrap mt-0.5">${content}</div>
        </div>
      </div>`;
    }
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// ==================== ACTIONS ====================
window._blazeToggle = function() {
  blazeOpen = !blazeOpen;
  const panel = document.getElementById('blaise-panel');
  const bubble = document.getElementById('blaise-bubble');
  if (blazeOpen) {
    panel.classList.add('open');
    bubble.classList.add('open');
    renderMessages();
    setTimeout(() => {
      const input = document.getElementById('blaise-input');
      if (input) input.focus();
    }, 100);
  } else {
    panel.classList.remove('open');
    bubble.classList.remove('open');
  }
};

window._blazeStarter = function(el) {
  document.getElementById('blaise-input').value = el.textContent;
  window._blazeSend();
};

window._blazePlay = function(sampleId) {
  blazePlaySample(sampleId);
};

window._blazeRetryGen = function(msgIndex, promptIndex) {
  const key = msgIndex + '_' + promptIndex;
  delete blazeGeneratedSamples[key];
  // Re-parse the prompt from the message
  const msg = blazeMessages[msgIndex];
  if (!msg) return;
  let pi = 0;
  const re = /```prompt\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(msg.content)) !== null) {
    if (pi === promptIndex) {
      try {
        const p = JSON.parse(m[1].trim());
        blazeGenerateSample(p, msgIndex, promptIndex);
      } catch(e) {}
      break;
    }
    pi++;
  }
};

window._blazeManualGen = function(msgIndex, promptIndex) {
  if (!ELEVENLABS_API_KEY) {
    showToast('Set your ElevenLabs API key in Settings first');
    if (typeof openSettingsModal === 'function') openSettingsModal();
    return;
  }
  window._blazeRetryGen(msgIndex, promptIndex);
};

window._blazeSend = function() {
  const input = document.getElementById('blaise-input');
  const text = input.value.trim();
  if (!text || blazeRefining) return;

  if (!CLAUDE_API_KEY) {
    showToast('Set your Claude API key in Settings first');
    if (typeof openSettingsModal === 'function') openSettingsModal();
    return;
  }

  blazeMessages.push({ role: 'user', content: text });
  input.value = '';
  renderMessages();

  blazeRefining = true;
  document.getElementById('blaise-loading').classList.remove('hidden');
  const sendBtn = document.getElementById('blaise-send-btn');
  sendBtn.disabled = true;
  sendBtn.classList.add('opacity-60');

  const apiMessages = blazeMessages.map(m => ({ role: m.role, content: m.content }));

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: CLAUDE_API_KEY,
      system: BLAISE_SYSTEM_PROMPT + buildProjectContext(),
      messages: apiMessages,
    }),
  })
  .then(res => {
    if (!res.ok) return res.json().then(j => { throw new Error(j.error?.message || j.error || `Error ${res.status}`); });
    return res.json();
  })
  .then(data => {
    if (data.error) throw new Error(typeof data.error === 'object' ? data.error.message : data.error);
    const text = data.content?.[0]?.text || '';
    blazeMessages.push({ role: 'assistant', content: text });
    renderMessages();
  })
  .catch(err => {
    showToast('Blaise error: ' + err.message);
    console.error('Blaise API error:', err);
  })
  .finally(() => {
    blazeRefining = false;
    document.getElementById('blaise-loading').classList.add('hidden');
    sendBtn.disabled = false;
    sendBtn.classList.remove('opacity-60');
  });
};

window._blazeClear = function() {
  blazeMessages = [];
  blazeGeneratedSamples = {};
  renderMessages();
};

// ==================== DRAG TO MOVE & RESIZE ====================
(function initBlaiseDrag() {
  const panel = document.getElementById('blaise-panel');
  const header = panel.querySelector('.border-b.bg-panel');
  const resizeHandle = document.getElementById('blaise-resize');
  if (!header) return;
  header.style.cursor = 'grab';

  // --- Move ---
  let moving = false, startX, startY, startLeft, startBottom;

  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    moving = true;
    header.style.cursor = 'grabbing';
    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startBottom = window.innerHeight - rect.bottom;
    panel.style.transition = 'none';
    e.preventDefault();
  });

  // --- Resize (top-left corner) ---
  let resizing = false, resStartX, resStartY, resStartW, resStartH, resStartLeft, resStartBottom;

  resizeHandle.addEventListener('mousedown', e => {
    resizing = true;
    const rect = panel.getBoundingClientRect();
    resStartX = e.clientX;
    resStartY = e.clientY;
    resStartW = rect.width;
    resStartH = rect.height;
    resStartLeft = rect.left;
    resStartBottom = window.innerHeight - rect.bottom;
    panel.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (moving) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.right = 'auto';
      panel.style.left = (startLeft + dx) + 'px';
      panel.style.bottom = (startBottom - dy) + 'px';
    }
    if (resizing) {
      const dx = e.clientX - resStartX;
      const dy = e.clientY - resStartY;
      const newW = Math.max(280, resStartW - dx);
      const newH = Math.max(300, resStartH - dy);
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      panel.style.right = 'auto';
      panel.style.left = (resStartLeft + (resStartW - newW)) + 'px';
      panel.style.bottom = resStartBottom + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (moving) { moving = false; header.style.cursor = 'grab'; panel.style.transition = ''; }
    if (resizing) { resizing = false; panel.style.transition = ''; }
  });
})();

// Initial render
renderMessages();

})();
