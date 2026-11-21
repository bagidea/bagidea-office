extends Node3D
## 🎨 3D Office Editor — a real in-world editor launched in its OWN window
## (office_floor with --editor3d). The procedural rooms/walls + Ghost Deck are
## LOCKED context; you place / move / rotate / scale DECOR and import .glb
## models (with animation) or images, then save. Saving writes the shared
## layout.json so the live wallpaper renders the same arrangement; "Save as
## preset" keeps it as a reusable custom preset.
##
## Picking is real 3D (a box collider per item + camera raycast) — click the
## object itself to select, drag the floor handle to move. Panels: SCENE
## (everything placed) and LIBRARY (imported models/images, reusable).

const LAYOUT_URL := "http://127.0.0.1:8787/layout"
const PRESETS_URL := "http://127.0.0.1:8787/presets"
const ASSETS_URL := "http://127.0.0.1:8787/assets"

var rig: Node3D
var cam: Camera3D
var _root: Node3D
var items: Array = []             # [{dict, node, body}]
var sel: int = -1
var _hi: MeshInstance3D            # selection highlight ring

# camera: real framing + game-style controls (LMB pan, RMB orbit, wheel zoom)
const BASE_TARGET := Vector3(0.0, 0.3, 0.0)   # centre of the room grid
const BASE_YAW := -12.0
const BASE_PITCH := -45.0
var target := BASE_TARGET
var yaw := BASE_YAW
const YAW_LIMIT := 32.0
var dist := 52.0
const DIST_MIN := 30.0
const DIST_MAX := 64.0
var _orbit := false               # RMB/MMB held → rotate
var _lmb := false                 # LMB held
var _drag_item := false           # LMB drag is moving the selected item
var _panning := false             # LMB drag is panning the camera
var _press_pos := Vector2.ZERO
var _moved := false
var _pan_anchor := Vector3.ZERO   # world point grabbed under the cursor

var _req: HTTPRequest
var _save_req: HTTPRequest
var _preset_req: HTTPRequest
var _assets_req: HTTPRequest
var ui: Control
var custom_presets: Array = []
var library: Array = []           # [{path, kind, name}]
var _decor_cache := {}            # {category: [name…]} bundled Low Poly furniture
var world: Node3D                 # the live grid world (room swapping)
var _swap_pick := -1              # first slot clicked in the room-swap panel
var ui_lang := "en"               # editor UI language (en default, th if set on this machine)
var _ui_layer: CanvasLayer        # so we can rebuild the whole UI on a language switch
var _billboard_path := ""         # user-uploaded billboard image (persisted in layout)

# the office languages (mirrors overlay.html LANGS). The editor UI ships full
# translations for en/th/zh/ja and falls back to English for the rest; the
# overlay auto-translates every language via the daemon's /i18n endpoint.
const LANGS := [["en", "🇬🇧 EN"], ["zh", "🇨🇳 中文"], ["es", "🇪🇸 Español"], ["hi", "🇮🇳 हिन्दी"],
	["ar", "🇸🇦 العربية"], ["pt", "🇧🇷 Português"], ["ru", "🇷🇺 Русский"], ["ja", "🇯🇵 日本語"],
	["de", "🇩🇪 Deutsch"], ["fr", "🇫🇷 Français"], ["ko", "🇰🇷 한국어"], ["id", "🇮🇩 Indonesia"],
	["vi", "🇻🇳 Tiếng Việt"], ["it", "🇮🇹 Italiano"], ["th", "🇹🇭 ไทย"]]

## Pick the localized string. English is the default; th passed inline, zh/ja
## looked up by the English key so existing L(en, th) call sites need no change.
func L(en: String, th: String) -> String:
	match ui_lang:
		"th": return th
		"zh": return _ZH.get(en, en)
		"ja": return _JA.get(en, en)
		"it": return _IT.get(en, en)
		_: return en

const _IT := {
	"All 6 workstations are taken": "Tutte e 6 le postazioni sono occupate",
	"Both beds are taken": "Entrambi i letti sono occupati",
	"Added — drag to position": "Aggiunto — trascinalo dove vuoi",
	"🏷 Billboard": "🏷 Insegna",
	"💾 Save": "💾 Salva",
	"🔀 Room layout (click 2 rooms = swap)": "🔀 Disposizione stanze (clicca 2 stanze = scambia)",
	"👻 Ghost office (move)": "👻 Stanza dei cloni (sposta)",
	"👻 moved ghost office": "👻 Stanza dei cloni spostata",
	"＋ Add object": "＋ Aggiungi oggetto",
	"L-drag=pan · click=select · drag=move · R-drag=rotate · wheel=zoom": "trascina sx=sposta vista · clic=seleziona · trascina=muovi · trascina dx=ruota · rotella=zoom",
	"🔵 System (agents use)": "🔵 Di sistema (usati dagli agenti)",
	"🟢 Decor (free to move)": "🟢 Arredo (si sposta liberamente)",
	"📦 Furniture (Low Poly)": "📦 Mobili (Low Poly)",
	"🗃 LIBRARY — imported models/images": "🗃 LIBRERIA — modelli/immagini importati",
	"🗂 SCENE — placed objects": "🗂 SCENA — oggetti posizionati",
	"📐 Best: 1380×207 px (ratio ~6.7:1, wide banner)": "📐 Ideale: 1380×207 px (rapporto ~6,7:1, striscione largo)",
	"📁 Upload new image…": "📁 Carica una nuova immagine…",
	"(library has no images yet)": "(nessuna immagine nella libreria)",
	"🏷 Billboard set — Save to keep (best ratio ~6.7:1, e.g. 1380×207)": "🏷 Insegna impostata — salva per tenerla (rapporto ideale ~6,7:1, es. 1380×207)",
	"Rotate": "Rotazione",
	"Size": "Dimensione",
	"(none)": "(nessuno)",
	"🗑 Delete this": "🗑 Elimina",
	"Picked first room — click another to swap": "Prima stanza scelta — clicca un'altra per scambiarle",
	"Cancelled": "Annullato",
	"🔀 Rooms swapped — press 💾 Save to keep it": "🔀 Stanze scambiate — premi 💾 Salva per tenerle",
	"(empty — use Import)": "(vuoto — usa Importa)",
	"⭐ Loaded: ": "⭐ Caricato: ",
	"Confirm save": "Conferma salvataggio",
	"Save this office layout, update the wallpaper, and close the editor?": "Salvare questa disposizione, aggiornare l'ufficio e chiudere l'editor?",
	"💾 Save & close": "💾 Salva e chiudi",
	"Cancel": "Annulla",
	"💾 Saved — updating wallpaper, closing…": "💾 Salvato — aggiorno l'ufficio e chiudo…",
	"Save as preset": "Salva come modello",
	"preset name": "nome del modello",
	"⭐ Saved preset: ": "⭐ Modello salvato: ",
	"🖥 Workstation": "🖥 Postazione",
	"⭐ Director desk": "⭐ Scrivania del Director",
	"👑 CEO desk": "👑 Scrivania del CEO",
	"🛏 Bed": "🛏 Letto",
}

const _ZH := {
	"💾 Save": "💾 保存", "🏷 Billboard": "🏷 招牌",
	"🔀 Room layout (click 2 rooms = swap)": "🔀 房间布局（点两个房间=交换）",
	"👻 Ghost office (move)": "👻 幽灵办公室（移动）",
	"＋ Add object": "＋ 添加物件",
	"L-drag=pan · click=select · drag=move · R-drag=rotate · wheel=zoom": "左拖=平移 · 点击=选择 · 拖动=移动 · 右拖=旋转 · 滚轮=缩放",
	"🔵 System (agents use)": "🔵 系统（代理使用）", "🟢 Decor (free to move)": "🟢 装饰（可自由移动）",
	"📦 Furniture (Low Poly)": "📦 家具（低多边形）",
	"🗃 LIBRARY — imported models/images": "🗃 素材库 — 导入的模型/图片",
	"🗂 SCENE — placed objects": "🗂 场景 — 已放置物件",
	"🖥 Workstation": "🖥 工位", "⭐ Director desk": "⭐ 主管桌", "👑 CEO desk": "👑 CEO 桌", "🛏 Bed": "🛏 床",
	"Rotate": "旋转", "Size": "大小", "(none)": "(不播放)", "🗑 Delete this": "🗑 删除此物",
	"(empty — use Import)": "(空 — 点击导入)",
	"Picked first room — click another to swap": "已选第一个房间 — 再点一个进行交换",
	"Cancelled": "已取消", "🔀 Rooms swapped — press 💾 Save to keep it": "🔀 已交换房间 — 按 💾 保存以记住",
	"Added — drag to position": "已添加 — 拖动以摆放",
	"Confirm save": "确认保存", "Save & close": "保存并关闭", "Cancel": "取消",
	"Save this office layout, update the wallpaper, and close the editor?": "保存此办公室布局、更新壁纸并关闭编辑器？",
	"💾 Saved — updating wallpaper, closing…": "💾 已保存 — 正在更新壁纸，即将关闭…",
	"📁 Upload new image…": "📁 上传新图片…", "(library has no images yet)": "(素材库还没有图片)",
	"🏷 Billboard set — Save to keep (best ratio ~6.7:1, e.g. 1380×207)": "🏷 已设置招牌 — 保存以记住（最佳比例约 6.7:1，例如 1380×207）",
	"👻 moved ghost office": "👻 已移动幽灵办公室",
}
const _JA := {
	"💾 Save": "💾 保存", "🏷 Billboard": "🏷 看板",
	"🔀 Room layout (click 2 rooms = swap)": "🔀 部屋レイアウト（2部屋クリックで入替）",
	"👻 Ghost office (move)": "👻 ゴーストオフィス（移動）",
	"＋ Add object": "＋ オブジェクト追加",
	"L-drag=pan · click=select · drag=move · R-drag=rotate · wheel=zoom": "左ドラッグ=移動 · クリック=選択 · ドラッグ=移動 · 右ドラッグ=回転 · ホイール=ズーム",
	"🔵 System (agents use)": "🔵 システム（エージェント用）", "🟢 Decor (free to move)": "🟢 装飾（自由に移動）",
	"📦 Furniture (Low Poly)": "📦 家具（ローポリ）",
	"🗃 LIBRARY — imported models/images": "🗃 ライブラリ — 取込モデル/画像",
	"🗂 SCENE — placed objects": "🗂 シーン — 配置オブジェクト",
	"🖥 Workstation": "🖥 作業デスク", "⭐ Director desk": "⭐ ディレクター席", "👑 CEO desk": "👑 CEO席", "🛏 Bed": "🛏 ベッド",
	"Rotate": "回転", "Size": "サイズ", "(none)": "(再生しない)", "🗑 Delete this": "🗑 これを削除",
	"(empty — use Import)": "(空 — インポート)",
	"Picked first room — click another to swap": "最初の部屋を選択 — もう一つで入替",
	"Cancelled": "キャンセル", "🔀 Rooms swapped — press 💾 Save to keep it": "🔀 部屋を入替 — 💾 保存で確定",
	"Added — drag to position": "追加 — ドラッグで配置",
	"Confirm save": "保存の確認", "Save & close": "保存して閉じる", "Cancel": "キャンセル",
	"Save this office layout, update the wallpaper, and close the editor?": "このレイアウトを保存し、壁紙を更新してエディタを閉じますか？",
	"💾 Saved — updating wallpaper, closing…": "💾 保存しました — 壁紙を更新して閉じます…",
	"📁 Upload new image…": "📁 新しい画像をアップロード…", "(library has no images yet)": "(ライブラリに画像がありません)",
	"🏷 Billboard set — Save to keep (best ratio ~6.7:1, e.g. 1380×207)": "🏷 看板を設定 — 保存で確定（推奨比 約6.7:1 例 1380×207）",
	"👻 moved ghost office": "👻 ゴーストオフィスを移動",
}

## Read the persisted UI language straight off the daemon's registry.json (sync,
## so the UI builds in the right language with no async race).
func _read_lang() -> String:
	var p := ProjectSettings.globalize_path("res://..").path_join("daemon/registry.json")
	if FileAccess.file_exists(p):
		var f := FileAccess.open(p, FileAccess.READ)
		if f:
			var data: Variant = JSON.parse_string(f.get_as_text())
			if data is Dictionary and data.has("lang"):
				return String(data["lang"])
	return "en"

# pretty labels for the room kinds (mirrors grid_world ROOM_DEFS)
const ROOM_LABELS := {
	"exec": "⭐ EXEC", "ops": "🖥 OPS", "server": "🗄 SERVER", "lobby": "🛎 LOBBY",
	"cafe": "☕ CAFE", "meeting": "📋 MEETING", "rec": "🎮 REC", "dormx": "🛏 DORM XL", "dorm": "🛏 DORM",
}

const TYPES := [
	["desk", "🪑 Desk"], ["table", "🍽 Table"], ["chair", "💺 Chair"],
	["shelf", "📚 Shelf"], ["plant", "🪴 Plant"], ["lamp", "💡 Lamp"],
	["rug", "🟫 Rug"], ["sofa", "🛋 Sofa"], ["tv", "📺 TV"],
	["whiteboard", "📋 Board"], ["cabinet", "🗄 Cabinet"], ["cooler", "🚰 Cooler"],
]

# system objects bind to an agent anchor. workstation cycles desk1..desk6.
const SYS_TYPES := [
	["workstation", "🖥 โต๊ะทำงาน", "🖥 Workstation"], ["director", "⭐ โต๊ะ Director", "⭐ Director desk"],
	["ceo", "👑 โต๊ะ CEO", "👑 CEO desk"], ["bed", "🛏 เตียง", "🛏 Bed"],
]
const WORK_ANCHORS := ["desk1", "desk2", "desk3", "desk4", "desk5", "desk6"]
const BED_ANCHORS := ["bed1", "bed2"]

# default floor footprint (largest x/z dim, metres) per furniture category, so a
# fresh drop looks right before the user tweaks scale.
const FIT_BY_CAT := {
	"Beds": 2.0, "Sofas": 1.8, "Tables": 1.2, "Carpets": 2.2, "Shelves": 1.0,
	"Chairs": 0.6, "Drawers": 0.9, "Doors": 1.0, "Windows": 1.2, "Lights": 0.5,
	"Kitchen": 0.9, "Bathroom": 0.9, "Electronics": 0.6, "Miscellaneous": 0.6,
	"Restaurant": 0.85,  # KayKit Restaurant Bits (chairs/tables/props/food)
}

const PRESETS := [
	{ "name": "Classic grid", "items": [
		{ "type": "desk", "x": -7, "z": -7 }, { "type": "chair", "x": -7, "z": -6, "rot": 180 },
		{ "type": "desk", "x": -4, "z": -7 }, { "type": "chair", "x": -4, "z": -6, "rot": 180 },
		{ "type": "desk", "x": -7, "z": -3 }, { "type": "chair", "x": -7, "z": -2, "rot": 180 },
		{ "type": "desk", "x": -4, "z": -3 }, { "type": "chair", "x": -4, "z": -2, "rot": 180 },
		{ "type": "plant", "x": -9.5, "z": -8.5 }, { "type": "cooler", "x": -1.5, "z": -8 } ] },
	{ "name": "Open plan", "items": [
		{ "type": "table", "x": -5, "z": -5, "scale": 1.4 }, { "type": "chair", "x": -6, "z": -5, "rot": 90 },
		{ "type": "chair", "x": -4, "z": -5, "rot": 270 }, { "type": "rug", "x": -5, "z": -5, "scale": 1.6, "color": "33405a" },
		{ "type": "whiteboard", "x": -8.5, "z": -7 }, { "type": "plant", "x": -8, "z": -2 } ] },
	{ "name": "Cozy lounge", "items": [
		{ "type": "rug", "x": 2, "z": 4, "scale": 1.8, "color": "7a3b4b" }, { "type": "sofa", "x": 2, "z": 5 },
		{ "type": "table", "x": 2, "z": 4, "scale": 0.8 }, { "type": "tv", "x": 2, "z": 2, "rot": 180 },
		{ "type": "plant", "x": -0.5, "z": 2.5 }, { "type": "lamp", "x": 4.5, "z": 5, "color": "ffcf9a" } ] },
	{ "name": "Focus pods", "items": [
		{ "type": "desk", "x": 8, "z": -7 }, { "type": "chair", "x": 8, "z": -6, "rot": 180 }, { "type": "shelf", "x": 9.4, "z": -7, "rot": 90 },
		{ "type": "desk", "x": 8, "z": -3 }, { "type": "chair", "x": 8, "z": -2, "rot": 180 }, { "type": "cabinet", "x": 9.4, "z": -3, "rot": 90 },
		{ "type": "lamp", "x": 10, "z": -5, "color": "cfe0ff" } ] },
	{ "name": "Minimal green", "items": [
		{ "type": "desk", "x": 0, "z": 0 }, { "type": "chair", "x": 0, "z": 1, "rot": 180 },
		{ "type": "plant", "x": -2, "z": -1 }, { "type": "plant", "x": 2, "z": -1 },
		{ "type": "plant", "x": -2, "z": 2 }, { "type": "rug", "x": 0, "z": 0.5, "scale": 1.3, "color": "2f5a3a" } ] },
]

func setup(camera_rig: Node3D, camera: Camera3D) -> void:
	rig = camera_rig
	cam = camera

func _ready() -> void:
	ui_lang = _read_lang()
	world = get_node_or_null("/root/OfficeFloor/World")
	if world == null:
		world = get_tree().get_root().find_child("World", true, false)
	_root = Node3D.new(); _root.name = "EditorLayout"; add_child(_root)
	_req = HTTPRequest.new(); add_child(_req); _req.request_completed.connect(_on_layout)
	_save_req = HTTPRequest.new(); add_child(_save_req)
	_preset_req = HTTPRequest.new(); add_child(_preset_req); _preset_req.request_completed.connect(_on_preset)
	_assets_req = HTTPRequest.new(); add_child(_assets_req); _assets_req.request_completed.connect(_on_assets)
	_make_highlight()
	_build_ui()
	_refresh_rooms()
	_update_cam()
	_req.request(LAYOUT_URL)
	_preset_req.request(PRESETS_URL)
	_assets_req.request(ASSETS_URL)

# ---------------------------------------------------------------- camera
func _update_cam() -> void:
	if rig == null or cam == null:
		return
	rig.position = target
	rig.rotation_degrees = Vector3(BASE_PITCH, yaw, 0.0)
	cam.position = Vector3(0.0, 0.0, dist)

# True while the cursor is over an editor panel — gate camera input so
# scrolling a menu doesn't also zoom the world (and pans don't start on UI).
func _over_ui() -> bool:
	return get_viewport().gui_get_hovered_control() != null

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP:
			if _over_ui(): return
			dist = clampf(dist - 2.5, DIST_MIN, DIST_MAX); _update_cam()
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if _over_ui(): return
			dist = clampf(dist + 2.5, DIST_MIN, DIST_MAX); _update_cam()
		elif e.button_index == MOUSE_BUTTON_RIGHT or e.button_index == MOUSE_BUTTON_MIDDLE:
			_orbit = e.pressed and not _over_ui()
		elif e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				if _over_ui(): return
				_lmb = true; _moved = false; _press_pos = e.position
				_begin_left(e.position)
			else:
				# a click with no drag on empty space → unselect
				if _lmb and not _moved and not _drag_item:
					sel = -1; _place_highlight(); _refresh_sel()
				_lmb = false; _drag_item = false; _panning = false
	elif e is InputEventMouseMotion:
		if _orbit:
			yaw = clampf(yaw - e.relative.x * 0.08, BASE_YAW - YAW_LIMIT, BASE_YAW + YAW_LIMIT)
			_update_cam()
		elif _lmb:
			if e.relative.length() > 0.5: _moved = true
			if _drag_item and sel >= 0:
				var hit := _floor_hit(e.position)
				if hit != Vector3.INF:
					items[sel]["dict"]["x"] = snappedf(hit.x, 0.1)
					items[sel]["dict"]["z"] = snappedf(hit.z, 0.1)
					items[sel]["node"].position.x = items[sel]["dict"]["x"]
					items[sel]["node"].position.z = items[sel]["dict"]["z"]
					_place_highlight()
			elif _panning:
				# grab-pan: keep the world point you grabbed under the cursor —
				# rock solid at any yaw/zoom (no swing).
				var cur := _floor_hit(e.position)
				if cur != Vector3.INF and _pan_anchor != Vector3.INF:
					target += _pan_anchor - cur
					target.x = clampf(target.x, -14.0, 20.0)
					target.z = clampf(target.z, -14.0, 18.0)
					_update_cam()

# LMB pressed on the world: grab the clicked item (→ drag-move) or, on empty,
# start a camera pan. Selection of a different item happens here too.
func _begin_left(screen: Vector2) -> void:
	var space := get_world_3d().direct_space_state
	var o := cam.project_ray_origin(screen)
	var d := cam.project_ray_normal(screen)
	var q := PhysicsRayQueryParameters3D.create(o, o + d * 500.0)
	q.collide_with_areas = true
	q.collide_with_bodies = true
	var r := space.intersect_ray(q)
	if r and r.has("collider"):
		var node: Node = r["collider"]
		while node and not node.has_meta("item_rig"):
			node = node.get_parent()
		if node:
			for i in items.size():
				if items[i]["node"] == node:
					sel = i; _drag_item = true; _place_highlight(); _refresh_sel(); _refresh_scene(); return
	# empty space → pan the camera (and unselect on a clean click)
	_panning = true
	_pan_anchor = _floor_hit(screen)

func _floor_hit(screen: Vector2) -> Vector3:
	if cam == null: return Vector3.INF
	var o := cam.project_ray_origin(screen)
	var d := cam.project_ray_normal(screen)
	if absf(d.y) < 0.0001: return Vector3.INF
	var tt := -o.y / d.y
	if tt < 0: return Vector3.INF
	return o + d * tt

# Add an item from the palette / library: it appears at the camera focus,
# gets selected, ready to drag into place. (Placement is via buttons now —
# clicking empty space only unselects.)
# add a system object bound to the next free anchor for its kind
func _add_system(base: String) -> void:
	var used := {}
	for e in items:
		if e["dict"].has("anchor"): used[e["dict"]["anchor"]] = true
	var anchor := ""
	var vis := "desk"
	match base:
		"workstation":
			for a in WORK_ANCHORS:
				if not used.has(a): anchor = a; break
			if anchor == "": _flash(L("All 6 workstations are taken", "ครบ 6 โต๊ะทำงานแล้ว")); return
		"director": anchor = "lead_desk"
		"ceo": anchor = "ceo_desk"
		"bed":
			vis = "bed"
			for a in BED_ANCHORS:
				if not used.has(a): anchor = a; break
			if anchor == "": _flash(L("Both beds are taken", "ครบ 2 เตียงแล้ว")); return
	if used.has(anchor): _flash(L(anchor + " already exists", "มี " + anchor + " แล้ว")); return
	var it := { "type": vis, "system": true, "anchor": anchor,
		"x": snappedf(target.x, 0.1), "z": snappedf(target.z, 0.1), "rot": 0.0, "scale": 1.0 }
	_add_item(it); sel = items.size() - 1
	_place_highlight(); _refresh_sel(); _refresh_scene()
	_flash(L("Added system object (" + anchor + ") — drag to place; agents work there",
		"เพิ่มของระบบ (" + anchor + ") — ลากไปวาง agents จะทำงานที่นั่น"))

func _add_at_focus(type: String, asset := "", fit := 0.0) -> void:
	var it := { "type": type, "x": snappedf(target.x, 0.1), "z": snappedf(target.z, 0.1), "rot": 0.0, "scale": 1.0 }
	if asset != "": it["asset"] = asset
	if fit > 0.0: it["fit"] = fit
	_add_item(it); sel = items.size() - 1
	_place_highlight(); _refresh_sel(); _refresh_scene()
	_flash(L("Added — drag to position", "เพิ่มแล้ว — ลากเพื่อจัดวาง"))

# ---------------------------------------------------------------- highlight
func _make_highlight() -> void:
	# a bright disc + ring on the floor + a soft pillar of light so the
	# selected object is unmistakable from any angle.
	_hi = MeshInstance3D.new()
	var tm := TorusMesh.new(); tm.inner_radius = 0.5; tm.outer_radius = 0.66
	_hi.mesh = tm
	var m := StandardMaterial3D.new(); m.albedo_color = Color(0.45, 0.9, 1.0)
	m.emission_enabled = true; m.emission = Color(0.45, 0.9, 1.0); m.emission_energy_multiplier = 4.0
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA; m.albedo_color.a = 0.9
	_hi.material_override = m
	_hi.visible = false
	add_child(_hi)
	# pillar
	var pil := MeshInstance3D.new()
	var cm := CylinderMesh.new(); cm.top_radius = 0.42; cm.bottom_radius = 0.42; cm.height = 2.4
	pil.mesh = cm; pil.position.y = 1.2; pil.name = "Pillar"
	var pm := StandardMaterial3D.new(); pm.albedo_color = Color(0.45, 0.9, 1.0, 0.08)
	pm.emission_enabled = true; pm.emission = Color(0.45, 0.9, 1.0); pm.emission_energy_multiplier = 1.0
	pm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA; pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	pm.cull_mode = BaseMaterial3D.CULL_DISABLED
	pil.material_override = pm
	_hi.add_child(pil)

func _process(_dt: float) -> void:
	if _hi and _hi.visible:
		_hi.rotation_degrees.y += _dt * 40.0   # gentle spin so it reads as "selected"

func _place_highlight() -> void:
	if sel < 0 or sel >= items.size():
		_hi.visible = false; return
	var it: Dictionary = items[sel]["dict"]
	_hi.visible = true
	_hi.position = Vector3(float(it.get("x", 0)), 0.06, float(it.get("z", 0)))
	var s := float(it.get("scale", 1.0))
	_hi.scale = Vector3(s, s, s)

# ---------------------------------------------------------------- items
func _on_layout(_r: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	if code != 200: return
	var data: Variant = JSON.parse_string(body.get_string_from_utf8())
	if data is Dictionary and data.get("items") is Array:
		for it in data["items"]:
			if it is Dictionary: _add_item(it.duplicate(true))
	# restore a saved room arrangement, then refresh the swap panel
	if data is Dictionary and data.get("rooms") is Array and world and world.has_method("apply_room_order"):
		world.apply_room_order(data["rooms"])
	if data is Dictionary and data.get("ghost") is Array and (data["ghost"] as Array).size() == 2 and world and world.has_method("set_ghost_deck_pos"):
		world.set_ghost_deck_pos(float(data["ghost"][0]), float(data["ghost"][1]))
	if data is Dictionary and data.get("billboard") is String and String(data["billboard"]) != "":
		_billboard_path = String(data["billboard"])
		if world and world.has_method("set_billboard_texture"): world.set_billboard_texture(_billboard_path)
	_refresh_scene()
	_refresh_rooms()

func _add_item(it: Dictionary) -> void:
	var node := _spawn(it)
	_root.add_child(node)
	items.append({ "dict": it, "node": node })

func _mat(hex: String, rough := 0.8) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(hex) if hex != "" else Color(0.7, 0.72, 0.78)
	m.roughness = rough
	return m

func _box(w: float, h: float, d: float, mat: StandardMaterial3D) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(w, h, d)
	mi.mesh = bm; mi.material_override = mat
	return mi

func _spawn(it: Dictionary) -> Node3D:
	var rig2 := Node3D.new()
	rig2.set_meta("item_rig", true)
	rig2.position = Vector3(float(it.get("x", 0)), float(it.get("y", 0)), float(it.get("z", 0)))
	rig2.rotation_degrees = Vector3(0, float(it.get("rot", 0)), 0)
	var s := float(it.get("scale", 1.0)); rig2.scale = Vector3(s, s, s)
	var col := String(it.get("color", ""))
	var foot := Vector3(1.0, 1.0, 1.0)   # collider footprint
	match String(it.get("type", "desk")):
		"desk":
			var top := _box(1.4, 0.08, 0.8, _mat(col if col != "" else "3a2e25", 0.5)); top.position.y = 0.74; rig2.add_child(top)
			for sx in [-0.6, 0.6]:
				for sz in [-0.32, 0.32]:
					var leg := _box(0.08, 0.74, 0.08, _mat("222831")); leg.position = Vector3(sx, 0.37, sz); rig2.add_child(leg)
			foot = Vector3(1.4, 0.9, 0.8)
		"table":
			var t := _box(1.1, 0.08, 1.1, _mat(col if col != "" else "4a3b2c", 0.5)); t.position.y = 0.7; rig2.add_child(t)
			var post := _box(0.12, 0.7, 0.12, _mat("2a2a2a")); post.position.y = 0.35; rig2.add_child(post); foot = Vector3(1.1, 0.8, 1.1)
		"chair":
			var seat := _box(0.45, 0.07, 0.45, _mat(col if col != "" else "5a6b8c", 0.6)); seat.position.y = 0.45; rig2.add_child(seat)
			var back := _box(0.45, 0.5, 0.07, _mat(col if col != "" else "5a6b8c", 0.6)); back.position = Vector3(0, 0.7, -0.19); rig2.add_child(back); foot = Vector3(0.5, 1.0, 0.5)
		"shelf":
			var bd := _box(0.9, 1.6, 0.32, _mat(col if col != "" else "4a3a2a", 0.7)); bd.position.y = 0.8; rig2.add_child(bd); foot = Vector3(0.9, 1.6, 0.4)
		"plant":
			var pot := _box(0.3, 0.3, 0.3, _mat("8a5a3a")); pot.position.y = 0.15; rig2.add_child(pot)
			var lv := MeshInstance3D.new(); var sm := SphereMesh.new(); sm.radius = 0.32; sm.height = 0.7
			lv.mesh = sm; lv.material_override = _mat(col if col != "" else "3c7a3c", 0.9); lv.position.y = 0.6; rig2.add_child(lv); foot = Vector3(0.5, 1.0, 0.5)
		"lamp":
			var st := _box(0.06, 1.3, 0.06, _mat("333")); st.position.y = 0.65; rig2.add_child(st)
			var light := OmniLight3D.new(); light.position.y = 1.35; light.light_energy = 2.0; light.omni_range = 5.0
			light.light_color = Color(col) if col != "" else Color(1, 0.9, 0.7); rig2.add_child(light); foot = Vector3(0.4, 1.4, 0.4)
		"rug":
			var rg := _box(2.0, 0.02, 1.5, _mat(col if col != "" else "7a3b4b", 0.95)); rg.position.y = 0.02; rig2.add_child(rg); foot = Vector3(2.0, 0.2, 1.5)
		"sofa":
			var base := _box(1.6, 0.4, 0.7, _mat(col if col != "" else "44506b", 0.7)); base.position.y = 0.25; rig2.add_child(base)
			var bk := _box(1.6, 0.5, 0.18, _mat(col if col != "" else "44506b", 0.7)); bk.position = Vector3(0, 0.6, -0.26); rig2.add_child(bk); foot = Vector3(1.6, 0.9, 0.8)
		"tv":
			var screen := _box(1.5, 0.85, 0.08, _mat("0a0a0c", 0.3)); screen.position.y = 1.1; rig2.add_child(screen)
			var stnd := _box(0.1, 1.0, 0.1, _mat("222")); stnd.position.y = 0.5; rig2.add_child(stnd); foot = Vector3(1.5, 1.6, 0.4)
		"whiteboard":
			var wb := _box(1.6, 1.0, 0.06, _mat("f0f2f5", 0.4)); wb.position.y = 1.2; rig2.add_child(wb)
			var fr := _box(0.06, 1.2, 0.06, _mat("888")); fr.position = Vector3(-0.8, 0.6, 0); rig2.add_child(fr)
			var fr2 := _box(0.06, 1.2, 0.06, _mat("888")); fr2.position = Vector3(0.8, 0.6, 0); rig2.add_child(fr2); foot = Vector3(1.6, 1.8, 0.3)
		"cabinet":
			var cb := _box(0.9, 1.1, 0.5, _mat(col if col != "" else "6b7280", 0.6)); cb.position.y = 0.55; rig2.add_child(cb); foot = Vector3(0.9, 1.1, 0.5)
		"cooler":
			var bdy := _box(0.4, 1.1, 0.4, _mat("dfe7ef", 0.4)); bdy.position.y = 0.55; rig2.add_child(bdy)
			var jug := _box(0.32, 0.4, 0.32, _mat("7ec8ff", 0.2)); jug.position.y = 1.25; rig2.add_child(jug); foot = Vector3(0.45, 1.5, 0.45)
		"bed":
			var mat := _box(2.0, 0.3, 1.0, _mat(col if col != "" else "5566aa", 0.7)); mat.position.y = 0.25; rig2.add_child(mat)
			var pil := _box(0.5, 0.18, 0.9, _mat("eef2f7", 0.6)); pil.position = Vector3(-0.7, 0.45, 0); rig2.add_child(pil); foot = Vector3(2.0, 0.6, 1.0)
		"poster":
			_spawn_poster(rig2, String(it.get("asset", ""))); foot = Vector3(1.3, 0.9, 0.2)
		"model":
			_spawn_model(rig2, it); foot = Vector3(1.4, 1.4, 1.4)
		_:
			var dd := _box(0.6, 0.6, 0.6, _mat(col)); dd.position.y = 0.3; rig2.add_child(dd)
	# pick collider (invisible) sized to the item
	var sb := StaticBody3D.new(); sb.collision_layer = 1; sb.collision_mask = 0
	var cs := CollisionShape3D.new(); var bs := BoxShape3D.new(); bs.size = foot
	cs.shape = bs; cs.position.y = foot.y * 0.5
	sb.add_child(cs); rig2.add_child(sb)
	return rig2

func _spawn_poster(rig2: Node3D, asset: String) -> void:
	if asset == "": return
	var img := Image.new()
	if img.load(asset) != OK: return
	var mi := MeshInstance3D.new(); var qm := QuadMesh.new(); qm.size = Vector2(1.2, 0.8); mi.mesh = qm
	var m := StandardMaterial3D.new(); m.albedo_texture = ImageTexture.create_from_image(img)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; m.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = m; mi.position.y = 1.4; rig2.add_child(mi)

func _spawn_model(rig2: Node3D, it: Dictionary) -> void:
	var asset := String(it.get("asset", ""))
	if asset == "": return
	var path := asset
	if path.begins_with("res://"): path = ProjectSettings.globalize_path(path)
	var ext := path.get_extension().to_lower()
	var scene: Node = null
	if ext == "glb" or ext == "gltf":
		var doc := GLTFDocument.new(); var stt := GLTFState.new()
		if doc.append_from_file(path, stt) == OK: scene = doc.generate_scene(stt)
	elif ext == "fbx":
		var doc := FBXDocument.new(); var stt := FBXState.new()
		if doc.append_from_file(path, stt) == OK: scene = doc.generate_scene(stt)
	if scene and scene is Node3D:
		rig2.add_child(scene)
		# imported models come in every conceivable unit/origin — normalise to a
		# sane footprint and drop the base onto the floor so it never floats.
		_fit_model(scene as Node3D, float(it.get("fit", 1.1)))
		var ap := scene.find_child("AnimationPlayer", true, false)
		if ap and ap is AnimationPlayer:
			var names: Array = (ap as AnimationPlayer).get_animation_list()
			it["anims"] = names                    # remember clips for the picker
			# default: play the first clip on a fresh import; honour a chosen one.
			var chosen := String(it.get("anim", names[0] if names.size() > 0 else ""))
			if not it.has("anim"): it["anim"] = chosen
			if chosen != "" and chosen in names:
				(ap as AnimationPlayer).play(chosen)

## Scale an imported model so its largest floor dimension ≈ target metres and
## its base rests on y=0. Works for any source unit/origin (glb OR fbx), so the
## same code fits a user .glb import and the Low Poly furniture pack.
func _fit_model(scene: Node3D, target: float) -> void:
	var aabb := _node_aabb(scene, Transform3D.IDENTITY)
	if aabb.size == Vector3.ZERO: return
	var span: float = max(aabb.size.x, aabb.size.z)
	if span <= 0.0001: span = max(aabb.size.y, 0.0001)
	var f: float = target / span
	scene.scale = Vector3(f, f, f)
	scene.position.y = -aabb.position.y * f   # bottom of the mesh → floor

## Combined mesh AABB of a node tree, expressed in `scene`-local space.
func _node_aabb(n: Node, xform: Transform3D) -> AABB:
	var acc := AABB(); var has := false
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		acc = xform * (n as MeshInstance3D).mesh.get_aabb(); has = true
	for c in n.get_children():
		var cx := xform
		if c is Node3D: cx = xform * (c as Node3D).transform
		var sub := _node_aabb(c, cx)
		if sub.size != Vector3.ZERO:
			if has: acc = acc.merge(sub)
			else: acc = sub; has = true
	return acc

## One-time scan of the bundled Low Poly furniture pack → {category: [name…]}.
func _scan_decor() -> Dictionary:
	if not _decor_cache.is_empty(): return _decor_cache
	var root := "res://assets/decor/"
	var d := DirAccess.open(root)
	if d == null: return _decor_cache
	for cat in d.get_directories():
		var sub := DirAccess.open(root + cat)
		if sub == null: continue
		var names: Array = []
		for f in sub.get_files():
			var lf := f.to_lower()
			# keep the FULL filename (with extension) — _fill_decor builds the path
			# from it, so .gltf / .glb packs work alongside the .fbx furniture.
			if lf.ends_with(".fbx") or lf.ends_with(".gltf") or lf.ends_with(".glb"):
				names.append(f)
		if not names.is_empty():
			names.sort()
			_decor_cache[cat] = names
	return _decor_cache

# ---------------------------------------------------------------- UI
# A brand-dark theme so the editor doesn't look like raw Godot greybox.
func _build_theme() -> Theme:
	var th := Theme.new()
	var accent := Color(0.37, 0.78, 1.0)
	var ink := Color(0.88, 0.93, 1.0)
	# panels: dark glass, rounded
	var panel := StyleBoxFlat.new()
	panel.bg_color = Color(0.04, 0.07, 0.12, 0.94)
	panel.set_corner_radius_all(14)
	panel.set_border_width_all(1); panel.border_color = Color(1, 1, 1, 0.10)
	panel.set_content_margin_all(12)
	panel.shadow_color = Color(0, 0, 0, 0.5); panel.shadow_size = 16
	th.set_stylebox("panel", "PanelContainer", panel)
	# buttons
	var mk := func(bg: Color, bord: Color) -> StyleBoxFlat:
		var s := StyleBoxFlat.new(); s.bg_color = bg; s.set_corner_radius_all(9)
		s.set_border_width_all(1); s.border_color = bord
		s.content_margin_top = 7; s.content_margin_bottom = 7
		s.content_margin_left = 11; s.content_margin_right = 11
		return s
	th.set_stylebox("normal", "Button", mk.call(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.10)))
	th.set_stylebox("hover", "Button", mk.call(Color(0.37, 0.78, 1.0, 0.16), accent))
	th.set_stylebox("pressed", "Button", mk.call(Color(0.37, 0.78, 1.0, 0.28), accent))
	th.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	th.set_color("font_color", "Button", ink)
	th.set_color("font_hover_color", "Button", Color(1, 1, 1))
	th.set_font_size("font_size", "Button", 13)
	th.set_color("font_color", "Label", ink)
	# option button mirrors Button
	th.set_stylebox("normal", "OptionButton", mk.call(Color(1, 1, 1, 0.05), accent))
	th.set_stylebox("hover", "OptionButton", mk.call(Color(0.37, 0.78, 1.0, 0.16), accent))
	th.set_stylebox("pressed", "OptionButton", mk.call(Color(0.37, 0.78, 1.0, 0.2), accent))
	th.set_color("font_color", "OptionButton", ink)
	# sliders
	var track := StyleBoxFlat.new(); track.bg_color = Color(1, 1, 1, 0.08); track.set_corner_radius_all(4); track.content_margin_top = 3; track.content_margin_bottom = 3
	var fill := StyleBoxFlat.new(); fill.bg_color = accent; fill.set_corner_radius_all(4); fill.content_margin_top = 3; fill.content_margin_bottom = 3
	th.set_stylebox("slider", "HSlider", track)
	th.set_stylebox("grabber_area", "HSlider", fill)
	th.set_stylebox("grabber_area_highlight", "HSlider", fill)
	# scroll + line edit
	var le := StyleBoxFlat.new(); le.bg_color = Color(0, 0, 0, 0.3); le.set_corner_radius_all(8); le.set_content_margin_all(8); le.set_border_width_all(1); le.border_color = Color(1, 1, 1, 0.12)
	th.set_stylebox("normal", "LineEdit", le)
	th.set_color("font_color", "LineEdit", ink)
	return th

func _build_ui() -> void:
	ui = Control.new(); ui.set_anchors_preset(Control.PRESET_FULL_RECT); ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.theme = _build_theme()
	_ui_layer = CanvasLayer.new(); _ui_layer.add_child(ui); add_child(_ui_layer)

	var M := 16.0      # screen-edge margin
	var COLW := 224.0  # side-column width

	# ── TOP TOOLBAR — layout / file actions, separate from the object palette
	var bar := PanelContainer.new(); bar.position = Vector2(M, M)
	var bh := HBoxContainer.new(); bh.add_theme_constant_override("separation", 8); bar.add_child(bh)
	var bt := Label.new(); bt.text = "🎨 EDITOR"; bh.add_child(bt)
	bh.add_child(VSeparator.new())
	var imp := Button.new(); imp.text = "📦 .glb"; imp.pressed.connect(_import_model); bh.add_child(imp)
	var pst := Button.new(); pst.text = "🖼 image"; pst.pressed.connect(_import_image); bh.add_child(pst)
	var bbtn := Button.new(); bbtn.text = L("🏷 Billboard", "🏷 ป้าย"); bbtn.pressed.connect(_import_billboard); bh.add_child(bbtn)
	var save := Button.new(); save.text = L("💾 Save", "💾 บันทึก"); save.pressed.connect(_save); bh.add_child(save)
	bh.add_child(VSeparator.new())
	var lng := OptionButton.new(); lng.name = "LangPick"
	for i in LANGS.size():
		lng.add_item("🌐 " + String(LANGS[i][1]))
		if LANGS[i][0] == ui_lang: lng.select(i)
	lng.item_selected.connect(_on_lang_picked); bh.add_child(lng)
	ui.add_child(bar)

	# ── LEFT COLUMN — fills the left edge top-to-bottom: palette (scrolls) on
	# top, LIBRARY pinned at the bottom. One stretching container = never
	# overlaps or clips regardless of window size.
	var left := PanelContainer.new()
	left.anchor_left = 0.0; left.anchor_right = 0.0; left.anchor_top = 0.0; left.anchor_bottom = 1.0
	left.offset_left = M; left.offset_right = M + COLW; left.offset_top = 88.0; left.offset_bottom = -M
	var lcol := VBoxContainer.new(); lcol.add_theme_constant_override("separation", 6); left.add_child(lcol)
	# 🔀 ROOM SWAP — the jigsaw: click two rooms to trade their whole cells
	var rlab := Label.new(); rlab.text = L("🔀 Room layout (click 2 rooms = swap)", "🔀 จัดผังห้อง (คลิก 2 ห้อง = สลับ)"); rlab.add_theme_font_size_override("font_size", 10); lcol.add_child(rlab)
	var rgrid := GridContainer.new(); rgrid.name = "RoomGrid"; rgrid.columns = 3
	rgrid.add_theme_constant_override("h_separation", 3); rgrid.add_theme_constant_override("v_separation", 3)
	lcol.add_child(rgrid)
	# 👻 move the floating ghost (sub-ops) office
	var glab := Label.new(); glab.text = L("👻 Ghost office (move)", "👻 ห้องผี (ย้าย)"); glab.add_theme_font_size_override("font_size", 10); lcol.add_child(glab)
	var grow := HBoxContainer.new(); grow.add_theme_constant_override("separation", 3); lcol.add_child(grow)
	var step := 1.0
	for d in [["◀", -step, 0.0], ["▶", step, 0.0], ["▲", 0.0, -step], ["▼", 0.0, step]]:
		var gb := Button.new(); gb.text = String(d[0]); gb.custom_minimum_size = Vector2(40, 26)
		var dx: float = d[1]; var dz: float = d[2]
		gb.pressed.connect(func():
			if world and world.has_method("move_ghost_deck"):
				world.move_ghost_deck(dx, dz); _flash(L("👻 moved ghost office", "👻 ย้ายห้องผีแล้ว")))
		grow.add_child(gb)
	lcol.add_child(HSeparator.new())
	var title := Label.new(); title.text = L("＋ Add object", "＋ เพิ่มวัตถุ"); lcol.add_child(title)
	var hint := Label.new(); hint.text = L("L-drag=pan · click=select · drag=move · R-drag=rotate · wheel=zoom", "ลากซ้าย=เลื่อนกล้อง · คลิกวัตถุ=เลือก · ลาก=ย้าย · คลิกขวา=หมุน · ล้อ=ซูม")
	hint.add_theme_font_size_override("font_size", 9); hint.autowrap_mode = TextServer.AUTOWRAP_WORD; lcol.add_child(hint)
	# palette scroll grows to fill the space above the library
	var sc := ScrollContainer.new(); sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED; lcol.add_child(sc)
	var vb := VBoxContainer.new(); vb.add_theme_constant_override("separation", 4)
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL; sc.add_child(vb)
	# 🔵 system objects — bound to an agent anchor; moving one makes agents work there
	var syslab := Label.new(); syslab.text = L("🔵 System (agents use)", "🔵 ของระบบ (agents ใช้)"); syslab.add_theme_font_size_override("font_size", 10); vb.add_child(syslab)
	for s in SYS_TYPES:
		var b := Button.new(); b.text = "＋ " + L(s[2], s[1]); b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var base: String = s[0]
		b.pressed.connect(func(): _add_system(base))
		vb.add_child(b)
	var catlab := Label.new(); catlab.text = L("🟢 Decor (free to move)", "🟢 ของตกแต่ง (ขยับได้อิสระ)"); catlab.add_theme_font_size_override("font_size", 10); vb.add_child(catlab)
	for t in TYPES:
		var b := Button.new(); b.text = "＋ " + t[1]; b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var ty: String = t[0]
		b.pressed.connect(func(): _add_at_focus(ty))
		vb.add_child(b)
	# 📦 bundled Low Poly furniture — real models, auto-fitted to the floor
	var decor := _scan_decor()
	if not decor.is_empty():
		var flab := Label.new(); flab.text = L("📦 Furniture (Low Poly)", "📦 เฟอร์นิเจอร์ (Low Poly)"); flab.add_theme_font_size_override("font_size", 10); vb.add_child(flab)
		var cats: Array = decor.keys(); cats.sort()
		var cpick := OptionButton.new(); cpick.name = "DecorCat"
		for c in cats: cpick.add_item(String(c))
		cpick.item_selected.connect(func(i): _fill_decor(String(cats[i])))
		vb.add_child(cpick)
		var flist := VBoxContainer.new(); flist.name = "DecorList"; flist.add_theme_constant_override("separation", 2); vb.add_child(flist)
		_fill_decor(String(cats[0]))
	# LIBRARY pinned to the bottom of the left column
	lcol.add_child(HSeparator.new())
	var ll := Label.new(); ll.text = L("🗃 LIBRARY — imported models/images", "🗃 LIBRARY — โมเดล/รูปที่ import"); ll.add_theme_font_size_override("font_size", 11); lcol.add_child(ll)
	var lsc := ScrollContainer.new(); lsc.custom_minimum_size = Vector2(0, 132)
	lsc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED; lcol.add_child(lsc)
	var llist := VBoxContainer.new(); llist.name = "LibList"; llist.size_flags_horizontal = Control.SIZE_EXPAND_FILL; lsc.add_child(llist)
	ui.add_child(left)

	# ── RIGHT COLUMN — fills the right edge top-to-bottom: selected-item props
	# (toggled) on top, SCENE list (scrolls) filling the rest.
	var right := PanelContainer.new()
	right.anchor_left = 1.0; right.anchor_right = 1.0; right.anchor_top = 0.0; right.anchor_bottom = 1.0
	right.offset_left = -(M + COLW); right.offset_right = -M; right.offset_top = M; right.offset_bottom = -M
	var rcol := VBoxContainer.new(); rcol.add_theme_constant_override("separation", 6); right.add_child(rcol)
	var selWrap := VBoxContainer.new(); selWrap.name = "SelPanel"; selWrap.add_theme_constant_override("separation", 5)
	var sv := VBoxContainer.new(); sv.name = "SelBox"; sv.add_theme_constant_override("separation", 5); selWrap.add_child(sv)
	rcol.add_child(selWrap); selWrap.visible = false
	rcol.add_child(HSeparator.new())
	var scl := Label.new(); scl.text = L("🗂 SCENE — placed objects", "🗂 SCENE — วัตถุที่วาง"); rcol.add_child(scl)
	var ssc := ScrollContainer.new(); ssc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ssc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED; rcol.add_child(ssc)
	var slist := VBoxContainer.new(); slist.name = "SceneList"; slist.size_flags_horizontal = Control.SIZE_EXPAND_FILL; ssc.add_child(slist)
	ui.add_child(right)

	var toast := Label.new(); toast.name = "Toast"; toast.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	toast.position = Vector2(-120, -48); ui.add_child(toast)

func _on_lang_picked(idx: int) -> void:
	if idx < 0 or idx >= LANGS.size(): return
	ui_lang = String(LANGS[idx][0])
	var req := HTTPRequest.new(); add_child(req)
	req.request_completed.connect(func(_a, _b, _c, _d): req.queue_free())
	req.request("http://127.0.0.1:8787/registry/lang", ["content-type: application/json"],
		HTTPClient.METHOD_POST, JSON.stringify({ "lang": ui_lang }))   # persist for the whole office
	_rebuild_ui()

func _rebuild_ui() -> void:
	if _ui_layer: _ui_layer.queue_free()
	_build_ui(); _refresh_rooms(); _refresh_scene(); _refresh_lib(); _refresh_sel()

## Choose the company billboard image — from the LIBRARY or a fresh upload.
## Recommended ~1380×207 (the wide 6.7:1 ratio of the default sign).
func _import_billboard() -> void:
	var menu := PopupMenu.new()
	add_child(menu)
	# always-visible size hint at the top
	menu.add_item(L("📐 Best: 1380×207 px (ratio ~6.7:1, wide banner)",
		"📐 แนะนำ: 1380×207 px (อัตราส่วน ~6.7:1 แนวยาว)"))
	menu.set_item_disabled(menu.item_count - 1, true)
	menu.add_separator()
	menu.add_item(L("📁 Upload new image…", "📁 อัปโหลดรูปใหม่…"), 100)
	var imgs: Array = []
	for a in library:
		if String(a.get("kind", "")) == "image":
			imgs.append(a)
			menu.add_item("🖼 " + String(a.get("name", "")), imgs.size())
	if imgs.is_empty():
		menu.add_separator(L("(library has no images yet)", "(ยังไม่มีรูปใน library)"))
	menu.id_pressed.connect(func(id):
		if id == 100:
			_pick_file(PackedStringArray(["*.png", "*.jpg", "*.jpeg", "*.webp"]), func(p):
				_register_asset(p, "image"); _set_billboard(p))
		elif id >= 1 and id <= imgs.size():
			_set_billboard(String(imgs[id - 1].get("path", "")))
		menu.queue_free())
	menu.popup(Rect2i(Vector2i(230, 92), Vector2i(280, 10)))

func _set_billboard(p: String) -> void:
	if p == "": return
	_billboard_path = p
	if world and world.has_method("set_billboard_texture"):
		world.set_billboard_texture(p)
	_flash(L("🏷 Billboard set — Save to keep (best ratio ~6.7:1, e.g. 1380×207)",
		"🏷 ตั้งป้ายแล้ว — กดบันทึกเพื่อจำ (อัตราส่วน ~6.7:1 เช่น 1380×207)"))

func _fill_decor(cat: String) -> void:
	var box := ui.find_child("DecorList", true, false)
	if box == null: return
	for c in box.get_children(): c.queue_free()
	for name in _decor_cache.get(cat, []):
		var b := Button.new(); b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.text = "＋ " + String(name).get_basename(); b.add_theme_font_size_override("font_size", 10)
		var path := "res://assets/decor/%s/%s" % [cat, name]
		var fit: float = FIT_BY_CAT.get(cat, 1.0)
		b.pressed.connect(func(): _add_at_focus("model", path, fit))
		box.add_child(b)

func _flash(msg: String) -> void:
	var toast := ui.find_child("Toast", true, false)
	if toast and toast is Label: (toast as Label).text = msg

func _refresh_sel() -> void:
	var sp := ui.find_child("SelPanel", true, false)
	var sv := ui.find_child("SelBox", true, false)
	if sp == null or sv == null: return
	for c in sv.get_children(): c.queue_free()
	if sel < 0 or sel >= items.size():
		sp.visible = false; return
	sp.visible = true
	var it: Dictionary = items[sel]["dict"]
	var lbl := Label.new(); lbl.text = "⚙ " + String(it.get("type", "")); sv.add_child(lbl)
	# stepper rows (sliders were invisible on the dark theme) — clear value + buttons
	var apply_rot := func(v): it["rot"] = wrapf(v, 0.0, 360.0); items[sel]["node"].rotation_degrees.y = it["rot"]; _refresh_sel()
	sv.add_child(_stepper(L("Rotate", "หมุน"), "%d°" % int(it.get("rot", 0)),
		func(): apply_rot.call(float(it.get("rot", 0)) - 15.0),
		func(): apply_rot.call(float(it.get("rot", 0)) + 15.0)))
	var apply_scl := func(v): it["scale"] = clampf(v, 0.3, 4.0); items[sel]["node"].scale = Vector3(it["scale"], it["scale"], it["scale"]); _place_highlight(); _refresh_sel()
	sv.add_child(_stepper(L("Size", "ขนาด"), "%.1f" % float(it.get("scale", 1.0)),
		func(): apply_scl.call(float(it.get("scale", 1.0)) - 0.1),
		func(): apply_scl.call(float(it.get("scale", 1.0)) + 0.1)))
	# imported-model animation picker — choose which clip plays for THIS item
	if String(it.get("type", "")) == "model" and it.get("anims") is Array and (it["anims"] as Array).size() > 0:
		var al := Label.new(); al.text = "🎬 Animation"; sv.add_child(al)
		var ab := OptionButton.new(); ab.add_item(L("(none)", "(ไม่เล่น)"))
		var names: Array = it["anims"]
		for i in names.size(): ab.add_item(String(names[i]))
		var chosen := String(it.get("anim", ""))
		ab.select(0 if chosen == "" else (names.find(chosen) + 1))
		ab.item_selected.connect(func(i):
			it["anim"] = "" if i == 0 else String(names[i - 1])
			_respawn(sel))
		sv.add_child(ab)
	var del := Button.new(); del.text = L("🗑 Delete this", "🗑 ลบวัตถุนี้")
	del.pressed.connect(func():
		items[sel]["node"].queue_free(); items.remove_at(sel); sel = -1
		_place_highlight(); _refresh_sel(); _refresh_scene()); sv.add_child(del)

func _respawn(i: int) -> void:
	if i < 0 or i >= items.size(): return
	var dict: Dictionary = items[i]["dict"]
	items[i]["node"].queue_free()
	var node := _spawn(dict)
	_root.add_child(node)
	items[i]["node"] = node

func _stepper(label: String, value: String, on_minus: Callable, on_plus: Callable) -> HBoxContainer:
	var row := HBoxContainer.new(); row.add_theme_constant_override("separation", 4)
	var l := Label.new(); l.text = label; l.custom_minimum_size = Vector2(48, 0); row.add_child(l)
	var minus := Button.new(); minus.text = "−"; minus.custom_minimum_size = Vector2(34, 0)
	minus.pressed.connect(on_minus); row.add_child(minus)
	var v := Label.new(); v.text = value; v.custom_minimum_size = Vector2(50, 0); v.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER; row.add_child(v)
	var plus := Button.new(); plus.text = "＋"; plus.custom_minimum_size = Vector2(34, 0)
	plus.pressed.connect(on_plus); row.add_child(plus)
	return row

func _refresh_rooms() -> void:
	var g := ui.find_child("RoomGrid", true, false)
	if g == null or world == null or not world.has_method("get_room_order"): return
	for c in g.get_children(): c.queue_free()
	var order: Array = world.get_room_order()
	for slot in order.size():
		var b := Button.new()
		var kind := String(order[slot])
		var picked := (slot == _swap_pick)
		b.text = ("✪ " if picked else "") + String(ROOM_LABELS.get(kind, kind))
		b.add_theme_font_size_override("font_size", 9)
		b.custom_minimum_size = Vector2(62, 30)
		b.toggle_mode = true; b.button_pressed = picked
		if picked:
			# clearly mark the first pick: glowing cyan, awaiting the swap target
			b.modulate = Color(0.45, 1.0, 1.0)
			b.add_theme_color_override("font_color", Color(0.05, 0.1, 0.15))
			b.add_theme_color_override("font_focus_color", Color(0.05, 0.1, 0.15))
		var s := slot
		b.pressed.connect(func(): _on_room_click(s))
		g.add_child(b)

func _on_room_click(slot: int) -> void:
	if world == null: return
	if _swap_pick < 0:
		_swap_pick = slot; _flash(L("Picked first room — click another to swap", "เลือกห้องแรก — คลิกอีกห้องเพื่อสลับ"))
	elif _swap_pick == slot:
		_swap_pick = -1; _flash(L("Cancelled", "ยกเลิก"))
	else:
		world.swap_cells(_swap_pick, slot); _swap_pick = -1
		_flash(L("🔀 Rooms swapped — press 💾 Save to keep it", "🔀 สลับห้องแล้ว — กด 💾 บันทึก ให้วอลเปเปอร์จำ"))
	_refresh_rooms()

func _refresh_scene() -> void:
	var box := ui.find_child("SceneList", true, false)
	if box == null: return
	for c in box.get_children(): c.queue_free()
	for i in items.size():
		var b := Button.new(); b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.text = "%d. %s" % [i + 1, String(items[i]["dict"].get("type", ""))]
		b.add_theme_font_size_override("font_size", 11)
		var idx := i
		b.pressed.connect(func(): sel = idx; _place_highlight(); _refresh_sel())
		box.add_child(b)

func _refresh_lib() -> void:
	var box := ui.find_child("LibList", true, false)
	if box == null: return
	for c in box.get_children(): c.queue_free()
	if library.is_empty():
		var e := Label.new(); e.text = L("(empty — use Import)", "(ว่าง — กด Import)"); e.add_theme_font_size_override("font_size", 10); box.add_child(e); return
	for a in library:
		var row := HBoxContainer.new()
		var b := Button.new(); b.alignment = HORIZONTAL_ALIGNMENT_LEFT; b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var icon := "📦 " if a.get("kind") == "model" else "🖼 "
		b.text = icon + String(a.get("name", "")); b.add_theme_font_size_override("font_size", 10)
		var ap := String(a.get("path", "")); var ak := String(a.get("kind", "model"))
		b.pressed.connect(func(): _add_at_focus("model" if ak == "model" else "poster", ap))
		row.add_child(b)
		var x := Button.new(); x.text = "✕"; x.add_theme_font_size_override("font_size", 10)
		x.pressed.connect(func():
			_assets_req.request(ASSETS_URL, ["content-type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({ "remove": ap }))
			library = library.filter(func(z): return z.get("path") != ap); _refresh_lib())
		row.add_child(x)
		box.add_child(row)

# ---------------------------------------------------------------- presets / assets
func _on_preset_picked(idx: int) -> void:
	if idx <= 0: return
	var list := PRESETS + custom_presets
	if idx - 1 < list.size(): _load_preset(list[idx - 1])

func _load_preset(pr: Dictionary) -> void:
	for c in _root.get_children(): c.queue_free()
	items.clear(); sel = -1; _place_highlight()
	for it in pr.get("items", []):
		if it is Dictionary: _add_item(it.duplicate(true))
	_refresh_sel(); _refresh_scene()
	_flash(L("⭐ Loaded: ", "⭐ โหลด: ") + String(pr.get("name", "")))

func _current_items() -> Array:
	var out: Array = []
	for e in items: out.append(e["dict"])
	return out

func _save() -> void:
	# confirm first — saving updates the live wallpaper and then closes the editor
	_confirm_modal(
		L("Confirm save", "ยืนยันการบันทึก"),
		L("Save this office layout, update the wallpaper, and close the editor?",
			"บันทึกผังออฟฟิศนี้ อัปเดตวอลเปเปอร์ แล้วปิดโปรแกรมเลยไหม?"),
		L("💾 Save & close", "💾 บันทึกแล้วปิด"),
		L("Cancel", "ยกเลิก"),
		func(): _do_save())

# A brand-themed confirm dialog (the raw Godot ConfirmationDialog looked off-theme and
# half-finished). Built from Controls under `ui`, so it inherits the dark-glass theme.
func _confirm_modal(title: String, body: String, ok_text: String, cancel_text: String, on_ok: Callable) -> void:
	var accent := Color(0.37, 0.78, 1.0)
	var back := ColorRect.new()
	back.color = Color(0.02, 0.04, 0.08, 0.58)
	back.set_anchors_preset(Control.PRESET_FULL_RECT)
	back.mouse_filter = Control.MOUSE_FILTER_STOP   # eat clicks behind the modal
	ui.add_child(back)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	back.add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(400, 0)
	center.add_child(panel)
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 13)
	panel.add_child(vb)
	var t := Label.new(); t.text = title
	t.add_theme_color_override("font_color", accent)
	t.add_theme_font_size_override("font_size", 15)
	vb.add_child(t)
	var msg := Label.new(); msg.text = body
	msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	msg.custom_minimum_size = Vector2(372, 0)
	vb.add_child(msg)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	vb.add_child(row)
	var cancel := Button.new(); cancel.text = cancel_text
	var ok := Button.new(); ok.text = ok_text
	# OK = primary (accent fill, dark ink)
	var prim := func(a: float) -> StyleBoxFlat:
		var s := StyleBoxFlat.new(); s.bg_color = Color(0.37, 0.78, 1.0, a); s.set_corner_radius_all(9)
		s.content_margin_top = 7; s.content_margin_bottom = 7; s.content_margin_left = 13; s.content_margin_right = 13
		return s
	ok.add_theme_stylebox_override("normal", prim.call(0.92))
	ok.add_theme_stylebox_override("hover", prim.call(1.0))
	ok.add_theme_stylebox_override("pressed", prim.call(0.8))
	ok.add_theme_color_override("font_color", Color(0.03, 0.09, 0.16))
	ok.add_theme_color_override("font_hover_color", Color(0.02, 0.06, 0.12))
	row.add_child(cancel); row.add_child(ok)
	var close := func(): back.queue_free()
	cancel.pressed.connect(close)
	ok.pressed.connect(func(): close.call(); on_ok.call())

func _do_save() -> void:
	var payload := { "items": _current_items() }
	if world and world.has_method("get_room_order"): payload["rooms"] = world.get_room_order()
	if world and world.has_method("ghost_deck_pos"):
		var gp: Vector2 = world.ghost_deck_pos(); payload["ghost"] = [gp.x, gp.y]
	if _billboard_path != "": payload["billboard"] = _billboard_path
	_save_req.request(LAYOUT_URL, ["content-type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(payload))
	_flash(L("💾 Saved — updating wallpaper, closing…", "💾 บันทึกแล้ว — อัปเดตวอลเปเปอร์ แล้วปิด…"))
	await get_tree().create_timer(1.2).timeout   # let the POST land + daemon broadcast
	get_tree().quit()

func _save_as_preset() -> void:
	var dlg := AcceptDialog.new(); dlg.title = L("Save as preset", "บันทึกเป็น preset")
	var le := LineEdit.new(); le.placeholder_text = L("preset name", "ชื่อ preset"); le.custom_minimum_size = Vector2(260, 0)
	dlg.add_child(le); dlg.register_text_enter(le); add_child(dlg)
	dlg.confirmed.connect(func():
		var nm := le.text.strip_edges()
		if nm != "":
			_save_req.request(PRESETS_URL, ["content-type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({ "name": nm, "items": _current_items() }))
			_flash(L("⭐ Saved preset: ", "⭐ บันทึก preset: ") + nm)
			_preset_req.request(PRESETS_URL)
		dlg.queue_free())
	dlg.canceled.connect(func(): dlg.queue_free())
	dlg.popup_centered(Vector2i(320, 130)); le.grab_focus()

func _on_preset(_r: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	if code != 200: return
	var data: Variant = JSON.parse_string(body.get_string_from_utf8())
	if data is Dictionary and data.get("presets") is Array:
		custom_presets = data["presets"]
		var pick := ui.find_child("PresetPick", true, false)
		if pick and pick is OptionButton:
			var ob := pick as OptionButton
			while ob.item_count > 1 + PRESETS.size(): ob.remove_item(ob.item_count - 1)
			for cp in custom_presets: ob.add_item("🔸 " + String(cp.get("name", "")))

func _on_assets(_r: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	if code != 200: return
	var data: Variant = JSON.parse_string(body.get_string_from_utf8())
	if data is Dictionary and data.get("assets") is Array:
		library = data["assets"]; _refresh_lib()

func _register_asset(path: String, kind: String) -> void:
	_assets_req.request(ASSETS_URL, ["content-type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({ "path": path, "kind": kind }))
	if not library.any(func(a): return a.get("path") == path):
		library.append({ "path": path, "kind": kind, "name": path.get_file() }); _refresh_lib()

func _import_model() -> void:
	_pick_file(["*.glb", "*.gltf", "*.fbx"], func(p):
		_register_asset(p, "model"); _add_at_focus("model", p))

func _import_image() -> void:
	_pick_file(["*.png", "*.jpg", "*.jpeg", "*.webp"], func(p):
		_register_asset(p, "image"); _add_at_focus("poster", p))

func _pick_file(filters: PackedStringArray, cb: Callable) -> void:
	var fd := FileDialog.new(); fd.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	fd.access = FileDialog.ACCESS_FILESYSTEM; fd.filters = filters; fd.use_native_dialog = true
	add_child(fd)
	fd.file_selected.connect(func(p): cb.call(p); fd.queue_free())
	fd.canceled.connect(func(): fd.queue_free())
	fd.popup_centered(Vector2i(800, 560))
