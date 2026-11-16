# Security policy

Ozymandosis is a game and the small service that runs its online play. This file says how to report
a security problem in them, and what happens next.

## Reporting

Use **GitHub's private advisory form**: the **Security** tab of this repository → **Report a
vulnerability**. It opens a private thread that only the maintainers can read, and it is the only
channel that reaches us reliably.

Please do not open a public issue for anything that could be exploited, and do not test against
other players' accounts or data.

A useful report says what you did, what happened, and what you expected. A `file:line` or a request
that reproduces it is worth more than a severity label — we will work out the severity together.

## What happens next

We read every report. Where a fix is needed it ships as soon as it is verified, and we would rather
tell you "not yet" than name a date we cannot keep. If a report turns out to be a non-issue we will
say so and explain why, with the evidence.

We do not run a paid bounty programme. We will credit you in the release notes if you would like,
or leave you out of them if you would not.

## Safe harbour

Good-faith research on your own account, on a self-hosted copy, or against the public service
without touching anyone else's data, is welcome and we will not pursue it. That does not extend to:

- reading, changing or deleting another person's data, or attempting to;
- attacking the people who play the game — phishing, social engineering, harassment;
- volume-based denial of service against the live service (rate limits and connection caps are
  documented here; a load test belongs on your own copy);
- anything against Stripe, GitHub, Steam, Cloudflare or another third party: that is theirs to
  assess, not ours.

## What we already know about

`docs/ADVISORIES.md` lists dependency advisories we have looked at and decided to accept, with the
reason. Anything not there is something we intend to fix, so it is worth reporting.

Self-hosted copies are run by whoever hosts them. This policy covers `ozymandosis.com` and
`play.ozymandosis.com`.
