# Deploying scrollsurf

Local-only pipeline: laptop → Raspberry Pi over SSH using Docker Compose.
No GitHub Actions, no online registry, no AWS.

- **Prod**: public HTTPS via Tailscale Funnel (`https://<hostname>.<tailnet>.ts.net`)
- **Test**: LAN-only at `http://<pi>:3001`

Both stacks run on the same Pi with separate data directories, so test votes never
touch prod data.

---

## Prerequisites

- **Laptop**: Docker Desktop with buildx, Node 24+, rsync, SSH key auth to the Pi
- **Pi**: Docker installed, SSH enabled, internet access

---

## One-time setup

### 1. Tailscale admin console

Visit https://login.tailscale.com/admin and complete these three steps.

**Enable DNS features** (Settings → DNS):
- Turn on **MagicDNS**
- Turn on **HTTPS Certificates**

**Grant Funnel access** (Access controls → Edit ACLs) — add:
```jsonc
"tagOwners": {
  "tag:scrollsurf": ["autogroup:admin"]
},
"nodeAttrs": [
  { "target": ["tag:scrollsurf"], "attr": ["funnel"] }
]
```

**Create an auth key** (Settings → Keys → Generate auth key):
- Reusable: ✓
- Pre-approved: ✓
- Tags: `tag:scrollsurf`

Copy the key — you will put it in `.env.prod` as `TS_AUTHKEY`.

### 2. Pi — create data directories

SSH into the Pi and run once:

```sh
sudo mkdir -p /srv/scrollsurf/prod/datasets /srv/scrollsurf/test/datasets
sudo chown -R 1000:1000 /srv/scrollsurf
```

The container runs as uid 1000 (`node`), so the bind-mounted directories must be
owned by that user.

### 3. Laptop — create a Docker context for the Pi

```sh
docker context create pi --docker "host=ssh://pi@raspberrypi.local"
docker context ls   # confirm 'pi' appears
```

Replace `pi@raspberrypi.local` with your actual Pi SSH address. Ensure SSH key
auth works (`ssh pi@raspberrypi.local` should not ask for a password).

### 4. Env files

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
PI_SSH=pi@raspberrypi.local
DATA_DIR_HOST=/srv/scrollsurf/test
TEST_PORT=3001
SCROLLSURF_DATA_DIR=.   # not used by deploy script, but needed if running locally against test
```

**.env.prod**:
```
PI_SSH=pi@raspberrypi.local
DATA_DIR_HOST=/srv/scrollsurf/prod
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=scrollsurf
SCROLLSURF_DATA_DIR=.
```

All three files are gitignored. Only `.env.example` is committed.

---

## Everyday deploy workflow

```sh
# Deploy to test (LAN only):
npm run deploy:test
# → app running at http://<pi>:3001

# Deploy to prod (public HTTPS):
npm run deploy:prod
# → app running at https://scrollsurf.<tailnet>.ts.net

# Check the public Funnel URL:
npm run pi:funnel

# Tail logs:
npm run pi:logs:test
npm run pi:logs:prod

# Tear down a stack:
npm run pi:down:test
npm run pi:down:prod
```

Each deploy:
1. Runs `npm run check` (type-check + lint) — fails fast if the code is broken
2. Rsyncs `datasets/` into the Pi data dir. If the local `datasets/` directory has
   no `*.db` files, this step is skipped with a warning (so the deploy still works
   on a fresh checkout, and an empty `datasets/` never wipes the remote copy via
   `--delete`). Run the `download-*` scripts first if the app should have content.
3. Builds the Docker image on the Pi (ARM-native via the SSH context) and starts the stack

Datasets and code deploys are independent: re-deploying without changing datasets
is fast because rsync only transfers diffs.

### First prod deploy

The first time prod starts, Tailscale provisions an HTTPS certificate — this takes
up to ~60 seconds. The app is reachable once `npm run pi:funnel` shows the public
URL as active.

---

## Adding build/test gates

`npm run check` is the single gate both deploys depend on. To add steps:

```json
"check": "npm run type-check && npm run lint && npm test"
```

No pipeline restructure required — just extend the `check` script.

---

## Fallback: cross-build on the laptop (if Pi OOMs)

If the Pi runs out of memory during the Docker build:

```sh
# Build for ARM64 on the laptop:
docker buildx build --platform linux/arm64 -t scrollsurf:latest --load .

# Ship the image to the Pi:
docker save scrollsurf:latest | ssh pi@raspberrypi.local docker load
```

Then change `build: .` → `image: scrollsurf:latest` in the compose file and
re-run the deploy. No Pi host changes required.
