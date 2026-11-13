# my closet

A calm, sticker-style wardrobe app: photograph your clothes, they become die-cut stickers, then collage them into looks.

- **Closet** – upload or snap a photo; the background is removed on-device and the piece gets a smooth white sticker border. Sort into Tops / Bottoms / Shoes / Accessories and sub-types (or add your own).
- **Prices & tally** – optional price per piece; the tally shows the closet's total value, per-category breakdown and the cost of each look.
- **Looks** – a mood-board collage: drag, pinch, twist, flip and layer pieces; board colours; a palette tray shows the colours in the look and what to try with them.
- **Palette** – colour harmonies (complementary, analogous, triadic, tonal, neutral) built from your own pieces, plus calm inspiration palettes, with the closet pieces that match.
- **Haptics & long-press** – long-press nearly anything (pieces, looks, tabs, the + button, colour swatches, board items) for quick actions. Haptics use the Vibration API on Android and the native switch tick on iOS 18+.

Photo tip: lay the piece on a light, plain background in soft, even light. Use the strength slider and *tap to erase* for any leftovers.

## Run it

It's a static web app (no build step). Serve the folder and open it on your phone:

```sh
python3 -m http.server 8080
```

Or enable GitHub Pages for the repo. On iPhone, open in Safari → Share → *Add to Home Screen* for a full-screen app. Everything is stored privately in the browser (IndexedDB); use Settings → backup to export.
