#!/usr/bin/env bash
# compose-marketplace-gallery.sh
#
# Generate the three Elgato Marketplace gallery images (PNG, 1920x960) for the
# NaN Dashboard plugin, per https://docs.elgato.com/guidelines/products/#gallery.
#
# Design rules honoured here:
#   - 1920x960 PNG, coherent dark/purple NaN branding, generous safe margins.
#   - Source screenshots are placed at NATIVE size on a designed canvas;
#     hierarchy comes from large headings/captions, never from blow-ups.
#   - Only real functionality and real values are described; all copy is
#     anchored in docs/marketplace-listing.md and the screenshots themselves.
#   - The setup image crops only the English plugin-controlled inspector panel
#     (the app's Spanish "Título" row ends at y=184; crops start at y=215).
#
# Inputs (never modified): docs/screenshots/nan-dashboard-overview.png,
#                          docs/screenshots/nan-property-inspector.png
# Outputs (deterministic): docs/gallery/nan-dashboard-overview.png
#                          docs/gallery/nan-usage-detail.png
#                          docs/gallery/nan-setup.png
#
# Requires ImageMagick 7 (MAGICK env overrides) and the macOS system fonts
# referenced below. Re-running produces byte-identical PNGs (no timestamps).

set -euo pipefail

MAGICK="${MAGICK:-/opt/homebrew/bin/magick}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/screenshots"
OUT="$ROOT/docs/gallery"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

HEAD_FONT="/System/Library/Fonts/Avenir Next.ttc"      # renders bold face
BODY_FONT="/System/Library/Fonts/SFNS.ttf"             # SF Pro, regular
MONO_FONT="$HOME/Library/Fonts/HackNerdFont-Regular.ttf"

for f in "$HEAD_FONT" "$BODY_FONT" "$MONO_FONT"; do
  [[ -f "$f" ]] || { echo "error: required font not found: $f" >&2; exit 1; }
done
for f in "$SRC/nan-dashboard-overview.png" "$SRC/nan-property-inspector.png"; do
  [[ -f "$f" ]] || { echo "error: required screenshot not found: $f" >&2; exit 1; }
done

mkdir -p "$OUT"

# ---------------------------------------------------------------- palette ---
BG_TOP="#1c1627"      BG_BOT="#110c19"
CARD="#1a1424"        CARD_EDGE="#38295a"
INK="#f3f1f8"         BODY_C="#b3a4d6"      MUTED="#8f7fb0"
ACCENT="#7d39eb"      ACCENT_SOFT="#c9a8ff" ACCENT_LINE="#8d50f0"
GREEN="#7ed49c"       HAIRLINE="#2a2140"

# ----------------------------------------------------- shared background ---
$MAGICK -size 1920x960 "gradient:${BG_TOP}-${BG_BOT}" \
  \( -size 1920x960 xc:none -fill "$ACCENT" \
       -draw "circle 1500,120 1500,550" -blur 0x170 \
       -channel A -evaluate multiply 0.16 +channel \) \
  \( -size 1920x960 xc:none -fill "$ACCENT_SOFT" \
       -draw "circle 240,930 240,530" -blur 0x160 \
       -channel A -evaluate multiply 0.10 +channel \) \
  -flatten -strip "$WORK/bg.png"

# ------------------------------------------------- rounded-crop helper -----
round() { # round <in> <out> <w> <h> <radius>
  $MAGICK "$1" \
    \( -size "$3x$4" xc:none -fill white \
         -draw "roundrectangle 0,0 $(( $3 - 1 )),$(( $4 - 1 )) $5,$5" \) \
    -alpha off -compose CopyOpacity -composite -strip "$2"
}

# Native-size crops from the dashboard overview (measured, px):
#   tiles grid  x 40..926  y 266..604   (tiles at x 52..914, y 278..592)
#   display strip x 40..926 y 624..750  (strip at 52..914, y 634..740)
#   dial 1      x 44..196  y 774..926   (dial circle 52..188, y 782..918)
$MAGICK "$SRC/nan-dashboard-overview.png" -crop 886x338+40+266 +repage -strip "$WORK/grid.png"
$MAGICK "$SRC/nan-dashboard-overview.png" -crop 886x126+40+624 +repage -strip "$WORK/strip.png"
$MAGICK "$SRC/nan-dashboard-overview.png" -crop 152x152+44+774 +repage -strip "$WORK/dial.png"
# Property inspector: English plugin-controlled panel only
# (identity, SESSION, MODEL). The Spanish "Título" row ends at y=184.
$MAGICK "$SRC/nan-property-inspector.png" -crop 750x480+310+215 +repage -strip "$WORK/panel.png"

round "$WORK/grid.png"  "$WORK/grid_r.png"  886 338 14
round "$WORK/strip.png" "$WORK/strip_r.png" 886 126 14
round "$WORK/dial.png"  "$WORK/dial_r.png"  152 152 14
round "$WORK/panel.png" "$WORK/panel_r.png" 750 480 14

# Right-aligned footer URL: measure width (deterministic) instead of using
# East gravity, whose Y offset is center-relative in this IM build.
GITHUB_URL="github.com/refactor-ia/streamdeck-nan"
URL_W="$($MAGICK -font "$MONO_FONT" -pointsize 20 -background none label:"$GITHUB_URL" -format "%w" info:)"
URL_X=$(( 1836 - URL_W ))

# Step numerals: center the digit ink inside each circle. The final
# composition annotates under explicit -gravity NorthWest, which anchors
# the ink TOP at the Y offset (not the baseline). The probe below uses the
# same gravity, measures the ink box for a digit drawn at a known offset
# (+30,+90), and derives the offsets that put the ink center on the circle
# center. Deterministic per run.
num_pos() { # num_pos <digit> <cx> <cy> -> prints "x,y" annotate offsets
  local d="$1" cx="$2" cy="$3" g w h tx ty
  g="$($MAGICK -size 60x120 xc:none -gravity NorthWest -font "$HEAD_FONT" -pointsize 30 \
         -fill white -annotate +30+90 "$d" -trim -format "%w %h %X %Y" info:)"
  w="${g%% *}"; g="${g#* }"; h="${g%% *}"; g="${g#* }"; tx="${g%% *}"; ty="${g##* }"
  tx="${tx#+}"; ty="${ty#+}"
  printf '%s,%s\n' "$(( cx - w / 2 - (tx - 30) ))" "$(( cy - h / 2 - (ty - 90) ))"
}
P1="$(num_pos 1 934 320)"; P2="$(num_pos 2 934 500)"; P3="$(num_pos 3 934 680)"

# =============================================================== IMAGE 1 ===
# App preview: tiles grid + display strip (native), feature cards + dial.
$MAGICK "$WORK/bg.png" \
  -fill "$CARD" -draw "roundrectangle 80,264 998,628 18,18" \
  -fill "$CARD" -draw "roundrectangle 80,652 998,810 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,264 1836,380 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,396 1836,512 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,528 1836,644 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,660 1836,834 18,18" \
  -stroke "$CARD_EDGE" -strokewidth 1.5 -fill none \
  -draw "roundrectangle 80,264 998,628 18,18" \
  -draw "roundrectangle 80,652 998,810 18,18" \
  -draw "roundrectangle 1044,264 1836,380 18,18" \
  -draw "roundrectangle 1044,396 1836,512 18,18" \
  -draw "roundrectangle 1044,528 1836,644 18,18" \
  -draw "roundrectangle 1044,660 1836,834 18,18" \
  -stroke none \
  \( "$WORK/grid_r.png" -geometry +96+277 \) -composite \
  \( "$WORK/strip_r.png" -geometry +96+668 \) -composite \
  \( "$WORK/dial_r.png" -geometry +1068+671 \) -composite \
  -fill "$ACCENT" -draw "roundrectangle 84,58 188,110 14,14" \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 28 -annotate +106+92 "NaN" \
  -font "$HEAD_FONT" -pointsize 40 -annotate +212+94 "NaN Dashboard" \
  -font "$MONO_FONT" -pointsize 17 -fill "$MUTED" \
  -gravity Northeast -annotate +84+88 "STREAM DECK APP PREVIEW" -gravity NorthWest \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 58 \
  -annotate +84+176 "Track your NaN AI usage on Stream Deck." \
  -fill "$BODY_C" -font "$BODY_FONT" -pointsize 26 \
  -annotate +84+238 "Quota tiles, token totals and the Stream Deck+ display strip." \
  -fill "#e9defc" -font "$HEAD_FONT" -pointsize 27 \
  -annotate +1072+302 "Per-model quota" \
  -annotate +1072+434 "Token totals" \
  -annotate +1072+566 "Display strip" \
  -annotate +1256+735 "Stream Deck+ dials" \
  -fill "$BODY_C" -font "$BODY_FONT" -pointsize 21 \
  -annotate +1072+338 "Percent used, capacity and reset date for supported models." \
  -annotate +1072+470 "Monthly and all-time totals." \
  -annotate +1072+602 "Claude, GPT/OpenAI and Grok (experimental) at a glance." \
  -annotate +1256+773 "NaN Usage on Stream Deck+." \
  -fill "$MUTED" -pointsize 20 \
  -annotate +96+842 "Stream Deck app preview." \
  -annotate +84+932 "Requires macOS 13+ and the Stream Deck 7.1+ app." \
  -font "$MONO_FONT" -annotate +${URL_X}+932 "$GITHUB_URL" \
  -stroke "$HAIRLINE" -strokewidth 1 \
  -draw "line 84,898 1836,898" -stroke none \
  -strip -define png:exclude-chunk=date,time -depth 8 \
  "$OUT/nan-dashboard-overview.png"

# =============================================================== IMAGE 2 ===
# Usage detail: tiles grid + display strip (native), callouts to real tiles.
$MAGICK "$WORK/bg.png" \
  -fill "$CARD" -draw "roundrectangle 80,264 998,628 18,18" \
  -fill "$CARD" -draw "roundrectangle 80,652 998,810 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,306 1836,410 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,482 1836,586 18,18" \
  -fill "$CARD" -draw "roundrectangle 1044,626 1836,730 18,18" \
  -stroke "$CARD_EDGE" -strokewidth 1.5 -fill none \
  -draw "roundrectangle 80,264 998,628 18,18" \
  -draw "roundrectangle 80,652 998,810 18,18" \
  -draw "roundrectangle 1044,306 1836,410 18,18" \
  -draw "roundrectangle 1044,482 1836,586 18,18" \
  -draw "roundrectangle 1044,626 1836,730 18,18" \
  -stroke none \
  \( "$WORK/grid_r.png" -geometry +96+277 \) -composite \
  \( "$WORK/strip_r.png" -geometry +96+668 \) -composite \
  -fill "$ACCENT" -draw "roundrectangle 84,58 188,110 14,14" \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 28 -annotate +106+92 "NaN" \
  -font "$HEAD_FONT" -pointsize 40 -annotate +212+94 "NaN Dashboard" \
  -font "$MONO_FONT" -pointsize 17 -fill "$MUTED" \
  -gravity Northeast -annotate +84+88 "STREAM DECK APP PREVIEW" -gravity NorthWest \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 58 \
  -annotate +84+176 "Read your usage in detail." \
  -fill "$BODY_C" -font "$BODY_FONT" -pointsize 26 \
  -annotate +84+238 "Per-model quota, capacity, resets and token totals — real values from this screenshot." \
  -fill "$ACCENT_LINE" -strokewidth 2 \
  -draw "line 974,357 1042,357" -draw "line 974,535 1042,535" \
  -draw "circle 974,357 979,357" -draw "circle 974,535 979,535" \
  -stroke none \
  -fill "#e9defc" -font "$HEAD_FONT" -pointsize 25 \
  -annotate +1072+348 "All-time total" \
  -annotate +1072+524 "Month-to-date" \
  -annotate +1094+670 "Per-model quota" \
  -fill "$BODY_C" -font "$BODY_FONT" -pointsize 20 \
  -annotate +1072+382 "Example: 7.1B tokens, all time." \
  -annotate +1072+558 "Example: 477.7M month to date." \
  -annotate +1072+704 "e.g. glm5.3 — 6.1% of a 3B cap, resets Oct 5." \
  -fill "$GREEN" -draw "circle 1072,662 1079,662" \
  -fill "$MUTED" -pointsize 20 -font "$BODY_FONT" \
  -annotate +96+842 "Display strip — external Claude, GPT/OpenAI and Grok monitors." \
  -annotate +84+932 "Requires macOS 13+ and the Stream Deck 7.1+ app." \
  -font "$MONO_FONT" -annotate +${URL_X}+932 "$GITHUB_URL" \
  -stroke "$HAIRLINE" -strokewidth 1 \
  -draw "line 84,898 1836,898" -stroke none \
  -strip -define png:exclude-chunk=date,time -depth 8 \
  "$OUT/nan-usage-detail.png"

# =============================================================== IMAGE 3 ===
# Setup: inspector panel (native) + three numbered steps.
$MAGICK "$WORK/bg.png" \
  -fill "$CARD" -draw "roundrectangle 80,264 862,776 18,18" \
  -stroke "$CARD_EDGE" -strokewidth 1.5 -fill none \
  -draw "roundrectangle 80,264 862,776 18,18" \
  -stroke none \
  \( "$WORK/panel_r.png" -geometry +96+280 \) -composite \
  -fill "$ACCENT" -draw "roundrectangle 84,58 188,110 14,14" \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 28 -annotate +106+92 "NaN" \
  -font "$HEAD_FONT" -pointsize 40 -annotate +212+94 "NaN Dashboard" \
  -font "$MONO_FONT" -pointsize 17 -fill "$MUTED" \
  -gravity Northeast -annotate +84+88 "SETUP · STREAM DECK APP" -gravity NorthWest \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 58 \
  -annotate +84+176 "Set up NaN Usage" \
  -fill "$BODY_C" -font "$BODY_FONT" -pointsize 26 \
  -annotate +84+238 "Add a dial action, import a session and choose a model." \
  -stroke "#2c2340" -strokewidth 2 \
  -draw "line 934,356 934,470" -draw "line 934,536 934,650" \
  -stroke none \
  -fill "$ACCENT" \
  -draw "circle 934,320 962,320" -draw "circle 934,500 962,500" -draw "circle 934,680 962,680" \
  -fill "$INK" -font "$HEAD_FONT" -pointsize 30 \
  -annotate +${P1%%,*}+${P1##*,} "1" -annotate +${P2%%,*}+${P2##*,} "2" -annotate +${P3%%,*}+${P3##*,} "3" \
  -font "$HEAD_FONT" -pointsize 27 \
  -annotate +990+330 "Add NaN Usage to a dial" \
  -annotate +990+510 "Save your NaN API key" \
  -annotate +990+690 "Choose your model" \
  -fill "$BODY_C" -font "$BODY_FONT" -pointsize 21 \
  -annotate +990+368 "Add the action in the Stream Deck app." \
  -annotate +990+548 "Paste it in the panel shown here." \
  -annotate +990+728 "Pick the model your dial monitors." \
  -fill "$MUTED" -pointsize 20 \
  -annotate +96+822 "NaN Usage configuration panel in the Stream Deck app." \
  -annotate +84+932 "Requires macOS 13+ and the Stream Deck 7.1+ app." \
  -font "$MONO_FONT" -annotate +${URL_X}+932 "$GITHUB_URL" \
  -stroke "$HAIRLINE" -strokewidth 1 \
  -draw "line 84,898 1836,898" -stroke none \
  -strip -define png:exclude-chunk=date,time -depth 8 \
  "$OUT/nan-setup.png"

echo "composed:"
echo "  $OUT/nan-dashboard-overview.png"
echo "  $OUT/nan-usage-detail.png"
echo "  $OUT/nan-setup.png"
