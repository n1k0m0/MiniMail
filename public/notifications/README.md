# MiniMail notification artwork

The 256 × 256 PNG files are used by native browser notifications. `mail.png`
combines the MiniMail wordmark with an envelope; `calendar.png` uses a calendar
badge. `brand.png` is the generic fallback. SVG files contain the corresponding
vector masters with outlined lettering, so rendering needs no external font.

The wordmark uses Manrope ExtraBold, matching the application navigation.
Manrope is licensed under the SIL Open Font License; see `MANROPE-LICENSE.txt`.
The envelope and calendar are geometric line drawings. All artwork is served
from the MiniMail installation without external image requests.

Operating systems and browsers control notification layout and may omit images.
The titles also identify mail and calendar notifications without relying on icons.
