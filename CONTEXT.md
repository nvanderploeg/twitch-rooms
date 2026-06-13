# Twitch Room

A web service that lets a Twitch streamer's viewers gather in a shared, configurable virtual room and experience chat together. The project ships the **harness** — the room is configurable in looks and functionality, not a single fixed game.

## Language

**Streamer**:
The broadcaster who owns a Room and runs the room software locally. One Streamer owns exactly one Room (for now).
_Avoid_: Host, broadcaster, creator.

**Viewer**:
A member of the Streamer's audience who joins the Room through a web browser. Many Viewers per Room. A Viewer watches anonymously by default (the scene is chat-driven, ingested via the Streamer's OAuth). A Viewer may optionally log in with Twitch to **claim** their avatar and gain web-side agency; an anonymous Viewer is watch-only.
_Avoid_: User, guest, member.

**Room**:
The shared virtual space for one Streamer and their Viewers — the thing being rendered, configured, and inhabited. A Room corresponds one-to-one to a Twitch channel; the Hub identifies it by the channel's Twitch login (`hub.site/alice` ↔ `twitch.tv/alice`). A Room is a logical space; the **Room Server** is the software instance that runs it.
_Avoid_: Channel, world, lobby, space.

**Twitch OAuth (Streamer)**:
The Streamer authenticates with Twitch to prove they own their channel. This both authorizes the Room Server's registration with the Hub (no impersonation/squatting) and grants the scopes needed to read the channel's chat. The Hub's directory key is the verified Twitch login.

**Room Server**:
The software a Streamer runs locally (the docker-compose stack) that owns the authoritative state of one Room. It is reachable by Viewers at a **Public Endpoint**, where it serves both the web client (React app + assets) and the live `wss://` data — same origin. Viewers connect to it directly; the Hub is not in the data path.
_Avoid_: Backend, node, instance.

**Public Endpoint**:
The publicly-reachable, TLS-secured URL at which a Room Server accepts direct Viewer connections (e.g. `wss://room.alicestreams.tv`). The Streamer owns it — their own DNS, TLS, and reachability (VPS, port-forward, or self-run tunnel). The Room Server registers this URL with the Hub on boot.
_Avoid_: URL, address, host.

**Hub**:
The single public service Viewers visit first. It is a **directory**: it tracks which Rooms exist, their presence (online/offline), and each Room's Public Endpoint, then **redirects** the Viewer to that endpoint. The Hub serves no client assets and carries no live Room traffic — once it redirects, it is out of the loop. One Hub serves many Rooms.
_Avoid_: Gateway, proxy, relay, broker.

**Room Config**:
The declarative document that defines a Room's looks and functionality — theme, scene/layout, asset references, and the set of **Modules** it enables with their parameters. Interpreted by a fixed engine shared by all Rooms; in v1 it runs only built-in behavior, no third-party code.
_Avoid_: Settings, preferences, manifest.

**Module**:
A built-in, configurable feature unit the engine can run in a Room (e.g. avatars, emote-rain, polls, mini-games). A Room turns Modules on and parametrizes them through its Room Config. v1 ships a curated set of Modules; third-party plugins are an explicit future extension, not a v1 surface.
_Avoid_: Plugin, extension, widget, addon.

**Engine**:
The fixed client+room runtime, shared by every Room, that renders the scene and executes enabled Modules according to the Room Config. The Engine is the harness; Rooms differ by config, not by code.
_Avoid_: Framework, runtime, core.

## Flagged ambiguities

**Hub: directory, not relay.** Early discussion floated the Hub tunneling all Viewer traffic (room dials out, Hub fans out). Rejected. The Hub only does discovery/presence/routing; live Room traffic flows directly Viewer ↔ Room Server via the Public Endpoint. If you catch yourself describing the Hub carrying gameplay/chat bytes, you've drifted.

## Example dialogue

> **Dev:** When a Viewer opens `hub.site/room/alice`, are they talking to the Hub or to Alice's machine?
> **Domain expert:** To the Hub. The Hub holds a live outbound connection from Alice's Room Server and relays the Viewer through it. Alice never opens a port.
> **Dev:** So if Alice closes her laptop, the Room is gone?
> **Domain expert:** Right — the Room Server owns the Room's authoritative state. No Room Server, no Room. The Hub just shows it as offline.
