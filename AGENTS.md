# Project rules

## Hosting policy

- Host Care Finder Aotearoa on the existing finnerty.me hosting service at
  https://finnerty.me/care-finder/.
- GitHub is for source control, issues, pull requests and validation only.
  Do not enable GitHub Pages, deploy to github.io, add a Pages publishing
  workflow or use GitHub Pages behind a custom domain.
- A request to push code or publish a repository does not authorise website
  hosting on GitHub. Keep GitHub Pages disabled unless the user explicitly
  changes this policy.
- Build only the public allowlisted files with `npm run build`. Deploy the
  contents of `outputs/site/` to the dedicated care-finder directory, never
  to the finnerty.me document root. Preserve the portfolio and source archive.
- Use the existing owned-hosting deployment process, exact target checks,
  backups before overwrites and live verification. Never commit credentials.
- Keep the visible status "In development". Do not describe the project as
  a soft launch or pilot.

## Validation

Run `npm run validate`, `npm test`, `npm run build` and `git diff --check`
before publishing. Provider data publication remains separately gated.
