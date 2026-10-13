import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
let failures = 0;
async function check(name, run) {
  try { await run(); console.log('PASS: ' + name); }
  catch (error) { failures++; console.error('FAIL: ' + name + '\n  ' + error.message); }
}
async function open(viewport, hash, options = {}) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce', ...options });
  await page.goto('http://127.0.0.1:8765/' + hash);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
  });
  page.setDefaultTimeout(5000);
  return page;
}
async function settled(page, id) {
  await page.waitForFunction(id => {
    const active = document.querySelector('.portfolio-scene.is-active');
    return active?.id === id && !active.classList.contains('is-entering');
  }, id);
}
async function swipe(page, fromY, toY) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: fromY }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 160, y: fromY + (toY - fromY) * i / 6 }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(400);
}
try {
  for (const viewport of [{ width: 1920, height: 912 }, { width: 1440, height: 900 }]) {
    const page = await open(viewport, '#journey');
    await check(`Journey fits without hidden labels or blank scrolling at ${viewport.width}x${viewport.height}`, async () => {
      const bounds = await page.evaluate(() => {
        const section = document.querySelector('#journey');
        return {
          overflow: section.scrollHeight - section.clientHeight,
          labelTop: section.firstElementChild.getBoundingClientRect().top,
          headerBottom: document.querySelector('.topbar').getBoundingClientRect().bottom,
          contentBottom: section.lastElementChild.getBoundingClientRect().bottom,
          controlsTop: document.querySelector('.chapter-controls').getBoundingClientRect().top,
        };
      });
      assert.ok(bounds.overflow <= 1, `Unnecessary vertical overflow: ${bounds.overflow}px`);
      assert.ok(bounds.labelTop >= bounds.headerBottom, 'Section label is hidden behind navigation');
      assert.ok(bounds.contentBottom <= bounds.controlsTop, 'Content overlaps chapter controls');
    });
    await check('Wheel advances a fitting chapter without blank scrolling', async () => {
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 180);
      await settled(page, 'contact');
      assert.equal(await page.locator('#journey').evaluate(el => el.scrollTop), 0);
    });
    await page.close();
  }
  for (const viewport of [{width:1366,height:768}, {width:1280,height:720}, {width:1024,height:768}, {width:768,height:1024}]) {
    const page = await open(viewport, '#top');
    await check(`All short chapters fit at ${viewport.width}x${viewport.height}`, async () => {
      for (const id of ['', 'about', 'skills', 'journey', 'contact']) {
        const chapter = page.locator(id ? '#' + id : '.hero');
        const extra = await chapter.evaluate(el => el.scrollHeight - el.clientHeight);
        assert.ok(extra <= 1, `${id || 'intro'} still has ${extra}px unnecessary scroll`);
      }
    });
    await page.close();
  }
  const fade = await open({width:1440,height:900}, '#about', {reducedMotion:'no-preference'});
  await check('Wheel fades out then in, and one continuous gesture never skips chapters', async () => {
    await fade.mouse.move(700, 400);
    await fade.mouse.wheel(0, 180);
    const momentum = (async () => {
      for (let i=0;i<20;i++) { await fade.waitForTimeout(100); await fade.mouse.wheel(0,180); }
    })();
    await fade.waitForFunction(() => document.querySelector('#about').classList.contains('is-exiting'));
    assert.equal(await fade.locator('#skills').getAttribute('aria-hidden'), 'true');
    await fade.waitForFunction(() => Number(getComputedStyle(document.querySelector('#about')).opacity) < .15);
    await settled(fade, 'skills');
    await fade.waitForFunction(() => Number(getComputedStyle(document.querySelector('#skills')).opacity) > .95);
    // Keep events arriving after the transition, like a trackpad's inertia.
    await momentum;
    assert.equal(new URL(fade.url()).hash, '#skills');
    await fade.waitForTimeout(350);
    await fade.mouse.wheel(0,-180);
    await settled(fade, 'about');
  });
  await fade.close();
  const edge = await open({width:1280,height:720}, '#projects');
  await check('Long content reaches its end before a fresh wheel gesture changes chapter', async () => {
    await edge.mouse.move(600,350);
    await edge.mouse.wheel(0,150);
    await edge.waitForTimeout(100);
    assert.ok(await edge.locator('#projects').evaluate(el => el.scrollTop > 0));
    await edge.mouse.wheel(0,3000);
    await edge.waitForTimeout(100);
    await edge.mouse.wheel(0,180);
    await edge.waitForTimeout(100);
    assert.equal(new URL(edge.url()).hash, '#projects');
    assert.ok(await edge.locator('#projects').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop <= 1));
    await edge.waitForTimeout(350);
    await edge.mouse.wheel(0,180);
    await settled(edge, 'journey');
  });
  await edge.close();
  const mobileFit = await open({width:390,height:844}, '#about');
  await check('Short mobile chapters avoid even a few pixels of empty scrolling', async () => {
    for (const selector of ['.hero','#about','#journey','#contact']) {
      const extra = await mobileFit.locator(selector).evaluate(el => el.scrollHeight - el.clientHeight);
      assert.ok(extra <= 1, `${selector} has ${extra}px overflow`);
    }
  });
  await mobileFit.close();
  const lineWheel = await open({width:1440,height:900}, '#journey');
  await check('A single line-mode mouse notch advances a fitting chapter', async () => {
    await lineWheel.locator('#journey').dispatchEvent('wheel', {deltaY:3, deltaMode:1});
    await settled(lineWheel, 'contact');
  });
  await lineWheel.close();
  const focusScroll = await open({width:1280,height:720}, '#journey');
  await check('Keyboard can enter and scroll a long chapter after using controls', async () => {
    await focusScroll.locator('[data-step="-1"]').focus();
    await focusScroll.keyboard.press('Enter');
    await settled(focusScroll, 'projects');
    await focusScroll.keyboard.press('Shift+Tab');
    assert.equal(await focusScroll.locator('#projects').evaluate(el => el === document.activeElement), true);
    await focusScroll.keyboard.press('PageDown');
    await focusScroll.waitForTimeout(300);
    assert.ok(await focusScroll.locator('#projects').evaluate(el => el.scrollTop > 0));
  });
  await focusScroll.close();
  const desktop = await open({ width: 1440, height: 900 }, '#journey');
  await check('Reading keys never change chapters', async () => {
    await desktop.locator('#journey').focus();
    for (const key of ['PageDown', 'ArrowDown', 'Space', 'End', 'Home', 'PageUp']) {
      await desktop.keyboard.press(key);
      await desktop.waitForTimeout(100);
      assert.equal(new URL(desktop.url()).hash, '#journey', key + ' changed chapter');
    }
  });
  await desktop.close();
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const page = await open(viewport, '#projects', { hasTouch: true, isMobile: true });
    await check(`Mobile content scrolls before a fresh edge swipe changes chapter at ${viewport.width}`, async () => {
      const section = page.locator('#projects');
      assert.ok(await section.evaluate(el => el.scrollHeight > el.clientHeight), 'Expected genuinely long content');
      await swipe(page, viewport.height - 120, 180);
      assert.ok(await section.evaluate(el => el.scrollTop > 0), 'Native touch scrolling did not move content');
      assert.equal(new URL(page.url()).hash, '#projects');
      await section.evaluate(el => el.scrollTop = el.scrollHeight);
      const bottom = await section.locator('.tags').last().boundingBox();
      const controls = await page.locator('.chapter-controls').boundingBox();
      assert.ok(bottom.y + bottom.height <= controls.y + 1, 'Last content is obscured by controls');
      await swipe(page, viewport.height - 120, 180);
      await settled(page, 'journey');
      await swipe(page, 180, viewport.height - 120);
      await settled(page, 'projects');
      assert.ok(await section.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop <= 1));
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'Outer page scrolled');
    });
    await page.close();
  }
  const intro = await open({ width: 320, height: 568 }, '#top');
  await check('Short-screen intro link stays clear of chapter controls', async () => {
    await intro.locator('.is-active').evaluate(el => el.scrollTop = el.scrollHeight);
    const link = await intro.locator('.hero .scroll').boundingBox();
    const controls = await intro.locator('.chapter-controls').boundingBox();
    assert.ok(link.y + link.height <= controls.y, 'Explore link overlaps controls');
  });
  await intro.close();
  const reading = await open({ width: 1280, height: 720 }, '#projects');
  await check('Native keyboard reaches the end before wheel changes chapter', async () => {
    assert.equal(await reading.locator('#projects').evaluate(el => el === document.activeElement), true);
    await reading.keyboard.press('PageDown');
    await reading.waitForTimeout(300);
    assert.ok(await reading.locator('#projects').evaluate(el => el.scrollTop > 0));
    await reading.keyboard.press('End');
    await reading.waitForTimeout(300);
    assert.ok(await reading.locator('#projects').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop <= 1));
    await reading.mouse.move(600, 350);
    await reading.mouse.wheel(0, 600);
    await settled(reading, 'journey');
  });
  await reading.close();
  const resize = await open({ width: 1920, height: 912 }, '#journey');
  await check('Resizing preserves content access and removes overflow when it fits again', async () => {
    await resize.setViewportSize({ width: 320, height: 568 });
    await resize.waitForTimeout(100);
    assert.ok(await resize.locator('#journey').evaluate(el => el.scrollHeight > el.clientHeight));
    await resize.locator('#journey').evaluate(el => el.scrollTop = el.scrollHeight);
    await resize.setViewportSize({ width: 1920, height: 912 });
    await resize.waitForTimeout(100);
    assert.ok(await resize.locator('#journey').evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollTop === 0));
  });
  await resize.close();
  const keyboardNav = await open({ width: 1440, height: 900 }, '#journey');
  await check('Keyboard chapter controls keep focus for repeated activation', async () => {
    const previous = keyboardNav.locator('[data-step="-1"]');
    await previous.focus();
    await keyboardNav.keyboard.press('Enter');
    await settled(keyboardNav, 'projects');
    assert.equal(await previous.evaluate(el => el === document.activeElement), true);
    await keyboardNav.keyboard.press('Enter');
    await settled(keyboardNav, 'skills');
    assert.equal(await previous.evaluate(el => el === document.activeElement), true);
  });
  await keyboardNav.close();
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const page = await open({ width: 390, height: 844 }, '#journey', { reducedMotion });
    await check(`Explicit navigation and history still work (${reducedMotion})`, async () => {
      await page.locator('[data-step="1"]').click();
      await settled(page, 'contact');
      await page.waitForTimeout(reducedMotion === 'reduce' ? 0 : 650);
      await page.locator('[data-step="-1"]').click();
      await settled(page, 'journey');
      await page.goBack();
      await settled(page, 'contact');
      await page.locator('#menu').click();
      await page.locator('.nav a[href="#about"]').click();
      await settled(page, 'about');
      assert.equal(await page.locator('#menu').getAttribute('aria-expanded'), 'false');
      const label = await page.locator('#about .section-meta').boundingBox();
      const header = await page.locator('.topbar').boundingBox();
      assert.ok(label.y >= header.y + header.height, 'Mobile section label is hidden behind header');
    });
    await page.close();
  }
} finally { await browser.close(); }
if (failures) process.exitCode = 1;
