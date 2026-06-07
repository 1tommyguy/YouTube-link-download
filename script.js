(function () {

  /* ── API instance lists ─────────────────────────────────────────── */
  const PIPED_HOSTS = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.moomoo.me',
    'https://pipedapi.adminforge.de',
    'https://piped-api.garudalinux.org',
    'https://api.piped.projectsegfau.lt',
  ];

  const INVIDIOUS_HOSTS = [
    'https://inv.nadeko.net',
    'https://invidious.privacyredirect.com',
    'https://yt.cdaut.de',
    'https://invidious.nerdvpn.de',
    'https://iv.melmac.space',
  ];

  /* ── DOM refs ───────────────────────────────────────────────────── */
  const input  = document.getElementById('url-input');
  const paste  = document.getElementById('paste-btn');
  const dlBtn  = document.getElementById('download-btn');
  const status = document.getElementById('status');
  const qGrid  = document.getElementById('quality-grid');

  let selQ     = 'max';
  let selAudio = false;

  /* ── quality chips ──────────────────────────────────────────────── */
  qGrid.addEventListener('click', e => {
    const btn = e.target.closest('.q-btn');
    if (!btn) return;
    qGrid.querySelectorAll('.q-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selQ     = btn.dataset.q;
    selAudio = btn.dataset.audio === 'true';
  });

  /* ── paste button ───────────────────────────────────────────────── */
  paste.addEventListener('click', async () => {
    try {
      input.value = (await navigator.clipboard.readText()).trim();
      clearStatus();
    } catch {
      showStatus('Clipboard denied — long-press the input box and choose Paste.', 'err');
    }
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') dlBtn.click(); });

  /* ── main download flow ─────────────────────────────────────────── */
  dlBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) { showStatus('Paste a YouTube link first.', 'err'); return; }

    const videoId = extractId(url);
    if (!videoId) {
      showStatus('Not a YouTube link — copy the URL directly from the YouTube app.', 'err');
      return;
    }

    dlBtn.disabled = true;
    showStatus('<span class="spin"></span>Fetching video…', 'info');

    try {
      const result = await fetchWithFallback(videoId);
      const streamUrl = selectStream(result, selQ, selAudio);

      if (!streamUrl) throw new Error('No stream found. Try a lower quality or "Audio".');

      /* open URL — browser handles the download */
      const a = document.createElement('a');
      a.href   = streamUrl;
      a.target = '_blank';
      a.rel    = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();

      showStatus('✓ Download started! On iPhone: if a player opens, tap ↑ Share → Save to Files.', 'ok');
    } catch (e) {
      showStatus('⚠ ' + e.message, 'err');
    } finally {
      dlBtn.disabled = false;
    }
  });

  /* ── fetch with Piped → Invidious fallback ──────────────────────── */
  async function fetchWithFallback(videoId) {
    /* 1. Try Piped instances */
    for (const host of PIPED_HOSTS) {
      try {
        const res = await timedFetch(`${host}/streams/${videoId}`, 9000);
        if (!res.ok) continue;
        const d = await res.json();
        if (d.error) { handleVideoError(d.error); }
        if (d.videoStreams?.length) return { api: 'piped', d };
      } catch (e) {
        if (e.isFatal) throw e;
      }
    }

    /* 2. Try Invidious instances */
    for (const host of INVIDIOUS_HOSTS) {
      try {
        const res = await timedFetch(
          `${host}/api/v1/videos/${videoId}?fields=title,formatStreams,adaptiveFormats`,
          9000
        );
        if (!res.ok) continue;
        const d = await res.json();
        if (d.error) handleVideoError(d.error);
        if (d.formatStreams?.length || d.adaptiveFormats?.length) return { api: 'invidious', d };
      } catch (e) {
        if (e.isFatal) throw e;
      }
    }

    throw new Error('Download service unavailable right now. Please try again in a minute.');
  }

  /* ── stream selection ───────────────────────────────────────────── */
  function selectStream(result, qualityLabel, isAudio) {
    const { api, d } = result;

    if (api === 'piped') {
      if (isAudio) {
        const s = (d.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return s[0]?.url || null;
      }
      const progressive = (d.videoStreams || [])
        .filter(s => !s.videoOnly)
        .map(s => ({ url: s.url, h: parseInt(s.quality) || 0 }))
        .sort((a, b) => b.h - a.h);
      const pool = progressive.length
        ? progressive
        : (d.videoStreams || []).map(s => ({ url: s.url, h: parseInt(s.quality) || 0 })).sort((a, b) => b.h - a.h);
      return pickQuality(pool, qualityLabel);
    }

    if (api === 'invidious') {
      if (isAudio) {
        const audio = (d.adaptiveFormats || [])
          .filter(s => s.type?.startsWith('audio'))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return audio[0]?.url || null;
      }
      /* formatStreams = progressive MP4 (video + audio combined) */
      const pool = (d.formatStreams || [])
        .filter(s => s.container === 'mp4')
        .map(s => ({ url: s.url, h: parseInt(s.qualityLabel) || 0 }))
        .sort((a, b) => b.h - a.h);
      if (!pool.length) {
        /* fall back to adaptive video */
        const adaptive = (d.adaptiveFormats || [])
          .filter(s => s.type?.startsWith('video'))
          .map(s => ({ url: s.url, h: parseInt(s.qualityLabel) || 0 }))
          .sort((a, b) => b.h - a.h);
        return pickQuality(adaptive, qualityLabel);
      }
      return pickQuality(pool, qualityLabel);
    }

    return null;
  }

  function pickQuality(pool, qualityLabel) {
    if (!pool.length) return null;
    if (qualityLabel === 'max') return pool[0].url;
    const target = parseInt(qualityLabel);
    return (pool.find(s => s.h <= target) || pool[pool.length - 1]).url;
  }

  /* ── utilities ──────────────────────────────────────────────────── */
  function timedFetch(url, ms) {
    return new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const id   = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { signal: ctrl.signal })
        .then(r => { clearTimeout(id); resolve(r); })
        .catch(e => { clearTimeout(id); reject(e); });
    });
  }

  function handleVideoError(msg) {
    const m = (msg || '').toLowerCase();
    const err = new Error(
      m.includes('private')      ? 'This video is private.' :
      m.includes('unavailable')  ? 'This video is unavailable or deleted.' :
      m.includes('age')          ? 'This video is age-restricted.' :
      'Could not load this video. It may be unavailable in your region.'
    );
    err.isFatal = true;
    throw err;
  }

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

  function showStatus(html, type) {
    status.innerHTML = html;
    status.className = 'status ' + type;
  }

  function clearStatus() {
    status.className = 'status hidden';
    status.innerHTML = '';
  }

})();
