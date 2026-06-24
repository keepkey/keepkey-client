# Release SOP — KeepKey Client

How a version of the browser extension goes from `develop` to a shipped,
built release. Follow this top to bottom; the steps are ordered for a reason
(skipping the last one is what caused `develop` and `master` to diverge in
the past — see **Lesson** at the bottom).

## Branch model

- **`develop`** — integration branch. All feature/fix work lands here via PR.
- **`master`** — released code. Only ever updated by a release PR from a
  `release/x.y.z` branch, and then synced back into `develop`.
- Never push directly to `develop` or `master`. Everything goes through a PR.

## CI gates (all headless, must be green before merge)

| Check | Command | Runs on |
|---|---|---|
| Unit tests + type-check | `make test`, `make type-check` | PRs + pushes to `master`/`develop` |
| Lint | `make lint` | PRs + pushes to `master` |
| Prettier | — (`prettier-cli-action`) | PRs + pushes to `master` |
| Build + zip artifact | `make build` | PRs + pushes to `master` |

**E2E is _not_ a CI gate.** It drives the extension against a physically
connected KeepKey, which GitHub's headless runners don't have, so it can
never pass in CI. `e2e.yml` is `workflow_dispatch` (manual) — run it locally
with `make e2e` / `make e2e-firefox`, or from the Actions tab on a machine
with a device attached.

> Note: there is currently **no branch protection** on `master`, so green CI
> is enforced by convention, not by GitHub. Don't merge red.

## Release steps

1. **Confirm `develop` is green** (the release ships whatever is on `develop`):
   ```bash
   make type-check && make test && make lint && make prettier && make build
   ```

2. **Cut the release branch** off `develop`:
   ```bash
   git checkout develop && git pull --ff-only
   git checkout -b release/x.y.z
   ```

3. **Bump the version** across every `package.json` (the manifest derives its
   version from `package.json`, so it updates automatically):
   ```bash
   make bump VERSION=x.y.z
   git diff   # eyeball: only "version" fields should change
   git commit -am "chore(release): bump to x.y.z"
   ```
   > `make bump` runs `update_version.sh`, which does a global substitution of
   > the old version string in each `package.json`. Eyeball the diff — if any
   > dependency happened to be pinned at the old version string it would also
   > be rewritten (rare, but check).

4. **Open the release PR** `release/x.y.z` → `master`, get CI green, **merge**.
   ```bash
   git push -u origin release/x.y.z
   gh pr create --base master --head release/x.y.z --title "chore(release): x.y.z"
   ```
   The `master` ↔ `develop` merge only conflicts on the `package.json` version
   strings — resolve them to the new version.

5. **Tag** the merge commit on `master` and push the tag:
   ```bash
   git checkout master && git pull --ff-only
   git tag vx.y.z && git push origin vx.y.z
   ```

6. **Build the distributables**:
   ```bash
   make zip          # Chrome  → dist-zip/extension.zip
   make zip-firefox  # Firefox → dist-zip/extension.zip (rename when attaching)
   ```

7. **Create the GitHub Release** for `vx.y.z` and attach both zips:
   ```bash
   gh release create vx.y.z --title "vx.y.z" --notes "..." \
     chrome-extension.zip firefox-extension.zip
   ```

8. **Sync `master` back into `develop`** ← do not skip this:
   ```bash
   gh pr create --base develop --head master --title "chore: sync master x.y.z back into develop"
   ```
   Merge it. This keeps the branches from re-diverging.

## Lesson (why step 8 matters)

`master` once received a fix (#64, dropping the `chrome.alarms` permission to
avoid a Chrome Web Store re-consent wall) that was **never synced back into
`develop`**. `develop` kept carrying the old `alarms` code for weeks, so it
looked like `develop` "intentionally re-added" a permission `master` had
deliberately removed. The next release's merge silently resolved it back to
`master`'s version — correct, but only by luck. Always complete step 8 so the
branches agree and the next release merge has nothing surprising to resolve.
