# my closet

A calm, sticker-style wardrobe app: photograph your clothes, they become die-cut stickers, then put them together into looks. Everything stays on the phone.

- **Closet**: upload or snap a photo; the background is removed on-device and the item gets a smooth sticker border. Sort into Tops / Outerwear / Bottoms / Shoes / Accessories and sub-types (or add your own). Scrolling the closet makes the stickers sway a little, as if they were hanging on a rail.
- **Getting started**: an empty closet opens on *Take photo* / *Choose photos*. A new item only needs its category, which is pre-picked from the item's shape; type, brand, name and price are tucked away. *Add and do another* saves it and opens the camera or photos again straight away.
- **Brands**: type a brand once and it is kept in a list; every item's Brand menu offers it after that, with *Add a brand…* for new ones. Brands can be searched and filtered on.
- **Select**: *Select* in the closet's header (or *Select* in an item's long-press menu) picks several items at once: edit them together (category, type, brand), favourite them, put them in the wash or delete them.
- **Bulk add**: choose up to 40 photos at once and they are all cut out together, each with its category guessed from its shape (one tap fixes a wrong guess, or "set all"). Tap any photo to fix its cut-out with the same tools as the one-item form, and optionally use that strength for every photo.
- **Background removal**: works on an item lying on a sheet in an ordinary room: the wall, floor, furniture and rug around the sheet are removed with the sheet, leaving only the item with a smooth edge. Long thin background lines (creases, floorboard gaps, shadow edges) are dropped instead of leaving spikes, and the crop is tight. The cut edge is shaved by a pixel or two and its colours are taken from just inside, so no line of wall or sheet shows between the item and its outline (thin straps and laces are left whole).
- **Fixing a cut-out**: a *Less / More* slider for how much background goes; *Remove* (tap anything left over; a tap just beside a thin line still catches it) and *Add back* (tap a part of the item that was cut away; the removed parts show faintly so you can find them). Pinch the photo to zoom in for the small bits, drag to move around, *Fit* to zoom out. *Undo* takes back the last tap.
- **Mix**: a dress-up screen, one row per kind. Swipe a row, or tap the item next to the middle, to change it; the item in the middle is the one chosen (a row can be left empty). *Rows* chooses what Mix shows: drag the handle to reorder, minus to remove a row, *Add a row* for up to five, and a kind can have more than one row (two tops for a shirt under a sweater). *Shuffle* spins every row to a fit whose colours go together. *Save look* turns the selection into a look on the Looks page, already laid out.
- **Looks**: a mood-board collage: drag an item with one finger; put a second finger down anywhere (even on another item) to pinch and turn the same item. Tap an item and the bar below offers *To front*, *To back*, *Swap* (other items of the same kind in its exact place), *Flip* and *Delete*; tap the board to go back to *Add*, *Background*, *Arrange* and *Worn*. *Background* opens a strip of board colours, led by *Auto*: the board takes a soft tint of the look's own colours and each item's outline takes the item's main (or second) colour. *Arrange* hops the items into a new layout each time (a column, a zigzag, a lean or a loose scatter, with tops high, bottoms under them, shoes at the foot and accessories around the edges).
- **Worn counter**: inside a look, *Worn* counts how often you wore it, with minus and plus (and *Undo* after a change). Each look card shows the count.
- **More**: counts per category, looks, favourites, items worn this month, the most worn items and look, items not worn lately, the closet's colours and the closet's value (tap it for the price list). Settings live here too: appearance (auto, light, dark), *Colour backgrounds* (each item's card and each new look take a soft tint of their colours), *Mix rows*, backup, restore and clear.
- **Search, favourites and filters**: the closet and the looks each have a search box (name, type, brand, category or colour; every word has to match, "black boots"), a heart button that shows favourites only, and a filter button: sort by newest, oldest, colour (rainbow order), name, most worn or least worn, and filter by colour family, brand, or not worn lately / never worn. The sort is remembered.
- **Laundry**: "In the wash" fades an item and keeps it out of suggestions until "Clean again" (or a week later, by itself).
- **Suggested looks**: "Style" on an item, "Surprise me" and Mix's *Shuffle* pick one item per kind whose colours go together, leaning toward items that have rested, are in no look yet or are favourites, and never repeating the last few suggestions or an existing look.
- **Share**: long-press a look and choose Share to send it as a picture, or save the picture where sharing is not available.
- **Shortcuts & long-press**: long-press the app icon for Add clothes, Create a look, Mix and More; long-press nearly anything inside (items, looks, tabs, the + button, board items) for quick actions. Haptics are the phone's own in the iOS app.

Photo tip: lay the item flat on a light sheet or plain surface, or hang it against a plain wall, in soft, even light, with the whole item in the photo. *Remove* and *Add back* fix what is left.

## iPhone app

`ios/` holds a ready-made Xcode project that wraps this web app: open `ios/Closet.xcodeproj`, pick your team, press Run. See `ios/README.md`, which also lists what to check before sending it to the App Store.

## Run it

It's a static web app (no build step). Serve the folder and open it on your phone:

```sh
python3 -m http.server 8080
```

Or enable GitHub Pages for the repo. On iPhone, open in Safari → Share → *Add to Home Screen* for a full-screen app. Everything is stored privately on the device (IndexedDB); use More → Backup to export.

The serif typeface, Cormorant Garamond, is bundled in `css/fonts` under the SIL Open Font License (`css/fonts/OFL.txt`).
