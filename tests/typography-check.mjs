import { chromium } from 'playwright';

const viewports = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 860, height: 800 },
  { width: 900, height: 900 },
  { width: 960, height: 820 },
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
      const lines = Array.from(heading.querySelectorAll(':scope > span'));
      const actual = lines.map(line => line.textContent.trim());
      if (actual.length !== 2 || actual.some((value, index) => value !== expected[index])) {
        issues.push('Headline content changed or missing: ' + JSON.stringify(actual));
      }
      const latinRuns = Array.from(document.querySelectorAll('.latin-wide'));
      if (latinRuns.length < 25) issues.push('English runs not widened consistently: ' + latinRuns.length);
      const heroRun = document.querySelector('.hero-title .latin-wide');
      const navRun = document.querySelector('.nav a .latin-wide');
      if (!heroRun || !navRun) issues.push('Missing English typography styling in headline/navigation');
      if (heroRun && getComputedStyle(heroRun).letterSpacing === 'normal')
        issues.push('English-only letter spacing was not applied');
      if (heroRun) {
        const measured = heroRun.getBoundingClientRect().width / Math.max(1, heroRun.offsetWidth);
        const target = viewport.width <= 560 ? 1.16 : 1.22;
        if (Math.abs(measured-target)>0.035)
          issues.push('English glyphs did not stretch by intended ratio: '+measured.toFixed(3));
        const reserved = parseFloat(getComputedStyle(heroRun).marginRight) || 0;
        if (reserved <= 0)
          issues.push('No reserved layout width for expanded headline');
      }
      if (navRun) {
        const ratio=navRun.getBoundingClientRect().width / Math.max(1,navRun.offsetWidth);
        if (Math.abs(ratio-1.12)>0.035)
          issues.push('Navigation Latin letterform scaling missing: '+ratio.toFixed(3));
      }
      const sectionHeading=document.querySelector('#about h2 .latin-wide');
      if(sectionHeading){
        const ratio=sectionHeading.getBoundingClientRect().width/Math.max(1,sectionHeading.offsetWidth);
        if(Math.abs(ratio-1.17)>0.035)
          issues.push('Other English headings did not widen: '+ratio.toFixed(3));
      }
      if (document.querySelector('.hero-copy .latin-wide')?.textContent.includes('문제를'))
        issues.push('Korean text was unexpectedly wrapped as Latin');
      const header = document.querySelector('.topbar-inner');
      const nav = document.querySelector('.nav');
      if (getComputedStyle(nav).display !== 'none') {
        const brandRect = document.querySelector('.brand').getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const badgeRect = header.querySelector('.eyebrow').getBoundingClientRect();
        if (navRect.left < brandRect.right - 2 || navRect.right > badgeRect.left + 2)
          issues.push('Navigation overlaps brand or right metadata');
      }
      const navFontSize = parseFloat(getComputedStyle(document.querySelector('.nav a')).fontSize);
      if (navFontSize < 15) issues.push('Navigation font smaller than 15px: ' + navFontSize);
      const chapter = heading.closest('.portfolio-scene');
      const chapterRect = chapter.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      for (const line of lines) {
        const rect = line.getBoundingClientRect();
        // Measure both the block line and the transformed English glyph box.
        const glyph= line.querySelector('.latin-wide');
        const glyphRect=glyph?.getBoundingClientRect();
        if (rect.right > Math.min(width, chapterRect.right) - 5 || rect.left < -1 ||
            glyphRect?.right > Math.min(width,chapterRect.right)-5 || glyphRect?.left < -1) {
          issues.push('Headline overflows: ' + line.textContent.trim() +
            ' [' + rect.left.toFixed(1) + ', ' + rect.right.toFixed(1) + ']');
        }
      }

      // Range fragments reveal overflowing text even when parent boxes stay within bounds.
      const targets = document.querySelectorAll(
        'main h2, main h3, .section-meta span, .contact-link span, .hero-copy, .hero-aside, .nav a'
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
