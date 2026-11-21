extends Node2D
const Model := preload("res://scripts/model.gd")
const Look := preload("res://scripts/look.gd")
## One record as a card. Drawn by hand (no Controls) so it can be lifted, tilted
## and turned over. Its origin is its centre.
##
## Depth is faked: a lifted card grows a little and its shadow slides away and
## softens; a turning card is squeezed and sheared about its vertical axis and
## swaps faces at the half-way point.

const W_DEFAULT := 280.0
const W_MIN := 180.0
const W_MAX := 420.0
const STRIP_H := 22.0
const PAD := 10.0
const ROW_H := 19.0
const RADIUS := 7
const FLIP_SECONDS := 0.36

var model: Model
var record: Dictionary
var table: Dictionary
var record_id := ""
var width := W_DEFAULT
var front_h := 80.0
var back_h := 80.0

# where it is going; _process eases toward these
var target_pos := Vector2.ZERO
var target_rot := 0.0
var target_scale := 1.0
var target_lift := 0.0

var home := Vector2.ZERO   ## its place on the canvas, as the server has it (centre)
var touched := false       ## moved on the table since it was loaded
var dealt := false         ## came out of a deck; not on the canvas
var pile: RefCounted = null
var jitter := 0.0          ## its resting angle in a pile
var dragging := false
var selected := false:
	set(v):
		if selected != v:
			selected = v
			queue_redraw()
var drop_target := false:
	set(v):
		if drop_target != v:
			drop_target = v
			queue_redraw()

var lift := 0.0
var flip := 0.0            ## 0 = front, 1 = back (eased)
var _flip_t := 0.0
var _flip_to := 0.0
var _scale := 1.0
var pulse := 0.0
var fade := 1.0
var dying := false

var _strip: TextLine
var _title: TextParagraph
var _rows: Array = []        # [{label: TextLine, value: TextLine, empty: bool}]
var _label_w := 0.0
var _back_title: TextLine
var _back_rows: Array = []   # [{label: TextLine, value: TextParagraph, h: float, empty: bool}]
var _back_label_w := 0.0
var _color := Color.GRAY

var _paper := StyleBoxFlat.new()
var _strip_box := StyleBoxFlat.new()
var _well := StyleBoxFlat.new()
var _ring := StyleBoxFlat.new()
var _shade := StyleBoxFlat.new()


func _init() -> void:
	_paper.set_corner_radius_all(RADIUS)
	_paper.set_border_width_all(1)
	_paper.border_color = Look.PAPER_EDGE
	_paper.anti_aliasing = true
	_strip_box.corner_radius_top_left = RADIUS
	_strip_box.corner_radius_top_right = RADIUS
	_well.set_corner_radius_all(5)
	_well.bg_color = Look.WELL
	_ring.draw_center = false
	_ring.set_border_width_all(2)
	_ring.set_corner_radius_all(RADIUS + 3)
	_ring.anti_aliasing = true
	_shade.set_corner_radius_all(RADIUS)


## Lay the card out again from its record. Height is arithmetic over the text.
func rebuild(look: Dictionary, links: Dictionary) -> void:
	var inner := width - PAD * 2.0
	_color = model.table_color(table)
	_strip = _line(model.table_name(table).to_upper(), Look.bold(), 9, inner)

	_title = TextParagraph.new()
	_title.width = inner
	# Wrap at words; a run with no break in it (a filename) wraps by character.
	_title.break_flags = TextServer.BREAK_MANDATORY | TextServer.BREAK_WORD_BOUND | TextServer.BREAK_ADAPTIVE
	_title.max_lines_visible = 6
	_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_title.add_string(model.title_of(record), Look.bold(), 15)

	var rows := model.front_rows(record, look, links)
	_label_w = _label_width(rows, 10, inner)
	_rows.clear()
	for r: Array in rows:
		_rows.append({
			"label": _line(r[0], Look.regular(), 10, _label_w),
			"value": _line(r[1], Look.regular(), 12, inner - _label_w - 8.0),
			"empty": r[1] == "",
		})
	front_h = STRIP_H + 8.0 + _title.get_size().y + 9.0
	if not _rows.is_empty():
		front_h += 5.0 + _rows.size() * ROW_H

	var brows := model.back_rows(record, links)
	_back_title = _line(model.title_of(record), Look.bold(), 12, inner)
	var well_inner := inner - 14.0
	_back_label_w = _label_width(brows, 10, well_inner)
	_back_rows.clear()
	back_h = 8.0 + 10.0 + 18.0 + 8.0 + 7.0
	for r: Array in brows:
		var p := TextParagraph.new()
		p.width = well_inner - _back_label_w - 8.0
		p.break_flags = TextServer.BREAK_MANDATORY | TextServer.BREAK_WORD_BOUND | TextServer.BREAK_ADAPTIVE
		p.max_lines_visible = 6
		p.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		p.add_string(r[1] if r[1] != "" else "—", Look.regular(), 12)
		var h := maxf(ROW_H, p.get_size().y + 4.0)
		_back_rows.append({"label": _line(r[0], Look.regular(), 10, _back_label_w), "value": p, "h": h, "empty": r[1] == ""})
		back_h += h
	back_h += 7.0 + 10.0
	queue_redraw()


static func _line(text: String, font: Font, size: int, w: float) -> TextLine:
	var l := TextLine.new()
	l.add_string(text, font, size)
	l.width = maxf(w, 8.0)
	l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	return l


## One label column, as wide as its longest label, never more than 45% of the card.
static func _label_width(rows: Array, size: int, inner: float) -> float:
	var w := 0.0
	for r: Array in rows:
		w = maxf(w, Look.regular().get_string_size(r[0], HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
	return minf(ceilf(w) + 2.0, inner * 0.45)


func showing_back() -> bool:
	return flip > 0.5


func turn_over() -> void:
	set_face(_flip_to < 0.5)


func set_face(back: bool) -> void:
	_flip_to = 1.0 if back else 0.0
	wake()


func faces_back() -> bool:
	return _flip_to > 0.5


## The size of the face it is turning TO — what layout should plan for.
func face_size() -> Vector2:
	return Vector2(width, back_h if faces_back() else front_h)


func hit(world_point: Vector2) -> bool:
	var s := Vector2(width, back_h if showing_back() else front_h)
	return Rect2(-s * 0.5, s).has_point(to_local(world_point))


func place(pos: Vector2) -> void:
	position = pos
	target_pos = pos


func wake() -> void:
	set_process(true)


func flash() -> void:
	pulse = 1.0
	wake()


func leave() -> void:
	dying = true
	wake()


func _process(dt: float) -> void:
	var moving := false
	var kp := 1.0 - exp(-dt * (32.0 if dragging else 12.0))
	if position.distance_squared_to(target_pos) > 0.01:
		position = position.lerp(target_pos, kp)
		moving = true
	else:
		position = target_pos
	if absf(angle_difference(rotation, target_rot)) > 0.0005:
		rotation = lerp_angle(rotation, target_rot, 1.0 - exp(-dt * 10.0))
		moving = true
	else:
		rotation = target_rot

	var redraw := false
	if absf(lift - target_lift) > 0.002:
		lift = lerpf(lift, target_lift, 1.0 - exp(-dt * 14.0))
		moving = true
		redraw = true
	elif lift != target_lift:
		lift = target_lift
		redraw = true
	if _flip_t != _flip_to:
		_flip_t = move_toward(_flip_t, _flip_to, dt / FLIP_SECONDS)
		flip = _flip_t * _flip_t * (3.0 - 2.0 * _flip_t)
		moving = true
		redraw = true
	if pulse > 0.0:
		pulse = maxf(0.0, pulse - dt * 0.9)
		moving = true
		redraw = true
	if dying:
		fade -= dt * 4.0
		modulate.a = clampf(fade, 0.0, 1.0)
		moving = true
		if fade <= 0.0:
			queue_free()
			return

	var want := target_scale * (1.0 + 0.05 * lift)
	if absf(_scale - want) > 0.0005:
		_scale = lerpf(_scale, want, 1.0 - exp(-dt * 12.0))
		moving = true
	else:
		_scale = want
	scale = Vector2.ONE * _scale

	if redraw:
		queue_redraw()
	if not moving and not dragging:
		set_process(false)


func _draw() -> void:
	var ang := flip * PI
	var c := cos(ang)
	var back := c < 0.0
	var sx := maxf(absf(c), 0.015)
	var h := back_h if back else front_h
	var half := Vector2(width, h) * 0.5
	var rect := Rect2(-half, half * 2.0)
	# The turn: squeeze in x, and shear so the near edge drops — a cheap perspective.
	var turn := Transform2D(Vector2(sx, sin(ang) * 0.10), Vector2(0, 1), Vector2(0, -5.0 * lift))
	draw_set_transform_matrix(turn)

	_paper.bg_color = Look.PAPER_BACK if back else Look.PAPER
	_paper.shadow_size = int(5.0 + 22.0 * lift)
	_paper.shadow_offset = Vector2(1.5, 2.5) + Vector2(5.0, 16.0) * lift
	_paper.shadow_color = Color(0, 0, 0, 0.42 - 0.2 * lift)
	draw_style_box(_paper, rect)

	if back:
		_draw_back(rect)
	else:
		_draw_front(rect)

	var dark := (1.0 - absf(c)) * 0.3
	if dark > 0.004:
		_shade.bg_color = Color(0, 0, 0, dark)
		draw_style_box(_shade, rect)
	if selected or drop_target:
		_ring.border_color = Look.CREAM if drop_target else Look.GOLD
		_ring.set_border_width_all(3 if drop_target else 2)
		draw_style_box(_ring, rect.grow(4.0))
	if pulse > 0.0:
		_ring.border_color = Color(Look.CREAM, pulse)
		_ring.set_border_width_all(2)
		draw_style_box(_ring, rect.grow(4.0 + (1.0 - pulse) * 10.0))
	draw_set_transform_matrix(Transform2D.IDENTITY)


func _draw_front(rect: Rect2) -> void:
	var ci := get_canvas_item()
	var x := rect.position.x + PAD
	var y := rect.position.y
	_strip_box.bg_color = _color
	draw_style_box(_strip_box, Rect2(rect.position + Vector2(1, 1), Vector2(rect.size.x - 2.0, STRIP_H - 1.0)))
	_strip.draw(ci, Vector2(x, y + 5.0), Look.on_color(_color))
	y += STRIP_H + 8.0
	_title.draw(ci, Vector2(x, y), Look.INK)
	y += _title.get_size().y + 5.0
	for row: Dictionary in _rows:
		(row["label"] as TextLine).draw(ci, Vector2(x, y + 4.0), Look.INK_SOFT)
		if row["empty"]:
			draw_line(Vector2(x + _label_w + 8.0, y + 10.0), Vector2(x + _label_w + 20.0, y + 10.0), Look.INK_FAINT, 1.0)
		else:
			(row["value"] as TextLine).draw(ci, Vector2(x + _label_w + 8.0, y + 2.0), Look.INK)
		y += ROW_H


func _draw_back(rect: Rect2) -> void:
	var ci := get_canvas_item()
	var x := rect.position.x + PAD
	var y := rect.position.y
	_strip_box.bg_color = _color
	draw_style_box(_strip_box, Rect2(rect.position + Vector2(1, 1), Vector2(rect.size.x - 2.0, 7.0)))
	y += 8.0 + 10.0
	_back_title.draw(ci, Vector2(x, y), Look.INK)
	y += 18.0 + 8.0
	var well_h := rect.end.y - 10.0 - y
	draw_style_box(_well, Rect2(x, y, rect.size.x - PAD * 2.0, well_h))
	y += 7.0
	for row: Dictionary in _back_rows:
		(row["label"] as TextLine).draw(ci, Vector2(x + 7.0, y + 4.0), Look.INK_SOFT)
		(row["value"] as TextParagraph).draw(ci, Vector2(x + 7.0 + _back_label_w + 8.0, y + 2.0), Look.INK_FAINT if row["empty"] else Look.INK)
		y += row["h"]
