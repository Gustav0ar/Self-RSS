# Security Policy

## Supported Versions

Security fixes are provided for the latest commit on the default branch and the latest tagged release.

## Reporting A Vulnerability

Please do not open public issues for suspected vulnerabilities.

Report security issues privately through GitHub Security Advisories, or contact the project maintainer using the private channel listed on the repository profile. Include:

- Affected version or commit.
- Reproduction steps.
- Impact and affected components.
- Any logs or proof-of-concept details that help verify the issue.

We aim to acknowledge reports within 72 hours and will coordinate disclosure after a fix is available.

## Secret Handling

Never commit real `.env` files, private keys, access tokens, signing keys, or production database files. Production secrets should be stored in the deployment platform or server secret store, not in the repository.
