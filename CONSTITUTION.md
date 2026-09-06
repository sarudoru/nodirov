# The character field

## One visible material

Every visible mark on the main page is a glyph at a fixed cell origin. Text, rules, media, and control labels use that grid.

The canvas has one uniform background color. It has no image panels, drawn shapes, grain textures, or floating cards. Browser selection and keyboard focus retain their native indicators.

## Scroll changes cell contents

The browser provides native scrolling. The renderer reads the scroll position and blends adjacent document rows inside fixed cells.

A new gesture takes priority over row settlement. Committed text stays still at rest. Hover changes link color without changing its letters.

## Color belongs to characters

The page uses local IBM Plex Mono at one size per viewport. Large letters consist of smaller glyphs.

Warm paper and dark ink support reading. An orange accent identifies headings and links. Media can retain source colors or use a limited palette.

## The document remains usable

The HTML document contains all content and links. Transparent text spans preserve selection, search, native navigation, and keyboard focus.

Without JavaScript, the browser shows the plain document. A renderer startup error restores that document.

## Motion has an owner

The ambient field and the video share one frame scheduler. Media updates only inside the viewport. A resize retains the media element and its playback position.

The motion control pauses animation. Reduced motion presents still media. Hidden tabs pause all playback.

## Experiments stay connected

A picture declares its source, caption, and settings in HTML. It uses the existing media sampler and cell renderer.

The lab contains the active renderer settings.
