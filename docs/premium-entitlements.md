# Premium entitlement operations

Premium belongs to a cloud Homestead. The browser can read the effective plan
and a Steward can redeem a gift, but no browser role can create, edit, or revoke
an entitlement.

## Issue a gift

Run this as a trusted database operator in the Supabase SQL editor:

```sql
select private.issue_premium_gift(
  duration_days := 365,
  redeem_by := now() + interval '90 days',
  gift_note := 'Founding household gift'
);
```

Copy the returned code once and send it privately to the recipient. Only its
SHA-256 hash is stored. A Homestead Steward redeems it under **Settings → Cyril
& Premium**. Codes are single-use and extend an existing time-limited Premium
period rather than replacing it.

## Future purchase adapters

Verified billing webhooks or app-store receipt handlers should write one
`premium_entitlements` row per durable provider transaction. Use:

- `source = 'purchase'`
- a stable `provider`, such as `stripe`, `apple_app_store`, or `google_play`
- the provider transaction/subscription identifier in `external_reference`
- the verified access interval in `starts_at` and `ends_at`

The `(provider, external_reference)` uniqueness constraint makes webhook retries
idempotent. Purchase validation must remain server-side. Never accept a client
claim that a purchase succeeded, and never expose a Supabase secret/service-role
key in the browser.

## Cyril feature checks

Authenticated server endpoints should call `has_premium_feature(feature_key)`
using the user's JWT before invoking paid AI infrastructure. Current feature
keys are:

- `cellarer_assisted_entry`
- `cellarer_receipt_reader`
- `cellarer_ask_farm_book`

The UI indication is informational; the server-side feature check is the access
control boundary.
