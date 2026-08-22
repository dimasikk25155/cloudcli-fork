/* ==========================================================================
   Neo3 live layer — общий рантайм анимаций портала neo3.ru
   --------------------------------------------------------------------------
   SOURCE OF TRUTH: neo3-hub/shared/neo3.js
   Правится ТОЛЬКО здесь. Копии по origin'ам раскладывает shared/sync.sh,
   расхождения ловит shared/check-drift.mjs. Стили слоя — в shared/neo3.css
   (блок «ЖИВОЙ СЛОЙ»).

   Зачем отдельный файл, а не скрипт в каждой странице: страниц десять, они
   раздаются из четырёх мест, и десять копий одного обработчика разъезжаются
   ровно так же, как разъезжались стили до появления ядра.

   Правила слоя:
     — только transform/opacity, никакого layout за кадр;
     — ничего не ломается, если элемента на странице нет (портал разнородный);
     — идемпотентность: второй запуск не плодит вторых аврор;
     — prefers-reduced-motion выключает движение целиком, контент остаётся.

   Подключение (в конце <body>, после собственного скрипта страницы):
     <script defer src="/neo3.js"></script>
   ========================================================================== */

(function () {
  'use strict';

  if (window.__neo3Live) return;         // второй вызов — уже живём
  window.__neo3Live = true;

  var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ---------- аврора: тёплые очаги под контентом -------------------------
     Три пустых <i> — вся работа в CSS. JS нужен только чтобы не держать этот
     мусор в разметке десяти страниц. */
  function aurora() {
    if (document.querySelector('.neo3-aurora')) return;
    var box = document.createElement('div');
    box.className = 'neo3-aurora';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<i></i><i></i><i></i>';
    document.body.appendChild(box);
  }

  /* ---------- полоса прочтения + параллакс авроры -------------------------
     Один слушатель скролла на обе задачи: два независимых — это два rAF на
     кадр и дёрганый скролл на слабом телефоне.
     scaleX вместо width: ширина — это layout на каждый кадр,
     трансформ уезжает на композитор и не будит вёрстку. */
  function onScrollFx() {
    if (reduce) return;
    var bar = document.querySelector('.neo3-progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'neo3-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    var sky = document.querySelector('.neo3-aurora');
    var ticking = false;

    function draw() {
      ticking = false;
      var max = (document.documentElement.scrollHeight - innerHeight) || 1;
      bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, scrollY / max)).toFixed(4) + ')';
      if (sky) sky.style.setProperty('--sy', Math.round(scrollY));
    }
    addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(draw); }
    }, { passive: true });
    addEventListener('resize', draw, { passive: true });
    draw();
  }

  /* ---------- появление по data-anim -------------------------------------
     Свои системы reveal у страниц (.r, .seen) не трогаем — работаем строго
     по атрибуту. Каскад внутри группы задаёт data-anim-group на родителе. */
  function reveal() {
    var items = [].slice.call(document.querySelectorAll('[data-anim]'));
    if (!items.length) return;
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var group = el.closest('[data-anim-group]');
        var delay = 0;
        if (group) {
          var peers = [].slice.call(group.querySelectorAll('[data-anim]'));
          delay = Math.min(peers.indexOf(el), 8) * 80;
        }
        el.style.transitionDelay = delay + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    items.forEach(function (el) { io.observe(el); });

    /* Страховка: если наблюдатель по какой-то причине не сработал (страница
       короче порога, вкладка открыта в фоне), через 2 с показываем всё.
       Невидимый контент — худший из возможных багов анимации. */
    setTimeout(function () {
      document.querySelectorAll('[data-anim]:not(.in)').forEach(function (el) {
        el.classList.add('in');
      });
    }, 2000);
  }

  /* ---------- пятно света под курсором -----------------------------------
     Один слушатель на документ, координаты пишем только когда курсор реально
     над карточкой. На тач-устройствах слой не нужен — там нет курсора. */
  var SPOT = '[data-spot],.card,.card3,.bigcard,.tcard,.pfcard,.ucard,.chip,.focus';

  function spotlight() {
    if (reduce || matchMedia('(pointer:coarse)').matches) return;
    document.querySelectorAll(SPOT).forEach(function (el) {
      el.classList.add('neo3-spot');
    });
    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest ? e.target.closest('.neo3-spot') : null;
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  /* ---------- волна от касания кнопки ------------------------------------
     Единственная анимация слоя, которая работает и без курсора: на телефоне
     кнопка должна отвечать на палец, иначе непонятно, попал ты или нет. */
  function ripple() {
    if (reduce) return;
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest ? e.target.closest('.btn') : null;
      if (!btn) return;
      var cs = getComputedStyle(btn);
      if (cs.position === 'static') btn.style.position = 'relative';
      if (cs.overflow === 'visible') btn.style.overflow = 'hidden';
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 2.2;
      var wave = document.createElement('span');
      wave.className = 'neo3-ripple';
      wave.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:'
        + (e.clientX - r.left) + 'px;top:' + (e.clientY - r.top) + 'px';
      btn.appendChild(wave);
      setTimeout(function () { wave.remove(); }, 600);
    }, { passive: true });
  }

  function boot() {
    aurora();
    onScrollFx();
    reveal();
    spotlight();
    ripple();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
