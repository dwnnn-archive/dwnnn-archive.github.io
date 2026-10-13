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
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const issues = [];
    page.on('pageerror', error => issues.push('JavaScript error: ' + error.message));
    page.on('requestfailed', request => issues.push('Resource failed: ' + request.url()));
    page.on('request', request => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:8765')
        issues.push('Unexpected external resource: ' + request.url());
    });
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await Promise.all([400, 500, 600].map(weight =>
        document.fonts.load(`${weight} 16px "Pretendard Variable"`, '한글 Creative Developer.')));
      await Promise.all([
        document.fonts.load('400 64px "Instrument Serif"'),
        document.fonts.load('italic 400 64px "Instrument Serif"'),
      ]);
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    issues.push(...await page.evaluate(() => {
      const issues = [];
      const heading = document.querySelector('.hero-title');
      const expected = ['Creative', 'Developer.'];
      const lines = Array.from(heading.querySelectorAll(':scope > span'));
      const actual = lines.map(line => line.textContent.trim());
      if (actual.length !== 2 || actual.some((value, index) => value !== expected[index]))
        issues.push('Headline content changed or missing: ' + JSON.stringify(actual));
      for (const [family, style] of [['Pretendard Variable', 'normal'], ['Instrument Serif', 'normal'], ['Instrument Serif', 'italic']]) {
        const loaded = Array.from(document.fonts).some(font =>
          font.family.replace(/["']/g, '') === family && font.style === style && font.status === 'loaded');
        if (!loaded) issues.push(`${family} ${style} webfont did not load`);
      }
      for (const selector of ['.hero-title', '.hero-title .serif', '.section h2', '.serif-word', '.skill h3', '.project h3']) {
        const style = getComputedStyle(document.querySelector(selector));
        if (!style.fontFamily.startsWith('"Instrument Serif"') || style.fontWeight !== '400')
          issues.push('Original display font or weight missing: ' + selector);
      }
      for (const selector of ['.hero-title .serif', '.serif-word', '.big-symbol']) {
        if (getComputedStyle(document.querySelector(selector)).fontStyle !== 'italic')
          issues.push('Original display italic missing: ' + selector);
      }
      for (const selector of ['.nav a', '.body-text', '.hero-copy', '.skill p', '.section-meta', '.time-detail h3']) {
        const element = document.querySelector(selector);
        const style = getComputedStyle(element);
        if (!style.fontFamily.startsWith('"Pretendard Variable"'))
          issues.push('Readable bilingual font missing: ' + selector);
        if (style.transform !== 'none' || element.querySelector('.latin-wide'))
          issues.push('Reading or utility text is stretched: ' + selector);
      }
      for (const run of document.querySelectorAll('.latin-wide')) {
        if (/[가-힣]/.test(run.textContent)) issues.push('Korean glyphs are stretched');
        if (!run.closest('.hero-title,.section h2,.skill h3,.project h3,.contact-link'))
          issues.push('Unexpected stretched text outside display typography');
      }
      for (const [selector, target] of [
        ['.hero-title .latin-wide', innerWidth <= 560 ? 1.16 : 1.22],
        ['#about h2 .latin-wide', 1.17],
      ]) {
        const run = document.querySelector(selector);
        const ratio = run ? run.getBoundingClientRect().width / Math.max(1, run.offsetWidth) : 0;
        if (Math.abs(ratio - target) > .035) issues.push('Original display width missing: ' + selector);
        if (run && parseFloat(getComputedStyle(run).marginRight) <= 0)
          issues.push('Display width compensation missing: ' + selector);
      }
      for (const line of lines) {
        const right = Math.min(document.documentElement.clientWidth, heading.closest('.portfolio-scene').getBoundingClientRect().right);
        for (const element of [line, ...line.querySelectorAll('.latin-wide')]) {
          const rect = element.getBoundingClientRect();
          if (rect.right > right - 5 || rect.left < -1)
            issues.push('Headline overflows: ' + element.textContent.trim());
        }
      }
      const nav = document.querySelector('.nav');
      if (getComputedStyle(nav).display !== 'none') {
        const brandRect = document.querySelector('.brand').getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const badgeRect = document.querySelector('.topbar .eyebrow').getBoundingClientRect();
        if (navRect.left < brandRect.right - 2 || navRect.right > badgeRect.left + 2)
          issues.push('Navigation overlaps brand or right metadata');
      }
      if (parseFloat(getComputedStyle(document.querySelector('.nav a')).fontSize) < 15)
        issues.push('Navigation font smaller than 15px');
      if (parseFloat(getComputedStyle(document.querySelector('.skill p')).fontSize) < 15)
        issues.push('Skill body text smaller than 15px');
      if (document.querySelectorAll('.visual-mark').length !== 4)
        issues.push('Expected four compact decorative marks');
      if (document.querySelector('.about-art,.project-visual'))
        issues.push('A large decorative panel remains');
      return issues;
    }));

    // Reveal every chapter; hidden text cannot demonstrate that a layout fits.
    const chapters = await page.locator('.portfolio-scene').count();
    if (chapters !== 6) issues.push('Expected six portfolio chapters, got ' + chapters);
    for (let chapter = 0; chapter < chapters; chapter++) {
      issues.push(...await page.evaluate(() => {
        const issues = [];
        const active = document.querySelector('.portfolio-scene.is-active');
        const width = document.documentElement.clientWidth;
        const targets = document.querySelectorAll(
          '.portfolio-scene.is-active h1, .portfolio-scene.is-active h2, .portfolio-scene.is-active h3, ' +
          '.portfolio-scene.is-active p, .portfolio-scene.is-active .section-meta, ' +
          '.portfolio-scene.is-active .contact-link, .portfolio-scene.is-active .hero-copy, ' +
          '.portfolio-scene.is-active .hero-aside, .portfolio-scene.is-active .about-signature, ' +
          '.portfolio-scene.is-active .project-kicker, .portfolio-scene.is-active .fact, ' +
          '.portfolio-scene.is-active .tags, .portfolio-scene.is-active .time-date, ' +
          '.portfolio-scene.is-active .footer, .nav a'
        );
        for (const target of targets) {
          if (!target.checkVisibility()) continue;
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.nodeValue.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            for (const rect of range.getClientRects()) {
              if (!rect.width || !rect.height) continue;
              if (rect.left < -2 || rect.right > width + 2)
                issues.push(`Chapter ${active.dataset.chapter}: text clipped: "${text.nodeValue.trim().slice(0, 60)}"`);
            }
          }
        }
        if (active.scrollWidth > active.clientWidth + 2)
          issues.push(`Chapter ${active.dataset.chapter}: horizontal overflow`);
        for (const mark of active.querySelectorAll('.visual-mark')) {
          const rect = mark.getBoundingClientRect();
          const bodySize = parseFloat(getComputedStyle(document.querySelector('.body-text')).fontSize);
          if (rect.height > bodySize + 2 || rect.width > bodySize * 2 || rect.height < 8)
            issues.push('Decoration is not text-sized: ' + mark.textContent.trim());
          if (mark.getAttribute('aria-hidden') !== 'true')
            issues.push('Decorative mark is announced as content');
          const label = mark.nextElementSibling?.getBoundingClientRect();
          if (!label || label.left < rect.right || label.top > rect.bottom)
            issues.push('Decorative mark is detached from its label');
        }
        for (const project of active.querySelectorAll('.project')) {
          const card = project.getBoundingClientRect();
          const info = project.querySelector('.project-info').getBoundingClientRect();
          const style = getComputedStyle(project);
          const nonContentHeight = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
            parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
          if (Math.abs(info.left - card.left) > 2 || card.height - info.height > nonContentHeight + 2)
            issues.push('Project retains space reserved for the removed image panel');
        }
        const about = active.querySelector('.about-grid');
        if (about && Math.abs(about.firstElementChild.getBoundingClientRect().width - about.clientWidth) > 2)
          issues.push('About still reserves an empty image column');
        return issues;
      }));
      if (chapter < chapters - 1) {
        await page.locator('[data-step="1"]').click();
        await page.waitForFunction(expected =>
          document.querySelector('.portfolio-scene.is-active').dataset.chapter === String(expected), chapter + 2);
      }
    }
    console.log(`${viewport.width}x${viewport.height}: ${issues.length ? 'FAIL' : 'PASS'} / ${chapters} chapters`);
    for (const issue of issues) {
      failures++;
      console.error('  - ' + issue);
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
