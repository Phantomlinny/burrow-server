# Burrow
Burrow is a private server for AJ Classic.

## Account-recovery email

Set `AJ_RECOVERY_MAIL_URL` and `AJ_RECOVERY_MAIL_TOKEN` to an HTTPS mail-relay or transactional-email webhook. Burrow posts `{to, subject, text}` with a Bearer token. Until both are configured, email recovery intentionally does not issue a usable reset link. New web sign-ups are asked for a recovery email; password and 2FA recovery require the one-time link sent there.

# Security
An independent security audit by a Strawberry Jam contributor, who is not part of the Burrow team, found no malware in the Burrow client or server (client v1.2.0, server as of 17 October 2026). Every file in every installer was checked against its source and against the official Electron, NSIS and Adobe Flash releases. The report also lists the weaknesses found, with fixes, and every check can be repeated by anyone.

**[Read the audit](https://snipzil.github.io/burrow-server/)**

Every push to this repository is checked automatically (`.github/workflows/security.yml`) for new outside web addresses in the server or game files, code that starts programs, committed keys and leaked credentials.

# Disclaimer
Burrow is an unofficial fan project. It is not affiliated with, endorsed by or connected to WildWorks, Inc. or Animal Jam. Animal Jam and Animal Jam Classic are trademarks of WildWorks, Inc.

**Takedown procedure: WildWorks, Inc. or its authorized representatives may request the removal of content, or of Burrow as a whole, by writing to legal@burrow.moe. Upon verification of authority, the request will be carried out promptly.**

# Credits
Emoji in chat are drawn with [Twemoji](https://github.com/jdecked/twemoji), © Twitter, Inc. and other contributors, under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
