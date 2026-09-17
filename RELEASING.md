# Releasing BagIdea Office

The in-app update notifier compares each user's local **`VERSION`** file with the
`VERSION` file on the **`main`** branch. Users only get a 🔄 "new version"
banner when those differ — so **a release is a deliberate `VERSION` bump on
`main`, not just any commit**.

This keeps two promises:

- Routine commits to `main` (docs, website, small fixes) never nag users.
- Users only ever update to code we've decided is ready to ship.

## Workflow

1. **Develop on `dev`** (or feature branches off `dev`). Push freely — the
   update check ignores everything except `main`'s `VERSION`, so nothing here
   reaches users.

2. **Merge to `main` when it's verified.** Merging alone does **not** trigger an
   update prompt as long as `VERSION` is unchanged. You can land several merges
   on `main` and still hold the release.

3. **Cut a release** when you're confident it's bug-free:
   - Bump `VERSION` (semver — `MAJOR.MINOR.PATCH`).
   - Commit + push to `main`.
   - Within ~6 h (or 90 s after a restart) every running office sees the newer
     `VERSION`, shows the 🔄 banner, and `bagidea update` pulls + rebuilds +
     relaunches.

## Versioning (semver)

- **PATCH** (`0.1.0 → 0.1.1`): bug fixes, copy, no behaviour change for users.
- **MINOR** (`0.1.0 → 0.2.0`): new features, backward compatible.
- **MAJOR** (`0.1.0 → 1.0.0`): breaking changes (data format, removed commands).

## Checklist before bumping VERSION

- [ ] `dev` merged to `main`, working tree clean.
- [ ] Automated tests pass — the same bar CI holds every PR to:
      `node --test $(ls daemon/tests/*.test.js | grep -v meetings.test.js)`.
      `meetings.test.js` is excluded there because it drives a real agent and
      needs a brain CI doesn't have — run it here if you touched meetings:
      `npm run test:meetings`.
- [ ] Daemon boots clean: `node daemon/server.js` (no errors), or `bagidea restart`.
- [ ] Shell builds: `cargo build --release` in `shell/`. This only proves the
      code for **this** OS — `#[cfg(target_os = ...)]` blocks for the others are
      parsed but never type-checked. CI (`.github/workflows/ci.yml`) builds all
      three on every PR and on every push to `main`; check it is green for the
      commit you are about to tag.
- [ ] Godot scene loads: `godot/bin/BagIdeaOffice.exe --headless --check-only --quit`
      (only "leaked at exit" RID lines are fine — no `SCRIPT ERROR` / `Parse Error`).
- [ ] Docs/README reflect the changes.
- [ ] Add a `CHANGELOG.md` entry for the new version.
- [ ] Bump `VERSION`, commit `release: vX.Y.Z`, push `main`.
