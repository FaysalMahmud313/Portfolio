/**
 * 3D WebGL Engine using Three.js — "Developer Desk"
 * Features:
 * - Procedurally modelled laptop (no external model files): aluminium chassis, instanced
 *   keyboard with backlight, trackpad, hinged lid, power key, status LED
 * - Minimal desk scene: graphite desk surface, wireless mouse, notebook & pen, mug,
 *   soft contact shadows, floating code fragments and ambient dust
 * - Lid opening + boot animation on first view, power off / on, screen focus (zoom),
 *   controlled drag-to-rotate, mouse parallax, idle breathing, reset view
 * - Laptop screen is a live canvas "OS" built from the real portfolio data
 *   (LaptopScreenUI) — apps link to the matching page sections and project modals
 * - Mobile / Android tier (capped pixel ratio, fewer effects), reduced-motion support,
 *   visibility throttling, WebGL context-loss recovery and a static fallback
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function getPortfolioData() {
  try {
    if (typeof currentPortfolioData !== "undefined" && currentPortfolioData) return currentPortfolioData;
  } catch (e) { /* not loaded yet */ }
  return window.DEFAULT_PORTFOLIO_DATA || {};
}

function stripLeadingEmoji(text) {
  return String(text || "").replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "").trim();
}

/* ---------- 2D canvas helpers ---------- */

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateText(ctx, text, maxW) {
  text = String(text || "");
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) {
        lines[maxLines - 1] = truncateText(ctx, lines[maxLines - 1] + " " + words.slice(i).join(" "), maxW);
        return lines;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const SANS = "Inter, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', Menlo, monospace";

// Tabs shown on the laptop screen — ids match the data-laptop-app buttons under the laptop
const SCREEN_TABS = [
  { id: "home", label: "Home", section: "#hero" },
  { id: "about", label: "About", section: "#about" },
  { id: "projects", label: "Projects", section: "#projects" },
  { id: "skills", label: "Skills", section: "#skills" },
  { id: "research", label: "Research", section: "#research" },
  { id: "leadership", label: "Leadership", section: "#experience" },
  { id: "contact", label: "Terminal", section: "#contact" }
];

function esc(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hasLink(url) {
  return !!url && url !== "#";
}

/**
 * CSS matrix3d that maps a w×h element onto an arbitrary screen-space quad
 * (top-left, top-right, bottom-right, bottom-left) — a projective "square to quad" homography.
 */
function rectToQuadMatrix(w, h, q) {
  const [x0, y0] = q[0];
  const [x1, y1] = q[1];
  const [x2, y2] = q[2];
  const [x3, y3] = q[3];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const k = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
}

/**
 * The 3D display texture: backlight states only (off, boot sequence, shutdown) plus the
 * wallpaper that sits underneath the live HTML screen (LaptopScreenDOM) while it is on.
 */
class LaptopScreenUI {
  constructor(owner, pixelWidth) {
    this.owner = owner;
    this.W = 1280;
    this.H = 800;
    this.canvas = document.createElement("canvas");
    this.canvas.width = pixelWidth;
    this.canvas.height = Math.round(pixelWidth * (this.H / this.W));
    this.scale = this.canvas.width / this.W;
    this.ctx = this.canvas.getContext("2d");

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.encoding = THREE.sRGBEncoding;
    this.texture.generateMipmaps = false; // non-power-of-two safe on WebGL1 (older Android)
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.anisotropy = Math.min(8, owner.renderer.capabilities.getMaxAnisotropy());

    this.state = "off"; // off | booting | on | shutting
    this.stateStart = 0;
    this.bootDur = owner.reducedMotion ? 500 : 2600;
    this.shutDur = owner.reducedMotion ? 250 : 650;
    this.dirty = true;
    this.brightness = 0;
    this.snapshot = null;
    this.wallpaper = null;

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { this.dirty = true; });
    }
  }

  boot(now) {
    if (this.state === "on" || this.state === "booting") return;
    this.state = "booting";
    this.stateStart = now;
    this.dirty = true;
  }

  shutdown(now) {
    if (this.state === "off" || this.state === "shutting") return;
    this.snapshot = document.createElement("canvas");
    this.snapshot.width = this.canvas.width;
    this.snapshot.height = this.canvas.height;
    this.snapshot.getContext("2d").drawImage(this.canvas, 0, 0);
    this.state = "shutting";
    this.stateStart = now;
    this.dirty = true;
  }

  get isOn() {
    return this.state === "on" || this.state === "booting";
  }

  update(now) {
    if (this.dirty || this.state === "booting" || this.state === "shutting") {
      this.dirty = false;
      this.draw(now);
      this.texture.needsUpdate = true;
    }
    return this.brightness;
  }

  draw(now) {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;

    if (this.state === "off") {
      this.drawOff();
      this.brightness = 0;
    } else if (this.state === "booting") {
      const p = clamp((now - this.stateStart) / this.bootDur, 0, 1);
      this.drawBoot(p);
      this.brightness = clamp(p / 0.15, 0, 1);
      if (p >= 1) {
        this.state = "on";
        this.dirty = true;
        this.owner.syncHud();
      }
    } else if (this.state === "shutting") {
      const p = clamp((now - this.stateStart) / this.shutDur, 0, 1);
      this.drawShutdown(p);
      this.brightness = 1 - p;
      if (p >= 1) {
        this.state = "off";
        this.snapshot = null;
        this.dirty = true;
        this.owner.syncHud();
      }
    } else {
      this.drawWallpaper();
      this.brightness = 1;
    }
  }

  drawOff() {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.fillStyle = "#030406";
    ctx.fillRect(0, 0, W, H);
    const glare = ctx.createLinearGradient(0, 0, W, H);
    glare.addColorStop(0, "rgba(255,255,255,0.055)");
    glare.addColorStop(0.32, "rgba(255,255,255,0)");
    glare.addColorStop(0.58, "rgba(255,255,255,0.025)");
    glare.addColorStop(0.7, "rgba(255,255,255,0)");
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, W, H);
    // faint power glyph so a dark screen still reads as "press to wake"
    ctx.strokeStyle = "rgba(148,163,184,0.16)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 26, -Math.PI / 2 + 0.7, Math.PI * 1.5 - 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2 - 34);
    ctx.lineTo(W / 2, H / 2 - 8);
    ctx.stroke();
  }

  bootLines() {
    const d = getPortfolioData();
    const name = (d.personal && d.personal.name) || "Developer";
    const user = name.split(" ")[0].toLowerCase();
    const projects = (d.projects || []).length;
    const areas = ((d.research && d.research.areas) || []).length;
    return [
      ["", `Faysal OS — starting ${name}'s workspace`],
      ["OK", `Mounted /home/${user}`],
      ["OK", `Loaded ${projects} projects`],
      ["OK", `Indexed ${areas} research areas`],
      ["OK", "Started portfolio.service"],
      ["", "Welcome. Use the tabs below the laptop to explore."]
    ];
  }

  drawBoot(p) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    if (p < 0.12) {
      ctx.fillStyle = `rgba(6,9,16,${p / 0.12})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }

    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, W, H);

    if (p < 0.5) {
      const q = (p - 0.12) / 0.38;
      ctx.globalAlpha = Math.min(1, q * 3);
      const cx = W / 2;
      roundRect(ctx, cx - 64, 250, 128, 128, 30);
      const g = ctx.createLinearGradient(cx - 64, 250, cx + 64, 378);
      g.addColorStop(0, "#1e3a8a");
      g.addColorStop(1, "#0b1220");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(96,165,250,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#7dd3fc";
      ctx.font = `700 46px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText("</>", cx, 330);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `700 30px ${SANS}`;
      ctx.fillText("Faysal OS", cx, 440);
      roundRect(ctx, cx - 110, 476, 220, 6, 3);
      ctx.fillStyle = "rgba(148,163,184,0.18)";
      ctx.fill();
      roundRect(ctx, cx - 110, 476, Math.max(6, 220 * easeOutCubic(q)), 6, 3);
      ctx.fillStyle = "#3b82f6";
      ctx.fill();
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
      return;
    }

    const lines = this.bootLines();
    const q = clamp((p - 0.5) / 0.33, 0, 1);
    const shown = q * lines.length;
    ctx.font = `500 24px ${MONO}`;
    for (let i = 0; i < lines.length && i < shown; i++) {
      const [tag, text] = lines[i];
      const y = 210 + i * 46;
      let x = 130;
      const portion = i + 1 > shown ? (shown - i) : 1;
      if (tag) {
        ctx.fillStyle = "#64748b";
        ctx.fillText("[", x, y);
        ctx.fillStyle = "#34d399";
        ctx.fillText("  OK  ", x + 14, y);
        ctx.fillStyle = "#64748b";
        ctx.fillText("]", x + 100, y);
        x += 130;
      }
      ctx.fillStyle = i === lines.length - 1 ? "#7dd3fc" : "#cbd5e1";
      ctx.fillText(text.slice(0, Math.ceil(text.length * portion)), x, y);
    }

    if (p > 0.85) {
      ctx.globalAlpha = (p - 0.85) / 0.15;
      this.drawWallpaper();
      ctx.globalAlpha = 1;
    }
  }

  drawShutdown(p) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (p < 0.55 && this.snapshot) {
      const k = easeInOutCubic(p / 0.55);
      const h = Math.max(4, H * (1 - k));
      ctx.globalAlpha = 1 - 0.4 * k;
      ctx.drawImage(this.snapshot, 0, (H - h) / 2, W, h);
      ctx.globalAlpha = k * 0.7;
      ctx.fillStyle = "#cfe8ff";
      ctx.fillRect(0, H / 2 - 2, W, 4);
      ctx.globalAlpha = 1;
    } else {
      const k = easeInOutCubic(clamp((p - 0.55) / 0.45, 0, 1));
      const w = W * (1 - k);
      ctx.fillStyle = `rgba(207,232,255,${1 - k})`;
      ctx.fillRect((W - w) / 2, H / 2 - 2, w, 4);
    }
  }

  /** Same palette as the HTML screen's wallpaper, so edges match while it fades in/out. */
  drawWallpaper() {
    if (!this.wallpaper) {
      const c = document.createElement("canvas");
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const ctx = c.getContext("2d");
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      const { W, H } = this;
      const base = ctx.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, "#0a1122");
      base.addColorStop(1, "#04060b");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, W * 0.5);
      glow.addColorStop(0, "rgba(59,130,246,0.24)");
      glow.addColorStop(1, "rgba(59,130,246,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(3,6,12,0.7)";
      ctx.fillRect(0, 0, W, 50);
      this.wallpaper = c;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.wallpaper, 0, 0);
    ctx.restore();
  }
}

/**
 * The live laptop screen: real, scrollable HTML laid over the 3D display.
 * Every frame the display's four corners are projected to screen space and the element is
 * mapped onto them with a matrix3d homography, so it stays locked to the screen while the
 * laptop rotates, the camera focuses or the lid moves. Content comes from data.js.
 */
class LaptopScreenDOM {
  constructor(owner) {
    this.owner = owner;
    this.root = document.getElementById("laptop-screen");
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "laptop-screen";
      this.root.className = "laptop-screen";
      owner.container.appendChild(this.root);
    }
    this.app = "home";
    this.scrollMemory = {};
    this.width = 0;
    this.height = 0;
    this.visible = false;
    this.hasShown = false;
    this.local = [
      new THREE.Vector3(-13.6, 8.5, 0.02),
      new THREE.Vector3(13.6, 8.5, 0.02),
      new THREE.Vector3(13.6, -8.5, 0.02),
      new THREE.Vector3(-13.6, -8.5, 0.02)
    ];
    this.tmp = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.center = new THREE.Vector3();

    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Laptop screen — Faysal OS");
    this.root.innerHTML = `
      <div class="ls-wallpaper" aria-hidden="true"></div>
      <div class="ls-bar">
        <div class="ls-bar-left">
          <span class="ls-logo">&lt;/&gt;</span><strong>Faysal OS</strong>
          <span class="ls-bar-sep"></span><span class="ls-bar-app" data-ls-label>Home</span>
        </div>
        <div class="ls-bar-right" aria-hidden="true">
          <svg viewBox="0 0 20 14" class="ls-ico"><path d="M2 5a12 12 0 0 1 16 0M5 8.2a7.5 7.5 0 0 1 10 0M8 11.2a3 3 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <svg viewBox="0 0 26 14" class="ls-ico ls-ico-wide"><rect x="1" y="2" width="21" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="4" width="14" height="6" rx="1" fill="#34d399"/><rect x="23" y="5" width="2" height="4" rx="1" fill="currentColor"/></svg>
          <span data-ls-clock></span>
        </div>
      </div>
      <div class="ls-scroll" tabindex="0" aria-label="Laptop screen content — scroll to read more">
        <div class="ls-page" data-ls-page aria-live="polite"></div>
      </div>
      <div class="ls-scroll-hint" aria-hidden="true"></div>`;
    this.page = this.root.querySelector("[data-ls-page]");
    this.scroller = this.root.querySelector(".ls-scroll");
    this.label = this.root.querySelector("[data-ls-label]");
    this.clock = this.root.querySelector("[data-ls-clock]");
    this.root.inert = true;
    this.root.setAttribute("aria-hidden", "true");

    this.setSize(480);
    this.bindEvents();
    this.render(false);
    this.updateClock();
    this.clockTimer = setInterval(() => { if (this.visible) this.updateClock(); }, 15000);
  }

  bindEvents() {
    const sig = { signal: this.owner.listeners.signal };
    const passiveSig = { passive: true, signal: this.owner.listeners.signal };
    // Interacting with the screen must never rotate the laptop or move the camera
    ["pointerdown", "pointermove", "pointerup", "mousemove", "mousedown"].forEach((type) => {
      this.root.addEventListener(type, (e) => {
        e.stopPropagation();
        this.owner.markScreenActive();
      }, sig);
    });
    ["wheel", "touchstart", "touchmove"].forEach((type) => {
      this.root.addEventListener(type, (e) => {
        e.stopPropagation();
        this.owner.markScreenActive();
      }, passiveSig);
    });
    this.scroller.addEventListener("scroll", () => {
      this.owner.markScreenActive();
      this.updateScrollHint();
    }, passiveSig);
    this.root.addEventListener("focusin", () => this.owner.markScreenActive(), sig);

    this.page.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ls-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-ls-action");
      if (action === "project" && typeof window.openProjectModal === "function") {
        window.openProjectModal(btn.getAttribute("data-id"));
      } else if (action === "section") {
        this.owner.scrollToSection(btn.getAttribute("data-section"));
      }
    }, sig);

    this.page.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-ls-contact]");
      if (!form) return;
      e.preventDefault();
      // same mailto composition as the page's contact form (app.js → setupContactForm)
      const p = getPortfolioData().personal || {};
      const name = form.elements.name.value || "Recruiter";
      const email = form.elements.email.value || "";
      const subject = form.elements.subject.value || "Internship / Project Inquiry";
      const message = form.elements.message.value || "";
      const recipient = p.email || "";
      window.location.href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject + " - from " + name)}&body=${encodeURIComponent(message + "\n\nSender Email: " + email)}`;
      if (typeof window.showToast === "function") window.showToast("Opening your email client to send message to " + (p.name || "Faysal") + "!");
      form.reset();
    }, sig);
  }

  setSize(w) {
    w = Math.round(clamp(w, 280, 980));
    if (Math.abs(w - this.width) < 2) return;
    this.width = w;
    this.height = Math.round(w * (17 / 27.2));
    this.root.style.width = `${this.width}px`;
    this.root.style.height = `${this.height}px`;
    this.root.style.fontSize = `${clamp(w / 38, 10.5, 16).toFixed(2)}px`;
    this.root.classList.toggle("ls-compact", w < 520);
    this.updateScrollHint();
  }

  setApp(id) {
    if (!SCREEN_TABS.some((t) => t.id === id)) return;
    if (id === this.app) {
      if (this.scroller.scrollTop > 0) this.scroller.scrollTo({ top: 0, behavior: this.owner.reducedMotion ? "auto" : "smooth" });
      return;
    }
    this.scrollMemory[this.app] = this.scroller.scrollTop;
    this.app = id;
    this.render(true);
    this.scroller.scrollTop = this.scrollMemory[id] || 0;
    this.updateScrollHint();
  }

  refresh() {
    const top = this.scroller.scrollTop;
    this.render(false);
    this.scroller.scrollTop = top;
  }

  updateClock() {
    const d = new Date();
    this.clock.textContent = `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}  ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  updateScrollHint() {
    const s = this.scroller;
    const more = s.scrollHeight - s.clientHeight - s.scrollTop > 8;
    this.root.classList.toggle("ls-has-more", more);
  }

  render(animate) {
    const d = getPortfolioData();
    const tab = SCREEN_TABS.find((t) => t.id === this.app) || SCREEN_TABS[0];
    const renderers = {
      home: () => this.homePage(d),
      about: () => this.aboutPage(d),
      projects: () => this.projectsPage(d),
      skills: () => this.skillsPage(d),
      research: () => this.researchPage(d),
      leadership: () => this.leadershipPage(d),
      contact: () => this.contactPage(d)
    };
    this.page.innerHTML = renderers[tab.id]();
    this.page.setAttribute("data-tab", tab.id);
    this.label.textContent = tab.label;
    this.page.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        const ph = document.createElement("div");
        ph.className = "ls-thumb-fallback";
        ph.textContent = img.getAttribute("data-fallback");
        img.replaceWith(ph);
      }, { once: true });
    });
    if (animate && !this.owner.reducedMotion) {
      this.page.classList.remove("ls-enter");
      void this.page.offsetWidth;
      this.page.classList.add("ls-enter");
    }
    requestAnimationFrame(() => this.updateScrollHint());
  }

  /* ---------- pages (all content from data.js) ---------- */

  head(index, title, subtitle) {
    return `
      <header class="ls-head">
        <p class="ls-eyebrow">${esc(index)}</p>
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p class="ls-head-sub">${esc(subtitle)}</p>` : ""}
      </header>`;
  }

  sectionLink(section, label) {
    return `<div class="ls-foot"><button type="button" class="ls-btn ls-btn-ghost" data-ls-action="section" data-section="${esc(section)}">${esc(label)} <span aria-hidden="true">↓</span></button></div>`;
  }

  homePage(d) {
    const p = d.personal || {};
    const parts = String(p.name || "").trim().split(/\s+/);
    const first = parts.shift() || "";
    const rest = parts.join(" ");
    const roles = String(p.role || "").split("|").map((s) => s.trim()).filter(Boolean);
    const intro = String(p.tagline || "").split(/(?<=\.)\s+/)[0];
    const stats = (p.stats || []).slice(0, 4);
    return `
      <section class="ls-home">
        <svg class="ls-home-art" viewBox="0 0 400 400" aria-hidden="true">
          <defs>
            <radialGradient id="lsArtGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stop-color="#3b82f6" stop-opacity="0.35"/>
              <stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="200" cy="200" r="190" fill="url(#lsArtGlow)"/>
          <g fill="none" stroke="#60a5fa" stroke-opacity="0.28">
            <circle cx="200" cy="200" r="70"/>
            <circle cx="200" cy="200" r="120" stroke-dasharray="2 7"/>
            <circle cx="200" cy="200" r="170" stroke-opacity="0.16"/>
            <path d="M200 30v60M200 310v60M30 200h60M310 200h60" stroke-opacity="0.2"/>
            <path d="M80 120l50 30 70-40 70 60 50-20M90 280l60-30 50 40 80-50" stroke="#93c5fd" stroke-opacity="0.35"/>
          </g>
          <g class="ls-orbit"><circle cx="320" cy="200" r="4" fill="#60a5fa"/></g>
          <g fill="#93c5fd"><circle cx="130" cy="150" r="3"/><circle cx="200" cy="110" r="3"/><circle cx="270" cy="170" r="3"/><circle cx="150" cy="250" r="3"/><circle cx="280" cy="240" r="3"/></g>
        </svg>
        <div class="ls-home-main">
          <p class="ls-kicker"><span class="ls-prompt">faysal@workspace</span>:~$ hello<span class="ls-caret" aria-hidden="true"></span></p>
          <h1 class="ls-name"><span>${esc(first)}</span> <span class="ls-name-accent">${esc(rest)}</span></h1>
          <p class="ls-sub">${roles.map(esc).join('<span class="ls-sep">·</span>')}</p>
          <p class="ls-intro">${esc(intro)}</p>
          ${p.statusBadge ? `<p class="ls-status"><span class="ls-pulse" aria-hidden="true"></span>${esc(stripLeadingEmoji(p.statusBadge))}</p>` : ""}
        </div>
        <div class="ls-widgets">
          ${stats.map((s) => `
            <div class="ls-widget">
              <span class="ls-widget-value">${esc(s.value)}</span>
              <span class="ls-widget-label">${esc(s.label)}</span>
            </div>`).join("")}
        </div>
        <p class="ls-hint">Explore with the tabs below the laptop <span aria-hidden="true">↓</span></p>
      </section>`;
  }

  aboutPage(d) {
    const p = d.personal || {};
    const edu = (d.education || [])[0];
    return `
      ${this.head("01 · Profile", "About Me")}
      <div class="ls-profile">
        <img src="${esc(p.avatar || "assets/images/demo-avatar.svg")}" alt="${esc(p.name)}" data-fallback="${esc((p.name || "").split(" ").map((s) => s[0]).join(""))}">
        <div>
          <h3>${esc(p.name)}</h3>
          <p class="ls-mono ls-accent">${esc(p.department)} · ${esc(p.university)}</p>
        </div>
      </div>
      <p class="ls-text">${esc(p.bioP1)}</p>
      <p class="ls-text">${esc(p.bioP2)}</p>
      <ul class="ls-meta">
        ${p.location ? `<li><span>Location</span>${esc(p.location)}</li>` : ""}
        ${p.email ? `<li><span>Email</span><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></li>` : ""}
        ${hasLink(p.github) ? `<li><span>GitHub</span><a href="${esc(p.github)}" target="_blank" rel="noopener">${esc(p.github)}</a></li>` : ""}
        ${hasLink(p.linkedin) ? `<li><span>LinkedIn</span><a href="${esc(p.linkedin)}" target="_blank" rel="noopener">${esc(p.linkedin)}</a></li>` : ""}
      </ul>
      ${(p.careerInterests || []).length ? `
        <h4 class="ls-subhead">Career &amp; research interests</h4>
        <div class="ls-chips">${p.careerInterests.map((i) => `<span class="ls-chip">${esc(i)}</span>`).join("")}</div>` : ""}
      ${edu ? `
        <h4 class="ls-subhead">Education</h4>
        <article class="ls-card ls-pad">
          <h3 class="ls-card-title">${esc(edu.institution)}</h3>
          <p class="ls-mono ls-accent">${esc(edu.degree)}</p>
          <p class="ls-small ls-muted">${esc(edu.duration)} · <span class="ls-green">${esc(edu.score)}</span></p>
          ${edu.description ? `<p class="ls-text">${esc(edu.description)}</p>` : ""}
          ${(edu.coursework || []).length ? `<div class="ls-chips">${edu.coursework.map((c) => `<span class="ls-chip ls-chip-dim">${esc(c)}</span>`).join("")}</div>` : ""}
        </article>` : ""}
      ${this.sectionLink("#about", "Open the full About section")}`;
  }

  projectsPage(d) {
    const projects = d.projects || [];
    return `
      ${this.head("02 · Engineering portfolio", "Projects", `${projects.length} projects · strongest first`)}
      <div class="ls-grid">
        ${projects.map((proj) => {
          const initials = String(proj.title || "").split(/\s+/).slice(0, 2).map((s) => s[0]).join("");
          return `
          <article class="ls-card ls-project">
            <div class="ls-thumb">
              ${proj.image
                ? `<img src="${esc(proj.image)}" alt="${esc(proj.title)} preview" loading="lazy" data-fallback="${esc(initials)}">`
                : `<div class="ls-thumb-fallback">${esc(initials)}</div>`}
              ${proj.status ? `<span class="ls-status-chip ls-st-${esc(proj.statusClass || "completed")}">${esc(proj.status)}</span>` : ""}
            </div>
            <div class="ls-card-body">
              <p class="ls-card-kicker">${esc(proj.categoryLabel || proj.category)}</p>
              <h3 class="ls-card-title">${esc(proj.title)}</h3>
              <p class="ls-card-text">${esc(proj.summary)}</p>
              <div class="ls-tags">${(proj.tags || []).slice(0, 4).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
              <div class="ls-actions">
                <button type="button" class="ls-btn" data-ls-action="project" data-id="${esc(proj.id)}">Details</button>
                ${hasLink(proj.github) ? `<a class="ls-btn ls-btn-ghost" href="${esc(proj.github)}" target="_blank" rel="noopener">Code ↗</a>` : ""}
                ${hasLink(proj.demo) ? `<a class="ls-btn ls-btn-ghost" href="${esc(proj.demo)}" target="_blank" rel="noopener">Live demo ↗</a>` : ""}
              </div>
            </div>
          </article>`;
        }).join("")}
      </div>
      ${this.sectionLink("#projects", "Open the full Projects section")}`;
  }

  skillsPage(d) {
    const cats = d.skills || [];
    const total = cats.reduce((n, c) => n + (c.items || []).length, 0);
    return `
      ${this.head("03 · Core competencies", "Technical Skills", `${cats.length} categories · ${total} tools & technologies`)}
      <div class="ls-grid ls-grid-wide">
        ${cats.map((cat) => `
          <article class="ls-card ls-pad">
            <h3 class="ls-card-title"><span class="ls-bullet" aria-hidden="true"></span>${esc(cat.category)}</h3>
            <div class="ls-skill-list">
              ${(cat.items || []).map((s) => `
                <div class="ls-skill"><span>${esc(s.name)}</span>${s.tag ? `<small>${esc(s.tag)}</small>` : ""}</div>`).join("")}
            </div>
          </article>`).join("")}
      </div>
      ${this.sectionLink("#skills", "Open the full Skills section")}`;
  }

  researchPage(d) {
    const r = d.research || {};
    const areas = r.areas || [];
    const pubs = r.publications || [];
    return `
      ${this.head("04 · Research", "Research & Publications", `${areas.length} focus areas · ${pubs.length} reported publications`)}
      <div class="ls-grid ls-grid-wide">
        ${areas.map((a) => `
          <article class="ls-card ls-pad">
            <h3 class="ls-card-title"><span class="ls-bullet ls-bullet-violet" aria-hidden="true"></span>${esc(a.title)}</h3>
            <p class="ls-card-text ls-noclamp">${esc(a.desc)}</p>
          </article>`).join("")}
      </div>
      ${pubs.length ? `
        <h4 class="ls-subhead">Peer-reviewed publications (reported)</h4>
        ${pubs.map((pub) => `
          <article class="ls-card ls-pad ls-pub">
            <p class="ls-card-kicker ls-violet">${esc(pub.status)}</p>
            <h3 class="ls-card-title">${esc(pub.title)}</h3>
            ${pub.authors ? `<p class="ls-mono ls-accent ls-small">${esc(pub.authors)}</p>` : ""}
            ${pub.conference ? `<p class="ls-small ls-muted">${esc(pub.conference)}${pub.year ? ` (${esc(pub.year)})` : ""}</p>` : ""}
            ${pub.focus ? `<p class="ls-text"><strong>Focus:</strong> ${esc(pub.focus)}</p>` : ""}
            ${pub.note ? `<p class="ls-small ls-muted"><em>${esc(pub.note)}</em></p>` : ""}
            ${hasLink(pub.link) ? `<a class="ls-btn ls-btn-ghost" href="${esc(pub.link)}" target="_blank" rel="noopener">View publication ↗</a>` : ""}
          </article>`).join("")}` : ""}
      ${this.sectionLink("#research", "Open the full Research section")}`;
  }

  leadershipPage(d) {
    const exp = d.experience || [];
    const certs = d.certifications || [];
    return `
      ${this.head("05 · Leadership & service", "Leadership & Activities", `${exp.length} roles · ${certs.length} achievements & competitions`)}
      ${exp.map((e) => `
        <article class="ls-card ls-pad">
          <div class="ls-row-between">
            <div>
              <h3 class="ls-card-title">${esc(e.role)}</h3>
              <p class="ls-amber ls-small">${esc(e.company)}${e.location ? ` · ${esc(e.location)}` : ""}</p>
            </div>
            <span class="ls-chip ls-chip-dim">${esc(e.duration)}</span>
          </div>
          <ul class="ls-bullets">${(e.description || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
        </article>`).join("")}
      ${certs.length ? `
        <h4 class="ls-subhead">Achievements &amp; competitions</h4>
        <ul class="ls-achievements">
          ${certs.map((c) => `
            <li>
              <strong>${esc(c.title)}</strong>
              <span>${esc(c.issuer)}${c.date ? ` · ${esc(c.date)}` : ""}</span>
              ${hasLink(c.link) ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">View ↗</a>` : ""}
            </li>`).join("")}
        </ul>` : ""}
      ${this.sectionLink("#experience", "Open the full Leadership section")}`;
  }

  contactPage(d) {
    const p = d.personal || {};
    const rows = [
      ["name", p.name],
      ["role", String(p.role || "").split("|")[0].trim()],
      ["email", p.email, p.email ? `mailto:${p.email}` : ""],
      ["location", p.location],
      ["campus", `${String(p.university || "").replace(/\s*\(.*\)/, "")} · CSE`],
      ["github", hasLink(p.github) ? p.github : "", hasLink(p.github) ? p.github : ""],
      ["linkedin", hasLink(p.linkedin) ? p.linkedin : "", hasLink(p.linkedin) ? p.linkedin : ""],
      ["status", stripLeadingEmoji(p.statusBadge)]
    ].filter((r) => r[1]);
    return `
      <div class="ls-terminal">
        <div class="ls-term-bar"><span></span><span></span><span></span><em>recruiter@faysal: ~/contact</em></div>
        <div class="ls-term-body">
          <p><span class="ls-green">recruiter@faysal:~$</span> contact --all</p>
          ${rows.map(([k, v, href]) => `
            <p class="ls-term-row"><span class="ls-term-key">${esc(k)}</span>${href
              ? `<a href="${esc(href)}"${href.startsWith("mailto:") ? "" : ' target="_blank" rel="noopener"'}>${esc(v)}</a>`
              : `<span class="${k === "status" ? "ls-green" : ""}">${esc(v)}</span>`}</p>`).join("")}
          <p><span class="ls-green">recruiter@faysal:~$</span> <span class="ls-caret" aria-hidden="true"></span></p>
        </div>
      </div>
      <h4 class="ls-subhead">Send a message</h4>
      <form class="ls-form" data-ls-contact>
        <div class="ls-form-row">
          <label>Your name<input name="name" type="text" required autocomplete="name"></label>
          <label>Your email<input name="email" type="email" required autocomplete="email"></label>
        </div>
        <label>Subject<input name="subject" type="text" required></label>
        <label>Message<textarea name="message" rows="3" required></textarea></label>
        <div class="ls-actions">
          <button type="submit" class="ls-btn">Send message</button>
          ${p.email ? `<a class="ls-btn ls-btn-ghost" href="mailto:${esc(p.email)}">Email directly ↗</a>` : ""}
        </div>
      </form>
      ${this.sectionLink("#contact", "Open the full Contact section")}`;
  }

  /* ---------- per-frame alignment ---------- */

  update(camera, display, show, settled) {
    let visible = show;
    let quad = null;
    let face = 0;

    if (visible) {
      const W = this.owner.lastWidth;
      const H = this.owner.lastHeight;
      quad = [];
      for (const v of this.local) {
        this.tmp.copy(v).applyMatrix4(display.matrixWorld);
        const camSpaceZ = this.tmp.clone().applyMatrix4(camera.matrixWorldInverse).z;
        if (camSpaceZ > -1) { visible = false; break; }
        this.tmp.project(camera);
        quad.push([(this.tmp.x + 1) / 2 * W, (1 - this.tmp.y) / 2 * H]);
      }
      if (visible) {
        this.normal.set(0, 0, 1).transformDirection(display.matrixWorld);
        display.getWorldPosition(this.center);
        const toCam = this.tmp.copy(camera.position).sub(this.center).normalize();
        face = clamp((this.normal.dot(toCam) - 0.12) * 5, 0, 1);
        if (face <= 0.02) visible = false;
      }
    }

    if (visible) {
      const edge = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
      // lay the content out at roughly its on-screen size so text stays crisp; only re-layout
      // once the camera has settled, so content doesn't reflow mid-animation
      if (!this.hasShown || (settled && Math.abs(edge - this.width) / this.width > 0.14)) {
        this.setSize(edge);
        this.hasShown = true;
      }
      const m = rectToQuadMatrix(this.width, this.height, quad);
      if (m) {
        this.root.style.transform = m;
        this.root.style.setProperty("--ls-face", face.toFixed(3));
      } else {
        visible = false;
      }
    }

    if (visible !== this.visible) {
      this.visible = visible;
      this.root.classList.toggle("is-visible", visible);
      this.root.inert = !visible;
      this.root.setAttribute("aria-hidden", String(!visible));
      if (visible) {
        this.updateClock();
        this.updateScrollHint();
      }
    }
  }

  dispose() {
    clearInterval(this.clockTimer);
  }
}

/**
 * Main scene controller — keeps the original class name / constructor so app.js is unchanged.
 */
class Portfolio3DScene {
  constructor(canvasContainerId) {
    this.container = document.getElementById(canvasContainerId);
    if (!this.container) return;
    window.portfolioScene = this;

    const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
    this.isTouch = mq("(hover: none) and (pointer: coarse)");
    this.isMobile = window.innerWidth <= 768 || this.isTouch;
    this.reducedMotion = mq("(prefers-reduced-motion: reduce)");

    this.slot = document.querySelector(".hero-3d-wrapper");
    this.listeners = new AbortController();
    this.rafId = null;
    this.isInView = true;
    this.isPageVisible = !document.hidden;
    this.contextLost = false;
    this.lastTime = performance.now();
    this.firstFrame = false;

    // interaction state
    this.pointer = { x: 0, y: 0, inside: false, dirty: false };
    this.mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    this.drag = null;
    this.userYaw = 0;
    this.userEl = 0;
    this.zoomed = false;
    this.hovered = null;
    this.scrollProgress = 0;
    this.idleK = 1; // ambient motion strength — eases to 0 while someone reads the screen
    this.screenActiveUntil = 0;

    // lid: 0 = closed, 1 = open
    this.lidOpen = 0;
    this.lidTween = null;
    this.introStarted = false;

    // smoothed camera state
    this.cam = null;
    this.layout = { cx: 0, cy: 0, fitDist: 90, zoomDist: 50 };

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: this.isMobile ? "default" : "high-performance"
      });
    } catch (e) {
      console.warn("WebGL not supported or disabled:", e);
      this.fail();
      return;
    }

    this.renderer.setPixelRatio(this.getPixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);
    this.lastWidth = width;
    this.lastHeight = height;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x070a12, 140, 320);
    this.camera = new THREE.PerspectiveCamera(32, width / height, 1, 600);

    this.setupEnvironment();
    this.setupLighting();
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.buildDesk();
    this.buildLaptop();
    this.buildAccessories();
    if (!this.isMobile) this.buildCodePanels();
    this.buildDust();

    this.screen = new LaptopScreenUI(this, this.isMobile ? 1024 : 1280);
    this.displayMat.map = this.screen.texture;
    this.displayMat.needsUpdate = true;
    this.screenDom = new LaptopScreenDOM(this);

    this.updateLayout();
    this.cam = this.desiredCamera(0);
    this.applyCamera();
    this.setupEventListeners();
    this.setupHud();
    this.syncHud();
    this.start();
  }

  fail() {
    this.container.classList.add("no-webgl");
    document.documentElement.classList.add("no-webgl");
  }

  getPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2);
  }

  /* ---------- scene building ---------- */

  setupEnvironment() {
    // Soft studio reflections for the aluminium. PMREM needs float render targets,
    // which some older Android GPUs lack — desktop only, and never fatal.
    if (this.isMobile) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new THREE.Scene();
      const room = new THREE.Mesh(
        new THREE.BoxGeometry(100, 60, 100),
        new THREE.MeshBasicMaterial({ color: 0x0b0f18, side: THREE.BackSide })
      );
      env.add(room);
      const softbox = (w, h, color, pos, rot) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        m.position.set(...pos);
        m.rotation.set(...rot);
        env.add(m);
      };
      softbox(60, 18, 0xffffff, [0, 29, 0], [Math.PI / 2, 0, 0]);
      softbox(30, 20, 0x9cc3ff, [-49, 8, 0], [0, Math.PI / 2, 0]);
      softbox(24, 14, 0x3b82f6, [0, 6, -49], [0, 0, 0]);
      softbox(40, 10, 0x8fa3bf, [49, 4, 10], [0, -Math.PI / 2, 0]);
      this.envTexture = pmrem.fromScene(env, 0.04).texture;
      this.scene.environment = this.envTexture;
      env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pmrem.dispose();
    } catch (e) {
      console.warn("Environment map unavailable:", e);
    }
  }

  setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xa8c4ff, 0x080a10, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(22, 40, 26);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x3b82f6, 1.6);
    rim.position.set(-30, 18, -32);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x94a3b8, 0.35);
    fill.position.set(-26, 12, 24);
    this.scene.add(fill);
  }

  makeCanvasTexture(size, draw) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  radialAlpha(inner = 0, outer = 0.5, size = 256) {
    return this.makeCanvasTexture(size, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, s * inner, s / 2, s / 2, s * outer);
      g.addColorStop(0, "#fff");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }

  roundedSlab(w, d, h, r, bevel = 0.2) {
    const s = new THREE.Shape();
    const x = -w / 2 + bevel;
    const y = -d / 2 + bevel;
    const iw = w - bevel * 2;
    const id = d - bevel * 2;
    const rr = Math.max(0.01, r - bevel);
    s.moveTo(x + rr, y);
    s.lineTo(x + iw - rr, y);
    s.quadraticCurveTo(x + iw, y, x + iw, y + rr);
    s.lineTo(x + iw, y + id - rr);
    s.quadraticCurveTo(x + iw, y + id, x + iw - rr, y + id);
    s.lineTo(x + rr, y + id);
    s.quadraticCurveTo(x, y + id, x, y + id - rr);
    s.lineTo(x, y + rr);
    s.quadraticCurveTo(x, y, x + rr, y);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.01, h - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: this.isMobile ? 4 : 8
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel, 0);
    return geo;
  }

  blobShadow(w, d, x, z, opacity, parent) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: this.shadowAlpha, transparent: true, opacity, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.04, z);
    mesh.renderOrder = 1;
    (parent || this.rig).add(mesh);
    return mesh;
  }

  buildDesk() {
    this.shadowAlpha = this.radialAlpha(0.05, 0.5);

    const deskTex = this.makeCanvasTexture(512, (ctx, s) => {
      ctx.fillStyle = "#1a1f29";
      ctx.fillRect(0, 0, s, s);
      // fine brushed grain
      for (let i = 0; i < 1400; i++) {
        const y = Math.random() * s;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
        ctx.fillRect(0, y, s, 1);
      }
      // faint technical grid
      ctx.strokeStyle = "rgba(96,165,250,0.07)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= s; i += 32) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
      }
    });
    deskTex.encoding = THREE.sRGBEncoding;
    deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping;
    deskTex.repeat.set(4, 3);

    const desk = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 84),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: deskTex,
        alphaMap: this.radialAlpha(0.18, 0.5),
        transparent: true,
        roughness: 0.86,
        metalness: 0.05,
        envMapIntensity: 0.25,
        depthWrite: false
      })
    );
    desk.rotation.x = -Math.PI / 2;
    desk.position.z = -4;
    desk.renderOrder = 0;
    this.rig.add(desk);

    this.blobShadow(42, 32, 0, 0, 0.75);
  }

  buildLaptop() {
    const alu = new THREE.MeshStandardMaterial({
      color: 0x1d222a,
      metalness: this.isMobile ? 0.45 : 0.85,
      roughness: 0.34,
      envMapIntensity: 0.7
    });
    this.aluMat = alu;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0c11, roughness: 0.75, metalness: 0.1 });

    const laptop = new THREE.Group();
    this.laptop = laptop;
    this.rig.add(laptop);

    const BASE_W = 30;
    const BASE_D = 21;
    const BASE_H = 1.3;

    // chassis
    this.baseMesh = new THREE.Mesh(this.roundedSlab(BASE_W, BASE_D, BASE_H, 1.3, 0.28), alu);
    laptop.add(this.baseMesh);

    // keyboard well with backlight glow between the keys
    this.deckMat = new THREE.MeshStandardMaterial({
      color: 0x07090d,
      roughness: 0.9,
      emissive: 0x2563eb,
      emissiveIntensity: 0
    });
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(26.4, 10.4), this.deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, BASE_H + 0.005, -3.5);
    laptop.add(deck);

    // keys (one instanced draw call)
    const rows = [
      { units: Array(14).fill(1), depth: 0.8 },
      { units: [...Array(13).fill(1), 1.6], depth: 1.4 },
      { units: [1.5, ...Array(12).fill(1), 1.1], depth: 1.4 },
      { units: [1.8, ...Array(11).fill(1), 1.8], depth: 1.4 },
      { units: [2.3, ...Array(10).fill(1), 2.3], depth: 1.4 },
      { units: [1, 1, 1, 1.3, 5.6, 1.3, 1, 1, 1], depth: 1.4 }
    ];
    const keyGap = 0.28;
    const kbWidth = 25.4;
    const keyMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.55, metalness: 0.15 });
    const keyGeo = new THREE.BoxGeometry(1, 0.26, 1);
    const count = rows.reduce((n, r) => n + r.units.length, 0) - 1; // last fn key is the power key
    const keys = new THREE.InstancedMesh(keyGeo, keyMat, count);
    const dummy = new THREE.Object3D();
    let z = -8.45;
    let index = 0;
    rows.forEach((row, ri) => {
      const unitSum = row.units.reduce((a, b) => a + b, 0);
      const unit = (kbWidth - keyGap * (row.units.length - 1)) / unitSum;
      let x = -kbWidth / 2;
      row.units.forEach((u, ki) => {
        const w = u * unit;
        const cx = x + w / 2;
        const cz = z + row.depth / 2;
        if (ri === 0 && ki === row.units.length - 1) {
          this.powerKeyMat = new THREE.MeshStandardMaterial({
            color: 0x15181f, roughness: 0.5, metalness: 0.2, emissive: 0x3b82f6, emissiveIntensity: 0.25
          });
          this.powerKey = new THREE.Mesh(new THREE.BoxGeometry(w, 0.26, row.depth), this.powerKeyMat);
          this.powerKey.position.set(cx, BASE_H + 0.15, cz);
          laptop.add(this.powerKey);
        } else {
          dummy.position.set(cx, BASE_H + 0.15, cz);
          dummy.scale.set(w, 1, row.depth);
          dummy.updateMatrix();
          keys.setMatrixAt(index++, dummy.matrix);
        }
        x += w + keyGap;
      });
      z += row.depth + keyGap;
    });
    keys.instanceMatrix.needsUpdate = true;
    laptop.add(keys);

    // trackpad
    const pad = new THREE.Mesh(
      this.roundedSlab(11, 6.4, 0.06, 0.5, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x232933, metalness: this.isMobile ? 0.4 : 0.7, roughness: 0.28, envMapIntensity: 0.7 })
    );
    pad.position.set(0, BASE_H - 0.02, 6.1);
    laptop.add(pad);

    // status LED on the front lip
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.08), this.ledMat);
    led.position.set(9.5, BASE_H * 0.5, BASE_D / 2 + 0.01);
    laptop.add(led);

    // hinge
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 22, 16), darkMat);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, BASE_H + 0.3, -BASE_D / 2 + 0.5);
    laptop.add(hinge);

    // lid (pivots at the hinge)
    const LID_H = 20.4;
    const LID_T = 0.6;
    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(0, BASE_H + 0.3, -BASE_D / 2 + 0.5);
    laptop.add(this.lidPivot);

    const shellGeo = this.roundedSlab(BASE_W, LID_H, LID_T, 1.3, 0.18);
    shellGeo.rotateX(Math.PI / 2);
    shellGeo.translate(0, LID_H / 2, -LID_T);
    this.lidShell = new THREE.Mesh(shellGeo, alu);
    this.lidPivot.add(this.lidShell);

    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(BASE_W - 0.9, LID_H - 0.8),
      new THREE.MeshStandardMaterial({ color: 0x040507, roughness: 0.18, metalness: 0.0, envMapIntensity: 1.2 })
    );
    bezel.position.set(0, LID_H / 2, 0.006);
    this.lidPivot.add(bezel);

    const camDot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: 0x111827 }));
    camDot.position.set(0, LID_H - 0.55, 0.012);
    this.lidPivot.add(camDot);

    this.displayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.display = new THREE.Mesh(new THREE.PlaneGeometry(27.2, 17), this.displayMat);
    this.display.position.set(0, 10.55, 0.014);
    this.lidPivot.add(this.display);

    // glowing logo on the back of the lid
    const logoTex = this.makeCanvasTexture(256, (ctx, s) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${s * 0.3}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("</>", s / 2, s / 2 + 4);
    });
    this.logoMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, alphaMap: logoTex, transparent: true, opacity: 0.25 });
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), this.logoMat);
    logo.position.set(0, LID_H / 2, -LID_T - 0.01);
    logo.rotation.y = Math.PI;
    this.lidPivot.add(logo);

    // light spill from the display onto the keyboard (desktop only)
    if (!this.isMobile) {
      this.screenLight = new THREE.PointLight(0x8ec5ff, 0, 34, 2);
      this.screenLight.position.set(0, 9, 7);
      this.lidPivot.add(this.screenLight);
    }

    this.LID_CLOSED = Math.PI / 2 - 0.012;
    this.LID_OPEN = -0.3;
    this.applyLid();
  }

  buildAccessories() {
    const matte = (color, rough = 0.6, metal = 0.2) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMapIntensity: 0.35 });

    // wireless mouse
    const mouse = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), matte(0x262b34, 0.35, this.isMobile ? 0.3 : 0.6));
    shell.scale.set(1.55, 0.72, 2.5);
    shell.position.y = 0.32;
    mouse.add(shell);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 12), matte(0x0b0d12));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 1.03, -0.9);
    mouse.add(wheel);
    const mouseLed = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.08), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }));
    mouseLed.position.set(0, 0.42, 2.42);
    this.mouseLedMat = mouseLed.material;
    mouse.add(mouseLed);
    mouse.position.set(21, 0, 5);
    mouse.rotation.y = -0.18;
    this.rig.add(mouse);
    this.blobShadow(6, 8, 21, 5.2, 0.55);

    // notebook + pen
    const book = new THREE.Group();
    const cover = new THREE.Mesh(this.roundedSlab(9.5, 13, 0.9, 0.5, 0.12), matte(0x121826, 0.9, 0.0));
    book.add(cover);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.62, 12.6), matte(0xd8d2c4, 0.95, 0));
    pages.position.set(0.12, 0.45, 0);
    book.add(pages);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.94, 13.05), matte(0x1d4ed8, 0.5, 0.1));
    band.position.set(3.4, 0.45, 0);
    book.add(band);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 9, 12), matte(0xb8c0cc, 0.25, 0.9));
    pen.rotation.z = Math.PI / 2;
    pen.rotation.y = 0.5;
    pen.position.set(-0.4, 1.12, 1.5);
    book.add(pen);
    book.position.set(-24, 0, -1);
    book.rotation.y = 0.22;
    this.rig.add(book);
    this.blobShadow(13, 16, -24, -1, 0.55);

    // mug
    const mug = new THREE.Group();
    const ceramic = matte(0x1e2430, 0.42, 0.05);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.7, 4.4, 32), ceramic);
    body.position.y = 2.2;
    mug.add(body);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(1.62, 32), matte(0x2a1a10, 0.3, 0));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 4.1;
    mug.add(coffee);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.28, 10, 22, Math.PI), ceramic);
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(1.85, 2.3, 0);
    mug.add(handle);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.87, 1.85, 0.25, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x2563eb }));
    stripe.position.y = 3.3;
    mug.add(stripe);
    mug.position.set(20, 0, -12);
    mug.rotation.y = 2.4;
    this.rig.add(mug);
    this.blobShadow(7, 7, 20, -12, 0.6);
  }

  buildCodePanels() {
    const d = getPortfolioData();
    const projectCount = (d.projects || []).length;
    const snippets = [
      { lines: [["$ ", "#34d399"], ["whoami", "#e2e8f0"], ["\n"], ["faysal_mahmud", "#7dd3fc"], [" // CSE @ AIUB", "#64748b"]], pos: [-23, 15, -13] },
      { lines: [["const ", "#c4b5fd"], ["projects", "#e2e8f0"], [" = ", "#94a3b8"], [String(projectCount), "#fbbf24"], [";", "#94a3b8"], ["\n"], ["// software · AI/ML · IoT", "#64748b"]], pos: [18, 17, -16] }
    ];
    this.codePanels = snippets.map((snip, i) => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 160;
      const ctx = c.getContext("2d");
      roundRect(ctx, 2, 2, 508, 156, 18);
      ctx.fillStyle = "rgba(8,13,24,0.78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(96,165,250,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `500 24px ${MONO}`;
      let x = 28;
      let y = 64;
      snip.lines.forEach(([text, color]) => {
        if (text === "\n") { x = 28; y += 44; return; }
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        x += ctx.measureText(text).width;
      });
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(12.8, 4),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 })
      );
      mesh.position.set(...snip.pos);
      mesh.userData = { base: snip.pos.slice(), phase: i * 2.1 };
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      return mesh;
    });
  }

  buildDust() {
    const count = this.isMobile ? 36 : 110;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 1] = Math.random() * 45;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60 - 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const sprite = this.makeCanvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(147,197,253,0.6)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.55,
      map: sprite,
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.scene.add(this.dust);
  }

  /* ---------- layout & camera ---------- */

  /**
   * Fit the desk composition into the visible part of .hero-3d-wrapper (minus the hint
   * badge and control bar). A view offset shifts the projection so the laptop is centred
   * in that slot while the canvas itself can span the whole hero.
   */
  updateLayout() {
    if (!this.camera) return;
    const cRect = this.container.getBoundingClientRect();
    const W = cRect.width || window.innerWidth;
    const H = cRect.height || window.innerHeight;
    let fit = { left: W * 0.55, top: H * 0.15, width: W * 0.4, height: H * 0.7 };

    if (this.slot) {
      const s = this.slot.getBoundingClientRect();
      const hud = this.slot.querySelector(".laptop-hud");
      const hint = this.slot.querySelector(".cyber-hint-badge");
      const bottom = hud ? hud.getBoundingClientRect().height + 16 : 0;
      const top = hint ? hint.getBoundingClientRect().height + 10 : 0;
      if (s.width && s.height) {
        fit = {
          left: s.left - cRect.left,
          top: s.top - cRect.top + top,
          width: s.width,
          height: Math.max(120, s.height - top - bottom)
        };
      }
    }

    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const extentW = this.isMobile ? 35 : 46;
    const extentH = this.isMobile ? 28 : 31;
    this.layout.cx = fit.left + fit.width / 2;
    this.layout.cy = fit.top + fit.height / 2;
    this.layout.fitDist = Math.max((H / 2) * extentW / (fit.width * tan), (H / 2) * extentH / (fit.height * tan));
    this.layout.zoomDist = Math.max((H / 2) * 27.2 / (fit.width * 0.94 * tan), (H / 2) * 17 / (fit.height * 0.96 * tan));
    this.layout.stacked = window.innerWidth <= 992;

    // fog only fades the far desk edges, whatever the camera distance
    this.scene.fog.near = this.layout.fitDist + 40;
    this.scene.fog.far = this.layout.fitDist + 220;

    this.camera.aspect = W / H;
    this.camera.setViewOffset(W, H, W / 2 - this.layout.cx, H / 2 - this.layout.cy, W, H);
    this.camera.updateProjectionMatrix();
  }

  desiredCamera(t) {
    const motion = this.reducedMotion ? 0 : 1;
    const baseYaw = this.layout.stacked ? -0.26 : -0.42;
    const desired = {};

    if (this.zoomed) {
      const target = new THREE.Vector3();
      this.display.getWorldPosition(target);
      desired.yaw = 0;
      desired.az = 0;
      desired.el = -this.LID_OPEN + 0.02;
      desired.dist = this.layout.zoomDist;
      desired.target = target;
    } else {
      desired.yaw = baseYaw + this.userYaw - this.scrollProgress * 0.45;
      const idle = motion * this.idleK;
      desired.az = (this.mouse.x * 0.09) * idle + Math.sin(t * 0.00023) * 0.025 * idle;
      desired.el = clamp(0.4 + this.userEl - this.mouse.y * 0.05 * idle, 0.08, 0.95);
      desired.dist = this.layout.fitDist;
      desired.target = new THREE.Vector3(0, 8.4 + Math.sin(t * 0.0009) * 0.18 * idle, -2.2);
    }
    return desired;
  }

  applyCamera() {
    const c = this.cam;
    this.rig.rotation.y = c.yaw;
    const cosEl = Math.cos(c.el);
    this.camera.position.set(
      c.target.x + c.dist * Math.sin(c.az) * cosEl,
      c.target.y + c.dist * Math.sin(c.el),
      c.target.z + c.dist * Math.cos(c.az) * cosEl
    );
    this.camera.lookAt(c.target);
  }

  /* ---------- lid & power ---------- */

  applyLid() {
    const closeBy = this.zoomed ? 0 : this.scrollProgress * 0.3;
    const open = this.lidOpen * (1 - closeBy);
    this.lidPivot.rotation.x = lerp(this.LID_CLOSED, this.LID_OPEN, open);
  }

  tweenLid(to, duration) {
    this.lidTween = { from: this.lidOpen, to, start: performance.now(), dur: this.reducedMotion ? Math.min(250, duration) : duration };
  }

  startIntro() {
    if (this.introStarted) return;
    this.introStarted = true;
    setTimeout(() => {
      this.tweenLid(1, 1800);
      this.pendingBoot = true;
    }, this.reducedMotion ? 0 : 450);
  }

  togglePower() {
    const now = performance.now();
    if (this.lidOpen < 0.6) {
      this.tweenLid(1, 1200);
      this.pendingBoot = true;
      this.introStarted = true;
    } else if (this.screen.isOn) {
      this.screen.shutdown(now);
      if (this.zoomed) this.setZoom(false);
    } else {
      this.screen.boot(now);
    }
    this.syncHud();
  }

  setZoom(on) {
    this.zoomed = !!on;
    if (this.zoomed) {
      this.userYaw = 0;
      if (this.lidOpen < 0.99) { this.tweenLid(1, 900); this.pendingBoot = true; }
    }
    this.syncHud();
  }

  resetView() {
    this.userYaw = 0;
    this.userEl = 0;
    this.setZoom(false);
  }

  showApp(id) {
    this.screenDom.setApp(id);
    if (!this.screen.isOn) {
      if (this.lidOpen < 0.6) this.togglePower();
      else this.screen.boot(performance.now());
    }
    this.syncHud();
  }

  scrollToSection(selector) {
    const el = document.querySelector(selector);
    if (el) el.scrollIntoView({ behavior: this.reducedMotion ? "auto" : "smooth", block: "start" });
  }

  refreshContent() {
    if (this.screenDom) this.screenDom.refresh();
  }

  /** Called by the HTML screen on any pointer / scroll / focus inside it. */
  markScreenActive() {
    this.screenActiveUntil = performance.now() + 6000;
  }

  /* ---------- HTML controls ---------- */

  setupHud() {
    const sig = { signal: this.listeners.signal };
    this.powerBtn = document.getElementById("laptop-power");
    this.zoomBtn = document.getElementById("laptop-zoom");
    this.resetBtn = document.getElementById("laptop-reset");
    this.appBtns = Array.from(document.querySelectorAll("[data-laptop-app]"));

    this.powerBtn?.addEventListener("click", () => this.togglePower(), sig);
    this.zoomBtn?.addEventListener("click", () => this.setZoom(!this.zoomed), sig);
    this.resetBtn?.addEventListener("click", () => this.resetView(), sig);
    this.appBtns.forEach((btn) => {
      btn.addEventListener("click", () => this.showApp(btn.getAttribute("data-laptop-app")), sig);
    });
  }

  syncHud() {
    if (!this.screen) return;
    const on = this.screen.isOn;
    if (this.powerBtn) {
      this.powerBtn.setAttribute("aria-pressed", String(on));
      this.powerBtn.setAttribute("aria-label", on ? "Turn laptop display off" : "Turn laptop display on");
      this.powerBtn.title = on ? "Turn display off" : "Turn display on";
      this.powerBtn.classList.toggle("is-on", on);
    }
    if (this.zoomBtn) {
      this.zoomBtn.setAttribute("aria-pressed", String(this.zoomed));
      this.zoomBtn.setAttribute("aria-label", this.zoomed ? "Exit screen focus" : "Focus the laptop screen");
      this.zoomBtn.title = this.zoomed ? "Exit focus" : "Focus screen";
    }
    this.appBtns?.forEach((btn) => {
      const active = btn.getAttribute("data-laptop-app") === this.screenDom.app;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
      if (active && btn.parentElement && btn.parentElement.scrollWidth > btn.parentElement.clientWidth) {
        const bar = btn.parentElement;
        bar.scrollTo({ left: btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2, behavior: this.reducedMotion ? "auto" : "smooth" });
      }
    });
    if (this.slot) this.slot.classList.toggle("display-off", !on);
  }

  /* ---------- input ---------- */

  setupEventListeners() {
    const sig = { signal: this.listeners.signal };
    const passive = { passive: true, signal: this.listeners.signal };
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.onWindowResize(), 120);
    }, sig);
    window.addEventListener("orientationchange", () => setTimeout(() => this.onWindowResize(), 250), sig);
    window.addEventListener("load", () => this.updateLayout(), sig);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.updateLayout());

    const el = this.container;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, type: e.pointerType };
      if (e.pointerType === "mouse") el.setPointerCapture(e.pointerId);
    }, sig);

    el.addEventListener("pointermove", (e) => {
      this.setPointer(e);
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 5) {
        this.drag.moved = true;
        if (this.zoomed) this.setZoom(false);
      }
      if (this.drag.moved) {
        this.userYaw = clamp(this.userYaw + dx * 0.006, -1.25, 1.25);
        if (this.drag.type === "mouse") this.userEl = clamp(this.userEl + dy * 0.004, -0.3, 0.45);
      }
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    }, sig);

    const endDrag = (e, cancelled) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const wasClick = !this.drag.moved && !cancelled;
      this.drag = null;
      if (wasClick) {
        this.setPointer(e);
        this.handleClick();
      }
    };
    el.addEventListener("pointerup", (e) => endDrag(e, false), sig);
    el.addEventListener("pointercancel", (e) => endDrag(e, true), sig);
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") {
        this.pointer.inside = false;
        this.pointer.dirty = true;
      }
    }, sig);

    window.addEventListener("mousemove", (e) => {
      if (this.isTouch || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
      this.mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ty = -(e.clientY / window.innerHeight) * 2 + 1;
    }, passive);

    window.addEventListener("scroll", () => {
      const heroH = this.container.offsetHeight || window.innerHeight;
      this.scrollProgress = clamp((window.scrollY || 0) / heroH, 0, 1);
    }, passive);

    if ("IntersectionObserver" in window) {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          this.isInView = entry.isIntersecting;
          if (entry.isIntersecting) this.startIntro();
          this.updatePauseState();
        });
      }, { threshold: 0.05 });
      this.observer.observe(this.container);
    } else {
      this.startIntro();
    }

    document.addEventListener("visibilitychange", () => {
      this.isPageVisible = !document.hidden;
      this.updatePauseState();
    }, sig);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stop();
    }, sig);
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this.screen.dirty = true;
      this.updatePauseState();
    }, sig);
  }

  setPointer(e) {
    const rect = this.container.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.inside = true;
    this.pointer.dirty = true;
  }

  raycast() {
    if (!this.raycaster) {
      this.raycaster = new THREE.Raycaster();
      this.ndc = new THREE.Vector2();
    }
    this.ndc.set(this.pointer.x, this.pointer.y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.display, this.powerKey, this.lidShell, this.baseMesh], false);
    return hits[0] || null;
  }

  updateHover() {
    if (!this.pointer.dirty || this.drag) return;
    this.pointer.dirty = false;
    let hovered = null;
    let interactive = false;
    if (this.pointer.inside) {
      const hit = this.raycast();
      if (hit) {
        if (hit.object === this.display && hit.uv) {
          hovered = "screen";
          interactive = this.screen.state === "off";
        } else if (hit.object === this.powerKey) {
          hovered = "power";
          interactive = true;
        } else if (this.lidOpen < 0.6) {
          hovered = "body";
          interactive = true;
        }
      }
    }
    this.hovered = hovered;
    this.container.style.cursor = interactive ? "pointer" : (this.drag ? "grabbing" : "grab");
  }

  handleClick() {
    const hit = this.raycast();
    if (!hit) return;
    if (hit.object === this.powerKey) {
      this.togglePower();
    } else if (hit.object === this.display && hit.uv) {
      if (this.screen.state === "off") this.togglePower();
    } else if (this.lidOpen < 0.6) {
      this.togglePower();
    }
  }

  /* ---------- loop ---------- */

  updatePauseState() {
    const paused = !(this.isInView && this.isPageVisible) || this.contextLost;
    if (paused) this.stop();
    else this.start();
  }

  start() {
    if (this.rafId !== null || !this.renderer) return;
    this.lastTime = performance.now();
    const loop = (t) => {
      this.rafId = requestAnimationFrame(loop);
      this.animate(t);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  onWindowResize() {
    if (!this.renderer) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    // Android fires resize when the URL bar shows/hides; the canvas height is locked to the
    // small viewport, so skip redundant (flickering) buffer reallocations.
    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.lastWidth = width;
      this.lastHeight = height;
      this.renderer.setPixelRatio(this.getPixelRatio());
      this.renderer.setSize(width, height);
    }
    this.updateLayout();
  }

  animate(now) {
    now = now || performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // lid tween + deferred boot once the lid is mostly open
    if (this.lidTween) {
      const tw = this.lidTween;
      const k = clamp((now - tw.start) / tw.dur, 0, 1);
      this.lidOpen = lerp(tw.from, tw.to, easeInOutCubic(k));
      if (k >= 1) this.lidTween = null;
    }
    if (this.pendingBoot && this.lidOpen > 0.62) {
      this.pendingBoot = false;
      this.screen.boot(now);
      this.syncHud();
    }
    this.applyLid();

    // mouse smoothing (touch devices get no hover parallax)
    this.mouse.x += (this.mouse.tx - this.mouse.x) * 0.06;
    this.mouse.y += (this.mouse.ty - this.mouse.y) * 0.06;

    // ambient motion pauses while the screen is being read / scrolled / focused
    const idleTarget = this.zoomed || now < this.screenActiveUntil ? 0 : 1;
    this.idleK += (idleTarget - this.idleK) * Math.min(1, dt * 2.5);

    // camera / rig smoothing
    const want = this.desiredCamera(now);
    const k = 1 - Math.exp(-dt * (this.zoomed ? 4 : 5));
    const c = this.cam;
    c.yaw = lerp(c.yaw, want.yaw, k);
    c.az = lerp(c.az, want.az, k);
    c.el = lerp(c.el, want.el, k);
    c.dist = lerp(c.dist, want.dist, k);
    c.target.lerp(want.target, k);
    this.applyCamera();

    // keep the live HTML screen locked onto the 3D display
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const settled = !this.drag && !this.lidTween &&
      Math.abs(c.dist - want.dist) < 0.6 && Math.abs(c.yaw - want.yaw) < 0.01 && Math.abs(c.el - want.el) < 0.01;
    this.screenDom.update(this.camera, this.display, this.screen.state === "on" && this.lidOpen > 0.97, settled);

    // screen + power-linked lighting
    const b = this.screen.update(now);
    const hoverPower = this.hovered === "power";
    this.deckMat.emissiveIntensity = 0.04 + b * 0.32;
    this.powerKeyMat.emissiveIntensity = (b > 0.5 ? 0.55 : 0.12) + (hoverPower ? 0.9 : 0);
    this.ledMat.color.setHex(b > 0.05 ? 0x60a5fa : (this.lidOpen > 0.5 ? 0x7c4a12 : 0x1e293b));
    this.logoMat.opacity = 0.12 + b * 0.35;
    this.mouseLedMat.color.setHex(b > 0.05 ? 0x3b82f6 : 0x1e293b);
    if (this.screenLight) this.screenLight.intensity = b * 0.9;

    if (this.codePanels) {
      const t = now * 0.001;
      this.codePanels.forEach((m) => {
        const { base, phase } = m.userData;
        m.position.y = base[1] + (this.reducedMotion ? 0 : Math.sin(t * 0.8 + phase) * 0.6);
        m.quaternion.copy(this.camera.quaternion);
        const targetOpacity = this.zoomed ? 0 : b * 0.92;
        m.material.opacity += (targetOpacity - m.material.opacity) * 0.08;
        m.visible = m.material.opacity > 0.01;
      });
    }

    if (this.dust && !this.reducedMotion) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * 0.9;
        if (y > 45) y = 0;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }

    this.updateHover();
    this.renderer.render(this.scene, this.camera);

    if (!this.firstFrame) {
      this.firstFrame = true;
      if (this.slot) this.slot.classList.add("scene-ready");
    }
  }

  /** Release GPU resources and listeners (the page never needs this, but it keeps the class clean to reuse). */
  dispose() {
    this.stop();
    this.listeners.abort();
    if (this.screenDom) this.screenDom.dispose();
    if (this.observer) this.observer.disconnect();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m) => {
        ["map", "alphaMap", "emissiveMap"].forEach((k) => m[k] && m[k].dispose());
        m.dispose();
      });
    });
    if (this.envTexture) this.envTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// Global initialization hook
window.Portfolio3DScene = Portfolio3DScene;
