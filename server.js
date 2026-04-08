const express   = require('express');
const puppeteer = require('puppeteer-core');
const chromium  = require('@sparticuz/chromium');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

/* ── CORS ── */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ── Executablepath cacheado (extração é lenta) ── */
let execPath = null;
async function getExecPath() {
  if (!execPath) execPath = await chromium.executablePath();
  return execPath;
}

/* ── Lança browser por requisição (mais estável no free tier) ── */
async function getBrowser() {
  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      // REMOVIDO: --single-process  ← causava crashes
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath:  await getExecPath(),
    headless:        chromium.headless,
  });
}

/* ── POST /pdf ── */
app.post('/pdf', async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).send('Campo "html" obrigatório.');

  let browser, page;
  try {
    browser = await getBrowser();
    page    = await browser.newPage();
    await page.setViewport({ width: 600, height: 800 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 0 });
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(() =>
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    );

    const { contentHeight, contentTop } = await page.evaluate(() => {
      document.documentElement.style.cssText += ';margin:0;padding:0;border:0';
      document.body.style.cssText            += ';margin:0;padding:0;border:0';
      const all = document.querySelectorAll('*');
      let minTop = Infinity, maxBottom = 0;
      all.forEach(el => {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return;
        if (parseFloat(s.opacity) === 0) return;
        if (s.position === 'fixed' || s.position === 'absolute') return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (r.top    < minTop)    minTop    = r.top;
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      });
      return {
        contentTop:    minTop    === Infinity ? 0    : Math.floor(minTop),
        contentHeight: maxBottom === 0        ? 3000 : Math.ceil(maxBottom) - (minTop === Infinity ? 0 : Math.floor(minTop)),
      };
    });

    await page.addStyleTag({ content: `
      @page { size: 600px ${contentHeight}px !important; margin: 0 !important; }
      html, body {
        width: 600px !important; height: ${contentHeight}px !important;
        overflow: hidden !important; margin: 0 !important; padding: 0 !important;
      }
      ${contentTop > 1 ? `body > *:first-child { margin-top: -${contentTop}px !important; }` : ''}
    `});

    const pdfBuffer = await page.pdf({
      printBackground:   true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': 'attachment; filename="Relatorio.pdf"',
      'Content-Length':      pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[PDF ERROR]', err.message);
    res.status(500).send(`Erro ao gerar PDF: ${err.message}`);
  } finally {
    if (page)    await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {}); // fecha tudo após cada request
  }
});

/* ── Health check ── */
app.get('/', (req, res) => res.send('in.Pacto PDF Server — online ✅'));

/* ── Keep-alive (evita spin down no free tier) ── */
const http = require('http');
setInterval(() => {
  http.get(`http://localhost:${PORT}/`).on('error', () => {});
}, 14 * 60 * 1000);

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
