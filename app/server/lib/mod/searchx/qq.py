import json
import logging
import urllib.parse
from functools import lru_cache

import requests

from mod import textcompare, tools
from mygo.devtools import no_error
from mod.ttscn import t2s

headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'origin': 'https://y.qq.com',
    'referer': 'https://y.qq.com/portal/player.html',
}

logger = logging.getLogger(__name__)

QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
QQ_SONG_DETAIL_URL = 'https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg'
QQ_VKEY_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
QQ_ALBUM_IMG_URL = 'http://imgcache.qq.com/music/photo/album_300/{}/300_albumpic_{}_0.jpg'


def listify(obj):
    if isinstance(obj, list):
        return obj
    else:
        return [obj]

def parse_f_field(f_str):
    # 解析f字段
    fields = f_str.split('|')
    return {
        'song_id': fields[0],
        'title': fields[1],
        'artist': fields[3],
        'img_id': fields[4],
        'songmid': fields[19] if len(fields) > 19 else '',
    }

def get_cover_url(img_id):
    try:
        img_id = int(img_id)
        return QQ_ALBUM_IMG_URL.format(img_id % 100, img_id)
    except Exception:
        return None

def get_songmid(song_id):
    params = {
        'songid': song_id,
        'tpl': 'yqq_song_detail',
        'format': 'json',
    }
    resp = requests.get(QQ_SONG_DETAIL_URL, params=params, headers=headers, timeout=10)
    data = resp.json()
    try:
        return data['data'][0]['mid']
    except Exception:
        return None

def get_lyrics(songmid):
    params = {
        'songmid': songmid,
        'format': 'json',
        'nobase64': 1,
    }
    resp = requests.get(QQ_LYRIC_URL, params=params, headers=headers, timeout=10)
    data = resp.json()
    if data.get('code') == 0 and 'lyric' in data:
        return data['lyric']
    elif data.get('code') == -1310:
        # 需要Referer
        resp = requests.get(QQ_LYRIC_URL, params=params, headers=headers, timeout=10)
        data = resp.json()
        return data.get('lyric', None)
    return None

def search_track(title, artist, album):
    result_list = []
    search_str = ' '.join([item for item in [title, artist, album] if item])
    params = {
        'w': search_str,
        'p': 1,
        'n': 5,
        'format': 'json',
    }
    resp = requests.get(QQ_SEARCH_URL, params=params, headers=headers, timeout=10)
    data = resp.json()
    try:
        song_list = data['data']['song']['list']
    except Exception:
        return []
    for song in song_list:
        title_conform_ratio = textcompare.association(title, song['songname'])
        artist_conform_ratio = textcompare.assoc_artists(artist, song['singer'][0]['name'] if song['singer'] else '')
        ratio = (title_conform_ratio * (artist_conform_ratio + 1) / 2) ** 0.5
        if ratio < 0.2:
            continue
        songmid = song.get('songmid')
        lyrics = get_lyrics(songmid) if songmid else None
        cover_url = get_cover_url(song.get('albumid'))
        music_json_data = {
            'title': song['songname'],
            'artist': song['singer'][0]['name'] if song['singer'] else '',
            'album': song.get('albumname', ''),
            'lyrics': lyrics,
            'cover': cover_url,
            'id': tools.calculate_md5(f"title:{song['songname']};artists:{song['singer'][0]['name'] if song['singer'] else ''};album:{song.get('albumname', '')}", base='decstr'),
        }
        result_list.append(music_json_data)
    return result_list

@lru_cache(maxsize=64)
@no_error(throw=logger.info, exceptions=(requests.RequestException, KeyError, IndexError, AttributeError))
def search(title='', artist='', album=''):
    title = str(title) if title else ''
    artist = str(artist) if artist else ''
    album = str(album) if album else ''
    if not any((title, artist, album)):
        return None
    title = title.strip()
    artist = artist.strip()
    album = album.strip()
    if title:
        return search_track(title=title, artist=artist, album=album)
    return None

if __name__ == "__main__":
    print(search(title="可能"))
