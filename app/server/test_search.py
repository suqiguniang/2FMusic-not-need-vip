import sys
import os
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import threading
from mod.searchx import qq, netease, kugou
from mod import textcompare

def search_api(api_func, title, artist, album, result_list, source):
    import time
    start = time.perf_counter()
    results = api_func(title=title, artist=artist, album=album)
    elapsed = (time.perf_counter() - start) * 1000  # ms
    print(f"[耗时] {source} API: {elapsed:.2f} ms")
    if results:
        for item in results:
            item = dict(item)
            item['source'] = source
            result_list.append(item)

# 定义API优先级加分
API_BONUS = {'qq': 0.01, 'netease': 0.005, 'kugou': 0.0}

def main(title, artist, album):
    import time
    t_all_start = time.perf_counter()
    threads = []
    all_results = []
    apis = [
        (qq.search, 'qq'),
        (netease.search, 'netease'),
        (kugou.search, 'kugou')
    ]
    t_thread_start = time.perf_counter()
    for api, source in apis:
        t = threading.Thread(target=search_api, args=(api, title, artist, album, all_results, source))
        threads.append(t)
        t.start()
    t_thread_end = time.perf_counter()
    print(f"[耗时] 线程启动耗时: {(t_thread_end - t_thread_start)*1000:.2f} ms")
    t_join_start = time.perf_counter()
    for t in threads:
        t.join()
    t_join_end = time.perf_counter()
    print(f"[耗时] 等待所有线程完成耗时: {(t_join_end - t_join_start)*1000:.2f} ms")
    t_score_start = time.perf_counter()
    scored = []
    for item in all_results:
        title_score = textcompare.association(title, item.get('title', ''))
        artist_score = textcompare.assoc_artists(artist, item.get('artist', '')) if artist else 1.0
        album_score = textcompare.association(album, item.get('album', '')) if album else 1.0
        score = 0.6 * title_score + 0.3 * artist_score + 0.1 * album_score
        score += API_BONUS.get(item.get('source'), 0.0)  # 微小加分
        scored.append((score, item))
    t_score_end = time.perf_counter()
    print(f"[耗时] 结果打分耗时: {(t_score_end - t_score_start)*1000:.2f} ms")
    t_sort_start = time.perf_counter()
    scored.sort(reverse=True, key=lambda x: x[0])
    t_sort_end = time.perf_counter()
    print(f"[耗时] 排序耗时: {(t_sort_end - t_sort_start)*1000:.2f} ms")
    best = scored[0][1] if scored else None
    print('最有效结果:', best)
    print('\n全部结果按相似度排序:')
    for s, item in scored:
        print(f"[source={item.get('source')}] score={s:.3f} title={item.get('title')} artist={item.get('artist')} album={item.get('album')} cover={item.get('cover')}")
    t_all_end = time.perf_counter()
    print(f"[耗时] main() 总耗时: {(t_all_end - t_all_start)*1000:.2f} ms")
    return best

if __name__ == "__main__":
    # 示例：
    main(title="可能", artist="程响", album="")
