import os
import json
import re
import subprocess
import tempfile
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import yt_dlp

app = Flask(__name__)

def sanitize_url(url):
    url = url.strip()
    if not re.match(r'^https?://(www\.)?(youtube\.com|youtu\.be)/', url):
        raise ValueError("Only YouTube URLs are allowed")
    return url

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/info", methods=["POST"])
def video_info():
    data = request.get_json(force=True)
    raw_url = data.get("url", "")
    try:
        url = sanitize_url(raw_url)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extractor_args": {"youtube": {"player_client": ["android"]}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            formats = []
            seen = set()
            for f in (info.get("formats") or []):
                if f.get("vcodec") == "none" or not f.get("height"):
                    continue
                label = f"{f['height']}p"
                ext = f.get("ext", "mp4")
                if label not in seen:
                    seen.add(label)
                    formats.append({
                        "format_id": f["format_id"],
                        "label": label,
                        "ext": ext,
                        "filesize": f.get("filesize") or f.get("filesize_approx"),
                    })
            formats.sort(key=lambda x: int(x["label"].replace("p", "")), reverse=True)
            # Add audio-only option
            formats.append({"format_id": "bestaudio/best", "label": "Audio only (MP3)", "ext": "mp3", "filesize": None})
            return jsonify({
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail"),
                "duration": info.get("duration"),
                "formats": formats,
            })
    except Exception as e:
        return jsonify({"error": f"Could not fetch video info: {str(e)}"}), 500

@app.route("/api/download", methods=["POST"])
def download_video():
    data = request.get_json(force=True)
    raw_url = data.get("url", "")
    format_id = data.get("format_id", "bestvideo+bestaudio/best")
    is_audio = data.get("is_audio", False)

    try:
        url = sanitize_url(raw_url)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "%(title)s.%(ext)s")
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "outtmpl": out_template,
            "extractor_args": {"youtube": {"player_client": ["android"]}},
        }

        if is_audio:
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        else:
            ydl_opts["format"] = f"{format_id}+bestaudio/best" if "+" not in format_id else format_id
            ydl_opts["merge_output_format"] = "mp4"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = re.sub(r'[^\w\s-]', '', info.get("title", "video")).strip()
                files = os.listdir(tmpdir)
                if not files:
                    return jsonify({"error": "Download failed — no output file"}), 500
                filepath = os.path.join(tmpdir, files[0])
                ext = os.path.splitext(filepath)[1]
                filename = f"{title}{ext}"

                def generate():
                    with open(filepath, "rb") as f:
                        while chunk := f.read(1024 * 64):
                            yield chunk

                content_type = "audio/mpeg" if is_audio else "video/mp4"
                headers = {
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Content-Type": content_type,
                }
                if os.path.exists(filepath):
                    headers["Content-Length"] = str(os.path.getsize(filepath))

                return Response(stream_with_context(generate()), headers=headers)
        except Exception as e:
            return jsonify({"error": f"Download failed: {str(e)}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
