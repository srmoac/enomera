/* Entrada sem configuração: liga o Liquid Glass no documento inteiro.
   Para Next.js e páginas estáticas:
   <script type="module" src="/glass/liquid-glass-auto.js"></script>
   O MutationObserver do módulo acompanha elementos .lg que o React montar depois. */
import { initLiquidGlass } from './liquid-glass.js';

if (!window.__enomeraLiquidGlass) {
  const start = () => { window.__enomeraLiquidGlass = initLiquidGlass(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
}
