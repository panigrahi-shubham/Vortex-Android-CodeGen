import { expect, test } from '@mobilewright/test';

test.use({ autoAppLaunch: false });

const bundleId = 'com.yourname.tradehub';
const id = (name: string) => `${bundleId}:id/${name}`;

// Verify on first run (not confirmed in the MobileWright docs): not.toBeVisible()
test('search and edit', async ({ device, screen }) => {
  await device.launchApp(bundleId);
  try {
    // 1. Tap "Search"
    await expect(screen.getByTestId(id('home_search_button'))).toBeVisible();
    await screen.getByTestId(id('home_search_button')).tap();
    // 2. Type into "Search"
    await expect(screen.getByTestId(id('home_search_input'))).toBeVisible();
    await screen.getByTestId(id('home_search_input')).fill('steel');
    // 3. Swipe up
    await screen.swipe('up', { distance: 650 });
    // 4. Scroll to "Featured Products"
    await screen.getByTestId(id('home_featured_header_text')).scrollIntoViewIfNeeded();
    // 5. Tap "icon"
    await screen.tap(990, 1950); // unlabeled element at (0.917, 0.813) of 1080x2400; template image: assets/step-5.png
    // 6. Tap "Edit"
    await expect(screen.getByTestId(id('myproduct_row_card')).filter({ has: screen.getByText('Fiber Laser Metal Cutting Machine 1500W') }).getByTestId(id('myproduct_edit_button'))).toBeVisible();
    await screen.getByTestId(id('myproduct_row_card')).filter({ has: screen.getByText('Fiber Laser Metal Cutting Machine 1500W') }).getByTestId(id('myproduct_edit_button')).tap();
    // then:
    await expect(screen.getByText('Edit product')).toBeVisible();
    // 7. Press BACK
    await screen.pressButton('BACK');
    // 8. Check "Role" (text)
    await expect(screen.getByTestId(id('home_role_badge_text'))).toBeVisible();
    expect(await screen.getByTestId(id('home_role_badge_text')).getText()).toBe('Role: SELLER');
    // 9. Wait for "Loader" to disappear
    await expect(screen.getByTestId(id('loading_progress'))).not.toBeVisible();
  } finally {
    await device.terminateApp(bundleId);
  }
});
