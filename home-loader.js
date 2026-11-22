import { showPageLoader } from "./page-loader.js?v=quicker-reveal";

const root = document.documentElement;
const hero = document.querySelector(".hero .stage");

async function revealHome() {
  if (!root.classList.contains("is-site-loading")) return;
  // The hero has a real src in the HTML, so the browser starts downloading it
  // straight away (fetchpriority="high"). The loader only waits for it to finish.
  const openingImages = Array.from(document.images).filter(image => {
    if (image === hero || !image.hasAttribute("src")) return false;
    const { top, right, bottom, left, width, height } = image.getBoundingClientRect();
    return width && height && bottom > 0 && top < innerHeight && right > 0 && left < innerWidth;
  });

  async function decodeOpeningImage(image) {
    image.loading = "eager";
    try {
      await image.decode();
    } catch {
      // A missing supporting image shouldn't keep the entire home page covered.
    }
  }

  try {
    await showPageLoader({
      content: document.querySelectorAll("#top > :is(.skip, header, main, footer)"),
      load: (signal, updateProgress) => {
        const tasks = [decodeOpeningImage(hero), document.fonts.ready, ...openingImages.map(decodeOpeningImage)];
        let done = 0;
        for (const task of tasks) {
          task.finally(() => {
            done += 1;
            // Leave the final percent for the reveal.
            updateProgress(Math.min(99, done / tasks.length * 100));
          });
        }
        return Promise.all(tasks);
      },
      recover: () => {},
      beforeFade: () => root.classList.add("is-site-revealing")
    });
  } finally {
    document.dispatchEvent(new Event("site:ready"));
  }
}

revealHome();
