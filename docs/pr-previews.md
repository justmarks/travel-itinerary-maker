# PR Preview Deployments

Every pull request gets a self-contained preview deployment. After CI
finishes, the bot comments on the PR with a link like:

```
https://justmarks.github.io/travel-itinerary-maker/previews/pr-89/
```

Open that on a phone (or in DevTools at 430×956 to simulate a Pixel 10 XL)
to test the PR's changes against the same data the main site uses. Append
`?demo=true` for a no-auth walkthrough.

The preview directory is removed automatically when the PR is merged or
closed.

## How it works

Three workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `pages.yml` | push to `main` | Builds with `NEXT_PUBLIC_BASE_PATH=/travel-itinerary-maker` and pushes to `gh-pages:/`. Uses `keep_files: true` so live previews aren't wiped. |
| `pr-preview.yml` | PR opened / synchronize / reopened | Builds with `NEXT_PUBLIC_BASE_PATH=/travel-itinerary-maker/previews/pr-NN`, pushes to `gh-pages:/previews/pr-NN/`, comments the URL on the PR. |
| `pr-preview-cleanup.yml` | PR closed | Removes `previews/pr-NN/` from `gh-pages` and updates the bot comment. |

`apps/web/next.config.ts` reads `NEXT_PUBLIC_BASE_PATH` first (falling back
to `/travel-itinerary-maker` for production builds). The same env var is
read by `apps/web/src/app/layout.tsx` for `apple-touch-icon` and by
`apps/web/scripts/postbuild.mjs` to template the `__BASE_PATH__`
placeholder in `scripts/404.html`.

## One-time repo setup

The workflows publish to a `gh-pages` branch. GitHub Pages must be told
to serve from that branch:

1. Repo **Settings → Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `gh-pages` · Folder: `/ (root)`
4. Save

If you previously had Pages set to `GitHub Actions` (the artifact-based
deployment used by the old `pages.yml`), this change supersedes it.

## Limits and gotchas

- **Forks don't get previews.** The workflow needs `contents: write` on
  `gh-pages` and access to `NEXT_PUBLIC_*` secrets, neither of which
  forked PRs receive. The `if:` guard at the top of the job skips them.
- **OAuth doesn't work in previews.** Each preview lives at a unique URL
  not registered as a Google OAuth redirect. Use `?demo=true` to test
  signed-in flows without auth — the demo client serves the same shape of
  data as the real backend.
- **Concurrency.** A new push to a PR cancels the in-flight preview build
  for that PR; main deploys queue rather than cancel.
- **Cleanup of legacy previews.** If the cleanup workflow misses a PR
  (e.g. closed before this infra existed), delete the directory manually:
  ```bash
  git fetch origin gh-pages
  git checkout -B gh-pages origin/gh-pages
  git rm -rf previews/pr-XX
  git commit -m "preview: clean up PR #XX"
  git push origin gh-pages
  ```
