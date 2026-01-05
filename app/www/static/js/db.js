// IndexedDB 数据库管理
// 用于存储超过localStorage限制的大型数据集（播放历史、收听统计等）

const DB_NAME = '2FMusicDB';
const DB_VERSION = 1;

// 对象存储定义
const STORES = {
  playHistory: { keyPath: 'id', indexes: [{ name: 'filename', unique: false }, { name: 'playedAt', unique: false }] },
  listenStats: { keyPath: 'filename', indexes: [{ name: 'playCount', unique: false }, { name: 'lastListenTime', unique: false }] },
  syncLog: { keyPath: 'id', indexes: [{ name: 'timestamp', unique: false }] }
};

let db = null;

// 初始化数据库
export async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB 打开失败', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[IndexedDB] 初始化成功');
      resolve(db);
    };

    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      
      // 创建对象存储和索引
      Object.entries(STORES).forEach(([storeName, config]) => {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: config.keyPath, autoIncrement: storeName !== 'listenStats' });
          
          // 添加索引
          config.indexes.forEach(index => {
            try {
              store.createIndex(index.name, index.name, { unique: index.unique });
            } catch (e) {
              console.warn(`索引创建失败 ${storeName}.${index.name}:`, e);
            }
          });
        }
      });
      
      console.log('[IndexedDB] 数据库升级完成');
    };
  });
}

// 检查 localStorage 空间使用情况
export function checkLocalStorageSize() {
  let totalSize = 0;
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      totalSize += localStorage[key].length + key.length;
    }
  }
  
  const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
  const threshold = 5; // 5MB阈值
  
  return {
    sizeInBytes: totalSize,
    sizeInMB: parseFloat(sizeInMB),
    isNearLimit: totalSize > threshold * 1024 * 1024,
    needsMigration: totalSize > threshold * 1024 * 1024
  };
}

// 迁移播放历史到 IndexedDB
export async function migratePlayHistoryToIndexedDB() {
  if (!db) await initIndexedDB();
  
  try {
    const playHistory = localStorage.getItem('2fmusic_play_history');
    if (!playHistory) return { migrated: 0, message: '无播放历史需要迁移' };

    const data = JSON.parse(playHistory);
    const transaction = db.transaction(['playHistory'], 'readwrite');
    const store = transaction.objectStore('playHistory');
    
    let count = 0;
    data.forEach(item => {
      item.id = `${item.filename}_${item.playedAt}`;
      store.put(item);
      count++;
    });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 迁移了 ${count} 条播放历史`);
        // 迁移完成后可选删除localStorage中的数据以释放空间
        // localStorage.removeItem('2fmusic_play_history');
        resolve({ migrated: count, message: `已迁移 ${count} 条播放历史到 IndexedDB` });
      };
      
      transaction.onerror = () => {
        console.error('[IndexedDB] 播放历史迁移失败:', transaction.error);
        reject(transaction.error);
      };
    });
  } catch (e) {
    console.error('[IndexedDB] 播放历史迁移出错:', e);
    throw e;
  }
}

// 迁移收听统计到 IndexedDB
export async function migrateListenStatsToIndexedDB() {
  if (!db) await initIndexedDB();
  
  try {
    const listenStats = localStorage.getItem('2fmusic_listen_stats');
    if (!listenStats) return { migrated: 0, message: '无收听统计需要迁移' };

    const statsObj = JSON.parse(listenStats);
    const transaction = db.transaction(['listenStats'], 'readwrite');
    const store = transaction.objectStore('listenStats');
    
    let count = 0;
    Object.values(statsObj).forEach(item => {
      store.put(item);
      count++;
    });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 迁移了 ${count} 条收听统计`);
        // localStorage.removeItem('2fmusic_listen_stats');
        resolve({ migrated: count, message: `已迁移 ${count} 条收听统计到 IndexedDB` });
      };
      
      transaction.onerror = () => {
        console.error('[IndexedDB] 收听统计迁移失败:', transaction.error);
        reject(transaction.error);
      };
    });
  } catch (e) {
    console.error('[IndexedDB] 收听统计迁移出错:', e);
    throw e;
  }
}

// 从 IndexedDB 读取播放历史
export async function getPlayHistoryFromDB(limit = 100) {
  if (!db) await initIndexedDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playHistory'], 'readonly');
    const store = transaction.objectStore('playHistory');
    const request = store.getAll();

    request.onsuccess = () => {
      const data = request.result;
      // 按 playedAt 降序排序，返回最新的 N 条
      const sorted = data.sort((a, b) => 
        new Date(b.playedAt) - new Date(a.playedAt)
      ).slice(0, limit);
      
      resolve(sorted);
    };

    request.onerror = () => reject(request.error);
  });
}

// 从 IndexedDB 读取收听统计
export async function getListenStatsFromDB() {
  if (!db) await initIndexedDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['listenStats'], 'readonly');
    const store = transaction.objectStore('listenStats');
    const request = store.getAll();

    request.onsuccess = () => {
      const data = request.result;
      const statsObj = {};
      data.forEach(item => {
        statsObj[item.filename] = item;
      });
      resolve(statsObj);
    };

    request.onerror = () => reject(request.error);
  });
}

// 自动检查并迁移（在初始化时调用）
export async function checkAndMigrateData() {
  try {
    const spaceStatus = checkLocalStorageSize();
    
    if (spaceStatus.needsMigration) {
      console.warn('[IndexedDB] 检测到 localStorage 接近限制，准备迁移...');
      
      const results = [];
      
      // 先初始化 IndexedDB
      await initIndexedDB();
      
      // 迁移播放历史
      const historyResult = await migratePlayHistoryToIndexedDB();
      results.push(historyResult);
      
      // 迁移收听统计
      const statsResult = await migrateListenStatsToIndexedDB();
      results.push(statsResult);
      
      console.log('[IndexedDB] 数据迁移完成:', results);
      return {
        success: true,
        spaceBefore: spaceStatus.sizeInMB,
        migrations: results
      };
    } else {
      console.log(`[IndexedDB] localStorage 使用 ${spaceStatus.sizeInMB}MB，无需迁移`);
      return {
        success: true,
        spaceBefore: spaceStatus.sizeInMB,
        message: '无需迁移'
      };
    }
  } catch (e) {
    console.error('[IndexedDB] 数据迁移检查失败:', e);
    return {
      success: false,
      error: e.message
    };
  }
}

// 清理 IndexedDB 中过期的数据
export async function cleanupOldData(daysOld = 90) {
  if (!db) await initIndexedDB();
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const transaction = db.transaction(['playHistory'], 'readwrite');
    const store = transaction.objectStore('playHistory');
    const index = store.index('playedAt');
    const range = IDBKeyRange.upperBound(cutoffDate.toISOString());
    
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 清理了 ${deletedCount} 条超过 ${daysOld} 天的历史记录`);
        resolve(deletedCount);
      };
      
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 数据清理失败:', e);
    throw e;
  }
}

// 导出数据备份
export async function exportDBAsJSON() {
  if (!db) await initIndexedDB();
  
  try {
    const backups = {};
    
    for (const storeName of Object.keys(STORES)) {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      backups[storeName] = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    
    return {
      backup: backups,
      exportTime: new Date().toISOString(),
      version: DB_VERSION
    };
  } catch (e) {
    console.error('[IndexedDB] 导出失败:', e);
    throw e;
  }
}
