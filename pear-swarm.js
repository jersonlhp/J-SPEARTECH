/*!
 * J&S Pear Tech — Enxame de peras voadoras
 * Ao clicar no ícone de pera (logo), várias peras com asas saem dele,
 * batem as asas, voam pela tela e desaparecem.
 *
 * - Sem dependências. Não altera o bundle React (usa delegação de eventos).
 * - Animação via requestAnimationFrame (trajetória) + CSS (bater de asas).
 * - Respeita "prefers-reduced-motion" e pausa com a aba oculta.
 */
(function () {
  'use strict';

  if (window.__jsPearSwarm) return;
  window.__jsPearSwarm = true;

  /* ------------------------------------------------------------------ */
  /* Configuração                                                        */
  /* ------------------------------------------------------------------ */
  var CONFIG = {
    countDesktop: 22,
    countMobile: 12,
    maxAlive: 60,          // limite de peras simultâneas (performance)
    cooldownMs: 350,       // evita disparos acidentais em sequência
    spawnWindowMs: 700,    // as peras "jorram" do logo ao longo desse tempo
    lifeMin: 3.2,          // segundos
    lifeMax: 5.6,
    sizeDesktop: [64, 118], // largura total do SVG (corpo + asas), em px
    sizeMobile: [50, 88]
  };

  var BADGE_SELECTOR = 'span.rounded-full[aria-hidden="true"]';
  var LOGO_LINK_SELECTOR = 'a[aria-label^="J&S Pear Tech"]';

  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* ------------------------------------------------------------------ */
  /* Estilos (injetados uma única vez)                                   */
  /* ------------------------------------------------------------------ */
  var STYLE_ID = 'jp-swarm-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.jp-stage{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;contain:strict}' +
      '.jp-pear{position:absolute;left:0;top:0;opacity:0;will-change:transform,opacity;' +
      'filter:drop-shadow(0 4px 5px rgba(0,0,0,.35))}' +
      '.jp-pear svg{display:block;width:100%;height:auto;overflow:visible}' +
      '.jp-w{transform-box:fill-box;transform-origin:0% 85%;' +
      'animation:jp-flap var(--jp-flap,.16s) ease-in-out infinite alternate;' +
      'animation-delay:var(--jp-delay,0s)}' +
      '@keyframes jp-flap{' +
      'from{transform:rotate(38deg) scaleY(.82)}' +
      'to{transform:rotate(-34deg) scaleY(1.06)}}' +
      '@media (prefers-reduced-motion:reduce){.jp-stage{display:none}}';
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* SVG da pera com asas (mesma identidade visual do logo)              */
  /* ------------------------------------------------------------------ */
  // viewBox centralizado no corpo da pera (x = 32): as asas ocupam as laterais.
  var WING_PATH =
    'M0 6C1 -8 12 -24 34 -30C32 -23 36 -21 39 -15C35 -13 35 -9 38 -3' +
    'C32 -3 28 1 24 6C19 10 7 12 0 6Z';

  var PEAR_SVG =
    '<svg viewBox="-44 -6 152 74" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    // asa esquerda (espelhada) — fica atrás do corpo
    '<g transform="translate(23 31) scale(-1 1)"><g class="jp-w">' +
    '<path d="' + WING_PATH + '" fill="url(#jp-wing-grad)" stroke="#7fcf45" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M4 4C12 -4 20 -12 30 -20" fill="none" stroke="#b8e68e" stroke-width="1.1" stroke-linecap="round"/>' +
    '</g></g>' +
    // asa direita
    '<g transform="translate(41 31)"><g class="jp-w">' +
    '<path d="' + WING_PATH + '" fill="url(#jp-wing-grad)" stroke="#7fcf45" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M4 4C12 -4 20 -12 30 -20" fill="none" stroke="#b8e68e" stroke-width="1.1" stroke-linecap="round"/>' +
    '</g></g>' +
    // folha, cabinho e corpo
    '<path d="M35 14C38 6 46 3 54 5c-2 8-8 13-17 13" fill="#2f731a"/>' +
    '<path d="M34 18c0-6 2-10 6-13" fill="none" stroke="#2f731a" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M32 15c-7 0-11 6-12 13-1 6-3 9-7 14-6 9 1 17 19 17s25-8 19-17c-4-5-6-8-7-14-1-7-5-13-12-13Z" ' +
    'fill="#a6e85f" stroke="#5aa52b" stroke-width="1.2" mask="url(#jp-bite)"/>' +
    '<circle cx="24" cy="31" r="4" fill="#dfffc4" opacity=".85"/>' +
    '</svg>';

  // Definições compartilhadas (máscara da "mordida" e degradê das asas)
  var SHARED_DEFS =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
    '<defs>' +
    '<mask id="jp-bite"><rect width="64" height="64" fill="#fff"/>' +
    '<circle cx="13" cy="37" r="7.5" fill="#000"/></mask>' +
    '<linearGradient id="jp-wing-grad" x1="0" y1="1" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#e6fbd0"/><stop offset="1" stop-color="#ffffff"/>' +
    '</linearGradient>' +
    '</defs></svg>';

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */
  var stage = null;
  var template = null;
  var pears = [];
  var rafId = 0;
  var lastFrame = 0;
  var lastLaunch = 0;

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function ensureStage() {
    injectStyle();
    if (!template) {
      var holder = document.createElement('div');
      holder.className = 'jp-pear';
      holder.innerHTML = PEAR_SVG;
      template = holder;
    }
    if (stage && stage.isConnected) return;
    stage = document.createElement('div');
    stage.className = 'jp-stage';
    stage.setAttribute('aria-hidden', 'true');
    stage.innerHTML = SHARED_DEFS;
    document.body.appendChild(stage);
  }

  function teardownStage() {
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null;
  }

  /* ------------------------------------------------------------------ */
  /* Criação das peras                                                   */
  /* ------------------------------------------------------------------ */
  function spawn(ox, oy, baseAngle, startAt, small) {
    var el = template.cloneNode(true);
    var sizeRange = small ? CONFIG.sizeMobile : CONFIG.sizeDesktop;
    var width = rand(sizeRange[0], sizeRange[1]);
    el.style.width = width + 'px';
    el.style.setProperty('--jp-flap', rand(0.12, 0.2).toFixed(3) + 's');
    el.style.setProperty('--jp-delay', '-' + rand(0, 0.2).toFixed(3) + 's');
    stage.appendChild(el);

    pears.push({
      el: el,
      w: width,
      h: width * (74 / 152),
      x: ox + rand(-6, 6),
      y: oy + rand(-6, 6),
      start: startAt,
      life: rand(CONFIG.lifeMin, CONFIG.lifeMax),
      heading: baseAngle + rand(-1.15, 1.15),   // abre em leque
      burst: rand(420, 780),                    // impulso inicial (px/s)
      cruise: rand(70, 150),                    // velocidade de cruzeiro
      lift: rand(8, 34),                        // leve tendência de subir
      turn: rand(0.9, 2.4),                     // quanto desvia no caminho
      freq: rand(1.2, 2.8),
      phase: rand(0, Math.PI * 2),
      bobAmp: rand(5, 13),
      bobFreq: rand(5, 9),
      scaleMax: rand(0.85, 1.1)
    });
  }

  /* ------------------------------------------------------------------ */
  /* Loop de animação                                                    */
  /* ------------------------------------------------------------------ */
  function frame(now) {
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    for (var i = pears.length - 1; i >= 0; i--) {
      var p = pears[i];
      var age = (now - p.start) / 1000;

      if (age < 0) continue; // ainda aguardando para "sair" do logo

      if (age >= p.life) {
        if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
        pears.splice(i, 1);
        continue;
      }

      var speed = p.cruise + (p.burst - p.cruise) * Math.exp(-age * 2.4);
      p.heading += Math.sin(age * p.freq + p.phase) * p.turn * dt;

      var vx = Math.cos(p.heading) * speed;
      var vy = Math.sin(p.heading) * speed - p.lift;
      p.x += vx * dt;
      p.y += vy * dt;

      var bob = Math.sin(age * p.bobFreq + p.phase) * p.bobAmp;
      var tilt = clamp(vx * 0.045, -16, 16) + Math.sin(age * p.bobFreq) * 5;
      var grow = easeOutBack(clamp(age / 0.38, 0, 1)) * p.scaleMax;
      var alpha = Math.min(1, age / 0.16) * clamp((p.life - age) / 1.1, 0, 1);

      p.el.style.opacity = alpha.toFixed(3);
      p.el.style.transform =
        'translate3d(' + (p.x - p.w / 2).toFixed(1) + 'px,' + (p.y + bob - p.h / 2).toFixed(1) + 'px,0) ' +
        'rotate(' + tilt.toFixed(1) + 'deg) scale(' + grow.toFixed(3) + ')';
    }

    if (pears.length > 0) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = 0;
      teardownStage();
    }
  }

  function startLoop() {
    if (rafId) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Feedback no próprio ícone                                           */
  /* ------------------------------------------------------------------ */
  function pop(badge) {
    if (!badge.animate) return;
    try {
      badge.animate(
        [
          { transform: 'scale(1) rotate(0deg)' },
          { transform: 'scale(.86) rotate(-4deg)', offset: 0.25 },
          { transform: 'scale(1.14) rotate(5deg)', offset: 0.6 },
          { transform: 'scale(1) rotate(0deg)' }
        ],
        { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' }
      );
    } catch (e) { /* animação opcional */ }
  }

  /* ------------------------------------------------------------------ */
  /* Disparo                                                             */
  /* ------------------------------------------------------------------ */
  function launch(badge) {
    if (reduceMotion.matches) return;

    var now = performance.now();
    if (now - lastLaunch < CONFIG.cooldownMs) return;
    lastLaunch = now;

    pop(badge);

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var small = vw < 640;
    var rect = badge.getBoundingClientRect();
    var ox = rect.left + rect.width / 2;
    var oy = rect.top + rect.height / 2;

    var wanted = small ? CONFIG.countMobile : CONFIG.countDesktop;
    var count = Math.min(wanted, CONFIG.maxAlive - pears.length);
    if (count <= 0) return;

    ensureStage();

    // O enxame se abre em direção ao centro da tela, como no efeito original.
    var base = Math.atan2(vh / 2 - oy, vw / 2 - ox);

    for (var i = 0; i < count; i++) {
      var startAt = now + (i / count) * CONFIG.spawnWindowMs + rand(0, 60);
      spawn(ox, oy, base, startAt, small);
    }
    startLoop();
  }

  /* ------------------------------------------------------------------ */
  /* Delegação de eventos (funciona com o React sem alterar o bundle)    */
  /* ------------------------------------------------------------------ */
  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      // Clique/toque direto no ícone (cabeçalho e rodapé).
      var badge = target.closest(BADGE_SELECTOR);
      if (badge && badge.querySelector('svg')) {
        launch(badge);
        return;
      }

      // Acessibilidade: Enter no link do logo via teclado (detail === 0).
      if (event.detail === 0) {
        var link = target.closest(LOGO_LINK_SELECTOR);
        var inner = link && link.querySelector(BADGE_SELECTOR);
        if (inner) launch(inner);
      }
    },
    true // captura: dispara mesmo se o React tratar o clique antes
  );
})();
