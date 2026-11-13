# my closet

A calm, sticker-style wardrobe app: photograph your clothes, they become die-cut stickers, then collage them into looks.

- **Closet** – upload or snap a photo; the background is removed on-device and the piece gets a smooth white sticker border. Sort into Tops / Bottoms / Shoes / Accessories and sub-types (or add your own).
- **Bulk add** – choose several photos at once and they are all cut out together; you only pick a category for each (or one tap for "they're all tops"). Tap any photo to fix its cut-out with the same tools as the one-piece form, and optionally use that strength for every photo. Names are filled in automatically; types and prices can be added later.
- **Tally & prices** – the tally shows piece counts per category, looks, your most-styled piece and signature colour, plus one small *closet value* pill. Tap it for the price list: every piece with a price box, unpriced ones first. Costs appear only in those two places (you can also type a price while uploading a new piece).
- **Looks** – a mood-board collage: drag, pinch, twist, flip and layer pieces; board colours; a strip shows the colours in the look.
- **Colours** – each piece shows its two main colours, and each look shows the colours of its pieces. There is no separate palette screen.
- **Haptics & long-press** – long-press nearly anything (pieces, looks, tabs, the + button, colour swatches, board items) for quick actions. Haptics use the Vibration API on Android and the native switch tick on iOS 18+.

Photo tip: lay the piece on a light, plain background in soft, even light. Use the strength slider and *tap to erase* for any leftovers.

## Run it

It's a static web app (no build step). Serve the folder and open it on your phone:

```sh
python3 -m http.server 8080
```

Or enable GitHub Pages for the repo. On iPhone, open in Safari → Share → *Add to Home Screen* for a full-screen app. Everything is stored privately in the browser (IndexedDB); use Settings → backup to export.
