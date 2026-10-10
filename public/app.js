// Live preview for the free static QR generator on the home page.
const input = document.getElementById('qr-data');
if (input) {
  const fg = document.getElementById('qr-fg');
  const bg = document.getElementById('qr-bg');
  const preview = document.getElementById('qr-preview');
  const png = document.getElementById('dl-png');
  const svg = document.getElementById('dl-svg');
  const wifi = document.querySelector('.generator[data-mode="wifi"]');
  let timer;

  // Special characters must be backslash-escaped in the WIFI: payload format.
  const wifiEscape = (value) => value.replace(/([\\;,:"])/g, '\\$1');
  const wifiPayload = () => {
    const ssid = document.getElementById('wifi-ssid').value;
    if (!ssid) return '';
    const type = document.getElementById('wifi-type').value;
    const pass = type === 'nopass' ? '' : document.getElementById('wifi-pass').value;
    return `WIFI:T:${type};S:${wifiEscape(ssid)};P:${wifiEscape(pass)};;`;
  };

  const render = () => {
    if (wifi) input.value = wifiPayload();
    const data = input.value.trim();
    if (!data) {
      preview.textContent = wifi ? 'Enter your network name to generate a code.' : 'Type something to generate a code.';
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

  const fields = wifi ? wifi.querySelectorAll('input, select') : [input, fg, bg];
  for (const el of fields) {
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
