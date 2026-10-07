# Contributing

Thanks for helping improve Jev. Issues and pull requests should be written in English so maintainers and users can review them.

## Before opening a pull request

1. Create a branch for your change.
2. Keep the change focused and update the documentation when behavior changes.
3. Run the plugin validator and test suite:

   ```sh
   claude plugin validate .
   claude plugin test .
   node --test tests/sift-cli.test.mjs
   ```

4. Review the staged diff and confirm that it contains no credentials or private data.
5. Include a concise summary and validation results in the pull request.

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
- Preserve the plugin's fail-open behavior: routing failures must not block Claude Code.
- Do not log API keys or include them in request bodies, URLs, test output, screenshots, or issue reports.
- Add or update tests for behavior changes and keep provider calls stubbed in tests.
