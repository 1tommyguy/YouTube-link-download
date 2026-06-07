(function () {
  const COBALT = "https://api.cobalt.tools/";

  const input   = document.getElementById("url-input");
  const paste   = document.getElementById("paste-btn");
  const dlBtn   = document.getElementById("download-btn");
  const status  = document.getElementById("status");
  const qGrid   = document.getElementById("quality-grid");

  let selectedQ     = "max";
  let selectedAudio = false;

  /* ── quality chip selection ── */
  qGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".q-btn");
    if (!btn) return;
    qGrid.querySelectorAll(".q-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedQ     = btn.dataset.q;
    selectedAudio = btn.dataset.audio === "true";
  });

  /* ── paste button ── */
  paste.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      input.value = text.trim();
      hideStatus();
    } catch {
      showStatus("Clipboard access denied — please paste manually (Ctrl+V / long-press).", "err");
    }
  });

  /* ── enter key ── */
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") dlBtn.click();
  });

  /* ── download ── */
  dlBtn.addEventListener("click", async () => {
    const url = input.value.trim();
    if (!url) { showStatus("Please paste a YouTube link first.", "err"); return; }
    if (!isYouTube(url)) { showStatus("Only YouTube links are supported (youtube.com or youtu.be).", "err"); return; }

    setLoading(true);
    showStatus('<span class="spin"></span>Preparing your download…', "info");

    const body = {
      url,
      videoQuality: selectedAudio ? undefined : selectedQ,
      downloadMode: selectedAudio ? "audio" : "auto",
      filenameStyle: "pretty",
    };
    if (selectedAudio) {
      body.audioFormat = "mp3";
      delete body.videoQuality;
    }

    try {
      const res = await fetch(COBALT, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.code || `Server error ${res.status}`);
      }

      const data = await res.json();

      if (data.status === "redirect" || data.status === "tunnel") {
        triggerDownload(data.url);
        showStatus("✓ Download started! Check your downloads folder.", "ok");
      } else if (data.status === "picker") {
        /* playlist/multi — download first item */
        const first = data.picker?.[0];
        if (first?.url) {
          triggerDownload(first.url);
          showStatus("✓ Downloading first item. For playlists, paste each video link separately.", "ok");
        } else {
          throw new Error("No downloadable item found.");
        }
      } else {
        const code = data?.error?.code || "unknown_error";
        throw new Error(friendlyError(code));
      }
    } catch (e) {
      showStatus("⚠ " + (e.message || "Something went wrong. Try again."), "err");
    } finally {
      setLoading(false);
    }
  });

  /* ── helpers ── */
  function isYouTube(url) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
  }

  function triggerDownload(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function showStatus(html, type) {
    status.innerHTML = html;
    status.className = "status " + type;
  }

  function hideStatus() {
    status.className = "status hidden";
    status.innerHTML = "";
  }

  function setLoading(on) {
    dlBtn.disabled = on;
  }

  function friendlyError(code) {
    const map = {
      "error.api.link.invalid":          "That link doesn't look valid. Copy it directly from YouTube.",
      "error.api.link.unsupported":      "This video can't be downloaded (private, age-restricted, or region-blocked).",
      "error.api.fetch.empty":           "YouTube returned no video data. The video may be unavailable.",
      "error.api.content.too_long":      "Video is too long to download via this service.",
    };
    return map[code] || `Could not download: ${code}`;
  }
})();
