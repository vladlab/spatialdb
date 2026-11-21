extends Node2D
const Api := preload("res://scripts/api.gd")
const EventStream := preload("res://scripts/stream.gd")
const Model := preload("res://scripts/model.gd")
const Card := preload("res://scripts/card.gd")
const Look := preload("res://scripts/look.gd")
## The table: one spatialdb canvas laid out as cards you can handle.
##
## READ-ONLY. Cards start where the canvas has them. Everything done here —
## moving, piling, fanning, dealing, turning over — is local to this window and
## is forgotten when the canvas is closed. Changes made in the web app arrive
## live: a card nobody has moved here glides to its new place, an edited card
## redraws and flashes, a newly placed card flies in.

signal changed                 ## counts or live state changed; the HUD re-reads
signal notice(text: String)    ## something to tell the person, briefly
signal failed(text: String)    ## the canvas could not be loaded

const EXAMINE_W := 440.0       ## an examined card's width on screen, in pixels
const ZOOM_MIN := 0.06
const ZOOM_MAX := 3.0
const FAN_STEP := 200.0
const HAND_OFFSET := Vector2(310.0, 0.0)


class Pile extends RefCounted:
	var cards: Array = []       ## bottom → top
	var pos := Vector2.ZERO     ## where its first card sits
	var fanned := false
	var per_row := 8
	var keep_single := false    ## a deck's hand stays a pile with one card in it
	var badge := Rect2()        ## where its count is drawn; grab it to move the pile


class Deck extends Node2D:
	## The records of one table that are NOT on this canvas, as a face-down deck.
	const SIZE := Vector2(230.0, 150.0)
	var table: Dictionary
	var model: Model
	var records: Array = []
	var more := false
	var hand: Pile = null
	var _box := StyleBoxFlat.new()
	var _frame := StyleBoxFlat.new()

	func _init() -> void:
		_box.set_corner_radius_all(9)
		_box.set_border_width_all(1)
		_box.anti_aliasing = true
		_frame.draw_center = false
		_frame.set_corner_radius_all(5)
		_frame.set_border_width_all(1)

	func hit(world_point: Vector2) -> bool:
		return Rect2(-SIZE * 0.5, SIZE).grow(6.0).has_point(to_local(world_point))

	func _draw() -> void:
		var rect := Rect2(-SIZE * 0.5, SIZE)
		var color := model.table_color(table)
		var label := model.table_name(table)
		if records.is_empty():
			_frame.border_color = Color(Look.CREAM, 0.22)
			draw_style_box(_frame, rect)
			draw_string(Look.regular(), Vector2(rect.position.x, 4.0), "every %s is on the table" % label.to_lower(), HORIZONTAL_ALIGNMENT_CENTER, SIZE.x, 11, Color(Look.CREAM, 0.4))
			return
		var layers := mini(records.size(), 9)
		for i in layers:
			var r := Rect2(rect.position + Vector2(0.7, -2.0) * i, rect.size)
			_box.bg_color = color.darkened(0.18)
			_box.border_color = color.darkened(0.5)
			_box.shadow_size = 7 if i == 0 else 0
			_box.shadow_offset = Vector2(2, 4)
			_box.shadow_color = Color(0, 0, 0, 0.45)
			draw_style_box(_box, r)
		var top := Rect2(rect.position + Vector2(0.7, -2.0) * (layers - 1), rect.size)
		var ink := Look.on_color(color.darkened(0.18))
		_frame.border_color = Color(ink, 0.45)
		draw_style_box(_frame, top.grow(-9.0))
		var y := top.position.y + SIZE.y * 0.5
		draw_string(Look.bold(), Vector2(top.position.x, y - 6.0), label, HORIZONTAL_ALIGNMENT_CENTER, SIZE.x, 17, ink)
		var count := "%d%s not on this canvas" % [records.size(), "+" if more else ""]
		draw_string(Look.regular(), Vector2(top.position.x, y + 14.0), count, HORIZONTAL_ALIGNMENT_CENTER, SIZE.x, 11, Color(ink, 0.85))
		draw_string(Look.regular(), Vector2(top.position.x, y + 44.0), "click to deal  ·  shift-click deals 10", HORIZONTAL_ALIGNMENT_CENTER, SIZE.x, 9, Color(ink, 0.6))


class Drawer extends Node2D:
	## A layer whose drawing the table does.
	var paint: Callable
	func _draw() -> void:
		paint.call(self)


var api: Api
var stream: EventStream
var model := Model.new()
var canvas := {}
var look := {}
var cards := {}               ## record id -> Card
var piles: Array = []
var decks := {}               ## table id -> Deck
var scene_links: Array = []
var link_names := {}
var dealt_ids := {}
var show_threads := true
var loaded := false

var _cam := Camera2D.new()
var _threads := Drawer.new()
var _cards := Node2D.new()
var _decks := Node2D.new()
var _overlay := Drawer.new()
var _dim := Drawer.new()

var _zoom := 1.0
var _zoom_to := 1.0
var _zoom_screen := Vector2.ZERO
var _zoom_world := Vector2.ZERO
var _cam_to: Variant = null    ## a camera position being eased to, or null

var _mode := ""                ## "", "press", "drag", "marquee", "pan"
var _press := {}
var _drag: Array = []          ## [{card, off}]
var _drag_pile: Pile = null
var _drag_tilt := 0.0
var _drag_vel := Vector2.ZERO
var _drop_on: Card = null
var _marq_a := Vector2.ZERO
var _marq_b := Vector2.ZERO
var _hover: Card = null
var _examined: Card = null
var _ex_prev := {}
var _dim_a := 0.0
var _dim_to := 0.0

var _generation := 0
var _loading := false
var _dirty := false
var _reload_in := -1.0
var _placed := {}
var _deck_origin: Variant = null


func _ready() -> void:
	add_child(_cam)
	_cam.make_current()
	_threads.paint = _paint_threads
	add_child(_threads)
	add_child(_decks)
	add_child(_cards)
	_overlay.paint = _paint_overlay
	_overlay.z_index = 50
	add_child(_overlay)
	_dim.paint = _paint_dim
	_dim.z_index = 150
	add_child(_dim)
	stream = EventStream.new()
	stream.api = api
	add_child(stream)
	stream.event.connect(_on_event)
	stream.state_changed.connect(func(_live: bool) -> void: changed.emit())


# ───────────────────────────── loading ─────────────────────────────

func open(c: Dictionary) -> void:
	close()
	canvas = c.duplicate(true)
	_generation += 1
	var ok := await _reload(true)
	if ok:
		loaded = true
		fit(false)
		changed.emit()


func close() -> void:
	_generation += 1
	stream.stop()
	for c: Card in cards.values():
		c.queue_free()
	for d: Deck in decks.values():
		d.queue_free()
	cards.clear()
	decks.clear()
	piles.clear()
	dealt_ids.clear()
	scene_links.clear()
	link_names.clear()
	canvas = {}
	loaded = false
	_examined = null
	_hover = null
	_drag.clear()
	_mode = ""
	_dim_a = 0.0
	_dim_to = 0.0
	_deck_origin = null
	_loading = false
	_dirty = false
	_reload_in = -1.0
	_threads.queue_redraw()
	_overlay.queue_redraw()
	_dim.queue_redraw()


func _reload(first: bool) -> bool:
	if _loading:
		_dirty = true
		return false
	_loading = true
	var gen := _generation
	var id: String = canvas["id"]

	var s := await api.fetch("/api/schema")
	if gen != _generation:
		return false
	if not s.ok:
		return _load_failed(s.error, first)
	model.set_schema(s.data)

	var sc := await api.fetch("/api/canvases/%s/scene" % id)
	if gen != _generation:
		return false
	if not sc.ok:
		return _load_failed(sc.error, first)
	var scene: Dictionary = sc.data
	canvas["config"] = (scene.get("canvas", {}) as Dictionary).get("config", {})
	look = model.look_of(canvas)
	_apply_scene(scene, first)

	var decks_ok := await _load_decks(gen)
	if gen != _generation:
		return false
	if decks_ok:
		_drop_missing()
	for p: Pile in piles:
		_layout(p)

	if first:
		stream.start(int(scene.get("seq", 0)))
	_loading = false
	_threads.queue_redraw()
	_overlay.queue_redraw()
	changed.emit()
	if _dirty:
		_dirty = false
		_reload(false)
	return true


func _load_failed(text: String, first: bool) -> bool:
	_loading = false
	if first:
		failed.emit(text)
	else:
		notice.emit("Could not refresh: %s" % text)
	return false


func _apply_scene(scene: Dictionary, first: bool) -> void:
	var recs := {}
	for r: Dictionary in scene.get("records", []):
		recs[r["id"]] = r
	scene_links = scene.get("links", [])
	link_names.clear()
	for l: Dictionary in scene_links:
		var from: Variant = recs.get(l["from_record"])
		var to: Variant = recs.get(l["to_record"])
		if from == null or to == null:
			continue
		var k := "%s|%s" % [l["field_id"], l["from_record"]]
		var kb := "back|%s|%s" % [l["field_id"], l["to_record"]]
		if not link_names.has(k):
			link_names[k] = []
		if not link_names.has(kb):
			link_names[kb] = []
		link_names[k].append(model.title_of(to))
		link_names[kb].append(model.title_of(from))

	_placed = {}
	for p: Dictionary in scene.get("placements", []):
		var id: String = p["record_id"]
		var rec: Variant = recs.get(id)
		if rec == null:
			continue
		_placed[id] = true
		var w := Card.W_DEFAULT
		if p.get("w") != null:
			w = clampf(float(p["w"]), Card.W_MIN, Card.W_MAX)
		var card: Card = cards.get(id)
		if card == null:
			card = _make_card(rec, w)
			card.home = Vector2(float(p["x"]) + w * 0.5, float(p["y"]) + card.front_h * 0.5)
			if first:
				card.place(card.home)
			else:
				# placed from the web app while we watch: it comes down onto the table
				card.place(card.home + Vector2(0, -90))
				card.target_pos = card.home
				card.lift = 1.0
				card.flash()
		else:
			var edited: bool = (card.record.get("data", {}) as Dictionary).hash() != (rec.get("data", {}) as Dictionary).hash()
			card.record = rec
			card.table = model.tables.get(rec.get("table_id", ""), {})
			card.width = w
			card.dealt = false
			card.rebuild(look, link_names)
			if edited:
				card.flash()
			var home := Vector2(float(p["x"]) + w * 0.5, float(p["y"]) + card.front_h * 0.5)
			if not home.is_equal_approx(card.home):
				card.home = home
				if not card.touched and card.pile == null and card != _examined:
					card.target_pos = home
					card.wake()


## Unplaced records, per table, as decks. Returns false if a read failed (then
## nothing is removed on the strength of it).
func _load_decks(gen: int) -> bool:
	var seen := {}
	for tid: String in model.table_order:
		var t: Dictionary = model.tables[tid]
		var kind := str(t.get("kind", "records"))
		if kind != "records" or t.get("utility", false) == true:
			continue
		var r := await api.fetch("/api/canvases/%s/unplaced?tableId=%s&limit=500" % [canvas.get("id", ""), tid])
		if gen != _generation:
			return false
		if not r.ok:
			notice.emit("Could not read the unplaced %s: %s" % [model.table_name(t), r.error])
			return false
		var remaining: Array = []
		for rec: Dictionary in (r.data as Dictionary).get("records", []):
			seen[rec["id"]] = true
			if dealt_ids.has(rec["id"]):
				var c: Card = cards.get(rec["id"])
				if c != null and (c.record.get("data", {}) as Dictionary).hash() != (rec.get("data", {}) as Dictionary).hash():
					c.record = rec
					c.rebuild(look, link_names)
					c.flash()
			else:
				remaining.append(rec)
		var deck: Deck = decks.get(tid)
		if deck == null:
			if remaining.is_empty():
				continue
			deck = Deck.new()
			deck.model = model
			deck.position = _next_deck_position()
			decks[tid] = deck
			_decks.add_child(deck)
		deck.table = t
		deck.records = remaining
		deck.more = (r.data as Dictionary).get("hasMore", false) == true
		deck.queue_redraw()
	_placed.merge(seen)
	return true


## Cards whose record is no longer on the canvas (and was not dealt here), or is gone.
func _drop_missing() -> void:
	for id: String in cards.keys():
		if _placed.has(id):
			continue
		var c: Card = cards[id]
		cards.erase(id)
		dealt_ids.erase(id)
		_detach(c)
		c.selected = false
		if c == _examined:
			_examined = null
			_dim_to = 0.0
		if c == _hover:
			_hover = null
		c.leave()
	_tidy_piles()


func _next_deck_position() -> Vector2:
	if _deck_origin == null:
		var box := _bounds(false)
		_deck_origin = Vector2(box.position.x + Deck.SIZE.x * 0.5, box.end.y + 230.0)
	return (_deck_origin as Vector2) + Vector2(0, 290.0) * decks.size()


func _make_card(rec: Dictionary, w: float) -> Card:
	var c := Card.new()
	c.model = model
	c.record = rec
	c.record_id = rec["id"]
	c.table = model.tables.get(rec.get("table_id", ""), {})
	c.width = w
	c.rebuild(look, link_names)
	cards[c.record_id] = c
	_cards.add_child(c)
	return c


func _on_event(ev: Dictionary) -> void:
	if canvas.is_empty():
		return
	if ev.get("kind") != "resync":
		var m: Dictionary = ev.get("mutation", {})
		var other: String = str(m.get("canvasId", ""))
		if other != "" and other != canvas["id"]:
			return  # another canvas's cards moving
		if str(ev.get("type", "")) == "canvas.update" and m.get("id") != canvas["id"]:
			return
	_reload_in = 0.3


# ───────────────────────────── per frame ─────────────────────────────

func _process(dt: float) -> void:
	if canvas.is_empty():
		return
	if _reload_in >= 0.0:
		_reload_in -= dt
		if _reload_in < 0.0:
			_reload(false)

	var vp := get_viewport_rect().size
	if absf(_zoom - _zoom_to) > 0.0005 * _zoom:
		_zoom = lerpf(_zoom, _zoom_to, 1.0 - exp(-dt * 18.0))
		_cam.position = _zoom_world - (_zoom_screen - vp * 0.5) / _zoom
	elif _zoom != _zoom_to:
		_zoom = _zoom_to
	if _cam_to != null:
		_cam.position = _cam.position.lerp(_cam_to, 1.0 - exp(-dt * 10.0))
		if _cam.position.distance_to(_cam_to) < 0.5:
			_cam_to = null
	_cam.zoom = Vector2.ONE * _zoom

	if _mode == "drag":
		_drag_tilt = lerpf(_drag_tilt, 0.0, 1.0 - exp(-dt * 5.0))
		_drag_vel = _drag_vel.lerp(Vector2.ZERO, 1.0 - exp(-dt * 8.0))
		for d: Dictionary in _drag:
			(d["card"] as Card).target_rot = float(d["rot"]) + _drag_tilt

	if absf(_dim_a - _dim_to) > 0.003:
		_dim_a = lerpf(_dim_a, _dim_to, 1.0 - exp(-dt * 10.0))
		_dim.queue_redraw()
	elif _dim_a != _dim_to:
		_dim_a = _dim_to
		_dim.queue_redraw()

	var busy := _mode == "drag" or _mode == "marquee"
	if not busy:
		for c: Card in cards.values():
			if c.is_processing():
				busy = true
				break
	if busy:
		_threads.queue_redraw()
		_overlay.queue_redraw()


func s2w(screen: Vector2) -> Vector2:
	return _cam.position + (screen - get_viewport_rect().size * 0.5) / _zoom


func _bounds(with_decks: bool) -> Rect2:
	var box := Rect2()
	var any := false
	for c: Card in cards.values():
		var s := c.face_size()
		var r := Rect2(c.target_pos - s * 0.5, s)
		box = r if not any else box.merge(r)
		any = true
	if with_decks:
		for d: Deck in decks.values():
			var r := Rect2(d.position - Deck.SIZE * 0.5, Deck.SIZE)
			box = r if not any else box.merge(r)
			any = true
	return box if any else Rect2(-400, -300, 800, 600)


func fit(animated := true) -> void:
	var box := _bounds(true).grow(90.0)
	var vp := get_viewport_rect().size
	var z := clampf(minf(vp.x / box.size.x, vp.y / box.size.y), ZOOM_MIN, 1.25)
	_zoom_to = z
	_zoom_world = box.get_center()
	_zoom_screen = vp * 0.5
	if animated:
		_cam_to = box.get_center()
	else:
		_zoom = z
		_cam.position = box.get_center()
		_cam.zoom = Vector2.ONE * z
		_cam_to = null


func _zoom_at(screen: Vector2, factor: float) -> void:
	_cam_to = null
	_zoom_world = s2w(screen)
	_zoom_screen = screen
	_zoom_to = clampf(_zoom_to * factor, ZOOM_MIN, ZOOM_MAX)


# ───────────────────────────── input ─────────────────────────────

func _unhandled_input(e: InputEvent) -> void:
	if canvas.is_empty() or not loaded:
		return
	if e is InputEventMouseButton:
		_mouse_button(e)
	elif e is InputEventMouseMotion:
		_mouse_motion(e)
	elif e is InputEventPanGesture and _examined == null:
		_cam_to = null
		_cam.position += (e as InputEventPanGesture).delta * 12.0 / _zoom
	elif e is InputEventMagnifyGesture and _examined == null:
		_zoom_at((e as InputEventMagnifyGesture).position, (e as InputEventMagnifyGesture).factor)
	elif e is InputEventKey and e.pressed and not e.echo:
		_key(e)


func _mouse_button(e: InputEventMouseButton) -> void:
	var world := s2w(e.position)
	if e.button_index == MOUSE_BUTTON_WHEEL_UP or e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		if e.pressed and _examined == null:
			_zoom_at(e.position, 1.12 if e.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.12)
		return
	if e.button_index == MOUSE_BUTTON_MIDDLE or e.button_index == MOUSE_BUTTON_RIGHT:
		if e.pressed and _examined == null and _mode == "":
			_mode = "pan"
			_cam_to = null
		elif not e.pressed and _mode == "pan":
			_mode = ""
		return
	if e.button_index != MOUSE_BUTTON_LEFT:
		return

	if e.pressed:
		if _examined != null:
			if _examined.hit(world):
				_examined.turn_over()
				_fit_examined()
			else:
				close_examine()
			return
		for p: Pile in piles:
			if p.cards.size() >= 2 and p.badge.has_point(world):
				_press = {"card": p.cards.back(), "screen": e.position, "world": world, "shift": e.shift_pressed, "pile": true}
				_mode = "press"
				return
		var deck := _deck_at(world)
		var card := _card_at(world)
		if card == null and deck != null:
			deal(deck, 10 if e.shift_pressed else 1)
			return
		if card != null:
			if e.double_click:
				_mode = ""
				if card.pile != null and card.pile.cards.size() >= 2:
					toggle_fan(card.pile)
				else:
					examine(card)
				return
			_press = {"card": card, "screen": e.position, "world": world, "shift": e.shift_pressed, "pile": false}
			_mode = "press"
		else:
			if not e.shift_pressed:
				_clear_selection()
			_mode = "marquee"
			_marq_a = world
			_marq_b = world
	else:
		match _mode:
			"press":
				var card: Card = _press["card"]
				if _press["shift"]:
					card.selected = not card.selected
				else:
					_clear_selection()
					card.selected = true
			"drag":
				_drop()
			"marquee":
				_overlay.queue_redraw()
		_mode = ""
		changed.emit()


func _mouse_motion(e: InputEventMouseMotion) -> void:
	var world := s2w(e.position)
	match _mode:
		"pan":
			_cam.position -= e.relative / _zoom
		"press":
			if e.position.distance_to(_press["screen"]) > 5.0:
				_begin_drag()
				_move_drag(world, e.velocity)
		"drag":
			_move_drag(world, e.velocity)
		"marquee":
			_marq_b = world
			var box := Rect2(_marq_a, Vector2.ZERO).expand(_marq_b)
			for c: Card in cards.values():
				var top: bool = c.pile == null or c.pile.fanned or c.pile.cards.back() == c
				var s := c.face_size()
				c.selected = top and box.intersects(Rect2(c.position - s * 0.5, s))
		_:
			if _examined == null:
				_set_hover(_card_at(world))


func _key(e: InputEventKey) -> void:
	if _examined != null:
		match e.keycode:
			KEY_F:
				_examined.turn_over()
				_fit_examined()
			KEY_SPACE, KEY_ESCAPE:
				close_examine()
		get_viewport().set_input_as_handled()
		return
	if _mode != "":
		return
	var handled := true
	match e.keycode:
		KEY_SPACE:
			var c := _focus_card()
			if c != null:
				examine(c)
		KEY_F:
			var flipped := {}
			for c: Card in _focus_cards():
				c.turn_over()
				if c.pile != null:
					flipped[c.pile] = true
			for p: Pile in flipped:
				_layout(p)
		KEY_G:
			gather()
		KEY_X:
			if _hover != null and _hover.pile != null:
				toggle_fan(_hover.pile)
		KEY_S:
			if _hover != null and _hover.pile != null:
				shuffle(_hover.pile)
		KEY_L:
			show_threads = not show_threads
			_threads.queue_redraw()
		KEY_Z:
			fit()
		KEY_R:
			if e.shift_pressed:
				reset()
			else:
				handled = false
		KEY_ESCAPE:
			if _selection().is_empty():
				handled = false
			else:
				_clear_selection()
		_:
			handled = false
	if handled:
		get_viewport().set_input_as_handled()
		changed.emit()


func _card_at(world: Vector2) -> Card:
	for i in range(_cards.get_child_count() - 1, -1, -1):
		var c := _cards.get_child(i) as Card
		if c == null or c.dying:
			continue
		if c.hit(world):
			# in a squared-up pile only the top card can be touched
			if c.pile != null and not c.pile.fanned:
				return c.pile.cards.back()
			return c
	return null


func _deck_at(world: Vector2) -> Deck:
	for d: Deck in decks.values():
		if not d.records.is_empty() and d.hit(world):
			return d
	return null


func _set_hover(c: Card) -> void:
	if c == _hover:
		return
	if _hover != null and is_instance_valid(_hover) and not _hover.dragging:
		_hover.target_lift = 0.0
		_hover.wake()
	_hover = c
	if c != null:
		c.target_lift = 0.16
		c.wake()


func _selection() -> Array:
	var out: Array = []
	for i in _cards.get_child_count():
		var c := _cards.get_child(i) as Card
		if c != null and c.selected and not c.dying:
			out.append(c)
	return out


func _clear_selection() -> void:
	for c: Card in cards.values():
		c.selected = false


func _focus_card() -> Card:
	if _hover != null:
		return _hover
	var sel := _selection()
	return sel[0] if sel.size() == 1 else null


func _focus_cards() -> Array:
	var sel := _selection()
	if _hover != null and not _hover.selected:
		return [_hover]
	return sel


func selection_count() -> int:
	return _selection().size()


# ───────────────────────────── dragging ─────────────────────────────

func _begin_drag() -> void:
	var lead: Card = _press["card"]
	var world: Vector2 = _press["world"]
	var moved: Array = []
	_drag_pile = null
	if lead.pile != null and (_press["pile"] or _press["shift"]):
		_drag_pile = lead.pile
		moved = lead.pile.cards.duplicate()
	elif lead.selected and _selection().size() > 1:
		moved = _selection()
		for c: Card in moved:
			_detach(c)
	else:
		_detach(lead)
		moved = [lead]
	_tidy_piles()
	_drag.clear()
	for c: Card in moved:
		c.dragging = true
		c.target_lift = 1.0
		c.z_index = 100
		_cards.move_child(c, -1)
		_drag.append({"card": c, "off": c.position - world, "rot": c.target_rot})
		c.wake()
	_mode = "drag"
	_drag_tilt = 0.0
	_set_hover(null)


func _move_drag(world: Vector2, velocity: Vector2) -> void:
	for d: Dictionary in _drag:
		var c: Card = d["card"]
		c.target_pos = world + d["off"]
		c.wake()
	_drag_vel = _drag_vel.lerp(velocity / _zoom, 0.4)
	_drag_tilt = clampf(lerpf(_drag_tilt, velocity.x * 0.00035, 0.35), -0.17, 0.17)
	var over := _drop_candidate(world)
	if over != _drop_on:
		if _drop_on != null and is_instance_valid(_drop_on):
			_drop_on.drop_target = false
		_drop_on = over
		if over != null:
			over.drop_target = true


## The card a drop here would land ON: the topmost resting card under the pointer.
func _drop_candidate(world: Vector2) -> Card:
	var moving := {}
	for d: Dictionary in _drag:
		moving[d["card"]] = true
	for i in range(_cards.get_child_count() - 1, -1, -1):
		var c := _cards.get_child(i) as Card
		if c == null or c.dying or moving.has(c):
			continue
		if c.hit(world):
			if c.pile != null and not c.pile.fanned:
				return c.pile.cards.back()
			return c
	return null


func _drop() -> void:
	var target := _drop_on
	if target != null:
		target.drop_target = false
	_drop_on = null
	var moved: Array = []
	for d: Dictionary in _drag:
		var c: Card = d["card"]
		c.dragging = false
		c.z_index = 0
		c.target_lift = 0.0
		c.target_rot = float(d["rot"])
		c.touched = true
		moved.append(c)
		c.wake()
	_drag.clear()

	if _drag_pile != null:
		var p := _drag_pile
		_drag_pile = null
		if target != null and target.pile != p:
			var onto := _pile_of(target)
			for c: Card in p.cards:
				c.pile = onto
				onto.cards.append(c)
			p.cards.clear()
			_layout(onto)
		else:
			p.pos = (p.cards[0] as Card).target_pos
			_layout(p)
	elif target != null:
		var onto := _pile_of(target)
		for c: Card in moved:
			c.pile = onto
			c.jitter = randf_range(-0.045, 0.045)
			onto.cards.append(c)
		_layout(onto)
	else:
		# let go on the bare table: it slides a little and comes to rest slightly askew
		var slide := (_drag_vel * 0.07).limit_length(110.0)
		for c: Card in moved:
			c.target_pos += slide
			c.target_rot = clampf(_drag_tilt * 0.3, -0.05, 0.05)
	_tidy_piles()
	_overlay.queue_redraw()


# ───────────────────────────── piles ─────────────────────────────

func _pile_of(card: Card) -> Pile:
	if card.pile != null:
		return card.pile
	var p := Pile.new()
	p.pos = card.target_pos
	p.cards = [card]
	card.pile = p
	card.jitter = card.target_rot
	piles.append(p)
	return p


func _detach(c: Card) -> void:
	if c.pile != null:
		(c.pile as Pile).cards.erase(c)
		c.pile = null


## Empty piles go; a pile of one is just a card again.
func _tidy_piles() -> void:
	for p: Pile in piles.duplicate():
		if p.cards.is_empty():
			piles.erase(p)
		elif p.cards.size() == 1 and not p.keep_single:
			var c: Card = p.cards[0]
			c.pile = null
			if not c.dragging:
				c.target_rot = 0.0
				c.wake()
			piles.erase(p)
		else:
			_layout(p)
	_overlay.queue_redraw()


func _layout(p: Pile) -> void:
	var n := p.cards.size()
	if n == 0:
		return
	var row_h := 0.0
	for c: Card in p.cards:
		row_h = maxf(row_h, c.face_size().y)
	row_h += 28.0
	var top := p.pos.y - (p.cards[0] as Card).face_size().y * 0.5
	for i in n:
		var c: Card = p.cards[i]
		if c.dragging or c == _examined:
			continue
		if p.fanned:
			var col := i % p.per_row
			var row := i / p.per_row
			var in_row := mini(n - row * p.per_row, p.per_row)
			var mid := (in_row - 1) * 0.5
			# a shallow arc, like a hand of cards laid down
			c.target_pos = Vector2(p.pos.x + col * FAN_STEP, top + row * row_h + c.face_size().y * 0.5 + pow(absf(col - mid), 2.0) * 1.4)
			c.target_rot = (col - mid) * 0.012
		else:
			c.target_pos = p.pos + Vector2(0.8, -1.7) * mini(i, 18)
			c.target_rot = c.jitter
		c.target_lift = 0.0
		_cards.move_child(c, -1)
		c.wake()
	_overlay.queue_redraw()


func toggle_fan(p: Pile) -> void:
	p.fanned = not p.fanned
	_layout(p)


func shuffle(p: Pile) -> void:
	p.cards.shuffle()
	for c: Card in p.cards:
		c.jitter = randf_range(-0.05, 0.05)
		c.target_pos = p.pos + Vector2(randf_range(-90, 90), randf_range(-50, 50))
		c.target_rot = randf_range(-0.5, 0.5)
		c.target_lift = 0.6
		c.wake()
	get_tree().create_timer(0.24).timeout.connect(func() -> void:
		if piles.has(p):
			_layout(p))


## Selected cards become one pile, where the first of them is.
func gather() -> void:
	var sel := _selection()
	if sel.size() < 2:
		notice.emit("Select two or more cards to gather them into a pile.")
		return
	var at: Vector2 = (_hover.target_pos if _hover != null and _hover.selected else (sel[0] as Card).target_pos)
	for c: Card in sel:
		_detach(c)
	var p := Pile.new()
	p.pos = at
	for c: Card in sel:
		c.pile = p
		c.jitter = randf_range(-0.045, 0.045)
		c.touched = true
		p.cards.append(c)
	piles.append(p)
	_tidy_piles()


# ───────────────────────────── decks ─────────────────────────────

func deal(deck: Deck, count: int) -> void:
	var gen := _generation
	for i in count:
		if gen != _generation or deck.records.is_empty():
			return
		var rec: Dictionary = deck.records.pop_front()
		deck.queue_redraw()
		dealt_ids[rec["id"]] = true
		var c := _make_card(rec, Card.W_DEFAULT)
		c.dealt = true
		c.touched = true
		c.home = deck.position
		# it leaves the deck face down and turns over on the way
		c.place(deck.position)
		c.rotation = randf_range(-0.25, 0.25)
		c.flip = 1.0
		c._flip_t = 1.0
		c._flip_to = 1.0
		c.set_face(false)
		c.lift = 1.0
		if deck.hand == null or not piles.has(deck.hand):
			deck.hand = Pile.new()
			deck.hand.fanned = true
			deck.hand.keep_single = true
			deck.hand.per_row = 10
			deck.hand.pos = deck.position + HAND_OFFSET
			piles.append(deck.hand)
		c.pile = deck.hand
		deck.hand.cards.append(c)
		_layout(deck.hand)
		changed.emit()
		if i < count - 1:
			await get_tree().create_timer(0.07).timeout


## Everything back the way the canvas has it: piles undone, dealt cards back in
## their decks, every card face up in its own place.
func reset() -> void:
	close_examine()
	for id: String in cards.keys():
		var c: Card = cards[id]
		c.pile = null
		c.selected = false
		if c.dealt:
			cards.erase(id)
			c.leave()
			continue
		c.touched = false
		c.target_pos = c.home
		c.target_rot = 0.0
		c.target_lift = 0.0
		c.set_face(false)
		c.wake()
	piles.clear()
	dealt_ids.clear()
	for d: Deck in decks.values():
		d.hand = null
	_reload_in = 0.0
	_overlay.queue_redraw()


# ───────────────────────────── examine ─────────────────────────────

func examine(c: Card) -> void:
	if _examined != null:
		close_examine()
	_set_hover(null)
	_examined = c
	_ex_prev = {"pos": c.target_pos, "rot": c.target_rot, "back": c.faces_back()}
	c.z_index = 200
	c.target_rot = 0.0
	c.target_lift = 1.0
	_dim_to = 0.62
	_fit_examined()


## Bring the examined card to the middle at a readable size whatever the zoom.
func _fit_examined() -> void:
	var c := _examined
	var vp := get_viewport_rect().size
	var s := c.face_size()
	var k := minf(EXAMINE_W / s.x, vp.y * 0.86 / s.y)
	c.target_scale = k / _zoom / 1.05
	c.target_pos = _cam.position
	c.wake()


func close_examine() -> void:
	if _examined == null:
		return
	var c := _examined
	_examined = null
	_dim_to = 0.0
	c.target_scale = 1.0
	c.target_lift = 0.0
	c.target_pos = _ex_prev["pos"]
	c.target_rot = _ex_prev["rot"]
	c.set_face(_ex_prev["back"])
	c.z_index = 100
	c.wake()
	# by id, not by reference: the card may be gone (canvas closed) before this fires
	var card_id := c.get_instance_id()
	get_tree().create_timer(0.4).timeout.connect(func() -> void:
		var back := instance_from_id(card_id) as Card
		if back != null and back != _examined and not back.dragging:
			back.z_index = 0)
	if c.pile != null:
		_layout(c.pile)


func examining() -> bool:
	return _examined != null


# ───────────────────────────── drawing ─────────────────────────────

## Links between cards, as threads lying on the table under them.
func _paint_threads(layer: Node2D) -> void:
	if not show_threads:
		return
	var color := Color(Look.CREAM, 0.3)
	for l: Dictionary in scene_links:
		var a: Card = cards.get(l["from_record"])
		var b: Card = cards.get(l["to_record"])
		if a == null or b == null or a.dying or b.dying:
			continue
		if _buried(a) or _buried(b):
			continue
		var p0 := a.position
		var p3 := b.position
		var bend := maxf(absf(p3.x - p0.x) * 0.45, 60.0)
		var p1 := p0 + Vector2(bend, 0)
		var p2 := p3 - Vector2(bend, 0)
		var pts := PackedVector2Array()
		for i in 25:
			pts.append(p0.bezier_interpolate(p1, p2, p3, i / 24.0))
		layer.draw_polyline(pts, color, 1.8, true)


func _buried(c: Card) -> bool:
	return c.pile != null and not (c.pile as Pile).fanned and (c.pile as Pile).cards.back() != c


func _paint_overlay(layer: Node2D) -> void:
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.08, 0.08, 0.07, 0.88)
	box.set_corner_radius_all(11)
	for p: Pile in piles:
		if p.cards.size() < 2:
			p.badge = Rect2()
			continue
		var top: Card = p.cards.back() if not p.fanned else p.cards[0]
		var s := top.face_size()
		var text := str(p.cards.size())
		var w := maxf(30.0, Look.bold().get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x + 18.0)
		var at := top.position + Vector2((s.x * 0.5 - w * 0.5 - 2.0) * (-1.0 if p.fanned else 1.0), -s.y * 0.5 - 13.0)
		p.badge = Rect2(at - Vector2(w * 0.5, 11.0), Vector2(w, 22.0))
		layer.draw_style_box(box, p.badge)
		layer.draw_string(Look.bold(), Vector2(p.badge.position.x, p.badge.position.y + 15.5), text, HORIZONTAL_ALIGNMENT_CENTER, w, 13, Look.CREAM)
	if _mode == "marquee":
		var r := Rect2(_marq_a, Vector2.ZERO).expand(_marq_b)
		layer.draw_rect(r, Color(Look.CREAM, 0.08), true)
		layer.draw_rect(r, Color(Look.CREAM, 0.55), false, 1.0 / _zoom)


func _paint_dim(layer: Node2D) -> void:
	if _dim_a <= 0.003:
		return
	var vp := get_viewport_rect().size / _zoom
	layer.draw_rect(Rect2(_cam.position - vp, vp * 2.0), Color(0.04, 0.04, 0.03, _dim_a), true)
