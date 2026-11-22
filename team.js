// Bios and divisions live in index.html (.member-bio) so search engines and AI crawlers can read them.

const profileDialog = document.querySelector(".profile-dialog");
const profileName = document.querySelector("#profile-name");
const profileRole = document.querySelector("#profile-role");
const profileDivision = document.querySelector("#profile-division");
const profileBio = document.querySelector("#profile-bio");
const profilePhoto = document.querySelector(".profile-photo");
const teamRoster = document.querySelector(".team-roster");
const teamTiles = Array.from(teamRoster.children);
const slidingLineup = window.matchMedia("(hover: hover) and (min-width: 701px)");
const lineupMotionProperties = new Set(["flex-basis", "left", "width", "bottom"]);
let pointerTile = null;
let pointerPosition;
let highlightedTile = null;
let copyFadesUntil = 0;
let lineupRevision = 0;
let portraitsSettled = false;
let panelIndex = 0;
let panel;
let panelFrame = 0;

function paintLineupPanel() {
  const [left, right] = panel.edges;
  teamRoster.style.setProperty("--lineup-highlight-left", `${left.position}px`);
  teamRoster.style.setProperty("--lineup-highlight-width", `${right.position - left.position}px`);
}

function advanceLineupPanel(now) {
  const elapsed = Math.max(0, now - Math.max(panel.time, copyFadesUntil)) / 1000;
  panel.time = Math.max(now, panel.time);
  const decay = Math.exp(-panel.rate * elapsed);
  // Critical damping carries the current velocity into each new target without bouncing.
  for (const edge of panel.edges) {
    const error = edge.position - edge.target;
    const approach = edge.velocity + panel.rate * error;
    edge.position = edge.target + (error + approach * elapsed) * decay;
    edge.velocity = (edge.velocity - panel.rate * approach * elapsed) * decay;
  }
}

function revealSettledCopy() {
  if (portraitsSettled && !panelFrame) highlightedTile?.classList.add("is-copy-visible");
}

function animateLineupPanel(now) {
  advanceLineupPanel(now);
  const settled = panel.edges.every(edge => Math.abs(edge.position - edge.target) < .6 && Math.abs(edge.velocity) < 6);
  if (settled) {
    for (const edge of panel.edges) {
      edge.position = edge.target;
      edge.velocity = 0;
    }
    panelFrame = 0;
  } else {
    panelFrame = requestAnimationFrame(animateLineupPanel);
  }
  paintLineupPanel();
  if (settled) revealSettledCopy();
}

function aimLineupPanel(next, now, resize = false) {
  const style = getComputedStyle(teamRoster);
  const row = teamRoster.getBoundingClientRect();
  const inset = parseFloat(style.paddingLeft);
  const gap = parseFloat(style.columnGap);
  const available = row.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) -
    inset - parseFloat(style.paddingRight) - gap * (teamTiles.length - 1);
  const grow = next ? parseFloat(style.getPropertyValue("--expanded-member-grow")) : 1;
  const regularWidth = available / (teamTiles.length - 1 + grow);
  if (next) panelIndex = teamTiles.indexOf(next);
  const left = inset + panelIndex * (regularWidth + gap);
  const targets = [left, left + regularWidth * grow];
  const durationSeconds = parseFloat(style.getPropertyValue("--highlight-glide-duration")) / 1000;
  const rate = 9 / durationSeconds;

  if (!panel || (!resize && next && Number(getComputedStyle(teamRoster, "::before").opacity) === 0)) {
    const tile = next?.getBoundingClientRect();
    const start = tile ? tile.left - row.left - parseFloat(style.borderLeftWidth) : targets[0];
    const positions = [start, tile ? start + tile.width : targets[1]];
    panel = { edges: positions.map(position => ({ position, target: position, velocity: 0 })), time: now, rate };
    paintLineupPanel();
  } else if (panelFrame) {
    advanceLineupPanel(now);
  }

  panel.rate = rate;
  for (const [index, edge] of panel.edges.entries()) {
    edge.target = targets[index];
    if (resize && !panelFrame) edge.position = edge.target;
  }
  if (resize && !panelFrame) {
    paintLineupPanel();
  } else if (!panelFrame) {
    panel.time = now;
    panelFrame = requestAnimationFrame(animateLineupPanel);
  }
}

function updateLineupHighlight() {
  const focused = document.activeElement;
  const focusedTile = teamRoster.contains(focused) && focused.matches(".member-trigger:focus-visible")
    ? focused.closest(".member")
    : null;
  const next = slidingLineup.matches ? pointerTile ?? focusedTile : null;
  if (next === highlightedTile) return;

  const revision = ++lineupRevision;
  const now = performance.now();
  if (slidingLineup.matches && highlightedTile?.classList.contains("is-copy-visible")) {
    const preview = highlightedTile.querySelector(".member-preview");
    if (Number(getComputedStyle(preview).opacity) > 0) {
      const fadeDuration = parseFloat(getComputedStyle(teamRoster).getPropertyValue("--member-copy-exit"));
      copyFadesUntil = now + fadeDuration;
    }
  }
  teamRoster.style.setProperty("--lineup-shift-delay", `${Math.max(0, copyFadesUntil - now)}ms`);
  if (slidingLineup.matches) aimLineupPanel(next, now);
  portraitsSettled = false;
  highlightedTile?.classList.remove("is-highlighted", "is-copy-visible");
  next?.classList.add("is-highlighted");
  highlightedTile = next;
  if (!next) return;

  // Replacing a hover can cancel its transitions. Only the latest tile may reveal its text.
  const movement = teamRoster.getAnimations({ subtree: true }).filter(animation =>
    lineupMotionProperties.has(animation.transitionProperty));
  Promise.allSettled(movement.map(animation => animation.finished)).then(() => {
    if (revision !== lineupRevision) return;
    portraitsSettled = true;
    revealSettledCopy();
  });
}

function updateLineupMode() {
  pointerTile = null;
  pointerPosition = undefined;
  copyFadesUntil = 0;
  if (!slidingLineup.matches) {
    cancelAnimationFrame(panelFrame);
    panelFrame = 0;
    panel = undefined;
    teamRoster.style.removeProperty("--lineup-highlight-left");
    teamRoster.style.removeProperty("--lineup-highlight-width");
  }
  teamRoster.classList.toggle("has-sliding-background", slidingLineup.matches);
  updateLineupHighlight();
}

// Pointer movement selects the tile. Reflow under a stationary cursor does not.
teamRoster.addEventListener("pointermove", event => {
  if (!slidingLineup.matches || event.pointerType === "touch") return;
  if (event.clientX === pointerPosition?.x && event.clientY === pointerPosition.y) return;
  pointerPosition = { x: event.clientX, y: event.clientY };
  const tile = event.target.closest(".member");
  if (tile) pointerTile = tile;
  updateLineupHighlight();
});
teamRoster.addEventListener("pointerleave", () => {
  pointerTile = null;
  pointerPosition = undefined;
  updateLineupHighlight();
});
teamRoster.addEventListener("focusin", event => {
  if (event.target.matches(":focus-visible")) pointerTile = null;
  updateLineupHighlight();
});
teamRoster.addEventListener("focusout", () => queueMicrotask(updateLineupHighlight));
slidingLineup.addEventListener("change", updateLineupMode);
new ResizeObserver(() => {
  if (panel) aimLineupPanel(highlightedTile, performance.now(), true);
}).observe(teamRoster);
updateLineupMode();

const signaturePositions = new ResizeObserver(entries => {
  for (const { target } of entries) {
    target.closest(".member-trigger").style.setProperty("--member-name-height", `${target.offsetHeight}px`);
  }
});
for (const name of teamRoster.querySelectorAll(".member-name")) {
  signaturePositions.observe(name);
}

for (const trigger of teamRoster.querySelectorAll(".member-trigger")) {
  trigger.addEventListener("click", () => {
    const member = trigger.dataset.member;
    const bio = trigger.closest(".member").querySelector(".member-bio");
    profileName.textContent = trigger.querySelector(".member-name").textContent.trim();
    profileRole.textContent = trigger.querySelector(".member-role").textContent;
    profileDivision.textContent = bio?.dataset.division ?? "";
    profileBio.textContent = bio?.textContent.trim() ?? "";
    // Clear the previous member's photo first so it never shows under the new name while loading.
    profilePhoto.removeAttribute("src");
    profilePhoto.src = `assets/team-${member}.webp`;
    profilePhoto.alt = `Portrait of ${profileName.textContent}`;
    profileDialog.showModal();
  });
}
