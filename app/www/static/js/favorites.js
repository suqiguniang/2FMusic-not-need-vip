import { state, saveFavorites, saveCachedPlaylists, saveCachedPlaylistSongs } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { showToast, updateDetailFavButton } from './utils.js';
import { renderPlaylist } from './player.js';

// 旧的缓存机制已替换为state.js中的持久化缓存

// 清除收藏夹列表缓存
export function clearPlaylistCache() {
  // 清除state中的收藏夹缓存
  saveCachedPlaylists([]);
  // 清除所有收藏夹歌曲缓存
  state.cachedPlaylistSongs = {};
  localStorage.setItem('2fmusic_cached_playlist_songs', JSON.stringify({}));
}

// 加载收藏夹筛选列表
export async function loadPlaylistFilter() {
  if (!ui.playlistFilter) return;
  
  try {
    // 优先使用本地缓存数据
    let playlists = state.cachedPlaylists;
    
    // 如果缓存中没有数据或数据为空，从API获取
    if (playlists.length === 0) {
      const res = await api.favoritePlaylists.list();
      if (res && res.data) {
        playlists = res.data;
      }
    }
    
    if (playlists.length > 0) {
      // 去重处理
      const uniquePlaylists = [];
      const seenIds = new Set();
      
      playlists.forEach(playlist => {
        if (!seenIds.has(playlist.id)) {
          seenIds.add(playlist.id);
          uniquePlaylists.push(playlist);
        }
      });
      
      // 对收藏夹进行排序：默认收藏夹排第一位，其他按名称排序
      const sortedPlaylists = uniquePlaylists.sort((a, b) => {
        // 默认收藏夹排第一位
        if (a.name === '默认收藏夹' && b.name !== '默认收藏夹') return -1;
        if (a.name !== '默认收藏夹' && b.name === '默认收藏夹') return 1;
        // 其他收藏夹按名称排序
        return a.name.localeCompare(b.name);
      });
      
      // 清空现有选项，保留"所有收藏夹"
      ui.playlistFilter.innerHTML = '<option value="">所有收藏夹</option>';
      
      // 添加收藏夹选项
      sortedPlaylists.forEach(playlist => {
        const option = document.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.name;
        ui.playlistFilter.appendChild(option);
      });
    }
  } catch (e) {
    console.error('加载收藏夹列表失败:', e);
  }
}

export function handlePlaylistFilterChange() {
  if (!ui.playlistFilter) return;
  
  const selectedPlaylistId = ui.playlistFilter.value;
  renderPlaylist();
}

export async function loadPlaylistSongs(playlistId) {
  if (!ui.songContainer) return;
  
  try {
    const res = await api.favoritePlaylists.getSongs(playlistId);
    if (res.success && res.data) {
      const playlistSongIds = new Set(res.data);
    }
  } catch (e) {
    console.error('加载收藏夹歌曲失败:', e);
  }
}

// 显示收藏夹选择对话框
export function showPlaylistSelectDialog(song, btnEl) {
  // 创建独立的收藏夹选择对话框
  const dialog = document.createElement('div');
  dialog.className = 'playlist-select-dialog';
  
  dialog.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>选择收藏夹</h3>
        <button id="close-btn" class="close-btn">&times;</button>
      </div>
      <div class="playlists-container"></div>
      <div class="dialog-actions">
        <button id="confirm-btn" class="btn-primary">确定</button>
      </div>
    </div>
  `;
  
  // 使用CSS定义的样式，不再设置内联样式
  const dialogContent = dialog.querySelector('.dialog-content');
  const confirmBtn = dialog.querySelector('#confirm-btn');
  
  // 获取收藏夹列表
  (async () => {
    try {
      let playlists = [];
      // 优先使用本地缓存数据
      if (state && state.cachedPlaylists) {
        playlists = state.cachedPlaylists;
      } else {
        // 如果缓存中没有数据或数据为空，从API获取
        const res = await api.favoritePlaylists.list();
        if (res && res.data) {
          playlists = res.data;
        }
      }
      
      // 去重处理
      const uniquePlaylists = [];
      const seenIds = new Set();
      
      playlists.forEach(playlist => {
        if (!seenIds.has(playlist.id)) {
          seenIds.add(playlist.id);
          uniquePlaylists.push(playlist);
        }
      });
      
      const container = dialog.querySelector('.playlists-container');
      container.innerHTML = '';
      
      uniquePlaylists.forEach(playlist => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        // 如果在收藏夹详情页，默认选中当前收藏夹，否则选中默认收藏夹
        const isSelected = state.selectedPlaylistId ? String(playlist.id) === String(state.selectedPlaylistId) : playlist.is_default;
        item.innerHTML = `
          <input type="radio" name="playlist" id="playlist-${playlist.id}" value="${playlist.id}" ${isSelected ? 'checked' : ''}>
          <label for="playlist-${playlist.id}">${playlist.name}</label>
        `;
        container.appendChild(item);
      });
    } catch (e) {
      console.error('加载收藏夹列表失败:', e);
    }
  })();
  
  // 直接显示对话框
  document.body.appendChild(dialog);
  
  // 即使获取收藏夹列表失败，也要显示对话框（使用默认样式）
  // 对话框显示逻辑已经在上面的async函数和图片加载事件中处理
  
  // 确认按钮事件
  const closeBtn = dialog.querySelector('#close-btn');
  
  const confirmHandler = () => {
    const playlistId = dialog.querySelector('input[name="playlist"]:checked');
    if (playlistId) {
      addToSelectedPlaylist(song, playlistId.value, btnEl, dialog);
    } else {
      dialog.remove();
    }
  };
  
  const closeHandler = () => {
    dialog.remove();
  };
  
  const overlayHandler = (e) => {
    if (e.target === dialog) {
      dialog.remove();
    }
  };
  
  confirmBtn.addEventListener('click', confirmHandler);
  closeBtn.addEventListener('click', closeHandler);
  dialog.addEventListener('click', overlayHandler);
}

// 将歌曲添加到选中的收藏夹
export async function addToSelectedPlaylist(song, playlistId, btnEl, dialog) {
  state.favorites.add(song.id);
  if (btnEl) { btnEl.classList.add('active'); btnEl.innerHTML = '<i class="fas fa-heart"></i>'; }
  try { 
    await api.favorites.add(song.id, playlistId); 
    
    // 更新本地缓存：立即更新收藏夹歌曲列表，实现乐观UI
    // 1. 更新收藏夹列表中的歌曲数量
    const updatedPlaylists = state.cachedPlaylists.map(playlist => {
      if (String(playlist.id) === String(playlistId)) {
        return {
          ...playlist,
          song_count: (playlist.song_count || 0) + 1
        };
      }
      return playlist;
    });
    saveCachedPlaylists(updatedPlaylists);
    
    // 2. 更新收藏夹歌曲列表
    const currentSongs = state.cachedPlaylistSongs[playlistId] || [];
    if (!currentSongs.includes(song.id)) {
      currentSongs.push(song.id);
      saveCachedPlaylistSongs(playlistId, currentSongs);
    }
  } catch (e) { 
    console.error(e); 
    // 回滚 UI
    state.favorites.delete(song.id);
    if (btnEl) { btnEl.classList.remove('active'); btnEl.innerHTML = '<i class="far fa-heart"></i>'; }
  }
  saveFavorites();

  const currentPlaying = state.playQueue[state.currentTrackIndex];
  if (currentPlaying && currentPlaying.id === song.id) {
    updateDetailFavButton(state.favorites.has(song.id));
  }
  
  // 关闭对话框
  dialog.remove();
}

// 显示创建新收藏夹对话框
export function showCreatePlaylistDialog() {
  // 创建独立的创建收藏夹对话框
  const dialog = document.createElement('div');
  dialog.className = 'playlist-select-dialog';
  
  dialog.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>创建新收藏夹</h3>
        <button id="close-btn" class="close-btn">&times;</button>
      </div>
      <div class="dialog-body">
        <input type="text" id="playlist-name" placeholder="输入收藏夹名称" class="text-input">
      </div>
      <div class="dialog-actions">
        <button id="create-btn" class="btn-primary">创建</button>
      </div>
    </div>
  `;
  
  // 获取输入框焦点
  const playlistNameInput = dialog.querySelector('#playlist-name');
  
  // 确认按钮事件
  const createBtn = dialog.querySelector('#create-btn');
  const closeBtn = dialog.querySelector('#close-btn');
  
  const createHandler = async () => {
    const name = playlistNameInput.value.trim();
    if (!name) {
      // 空名称验证
      playlistNameInput.style.borderColor = '#ff4444';
      playlistNameInput.placeholder = '请输入收藏夹名称';
      return;
    }
    
    try {
      // 先获取所有收藏夹，检查名称是否已存在
      let playlists = [];
      if (state && state.cachedPlaylists) {
        playlists = state.cachedPlaylists;
      } else {
        // 如果缓存中没有，则通过API获取
        const listRes = await api.favoritePlaylists.list();
        if (listRes && listRes.success && listRes.data) {
          playlists = listRes.data;
        }
      }
      
      // 检查是否存在同名收藏夹
      const existingPlaylist = playlists.find(playlist => playlist.name === name);
      if (existingPlaylist) {
        playlistNameInput.style.borderColor = '#ff4444';
        showToast(`已存在名为"${name}"的收藏夹，请使用其他名称`, 'error');
        return;
      }
      
      // 创建收藏夹
      const res = await api.favoritePlaylists.create(name);
      if (res.success) {
        // 创建成功后，将新收藏夹添加到缓存中
        console.log('收藏夹创建成功:', res.data);
        
        // 更新缓存：添加新创建的收藏夹
        if (res.data) {
          const updatedPlaylists = [...(state.cachedPlaylists || []), res.data];
          saveCachedPlaylists(updatedPlaylists);
          
          // 初始化新收藏夹的歌曲缓存为空数组
          if (!state.cachedPlaylistSongs) {
            state.cachedPlaylistSongs = {};
          }
          state.cachedPlaylistSongs[res.data.id] = [];
          localStorage.setItem('2fmusic_cached_playlist_songs', JSON.stringify(state.cachedPlaylistSongs));
        }
        
        // 刷新收藏夹页面
        renderPlaylist();
        showToast('收藏夹创建成功', 'success');
        dialog.remove();
      } else {
        console.error('创建收藏夹失败:', res.message);
        // 显示错误提示
        showToast(`创建收藏夹失败: ${res.message || '未知错误'}`, 'error');
      }
    } catch (e) {
      console.error('创建收藏夹失败:', e);
      // 显示错误提示
      showToast(`创建收藏夹失败: ${e.message || '网络错误'}`, 'error');
    }
  };
  
  const closeHandler = () => {
    dialog.remove();
  };
  
  const overlayHandler = (e) => {
    if (e.target === dialog) {
      dialog.remove();
    }
  };
  
  // 回车创建
  playlistNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      createHandler();
    }
  });
  
  createBtn.addEventListener('click', createHandler);
  closeBtn.addEventListener('click', closeHandler);
  dialog.addEventListener('click', overlayHandler);
  

  const dialogContent = dialog.querySelector('.dialog-content');
  
  // 设置平衡的背景透明度
  dialogContent.style.backgroundColor = 'rgba(35, 35, 35, 0.9)';
  dialogContent.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  dialogContent.style.backdropFilter = 'blur(10px)';
  dialogContent.style.webkitBackdropFilter = 'blur(10px)';
  
  // 显示对话框并设置焦点
  document.body.appendChild(dialog);
  playlistNameInput.focus();
}