(function () {
  const urlInput     = document.getElementById("url-input");
  const pasteBtn     = document.getElementById("paste-btn");
  const fetchBtn     = document.getElementById("fetch-btn");
  const errorMsg     = document.getElementById("error-msg");
  const loader       = document.getElementById("loader");
  const resultCard   = document.getElementById("result-card");
  const thumbnail    = document.getElementById("thumbnail");
  const videoTitle   = document.getElementById("video-title");
  const videoDuration= document.getElementById("video-duration");
  const formatList   = document.getElementById("format-list");
  const downloadBtn  = document.getElementById("download-btn");
  const dlStatus     = document.getElementById("download-status");

  let selectedFormat = null;

  function fmtDuration(secs) {
    if (!secs) return "";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove("hidden");
  }

  function clearError() {
    errorMsg.textContent = "";
    errorMsg.classList.add("hidden");
  }

  function setLoading(active) {
    loader.classList.toggle("hidden", !active);
    fetchBtn.disabled = active;
  }

  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      urlInput.value = text.trim();
      clearError();
    } catch {
      showError("Clipboard access denied — please paste manually.");
    }
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchBtn.click();
  });

  fetchBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) { showError("Please enter a YouTube URL."); return; }
    clearError();
    resultCard.classList.add("hidden");
    dlStatus.classList.add("hidden");
    selectedFormat = null;
    downloadBtn.disabled = true;
    setLoading(true);

    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error || "Failed to fetch video info."); return; }

      thumbnail.src = data.thumbnail || "";
      videoTitle.textContent = data.title || "Unknown title";
      videoDuration.textContent = data.duration ? `Duration: ${fmtDuration(data.duration)}` : "";

      formatList.innerHTML = "";
      (data.formats || []).forEach((fmt) => {
        const chip = document.createElement("button");
        chip.className = "format-chip";
        chip.textContent = fmt.label;
        if (fmt.filesize) {
          const mb = (fmt.filesize / 1048576).toFixed(1);
          chip.textContent += ` (~${mb} MB)`;
        }
        chip.dataset.formatId = fmt.format_id;
        chip.dataset.isAudio = fmt.label.includes("Audio") ? "1" : "0";
        chip.addEventListener("click", () => {
          document.querySelectorAll(".format-chip").forEach((c) => c.classList.remove("selected"));
          chip.classList.add("selected");
          selectedFormat = fmt;
          downloadBtn.disabled = false;
        });
        formatList.appendChild(chip);
      });

      resultCard.classList.remove("hidden");
    } catch (err) {
      showError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  });

  downloadBtn.addEventListener("click", async () => {
    if (!selectedFormat) return;
    const url = urlInput.value.trim();
    const isAudio = selectedFormat.label.includes("Audio");

    downloadBtn.disabled = true;
    dlStatus.textContent = "Preparing download… this may take a moment for longer videos.";
    dlStatus.classList.remove("hidden");

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          format_id: selectedFormat.format_id,
          is_audio: isAudio,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        dlStatus.textContent = data.error || "Download failed. Please try again.";
        return;
      }

      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : (isAudio ? "audio.mp3" : "video.mp4");

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      dlStatus.textContent = "Download started!";
    } catch (err) {
      dlStatus.textContent = "Network error during download. Please try again.";
    } finally {
      downloadBtn.disabled = false;
    }
  });
})();
