# Releasing

Capricorn is **not published yet**. Nothing in this repository publishes to npm,
GitHub Releases, Homebrew or a container registry automatically; every step
below is run by a maintainer with their own credentials.

## Versioning

Semantic Versioning. During `0.x`, minor versions may contain breaking changes;
they are called out in `CHANGELOG.md`. Pre-releases use `-alpha.N`, `-beta.N`,
`-rc.N`.

The version lives in the root `package.json` and every workspace `package.json`
(kept identical). `capricorn --version` reads it.

## Procedure

1. Work through [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) on a clean checkout
   of the release commit.
2. Update `CHANGELOG.md` (move "Unreleased" under the new version and date).
3. Set the version everywhere:
   `npm version <x.y.z> --no-git-tag-version --workspaces --include-workspace-root`
4. `npm ci && npm run build && npm run bundle`
5. Verify: unit tests, `npm run test:e2e:capricorn`, `npm run verify:offline`
   (Linux), `node scripts/capricorn/pack-smoke.js`, and the real-model smoke
   test on at least one machine per supported OS.
6. Inspect the package: `npm pack --dry-run` — only `bundle/`, `README.md`,
   `LICENSE`, `NOTICE` and `package.json` should be listed.
7. Generate an SBOM:
   `npm sbom --sbom-format cyclonedx > capricorn-<x.y.z>.cdx.json` and review
   `npm audit --omit=dev`.
8. Commit, tag `v<x.y.z>`, push the tag.
9. Publish (manual): flip `"private": true` to `false` in the **root**
   `package.json` only after the package name is confirmed available and owned,
   then `npm publish --access public` (add `--tag next` for pre-releases).
   Workspace packages stay private.
10. Create the GitHub release with the changelog section, the SBOM and the
    real-model smoke results.

## Rollback

`npm deprecate capricorn-cli@<bad-version> "<reason>"` and publish a fixed patch
release. Do not unpublish versions others may depend on.
