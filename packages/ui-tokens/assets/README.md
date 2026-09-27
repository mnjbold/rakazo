# App icon source

`jewl-mark.svg` is the JEWL mark: a cut gem (three crown facets over a pavilion) with two
eye facets. Its geometry is `JEWL_MARK` in `packages/core/src/brand.ts`; the web
`JewlMark` component and the mobile `components/jewl-mark.tsx` draw from that constant.
Every raster below is exported from it: emerald `#34D399` on the dark background token
`#0B0C0E`, or on transparency where the platform supplies the background.

`Rakazo.icon` is the editable Icon Composer source for macOS and iOS (Xcode 26 or newer).
Its foreground layer keeps the file name `orange-bot.png` because CI checks the compiled
asset name; the layer now holds the centered emerald mark on the system dark fill.

The platform exports are:

- `apps/web/public`: `favicon.svg`, `favicon.ico` (16/32/48), `favicon-16x16.png`,
  `favicon-32x32.png` and `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, and
  `icon-maskable-512.png`, whose mark stays inside the 80% maskable safe zone.
- `apps/desktop/assets/icon-macos.png`: 1024-pixel pre-Tahoe export with Dock margins.
- `apps/desktop/assets/icon.png` and `icon.ico` (16 to 256): Linux and Windows.
- `apps/mobile/assets/icon.png`: opaque 1024-pixel square, no rounded mask or margins.
- `apps/mobile/assets/adaptive-icon.png`: transparent 1024-pixel Android foreground with the
  mark inside the launcher's 66% safe zone.
- `apps/mobile/assets/icon-background.png`: opaque Android background in the dark token.
- `apps/mobile/assets/monochrome-icon.png`: matching alpha silhouette with open eyes.
- `apps/mobile/assets/notification-icon.png`, `splash-icon.png`, `favicon.png`.

Refresh platform exports after changing the mark. Android supplies its own mask; never
bake Mac corners, a rim, or an outer shadow into adaptive layers.
