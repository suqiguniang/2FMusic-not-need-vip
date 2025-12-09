#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import sqlite3
import threading
import shutil
import logging
import argparse
import locale
import concurrent.futures
from urllib.parse import quote, unquote

# 从 lib 目录导入第三方库
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(CURRENT_DIR, 'lib')
sys.path.insert(0, LIB_DIR)

try:
    from flask import Flask, render_template, request, jsonify, send_file
    import requests
    from mutagen import File
    from mutagen.easyid3 import EasyID3
except ImportError as e:
    print(f"错误：无法导入依赖库。\n详情: {e}")
    sys.exit(1)

# --- 环境配置 ---
os.environ['PYTHONIOENCODING'] = 'utf-8'
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

for encoding in ['UTF-8', 'utf-8', 'en_US.UTF-8', 'zh_CN.UTF-8']:
    try:
        locale.setlocale(locale.LC_ALL, f'en_US.{encoding}')
        break
    except:
        continue

# --- 参数解析 ---
parser = argparse.ArgumentParser(description='2FMusic Server')
parser.add_argument('--music-library-path', type=str, help='Path to music library')
parser.add_argument('--log-path', type=str, help='Path to log file')
parser.add_argument('--port', type=int, default=8080, help='Server port')
args = parser.parse_args()

# --- 路径初始化 ---
MUSIC_LIBRARY_PATH = args.music_library_path or os.getcwd()
os.makedirs(MUSIC_LIBRARY_PATH, exist_ok=True)
os.makedirs(os.path.join(MUSIC_LIBRARY_PATH, 'lyrics'), exist_ok=True)
os.makedirs(os.path.join(MUSIC_LIBRARY_PATH, 'covers'), exist_ok=True)

log_file = args.log_path or os.path.join(os.getcwd(), 'app.log')
os.makedirs(os.path.dirname(log_file), exist_ok=True)
DB_PATH = os.path.join(MUSIC_LIBRARY_PATH, 'library_cache.db')

# --- 日志配置 ---
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.handlers.clear()
file_handler = logging.FileHandler(log_file, mode='w', encoding='utf-8')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
logger.addHandler(file_handler)
logger.addHandler(console_handler)

logger.info(f"Music Library Path: {MUSIC_LIBRARY_PATH}")

# --- 全局状态变量 ---
SCAN_STATUS = {
    'scanning': False,
    'total': 0,
    'processed': 0,
    'current_file': ''
}

app = Flask(__name__, static_folder='../www/static', template_folder='../www/templates')

# --- 数据库管理 ---
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    try:
        with get_db() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS songs (
                    filename TEXT PRIMARY KEY,
                    title TEXT,
                    artist TEXT,
                    album TEXT,
                    mtime REAL,
                    size INTEGER,
                    has_cover INTEGER DEFAULT 0
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS mount_points (
                    path TEXT PRIMARY KEY,
                    created_at REAL
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS mount_files (
                    mount_path TEXT,
                    file_type TEXT, 
                    filename TEXT,
                    PRIMARY KEY (mount_path, filename)
                )
            ''')
            conn.commit()
        logger.info("数据库初始化完成。")
    except Exception as e:
        logger.exception(f"数据库初始化失败: {e}")

# --- 元数据提取 ---
def get_metadata(file_path):
    metadata = {'title': None, 'artist': None, 'album': None}
    try:
        audio = None
        try:
            audio = EasyID3(file_path)
        except Exception as e1:
            try:
                audio = File(file_path, easy=True)
            except Exception as e2:
                audio = File(file_path)
                logger.warning(f"文件 {file_path} 元数据解析异常: {e2}")
        if audio:
            def get_tag(key):
                if hasattr(audio, 'get'):
                    val = audio.get(key)
                    if isinstance(val, list): return val[0]
                    return val
                return None
            metadata['title'] = get_tag('title')
            metadata['artist'] = get_tag('artist')
            metadata['album'] = get_tag('album')
    except Exception as e:
        logger.error(f"提取元数据失败: {file_path}, 错误: {e}")
    filename = os.path.splitext(os.path.basename(file_path))[0]
    if not metadata['title']:
        if ' - ' in filename:
            parts = filename.split(' - ', 1)
            if not metadata['artist']: metadata['artist'] = parts[0].strip()
            metadata['title'] = parts[1].strip()
        else:
            metadata['title'] = filename
    if not metadata['artist']: metadata['artist'] = "未知艺术家"
    logger.debug(f"文件 {file_path} 元数据: {metadata}")
    return metadata

# --- 优化后的并发扫描逻辑 ---
def scan_library_incremental():
    global SCAN_STATUS
    
    lock_file = os.path.join(MUSIC_LIBRARY_PATH, '.scan_lock')
    if os.path.exists(lock_file):
        if time.time() - os.path.getmtime(lock_file) > 300:
            try:
                os.remove(lock_file)
                logger.info("过期扫描锁文件已移除。")
            except Exception as e:
                logger.warning(f"移除扫描锁文件失败: {e}")
        else:
            return 

    try:
        # 更新状态：开始
        SCAN_STATUS.update({'scanning': True, 'total': 0, 'processed': 0, 'current_file': '正在遍历文件...'})
        
        with open(lock_file, 'w') as f: f.write(str(time.time()))
        logger.info("开始增量扫描...")
        
        disk_files = {}
        supported_exts = ('.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma')
        
        # 1. 快速遍历文件
        files_to_process_list = []
        
        for root, dirs, files in os.walk(MUSIC_LIBRARY_PATH):
            dirs[:] = [d for d in dirs if d not in ('lyrics', 'covers')]
            for f in files:
                if f.lower().endswith(supported_exts):
                    if root != MUSIC_LIBRARY_PATH: continue 
                    path = os.path.join(root, f)
                    try:
                        stat = os.stat(path)
                        info = {'mtime': stat.st_mtime, 'size': stat.st_size, 'path': path, 'filename': f}
                        disk_files[f] = info
                    except: pass

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT filename, mtime, size FROM songs")
            db_rows = {row['filename']: row for row in cursor.fetchall()}
            
            # 删除不存在的文件
            to_delete = set(db_rows.keys()) - set(disk_files.keys())
            if to_delete:
                cursor.executemany("DELETE FROM songs WHERE filename=?", [(f,) for f in to_delete])
                conn.commit()

            # 筛选需要更新的文件
            for fname, info in disk_files.items():
                db_rec = db_rows.get(fname)
                if not db_rec or db_rec['mtime'] != info['mtime'] or db_rec['size'] != info['size']:
                    files_to_process_list.append(info)

            # 更新状态：准备处理
            total_files = len(files_to_process_list)
            SCAN_STATUS.update({'total': total_files, 'processed': 0})
            
            to_update_db = []
            
            # 2. 多线程提取元数据
            if total_files > 0:
                logger.info(f"使用线程池处理 {total_files} 个文件...")
                
                def process_file_metadata(info):
                    meta = get_metadata(info['path'])
                    base = os.path.splitext(info['filename'])[0]
                    has_cover = 1 if os.path.exists(os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base}.jpg")) else 0
                    return (info['filename'], meta['title'], meta['artist'], meta['album'], info['mtime'], info['size'], has_cover)

                # 使用线程池并发处理
                with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                    futures = {executor.submit(process_file_metadata, item): item for item in files_to_process_list}
                    for future in concurrent.futures.as_completed(futures):
                        try:
                            res = future.result()
                            to_update_db.append(res)
                        except Exception: pass
                        
                        # 更新进度
                        SCAN_STATUS['processed'] += 1
                        if SCAN_STATUS['processed'] % 10 == 0:
                            SCAN_STATUS['current_file'] = f"处理中... {int((SCAN_STATUS['processed']/total_files)*100)}%"

                # 批量写入
                if to_update_db:
                    cursor.executemany('''
                        INSERT OR REPLACE INTO songs (filename, title, artist, album, mtime, size, has_cover)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', to_update_db)
                    conn.commit()

        logger.info("扫描完成。")
        
    except Exception as e:
        logger.error(f"扫描失败: {e}")
    finally:
        SCAN_STATUS['scanning'] = False
        SCAN_STATUS['current_file'] = ''
        if os.path.exists(lock_file): 
            try: os.remove(lock_file)
            except: pass

threading.Thread(target=lambda: (init_db(), scan_library_incremental()), daemon=True).start()

# --- 路由定义 ---
@app.route('/')
@app.route('/import_mode')
def index(): return render_template('index.html')

# --- 系统状态接口 ---
@app.route('/api/system/status')
def get_system_status():
    """返回当前扫描状态和进度"""
    return jsonify(SCAN_STATUS)

@app.route('/api/music', methods=['GET'])
def get_music_list():
    logger.info("API请求: 获取音乐列表")
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM songs ORDER BY title")
            songs = []
            for row in cursor.fetchall():
                album_art = None
                if row['has_cover']:
                    base_name = os.path.splitext(row['filename'])[0]
                    album_art = f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(row['filename'])}"
                songs.append({
                    'filename': row['filename'], 'title': row['title'],
                    'artist': row['artist'], 'album': row['album'], 'album_art': album_art
                })
        logger.info(f"返回音乐数量: {len(songs)}")
        return jsonify({'success': True, 'data': songs})
    except Exception as e:
        logger.exception(f"获取音乐列表失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/music/play/<filename>')
def play_music(filename):
    logger.info(f"API请求: 播放音乐 {filename}")
    path = os.path.join(MUSIC_LIBRARY_PATH, unquote(filename))
    if os.path.exists(path):
        logger.info(f"文件存在，开始发送: {path}")
        return send_file(path, conditional=True)
    logger.warning(f"文件未找到: {path}")
    return jsonify({'error': 'Not Found'}), 404

# --- 挂载相关 ---
@app.route('/api/mount_points', methods=['GET'])
def list_mount_points():
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT path FROM mount_points ORDER BY created_at DESC").fetchall()
            return jsonify({'success': True, 'data': [row['path'] for row in rows]})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

@app.route('/api/mount_points', methods=['POST'])
def add_mount_point():
    logger.info("API请求: 添加挂载点")
    try:
        path = request.json.get('path')
        if not path or not os.path.exists(path):
            logger.warning(f"挂载路径不存在: {path}")
            return jsonify({'success': False, 'error': '路径不存在'})
        with get_db() as conn:
            if conn.execute("SELECT 1 FROM mount_points WHERE path=?", (path,)).fetchone():
                logger.warning(f"挂载点已存在: {path}")
                return jsonify({'success': False, 'error': '已挂载'})
            conn.execute("INSERT INTO mount_points (path, created_at) VALUES (?, ?)", (path, time.time()))
            conn.commit()
        logger.info(f"挂载点已添加: {path}")

        # 立即设置状态，防止前端轮询时线程还未启动
        SCAN_STATUS['scanning'] = True
        SCAN_STATUS['total'] = 0
        SCAN_STATUS['processed'] = 0
        SCAN_STATUS['current_file'] = "正在准备挂载..."

        def run_mount():
            try:
                logger.info(f"后台任务启动: 挂载 {path}")
                audio_exts = ('.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma')
                misc_exts = ('.lrc', '.jpg', '.png', '.jpeg')
                
                # 第一步：计算总数
                SCAN_STATUS['current_file'] = "正在分析文件列表..."
                total_files = 0
                for root, _, files in os.walk(path):
                    for f in files:
                        lower_f = f.lower()
                        if lower_f.endswith(audio_exts) or lower_f.endswith(misc_exts):
                            total_files += 1
                SCAN_STATUS['total'] = total_files
                
                # 第二步：执行处理
                added = []
                processed_count = 0
                
                for root, _, files in os.walk(path):
                    for f in files:
                        lower_f = f.lower()
                        is_audio = lower_f.endswith(audio_exts)
                        is_misc = lower_f.endswith(misc_exts)
                        
                        if is_audio or is_misc:
                            SCAN_STATUS['current_file'] = f"导入: {f}"
                            processed_count += 1
                            SCAN_STATUS['processed'] = processed_count
                            
                            base = os.path.splitext(f)[0]
                            if is_audio:
                                src = os.path.join(root, f)
                                dst = os.path.join(MUSIC_LIBRARY_PATH, f)
                                if not os.path.exists(dst):
                                    try:
                                        os.symlink(src, dst)
                                    except Exception:
                                        try: shutil.copy2(src, dst)
                                        except Exception: pass
                                added.append((path, 'audio', f))
                            
                            elif is_misc:
                                sub_dir = 'lyrics' if lower_f.endswith('.lrc') else 'covers'
                                s_path = os.path.join(root, f)
                                d_path = os.path.join(MUSIC_LIBRARY_PATH, sub_dir, f)
                                if not os.path.exists(d_path):
                                    try: shutil.copy2(s_path, d_path)
                                    except Exception: pass
                                added.append((path, 'misc', f))

                if added:
                    with get_db() as conn:
                        conn.executemany("INSERT OR IGNORE INTO mount_files VALUES (?, ?, ?)", added)
                        conn.commit()
                    logger.info(f"挂载文件入库: {len(added)} 条")
                
                # 触发扫描索引（scan_library_incremental 会重置 SCAN_STATUS 并显示索引进度）
                scan_library_incremental()
                logger.info(f"挂载点扫描完成: {path}")
                
            except Exception as e:
                logger.error(f"挂载任务异常: {e}")
                SCAN_STATUS['scanning'] = False

        threading.Thread(target=run_mount, daemon=True).start()
        return jsonify({'success': True, 'message': '后台处理中...'})
    except Exception as e:
        logger.exception(f"添加挂载点失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/mount_points', methods=['DELETE'])
def remove_mount_point():
    try:
        path = request.json.get('path')
        with get_db() as conn:
            files = conn.execute("SELECT file_type, filename FROM mount_files WHERE mount_path=?", (path,)).fetchall()
            for row in files:
                fpath = None
                if row['file_type'] == 'audio': fpath = os.path.join(MUSIC_LIBRARY_PATH, row['filename'])
                elif row['filename'].endswith('.lrc'): fpath = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', row['filename'])
                else: fpath = os.path.join(MUSIC_LIBRARY_PATH, 'covers', row['filename'])
                
                if fpath and os.path.exists(fpath):
                    try: os.remove(fpath)
                    except: pass
            
            conn.execute("DELETE FROM songs WHERE filename IN (SELECT filename FROM mount_files WHERE mount_path=? AND file_type='audio')", (path,))
            conn.execute("DELETE FROM mount_points WHERE path=?", (path,))
            conn.execute("DELETE FROM mount_files WHERE mount_path=?", (path,))
            conn.commit()
            
        return jsonify({'success': True, 'message': '已移除'})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

# --- 资源获取 ---
COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Authorization': '2FMusic'
}
@app.route('/api/music/lyrics')
def get_lyrics_api():
    title = request.args.get('title')
    logger.info("API请求: 获取歌词")
    title = request.args.get('title')
    artist = request.args.get('artist')
    filename = request.args.get('filename')
    if not title:
        logger.warning("歌词请求缺少title参数")
        return jsonify({'success': False})
    filename = unquote(filename) if filename else None
    # 1. 优先读取本地
    if filename:
        base_name = os.path.splitext(os.path.basename(filename))[0]
        lrc_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', f"{base_name}.lrc")
        if os.path.exists(lrc_path):
            try:
                with open(lrc_path, 'r', encoding='utf-8') as f:
                    logger.info(f"本地歌词命中: {lrc_path}")
                    return jsonify({'success': True, 'lyrics': f.read()})
            except Exception as e:
                logger.warning(f"读取本地歌词失败: {lrc_path}, 错误: {e}")
    # 2. 网络获取
    api_urls = [
        f"https://lrcapi.msfxp.top/lyrics?artist={quote(artist or '')}&title={quote(title)}",
        f"https://api.lrc.cx/lyrics?artist={quote(artist or '')}&title={quote(title)}"
    ]
    for api_url in api_urls:
        try:
            logger.info(f"请求歌词API: {api_url}")
            resp = requests.get(api_url, timeout=3, headers=COMMON_HEADERS)
            if resp.status_code == 200:
                with open(lrc_path, 'wb') as f:
                    f.write(resp.text.encode('utf-8'))
                logger.info(f"网络歌词保存: {lrc_path}")
                return jsonify({'success': True, 'lyrics': resp.text})
            else:
                logger.warning(f"歌词API响应异常: {api_url}, 状态码: {resp.status_code}")
        except Exception as e:
            logger.warning(f"歌词API请求失败: {api_url}, 错误: {e}")
    logger.warning(f"歌词获取失败: {title} - {artist}")
    return jsonify({'success': False})

@app.route('/api/music/album-art')
def get_album_art_api():
    title = request.args.get('title')
    artist = request.args.get('artist') or ''
    filename = request.args.get('filename')
    
    if not title or not filename: return jsonify({'success': False})
    filename = unquote(filename)
    base_name = os.path.splitext(os.path.basename(filename))[0]
    
    local_path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
    if os.path.exists(local_path):
        return jsonify({'success': True, 'album_art': f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"})

    # 网络获取并保存
    api_urls = [
        f"https://api.lrc.cx/cover?artist={quote(artist)}&title={quote(title)}",
        f"https://lrcapi.msfxp.top/cover?artist={quote(artist)}&title={quote(title)}"
    ]
    
    for api_url in api_urls:
        try:
            resp = requests.get(api_url, timeout=3, headers=COMMON_HEADERS)
            if resp.status_code == 200 and resp.headers.get('content-type', '').startswith('image/'):
                with open(local_path, 'wb') as f: 
                    f.write(resp.content)
                
                # 更新数据库标识
                if not os.path.isabs(filename):
                    with get_db() as conn: 
                        conn.execute("UPDATE songs SET has_cover=1 WHERE filename=?", (filename,))
                        conn.commit()
                        
                return jsonify({'success': True, 'album_art': f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"})
        except: pass
        
    return jsonify({'success': False})

@app.route('/api/music/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    filename = unquote(filename)
    try:
        path = os.path.join(MUSIC_LIBRARY_PATH, filename)
        if os.path.exists(path):
            # 重试机制应对 Windows 文件锁
            for i in range(10):
                try:
                    os.remove(path)
                    break
                except PermissionError:
                    if i < 9: time.sleep(0.2)
                    else: return jsonify({'success': False, 'error': '文件正被占用，无法删除'})
            
            # 清理关联元数据
            base = os.path.splitext(filename)[0]
            for sub in ['lyrics', 'covers']:
                ext = '.lrc' if sub == 'lyrics' else '.jpg'
                sub_path = os.path.join(MUSIC_LIBRARY_PATH, sub, base + ext)
                try: 
                    if os.path.exists(sub_path): os.remove(sub_path)
                except: pass
            
            with get_db() as conn:
                conn.execute("DELETE FROM songs WHERE filename=?", (filename,))
                conn.execute("DELETE FROM mount_files WHERE filename=?", (filename,))
                conn.commit()
            return jsonify({'success': True})
        return jsonify({'success': False, 'error': '文件未找到'})
    except Exception as e: 
        return jsonify({'success': False, 'error': str(e)})

# --- 辅助接口 ---
@app.route('/api/music/covers/<cover_name>')
def get_cover(cover_name):
    cover_name = unquote(cover_name)
    path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', cover_name)
    if os.path.exists(path): return send_file(path, mimetype='image/jpeg')
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/music/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({'success': False, 'error': '未收到文件'})
    file = request.files['file']
    if file.filename == '': return jsonify({'success': False, 'error': '文件名为空'})
    if file:
        filename = file.filename
        save_path = os.path.join(MUSIC_LIBRARY_PATH, filename)
        try:
            file.save(save_path)
            scan_library_incremental()
            return jsonify({'success': True})
        except Exception as e: return jsonify({'success': False, 'error': str(e)})
    return jsonify({'success': False, 'error': '未知错误'})

@app.route('/api/music/import_path', methods=['POST'])
def import_music_by_path():
    try:
        data = request.json
        src_path = data.get('path')
        if not src_path or not os.path.exists(src_path): return jsonify({'success': False, 'error': '无效路径'})
        filename = os.path.basename(src_path)
        dst_path = os.path.join(MUSIC_LIBRARY_PATH, filename)
        if not os.path.exists(dst_path):
            shutil.copy2(src_path, dst_path)
            scan_library_incremental()
        return jsonify({'success': True, 'filename': filename})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

@app.route('/api/music/external/meta')
def get_external_meta():
    path = request.args.get('path')
    if not path or not os.path.exists(path): return jsonify({'success': False, 'error': '文件未找到'})
    try:
        meta = get_metadata(path)
        album_art = None
        base_name = os.path.splitext(os.path.basename(path))[0]
        cached_cover = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
        if os.path.exists(cached_cover): album_art = f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"
        return jsonify({'success': True, 'data': {'filename': path, 'title': meta['title'] or os.path.basename(path), 'artist': meta['artist'] or '未知艺术家', 'album': meta['album'] or '', 'album_art': album_art}})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

@app.route('/api/music/external/play')
def play_external_file():
    path = request.args.get('path')
    if path and os.path.exists(path): return send_file(path, conditional=True)
    return jsonify({'error': '文件未找到'}), 404

if __name__ == '__main__':
    logger.info(f"服务启动，端口: {args.port} ...")
    try:
        init_db()
        app.run(host='0.0.0.0', port=args.port, threaded=True)
    except Exception as e:
        logger.exception(f"服务启动失败: {e}")