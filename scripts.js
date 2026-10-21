(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const seg = (p, a, b) => clamp01((p - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const TAU = Math.PI * 2;
  const DEG = 180 / Math.PI;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const TIMELINE = {
    stemYellow: [0.0, 0.56],
    stemBlue: [0.05, 0.62],
    yearEnd: 0.58,
    bloomYellow: [0.58, 0.75],
    bloomBlue: [0.61, 0.78],
    card: 0.8,
    rain: 0.82,
    interactive: 0.78
  };
  const TOTAL_MS = 10500;

  const svg = $('#garden');
  const card = $('#card');
  const yearNum = $('#yearNum');
  const counter = $('#counter');
  const timelineEl = $('#timeline');
  const progressFill = $('#progressFill');
  const tooltip = $('#tooltip');
  const tooltipText = $('#tooltipText');
  const replayBtn = $('#replay');
  const crossingsLayer = $('#crossings');

  const stems = {
    yellow: {
      key: 'yellow',
      geo: $('#geoYellow'),
      path: null,
      length: 0,
      tipX: 152,
      tipY: 214,
      tilt: -9
    },
    blue: {
      key: 'blue',
      geo: $('#geoBlue'),
      path: null,
      length: 0,
      tipX: 248,
      tipY: 214,
      tilt: 9
    }
  };

  const blooms = {
    yellow: { el: $('#bloomYellow'), glow: $('#bloomYellow .bloom-glow'), stem: stems.yellow },
    blue: { el: $('#bloomBlue'), glow: $('#bloomBlue .bloom-glow'), stem: stems.blue }
  };

  const leafDefs = [
    { id: '#leafY1', stem: 'yellow', at: 0.22, fraction: 0.08, dir: 162, scale: 0.92 },
    { id: '#leafY2', stem: 'yellow', at: 0.44, fraction: 0.62, dir: 202, scale: 1 },
    { id: '#leafB1', stem: 'blue', at: 0.29, fraction: 0.1, dir: 18, scale: 0.92 },
    { id: '#leafB2', stem: 'blue', at: 0.51, fraction: 0.66, dir: -22, scale: 1 }
  ];
  const LEAF_ANGLE = 43.8;

  let currentYear = 1;
  let rafId = 0;
  let startTime = 0;
  let interactive = false;
  let loopWarned = false;

  const timelineTicks = [];
  for (let i = 0; i < 11; i++) {
    const tick = document.createElement('i');
    timelineEl.appendChild(tick);
    timelineTicks.push(tick);
  }

  function stemUses(key) {
    return $$('[data-stem="' + key + '"]');
  }

  function buildStems() {
    Object.keys(stems).forEach(key => {
      const stem = stems[key];
      stem.path = stem.geo;
      stem.length = stem.path.getTotalLength();
      stem.uses = stemUses(key);
      const dash = stem.length.toFixed(2);
      stem.path.style.strokeDasharray = dash;
      stem.path.style.strokeDashoffset = dash;
      stem.uses.forEach(use => {
        use.style.strokeDasharray = dash;
        use.style.strokeDashoffset = dash;
      });
    });
  }

  function setStemGrowth(stem, growth) {
    const g = clamp01(growth);
    const offset = (stem.length * (1 - g)).toFixed(2);
    stem.path.style.strokeDashoffset = offset;
    stem.uses.forEach(use => { use.style.strokeDashoffset = offset; });
    if (g > 0.0005) {
      const tip = stem.path.getPointAtLength(stem.length * g);
      stem.tipX = tip.x;
      stem.tipY = tip.y;
    }
  }

  function stemAngleAt(stem, growth) {
    const g = clamp01(growth);
    const back = stem.path.getPointAtLength(stem.length * Math.max(0, g - 0.006));
    const tip = stem.path.getPointAtLength(stem.length * g);
    return Math.atan2(tip.y - back.y, tip.x - back.x) * DEG;
  }

  function samplePath(path, steps) {
    const len = path.getTotalLength();
    const pts = new Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      const s = (len * i) / steps;
      const p = path.getPointAtLength(s);
      pts[i] = { x: p.x, y: p.y, s: s };
    }
    return pts;
  }

  function findCrossings(a, b, eps) {
    const hits = [];
    const limit = eps * eps;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        const dx = a[i].x - b[j].x;
        const dy = a[i].y - b[j].y;
        if (dx * dx + dy * dy < limit) {
          hits.push({ x: (a[i].x + b[j].x) / 2, y: (a[i].y + b[j].y) / 2 });
        }
      }
    }
    const clusters = [];
    hits.forEach(h => {
      let target = null;
      for (let i = 0; i < clusters.length; i++) {
        if (Math.hypot(clusters[i].x - h.x, clusters[i].y - h.y) < 18) { target = clusters[i]; break; }
      }
      if (target) {
        target.x = (target.x + h.x) / 2;
        target.y = (target.y + h.y) / 2;
      } else {
        clusters.push({ x: h.x, y: h.y });
      }
    });
    return clusters.sort((p, q) => q.y - p.y);
  }

  function buildCrossings() {
    const yellow = samplePath(stems.yellow.path, 420);
    const blue = samplePath(stems.blue.path, 420);
    const found = findCrossings(yellow, blue, 2.6);
    found.forEach((cross, index) => {
      if (index % 2 === 0) return;
      const clipId = 'clipCross' + index;
      const clip = document.createElementNS(SVG_NS, 'clipPath');
      clip.setAttribute('id', clipId);
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', cross.x.toFixed(2));
      circle.setAttribute('cy', cross.y.toFixed(2));
      circle.setAttribute('r', '15');
      clip.appendChild(circle);
      crossingsLayer.appendChild(clip);

      const overlay = document.createElementNS(SVG_NS, 'use');
      overlay.setAttribute('href', '#geoBlue');
      overlay.setAttribute('class', 'stem stem--blue crossing-veil');
      overlay.setAttribute('clip-path', 'url(#' + clipId + ')');
      overlay.setAttribute('data-stem', 'blue');
      overlay.style.strokeDasharray = stems.blue.length.toFixed(2);
      overlay.style.strokeDashoffset = stems.blue.length.toFixed(2);
      crossingsLayer.appendChild(overlay);
      stems.blue.uses.push(overlay);
    });
  }

  function placeLeaves() {
    leafDefs.forEach(def => {
      const el = $(def.id);
      const stem = stems[def.stem];
      const pt = stem.path.getPointAtLength(stem.length * def.fraction);
      const rot = def.dir + LEAF_ANGLE;
      el.dataset.pos = 'translate(' + pt.x.toFixed(2) + ' ' + pt.y.toFixed(2) + ')';
      el.dataset.rot = rot.toFixed(2);
      el.dataset.size = def.scale.toFixed(3);
      el.setAttribute('transform', leafTransform(el, 0));
    });
  }

  function leafTransform(el, factor) {
    const size = (parseFloat(el.dataset.size) || 1) * factor;
    return el.dataset.pos + ' rotate(' + el.dataset.rot + ') scale(' + size.toFixed(3) + ')';
  }

  function updateLeaves(p) {
    leafDefs.forEach(def => {
      const el = $(def.id);
      const t = seg(p, def.at, def.at + 0.09);
      el.setAttribute('transform', leafTransform(el, easeOutBack(t)));
      el.style.opacity = String(clamp01(seg(p, def.at, def.at + 0.05)));
    });
  }

  function updateBlooms(p) {
    Object.keys(blooms).forEach(key => {
      const bloom = blooms[key];
      const stem = bloom.stem;
      const range = TIMELINE['bloom' + key.charAt(0).toUpperCase() + key.slice(1)];
      const open = seg(p, range[0], range[1]);
      const growth = clamp01(stem.growth || 0);
      const bud = 0.14 + 0.2 * growth;
      const sx = bud + (1 - bud) * easeOutBack(open);
      const sy = lerp(bud * 0.92, 1, easeOutCubic(open));
      const rot = stemAngleAt(stem, growth) + 90 + stem.tilt;
      bloom.el.setAttribute('transform',
        'translate(' + stem.tipX.toFixed(2) + ' ' + stem.tipY.toFixed(2) + ') ' +
        'rotate(' + rot.toFixed(2) + ') ' +
        'scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ')');
      bloom.el.style.opacity = growth > 0.015 ? '1' : '0';
      const flash = Math.sin(Math.PI * clamp01(open * 1.1));
      bloom.glow.setAttribute('opacity', (flash * 0.95).toFixed(3));
    });
  }

  function setTicks(year) {
    timelineTicks.forEach((tick, i) => {
      tick.classList.toggle('is-done', i < year - 1);
      tick.classList.toggle('is-active', i === year - 1);
    });
  }

  function updateCounter(p) {
    const year = clamp01((p - 0.02) / TIMELINE.yearEnd) * 10 + 1;
    const rounded = Math.min(11, Math.max(1, Math.round(year)));
    if (rounded !== currentYear) {
      currentYear = rounded;
      yearNum.textContent = String(rounded);
      counter.setAttribute('aria-label', 'Año ' + rounded + ' de 11');
      yearNum.classList.remove('is-ticking');
      void yearNum.offsetWidth;
      yearNum.classList.add('is-ticking');
      setTicks(rounded);
    }
  }

  function applyState(p) {
    const gY = easeOutCubic(seg(p, TIMELINE.stemYellow[0], TIMELINE.stemYellow[1]));
    const gB = easeOutCubic(seg(p, TIMELINE.stemBlue[0], TIMELINE.stemBlue[1]));
    stems.yellow.growth = gY;
    stems.blue.growth = gB;
    setStemGrowth(stems.yellow, gY);
    setStemGrowth(stems.blue, gB);
    updateLeaves(p);
    updateBlooms(p);
    updateCounter(p);
    progressFill.style.width = (clamp01(p) * 100).toFixed(2) + '%';
    document.documentElement.style.setProperty('--bloom', clamp01(p).toFixed(3));

    if (p >= TIMELINE.card) showCard();
    else hideCard();

    if (p >= TIMELINE.interactive && !interactive) enableInteraction();
    if (p >= TIMELINE.rain) startRain();
  }

  function showCard() {
    if (card.classList.contains('is-visible')) return;
    card.classList.add('is-visible');
    card.setAttribute('aria-hidden', 'false');
  }

  function hideCard() {
    if (!card.classList.contains('is-visible')) return;
    card.classList.remove('is-visible');
    card.setAttribute('aria-hidden', 'true');
  }

  const tooltipHost = {
    el: null,
    show(target) {
      const text = target.dataset.tip;
      if (!text) return;
      tooltipHost.el = target;
      tooltipText.textContent = '';
      const strong = document.createElement('b');
      const cut = text.indexOf(':');
      strong.textContent = cut === -1 ? text : text.slice(0, cut + 1);
      tooltipText.appendChild(strong);
      tooltipText.appendChild(document.createTextNode(cut === -1 ? '' : text.slice(cut + 1)));
      tooltip.classList.toggle('tooltip--gold', target.classList.contains('bloom--yellow'));
      tooltip.classList.toggle('tooltip--blue', target.classList.contains('bloom--blue'));
      tooltip.classList.add('is-visible');
      tooltip.setAttribute('aria-hidden', 'false');
      positionTooltip();
    },
    hide() {
      tooltipHost.el = null;
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }
  };

  function enableInteraction() {
    interactive = true;
    svg.classList.add('is-interactive');
  }

  function disableInteraction() {
    interactive = false;
    svg.classList.remove('is-interactive');
    tooltipHost.hide();
  }

  function frame(now) {
    if (!startTime) startTime = now;
    const p = clamp01((now - startTime) / TOTAL_MS);
    try {
      applyState(p);
    } catch (err) {
      if (!loopWarned) {
        loopWarned = true;
        console.warn('[11 años] se ha omitido un fotograma de la animación:', err);
      }
    }
    if (p < 1) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = 0;
    }
  }

  function play(fromStart) {
    cancelAnimationFrame(rafId);
    if (fromStart) {
      currentYear = 1;
      yearNum.textContent = '1';
      counter.setAttribute('aria-label', 'Año 1 de 11');
      yearNum.classList.remove('is-ticking');
      setTicks(1);
      progressFill.style.width = '0%';
      hideCard();
      disableInteraction();
      stopRain();
      applyState(0);
    }
    startTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function positionTooltip() {
    const target = tooltipHost.el;
    if (!target) return;
    const face = target.querySelector('.tulip') || target;
    const rect = face.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const width = box.width || 240;
    const height = box.height || 70;
    let x = rect.left + rect.width / 2 - width / 2;
    let y = rect.top - height - 16;
    if (y < 12) y = rect.bottom + 16;
    x = Math.max(12, Math.min(window.innerWidth - width - 12, x));
    y = Math.max(12, Math.min(window.innerHeight - height - 12, y));
    tooltip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function bindTooltip(target) {
    target.addEventListener('pointerenter', event => {
      if (!interactive) return;
      if (event.pointerType === 'mouse') tooltipHost.show(target);
    });
    target.addEventListener('pointerleave', event => {
      if (!interactive) return;
      if (event.pointerType === 'mouse') tooltipHost.hide();
    });
    target.addEventListener('pointerdown', event => {
      if (!interactive) return;
      event.stopPropagation();
      if (tooltipHost.el === target) tooltipHost.hide();
      else tooltipHost.show(target);
    });
    target.addEventListener('focus', () => { if (interactive) tooltipHost.show(target); });
    target.addEventListener('blur', () => { if (tooltipHost.el === target) tooltipHost.hide(); });
    target.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        tooltipHost.show(target);
      }
    });
  }

  const canvas = $('#sparkles');
  const ctx = canvas.getContext('2d');
  let rainRunning = false;
  let rainRaf = 0;
  let width = 0;
  let height = 0;
  let particles = [];
  let sprites = {};
  let lastFrame = 0;
  let rainFailed = false;

  function makeSprite(inner, mid) {
    const size = 64;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const c = off.getContext('2d');
    const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, inner);
    grad.addColorStop(0.48, mid);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, size, size);
    return off;
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.round(Math.min(110, Math.max(38, (width * height) / 22000)));
    particles = [];
    for (let i = 0; i < target; i++) particles.push(makeParticle(true));
  }

  function makeParticle(initial) {
    const gold = Math.random() < 0.55;
    return {
      x: Math.random() * width,
      y: initial ? Math.random() * height : -20 - Math.random() * 60,
      r: 0.7 + Math.random() * 2.3,
      vy: 14 + Math.random() * 26,
      sway: 6 + Math.random() * 20,
      swaySpeed: 0.25 + Math.random() * 0.5,
      phase: Math.random() * TAU,
      twinkle: 0.5 + Math.random() * 1.4,
      alpha: 0.32 + Math.random() * 0.5,
      gold: gold,
      star: Math.random() < 0.22
    };
  }

  function drawStar(p, alpha) {
    const len = p.r * 4.2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = p.gold ? 'rgba(255,236,190,0.95)' : 'rgba(214,240,255,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len, 0);
    ctx.moveTo(0, -len);
    ctx.lineTo(0, len);
    ctx.stroke();
    ctx.restore();
  }

  function rainFrame(now) {
    if (!rainRunning) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      const t = now / 1000;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.y += p.vy * dt;
        p.x += Math.sin(t * p.swaySpeed + p.phase) * p.sway * dt;
        if (p.y > height + 24) {
          const fresh = makeParticle(false);
          fresh.x = Math.random() * width;
          particles[i] = fresh;
          continue;
        }
        const twinkle = 0.55 + 0.45 * Math.sin(t * p.twinkle + p.phase);
        const alpha = p.alpha * twinkle;
        if (alpha <= 0.01) continue;
        const sprite = p.gold ? sprites.gold : sprites.blue;
        const size = p.r * 9;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
        if (p.star) drawStar(p, alpha * 0.9);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } catch (err) {
      if (!rainFailed) {
        rainFailed = true;
        rainRunning = false;
        console.warn('[11 años] la lluvia de brillitos se ha detenido:', err);
        return;
      }
    }
    if (rainRunning) rainRaf = requestAnimationFrame(rainFrame);
  }

  function startRain() {
    if (rainRunning || rainFailed || reducedMotion.matches) return;
    try {
      sprites = {
        gold: makeSprite('rgba(255,229,160,0.95)', 'rgba(246,196,83,0.28)'),
        blue: makeSprite('rgba(206,236,255,0.95)', 'rgba(110,198,255,0.28)')
      };
      lastFrame = performance.now();
      cancelAnimationFrame(rainRaf);
      rainRunning = true;
      rainRaf = requestAnimationFrame(rainFrame);
    } catch (err) {
      rainFailed = true;
      console.warn('[11 años] no se pudo iniciar la lluvia de brillitos:', err);
    }
  }

  function stopRain() {
    rainRunning = false;
    cancelAnimationFrame(rainRaf);
    rainRaf = 0;
    ctx.clearRect(0, 0, width, height);
  }

  function init() {
    buildStems();
    buildCrossings();
    placeLeaves();
    setTicks(1);
    bindTooltip(blooms.yellow.el);
    bindTooltip(blooms.blue.el);
    resizeCanvas();
    window.addEventListener('resize', () => {
      resizeCanvas();
      positionTooltip();
    });
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 220));
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest || !event.target.closest('.bloom')) tooltipHost.hide();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') tooltipHost.hide();
    });
    replayBtn.addEventListener('click', () => play(true));

    svg.classList.add('is-ready');
    requestAnimationFrame(() => {
      if (reducedMotion.matches) {
        applyState(1);
        showCard();
        enableInteraction();
      } else {
        play(false);
      }
    });
  }

  init();
})();
