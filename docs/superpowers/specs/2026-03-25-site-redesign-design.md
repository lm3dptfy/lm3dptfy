# LM3DPTFY Site Redesign — Design Spec

## Goal

Modernize the site's look and feel so customers never get lost — the path from landing to submitting a quote is immediate and obvious. Layer in a nerdy, techy 3D printing personality with circuit board aesthetics and the Bambu H2S as a cinematic hero background.

## Architecture

All changes are confined to `public/index.html` and `public/style.css`. No new pages, no new server routes, no backend changes. The redesign is purely frontend — HTML structure and CSS updates to the existing single-page layout.

**Tech stack:** Vanilla HTML/CSS, no JS frameworks, no new dependencies.

---

## 1. Hero Section — Full Redesign

### Layout
Replace the current centered hero with a **split-panel layout**:

- **Left half** (`.hero-left`, `55% width` on desktop): headline, eyebrow labels, two action cards
- **Right half** (`.hero-right`, `45% width` on desktop): Bambu H2S cinematic background, no text content

On mobile (`< 768px`), right half is hidden entirely; left half goes full-width single column.

### Left half — markup structure

```html
<section class="hero" id="heroSection">
  <div class="hero-left">
    <div class="mono-label">// START YOUR ORDER</div>
    <div class="hero-eyebrow">
      <img src="https://flagcdn.com/24x18/us.png" ... /> Veteran Owned &amp; Operated · Ships USA Only
    </div>
    <h1>Let Me <em>3D Print</em><br/>That For You.</h1>
    <p class="hero-sub">Choose a design from one of our partner links below.</p>

    <div class="hero-action-panels">
      <!-- Browse panel -->
      <div class="hero-panel">
        <div class="hero-panel-label">Browse a Model Library</div>
        <p class="hero-panel-sub">Find your model, copy the link</p>
        <div id="heroPanelSites" class="lib-row"></div>
      </div>
      <!-- Paste panel -->
      <div class="hero-panel hero-panel--primary">
        <div class="hero-panel-label">Already Have a Link?</div>
        <p class="hero-panel-sub">Paste it and get a free quote</p>
        <div class="hero-paste-row">
          <input class="input" type="url" id="heroLinkInput" placeholder="Paste STL / model URL here…" />
          <button class="btn btn-solid" id="heroQuoteBtn" type="button">Get Quote →</button>
        </div>
      </div>
    </div>

    <!-- Mascot moved here, bottom of left panel -->
    <img class="hero-mascot" src="mascot.png" alt="LM3DPTFY Mascot" />
  </div>

  <!-- Circuit traces SVG layer (behind everything) -->
  <div class="hero-circuit" aria-hidden="true"><!-- SVG injected below --></div>

  <!-- Animated scan line -->
  <div class="hero-scanline" aria-hidden="true"></div>

  <!-- Right panel — Bambu H2S cinematic background -->
  <div class="hero-right" role="presentation"></div>
</section>
```

**ID changes from current:**
- Old `heroLink` (in `#get-a-quote` quote banner) → stays as `heroLink`, unchanged
- Old `heroCta` (in `#get-a-quote` quote banner) → stays as `heroCta`, unchanged
- New hero panel input: `heroLinkInput` (distinct from `heroLink`)
- New hero panel button: `heroQuoteBtn` (distinct from `heroCta`)
- The `.hero-scroll` element and its SCROLL indicator / `::after` line are **removed** — the mascot is relocated to the bottom of `.hero-left` and the SCROLL affordance is removed (the split layout makes the page structure self-evident)

### Left half — JS
The `heroQuoteBtn` click handler (new):
```js
document.getElementById('heroQuoteBtn').addEventListener('click', () => {
  const link = (document.getElementById('heroLinkInput').value || '').trim();
  window.location.href = link
    ? '/request.html?link=' + encodeURIComponent(link)
    : '/request.html';
});
```

The `heroPanelSites` div uses the same `loadSites()` function already in the page — call it twice. Refactor `loadSites()` to accept two parameters: `listId` (required) and `emptyId` (optional, defaults to `null`). When `emptyId` is null the empty-state div is skipped. Call pattern:
```js
// existing libraries section — passes both IDs as before
loadSites('sitesList', 'sitesEmpty');
// new hero panel — no empty state element
loadSites('heroPanelSites', null);
```

### `.hero` CSS updates
The existing `.hero` is `position: relative; flex-direction: column`. Update to a **row layout** to support the split:
```css
.hero {
  /* keep: position: relative, min-height: 100vh, padding */
  flex-direction: row;       /* changed from column */
  align-items: stretch;      /* children fill full height */
  justify-content: flex-start;
  text-align: left;          /* changed from center */
  gap: 0;
}
```
The existing `.hero::before` (radial gradient background) and `.hero::after` (blueprint grid) pseudo-elements are **kept unchanged** — they continue to provide the base gradient and grid behind everything.

### z-index stacking order (lowest → highest)
| Element | z-index | position |
|---------|---------|----------|
| `.hero::before`, `.hero::after` (gradients/grid) | 0 | absolute |
| `.hero-right` (printer image) | 0 | absolute |
| `.hero-circuit` (SVG traces) | 1 | absolute |
| `.hero-scanline` | 2 | absolute |
| `.hero-left` (content) | 3 | relative |

`.hero-left` CSS:
```css
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

### Right half — Cinematic Bambu H2S
`.hero-right` is a full-height absolutely-positioned div covering the right 45% of the hero:
```css
.hero-right {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 45%;
  background-image: url('/bambu-h2s.png');
  background-size: cover;
  background-position: center;
  /* Dark-to-transparent gradient overlay — darkens left edge to blend with content */
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 35%);
  mask-image: linear-gradient(to right, transparent 0%, black 35%);
  opacity: .28;
  z-index: 0;
}
/* Dark mode only — hide in light mode */
html[data-theme="light"] .hero-right { display: none; }
```

### Circuit Board Traces — SVG layer
`.hero-circuit` is an `absolutely-positioned` div covering the full hero at `z-index: 0`. The SVG inside:

```svg
<svg width="100%" height="100%" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g stroke="rgba(0,154,184,.09)" stroke-width="1" fill="none">
    <!-- Horizontal traces -->
    <path d="M0,120 L200,120 L200,180 L400,180 L400,120 L700,120"/>
    <path d="M0,380 L150,380 L150,320 L350,320 L350,380 L600,380 L600,440 L900,440"/>
    <path d="M1200,200 L950,200 L950,260 L750,260 L750,200 L500,200"/>
    <path d="M1200,520 L1000,520 L1000,460 L800,460 L800,560 L500,560"/>
    <path d="M0,600 L180,600 L180,540 L360,540"/>
    <path d="M600,700 L600,600 L700,600 L700,500 L850,500"/>
  </g>
  <!-- Glowing junction nodes -->
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
```

CSS for `.hero-circuit`:
```css
.hero-circuit {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
/* Dim further in light mode */
html[data-theme="light"] .hero-circuit { opacity: .4; }
```

### Animated Scan Line
`.hero-scanline`:
```css
.hero-scanline {
  position: absolute;
  left: 0; right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent 0%, rgba(0,200,232,.35) 40%, rgba(0,200,232,.35) 60%, transparent 100%);
  box-shadow: 0 0 10px rgba(0,200,232,.2);
  animation: scanline 5s linear infinite;
  z-index: 1;
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

---

## 2. Sticky Nav Quote Bar

### Behavior
- Hidden by default (`opacity: 0`, `pointer-events: none`, `max-width: 0`)
- Becomes visible once user scrolls past `heroSection.getBoundingClientRect().bottom < 0`
- CSS transition on `opacity` and `max-width` (`300ms ease`)
- Contains: compact URL input + "Quote →" button
- On mobile (`< 768px`): input is visible but narrower (`width: 120px`); button always visible
- Button always navigates to `/request.html?link=<value>` if input has a value, else `/request.html`

### CSS
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
  max-width: 360px;
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

### Markup (added inside existing `<nav>` after `.nav-links`):
```html
<div class="nav-quote-bar" id="navQuoteBar">
  <input type="url" id="navQuoteInput" class="nav-quote-input" placeholder="Paste model link…" />
  <button class="btn btn-solid btn-sm" id="navQuoteBtn" type="button">Quote →</button>
</div>
```

### JS (added to existing scroll handler):
```js
const navQuoteBar = document.getElementById('navQuoteBar');
const heroSection = document.getElementById('heroSection');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
  if (heroSection) {
    const heroGone = heroSection.getBoundingClientRect().bottom < 0;
    navQuoteBar.classList.toggle('visible', heroGone);
  }
}, { passive: true });

document.getElementById('navQuoteBtn').addEventListener('click', () => {
  const link = (document.getElementById('navQuoteInput').value || '').trim();
  window.location.href = link
    ? '/request.html?link=' + encodeURIComponent(link)
    : '/request.html';
});
```

---

## 3. Partner Libraries Section — Move and Restyle

- Move the "Supported Model Libraries" section to **immediately below the hero**, before "How It Works"
- Rename heading to "Browse Model Libraries"
- Add subtext: "Find your model on a supported library, copy the link, then paste it above to get a quote."
- Partner buttons rendered larger (`btn-outline`, standard size, not `btn-sm`)
- Keep the dynamic `/api/public/sites` loading — now also powering the hero browse panel

---

## 4. Circuit Texture on Section Backgrounds

### Section dividers
`.section-divider` CSS updated to:
```css
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
This replaces the current `48px × 2px` filled bar. Used only in hero-area and section headers — confirmed no other uses in the codebase that would break.

### Section backgrounds
`.section-alt` gets a tiled circuit-dot pattern via CSS `background-image` (additive on top of `var(--bg2)`):
```css
.section-alt {
  background-image:
    radial-gradient(circle, rgba(0,154,184,.07) 1px, transparent 1px),
    radial-gradient(circle, rgba(0,154,184,.04) 1px, transparent 1px);
  background-size: 40px 40px, 80px 80px;
  background-position: 0 0, 20px 20px;
}
```
Subtle dot grid — visible on close inspection, invisible at a glance.

---

## 5. Typography Accents

New CSS class `.mono-label`:
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

Step numbers (`.step-n`) updated to use `font-family: monospace` — making them feel like terminal counters rather than decorative numbers.

---

## 6. What Does NOT Change

- `request.html`, `admin.html`, `gallery.html`, `server.js` — untouched
- All existing section content (pricing copy, FAQ questions, terms, who we are, footer)
- The existing quote banner in `#get-a-quote` with `heroLink` and `heroCta` IDs
- Burger menu JS and existing scroll handler logic
- All existing JS (FAQ accordion, etc.)
- Light mode CSS variables — circuit elements are scoped to dark mode or use low-opacity values that remain acceptable in light mode

---

## 7. Files Modified

| File | Changes |
|------|---------|
| `public/index.html` | Hero markup restructured; nav quote bar added; partner libs section moved up; `.hero-scroll` removed; mascot relocated; `heroSection` id added to `<section class="hero">`; monospace eyebrow label added |
| `public/style.css` | New hero split layout rules; `.hero-right` cinematic styles; `.hero-circuit` SVG container; `.hero-scanline` animation; `.nav-quote-bar` styles; updated `.section-divider`; `.section-alt` dot pattern; `.mono-label`; step-n monospace; responsive breakpoints |

---

## 8. Responsive Behavior

| Breakpoint | Behavior |
|-----------|---------|
| `> 900px` | Full split hero — left content 55%, right Bambu H2S 45%; action cards side by side |
| `768px–900px` | `.hero-right` hidden; left content full width; action cards side by side (two columns) |
| `< 768px` | `.hero-right` hidden; action cards stack vertically (single column); nav quote bar input shrinks to `width: 120px` |

---

## 9. Image Asset

- `public/bambu-h2s.png` — already committed to repo
- Used only in `.hero-right` as a CSS `background-image` (decorative, no `<img>` tag)
- Opacity controlled via CSS `opacity: .28` on the container
