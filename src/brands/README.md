# Provider logo provenance

Recap Page shows a provider's logo only on the button that starts a sign-in to that provider, beside
the button's own words, as the provider's branding guidance asks (#810, OD-12). Each file here is the
provider's own, kept byte for byte as published: never redrawn, recolored, cropped or resized in the
file. `.gitattributes` keeps these files out of line-ending conversion so the digest below holds on
every checkout. `test/settings-view.test.js` checks the digest, and the palette check owns a logo's
colors only while its bytes match it.

The logos are not covered by this repository's MIT license. They remain their owners' trademarks.

## Microsoft

| | |
|---|---|
| File | `ms-symbollockup_mssymbol_19.svg` |
| Source | https://learn.microsoft.com/en-us/entra/identity-platform/media/howto-add-branding-in-apps/ms-symbollockup_mssymbol_19.svg |
| Guidance | [Sign in with Microsoft branding guidelines](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps), page updated 2026-06-15 |
| Retrieved | 2026-10-28 |
| Size | 343 bytes |
| SHA-256 | `929f48f88c8ca7f3f5d294be47ec4caf51acc28ac25340c19a903125d7ecd84a` |

The guidance offers this file as the Microsoft logo to use in an app, and asks for the logo beside the
words "Sign in with Microsoft", in a light or dark button, with the logo not altered. The button here
is the app's neutral button, light in the light theme and dark in the dark one, holding the file at its
own size of 21 by 21 pixels before the words. The words are text, so they scale with the page, take
forced colors and are the button's name; the logo has empty alternative text because the words say
everything it does.

Microsoft and the Microsoft logo are trademarks of the Microsoft group of companies. Microsoft's
[general trademark guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general)
also say its logos need a license and must not suggest an endorsement; this use rests on the
identity platform guidance above, which offers the logo for use in apps that sign in with Microsoft.

## Google

| | |
|---|---|
| File | `g-logo.png` |
| Source | https://developers.google.com/static/identity/images/g-logo.png |
| Guidance | [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines) |
| Retrieved | 2026-11-01 |
| Size | 33,661 bytes, 200 by 204 pixels |
| SHA-256 | `d1ce9c2af0b10a7333abc99bc706f9a6a199e5b65bf3e3009624f076b8638e6a` |

The guidance shows this file as the Google "G" for a custom Sign in with Google button. It asks for
the standard color G, never resized out of proportion or recolored, beside words such as "Sign in
with Google", on a light, dark or neutral button, and for the Google button to be about as prominent
as any other sign-in choice. Its pre-approved downloads hold only whole buttons with the words drawn
into the image, which would stop the words scaling, taking forced colors or naming the button, so the
standalone G is used instead. The button here is the same neutral button as Microsoft's, with the G in
the 20 by 20 pixel box Google's own button gives it, kept at its own proportions, before the words. The
logo has empty alternative text because the words say everything it does.

Google and the Google logo are trademarks of Google LLC. Google's
[guidelines for third party use of its brand features](https://www.google.com/intl/en/permissions/)
say any use not covered by the sign-in guidance needs its written consent; this use rests on that
guidance alone.