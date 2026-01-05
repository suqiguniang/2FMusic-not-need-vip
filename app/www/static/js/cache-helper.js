// 图片缓存辅助函数 - 发送给 Service Worker 进行缓存

/**
 * 预缓存图片到 Service Worker（用于离线支持）
 * @param {string} imageUrl - 图片 URL
 */
export function cacheImageForOffline(imageUrl) {
  if (!imageUrl || imageUrl.includes('ICON_256')) return; // 跳过默认图标
  
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_IMAGE',
      url: imageUrl
    });
  }
}
