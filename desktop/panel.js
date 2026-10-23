// xterm.js front end for the PTY that main.js runs. window.pragmatic comes from preload.js.
const api = window.pragmatic;
const term = new Terminal({
  fontFamily: '"SF Mono", Menlo, Monaco, monospace',
  fontSize: 13,
  lineHeight: 1.15,
  cursorBlink: true,
  macOptionIsMeta: true,
  scrollback: 10000,
  linkHandler: { activate: (_e, uri) => api.openLink(uri) },
  theme: {
    background: '#17161c', foreground: '#e6e4ee', cursor: '#b7adff', selectionBackground: '#4b3fa8',
    scrollbarSliderBackground: 'rgba(255,255,255,0.10)', scrollbarSliderHoverBackground: 'rgba(255,255,255,0.18)',
    scrollbarSliderActiveBackground: 'rgba(255,255,255,0.26)',
  },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));
fit.fit();

let ended = false;
term.onData((d) => {
  if (!ended) return api.write(d);
  ended = false;
  term.reset();
  api.restart();
});
api.onData((d) => term.write(d));
api.onExit(() => {
  ended = true;
  term.write('\r\n\x1b[2mSession ended. Press any key to start again.\x1b[0m\r\n');
});
api.onInfo(({ cwd }) => {
  document.getElementById('cwd').textContent = cwd;
  term.reset();
});
document.getElementById('folder').onclick = () => api.chooseFolder();

new ResizeObserver(() => {
  fit.fit();
  api.resize(term.cols, term.rows);
}).observe(document.getElementById('term'));
api.ready(term.cols, term.rows);
term.focus();
