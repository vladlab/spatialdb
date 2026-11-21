extends Node
# Preloaded, not class_name: global class names live in the .godot cache, which is
# not in the repo, so a fresh checkout could not find them when run without the editor.
const Api := preload("res://scripts/api.gd")
const Table := preload("res://scripts/table.gd")
const Card := preload("res://scripts/card.gd")
const Look := preload("res://scripts/look.gd")
## The app around the table: sign in, pick a canvas, and the few words of HUD.

const CFG_PATH := "user://tabletop.cfg"
const HELP := """drag a card to move it  ·  drop it on another to pile them
double-click a card to examine it  ·  double-click a pile to fan or square it
drag a pile's count to move the whole pile  ·  click a deck to deal from it
drag on the table to select  ·  right-drag to pan  ·  wheel to zoom

Space  examine      F  turn over      G  gather selection into a pile
X  fan / square pile      S  shuffle pile      L  threads on / off
Z  fit everything      Shift+R  put everything back      Esc  canvases      H  hide this"""

var api := Api.new()
var table := Table.new()
var cfg := ConfigFile.new()
var canvases: Array = []
var shown: Array = []          ## the canvases in the list, in list order
var want_canvas := ""          ## --canvas=<id>

var ui := Control.new()
var connect_box: Control
var picker_box: Control
var hud: Control
var f_url := LineEdit.new()
var f_email := LineEdit.new()
var f_password := LineEdit.new()
var f_ca := LineEdit.new()
var b_connect := Button.new()
var l_error := Label.new()
var f_filter := LineEdit.new()
var list := ItemList.new()
var l_picker := Label.new()
var l_who := Label.new()
var l_name := Label.new()
var l_live := Label.new()
var l_counts := Label.new()
var l_help := Label.new()
var l_toast := Label.new()
var toast_left := 0.0


func _ready() -> void:
	get_window().title = "spatialdb tabletop"
	get_window().min_size = Vector2i(900, 600)
	add_child(api)
	_build_background()
	table.api = api
	add_child(table)
	_build_ui()
	api.signed_out.connect(_on_signed_out)
	table.changed.connect(_refresh_hud)
	table.notice.connect(_toast)
	table.failed.connect(func(text: String) -> void:
		table.close()
		_show(picker_box)
		l_picker.text = "Could not open that canvas: %s" % text)

	cfg.load(CFG_PATH)
	var url: String = cfg.get_value("server", "url", "")
	var ca: String = cfg.get_value("server", "ca", "")
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--canvas="):
			want_canvas = arg.trim_prefix("--canvas=")
		elif arg.begins_with("--url="):
			url = arg.trim_prefix("--url=")
	if OS.has_environment("SPATIALDB_URL"):
		url = OS.get_environment("SPATIALDB_URL")
	if OS.has_environment("SPATIALDB_CA"):
		ca = OS.get_environment("SPATIALDB_CA")
	f_url.text = url
	f_ca.text = ca
	f_email.text = cfg.get_value("server", "email", "")
	var token: String = cfg.get_value("server", "token", "")

	_show(connect_box)
	if url != "" and token != "" and url == cfg.get_value("server", "url", ""):
		_busy(true, "Signing in…")
		if api.configure(url, ca) == "":
			api.token = token
			var me := await api.fetch("/api/auth/me")
			if me.ok:
				_busy(false, "")
				_load_canvases()
				return
		api.token = ""
		_busy(false, "")
	(f_url if f_url.text == "" else (f_email if f_email.text == "" else f_password)).grab_focus()


func _process(dt: float) -> void:
	if toast_left > 0.0:
		toast_left -= dt
		if toast_left <= 0.0:
			l_toast.visible = false


func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventKey and e.pressed and not e.echo) or not hud.visible:
		return
	match (e as InputEventKey).keycode:
		KEY_ESCAPE:
			_back_to_canvases()
		KEY_H:
			l_help.visible = not l_help.visible


# ───────────────────────────── sign in ─────────────────────────────

func _on_connect() -> void:
	if f_url.text.strip_edges() == "" or f_email.text.strip_edges() == "" or f_password.text == "":
		l_error.text = "Server address, email and password are all needed."
		return
	var problem := api.configure(f_url.text, f_ca.text)
	if problem != "":
		l_error.text = problem
		return
	_busy(true, "Signing in…")
	var r := await api.login(f_email.text.strip_edges(), f_password.text)
	_busy(false, "")
	if not r.ok:
		l_error.text = r.error
		return
	f_password.text = ""
	cfg.set_value("server", "url", api.base_url)
	cfg.set_value("server", "email", f_email.text.strip_edges())
	cfg.set_value("server", "ca", api.ca_path)
	cfg.set_value("server", "token", api.token)
	_save_cfg()
	_load_canvases()


func _on_signed_out() -> void:
	if connect_box.visible:
		return
	table.close()
	api.token = ""
	cfg.set_value("server", "token", "")
	_save_cfg()
	_show(connect_box)
	l_error.text = "Signed out. Sign in again to carry on."
	f_password.grab_focus()


func _sign_out() -> void:
	api.token = ""
	cfg.set_value("server", "token", "")
	_save_cfg()
	_show(connect_box)
	l_error.text = ""
	f_password.grab_focus()


## The file holds a session token, so it is readable by this user only.
func _save_cfg() -> void:
	cfg.save(CFG_PATH)
	FileAccess.set_unix_permissions(CFG_PATH, FileAccess.UNIX_READ_OWNER | FileAccess.UNIX_WRITE_OWNER)


func _busy(on: bool, text: String) -> void:
	b_connect.disabled = on
	l_error.text = text


# ───────────────────────────── canvases ─────────────────────────────

func _load_canvases() -> void:
	_show(picker_box)
	l_who.text = "%s  ·  %s" % [api.base_url.get_slice("://", 1), cfg.get_value("server", "email", "")]
	l_picker.text = "Loading…"
	var s := await api.fetch("/api/schema")
	var c := await api.fetch("/api/canvases")
	if not s.ok or not c.ok:
		l_picker.text = s.error if not s.ok else c.error
		return
	table.model.set_schema(s.data)
	canvases = c.data
	for entry: Dictionary in canvases:
		var t: Dictionary = table.model.tables.get(entry.get("table_id", ""), {})
		entry["_table"] = table.model.table_name(t)
		entry["_title"] = table.model.title_of(entry)
	canvases.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a["_table"] != b["_table"]:
			return a["_table"] < b["_table"]
		return str(a["_title"]).naturalnocasecmp_to(str(b["_title"])) < 0)
	l_picker.text = "" if not canvases.is_empty() else "This server has no canvases yet."
	_fill_list()
	f_filter.grab_focus()
	if want_canvas != "":
		var id := want_canvas
		want_canvas = ""
		for entry: Dictionary in canvases:
			if entry["id"] == id:
				_open(entry)
				return
		l_picker.text = "No canvas with the id %s." % id


func _fill_list() -> void:
	list.clear()
	shown.clear()
	var q := f_filter.text.strip_edges().to_lower()
	for entry: Dictionary in canvases:
		var label := "%s  ›  %s" % [entry["_table"], entry["_title"]]
		if q != "" and not label.to_lower().contains(q):
			continue
		list.add_item(label)
		shown.append(entry)
	if not shown.is_empty():
		list.select(0)


func _open_selected() -> void:
	var sel := list.get_selected_items()
	if sel.is_empty():
		return
	_open(shown[sel[0]])


func _open(entry: Dictionary) -> void:
	_show(hud)
	l_name.text = "%s  ›  %s" % [entry["_table"], entry["_title"]]
	l_counts.text = "opening…"
	table.open(entry)


func _back_to_canvases() -> void:
	table.close()
	_load_canvases()


func _refresh_hud() -> void:
	if not hud.visible:
		return
	l_live.text = "●  live" if table.stream.live else "○  reconnecting…"
	l_live.add_theme_color_override("font_color", Color("9fc27a") if table.stream.live else Look.GOLD)
	var placed := 0
	for c: Card in table.cards.values():
		if not c.dealt:
			placed += 1
	var parts := PackedStringArray(["1 card" if placed == 1 else "%d cards" % placed])
	if table.cards.size() > placed:
		parts.append("%d dealt" % (table.cards.size() - placed))
	if not table.piles.is_empty():
		parts.append("1 pile" if table.piles.size() == 1 else "%d piles" % table.piles.size())
	if table.selection_count() > 0:
		parts.append("%d selected" % table.selection_count())
	l_counts.text = "  ·  ".join(parts)


func _toast(text: String) -> void:
	l_toast.text = text
	l_toast.visible = true
	toast_left = 5.0


func _show(which: Control) -> void:
	for box: Control in [connect_box, picker_box, hud]:
		box.visible = box == which
	l_toast.visible = false


# ───────────────────────────── building the UI ─────────────────────────────

func _build_background() -> void:
	var layer := CanvasLayer.new()
	layer.layer = -10
	add_child(layer)
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = """shader_type canvas_item;
uniform vec4 base : source_color;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void fragment() {
	float light = smoothstep(0.95, 0.15, length(UV - 0.5));
	float grain = hash(floor(FRAGCOORD.xy)) - 0.5;
	COLOR = vec4(base.rgb * mix(0.62, 1.18, light) + grain * 0.022, 1.0);
}"""
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.set_shader_parameter("base", Look.FELT)
	rect.material = mat
	layer.add_child(rect)


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.theme = _theme()
	layer.add_child(ui)

	# sign in
	connect_box = _centered(420)
	var v := connect_box.get_meta("body") as VBoxContainer
	v.add_child(_heading("spatialdb tabletop"))
	v.add_child(_muted("A read-only card table over your spatialdb server.\nNothing you do here is saved or written back."))
	v.add_child(_spacer(6))
	v.add_child(_field("Server", f_url, "https://vsrv.example"))
	v.add_child(_field("Email", f_email, ""))
	f_password.secret = true
	v.add_child(_field("Password", f_password, ""))
	v.add_child(_field("CA certificate (optional)", f_ca, "/path/to/caddy-root.crt"))
	v.add_child(_spacer(4))
	b_connect.text = "Sign in"
	b_connect.pressed.connect(_on_connect)
	v.add_child(b_connect)
	l_error.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l_error.add_theme_color_override("font_color", Look.GOLD)
	l_error.custom_minimum_size = Vector2(0, 44)
	v.add_child(l_error)
	for f: LineEdit in [f_url, f_email, f_password, f_ca]:
		f.text_submitted.connect(func(_t: String) -> void: _on_connect())

	# canvases
	picker_box = _centered(560)
	v = picker_box.get_meta("body") as VBoxContainer
	var head := HBoxContainer.new()
	var h := _heading("Canvases")
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	var out := Button.new()
	out.text = "Sign out"
	out.pressed.connect(_sign_out)
	head.add_child(out)
	v.add_child(head)
	l_who.add_theme_color_override("font_color", Look.UI_MUTED)
	v.add_child(l_who)
	f_filter.placeholder_text = "Filter…"
	f_filter.text_changed.connect(func(_t: String) -> void: _fill_list())
	f_filter.text_submitted.connect(func(_t: String) -> void: _open_selected())
	v.add_child(f_filter)
	list.custom_minimum_size = Vector2(0, 380)
	list.item_activated.connect(func(_i: int) -> void: _open_selected())
	v.add_child(list)
	l_picker.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l_picker.add_theme_color_override("font_color", Look.GOLD)
	v.add_child(l_picker)
	var open := Button.new()
	open.text = "Open on the table"
	open.pressed.connect(_open_selected)
	v.add_child(open)

	# on the table
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(hud)
	var bar := HBoxContainer.new()
	bar.position = Vector2(14, 12)
	bar.add_theme_constant_override("separation", 14)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(bar)
	var back := Button.new()
	back.text = "‹  Canvases"
	back.focus_mode = Control.FOCUS_NONE
	back.pressed.connect(_back_to_canvases)
	bar.add_child(back)
	l_name.add_theme_font_size_override("font_size", 16)
	bar.add_child(l_name)
	var chip := Label.new()
	chip.text = "read-only"
	chip.add_theme_color_override("font_color", Look.UI_MUTED)
	bar.add_child(chip)
	bar.add_child(l_live)
	l_counts.add_theme_color_override("font_color", Look.UI_MUTED)
	bar.add_child(l_counts)

	l_help.text = HELP
	l_help.add_theme_font_size_override("font_size", 12)
	l_help.add_theme_color_override("font_color", Color(Look.UI_TEXT, 0.62))
	l_help.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(l_help)
	_pin_bottom(l_help, 0.0, 16.0, -14.0)

	l_toast.visible = false
	l_toast.add_theme_color_override("font_color", Look.CREAM)
	l_toast.add_theme_stylebox_override("normal", _flat(Color(0.07, 0.07, 0.06, 0.92), 8, 11))
	l_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(l_toast)
	_pin_bottom(l_toast, 0.5, 0.0, -150.0)


## Sit a control on the bottom edge, growing upward (and outward from `anchor_x`).
func _pin_bottom(c: Control, anchor_x: float, left: float, bottom: float) -> void:
	c.anchor_left = anchor_x
	c.anchor_right = anchor_x
	c.anchor_top = 1.0
	c.anchor_bottom = 1.0
	c.grow_vertical = Control.GROW_DIRECTION_BEGIN
	c.grow_horizontal = Control.GROW_DIRECTION_BOTH if anchor_x == 0.5 else Control.GROW_DIRECTION_END
	c.offset_left = left
	c.offset_right = left
	c.offset_top = bottom
	c.offset_bottom = bottom


func _centered(width: int) -> Control:
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(width, 0)
	center.add_child(panel)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 9)
	panel.add_child(body)
	center.set_meta("body", body)
	return center


func _heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 22)
	return l


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", Look.UI_MUTED)
	return l


func _spacer(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c


func _field(label: String, edit: LineEdit, hint: String) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 3)
	var l := Label.new()
	l.text = label
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", Look.UI_MUTED)
	v.add_child(l)
	edit.placeholder_text = hint
	v.add_child(edit)
	return v


func _theme() -> Theme:
	var t := Theme.new()
	t.default_font = Look.ui()
	t.default_font_size = 14
	t.set_color("font_color", "Label", Look.UI_TEXT)
	var panel := _flat(Look.UI_PANEL, 10, 22)
	panel.shadow_size = 24
	panel.shadow_color = Color(0, 0, 0, 0.45)
	panel.shadow_offset = Vector2(0, 8)
	t.set_stylebox("panel", "PanelContainer", panel)
	t.set_stylebox("normal", "Button", _flat(Look.UI_LINE, 6, 9))
	t.set_stylebox("hover", "Button", _flat(Look.UI_LINE.lightened(0.12), 6, 9))
	t.set_stylebox("pressed", "Button", _flat(Look.UI_LINE.darkened(0.15), 6, 9))
	t.set_stylebox("disabled", "Button", _flat(Look.UI_LINE.darkened(0.3), 6, 9))
	t.set_stylebox("focus", "Button", _outline())
	t.set_color("font_color", "Button", Look.UI_TEXT)
	t.set_color("font_hover_color", "Button", Look.CREAM)
	t.set_stylebox("normal", "LineEdit", _flat(Look.UI_BG, 6, 9))
	t.set_stylebox("focus", "LineEdit", _outline())
	t.set_color("font_color", "LineEdit", Look.UI_TEXT)
	t.set_color("font_placeholder_color", "LineEdit", Color(Look.UI_MUTED, 0.6))
	t.set_color("caret_color", "LineEdit", Look.CREAM)
	t.set_stylebox("panel", "ItemList", _flat(Look.UI_BG, 6, 6))
	t.set_stylebox("focus", "ItemList", _outline())
	t.set_stylebox("selected", "ItemList", _flat(Look.UI_LINE, 4, 2))
	t.set_stylebox("selected_focus", "ItemList", _flat(Look.UI_LINE.lightened(0.1), 4, 2))
	t.set_stylebox("hovered", "ItemList", _flat(Color(Look.UI_LINE, 0.4), 4, 2))
	t.set_color("font_color", "ItemList", Look.UI_TEXT)
	t.set_color("font_selected_color", "ItemList", Look.CREAM)
	t.set_constant("v_separation", "ItemList", 6)
	return t


func _flat(color: Color, radius: int, margin: int) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = color
	s.set_corner_radius_all(radius)
	s.set_content_margin_all(margin)
	return s


func _outline() -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.draw_center = false
	s.set_corner_radius_all(6)
	s.set_border_width_all(1)
	s.border_color = Look.GOLD
	return s
