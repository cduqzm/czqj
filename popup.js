const power = document.getElementById('power');

let host = null;
let tabId = null;
let site = {};

function render(on) {
  power.setAttribute('aria-checked', String(on));
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  tabId = tab ? tab.id : null;
  try {
    const url = new URL(tab.url);
    if (['http:', 'https:', 'file:'].includes(url.protocol)) host = url.hostname || 'local';
  } catch (e) {}

  document.getElementById('host').textContent = host || "can't run on this page";

  if (!host) {
    power.disabled = true;
    return;
  }

  chrome.storage.local.get(['settings', 'site:' + host], (data) => {
    const defaultMode = (data.settings && data.settings.defaultMode) || 'dynamic';
    site = data['site:' + host] || {};
    const mode = site.mode && site.mode !== 'default' ? site.mode : defaultMode;
    render(mode !== 'off');
    requestAnimationFrame(() => requestAnimationFrame(() => power.classList.add('ready')));
  });
});

power.addEventListener('click', () => {
  if (!host) return;
  const on = power.getAttribute('aria-checked') !== 'true';
  render(on);
  site = { ...site, mode: on ? 'dynamic' : 'off' };
  chrome.storage.local.set({ ['site:' + host]: site }, () => {
    if (tabId !== null) setTimeout(() => chrome.tabs.reload(tabId), 350);
  });
});
