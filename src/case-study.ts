/**
 * Case study enhancements. The page is complete without this file; the script
 * only adds the reading-progress line and a small scrolled state for the bar.
 */

const progressFill = document.querySelector<HTMLElement>("#cs-progress-fill");
const topbar = document.querySelector<HTMLElement>(".cs-topbar");

let frame = 0;

function update(): void {
  const root = document.documentElement;
  const max = root.scrollHeight - window.innerHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;

  if (progressFill) {
    progressFill.style.transform = `scaleX(${ratio})`;
  }

  if (topbar) {
    topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  }
}

function schedule(): void {
  if (frame !== 0) return;
  frame = window.requestAnimationFrame(() => {
    frame = 0;
    update();
  });
}

window.addEventListener("scroll", schedule, { passive: true });
window.addEventListener("resize", schedule);
window.addEventListener("load", schedule);
window.addEventListener("pageshow", schedule);

if (document.fonts) {
  void document.fonts.ready.then(schedule);
}

update();
