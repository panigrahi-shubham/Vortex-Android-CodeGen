# TPHub Recorder (v0.1)

A codegen-style recorder for Android. You work on a mirrored phone screen in the browser; it records your
actions and writes a **MobileWright** test as you go, with a **pre-assertion → action → post-assertion**
for every step.

It has no npm dependencies: you only need Node.js and ADB (both already installed on your machine).

## Start (Windows PowerShell)

```powershell
cd C:\Projects\tphub-recorder
node src/server.js --out C:\Projects\Indiamart-Mobilewright\tests
```

The browser opens at http://localhost:4700. Open **TradeHub** on the phone first (USB debugging on, `adb devices` shows the phone).

No phone handy? Try the UI with a fake two-screen app: `npm run mock`.

| Option | Default | Meaning |
|---|---|---|
| `--pkg` | `com.yourname.tradehub` | App under test. Only this app's elements are shown (status bar, nav bar and overlays such as a screen-recorder widget are dropped). |
| `--out` | `./generated` | Folder where **Save** writes the `.spec.ts` (point it at your `tests` folder). |
| `--device` | auto | ADB serial. Needed only if several devices are connected. |
| `--port` | `4700` | Web port. |
| `--tree-source` | `auto` | `auto` tries `mobilecli dump ui`, then falls back to `adb uiautomator dump`. Or force `mobilecli` / `uiautomator`. |
| `--tree-cmd` | `mobilecli dump ui` | Command that prints the view tree. Change it if `mobilecli` is not on your PATH. |
| `--mock` | off | Use the built-in fake device. |

The header badge shows which tree source is in use (green = mobilecli, yellow = uiautomator fallback).

## Using it

Pick a mode in the toolbar, then click or drag on the phone image.

| Mode | What it does | Generated code |
|---|---|---|
| **Tap / Long-press / Double-tap** | Click an element. Drag instead of click = swipe. | `await expect(L).toBeVisible(); await L.tap();` |
| **Swipe** | Drag on the screen. Direction and distance are recorded. | `await screen.swipe('up', { distance: 650 });` |
| **Type** | Click an input, enter text. | `await L.fill('text');` |
| **Scroll to** | Click the element you want to reach. | `await L.scrollIntoViewIfNeeded();` |
| **Assert** | Click an element, choose a check (visible, hidden, enabled, disabled, text equals/contains, checked, count). | `await expect(L).toBeVisible();` etc. |
| **Wait for** | Click an element: wait until visible / until it disappears. | `await expect(L).toBeVisible();` |
| **Inspect** | Shows every locator for an element. Nothing is recorded. | none |

Also: **Back**, **Home**, **Enter** (submit a search or filter), **Wait 1.5 s**, **Undo last step**, per-step delete, and **Save debug snapshot**.

**Tap style (name and coordinate).** Many buttons cannot be found or tapped by name, so every tap step has a style, set globally
in the *Tap style* box and changeable per step:

| Style | Generated code |
|---|---|
| **Name, with coordinate fallback** (default) | `await tapOrAt(<locator>, x, y);` taps by name, and if the element is not found or the tap throws, taps the recorded position |
| **Name only** | `await expect(<locator>).toBeVisible(); await <locator>.tap();` |
| **Coordinate only** | `await screen.tap(x, y);` with the locator kept in a comment |

The `tapOrAt` helper is written once at the top of the test (uses `exists()` and `tap()`, both already used in your specs).
Coordinates are for the phone you recorded on; the comment shows the screen ratio, for example `(0.800, 0.102) of 1080x2400`.

**Automatic checks.** After every action the recorder waits for the screen to stop changing, compares before and after,
and lists *suggested checks* under the step (new screen title, dialog, toggled switch, selected tab...). The top suggestion is
ticked by default; tick or untick others. The *pre-assertion* checkbox turns the "is visible first" check on or off per step.

**Locator choice.** Best first: unique id → unique label → unique text → a list row narrowed by a unique child text
(`.filter({ has: ... })`) → `.nth(i)`. Dynamic-looking values (counts, times, prices) are avoided when something steadier exists
(for example the Messages tab is recorded by its id, not by "Messages, 6 new notifications").
An element with nothing usable (for example the unlabeled paperclip) is recorded as a **coordinate tap** with its
screen ratio in a comment, and a 200x200 crop is saved to `assets/` for a later image-match step.

Run the saved test as usual: `npx mobilewright test your-test-name`.

## Typing, WebViews and fields the app does not expose

- **Type** taps the real input field when the tree has one. If there is no input element where you click (some WebView and
  custom fields), it taps exactly the position you clicked, types there, and writes `await screen.tap(x, y)` plus a TODO line
  in the test, because a locator-based `fill` is not possible for that field.
- A yellow **WebView on screen** badge appears when the screen contains a WebView. Web content is only as detailed as the app
  exposes it to Android accessibility: text and some page ids usually come through, but unlabeled inputs often do not.
- **Save debug snapshot** writes the full tree and a screenshot of the current screen to `<out>\debug\`. Use it when an element
  you can see is missing from the recorder, then run `node src/check.js <snapshot.json>` to see what the phone really exposes.

## Check a real tree file

```powershell
node src/check.js C:\Projects\Indiamart-Mobilewright\tree1.json
```

Prints the locator the recorder would pick for every element in that file.

## Things to confirm on your first run

The test style matches your existing specs. These calls are used but are **not confirmed in the MobileWright docs** I could read,
so the generated file lists them in a comment if they appear. If one fails, tell me and I will change the generator:

`longPress()`, `doubleTap()`, `.nth(i)`, `.count()`, `expect(...).not.toBeVisible()`, `expect(...).not.toBeEnabled()`,
`screen.pressButton('BACK')`, `fill()`, `scrollIntoViewIfNeeded()`, `getText()`, `isChecked()`, `isSelected()`, `filter({ has })`.

## Limits of v0.1

- Not live video: the screen refreshes after each action (or with **Refresh screen**).
- No voice commands yet and no image matching yet (the crop for unlabeled elements is saved, not used).
- WebView content is only as detailed as the tree exposes it.
- *Type* uses `adb shell input text`, so ASCII text only (no ₹ or Hindi).
- Long-press and double-tap on an unlabeled element are written as a plain tap plus a TODO comment.
- Scroll to performs one swipe on the phone as an approximation; the generated code uses the locator-based scroll.
- If you record the real IndiaMART app, customer names, numbers and text appear in the browser and in locators inside the
  saved file. Keep those files out of git, or record on TradeHub.

## Troubleshooting

| Message | Fix |
|---|---|
| `No device found` | Check the cable, USB debugging, and `adb devices`. |
| `Several devices connected` | Start with `--device ZD2227CK9F`. |
| Badge shows `uiautomator` | `mobilecli dump ui` failed; the fallback works but is slower. Run `mobilecli dump ui` yourself and send me the error. |
| "The app ... is not on screen" | Open the app on the phone, or change the Package field, then Refresh. |
| `null root node returned by UiTestAutomationBridge` | A test run or another automation tool is holding the accessibility service. Stop it and Refresh. |
| Port in use | `--port 4701`. |

## Files

`src/tree.js` parser and app filter · `src/locators.js` locator ranking · `src/suggest.js` before/after diff ·
`src/codegen.js` test writer · `src/device.js` ADB and mock device · `src/server.js` local server · `public/index.html` UI ·
`test/run-tests.js` (`npm test`) · `samples/` fake screens in your tree format · `examples/` a sample generated spec.
