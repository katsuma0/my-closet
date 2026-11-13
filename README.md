# my closet

A calm, sticker-style wardrobe app: photograph your clothes, they become die-cut stickers, then collage them into looks.

- **Closet**: upload or snap a photo; the background is removed on-device and the piece gets a smooth white sticker border. Sort into Tops / Bottoms / Shoes / Accessories and sub-types (or add your own).
- **Bulk add**: choose several photos at once and they are all cut out together; you only pick a category for each (or one tap for "they're all tops"). Tap any photo to fix its cut-out with the same tools as the one-piece form, and optionally use that strength for every photo. Names are filled in automatically; types and prices can be added later.
- **Stats & prices**: the stats sheet shows piece counts per category, looks and your most-styled piece, plus one small *value* row. Tap it for the price list: every piece with a price box, unpriced ones first. Costs appear only in those two places (you can also type a price while uploading a new piece).
- **Looks**: a mood-board collage: drag, pinch, twist, flip and layer pieces; board colours; a strip shows the colours in the look.
- **Colours**: each piece shows its two main colours, and each look shows the colours of its pieces. There is no separate palette screen.
- **Search & favourites**: the magnifier in the header searches by name, type, category or colour. Heart a piece or a look to mark it; a heart chip then filters the closet to favourites.
- **Wear log**: "Wore today" on a piece or a look counts one wear per day. A piece shows how often and how recently it was worn, and Stats shows the most worn piece.
- **Suggested looks**: "Style" on a piece, and "Surprise me", build a look with one piece per category whose colours go together (neutrals with anything, tints of one colour, opposites), leaning toward favourites and pieces worn less.
- **Share**: long-press a look and choose Share to send it as a picture, or save the picture where sharing is not available.
- **Appearance & accessibility**: Settings has light, dark or automatic appearance, three text sizes, higher contrast and reduce motion. Sheets are labelled dialogs that take and return keyboard focus, and everything has a visible focus ring.
- **Haptics & long-press**: long-press nearly anything (pieces, looks, tabs, the + button, colour swatches, board items) for quick actions. Haptics use the Vibration API on Android and the native switch tick on iOS 18+.

Photo tip: lay the piece on a light, plain background in soft, even light. Use the strength slider and *tap to erase* for any leftovers.

## Run it

It's a static web app (no build step). Serve the folder and open it on your phone:

```sh
python3 -m http.server 8080
```

Or enable GitHub Pages for the repo. On iPhone, open in Safari → Share → *Add to Home Screen* for a full-screen app. Everything is stored privately in the browser (IndexedDB); use Settings → backup to export.
