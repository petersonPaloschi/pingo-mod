# README media

These files are archived illustrations from the earlier tool-suggestion design. The current README and dashboard do not use them to describe active features or measured performance; current UI behavior is documented in [DESIGN.md](../../DESIGN.md).

The animations are authored 3D illustrations made with the Higgsfield MCP's **3D Jutsu** scene tools. The Blender scene and keyframes were exported as GLB and rendered through WebGL in an existing browser, then encoded as GIFs. They are illustrations, rather than captured product screens.

- `pingo-states.gif`: Pingo's six expressions, a rotating dotted body, and the routing illustration.
- `pingo-routing.gif`: a focused view of context flowing from Claude to Jev, a hint returning to Claude, and Claude calling a tool.
- `pingo-preview.png`: a still from the delivery camera.
- `pingo-scene.py`: the procedural scene and animation source used in Higgsfield. Run it in a fresh 3D Jutsu scene through `scene_builder_3d_run_python` after inspecting the project and obtaining its revision guards. It uses the service's `bpy` and `artifacts` objects.

The scene follows Pingo's repository geometry and the supplied *Jev Pontilhado* visual reference: a Fibonacci distribution of body dots, eyes shaped by state, restrained color, and depth through point size and brightness. Its proportions are illustrations, not exact UI output. The animations do not contain real prompts, provider responses, or performance measurements.

Animation: 12 fps, frames 1–108, nine seconds. Each mood lasts 18 frames. The continuation at frame 109 closes the body motion; the routing pulse fades before its position resets. A short pause marks each decision stage. The sequence illustrates an accepted hint; it does not imply that Claude must follow it.

The hero GIF is 1000×400; the focused routing GIF is 820×170. Both contain 108 frames and loop every nine seconds. The GIFs use a shared palette and alternate 80/80/90 ms frame delays to approximate 12 fps within GIF's timing resolution. The first, thinking, passthrough, failure, idle, baseline, and final poses were inspected from the delivery camera.

The committed scene is available in [Higgsfield 3D Jutsu](https://higgsfield.ai/3d-jutsu/d4f6789d-2e97-4934-b816-ec630aa2029a). Access follows the account's project permissions. The README uses repository files and does not depend on signed download URLs.

Media is covered by the repository's [MIT license](../../LICENSE).
