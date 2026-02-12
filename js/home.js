// ==================== FIIRE HOME JS ====================
// Dashboard: project picker, project grid, global library

libraryGlobalMode = true;

// ==================== PROJECT PICKER (top bar) ====================
let homeDropdownOpen = false;

function renderHomeProjectPicker() {
  const nameEl = document.getElementById('home-project-picker-name');
  if (!nameEl) return;
  const proj = currentProjectId && projects[currentProjectId];
  nameEl.textContent = proj ? proj.name : 'No Project';
}

function toggleHomeProjectDropdown() {
  homeDropdownOpen = !homeDropdownOpen;
  const dd = document.getElementById('home-project-dropdown');
  if (!dd) return;

  if (homeDropdownOpen) {
    const list = document.getElementById('home-project-dropdown-list');
    const projList = Object.values(projects).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    list.innerHTML = projList.map(p => {
      const isActive = p.id === currentProjectId;
      const count = Object.values(samples).filter(s => s.projectId === p.id && s.isInLibrary).length;
      return `
        <button class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface transition-colors ${isActive ? 'bg-brand/5' : ''}"
                onclick="switchProject('${p.id}'); toggleHomeProjectDropdown(); renderHomeProjectPicker(); renderProjectCards();">
          <span class="material-symbols-outlined text-[14px] ${isActive ? 'text-brand' : 'text-txt-dim'}">folder</span>
          <span class="flex-1 text-[11px] font-medium truncate ${isActive ? 'text-brand' : ''}">${p.name}</span>
          <span class="text-[9px] text-txt-dim">${count}</span>
          ${isActive ? '<span class="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0"></span>' : ''}
        </button>`;
    }).join('');
    dd.classList.remove('hidden');

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closeHomeDropdownOutside);
    }, 0);
  } else {
    dd.classList.add('hidden');
    document.removeEventListener('click', closeHomeDropdownOutside);
  }
}

function closeHomeDropdownOutside(e) {
  const picker = document.getElementById('home-project-picker');
  const dd = document.getElementById('home-project-dropdown');
  if (picker && !picker.contains(e.target) && dd && !dd.contains(e.target)) {
    homeDropdownOpen = false;
    dd.classList.add('hidden');
    document.removeEventListener('click', closeHomeDropdownOutside);
  }
}

// ==================== SOURCE FILTER ====================
function renderSourceFilter() {
  const select = document.getElementById('lib-source-filter');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="all">All Sources</option><option value="dna">Sound DNA</option>';
  Object.values(projects).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(p => {
    select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
  });
  select.value = current || 'all';
}

// ==================== PROJECT CARDS ====================
function renderProjectCards() {
  const container = document.getElementById('home-project-list');
  if (!container) return;

  const projList = Object.values(projects).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (!projList.length) {
    container.innerHTML = `
      <div class="text-center py-8 border-2 border-dashed border-border rounded">
        <span class="material-symbols-outlined text-3xl text-txt-dim mb-2 block">folder</span>
        <p class="text-txt-muted text-sm font-medium">No projects yet</p>
        <p class="text-txt-dim text-[11px]">Create one to start generating samples.</p>
      </div>`;
    return;
  }

  container.innerHTML = projList.map(p => {
    const count = Object.values(samples).filter(s => s.projectId === p.id && s.isInLibrary).length;
    const isActive = p.id === currentProjectId;
    const hasDna = !!localStorage.getItem('fiire_dna_' + p.id);
    const ago = timeAgo(p.updatedAt || p.createdAt);
    return `
      <div class="group bg-panel border ${isActive ? 'border-brand/40' : 'border-border'} p-4 hover:border-brand/30 transition-all cursor-pointer rounded"
           onclick="switchProject('${p.id}'); navigateTo('studio')">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-8 h-8 ${isActive ? 'bg-brand/15' : 'bg-surface'} flex items-center justify-center flex-shrink-0 rounded">
            <span class="material-symbols-outlined ${isActive ? 'text-brand' : 'text-txt-dim'} text-[16px]">folder</span>
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-bold truncate">${p.name}</h4>
            <p class="text-[9px] text-txt-dim">${ago}</p>
          </div>
          ${isActive ? '<span class="text-[8px] text-brand font-bold uppercase bg-brand/10 px-1.5 py-0.5 rounded">Active</span>' : ''}
        </div>
        <div class="flex items-center gap-3 text-[10px] text-txt-muted">
          <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">music_note</span> ${count} samples</span>
          ${hasDna ? '<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">fingerprint</span> DNA</span>' : ''}
        </div>
      </div>`;
  }).join('');
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

// ==================== WELCOME BANNER ====================
function renderWelcomeBanner() {
  const banner = document.getElementById('welcome-banner');
  if (!banner) return;

  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="bg-panel border-b border-border px-6 py-5">
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-lg font-bold">Hey, Elle</h2>
          <p class="text-[11px] text-txt-muted">AI-powered sample generation built for your workflow.</p>
        </div>
        <div class="relative flex-shrink-0">
          <button id="home-project-picker" class="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border hover:border-border-light transition-colors text-left rounded" onclick="toggleHomeProjectDropdown()">
            <span class="material-symbols-outlined text-brand text-[14px]">folder</span>
            <span id="home-project-picker-name" class="text-[11px] font-bold">My Project</span>
            <span class="material-symbols-outlined text-txt-dim text-[14px]">expand_more</span>
          </button>
          <div id="home-project-dropdown" class="hidden absolute right-0 top-full mt-1 w-56 bg-panel border border-border z-50 rounded overflow-hidden shadow-lg">
            <div class="max-h-64 overflow-y-auto py-1" id="home-project-dropdown-list"></div>
            <div class="border-t border-border p-1.5">
              <button class="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-brand hover:bg-surface transition-colors font-medium rounded" onclick="showNewProjectInput()">
                <span class="material-symbols-outlined text-[14px]">add</span> New Project
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-4">
        <a href="sounddna.html" class="group bg-surface border border-border rounded-[3px] p-5 hover:border-brand/30 transition-all flex flex-col items-center text-center">
          <div class="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center mb-3">
            <span class="material-symbols-outlined text-brand text-[20px]">fingerprint</span>
          </div>
          <h4 class="text-[13px] font-bold mb-1">Sound DNA</h4>
          <p class="text-[11px] text-txt-muted leading-relaxed">Upload reference tracks and build your sonic identity.</p>
        </a>
        <div class="group bg-surface border border-border rounded-[3px] p-5 flex flex-col items-center text-center cursor-pointer hover:border-brand/30 transition-all" onclick="window._blazeToggle()">
          <div class="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center mb-3">
            <span class="material-symbols-outlined text-brand text-[20px]">auto_awesome</span>
          </div>
          <h4 class="text-[13px] font-bold mb-1">Blaise</h4>
          <p class="text-[11px] text-txt-muted leading-relaxed">Chat with Blaise to brainstorm sounds and prompts.</p>
        </div>
        <a href="studio.html" class="group bg-surface border border-border rounded-[3px] p-5 hover:border-brand/30 transition-all flex flex-col items-center text-center">
          <div class="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center mb-3">
            <span class="material-symbols-outlined text-brand text-[20px]">music_note</span>
          </div>
          <h4 class="text-[13px] font-bold mb-1">Studio</h4>
          <p class="text-[11px] text-txt-muted leading-relaxed">Generate, refine, and arrange samples in the Studio.</p>
        </a>
      </div>
    </div>`;
}

// ==================== PAGE CALLBACKS ====================
window.FIIRE_onProjectSwitch = function() {
  renderHomeProjectPicker();
  renderSourceFilter();
  renderLibrary({ global: true });
};

window.FIIRE_onFavoriteToggle = function() {
  renderLibrary({ global: true });
};

// ==================== INIT ====================
(function initHome() {
  initNavHighlight();
  renderProjectSwitcher();
  renderHomeProjectPicker();
  renderSourceFilter();
  renderWelcomeBanner();
  renderLibrary({ global: true });
})();
