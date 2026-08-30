# Tasks

# [Plan 1 — Move prod from the Pi to the box](plan-1.md)

1. Make host, docker context and build mode per-target in scripts/deploy.ts [x]
2. Turn the prod compose file into a caddy tenant [x]
3. Drop Tailscale from the deploy script and delete tailscale/serve.json [x]
4. Rename the pi:\* npm scripts and update .env.example [x]
5. Add sites/scrollsurf.caddy to the box-caddy project [x]
6. Update DEPLOY.md, README.md and CLAUDE.md [x]
7. Cut over on the box [x]

## Notes

- Task 5 lands in `~/code/box-caddy`, a sibling repo outside this one. It
  produces a commit there, not here.

- **Tasks 1–3 must land together or the tree is briefly undeployable.** Task 1
  rewrites the build and context handling, task 2 removes the Tailscale sidecar
  from the compose file, and task 3 removes the code that rsyncs a serve config
  for it. They are separate commits only because they touch disjoint files; do
  not stop after one and walk away.

- Task 1 is the only task with real thinking in it. The two things to get right:
  the `arch() !== 'arm64'` guard has to move *inside* the local-build branch (it
  describes the Mac→Pi path, not the box), and prod must not run
  `docker save | ssh docker load` at all — a remote build leaves the image
  already on the box, and shipping it would be a pointless ~1GB round trip.

- Task 4 also edits `.env.prod` and `.env.test`, which are untracked. Those edits
  will not show up in the diff, and skipping them means `deploy.ts` reads
  `SSH_HOST` from a file that still only defines `PI_SSH` — it will fail
  immediately, which is at least loud. Do them anyway.

- Task 4 is also where `.env.test`'s `DATA_DIR_HOST` inline `#` comment gets
  fixed. `process.loadEnvFile` strips it, but the value is interpolated straight
  into shell commands, so a stray trailing space there is a landmine.

- **Task 5 must not land before task 7 has the app running on the box.** Caddy
  fails a whole-config reload when it cannot resolve an upstream, so a
  `scrollsurf.caddy` pointing at a container that does not exist yet would block
  every unrelated box-caddy change — butterfry's and nextcloud's included. Write
  the file in task 5 if you like, but do not `npm run reload` until the container
  answers. `sites/nextcloud.caddy`'s header comment in that repo documents the
  same trap.

- Task 7 is not a code change and produces no commit beyond whatever fixes it
  forces. It needs the host directories on the box and the database copy.

- **The database copy in task 7 is the part to be careful about.** The Pi's
  `scrollsurf.db` is 623MB of real user votes and click history — the only thing
  in this move that cannot be regenerated. Stop the Pi stack first so the WAL is
  not being written mid-copy, and copy `-wal` and `-shm` along with it (a plain
  `tar` of the whole directory does this). Nothing in the plan deletes the Pi's
  copy, so it stays as the rollback.

- The acceptance criterion for the whole plan is step 7 of the plan's manual
  verification: a previously-liked article still reads as liked at
  `https://scrollsurf.cornshakes.at`. Everything else can pass with an empty
  database — that check is the one that proves the history came across.

- After the reload, check butterfry and nextcloud still serve. The reload touched
  a proxy shared with them, and a mistake there is not scrollsurf's problem alone.
