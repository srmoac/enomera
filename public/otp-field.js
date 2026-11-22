// Campo de código de 6 dígitos: um <input> real (one-time-code, numérico) por baixo
// de 6 casas visuais. Colar, preencher pelo teclado do iPhone e apagar se comportam
// como uma entrada só. A verificação automática dispara uma única vez por código.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function otpFieldHTML({ id = 'otp-0', value = '', error = false, describedBy = '', state = '', label = 'Código de 6 dígitos' } = {}) {
  const v = String(value || '').replace(/\D/g, '').slice(0, 6);
  const cls = ['eno-otp-row', 'eno-otp-field'];
  if (error) cls.push('has-error');
  if (state === 'verifying') cls.push('is-verifying');
  if (state === 'verified') cls.push('is-verified');
  const slots = [0, 1, 2, 3, 4, 5]
    .map((i) => `<span class="eno-otp-digit${v[i] ? ' is-filled' : ''}" data-slot="${i}" data-d="${esc(v[i] || '')}" style="--slot-i:${i}" aria-hidden="true">${v[i] ? `<span class="eno-otp-d">${esc(v[i])}</span>` : ''}</span>`)
    .join('');
  return `<div class="${cls.join(' ')}" id="eno-otp-group">
    <input id="${esc(id)}" name="code" class="eno-otp-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" enterkeyhint="done" maxlength="6" spellcheck="false" autocapitalize="off" value="${esc(v)}" aria-label="${esc(label)}" aria-invalid="${error ? 'true' : 'false'}"${describedBy ? ` aria-describedby="${esc(describedBy)}"` : ''}${state === 'verifying' || state === 'verified' ? ' readonly' : ''}>
    ${slots}
    <span class="eno-otp-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
  </div>`;
}

/**
 * Liga o campo. onChange(digits:string[]) a cada alteração; onComplete(code) quando
 * chega a 6 dígitos — no máximo uma vez para o mesmo código, mesmo com re-render,
 * troca de foco ou evento repetido.
 */
export function bindOtpField(root, { onChange, onComplete, lastAuto } = {}) {
  const field = root.querySelector('.eno-otp-field');
  const input = field?.querySelector('.eno-otp-input');
  if (!field || !input) return null;
  const slots = [...field.querySelectorAll('.eno-otp-digit')];
  let auto = lastAuto || { code: '' };

  const paint = () => {
    const v = input.value;
    const focused = document.activeElement === input;
    const activeIdx = focused && !input.readOnly ? Math.min(v.length, 5) : -1;
    slots.forEach((s, i) => {
      // Só recria o dígito quando ele muda: assim a entrada anima uma vez por dígito.
      if ((s.dataset.d || '') !== (v[i] || '')) {
        s.dataset.d = v[i] || '';
        s.innerHTML = v[i] ? `<span class="eno-otp-d">${v[i]}</span>` : '';
      }
      s.classList.toggle('is-filled', Boolean(v[i]));
      s.classList.toggle('is-active', i === activeIdx);
      s.classList.toggle('is-caret', i === activeIdx && !v[i]);
    });
  };

  const commit = () => {
    const clean = input.value.replace(/\D/g, '').slice(0, 6);
    if (clean !== input.value) input.value = clean;
    paint();
    onChange?.(clean.split('').concat(Array(6).fill('')).slice(0, 6));
    if (clean.length < 6) { auto.code = ''; return; }
    if (auto.code === clean) return;
    auto.code = clean;
    onComplete?.(clean);
  };

  input.addEventListener('input', commit);
  // Colar texto como "Seu código é 048 291" funciona: só os dígitos entram, zeros à esquerda ficam.
  input.addEventListener('paste', (ev) => {
    const raw = ev.clipboardData?.getData('text') || ev.clipboardData?.getData('text/plain') || '';
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    if (!digits || input.readOnly) return;
    ev.preventDefault();
    input.value = digits;
    commit();
  });
  input.addEventListener('focus', () => { paint(); });
  input.addEventListener('blur', paint);
  // Mantém o cursor sempre no fim: as casas são uma entrada só.
  const toEnd = () => { const n = input.value.length; try { input.setSelectionRange(n, n); } catch {} };
  input.addEventListener('click', toEnd);
  input.addEventListener('keyup', (ev) => { if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home') toEnd(); });
  paint();
  return { input, auto, focus: (selectAll) => { input.focus(); if (selectAll) input.select(); else toEnd(); paint(); } };
}
