extends RefCounted
## What the tabletop knows about the schema, and the few rules it shares with the
## web app's contract (src/contract): which field is a record's name, which fields
## a card shows, and how a value reads as one line of text.
##
## Ported by hand from labels.ts and canvasConfig.ts. Kept small on purpose: this
## is a prototype, and everything it does NOT port is listed in tabletop/README.md.

const LABEL_TYPES := ["text", "long_text", "number", "date", "select", "file_path", "dimensions"]
const DEFAULT_CARD_FIELDS := 5

var tables := {}          ## table id -> table (with its fields sorted)
var table_order: Array = []


func set_schema(schema: Array) -> void:
	tables.clear()
	table_order.clear()
	for t: Dictionary in schema:
		var fields: Array = t.get("fields", [])
		fields.sort_custom(_field_before)
		t["fields"] = fields
		tables[t["id"]] = t
		table_order.append(t["id"])


## labels.ts `compareFields`: position, then name.
static func _field_before(a: Dictionary, b: Dictionary) -> bool:
	var pa := float(a.get("position", 0))
	var pb := float(b.get("position", 0))
	if pa != pb:
		return pa < pb
	return str(a.get("name", "")) < str(b.get("name", ""))


func primary_field(table: Dictionary) -> Dictionary:
	for f: Dictionary in table.get("fields", []):
		if LABEL_TYPES.has(f.get("type", "")):
			return f
	return {}


func title_of(record: Dictionary) -> String:
	var table: Dictionary = tables.get(record.get("table_id", ""), {})
	var pf := primary_field(table)
	var data: Dictionary = record.get("data", {})
	if not pf.is_empty():
		var v: Variant = data.get(pf["key"])
		if v != null and str(v) != "":
			return plain(pf, v)
	return str(record.get("id", "")).substr(0, 8)


func table_name(table: Dictionary) -> String:
	return str(table.get("name", "?"))


func table_color(table: Dictionary) -> Color:
	var c := str(table.get("color", ""))
	if c != "" and Color.html_is_valid(c):
		return Color.html(c)
	return Color("5b584d")


## A canvas wears its own look only when its config says `ownLook`; otherwise its
## home table's (canvasConfig.ts `lookOf`).
func look_of(canvas: Dictionary) -> Dictionary:
	var config: Variant = canvas.get("config", {})
	if config is Dictionary and config.get("ownLook", false) == true:
		return config
	var home: Dictionary = tables.get(canvas.get("table_id", ""), {})
	var shared: Variant = home.get("canvas_look")
	return shared if shared is Dictionary else {}


## canvasConfig.ts `cardFieldsFor`.
func card_fields(table: Dictionary, look: Dictionary) -> Array:
	var fields: Array = table.get("fields", [])
	var chosen: Variant = (look.get("cardFields", {}) as Dictionary).get(table.get("id", ""))
	if chosen is Array:
		var by_id := {}
		for f: Dictionary in fields:
			by_id[f["id"]] = f
		var out: Array = []
		for id: Variant in chosen:
			if by_id.has(id):
				out.append(by_id[id])
		return out
	var pf := primary_field(table)
	var rest: Array = []
	for f: Dictionary in fields:
		if f.get("id") != pf.get("id"):
			rest.append(f)
		if rest.size() >= DEFAULT_CARD_FIELDS:
			break
	return rest


## Rows for the card's FRONT: [[label, value], …]. `links` is the table's index of
## link names (see Table._index_links).
func front_rows(record: Dictionary, look: Dictionary, links: Dictionary) -> Array:
	var table: Dictionary = tables.get(record.get("table_id", ""), {})
	var hide_empty: bool = look.get("hideEmpty", false) == true
	var pinned: Variant = (look.get("pinnedFields", {}) as Dictionary).get(table.get("id", ""), [])
	var rows: Array = []
	for f: Dictionary in card_fields(table, look):
		var text := value_text(record, f, links)
		if text == "" and hide_empty and not (pinned is Array and (pinned as Array).has(f["id"])):
			continue
		rows.append([str(f.get("name", "")), text])
	return rows


## Rows for the card's BACK: every field but the name, in schema order, unless the
## table lists its own (`card_back`, sql/025).
func back_rows(record: Dictionary, links: Dictionary) -> Array:
	var table: Dictionary = tables.get(record.get("table_id", ""), {})
	var fields: Array = table.get("fields", [])
	var listed: Variant = table.get("card_back")
	var show: Array = []
	if listed is Array and not (listed as Array).is_empty():
		var by_id := {}
		for f: Dictionary in fields:
			by_id[f["id"]] = f
		for id: Variant in listed:
			if by_id.has(id):
				show.append(by_id[id])
	else:
		var pf := primary_field(table)
		for f: Dictionary in fields:
			if f.get("id") != pf.get("id"):
				show.append(f)
	var rows: Array = []
	for f: Dictionary in show:
		rows.append([str(f.get("name", "")), value_text(record, f, links)])
	return rows


func value_text(record: Dictionary, field: Dictionary, links: Dictionary) -> String:
	var type := str(field.get("type", ""))
	if type == "link" or type == "backlink":
		var key := "%s|%s" % [field.get("id", ""), record.get("id", "")]
		if type == "backlink":
			key = "back|%s|%s" % [(field.get("options", {}) as Dictionary).get("source_field_id", ""), record.get("id", "")]
		var names: Array = links.get(key, [])
		return ", ".join(PackedStringArray(names))
	if type == "lookup":
		return ""  # computed in the web client from links; not ported
	var data: Dictionary = record.get("data", {})
	var v: Variant = data.get(field.get("key", ""))
	if v == null:
		return ""
	return plain(field, v)


func plain(field: Dictionary, v: Variant) -> String:
	match str(field.get("type", "")):
		"checkbox":
			return "yes" if v == true else "no"
		"number":
			return _number(v)
		"multi_select":
			if v is Array:
				var parts := PackedStringArray()
				for x: Variant in v:
					parts.append(str(x))
				return ", ".join(parts)
			return str(v)
		"rich_text":
			return _rich_plain(v).strip_edges()
		"attachment":
			if v is Array:
				return "%d attached" % (v as Array).size()
			return ""
		"structured":
			return _structured(v)
	if v is float or v is int:
		return _number(v)
	if v is Dictionary or v is Array:
		return _structured(v)
	return str(v)


static func _number(v: Variant) -> String:
	if v is float and is_equal_approx(v, roundf(v)):
		return str(int(v))
	return str(v)


## The text of a TipTap document, paragraphs joined by spaces. Task items get a box.
static func _rich_plain(node: Variant) -> String:
	if node is String:
		return node
	if node is Array:
		var out := ""
		for child: Variant in node:
			out += _rich_plain(child)
		return out
	if node is Dictionary:
		var d: Dictionary = node
		if d.get("type") == "text":
			return str(d.get("text", ""))
		var inner := _rich_plain(d.get("content", []))
		match str(d.get("type", "")):
			"taskItem":
				var done: bool = (d.get("attrs", {}) as Dictionary).get("checked", false) == true
				return ("[x] " if done else "[ ] ") + inner + "  "
			"listItem":
				return "· " + inner + "  "
			"paragraph", "heading":
				return inner + " "
		return inner
	return ""


## A structured value (audio layout, video layout, manifest, timeline audio) as a
## rough one-liner. The web app has a proper summary per shape; this does not.
static func _structured(v: Variant) -> String:
	if v is Array:
		return "%d items" % (v as Array).size()
	if v is Dictionary:
		var d: Dictionary = v
		for key: String in ["tracks", "items", "files", "clips"]:
			if d.get(key) is Array:
				return "%d %s" % [(d[key] as Array).size(), key]
		return "(structured)"
	return str(v)
