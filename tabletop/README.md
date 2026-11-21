# spatialdb tabletop (prototype)

A native card table over a spatialdb server, built in Godot 4. It exists to answer
one question: **does handling records as physical cards feel good enough to be worth
a second client?** It is a throwaway until that is answered.

It is **read-only**. It signs in, reads a canvas, and follows the server's change
stream. It never calls `/api/mutate`; `scripts/api.gd` refuses any request that is
not a GET or the sign-in. Everything you do on the table (moving, piling, fanning,
dealing, turning cards over) lives in this window only and is forgotten when the
canvas is closed.

Nothing here touches the web app, the server or `src-tauri/`. Deleting this folder
removes it completely.

## Running it

Needs Godot **4.3 or newer** (tested on 4.3 and 4.5). Godot is one self-contained
binary from <https://godotengine.org/download/linux/>; no build step, no packages.

```
godot --path tabletop
```

On NixOS, `nix run nixpkgs#godot_4 -- --path tabletop` should do the same (not tested).

Sign in with your spatialdb email and password, pick a canvas. Optional:

- `SPATIALDB_URL=https://…` or `-- --url=https://…` presets the server address.
- `SPATIALDB_CA=/path/root.crt` trusts one extra CA (Caddy's internal root).
- `-- --canvas=<record id>` opens that canvas straight away.

The server address, email and **session token** are remembered in
`~/.local/share/spatialdb-tabletop/tabletop.cfg` (plain text, readable by your user only). The
password is never stored.

## What you can do

| | |
|---|---|
| drag a card | it lifts, leans into the movement, and slides a little when let go |
| drop a card on another | they become a pile (the card it will land on is ringed first) |
| drag a pile's count | moves the whole pile; drop it on a card or pile to merge |
| double-click a pile, or **X** | fan it out / square it up |
| **S** over a pile | shuffle it |
| drag on the table, then **G** | select cards and gather them into one pile |
| double-click a card, or **Space** | examine: it comes up to the middle at a readable size |
| **F**, or click the examined card | turn it over: the back lists every field |
| click a deck | deal one record that is not on this canvas; shift-click deals 10 |
| wheel, right-drag | zoom, pan. **Z** fits everything |
| **L** | link threads on / off |
| **Shift+R** | put everything back the way the canvas has it |
| **Esc** | close examine → clear selection → back to the canvas list |

Decks are the records of each ordinary table that are *not* placed on the canvas
(the same list the web app's unplaced endpoint returns). Dealing does not place
anything on the real canvas.

Live changes: a card edited in the web app redraws and flashes; a card placed there
comes down onto the table; a card moved there glides to its new place, unless you
have moved or piled it here.

## How it maps to the server

| file | what |
|---|---|
| `scripts/api.gd` | sign-in (bearer token), GET helpers, the read-only guard |
| `scripts/stream.gd` | `GET /api/stream` (server-sent events) with reconnect |
| `scripts/model.gd` | primary field, card fields and shared look (`lookOf`, `cardFieldsFor`), hide-empty and pins, values as text — ported by hand from `src/contract` |
| `scripts/card.gd` | one card, drawn by hand: lift, shadow, the turn-over |
| `scripts/table.gd` | the canvas as a table: camera, dragging, piles, decks, examine, live refresh |
| `scripts/main.gd` | sign-in screen, canvas list, HUD |

Depth is faked in 2D: a lifted card grows slightly and its shadow slides away and
softens; a turning card is squeezed and sheared about its vertical axis and swaps
faces half-way. Card text uses a distance-field system font (Inter if installed), so
it stays sharp at any zoom.

## Tested, and not

Run against a local server with sample data, under a virtual display with software
OpenGL: sign-in (and a wrong password), the canvas list, loading a canvas, drag,
drop-to-pile, fan, deal, examine, turn over, reset, and a live edit / place / move
arriving over the stream. Real mouse, wheel and key events were sent through
Godot's own input dispatch.

**Not tested:** a real GPU or a real mouse (so the *feel*, which is the whole point,
is unjudged), HTTPS and the `SPATIALDB_CA` path, Wayland, a large canvas (hundreds
of cards), an expired session, trackpad gestures.

## Not ported from the web canvas

Deliberately left out of a prototype; each is a known gap, not an oversight:

- Colour rules and the glow, card watermarks, folded (`collapsed`) cards, stacks,
  annotations.
- Structured values (audio / video layouts, manifests, the mini timeline) print as a
  rough count, not the web app's summaries or strips.
- Lookup fields are blank. Link and backlink pills only name records that are also
  on the canvas (the scene endpoint only carries those links).
- The card back ignores field sections (no wells); it honours `card_back` when set.
- Titles wrap at words, else by character — not after `_ - . /` as the web card does.
- Card heights are this client's own, so a card can be a little taller or shorter
  than in the browser; top-left corners match the canvas.
- Compare, canvas notes, editing of any kind, file drop.
