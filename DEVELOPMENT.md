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

   Example: set package version to `0.3.2` before creating tag `v0.3.2`.

2. Run verification:

   ```bash
   npm run typecheck
   node scripts/create-platform-packages.mjs
   ```

3. Merge the release commit to `main`.

4. Create and push the release tag:

   ```bash
   git tag v0.3.2
   git push origin v0.3.2
   ```

5. Tag pushes matching `v*` trigger GitHub Actions automatically.

6. Current workflow behavior on a tag push:

   - builds platform packages for supported targets
   - publishes platform packages such as `@openzerocode/linux-x64`
   - creates a GitHub Release for the tag

7. Current limitation:

   - the workflow does **not** publish the root `openzerocode` package yet
   - if you need `npm install -g openzerocode` to work from npm, publish the root package from `npm/` separately after platform packages are available

## Manual workflow reruns

If the release workflow fails and you only need to rerun it, you can use the GitHub Actions `workflow_dispatch` trigger.

- This does **not** require another version bump.
- If you want the manual run to publish to npm, enable the publish input.
- If you want it to create a GitHub Release, provide the existing release tag (for example `v0.3.2`) and enable the release input.
- Leave the tag blank if you only want to rebuild artifacts without creating a release.
