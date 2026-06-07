(function () {
  /* Piped public instances — tried in order until one responds */
  const PIPED = [
    'https://pipedapi.kavin.rocks',
    'https://piped-api.garudalinux.org',
    'https://api.piped.projectsegfau.lt',
  ];

  const input  = document.getElementById('url-input');
  const paste  = document.getElementById('paste-btn');
  const dlBtn  = document.getElementById('download-btn');
  const status = document.getElementById('status');
  const qGrid  = document.getElementById('quality-grid');

  let selQ     = 'max';
  let selAudio = false;

  /* quality chip selection */
  qGrid.addEventListener('click', e => {
    const btn = e.target.closest('.q-btn');
    if (!btn) return;
    qGrid.querySelectorAll('.q-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selQ     = btn.dataset.q;
    selAudio = btn.dataset.audio === 'true';
  });

  /* paste button */
  paste.addEventListener('click', async () => {
    try {
      input.value = (await navigator.clipboard.readText()).trim();
      clearStatus();
    } catch {
      showStatus('Clipboard denied — long-press the input box and choose Paste.', 'err');
    }
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') dlBtn.click(); });

  /* download */
  dlBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) { showStatus('Paste a YouTube link first.', 'err'); return; }

    const videoId = extractId(url);
    if (!videoId) {
      showStatus('Not a YouTube link — copy the URL directly from the YouTube app or browser.', 'err');
      return;
    }

    dlBtn.disabled = true;
    showStatus('<span class="spin"></span>Fetching video…', 'info');

    try {
      const data   = await fetchStreams(videoId);
      const stream = selectStream(data, selQ, selAudio);

      if (!stream?.url) {
        throw new Error('No stream found at this quality. Try a lower quality or Audio.');
      }

      /* Open stream URL — browser will download or play it */
      const a = document.createElement('a');
      a.href   = stream.url;
      a.target = '_blank';
      a.rel    = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();

      showStatus('✓ Download opened! On iPhone: tap the screen → tap the share icon → Save to Files.', 'ok');
    } catch (e) {
      showStatus('⚠ ' + e.message, 'err');
    } finally {
      dlBtn.disabled = false;
    }
  });

  /* ── helpers ── */

  function extractId(url) {
    const pats = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /\/shorts\/([a-zA-Z0-9_-]{11})/,
      /\/embed\/([a-zA-Z0-9_-]{11})/,
      /\/live\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of pats) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  async function fetchStreams(videoId) {
    let lastErr = new Error('All download servers are busy. Try again in a moment.');
    for (const host of PIPED) {
      try {
        const res = await fetch(`${host}/streams/${videoId}`, {
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) continue;
        const d = await res.json();
        if (d.error) throw new Error(friendlyPipedError(d.error));
        return d;
      } catch (e) {
        if (e.name !== 'AbortError' && e.name !== 'TypeError') lastErr = e;
      }
    }
    throw lastErr;
  }

  function selectStream(data, qualityLabel, isAudio) {
    if (isAudio) {
      return (data.audioStreams || [])
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    }

    /* Progressive streams have video + audio combined */
    const progressive = (data.videoStreams || [])
      .filter(s => !s.videoOnly)
      .map(s => ({ ...s, h: parseInt(s.quality) || 0 }))
      .sort((a, b) => b.h - a.h);

    /* Fall back to any video stream if no progressive found */
    const pool = progressive.length
      ? progressive
      : (data.videoStreams || [])
          .map(s => ({ ...s, h: parseInt(s.quality) || 0 }))
          .sort((a, b) => b.h - a.h);

    if (!pool.length) return null;
    if (qualityLabel === 'max') return pool[0];

    const target = parseInt(qualityLabel);
    return pool.find(s => s.h <= target) || pool[pool.length - 1];
  }

  function friendlyPipedError(msg) {
    const m = (msg || '').toLowerCase();
    if (m.includes('private'))    return 'This video is private.';
    if (m.includes('unavailable')) return 'This video is unavailable or deleted.';
    if (m.includes('age'))         return 'This video is age-restricted and cannot be downloaded.';
    return msg || 'Could not fetch this video.';
  }

  function showStatus(html, type) {
    status.innerHTML  = html;
    status.className  = 'status ' + type;
  }

  function clearStatus() {
    status.className  = 'status hidden';
    status.innerHTML  = '';
  }
})();
