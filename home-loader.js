import { loadImages, showPageLoader } from "./page-loader.js";

const root = document.documentElement;
const hero = document.querySelector(".stage[data-loading-src]");

async function revealHome() {
  if (!root.classList.contains("is-site-loading")) return;
  const url = hero.dataset.loadingSrc;
  const photoCopies = document.querySelectorAll(`img[data-loading-src="${url}"]:not(.stage)`);
  const openingImages = Array.from(document.images).filter(image => {
    if (!image.hasAttribute("src") && !image.hasAttribute("data-loading-src")) return false;
    const { top, right, bottom, left, width, height } = image.getBoundingClientRect();
    return width && height && bottom > 0 && top < innerHeight && right > 0 && left < innerWidth;
  });

  function setPhotoCopies(src) {
    for (const photo of photoCopies) photo.src = src;
  }

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
      load: (signal, updateProgress) => Promise.all([
        loadImages([{ image: hero, url }], signal, updateProgress).then(async () => {
          if (signal.aborted) return;
          setPhotoCopies(hero.src);
          await Promise.all(Array.from(photoCopies).filter(photo => openingImages.includes(photo)).map(decodeOpeningImage));
        }),
        document.fonts.ready,
        ...openingImages.filter(image => image.hasAttribute("src")).map(decodeOpeningImage)
      ]),
      recover: () => {
        if (!hero.naturalWidth) hero.src = url;
        setPhotoCopies(hero.src);
      },
      beforeFade: () => root.classList.add("is-site-revealing")
    });
  } finally {
    document.dispatchEvent(new Event("site:ready"));
  }
}

revealHome();
