# Closet for iOS

A small app that shows the web app full screen in a WKWebView, under a native iOS tab bar (Closet, Mix, Looks, More) with a round + beside it, plus real haptics and home-screen quick actions. Everything stays on the phone.

What is in this folder:

- `Closet.xcodeproj`: the ready-made Xcode project, with a shared "Closet" scheme.
- `Closet/`: the Swift files, `Info.plist` (the camera and photo permission texts, the four quick actions, the launch screen colour and the export-compliance answer; Xcode adds the standard keys itself), `PrivacyInfo.xcprivacy` (the privacy manifest) and `Assets.xcassets` (the app icon, the accent colour and the launch screen colour).

The web files are not in this folder. Every build copies them from the repo root (see Updating).

You need a Mac with Xcode 26 or later: since April 2026 the App Store only takes apps built with it, and it is what gives the bar the iOS 26 Liquid Glass look. Xcode 15 or 16 should still build and run the app, with the classic bar. For a real iPhone you also need iOS 16 or later, its cable and an Apple ID (a free one works for testing; publishing needs the paid Apple Developer Program).

## Run it

1. **Open the project.** Double-click `ios/Closet.xcodeproj` in Finder (or File > Open in Xcode). Keep the `ios` folder where it is, inside the repo: the build reads the web files from the folder above it.

2. **Signing.** Click the blue Closet icon at the top of the left sidebar, select the Closet target, open Signing & Capabilities. Leave "Automatically manage signing" ticked and pick your Team (choose Add an Account... to sign in with your Apple ID). Then change Bundle Identifier from `com.example.closet` to something only yours, such as `com.yourname.closet`; if you keep the placeholder, Xcode will most likely say it cannot register it. Pick it once and keep it: the app's saved closet belongs to that identifier. The Simulator does not need a Team.

3. **Choose where to run.** In the bar at the top of the window, open the device menu next to "Closet" and pick a simulator (any iPhone) or your iPhone. For your iPhone: connect it, unlock it and tap Trust. The first time, turn on Settings > Privacy & Security > Developer Mode on the iPhone (it restarts).

4. **Run.** Press the Run button (Cmd-R). The first build takes a minute. With a free Apple ID, the first launch on the iPhone is blocked until you allow yourself in Settings > General > VPN & Device Management.

## Updating

The "Copy web app" build step (Closet target > Build Phases) copies `index.html`, `manifest.webmanifest`, `sw.js`, `css/` (with the bundled font in `css/fonts`), `js/`, `icons/` and, if there is one, a top-level `fonts/` from the repo root into the app at every build, replacing the previous copy. There is nothing to sync or add by hand: change or pull the web app, then press Run.

If the old version still shows, choose Product > Clean Build Folder (Shift-Cmd-K) and Run again. Running a new build keeps your saved closet; deleting the app deletes it.

## Test the tab bar

Inside the app the tab bar and the + are native iOS controls; the web page's own floating bar is hidden. On iOS 26 and later the bar is Liquid Glass and floats over the page, with the + as a round glass button beside it. On iOS 16 to 18 it is the classic bar, with the + at its right end.

1. Start the app: Closet is selected. Scroll the closet: the items pass behind the bar, and the last row can still be scrolled clear of it.
2. Tap Mix, Looks, More and Closet: the page follows each tap. Tap the tab you are on: the page scrolls back to the top.
3. Tap +: an iOS menu opens with Add clothes, Create a look and Surprise me. Pick Add clothes: the bar and the + slide away while the sheet is up, and come back with a little bounce when you close it. Try Create a look (the editor, full screen) and Surprise me the same way.
4. Long-press an item to open its menu: the bar steps aside while the menu is open. Use Select in the closet: the bar steps aside while you are choosing.
5. Let the page change tab by itself: with the app on Closet, go to the home screen, long-press the icon and pick Mix. The app comes back on Mix, and the Mix tab is selected.
6. In More, set the theme to Dark while the iPhone is in Light mode: the bar, the + menu and the status bar turn dark too. Set it back to Auto.
7. With VoiceOver on, swipe to the bar: each tab is read with its place ("Closet, tab, 1 of 4"), then the + as "Add". With Settings > Accessibility > Motion > Reduce Motion on, the bar fades instead of sliding.
8. On iOS 26, check that the round + sits level with the glass bar and is spaced like the gap at the other end. If not, change `plusSize` and `plusMargin` in `AppViewController.swift` (search for "chosen without a device").

## Test long press

Inside the app, the long-press menus on items, looks, colour swatches and board items are the web app's own. The native side keeps iOS out of the way: no link previews, no Save Image callout, no text selection or image dragging, except in text fields. When a menu opens you feel a medium tap. Haptics follow Settings > Sounds & Haptics > System Haptics; the Simulator plays none, so test them on the iPhone.

To test: long-press an item in My closet (its menu opens, with no iOS menu, preview or magnifier); long-press a look; then edit an item's name and check that you can still select text in the field.

## Test the quick actions

Long-press the app icon on the home screen: Add clothes, Create a look, Mix and More. In the Simulator, click and hold the icon. Try both ways in:

- App running: open the app, go to the home screen, long-press the icon and pick More. The app comes back on the More page, and the More tab is selected.
- App not running: swipe the app away in the app switcher (or press Stop in Xcode), then long-press the icon and pick Add clothes. The app opens straight into adding an item.

The web app ignores a quick action while one of its sheets or menus is open; close it and try again. To debug a cold launch in Xcode: Product > Scheme > Edit Scheme... > Run > Info > Launch: "Wait for the executable to be launched", press Run, then use the icon.

## If the build fails

- "Signing for Closet requires a development team": step 2.
- "Failed to register bundle identifier" or "is not available": change the Bundle Identifier (step 2).
- "Copy web app: ... index.html not found": the `ios` folder was moved out of the repo. Put it back next to `index.html`.
- "Copy web app: User Script Sandboxing is on": Closet target > Build Settings, search for "sandboxing", set User Script Sandboxing to No. Xcode may offer "Update to recommended settings"; you can ignore it, and if you accept it, untick User Script Sandboxing.
- The app opens on "The web app is not in this build": open the Report navigator (Cmd-9), select the last build and read the "Copy web app" step.

## Releasing to the App Store

What the project already has: version 1.0, build 1, the home-screen name "Closet", an app icon, a launch screen in the app's paper colour, a privacy manifest (`PrivacyInfo.xcprivacy`: no tracking, no data collected, no required-reason APIs) and `ITSAppUsesNonExemptEncryption` = NO in `Info.plist` (the app only uses the encryption built into iOS), so App Store Connect asks no export questions.

1. **Join the Apple Developer Program** (paid, yearly) with the Apple ID you will publish under, then choose that team in Signing & Capabilities. Keep "Automatically manage signing" on.
2. **Pick the final bundle identifier** (Run it, step 2), such as `com.yourname.closet`. It cannot change after the first release, and the saved closet belongs to it.
3. **Create the app record.** In App Store Connect (appstoreconnect.apple.com), Apps > + > New App: platform iOS, a name (it must be unique on the store, so it may need to be longer than "Closet"; the home screen still shows "Closet"), primary language, your bundle ID and any SKU, such as `closet-1`.
4. **Archive and upload.** In Xcode 26 choose Any iOS Device (arm64) as the destination, then Product > Archive. In the Organizer that opens, Distribute App > App Store Connect > Upload. Every later upload needs a higher build number: Closet target > General > Build (`CURRENT_PROJECT_VERSION`).
5. **Try it in TestFlight** on your iPhone before you submit: the uploaded build appears there after processing.
6. **Screenshots.** At least one iPhone screenshot at 1179 × 2556 (iPhone with Dynamic Island, portrait; 1206 × 2622 is also taken), up to 10. Because the app also runs on iPad (`TARGETED_DEVICE_FAMILY` = 1,2), at least one iPad 13-inch screenshot, 2064 × 2752 (or 2048 × 2732). PNG or JPEG, no transparency. The Simulator's File > Save Screen gives the right sizes (iPhone 17 or 16 for the first, iPad Pro 13-inch for the second). To publish for iPhone only, set Targeted Device Family to iPhone before the first upload.
7. **App Privacy.** Answer "Data Not Collected": everything stays on the phone (localStorage and IndexedDB in the app), there are no accounts, analytics or ads, and photos never leave the device. Apple also asks for a privacy policy URL; a short page saying exactly that is enough. The display font is bundled with the app (`css/fonts`), so the app makes no network requests at all.
8. **The rest of the version page:** description, keywords, support URL, category (Lifestyle fits), the age rating questionnaire (no objectionable content, so the lowest rating), price and availability.
9. **Review notes.** Say that the app needs no account, works offline, and uses the camera and photo library only to add pictures of the user's own clothes. Apple turns down apps that are only a website in a wrapper (guideline 4.2), so mention what is native here: the iOS tab bar and menus, haptics, home-screen quick actions, the share sheet, and that the whole app runs from the bundle without the web.

Then Add for Review, and Submit.

## How it works

- The page is served from the app at `closet://app/` by `BundleSchemeHandler`, so ES modules, localStorage and IndexedDB work and are kept across launches. Never change the scheme or host: the saved data belongs to `closet://app`.
- `AppViewController` puts a UIKit `UITabBar` and a + `UIButton` (with a `UIMenu`) over the bottom of the web view. The page and the app talk like this:
  - the page posts `{type: 'state', tab: 'closet'|'mix'|'looks'|'more', bar: true|false}` to the `chrome` message handler on load and whenever its page, a sheet or a menu changes; `bar: false` hides the native bar and the + (animated) until the next `bar: true`. The selected tab always follows the page;
  - a tab tap calls `window.closetAction('closet'|'mix'|'looks'|'more')`, and the + menu calls `closetAction('add'|'look'|'surprise')`. If the page refuses (something is open), the selection goes back to the page's tab;
  - a script injected at document start adds the class `native-bar` to `<html>` and sets the CSS variable `--native-bar` to the height of the bar plus the bottom safe area (in CSS px, which are points). The app sets it again after each page load and whenever the height changes (rotation, iPad window size);
  - a second injected script reports the theme chosen in the app (`<html data-theme>`), and the app applies it to the window, so the bar, the menus, the share sheet and the status bar match the page.
- The page posts `light`, `select`, `medium`, `heavy`, `success`, `warning` or `long` to the `haptic` message handler, which plays the matching iOS haptic.
- A file the page saves (the JSON backup, a look picture) opens the share sheet, where Save to Files keeps it.
- Web inspector, Debug builds only: turn on Web Inspector in the iPhone's Safari > Advanced settings and "Show features for web developers" in the Mac's Safari > Advanced settings, then Safari > Develop > your iPhone > Closet.

## Known limits

- Nothing here has been built or run. The project was written by hand without a Mac; its file, scheme and asset catalog were checked by scripts, the Swift code was checked for syntax with a parser and against Apple's documentation (no compiler), and the page side of the tab bar contract was played through in a desktop browser. Expect to fix small things on the first build.
- The project uses the Xcode 14 format so that older versions open it. Newer Xcode versions open it as it is and may suggest "Update to recommended settings" (see If the build fails).
- iPhone runs in portrait only, as the web app is laid out for portrait. iPad allows every orientation.
- No service worker: WKWebView only runs them for apps that declare App-Bound Domains. Offline works anyway because the files are in the app. `sw.js` is copied but its registration fails quietly.
- The app's data is separate from Safari and from a home-screen web app. Move it with the backup and restore in the app's settings (on the More page). Deleting the app deletes the data, so keep backups.
- Not confirmed: whether WebKit counts `closet://` as a secure context. If not, `navigator.share` is not offered and a look picture goes through the download path, which opens the same share sheet.
- Not confirmed: how WebKit's storage limits for websites treat a custom-scheme origin. You use the page each time you open the app, so they should not apply, but keep backups.
- The launch screen follows the iPhone's light or dark setting; the in-app theme takes over as soon as the page starts.
- Not confirmed on a device: the iOS 26 glass tab bar used on its own (without a tab bar controller). It is drawn by iOS, but the + was placed beside it without seeing it (see Test the tab bar, step 8), and the soft edge under the bar comes from `UIScrollEdgeElementContainerInteraction`, which an Apple engineer recommends for a standalone bar on the developer forums, but which was not seen working with a web view.
- Do not add `UIDesignRequiresCompatibility` to `Info.plist`: it turns off Liquid Glass, and the + would then be placed for the glass bar over a classic one.
- On iPad, each window runs its own copy of the page. A change made in one window shows in another after that window reopens.
- With a free Apple ID the app stops opening after 7 days. Run it from Xcode again.
