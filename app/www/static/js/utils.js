import { state, persistState, saveFavorites } from './state.js';
import { ui } from './ui.js';

export function autoResizeUI() {
  if (window.innerWidth > 768) {
    const scale = Math.min(Math.max(window.innerWidth / 1440, 0.8), 1.2);
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
  } else {
    document.documentElement.style.setProperty('--ui-scale', '1.0');
  }
}

export function showToast(message, isPersistent = false) {
  if (!isPersistent) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    if (ui.toastContainer) ui.toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
    return;
  }

  if (!state.progressToastEl) {
    state.progressToastEl = document.createElement('div');
    state.progressToastEl.className = 'toast progress-toast';
    if (ui.toastContainer) ui.toastContainer.appendChild(state.progressToastEl);
    requestAnimationFrame(() => state.progressToastEl.classList.add('show'));
  }
  state.progressToastEl.innerHTML = `<i class="fas fa-sync fa-spin"></i> ${message}`;
}

export function hideProgressToast() {
  if (state.progressToastEl) {
    state.progressToastEl.classList.remove('show');
    setTimeout(() => {
      if (state.progressToastEl) state.progressToastEl.remove();
      state.progressToastEl = null;
    }, 300);
  }
}

export function showConfirmDialog(title, message, onConfirm) {
  if (ui.confirmTitle) ui.confirmTitle.innerText = title;
  if (ui.confirmText) ui.confirmText.innerHTML = message;
  state.currentConfirmAction = onConfirm;
  ui.confirmModalOverlay?.classList.add('active');
}

export function updateDetailFavButton(isFav) {
  if (!ui.fpBtnFav) return;
  if (isFav) { ui.fpBtnFav.classList.add('active-fav'); ui.fpBtnFav.innerHTML = '<i class="fas fa-heart"></i>'; }
  else { ui.fpBtnFav.classList.remove('active-fav'); ui.fpBtnFav.innerHTML = '<i class="far fa-heart"></i>'; }
}

export function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const min = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function renderNoLyrics(msg) {
  if (!ui.lyricsContainer) return;
  ui.lyricsContainer.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-sub);font-size:1.2rem;">${msg}</div>`;
}

export function updateSliderFill(el) {
  if (!el) return;
  const val = (el.value - el.min) / (el.max - el.min);
  el.style.backgroundSize = `${val * 100}% 100%`;
}

export function flyToElement(startEl, targetEl) {
  if (!startEl || !targetEl) return;
  const startRect = startEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const flyer = document.createElement('div');
  Object.assign(flyer.style, {
    position: 'fixed',
    zIndex: '9999',
    pointerEvents: 'none',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#1db954',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    left: `${startRect.left + startRect.width / 2}px`,
    top: `${startRect.top + startRect.height / 2}px`,
    opacity: 1,
    transform: 'scale(1)'
  });
  flyer.innerHTML = '<i class="fas fa-music"></i>';
  document.body.appendChild(flyer);

  requestAnimationFrame(() => {
    flyer.style.transition = 'all 0.6s ease';
    flyer.style.left = `${targetRect.left + targetRect.width / 2}px`;
    flyer.style.top = `${targetRect.top + targetRect.height / 2}px`;
    flyer.style.transform = 'scale(0.5)';
    flyer.style.opacity = '0';
  });

  flyer.addEventListener('transitionend', () => flyer.remove());
}

export function persistOnUnload(audio) {
  window.addEventListener('beforeunload', () => persistState(audio));
}

export function saveFavoritesToStorage() {
  saveFavorites();
}
