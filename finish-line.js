(() => {
  const finishLine = document.getElementById("finish-line");
  const track = document.querySelector(".finish-track");
  const car = track.querySelector(".finish-car");
  const slogan = document.querySelector(".finish-slogan");
  const sloganText = document.createRange();
  sloganText.selectNodeContents(slogan.querySelector("span"));
  const contact = document.querySelector(".finish-contact");
  const dock = document.querySelector(".footer-dock");
  const anchorProgress = .72;
  const rolloutStart = .55;
  const returnThreshold = rolloutStart - .05;
  const flashDuration = 340;
  const revealDuration = 840;
  const socialDelay = 160;
  const brakingDuration = 1450;
  const cruiseSpeed = .28 / 900;
  // Progress is measured in car lengths. Work back from the fixed parking position to place the beam.
  const stopProgress = 1.823703703703704;
  const brakingDistance = cruiseSpeed * brakingDuration / 3;
  const rearClearProgress = stopProgress - brakingDistance;
  const crossing = rearClearProgress - 1;
  const rearClearanceDuration = 1 / cruiseSpeed;
  const runOutDuration = rearClearanceDuration + brakingDuration;
  const minRolloutRate = .45;
  const maxRolloutRate = 3;
  const wheelCoastDuration = 400;
  const scrollEndLookahead = 180;
  const returnResponse = .09;
  let rolling = false;
  let beamTime = null;
  let rolloutRate = 1;
  let previousScroll = null;
  let lastScrollSample = null;
  let approachSpeed = 0;
  let wheelDistance = 0;
  let wheelTargetsBottom = false;
  let lastWheelInput = null;
  let carryingMomentum = false;
  let carProgress = 0;
  let lastDrawTime = null;
  let trailStrength = 0;
  let trailRemaining = 1;
  let trailRequested = false;
  let returning = false;
  let returnVelocity = 0;
  let frame = 0;
  let inView = false;

  const unit = value => Math.max(0, Math.min(1, value));
  const rateFor = speed => speed > 0
    ? Math.max(minRolloutRate, Math.min(maxRolloutRate, speed / cruiseSpeed))
    : 1;

  function renderRearEdge(spriteContext) {
    const edge = car.querySelector(".finish-rear-edge");
    const context = edge.getContext("2d");
    if (!context) return;

    const { width, height } = spriteContext.canvas;
    const pixels = spriteContext.getImageData(0, 0, width, height).data;
    const smear = context.createImageData(edge.width, edge.height);
    const rearSection = Math.floor(width * .79);
    const smearLength = edge.width - width;
    // Extend the rear silhouette a few pixels with its own colours. The car stays opaque underneath.
    for (let row = 0; row < height; row++) {
      let rearPixel = width - 1;
      while (rearPixel >= rearSection && pixels[(row * width + rearPixel) * 4 + 3] < 224) rearPixel--;
      if (rearPixel < rearSection) continue;
      const innerColor = (row * width + Math.max(rearSection, rearPixel - 3)) * 4;
      const color = pixels[innerColor + 3] >= 224 ? innerColor : (row * width + rearPixel) * 4;
      for (let shift = 0; shift < smearLength; shift++) {
        const target = (row * edge.width + rearPixel + shift) * 4;
        const remaining = 1 - shift / smearLength;
        smear.data[target] = pixels[color];
        smear.data[target + 1] = pixels[color + 1];
        smear.data[target + 2] = pixels[color + 2];
        smear.data[target + 3] = 255 * remaining ** 2 * (3 - 2 * remaining);
      }
    }
    context.putImageData(smear, 0, 0);
  }

  function renderTrail(image) {
    const canvas = car.querySelector(".finish-trail");
    const context = canvas.getContext("2d");
    if (!context) return;

    // Match the opaque crop used for the sharp car in finish-line.css.
    const sprite = document.createElement("canvas");
    sprite.width = 1185;
    sprite.height = 270;
    const spriteContext = sprite.getContext("2d");
    if (!spriteContext) return;

    // Use the same outline as the sharp render to keep the ground out of the trail.
    const outline = document.querySelector("#finish-car-outline path");
    spriteContext.translate(-136, -393);
    spriteContext.clip(new Path2D(outline.getAttribute("d")));
    spriteContext.drawImage(image, 0, 0);
    renderRearEdge(spriteContext);

    const width = canvas.width / 1.4;
    const height = width * sprite.height / sprite.width;
    const top = (canvas.height - height) / 2;
    const samples = 72;
    context.globalCompositeOperation = "lighter";
    context.imageSmoothingQuality = "high";

    // Average overlapping positions of the render, weighted toward the car.
    // The canvas starts at the bumper and captures just the trailing part.
    for (let sample = 0; sample < samples; sample++) {
      const distance = (sample + .5) / samples;
      const left = distance * canvas.width - width * .88;
      context.globalAlpha = 2 * (1 - distance) / samples;
      context.drawImage(sprite, left, top, width, height);
    }
  }

  function revealFooter(ready, socialReady, timing = null) {
    const pending = !ready;
    slogan.toggleAttribute("inert", pending);
    // Never make the links inert: keyboard and screen-reader users must reach them without the scroll sequence.
    // While pending they ignore the pointer, and CSS reveals them as soon as one receives focus.
    contact.toggleAttribute("data-pending", !socialReady);
    if (dock.hasAttribute("data-finish-line-pending") === pending) return;
    dock.toggleAttribute("data-finish-line-pending", pending);
    dock.dispatchEvent(new CustomEvent("finish-line:reveal-change", { detail: timing }));
  }

  function measureSlogan() {
    // Wrapped lines can end well inside the paragraph's layout box.
    const width = sloganText.getBoundingClientRect().right - slogan.getBoundingClientRect().left;
    slogan.style.setProperty("--scan-width", width + "px");
  }

  function schedule() {
    if (inView && !frame) frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = 0;
    if (!inView) return;
    const frameTime = lastDrawTime === null ? 0 : Math.max(1, now - lastDrawTime);
    const frameStep = frameTime > 64 ? 16 : Math.min(frameTime, 32);
    lastDrawTime = now;
    const previousProgress = carProgress;
    const viewport = document.documentElement.clientHeight;
    const shown = viewport - track.getBoundingClientRect().top;
    // Measure against the dock slot so a moving bar can't change the car's scroll range.
    const dockBounds = dock.getBoundingClientRect();
    const remaining = Math.max(0, dockBounds.bottom - viewport);
    // Start the approach once the socials can clear the pinned bar, even if scrolling stops.
    const clearance = Math.max(0, dockBounds.top - finishLine.getBoundingClientRect().bottom - 12);
    const approachDistance = Math.max(1, shown + remaining - clearance);
    const scrollProgress = rolloutStart * unit(shown / approachDistance);
    const scroll = window.scrollY;
    const scrollDelta = previousScroll === null ? 0 : scroll - previousScroll;
    previousScroll = scroll;
    const canReturn = beamTime === null || carProgress >= rearClearProgress;
    if (rolling && canReturn && scrollProgress < returnThreshold) {
      rolling = false;
      beamTime = null;
      carryingMomentum = false;
      returning = true;
    }

    const wheelSample = wheelDistance > 0 && scrollDelta >= 0;
    const scrollInput = wheelSample ? wheelDistance : scrollDelta;
    wheelDistance = 0;
    if (wheelSample) lastWheelInput = now;
    const wheelCoasting = lastWheelInput !== null && now - lastWheelInput <= wheelCoastDuration;
    const measuringScroll = frameTime > 0 && frameTime <= 160;
    if (beamTime === null && !carryingMomentum && !returning && carProgress >= returnThreshold) {
      const pixelsRemaining = Math.max(0, document.scrollingElement.scrollHeight - viewport - scroll);
      const distanceFromScroll = pixelsRemaining * rolloutStart / approachDistance;
      const speed = rolling ? cruiseSpeed * rolloutRate : returnVelocity / 1000;
      const headingToBottom = wheelCoasting ? wheelTargetsBottom && scrollDelta >= 0 : measuringScroll && scrollDelta > 0;
      if (headingToBottom && speed >= minRolloutRate * cruiseSpeed &&
          distanceFromScroll <= speed * scrollEndLookahead && distanceFromScroll < crossing - carProgress) {
        // Carry the current frame velocity across the page's easing tail.
        carryingMomentum = true;
        rolling = true;
        rolloutRate = speed / cruiseSpeed;
      }
    }

    const paceChanged = beamTime === null && !carryingMomentum && scrollInput > 0 &&
      (wheelSample || (measuringScroll && !wheelCoasting));
    if (paceChanged) {
      const sinceSample = lastScrollSample === null ? frameTime : now - lastScrollSample;
      lastScrollSample = now;
      // Use fresh wheel input in place of the page's eased scroll tail.
      const interval = wheelSample ? Math.max(32, Math.min(100, sinceSample))
        : Math.max(frameTime, sinceSample <= 160 ? sinceSample : frameTime);
      const scrollSpeed = scrollInput * rolloutStart / (approachDistance * interval);
      approachSpeed += (scrollSpeed - approachSpeed) * (1 - Math.exp(-interval / 65));
    } else if (scrollDelta < 0 || (!rolling && !wheelCoasting && lastScrollSample !== null && now - lastScrollSample > 160)) {
      approachSpeed = 0;
      lastScrollSample = null;
      lastWheelInput = null;
    }

    if (!rolling) {
      if (returning || scrollProgress < carProgress) {
        // A critically damped spring carries velocity across changes in the scroll target.
        const step = frameStep / 1000;
        const offset = carProgress - scrollProgress;
        const rate = 1 / returnResponse;
        const slope = returnVelocity + rate * offset;
        const decay = Math.exp(-rate * step);
        carProgress = Math.max(0, Math.min(stopProgress, scrollProgress + (offset + slope * step) * decay));
        returnVelocity = (returnVelocity - rate * slope * step) * decay;
        returning = Math.abs(carProgress - scrollProgress) > .001 || Math.abs(returnVelocity) > .015;
      }
      if (!returning) {
        const maxAdvance = cruiseSpeed * maxRolloutRate * frameStep;
        carProgress = frameTime ? Math.min(scrollProgress, carProgress + maxAdvance) : scrollProgress;
        if (scrollProgress >= rolloutStart) {
          rolling = true;
          const incomingSpeed = measuringScroll ? (carProgress - previousProgress) / frameTime : 0;
          rolloutRate = rateFor(Math.max(approachSpeed, incomingSpeed));
        }
      }
    } else if (beamTime === null) {
      const distanceToBeam = crossing - carProgress;
      const speed = cruiseSpeed * rolloutRate;
      const timeToBeam = distanceToBeam / speed;
      if (timeToBeam <= frameTime) {
        // Split the frame at the crossing and carry that speed into the run-out.
        beamTime = now - (frameTime - timeToBeam);
      } else {
        carProgress += speed * frameTime;
        if (paceChanged) rolloutRate = rateFor(approachSpeed);
      }
    }

    const timeSinceBeam = beamTime === null ? -Infinity : now - beamTime;
    const elapsed = beamTime === null ? 0 : Math.min(timeSinceBeam * rolloutRate, runOutDuration);
    const brakeTimeLeft = unit((runOutDuration - elapsed) / brakingDuration);
    if (beamTime !== null) {
      // The remaining distance integrates the easing curve used for trail retraction.
      carProgress = elapsed <= rearClearanceDuration ? crossing + cruiseSpeed * elapsed
        : stopProgress - brakingDistance * brakeTimeLeft ** 5 * (3 - 2 * brakeTimeLeft);
    }

    // The rollout translates by one car width, so measure velocity in CSS pixels per second.
    const progressVelocity = frameTime ? (carProgress - previousProgress) * 1000 / frameTime : 0;
    if (!returning) returnVelocity = progressVelocity;
    const velocity = progressVelocity * car.offsetWidth;
    if (brakeTimeLeft < 1) {
      // Retract in proportion to the easing car speed so both reach zero together.
      trailRemaining = brakeTimeLeft ** 4 * (5 - 4 * brakeTimeLeft);
    } else if (!returning || !trailStrength) {
      trailRemaining = 1;
    }
    if (velocity < 0 || trailRemaining === 0) {
      trailStrength = 0;
    } else if (brakeTimeLeft === 1) {
      const trailSpeed = Math.max(0, velocity - 2);
      const trailTarget = trailSpeed / (trailSpeed + 55);
      const responseTime = trailTarget > trailStrength ? 20 : 76;
      const blend = 1 - Math.exp(-frameTime / responseTime);
      trailStrength += (trailTarget - trailStrength) * blend;
      if (!trailTarget && trailStrength < .004) trailStrength = 0;
    }
    track.style.setProperty("--trail-strength", trailStrength);
    track.style.setProperty("--trail-remaining", trailRemaining);

    // Keep the flash and footer reveal on their own clock as the car speed changes.
    const revealElapsed = timeSinceBeam - flashDuration;
    const pulse = unit(timeSinceBeam / flashDuration);
    const brightness = Math.min(pulse / .18, (1 - pulse) / .82);
    const scan = unit(revealElapsed / revealDuration);
    const social = unit((revealElapsed - socialDelay) / (revealDuration - socialDelay));
    const socialEase = social * social * (3 - 2 * social);

    track.style.setProperty("--roll-in", (1 - carProgress) * 100 + "%");
    track.style.setProperty("--signal", brightness * brightness * (3 - 2 * brightness));
    slogan.style.setProperty("--scan-offset", `calc(${scan} * var(--scan-width, 100%))`);
    slogan.style.setProperty("--scan-inset", scan === 1 ? "-.6em" : "calc(100% - var(--scan-offset))");
    slogan.style.setProperty("--scan-opacity", unit(Math.min(scan / .08, (1 - scan) / .1)));
    finishLine.style.setProperty("--social-opacity", socialEase);
    finishLine.style.setProperty("--social-offset", .6 * (1 - socialEase) + "rem");

    const ready = revealElapsed >= 0;
    const timing = ready ? { startTime: beamTime + flashDuration, duration: revealDuration } : null;
    revealFooter(ready, revealElapsed >= socialDelay, timing);
    const pendingMotion = rolling
      ? beamTime === null || elapsed < runOutDuration || revealElapsed < revealDuration
      : carProgress < scrollProgress;
    if (returning || trailStrength > 0 || pendingMotion) schedule();
  }

  finishLine.classList.add("is-sequenced");
  track.style.setProperty("--beam-shift", anchorProgress - crossing);
  new ResizeObserver(measureSlogan).observe(slogan);
  document.fonts.ready.then(measureSlogan);
  revealFooter(false, false);
  finishLine.addEventListener("finish-line:wheel-input", ({ detail: { distance, reachesBottom } }) => {
    if (!inView || beamTime !== null || carryingMomentum) return;
    wheelDistance += distance;
    wheelTargetsBottom = reachesBottom;
    schedule();
  });

  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView && !trailRequested) {
      trailRequested = true;
      const image = car.querySelector("img");
      // The trail is decoration: if the canvas can't be read (e.g. opened from file://), skip it quietly.
      image.decode().then(() => renderTrail(image)).catch(() => {});
    }
    if (!inView) {
      lastDrawTime = null;
      previousScroll = null;
      lastScrollSample = null;
      approachSpeed = 0;
      wheelDistance = 0;
      wheelTargetsBottom = false;
      lastWheelInput = null;
      trailStrength = 0;
      trailRemaining = 1;
      track.style.removeProperty("--trail-strength");
      track.style.removeProperty("--trail-remaining");
    }
    if (!inView && entry.boundingClientRect.top >= entry.rootBounds?.bottom) {
      rolling = false;
      beamTime = null;
      carryingMomentum = false;
      carProgress = 0;
      returning = false;
      returnVelocity = 0;
      track.style.setProperty("--roll-in", "100%");
      track.style.setProperty("--signal", "0");
      revealFooter(false, false);
    }
    schedule();
  }).observe(track);

  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  addEventListener("pageshow", schedule);
})();
