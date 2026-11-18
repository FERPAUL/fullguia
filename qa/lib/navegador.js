// Abre Chrome/Edge instalado con puppeteer-core.
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CANDIDATOS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

function rutaNavegador() {
  const r = CANDIDATOS.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!r) throw new Error('No se encontró Chrome ni Edge. Define CHROME_PATH.');
  return r;
}

async function abrir() {
  return puppeteer.launch({
    executablePath: rutaNavegador(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
}

module.exports = { abrir, rutaNavegador };
