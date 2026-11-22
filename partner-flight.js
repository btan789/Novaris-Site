const clamp = value => Math.max(0, Math.min(1, value));
const smooth = t => t * t * (3 - 2 * t);
// Spend more of the flight braking into the close-up. The return retraces this curve.
const cameraProgress = t => t * t * (6 - t * (8 - 3 * t));
const centerX = box => box.left + box.width / 2;
const centerY = box => box.top + box.height / 2;
const duration = 2050;
const overviewBlendDuration = 420;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const compactFlight = matchMedia("(max-width: 680px), (pointer: coarse)");
const thumbnailSize = () => compactFlight.matches ? 192 : 324;

function loadImage(url) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

function surface(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return canvas;
}

// Composite the curved logos with the overview terrain once, at the size the flight needs.
function planetSprite(terrain, marks, index, colour, size = terrain.naturalWidth / 5) {
  const tile = terrain.naturalWidth / 5;
  const canvas = surface(size);
  const ctx = canvas.getContext("2d");
  const column = index % 5, row = Math.floor(index / 5);
  ctx.drawImage(terrain, column * tile, row * tile, tile, tile, 0, 0, size, size);
  const fullMark = marks.naturalWidth / 5;
  const smallMark = marks.naturalHeight - fullMark * 3;
  const markSize = colour ? fullMark : smallMark;
  const diameter = size / 1.8;
  const inset = (size - diameter) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, diameter / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(size / 2, size / 2 + diameter * .01);
  ctx.scale(diameter * .61, diameter * .53);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, "#080a1280");
  shade.addColorStop(.54, "#0b0b1238");
  shade.addColorStop(.9, "transparent");
  ctx.fillStyle = shade;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  ctx.drawImage(marks, colour ? column * fullMark : index * smallMark,
    colour ? row * fullMark : 3 * fullMark, markSize, markSize, inset, inset, diameter, diameter);
  return canvas;
}

function shadowOf(image) {
  const mask = surface(image.width);
  const ctx = mask.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, mask.width, mask.height);
  return mask;
}

let artwork;
function prepareFlightArt() {
  if (!artwork) {
    artwork = Promise.all([loadImage("assets/partner-planets.webp?v=mineral"), loadImage("assets/flight-marks.webp")])
      .then(([terrain, marks]) => {
        const thumbnails = new Map();
        let lastIndex, portrait;
        return {
          thumbnail(index, size) {
            const key = `${size}:${index}`;
            if (!thumbnails.has(key)) {
              const image = planetSprite(terrain, marks, index, false, size);
              thumbnails.set(key, { image, shadow: shadowOf(image) });
            }
            return thumbnails.get(key);
          },
          portrait(index) {
            if (index !== lastIndex) {
              portrait = planetSprite(terrain, marks, index, true);
              lastIndex = index;
            }
            return portrait;
          }
        };
      }).catch(error => {
        artwork = undefined;
        throw error;
      });
  }
  return artwork;
}

export async function preloadFlightArt(count, onArtworkReady) {
  const art = await prepareFlightArt();
  onArtworkReady();
  const size = thumbnailSize();
  // Spread sprite preparation over short batches so it does not block the approach.
  for (let index = 0; index < count;) {
    await new Promise(resolve => {
      if (window.requestIdleCallback) requestIdleCallback(resolve);
      else requestAnimationFrame(resolve);
    });
    const end = Math.min(index + 2, count);
    for (; index < end; index++) art.thumbnail(index, size);
  }
}

function starLayer(width, height, depth, seed) {
  function sample() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  return { depth, points: Array.from({ length: Math.ceil(4 * width * height / 16500) }, () => ({
    x: (sample() * 2 - 1) * width * depth,
    y: (sample() * 2 - 1) * height * depth,
    size: (.7 + 1.1 * sample()) * depth,
    colour: 'rgba(235,234,233,' + (.22 + .55 * sample()) + ')'
  })) };
}

function sunSprite(core, includeName) {
  const canvas = surface(256);
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const diameter = size / 2.9;
  const radius = size / 2;
  const halo = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  halo.addColorStop(0, "#ff957a8a");
  halo.addColorStop(.2, "#ed685247");
  halo.addColorStop(.48, "#c33e4c1f");
  halo.addColorStop(1, "transparent");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  const icon = core.querySelector("img");
  if (icon.complete && icon.naturalWidth) {
    ctx.drawImage(icon, radius - diameter / 2, radius - diameter / 2, diameter, diameter);
  }
  if (includeName) {
    ctx.font = '18px "Novaris Wordmark", sans-serif';
    ctx.fillStyle = "#fff4ec";
    ctx.textAlign = "center";
    ctx.fillText("NOVARIS", radius, radius + diameter * .76);
  }
  return canvas;
}

export function createOrbitFlight(map, inspector, source, { initialOrbitSpeed, setOverviewTime, onReturn }) {
  const viewport = inspector.querySelector(".flight-viewport");
  const stage = inspector.querySelector(".planet-stage");
  const caption = inspector.querySelector(".planet-caption");
  const canvas = document.createElement("canvas");
  viewport.append(canvas);
  const ctx = canvas.getContext("2d");
  const core = map.querySelector(".solar-core");
  const rings = [...map.querySelectorAll(".partner-grid")].map(grid => ({ grid }));
  const bodies = [core, ...map.querySelectorAll("button.partner-logo")].map(original => ({
    original,
    visual: original.querySelector(".planet-visual") ?? original,
    sizeFactor: original === core ? 2.9 : 1.8,
    ring: rings.find(({ grid }) => grid.contains(original))
  }));
  const target = bodies.find(body => body.original === source);
  let width, height, focal, mapY, tilt, arrival, arcDirection, stars;
  let time = 0, direction = 1, frame = 0, previousTime;
  let orbitTime = 0, orbitSpeed = initialOrbitSpeed ?? 0;
  let departureTime, departureSpeed, renderedOrbitTime;
  let blendStart, overviewTime = 0, layoutOrbitTime = 0;
  let disposed = false, ready = false;
  let previousCaption;
  let layoutKey;
  const resize = new ResizeObserver(layout);

  function depthAt(y) {
    return focal / (1 + tilt * (y - mapY) / focal);
  }

  function positionBodies() {
    if (renderedOrbitTime === orbitTime) return;
    renderedOrbitTime = orbitTime;
    for (const body of bodies) {
      const ring = body.ring;
      let x = body.startX, y = body.startY;
      if (ring) {
        const angle = body.angle + (orbitTime - layoutOrbitTime) * ring.radiansPerMs;
        x += ring.rx * (Math.cos(angle) - Math.cos(body.angle));
        y += ring.ry * (Math.sin(angle) - Math.sin(body.angle));
      }
      const depth = depthAt(y);
      body.depth = depth;
      body.x = (x - width / 2) * depth / focal;
      body.y = (y - height / 2) * depth / focal;
      body.screenX = x;
      body.screenY = y;
    }
    bodies.sort((a, b) => b.depth - a.depth);
  }

  function fitCanvas(settled) {
    // Spend fewer pixels on moving frames and restore the sharp close-up at rest.
    const compactMotion = compactFlight.matches && !settled;
    const pixelBudget = compactMotion ? 650_000 : 2_600_000;
    const ratio = Math.min(devicePixelRatio || 1, compactMotion ? 1.4 : 2,
      Math.sqrt(pixelBudget / (width * height)));
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    ctx.setTransform(bufferWidth / width, 0, 0, bufferHeight / height, 0, 0);
  }

  function layout() {
    if (!ready || disposed) return;
    const view = viewport.getBoundingClientRect();
    const goal = stage.getBoundingClientRect();
    const mapBox = map.getBoundingClientRect();
    const key = [view.width, view.height, mapBox.x, mapBox.y, mapBox.width, mapBox.height,
      goal.x, goal.y, goal.width, devicePixelRatio, compactFlight.matches].join(",");
    if (layoutKey === key || !view.width || !goal.width) return;
    layoutKey = key;
    width = view.width;
    height = view.height;
    focal = Math.max(width * .68, height * .86);
    const mapX = centerX(mapBox) - view.left;
    mapY = centerY(mapBox) - view.top;
    tilt = width < 700 ? .85 : 1.13;
    layoutOrbitTime = overviewTime;

    const ringSteps = compactFlight.matches ? 72 : 144;
    for (const ring of rings) {
      const style = getComputedStyle(ring.grid, "::before");
      ring.colour = style.borderColor;
      ring.opacity = Number(style.opacity);
      ring.rx = parseFloat(style.width) / 2;
      ring.ry = parseFloat(style.height) / 2;
      const period = parseFloat(style.getPropertyValue("--period")) * 1000;
      ring.radiansPerMs = 2 * Math.PI / period;
      ring.points = Array.from({ length: ringSteps + 1 }, (_, i) => {
        const angle = i * 2 * Math.PI / ringSteps;
        const x = mapX + Math.cos(angle) * ring.rx, y = mapY + Math.sin(angle) * ring.ry;
        const depth = depthAt(y);
        return { x: (x - width / 2) * depth / focal, y: (y - height / 2) * depth / focal, depth };
      });
    }
    // All bodies start at their exact overview positions on the same inclined orbital plane.
    for (const body of bodies) {
      const box = body.visual.getBoundingClientRect();
      body.startX = centerX(box) - view.left;
      body.startY = centerY(box) - view.top;
      body.diameter = box.width;
      body.muted = body.original.closest(".partner-tier")?.classList.contains("is-muted");
      body.overviewDiameter = parseFloat(getComputedStyle(body.original).width) * (body.muted ? .65 : 1);
      if (body.ring) {
        body.angle = Math.atan2((body.startY - mapY) / body.ring.ry, (body.startX - mapX) / body.ring.rx);
      }
      if (body.original === core) {
        body.image = sunSprite(core, width > 680);
        body.shadow = shadowOf(body.image);
      }
    }
    arcDirection = Math.sign(target.startX - width / 2);
    arrival = { x: centerX(goal) - view.left, y: centerY(goal) - view.top, width: goal.width };
    renderedOrbitTime = undefined;
    fitCanvas(direction > 0 && time === 1);
    stars = [starLayer(width, height, 4.1, 8273), starLayer(width, height, 2.1, 14371)];
    render();
  }

  function render() {
    if (!arrival) return;
    positionBodies();
    const p = cameraProgress(time);
    const distance = target.depth * (target.diameter / arrival.width) ** p;
    const forward = target.depth - distance;
    const arc = Math.sin(Math.PI * p);
    const aimX = target.screenX + (arrival.x - target.screenX) * p
      + arcDirection * arc * Math.min(width * .045, 65);
    const aimY = target.screenY + (arrival.y - target.screenY) * p - arc * Math.min(height * .045, 45);
    const cx = target.x - (aimX - width / 2) * distance / focal;
    const cy = target.y - (aimY - height / 2) * distance / focal;
    const landingScale = direction < 0 ? smooth(clamp(time / Math.min(.25, departureTime))) : 1;

    const fill = smooth(clamp(time / .63));
    if (fill < 1) ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = fill;
    ctx.fillStyle = "#040405";
    ctx.fillRect(0, 0, width, height);
    for (const layer of stars) {
      const scale = focal / (focal * layer.depth - forward);
      for (const star of layer.points) {
        const x = width / 2 + (star.x - cx) * scale, y = height / 2 + (star.y - cy) * scale;
        if (x < 0 || x > width || y < 0 || y > height) continue;
        ctx.fillStyle = star.colour;
        ctx.beginPath();
        ctx.arc(x, y, star.size * scale / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const ring of rings) {
      ctx.beginPath();
      let connected = false;
      for (const point of ring.points) {
        const z = point.depth - forward;
        if (z < focal * .05) { connected = false; continue; }
        const x = width / 2 + (point.x - cx) * focal / z, y = height / 2 + (point.y - cy) * focal / z;
        if (connected) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        connected = true;
      }
      ctx.strokeStyle = ring.colour;
      const strength = ring.opacity * (1 - .52 * p);
      ctx.globalAlpha = strength * .16;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = strength;
      ctx.lineWidth = 1 + .6 * p;
      ctx.stroke();
    }
    for (const body of bodies) {
      const clearance = (body.depth - forward) / focal;
      if (clearance <= .08 && body !== target) continue;
      const baseDiameter = body.overviewDiameter + (body.diameter - body.overviewDiameter) * landingScale;
      const diameter = baseDiameter * body.depth / (body.depth - forward);
      const size = diameter * body.sizeFactor;
      const x = width / 2 + (body.x - cx) / clearance - size / 2;
      const y = height / 2 + (body.y - cy) / clearance - size / 2;
      if (x > width || x + size < 0 || y > height || y + size < 0) continue;
      ctx.globalAlpha = body === target ? 1 : (body.muted ? .24 : 1) * smooth(clamp((clearance - .08) / .25));
      ctx.drawImage(body.image, x, y, size, size);
      if (body.shadow && p > 0) {
        ctx.globalAlpha *= p * (.36 + .34 * clamp(diameter / Math.min(width, height)));
        ctx.drawImage(body.shadow, x, y, size, size);
      }
    }
    const reveal = smooth(clamp((time - .62) / .34));
    if (reveal !== previousCaption) {
      caption.style.opacity = reveal;
      if (caption.inert !== (reveal < .35)) caption.inert = reveal < .35;
      previousCaption = reveal;
    }
  }

  function blendOverview(progress) {
    // The two renderers share an orbit clock throughout the dissolve.
    setOverviewTime(orbitTime);
    overviewTime = orbitTime;
    const angle = smooth(progress) * Math.PI / 2;
    map.style.opacity = Math.sin(angle);
    canvas.style.opacity = Math.cos(angle);
    map.classList.remove("in-flight");
  }

  function tick(now) {
    frame = 0;
    if (blendStart !== undefined) {
      orbitTime += (now - previousTime) * smooth(orbitSpeed);
      previousTime = now;
      const progress = clamp((now - blendStart) / overviewBlendDuration);
      if (progress === 1) {
        onReturn(orbitTime, orbitSpeed);
        return;
      }
      render();
      blendOverview(progress);
      frame = requestAnimationFrame(tick);
      return;
    }
    const lastTime = time;
    // Under reduced motion the camera cuts straight to the close-up (or back); only the short fade remains.
    const flightDuration = reducedMotion.matches ? 1 : duration;
    if (previousTime !== undefined) time = clamp(time + direction * (now - previousTime) / flightDuration);
    previousTime = now;
    if (initialOrbitSpeed !== null && time !== lastTime) {
      const lastSpeed = orbitSpeed;
      orbitSpeed = direction > 0 ? initialOrbitSpeed * (1 - time)
        : departureSpeed + (1 - departureSpeed) * (1 - time / departureTime);
      // Integrate the smooth speed curve exactly over this frame.
      const average = (smooth(lastSpeed) + 4 * smooth((lastSpeed + orbitSpeed) / 2) + smooth(orbitSpeed)) / 6;
      orbitTime += Math.abs(time - lastTime) * duration * average;
    }
    if (compactFlight.matches && time !== lastTime && (time === 1 || lastTime === 1)) {
      fitCanvas(time === 1);
    }
    render();
    if (direction < 0 && time === 0) {
      blendStart = now;
      blendOverview(0);
    } else if (direction > 0 && time === 1) {
      previousTime = undefined;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  caption.style.opacity = 0;
  caption.inert = true;
  prepareFlightArt().then(art => {
    if (disposed) return;
    if (!ctx) throw new Error("Flight canvas unavailable");
    const size = thumbnailSize();
    for (const body of bodies) {
      if (body.original === core) continue;
      const index = Number(body.original.dataset.sprite);
      if (body === target) body.image = art.portrait(index);
      else Object.assign(body, art.thumbnail(index, size));
    }
    ready = true;
    layout();
    map.classList.add("in-flight");
    [viewport, map, stage].forEach(element => resize.observe(element));
    frame = requestAnimationFrame(tick);
  }).catch(() => {
    if (disposed) return;
    ready = false;
    // Keep the sponsor and its link usable even if a flight texture cannot load.
    const portrait = source.cloneNode(true);
    portrait.tabIndex = -1;
    portrait.inert = true;
    for (const prop of ["--sprite-x", "--sprite-y", "--planet-accent"]) {
      portrait.style.setProperty(prop, getComputedStyle(source).getPropertyValue(prop));
    }
    stage.replaceChildren(portrait);
    viewport.classList.add("static-portrait");
    caption.style.opacity = 1;
    caption.inert = false;
  });
  return {
    reverse() {
      if (!ready || time === 0) { onReturn(orbitTime, orbitSpeed); return; }
      departureTime = time;
      departureSpeed = orbitSpeed;
      direction = -1;
      previousTime = undefined;
      if (!frame) frame = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      stage.replaceChildren();
      viewport.classList.remove("static-portrait");
      canvas.remove();
      map.style.removeProperty("opacity");
      map.classList.remove("in-flight");
    }
  };
}
