// Live preview for the free static QR generator on the home page.
const input = document.getElementById('qr-data');
if (input) {
  const fg = document.getElementById('qr-fg');
  const bg = document.getElementById('qr-bg');
  const preview = document.getElementById('qr-preview');
  const png = document.getElementById('dl-png');
  const svg = document.getElementById('dl-svg');
  let timer;

  const render = () => {
    const data = input.value.trim();
    if (!data) {
      preview.textContent = 'Type something to generate a code.';
      return;
    }
    const params = new URLSearchParams({ data, fg: fg.value.slice(1), bg: bg.value.slice(1) });
    const src = `/api/qr?${params}`;
    preview.innerHTML = '';
    const img = new Image(240, 240);
    img.alt = 'QR code preview';
    img.src = src;
    preview.appendChild(img);
    svg.href = `${src}&format=svg`;
    png.href = `${src}&format=png`;
  };

  for (const el of [input, fg, bg]) {
    el.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(render, 200);
    });
  }
  render();
}

for (const form of document.querySelectorAll('form[data-confirm]')) {
  form.addEventListener('submit', (event) => {
    if (!confirm(form.dataset.confirm)) event.preventDefault();
  });
}
