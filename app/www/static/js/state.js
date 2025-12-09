// 状态集中管理
export const state = {
  fullPlaylist: [],
  displayPlaylist: [],
  playQueue: [],
  currentTrackIndex: 0,
  isPlaying: false,
  playMode: 0,
  lyricsData: [],
  currentFetchId: 0,
  favorites: new Set(JSON.parse(localStorage.getItem('2fmusic_favs') || '[]')),
  savedState: JSON.parse(localStorage.getItem('2fmusic_state') || '{}'),
  currentTab: 'local',
  neteaseResults: [],
  neteasePollingTimer: null,
  currentLoginKey: null,
  neteaseDownloadDir: '',
  neteaseApiBase: '',
  neteaseSelected: new Set(),
  neteaseDownloadTasks: [],
  isPolling: false,
  progressToastEl: null,
  currentConfirmAction: null
};

export function persistState(audio) {
  const { playQueue, currentTrackIndex, playMode, currentTab } = state;
  const currentSong = playQueue[currentTrackIndex];
  if (currentSong && currentSong.isExternal) return;

  const nextState = {
    volume: audio?.volume ?? 1,
    playMode,
    currentTime: audio?.currentTime ?? 0,
    currentFilename: currentSong ? currentSong.filename : null,
    tab: currentTab
  };
  localStorage.setItem('2fmusic_state', JSON.stringify(nextState));
}

export function saveFavorites() {
  localStorage.setItem('2fmusic_favs', JSON.stringify([...state.favorites]));
}
