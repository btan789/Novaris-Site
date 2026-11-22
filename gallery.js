import { easeGlide, glideDuration, reducedMotion } from "./carousel-motion.js";
import { revealGallery } from "./gallery-loader.js?v=page-loader";

const grid = document.querySelector(".photo-grid");
const allPhotos = Array.from(grid.querySelectorAll("a"));
const filter = document.querySelector("#competition");
const summary = document.querySelector("#gallery-summary");
const viewer = document.querySelector(".photo-viewer");
const viewport = viewer.querySelector(".viewer-viewport");
const track = viewport.querySelector(".viewer-track");
const position = viewer.querySelector(".viewer-position");
const caption = viewer.querySelector(".viewer-caption p");
let photos = allPhotos;
let destination = 0;
let activeSlide;

revealGallery(grid.querySelectorAll("img[data-opening-preview]"));

function applyFilter() {
  const category = filter.value;
  for (const photo of allPhotos) {
    photo.hidden = category !== "" && photo.dataset.category !== category;
  }
  photos = allPhotos.filter(photo => !photo.hidden);
  summary.textContent = `${photos.length} photos`;
}

filter.addEventListener("change", applyFilter);
window.addEventListener("pageshow", applyFilter);
applyFilter();
filter.closest(".picker").hidden = false;

// Sample the Achievements curve for a native transform transition.
const stops = Array.from({ length: 41 }, (_, step) => easeGlide(step / 40).toFixed(5));
track.style.transitionTimingFunction = `linear(${stops.join(",")})`;
track.style.setProperty("--glide-duration", `${glideDuration}ms`);

function photoIndex(slot) {
  return ((slot % photos.length) + photos.length) % photos.length;
}

function slideAt(slot) {
  const existing = track.querySelector(`[data-slot="${slot}"]`);
  if (existing) return existing;
  const thumb = photos[photoIndex(slot)].querySelector("img");
  const image = new Image();
  image.className = "viewer-image";
  image.dataset.slot = slot;
  image.style.transform = `translateX(${slot * 100}%)`;
  image.setAttribute("aria-hidden", "true");
  image.alt = thumb.alt;
  image.src = thumb.currentSrc || thumb.src;
  track.append(image);
  return image;
}

function settle() {
  if (!activeSlide || Number(activeSlide.dataset.slot) !== destination) return;
  for (const slide of Array.from(track.children)) {
    if (Math.abs(Number(slide.dataset.slot) - destination) > 1) slide.remove();
  }
  slideAt(destination - 1);
  slideAt(destination + 1);
}

async function showPhoto(slot, glide = true) {
  if (reducedMotion.matches) glide = false;
  destination = slot;
  const index = photoIndex(slot);
  const image = slideAt(slot);
  const originalURL = photos[index].href;

  // Keep the outgoing photo visible while an uncached thumbnail is arriving.
  if (glide && !image.naturalWidth) {
    try { await image.decode(); } catch { /* Try the full image below. */ }
  }
  if (!viewer.open || destination !== slot || !image.isConnected) return;
  activeSlide?.setAttribute("aria-hidden", "true");
  activeSlide = image;
  image.removeAttribute("aria-hidden");
  position.textContent = `${index + 1} / ${photos.length}`;
  caption.textContent = photos[index].dataset.caption ?? "";
  caption.hidden = !caption.textContent;
  track.classList.toggle("is-gliding", glide);
  track.style.transform = `translateX(${-slot * 100}%)`;
  if (!glide) settle();

  if (image.src !== originalURL) {
    const original = new Image();
    original.src = originalURL;
    try {
      await original.decode();
    } catch {
      // Keep the thumbnail if the original is unavailable.
      return;
    }
    if (!image.isConnected) return;
    original.className = image.className;
    original.dataset.slot = image.dataset.slot;
    original.style.transform = image.style.transform;
    original.alt = image.alt;
    if (image === activeSlide) activeSlide = original;
    else original.setAttribute("aria-hidden", "true");
    image.replaceWith(original);
  }
}

track.addEventListener("transitionend", event => {
  if (event.target === track && event.propertyName === "transform") settle();
});
viewer.addEventListener("close", () => {
  if (viewer.open) return;
  track.classList.remove("is-gliding");
  track.replaceChildren();
  activeSlide = null;
});
grid.addEventListener("click", event => {
  const index = photos.indexOf(event.target.closest("a"));
  if (index < 0 || !viewer.showModal || event.button !== 0 ||
      event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  viewer.showModal();
  showPhoto(index, false);
});
for (const button of viewer.querySelectorAll("[data-step]")) {
  button.addEventListener("click", () => showPhoto(destination + Number(button.dataset.step)));
}
viewer.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  showPhoto(destination + (event.key === "ArrowLeft" ? -1 : 1));
});

let startTouch;
viewport.addEventListener("touchstart", event => {
  startTouch = event.touches.length === 1 ? event.touches[0] : null;
}, { passive: true });
viewport.addEventListener("touchcancel", () => { startTouch = null; });
viewport.addEventListener("touchend", event => {
  if (!startTouch) return;
  const end = event.changedTouches[0];
  const dx = end.clientX - startTouch.clientX;
  const dy = end.clientY - startTouch.clientY;
  startTouch = null;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    showPhoto(destination + (dx < 0 ? 1 : -1));
  }
}, { passive: true });
