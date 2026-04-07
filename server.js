/**
 * in.Pacto PDF Server
 * Substitui o Browserless — roda Puppeteer diretamente no Render.com.
 * Recebe HTML já processado e devolve PDF.
 */

const express    = require('express');
const puppeteer  = require('puppeteer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

/* ── CORS — permite chamadas do Cloudflare Pages ── */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ── Reutiliza o browser entre requisições ── */
let browserInstance = null;

async function getBrowser() {
  if (browserInstance) {
    try {
      // Testa se ainda está vivo
      await browserInstance.version();
      return browserInstance;
    } catch (_) {
      browserInstance = null;
    }
  }
  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
  });
  return browserInstance;
}

/* ══════════════════════════════════════════════════════
   POST /pdf
   Body: { html: string }
   Retorna: application/pdf
   ══════════════════════════════════════════════════════ */
app.post('/pdf', async (req, res) => {
  const { html } = req.body;

  if (!html) {
    return res.status(400).send('Campo "html" obrigatório.');
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setViewport({ width: 600, height: 800 });

    /* Carrega o HTML — waitUntil networkidle2 com fallback para load */
    try {
      await page.setContent(html, { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (_) {
      await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    }

    /* Aguarda dois frames para garantir que scripts de medição rodaram */
    await page.evaluate(() =>
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    );

    /* Mede a altura real do conteúdo */
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

    /* Injeta @page com tamanho exato medido */
    await page.addStyleTag({ content: `
      @page {
        size: 600px ${contentHeight}px !important;
        margin: 0 !important;
      }
      html, body {
        width:    600px !important;
        height:   ${contentHeight}px !important;
        overflow: hidden !important;
        margin:   0 !important;
        padding:  0 !important;
      }
      ${contentTop > 1 ? `
        body > *:first-child { margin-top: -${contentTop}px !important; }
        body > *:not(:first-child) { margin-top: 0 !important; }
      ` : ''}
    `});

    /* Gera o PDF */
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
    if (page) await page.close().catch(() => {});
  }
});

/* ── Health check ── */
app.get('/', (req, res) => res.send('in.Pacto PDF Server — online ✅'));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
