const competitions = [
  {
    id: "world-finals-2026",
    event: "2026 World Finals",
    code: "NV-45",
    car: "Redshift",
    summary: "Winner of the Fastest Car award at the 2026 STEM Racing World Finals in Singapore",
    image: { file: "redshift-side.webp", alt: "Side profile of Redshift, showing its low nose and raised rear wing." },
    reveal: { file: "redshift-reveal.mp4", start: 10.25, end: 48.75 }
  }
];

const selector = document.querySelector("#competition");
const carCard = document.querySelector(".car");
const carName = document.querySelector("#car-name");
const redshiftWordmark = carName.querySelector(".car-wordmark");
const carSummary = document.querySelector("#car-summary");
const carImage = document.querySelector("#car-image");
const carRender = document.querySelector(".car-render");
const carVideo = document.querySelector("#car-reveal");
const carFilmFrame = document.querySelector(".car-film-frame");
const carFilmContext = carFilmFrame.getContext("2d", { alpha: false });
const carFilmShade = carCard.querySelector(".car-film-shade");
const carRevealTimer = document.querySelector(".car-reveal-timer");
const hasVideoFrameCallback = typeof carVideo.requestVideoFrameCallback === "function";
const revealDelay = 5000;
const filmSampleWidth = 16;
const filmSampleHeight = 8;
const revealProgressSteps = 600;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const maxRevealFailures = 3;
let revealFailures = 0;
let revealFailed = false;
let revealSource;
let revealStart = 0;
let revealEnd = Infinity;
let revealInView = false;
let revealTimer;
let revealFrameRequest;
let revealPollTimer;
let lastRevealPaint = -Infinity;
let lastRevealProgressStep;
let nextFilmColorSample = 0;
let filmSampleContext;
selector.replaceChildren(...competitions.map(entry => new Option(entry.event, entry.id)));

function positionIndicator(indicator, control) {
  indicator.style.width = control.offsetWidth + "px";
  indicator.style.height = control.offsetHeight + "px";
  indicator.style.transform = `translate(${control.offsetLeft}px, ${control.offsetTop}px)`;
}

function showCompetition() {
  const entry = competitions.find(item => item.id === selector.value);
  document.querySelector("#car-code").textContent = entry.code;
  carName.replaceChildren(entry.car === redshiftWordmark?.alt ? redshiftWordmark : entry.car);
  carSummary.textContent = entry.summary;
  const source = "assets/" + entry.image.file;
  carImage.alt = entry.image.alt;
  carImage.src = source;
  carRender.style.setProperty("--car-render-image", `url("${source}")`);
  revealSource = entry.reveal ? "assets/" + entry.reveal.file : null;
  revealFailures = 0;
  revealFailed = false;
  revealStart = entry.reveal?.start ?? 0;
  revealEnd = entry.reveal?.end ?? Infinity;
  carVideo.setAttribute("aria-label", `${entry.car} car reveal`);
  if (carVideo.hasAttribute("src")) {
    carVideo.removeAttribute("src");
    carVideo.load();
  }
  queueCarReveal();
}

function filmBandColor(pixels, firstRow, lastRow) {
  let red = 0;
  let green = 0;
  let blue = 0;
  const firstPixel = firstRow * filmSampleWidth;
  const lastPixel = lastRow * filmSampleWidth;
  for (let pixel = firstPixel; pixel < lastPixel; pixel++) {
    const offset = pixel * 4;
    red += pixels[offset];
    green += pixels[offset + 1];
    blue += pixels[offset + 2];
  }
  const scale = 1 / Math.max(lastPixel - firstPixel, Math.max(red, green, blue) / 78);
  return `rgb(${Math.round(6 + red * scale)} ${Math.round(6 + green * scale)} ${Math.round(8 + blue * scale)})`;
}

function sampleFilmColors() {
  if (!canPlayCarReveal() || carVideo.paused || carVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (!filmSampleContext) {
    const canvas = document.createElement("canvas");
    canvas.width = filmSampleWidth;
    canvas.height = filmSampleHeight;
    filmSampleContext = canvas.getContext("2d", { willReadFrequently: true });
  }

  try {
    if (!filmSampleContext) {
      nextFilmColorSample = Infinity;
      return;
    }
    filmSampleContext.drawImage(carFilmContext ? carFilmFrame : carVideo, 0, 0, filmSampleWidth, filmSampleHeight);
    const { data } = filmSampleContext.getImageData(0, 0, filmSampleWidth, filmSampleHeight);
    carFilmShade.style.setProperty("--car-film-top", filmBandColor(data, 0, 2));
    carFilmShade.style.setProperty("--car-film-middle", filmBandColor(data, 2, 6));
    carFilmShade.style.setProperty("--car-film-bottom", filmBandColor(data, 6, filmSampleHeight));
  } catch {
    // The reveal still works if the browser cannot read video pixels.
    nextFilmColorSample = Infinity;
  }
}

// The canvas is shown with object-fit: cover, so a backing buffer at the displayed size
// (times the pixel ratio) looks identical to a full-resolution one at a fraction of the copy cost.
let filmDisplayWidth = 0;
let filmDisplayHeight = 0;
new ResizeObserver(([entry]) => {
  const box = entry.devicePixelContentBoxSize?.[0];
  filmDisplayWidth = box ? box.inlineSize : entry.contentRect.width * devicePixelRatio;
  filmDisplayHeight = box ? box.blockSize : entry.contentRect.height * devicePixelRatio;
}).observe(carVideo);

function paintRevealFrame() {
  if (!carFilmContext) return;
  const { videoWidth, videoHeight } = carVideo;
  const scale = filmDisplayWidth && filmDisplayHeight
    ? Math.min(1, Math.max(filmDisplayWidth / videoWidth, filmDisplayHeight / videoHeight))
    : 1;
  const width = Math.max(1, Math.round(videoWidth * scale));
  const height = Math.max(1, Math.round(videoHeight * scale));
  if (carFilmFrame.width !== width || carFilmFrame.height !== height) {
    carFilmFrame.width = width;
    carFilmFrame.height = height;
  }
  carFilmContext.drawImage(carVideo, 0, 0, width, height);
  if (carFilmFrame.hidden) {
    carFilmFrame.hidden = false;
    carVideo.classList.add("is-frame-source");
  }
}

function renderRevealFrame(now, mediaTime) {
  paintRevealFrame();
  const length = Math.min(carVideo.duration, revealEnd) - revealStart;
  const progress = Number.isFinite(length) && length > 0
    ? Math.max(0, Math.min(1, (mediaTime - revealStart) / length))
    : 0;
  // Each step moves the gradient by about a quarter of a CSS pixel at its widest.
  const step = Math.round(progress * revealProgressSteps);
  if (step !== lastRevealProgressStep) {
    carRevealTimer.style.setProperty("--playback-timer-progress", `${step * 108 / revealProgressSteps}%`);
    lastRevealProgressStep = step;
  }
  showRevealFrame(true);
  lastRevealPaint = now;
  if (now >= nextFilmColorSample) {
    nextFilmColorSample = now + 200;
    sampleFilmColors();
  }
}

function stopRevealPolling() {
  if (revealPollTimer === undefined) return;
  window.clearTimeout(revealPollTimer);
  revealPollTimer = undefined;
}

function showRevealFrame(show) {
  if (!show) {
    if (revealFrameRequest !== undefined) {
      carVideo.cancelVideoFrameCallback(revealFrameRequest);
      revealFrameRequest = undefined;
    }
    stopRevealPolling();
    lastRevealPaint = -Infinity;
    nextFilmColorSample = 0;
  }
  if (carCard.classList.contains("is-showing-reveal") === show) return;
  carCard.classList.toggle("is-showing-reveal", show);
  carVideo.setAttribute("aria-hidden", String(!show));
}

function canPlayCarReveal() {
  return revealSource && !revealFailed && !reducedMotion.matches && revealInView && !document.hidden &&
    !document.documentElement.classList.contains("is-site-loading");
}

function canShowRevealFrame() {
  return canPlayCarReveal() && !carVideo.paused && !carVideo.seeking &&
    carVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && carVideo.videoWidth > 0 &&
    carVideo.currentTime >= revealStart && carVideo.currentTime < revealEnd;
}

function waitForRevealFrame() {
  if (!canShowRevealFrame() || revealFrameRequest !== undefined) return;
  if (!hasVideoFrameCallback) {
    if (revealPollTimer === undefined) pollRevealFrames();
    return;
  }

  // Copy the frame after the video supplies it instead of on every display refresh.
  revealFrameRequest = carVideo.requestVideoFrameCallback((now, { mediaTime }) => {
    revealFrameRequest = undefined;
    if (!canShowRevealFrame()) return;
    stopRevealPolling();
    renderRevealFrame(now, mediaTime);
    waitForRevealFrame();
  });
}

function pollRevealFrames() {
  revealPollTimer = undefined;
  if (!canShowRevealFrame()) return;
  renderRevealFrame(performance.now(), carVideo.currentTime);
  revealPollTimer = window.setTimeout(pollRevealFrames, 1000 / 60);
}

function queueCarReveal() {
  window.clearTimeout(revealTimer);
  carVideo.pause();
  showRevealFrame(false);
  if (!canPlayCarReveal()) return;

  if (!carVideo.hasAttribute("src")) carVideo.src = revealSource;
  revealTimer = window.setTimeout(() => {
    if (!canPlayCarReveal()) return;
    // Delay the seek until playback is about to start so it does no work offscreen.
    carVideo.currentTime = revealStart;
    carVideo.play().catch(() => {
      if (carVideo.paused) showRevealFrame(false);
    });
  }, revealDelay);
}

carVideo.addEventListener("playing", waitForRevealFrame);
carVideo.addEventListener("seeked", waitForRevealFrame);
carVideo.addEventListener("timeupdate", () => {
  if (carVideo.paused || carVideo.seeking) return;
  if (carVideo.currentTime >= revealEnd) {
    queueCarReveal();
  } else if (canShowRevealFrame() && carVideo.currentTime > revealStart) {
    waitForRevealFrame();
    // Some browsers stop sending callbacks when the canvas covers the video.
    if (revealPollTimer === undefined && performance.now() - lastRevealPaint >= 200) {
      pollRevealFrames();
    }
  }
});
carVideo.addEventListener("ended", queueCarReveal);
carVideo.addEventListener("pause", () => showRevealFrame(false));
carVideo.addEventListener("seeking", () => showRevealFrame(false));
carVideo.addEventListener("waiting", () => showRevealFrame(false));
carVideo.addEventListener("error", () => {
  if (!carVideo.error) return;
  // Keep the configured source so a later entrance can try again; show the still until then.
  revealFailures++;
  revealFailed = true;
  carVideo.removeAttribute("src");
  carVideo.load();
  queueCarReveal();
});
document.addEventListener("visibilitychange", queueCarReveal);
document.addEventListener("site:ready", queueCarReveal, { once: true });
reducedMotion.addEventListener("change", queueCarReveal);
new IntersectionObserver(([entry]) => {
  const inView = revealInView ? entry.isIntersecting : entry.intersectionRatio >= .15;
  if (inView === revealInView) return;
  revealInView = inView;
  // Each new entrance allows another attempt, up to a limit.
  if (inView && revealFailures < maxRevealFailures) revealFailed = false;
  queueCarReveal();
}, { threshold: [0, .15] }).observe(carRender);

selector.addEventListener("change", showCompetition);
showCompetition();

const hero = document.querySelector(".hero");

function easeScrollFade(value) {
  const progress = Math.max(0, Math.min(1, value));
  return progress ** 2 * (3 - 2 * progress);
}

// Measuring and applying are split so the scroll handler can do every layout read
// (here and in updateNavigation) before any style write, avoiding forced layouts.
function measureScrollFades() {
  const { top, height } = hero.getBoundingClientRect();
  if (!height) return null;

  const heroExit = -top / height;
  const { scrollHeight, clientHeight, scrollTop } = document.scrollingElement;
  const fromBottom = scrollHeight - clientHeight - scrollTop;
  const bottomFadeDistance = Math.min(240, clientHeight * .3);
  // Rounded so tiny scroll steps don't restyle the page when the change is invisible.
  return {
    opacity: (1 - easeScrollFade((heroExit - .06) / .88)).toFixed(3),
    vignette: easeScrollFade(Math.min((heroExit - .22) / .43, fromBottom / bottomFadeDistance)).toFixed(3)
  };
}

function applyScrollFades(fades) {
  if (!fades) return;
  if (hero.style.getPropertyValue("--hero-opacity") !== fades.opacity) {
    hero.style.setProperty("--hero-opacity", fades.opacity);
  }
  if (document.body.style.getPropertyValue("--vignette-opacity") !== fades.vignette) {
    document.body.style.setProperty("--vignette-opacity", fades.vignette);
  }
}

function updateScrollFades() {
  applyScrollFades(measureScrollFades());
}

const headerBar = document.querySelector(".bar");
const headerSlot = headerBar.parentElement;
const barSurface = headerBar.querySelector(".bar-surface");
const navigation = headerBar.querySelector("nav");
const navIndicator = navigation.querySelector(".nav-indicator");
const navLinks = Array.from(navigation.querySelectorAll("a"));
const navSections = navLinks.map(link => ({ link, section: document.getElementById(link.hash.slice(1)) })).reverse();
const brandIcon = headerBar.querySelector(".brand img");
const barLabels = Array.from(headerBar.querySelectorAll(".bar-label"));
const footerDock = document.querySelector(".footer-dock");
const pageFooter = footerDock.parentElement;
const finishLineScene = document.getElementById("finish-line");
const partnersSection = document.getElementById("partners");
const homeLink = headerBar.querySelector(".brand");
const movingParts = [barSurface, brandIcon, ...navLinks];
const textWaveStyle = getComputedStyle(document.documentElement);
const labelFadeDuration = parseFloat(textWaveStyle.getPropertyValue("--bar-label-fade-duration")) || 140;
const labelWaveDuration = parseFloat(textWaveStyle.getPropertyValue("--text-wave-duration")) || 780;
const labelRevealEasing = textWaveStyle.getPropertyValue("--text-wave-easing").trim() || "cubic-bezier(.4, 0, .25, 1)";
let dockAnimations = [];
let fadingLabels = [];
let pendingDock = null;
let dockTimer;
let currentSectionLink = homeLink;
let hoveredNavLink = null;
let sectionScrollDock = null;
let restoringNavigation = true;
let indicatorReveal;
let indicatorLink;

function syncNavigationIndicatorReveal(label) {
  const labelAnimations = pendingDock === null ? dockAnimations : fadingLabels;
  const labelAnimation = label && labelAnimations.find(animation =>
    animation.effect.target === label && animation.playState === "running");
  if (indicatorReveal?.labelAnimation === labelAnimation) return;

  const outgoingOpacity = pendingDock !== null ? getComputedStyle(navIndicator).opacity : null;
  indicatorReveal?.animation.cancel();
  navIndicator.classList.toggle("is-revealing", !!labelAnimation);
  indicatorReveal = undefined;
  if (!labelAnimation) return;

  // Follow the label's timing even when hover or focus changes during the reveal.
  const { effect, startTime } = labelAnimation;
  const keyframes = effect.getKeyframes();
  if (outgoingOpacity !== null) keyframes[0].opacity = outgoingOpacity;
  const animation = navIndicator.animate(keyframes, effect.getTiming());
  if (startTime !== null) animation.startTime = startTime;
  indicatorReveal = { labelAnimation, animation };
  animation.addEventListener("finish", updateNavigationIndicator, { once: true });
}

function fadeDepartingIndicator(sync) {
  const style = getComputedStyle(navIndicator);
  const opacity = Number(style.opacity);
  if (!indicatorLink || opacity === 0) return;

  const badgeBounds = navIndicator.getBoundingClientRect();
  const linkBounds = indicatorLink.getBoundingClientRect();
  // Follow the link through its layout change while the outgoing highlight fades.
  const badge = navIndicator.cloneNode(false);
  badge.className = "nav-indicator is-departing";
  Object.assign(badge.style, {
    top: `${badgeBounds.top - linkBounds.top - indicatorLink.clientTop}px`,
    left: `${badgeBounds.left - linkBounds.left - indicatorLink.clientLeft}px`,
    width: `${badgeBounds.width}px`,
    height: `${badgeBounds.height}px`,
    transform: "none",
    borderRadius: style.borderRadius,
    mask: style.mask
  });
  indicatorLink.append(badge);
  const animation = badge.animate([{ opacity }, { opacity: 0 }], {
    duration: Math.min(labelFadeDuration, sync.duration),
    easing: "ease-out"
  });
  animation.startTime = sync.startTime;
  animation.addEventListener("finish", () => badge.remove(), { once: true });
}

function updateNavigationIndicator() {
  const focusedLink = navigation.querySelector("a:focus-visible");
  const target = hoveredNavLink ?? focusedLink ?? navigation.querySelector("a[aria-current]");
  const travelling = pendingDock !== null || dockAnimations[0]?.playState === "running";
  const visible = !!target && !travelling;
  if (visible) {
    indicatorLink = target;
    const hidden = Number(getComputedStyle(navIndicator).opacity) === 0;
    navIndicator.classList.toggle("is-positioning", hidden);
    positionIndicator(navIndicator, target);
    if (hidden) {
      // Place a hidden highlight under its first link before fading it in.
      getComputedStyle(navIndicator).getPropertyValue("transform");
      navIndicator.classList.remove("is-positioning");
    }
  }
  const fadingLink = pendingDock !== null && Number(getComputedStyle(navIndicator).opacity) > 0
    ? indicatorLink : undefined;
  syncNavigationIndicatorReveal((visible ? target : fadingLink)?.querySelector(".bar-label"));
  navIndicator.classList.toggle("is-visible", visible);
}

function releaseTopDock() {
  if (!headerBar.classList.contains("is-pinned-top")) return;
  headerBar.classList.remove("is-pinned-top");
  headerBar.style.removeProperty("--top-dock-inset");
}

function moveNavigationDock(dock, animate, sync) {
  const previousDock = headerBar.dataset.dock ?? "top";
  if (previousDock === dock) return;

  headerBar.classList.remove("is-introducing");
  const origins = animate ? movingParts.map(part => part.getBoundingClientRect()) : [];
  const originRadius = animate ? parseFloat(getComputedStyle(barSurface).borderTopLeftRadius) : 0;
  const labelOpacities = sync && new Map(barLabels.filter(label => label.getClientRects().length)
    .map(label => [label, getComputedStyle(label).opacity]));
  navigation.querySelector(".nav-indicator.is-departing")?.remove();
  if (sync) {
    if (previousDock !== "side") fadeDepartingIndicator(sync);
    syncNavigationIndicatorReveal(undefined);
    navIndicator.classList.add("is-positioning");
    navIndicator.classList.remove("is-visible");
    getComputedStyle(navIndicator).opacity;
    navIndicator.classList.remove("is-positioning");
  }
  for (const animation of dockAnimations) animation.cancel();
  dockAnimations = [];
  hoveredNavLink = null;
  releaseTopDock();
  if (dock !== "footer") footerDock.classList.remove("is-pinned");
  if (dock === "top") delete headerBar.dataset.dock;
  else headerBar.dataset.dock = dock;

  const slot = dock === "footer" ? footerDock : headerSlot;
  if (headerBar.parentElement !== slot) {
    if (slot.moveBefore) slot.moveBefore(headerBar, null);
    else {
      const focused = headerBar.contains(document.activeElement) ? document.activeElement : null;
      slot.append(headerBar);
      focused?.focus({ preventScroll: true });
    }
  }
  if (!animate) {
    updateNavigationIndicator();
    return;
  }

  if (dock === "top" && sync) {
    // Hold the header at its final viewport position while the page scrolls underneath it.
    const topInset = headerBar.getBoundingClientRect().top + window.scrollY;
    headerBar.style.setProperty("--top-dock-inset", `${topInset}px`);
    headerBar.classList.add("is-pinned-top");
  }
  const destinations = movingParts.map(part => part.getBoundingClientRect());
  const destinationRadius = parseFloat(getComputedStyle(barSurface).borderTopLeftRadius);
  // A section link can jump past the entire header between scroll events.
  let verticalOffset = 0;
  if (previousDock === "top" && origins[0].bottom <= 0) {
    verticalOffset = 12 - origins[0].top;
  } else if (previousDock === "footer" && origins[0].top >= window.innerHeight) {
    verticalOffset = window.innerHeight - 12 - origins[0].bottom;
  }
  const timing = {
    duration: sync?.duration ?? 760,
    easing: "cubic-bezier(.42, 0, .16, 1)"
  };

  dockAnimations = movingParts.map((part, index) => {
    const from = origins[index];
    const to = destinations[index];
    const start = { transform: `translate(${from.left - to.left}px, ${from.top - to.top + verticalOffset}px)` };
    const end = { transform: "translate(0, 0)" };
    if (part === barSurface) {
      Object.assign(start, {
        width: from.width + "px",
        height: from.height + "px",
        borderRadius: Math.min(originRadius, from.width / 2, from.height / 2) + "px"
      });
      Object.assign(end, {
        width: to.width + "px",
        height: to.height + "px",
        borderRadius: Math.min(destinationRadius, to.width / 2, to.height / 2) + "px"
      });
    }
    return part.animate([start, end], timing);
  });
  dockAnimations[0].addEventListener("finish", updateNavigationIndicator, { once: true });
  const visibleLabels = barLabels.filter(label => label.getClientRects().length);
  const wave = dock !== "side";
  const revealDuration = wave ? labelWaveDuration : 180;
  for (const [index, label] of visibleLabels.entries()) {
    const revealFrom = wave ? { opacity: 0, maskPosition: "100% 100%" } : { opacity: 0 };
    const revealTo = wave ? { opacity: 1, maskPosition: "0% 0%" } : { opacity: 1 };
    const revealDelay = timing.duration + (wave ? 32 * index : 0);
    if (sync) {
      const duration = revealDelay + revealDuration;
      const fadeEnd = Math.min(labelFadeDuration, timing.duration) / duration;
      dockAnimations.push(label.animate([
        { ...revealTo, opacity: labelOpacities.get(label) ?? 0, easing: "ease-out" },
        { ...revealTo, opacity: 0, offset: fadeEnd },
        { ...revealFrom, offset: revealDelay / duration, easing: labelRevealEasing },
        revealTo
      ], duration));
    } else {
      dockAnimations.push(label.animate([revealFrom, revealTo], {
        duration: revealDuration,
        delay: revealDelay,
        easing: labelRevealEasing,
        fill: "backwards"
      }));
    }
  }
  if (sync) {
    // The bar's movement shares the page's timeline.
    for (const animation of dockAnimations) animation.startTime = sync.startTime;
    updateNavigationIndicator();
  }
}

function setNavigationDock(dock, animate, sync) {
  const currentDock = headerBar.dataset.dock ?? "top";
  if (sync || !animate || dock === currentDock) {
    if (pendingDock !== null) {
      window.clearTimeout(dockTimer);
      pendingDock = null;
      for (const fade of fadingLabels) {
        if (animate && !sync) {
          fade.reverse();
          fade.addEventListener("finish", () => fade.cancel(), { once: true });
        } else {
          fade.cancel();
        }
      }
      fadingLabels = [];
      updateNavigationIndicator();
    }
    if (sync || !animate) moveNavigationDock(dock, animate, sync);
    return;
  }
  if (pendingDock !== null) {
    pendingDock = dock;
    return;
  }

  pendingDock = dock;
  fadingLabels = barLabels.filter(label => label.getClientRects().length).map(label => label.animate([
    { opacity: getComputedStyle(label).opacity },
    { opacity: 0 }
  ], { duration: labelFadeDuration, easing: "ease-out", fill: "forwards" }));
  updateNavigationIndicator();
  dockTimer = window.setTimeout(() => {
    const destination = pendingDock;
    pendingDock = null;
    for (const fade of fadingLabels) fade.cancel();
    fadingLabels = [];
    moveNavigationDock(destination, true);
  }, labelFadeDuration);
}

function footerDockFits(scrollDelta = 0) {
  return pageFooter.getBoundingClientRect().top - scrollDelta <= window.innerHeight - footerDock.offsetHeight;
}

function footerDockReady() {
  return !footerDock.hasAttribute("data-finish-line-pending");
}

function headerIsLeaving() {
  const headerBounds = headerSlot.getBoundingClientRect();
  return headerBounds.bottom <= headerBounds.height * 0.55;
}

function updateNavigation(animateDock = false) {
  const viewportHeight = window.innerHeight;
  // finish-line.js always marks its scene as sequenced and owns when the footer dock pins,
  // so a pinned dock simply stays pinned.
  const keepPinned = footerDock.classList.contains("is-pinned");
  const footerVisible = footerDock.getBoundingClientRect().top <= viewportHeight - 40;
  const footerInView = footerDockReady() &&
    (keepPinned || (footerVisible && (!sectionScrollDock || headerBar.dataset.dock === "footer")));
  let dock = !headerIsLeaving() ? "top" : footerInView ? "footer" : "side";
  if (sectionScrollDock === "top" || sectionScrollDock === "side") dock = headerBar.dataset.dock ?? "top";
  else if (dock === "top") releaseTopDock();

  const footerBounds = pageFooter.getBoundingClientRect();
  // A short footer can be fully visible before its top crosses the viewport midpoint.
  const footerIsCurrent = footerBounds.top <= viewportHeight / 2 || footerBounds.bottom <= viewportHeight + 1;
  let nextLink = null;
  if (!footerIsCurrent) {
    const sectionLine = footerInView ? viewportHeight : viewportHeight / 2;
    const currentSection = navSections.find(({ section }) => section.getBoundingClientRect().top <= sectionLine);
    nextLink = currentSection?.link ?? homeLink;
  }

  setNavigationDock(dock, animateDock);
  if (nextLink !== currentSectionLink) {
    currentSectionLink?.removeAttribute("aria-current");
    nextLink?.setAttribute("aria-current", "location");
    currentSectionLink = nextLink;
    updateNavigationIndicator();
  }
}

const navResizeObserver = new ResizeObserver(updateNavigationIndicator);
for (const link of navLinks) {
  link.addEventListener("pointerenter", event => {
    if (event.pointerType === "touch") return;
    hoveredNavLink = link;
    updateNavigationIndicator();
  });
  navResizeObserver.observe(link);
}
navigation.addEventListener("pointerleave", () => {
  hoveredNavLink = null;
  updateNavigationIndicator();
});
navigation.addEventListener("focusin", updateNavigationIndicator);
navigation.addEventListener("focusout", () => queueMicrotask(updateNavigationIndicator));
headerBar.addEventListener("animationend", event => {
  if (event.target === barSurface && event.animationName === "bar-surface-reveal") {
    headerBar.classList.remove("is-introducing");
  }
});
window.addEventListener("scroll", () => {
  const fades = measureScrollFades();
  updateNavigation(!restoringNavigation);
  applyScrollFades(fades);
}, { passive: true });
footerDock.addEventListener("finish-line:reveal-change", ({ detail: timing }) => {
  if (timing && sectionScrollDock !== "side" && sectionScrollDock !== "top") {
    footerDock.classList.add("is-pinned");
    setNavigationDock("footer", true, timing);
  }
  updateNavigation(!restoringNavigation);
});
window.addEventListener("resize", () => {
  updateScrollFades();
  updateNavigation();
});
window.addEventListener("pagehide", () => {
  restoringNavigation = true;
});
window.addEventListener("pageshow", () => {
  // Let the browser restore its scroll position before animating dock changes.
  window.requestAnimationFrame(() => {
    updateScrollFades();
    updateNavigation();
    restoringNavigation = false;
  });
});
const scrollFadeObserver = new ResizeObserver(updateScrollFades);
scrollFadeObserver.observe(hero);
scrollFadeObserver.observe(document.body);
const navigationType = performance.getEntriesByType("navigation")[0]?.type;
const initialSection = navSections.find(({ link }) => link.hash === location.hash)?.section;
if (navigationType === "navigate" && initialSection && window.scrollY === 0) {
  // Dock against the destination before the browser dispatches its fragment scroll.
  initialSection.scrollIntoView({ behavior: "instant" });
}
updateScrollFades();
updateNavigation();

let sectionScrollFrame = 0;
let sectionScrollClock;
let wheelScrollFrame = 0;
let wheelMotion;

function cancelSectionScroll() {
  const approachingFooter = sectionScrollDock === "footer";
  window.cancelAnimationFrame(sectionScrollFrame);
  sectionScrollClock?.cancel();
  sectionScrollClock = null;
  sectionScrollDock = null;
  if (approachingFooter || headerBar.classList.contains("is-pinned-top")) updateNavigation(true);
}

function cancelWheelScroll() {
  window.cancelAnimationFrame(wheelScrollFrame);
  wheelScrollFrame = 0;
  wheelMotion = undefined;
}

function cancelScrollMotion() {
  cancelWheelScroll();
  cancelSectionScroll();
}

function advanceWheelScroll(now) {
  const motion = wheelMotion;
  if (Math.abs(window.scrollY - motion.lastScroll) > 1) {
    cancelWheelScroll();
    return;
  }

  const root = document.scrollingElement;
  const bottom = root.scrollHeight - root.clientHeight;
  motion.target = Math.min(bottom, motion.target);
  const step = 16 * Math.max(0, now - motion.time) / 1000;
  motion.time = Math.max(motion.time, now);
  const decay = Math.exp(-step);
  const leadError = motion.lead - motion.target;
  const followError = motion.follow - motion.target;
  const positionError = motion.position - motion.target;
  // Cascade three easing stages so a new wheel input preserves both speed and acceleration.
  motion.lead = Math.min(bottom, motion.target + leadError * decay);
  motion.follow = Math.min(bottom, motion.target + (followError + leadError * step) * decay);
  motion.position = Math.min(bottom, motion.target +
    (positionError + followError * step + leadError * step ** 2 / 2) * decay);

  const settled = Math.max(Math.abs(motion.lead - motion.target), Math.abs(motion.follow - motion.target),
    Math.abs(motion.position - motion.target)) < .5;
  window.scrollTo({ top: settled ? motion.target : motion.position, behavior: "instant" });
  motion.lastScroll = window.scrollY;
  if (settled) cancelWheelScroll();
  else wheelScrollFrame = window.requestAnimationFrame(advanceWheelScroll);
}

function handleWheelScroll(event) {
  if (reducedMotion.matches || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.target.closest?.("dialog, select, textarea, [contenteditable]")) {
    cancelWheelScroll();
    return;
  }

  const root = document.scrollingElement;
  const bottom = root.scrollHeight - root.clientHeight;
  const y = window.scrollY;
  const mode = event.deltaMode;
  const unit = mode === WheelEvent.DOM_DELTA_LINE ? (parseFloat(getComputedStyle(document.body).lineHeight) || 24)
    : mode === WheelEvent.DOM_DELTA_PAGE ? root.clientHeight : 1;
  // Match the native scroll distance; the smoothing only changes how the page gets there.
  const delta = event.deltaY * unit;
  cancelSectionScroll();
  if (wheelMotion && Math.abs(y - wheelMotion.lastScroll) > 1) cancelWheelScroll();

  // A reversal replaces any distance still queued in the old direction.
  const position = wheelMotion?.position ?? y;
  const previousTarget = wheelMotion?.target ?? y;
  const origin = (previousTarget - position) * delta < 0 ? position : previousTarget;
  const target = Math.max(0, Math.min(bottom, origin + delta));
  if (delta > 0) {
    finishLineScene.dispatchEvent(new CustomEvent("finish-line:wheel-input", {
      detail: { distance: delta, reachesBottom: target >= bottom }
    }));
  }
  if (!wheelMotion && (delta < 0 ? y <= 0 : y >= bottom)) return;

  event.preventDefault();
  wheelMotion ??= { position: y, target, lead: y, follow: y, time: performance.now(), lastScroll: y };
  wheelMotion.target = target;
  if (!wheelScrollFrame) wheelScrollFrame = window.requestAnimationFrame(advanceWheelScroll);
}

function scrollToSection(section) {
  cancelScrollMotion();
  const root = document.scrollingElement;
  const start = window.scrollY;
  const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
  const maxScroll = root.scrollHeight - root.clientHeight;
  const destination = Math.max(0, Math.min(maxScroll, start + section.getBoundingClientRect().top - margin));
  const distance = destination - start;
  const travel = Math.abs(distance);
  // Move focus now, not when the glide ends: a key press or touch can cancel the glide,
  // and keyboard users would otherwise be left on the link they activated.
  section.focus({ preventScroll: true });
  if (travel < 1) return;

  const startDock = headerBar.dataset.dock ?? "top";
  const toPartners = section === partnersSection;
  const toFooter = toPartners && footerDockFits(distance);
  const fromSectionToPartners = toPartners && startDock === "side" &&
    currentSectionLink && currentSectionLink !== homeLink && currentSectionLink.hash !== "#partners";
  // Give each section's trip to Partners at least the time it takes to return to the hero.
  const pacingDistance = fromSectionToPartners ? Math.max(start, travel) : travel;
  // Under reduced motion the trip completes on the next frame, which still runs the dock hand-offs.
  const duration = reducedMotion.matches ? 1 : Math.min(1540, 590 + pacingDistance * .37);
  const clock = new Animation(new KeyframeEffect(null, [], {
    duration,
    easing: "cubic-bezier(.35, 0, .27, 1)",
    fill: "forwards"
  }), document.timeline);
  sectionScrollClock = clock;
  const fromFooter = startDock === "footer";
  if (toFooter) {
    sectionScrollDock = "footer";
  } else if (section === document.body && startDock !== "top") {
    sectionScrollDock = "top";
  } else if (startDock !== "side" && navSections.some(entry => entry.section === section)) {
    sectionScrollDock = "side";
  }
  clock.play();

  let lastScroll = start;
  let dockAtPartners = sectionScrollDock === "footer";
  let dockAtTop = sectionScrollDock === "top";
  let dockAtSide = sectionScrollDock === "side" || (fromFooter && dockAtTop);
  const secondPhaseStart = duration * .42;
  function advance() {
    if (Math.abs(window.scrollY - lastScroll) > 1) {
      cancelSectionScroll();
      return;
    }

    const elapsed = clock.currentTime ?? 0;
    const startTime = clock.startTime + elapsed;
    const remaining = Math.max(0, duration - elapsed);
    if (dockAtSide && elapsed > 0) {
      dockAtSide = false;
      // Capture the bar's on-screen position before the page starts moving.
      const sideDuration = dockAtTop ? Math.max(0, secondPhaseStart - elapsed) : remaining;
      setNavigationDock("side", true, { startTime, duration: sideDuration });
    }
    if (dockAtTop && elapsed > 0 && (!fromFooter || elapsed >= secondPhaseStart)) {
      dockAtTop = false;
      setNavigationDock("top", true, { startTime, duration: remaining });
    }

    const progress = clock.effect.getComputedTiming().progress ?? 0;
    window.scrollTo({ top: start + distance * progress, behavior: "instant" });
    lastScroll = window.scrollY;
    // The finish-line sequence (always present on this page) pins the footer dock itself,
    // so this trip only needs to move the bar aside while it leaves the hero.
    if (dockAtPartners && elapsed > 0 && elapsed < secondPhaseStart &&
        !headerBar.dataset.dock && headerIsLeaving()) {
      setNavigationDock("side", true, { startTime, duration: secondPhaseStart - elapsed });
    }
    if (progress < 1) {
      sectionScrollFrame = window.requestAnimationFrame(advance);
    } else {
      cancelSectionScroll();
    }
  }
  sectionScrollFrame = window.requestAnimationFrame(advance);
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const link = event.target.closest('a[href^="#"]');
  if (!link || link.target || link.hasAttribute("download")) return;
  const section = document.getElementById(link.hash.slice(1));
  if (!section) return;

  event.preventDefault();
  if (location.hash !== link.hash) history.pushState(null, "", link.hash);
  scrollToSection(section);
});
window.addEventListener("wheel", handleWheelScroll, { passive: false });
window.addEventListener("pointerdown", cancelWheelScroll, { passive: true });
window.addEventListener("touchstart", cancelScrollMotion, { passive: true });
window.addEventListener("popstate", cancelScrollMotion);
window.addEventListener("keydown", event => {
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelScrollMotion();
});
