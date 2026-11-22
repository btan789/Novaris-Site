export async function loadImages(images, signal, updateProgress) {
  const responses = await Promise.all(images.map(async ({ url }) => {
    const response = await fetch(url, { signal, priority: "high" });
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response;
  }));
  const lengths = responses.map(response => Number(response.headers.get("Content-Length")));
  const total = lengths.every(length => length > 0) ? lengths.reduce((sum, length) => sum + length, 0) : 0;
  if (!total) updateProgress(null);

  let bytesRead = 0;
  await Promise.all(responses.map(async (response, index) => {
    const { image } = images[index];
    const reader = response.body.getReader();
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytesRead += value.byteLength;
        // Leave the final percent for image decoding and other opening assets.
        if (total) updateProgress(Math.min(99, bytesRead / total * 100));
      }
      signal.throwIfAborted();
      const type = response.headers.get("Content-Type") || "image/webp";
      const objectURL = URL.createObjectURL(new Blob(chunks, { type }));
      image.src = objectURL;
      try {
        await image.decode();
      } catch (error) {
        URL.revokeObjectURL(objectURL);
        throw error;
      }
    } finally {
      reader.releaseLock();
    }
  }));
}

export async function showPageLoader({ content, load, recover, beforeFade }) {
  const loader = document.querySelector(".page-loader");
  const logo = loader.querySelector(".page-loader-logo");
  const ring = loader.querySelector(".page-loader-fill");
  const percentage = loader.querySelector(".page-loader-percent");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const controller = new AbortController();
  const { signal } = controller;
  // Reveal the page after 4 s even if some opening assets are still loading.
  const timeout = setTimeout(() => controller.abort(), 4000);

  function updateProgress(progress) {
    if (signal.aborted) return;
    if (progress === null) {
      percentage.removeAttribute("aria-valuenow");
      percentage.textContent = "Loading…";
      return;
    }
    ring.style.strokeDashoffset = 100 - progress;
    const percent = Math.floor(progress);
    if (percentage.getAttribute("aria-valuenow") !== String(percent)) {
      percentage.setAttribute("aria-valuenow", percent);
      percentage.textContent = `${percent}%`;
    }
  }

  const sections = Array.from(content).filter(section => !section.inert);
  loader.hidden = false;
  for (const section of sections) section.inert = true;
  try {
    const deadline = new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    await Promise.race([load(signal, updateProgress), deadline]);
    clearTimeout(timeout);
    updateProgress(100);
    if (!reducedMotion) {
      await logo.animate([
        { transform: "scale(1)", filter: "drop-shadow(0 0 0 rgb(255 255 255 / 0))" },
        { transform: "scale(1.12)", filter: "drop-shadow(0 0 20px rgb(255 255 255 / .75))" }
      ], { duration: 200, easing: "cubic-bezier(.35, 0, .22, 1)", fill: "forwards" }).finished;
    }
  } catch {
    controller.abort();
    recover();
  } finally {
    clearTimeout(timeout);
    try {
      beforeFade?.();
      await loader.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reducedMotion ? 150 : 300,
        easing: "cubic-bezier(.42, 0, .2, 1)",
        fill: "forwards"
      }).finished;
    } finally {
      loader.hidden = true;
      for (const section of sections) section.inert = false;
    }
  }
}
