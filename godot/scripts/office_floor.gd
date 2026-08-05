extends Node3D
## Root controller for the office floor: real-time day cycle, screenshot
## automation (--shot) and wallpaper mode (--wallpaper).

## hour → [sun pitch°, sun energy, sun color, sky color, ambient energy].
## Ambient must follow the clock too — light surroundings (grass, mountains)
## glow unnaturally at night otherwise.
## Tuned to a realistic tropical (Thailand) sun: first light ~5:45, sunrise
## ~6:10, golden mornings, white overhead noon, golden hour from ~17:30,
## sunset ~18:20 with a purple dusk, full night by ~19:10.
const DAY_KEYS := [
	[0.0,  -40.0, 0.22, Color(0.5, 0.62, 1.0),  Color(0.05, 0.07, 0.16), 0.8],   # deep night
	[5.6,  -40.0, 0.22, Color(0.5, 0.62, 1.0),  Color(0.06, 0.08, 0.18), 0.8],   # pre-dawn
	[6.1,  -11.0, 0.9,  Color(1.0, 0.52, 0.32), Color(0.5, 0.38, 0.52),  1.05],  # sunrise — red sun, mauve sky
	[7.0,  -20.0, 1.9,  Color(1.0, 0.76, 0.5),  Color(0.82, 0.68, 0.58), 1.45],  # golden morning
	[9.0,  -38.0, 2.5,  Color(1.0, 0.91, 0.78), Color(0.58, 0.77, 1.0),  1.6],   # bright morning
	[12.0, -50.0, 2.7,  Color(1.0, 0.93, 0.8),  Color(0.55, 0.74, 1.0),  1.6],   # noon — warm daylight, not washed-out white (lower ambient = richer + visible shadows)
	[15.0, -45.0, 2.6,  Color(1.0, 0.91, 0.78), Color(0.58, 0.76, 1.0),  1.6],   # afternoon
	[17.0, -30.0, 2.3,  Color(1.0, 0.82, 0.56), Color(0.74, 0.72, 0.66), 1.6],   # late afternoon, warming
	[18.0, -15.0, 1.5,  Color(1.0, 0.58, 0.32), Color(0.95, 0.55, 0.38), 1.2],   # golden hour
	[18.4, -8.0,  0.7,  Color(1.0, 0.42, 0.3),  Color(0.45, 0.28, 0.42), 0.95],  # sunset — purple dusk
	[19.1, -40.0, 0.22, Color(0.5, 0.62, 1.0),  Color(0.07, 0.09, 0.2),  0.8],   # night falls
	[24.0, -40.0, 0.22, Color(0.5, 0.62, 1.0),  Color(0.05, 0.07, 0.16), 0.8],
]

var _clock_timer := 0.0
var _last_minute := -1  # minute-of-day last painted on the roofline clock
var _hour_override := -1.0
var _cli_pinned := false  # --hour=N beats replayed ui.daylight events

var _wallpaper_mode := false
var _occ_check_timer := 0.0
var _occluded := false
var _fps_log_timer := 0.0

func _ready() -> void:
	_wallpaper_mode = "--wallpaper" in OS.get_cmdline_user_args()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--hour="):
			_hour_override = float(arg.split("=")[1])
			_cli_pinned = true
	$Sun.rotation_degrees = Vector3(-46.0, 150.0, 0.0)
	_apply_daylight()

	# 🎨 3D EDITOR MODE — a normal window for arranging the office. Skip the
	# wallpaper attach / splash / live agents / cinematic drift; drive the
	# camera and editing through map_editor.gd. The procedural world stays as
	# locked context.
	if "--editor3d" in OS.get_cmdline_user_args():
		_enter_editor_mode()
		return

	if "--shot" in OS.get_cmdline_user_args():
		_take_shot()

	_capture_map.call_deferred()

	# 🎨 Office Editor layer: spawn the user's custom furniture/decor on top
	# of the procedural world (atmosphere + effects stay intact).
	var layout: Node = load("res://scripts/layout_loader.gd").new()
	layout.name = "LayoutLoader"
	add_child(layout)

	# Splash floats logo-only over the desktop (transparent window). Going
	# opaque here would paint a black box for the whole blocking scene build
	# — flip only after the first real frame is on screen.
	_opaque_after_first_frame()

	if "--wallpaper" in OS.get_cmdline_user_args():
		# NB: borderless/fullscreen/opaque happen in _opaque_after_first_frame
		# — touching the window mid-load repaints the splash on black.
		# Wallpaper rung: 30 fps, NATIVE render + MSAA 2x — the measured sweet
		# spot (FSR upscale read as jaggies; 4x MSAA costs +10% GPU for little
		# visible gain at wallpaper distance).
		Engine.max_fps = 30
		get_viewport().scaling_3d_scale = 1.0
		get_viewport().msaa_3d = Viewport.MSAA_2X
		var env: Environment = $WorldEnvironment.environment
		env.ssao_enabled = false
		env.ssr_max_steps = 24
		# Volumetric froxel pipeline is the big GPU cost — at wallpaper rung
		# the fake beam cards carry the god-ray look on their own.
		env.volumetric_fog_enabled = false
		# Shadow atlas: the orthogonal map is fit to the whole view frustum (up to
		# directional_shadow_max_distance = 100, which must cover the office at the
		# far wallpaper camera or shadows vanish entirely when zoomed out). Spread
		# over that large area, 4096 read soft/faint at normal zoom — 8192 packs
		# enough texels to stay CRISP at the far camera, the same way the map
		# concentrates when you zoom in. Worth the GPU at the 30 fps wallpaper rung.
		RenderingServer.directional_shadow_atlas_set_size(8192, true)
		var cam: Camera3D = $CameraRig/Camera3D
		cam.attributes.dof_blur_far_enabled = false
		cam.attributes.dof_blur_near_enabled = false

## 🎨 Switch this instance into the standalone 3D Office Editor.
## Boots EXACTLY like the main app: the window stays transparent/borderless while
## everything loads (so Godot's small centred boot splash floats over the desktop
## — no black box), then goes opaque + windowed after the first real frame.
func _enter_editor_mode() -> void:
	DisplayServer.window_set_title("BagIdea Office Editor")
	var icon := Image.new()
	if icon.load(ProjectSettings.globalize_path("res://assets/brand/logo_ico_cute.png")) == OK:
		DisplayServer.set_icon(icon)
	# bright, fixed daylight for clear editing
	_cli_pinned = true
	_hour_override = 12.0
	_apply_daylight()
	# silence the live office: no cinematic drift, no agents, no overlays
	var rig := get_node_or_null("CameraRig")
	if rig:
		rig.set_process(false)
		rig.set_physics_process(false)
		if rig.has_method("set_process_input"):
			rig.set_process_input(false)
	var ec := get_node_or_null("EventClient")
	if ec:
		ec.set_process(false)
	for n in ["CinemaLayer", "GrainLayer", "Hud"]:
		var node := get_node_or_null(n)
		if node:
			node.visible = false
	# camera = the real framing, DOF off (blur made everything fuzzy)
	var cam: Camera3D = $CameraRig/Camera3D
	if cam.attributes:
		cam.attributes.dof_blur_far_enabled = false
		cam.attributes.dof_blur_near_enabled = false
	# drive the camera + editing (built while the transparent boot splash shows)
	var ed: Node = load("res://scripts/map_editor.gd").new()
	ed.name = "MapEditor"
	add_child(ed)
	ed.setup($CameraRig, cam)
	# first real frame is ready → drop the transparent boot splash, become the
	# opaque framed editor window (same handoff as the main app).
	await RenderingServer.frame_post_draw
	get_viewport().transparent_bg = false
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, false)
	RenderingServer.set_default_clear_color(Color(0.05, 0.07, 0.12))
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, false)
	var win := Vector2i(1280, 800)
	DisplayServer.window_set_size(win)
	var scr := DisplayServer.window_get_current_screen()
	var sp := DisplayServer.screen_get_position(scr)
	var ss := DisplayServer.screen_get_size(scr)
	DisplayServer.window_set_position(sp + (ss - win) / 2)
	get_window().grab_focus()
	DisplayServer.window_move_to_foreground()
	get_tree().create_timer(0.6).timeout.connect(func():
		DisplayServer.window_move_to_foreground(); get_window().grab_focus())
	# re-assert the title AFTER the window is framed — Godot stamps
	# "<project> (DEBUG)" on a debug run; setting it here overrides that suffix.
	DisplayServer.window_set_title("BagIdea Office Editor")
	get_tree().create_timer(0.8).timeout.connect(func():
		DisplayServer.window_set_title("BagIdea Office Editor"))
	Engine.max_fps = 60
	# tell the shell the editor is on screen → it drops the circular logo splash
	# (same handoff as the wallpaper's bagidea_world_ready flag)
	# NB: OS.get_temp_dir() (not $TEMP, which is Windows-only) so the flag lands
	# where the shell's std::env::temp_dir() reads it on macOS/Linux too.
	var flag := FileAccess.open(
		OS.get_temp_dir().path_join("bagidea_editor_ready"), FileAccess.WRITE)
	if flag:
		flag.store_line(Time.get_datetime_string_from_system())

## Manual atmosphere from the overlay: {"hour": 17.5} pins the clock for
## debugging/beauty shots; {"hour": "auto"} hands it back to real time.
func apply_daylight_event(evt: Dictionary) -> void:
	if _cli_pinned:
		return
	var h: Variant = evt.get("hour", "auto")
	_hour_override = float(h) if (h is float or h is int) else -1.0
	_apply_daylight()

func _opaque_after_first_frame() -> void:
	await RenderingServer.frame_post_draw
	get_viewport().transparent_bg = false
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, false)
	if "--wallpaper" in OS.get_cmdline_user_args():
		DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
		DisplayServer.window_set_position(Vector2i.ZERO)
		DisplayServer.window_set_size(DisplayServer.screen_get_size())
	# Signal the shell that the scene is on screen — it holds the WorkerW
	# attach until now so the transparent splash survives the whole load.
	# OS.get_temp_dir() works on all three OSes; $TEMP is Windows-only and would
	# be empty on macOS/Linux, so the shell would never see this flag.
	var flag := FileAccess.open(
		OS.get_temp_dir().path_join("bagidea_world_ready"), FileAccess.WRITE)
	if flag:
		flag.store_line(Time.get_datetime_string_from_system())

func _process(delta: float) -> void:
	# The roofline clock has to agree with the taskbar, so it SAMPLES the system
	# clock every second and repaints the moment the minute rolls over. The old
	# loop counted 60 seconds of frame deltas instead and only then looked at the
	# time: stale by up to a minute even at a healthy frame rate, and stale for
	# however long the renderer was starved when it wasn't (an occluded
	# wallpaper, a machine coming back from sleep — where the frame timer stops
	# but the wall clock doesn't). That is how a desktop clock ends up minutes
	# behind the one in the corner of the same screen.
	_clock_timer -= delta
	if _clock_timer <= 0.0:
		_clock_timer = 1.0
		var t := Time.get_time_dict_from_system()
		var minute_of_day: int = int(t.hour) * 60 + int(t.minute)
		if minute_of_day != _last_minute:
			_last_minute = minute_of_day
			_apply_daylight()

	if _wallpaper_mode:
		# Occlusion throttle: shim writes /tmp/bagidea_occ when the window is
		# fully hidden — drop to 2 fps so we consume near-zero GPU while invisible.
		_occ_check_timer -= delta
		if _occ_check_timer <= 0.0:
			_occ_check_timer = 0.5
			var now_occ := FileAccess.open("/private/tmp/bagidea_occ", FileAccess.READ) != null
			if now_occ != _occluded:
				_occluded = now_occ
				Engine.max_fps = 2 if _occluded else 30

		# FPS telemetry for perf testing: write actual fps to /tmp/bagidea_fps once/sec.
		_fps_log_timer += delta
		if _fps_log_timer >= 1.0:
			_fps_log_timer -= 1.0
			var f := FileAccess.open("/private/tmp/bagidea_fps", FileAccess.WRITE)
			if f:
				f.store_line(str(Engine.get_frames_per_second()))

## Sun, sky and god-ray cards follow the machine's real local time (doc 3.4:
## lighting itself is a status display — glance at the office, read the day).
func _apply_daylight() -> void:
	var t := Time.get_time_dict_from_system()
	var hour: float = t.hour + t.minute / 60.0
	if _hour_override >= 0.0:
		hour = _hour_override
	var a: Array = DAY_KEYS[0]
	var b: Array = DAY_KEYS[DAY_KEYS.size() - 1]
	for i in DAY_KEYS.size() - 1:
		if hour >= DAY_KEYS[i][0] and hour <= DAY_KEYS[i + 1][0]:
			a = DAY_KEYS[i]
			b = DAY_KEYS[i + 1]
			break
	var f: float = 0.0 if b[0] == a[0] else (hour - a[0]) / (b[0] - a[0])
	var pitch: float = lerpf(a[1], b[1], f)
	var energy: float = lerpf(a[2], b[2], f)
	var sun_col: Color = a[3].lerp(b[3], f)
	var sky_col: Color = a[4].lerp(b[4], f)

	$Sun.rotation_degrees = Vector3(pitch, 150.0, 0.0)
	$Sun.light_energy = energy
	$Sun.light_color = sun_col
	var env: Environment = $WorldEnvironment.environment
	env.ambient_light_energy = lerpf(a[5], b[5], f)
	# Procedural sky is the IBL source (ambient + reflections) — keep its
	# colors on the clock so glossy floors mirror dawn/day/night correctly.
	if env.sky and env.sky.sky_material is ProceduralSkyMaterial:
		var sm: ProceduralSkyMaterial = env.sky.sky_material
		sm.sky_top_color = sky_col.darkened(0.25)
		sm.sky_horizon_color = sky_col.lightened(0.25)
		sm.ground_horizon_color = sky_col * Color(0.75, 0.8, 0.7)
	var world: Node3D = $World
	# Roofline clock + phase icon + the day/night particle shift.
	var phase := "day"
	if hour < 5.8 or hour >= 19.0:
		phase = "night"
	elif hour < 8.5:
		phase = "dawn"
	elif hour >= 17.3:
		phase = "dusk"
	var mins := int(round(fmod(hour, 1.0) * 60.0)) % 60
	world.update_clock("%02d:%02d" % [int(hour) % 24, mins], phase)
	world.set_night_life(phase == "night")
	if world.sky_mat:
		world.sky_mat.emission = sky_col
		world.sky_mat.albedo_color = sky_col
	for bm in world.beam_mats:
		bm.set_shader_parameter("strength", 0.18 * clampf(energy / 2.6, 0.0, 1.0))
		bm.set_shader_parameter("tint", Color(sun_col.r, sun_col.g, sun_col.b * 0.8))

## Orthographic top-down floorplan, rendered once into a SubViewport and
## shipped to the daemon — the overlay's live-map background. Extents MUST
## match overlay.html's MAP_* constants: x -11.29..17.29, z -11..14.
func _capture_map() -> void:
	await get_tree().create_timer(4.0).timeout  # world + runtime assets ready
	var vp := SubViewport.new()
	vp.size = Vector2i(832, 640)   # 1.3:1 — matches the rectangular office (X>Z)
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(vp)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 26.0                # vertical world extent; horizontal = 26*832/640 ≈ 33.8
	cam.cull_mask = 1  # world only — characters live on render layer 2
	cam.position = Vector3(0, 40, 0)
	cam.rotation_degrees = Vector3(-90, 0, 0)
	vp.add_child(cam)
	cam.current = true
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := vp.get_texture().get_image()
	vp.queue_free()
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(_r, _c, _h, _b): req.queue_free())
	req.request_raw("http://127.0.0.1:8787/map/bg", ["content-type: image/png"],
		HTTPClient.METHOD_POST, img.save_png_to_buffer())

func _take_shot() -> void:
	await get_tree().create_timer(2.5).timeout
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var dir := ProjectSettings.globalize_path("res://").path_join("../shots")
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir.path_join("office_floor.png")
	img.save_png(path)
	print("screenshot saved: ", path)
	get_tree().quit()
