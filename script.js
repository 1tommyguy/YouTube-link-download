(function () {

  const input  = document.getElementById('url-input');
  const paste  = document.getElementById('paste-btn');
  const dlBtn  = document.getElementById('download-btn');
  const status = document.getElementById('status');
  const qGrid  = document.getElementById('quality-grid');

  let selQ     = 'max';
  let selAudio = false;

  /* ── quality chips ── */
  qGrid.addEventListener('click', e => {
    const btn = e.target.closest('.q-btn');
    if (!btn) return;
    qGrid.querySelectorAll('.q-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selQ     = btn.dataset.q;
    selAudio = btn.dataset.audio === 'true';
  });

  /* ── paste ── */
  paste.addEventListener('click', async () => {
    try {
      input.value = (await navigator.clipboard.readText()).trim();
      clearStatus();
    } catch {
      showStatus('Long-press the input box and tap Paste.', 'err');
    }
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') dlBtn.click(); });

  /* ── download ── */
  dlBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) { showStatus('Paste a YouTube link first.', 'err'); return; }

    const videoId = extractId(url);
    if (!videoId) {
      showStatus('Not a valid YouTube link — copy it directly from the YouTube app.', 'err');
      return;
    }

    dlBtn.disabled = true;
    showStatus('<span class="spin"></span>Fetching video…', 'info');

    try {
      const formats = await fetchFormats(url);
      const pick    = selectFormat(formats, selQ, selAudio);

      if (!pick?.url) throw new Error('No stream found. Try a lower quality or Audio.');

      openDownload(pick.url);
      showStatus(
        '✓ Download started!<br><small>On iPhone: if a video plays, tap <b>↑ Share → Save to Files</b> to keep it.</small>',
        'ok'
      );
    } catch (e) {
      showDeployMsg(e.message);
    } finally {
      dlBtn.disabled = false;
    }
  });

  /* ── fetch: try local /api/info first (works on Vercel), else show error ── */
  async function fetchFormats(youtubeUrl) {
    try {
      const res = await timedFetch('/api/info', 20000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      });
      if (res.status === 404) throw new Error('NO_BACKEND');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Server error');
      }
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      return d.formats || [];
    } catch (e) {
      if (e.message === 'NO_BACKEND' || e.name === 'TypeError') {
        throw new Error('NO_BACKEND');
      }
      throw e;
    }
  }

  /* ── select the best format matching chosen quality ── */
  function selectFormat(formats, qualityLabel, isAudio) {
    if (isAudio) {
      return formats.find(f => f.audio_only) || null;
    }
    const videos = formats.filter(f => !f.audio_only).sort((a, b) => b.height - a.height);
    if (!videos.length) return null;
    if (qualityLabel === 'max') return videos[0];
    const target = parseInt(qualityLabel);
    return videos.find(v => v.height <= target) || videos[videos.length - 1];
  }

  /* ── open URL as download ── */
  function openDownload(url) {
    const a = Object.assign(document.createElement('a'), {
      href: url, target: '_blank', rel: 'noopener noreferrer',
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ── show "deploy backend" instructions ── */
  function showDeployMsg(msg) {
    if (msg === 'NO_BACKEND') {
      status.innerHTML = `
        <b>Backend not connected.</b><br>
        This site needs a backend server to download videos.
        Deploy it free in ~3 minutes:<br><br>
        <a href="https://vercel.com/new/clone?repository-url=https://github.com/1tommyguy/YouTube-link-download&branch=claude/youtube-video-downloader-j7Gw5"
           target="_blank" rel="noopener"
           style="display:inline-block;background:#000;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px 4px 4px 0">
          ▲ Deploy to Vercel (free)
        </a>
        <a href="https://render.com/deploy?repo=https://github.com/1tommyguy/YouTube-link-download"
           target="_blank" rel="noopener"
           style="display:inline-block;background:#46e3b7;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">
          ⬡ Deploy to Render (free)
        </a>
        <br><small style="color:#888;margin-top:8px;display:block">
          After deploying, use the URL they give you — it's your working downloader.
        </small>`;
      status.className = 'status err';
    } else {
      showStatus('⚠ ' + msg, 'err');
    }
  }

  /* ── utils ── */
  function extractId(url) {
    const pats = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /\/shorts\/([a-zA-Z0-9_-]{11})/,
      /\/embed\/([a-zA-Z0-9_-]{11})/,
      /\/live\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of pats) { const m = url.match(p); if (m) return m[1]; }
    return null;
  }

  function timedFetch(url, ms, opts) {
    return new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const id   = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { ...opts, signal: ctrl.signal })
        .then(r => { clearTimeout(id); resolve(r); })
        .catch(e => { clearTimeout(id); reject(e); });
    });
  }

  function showStatus(html, type) {
    status.innerHTML = html;
    status.className = 'status ' + type;
  }

  function clearStatus() {
    status.className = 'status hidden';
    status.innerHTML = '';
  }

})();
