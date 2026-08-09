/* Homepage motion. Everything animated is gated behind the .js class, so a
   browser without scripting gets the finished page rather than a blank one. */
(function () {
  var root = document.documentElement;
  root.classList.add('js');

  // stagger index for the children of a revealing section
  document.querySelectorAll('.reveal-up').forEach(function (section) {
    section.querySelectorAll('.project, .tags li, .contact .btn')
      .forEach(function (el, i) { el.style.setProperty('--i', i); });
  });

  var sections = document.querySelectorAll('.reveal-up');

  if (!('IntersectionObserver' in window)) {
    sections.forEach(function (s) { s.classList.add('in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);   // reveal once, never again
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });

  sections.forEach(function (s) { io.observe(s); });
})();
