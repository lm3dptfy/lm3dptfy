# LM3DPTFY Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `index.html` with a split-panel hero, cinematic Bambu H2S background, circuit board trace aesthetics, sticky nav quote bar, and partner libraries moved above the fold.

**Architecture:** All changes confined to `public/index.html` and `public/style.css`. CSS is added in logical blocks. HTML is restructured section by section. JS is refactored in-place inside the existing `<script>` block. No new files, no new dependencies.

**Tech Stack:** Vanilla HTML, CSS, JavaScript. Node/Express backend untouched.

---

## File Map

| File | What changes |
|------|-------------|
| `public/style.css` | New hero layout, `.hero-left/right/circuit/scanline`, `.nav-quote-bar`, updated `.section-divider`, `.section-alt` pattern, `.mono-label`, `.step-n` monospace, `.hero-action-panels/panel` |
| `public/index.html` | Hero section replaced; nav quote bar added; libraries section moved up; JS refactored |

---

## Task 1: Update `.hero` layout and add `.hero-left`

**Files:** Modify `public/style.css:157-199`

- [ ] **Step 1: Replace the `.hero` rule and add `.hero-left`**

Find this block in `style.css` (lines 157–166):
```css
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px 160px;
  text-align: center;
}
```

Replace with:
```css
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
  text-align: left;
  overflow: hidden;
}
.hero-left {
  position: relative;
  z-index: 3;
  width: 55%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 120px 48px 80px;
}
@media (max-width: 900px) { .hero-left { width: 100%; } }
@media (max-width: 600px) { .hero-left { padding: 80px 20px 60px; } }
```

Also remove the now-redundant `.hero-content` rule (line 188 — `position: relative; z-index: 2; max-width: 860px`), and update `.hero h1`, `.hero-sub` to remove `margin: 0 auto` centering:

Find:
```css
.hero-sub { font-size: clamp(1rem, 1.6vw, 1.2rem); color: var(--ink2); max-width: 560px; margin: 0 auto 40px; font-weight: 300; line-height: 1.7; }
```
Replace with:
```css
.hero-sub { font-size: clamp(1rem, 1.6vw, 1.2rem); color: var(--ink2); max-width: 560px; margin: 0 0 32px; font-weight: 300; line-height: 1.7; }
```

- [ ] **Step 2: Commit**
```bash
cd /tmp/lm3dptfy-fix
git add public/style.css
git commit -m "style: hero row layout and hero-left panel"
```

---

## Task 2: Add `.hero-right` (Bambu H2S cinematic) to CSS

**Files:** Modify `public/style.css` — add after `.hero-left` block

- [ ] **Step 1: Add `.hero-right` CSS** after the `.hero-left` block added in Task 1:

```css
.hero-right {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 45%;
  background-image: url('/bambu-h2s.png');
  background-size: cover;
  background-position: center;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 35%);
  mask-image: linear-gradient(to right, transparent 0%, black 35%);
  opacity: .28;
  z-index: 0;
}
html[data-theme="light"] .hero-right { display: none; }
@media (max-width: 900px) { .hero-right { display: none; } }
```

- [ ] **Step 2: Commit**
```bash
git add public/style.css
git commit -m "style: cinematic Bambu H2S hero-right panel"
```

---

## Task 3: Add circuit traces and scan line CSS

**Files:** Modify `public/style.css` — add after `.hero-right` block

- [ ] **Step 1: Add `.hero-circuit` and `.hero-scanline` CSS:**

```css
.hero-circuit {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
html[data-theme="light"] .hero-circuit { opacity: .4; }

.hero-scanline {
  position: absolute;
  left: 0; right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent 0%, rgba(0,200,232,.35) 40%, rgba(0,200,232,.35) 60%, transparent 100%);
  box-shadow: 0 0 10px rgba(0,200,232,.2);
  animation: scanline 5s linear infinite;
  z-index: 2;
  pointer-events: none;
}
@keyframes scanline {
  0%   { top: 0%;   opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
html[data-theme="light"] .hero-scanline { display: none; }
```

Also remove the now-unused `.hero-scroll` and `@keyframes bounce` rules (currently lines 194–199 in original — search for `.hero-scroll {` and `@keyframes bounce`).

- [ ] **Step 2: Commit**
```bash
git add public/style.css
git commit -m "style: circuit trace layer and scan line animation"
```

---

## Task 4: Add hero action panel CSS

**Files:** Modify `public/style.css` — add after scan line block

- [ ] **Step 1: Add hero panel CSS:**

```css
.hero-action-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 32px;
  max-width: 580px;
}
@media (max-width: 768px) {
  .hero-action-panels { grid-template-columns: 1fr; }
}

.hero-panel {
  background: rgba(12,24,38,.85);
  border: 1px solid rgba(0,154,184,.25);
  border-radius: 16px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.hero-panel--primary {
  border-color: rgba(0,200,232,.5);
  background: rgba(12,24,38,.92);
}
.hero-panel-label {
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--teal-light);
  margin: 0;
}
.hero-panel-sub {
  font-size: .8rem;
  color: var(--ink3);
  font-weight: 300;
  line-height: 1.5;
  margin: 0;
}
.hero-paste-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.hero-paste-row .input {
  font-size: .82rem;
  padding: 10px 14px;
}
.hero-panel .lib-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.hero-panel .lib-row .btn {
  width: 100%;
  justify-content: flex-start;
  font-size: .72rem;
  padding: 9px 14px;
}
```

- [ ] **Step 2: Commit**
```bash
git add public/style.css
git commit -m "style: hero action panel cards"
```

---

## Task 5: Add nav quote bar, mono-label, and section texture CSS

**Files:** Modify `public/style.css`

- [ ] **Step 1: Add `.nav-quote-bar` CSS** after the `.nav-cta` block (around line 149):

```css
.nav-quote-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  max-width: 0;
  overflow: hidden;
  transition: opacity 300ms ease, max-width 300ms ease;
  flex-shrink: 0;
}
.nav-quote-bar.visible {
  opacity: 1;
  pointer-events: auto;
  max-width: 380px;
}
.nav-quote-input {
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line2);
  background: var(--bg3);
  color: var(--ink);
  font-family: var(--sans);
  font-size: .75rem;
  width: 220px;
  transition: border-color var(--t), width var(--t);
}
.nav-quote-input:focus {
  outline: none;
  border-color: var(--teal);
  box-shadow: var(--focus);
}
@media (max-width: 768px) {
  .nav-quote-input { width: 120px; }
}
```

- [ ] **Step 2: Add `.mono-label` and update `.step-n`**

Add after `.eyebrow` rule (around line 220):
```css
.mono-label {
  font-family: monospace;
  font-size: .68rem;
  color: var(--teal-light);
  letter-spacing: .18em;
  text-transform: uppercase;
  margin-bottom: 10px;
  display: block;
}
```

Find and update `.step-n` rule (around line 230):
```css
/* Before: font-family: var(--serif) */
/* After: */
.step-n { font-family: monospace; font-size: 3.5rem; font-weight: 900; color: var(--teal); opacity: .3; line-height: 1; margin-bottom: 16px; }
```

- [ ] **Step 3: Update `.section-divider` and `.section-alt`**

Find `.section-divider` (line 224) and replace:
```css
/* Before: .section-divider { width: 48px; height: 2px; ... } */
.section-divider {
  position: relative;
  width: 100%;
  height: 1px;
  background: rgba(0,154,184,.2);
  margin: 20px 0;
}
.section-divider::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--teal);
  box-shadow: 0 0 10px var(--teal);
}
```

Find `.section-alt` (line 225) and add the dot pattern:
```css
.section-alt {
  background: var(--bg2);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background-image:
    radial-gradient(circle, rgba(0,154,184,.07) 1px, transparent 1px),
    radial-gradient(circle, rgba(0,154,184,.04) 1px, transparent 1px);
  background-size: 40px 40px, 80px 80px;
  background-position: 0 0, 20px 20px;
}
```

- [ ] **Step 4: Also update `.hero-mascot`** — remove from `.hero-scroll` context; reposition as bottom decoration in `.hero-left`:

Add after `.hero-left` responsive rules:
```css
.hero-mascot {
  width: 100px;
  margin-top: 32px;
  pointer-events: none;
  filter: drop-shadow(0 0 20px rgba(0,200,232,.3));
  animation: mascot-bounce 1.6s ease-in-out infinite;
  align-self: flex-start;
}
@media (max-width: 600px) { .hero-mascot { width: 70px; } }
```

Note: The existing `.hero-mascot` rule and `@keyframes mascot-bounce` near the bottom of `style.css` — **remove the old rule** (search for `.hero-mascot {` and delete the block with `width: 160px`). Keep `@keyframes mascot-bounce` in place.

- [ ] **Step 5: Commit**
```bash
git add public/style.css
git commit -m "style: nav quote bar, mono-label, section-divider node, dot pattern"
```

---

## Task 6: Replace hero HTML

**Files:** Modify `public/index.html:82-94`

- [ ] **Step 1: Replace the hero section**

Find and replace this entire block (lines 82–94):
```html
<!-- ===== HERO ===== -->

<section class="hero">
  <div class="hero-content">
    <div class="hero-eyebrow"><img src="https://flagcdn.com/24x18/us.png" alt="US Flag" style="height:14px;width:auto;border-radius:2px;flex-shrink:0;" /> Veteran Owned &amp; Operated · Ships USA Only</div>
    <h1>Let Me <em>3D Print</em><br/>That For You.</h1>
    <p class="hero-sub">Choose a design from one of our provider links below.</p>
    <div class="hero-cta-group">
      <a class="btn btn-solid" id="heroStartBtn" href="#libraries">Start Your Free Quote →</a>
      <a class="btn btn-outline" href="#how-it-works">See How It Works</a>
      <a class="btn btn-outline" href="/gallery.html">View Our Work</a>
    </div>
  </div>
  <div class="hero-scroll"><img class="hero-mascot" src="mascot.png" alt="LM3DPTFY Mascot"><span>SCROLL</span></div>
</section>
```

Replace with:
```html
<!-- ===== HERO ===== -->

<section class="hero" id="heroSection">

  <!-- Circuit board trace layer -->
  <div class="hero-circuit" aria-hidden="true">
    <svg width="100%" height="100%" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <g stroke="rgba(0,154,184,.09)" stroke-width="1" fill="none">
        <path d="M0,120 L200,120 L200,180 L400,180 L400,120 L700,120"/>
        <path d="M0,380 L150,380 L150,320 L350,320 L350,380 L600,380 L600,440 L900,440"/>
        <path d="M1200,200 L950,200 L950,260 L750,260 L750,200 L500,200"/>
        <path d="M1200,520 L1000,520 L1000,460 L800,460 L800,560 L500,560"/>
        <path d="M0,600 L180,600 L180,540 L360,540"/>
        <path d="M600,700 L600,600 L700,600 L700,500 L850,500"/>
      </g>
      <g fill="rgba(0,200,232,.3)">
        <circle cx="200" cy="120" r="3"/>
        <circle cx="400" cy="180" r="3"/>
        <circle cx="150" cy="380" r="3"/>
        <circle cx="350" cy="320" r="3"/>
        <circle cx="600" cy="380" r="3"/>
        <circle cx="950" cy="200" r="3"/>
        <circle cx="750" cy="260" r="3"/>
        <circle cx="1000" cy="520" r="3"/>
        <circle cx="800" cy="460" r="3"/>
        <circle cx="180" cy="600" r="3"/>
        <circle cx="700" cy="600" r="3"/>
      </g>
    </svg>
  </div>

  <!-- Scan line -->
  <div class="hero-scanline" aria-hidden="true"></div>

  <!-- Left content panel -->
  <div class="hero-left">
    <div class="mono-label">// start your order</div>
    <div class="hero-eyebrow"><img src="https://flagcdn.com/24x18/us.png" alt="US Flag" style="height:14px;width:auto;border-radius:2px;flex-shrink:0;" /> Veteran Owned &amp; Operated · Ships USA Only</div>
    <h1>Let Me <em>3D Print</em><br/>That For You.</h1>
    <p class="hero-sub">Choose a model from a supported library or paste a link you already have.</p>

    <div class="hero-action-panels">
      <!-- Browse panel -->
      <div class="hero-panel">
        <div class="hero-panel-label">Browse a Library</div>
        <p class="hero-panel-sub">Find a model, copy the link</p>
        <div id="heroPanelSites" class="lib-row"></div>
      </div>
      <!-- Paste panel -->
      <div class="hero-panel hero-panel--primary">
        <div class="hero-panel-label">Have a Link?</div>
        <p class="hero-panel-sub">Paste it and get a free quote</p>
        <div class="hero-paste-row">
          <input class="input" type="url" id="heroLinkInput" placeholder="Paste model URL here…" autocomplete="off" />
          <button class="btn btn-solid" id="heroQuoteBtn" type="button">Get My Free Quote →</button>
        </div>
      </div>
    </div>

    <img class="hero-mascot" src="mascot.png" alt="LM3DPTFY Mascot" />
  </div>

  <!-- Right panel — Bambu H2S cinematic background -->
  <div class="hero-right" role="presentation"></div>

</section>
```

- [ ] **Step 2: Verify hero renders** — open `http://localhost:3000` (or preview). You should see:
  - Left panel with mono-label, eyebrow, headline, two action cards
  - Mascot below the cards
  - Circuit traces faintly visible across the background
  - Scan line sweeping down
  - Bambu H2S fading in on the right (desktop only)

- [ ] **Step 3: Commit**
```bash
git add public/index.html
git commit -m "feat: split-panel hero with circuit traces and Bambu H2S background"
```

---

## Task 7: Add nav quote bar HTML

**Files:** Modify `public/index.html:66-78` (inside `<nav>`)

- [ ] **Step 1: Add nav quote bar** — inside the `<nav>` block, add after the closing `</div>` of `.nav-links` (after line 77) and before the closing `</nav>`:

Find:
```html
  </div>
  </nav>
```

Replace with:
```html
  </div>
  <div class="nav-quote-bar" id="navQuoteBar">
    <input type="url" id="navQuoteInput" class="nav-quote-input" placeholder="Paste model link…" autocomplete="off" />
    <button class="btn btn-solid btn-sm" id="navQuoteBtn" type="button">Quote →</button>
  </div>
  </nav>
```

- [ ] **Step 2: Commit**
```bash
git add public/index.html
git commit -m "feat: sticky nav quote bar markup"
```

---

## Task 8: Move libraries section above How It Works

**Files:** Modify `public/index.html`

- [ ] **Step 1: Cut the libraries section** (currently after the quote banner, around lines 173–186):

Find this entire block:
```html
<!-- ===== SUPPORTED LIBRARIES ===== -->

<section class="section section-sm section-alt" id="libraries">
  <div class="container">
    <div style="border:1px solid var(--line2);border-radius:20px;background:var(--bg2);padding:48px 56px;">
    <span class="eyebrow">Browse & Submit</span>
    <h2 class="section-title">Supported Model Libraries</h2>
    <div class="section-divider"></div>
    <p class="section-body" style="margin-bottom:8px;">Find your model on a supported library, copy the link, and paste it in the quote form. Don't see your library? Submit anyway — we'll confirm compatibility.</p>
    <div id="sitesList" class="lib-row"></div>
    <div id="sitesEmpty" style="display:none;color:var(--ink3);font-size:.88rem;margin-top:10px;">No libraries configured yet — paste any link and we'll check it out.</div>
    </div>
  </div>
</section>
```

Replace it with an updated version and **paste it immediately after the closing `</section>` of the hero** (after the `</section>` tag of `#heroSection`). Updated copy:

```html
<!-- ===== MODEL LIBRARIES ===== -->

<section class="section section-sm section-alt" id="libraries">
  <div class="container">
    <div style="border:1px solid var(--line2);border-radius:20px;background:var(--bg2);padding:48px 56px;">
    <span class="eyebrow">Browse &amp; Submit</span>
    <h2 class="section-title">Browse Model Libraries</h2>
    <div class="section-divider"></div>
    <p class="section-body" style="margin-bottom:16px;">Find your model on a supported library, copy the link, then paste it above to get a quote. Don't see your library? Submit anyway — we'll confirm compatibility.</p>
    <div id="sitesList" class="lib-row"></div>
    <div id="sitesEmpty" style="display:none;color:var(--ink3);font-size:.88rem;margin-top:10px;">No libraries configured yet — paste any link and we'll check it out.</div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Commit**
```bash
git add public/index.html
git commit -m "feat: move libraries section above the fold"
```

---

## Task 9: Update JavaScript

**Files:** Modify `public/index.html` — the `<script>` block at the bottom

- [ ] **Step 1: Refactor `loadSites()` to accept `listId` and `emptyId`**

Find the entire `loadSites` function (lines 432–461) and replace with:
```js
  async function loadSites(listId, emptyId) {
    const list  = document.getElementById(listId);
    const empty = emptyId ? document.getElementById(emptyId) : null;
    if (!list) return;
    list.innerHTML = '';
    if (empty) empty.style.display = 'none';
    try {
      const res   = await fetch('/api/public/sites', { headers: { Accept: 'application/json' }, redirect: 'follow' });
      const data  = await res.json().catch(() => ({}));
      const sites = Array.isArray(data.sites) ? data.sites : [];
      if (!sites.length) { if (empty) empty.style.display = 'block'; return; }
      sites.forEach(s => {
        const a = document.createElement('a');
        a.href = s.browseUrl || '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'btn btn-outline btn-sm';
        a.textContent = s.name || 'Library';
        if (!s.browseUrl) { a.style.opacity = '.5'; a.style.pointerEvents = 'none'; }
        list.appendChild(a);
      });
    } catch {
      const fallback = [{name:'STLFlix', browseUrl:'https://platform.stlflix.com/explore'}];
      fallback.forEach(s => {
        const a = document.createElement('a');
        a.href = s.browseUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'btn btn-outline btn-sm';
        a.textContent = s.name;
        list.appendChild(a);
      });
    }
  }
  loadSites('sitesList', 'sitesEmpty');
  loadSites('heroPanelSites', null);
```

- [ ] **Step 2: Update the scroll handler** to show/hide the nav quote bar.

Find the existing scroll handler:
```js
  const nav = document.getElementById('mainNav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
```

Replace with:
```js
  const nav = document.getElementById('mainNav');
  const heroSection = document.getElementById('heroSection');
  const navQuoteBar = document.getElementById('navQuoteBar');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
    if (heroSection && navQuoteBar) {
      navQuoteBar.classList.toggle('visible', heroSection.getBoundingClientRect().bottom < 0);
    }
  }, { passive: true });
```

- [ ] **Step 3: Add `heroQuoteBtn` click handler** — add after the existing `heroCta` handler block:

```js
  // Hero panel quote button
  const heroQuoteBtn = document.getElementById('heroQuoteBtn');
  if (heroQuoteBtn) {
    heroQuoteBtn.addEventListener('click', () => {
      const link = (document.getElementById('heroLinkInput').value || '').trim();
      window.location.href = link
        ? '/request.html?link=' + encodeURIComponent(link)
        : '/request.html';
    });
  }

  // Nav quote bar button
  const navQBtn = document.getElementById('navQuoteBtn');
  if (navQBtn) {
    navQBtn.addEventListener('click', () => {
      const link = (document.getElementById('navQuoteInput').value || '').trim();
      window.location.href = link
        ? '/request.html?link=' + encodeURIComponent(link)
        : '/request.html';
    });
  }
```

- [ ] **Step 4: Commit**
```bash
git add public/index.html
git commit -m "feat: loadSites refactor, nav quote bar JS, heroQuoteBtn handler"
```

---

## Task 10: Final cleanup and push

**Files:** `public/index.html`, `public/style.css`

- [ ] **Step 1: Remove leftover dead CSS** from `style.css`:
  - Find and delete `.hero-cta-group` rule (no longer used — buttons removed from hero)
  - Find and delete `.hero-scroll` rule (element removed)
  - Find and delete `@keyframes bounce` (was for `.hero-scroll`, no longer used)
  - Find and delete `.hero-content` rule (replaced by `.hero-left`)
  - Find and delete the old `.hero-mascot { width: 160px; ... }` block near bottom of file (keep `@keyframes mascot-bounce`)

- [ ] **Step 2: Remove leftover dead HTML** from `index.html`:
  - Confirm `id="heroStartBtn"` is gone (it was on the old `Start Your Free Quote →` button — it should already be gone after Task 6)
  - Confirm no remaining reference to `.hero-scroll` or `.hero-content` divs

- [ ] **Step 3: Bump style.css cache version** in `index.html` — change `?v=6.9` to `?v=7.0` so browsers pick up the new CSS.

Find:
```html
  <link rel="stylesheet" href="/style.css?v=6.9" />
```
Replace with:
```html
  <link rel="stylesheet" href="/style.css?v=7.0" />
```

- [ ] **Step 4: Final visual check** — open the site and verify:
  - [ ] Hero split panel renders correctly on desktop (>900px)
  - [ ] Bambu H2S printer fades in on the right side
  - [ ] Circuit traces and scan line visible in dark mode
  - [ ] Both action cards (Browse / Paste Link) work and route to `/request.html`
  - [ ] Scroll down past hero → nav quote bar slides in
  - [ ] Nav quote bar "Quote →" routes to `/request.html?link=...`
  - [ ] Libraries section appears immediately below hero
  - [ ] Section dividers show the glowing center node
  - [ ] Step numbers render in monospace
  - [ ] Mobile (<768px): printer hidden, action cards stack, nav quote bar collapses

- [ ] **Step 5: Commit and push**
```bash
git add public/index.html public/style.css
git commit -m "chore: remove dead CSS/HTML, bump style cache to v7.0"
git push origin main
```
