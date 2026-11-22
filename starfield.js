function mountStarfield(starfield) {
  // Scoped here: this is a classic script, so a top-level const would clash with cars.js.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const starContext = starfield.getContext("2d");
  if (!starContext) return;
  const orbitInspector = document.querySelector(".planet-inspector");
  const edgePadding = 3;
  const starUpdateInterval = 1000 / 30;
  let fieldWidth;
  let fieldHeight;
  let stars = [];
  let elapsed = 0;
  let previousFrame;
  let nextStarUpdate;
  let starTimer;

  function resizeStarfield() {
    const bounds = starfield.getBoundingClientRect();
    fieldWidth = bounds.width;
    fieldHeight = bounds.height;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    starfield.width = Math.round(fieldWidth * scale);
    starfield.height = Math.round(fieldHeight * scale);
    updateStarfieldVisibility();
    if (!fieldWidth || !fieldHeight) return;
    starContext.setTransform(scale, 0, 0, scale, 0, 0);

    // Seed the field so the same viewport always shows the same stars.
    let seed = 8243;
    function next() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    const count = Math.round(fieldWidth * fieldHeight / 8500);
    stars = Array.from({ length: count }, () => {
      const x = next() * fieldWidth;
      const y = next() * fieldHeight;
      const brightness = next();
      return {
        x,
        y,
        radius: 0.35 + 0.95 * brightness ** 2,
        color: next() < 0.07 ? "#e83b4d" : "#f4f6ff",
        opacity: 0.26 + 0.72 * brightness,
        speed: 2 + 3.5 * brightness
      };
    });
    drawStarfield();
  }

  function wrap(position, size) {
    // Wrap past the visible edge so the entire star is offscreen at the jump.
    return (position + edgePadding) % (size + 2 * edgePadding) - edgePadding;
  }

  function drawStarfield() {
    starContext.clearRect(0, 0, Math.ceil(fieldWidth), Math.ceil(fieldHeight));
    for (const star of stars) {
      const distance = elapsed * star.speed;
      const x = wrap(star.x + distance, fieldWidth);
      const y = wrap(star.y + distance * 0.38, fieldHeight);
      starContext.fillStyle = star.color;
      starContext.globalAlpha = star.opacity;
      starContext.beginPath();
      starContext.arc(x, y, star.radius, 0, Math.PI * 2);
      starContext.fill();
    }
  }

  function animateStarfield() {
    const timestamp = performance.now();
    elapsed += Math.min(timestamp - previousFrame, 50) / 1000;
    previousFrame = timestamp;
    drawStarfield();
    // Schedule against a steady cadence so ordinary timer delays do not accumulate.
    nextStarUpdate += starUpdateInterval;
    if (nextStarUpdate <= timestamp) nextStarUpdate = timestamp + starUpdateInterval;
    starTimer = window.setTimeout(animateStarfield, Math.max(0, nextStarUpdate - performance.now()));
  }

  function updateStarfieldVisibility() {
    window.clearTimeout(starTimer);
    // Visitors who ask for less motion get a still starfield (it is drawn once on resize).
    if (fieldWidth && fieldHeight && !document.hidden && !orbitInspector?.open && !reducedMotion.matches) {
      previousFrame = performance.now();
      nextStarUpdate = previousFrame + starUpdateInterval;
      starTimer = window.setTimeout(animateStarfield, starUpdateInterval);
    }
  }

  resizeStarfield();
  new ResizeObserver(resizeStarfield).observe(starfield);
  document.addEventListener("visibilitychange", updateStarfieldVisibility);
  reducedMotion.addEventListener("change", updateStarfieldVisibility);
  if (orbitInspector) new MutationObserver(updateStarfieldVisibility).observe(orbitInspector, {
    attributes: true, attributeFilter: ["open"]
  });
}

document.querySelectorAll(".starfield").forEach(mountStarfield);
