# Self-hosted Rooms behind a directory Hub

Streamers self-host the **Room Server** (a docker-compose stack) and expose it at their own TLS-secured **Public Endpoint** (`wss://…`, their own DNS/cert/reachability). The **Hub** is only a directory: it tracks which Rooms exist and their presence, then **redirects** a Viewer to the Room's Public Endpoint, where the Room Server serves both the web client and the live `wss://` data. The Hub is never in the data path.

## Considered options

- **Centrally-hosted multi-tenant SaaS** — we run everything; each Room is a tenant. Simplest reachability, but makes us the host/cost center and contradicts the "streamer runs their own room" goal.
- **Hub-relayed self-host (outbound tunnel, Hub fans out)** — Room dials out, Hub tunnels/replicates Viewer traffic. Solves NAT and home-bandwidth, but puts all live traffic (and its cost/scale) back on the Hub. Rejected: the Hub must stay a thin directory.
- **WebRTC data channels (Hub as signaling only)** — direct, NAT-piercing, but requires a WebRTC stack in the Room Server and a TURN fallback. Rejected for v1 in favor of the simpler "streamer owns a public endpoint" path.

## Consequences

- **v1 targets technically-capable streamers** who can stand up a public host with DNS + TLS (VPS, port-forward + cert, or a self-run tunnel). The "can't-configure-OBS" persona is explicitly deferred — turnkey tunneling/hosting is future work.
- Because the Viewer loads the client over HTTPS, the Room Server's endpoint **must** be valid `wss://` with TLS; a bare home IP or `ws://` will be blocked by the browser.
- The Hub stays cheap and stateless w.r.t. live Rooms; scaling a popular Room is the Streamer's own infrastructure problem.
