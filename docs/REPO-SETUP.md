# Publish the standalone repo

The code package is not a remote GitHub repository. Create one with GitHub CLI after authenticating:

```bash
cd hospital-fabric
git init -b main
git add .
git commit -m 'feat: scaffold offline hospital integration fabric'
gh repo create gmackie/hospital-fabric --private --source=. --remote=origin --push
```

If the remote repository already exists, do not run `gh repo create`; add that remote and push a reviewed branch/PR instead.

CI runs the SQLite schema checks and attempts to install dependencies and run TypeScript/synthetic fault tests. Verify against `celld dev` and local workerd separately. The `forge/` model is a **draft** and is not run by CI yet.
