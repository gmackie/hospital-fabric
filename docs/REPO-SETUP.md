# Repository and acceptance checks

The standalone repository is https://github.com/gmackie/hospital-fabric. Publish reviewed branches/PRs to that existing repository.

GitHub CI runs SQL integrity, TypeScript/build, synthetic fault tests, workerd crash/restart recovery, Chromium console scenarios, pinned Forge check/build with isolated generated SQL, and pinned celld crash/restart/local-bucket restore acceptance. Run the commands in [the weekend checklist](WEEKEND-ACCEPTANCE.md) to reproduce them locally.

The ForgeGraph app registry identity is in `.forgegraph.yaml`. GitHub repository/CI and Cloudflare production evidence synchronization remain HF-2 work; this file does not configure deployment or automatic issue closure. Generated Forge schemas remain isolated from authoritative live tables.
