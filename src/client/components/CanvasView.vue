<!--
  The canvas.

  Structure follows viznotes' CanvasView: a container that owns pointer input, a
  dot-grid background, a transformed world holding the cards, and an SVG layer
  under them for the connections. What differs is where state lives — every
  position here comes from `placements` in the store, and every change leaves as a
  mutation.
-->
<template>
  <!-- The CONTEXT BAR sits above the canvas, not over it: everything that acts on
       the canvas tab lives directly under the tabs (App.vue), and the canvas's own
       rectangle — which drops, zoom-at-cursor and "fit" all measure — is exactly the
       drawing surface and nothing else. -->
  <div class="canvas-view">
    <div class="canvas-controls context-bar" @pointerdown.stop>
      <button
        :class="{ active: viewport.scrollMode.value === 'mouse' }"
        :title="viewport.scrollMode.value === 'mouse'
          ? 'Mouse: scroll zooms (click for touchpad)'
          : 'Touchpad: scroll pans (click for mouse)'"
        @click="toggleScrollMode"
      >{{ viewport.scrollMode.value === 'mouse' ? 'mouse' : 'pad' }}</button>
      <span class="sep" />
      <button @click="viewport.zoomOut()" title="Zoom out">−</button>
      <span class="zoom">{{ viewport.zoomPercent.value }}%</span>
      <button @click="viewport.zoomIn()" title="Zoom in">+</button>
      <button @click="viewport.resetZoom()" title="Reset to 100%">1:1</button>
      <!-- FIT: the whole board when nothing is selected (Z, Shift+Z always); the
           selection — a card, a stack, or several — when something is (Z). -->
      <button class="fit" :title="hasSelection ? 'Fit the selection to the view (Z) · Shift+Z fits everything' : 'Fit everything on the board into view (Z)'" @click="fit">{{ hasSelection ? 'fit sel' : 'fit' }}</button>
      <span class="sep" />
      <!-- Which RELATIONAL arrows are drawn. A viewing preference, kept in this
           browser — see contract/canvasConfig.ts for why it is not shared. -->
      <button class="arrows-mode" :title="ARROW_MODE_TITLE[arrowMode]" @click="cycleArrowMode">
        arrows: {{ arrowMode }}
      </button>
      <button class="arrows-legend" :class="{ active: legendOpen }" :disabled="!legend.length"
              title="Which relationships are drawn — also the colour legend" @click="legendOpen = !legendOpen">▾</button>
      <div v-if="legendOpen" class="legend" @pointerdown.stop>
        <label v-for="l in legend" :key="l.id" class="legend-row">
          <input type="checkbox" :checked="!l.hidden" @change="toggleFieldArrows(l.id)" />
          <span class="legend-swatch" :style="{ background: l.color || 'var(--arrow)' }" />
          <span class="legend-label">{{ l.label }}</span>
          <span class="legend-n">{{ l.n }}</span>
        </label>
        <p class="legend-note">Colour and direction are set on the link field (⚙ on its column). Shown/hidden is just for you, on this canvas.</p>
      </div>
      <!-- HIDE EMPTY: cards leave out the rows that have no value (contract/canvasConfig.ts).
           Up here, not in the card menu: it is a setting of the whole canvas, and a
           canvas-wide switch inside one card's menu read as local. The pins (which
           fields stay, empty or not) are per table, so those ARE in the card menu. -->
      <button class="hide-empty" :class="{ active: hideEmpty }"
              :title="hideEmpty ? 'Empty fields are hidden on cards — click to show them (for this canvas, for everyone)' : 'Hide the fields that have no value on cards (for this canvas, for everyone)'"
              @click="setHideEmpty(!hideEmpty)">{{ hideEmpty ? 'empty: hidden' : 'empty: shown' }}</button>
      <!-- COLOUR RULES (contract/colorRules.ts): a canvas-wide setting, so up here. Per
           TABLE inside: a canvas mixes tables. A matched card wears a glow in the tint. -->
      <button class="colour" :class="{ active: ruleCount }" :title="ruleCount ? `${ruleCount} colour rule${ruleCount === 1 ? '' : 's'} on this canvas — for everyone` : 'Colour cards by a rule — “Accepted → green” — for this canvas, for everyone'"
              @click="colourOpen = !colourOpen; legendOpen = false">colour<template v-if="ruleCount"> · {{ ruleCount }}</template></button>
      <span v-if="tintLegend.length" class="tint-legend"><span v-for="l in tintLegend" :key="l.tint + l.label" :class="`tint-${l.tint}`"><i />{{ l.label }}</span></span>
      <div v-if="colourOpen" class="colour-pop" @pointerdown.stop @keydown.stop>
        <div class="colour-tabs">
          <button v-for="t in ruleTables" :key="t.id" type="button" class="colour-tab" :class="{ on: colourTableOn === t.id }" @click="colourTable = t.id">{{ t.name }}<span v-if="t.n" class="colour-n">{{ t.n }}</span></button>
          <span class="spacer" />
          <label class="colour-glow" title="How a matched card is marked: a tinted ring alone (dense boards), or the ring with a halo">
            <span class="muted">mark</span>
            <select :value="glow" @change="setGlow(($event.target as HTMLSelectElement).value as 'ring' | 'glow')">
              <option value="glow">glow</option><option value="ring">ring</option>
            </select>
          </label>
        </div>
        <ColorRules v-if="colourTableOn" :key="colourTableOn" :store="store" :table-id="colourTableOn" :rules="rulesFor(canvasConfig, colourTableOn)" row-word="card" @update:rules="saveRules(colourTableOn, $event as ColorRule[])" />
        <p v-else class="legend-note">Place a card first — rules are per table, and this canvas has none.</p>
        <p class="legend-note">The header keeps the table's colour and pills keep the link's: those say what a card IS. A rule's glow says how it is doing.</p>
      </div>
      <span class="sep" />
      <button :disabled="!selected.size" @click="unplaceSelected">
        unplace{{ selected.size > 1 ? ` ${selected.size}` : '' }}
      </button>
      <span class="sep" />
      <!-- A STACK: a filter's records in a column, kept current (contract/canvasStack.ts). -->
      <button class="new-stack" title="A column of every record matching a filter — kept current as records come to match" @click="newStack()">+ stack</button>
    </div>

    <!-- WHAT A NEW RECORD HERE STARTS OUT LINKED TO. Always visible, because the whole
         point is that nobody should have to wonder: the canvas's own DEFAULTS (set here,
         by pointing), plus the project scope from the breadcrumb, which applies on top.
         The switch turns the canvas's defaults off for YOU, in this browser — the list
         itself is saved with the canvas, for everyone. -->
    <div class="defaults-bar context-bar-2" :class="{ off: !defaultsOn }" @pointerdown.stop>
      <label class="defaults-switch" :title="defaultsOn ? 'New records on this canvas are linked to these. Click to switch that off (for you, here).' : 'Switched off — new records are not linked to these.'">
        <input type="checkbox" :checked="defaultsOn" :disabled="!defaults.length" @change="defaultsOn = ($event.target as HTMLInputElement).checked" />
        <span class="defaults-label">New records here →</span>
      </label>
      <span v-if="scopeChip" class="dchip scope" :title="`From the scope in the breadcrumb — applies to tables that belong to ${scopeChip.table}`">{{ scopeChip.label }} <i>scope</i></span>
      <span v-for="d in defaults" :key="d.recordId" class="dchip" :class="{ missing: d.missing }"
            :title="d.missing ? 'This record no longer exists — remove it' : `${d.table}: new records whose table links to ${d.table} get this one`">
        <span class="dchip-table">{{ d.table }}</span>{{ d.label }}
        <button class="dchip-x" title="Stop linking new records to this" @click="removeDefault(d.recordId)">×</button>
      </span>
      <span v-if="!defaults.length && !scopeChip" class="defaults-none">nothing — new records start unlinked</span>
      <button class="defaults-add" title="Choose a record that everything created on this canvas should be linked to" @click="addingDefault = !addingDefault; addTable = ''">+ add</button>
      <span v-for="a in defaultAmbiguities" :key="a" class="defaults-warn" title="A new record of that table will NOT be linked: it has more than one link to the same table, and none (or several) is ticked “membership”. An admin can tick one, in that link field's ⚙ settings.">⚠ {{ a }}</span>

      <div v-if="addingDefault" class="defaults-pop" @keydown.stop>
        <select class="defaults-table" :value="addTable" @change="addTable = ($event.target as HTMLSelectElement).value">
          <option value="" disabled>link new records to a record of…</option>
          <option v-for="t in linkableTables" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <LinkPicker v-if="addTable" :key="addTable" inline :store="store" :target-table-id="addTable" :linked="defaults.filter((d) => d.tableId === addTable).map((d) => d.recordId)"
                    @add="addDefault(addTable, $event)" @remove="removeDefault($event)" @done="addingDefault = false" />
      </div>
    </div>

    <!-- LINKING SAYS WHAT IT IS DOING. While a link is held: what letting go right here
         would do ("Outputs", "Inputs or Outputs…", "no link from Edits to Works"). Just
         after: what happened ("✓ Outputs"), which is all there is to see when arrows are
         switched off. One small label by the pointer; it takes no pointer events. -->
    <div v-if="linkHint" class="link-note live" :class="linkHint.tone" :style="{ left: linkHint.x + 'px', top: linkHint.y + 'px' }">{{ linkHint.text }}</div>
    <div v-else-if="linkNote" :key="linkNote.n" class="link-note said" :class="linkNote.tone" :style="{ left: linkNote.x + 'px', top: linkNote.y + 'px' }">{{ linkNote.text }}</div>
    <!-- "find…" in the new-link menu: pick the other end here, or name a new one. -->
    <div v-if="linkPick" class="link-pick" :style="{ left: linkPick.client.x + 'px', top: linkPick.client.y + 'px' }" @pointerdown.stop @keydown.stop>
      <p class="link-pick-head">Link <b>{{ derived.labelOfId(linkPick.fromRecord) }}</b> → {{ store.state.tables.get(linkPick.targetTable)?.name }}: choose, or type a new name</p>
      <LinkPicker inline allow-create :store="store" :target-table-id="linkPick.targetTable"
                  :linked="linkPick.back ? derived.linkedTo(linkPick.fromRecord, linkPick.fieldId) : derived.linksFrom(linkPick.fromRecord, linkPick.fieldId)"
                  :link-field="linkPick.back ? undefined : linkPick.fieldId" :from-record="linkPick.back ? undefined : linkPick.fromRecord"
                  @add="linkPickChoose" @create="linkPickCreate" @done="linkPick = null" />
    </div>
    <!-- MAKING OR EDITING A STACK: its own dialog, with a preview of what the filter matches. -->
    <StackEditor v-if="stackEdit" :key="stackEdit.def.id" :store="store" :canvas-id="canvasId" :initial="stackEdit.def" :editing="stackEdit.editing" @save="saveStack" @cancel="stackEdit = null" />
    <!-- A JUNCTION drag (sql/016) let go: on a card of the other table, the pair's status
         is picked here and the row made; on empty canvas, the other end is picked first
         (the same editor, with its picker) and placed where the drop was. The div is only
         the popover's anchor: an invisible point at the drop. -->
    <div v-if="junctionPick" ref="junctionAnchor" class="junction-anchor" :style="{ left: junctionPick.client.x + 'px', top: junctionPick.client.y + 'px' }" @pointerdown.stop @keydown.stop>
      <JunctionEditor :store="store" :table="junctionPick.table" :cfg="junctionPick.cfg" :side="junctionPick.side" :from="junctionPick.fromRecord"
                      :picked="junctionPick.picked" :row-id="junctionPick.rowId" :anchor="junctionAnchor"
                      @created="junctionPickCreated" @open="(id) => { junctionPick = null; emit('open-record', id); }" @done="junctionPick = null" />
    </div>
  <div
    ref="containerRef"
    class="canvas-container stage-body"
    :class="{ panning: viewport.isPanning.value || spaceHeld }"
    tabindex="0"
    @wheel.prevent="viewport.onWheel"
    @pointerdown="onCanvasPointerDown"
    @pointermove="onCanvasPointerMove"
    @pointerup="viewport.onPointerUp"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @dblclick="onCanvasDblClick"
    @contextmenu.prevent="onCanvasMenu"
  >
    <div class="canvas-grid" :style="viewport.gridStyle.value" />

    <!-- Under the cards, sharing their transform. -->
    <ArrowLayer
      :transform="viewport.transform"
      :links="visibleLinks"
      :rects="cardRects"
      :styles="arrowStyles"
      :focus-ids="arrowMode === 'focus' ? selected : null"
      :selected-key="selectedLinkKey"
      :field-names="linkFieldNames"
      :rubber="rubber"
      :pulse-keys="pulsed"
      @select="selectLink"
      @menu="onLinkMenu"
    />

    <div class="canvas-world" :style="{ transform: viewport.transformCSS.value, '--zoom': viewport.transform.scale }">
      <!-- STACKS first: a frame is drawn UNDER the cards in it (contract/canvasStack.ts). -->
      <StackFrame v-for="st in stackFrames" :key="st.id" v-bind="st"
                  :selected="selectedStack === st.id" :drop-state="stackDrop.over === st.id ? 'over' : stackRefused === st.id ? 'refused' : null"
                  @pointerdown="onStackPointerDown" @menu="onStackMenu" @resize="onStackResize" @fit="fitStack" @fold="toggleStackFold" @gather="gatherStack" @edit="editStack" />
      <RecordCard
        v-for="c in cards"
        :key="c.recordId"
        v-bind="c"
        :store="store"
        :selected="selected.has(c.recordId)"
        :opened="c.recordId === openRecordId"
        :flash="flashed === c.recordId"
        :dragging="drag.draggingIds.value.has(c.recordId)"
        :unconfirmed="store.unconfirmed.value.has(c.recordId)"
        :can-link="!multiSelected && waysOf(c.tableId).length > 0"
        :path="multiSelected ? undefined : pathOf(c.recordId)"
        :path-state="pathState.get(c.recordId)"
        @reveal="revealPath"
        :link-target="linkTargetState(c.recordId)"
        :refused="refused === c.recordId"
        :drop-target="dropTargetId === c.recordId"
        :stacked="c.stacked"
        :stale="c.stale"
        :claimed="c.stacked && !c.stale"
        :tint="c.tint"
        :glow="glow"
        @pointerdown="onCardPointerDown"
        @link-start="startLinkDrag"
        @drag-linked="onDragLinked" @open-linked="(id) => emit('open-record', id)" @jump-linked="jumpTo" @edit-pair="onEditPair"
        @resize="onCardResize"
        @fit="onCardFit"
        @unplace="unplace"
        @fold="toggleFold"
        @open="(id) => (isBoardRecord(id) ? $emit('open-board', id) : $emit('open-record', id))"
        @menu="onCardMenu"
      />
    </div>

    <!-- Rubber band, drawn in screen space outside the transform. -->
    <div
      v-if="boxSelect.displayRect.value"
      class="selection-box"
      :style="{
        left: `${boxSelect.displayRect.value.left}px`,
        top: `${boxSelect.displayRect.value.top}px`,
        width: `${boxSelect.displayRect.value.width}px`,
        height: `${boxSelect.displayRect.value.height}px`,
      }"
    />


    <!-- Context menu / table chooser / card-fields chooser: one floating panel,
         screen-space, closed by any click outside it. -->
    <!-- `wheel.stop`: the container's wheel handler (zoom / pan, with preventDefault) sits
         above this menu in the DOM, so a scroll over the field list used to move the
         canvas and never the list. -->
    <div v-if="menu" ref="menuRef" class="ctx" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
         @pointerdown.stop @dblclick.stop @contextmenu.prevent.stop @keydown.stop @wheel.stop>
      <!-- AN ARROW. Removing a link from the canvas is deliberately three steps — select,
           right-click, confirm — because an arrow is a thin thing to hit by accident and
           what goes is DATA, not a drawing. (It is undoable all the same.) -->
      <template v-if="menu.kind === 'link' && menu.link && menu.link.junction">
        <!-- A JUNCTION ROW's arrow: its status is changed right here; the pair is deleted, not unlinked. -->
        <div class="ctx-head">{{ store.state.tables.get(menu.link.field_id)?.singular_name || store.state.tables.get(menu.link.field_id)?.name || 'pair' }}</div>
        <div class="ctx-sub">{{ derived.labelOfId(menu.link.from_record) }} → {{ derived.labelOfId(menu.link.to_record) }}</div>
        <template v-if="junctionStatusChoices(menu.link.field_id).length">
          <hr />
          <button v-for="c in junctionStatusChoices(menu.link.field_id)" :key="c" class="junction-status" :class="{ on: derived.junctionRow(menu.link.junction)?.status === c }"
                  @click="menuDo((m) => setJunctionStatus(m.link!.junction!, c))">{{ c }}</button>
        </template>
        <hr />
        <button class="open-junction" @click="menuDo((m) => emit('open-record', m.link!.junction!))">Open this pair ⤢</button>
        <button class="danger remove-link" @click="menuDo((m) => removeLink(m.link!))">Delete this pair…</button>
      </template>
      <template v-else-if="menu.kind === 'link' && menu.link">
        <div class="ctx-head">{{ linkFieldNames.get(menu.link.field_id) ?? 'link' }}</div>
        <div class="ctx-sub">{{ derived.labelOfId(menu.link.from_record) }} → {{ derived.labelOfId(menu.link.to_record) }}</div>
        <hr />
        <button class="danger remove-link" @click="menuDo((m) => removeLink(m.link!))">Remove this link…</button>
      </template>
      <!-- A LINK DROPPED ON A CARD THAT CAN TAKE IT SEVERAL WAYS (an Edit onto a File:
           input, or output?). Always asked, never guessed; a way already made between
           these two is shown ticked and cannot be made twice. -->
      <template v-else-if="menu.kind === 'link-choose'">
        <div class="ctx-head">Link through…</div>
        <div class="ctx-sub">{{ derived.labelOfId(menu.recordId!) }} → {{ derived.labelOfId(menu.toRecord!) }}</div>
        <hr />
        <button v-for="o in menu.options" :key="o.way.kind + o.way.key + ('side' in o.way ? o.way.side : '')" class="way" :class="{ made: o.linked }" :disabled="o.linked"
                @click="menuDo((m) => chooseWay(m, o.way))">
          <span class="way-dot" :style="{ background: wayColor(o.way) }" />
          <span class="way-name">{{ o.way.name }}</span>
          <span class="way-note">{{ o.linked ? '✓ linked' : wayNote(o.way, menu.recordId!, menu.toRecord!) }}</span>
        </button>
      </template>
      <!-- A LINK LET GO ON EMPTY CANVAS (or the ⊕ clicked): every way a record of this
           table can be linked. A row makes a NEW record at that spot, linked through
           that field; its "find…" links one that already exists. The fields this card
           shows come first — the same focus the old per-row handles gave — but nothing
           is left out for not being shown. -->
      <template v-else-if="menu.kind === 'link-new'">
        <div class="ctx-head">{{ derived.labelOfId(menu.recordId!) }}</div>
        <template v-for="g in menuWays" :key="g.title">
          <p class="ctx-title">{{ g.title }}</p>
          <div v-for="w in g.ways" :key="w.kind + w.key + ('side' in w ? w.side : '')" class="way-row">
            <button v-if="w.kind === 'link'" class="way new-via" :title="`Make a new ${singularOf(w.toTable)} here, linked through “${w.name}”`" @click="menuDo((m) => createLinked(m, w))">
              <span class="way-dot" :style="{ background: wayColor(w) }" />
              <span class="way-name">{{ w.name }}</span>
              <span class="way-note">new {{ singularOf(w.toTable) }}</span>
            </button>
            <button v-if="w.kind === 'link'" class="way-find" :title="`Link a ${singularOf(w.toTable)} that already exists (or type a name for a new one)`" @click="menuDo((m) => findLinked(m, w))">find…</button>
            <!-- A junction makes a PAIR: its other end is picked, then its status. -->
            <button v-else class="way pair-via" :title="`Pick a ${singularOf(w.toTable)}, then the pair's status`" @click="menuDo((m) => pairVia(m, w))">
              <span class="way-dot" :style="{ background: wayColor(w) }" />
              <span class="way-name">{{ w.name }}</span>
              <span class="way-note">pick a {{ singularOf(w.toTable) }}…</span>
            </button>
          </div>
        </template>
      </template>
      <template v-else-if="menu.kind === 'card'">
        <!-- A board placed on a board: this is how you walk from one canvas to another. -->
        <button v-if="isBoardRecord(menu.recordId!)" class="open-board" @click="menuDo((m) => $emit('open-board', m.recordId!))">▦ Open this board</button>
        <button @click="menuDo((m) => $emit('open-record', m.recordId!))">Open record</button>
        <button @click="menuDo((m) => toggleFold(m.recordId!))">{{ isCollapsed(menu.recordId!) ? 'Unfold' : 'Fold' }}</button>
        <button @click="menu = { ...menu, kind: 'fields' }">Fields on {{ tableNameOf(menu.recordId!) }} cards…</button>
        <!-- The easy way to set a canvas default: drop the Ep 101 card here, and point at it. -->
        <button v-if="isDefault(menu.recordId!)" class="unset-default" @click="menuDo((m) => removeDefault(m.recordId!))">Stop linking new records here to this</button>
        <button v-else-if="canBeDefault(menu.recordId!)" class="set-default" @click="menuDo((m) => addDefault(store.state.records.get(m.recordId!)!.table_id, m.recordId!))">Link new records here to this</button>
        <button v-if="resolveOffered(store, menu.recordId!)" class="resolve-ingest" @click="menuDo((m) => ingestFromResolve(store, m.recordId!, derived.labelOfId(m.recordId!)))">Ingest info from Resolve…</button>
        <hr />
        <button v-if="!isJunctionRecord(menu.recordId!)" class="duplicate-record" @click="menuDo((m) => duplicateHere(m.recordId!))">Duplicate record</button>
        <!-- IN A STACK: it can leave the stack and stay on the canvas, where it is, as a card placed by hand. -->
        <button v-if="stackOf(menu.recordId!)" class="leave-stack" @click="menuDo((m) => leaveStack([m.recordId!]))">Take out of the stack (keep here)</button>
        <button v-if="!stackClaims(menu.recordId!)" @click="menuDo((m) => unplace(m.recordId!))">Remove from canvas</button>
        <button class="danger" @click="menuDo((m) => deleteRecord(m.recordId!))">Delete record…</button>
      </template>

      <template v-else-if="menu.kind === 'canvas' || menu.kind === 'create'">
        <p class="ctx-title">New record here, in…</p>
        <button v-for="t in tablesForCreate" :key="t.id" class="create-in" @click="menuDo((m) => createAt(t.id, m.wx, m.wy))">
          <span class="swatch" :style="{ background: colorOf(t.id) }" />{{ t.name }}
        </button>
        <p v-if="!tablesForCreate.length" class="ctx-note">No tables yet — make one in the table tab.</p>
        <template v-if="menu.kind === 'canvas'">
          <hr />
          <button class="new-stack-here" @click="menuDo((m) => newStack({ x: m.wx, y: m.wy }))">New stack here…</button>
          <button @click="menuDo(() => fitAll())">Fit everything (Shift+Z)</button>
        </template>
      </template>

      <!-- A STACK's menu. Removing it UNPLACES its cards — that is what a stack holds; breaking
           it out is the other thing, offered, never the default. -->
      <template v-else-if="menu.kind === 'stack' && menu.stackId">
        <div class="ctx-head">{{ stackFrameOf(menu.stackId)?.name || stackFrameOf(menu.stackId)?.description }}</div>
        <!-- The whole story, whatever the bar shows: the table, the filter read aloud, the count. -->
        <div class="ctx-sub stack-ctx-table">{{ stackFrameOf(menu.stackId)?.tableName }} · {{ stackFrameOf(menu.stackId)?.count }} card{{ stackFrameOf(menu.stackId)?.count === 1 ? '' : 's' }}</div>
        <div v-if="stackFrameOf(menu.stackId)?.name" class="ctx-sub stack-ctx-filter" :title="stackFrameOf(menu.stackId)?.description">{{ stackFrameOf(menu.stackId)?.description }}</div>
        <hr />
        <button class="stack-edit-item" @click="menuDo((m) => editStack(m.stackId!))">Edit filter, order, name…</button>
        <button @click="menuDo((m) => toggleStackFold(m.stackId!))">{{ stackFrameOf(menu.stackId)?.collapsed ? 'Unfold' : 'Fold' }}</button>
        <button v-if="stackFrameOf(menu.stackId)?.elsewhere" class="stack-gather-item" @click="menuDo((m) => gatherStack(m.stackId!))">Gather the {{ stackFrameOf(menu.stackId)?.elsewhere }} placed elsewhere</button>
        <button v-if="stackFrameOf(menu.stackId)?.stale" class="stack-clear-stale" @click="menuDo((m) => clearStale(m.stackId!))">Remove the {{ stackFrameOf(menu.stackId)?.stale }} that no longer match</button>
        <button @click="menuDo((m) => fitStack(m.stackId!))">Fit width to the cards</button>
        <button @click="menuDo((m) => { selectedStack = m.stackId!; fit(); })">Fit to view (Z)</button>
        <hr />
        <button class="stack-breakout" @click="menuDo((m) => breakOutStack(m.stackId!))">Break out: keep the cards, remove the stack</button>
        <button class="danger stack-remove" @click="menuDo((m) => removeStack(m.stackId!))">Remove stack and its cards…</button>
      </template>

      <!-- WHICH FIELDS the cards of this table show here — and, per field, PIN: keep it
           on the card even when it is empty, once "hide empty" (the toolbar's switch)
           is on. The list scrolls on its own, so a forty-field table never pushes the
           reset off the bottom. -->
      <template v-else-if="menu.kind === 'fields'">
        <p class="ctx-title">{{ tableNameOf(menu.recordId!) }} cards on this canvas show</p>
        <div class="ctx-scroll">
          <div v-for="f in fieldChoices" :key="f.id" class="ctx-check field-choice" :data-field="f.id">
            <label class="field-on"><input type="checkbox" :checked="f.on" @change="toggleCardField(f.id)" /> {{ f.name }}</label>
            <label class="field-pin" :class="{ dim: !hideEmpty, on: f.pinned }"
                   :title="hideEmpty ? 'Shown on the card even when empty' : 'Shown even when empty — once the toolbar\'s “empty: hidden” is on'">
              <input type="checkbox" :checked="f.pinned" :disabled="!f.on" @change="togglePin(f.id)" /> pin
            </label>
          </div>
        </div>
        <p class="ctx-note">The title is always the primary field (★ in the grid).<template v-if="!hideEmpty"> Empty fields are shown on this canvas — “empty: shown” in the toolbar switches that.</template></p>
        <button v-if="hasCustomFields" @click="resetCardFields">Reset to default</button>
      </template>
    </div>

  </div>
  </div>
</template>

<script setup lang="ts">
import { vp } from '../uiScale';
import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { MutateOptions, Store } from '../store';
import { fieldsOf, tablesSorted, type FieldRow, type RecordRow } from '../state';
import { labelFrom } from '../../contract/labels';
import { useDerived } from '../derived';
import { ingestFromResolve, resolveOffered } from '../tools/resolveIngest';
import { defaultLinkField } from '../../contract/canvasConfig';
import LinkPicker from './LinkPicker.vue';
import JunctionEditor from './JunctionEditor.vue';
import { duplicateRecords } from '../duplicate';
import { addLink, addPair } from '../links';
import { dropVerdict, linkEnds, linkWays, verdictHint, waysBetween, type DropVerdict, type JunctionWay, type LinkFieldWay, type LinkWay } from '../../contract/canvasLink';
import { canvasDefaultsOff } from '../prefs';
import { confirmDialog } from '../dialogs';
import { SCOPE } from '../scope';
import { isEmptyRichText, richTextToPlain } from '../../contract/richtext';
import { formatNumberField, shapeOf, summarise } from '../../contract/shapes';
import { formatCreated } from '../../contract/systemFields';
import { beginRecordDrag, registerDropTarget } from '../recordDrag';
import { invoke, isDesktop, notice } from '../desktop';
import { arrowStyleOf, type ArrowStyle } from '../../contract/arrows';
import { backlinkSourceOf } from '../../contract/backlinks';
import { junctionOf, otherEnd, type JunctionConfig } from '../../contract/junction';
import { choicesOf } from '../../contract/values';
import type { ArrowLink } from './ArrowLayer.vue';
import { linkKey } from '../state';
import { bezierPath, rectsIntersect, type AnchorSide, type Point } from '../canvas/geometry';
import { CanvasConfig, cardFieldsFor, glowOf, hidesEmpty, pinnedFieldsFor, rulesFor } from '../../contract/canvasConfig';
import { legendOf, paintsOf, type ColorRule, type Paints } from '../../contract/colorRules';
import ColorRules from './ColorRules.vue';
import { CARD_W, defaultCardWidth, effectiveHeight, fitCardWidth, lineCount, linkHandleAt, visibleRows } from '../canvas/cardLayout';
import { capsuleWidth, JUMP_PAD, pairSlot, textWidth } from '../textWidth';
import type { CardRow } from './RecordCard.vue';
import type { Rect } from '../canvas/geometry';
import { useViewport } from '../canvas/useViewport';
import { useCardDrag } from '../canvas/useCardDrag';
import { useBoxSelection, useCardResize } from '../canvas/useCardResize';
import ArrowLayer from './ArrowLayer.vue';
import RecordCard from './RecordCard.vue';
import StackFrame from './StackFrame.vue';
import StackEditor from './StackEditor.vue';
import { STACK_MAX, STACK_MIN_W, STACK_PAD, describeFilters, stackCensus, stackDropLinks, stackLayout, type StackCensus, type StackDef, type StackLayout } from '../../contract/canvasStack';
import { placementKey, recordsOf } from '../state';

const props = defineProps<{ store: Store; canvasId: string; /** The record open in the tray, or '' — its card is marked. */ openRecordId?: string;
  /** The card a FILE is being dragged over (App.vue, from the shell's drag stream), or '' — it gets the drop ring. */ dropTargetId?: string }>();
const emit = defineEmits<{ 'open-record': [recordId: string]; 'open-board': [recordId: string] }>();
const isBoardRecord = (id: string) => store.state.tables.get(store.state.records.get(id)?.table_id ?? '')?.kind === 'canvas';
const store = props.store;

const containerRef = ref<HTMLElement | null>(null);
const selected = reactive(new Set<string>());
const spaceHeld = ref(false);

const viewport = useViewport(containerRef);

/* ── derived view of the store ───────────────────────────────────────────── */

const placements = computed(() =>
  [...store.state.placements.values()].filter((p) => p.canvas_id === props.canvasId));
/** The records that have a card here — from the placements, not from `cards` (which reads this to mark the pills that can jump). */
const placedHere = computed(() => new Set(placements.value.map((p) => p.record_id)));

/* ── what a card says ─────────────────────────────────────────────────────

   A card is a title plus a few lines of TEXT. Turning values into text happens
   here rather than in RecordCard because half of it needs the store: a link's
   text is the labels of the records it points at, a lookup's is computed across
   a link (contract/lookups.ts). RecordCard stays a dumb renderer of strings. */

const derived = useDerived(store);
const scopeApi = inject(SCOPE, null);
const labelKeys = derived.labelKeys;
const canvasConfig = computed(() => store.state.canvases.get(props.canvasId)?.config);
const labelOf = (r: RecordRow) => labelFrom(r.data, labelKeys.value.get(r.table_id), r.id.slice(0, 8));

function rowFor(rec: RecordRow, f: FieldRow): CardRow {
  if (f.type === 'link' || f.type === 'lookup' || f.type === 'backlink') {
    const { texts, broken } = derived.textOf(rec.id, f);
    // A relationship's row wears that relationship's colour (a backlink wears the
    // colour of the link field it mirrors — they are the two ends of the same arrows).
    // A JUNCTION's column (sql/016) is one too — its arrows key on the junction
    // TABLE — and what it names, and what can be dragged off it, is the other end of
    // each pair, not the pair rows themselves.
    const j = f.type === 'backlink' ? derived.junctionOfBacklink(f) : null;
    const styleField = f.type === 'link' ? f.id : j ? j.table : f.type === 'backlink' ? backlinkSourceOf(f) : null;
    const color = styleField ? arrowStyles.value.get(styleField)?.color : undefined;
    const rows = j ? derived.backlinkOf(rec.id, f) ?? [] : undefined;
    const ids = f.type === 'lookup' ? undefined
      : f.type === 'link' ? derived.linksFrom(rec.id, f.id)
      : j ? rows!.flatMap((row) => { const o = derived.junctionRow(row)?.[otherEnd(j.side)]; return o ? [o] : []; })
      : derived.backlinkOf(rec.id, f) ?? [];
    if (broken) return { id: f.id, name: f.name, broken: true, text: `broken ${f.type}` };
    // Shown as a COUNT (contract/pills.ts): ONE line, however many — still in its colour.
    const count = derived.countOf(rec.id, f);
    if (count) return { id: f.id, name: f.name, derived: true, text: count.n ? count.noun : '', count: count.n || undefined, countTitle: count.title,
      color, link: f.type === 'link' || !!j };
    // A junction column's pairs are lines like any link row's — the first beside the field's
    // name. `slot` is the room the other end gets, so the statuses line up under it, and
    // `statusW` what the widest status needs: on a narrow card it is the NAME that gives way.
    // `here`: which of them already have a card on this canvas — those pills wear the jump
    // arrow. In a column of pairs the arrow is inside the other end's box, so the slot is
    // that much wider when any pair has one (every status still starts at the same x).
    const here = ids?.map((id) => placedHere.value.has(id));
    const anyHere = !!here?.some(Boolean);
    const warns = f.type === 'link' && ids ? ids.map((id) => derived.pillWarning(rec.id, f.id, id)) : undefined;
    return { id: f.id, name: f.name, derived: true, text: texts.join(', '), lines: texts.length > 1 ? texts : undefined,
      ids, here: anyHere ? here : undefined, warns: warns?.some(Boolean) ? warns : undefined, color, link: f.type === 'link' || !!j, junction: !!j, rows,
      statuses: j ? rows!.map((row) => derived.junctionRow(row)?.status ?? '') : undefined,
      statusW: j ? capsuleWidth(rows!.map((row) => derived.junctionRow(row)?.status ?? ''), 11) : undefined,
      slot: j && ids!.length ? pairSlot(ids!.map((id) => derived.plainLabelOfId(id)), 11) + (anyHere ? JUMP_PAD : 0) : undefined };
  }
  if (f.type === 'rich_text') return { id: f.id, name: f.name, text: richTextToPlain(rec.data[f.key]).split('\n', 1)[0] };
  // A structured value is a one-line SUMMARY on a card ("4 tracks / 12 ch (5.1, 2.0…)"):
  // a card's rows are fixed-height, and the full thing lives in the tray.
  // A video layout also hands the card its VALUE: the row draws the mini strip beside the summary.
  if (f.type === 'structured') return { id: f.id, name: f.name, text: summarise(shapeOf(f), rec.data[f.key]), strip: shapeOf(f) === 'video_layout' ? rec.data[f.key] : undefined };
  if (f.type === 'attachment') {
    const n = Array.isArray(rec.data[f.key]) ? (rec.data[f.key] as unknown[]).length : 0;
    return { id: f.id, name: f.name, text: n ? `${n} file${n === 1 ? '' : 's'}` : '' };
  }
  const v = rec.data[f.key];
  if (f.type === 'created_at') return { id: f.id, name: f.name, text: formatCreated(v), derived: true };
  const formatted = formatNumberField(f, v);
  if (formatted !== null) return { id: f.id, name: f.name, text: formatted };
  const text = v === undefined || v === null || v === '' ? ''
    : typeof v === 'boolean' ? (v ? 'yes' : 'no')
    : Array.isArray(v) ? v.join(', ')
    // One line per row, always: the first line of a long text, not all of it.
    : String(v).split('\n', 1)[0];
  return { id: f.id, name: f.name, text };
}

/** The fields a card of this table shows on THIS canvas. */
/**
 * A card's fields come in two kinds (canvas/cardLayout.ts):
 *   ROWS    every shown field except rich text — one fixed-height line each. The same
 *           list for every card of a table, so a field's row INDEX never depends on
 *           the record.
 *   BLOCKS  shown rich_text fields THAT HAVE A NOTE, under the rows: formatted, with
 *           images, in a fixed-height window. A record without a note gets no block
 *           — and no empty 150px hole — which only changes its height, not its rows.
 */
const rowFields = (tableId: string) => shownFields(tableId).filter((f) => f.type !== 'rich_text');
/**
 * The rows ONE card draws. With the canvas's "hide empty" on (contract/canvasConfig.ts)
 * the empty ones are left out — unless the field is pinned on this canvas — so two
 * cards of a table may show different rows. Nothing hangs on a row's index any more
 * (cardLayout.ts, `rowPortY`), and heights count the lines a card actually has.
 */
const hideEmpty = computed(() => hidesEmpty(canvasConfig.value));
const pinnedOf = (tableId: string) => pinnedFieldsFor(canvasConfig.value, tableId);
function cardRows(rec: RecordRow, paint?: Paints): CardRow[] {
  const verdicts = derived.fieldVerdicts(rec.id);
  const rows = rowFields(rec.table_id).map((f) => {
    const r = rowFor(rec, f); const v = verdicts.get(f.id); const t = paint?.fields[f.id]?.tint;
    return { ...r, ...(v ? { verdict: v } : {}), ...(t ? { tint: t } : {}) };
  });
  return visibleRows(rows, hideEmpty.value, pinnedOf(rec.table_id));
}

/* ── COLOUR RULES (contract/colorRules.ts), per table, saved with the canvas ──────
   Evaluated over the placed records, once per change; a card reads its row's tint
   (its glow) and each row its field's. The stacks' census evaluates filters the same
   way (`stackLinkLabels`), so a rule reads links as a stack's filter does. */
const glow = computed(() => glowOf(canvasConfig.value));
const allRules = computed(() => parsedConfig().rules ?? {});
const ruleCount = computed(() => Object.values(allRules.value).reduce((n, rs) => n + rs.length, 0));
const tintLegend = computed(() => legendOf(Object.values(allRules.value).flat()));
const paints = computed(() => {
  const out = new Map<string, Paints>();
  const byTable = new Map<string, Map<string, FieldRow>>();
  for (const p of placements.value) {
    const rec = store.state.records.get(p.record_id);
    if (!rec) continue;
    const rules = allRules.value[rec.table_id];
    if (!rules?.length) continue;
    let fields = byTable.get(rec.table_id);
    if (!fields) { fields = new Map(fieldsOf(store.state, rec.table_id).map((f) => [f.id, f])); byTable.set(rec.table_id, fields); }
    const got = paintsOf(rec, rules, fields, stackLinkLabels, derived.idsOf);
    if (got) out.set(rec.id, got);
  }
  return out;
});
const colourOpen = ref(false);
const colourTable = ref('');
/** The tables a rule can be written for: those with a card here, plus any that already have rules. */
const ruleTables = computed(() => {
  const ids = new Set([...placedTables.value.split(',').filter(Boolean), ...Object.keys(allRules.value)]);
  return [...ids].map((id) => ({ id, name: store.state.tables.get(id)?.name ?? '?', n: allRules.value[id]?.length ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
});
/** The tab that is open: the chosen table while it is still one of `ruleTables`, else the first. */
const colourTableOn = computed(() => (ruleTables.value.some((t) => t.id === colourTable.value) ? colourTable.value : ruleTables.value[0]?.id ?? ''));
function saveRules(tableId: string, rules: ColorRule[]) {
  const next = { ...allRules.value };
  if (rules.length) next[tableId] = rules; else delete next[tableId];
  const { rules: _, ...rest } = parsedConfig();
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: Object.keys(next).length ? { ...rest, rules: next } : rest });
}
function setGlow(mode: 'ring' | 'glow') {
  const { glow: _, ...rest } = parsedConfig();
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: mode === 'ring' ? { ...rest, glow: 'ring' } : rest });
}
const richBlocks = (rec: RecordRow) => shownFields(rec.table_id)
  .filter((f) => f.type === 'rich_text' && !isEmptyRichText(rec.data[f.key]))
  .map((f) => ({ id: f.id, name: f.name, value: rec.data[f.key] }));

function shownFields(tableId: string): FieldRow[] {
  const all = fieldsOf(store.state, tableId);
  const primaryKey = labelKeys.value.get(tableId);
  return cardFieldsFor(canvasConfig.value, tableId, all, all.find((f) => f.key === primaryKey)?.id);
}

/* ── what the cards READ that the scene does not bring ────────────────────────
   A scene (server/reads.ts) is the placed records and the links BETWEEN them: enough
   to paint the cards and draw the arrows among them. But a card's rows also show
   what its record links to that is NOT on this canvas, and a junction column's pairs
   are rows of a third table, which is never placed at all. Those arrive with their
   TABLES — and nothing here asked for them, so a canvas opened cold (a reload, a
   link) showed "—" in those rows until some other view happened to load the table:
   the tray, in practice, which is why opening a card "fixed" it. So, as the grid and
   the tray do for their fields, the canvas loads what its shown rows read:

     a link, a lookup     the card's OWN table (a record's links, and the names of
                          what they point at, come with its table's pages)
     a backlink           the table the links come FROM
     a junction column    the junction table and the table at its other end
     and every junction between two tables that both have cards here: its pairs are
     arrows, whether or not any card shows its column.

   And what a card can LINK through, shown or not (contract/canvasLink.ts): a drag
   from its handle may write any link field of its table, so the canvas has to know
   what those fields hold already — a single link's current value is replaced, not
   added to, and a pair that exists must not be made twice. So: the own table of
   every card that has a link field, and every junction its table is an end of.    */
const tablesRead = computed(() => {
  const placed = new Set<string>();
  for (const p of placements.value) { const t = store.state.records.get(p.record_id)?.table_id; if (t) placed.add(t); }
  for (const st of parsedConfig().stacks ?? []) placed.add(st.tableId);   // (parsedConfig: hoisted; rawStacks is declared below)
  const out = new Set<string>();
  for (const tableId of placed) {
    const fs = shownFields(tableId);
    if (fs.some((f) => f.type === 'link' || f.type === 'lookup')) out.add(tableId);
    for (const t of derived.tablesNeededBy(fs)) out.add(t);
  }
  const targetOf = (fieldId: string) => store.state.fields.get(fieldId)?.options?.target_table_id;
  for (const t of store.state.tables.values()) {
    const cfg = junctionOf(t);
    if (cfg && placed.has(String(targetOf(cfg.a))) && placed.has(String(targetOf(cfg.b)))) out.add(t.id);
  }
  for (const tableId of placed) {
    for (const way of linkWays(store.state.fields.values(), store.state.tables.values(), tableId)) out.add(way.kind === 'link' ? tableId : way.table);
  }
  return [...out].sort().join();
});
watch(tablesRead, (joined) => { for (const t of joined.split(',').filter(Boolean)) void store.loadTable(t); }, { immediate: true });

/** Every card as its placement has it — before stacks lay theirs out (below). */
const baseCards = computed(() =>
  placements.value.flatMap((p) => {
    const rec = store.state.records.get(p.record_id);
    if (!rec) return [];   // placement without its record: mid-sync, skip a frame
    const table = store.state.tables.get(rec.table_id);
    const title = labelFrom(rec.data, labelKeys.value.get(rec.table_id), '');
    return [{
      recordId: p.record_id,
      tableId: rec.table_id,
      tableName: table?.name ?? 'unknown',
      tableColor: colorOf(rec.table_id),
      title,
      // ✓ / ⚠ per row from comparing links (COMPARE-BRIEF.md) — derived, live — ride on the rows.
      rows: cardRows(rec, paints.value.get(rec.id)),
      rich: richBlocks(rec),
      tint: paints.value.get(rec.id)?.row?.tint,
      collapsed: p.collapsed,
      // No width of its own: as wide as its name (cardLayout.ts) — resolved HERE, once, so the
      // card, the arrows and the box selection all use the same number.
      x: p.x, y: p.y, w: p.w ?? defaultCardWidth(title, textWidth), h: p.h, z: p.z,
      stacked: false, stale: false,
    }];
  }));

/* ── STACKS: a filter's records, in a column, kept current (contract/canvasStack.ts) ──

   The stack DEFINITIONS are in the canvas config; which cards are IN one is on their
   placements (`style.stack`). Everything else is derived, every frame:

     census    per stack — what matches, what is here, what is missing, what is stale
     layout    per stack — where its frame is and where each of its cards goes; a
               card in a stack takes THAT position and width, not its placement's
     missing   placed into the stack by the watcher below, without an undo step

   A card being DRAGGED keeps following the pointer (its placement's x/y, which the
   drag writes every frame) and only on release does the drop decide what it was. */

const rawStacks = computed<StackDef[]>(() => parsedConfig().stacks ?? []);
const stackById = computed(() => new Map(rawStacks.value.map((st) => [st.id, st])));
// A stack's table has to be WHOLLY loaded to know what matches — and what its filter
// reads (a link's labels) with it. loadTable is a no-op once a table is loaded.
watch(() => rawStacks.value.map((st) => st.tableId).sort().join(), (joined) => {
  for (const t of new Set(joined.split(',').filter(Boolean))) {
    void store.loadTable(t);
    for (const u of derived.tablesNeededBy(fieldsOf(store.state, t))) void store.loadTable(u);
  }
}, { immediate: true });

/** Which stack a record's card is in here: its id, '' for a card placed by hand, undefined for not on this canvas. */
function placedIn(recordId: string): string | undefined {
  const p = store.state.placements.get(placementKey(props.canvasId, recordId));
  if (!p) return undefined;
  const st = p.style?.stack;
  // A card whose stack is gone from the config (the stack was undone, or removed by a peer) is a card placed by hand.
  return typeof st === 'string' && stackById.value.has(st) ? st : '';
}
const stackOf = (recordId: string) => placedIn(recordId) || null;
const stackLinkLabels = (recordId: string, fieldId: string) => { const f = store.state.fields.get(fieldId); return f ? derived.textOf(recordId, f).texts : []; };
const censuses = computed(() => {
  const m = new Map<string, StackCensus>();
  for (const st of rawStacks.value) m.set(st.id, stackCensus(st, recordsOf(store.state, st.tableId), fieldsOf(store.state, st.tableId), placedIn, stackLinkLabels, derived.idsOf));
  return m;
});

/* A stack being moved or resized: its live geometry, written here every frame and
   sent as one canvas.update on release — the same split as a card drag. */
const stackLive = reactive(new Map<string, { x?: number; y?: number; w?: number | null }>());

const stackLayouts = computed(() => {
  const m = new Map<string, StackLayout>();
  const byId = new Map(baseCards.value.map((c) => [c.recordId, c]));
  for (const st of rawStacks.value) {
    const census = censuses.value.get(st.id);
    const members = (census?.order ?? []).flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ recordId: id, h: effectiveHeight(c.h, lineCount(c.rows), c.collapsed, c.rich.length), w: c.w }] : [];
    });
    const live = stackLive.get(st.id);
    m.set(st.id, stackLayout({ x: live?.x ?? st.x, y: live?.y ?? st.y, w: live?.w !== undefined ? live.w : st.w, collapsed: st.collapsed, name: st.name }, members));
  }
  return m;
});

/** Until a stack's table is wholly loaded, nothing in it is called stale: the links its filter reads arrive with the table. */
const stackLoaded = (stackId: string) => store.tableLoads.get(stackById.value.get(stackId)?.tableId ?? '')?.state === 'loaded';
const cards = computed(() => {
  const dragging = drag.draggingIds.value;
  return baseCards.value.map((c) => {
    const stackId = placedIn(c.recordId);
    if (!stackId) return c;
    const layout = stackLayouts.value.get(stackId), at = layout?.cards.get(c.recordId);
    const stale = stackLoaded(stackId) && (censuses.value.get(stackId)?.stale.includes(c.recordId) ?? false);
    if (!at) return { ...c, stacked: true, stale };
    // Folded stack: its cards are drawn nowhere — kept out of `cards` entirely (no arrows, no selection).
    return dragging.has(c.recordId)
      ? { ...c, w: layout!.cardW, stacked: true, stale }
      : { ...c, x: at.x, y: at.y, w: at.w, stacked: true, stale };
  }).filter((c) => !c.stacked || !stackById.value.get(placedIn(c.recordId)!)?.collapsed || dragging.has(c.recordId));
});

/** What StackFrame draws, per stack. */
const stackFrames = computed(() => rawStacks.value.map((st) => {
  const census = censuses.value.get(st.id), layout = stackLayouts.value.get(st.id)!;
  const table = store.state.tables.get(st.tableId);
  return {
    id: st.id, rect: layout.rect, tableName: table?.name ?? '?', color: table?.color || 'var(--border-main)',
    name: st.name, description: describeFilters(st.filters, (id) => store.state.fields.get(id)?.name, (id) => derived.plainLabelOfId(id)),
    count: census?.inStack.length ?? 0, total: census?.total ?? 0, overCap: (census?.total ?? 0) > STACK_MAX,
    elsewhere: census?.elsewhere.length ?? 0, stale: stackLoaded(st.id) ? census?.stale.length ?? 0 : 0, collapsed: st.collapsed,
    loading: !stackLoaded(st.id),
  };
}));
const stackFrameOf = (id: string) => stackFrames.value.find((f) => f.id === id);

/* NEW TO THE CANVAS → IN. Once a stack's table is loaded, every matching record with no
   card here is placed into the stack. Not an undo step: undoing it would only have it
   placed again a moment later. Keyed on the SET of missing ids, so a frame where nothing
   is missing does nothing. */
/* NOT before the scene is in. Opening a canvas whose stack table is already loaded
   (you were just in its grid) ran this before loadScene had brought the placements:
   every matching record looked missing, was placed — and then the scene arrived and
   REPLACED this canvas's placements, dropping the optimistic one. The server had the
   card; this tab did not, and nothing would ask again. */
const sceneReady = ref(false);
const missingKey = computed(() => rawStacks.value.map((st) => {
  if (!sceneReady.value || store.tableLoads.get(st.tableId)?.state !== 'loaded') return '';
  return (censuses.value.get(st.id)?.missing ?? []).map((id) => `${st.id}|${id}`).join(',');
}).filter(Boolean).join(','));
const autoPlaced = new Map<string, number>();   // key → when: a refused add must not be retried every frame
watch(missingKey, (key) => {
  if (!key) return;
  let z = placements.value.reduce((n, p) => Math.max(n, p.z), 0);
  let placedAny = false;
  const now = Date.now();
  for (const pair of key.split(',')) {
    const [stackId, recordId] = pair.split('|');
    const st = stackById.value.get(stackId), layout = stackLayouts.value.get(stackId);
    if (!st || !layout || store.state.placements.has(placementKey(props.canvasId, recordId))) continue;
    if ((autoPlaced.get(pair) ?? 0) > now - 3000) continue;
    autoPlaced.set(pair, now);
    // Its x/y are only where the card would land if the stack went away: under the frame.
    store.mutate({ type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId, x: Math.round(st.x + STACK_PAD), y: Math.round(layout.rect.y + layout.rect.h), w: null, h: null, z: ++z, style: { stack: stackId } },
      { undoable: false });
    placedAny = true;
  }
  if (placedAny) refreshLinksAfterPlacing();
}, { immediate: true });

/* The stack itself: selected by its bar; Delete asks; dragged by its bar; resized at its edge. */
const selectedStack = ref<string | null>(null);
watch(() => props.canvasId, () => { selectedStack.value = null; stackEdit.value = null; });

function saveStacks(next: StackDef[]) {
  const { stacks: _old, ...rest } = parsedConfig();
  void _old;
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: next.length ? { ...rest, stacks: next } : rest });
}
const patchStack = (id: string, patch: Partial<StackDef>) => saveStacks(rawStacks.value.map((st) => (st.id === id ? { ...st, ...patch } : st)));

function onStackPointerDown({ stackId, e }: { stackId: string; e: PointerEvent }) {
  if (e.button !== 0 || spaceHeld.value) return;
  menu.value = null; selectedLink.value = null; selected.clear();
  selectedStack.value = stackId;
  containerRef.value?.focus();
  const st = stackById.value.get(stackId); if (!st) return;
  const start = { x: e.clientX, y: e.clientY }, from = { x: st.x, y: st.y };
  let movedFar = false;
  const move = (ev: PointerEvent) => {
    const scale = viewport.transform.scale || 1;
    const dx = vp(ev.clientX - start.x) / scale, dy = vp(ev.clientY - start.y) / scale;
    if (!movedFar && Math.hypot(dx * scale, dy * scale) < 4) return;
    movedFar = true;
    stackLive.set(stackId, { ...(stackLive.get(stackId) ?? {}), x: from.x + dx, y: from.y + dy });
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    const live = stackLive.get(stackId);
    stackLive.delete(stackId);
    if (movedFar && live?.x !== undefined && live.y !== undefined) patchStack(stackId, { x: Math.round(live.x), y: Math.round(live.y) });
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function onStackResize({ stackId, e }: { stackId: string; e: PointerEvent }) {
  if (e.button !== 0) return;
  e.preventDefault();
  const layout = stackLayouts.value.get(stackId); if (!layout) return;
  const start = e.clientX, w0 = layout.rect.w;
  const move = (ev: PointerEvent) => {
    const w = Math.max(STACK_MIN_W, Math.round(w0 + vp(ev.clientX - start) / (viewport.transform.scale || 1)));
    stackLive.set(stackId, { ...(stackLive.get(stackId) ?? {}), w });
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    const live = stackLive.get(stackId);
    stackLive.delete(stackId);
    if (live?.w !== undefined && live.w !== null && live.w !== w0) patchStack(stackId, { w: live.w });
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
/** Double-click on the edge: back to "as wide as the widest card wants". */
function fitStack(stackId: string) { if (stackById.value.get(stackId)?.w !== null) patchStack(stackId, { w: null }); }
function toggleStackFold(stackId: string) { const st = stackById.value.get(stackId); if (st) patchStack(stackId, { collapsed: !st.collapsed }); }

/** Matching cards placed elsewhere on this canvas: into the stack, one Ctrl+Z. */
function gatherStack(stackId: string) {
  const ids = censuses.value.get(stackId)?.elsewhere ?? [];
  for (const id of ids) joinStack(id, stackId);
  selected.clear(); for (const id of ids) selected.add(id);
}
function joinStack(recordId: string, stackId: string) {
  const p = placementOf(recordId); if (!p) return;
  store.mutate({ type: 'placement.update', canvasId: props.canvasId, recordId, style: { ...(p.style ?? {}), stack: stackId } });
}
/** Out of the stack, staying ON the canvas where it is drawn now, as a card placed by hand. */
function leaveStack(recordIds: string[], at?: Map<string, { x: number; y: number }>) {
  const moves: Array<{ recordId: string; x: number; y: number }> = [];
  for (const recordId of recordIds) {
    const p = placementOf(recordId), rect = cardRects.value.get(recordId);
    if (!p) continue;
    const { stack: _s, ...rest } = p.style ?? {};
    void _s;
    store.mutate({ type: 'placement.update', canvasId: props.canvasId, recordId, style: rest });
    const to = at?.get(recordId) ?? rect;
    if (to) moves.push({ recordId, x: Math.round(to.x), y: Math.round(to.y) });
  }
  if (moves.length) store.mutate({ type: 'placement.move', canvasId: props.canvasId, moves });
}
function clearStale(stackId: string) { for (const id of censuses.value.get(stackId)?.stale ?? []) unplace(id); }

/** The stack goes; its cards stay where they were drawn, placed by hand. */
function breakOutStack(stackId: string) {
  const ids = placements.value.filter((p) => placedIn(p.record_id) === stackId).map((p) => p.record_id);
  leaveStack(ids);
  saveStacks(rawStacks.value.filter((st) => st.id !== stackId));
  if (selectedStack.value === stackId) selectedStack.value = null;
}
/** The stack goes, and so do its cards (off the canvas — the records stay). Asked, because it is many at once; one Ctrl+Z. */
async function removeStack(stackId: string) {
  const ids = placements.value.filter((p) => placedIn(p.record_id) === stackId).map((p) => p.record_id);
  const f = stackFrameOf(stackId);
  if (ids.length && !await confirmDialog({
    title: `Remove this stack and its ${ids.length} card${ids.length === 1 ? '' : 's'}?`, danger: true, okText: 'Remove stack',
    body: `${f?.name || f?.description || 'The stack'}\n\nThe cards come off this canvas; the records themselves stay. To keep the cards and drop only the frame, choose "Break out" instead. This can be undone (Ctrl+Z).`,
  })) return;
  for (const id of ids) unplace(id);
  saveStacks(rawStacks.value.filter((st) => st.id !== stackId));
  if (selectedStack.value === stackId) selectedStack.value = null;
}

/* The editor: a new stack at a point (the right-click, or the middle of the view), or an existing one. */
const stackEdit = ref<{ def: StackDef; editing: boolean } | null>(null);
function newStack(at?: Point) {
  const box = containerRef.value?.getBoundingClientRect();
  const p = at ?? viewport.clientToWorld((box?.left ?? 0) + (box?.width ?? 0) / 2 - STACK_MIN_W / 2, (box?.top ?? 0) + (box?.height ?? 0) / 3);
  const tables = tablesForCreate.value.filter((t) => t.kind !== 'junction');
  stackEdit.value = { def: { id: crypto.randomUUID(), tableId: tables.length === 1 ? tables[0].id : '', filters: [], sort: [], x: Math.round(p.x), y: Math.round(p.y), w: null, collapsed: false }, editing: false };
  menu.value = null;
}
function editStack(stackId: string) {
  const st = stackById.value.get(stackId); if (!st) return;
  stackEdit.value = { def: st, editing: true };
  menu.value = null;
}
/** The definition and, if asked, the gathering: one run, one Ctrl+Z. The missing ones follow by the watcher. */
function saveStack(def: StackDef, gather: boolean) {
  stackEdit.value = null;
  const exists = stackById.value.has(def.id);
  saveStacks(exists ? rawStacks.value.map((st) => (st.id === def.id ? def : st)) : [...rawStacks.value, def]);
  if (gather) {
    const census = stackCensus(def, recordsOf(store.state, def.tableId), fieldsOf(store.state, def.tableId), placedIn, stackLinkLabels, derived.idsOf);
    for (const id of census.elsewhere) joinStack(id, def.id);
  }
  selectedStack.value = def.id;
  containerRef.value?.focus();
}

/* A card DROPPED in or out of a stack (the hook in useCardDrag). Decided by where the
   card's top-left lands:
     its own stack       snaps back (nothing written)
     another stack       joins it if it already matches, or if the filter is links a
                         drop can set (contract `stackDropLinks`) — else refused: the
                         frame flashes, and the card is placed by hand where it landed
     empty canvas        out of its stack (if it was in one), placed by hand there */
const stackDrop = reactive<{ over: string | null }>({ over: null });
const stackRefused = ref('');
let stackRefuseTimer: ReturnType<typeof setTimeout> | undefined;
function stackAt(p: Point): string | null {
  for (const st of rawStacks.value) {
    const r = stackLayouts.value.get(st.id)?.rect;
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return st.id;
  }
  return null;
}
function dropCards(moves: Array<{ recordId: string; x: number; y: number; z: number }>): boolean {
  if (!rawStacks.value.length) return false;
  const plain: typeof moves = [];
  let handled = false;
  for (const mv of moves) {
    const was = placedIn(mv.recordId) || null;
    const to = stackAt({ x: mv.x + 24, y: mv.y + 12 });
    if (to && to === was) { handled = true; continue; }                         // let go inside its own stack: back it goes
    if (to) {
      const st = stackById.value.get(to)!, census = censuses.value.get(to);
      const rec = store.state.records.get(mv.recordId);
      if (census?.matching.includes(mv.recordId)) { joinStack(mv.recordId, to); handled = true; continue; }
      const links = rec ? stackDropLinks(st, [...store.state.fields.values()], rec.table_id) : null;   // the whole schema: a backlink's link is on the far table
      if (links) {
        // A line on a link: the row goes on the dropped record. On a backlink: on the filter's record, pointing at it.
        for (const l of links) {
          const [holder, target] = l.back ? [l.recordId, mv.recordId] : [mv.recordId, l.recordId];
          if (!derived.linksFrom(holder, l.fieldId).includes(target)) addLink(store, l.fieldId, holder, target);
        }
        joinStack(mv.recordId, to);
        handled = true; continue;
      }
      // Refused: said, and the card lands by hand where it was let go (out of its old stack, if any).
      stackRefused.value = ''; clearTimeout(stackRefuseTimer);
      void nextTick(() => { stackRefused.value = to; stackRefuseTimer = setTimeout(() => { stackRefused.value = ''; }, 750); });
      const tn = store.state.tables.get(st.tableId)?.name ?? 'that table';
      say(rec?.table_id !== st.tableId ? `not a ${tn} record` : 'this stack’s filter is not something a drop can set', 'no', lastClient ?? { x: 0, y: 0 });
    }
    if (was) { leaveStack([mv.recordId], new Map([[mv.recordId, mv]])); handled = true; continue; }
    plain.push(mv);
  }
  if (!handled) return false;
  if (plain.length) store.mutate({ type: 'placement.move', canvasId: props.canvasId, moves: plain });
  return true;
}

/**
 * World rects, for arrows and box selection — from the SAME function RecordCard
 * sizes itself with (canvas/cardLayout.ts), so an arrow meets the edge that is
 * actually drawn without anything measuring the DOM.
 */
const cardRects = computed(() => {
  const m = new Map<string, Rect>();
  for (const c of cards.value) {
    m.set(c.recordId, { x: c.x, y: c.y, w: c.w, h: effectiveHeight(c.h, lineCount(c.rows), c.collapsed, c.rich.length) });
  }
  return m;
});

/* ── arrow styles ────────────────────────────────────────────────────────── */

/** Colour and direction per link field — from the FIELD, so the same on every canvas. */
const arrowStyles = computed(() => {
  const m = new Map<string, ArrowStyle>();
  for (const f of store.state.fields.values()) if (f.type === 'link') m.set(f.id, arrowStyleOf(f));
  // A junction's arrows wear its TABLE's colour, keyed by the table id (sql/016).
  for (const t of store.state.tables.values()) if (junctionOf(t)) m.set(t.id, { color: t.color || undefined } as ArrowStyle);
  return m;
});

/**
 * A linked record named on a card, dragged OFF it: place it on this canvas where it is
 * dropped, or jump to it if it is already here (the same drop path pills from the tray
 * use). It stops the press so the card itself does not start moving.
 *
 * OFF the card is the point. A pill is also something you double-click, and a press
 * that wobbles a few pixels is a drag: let go anywhere over the card the pill sits on
 * and nothing is placed (it used to land a new card on top of the one you were
 * reading). The card's rectangle is taken when the drag starts — the card cannot move
 * during it — and the ghost stays dim until the pointer has left it.
 */
function onDragLinked({ recordId, from, e }: { recordId: string; from: string; e: PointerEvent }) {
  const rec = store.state.records.get(recordId);
  e.stopPropagation();
  // A press that moves places (or jumps to) the record; a still one does nothing — a double-click on the pill opens.
  if (!rec) return;
  const origin = cardRects.value.get(from);
  const leftTheCard = (x: number, y: number) => {
    if (!origin) return true;
    const p = viewport.clientToWorld(x, y);
    return !(p.x >= origin.x && p.x <= origin.x + origin.w && p.y >= origin.y && p.y <= origin.y + origin.h);
  };
  beginRecordDrag(() => [rec], e, () => derived.labelOfId(recordId), undefined, leftTheCard);
}
const isJunctionRecord = (id: string) => store.state.tables.get(store.state.records.get(id)?.table_id ?? '')?.kind === 'junction';
/** Duplicate a placed record and place the copy just beside the original, selected. */
function duplicateHere(recordId: string) {
  const [id] = duplicateRecords(store, [recordId]);
  const rect = cardRects.value.get(recordId);
  const rec = id ? store.state.records.get(id) : undefined;
  if (!rec || !rect) return;
  const c = viewport.worldToClient(rect.x + 24, rect.y + 24);
  placeMany([rec], c.x, c.y);
  selected.clear(); selected.add(id!);
}
/** A pair's ✎ on a card: the pair editor, on that row, anchored at the card. */
function onEditPair({ recordId, fieldId, row }: { recordId: string; fieldId: string; row: string }) {
  const f = store.state.fields.get(fieldId);
  const j = f ? derived.junctionOfBacklink(f) : null;
  const rect = cardRects.value.get(recordId);
  if (!j || !rect) return;
  const c = viewport.worldToClient(rect.x + rect.w, rect.y);
  junctionPick.value = { table: j.table, cfg: j.cfg, side: j.side, fromRecord: recordId, rowId: row, client: { x: c.x, y: c.y }, world: { x: rect.x + rect.w, y: rect.y } };
}

/* ── "find…" in the new-link menu: choose the other end, or name a new one ──
   Opened at the spot the link was let go; whichever it is lands THERE (`world` is the
   drop point — the card's top edge sits 24px above it, centred, as for a new record). */
const linkPick = ref<{ fieldId: string; fromRecord: string; targetTable: string; back?: boolean; client: { x: number; y: number }; world: { x: number; y: number } } | null>(null);
/** The row's ends for a pick: through a backlink the chosen record HOLDS the link. */
const pickEnds = (p: { fromRecord: string; back?: boolean }, chosen: string) => (p.back ? { holder: chosen, target: p.fromRecord } : { holder: p.fromRecord, target: chosen });
function linkPickChoose(recordId: string) {
  const p = linkPick.value; if (!p) return;
  linkPick.value = null;
  const rec = store.state.records.get(recordId);
  const e = pickEnds(p, recordId);
  addLink(store, p.fieldId, e.holder, e.target);
  if (rec) placeAtDrop(rec, p.world);
  pulse([`${p.fieldId}|${e.holder}|${e.target}`]);
}
function linkPickCreate(name: string) {
  const p = linkPick.value; if (!p) return;
  linkPick.value = null;
  const key = derived.labelKeys.value.get(p.targetTable);
  const id = crypto.randomUUID();
  const z = placements.value.reduce((n, q) => Math.max(n, q.z), 0) + 1;
  // Record, its name, the link and the placement: ONE run, one Ctrl+Z.
  const data = key ? { [key]: name } : {};
  if (scopeApi) scopeApi.createRecord(p.targetTable, data, id, { defaults: activeDefaults.value });
  else store.mutate({ type: 'record.create', id, tableId: p.targetTable, data });
  const e = pickEnds(p, id);
  addLink(store, p.fieldId, e.holder, e.target);
  store.mutate({ type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: id, x: Math.round(p.world.x - CARD_W / 2), y: Math.round(p.world.y - 24), w: null, h: null, z });
  selected.clear(); selected.add(id);
}

/* ── defaults: what a record created here starts out linked to ─────────────
   contract/canvasConfig.ts (`defaults`, `defaultLinkField`) and client/scope.ts
   (`createRecord`). This block is the BAR: showing them, adding, removing, the switch. */

const rawDefaults = computed(() => parsedConfig().defaults ?? []);
// A default's record has to be LOADED to have a name here (and to be linked to at all).
watch(rawDefaults, (list) => { for (const t of new Set(list.map((d) => d.tableId))) void store.loadTable(t); }, { immediate: true });

const defaults = computed(() => rawDefaults.value.map((d) => {
  const loaded = store.tableLoads.get(d.tableId)?.state === 'loaded';
  return {
    ...d, table: store.state.tables.get(d.tableId)?.name ?? '?',
    label: store.state.records.has(d.recordId) ? derived.labelOfId(d.recordId) : loaded ? '(deleted)' : '…',
    missing: loaded && !store.state.records.has(d.recordId),
  };
}));
const isDefault = (recordId: string) => rawDefaults.value.some((d) => d.recordId === recordId);

/** Tables something LINKS TO — the only ones a default can usefully point at. */
const linkableTables = computed(() => {
  const targets = new Set<string>();
  for (const f of store.state.fields.values()) if (f.type === 'link' && typeof f.options?.target_table_id === 'string') targets.add(f.options.target_table_id);
  return tablesSorted(store.state).filter((t) => targets.has(t.id));
});
const canBeDefault = (recordId: string) => linkableTables.value.some((t) => t.id === store.state.records.get(recordId)?.table_id);

function saveDefaults(next: Array<{ tableId: string; recordId: string }>) {
  const { defaults: _old, ...rest } = parsedConfig();
  void _old;
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: next.length ? { ...rest, defaults: next } : rest });
}
function addDefault(tableId: string, recordId: string) {
  if (isDefault(recordId) || rawDefaults.value.length >= 20) return;
  saveDefaults([...rawDefaults.value, { tableId, recordId }]);
  defaultsOn.value = true;                 // you just asked for it
  addingDefault.value = false; addTable.value = '';   // the popover closes; "+ add" starts fresh next time
}
const removeDefault = (recordId: string) => saveDefaults(rawDefaults.value.filter((d) => d.recordId !== recordId));

const addingDefault = ref(false);
const addTable = ref('');

/* On/off is a way of WORKING, not a fact about the board: ONE switch for every
   canvas, for this tab's session (client/prefs.ts). It was per canvas and came back
   ON with every canvas you opened. */
const defaultsOn = computed({ get: () => !canvasDefaultsOff.value, set: (on: boolean) => { canvasDefaultsOff.value = !on; } });
watch(() => props.canvasId, () => { addingDefault.value = false; addTable.value = ''; });

/** What createAt hands to createRecord. */
const activeDefaults = computed(() => (defaultsOn.value ? rawDefaults.value : []));

/** The project scope applies on top; show it, so the bar is the WHOLE answer. */
const scopeChip = computed(() => {
  const s = scopeApi?.scope.value;
  if (!scopeApi || !s || s.kind !== 'record') return null;
  return { label: scopeApi.label.value, table: store.state.tables.get(scopeApi.scopeTableId.value)?.name ?? '' };
});

/** "Files → Works": tables where a default would be SKIPPED because the field is ambiguous. */
const defaultAmbiguities = computed(() => {
  const out: string[] = [];
  for (const targetId of new Set(rawDefaults.value.map((d) => d.tableId))) {
    for (const t of tablesSorted(store.state)) {
      const via = defaultLinkField(store.state.fields.values(), t.id, targetId);
      if (via && 'ambiguous' in via) out.push(`${t.name} has ${via.ambiguous.length} links to ${store.state.tables.get(targetId)?.name ?? '?'}`);
    }
  }
  return out;
});

/* ── arrows you can select, and links you can make and remove here ─────────

     ADD     drag from a card's ⊕ handle (below: "one handle per card").
     SEE     click an arrow: it is selected and labelled with its field's name.
     REMOVE  right-click an arrow → "Remove this link…" → confirm. (Delete, with an
             arrow selected, asks the same question.) An arrow is thin; what goes is
             data. It is one Ctrl+Z either way. */

const selectedLink = ref<ArrowLink | null>(null);
const keyOfLink = (l: ArrowLink) => `${l.field_id}|${l.from_record}|${l.to_record}`;
const selectedLinkKey = computed(() => {
  const l = selectedLink.value;
  // A peer (or our own Remove) may have deleted it: a selection must not outlive its link.
  const alive = l && (l.junction ? store.state.records.has(l.junction) : store.state.links.has(linkKey(l.field_id, l.from_record, l.to_record)));
  return l && alive ? keyOfLink(l) : null;
});
const linkFieldNames = computed(() => {
  const m = new Map<string, string>();
  for (const f of store.state.fields.values()) if (f.type === 'link') m.set(f.id, f.name);
  return m;
});

function selectLink(l: ArrowLink) {
  selected.clear();                       // an arrow OR cards, never both: Delete must be unambiguous
  selectedLink.value = l;
  menu.value = null;
  containerRef.value?.focus();
}
function onLinkMenu(l: ArrowLink, e: MouseEvent) {
  selectLink(l);
  const r = containerRef.value!.getBoundingClientRect();
  const w = viewport.clientToWorld(e.clientX, e.clientY);
  menu.value = { kind: 'link', x: vp(e.clientX - r.left), y: vp(e.clientY - r.top), wx: w.x, wy: w.y, link: l };
}
async function removeLink(l: ArrowLink) {
  if (l.junction) {
    // A pair is DELETED, never unlinked (sql/016): the row, with its status and notes, goes — undoable.
    const t = store.state.tables.get(l.field_id);
    if (!await confirmDialog({
      title: `Delete this ${t?.singular_name || t?.name || 'pair'}?`, danger: true, okText: 'Delete pair',
      body: `${derived.labelOfId(l.from_record)} → ${derived.labelOfId(l.to_record)}\n\nBoth records stay; the pair between them — its status and notes — goes. It can be undone (Ctrl+Z, or from History).`,
    })) return;
    store.mutate({ type: 'record.delete', id: l.junction });
    selectedLink.value = null;
    return;
  }
  const field = linkFieldNames.value.get(l.field_id) ?? 'link';
  if (!await confirmDialog({
    title: `Remove this “${field}” link?`, danger: true, okText: 'Remove link',
    body: `${derived.labelOfId(l.from_record)} → ${derived.labelOfId(l.to_record)}\n\nBoth records stay; only the link between them goes. It can be undone (Ctrl+Z, or from History).`,
  })) return;
  store.mutate({ type: 'link.remove', fieldId: l.field_id, fromRecord: l.from_record, toRecord: l.to_record });
  selectedLink.value = null;
}

/* ── linking: ONE handle per card ──────────────────────────────────────────

   Every card whose table can link to anything has one ⊕, off its bottom-right
   corner. Drag it; what the drag makes is decided when it lands, by the two TABLES
   involved and nothing else (contract/canvasLink.ts is the rule, and says why):

     on a card, ONE way between the tables     the link is made (a junction's pair:
                                               its status is asked first)
     on a card, SEVERAL ways                   a menu of them — always
     on a card, NO way                         the card flashes red; nothing happens
     on a card it is already linked to         said, and the arrow pulses
     on empty canvas, or the ⊕ just clicked    a menu of every way this table has:
                                               a new record through it, or "find…"

   This replaced a handle on every visible link row (PLAN.md, "One handle"): those
   chose the field up front, which was unambiguous but put a column of small targets
   beside everything else a row does. Forward links only for now — dragging a File
   onto the Edit it is an input OF (the backlink reading) is not offered yet.

   Nobody has to let go to find out: while the link is held, cards that cannot take
   it dim, cards that can are outlined, and a label by the pointer names what
   releasing would do. */

/** Which tables have a card here — as a string, so it only changes when the SET does (not on every card move). */
const placedTables = computed(() => [...new Set(cards.value.map((c) => c.tableId))].sort().join());
/** The ways a record of each of those tables can be linked. Per TABLE: the same for every card of it, shown fields or not. */
const waysByTable = computed(() => {
  const m = new Map<string, LinkWay[]>();
  for (const tableId of placedTables.value.split(',').filter(Boolean)) m.set(tableId, linkWays(store.state.fields.values(), store.state.tables.values(), tableId));
  return m;
});
const waysOf = (tableId: string) => waysByTable.value.get(tableId) ?? [];

/** Is this way already made between these two records? */
/* A link way through a BACKLINK (`back`) writes the row on the record the drag LANDS
   on: `linkEnds` gives the row's holder and target either way, and every rule below
   reads the row through it — made, replaced, keyed, drawn. */
const wayMade = (way: LinkWay, from: string, to: string) => {
  if (way.kind !== 'link') return !!derived.junctionRowFor(way.cfg, way.side, from, to);
  const e = linkEnds(way, from, to);
  return store.state.links.has(linkKey(way.fieldId, e.holder, e.target));
};
/** The key its arrow is drawn under (ArrowLayer): a link's runs holder → target, a pair's A → B, whichever end made it. */
const arrowKeyOf = (way: LinkWay, from: string, to: string) => {
  if (way.kind === 'link') { const e = linkEnds(way, from, to); return `${way.fieldId}|${e.holder}|${e.target}`; }
  return way.side === 'a' ? `${way.table}|${from}|${to}` : `${way.table}|${to}|${from}`;
};
const wayColor = (way: LinkWay) => arrowStyles.value.get(way.key)?.color || 'var(--arrow)';
const singularOf = (tableId: string) => { const t = store.state.tables.get(tableId); return t?.singular_name || t?.name || 'record'; };

const verdictFor = (from: string, fromTable: string, to: string, toTable: string): DropVerdict =>
  dropVerdict(waysBetween(waysOf(fromTable), toTable), from === to, (w) => wayMade(w, from, to));
/** What a single link holds now and would lose: making it REPLACES that (client/links.ts). */
const replacedBy = (way: LinkWay, from: string, to: string) => {
  if (way.kind !== 'link') return undefined;
  const e = linkEnds(way, from, to);
  // Single on the holder's side: what the holder links to now goes. Single on the target's
  // side: whoever holds the target now lets go of it. Either reads as "replaces X".
  if (way.single) { const was = derived.linksFrom(e.holder, way.fieldId).find((id) => id !== e.target); if (was) return was; }
  if (way.singleTarget) return derived.linkedTo(e.target, way.fieldId).find((id) => id !== e.holder);
  return undefined;
};
function hintFor(v: DropVerdict, from: string, to: string) {
  const names = { from: tableNameOf(from), to: tableNameOf(to) };
  const was = v.kind === 'link' ? replacedBy(v.way, from, to) : undefined;
  return verdictHint(v, names, was ? derived.labelOfId(was) : undefined);
}
/** Beside a way in the "several ways" menu: what choosing it involves beyond the link itself. */
function wayNote(way: LinkWay, from: string, to: string) {
  if (way.kind === 'junction') return junctionStatusChoices(way.table).length ? 'status…' : '';
  const was = replacedBy(way, from, to);
  return was ? `replaces ${derived.labelOfId(was)}` : '';
}

/* The drag, in two parts: where it STARTED (fixed for its whole life — the verdicts
   below are computed once from it) and where the pointer IS (changes every move). */
const linkFrom = ref<{ recordId: string; tableId: string; at: Point } | null>(null);
const linkTo = ref<{ world: Point; client: { x: number; y: number }; over: string | null; moved: boolean } | null>(null);
/** A press that moves less than this is a CLICK on the handle, not a drag. */
const LINK_DRAG_SLOP = 5;

/** For every card here: what letting the link go on it would do. */
const dragVerdicts = computed(() => {
  const m = new Map<string, DropVerdict>();
  const d = linkFrom.value;
  if (d) for (const c of cards.value) m.set(c.recordId, verdictFor(d.recordId, d.tableId, c.recordId, c.tableId));
  return m;
});
function linkTargetState(recordId: string): 'from' | 'ok' | 'over' | 'dim' | 'no' | 'linked' | null {
  if (!linkFrom.value) return null;
  const over = linkTo.value?.over === recordId;
  switch (dragVerdicts.value.get(recordId)?.kind) {
    case 'self': return 'from';
    case 'none': return over ? 'no' : 'dim';
    case 'linked': return 'linked';
    case 'link': case 'pair': case 'choose': return over ? 'over' : 'ok';
    default: return null;
  }
}
/** The label by the pointer while a link is held. */
const linkHint = computed(() => {
  const d = linkFrom.value, p = linkTo.value;
  if (!d || !p || !p.moved) return null;
  const at = { x: p.client.x + 14, y: p.client.y + 16 };
  if (!p.over) return { text: 'new or existing record…', tone: 'idle', ...at };
  const v = dragVerdicts.value.get(p.over);
  if (!v || v.kind === 'self') return null;
  return { text: hintFor(v, d.recordId, p.over), tone: v.kind === 'none' ? 'no' : v.kind === 'linked' ? 'info' : 'ok', ...at };
});

/* ── the handles and a MULTI-selection ──
   Several cards selected would show several ⊕ (and several folders): a link cannot
   be dragged from "several", so none is offered — the handles come back when one
   card is selected again. (Hover still shows them on the card under the pointer
   only when nothing is multi-selected.) */
const multiSelected = computed(() => selected.size > 1);

/* ── the path handle (desktop app only): show the record's file in the file manager ──
   A card whose table has a `file_path` field with a value gets the folder; the first
   such field is the path. What a click finds is kept per card, for this session:
   'folder' (file gone, folder opened) and 'missing' (neither) colour the handle. */
const desktop = isDesktop();
function pathOf(recordId: string): string | undefined {
  if (!desktop) return undefined;
  const rec = store.state.records.get(recordId);
  if (!rec) return undefined;
  for (const f of fieldsOf(store.state, rec.table_id)) {
    if (f.type === 'file_path' && typeof rec.data[f.key] === 'string' && rec.data[f.key]) return rec.data[f.key] as string;
  }
  return undefined;
}
const pathState = reactive(new Map<string, 'ok' | 'folder' | 'missing'>());
function revealPath({ recordId, path }: { recordId: string; path: string }) {
  invoke<string>('reveal', { path })
    .then((r) => { pathState.set(recordId, r === 'folder' ? 'folder' : 'ok'); if (r === 'folder') notice('The file is not there any more — its folder was opened.', 'info'); })
    .catch((e) => { pathState.set(recordId, 'missing'); notice(String(e), 'error'); });
}

/** The topmost card under a world point. */
function cardAt(p: Point): { recordId: string; tableId: string } | null {
  let best: { recordId: string; tableId: string; z: number } | null = null;
  for (const c of cards.value) {
    const r = cardRects.value.get(c.recordId);
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && (!best || c.z >= best.z)) best = { recordId: c.recordId, tableId: c.tableId, z: c.z };
  }
  return best;
}

function startLinkDrag({ recordId, e }: { recordId: string; e: PointerEvent }) {
  const rect = cardRects.value.get(recordId);
  const rec = store.state.records.get(recordId);
  if (e.button > 0 || !rect || !rec || !waysOf(rec.table_id).length) return;
  menu.value = null; linkPick.value = null; junctionPick.value = null; selectedLink.value = null;
  // The card being linked FROM is the selection: its handle stays up for the next
  // link, and in "focus" its own arrows are the ones left lit.
  selected.clear(); selected.add(recordId);
  // The handle swallows its press (or the card would drag), so the canvas does not get
  // focus by itself — and without it Escape reaches neither the drag's menu nor Delete.
  containerRef.value?.focus();
  const down = { x: e.clientX, y: e.clientY };
  linkFrom.value = { recordId, tableId: rec.table_id, at: linkHandleAt(rect) };
  linkTo.value = { world: viewport.clientToWorld(down.x, down.y), client: down, over: null, moved: false };

  const move = (ev: PointerEvent) => {
    const p = linkTo.value;
    if (!linkFrom.value || !p) return;
    // `!(… <= slop)`, not `> slop`: a pointer event with no coordinates must not read as "never moved".
    const moved = p.moved || !(Math.hypot(ev.clientX - down.x, ev.clientY - down.y) <= LINK_DRAG_SLOP);
    const world = viewport.clientToWorld(ev.clientX, ev.clientY);
    linkTo.value = { world, client: { x: ev.clientX, y: ev.clientY }, over: moved ? cardAt(world)?.recordId ?? null : null, moved };
  };
  const up = () => {
    const d = linkFrom.value, p = linkTo.value;
    end();
    if (d && p) dropLink(d.recordId, d.tableId, p);
  };
  const cancel = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(); };
  function end() {
    linkFrom.value = null; linkTo.value = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', cancel, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', cancel, true);
}

/** The link is let go. Everything it can do is one of `dropVerdict`'s cases. */
function dropLink(from: string, fromTable: string, p: { world: Point; client: { x: number; y: number }; moved: boolean }) {
  // The ⊕ clicked, not dragged: the same menu as an empty-canvas drop, the new record going beside the card.
  if (!p.moved) { openNewLinkMenu(from, p.client, spotBeside(from)); return; }
  const hit = cardAt(p.world);
  if (!hit) { openNewLinkMenu(from, p.client, p.world); return; }
  const v = verdictFor(from, fromTable, hit.recordId, hit.tableId);
  switch (v.kind) {
    case 'self': return;
    case 'none': refuse(hit.recordId); say(hintFor(v, from, hit.recordId), 'no', p.client); return;
    case 'linked': pulse(v.ways.map((w) => arrowKeyOf(w, from, hit.recordId))); say(hintFor(v, from, hit.recordId), 'info', p.client); return;
    case 'link': makeLink(v.way, from, hit.recordId, p.client); return;
    case 'pair': makePair(v.way, from, hit.recordId, p.client, p.world); return;
    case 'choose': menu.value = { kind: 'link-choose', ...menuAt(p.client), wx: p.world.x, wy: p.world.y, recordId: from, toRecord: hit.recordId, options: v.options, client: { ...p.client } };
  }
}

function makeLink(way: LinkFieldWay, from: string, to: string, client: { x: number; y: number }) {
  const was = replacedBy(way, from, to);
  const wasLabel = was ? derived.labelOfId(was) : '';
  const e = linkEnds(way, from, to);
  addLink(store, way.fieldId, e.holder, e.target);
  pulse([arrowKeyOf(way, from, to)]);
  say(was ? `✓ ${way.name} · replaced ${wasLabel}` : `✓ ${way.name}`, 'ok', client);
}
/** A pair has a status to pick — unless its junction has none to offer, and then it is simply made. */
function makePair(way: JunctionWay, from: string, to: string, client: { x: number; y: number }, world: Point) {
  if (!junctionStatusChoices(way.table).length) {
    addPair(store, way.table, way.cfg, way.side, from, to);
    pulse([arrowKeyOf(way, from, to)]);
    say(`✓ ${way.name}`, 'ok', client);
    return;
  }
  junctionPick.value = { table: way.table, cfg: way.cfg, side: way.side, fromRecord: from, picked: to, client: { ...client }, world };
}
function chooseWay(m: Menu, way: LinkWay) {
  if (!m.recordId || !m.toRecord || wayMade(way, m.recordId, m.toRecord)) return;   // (a peer may have made it while the menu was up)
  const client = m.client ?? { x: 0, y: 0 };
  if (way.kind === 'link') makeLink(way, m.recordId, m.toRecord, client);
  else makePair(way, m.recordId, m.toRecord, client, { x: m.wx, y: m.wy });
}

/* The new-link menu (empty canvas, or the ⊕ clicked). */
const menuAt = (client: { x: number; y: number }) => {
  const box = containerRef.value?.getBoundingClientRect();
  return { x: vp(client.x - (box?.left ?? 0)), y: vp(client.y - (box?.top ?? 0)) };
};
function openNewLinkMenu(from: string, client: { x: number; y: number }, world: Point) {
  menu.value = { kind: 'link-new', ...menuAt(client), wx: world.x, wy: world.y, recordId: from, client: { ...client } };
}
/** Its rows: the ways whose field this card SHOWS first, then the rest — all of them, always. */
const menuWays = computed(() => {
  const m = menu.value;
  const tableId = m?.kind === 'link-new' ? store.state.records.get(m.recordId ?? '')?.table_id : undefined;
  if (!tableId) return [];
  const on = new Set(shownFields(tableId).map((f) => f.id));
  const ways = waysOf(tableId);
  const shown = ways.filter((w) => w.column && on.has(w.column)), rest = ways.filter((w) => !(w.column && on.has(w.column)));
  return [
    { title: 'New record, linked through…', ways: shown.length ? shown : rest },
    ...(shown.length && rest.length ? [{ title: 'Not shown on this card', ways: rest }] : []),
  ];
});
/** A drop point for "beside this card": the first free spot down its right-hand side. */
function spotBeside(recordId: string): Point {
  const r = cardRects.value.get(recordId);
  if (!r) return lastPointer ?? { x: 0, y: 0 };
  const probe = { x: r.x + r.w + 64, y: r.y, w: CARD_W, h: 96 };
  const taken = [...cardRects.value.values()];
  for (let i = 0; i < 16 && taken.some((o) => rectsIntersect(probe, o)); i++) probe.y += probe.h + DROP_GAP;
  return { x: probe.x + CARD_W / 2, y: probe.y + 24 };
}
/** A new, blank record of the way's table at the drop point, linked FROM the card — one run, one Ctrl+Z — and opened, to be named. */
function createLinked(m: Menu, way: LinkFieldWay) {
  if (!m.recordId) return;
  const id = crypto.randomUUID();
  const z = placements.value.reduce((n, q) => Math.max(n, q.z), 0) + 1;
  if (scopeApi) scopeApi.createRecord(way.toTable, {}, id, { defaults: activeDefaults.value });
  else store.mutate({ type: 'record.create', id, tableId: way.toTable, data: {} });
  const e = linkEnds(way, m.recordId, id);
  addLink(store, way.fieldId, e.holder, e.target);
  store.mutate({ type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: id, x: Math.round(m.wx - CARD_W / 2), y: Math.round(m.wy - 24), w: null, h: null, z });
  selected.clear(); selected.add(id);
  emit('open-record', id);
}
const findLinked = (m: Menu, way: LinkFieldWay) => {
  if (m.recordId) linkPick.value = { fieldId: way.fieldId, fromRecord: m.recordId, targetTable: way.toTable, back: way.back, client: m.client ?? { x: 0, y: 0 }, world: { x: m.wx, y: m.wy } };
};
const pairVia = (m: Menu, way: JunctionWay) => {
  if (m.recordId) junctionPick.value = { table: way.table, cfg: way.cfg, side: way.side, fromRecord: m.recordId, client: m.client ?? { x: 0, y: 0 }, world: { x: m.wx, y: m.wy } };
};
/** An existing record, put where a link was let go (centred under the drop point, like a new one). */
function placeAtDrop(rec: RecordRow, world: Point) {
  const c = viewport.worldToClient(world.x - CARD_W / 2, world.y - 24);
  placeMany([rec], c.x, c.y);
}

/* What the canvas SAYS about a link, for a moment: a label where it was let go, a
   red flash on a card that refused it, a pulse on the arrow it made or found. Each
   restarts cleanly when the same thing happens twice running. */
const linkNote = ref<{ text: string; tone: 'ok' | 'info' | 'no'; x: number; y: number; n: number } | null>(null);
let noteTimer: ReturnType<typeof setTimeout> | undefined, noteN = 0;
function say(text: string, tone: 'ok' | 'info' | 'no', client: { x: number; y: number }) {
  clearTimeout(noteTimer);
  linkNote.value = { text, tone, x: client.x + 14, y: client.y + 16, n: ++noteN };
  noteTimer = setTimeout(() => { linkNote.value = null; }, 2000);
}
const refused = ref('');
let refuseTimer: ReturnType<typeof setTimeout> | undefined;
function refuse(recordId: string) {
  refused.value = '';
  clearTimeout(refuseTimer);
  void nextTick(() => { refused.value = recordId; refuseTimer = setTimeout(() => { refused.value = ''; }, 750); });
}
const pulsed = ref<ReadonlySet<string>>(new Set());
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
function pulse(keys: string[]) {
  pulsed.value = new Set();
  clearTimeout(pulseTimer);
  void nextTick(() => { pulsed.value = new Set(keys); pulseTimer = setTimeout(() => { pulsed.value = new Set(); }, 1200); });
}

/** The line being dragged, for ArrowLayer: from the handle to the pointer, leaving the way the pointer went. */
const rubber = computed(() => {
  const d = linkFrom.value, p = linkTo.value;
  if (!d || !p || !p.moved) return null;
  const dx = p.world.x - d.at.x, dy = p.world.y - d.at.y;
  const side: AnchorSide = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
  const facing: Record<AnchorSide, AnchorSide> = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
  const v = p.over ? dragVerdicts.value.get(p.over) : undefined;
  // Solid when letting go here would make (or ask about) a link; in the field's colour when it is known which.
  const valid = !!v && (v.kind === 'link' || v.kind === 'pair' || v.kind === 'choose');
  const color = v && (v.kind === 'link' || v.kind === 'pair') ? arrowStyles.value.get(v.way.key)?.color : undefined;
  return { path: bezierPath(d.at, side, p.world, facing[side], 0), valid, color };
});

/* ── a pair being made or edited (sql/016): the JunctionEditor, anchored at a point ── */
const junctionPick = ref<{ table: string; cfg: JunctionConfig; side: 'a' | 'b'; fromRecord: string; picked?: string; rowId?: string;
  client: { x: number; y: number }; world: { x: number; y: number } } | null>(null);
const junctionAnchor = ref<HTMLElement | null>(null);
/** The row is made: if its other end was chosen from the picker (the new-link menu), place it at the drop. */
function junctionPickCreated(_rowId: string, other: string) {
  const p = junctionPick.value; if (!p) return;
  if (!p.picked && !cardRects.value.has(other)) {
    const rec = store.state.records.get(other);
    if (rec) placeAtDrop(rec, p.world);
  }
  pulse([p.side === 'a' ? `${p.table}|${p.fromRecord}|${other}` : `${p.table}|${other}|${p.fromRecord}`]);
}
const junctionStatusChoices = (junctionTable: string) => {
  const cfg = junctionOf(store.state.tables.get(junctionTable));
  return cfg?.status ? choicesOf(store.state.fields.get(cfg.status)?.options) ?? [] : [];
};
function setJunctionStatus(rowId: string, status: string) {
  const row = store.state.records.get(rowId);
  const cfg = row ? junctionOf(store.state.tables.get(row.table_id)) : null;
  const key = cfg?.status ? store.state.fields.get(cfg.status)?.key : undefined;
  if (!key) return;
  store.mutate({ type: 'record.update', id: rowId, set: { [key]: status }, unset: [] });
}

/** Every junction row whose two ends are both on this canvas, as an arrow A → B keyed by the junction table (ArrowLayer.vue). */
const junctionArrows = computed<ArrowLink[]>(() => {
  const out: ArrowLink[] = [];
  for (const t of store.state.tables.values()) {
    const cfg = junctionOf(t);
    if (!cfg) continue;
    for (const r of store.state.records.values()) {
      if (r.table_id !== t.id) continue;
      const j = derived.junctionRow(r.id);
      if (!j?.a || !j.b || !cardRects.value.has(j.a) || !cardRects.value.has(j.b)) continue;
      out.push({ field_id: t.id, from_record: j.a, to_record: j.b, junction: r.id, label: j.status || (t.singular_name || t.name) });
    }
  }
  return out;
});

/* ── which relational arrows are drawn ────────────────────────────────────

   all       every link whose two ends are both on this canvas
   selected  only links touching a selected card — for a busy board, where the
             question is "what is THIS connected to"
   off       none

   Relational arrows only; hand-drawn canvas arrows (not built yet) get their own
   switch. Kept per browser, per canvas. */
/**
 * always  every arrow, never dimmed.
 * focus   every arrow; once something is SELECTED, arrows touching none of the
 *         selection dim. Nothing happens on hover — hovering used to dim, which
 *         made the canvas flicker as the pointer crossed it. (The default.)
 * off     no arrows.
 * The per-relationship visibility list (the ▾) applies in every mode.
 */
type ArrowMode = 'always' | 'focus' | 'off';
const ARROW_MODES: ArrowMode[] = ['always', 'focus', 'off'];
const ARROW_MODE_TITLE: Record<ArrowMode, string> = {
  always: 'Every relationship, never dimmed — click for: focus',
  focus: 'Every relationship; selecting cards dims the arrows that do not touch them — click for: off',
  off: 'Relationship arrows hidden — click for: always',
};
const arrowKey = () => `spatialdb.arrows.${props.canvasId}`;
function readArrowMode(): ArrowMode {
  try {
    const v = localStorage.getItem(arrowKey());
    if (v === 'all') return 'always'; if (v === 'selected') return 'focus';   // the old names, remembered by older builds
    return ARROW_MODES.includes(v as ArrowMode) ? (v as ArrowMode) : 'focus';
  } catch { return 'focus'; }   // storage can be unavailable (private mode, tests)
}
const arrowMode = ref<ArrowMode>(readArrowMode());
watch(() => props.canvasId, () => { arrowMode.value = readArrowMode(); });
function cycleArrowMode() {
  arrowMode.value = ARROW_MODES[(ARROW_MODES.indexOf(arrowMode.value) + 1) % ARROW_MODES.length];
  try { localStorage.setItem(arrowKey(), arrowMode.value); } catch { /* see above */ }
}

/* Per RELATIONSHIP, on top of the mode: hide "Inputs" while you look at version
   lineage. Same storage rule as the mode — this browser, this canvas. The list
   doubles as a legend: it names each relationship drawn here, in its colour. */
const hiddenFieldsKey = () => `spatialdb.arrows.hidden.${props.canvasId}`;
function readHiddenFields(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(hiddenFieldsKey()) ?? '[]') as string[]); }
  catch { return new Set(); }
}
const hiddenFields = ref(readHiddenFields());
watch(() => props.canvasId, () => { hiddenFields.value = readHiddenFields(); });
function toggleFieldArrows(fieldId: string) {
  const next = new Set(hiddenFields.value);
  if (next.has(fieldId)) next.delete(fieldId); else next.add(fieldId);
  hiddenFields.value = next;
  try { localStorage.setItem(hiddenFieldsKey(), JSON.stringify([...next])); } catch { /* unavailable */ }
}
const legendOpen = ref(false);

const linksOnCanvas = computed<ArrowLink[]>(() => [
  ...[...store.state.links.values()].filter((l) => cardRects.value.has(l.from_record) && cardRects.value.has(l.to_record)),
  ...junctionArrows.value,
]);

/** Every relationship that HAS an arrow on this canvas, for the legend. */
const legend = computed(() => {
  const counts = new Map<string, number>();
  for (const l of linksOnCanvas.value) counts.set(l.field_id, (counts.get(l.field_id) ?? 0) + 1);
  return [...counts].flatMap(([fieldId, n]) => {
    const jt = store.state.tables.get(fieldId);   // a junction's arrows are keyed by its table
    if (jt) return [{ id: fieldId, n, color: arrowStyles.value.get(fieldId)?.color, label: `${jt.name} (pairs)`, hidden: hiddenFields.value.has(fieldId) }];
    const f = store.state.fields.get(fieldId);
    if (!f) return [];
    return [{ id: fieldId, n, color: arrowStyles.value.get(fieldId)?.color,
      label: `${store.state.tables.get(f.table_id)?.name ?? '?'} · ${f.name}`, hidden: hiddenFields.value.has(fieldId) }];
  }).sort((a, b) => a.label.localeCompare(b.label));
});

const visibleLinks = computed(() => {
  if (arrowMode.value === 'off') return [];
  return linksOnCanvas.value.filter((l) => !hiddenFields.value.has(l.field_id));
});

function colorOf(tableId: string) {
  return store.state.tables.get(tableId)?.color || 'var(--card-head-bg)';
}


/* ── interactions ────────────────────────────────────────────────────────── */

const drag = useCardDrag({
  state: store.state,
  canvasId: () => props.canvasId,
  getTransform: () => viewport.transform,
  selected,
  mutate: store.mutate,
  topZ: () => placements.value.reduce((n, p) => Math.max(n, p.z), 0),
  drop: (moves) => dropCards(moves),
});

const resize = useCardResize({
  state: store.state,
  canvasId: () => props.canvasId,
  getTransform: () => viewport.transform,
  mutate: store.mutate,
  measure: (id) => {
    const r = cardRects.value.get(id);
    return r ? { w: r.w, h: r.h } : null;
  },
});

const boxSelect = useBoxSelection({
  clientToWorld: viewport.clientToWorld,
  cardRects: () => [...cardRects.value.entries()].map(([recordId, r]) => ({ recordId, ...r })),
  selected,
});

function onCardPointerDown({ recordId, e }: { recordId: string; e: PointerEvent }) {
  menu.value = null;
  selectedLink.value = null;       // cards OR an arrow, never both
  if (spaceHeld.value) return;   // space+drag pans, even over a card
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (additive) {
    selected.has(recordId) ? selected.delete(recordId) : selected.add(recordId);
  } else if (!selected.has(recordId)) {
    // Clicking an unselected card selects only it. Clicking one that is ALREADY
    // part of a multi-selection must NOT collapse the selection, or dragging a
    // group would be impossible.
    selected.clear();
    selected.add(recordId);
  }
  selectedStack.value = null;
  // A card in a stack is drawn where the stack puts it, not where its placement says:
  // give the placement that position, so the drag starts from where the card IS.
  for (const id of selected.has(recordId) && selected.size > 1 ? [...selected] : [recordId]) {
    const p = placementOf(id), r = placedIn(id) ? cardRects.value.get(id) : undefined;
    if (p && r) { p.x = r.x; p.y = r.y; }
  }
  drag.start(recordId, e);
}

function onCardResize({ recordId, handle, e }: { recordId: string; handle: 'e' | 's' | 'se'; e: PointerEvent }) {
  resize.start(recordId, handle, e);
}
/**
 * An edge double-clicked: the card fits its content along that edge — width wide enough
 * for every row (cardLayout.ts `fitCardWidth`), height back to the rows' own (null:
 * auto). Saved like a hand resize, so it stays.
 */
function onCardFit({ recordId, handle }: { recordId: string; handle: 'e' | 's' | 'se' }) {
  const c = cards.value.find((x) => x.recordId === recordId);
  const p = placementOf(recordId);
  if (!c || !p) return;
  const w = handle.includes('e') ? fitCardWidth(c.title, c.rows, textWidth) : undefined;
  const h = handle.includes('s') ? null : undefined;
  if ((w === undefined || w === p.w) && (h === undefined || p.h === null)) return;
  store.mutate({ type: 'placement.update', canvasId: props.canvasId, recordId, ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) });
}

function onCanvasPointerMove(e: PointerEvent) {
  lastPointer = viewport.clientToWorld(e.clientX, e.clientY);
  lastClient = { x: e.clientX, y: e.clientY };
  // While a card is dragged: the stack it would land in lights up (or not).
  if (drag.isDragging.value && rawStacks.value.length) {
    const id = [...drag.draggingIds.value][0];
    const p = id ? placementOf(id) : undefined;
    stackDrop.over = p ? stackAt({ x: p.x + 24, y: p.y + 12 }) : null;
  } else if (stackDrop.over) stackDrop.over = null;
  viewport.onPointerMove(e);
}
let lastClient: { x: number; y: number } | null = null;

function onCanvasPointerDown(e: PointerEvent) {
  menu.value = null;
  addingDefault.value = false;
  linkPick.value = null;
  selectedLink.value = null;
  legendOpen.value = false;
  colourOpen.value = false;
  if (e.button === 1 || spaceHeld.value) { viewport.startPan(e); return; }
  if (e.button !== 0) return;
  if (e.target !== containerRef.value &&
      !(e.target as HTMLElement).classList.contains('canvas-grid') &&
      !(e.target as HTMLElement).classList.contains('canvas-world')) return;
  selectedStack.value = null;
  if (!(e.shiftKey || e.ctrlKey || e.metaKey)) selected.clear();
  boxSelect.start(e);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !spaceHeld.value) { spaceHeld.value = true; e.preventDefault(); }
  // Delete removes the PLACEMENT, never the record. This is the distinction the
  // whole schema is built around, so the destructive-looking key gets the
  // non-destructive meaning; deleting a record is a deliberate act elsewhere.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    // With an ARROW selected, Delete asks about the link (and only ever asks).
    const l = selectedLink.value;
    if (l && selectedLinkKey.value) void removeLink(l);
    else if (selectedStack.value) void removeStack(selectedStack.value);   // asks
    else unplaceSelected();
  }
  if (e.key === 'Escape') { if (menu.value) { menu.value = null; return; } selected.clear(); selectedLink.value = null; selectedStack.value = null; drag.cancel(); }
  if (e.key === 'Enter' && selected.size === 1) { emit('open-record', [...selected][0]); e.preventDefault(); }
  if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    for (const id of cardRects.value.keys()) selected.add(id);
  }
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey) fitAll();
  if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (e.shiftKey) fitAll(); else fit(); }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') { spaceHeld.value = false; viewport.onPointerUp(); }
}

function toggleScrollMode() {
  viewport.scrollMode.value = viewport.scrollMode.value === 'mouse' ? 'touchpad' : 'mouse';
}

function fitAll() {
  viewport.fit([...cardRects.value.values(), ...[...stackLayouts.value.values()].map((l) => l.rect)]);
}
const hasSelection = computed(() => selected.size > 0 || !!selectedStack.value);
/** The selection's rects: the selected cards, or the selected stack's frame. */
function selectionRects(): Rect[] {
  const out: Rect[] = [];
  for (const id of selected) { const r = cardRects.value.get(id); if (r) out.push(r); }
  const st = selectedStack.value ? stackLayouts.value.get(selectedStack.value)?.rect : undefined;
  if (st) out.push(st);
  return out;
}
/** Z: fit the selection if there is one, else everything. Shift+Z: everything, always. */
function fit() {
  const rects = selectionRects();
  if (rects.length) viewport.fit(rects, { maxScale: 1.25 }); else fitAll();
}

/* ── placing and unplacing ───────────────────────────────────────────────── */

/* ── fold ─────────────────────────────────────────────────────────────── */

const placementOf = (recordId: string) => placements.value.find((p) => p.record_id === recordId);
const isCollapsed = (recordId: string) => placementOf(recordId)?.collapsed === true;
function toggleFold(recordId: string) {
  store.mutate({ type: 'placement.update', canvasId: props.canvasId, recordId, collapsed: !isCollapsed(recordId) });
}

/* ── menus, and making records on the canvas ──────────────────────────────

   One floating panel in three guises. `create` is what a double-click opens:
   just the table list, because a double-click means "new record here" and the
   only open question is WHICH KIND. It is skipped entirely when there is a
   single table — or when you made a record a moment ago, in which case the same
   table is assumed (hold Alt to be asked anyway). Laying out ten File cards is
   ten double-clicks, not ten double-clicks and ten menu picks. */

interface Menu {
  kind: 'card' | 'canvas' | 'create' | 'fields' | 'link' | 'link-choose' | 'link-new' | 'stack';
  x: number; y: number; wx: number; wy: number; recordId?: string; link?: ArrowLink; stackId?: string;
  /** The two link menus: the card the link landed on and the ways to choose from (`link-choose`); where the pointer was, on screen. */
  toRecord?: string; options?: Array<{ way: LinkWay; linked: boolean }>; client?: { x: number; y: number };
}
const menu = ref<Menu | null>(null);
/* A menu opened near the canvas's bottom or right edge would be cut off by it (the
   canvas clips). Once it is drawn and has a size, it is moved back inside — up and
   left only, and once per menu, so it never chases the pointer. */
const menuRef = ref<HTMLElement | null>(null);
watch(menu, (m, was) => {
  // …and again when the menu CHANGES SHAPE in place: "Fields on … cards" turns the
  // card menu into the (much taller) field list at the same x/y, which near the bottom
  // edge was cut off. Caught by the owner on a canvas with a long schema.
  if (!m || (was && was.x === m.x && was.y === m.y && was.kind === m.kind)) return;
  void nextTick(() => {
    const el = menuRef.value, box = containerRef.value?.getBoundingClientRect();
    if (!el || !box || menu.value !== m || !el.offsetWidth) return;
    const x = Math.max(4, Math.min(m.x, vp(box.width) - el.offsetWidth - 4)), y = Math.max(4, Math.min(m.y, vp(box.height) - el.offsetHeight - 4));
    if (x !== m.x || y !== m.y) menu.value = { ...m, x, y };
  });
});
const lastCreateTable = ref('');

const tablesForCreate = computed(() => tablesSorted(store.state));
const tableNameOf = (recordId: string) =>
  store.state.tables.get(store.state.records.get(recordId)?.table_id ?? '')?.name ?? 'these';

function openMenu(kind: Menu['kind'], e: MouseEvent, recordId?: string) {
  const box = containerRef.value?.getBoundingClientRect();
  const world = viewport.clientToWorld(e.clientX, e.clientY);
  menu.value = { kind, recordId, wx: world.x, wy: world.y,
    x: vp(e.clientX - (box?.left ?? 0)), y: vp(e.clientY - (box?.top ?? 0)) };
}
/**
 * Close the menu, THEN act — handing the action the menu as it was. The first
 * version cleared `menu` and then ran a closure that read `menu.value`: every
 * item found nothing there. The snapshot is the fix; do not "simplify" it away.
 */
function menuDo(fn: (m: Menu) => void) {
  const m = menu.value;
  menu.value = null;
  if (m) fn(m);
}

const isBackground = (t: EventTarget | null) =>
  t === containerRef.value
  || (t as HTMLElement | null)?.classList?.contains('canvas-grid') === true
  || (t as HTMLElement | null)?.classList?.contains('canvas-world') === true;

function onCardMenu({ recordId, x, y }: { recordId: string; x: number; y: number }) {
  if (!selected.has(recordId)) { selected.clear(); selected.add(recordId); }
  openMenu('card', { clientX: x, clientY: y } as MouseEvent, recordId);
}
function onCanvasMenu(e: MouseEvent) {
  if (isBackground(e.target)) openMenu('canvas', e);
}
function onStackMenu({ stackId, x, y }: { stackId: string; x: number; y: number }) {
  selected.clear(); selectedLink.value = null;
  selectedStack.value = stackId;
  openMenu('stack', { clientX: x, clientY: y } as MouseEvent);
  if (menu.value) menu.value = { ...menu.value, stackId };
}
function onCanvasDblClick(e: MouseEvent) {
  if (!isBackground(e.target)) return;
  const tables = tablesForCreate.value;
  const known = tables.find((t) => t.id === lastCreateTable.value);
  const world = viewport.clientToWorld(e.clientX, e.clientY);
  if (tables.length === 1) return createAt(tables[0].id, world.x, world.y);
  if (known && !e.altKey) return createAt(known.id, world.x, world.y);
  openMenu('create', e);
}

/**
 * A record AND its placement, in one flush — so they share a transaction and a
 * peer never sees a card-less record or a record-less card. Then straight into
 * the record panel: a new card is blank, and a blank card is useless until named.
 */
function createAt(tableId: string, wx: number, wy: number) {
  const id = crypto.randomUUID();
  lastCreateTable.value = tableId;
  const z = placements.value.reduce((n, p) => Math.max(n, p.z), 0) + 1;
  // Through the scope (client/scope.ts): inside a project the new record is made a
  // member of it, in this same run — record, link and placement are one Ctrl+Z.
  // …and linked to this canvas's DEFAULTS (the bar at the top), unless switched off.
  if (scopeApi) scopeApi.createRecord(tableId, {}, id, { defaults: activeDefaults.value });
  else store.mutate({ type: 'record.create', id, tableId, data: {} });
  store.mutate({
    type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: id,
    x: Math.round(wx - CARD_W / 2), y: Math.round(wy - 24), w: null, h: null, z,
  });
  selected.clear();
  selected.add(id);
  emit('open-record', id);
}

/* ── placing an existing record (the command palette) ─────────────────────

   Exposed to App.vue, which owns the palette. A record can be on a canvas ONCE
   (placements are keyed by canvas + record), so choosing one that is already
   here pans to it instead. */

/**
 * A record brought onto the canvas from OUTSIDE it (the palette, a drop) arrives
 * without its links: links reach the client with a table or a scene, and this
 * record came from neither. Its arrows to cards already here would be missing
 * until a reload. `store.loadSceneLinks` fetches exactly the links among the cards
 * now on the canvas — links ONLY, and only if nothing changed locally meanwhile;
 * see its comment for the Ctrl+Z race that taught it to.
 */
function refreshLinksAfterPlacing() {
  void store.loadSceneLinks(props.canvasId).catch(() => {});
}

/** Where the pointer last was over the canvas, in world space — "at the cursor". */
let lastPointer: { x: number; y: number } | null = null;
let cascade = 0;

/**
 * Go to a card that is on this canvas: centred (the zoom is left alone), selected, and
 * pulsed once so the eye lands on it — after a pan every card has moved, and a faint
 * selection ring is not much to find. One way to arrive, whatever asked: a pill's →,
 * the palette, a pill dropped from the tray.
 */
const flashed = ref('');
let flashTimer: ReturnType<typeof setTimeout> | undefined;
function jumpTo(recordId: string): boolean {
  const rect = cardRects.value.get(recordId);
  if (!rect) return false;
  viewport.centerOn([rect]);
  menu.value = null; selectedLink.value = null;
  selected.clear(); selected.add(recordId);
  // Restart the pulse even when the same card is jumped to twice running.
  flashed.value = '';
  clearTimeout(flashTimer);
  void nextTick(() => { flashed.value = recordId; flashTimer = setTimeout(() => { flashed.value = ''; }, 950); });
  containerRef.value?.focus();
  return true;
}

/** On this canvas but drawn nowhere — in a FOLDED stack: unfold it, so the card can be jumped to. */
function unfoldFor(recordId: string): boolean {
  const st = placedIn(recordId);
  if (!st || !stackById.value.get(st)?.collapsed) return false;
  patchStack(st, { collapsed: false });
  void nextTick(() => jumpTo(recordId));
  return true;
}
function placeOrJump(rec: RecordRow): 'placed' | 'jumped' {
  if (jumpTo(rec.id) || unfoldFor(rec.id)) return 'jumped';
  store.adopt([rec]);
  const box = containerRef.value?.getBoundingClientRect();
  const at = lastPointer ?? viewport.clientToWorld((box?.left ?? 0) + (box?.width ?? 0) / 2, (box?.top ?? 0) + (box?.height ?? 0) / 2);
  // Several placed in one palette visit (Shift+Enter) step down-right instead of
  // stacking exactly on top of each other.
  const off = (cascade++ % 8) * 28;
  const z = placements.value.reduce((n, p) => Math.max(n, p.z), 0) + 1;
  store.mutate({
    type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: rec.id,
    x: Math.round(at.x - CARD_W / 2 + off), y: Math.round(at.y - 24 + off), w: null, h: null, z,
  });
  selected.clear(); selected.add(rec.id);
  refreshLinksAfterPlacing();
  return 'placed';
}
/**
 * Several records dropped at one point — rows dragged out of a grid, once two views can share the screen.
 * Laid out as a column (wrapping into further columns), top-left at the drop
 * point, in the order they were in the grid: a sorted, filtered selection arrives
 * on the canvas still sorted. Records already here are skipped, not duplicated
 * (a record sits on a canvas once) and are selected along with the new ones, so
 * the whole set you dragged ends up highlighted either way.
 *
 * All the placement.add mutations happen in one synchronous run, which makes the
 * whole drop ONE Ctrl+Z (see history.ts).
 */
const DROP_GAP = 16, DROP_PER_COLUMN = 8;
function placeMany(records: RecordRow[], clientX: number, clientY: number, options: MutateOptions = {}) {
  // ONE record that is already here (a pill dragged from the tray, say): jump to its
  // card rather than do nothing — a drop that silently does nothing reads as a failure.
  if (records.length === 1 && placedHere.value.has(records[0].id)) { placeOrJump(records[0]); return; }
  const at = viewport.clientToWorld(clientX, clientY);
  const fresh = records.filter((r) => !placedHere.value.has(r.id));
  store.adopt(fresh);
  let z = placements.value.reduce((n, p) => Math.max(n, p.z), 0);
  let col = 0, row = 0, y = at.y;
  for (const rec of fresh) {
    const h = effectiveHeight(null, lineCount(cardRows(rec)), false, richBlocks(rec).length);
    store.mutate({
      type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: rec.id,
      x: Math.round(at.x + col * (CARD_W + DROP_GAP)), y: Math.round(y), w: null, h: null, z: ++z,
    }, options);
    y += h + DROP_GAP;
    if (++row === DROP_PER_COLUMN) { row = 0; col++; y = at.y; }
  }
  selected.clear();
  for (const r of records) selected.add(r.id);
  if (fresh.length) refreshLinksAfterPlacing();
  containerRef.value?.focus();
}

const placedIds = computed(() => new Set(cardRects.value.keys()));
/** The card under a CLIENT point, for a native file drop (client/desktop.ts). */
const cardAtClient = (clientX: number, clientY: number) => cardAt(viewport.clientToWorld(clientX, clientY));
defineExpose({ placeOrJump, placeMany, placedIds, jumpTo, cardAtClient, activeDefaults, refuse, resetCascade: () => { cascade = 0; } });

/** The one place the canvas can destroy DATA, so it says so, and says it is undoable. */
async function deleteRecord(recordId: string) {
  const rec = store.state.records.get(recordId);
  if (!rec) return;
  if (!await confirmDialog({ title: `Delete “${labelOf(rec)}” everywhere?`, danger: true, okText: 'Delete record',
    body: 'Not just from this canvas: it disappears from every canvas and table. It can be restored from History.' })) return;
  store.mutate({ type: 'record.delete', id: recordId });
}

/* ── which fields this canvas's cards show ────────────────────────────── */

const menuTableId = computed(() => store.state.records.get(menu.value?.recordId ?? '')?.table_id ?? '');
const fieldChoices = computed(() => {
  const on = new Set(shownFields(menuTableId.value).map((f) => f.id));
  const primaryKey = labelKeys.value.get(menuTableId.value);
  const pinned = pinnedOf(menuTableId.value);
  return fieldsOf(store.state, menuTableId.value)
    .filter((f) => f.key !== primaryKey)          // the title; always shown, never listed
    .map((f) => ({ id: f.id, name: f.name, on: on.has(f.id), pinned: pinned.has(f.id) }));
});
// A FUNCTION DECLARATION, deliberately: it is hoisted. As a `const` arrow it sat below
// the defaults bar's setup code, which reads the config immediately (an `immediate`
// watcher) — "Cannot access 'parsedConfig' before initialization", and every canvas
// failed to open. Caught by test/scope.ts.
function parsedConfig() {
  const p = CanvasConfig.safeParse(canvasConfig.value ?? {});
  return p.success ? p.data : { cardFields: {} };
}
const hasCustomFields = computed(() => menuTableId.value in parsedConfig().cardFields);

function saveCardFields(tableId: string, ids: string[] | null) {
  const cardFields = { ...parsedConfig().cardFields };
  if (ids) cardFields[tableId] = ids; else delete cardFields[tableId];
  // MERGED into the config, never `{ cardFields }` alone: canvas.update replaces the
  // whole config, and that would silently wipe the canvas's defaults.
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: { ...parsedConfig(), cardFields } });
}
function toggleCardField(fieldId: string) {
  const tableId = menuTableId.value;
  const current = shownFields(tableId).map((f) => f.id);
  const next = current.includes(fieldId) ? current.filter((x) => x !== fieldId)
    // Added fields keep TABLE order rather than going last: the card then reads
    // like the grid's columns, which is where people learned the order.
    : fieldsOf(store.state, tableId).map((f) => f.id).filter((x) => x === fieldId || current.includes(x));
  saveCardFields(tableId, next);
}
function resetCardFields() { saveCardFields(menuTableId.value, null); }
/* HIDE EMPTY and PINS (contract/canvasConfig.ts) — merged into the config like the
   fields are. A pin is kept while "hide empty" is off: it costs nothing, and the next
   time the switch goes on the card is as it was. Reset-to-default (above) leaves pins
   alone: it is about which fields, not which of them may be empty. */
function setHideEmpty(on: boolean) {
  const { hideEmpty: _, ...rest } = parsedConfig();
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: on ? { ...rest, hideEmpty: true } : rest });
}
function togglePin(fieldId: string) {
  const tableId = menuTableId.value;
  const pinnedFields = { ...(parsedConfig().pinnedFields ?? {}) };
  const now = new Set(pinnedFields[tableId] ?? []);
  if (now.has(fieldId)) now.delete(fieldId); else now.add(fieldId);
  if (now.size) pinnedFields[tableId] = [...now]; else delete pinnedFields[tableId];
  const { pinnedFields: _, ...rest } = parsedConfig();
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: Object.keys(pinnedFields).length ? { ...rest, pinnedFields } : rest });
}

function unplace(recordId: string) {
  store.mutate({ type: 'placement.remove', canvasId: props.canvasId, recordId });
  selected.delete(recordId);
}

function unplaceSelected() {
  // A card a stack CLAIMS (it matches the filter) cannot be unplaced: the stack would
  // place it again at once. Take it out of the stack, or change the stack.
  const kept = [...selected].filter((id) => { const st = placedIn(id); return st && censuses.value.get(st)?.matching.includes(id); });
  for (const id of [...selected]) if (!kept.includes(id)) unplace(id);
  if (kept.length) say(`${kept.length === 1 ? 'a card' : `${kept.length} cards`} in a stack stay${kept.length === 1 ? 's' : ''} — take ${kept.length === 1 ? 'it' : 'them'} out of the stack first`, 'info', lastClient ?? { x: 0, y: 0 });
}
/** Is this card one its stack claims — not stale? Such a card has no × and no "remove". */
const stackClaims = (recordId: string) => { const st = placedIn(recordId); return !!st && (censuses.value.get(st)?.matching.includes(recordId) ?? false); };

/* ── lifecycle ───────────────────────────────────────────────────────────── */

let unregisterDrop: (() => void) | undefined;

onMounted(async () => {
  // Records dropped here by anything that uses
  // client/recordDrag.ts) land here.
  if (containerRef.value) unregisterDrop = registerDropTarget(containerRef.value, placeMany);
  await store.loadScene(props.canvasId);
  sceneReady.value = true;
  fitAll();
  containerRef.value?.focus();
});

// Reopening a different canvas reloads rather than reusing a stale scene.
watch(() => props.canvasId, async (id) => {
  selected.clear();
  sceneReady.value = false;
  await store.loadScene(id);
  if (props.canvasId === id) sceneReady.value = true;
  fitAll();
});

onUnmounted(() => {
  clearTimeout(flashTimer); clearTimeout(noteTimer); clearTimeout(refuseTimer); clearTimeout(pulseTimer); clearTimeout(stackRefuseTimer);
  unregisterDrop?.();
  drag.cancel();
  resize.cancel();
});
</script>

<style scoped>
.canvas-container {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: clip;
  background: var(--bg-canvas);
  outline: none;
  user-select: none;
  cursor: default;
}
.canvas-container.panning { cursor: grabbing; }

.canvas-grid { position: absolute; inset: 0; pointer-events: none; z-index: 0; }

.canvas-world {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  transform-origin: 0 0;
  z-index: 1;
  /* Click-through, as in viznotes: this box covers the whole container and sits
     above the arrow layer, so if it took pointer events it would swallow every
     click meant for the background. Cards re-enable events on themselves. */
  pointer-events: none;
  will-change: transform;
}

.selection-box {
  position: fixed;
  border: 1px solid var(--accent);
  background: var(--accent-ring);
  pointer-events: none;
  z-index: 50;
}

/* `display: contents`: the bars and the container are items of App's stage grid
   (App.vue, `.stage`), placed by `.context-bar` / `.context-bar-2` / `.stage-body`. */
.canvas-view { display: contents; }
.canvas-controls {
  position: relative;
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-main);
  z-index: 40;
  font-size: 12px;
}
/* NEVER a line break inside a control: a narrow window wraps the bar by whole
   controls (flex-wrap above), which just makes the bar taller. A button that broke
   "arrows: always" over two lines made the bar taller AND left the rest misaligned. */
.canvas-controls button {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; padding: 2px 6px; border-radius: 3px; font: inherit; white-space: nowrap;
}
.canvas-controls button:hover:not(:disabled) { background: var(--bg-surface-hover); }
.canvas-controls button:disabled { opacity: 0.35; cursor: default; }
.canvas-controls button.active { color: var(--accent); }
.canvas-controls .zoom { color: var(--text-muted); min-width: 38px; text-align: center; }
.canvas-controls .sep { width: 1px; height: 14px; background: var(--border-main); margin: 0 2px; }
.canvas-controls .new-stack { border: 1px dashed var(--border-main); }
.canvas-controls .new-stack:hover { color: var(--accent); border-color: var(--accent); }

.stream-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
.stream-dot.connected { background: var(--success); }
.stream-dot.reconnecting, .stream-dot.connecting { background: var(--warning); }
.stream-dot.resyncing { background: var(--accent); }

.legend {
  position: absolute; top: calc(100% + 4px); left: 12px; min-width: 240px; padding: 6px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px;
  box-shadow: var(--card-shadow-drag); font-size: 12px; display: flex; flex-direction: column; gap: 2px;
}
.legend-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; white-space: nowrap; }
.legend-swatch { width: 18px; height: 3px; border-radius: 2px; flex: none; }
.legend-label { flex: 1; }
.legend-n { color: var(--text-muted); font-size: 11px; }
.legend-note { margin: 4px 4px 2px; color: var(--text-faint); font-size: 11px; white-space: normal; max-width: 260px; }

.defaults-bar {
  position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 4px 12px; border-bottom: 1px solid var(--border-main); font-size: 12px; z-index: 39;
}
.defaults-switch { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-secondary); white-space: nowrap; }
.defaults-switch input { margin: 0; }
.defaults-bar.off .dchip:not(.scope) { opacity: 0.4; text-decoration: line-through; }
.dchip { display: inline-flex; align-items: center; gap: 5px; background: var(--controls-bg); border: 1px solid var(--accent); border-radius: 10px; padding: 0 4px 0 8px; white-space: nowrap; }
.dchip.scope { border-color: var(--border-main); padding-right: 8px; }
.dchip.scope i { color: var(--text-faint); font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: 0.05em; }
.dchip.missing { border-color: var(--warning); color: var(--warning); }
.dchip-table { color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.dchip-x { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 2px; font-size: 12px; line-height: 1; }
.dchip-x:hover { color: var(--danger); }
.defaults-none { color: var(--text-faint); font-style: italic; }
.defaults-add { background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 10px; padding: 0 8px; cursor: pointer; font: inherit; font-size: 11px; }
.defaults-add:hover { color: var(--accent); border-color: var(--accent); }
.defaults-warn { color: var(--warning); font-size: 11px; white-space: nowrap; cursor: help; }
.defaults-pop {
  position: absolute; top: calc(100% + 2px); left: 12px; z-index: 60; width: 340px; padding: 8px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px; box-shadow: var(--card-shadow-drag);
  display: flex; flex-direction: column; gap: 6px;
}
.defaults-table { background: var(--bg-app); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 4px 6px; font: inherit; }

.link-note {
  position: fixed; z-index: 80; pointer-events: none; white-space: nowrap;
  padding: 2px 8px; border-radius: 10px; font-size: 11px; line-height: 16px;
  background: var(--controls-bg); border: 1px solid var(--border-main); color: var(--text-secondary);
  box-shadow: var(--card-shadow);
}
.link-note.ok { border-color: var(--accent); color: var(--text-primary); }
.link-note.info { color: var(--text-primary); }
.link-note.no { border-color: var(--danger); color: var(--danger); }
.link-note.said { animation: link-note-out 2s ease-out 1 forwards; }
@keyframes link-note-out { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
.link-pick { position: fixed; z-index: 70; width: 340px; padding: 8px; background: var(--controls-bg); border: 1px solid var(--accent); border-radius: 6px; box-shadow: var(--card-shadow-drag); }
.link-pick-head { margin: 0 0 6px; font-size: 12px; color: var(--text-secondary); }
.junction-anchor { position: fixed; width: 1px; height: 1px; z-index: 70; }
.ctx .junction-status { display: inline-block; width: auto; margin: 2px 4px; padding: 2px 8px; border: 1px solid var(--border-main); border-radius: 10px; }
.ctx .junction-status.on { background: var(--accent); border-color: var(--accent); color: #fff; }

/* The menu's LOOK is global (App.vue, `.ctx`) — the grid's row menu wears it too.
   Here: where the canvas's sits, and the parts only it has. */
.ctx { position: absolute; z-index: 40; }
.ctx-check { display: flex; gap: 6px; align-items: center; padding: 3px 8px; cursor: pointer; }
/* The field list: its own scroll, so the switch under it and the reset stay in reach. */
.ctx-scroll { max-height: min(40vh, 320px); overflow-y: auto; overscroll-behavior: contain; }
.field-choice { padding: 0; }
.field-choice .field-on { flex: 1; min-width: 0; display: flex; gap: 6px; align-items: center; padding: 3px 8px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-choice .field-pin { flex: none; display: flex; gap: 4px; align-items: center; padding: 3px 8px 3px 4px; cursor: pointer; font-size: 11px; color: var(--text-muted); }
.field-choice .field-pin.on { color: var(--text-primary); }
.field-choice .field-pin.dim { opacity: 0.55; }
.field-choice .field-pin input:disabled { opacity: 0.3; }
.canvas-controls .hide-empty.active { color: var(--accent); }
.canvas-controls .colour.active { color: var(--accent); }
.colour-pop {
  position: absolute; top: calc(100% + 4px); left: 12px; z-index: 60; width: 560px; max-width: calc(100vw - 24px); padding: 8px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px; box-shadow: var(--card-shadow-drag);
  display: flex; flex-direction: column; gap: 8px; font-size: 12px; max-height: calc(100vh - 160px); overflow-y: auto;
}
.colour-tabs { display: flex; gap: 2px; align-items: center; border-bottom: 1px solid var(--border-main); }
.colour-tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.colour-tab:hover { color: var(--text-primary); }
.colour-tab.on { color: var(--text-primary); border-bottom-color: var(--accent); }
.colour-n { margin-left: 5px; font-size: 10px; color: var(--text-faint); }
.colour-tabs .spacer { flex: 1; }
.colour-glow { display: flex; align-items: center; gap: 6px; }
.colour-glow .muted { color: var(--text-muted); font-size: 11px; }
.colour-glow select { background: var(--bg-app); color: inherit; border: 1px solid var(--border-main); border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 4px; }
/* The two link menus: a WAY is a row — its colour, its name, and (right-aligned,
   quieter) what choosing it does. In the new-link menu "find…" sits beside it. */
.ctx { max-height: calc(100% - 8px); overflow-y: auto; }
.way-row { display: flex; align-items: stretch; gap: 2px; }
.ctx .way { flex: 1; min-width: 0; }
.way-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.way-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.way-note { flex: none; color: var(--text-muted); font-size: 11px; margin-left: 12px; }
.ctx .way.made { cursor: default; color: var(--text-muted); }
.ctx .way.made:hover { background: none; }
.ctx .way-find { flex: none; color: var(--text-secondary); font-size: 11px; padding: 3px 8px; margin: 2px 2px 2px 4px; border: 1px solid var(--border-main); }
.ctx .way-find:hover { color: var(--accent); border-color: var(--accent); }
.swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
</style>
