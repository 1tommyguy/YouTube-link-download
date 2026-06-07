from http.server import BaseHTTPRequestHandler
import json
import re
import yt_dlp


def sanitize(url):
    url = url.strip()
    if not re.match(r'^https?://(www\.)?(youtube\.com|youtu\.be)/', url):
        raise ValueError('Only YouTube URLs are supported')
    return url


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
            url    = sanitize(body.get('url', ''))
        except ValueError as e:
            return self._json({'error': str(e)}, 400)

        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extractor_args': {'youtube': {'player_client': ['android']}},
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
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
                # Progressive streams (video + audio combined)
                if vcode != 'none' and acode != 'none' and h not in seen_h:
                    seen_h.add(h)
                    formats.append({'url': furl, 'height': h,
                                    'ext': f.get('ext', 'mp4'), 'audio_only': False})

            # Best audio stream
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

            self._json({
                'title': info.get('title', 'video'),
                'formats': formats,
            })

        except yt_dlp.utils.DownloadError as e:
            msg = str(e)
            if 'private' in msg.lower():
                err = 'This video is private.'
            elif 'unavailable' in msg.lower():
                err = 'This video is unavailable.'
            elif 'age' in msg.lower():
                err = 'This video is age-restricted.'
            else:
                err = 'Could not fetch this video.'
            self._json({'error': err}, 400)

        except Exception as e:
            self._json({'error': str(e)}, 500)

    def _cors(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

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
