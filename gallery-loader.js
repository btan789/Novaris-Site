import { loadImages, showPageLoader } from "./page-loader.js?v=quicker-reveal";

function previewRequest(image) {
  const sources = image.dataset.openingPreview;
  const candidates = sources.split(",").map(candidate => {
    const [url, width] = candidate.trim().split(/\s+/);
    return { url, width: parseInt(width, 10) };
  });
  const tileWidth = image.clientWidth;
  const preferredWidth = tileWidth * window.devicePixelRatio;
  const chosen = candidates.find(candidate => candidate.width >= preferredWidth) ?? candidates.at(-1);
  return { image, sources, tileWidth, url: chosen.url };
}

export function revealGallery(images) {
  const previews = Array.from(images, previewRequest);
  return showPageLoader({
    content: document.querySelectorAll(".skip, .gallery-header, .gallery-main"),
    load: (signal, updateProgress) => loadImages(previews, signal, updateProgress),
    recover: () => {
      for (const { image, tileWidth, sources, url } of previews) {
        if (image.complete && image.naturalWidth) continue;
        image.sizes = `${tileWidth}px`;
        image.srcset = sources;
        image.src = url;
      }
    }
  });
}
