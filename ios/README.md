# Closet for iOS

A small SwiftUI app that shows the web app full screen in a WKWebView, with real haptics and home-screen quick actions. Everything stays on the phone.

What is in this folder:

- `Closet.xcodeproj`: the ready-made Xcode project, with a shared "Closet" scheme.
- `Closet/`: the Swift files, `Info.plist` (the camera and photo permission texts and the four quick actions; Xcode adds the standard keys itself) and `Assets.xcassets` (the app icon).

The web files are not in this folder. Every build copies them from the repo root (see Updating).

You need a Mac with Xcode 15 or later. For a real iPhone you also need iOS 16 or later, its cable and an Apple ID (a free one works).

## Run it

1. **Open the project.** Double-click `ios/Closet.xcodeproj` in Finder (or File > Open in Xcode). Keep the `ios` folder where it is, inside the repo: the build reads the web files from the folder above it.

2. **Signing.** Click the blue Closet icon at the top of the left sidebar, select the Closet target, open Signing & Capabilities. Leave "Automatically manage signing" ticked and pick your Team (choose Add an Account... to sign in with your Apple ID). Then change Bundle Identifier from `com.example.closet` to something only yours, such as `com.yourname.closet`; if you keep the placeholder, Xcode will most likely say it cannot register it. Pick it once and keep it: the app's saved closet belongs to that identifier. The Simulator does not need a Team.

3. **Choose where to run.** In the bar at the top of the window, open the device menu next to "Closet" and pick a simulator (any iPhone) or your iPhone. For your iPhone: connect it, unlock it and tap Trust. The first time, turn on Settings > Privacy & Security > Developer Mode on the iPhone (it restarts).

4. **Run.** Press the Run button (Cmd-R). The first build takes a minute. With a free Apple ID, the first launch on the iPhone is blocked until you allow yourself in Settings > General > VPN & Device Management.

## Updating

The "Copy web app" build step (Closet target > Build Phases) copies `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/` and `icons/` from the repo root into the app at every build, replacing the previous copy. There is nothing to sync or add by hand: change or pull the web app, then press Run.

If the old version still shows, choose Product > Clean Build Folder (Shift-Cmd-K) and Run again. Running a new build keeps your saved closet; deleting the app deletes it.

## Test long press

Inside the app, the long-press menus on pieces, looks, tabs, the + button, colour swatches and board items are the web app's own. The native side keeps iOS out of the way: no link previews, no Save Image callout, no text selection or image dragging, except in text fields. When a menu opens you feel a medium tap. Haptics follow Settings > Sounds & Haptics > System Haptics; the Simulator plays none, so test them on the iPhone.

To test: long-press a piece in My closet (its menu opens, with no iOS menu, preview or magnifier); long-press a look, a tab and the + button; then edit a piece's name and check that you can still select text in the field.

## Test the quick actions

Long-press the app icon on the home screen: Add clothes, Create a look, Mix and Stats. In the Simulator, click and hold the icon. Try both ways in:

- App running: open the app, go to the home screen, long-press the icon and pick Stats. The app comes back on the stats page.
- App not running: swipe the app away in the app switcher (or press Stop in Xcode), then long-press the icon and pick Add clothes. The app opens straight into adding a piece.

The web app ignores a quick action while one of its sheets or menus is open; close it and try again. To debug a cold launch in Xcode: Product > Scheme > Edit Scheme... > Run > Info > Launch: "Wait for the executable to be launched", press Run, then use the icon.

## If the build fails

- "Signing for Closet requires a development team": step 2.
- "Failed to register bundle identifier" or "is not available": change the Bundle Identifier (step 2).
- "Copy web app: ... index.html not found": the `ios` folder was moved out of the repo. Put it back next to `index.html`.
- "Copy web app: User Script Sandboxing is on": Closet target > Build Settings, search for "sandboxing", set User Script Sandboxing to No. Xcode may offer "Update to recommended settings"; you can ignore it, and if you accept it, untick User Script Sandboxing.
- The app opens on "The web app is not in this build": open the Report navigator (Cmd-9), select the last build and read the "Copy web app" step.

## How it works

- The page is served from the app at `closet://app/` by `BundleSchemeHandler`, so ES modules, localStorage and IndexedDB work and are kept across launches. Never change the scheme or host: the saved data belongs to `closet://app`.
- The page posts `light`, `select`, `medium`, `heavy`, `success`, `warning` or `long` to the `haptic` message handler, which plays the matching iOS haptic.
- A file the page saves (the JSON backup, a look picture) opens the share sheet, where Save to Files keeps it.
- Web inspector, Debug builds only: turn on Web Inspector in the iPhone's Safari > Advanced settings and "Show features for web developers" in the Mac's Safari > Advanced settings, then Safari > Develop > your iPhone > Closet.

## Known limits

- Nothing here has been built or run. The project was written by hand without a Mac; its file, scheme and asset catalog were checked by scripts, and the Swift code only against Apple's documentation. Expect to fix small things on the first build.
- The project uses the Xcode 14 format so that older versions open it. Newer Xcode versions open it as it is and may suggest "Update to recommended settings" (see If the build fails).
- iPhone runs in portrait only, as the web app is laid out for portrait. iPad allows every orientation.
- No service worker: WKWebView only runs them for apps that declare App-Bound Domains. Offline works anyway because the files are in the app. `sw.js` is copied but its registration fails quietly.
- The display font comes from Google Fonts, so offline the page falls back to a system serif.
- The app's data is separate from Safari and from a home-screen web app. Move it with Settings > backup and restore. Deleting the app deletes the data, so keep backups.
- Not confirmed: whether WebKit counts `closet://` as a secure context. If not, `navigator.share` is not offered and a look picture goes through the download path, which opens the same share sheet.
- Not confirmed: how WebKit's storage limits for websites treat a custom-scheme origin. You use the page each time you open the app, so they should not apply, but keep backups.
- The status bar text follows the iPhone's light or dark setting, not the in-app theme choice.
- On iPad, each window runs its own copy of the page. A change made in one window shows in another after that window reopens.
- With a free Apple ID the app stops opening after 7 days. Run it from Xcode again.
