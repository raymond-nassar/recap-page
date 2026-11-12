# Brand guidelines

The [owner's adoption decisions](https://github.com/raymond-nassar/recap-page/issues/1208#issuecomment-6777898455)
govern use of the designer's guide. Keep the original three-panel icon across the app, website
favicon, installed apps and store icons, not the proposed lightning-bolt symbol or its combined
lockup. The separate RECAP PAGE wordmark uses outlined SVG lettering: Deep Purple on light
surfaces and Light Purple on dark surfaces, with its original Hot Pink outline and no background.
Fixed Deep Purple and Light Purple assets are selected by the page's theme rules, including an explicit app theme.

Keep clear space around each asset, assessed separately rather than copied from the rejected
lockup's diagram. Resize proportionally; do not stretch, skew, rotate, blur, recolor or add shadows
or other effects. The wordmark's supplied pink outline is intentional, not an effect to remove
or add to the icon. Use the retained icon for tiny surfaces and readable text if the wordmark
would become illegible. Preserve plain-text names and the forced-colors text fallback.

| Brand color | Value | Use |
|---|---|---|
| Deep Purple | `#6D28D9` | Original icon, light-surface wordmark lettering and the light-theme All read line |
| Light Purple | `#9E71E6` | Original icon detail and dark-surface wordmark lettering |
| White | `#FFFFFF` | Original icon detail |
| Hot Pink | `#EE0874` | Wordmark outline, and the outline of the light-theme All read line |

Never use Hot Pink for interface text, accents, buttons, links, focus rings, badges or backgrounds.
The one exception is the All read line that opens a finished list's wrap-up: in the light theme the
owner chose to give it the wordmark's own Deep Purple lettering and Hot Pink outline (#1208). The
dark theme keeps its masthead blue under a white outline, because Deep Purple fails the 3:1 large
text floor on the dark card.

The owner chose purple as a blend of red and blue, so the interface may use those two as decorative
brand accents (#1208). Brand Blue is `#1D4ED8` on light surfaces and `#4D8DFF` on dark ones; Brand
Red is `#C8102E` and `#FF4D5A`. In the app both are decoration only, never text, links or status.
Each color keeps one job there:

- Purple marks what you act on and how far you have come: buttons, progress, the bars under
  section headings about your reading, and the top edge of dialogs and sheets.
- Blue helps you find your way. Links, focus and the current place keep the app's contrast-tested
  interface blue; Brand Blue draws the bars under Library headings, the edge beside the Data page's
  groups and the About page's topics, and empty states, whose glyph and border are both blue.
- In the app, red only marks a moment. The blue, purple and red blend is reserved for finishing a
  whole list, as the band across the top of its wrap-up.
- Hot Pink stays with the wordmark and the All read exception above.
- Teal, amber and the error red keep their status meanings everywhere except the category colors
  below.

The project website uses Brand Blue more widely (#1208). It is the color of the website's links,
focus ring, current page and footer rule, at 6.4:1 in the light theme and 5.9:1 in the dark one.
The bars under its section and document headings cycle blue, purple and red, and a purple rule
tops its "Before you post" box.

Use one accent color per component. Each page opened from a Home category card takes that card's
color for its page header only, as a top bar over a soft wash; titles keep the text color, and
pages outside those categories keep a plain header.

Keep the current contrast-tested interface tokens and light/dark surfaces rather than replace them
with literal brand colors. Status and focus rules, including all five availability distinctions,
still govern the interface.

Komika Axis stays in the outlined wordmark only; do not ship a font file for headings. System fonts
and the responsive type scale remain until the separate [Poppins evaluation](https://github.com/raymond-nassar/recap-page/issues/1212)
establishes any change. An adopted font must be self-hosted with verified redistribution terms
and its license, never requested from a font service. Browser runtime dependencies remain zero.
Do not copy the guide's print sizes, ambiguous leading or unrelated template copy.

Welcome new and experienced Marvel readers, without age targeting. The internal vision is to be
an accessible, enjoyable companion for both. Keep public descriptions concrete and truthful about
what the app does; the guide's About text informs tone, not new feature promises. The website's
approved mission is: "Our mission is to make Marvel reading orders easier to follow, so you can
keep your place and enjoy the story."

The guide does not authorize an editorial service, social banner kit, stationery, merchandise or
signage in this repository. A [website link preview](https://github.com/raymond-nassar/recap-page/issues/1213)
and an [artwork-free Home welcome banner](https://github.com/raymond-nassar/recap-page/issues/1214)
are separate proposals, not shipped features. The dashboard mockup is not an interface specification:
keep current navigation, Search, continuation, progress, platform-link and version presentation.
Do not adopt its profile control, neon effects, lightning-bolt decoration or character artwork.
Never commit the guide, rendered guide pages or its stationery contact details.
