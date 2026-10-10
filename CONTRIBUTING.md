# Contributing

Thanks for helping improve Jev. Issues and pull requests should be written in English so maintainers and users can review them.

## Before opening a pull request

1. Create a branch for your change.
2. Keep the change focused and update the documentation when behavior changes.
3. Run the plugin validator and test suite:

   ```sh
   claude plugin validate .
   claude plugin test .
   npx --yes --package typescript tsc --noEmit
   node --test tests/sift-cli.test.mjs
   ```

4. If the change touches what the mod draws, compare the screens before and after it (see below).
5. Review the staged diff and confirm that it contains no credentials or private data.
6. Include a concise summary and validation results in the pull request.

## Screen captures

`scripts/screens.ts` draws the band above the prompt and every `/jev` tab as text, at a few widths, for a git ref and for your working tree, and shows which screens changed (Node 22.18+):

```sh
node scripts/screens.ts                      # before = HEAD, after = working tree
node scripts/screens.ts --base main          # compare against another ref
node scripts/screens.ts --only "pane (ai|live)"
node scripts/screens.ts --after-only         # just capture the working tree
```

It writes `.screens/before/`, `.screens/after/` (one `.txt` per screen) and `.screens/changes.diff`; `.screens/` is git-ignored. The scenes live in `tests/screens.snap.tsx` and the renderer in `tests/textshot.ts`. Both sides run the current scenes, so only the mod's code differs. The `.snap.tsx` name keeps `claude plugin test .` from running them. The text is an approximation of the terminal: colors are dropped, and rasters (the pet) keep only their size, since its frames are drawn at random.

## Credentials

Never commit API keys, access tokens, private keys, passwords, or environment files. Use Claude Code's sensitive plugin option or a provider environment variable. The repository ignores common local credential files and includes a pre-commit check for common secret patterns.

Enable the local check in each checkout with:

```sh
git config core.hooksPath .githooks
```

The hook checks staged additions and does not print matching content. It is a safeguard, not a replacement for reviewing the staged diff or enabling GitHub push protection.

## Commit messages

Use the Conventional Commits format:

```text
<type>(optional scope): <imperative summary>
```

Common types include `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `ci`. Keep the summary in English and describe the change directly.

## Code and documentation

- Keep repository documentation in English. Put runtime user-facing text in both `hooks/strings/en.ts` and `hooks/strings/pt.ts`.
- For UI appearance changes, start with the shared tokens in `hooks/theme.ts`; see `docs/style-system.md` for the rendering and alternative-style map.
- Preserve the plugin's fail-open behavior: routing failures must not block Claude Code.
- Do not log API keys or include them in request bodies, URLs, test output, screenshots, or issue reports.
- Add or update tests for behavior changes and keep provider calls stubbed in tests, through the shared fakes in `tests/helpers.ts`.
- Keep each rule in one place: read reasons through `hooks/core/reasons.ts`, answers through `hooks/core/selection.ts`, effort support through `supportsEffort`, and a request's model and effort through `hooks/core/runtime.ts`, rather than repeating the check.
