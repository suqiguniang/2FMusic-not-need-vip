// Service Worker - PWA离线支持和资源缓存
console.log('[SW] Service Worker 已加载');

// 版本号用于控制缓存更新
const CACHE_VERSION = '2fmusic-v1';
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// 缓存不需要缓存的路径
const EXCLUDE_CACHE_PATHS = [
  '/api/',
  '/upload/',
  '.mp3',
  '.flac',
  '.wav',
  '.ogg',
  '.m4a'
];

// 关键资源缓存列表 - PWA启动时缓存这些资源
// 包含所有必需的HTML、CSS、JS和图片，联网时会检查更新
const CRITICAL_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/css/favorites.css',
  '/static/css/artist-aggregate.css',
  '/static/css/queue-manager.css',
  '/static/css/font-awesome/all.min.css',
  '/static/js/main.js',
  '/static/js/state.js',
  '/static/js/player.js',
  '/static/js/ui.js',
  '/static/js/utils.js',
  '/static/js/api.js',
  '/static/js/netease.js',
  '/static/js/mounts.js',
  '/static/js/favorites.js',
  '/static/js/batch-manager.js',
  '/static/js/artist-aggregate.js',
  '/static/js/queue-manager.js',
  '/static/js/db.js',
  '/static/js/lib/color-thief.umd.js',
  '/static/images/ICON_256.PNG',
  '/static/images/BG.png'
];

// 安装事件：为PWA缓存所有关键资源
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中... 准备缓存关键资源');
  
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log(`[SW] 开始缓存 ${CRITICAL_ASSETS.length} 个关键资源...`);
      
      // 使用fetch + cache.put方式，可以处理重定向请求
      const cachePromises = CRITICAL_ASSETS.map(url => {
        return fetch(url, { credentials: 'same-origin' })
          .then((response) => {
            // 只缓存成功的响应
            if (response && response.status === 200) {
              return cache.put(url, response).then(() => {
                return { status: 'fulfilled' };
              });
            } else {
              console.warn(`[SW] ✗ ${url}: HTTP ${response?.status || 'unknown'}`);
              return { status: 'rejected' };
            }
          })
          .catch((e) => {
            console.warn(`[SW] ✗ ${url}: ${e.message}`);
            return { status: 'rejected' };
          });
      });
      
      return Promise.all(cachePromises).then((results) => {
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.length - succeeded;
        console.log(`[SW] ✓ 缓存完成: ${succeeded}/${CRITICAL_ASSETS.length} 成功`);
        if (failed > 0) {
          console.log(`[SW] ✗ 有 ${failed} 个资源缓存失败，但应用仍可正常运行`);
        }
        self.skipWaiting();
      });
    }).catch((e) => {
      console.error('[SW] 缓存过程出错:', e);
      self.skipWaiting();
    })
  );
});

// 激活事件：清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 删除不是当前版本的缓存
          if (!cacheName.startsWith('2fmusic-')) return Promise.resolve();
          if (cacheName === STATIC_CACHE || cacheName === RUNTIME_CACHE || cacheName === IMAGE_CACHE) {
            return Promise.resolve();
          }
          
          console.log('[SW] 删除旧缓存:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      // 立即控制所有页面
      return self.clients.claim();
    })
  );
});

// 获取事件：处理请求和缓存（为PWA提供离线支持和快速加载）
// 策略：安装时缓存所有关键资源，联网时通过networkFirst检查更新
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  // 排除某些路径（音频文件由上层应用直接处理）
  if (EXCLUDE_CACHE_PATHS.some(path => url.pathname.includes(path))) {
    return;
  }

  // API 请求：网络优先，联网时获取最新数据，离线时使用缓存
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML 页面：网络优先，联网时检查更新，离线使用缓存版本
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源（CSS、JS）：缓存优先，安装时已缓存所有关键资源
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 图片：缓存优先，联网时检查更新
  if (request.destination === 'image') {
    event.respondWith(
      cacheFirst(request, IMAGE_CACHE)
        .then((response) => {
          if (response) {
            console.log(`[SW] 图片缓存命中: ${request.url}`);
            return response;
          }
          console.log(`[SW] 图片无缓存且离线: ${request.url}`);
          throw new Error('No cache and offline');
        })
    );
    return;
  }

  // 其他资源：网络优先
  event.respondWith(networkFirst(request));
});

// 网络优先策略
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      // 检查响应是否有效
      if (!response || response.status !== 200 || response.type === 'error') {
        throw new Error(`HTTP ${response?.status}`);
      }

      // 成功响应时，也保存到运行时缓存
      const responseToCache = response.clone();
      caches.open(RUNTIME_CACHE).then((cache) => {
        cache.put(request, responseToCache);
      });

      return response;
    })
    .catch(() => {
      // 网络失败，尝试使用缓存
      return caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        // 没有缓存，返回离线页面
        if (request.destination === 'document') {
          return caches.match('/index.html');
        }

        // 其他类型返回空响应
        return new Response('离线：资源不可用', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    });
}

// 缓存优先策略
function cacheFirst(request, cacheName) {
  return caches.match(request).then((cachedResponse) => {
    if (cachedResponse) {
      return cachedResponse;
    }

    // 缓存中没有，尝试网络
    return fetch(request)
      .then((response) => {
        // 检查响应有效性
        if (!response || response.status !== 200) {
          return response;
        }

        // 保存到缓存
        const responseToCache = response.clone();
        caches.open(cacheName).then((cache) => {
          cache.put(request, responseToCache);
        });

        return response;
      })
      .catch(() => {
        // 网络和缓存都失败
        return cachedResponse || new Response('离线：资源不可用', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
  });
}

// 后台同步：当网络恢复时同步数据
self.addEventListener('sync', (event) => {
  if (event.tag === '2fmusic-sync') {
    event.waitUntil(syncOfflineData());
  }
});

// 同步离线数据
async function syncOfflineData() {
  try {
    // 待实现：同步离线时进行的操作（如收藏等）
    console.log('[SW] 执行离线数据同步...');
    return Promise.resolve();
  } catch (e) {
    console.error('[SW] 同步失败:', e);
    throw e;
  }
}

// 推送通知处理（用于后续推荐通知）
self.addEventListener('push', (event) => {
  const options = {
    body: event.data?.text?.() || '2FMusic 有新推荐',
    icon: '/static/images/ICON_128.PNG',
    badge: '/static/images/ICON_64.PNG',
    tag: '2fmusic-notification',
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification('2FMusic', options)
  );
});

// 通知点击处理
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // 打开应用窗口或聚焦现有窗口
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

console.log('[SW] Service Worker 已加载');
