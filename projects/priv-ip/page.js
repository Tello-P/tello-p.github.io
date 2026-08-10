/* Behaviour for the PrivIP page: one widget, the contents rail.
   It marks whichever section currently owns the top of the viewport, so the
   rail doubles as a position indicator on a long read. Everything degrades to
   plain anchor links if this file never loads. */

const links = Array.from(document.querySelectorAll('.rail a[href^="#"]'));

if (links.length) {
  const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
  const sections = links
    .map((a) => document.getElementById(a.hash.slice(1)))
    .filter(Boolean);

  let current = null;

  const mark = (id) => {
    if (id === current) return;
    if (current) byId.get(current).classList.remove('is-current');
    current = id;
    if (current) byId.get(current).classList.add('is-current');
  };

  /* A section counts as current from the moment its top crosses the reading
     line — a quarter down the viewport — until the next one does. Tracking the
     intersection ratio instead would flip early on the short sections. */
  const pick = () => {
    const line = window.innerHeight * 0.25;
    let found = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= line) found = s;
      else break;
    }
    mark(found ? found.id : null);
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pick();
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  pick();
}
