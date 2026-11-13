# my closet

A calm, sticker-style wardrobe app: photograph your clothes, they become die-cut stickers, then put them together into looks.

- **Closet**: upload or snap a photo; the background is removed on-device and the piece gets a smooth sticker border. Sort into Tops / Outerwear / Bottoms / Shoes / Accessories and sub-types (or add your own). Pieces typed as jackets or coats before Outerwear existed are moved there once.
- **Getting started**: an empty closet opens on *Take photo* / *Choose photos*. A new piece only needs its category, which is pre-picked from the piece's shape; type, name and price are tucked away. *Add and do another* saves it and opens the camera or photos again straight away.
- **Bulk add**: choose up to 40 photos at once and they are all cut out together, each with its category guessed from its shape (one tap fixes a wrong guess, or "set all"). Tap any photo to fix its cut-out with the same tools as the one-piece form, and optionally use that strength for every photo.
- **Background removal**: works on a piece lying on a sheet in an ordinary room: the wall, floor, furniture and rug around the sheet are removed with the sheet, leaving only the piece with a smooth edge. Long thin background lines (creases, floorboard gaps, shadow edges) are dropped instead of leaving spikes, and the crop is tight. Plain-background photos are cut exactly as before. A room photo takes a second or two on a phone.
- **Fixing a cut-out**: a *Less / More* slider for how much background goes, and *Tap to remove more*: tap anything left over (a tap just beside a thin line still catches it) and *Undo* if needed. The photo sits on a grey check while you do it, so light leftovers show.
- **Mix**: a dress-up screen with one row per kind (tops, bottoms, shoes, accessories). Swipe a row, or tap the piece next to the middle, to change it; the piece in the middle is the one chosen (accessories can be left empty). *Layer* adds another row of a kind for layering (a shirt under a jacket, a bag and a hat). *Shuffle* spins every row to a fit whose colours go together. *Save look* turns the selection into a look on the Looks page, already laid out.
- **Looks**: a mood-board collage: drag, pinch, twist, flip and layer pieces. Tap a piece and the bar below offers *To front*, *To back*, *Swap* (other pieces of the same kind in its exact place), *Flip* and *Delete*; tap the board to go back to *Add*, *Background* and *Arrange*. *Background* opens a strip of board colours, led by *Auto*: the board takes a soft tint of the look's own colours and each piece's outline takes the piece's main (or second) colour, and both follow as pieces come and go. *Arrange* lays the look out: tops high with outerwear beside them, bottoms under them, shoes at the foot, accessories around the edges, each with a slight random tilt. The Looks page offers *New look* only while it is empty; after that the + button does.
- **Worn counter**: each look card has a small counter. Tap it each time you wear the look (its pieces count it too; *Undo* in the note takes it back), hold it to remove one.
- **Stats & prices**: Stats is its own page: piece counts per category, looks, favourites, pieces worn this month, the three most worn pieces, the most worn look, how many pieces have not been worn lately (tap to see them), the closet's colours, and one small *value* row at the very bottom. Tap it for the price list: every piece with a price box, unpriced ones first. Costs appear only in those two places (you can also type a price while adding a piece).
- **Colours**: each piece shows its two main colours, and each look shows the colours of its pieces.
- **Search, favourites and filters**: the closet and the looks each have a search box (name, type, category or colour; every word has to match, "black boots"), a heart button that shows favourites only, and a filter button: sort by newest, oldest, colour (rainbow order), name, most worn or least worn, and filter by colour family or by not worn lately / never worn. The sort is remembered. Every card has its own heart.
- **Wear log & laundry**: "Wore today" on a piece or a look counts one wear per day. "In the wash" fades a piece and keeps it out of suggestions until "Clean again" (or a week later, by itself).
- **Suggested looks**: "Style" on a piece, "Surprise me" and Mix's *Shuffle* pick one piece per kind whose colours go together, leaning toward pieces that have rested, are in no look yet or are favourites, stepping away from a top or bottom worn in the last two days, and never repeating the last few suggestions or an existing look.
- **Share**: long-press a look and choose Share to send it as a picture, or save the picture where sharing is not available.
- **Appearance**: light, dark or automatic, and higher contrast.
- **Shortcuts**: long-press the app icon (the iOS app in `ios/`, or the installed web app on Android) for Add clothes, Create a look, Mix and Stats. In the iOS app, long-press menus inside the app work as on the web, and haptics are the phone's own. In dark mode pieces use a soft dark edge instead of the white sticker edge (older pieces get theirs quietly in the background).
- **Haptics & long-press**: long-press nearly anything (pieces, looks, tabs, the + button, colour swatches, board items) for quick actions. Haptics use the Vibration API on Android and the native switch tick on iOS 18+.

Photo tip: lay the piece flat on a light sheet or plain surface in soft, even light, with the whole piece in the photo (a piece that runs off the edge of the photo next to other things is the hardest case; *Tap to remove more* clears what is left).

## iPhone app

`ios/` holds a ready-made Xcode project that wraps this web app: open `ios/Closet.xcodeproj`, pick your team, press Run. See `ios/README.md`.

## Run it

It's a static web app (no build step). Serve the folder and open it on your phone:

```sh
python3 -m http.server 8080
```

Or enable GitHub Pages for the repo. On iPhone, open in Safari → Share → *Add to Home Screen* for a full-screen app. Everything is stored privately in the browser (IndexedDB); use Settings → backup to export.
