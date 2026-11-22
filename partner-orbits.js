import { createOrbitFlight, preloadFlightArt } from "./partner-flight.js?v=planet-hover";

const orbitRampDuration = 1200;
const orbitSteps = 72;
// Integral of smoothstep, so the same ramp works smoothly at any frame rate.
const easedOrbitTime = progress => progress ** 3 * (1 - progress / 2);

(() => {
  const system = document.querySelector(".solar-system");
  if (!system || !Element.prototype.animate || !CSS.supports("width", "1cqw")) return;

  const map = system.querySelector(".solar-map");
  const playback = system.querySelector(".orbit-playback");
  const inspector = system.querySelector(".planet-inspector");
  const description = inspector.querySelector("#planet-description");
  const website = inspector.querySelector(".planet-website");
  const tiers = [...map.querySelectorAll(".partner-tier")];
  const keys = [...system.querySelectorAll(".orbit-key")];
  const orbits = {
    title: { period: 100, start: .075 },
    principal: { period: 155, start: .16 },
    technical: { period: 210, start: .283 }
  };
  let sprite = 0;
  const orbitPaths = tiers.map(tier => {
    const { period, start } = orbits[tier.dataset.tier];
    tier.style.setProperty("--period", period + "s");
    const grid = tier.querySelector(".partner-grid");
    const planets = Array.from(grid.children).map((planet, index, group) => {
      const original = planet.querySelector(".partner-logo");
      const logo = document.createElement("button");
      logo.type = "button";
      logo.className = "partner-logo";
      logo.dataset.sprite = sprite;
      logo.title = original.querySelector("img").alt;
      logo.setAttribute("aria-label", logo.title);
      logo.setAttribute("aria-haspopup", "dialog");
      logo.setAttribute("aria-controls", inspector.id);
      if (original.href) logo.dataset.website = original.href;
      const visual = document.createElement("span");
      visual.className = "planet-visual";
      const mark = document.createElement("span");
      mark.className = "planet-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.append(...original.querySelectorAll("img"));
      visual.append(mark);
      logo.append(visual);
      original.replaceWith(logo);
      planet.style.setProperty("--sprite-index", sprite);
      planet.style.setProperty("--sprite-x", (sprite % 5) * 25 + "%");
      planet.style.setProperty("--sprite-y", Math.floor(sprite / 5) * 50 + "%");
      sprite++;
      return { element: planet, delay: -(start + index / group.length) * period * 1000 };
    });
    return { grid, planets, duration: period * 1000 };
  });

  const compact = matchMedia("(max-width: 680px)");
  let selected = compact.matches ? "title" : null;
  let manuallySelected = false;
  // Orbits start still for visitors who ask for less motion; the play button still works.
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = false;
  let inspecting = null;
  let flight = null;
  let returning = false;

  system.classList.add("is-ready");
  const orbitAnimations = [];

  function layoutOrbits() {
    for (const path of orbitPaths) {
      const ring = getComputedStyle(path.grid, "::before");
      const rx = parseFloat(ring.width) / 2;
      const ry = parseFloat(ring.height) / 2;
      if (!rx || !ry || (rx === path.rx && ry === path.ry)) continue;
      path.rx = rx;
      path.ry = ry;
      // Resolve each ellipse on resize so the browser can animate plain transforms.
      const keyframes = Array.from({ length: orbitSteps }, (_, i) => {
        const angle = 2 * Math.PI * i / orbitSteps;
        return { transform: `translate(${rx * Math.cos(angle)}px, ${ry * Math.sin(angle)}px)` };
      });
      keyframes.push(keyframes[0]);
      for (const planet of path.planets) {
        if (planet.animation) {
          planet.animation.effect.setKeyframes(keyframes);
        } else {
          const animation = planet.element.animate(keyframes, {
            duration: path.duration, delay: planet.delay, iterations: Infinity
          });
          animation.pause();
          animation.currentTime = 0;
          planet.animation = animation;
          orbitAnimations.push(animation);
        }
      }
    }
  }

  layoutOrbits();
  new ResizeObserver(layoutOrbits).observe(map);

  let speedProgress = 0;
  let targetSpeed = 0;
  let orbitFrame = 0;
  let orbitTime = 0;
  let previousOrbitFrame;

  function setOrbitTime(time) {
    for (const animation of orbitAnimations) animation.currentTime = time;
  }

  function coastOrbits(now) {
    orbitFrame = 0;
    const elapsed = Math.max(0, now - previousOrbitFrame);
    previousOrbitFrame = Math.max(previousOrbitFrame, now);
    const previousSpeed = speedProgress;
    const step = elapsed / orbitRampDuration;
    speedProgress = targetSpeed ? Math.min(1, speedProgress + step) : Math.max(0, speedProgress - step);
    orbitTime += orbitRampDuration * Math.abs(easedOrbitTime(speedProgress) - easedOrbitTime(previousSpeed));
    if (speedProgress === 1) {
      orbitTime += Math.max(0, elapsed - (1 - previousSpeed) * orbitRampDuration);
    }
    setOrbitTime(orbitTime);

    // At full speed, hand timing back to the native animations.
    if (speedProgress === targetSpeed) {
      if (targetSpeed) for (const animation of orbitAnimations) animation.play();
    } else orbitFrame = requestAnimationFrame(coastOrbits);
  }

  function setOrbitMotion(running, instant) {
    const nextSpeed = Number(running);
    if (nextSpeed === targetSpeed && (orbitFrame ? !instant : speedProgress === nextSpeed)) return;
    targetSpeed = nextSpeed;
    if (instant || speedProgress === nextSpeed) {
      cancelAnimationFrame(orbitFrame);
      orbitFrame = 0;
      speedProgress = nextSpeed;
      for (const animation of orbitAnimations) {
        if (running) animation.play();
        else animation.pause();
      }
    } else if (!orbitFrame) {
      orbitTime = orbitAnimations[0]?.currentTime ?? 0;
      for (const animation of orbitAnimations) animation.pause();
      previousOrbitFrame = document.timeline.currentTime ?? performance.now();
      orbitFrame = requestAnimationFrame(coastOrbits);
    }
  }

  function showTier() {
    for (const tier of tiers) {
      const muted = selected !== null && tier.dataset.tier !== selected;
      tier.classList.toggle("is-selected", tier.dataset.tier === selected);
      tier.classList.toggle("is-muted", muted);
      tier.toggleAttribute("inert", muted);
    }
    for (const key of keys) {
      key.setAttribute("aria-pressed", String(key.dataset.tier === selected));
    }
  }
  function selectTier(tier) {
    manuallySelected = true;
    selected = tier;
    showTier();
  }
  for (const key of keys) {
    key.addEventListener("click", () => selectTier(selected === key.dataset.tier ? null : key.dataset.tier));
  }
  document.addEventListener("click", event => {
    if (!visible || selected === null || inspecting) return;
    if (event.target.closest(".solar-system button, .planet-inspector")) return;
    selectTier(null);
  });
  compact.addEventListener("change", () => {
    if (manuallySelected) return;
    selected = compact.matches ? (inspecting?.closest(".partner-tier").dataset.tier ?? "title") : null;
    showTier();
  });

  function updateMotion() {
    const overviewVisible = visible && !document.hidden && !inspecting;
    setOrbitMotion(overviewVisible && !paused, !overviewVisible);
    playback.toggleAttribute("data-paused", paused);
    playback.title = paused ? "Play orbits" : "Pause orbits";
    playback.setAttribute("aria-label", playback.title);
  }
  playback.addEventListener("click", () => {
    paused = !paused;
    updateMotion();
  });
  document.addEventListener("visibilitychange", updateMotion);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateMotion();
  }).observe(map);
  const prefetch = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    prefetch.disconnect();
    preloadFlightArt(sprite, () => map.classList.add("has-mark-atlas")).catch(() => {});
  }, { rootMargin: "600px" });
  prefetch.observe(map);

  function openPlanet(event) {
    const planet = event.target.closest("button.partner-logo");
    if (!planet || inspecting) return;
    const startOrbitTime = orbitAnimations[0]?.currentTime ?? 0;
    const orbitSpeed = paused ? null : speedProgress;
    inspecting = planet;
    updateMotion();
    inspector.querySelector("#planet-name").textContent = planet.title;
    const tier = planet.closest(".partner-tier").dataset.tier;
    inspector.dataset.tier = tier;
    inspector.querySelector("#planet-tier").textContent = tier[0].toUpperCase() + tier.slice(1) + " partner";
    description.textContent = planet.closest("li").dataset.description ?? "";
    description.hidden = !description.textContent;
    website.hidden = !planet.dataset.website;
    if (planet.dataset.website) website.href = planet.dataset.website;
    else website.removeAttribute("href");

    inspector.showModal();
    inspector.scrollTop = 0;
    inspector.classList.add("is-presented");
    flight = createOrbitFlight(map, inspector, planet, {
      initialOrbitSpeed: orbitSpeed,
      setOverviewTime: elapsed => setOrbitTime(startOrbitTime + elapsed),
      onReturn: (elapsed, speed) => finishReturn(startOrbitTime + elapsed, speed)
    });
  }

  function returnToOrbits() {
    if (!inspecting || returning) return;
    returning = true;
    inspector.classList.remove("is-presented");
    flight.reverse();
  }

  function finishReturn(endOrbitTime, endSpeed) {
    const source = inspecting;
    setOrbitTime(endOrbitTime);
    speedProgress = endSpeed;
    flight.dispose();
    inspector.close();
    flight = null;
    inspecting = null;
    returning = false;
    if (!source.closest("[inert]")) source.focus({ preventScroll: true });
    else keys.find(key => key.getAttribute("aria-pressed") === "true")?.focus({ preventScroll: true });
    updateMotion();
  }
  map.addEventListener("click", openPlanet);
  inspector.querySelector(".orbit-return").addEventListener("click", returnToOrbits);
  inspector.addEventListener("cancel", event => {
    event.preventDefault();
    returnToOrbits();
  });
  inspector.addEventListener("click", event => {
    if (!event.target.closest("button, a, .planet-stage, .planet-caption")) returnToOrbits();
  });

  showTier();
  updateMotion();
})();
