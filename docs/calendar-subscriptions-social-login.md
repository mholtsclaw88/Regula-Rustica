# Calendar subscriptions and social sign-in

## Calendar subscription

A Premium Homestead Steward can open **Calendar → Subscribe** to create one private, read-only iCalendar URL. It publishes only synchronized Calendar events (including recurring events) and their titles, dates, times, locations, and notes. Local-only changes, Tasks, Chore Windows, Records, and Ledger data are not included. The URL is a bearer secret: anyone who has it can read these events without signing in.

The original link is displayed once. **Replace private link** rotates the credential and invalidates the previous URL; **Stop sharing** revokes it. Another calendar app may retain events it already fetched. If Premium Cloud Sync expires, the endpoint stops serving the feed. The endpoint uses `text/calendar`, a short rate limit, and no-store headers. No service-role key is needed: an anonymous RPC reads only the narrow event projection after validating the private token in a non-exposed table.

The feed uses floating local times because Calendar events currently store a date and wall-clock time, not a timezone. A subscriber in a different timezone may therefore see a different absolute instant. Daily and weekly recurrences use `RRULE`; monthly recurrences on the 29th–31st are expanded over a rolling one-year-past/two-years-ahead window to match Regula Rustica’s end-of-month clamping rule. Other apps choose their own refresh frequency.

- In Apple Calendar on iPhone, use **Calendars → Add Calendar → Add Subscription Calendar** and paste the URL. On Mac, use **File → New Calendar Subscription**.
- In Google Calendar, use a **computer browser** and **Other calendars → From URL**. The Google Calendar mobile app does not add URL subscriptions directly.

Apple and Google instructions: [Apple iPhone](https://support.apple.com/en-gb/guide/iphone/iph3d1110d4/26/ios/26), [Apple Mac](https://support.apple.com/guide/calendar/subscribe-to-calendars-icl1022/16.0/mac/26), [Google Calendar](https://support.google.com/calendar/answer/37100).

## Google and Apple account sign-in

The buttons in Account & Storage and onboarding use the existing Supabase Auth session. Email/password remains available. Supabase can automatically link a verified OAuth email to the existing user; Apple Hide My Email can result in a different account, so an existing Steward should use the same verified email or confirm identity linking before relying on the new sign-in route.

Provider credentials must be configured **outside the repository** before those buttons work:

1. Configure the Google OAuth web client and Apple Services ID/signing key in their respective developer consoles. In each, use the Supabase project callback `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Enter the provider client IDs and secrets in **Supabase Auth → Providers**. Keep secrets out of Git and Netlify client configuration. Apple’s web OAuth client secret requires rotation every six months.
3. In **Supabase Auth → URL Configuration**, keep the official site as Site URL and allow the exact production redirect path, the intended local development URL, and the Netlify Deploy Preview pattern. Do not use a broad wildcard across unrelated domains.
4. Test sign-in on a hosted Preview after builds are resumed, then verify it resolves to the existing user and Homestead, and that Premium Cloud Sync still requires an active entitlement. Test Apple’s private relay email separately.

Provider setup: [Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
