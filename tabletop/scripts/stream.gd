extends Node
const Api := preload("res://scripts/api.gd")
## The server's change stream (GET /api/stream?since=<seq>, server-sent events),
## read with a plain HTTPClient because HTTPRequest only hands over a finished body.
## Reconnects by itself from the last seq it saw.

signal event(ev: Dictionary)
signal state_changed(live: bool)

var api: Api
var seq := 0
var live := false

var _client: HTTPClient = null
var _requested := false
var _buf := PackedByteArray()
var _retry_in := 0.0
var _running := false


func start(from_seq: int) -> void:
	seq = from_seq
	_running = true
	_open()


func stop() -> void:
	_running = false
	_close()


func _open() -> void:
	_close()
	var url := api.base_url
	var https := url.begins_with("https://")
	var rest := url.get_slice("://", 1)
	var host := rest
	var port := 443 if https else 80
	if rest.contains(":"):
		host = rest.get_slice(":", 0)
		port = int(rest.get_slice(":", 1))
	_client = HTTPClient.new()
	var tls: TLSOptions = null
	if https:
		tls = api.tls_options() if api.tls_options() != null else TLSOptions.client()
	if _client.connect_to_host(host, port, tls) != OK:
		_fail()


func _close() -> void:
	if _client != null:
		_client.close()
	_client = null
	_requested = false
	_buf = PackedByteArray()
	_set_live(false)


func _fail() -> void:
	_close()
	_retry_in = 3.0


func _set_live(v: bool) -> void:
	if live != v:
		live = v
		state_changed.emit(v)


func _process(dt: float) -> void:
	if not _running:
		return
	if _client == null:
		_retry_in -= dt
		if _retry_in <= 0.0:
			_open()
		return
	_client.poll()
	match _client.get_status():
		HTTPClient.STATUS_CONNECTED:
			if not _requested:
				var headers := PackedStringArray(["Accept: text/event-stream", "Authorization: Bearer " + api.token])
				if _client.request(HTTPClient.METHOD_GET, "/api/stream?since=%d" % seq, headers) != OK:
					_fail()
				_requested = true
			else:
				_fail()  # the response ended; the server closed the stream
		HTTPClient.STATUS_BODY:
			if _client.get_response_code() != 200:
				_fail()
				return
			_set_live(true)
			var chunk := _client.read_response_body_chunk()
			if chunk.size() > 0:
				_buf.append_array(chunk)
				_drain()
		HTTPClient.STATUS_RESOLVING, HTTPClient.STATUS_CONNECTING, HTTPClient.STATUS_REQUESTING:
			pass
		_:
			_fail()


func _drain() -> void:
	while true:
		var nl := _buf.find(10)
		if nl < 0:
			return
		var line := _buf.slice(0, nl).get_string_from_utf8().strip_edges()
		_buf = _buf.slice(nl + 1)
		if not line.begins_with("data:"):
			continue  # ": open", ": ping", blank separators
		var ev: Variant = JSON.parse_string(line.substr(5).strip_edges())
		if ev is Dictionary:
			if ev.has("seq"):
				seq = maxi(seq, int(ev["seq"]))
			event.emit(ev)
