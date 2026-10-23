const api = window.pragmatic;
const input = document.getElementById('url');
const radios = [...document.querySelectorAll('input[name=server]')];
const mode = () => radios.find((r) => r.checked).value;
const sync = () => { input.disabled = mode() !== 'remote'; input.required = !input.disabled; };

const claude = document.getElementById('claude');

api.getSettings().then(({ server, serverUrl, presets, claude: on }) => {
  claude.checked = on;
  radios.find((r) => r.value === server).checked = true;
  input.value = serverUrl;
  for (const p of presets) document.getElementById('presets').append(new Option(p));
  sync();
  if (server === 'remote') input.select();
});
for (const r of radios) r.onchange = () => { sync(); if (mode() === 'remote') input.select(); };
document.getElementById('data').onclick = () => api.showData();
document.getElementById('form').onsubmit = async (e) => {
  e.preventDefault();
  document.getElementById('error').textContent = (await api.saveSettings({ server: mode(), serverUrl: input.value, claude: claude.checked })) || '';
};
document.getElementById('cancel').onclick = () => window.close();
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
