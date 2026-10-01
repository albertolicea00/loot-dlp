#!/usr/bin/env node
// Usage: node find_m3u8_movie.js <vsembed_movie_url>
// Direct vsembed.ru navigation — no cuevana3e (anti-scraping breaks it)
// Outputs m3u8 URL to stdout

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';
const CHROME_PATH = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const [,, vsembedUrl] = process.argv;
if (!vsembedUrl) { console.error('Usage: node find_m3u8_movie.js <vsembed_url>'); process.exit(1); }

async function main() {
    console.error('[start]', vsembedUrl);
    const browser = await chromium.launch({
        headless: true,
        executablePath: CHROME_PATH,
        args: ['--no-sandbox', '--disable-web-security',
               '--disable-features=IsolateOrigins,site-per-process',
               '--window-size=1280,800', '--disable-popup-blocking'],
    });

    const m3u8Urls = new Set();
    const captureM3u8 = url => {
        if (url.includes('.m3u8') || (url.includes('master') && url.includes('m3u'))) {
            m3u8Urls.add(url);
            console.error('[m3u8]', url.slice(0, 120));
        }
    };

    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });

    await context.route('**/*disable-devtool*', route => {
        console.error('[block] disable-devtool');
        route.fulfill({ status: 200, body: '// blocked' });
    });
    await context.route('**/*sbx*', route => route.fulfill({ status: 200, body: '// blocked' }));

    context.on('page', p => {
        console.error('[new-page]', p.url().slice(0, 80));
        p.on('request', req => captureM3u8(req.url()));
        p.on('response', resp => captureM3u8(resp.url()));
        p.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        }).catch(() => {});
        p.waitForTimeout(4000).then(async () => {
            for (const sel of ['#bigPlay', '#playbtnx', '#poster', '.poster', '[id*="play"]', 'video']) {
                try { await p.click(sel, { timeout: 1000 }); console.error('[popup-click]', sel); break; } catch {}
            }
            await p.waitForTimeout(8000);
        }).catch(() => {});
    });

    const page = await context.newPage();
    page.on('request', req => {
        captureM3u8(req.url());
        const url = req.url();
        if (!url.includes('fonts') && !url.includes('.css') && !url.includes('.png') &&
            !url.includes('.ico') && !url.includes('histats') && !url.includes('clarity') &&
            !url.includes('google') && !url.includes('yandex') && !url.includes('beacon')) {
            console.error('[req]', url.slice(0, 100));
        }
    });
    page.on('response', resp => captureM3u8(resp.url()));

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    });

    await page.goto(vsembedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch(e => console.error('[nav]', e.message));
    await page.waitForTimeout(5000);

    console.error('[url]', page.url());
    console.error('[frames]', page.frames().map(f => f.url().slice(0, 70)));

    // Click play in all frames
    for (const frame of page.frames()) {
        const furl = frame.url();
        if (!furl || furl === 'about:blank') continue;
        console.error('[frame]', furl.slice(0, 80));
        for (const sel of ['#bigPlay', '#playbtnx', '#poster', '.poster', '[id*="play"]', 'video', 'body']) {
            try {
                await frame.click(sel, { timeout: 1000 });
                console.error('[clicked]', sel);
                await page.waitForTimeout(8000);
                break;
            } catch {}
        }
    }

    await page.waitForTimeout(5000);
    console.error('[frames-final]', page.frames().map(f => f.url().slice(0, 70)));
    await browser.close();

    if (m3u8Urls.size === 0) { console.error('[FAIL] no m3u8'); process.exit(1); }
    const best = [...m3u8Urls].sort((a, b) => b.length - a.length)[0];
    console.log(best);
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
