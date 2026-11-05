// Sliding highlight behind the hovered nav link
const pill = document.querySelector(".nav-pill");
const glow = document.querySelector(".nav-glow");

pill.querySelectorAll("a").forEach((link) => {
  link.addEventListener("mouseenter", () => {
    glow.style.left = link.offsetLeft + "px";
    glow.style.width = link.offsetWidth + "px";
    glow.style.opacity = 1;
  });
});
pill.addEventListener("mouseleave", () => (glow.style.opacity = 0));

// Gentle mouse parallax on the floating elements
const floaters = document.querySelectorAll("[data-depth]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduceMotion) {
  window.addEventListener("mousemove", (e) => {
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    floaters.forEach((el) => {
      const d = Number(el.dataset.depth);
      const rot = getComputedStyle(el).getPropertyValue("--rot") || "0deg";
      el.style.transform = `translate(${x * d}px, ${y * d}px) rotate(${rot})`;
    });
  });
}

// Quick-capture box types out example thoughts
const captureEl = document.getElementById("capture-text");
const THOUGHTS = ["Call mom about Sunday", "Idea: podcast on slow living", "Book dentist appointment", "Read chapter 4 tonight"];
let thought = 0;
let char = 0;
let deleting = false;

function typeLoop() {
  const text = THOUGHTS[thought];
  char += deleting ? -1 : 1;
  captureEl.textContent = text.slice(0, char);
  let delay = deleting ? 28 : 65;
  if (!deleting && char === text.length) { deleting = true; delay = 1600; }
  else if (deleting && char === 0) { deleting = false; thought = (thought + 1) % THOUGHTS.length; delay = 400; }
  setTimeout(typeLoop, delay);
}
if (reduceMotion) captureEl.textContent = THOUGHTS[0];
else typeLoop();

// Focus timer: a real 25-minute countdown you can start and pause
const FOCUS_SECS = 25 * 60;
const RING = 2 * Math.PI * 52;
const ring = document.getElementById("timer-ring");
const timerText = document.getElementById("timer-text");
const timerBtn = document.getElementById("timer-btn");
let remaining = FOCUS_SECS;
let ticking = null;

function drawTimer() {
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  timerText.textContent = `${m}:${String(s).padStart(2, "0")}`;
  ring.style.strokeDashoffset = RING * (1 - remaining / FOCUS_SECS);
}

timerBtn.addEventListener("click", () => {
  if (ticking) {
    clearInterval(ticking);
    ticking = null;
    timerBtn.textContent = "Resume focus";
    return;
  }
  if (remaining === 0) remaining = FOCUS_SECS;
  timerBtn.textContent = "Pause";
  ticking = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    drawTimer();
    if (remaining === 0) {
      clearInterval(ticking);
      ticking = null;
      timerBtn.textContent = "Start again";
    }
  }, 1000);
});
drawTimer();

// Pricing: monthly / yearly switch
document.querySelector(".billing").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const period = btn.dataset.period;
  document.querySelectorAll(".billing button").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".price b[data-monthly]").forEach((b) => {
    const v = Number(b.dataset[period]);
    b.textContent = "$" + (Number.isInteger(v) ? v : v.toFixed(2));
  });
});

// Back-to-top button: appears once you've scrolled past the hero
const toTop = document.getElementById("to-top");
window.addEventListener("scroll", () => toTop.classList.toggle("show", window.scrollY > 600), { passive: true });
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));

// Fade sections in as they scroll into view
const fadeEls = document.querySelectorAll(".section .title, .tile, .how-steps li, .orbit-wrap, .plan, .faq details, .final .btn");
fadeEls.forEach((el) => el.classList.add("fade"));
const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("in");
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
fadeEls.forEach((el) => io.observe(el));
