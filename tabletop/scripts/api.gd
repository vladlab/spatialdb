extends Node
## Talks to a spatialdb server. READ-ONLY by construction: the only request that
## is not a GET is the sign-in, and `_send` refuses anything else. The tabletop
## never calls /api/mutate.

signal signed_out  ## the server answered 401: the token is gone or expired

var base_url := ""
var token := ""
var ca_path := ""
var _tls: TLSOptions = null


## Returns "" when fine, else what is wrong with the CA file.
func configure(url: String, ca: String) -> String:
	base_url = url.strip_edges().trim_suffix("/")
	if base_url != "" and not base_url.contains("://"):
		base_url = "https://" + base_url
	ca_path = ca.strip_edges()
	_tls = null
	if ca_path != "":
		var cert := X509Certificate.new()
		if cert.load(ca_path) != OK:
			return "Could not read the certificate file: %s" % ca_path
		_tls = TLSOptions.client(cert)
	return ""


func tls_options() -> TLSOptions:
	return _tls


func login(email: String, password: String) -> Dictionary:
	var r := await _send(HTTPClient.METHOD_POST, "/api/auth/login", {"email": email, "password": password})
	if r.ok and r.data is Dictionary and r.data.has("token"):
		token = str(r.data["token"])
	elif r.ok:
		r.ok = false
		r.error = "The server signed in but sent no token."
	return r


func fetch(path: String) -> Dictionary:
	return await _send(HTTPClient.METHOD_GET, path, null)


func _send(method: int, path: String, body: Variant) -> Dictionary:
	# The whole write surface of this client is the sign-in.
	assert(method == HTTPClient.METHOD_GET or path == "/api/auth/login", "the tabletop is read-only")
	if method != HTTPClient.METHOD_GET and path != "/api/auth/login":
		return {"ok": false, "status": 0, "error": "refused: the tabletop is read-only", "data": null}

	var req := HTTPRequest.new()
	req.timeout = 20.0
	add_child(req)
	if _tls != null:
		req.set_tls_options(_tls)
	var headers := PackedStringArray(["Accept: application/json"])
	if token != "" and path != "/api/auth/login":
		headers.append("Authorization: Bearer " + token)
	var payload := ""
	if body != null:
		headers.append("Content-Type: application/json")
		payload = JSON.stringify(body)
	var err := req.request(base_url + path, headers, method, payload)
	if err != OK:
		req.queue_free()
		return {"ok": false, "status": 0, "error": "Could not start the request (%s). Is the address right?" % error_string(err), "data": null}
	var res: Array = await req.request_completed
	req.queue_free()

	var result: int = res[0]
	var status: int = res[1]
	var text: String = (res[3] as PackedByteArray).get_string_from_utf8()
	if result != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": 0, "error": _result_text(result), "data": null}
	var data: Variant = JSON.parse_string(text) if text != "" else null
	if status == 401 and path != "/api/auth/login":
		signed_out.emit()
	if status < 200 or status >= 300:
		var msg := "The server answered %d." % status
		if data is Dictionary and data.has("error"):
			msg = str(data["error"])
		elif status == 401:
			msg = "Wrong email or password." if path == "/api/auth/login" else "Signed out."
		elif status == 429:
			msg = "Too many attempts; wait a little and try again."
		return {"ok": false, "status": status, "error": msg, "data": data}
	return {"ok": true, "status": status, "error": "", "data": data}


func _result_text(result: int) -> String:
	match result:
		HTTPRequest.RESULT_CANT_RESOLVE:
			return "That server name could not be found."
		HTTPRequest.RESULT_CANT_CONNECT, HTTPRequest.RESULT_CONNECTION_ERROR:
			return "Could not connect to the server."
		HTTPRequest.RESULT_TLS_HANDSHAKE_ERROR:
			return "The server's certificate was not trusted. If it is signed by Caddy's internal CA, give the path to that root certificate below."
		HTTPRequest.RESULT_TIMEOUT:
			return "The server did not answer in time."
		_:
			return "The request failed (%d)." % result
