# Deploying scrollsurf

Local-only pipeline: laptop → remote host over SSH using Docker Compose.
No GitHub Actions, no online registry, no AWS.

|                 | test                            | prod                                              |
| --------------- | ------------------------------- | ------------------------------------------------- |
| host            | the Pi (`ssh pi`, aarch64)      | the box (`ssh box`, amd64)                        |
| access          | plain HTTP, port 3001 (LAN)     | HTTPS via box-caddy, `scrollsurf.cornshakes.at`   |
| build           | local on the Mac, shipped over ssh | remote, on the box                             |
| compose project | `scrollsurf-test`               | `scrollsurf-prod`                                 |

The two stacks run on different machines with separate data directories, so test
votes never touch prod data.

Prod is one tenant behind the shared Caddy proxy that lives in its own repo at
`~/code/box-caddy`. The proxy owns 80 and 443, terminates TLS, and reaches each
tenant by container name over a shared `caddy_net` network.

---

## Prerequisites

- **Laptop**: Docker Desktop with buildx, Node 24+, rsync, SSH key auth to both hosts
- **Pi / box**: Docker installed, SSH enabled, internet access

---

## One-time setup

### 1. Docker contexts

```sh
docker context create pi  --docker "host=ssh://pi@raspberrypi.local"
docker context create box --docker "host=ssh://box"
docker context ls   # confirm both appear
```

Replace the SSH addresses with your actual ones, and make sure key auth works
(`ssh pi` / `ssh box` should not ask for a password) — both the deploy script and
the Docker context depend on it.

### 2. Host data directories

The container runs as uid 1000 (`node`), so the bind-mounted directories must be
owned by that user.

On the Pi (test):

```sh
sudo mkdir -p /srv/scrollsurf/test/datasets
sudo chown -R 1000:1000 /srv/scrollsurf
```

On the box (prod):

```sh
ssh box 'mkdir -p /srv/scrollsurf/prod/datasets && chown -R 1000:1000 /srv/scrollsurf'
```

### 3. The `caddy_net` network on the box

Prod attaches to an external network the proxy also joins. It is created once, by
hand, and `npm run deploy:prod` refuses to run without it:

```sh
docker --context box network create caddy_net
```

### 4. The site file in box-caddy

Prod is reachable from the internet only once `~/code/box-caddy/sites/scrollsurf.caddy`
exists and the proxy has reloaded. See `~/code/box-caddy/README.md` for how that
repo works.

> [!IMPORTANT]
> Add the site file **after** the app is running on the box, never before. Caddy
> fails a *whole config* reload when it cannot resolve an upstream, so a site file
> pointing at a container that does not exist yet blocks every unrelated
> box-caddy change until it is fixed — the other tenants' included.

Prefer `npm run reload` over `npm run deploy` in that repo: `deploy` runs
`compose up`, which can recreate the Caddy container and drop every tenant on the
box for a moment, while `reload` swaps the config in place.

### 5. Env files

Copy `.env.example` to the three environment files and fill in the values:

```sh
cp .env.example .env.local    # dev (Next.js auto-loads this)
cp .env.example .env.test
cp .env.example .env.prod
```

Minimum values per file:

**.env.local** (local dev):

```
SCROLLSURF_DATA_DIR=.
```

**.env.test**:

```
SSH_HOST=pi
DOCKER_CONTEXT=pi
DATA_DIR_HOST=/srv/scrollsurf/test
TEST_PORT=3001
SCROLLSURF_DATA_DIR=.
```

**.env.prod**:

```
SSH_HOST=box
DOCKER_CONTEXT=box
DATA_DIR_HOST=/srv/scrollsurf/prod
SCROLLSURF_DATA_DIR=.
```

`DATA_DIR_HOST` is interpolated straight into shell commands — no trailing
inline `#` comments on that line.

All three files are gitignored. Only `.env.example` is committed.

---

## Everyday deploy workflow

```sh
# Deploy to test (LAN only):
npm run deploy:test
# → app running at http://<pi>:3001

# Deploy to prod (public HTTPS):
npm run deploy:prod
# → app running at https://scrollsurf.cornshakes.at

# Tail logs:
npm run logs:test
npm run logs:prod

# Tear down a stack:
npm run down:test
npm run down:prod
```

Each deploy:

1. For prod only, checks that `caddy_net` exists on the box and fails with the fix
   if it does not.
2. Rsyncs `datasets/` into the host data dir. If the local `datasets/` directory
   has no `*.db` files, this step is skipped with a warning (so the deploy still
   works on a fresh checkout, and an empty `datasets/` never wipes the remote copy
   via `--delete`). Run the `download-*` scripts first if the app should have
   content.
3. Builds the image and starts the stack — see below.

Datasets and code deploys are independent: re-deploying without changing datasets
is fast because rsync only transfers diffs.

`npm run check` is **not** run automatically by either deploy. Run it yourself
first.

### The two build paths

**Test** builds on the Mac for `linux/arm64` and ships the image to the Pi over
`docker save | gzip | ssh docker load`. This requires an ARM64 Mac; the deploy
fails fast on anything else.

**Prod** builds remotely, on the box, via the `box` Docker context. The box is
amd64 and the Mac is not, and a remote build leaves the image exactly where it is
needed — so there is no `docker save`/`load` round trip for prod.

### First prod deploy

The certificate is Let's Encrypt over HTTP-01, issued by box-caddy the first time
the hostname is requested. The first request may take a few seconds while it
issues.

Never touch the `box-caddy_caddy_data` volume — it holds the Let's Encrypt
certificates and account key, against a limit of 5 duplicate certificates per
week.

---

## One-off: moving the prod database between hosts

`scrollsurf.db` holds real user votes and click history and is the one thing in a
host move that cannot be regenerated — the datasets can be re-downloaded and the
image rebuilt, but the votes cannot.

Stop the stack first so the WAL is not being written mid-copy, and carry the
`-wal` and `-shm` siblings along with it (a `tar` of the whole directory does
this):

```sh
npm run down:prod

ssh <old-host> 'tar -C /srv/scrollsurf/prod -czf - .' \
  | ssh <new-host> 'tar -C /srv/scrollsurf/prod -xzf -'
ssh <new-host> 'chown -R 1000:1000 /srv/scrollsurf'
```

Leave the source copy in place — it is the rollback.

---

## Adding build/test gates

`npm run check` is the natural gate to extend:

```json
"check": "npm run type-check && npm run lint && npm test"
```

No pipeline restructure required — just extend the `check` script.
