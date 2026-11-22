export const glideDuration = 1050;

// Shared by the carousels so visitors who ask for less motion get instant slide changes.
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Peak speed at one third of the journey, followed by a long deceleration.
export function easeGlide(progress) {
  return 1 - (1 - progress) ** 3 * (1 + 3 * progress);
}
