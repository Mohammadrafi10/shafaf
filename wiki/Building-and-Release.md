# Building and Release

How to build **شفاف (Shafaf)** locally and how the GitHub release workflow works.

---

## Local Builds

### Desktop (Windows)

```bash
npm run build
npm run tauri build
```

- **NSIS installer**: `src-tauri/target/release/bundle/nsis/`  
- Other bundles (app, dmg, appimage) depend on `tauri.conf.json` and the platform.

## GitHub Release Workflow

The workflow in `.github/workflows/release.yml` runs on **version tags** `v*` (e.g. `v6.3.2`).

### Flow

1. **build-windows** (runs first):
   - Checkout, Node 20, Rust, `npm ci`, `npm run build`
   - `tauri-action` builds the NSIS bundle and **creates the GitHub release** with the Windows `.exe`
   - Logs: `Release URL: https://github.com/OWNER/REPO/releases/tag/TAG`

2. **build-android** (`needs: [build-windows]`):
   - Checkout, Node, Java 17, Android SDK, Rust, Android targets, `cargo-ndk`, `npm ci`, `npm run build`
   - `tauri android init` if `src-tauri/gen/android` is missing
   - Creates a **CI keystore** in `src-tauri/gen/android/ci.keystore`
   - `npm run tauri android build` with `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
   - **action-gh-release** uploads APK and AAB to the **same** release
   - Logs: `Release URL: https://github.com/OWNER/REPO/releases/tag/TAG`

### Creating a Release

1. **Bump version** in `package.json` and `src-tauri/Cargo.toml` (and `tauri.conf.json` if it’s the source of truth) to the same value, e.g. `6.3.3`.

2. **Commit and tag**:
   ```bash
   git add .
   git commit -m "Bump version to 6.3.3"
   git tag v6.3.3
   git push origin v6.3.3
   ```
   Or: `git push --tags` if the tag is created locally.

3. The workflow runs on push of `v*`. The **Release** is created/updated with:
   - Windows: NSIS `.exe`
   - Android: APK and AAB

### Permissions

- Both jobs use `permissions: contents: write` so `tauri-action` and `action-gh-release` can create/update the release and upload artifacts.
- `GITHUB_TOKEN` is provided by GitHub Actions; no extra secrets are required for this.

### Artifacts

| Platform | Artifacts |
|----------|-----------|
| Windows | NSIS `.exe` in the release |
| Android | APK and AAB in the release |

---

## Tag Format

- Use `v` + semver, e.g. `v6.3.2`, `v6.3.3`.  
- The workflow `tagName` is `${{ github.ref_name }}`, so the tag and the release name/body are based on that.

---

## Related

- [.github/RELEASE_GUIDE.md](../.github/RELEASE_GUIDE.md)  
- [Android Setup](Android-Setup)  
- [Troubleshooting](Troubleshooting)  
