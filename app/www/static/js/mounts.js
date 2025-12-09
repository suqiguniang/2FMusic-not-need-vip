import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { showToast, hideProgressToast, showConfirmDialog } from './utils.js';

let scanInterval = null;

export function startScanPolling(isUserAction = false, onRefreshSongs, onRefreshMounts) {
  if (state.isPolling) return;
  state.isPolling = true;
  let hasTrackedScan = false;

  scanInterval = setInterval(async () => {
    try {
      const status = await api.system.status();
      const isModalOpen = ui.uploadModal && ui.uploadModal.classList.contains('active');
      if (status.scanning) {
        hasTrackedScan = true;
        if (!isModalOpen) {
          const percent = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
          showToast(`正在处理库... ${status.processed}/${status.total} (${percent}%)`, true);
        }
        if (status.processed % 20 === 0 && onRefreshSongs) onRefreshSongs(false);
      } else {
        clearInterval(scanInterval);
        state.isPolling = false;
        hideProgressToast();
        if ((isUserAction || hasTrackedScan) && !isModalOpen) {
          showToast('处理完成！');
          onRefreshSongs && onRefreshSongs();
          if (state.currentTab === 'mount' && onRefreshMounts) onRefreshMounts();
        }
      }
    } catch (e) {
      console.error('Poll error', e);
      state.isPolling = false;
      clearInterval(scanInterval);
    }
  }, 1000);
}

export async function loadMountPoints() {
  if (!ui.mountListContainer) return;
  ui.mountListContainer.innerHTML = '<div class="loading-text">加载中...</div>';
  try {
    const data = await api.mount.list();
    ui.mountListContainer.innerHTML = '';
    if (data.success) {
      if (data.data.length === 0) {
        ui.mountListContainer.innerHTML = '<div class="loading-text">暂无挂载目录</div>';
      } else {
        const frag = document.createDocumentFragment();
        data.data.forEach(path => {
          const card = document.createElement('div');
          card.className = 'mount-card';

          const infoDiv = document.createElement('div');
          infoDiv.className = 'mount-info';
          const icon = document.createElement('i');
          icon.className = 'fas fa-folder mount-icon';
          const pathSpan = document.createElement('span');
          pathSpan.className = 'mount-path-text';
          pathSpan.textContent = path;
          infoDiv.appendChild(icon);
          infoDiv.appendChild(pathSpan);

          const btn = document.createElement('button');
          btn.className = 'btn-remove-mount';
          btn.textContent = '移除';
          btn.onclick = () => triggerRemoveMount(path);

          card.appendChild(infoDiv);
          card.appendChild(btn);
          frag.appendChild(card);
        });
        ui.mountListContainer.appendChild(frag);
      }
    } else { ui.mountListContainer.innerHTML = `<div class="loading-text">加载失败: ${data.error}</div>`; }
  } catch (err) {
    ui.mountListContainer.innerHTML = '<div class="loading-text">网络错误</div>';
  }
}

export function triggerRemoveMount(path) {
  showConfirmDialog('移除挂载', `确定要移除目录<br><b>${path}</b> 吗？`, () => {
    showToast('正在移除...');
    api.mount.remove(path).then(data => {
      if (data.success) {
        showToast(data.message || '已移除');
        loadMountPoints();
      } else {
        showToast('移除失败: ' + (data.error || ''));
      }
    });
  });
}

export function trackMountProgress(onDone) {
  const interval = setInterval(async () => {
    try {
      const status = await api.system.status();
      if (status.scanning) {
        const percent = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
        if (ui.uploadFill) ui.uploadFill.style.width = `${percent}%`;
        if (ui.uploadPercent) ui.uploadPercent.innerText = `${percent}%`;
        if (ui.uploadMsg) ui.uploadMsg.innerText = status.current_file || '处理中...';
      } else {
        clearInterval(interval);
        if (ui.uploadFill) ui.uploadFill.style.width = '100%';
        if (ui.uploadPercent) ui.uploadPercent.innerText = '100%';
        if (ui.uploadMsg) ui.uploadMsg.innerText = '挂载并索引完成!';
        setTimeout(() => { onDone && onDone(); }, 1000);
      }
    } catch (e) { console.error('Mount poll error', e); }
  }, 500);
}

export function initMounts(onRefreshSongs) {
  if (ui.btnAddMount) {
    ui.btnAddMount.addEventListener('click', () => {
      const path = ui.mountPathInput?.value.trim();
      if (!path) { showToast('请输入路径'); return; }
      ui.uploadModal?.classList.add('active');
      if (ui.uploadFileName) ui.uploadFileName.innerText = '挂载目录: ' + path;
      if (ui.uploadFill) ui.uploadFill.style.width = '0%';
      if (ui.uploadPercent) ui.uploadPercent.innerText = '0%';
      if (ui.uploadMsg) ui.uploadMsg.innerText = '正在提交...';
      if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'none';
      ui.btnAddMount.disabled = true;

      api.mount.add(path)
        .then(data => {
          if (data.success) {
            trackMountProgress(() => {
              ui.uploadModal?.classList.remove('active');
              if (ui.btnAddMount) ui.btnAddMount.disabled = false;
              if (ui.mountPathInput) ui.mountPathInput.value = '';
              loadMountPoints();
              onRefreshSongs && onRefreshSongs();
            });
          } else {
            if (ui.uploadMsg) ui.uploadMsg.innerText = '添加失败: ' + data.error;
            if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'inline-block';
            ui.btnAddMount.disabled = false;
          }
        })
        .catch(() => {
          if (ui.uploadMsg) ui.uploadMsg.innerText = '网络请求失败';
          if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'inline-block';
          ui.btnAddMount.disabled = false;
        });
    });
  }
}
