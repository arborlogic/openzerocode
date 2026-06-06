# Development

## Common commands

```bash
npm run start      # run the TUI
npm run dev        # watch-mode TUI development
npm run typecheck  # TypeScript checks
```

For targeted tests, prefer:

```bash
npx tsx --test <file>
```

Avoid using `npm test` as a default smoke test because some provider-facing tests require environment variables such as `OPENCODE_API` or `OPENCODE_API_KEY`.

## Release SOP

Release automation has two parts:

- `scripts/release.ts` prepares the local release commit and git tag.
- `.github/workflows/build.yml` builds release artifacts, creates/updates the GitHub Release, and publishes npm packages when a `v*` tag is pushed.

### Prepare a release locally

Run the release script from a clean working tree. It accepts a bump type (`patch`, `minor`, `major`) or an explicit stable semver version.

```bash
npm run release -- patch       # next patch version
npm run release -- minor       # next minor version
npm run release -- major       # next major version
npm run release -- 0.4.3       # explicit version

# Convenience aliases:
npm run release:patch
npm run release:minor
npm run release:major
```

By default, the script:

1. checks the working tree is clean;
2. calculates and validates the next version;
3. rejects versions that are not greater than the current package version;
4. rejects an existing git tag for the target version;
5. updates `package.json`, `package-lock.json` if present, and `CHANGELOG.md`;
6. runs `npm run typecheck`;
7. creates a release commit named `chore: release v<version>`;
8. creates the local `v<version>` git tag.

Useful options:

```bash
npm run release -- patch --dry-run     # show planned actions without changing files
npm run release -- patch --no-verify   # skip npm run typecheck
npm run release -- patch --push        # also push the commit and tag to origin
npm run release -- patch --remote fork # use a different git remote with --push
```

After a release script run without `--push`, publish by pushing both the release commit and tag:

```bash
git push origin HEAD
git push origin v0.4.3
```

You can also let the script push both in one run:

```bash
npm run release -- patch --push
```

### CI release behavior

Tag pushes matching `v*` trigger GitHub Actions automatically. Current workflow behavior on a tag push:

- builds root and platform npm package tarballs for supported targets;
- builds direct binary archives for GitHub Releases;
- creates a GitHub Release for the tag;
- publishes npm packages automatically.

npm publishing publishes platform packages first and then the root `openzerocode` package, skipping versions that already exist.

### Manual workflow reruns

If the release workflow fails and you only need to rerun it, use the GitHub Actions `workflow_dispatch` trigger.

- This does **not** require another version bump or another release script run.
- If you want the manual run to rerun npm publishing, enable the publish input (`publish_to_npm=true`).
- If you want it to create or update a GitHub Release, provide the existing release tag (for example `v0.4.3`) and enable the release input.
- Leave the tag blank if you only want to rebuild artifacts without creating a release.
