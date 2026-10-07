# Security policy

## Supported versions

Security fixes are prepared for the latest version on the default branch.

## Reporting a vulnerability

Please do not report security vulnerabilities in a public issue. Use the repository's private vulnerability reporting option from the GitHub **Security** tab when it is available. If private reporting is unavailable, contact the maintainer through [GitHub](https://github.com/petersonPaloschi) and do not include credentials or sensitive user data in the message.

Reports should describe the affected version, the impact, and steps to reproduce with test data. Do not attach live API keys, access tokens, private keys, or production conversation data.

If a credential may have been exposed, revoke or rotate it with its provider immediately. Removing a value from the current files does not revoke it or remove it from Git history.

## Repository protections

The repository includes a local pre-commit check and ignores common credential files. Maintainers should also enable GitHub secret scanning and push protection in repository settings to block supported credentials on the server.
