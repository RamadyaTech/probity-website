/* ── Shared navigation: mega-menu, dropdowns, mobile ── */
(function () {
  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var menu = document.getElementById('navMenu');
  var items = document.querySelectorAll('.nav-item');

  function closeAll(except) {
    Array.prototype.forEach.call(items, function (it) {
      if (it === except) return;
      var t = it.querySelector('.nav-trigger');
      var p = it.querySelector('.mega, .drop');
      if (t) t.setAttribute('aria-expanded', 'false');
      if (p) p.classList.remove('open');
    });
  }

  if (burger && menu) {
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
      burger.classList.toggle('active');
      if (!menu.classList.contains('open')) closeAll();
    });
  }

  window.addEventListener('scroll', function () {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
  });

  Array.prototype.forEach.call(items, function (it) {
    var t = it.querySelector('.nav-trigger');
    var p = it.querySelector('.mega, .drop');
    if (!t || !p) return;
    t.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var isOpen = p.classList.contains('open');
      closeAll(it);
      if (isOpen) { p.classList.remove('open'); t.setAttribute('aria-expanded', 'false'); }
      else { p.classList.add('open'); t.setAttribute('aria-expanded', 'true'); }
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.nav-item')) closeAll();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) closeAll();
  });

  // Close mobile menu when a real link is tapped
  if (menu) {
    Array.prototype.forEach.call(menu.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('open');
        if (burger) burger.classList.remove('active');
        closeAll();
      });
    });
  }
})();
