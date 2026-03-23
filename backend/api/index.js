const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Habilitar CORS para o seu site do Cloudflare conseguir falar com este backend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).send('Use POST');

    const { html } = req.body;

    // LIMPEZA: Remove scripts e o rodapé da InPacto
    let cleanHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/Copyright \(C\) 2026 Holding InPacto.*/gi, "");

    try {
        const browser = await puppeteer.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        
        // Injeta CSS para esconder barras do Mailchimp e garantir cores
        const finalContent = `
            <style>
                @media print {
                    #awesomewrap, #awesomebar, .mceFooterSection, .archive_header { display: none !important; }
                    body { background: white !important; -webkit-print-color-adjust: exact; }
                }
            </style>
            ${cleanHtml}
        `;

        await page.setContent(finalContent, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true });

        await browser.close();
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdf);
    } catch (e) {
        res.status(500).send("Erro: " + e.message);
    }
};