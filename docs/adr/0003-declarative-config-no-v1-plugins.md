# Declarative config over built-in modules; no third-party plugins in v1

A Room is "configurable in looks and functionality" through a declarative **Room Config** (theme, scene/layout, assets, and the set of built-in **Modules** it enables with their parameters), interpreted by a fixed **Engine** shared by every Room. The Engine renders with PixiJS (2D, WebGL/WebGPU), chosen for high-performance rendering of hundreds of chat-driven sprites. v1 runs **only built-in code** — no third-party plugin system.

## Why the explicit "no" to plugins

A sandboxed plugin API would enable community content but forces us to design and freeze an API surface and solve untrusted-code sandboxing/security — large scope we are deliberately deferring. Rooms differ by config, not by code. Power users can still fork the open-source repo. A plugin API remains a possible future extension; it is not a v1 surface.
