# Liquid Glass compartilhado

Material de vidro para Enomera, Ambo, Minne e Etha. Dois arquivos, sem dependências:

- `liquid-glass.css` — o material inteiro, com fallbacks. Funciona sozinho.
- `liquid-glass.js` — opcional. Liga a refração real no Chromium e o brilho que acompanha ponteiro e rolagem.

Demonstração: `/glass/` (compara com o vidro atual sobre pétalas e componentes, em 1440 e 390 px).

## Uso

```html
<link rel="stylesheet" href="/glass/liquid-glass.css">
<script type="module">
  import { initLiquidGlass } from '/glass/liquid-glass.js';
  initLiquidGlass();
</script>

<nav class="lg" data-glass-tint="enomera">…</nav>
<button class="lg" data-glass="clear" data-glass-interactive>…</button>
<form class="lg" data-glass="reading">…</form>
```

| Variante | Onde | Texto |
|---|---|---|
| `clear` | lentes de seleção, CTAs, barras flutuantes | só rótulo curto de 15 px ou mais, peso 600 |
| `regular` (padrão) | cartões, painéis, topbar | títulos e texto curto |
| `reading` | formulários, prontuários, leitura longa | qualquer texto; centro quase sólido |

`data-glass-tint="enomera|etha|ambo|minne"` aplica a pétala do produto (Direção A).
Seleção (`aria-pressed`, `aria-selected`, `aria-current`), foco e desabilitado têm estilo próprio no material.

## Tokens

Todos em `.lg`, sobrescritos por elemento: `--lg-tint` (R G B), `--lg-alpha`, `--lg-blur`, `--lg-saturate`,
`--lg-bezel` (largura da borda que refrata), `--lg-refraction` (0 a 1), `--lg-dispersion` (0 desliga),
`--lg-rim` (brilho da aresta), `--lg-solid` (cor sem transparência). O raio vem do `border-radius` do elemento.

## Níveis

1. **Chromium + JS**: `feDisplacementMap` dentro de `backdrop-filter`, com mapa gerado no formato de cada elemento e dispersão por canal.
2. **Safari, iOS, Firefox**: não aplicam filtros SVG em `backdrop-filter`. Recebem desfoque, saturação, bisel luminoso e brilho direcional.
3. **Sem `backdrop-filter`**: superfície quase opaca.
4. **`prefers-reduced-transparency`, `prefers-contrast: more`, `forced-colors`**: superfície sólida com contorno.
5. **`prefers-reduced-motion`**: brilho parado, sem escala ao toque.

## Como aplicar nos produtos

O módulo não toca nas classes existentes. Para migrar uma superfície:

1. Troque `glass`, `eno-glass` ou `eno-card` por `lg` (com a variante certa) na marcação, ou adicione `lg` e remova do
   seletor antigo `background`, `border`, `backdrop-filter` e `box-shadow`.
2. O elemento não pode ter `backdrop-filter`, `filter`, `opacity < 1`, `mask` ou `clip-path` próprios, nem estar dentro de
   um ancestral de vidro com essas propriedades: elas isolam o fundo e o vidro filho deixa de ver a página.
3. `::before` e `::after` do elemento ficam reservados ao material.
4. Elementos cujo tamanho anima a cada quadro (a lente `motion-lens`) recalculam o mapa a cada mudança de tamanho.
   Para esses, use `data-glass-refract="off"` durante a animação ou anime só `transform`.
5. Peças com mais de 900 × 700 px ficam sem refração por custo de composição; o restante do material vale.

## Limites conhecidos

- A refração real não existe no Safari nem em nenhum navegador do iPhone. Não há como contornar isso com CSS.
- O ângulo do brilho usa `@property`; em navegadores sem suporte ele fica fixo em 135°.
