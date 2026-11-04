import { expect, test } from '@mobilewright/test';

test.use({ autoAppLaunch: false });

const appPackage = 'com.stockpilot.b2b';

test('StockPilot opens, exposes the home controls, and closes', async ({ device, screen }) => {
  test.setTimeout(60_000);
  await device.launchApp(appPackage);
  try {
    // The offer is optional: the same smoke test works after it has been dismissed.
    const offerClose = screen.getByTestId('promo-modal-close');
    const home = screen.getByTestId('home-screen');
    await expect(offerClose.or(home)).toBeVisible({ timeout: 20_000 });
    if (await offerClose.exists()) {
      await expect(offerClose).toBeVisible();
      await offerClose.tap();
      console.log('[stockpilot] Dismissed the startup offer.');
    }

    await expect(home).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByTestId('home-search-bar')).toBeVisible();
    await expect(screen.getByTestId('home-search-bar')).toBeEnabled();
    await expect(screen.getByTestId('header-cart-button')).toBeVisible();

    await test.info().attach('stockpilot-home', {
      body: await screen.screenshot(),
      contentType: 'image/png',
    });
  } catch (error) {
    await test.info().attach('stockpilot-failure', {
      body: await screen.screenshot(),
      contentType: 'image/png',
    }).catch(() => {});
    throw error;
  } finally {
    await device.terminateApp(appPackage);
  }
});
