import { chromium } from 'playwright';

const viewports = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1648, height: 900 },
  { width: 1920, height: 1080 },
];
const browser = await chromium.launch({ headless: true });
let failures = 0;

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('400 64px "Instrument Serif"'),
        document.fonts.load('italic 400 64px "Instrument Serif"'),
      ]);
      await document.fonts.ready;
    });
    await page.waitForTimeout(180);
    const report = await page.evaluate(() => {
      const issues = [];
      const heading = document.querySelector('.hero-title');
      const expected = ['Creative', 'Developer.'];
      const lines = Array.from(heading.querySelectorAll('span'));
      const actual = lines.map(line => line.textContent.trim());
      if (actual.length !== 2 || actual.some((value, index) => value !== expected[index])) {
        issues.push('Headline content changed or missing: ' + JSON.stringify(actual));
      }
      const chapter = heading.closest('.portfolio-scene');
      const chapterRect = chapter.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      for (const line of lines) {
        const rect = line.getBoundingClientRect();
        if (rect.right > Math.min(width, chapterRect.right) - 5 || rect.left < -1) {
          issues.push('Headline overflows: ' + line.textContent.trim() +
            ' [' + rect.left.toFixed(1) + ', ' + rect.right.toFixed(1) + ']');
        }
      }

      // Range fragments reveal overflowing text even when parent boxes stay within bounds.
      const targets = document.querySelectorAll(
        'main h2, main h3, .section-meta span, .contact-link span, .hero-copy, .hero-aside'
      );
      for (const target of targets) {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          if (!text.nodeValue.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          for (const rect of range.getClientRects()) {
            if (!rect.width || !rect.height) continue;
            if (rect.left < -2 || rect.right > width + 2) {
              issues.push('Text clipped at viewport edge: "' + text.nodeValue.trim().slice(0, 60) +
                '" [' + rect.left.toFixed(1) + ', ' + rect.right.toFixed(1) + ']');
            }
          }
        }
      }
      const loaded = Array.from(document.fonts)
        .some(font => font.family.replace(/["']/g, '') === 'Instrument Serif' && font.status === 'loaded');
      if (!loaded) issues.push('Instrument Serif webfont did not load');
      return { issues, headingSize: getComputedStyle(heading).fontSize, loaded };
    });
    console.log(viewport.width + 'x' + viewport.height + ': ' +
      (report.issues.length ? 'FAIL' : 'PASS') + ' / headline ' + report.headingSize);
    for (const error of report.issues) {
      failures++;
      console.error('  - ' + error);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (failures) {
  console.error('\nTypography regression checks failed: ' + failures);
  process.exitCode = 1;
} else {
  console.log('\nAll typography regression checks passed.');
}
