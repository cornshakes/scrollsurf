# Plan 1 — Move prod from the Pi to the box

## Context

Prod runs on the Raspberry Pi and reaches the public internet through a
Tailscale Funnel sidecar, at `https://scrollsurf.tail812f0.ts.net`. That means an
awkward URL nobody can type from memory, a second container in the prod stack, a
reusable auth key to keep alive, a one-time Funnel acknowledgement in the
Tailscale admin console, and a kernel-specific `TS_DEBUG_FIREWALL_MODE: nftables`
workaround for the Pi's 6.18 kernel — all of it to serve one small Next.js app.

Butterfry already went through this. Its prod lives on the box (`ssh box`,
amd64) as one tenant behind a shared Caddy proxy that is its own project at
`~/code/box-caddy`. The proxy owns 80 and 443, terminates TLS, and reaches each
tenant by container name over a shared `caddy_net` network. Adding a site there
is three steps: write one `.caddy` file, attach the app to the network under a
pinned container name, reload.

The outcome we want: scrollsurf prod serves from the box at
**`scrollsurf.cornshakes.at`**, with no Tailscale anywhere in the deploy. Test is
untouched — it stays on the Pi, LAN-only on port 3001.

Already verified on the box: it is `x86_64`, `caddy_net` exists, the `box` docker
context exists on the Mac, there is 56G free on `/`, and
`scrollsurf.cornshakes.at` already A-records to `89.22.103.245` — the same
address `butterfry.cornshakes.at` resolves to.

## Content

Four pieces of work.

**Teach the deploy script about two different hosts.** Today it assumes the Pi
everywhere: `docker --context pi` is hardcoded, the build is always
`--platform linux/arm64`, and there is a guard refusing to run on anything but
an arm64 Mac. The host, the docker context, the platform and the build strategy
all become per-target. Test keeps building on the Mac and shipping the image over
SSH; prod builds remotely on the box, because the box is amd64 and the Mac is
not.

**Turn the prod stack into a Caddy tenant.** The Tailscale sidecar, its state
volume and the serve config all go. The app service stops using
`network_mode: service:ts-scrollsurf`, publishes no ports at all, and instead
exposes 3000 on the shared network under the pinned name `scrollsurf-app`.

**Register the site with the proxy.** One new file, `sites/scrollsurf.caddy`, in
`~/code/box-caddy` — a sibling repo, so this produces a commit there rather than
here.

**Cut over on the box.** Create the host directories, move the live database
across, and bring the stack up before the site file is added.

## Notes

**The live database has to survive.** The Pi's `/srv/scrollsurf/prod` holds a
623MB `scrollsurf.db` with real user votes and click history, plus its `-wal` and
`-shm` siblings. This is the one genuinely irreplaceable thing in the whole move —
the datasets can always be re-downloaded, the image can always be rebuilt, but
the votes cannot. It gets copied Pi→box directly, with the app stopped so the WAL
is not being written mid-copy. This is the same procedure butterfry's DEPLOY.md
prescribes for backups.

**Copying beats re-uploading.** The alternative is letting the normal
`datasets/` rsync push 704MB from the Mac over the internet, which is slow and
still leaves the runtime DB behind. A server-to-server `tar | ssh tar` moves
datasets and database together in one pass.

**`container_name: scrollsurf-app` is a contract across two repos.** The compose
file here pins it; `sites/scrollsurf.caddy` in box-caddy points at it. Renaming
one without the other silently breaks prod. A compose-generated DNS name will not
do — on a network shared between projects, two projects each with an `app`
service would collide.

**Declaring `networks:` on a service disables the implicit default.** The moment
the app service names any network, compose stops attaching it to the project's
own default one. It must list `default` alongside `caddy_net` or it quietly loses
the network it already had.

**Order matters on the first bring-up, and getting it wrong hurts other people's
sites.** Caddy fails a *whole config* reload if it cannot resolve an upstream. A
`scrollsurf.caddy` pointing at a container that does not exist yet would block
every unrelated box-caddy change until it was fixed — butterfry's and
nextcloud's included. So the app goes up on the box first, gets verified
reachable over `caddy_net`, and only then does the site file land. This is
exactly the hazard the header comment in `sites/nextcloud.caddy` documents.

**Prefer `reload` over `deploy` in box-caddy.** `deploy` runs `compose up`, which
can recreate the Caddy container and drop every tenant on the box for a moment.
`reload` swaps the config in place.

**Never touch the `box-caddy_caddy_data` volume.** It holds the Let's Encrypt
certificates and account key, against a limit of 5 duplicate certificates per
week. Nothing in this plan needs to go near it; issuing one new certificate for a
new hostname is routine and happens by itself.

**No Dockerfile change is needed.** The image is already architecture-agnostic,
already listens on 3000, already runs as uid 1000 (`node`), and already bakes in
`SCROLLSURF_DATA_DIR=/data`. The only consequence is that `/srv/scrollsurf/prod`
on the box must be owned `1000:1000`, same as on the Pi.

**There will be downtime.** Between stopping the Pi stack and reloading Caddy
there is a tar of ~1.3G over the internet and a remote Next.js build. Prod is
unreachable for that window. Accepted — this is a hobby project with a handful of
users, and sequencing around it would mean copying the database twice.

**The Pi's prod data is left in place.** Nothing in this plan deletes it, which
is what makes rollback cheap: revert the commits, put the `TS_*` keys back in
`.env.prod`, redeploy at the Pi.

**Known stale claim, deliberately left alone.** DEPLOY.md says every deploy runs
`npm run check` first. It does not — there is no such gate in `scripts/deploy.ts`.
Out of scope here; noting it so it is not mistaken for a regression introduced by
this plan.

## Implementation

### 1. `scripts/deploy.ts`

Keep the existing shape — one file, no `deploy_lib.ts` split. Butterfry has that
split because its deploy makes far more decisions; importing the pattern here
would be cargo-culting.

Replace the Pi assumptions with per-target values. `PI_SSH` becomes `SSH_HOST`,
and a new `DOCKER_CONTEXT` is read alongside it; both required, keeping the
existing error style:

```ts
const build_mode = target === 'prod' ? 'remote' : 'local'; // the box is amd64, the Pi is arm64
const platform = target === 'prod' ? 'linux/amd64' : 'linux/arm64';
const dc = `docker --context ${docker_context} compose -p ${project} --env-file ${env_file} -f ${compose_file}`;
```

The `arch() !== 'arm64'` guard moves inside the local-build branch — it describes
the Mac→Pi path only. Building becomes:

```ts
if (build_mode === 'local') {
  run(`docker build --platform ${platform} --build-arg COMMIT_ID=${commit_id} -t ${image} .`);
  run(`docker save ${image} | gzip | ssh ${ssh_host} docker load`);
} else {
  run(`docker --context ${docker_context} build --build-arg COMMIT_ID=${commit_id} -t ${image} .`);
}
```

Add a prod-only `check_caddy_net()` that runs `docker --context <ctx> network
inspect caddy_net` and, on failure, throws a message naming the fix
(`docker network create caddy_net`) and pointing at `~/code/box-caddy` — a bare
`compose up` against a missing external network fails with an error that says
nothing about how to repair it.

Delete: the `tailscale/serve.json` rsync, the `TS_AUTHKEY` requirement, the
post-`up` funnel status check, and the entire `funnel` command branch. The usage
string becomes `<up|down|logs> <test|prod>`.

### 2. `docker-compose.prod.yml`

Delete the `ts-scrollsurf` service and the `ts-state` volume. The app service
keeps its SMTP passthrough, its `${DATA_DIR_HOST}:/data` mount, `restart` and the
log-rotation block, and loses `network_mode`, `depends_on` and the `serve.json`
mount:

```yaml
services:
  app:
    image: scrollsurf-prod
    # The proxy's reverse_proxy target. Compose's generated DNS name would be
    # ambiguous on a network shared with other projects, so pin it.
    container_name: scrollsurf-app
    expose: ["3000"]
    # Naming any network turns off the implicit default one, so `default` has
    # to be listed too or the app silently loses the network it already had.
    networks: [default, caddy_net]

networks:
  # Created once on the box by hand: docker network create caddy_net
  caddy_net:
    external: true
```

### 3. `tailscale/serve.json`

Delete it — the directory's only file.

### 4. `package.json`

The `pi:` prefix is now wrong for half the targets:

| old | new |
| --- | --- |
| `pi:logs:test` / `pi:logs:prod` | `logs:test` / `logs:prod` |
| `pi:down:test` / `pi:down:prod` | `down:test` / `down:prod` |
| `pi:funnel` | *(removed)* |

`deploy:test` / `deploy:prod` keep their names.

### 5. Env files

`.env.example` (committed): `PI_SSH` → `SSH_HOST` plus `DOCKER_CONTEXT`, section
heading no longer says "Pi deploys", and the whole "Prod only" Tailscale block
goes.

`.env.prod` and `.env.test` are untracked and must be edited by hand — they will
not appear in any diff. Prod gets `SSH_HOST=box`, `DOCKER_CONTEXT=box`, and loses
`TS_AUTHKEY` / `TS_HOSTNAME`. Test gets `SSH_HOST=pi`, `DOCKER_CONTEXT=pi`, and
drops the `TS_*` keys it carries but never used. While in there, fix `.env.test`'s
`DATA_DIR_HOST` line — it has a trailing inline `#` comment, and the value is
interpolated straight into shell commands.

### 6. `~/code/box-caddy/sites/scrollsurf.caddy`

A sibling repo; this is a commit there, not here. No legacy-hostname redirect
block is needed — unlike butterfry, this name has no predecessor worth keeping
alive.

```caddyfile
scrollsurf.cornshakes.at {
	encode zstd gzip
	# Over caddy_net, by the container_name docker-compose.prod.yml pins in the
	# scrollsurf repo. Never localhost: Caddy's localhost is its own container.
	reverse_proxy scrollsurf-app:3000
}
```

`test/caddy_config.test.ts` already validates every site file generically — each
`reverse_proxy` upstream must look like `container:port` and must not be
localhost, a loopback address or a bare IP — so no new test is required. Add
`"scrollsurf.caddy"` to the existing `has a file per hosted site` assertion.

### 7. Docs

`DEPLOY.md` — replace the Tailscale one-time setup (admin console, MagicDNS,
ACLs, funnel acknowledgement, auth key) with the box setup: the docker context,
the `caddy_net` prerequisite, host directories, and a pointer to
`~/code/box-caddy/README.md` for the site file itself. Lead with the target
table:

| | test | prod |
| --- | --- | --- |
| host | the Pi (`ssh pi`, aarch64) | the box (`ssh box`, amd64) |
| access | plain HTTP, port 3001 | HTTPS via box-caddy, `scrollsurf.cornshakes.at` |
| build | local on the Mac, shipped over ssh | remote, on the box |
| compose project | `scrollsurf-test` | `scrollsurf-prod` |

Document the one-off data migration, and drop the "fallback: cross-build on the
laptop" section — it describes what the test path already does.

`README.md:3` — the Tailscale URL becomes `https://scrollsurf.cornshakes.at`.

`CLAUDE.md` — the tech-stack line says "deployed to a Raspberry Pi via
`scripts/deploy.ts`"; make it name both targets. Fix the command table's
`pi:logs` / `pi:funnel` / `pi:down` rows and drop `TS_*` from the feature-flag
table.

### 8. Cutover on the box

Not a code change. Run once, in this order:

```sh
ssh box 'mkdir -p /srv/scrollsurf/prod/datasets && chown -R 1000:1000 /srv/scrollsurf'

npm run pi:down:prod   # stop the Pi so the WAL is not written mid-copy

ssh pi 'tar -C /srv/scrollsurf/prod -czf - .' | ssh box 'tar -C /srv/scrollsurf/prod -xzf -'
ssh box 'rm -f /srv/scrollsurf/prod/serve.json && chown -R 1000:1000 /srv/scrollsurf'
```

Then `npm run deploy:prod`, verify the container answers over `caddy_net`, and
only then add the site file and reload the proxy.

### Tests

There is no unit-test surface here: `scripts/deploy.ts` is entirely shell
orchestration, and the compose and Caddy files are declarative. The one automated
check that does apply lives in the sibling repo, and the rest is manual
verification against the running box.

- `box-caddy: sites > has a file per hosted site`
- `box-caddy: sites > proxies each site to a container name, never to localhost`

Manual verification, in order:

1. `npm run check` — type-check and lint clean.
2. `npm run deploy:prod` — the `caddy_net` check passes, the build runs on the
   box, `scrollsurf-prod` comes up.
3. `docker --context box ps --filter name=scrollsurf-app` — running.
4. `docker --context box exec caddy wget -qO- http://scrollsurf-app:3000/ | head -c 200`
   — proves Caddy resolves the upstream *before* the site file exists. If this
   fails, adding the site file would break Caddy's whole config.
5. In `~/code/box-caddy`: `npm run check`, `npm test`, `npm run reload`.
6. `curl -I https://scrollsurf.cornshakes.at` — 200, valid certificate. The first
   request may take a few seconds while Let's Encrypt issues.
7. Open the site, scroll the feed, confirm a previously-liked article still reads
   as liked — this is the proof the vote history survived the move.
8. `npm run logs:prod` — no startup errors from `instrumentation.ts` (dataset
   imports, then the feed-index rebuild).
9. `curl -I https://butterfry.cornshakes.at` and `https://c.cornshakes.at` — the
   reload touched a shared proxy; confirm the other tenants still serve.
10. `npm run deploy:test` — the Pi path still builds locally and serves on 3001.
