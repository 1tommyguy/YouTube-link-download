from http.server import BaseHTTPRequestHandler
import json
import os
import re
import tempfile
import yt_dlp


def sanitize(url):
    url = url.strip()
    if not re.match(r'^https?://(www\.)?(youtube\.com|youtu\.be)/', url):
        raise ValueError('Only YouTube URLs are supported')
    return url


def make_ydl_opts():
    opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'extractor_args': {
            'youtube': {'player_client': ['ios', 'android', 'tv_embedded']}
        },
    }
    cookies = os.environ.get('YOUTUBE_COOKIES', '').strip()
    if cookies:
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        tmp.write(cookies)
        tmp.close()
        opts['cookiefile'] = tmp.name
    return opts


def friendly_error(msg):
    m = msg.lower()
    if 'sign in' in m or 'bot' in m or 'confirm' in m:
        return (
            'YouTube is blocking downloads from this server. '
            'Fix: open your Vercel project → Settings → Environment Variables '
            '→ add YOUTUBE_COOKIES with your browser cookies. '
            'See the README for exact steps.'
        )
    if 'private' in m:
        return 'This video is private.'
    if 'unavailable' in m:
        return 'This video is unavailable or deleted.'
    if 'age' in m:
        return 'This video is age-restricted.'
    return 'Could not fetch this video. Try again.'


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
            url    = sanitize(body.get('url', ''))
        except ValueError as e:
            return self._json({'error': str(e)}, 400)

        try:
            with yt_dlp.YoutubeDL(make_ydl_opts()) as ydl:
                info = ydl.extract_info(url, download=False)

            formats = []
            seen_h  = set()

            for f in (info.get('formats') or []):
                h     = f.get('height')
                vcode = f.get('vcodec', 'none')
                acode = f.get('acodec', 'none')
                furl  = f.get('url', '')
                if not h or not furl:
                    continue
                if vcode != 'none' and acode != 'none' and h not in seen_h:
                    seen_h.add(h)
                    formats.append({'url': furl, 'height': h,
                                    'ext': f.get('ext', 'mp4'), 'audio_only': False})

            audio = sorted(
                [f for f in (info.get('formats') or [])
                 if f.get('vcodec') == 'none' and f.get('url')],
                key=lambda x: x.get('abr') or x.get('tbr') or 0,
                reverse=True
            )
            if audio:
                f = audio[0]
                formats.append({'url': f['url'], 'height': 0,
                                'ext': f.get('ext', 'webm'), 'audio_only': True})

            formats.sort(key=lambda x: x['height'], reverse=True)
            self._json({'title': info.get('title', 'video'), 'formats': formats})

        except yt_dlp.utils.DownloadError as e:
            self._json({'error': friendly_error(str(e))}, 400)
        except Exception as e:
            self._json({'error': friendly_error(str(e))}, 500)

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
