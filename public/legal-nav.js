// Termos ⇄ Privacidade sem recarregar a página: a pílula do menu desliza até o item escolhido,
// o cartão branco fica parado e só o texto dentro dele troca (sai para um lado, entra do outro),
// com a altura do cartão acompanhando. Âncoras (#cookies etc.) rolam suavemente até o destino.
(() => {
  const nav = document.querySelector('.lgl-nav');
  const ind = nav?.querySelector('.lgl-nav-ind');
  const card = document.querySelector('.lgl-card');
  const body = card?.querySelector('.lgl-body');
  if (!nav || !ind || !card || !body) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const EASE_MOVE = 'cubic-bezier(.32,.72,0,1)';
  const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
  const ORDER = { termos: 0, privacidade: 1 };
  const cache = new Map();
  let busy = false;

  const slugOf = (href) => {
    try { const u = new URL(href, location.href); if (u.origin !== location.origin) return null;
      const s = u.pathname.replace(/^\/|\/$/g, ''); return s in ORDER ? { slug: s, hash: u.hash } : null; } catch { return null; }
  };

  // Pílula: posiciona sob o item atual; com animate=true desliza esticando um pouco (sensação de mola).
  function placeIndicator(link, animate) {
    const nr = nav.getBoundingClientRect(), lr = link.getBoundingClientRect();
    const x = lr.left - nr.left, w = lr.width;
    const prev = { x: parseFloat(ind.dataset.x || x), w: parseFloat(ind.dataset.w || w) };
    ind.dataset.x = x; ind.dataset.w = w;
    ind.style.transform = `translateX(${x}px)`; ind.style.width = `${w}px`;
    ind.classList.add('is-ready');
    if (!animate || reduced.matches || (prev.x === x && prev.w === w)) return;
    const left = Math.min(prev.x, x), stretch = Math.max(prev.x + prev.w, x + w) - left;
    ind.animate([
      { transform: `translateX(${prev.x}px)`, width: `${prev.w}px` },
      { transform: `translateX(${left}px)`, width: `${stretch}px`, offset: .45 },
      { transform: `translateX(${x}px)`, width: `${w}px` },
    ], { duration: 420, easing: EASE_MOVE });
  }

  const current = () => nav.querySelector('a[aria-current="page"]');
  const syncIndicator = () => { const c = current(); if (c) placeIndicator(c, false); };
  syncIndicator();
  document.fonts?.ready.then(syncIndicator);
  addEventListener('resize', syncIndicator);

  async function load(slug) {
    if (cache.has(slug)) return cache.get(slug);
    const res = await fetch(`/${slug}/`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const next = doc.querySelector('.lgl-body');
    if (!next) throw new Error('sem conteúdo');
    const data = { html: next.innerHTML, title: doc.title };
    cache.set(slug, data);
    return data;
  }

  function scrollToHash(hash) {
    let target = null;
    try { target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; } catch {}
    const behavior = reduced.matches ? 'auto' : 'smooth';
    if (target) target.scrollIntoView({ behavior, block: 'start' });
    return target;
  }

  async function go(slug, hash, push) {
    const from = body.dataset.slug;
    if (busy) return;
    if (slug === from) { if (push) history.pushState({ slug }, '', `/${slug}${hash}`); if (!scrollToHash(hash)) scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' }); return; }
    busy = true;
    const link = nav.querySelector(`a[href="/${slug}"]`);
    nav.querySelectorAll('a').forEach((a) => a.removeAttribute('aria-current'));
    if (link) { link.setAttribute('aria-current', 'page'); placeIndicator(link, true); }

    const dir = ORDER[slug] > ORDER[from] ? 1 : -1;
    const shift = reduced.matches ? 0 : 28;
    let data;
    // Sobe até o início do cartão deslizando enquanto o texto antigo sai.
    const cardTop = card.getBoundingClientRect().top + scrollY - 88;
    if (!hash && scrollY > cardTop) scrollTo({ top: Math.max(0, cardTop), behavior: reduced.matches ? 'auto' : 'smooth' });
    const out = body.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dir * shift}px)` }],
      { duration: reduced.matches ? 80 : 200, easing: EASE_OUT, fill: 'forwards' });
    try { [data] = await Promise.all([load(slug), out.finished]); }
    catch { location.href = `/${slug}${hash}`; return; }

    const h0 = card.getBoundingClientRect().height;
    body.innerHTML = data.html; body.dataset.slug = slug;
    out.cancel();
    document.title = data.title;
    if (push) history.pushState({ slug }, '', `/${slug}${hash}`);
    const h1 = card.getBoundingClientRect().height;

    if (!reduced.matches) {
      // Cartão fica no lugar e só muda de altura; o texto novo entra do lado oposto, em cascata.
      card.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 420, easing: EASE_MOVE });
      card.style.overflow = 'hidden';
      setTimeout(() => { card.style.overflow = ''; }, 440);
      [...body.children].slice(0, 8).forEach((el, i) => el.animate(
        [{ opacity: 0, transform: `translateX(${dir * shift}px)` }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 320, delay: Math.min(i, 6) * 40, easing: EASE_OUT, fill: 'backwards' }));
    }
    if (hash) requestAnimationFrame(() => scrollToHash(hash));
    card.focus({ preventScroll: true });
    busy = false;
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('data-eno-consent')) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) { // âncora na mesma página: rola deslizando
      const t = scrollToHash(href);
      if (t) { e.preventDefault(); history.pushState(history.state, '', href); }
      return;
    }
    const s = slugOf(href);
    if (!s) return;
    e.preventDefault();
    go(s.slug, s.hash, true);
  });
  addEventListener('popstate', () => { const s = slugOf(location.href); if (s) go(s.slug, location.hash, false); });
  // Pré-carrega o outro documento para a troca começar sem espera.
  const other = Object.keys(ORDER).find((k) => k !== body.dataset.slug);
  (window.requestIdleCallback || setTimeout)(() => load(other).catch(() => {}));
})();
