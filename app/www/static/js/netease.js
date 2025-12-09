import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { showToast, hideProgressToast, formatTime } from './utils.js';

// 网易云业务
let songRefreshCallback = null;

function renderDownloadTasks() {
  const list = ui.neteaseDownloadList;
  const tasks = state.neteaseDownloadTasks;
  if (!list) return;
  if (!tasks.length) {
    list.innerHTML = '<div class="loading-text" style="padding: 3rem 0; opacity: 0.6; font-size: 0.9rem;">暂无下载记录</div>';
    return;
  }
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'netease-download-row';
    const meta = document.createElement('div');
    meta.className = 'netease-download-meta';
    meta.innerHTML = `<div class="title">${task.title}</div><div class="artist">${task.artist}</div>`;
    const statusEl = document.createElement('div');
    const config = {
      queued: { icon: 'fas fa-clock', text: '等待中', class: 'status-wait' },
      downloading: { icon: 'fas fa-sync fa-spin', text: '下载中', class: 'status-progress' },
      success: { icon: 'fas fa-check', text: '完成', class: 'status-done' },
      error: { icon: 'fas fa-times', text: '失败', class: 'status-error' }
    }[task.status] || { icon: 'fas fa-question', text: '未知', class: '' };
    statusEl.className = `download-status ${config.class}`;
    if (task.status === 'downloading') {
      statusEl.innerHTML = `<i class="${config.icon}"></i> <span>${task.progress || 0}%</span>`;
    } else {
      statusEl.innerHTML = `<i class="${config.icon}"></i> <span>${config.text}</span>`;
    }
    row.appendChild(meta);
    row.appendChild(statusEl);
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

function addDownloadTask(song) {
  const task = {
    id: `dl_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    title: song.title || `歌曲 ${song.id || ''}`,
    artist: song.artist || '',
    status: 'queued'
  };
  state.neteaseDownloadTasks.unshift(task);
  if (state.neteaseDownloadTasks.length > 30) state.neteaseDownloadTasks = state.neteaseDownloadTasks.slice(0, 30);
  renderDownloadTasks();
  return task.id;
}

function updateDownloadTask(id, status) {
  const task = state.neteaseDownloadTasks.find(t => t.id === id);
  if (task) {
    task.status = status;
    renderDownloadTasks();
  }
}

function updateSelectAllState() {
  const total = state.neteaseResults.length;
  const selectedCount = Array.from(state.neteaseSelected).filter(id => state.neteaseResults.some(s => String(s.id) === id)).length;
  if (ui.neteaseSelectAll) {
    ui.neteaseSelectAll.indeterminate = selectedCount > 0 && selectedCount < total;
    ui.neteaseSelectAll.checked = total > 0 && selectedCount === total;
  }
}

function renderNeteaseResults() {
  const list = ui.neteaseResultList;
  if (!list) return;
  if (!state.neteaseResults.length) {
    list.innerHTML = '<div class="loading-text">未找到相关歌曲</div>';
    updateSelectAllState();
    return;
  }
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  state.neteaseResults.forEach(song => {
    const card = document.createElement('div');
    card.className = 'netease-card';

    const selectWrap = document.createElement('div');
    selectWrap.className = 'netease-select';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const sid = String(song.id);
    checkbox.checked = state.neteaseSelected.has(sid);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.neteaseSelected.add(sid);
      else state.neteaseSelected.delete(sid);
      updateSelectAllState();
    });
    selectWrap.appendChild(checkbox);

    const cover = document.createElement('img');
    cover.src = song.cover || '/static/images/ICON_256.PNG';
    cover.loading = 'lazy';

    const meta = document.createElement('div');
    meta.className = 'netease-meta';
    const levelText = (song.level || 'standard').toUpperCase();
    meta.innerHTML = `<div class="title">${song.title}</div>
        <div class="subtitle">${song.artist}</div>
        <div class="extra"><span class="netease-level-pill">${levelText}</span>${song.album || '未收录专辑'} · ${formatTime(song.duration || 0)}</div>`;

    const actions = document.createElement('div');
    actions.className = 'netease-actions';
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.innerHTML = '<i class="fas fa-download"></i> 下载';
    btn.addEventListener('click', () => downloadNeteaseSong(song, btn));
    actions.appendChild(btn);

    card.appendChild(selectWrap);
    card.appendChild(cover);
    card.appendChild(meta);
    card.appendChild(actions);
    frag.appendChild(card);
  });
  list.appendChild(frag);
  updateSelectAllState();
}

async function downloadNeteaseSong(song, btnEl) {
  if (!song || !song.id) return;
  const level = ui.neteaseQualitySelect ? ui.neteaseQualitySelect.value : 'exhigh';
  const taskId = addDownloadTask(song);

  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-sync fa-spin"></i> 请求中'; }

  try {
    const res = await api.netease.download({ ...song, level, target_dir: state.neteaseDownloadDir || undefined });
    if (res.success) {
      const backendTaskId = res.task_id;
      updateDownloadTask(taskId, 'downloading');

      // 轮询进度
      const pollTimer = setInterval(async () => {
        try {
          const taskRes = await api.netease.task(backendTaskId);
          if (taskRes.success) {
            const tData = taskRes.data;
            const currentTask = state.neteaseDownloadTasks.find(t => t.id === taskId);
            if (currentTask) {
              // 状态映射
              let newStatus = tData.status;
              if (newStatus === 'pending') newStatus = 'queued';

              currentTask.status = newStatus;
              currentTask.progress = tData.progress;
              renderDownloadTasks();

              if (newStatus === 'success' || newStatus === 'error') {
                clearInterval(pollTimer);
                if (newStatus === 'success') {
                  showToast(`下载完成: ${tData.title}`);
                  if (songRefreshCallback) songRefreshCallback();
                } else {
                  showToast(`下载失败: ${tData.message || '未知错误'}`);
                }
              }
            } else {
              clearInterval(pollTimer);
            }
          }
        } catch (e) { console.error(e); }
      }, 1000);

    } else {
      updateDownloadTask(taskId, 'error');
      showToast(res.error || '请求失败');
    }
  } catch (err) {
    console.error('download netease error', err);
    updateDownloadTask(taskId, 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-download"></i> 下载'; }
  }
}

async function searchNeteaseSongs() {
  if (!ui.neteaseKeywordsInput) return;
  const keywords = ui.neteaseKeywordsInput.value.trim();
  if (!keywords) { showToast('请输入关键词'); return; }
  if (ui.neteaseResultList) ui.neteaseResultList.innerHTML = '<div class="loading-text">搜索中...</div>';
  try {
    const json = await api.netease.search(keywords);
    if (json.success) {
      state.neteaseResults = json.data || [];
      state.neteaseSelected = new Set();
      renderNeteaseResults();
    } else {
      ui.neteaseResultList.innerHTML = `<div class="loading-text">${json.error || '搜索失败'}</div>`;
    }
  } catch (err) {
    console.error('NetEase search failed', err);
    if (ui.neteaseResultList) ui.neteaseResultList.innerHTML = '<div class="loading-text">搜索失败，请检查 API 服务</div>';
  }
}

async function loadNeteaseConfig() {
  try {
    const json = await api.netease.configGet();
    if (json.success) {
      state.neteaseDownloadDir = json.download_dir || '';
      state.neteaseApiBase = json.api_base || '';
      if (ui.neteaseDownloadDirInput) ui.neteaseDownloadDirInput.value = state.neteaseDownloadDir;
      if (ui.neteaseApiGateInput) ui.neteaseApiGateInput.value = state.neteaseApiBase || 'http://localhost:3000';

      if (state.neteaseApiBase) {
        try {
          const statusJson = await api.netease.loginStatus();
          if (statusJson.success) {
            toggleNeteaseGate(true);
            refreshLoginStatus();
          } else {
            toggleNeteaseGate(false);
          }
        } catch (e) {
          toggleNeteaseGate(false);
        }
      } else {
        toggleNeteaseGate(false);
      }
    }
  } catch (err) {
    console.error('config error', err);
    toggleNeteaseGate(false);
  }
}

async function saveNeteaseConfig() {
  const dir = ui.neteaseDownloadDirInput ? ui.neteaseDownloadDirInput.value.trim() : '';
  const apiBaseVal = ui.neteaseApiGateInput ? ui.neteaseApiGateInput.value.trim() : state.neteaseApiBase;
  const payload = {};
  if (dir || state.neteaseDownloadDir) payload.download_dir = dir || state.neteaseDownloadDir;
  if (apiBaseVal) payload.api_base = apiBaseVal;
  if (!payload.download_dir && !payload.api_base) { showToast('请输入下载目录或API地址'); return; }
  try {
    const json = await api.netease.configSave(payload);
    if (json.success) {
      state.neteaseDownloadDir = json.download_dir;
      state.neteaseApiBase = json.api_base || '';
      if (ui.neteaseApiGateInput) ui.neteaseApiGateInput.value = state.neteaseApiBase || 'http://localhost:3000';
      toggleNeteaseGate(!!state.neteaseApiBase);
      showToast('保存成功');
    } else {
      showToast(json.error || '保存失败');
    }
  } catch (err) {
    console.error('save config error', err);
    showToast('保存失败');
  }
}

async function bindNeteaseApi() {
  if (!ui.neteaseApiGateInput) return;
  const apiBaseVal = ui.neteaseApiGateInput.value.trim();
  if (!apiBaseVal) { showToast('请输入 API 地址'); return; }
  if (ui.neteaseApiGateBtn) { ui.neteaseApiGateBtn.disabled = true; ui.neteaseApiGateBtn.innerText = '正在检测...'; }
  try {
    const payload = { api_base: apiBaseVal };
    if (state.neteaseDownloadDir) payload.download_dir = state.neteaseDownloadDir;
    const json = await api.netease.configSave(payload);
    if (json.success) {
      state.neteaseApiBase = json.api_base;
      const statusJson = await api.netease.loginStatus();
      if (statusJson.success) {
        showToast('连接成功');
        toggleNeteaseGate(true);
        refreshLoginStatus();
      } else {
        showToast('无法连接到该 API 地址');
      }
    } else {
      showToast(json.error || '保存配置失败');
    }
  } catch (err) {
    console.error('bind error', err);
    showToast('连接失败');
  } finally {
    if (ui.neteaseApiGateBtn) { ui.neteaseApiGateBtn.disabled = false; ui.neteaseApiGateBtn.innerText = '连接'; }
  }
}

async function refreshLoginStatus(showToastMsg = false) {
  if (!ui.neteaseLoginStatus) return;
  try {
    const json = await api.netease.loginStatus();
    if (json.success && json.logged_in) {
      ui.neteaseLoginStatus.innerText = `已登录：${json.nickname || ''}`;
      ui.neteaseLoginCard?.classList.remove('status-bad');
      ui.neteaseLoginCard?.classList.add('status-ok');
      if (ui.neteaseLoginDesc) ui.neteaseLoginDesc.innerText = '可以开始搜索或下载歌曲';
      if (ui.neteaseQrImg) ui.neteaseQrImg.src = '';
      ui.neteaseQrModal?.classList.remove('active');
      if (showToastMsg) showToast('网易云已登录');
    } else {
      ui.neteaseLoginStatus.innerText = json.error || '未登录';
      ui.neteaseLoginCard?.classList.remove('status-ok');
      ui.neteaseLoginCard?.classList.add('status-bad');
      if (ui.neteaseLoginDesc) ui.neteaseLoginDesc.innerText = '请扫码登录网易云账号';
      if (showToastMsg) showToast(json.error || '未登录');
    }
  } catch (err) {
    console.error('status error', err);
    if (showToastMsg) showToast('状态检查失败');
  }
}

async function startNeteaseLogin() {
  if (state.neteasePollingTimer) { clearInterval(state.neteasePollingTimer); state.neteasePollingTimer = null; }
  try {
    const json = await api.netease.loginQr();
    if (!json.success) { showToast(json.error || '获取二维码失败'); return; }
    state.currentLoginKey = json.unikey;
    if (ui.neteaseQrImg) ui.neteaseQrImg.src = json.qrimg;
    ui.neteaseQrModal?.classList.add('active');
    if (ui.neteaseQrHint) ui.neteaseQrHint.innerText = '使用网易云音乐扫码';
    if (ui.neteaseLoginStatus) ui.neteaseLoginStatus.innerText = '等待扫码...';
    ui.neteaseLoginCard?.classList.remove('status-ok');
    ui.neteaseLoginCard?.classList.add('status-bad');
    state.neteasePollingTimer = setInterval(checkLoginStatus, 2000);
  } catch (err) {
    console.error('login qr error', err);
    showToast('获取二维码失败');
  }
}

async function checkLoginStatus() {
  if (!state.currentLoginKey) return;
  try {
    const json = await api.netease.loginCheck(state.currentLoginKey);
    if (!json.success) return;
    if (json.status === 'authorized') {
      showToast('登录成功');
      if (ui.neteaseLoginStatus) ui.neteaseLoginStatus.innerText = '已登录';
      ui.neteaseLoginCard?.classList.remove('status-bad');
      ui.neteaseLoginCard?.classList.add('status-ok');
      if (ui.neteaseLoginDesc) ui.neteaseLoginDesc.innerText = '可以开始搜索或下载歌曲';
      ui.neteaseQrModal?.classList.remove('active');
      refreshLoginStatus();
      if (state.neteasePollingTimer) { clearInterval(state.neteasePollingTimer); state.neteasePollingTimer = null; }
    } else if (json.status === 'expired') {
      showToast('二维码已过期，请重新获取');
      if (ui.neteaseQrHint) ui.neteaseQrHint.innerText = '二维码已过期，请重新获取';
      if (state.neteasePollingTimer) { clearInterval(state.neteasePollingTimer); state.neteasePollingTimer = null; }
    } else if (json.status === 'scanned') {
      if (ui.neteaseLoginStatus) ui.neteaseLoginStatus.innerText = '已扫码，等待确认...';
      if (ui.neteaseLoginDesc) ui.neteaseLoginDesc.innerText = '请在网易云确认登录';
    }
  } catch (err) {
    console.error('check login error', err);
  }
}

async function downloadByIds() {
  const songId = ui.neteaseSongIdInput ? ui.neteaseSongIdInput.value.trim() : '';
  const playlistId = ui.neteasePlaylistIdInput ? ui.neteasePlaylistIdInput.value.trim() : '';
  if (!songId && !playlistId) { showToast('请输入单曲ID或歌单ID'); return; }
  if (songId) {
    try {
      if (ui.neteaseResultList) ui.neteaseResultList.innerHTML = '<div class="loading-text">解析单曲中...</div>';
      const json = await api.netease.song(songId);
      if (!json.success) { showToast(json.error || '解析失败'); return; }
      state.neteaseResults = json.data || [];
      state.neteaseSelected = new Set(state.neteaseResults.map(s => String(s.id)));
      renderNeteaseResults();
      if (!state.neteaseResults.length) {
        if (ui.neteaseResultList) ui.neteaseResultList.innerHTML = '<div class="loading-text">未找到歌曲</div>';
      } else {
        showToast(`解析到 ${state.neteaseResults.length} 首歌曲，可选择下载`);
      }
    } catch (err) {
      console.error('song parse error', err);
      showToast('解析失败');
    }
  } else if (playlistId) {
    try {
      if (ui.neteaseResultList) ui.neteaseResultList.innerHTML = '<div class="loading-text">解析歌单中...</div>';
      const json = await api.netease.playlist(playlistId);
      if (!json.success) { showToast(json.error || '获取歌单失败'); return; }
      state.neteaseResults = json.data || [];
      state.neteaseSelected = new Set(state.neteaseResults.map(s => String(s.id)));
      renderNeteaseResults();
      if (!state.neteaseResults.length) {
        if (ui.neteaseResultList) ui.neteaseResultList.innerHTML = '<div class="loading-text">歌单为空</div>';
      } else {
        showToast(`解析到 ${state.neteaseResults.length} 首歌曲，可选择下载`);
      }
    } catch (err) {
      console.error('playlist download error', err);
      showToast('解析失败');
    }
  }
}

async function bulkDownloadSelected() {
  const level = ui.neteaseQualitySelect ? ui.neteaseQualitySelect.value : 'exhigh';
  const targets = state.neteaseResults.filter(s => state.neteaseSelected.has(String(s.id)));
  if (!targets.length) { showToast('请先选择歌曲'); return; }
  for (const s of targets) {
    await downloadNeteaseSong({ ...s, level });
  }
}

function toggleNeteaseGate(enabled) {
  ui.neteaseConfigGate?.classList.toggle('hidden', enabled);
  ui.neteaseContent?.classList.toggle('hidden', !enabled);
}

function bindEvents() {
  ui.neteaseSearchBtn?.addEventListener('click', searchNeteaseSongs);
  ui.neteaseKeywordsInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchNeteaseSongs(); });
  ui.neteaseLoginBtn?.addEventListener('click', startNeteaseLogin);
  ui.closeQrModalBtn?.addEventListener('click', () => {
    ui.neteaseQrModal?.classList.remove('active');
    if (state.neteasePollingTimer) { clearInterval(state.neteasePollingTimer); state.neteasePollingTimer = null; }
  });
  ui.neteaseRefreshStatusBtn?.addEventListener('click', () => refreshLoginStatus(true));
  ui.neteaseIdDownloadBtn?.addEventListener('click', downloadByIds);
  ui.neteaseSaveDirBtn?.addEventListener('click', saveNeteaseConfig);
  if (ui.neteaseSelectAll) ui.neteaseSelectAll.addEventListener('change', (e) => {
    if (e.target.checked) state.neteaseSelected = new Set(state.neteaseResults.map(s => String(s.id)));
    else state.neteaseSelected.clear();
    renderNeteaseResults();
  });
  ui.neteaseBulkDownloadBtn?.addEventListener('click', bulkDownloadSelected);
  ui.neteaseDownloadToggle && ui.neteaseDownloadPanel && ui.neteaseDownloadToggle.addEventListener('click', () => {
    ui.neteaseDownloadPanel.classList.add('hidden');
  });
  ui.neteaseDownloadFloating && ui.neteaseDownloadPanel && ui.neteaseDownloadFloating.addEventListener('click', () => {
    ui.neteaseDownloadPanel.classList.toggle('hidden');
  });
  ui.neteaseApiGateBtn?.addEventListener('click', bindNeteaseApi);
  if (ui.neteaseChangeApiBtn) ui.neteaseChangeApiBtn.addEventListener('click', () => toggleNeteaseGate(false));
  if (ui.neteaseOpenConfigBtn && ui.neteaseApiGateInput) {
    ui.neteaseOpenConfigBtn.addEventListener('click', () => {
      ui.neteaseApiGateInput.focus();
      ui.neteaseApiGateInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

export async function initNetease(onRefreshSongs) {
  songRefreshCallback = onRefreshSongs;
  bindEvents();
  await loadNeteaseConfig();
  renderDownloadTasks();
}
