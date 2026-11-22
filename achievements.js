import { easeGlide, glideDuration, reducedMotion } from "./carousel-motion.js";

{
  const carousel = document.querySelector("#achievements");
  const track = carousel.querySelector(".achievement-track");
  const slides = [...track.children];
  const controls = carousel.querySelector(".achievement-controls");
  const dotsContainer = controls.querySelector(".achievement-dots");
  const playbackButton = controls.querySelector(".achievement-playback");
  const status = carousel.querySelector(".achievement-status");
  const titles = slides.map(slide => slide.querySelector("h3").textContent);
  const slideDuration = 10_000;

  // Add a snap point and a preview on each end so the wrap looks the same
  // immediately before and after jumping back to the matching real slide.
  function copySlide(slide, preview = false) {
    const copy = slide.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.removeAttribute("aria-labelledby");
    copy.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    if (preview) copy.dataset.preview = "";
    return copy;
  }

  track.prepend(copySlide(slides.at(-2), true), copySlide(slides.at(-1)));
  track.append(copySlide(slides[0]), copySlide(slides[1], true));

  const slots = [...track.children];
  const first = 2;
  const previousCopy = first - 1;
  const nextCopy = first + slides.length;
  let current = -1;
  let destination = null;
  let automaticSelection = false;
  let scrolling = false;
  let visible = false;
  let hovered = false;
  let touchPointer = null;
  let paused = false;
  let countdown;
  let glideFrame = 0;
  let paintFrame;
  let scrollTimer;

  const dots = titles.map((title, index) => {
    const dot = document.createElement("button");
    const fill = document.createElement("span");
    fill.className = "achievement-dot-fill playback-timer-fill";
    fill.setAttribute("aria-hidden", "true");
    dot.append(fill);
    dot.type = "button";
    dot.className = "achievement-dot";
    dot.setAttribute("aria-label", title);
    dot.setAttribute("aria-controls", track.id);
    dot.addEventListener("click", () => select(index));
    dotsContainer.append(dot);
    return dot;
  });

  function offset(slot) {
    const slide = slots[slot];
    return slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
  }

  let offsets = slots.map((_, i) => offset(i));

  function nearestSlot() {
    let closest = previousCopy;
    for (let slot = first; slot <= nextCopy; slot++) {
      if (Math.abs(offsets[slot] - track.scrollLeft) < Math.abs(offsets[closest] - track.scrollLeft)) {
        closest = slot;
      }
    }
    return closest;
  }

  function originalSlot(slot) {
    return first + (slot - first + slides.length) % slides.length;
  }

  function paintSlides() {
    paintFrame = undefined;
    const position = track.scrollLeft;
    const stride = offsets[first + 1] - offsets[first];
    if (!stride) return;
    slots.forEach((slide, i) => {
      const proximity = Math.max(0, 1 - Math.abs(offsets[i] - position) / stride);
      const focus = proximity * proximity * (3 - 2 * proximity);
      slide.style.setProperty("--slide-focus", focus.toFixed(3));
    });
  }

  function updateCountdown() {
    if (!countdown || countdown.playState === "finished") return;
    const focus = document.activeElement;
    const keyboardReading = focus !== playbackButton && focus !== carousel &&
      carousel.contains(focus) && focus.matches(":focus-visible");
    if (paused || hovered || touchPointer !== null || scrolling || !visible || document.hidden || keyboardReading) {
      if (countdown.playState === "running") countdown.pause();
    } else if (countdown.playState === "paused") {
      countdown.play();
    }
  }

  function startCountdown() {
    countdown?.cancel();
    const fill = dots[current].firstElementChild;
    // The visible fill is the timer. Pausing it also pauses the auto-advance.
    const animation = fill.animate(
      [{ "--playback-timer-progress": "0%" }, { "--playback-timer-progress": "108%" }],
      { duration: slideDuration, fill: "both" }
    );
    countdown = animation;
    animation.onfinish = () => {
      if (countdown === animation) step(1, true);
    };
    updateCountdown();
  }

  function showCurrent(slot, announce = true) {
    const index = originalSlot(slot) - first;
    if (index === current) return;
    current = index;
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-current", i === index);
      if (i === index) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", "true");
      if (i === index) dots[i].setAttribute("aria-current", "true");
      else dots[i].removeAttribute("aria-current");
    });
    status.textContent = announce ? `${titles[index]}, ${index + 1} of ${slides.length}` : "";
    startCountdown();
  }

  function settle() {
    if (glideFrame) return;
    destination = null;
    const slot = nearestSlot();
    const original = originalSlot(slot);
    if (slot !== original) track.scrollTo({ left: offsets[original], behavior: "instant" });
    scrolling = false;
    showCurrent(original, !automaticSelection);
    automaticSelection = false;
    if (countdown?.playState === "finished") startCountdown();
    updateCountdown();
  }

  function go(slot, automatic = false) {
    cancelAnimationFrame(glideFrame);
    glideFrame = 0;
    const start = track.scrollLeft;
    const left = offsets[slot];
    if (Math.abs(left - start) < 1) {
      track.classList.remove("is-sliding");
      settle();
      return;
    }
    destination = slot;
    automaticSelection = automatic;
    scrolling = true;
    updateCountdown();

    // Keep native snap for gestures and suspend it while the glide owns the position.
    track.classList.add("is-sliding");
    const startTime = performance.now();
    function glide(now) {
      const progress = reducedMotion.matches ? 1 : Math.max(0, Math.min(1, (now - startTime) / glideDuration));
      const eased = easeGlide(progress);
      track.scrollLeft = start + (left - start) * eased;
      if (progress < 1) {
        glideFrame = requestAnimationFrame(glide);
        return;
      }
      glideFrame = 0;
      track.classList.remove("is-sliding");
      settle();
    }
    glideFrame = requestAnimationFrame(glide);
  }

  function interruptGlide() {
    if (glideFrame) {
      cancelAnimationFrame(glideFrame);
      glideFrame = 0;
      track.classList.remove("is-sliding");
      scrolling = false;
    }
    destination = null;
    automaticSelection = false;
  }

  function step(direction, automatic = false) {
    let from = destination ?? nearestSlot();
    if (from + direction < previousCopy || from + direction > nextCopy) {
      from = originalSlot(from);
      track.scrollTo({ left: offsets[from], behavior: "instant" });
    }
    go(from + direction, automatic);
  }

  function select(index) {
    const from = destination ?? nearestSlot();
    const choices = [first + index];
    if (index === 0) choices.push(nextCopy);
    if (index === slides.length - 1) choices.push(previousCopy);
    go(choices.reduce((closest, slot) => Math.abs(slot - from) < Math.abs(closest - from) ? slot : closest));
  }

  for (const button of controls.querySelectorAll("[data-step]")) {
    button.addEventListener("click", () => step(Number(button.dataset.step)));
  }
  function setPaused(value) {
    paused = value;
    playbackButton.classList.toggle("is-paused", paused);
    playbackButton.setAttribute("aria-label", paused ? "Play slideshow" : "Pause slideshow");
    updateCountdown();
  }
  playbackButton.addEventListener("click", () => setPaused(!paused));
  // Visitors who ask for less motion start with the slideshow paused; they can still press play.
  setPaused(reducedMotion.matches);
  reducedMotion.addEventListener("change", () => setPaused(reducedMotion.matches));
  track.addEventListener("click", event => {
    if (window.getSelection()?.toString()) return;
    const slot = slots.indexOf(event.target.closest(".achievement-slide"));
    if (slot >= previousCopy && slot <= nextCopy && slot !== nearestSlot()) go(slot);
  });
  track.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse") return;
    hovered = true;
    updateCountdown();
  });
  track.addEventListener("pointerleave", () => {
    hovered = false;
    updateCountdown();
  });
  track.addEventListener("pointerdown", event => {
    interruptGlide();
    if (event.pointerType === "touch") touchPointer = event.pointerId;
    updateCountdown();
  });
  for (const type of ["pointerup", "pointercancel"]) {
    window.addEventListener(type, event => {
      if (event.pointerId !== touchPointer) return;
      touchPointer = null;
      updateCountdown();
    });
  }
  track.addEventListener("wheel", event => {
    if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    interruptGlide();
    updateCountdown();
  }, { passive: true });
  carousel.addEventListener("focusin", updateCountdown);
  carousel.addEventListener("focusout", () => queueMicrotask(updateCountdown));
  document.addEventListener("visibilitychange", updateCountdown);
  new IntersectionObserver(([entry]) => {
    visible = entry.intersectionRatio >= .5;
    updateCountdown();
  }, { threshold: .5 }).observe(track);
  carousel.addEventListener("keydown", event => {
    if (event.target === carousel || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    switch (event.key) {
      case "ArrowLeft": step(-1); break;
      case "ArrowRight": step(1); break;
      case "Home": select(0); break;
      case "End": select(slides.length - 1); break;
      default: return;
    }
    event.preventDefault();
  });

  const hasScrollEnd = "onscrollend" in track;
  if (hasScrollEnd) track.addEventListener("scrollend", settle);
  track.addEventListener("scroll", () => {
    scrolling = true;
    updateCountdown();
    if (paintFrame === undefined) paintFrame = requestAnimationFrame(paintSlides);
    if (!hasScrollEnd) {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(settle, 135);
    }
  }, { passive: true });

  track.scrollTo({ left: offsets[first], behavior: "instant" });
  paintSlides();
  showCurrent(first, false);
  track.classList.add("is-enhanced");
  controls.hidden = false;

  let width = track.clientWidth;
  new ResizeObserver(() => {
    if (track.clientWidth === width) return;
    width = track.clientWidth;
    offsets = slots.map((_, i) => offset(i));
    const slot = destination === null ? first + current : originalSlot(destination);
    const announce = !automaticSelection;
    interruptGlide();
    track.scrollTo({ left: offsets[slot], behavior: "instant" });
    scrolling = false;
    showCurrent(slot, announce);
    updateCountdown();
    paintSlides();
  }).observe(track);
}
