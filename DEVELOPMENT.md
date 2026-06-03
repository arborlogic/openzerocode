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

Current release automation lives in `.github/workflows/build.yml`.

1. Bump the root package version first:

   - `package.json`
   - `package-lock.json`

   Example: set package version to `0.3.9` before creating tag `v0.3.9`.

2. Run verification:

   ```bash
   npm run typecheck
   node scripts/create-platform-packages.mjs
   ```

3. Merge the release commit to `main`.

4. Create and push the release tag:

   ```bash
   git tag v0.3.9
   git push origin v0.3.9
   ```

5. Tag pushes matching `v*` trigger GitHub Actions automatically.

6. Current workflow behavior on a tag push:

   - builds root and platform npm package tarballs for supported targets
   - builds direct binary archives for GitHub Releases
   - creates a GitHub Release for the tag
   - publishes npm packages automatically

7. npm publishing publishes platform packages first and then the root `openzerocode` package, skipping versions that already exist. To rerun npm publishing manually from Actions, run `.github/workflows/build.yml` with `publish_to_npm=true`.

## Manual workflow reruns

If the release workflow fails and you only need to rerun it, you can use the GitHub Actions `workflow_dispatch` trigger.

- This does **not** require another version bump.
- If you want the manual run to rerun npm publishing, enable the publish input.
- If you want it to create a GitHub Release, provide the existing release tag (for example `v0.3.9`) and enable the release input.
- Leave the tag blank if you only want to rebuild artifacts without creating a release.
