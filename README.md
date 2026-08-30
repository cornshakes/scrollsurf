# Scrollsurf

[Visit this app!](https://scrollsurf.cornshakes.at)

With scrollsurf you can

- scroll through the best wikipedia articles, wikimedia pictures, and wikiquote
  quotes
- vote on items to influence your feed
- look at all your voted items
- log in with your e-mail to sync your laptop and phone
- download all your data (seen, clicked, liked, disliked items)
- withdraw cookie consent to make me forget everything
- read my [diary](./DIARY.md#Result)

The articles, pictures and quotes are randomly selected from these datasets:

- [The 50000 most vital articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level_5)

- [The Unusual articles page](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles)

- [Wikipedia Good articles](https://en.wikipedia.org/wiki/Wikipedia:Good_articles)

- [Wikipedia Featured articles](https://en.wikipedia.org/wiki/Wikipedia:Featured_articles)

- [Wikipedia Featured pictures](https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures)

- [Wikimedia Featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures)

- [Wikiquote Quote of the Day](https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month)

## Getting Started

```bash
npm install
```

Before you run the app for the first time, you have to download the datasets
that you want using the provided package scripts. The downloads take a long
time, but one dataset is enough to run the app: First, you have to add an .env
file in scripts/, next to .env.example, and add your own User-Agent. Then you
can

```bash
npm run download-vital-50000
npm run download-unusual
npm run download-good-articles
npm run download-featured-articles
npm run download-featured-pictures
npm run download-commons-featured-pictures
npm run download-quotes
```

Then, you can categorize the articles by running

```bash
npm run categorize
npm run categorize-commons
```

Currently, that's not very useful - it just builds a huge category tree that you
can look at.

Then you have to manually assign topic buckets (long story)

```bash
npm run unify-topics
```

And then you should be able to

```bash
npm run dev
```

and go to [http://localhost:3000](http://localhost:3000).\
But let's not kid ourselves, this is likely to fail at some point because it
only ever ran on my machine. Let me know if you need help :)

## Clicks, Likes & Dislikes

The feed is random, but influenced by user activity: likes, dislikes, and
followed links build a per-topic-bucket affinity that weights the random draw —
liked topics show up more often, disliked ones less, and nothing is ever
hard-excluded. Without any votes (or without the consent cookie, see below) the
feed is uniformly random.

Read more about how it all works in [Dataflow.md](./docs/Dataflow.md).

## Cookies, Accounts & Login

Consent is recorded in the client-readable **`ss_consent`** cookie (`granted` /
`denied` / `unknown`). When you try to vote on a feed item without having
granted consent, the consent dialog opens instead.

Once the user agrees to use cookies, their seen items, likes and clicks are
stored with the cookie as the key. So when the cookie is cleared or expires
after inactivity, that data is lost. Logging in with an email binds that history
to an account, which multiple browser cookies can then point at.

The `tokens` table maps each browser cookie to a row in `users`, and several
cookies can point at the same account. An anonymous user is a `users` row with
no email. Stale cookies are swept after `USER_INACTIVITY_DAYS` (default 14) of
inactivity by `cleanup_inactive_users` on startup — the underlying user row and
its history survive, only the cookie is dropped.

When revoking cookie consent, you can choose to leave your anonymized data for
research, but by default all your data will be deleted.

### Passwordless email login

Login is **code-only — there is no password**:

1. Enter your email → the server `create_login_code` creates a single-use
   6-digit code, upserted into the `login_codes` table (one row per email,
   15-minute expiry, 60-second resend rate-limit) and sent over SMTP. If
   `SMTP_HOST` is unset (dev/e2e) the code is just logged to the server console
   instead of emailed.
2. Enter the code → `verify_login_code` checks it and **deletes it** (single
   use; wrong attempts don't delete it, so you can retry until it expires).
3. On success `attach_login` binds your browser token to an account, and
   `submit_login_code` sets `ss_uid` and grants consent — **logging in implies
   consent**.

### Merging / switching user histories on login

`attach_login` reconciles any existing votes/clicks on login. It resolves the
current browser cookie and the account matching the email, then picks one of
these branches:

| Situation                            | Outcome                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Token already points at this account | No-op, stay logged in                                                  |
| You're anonymous, account exists     | **Merge** — fold your anon history into the account                    |
| You're logged into _another_ account | **Switch** — repoint just this browser's cookie; no merge              |
| No cookie at all, account exists     | Mint a fresh cookie for the account                                    |
| You're anonymous, email is new       | **Promote** — your anon user _becomes_ the account (keeps all history) |
| No cookie, email is new              | Create a brand-new empty account                                       |

### (`merge_anon_to_account`)

When "logging in", i.e. changing from anonymous to email, the anonymous
account's votes are merged into the existing account's votes with the existing
one taking precedence on conflict. Append-only clicks are carried over (added,
never replacing the account's), the cookie of the anonymous identity is
repointed to the account, and the anon user row is deleted. When "switching"
accounts, i.e. changing from one email account to another, the browser cookie is
pointed to the other account without any further changes.

## Integration Testing

All e2e tests run against a small example database (`e2e/.data/`). That database
is created from the downloaded datasets using the test:e2e:create-db script. It
is committed so that you don't have to download all datasets before being able
to run e2e tests.

```bash
npm run test:e2e            # run all integration tests (seeds DB automatically)
npm run playwright-ui       # same, but with Playwright's interactive UI
npm run test:e2e:update     # updates screenshots
```

## Future inspiration

These
[Main topic classifications](https://en.wikipedia.org/wiki/Category:Main_topic_classifications)
are not what I have

[Wikipedia:Contents](https://en.wikipedia.org/wiki/Wikipedia:Contents)

[why not reddit](https://www.reddit.com/r/wikipedia/comments/11nnbzx/i_maintain_a_list_of_500_of_my_favourite/)

[Wikipedia:Categorization](https://en.wikipedia.org/wiki/Wikipedia:Categorization)
