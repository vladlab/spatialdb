extends RefCounted
## Colours and fonts. The paper tones are the web app's "light (experimental)"
## theme (card #c4bfab), laid on a dark table so the shadows have something to fall on.

const PAPER := Color("c4bfab")
const PAPER_BACK := Color("bcb7a3")
const PAPER_EDGE := Color("8a8572")
const WELL := Color("aca793")
const INK := Color("0b0a08")
const INK_SOFT := Color("33302a")
const INK_FAINT := Color(0.2, 0.19, 0.16, 0.45)
const GOLD := Color("d8862a")
const CREAM := Color("efe9d2")
const FELT := Color("2b2923")
const UI_BG := Color("201f1b")
const UI_PANEL := Color("34322b")
const UI_LINE := Color("55524a")
const UI_TEXT := Color("e6e0cb")
const UI_MUTED := Color("a39e8b")

static var _regular: Font
static var _bold: Font
static var _ui: Font


## Card text is drawn with a distance-field font so it stays sharp at any zoom,
## rotation or lift. A system font, so nothing binary lives in the repo.
static func _make(weight: int, msdf: bool) -> Font:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Inter", "Inter Variable", "Noto Sans", "Cantarell", "DejaVu Sans", "Liberation Sans", "sans-serif"])
	f.font_weight = weight
	f.allow_system_fallback = true
	f.multichannel_signed_distance_field = msdf
	if msdf:
		f.msdf_size = 48
		f.msdf_pixel_range = 10
	return f


static func regular() -> Font:
	if _regular == null:
		_regular = _make(500, true)
	return _regular


static func bold() -> Font:
	if _bold == null:
		_bold = _make(700, true)
	return _bold


static func ui() -> Font:
	if _ui == null:
		_ui = _make(500, false)
	return _ui


static func on_color(bg: Color) -> Color:
	return INK if bg.get_luminance() > 0.5 else CREAM
