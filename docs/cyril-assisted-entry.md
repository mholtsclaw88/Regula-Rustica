# Cyril Assisted Entry

Cyril Assisted Entry is a Premium, cloud-connected drafting aid. It does not
create, update, complete, or sync an entry. It returns a validated draft that is
opened in the existing Regula Rustica form; the user reviews and explicitly
saves through the ordinary local-first workflow.

The single **Cyril the Cellarer** control opens the Cellarer's Desk from the
bottom-right of the app. **Prepare an Entry** opens the existing draft form with
the prompt first; Cyril chooses the entry type unless the user expands the
optional selector. **Ask About the Homestead** and **Consult Cyril** are shown
as unavailable future capabilities.

## Request path

1. The browser sends a short instruction plus a bounded list of active Records,
   people, and Chore Windows to `/api/cyril/assisted-entry`.
2. The Netlify Function verifies the supplied Supabase access token with the
   Auth server.
3. `consume_premium_feature('cellarer_assisted_entry')` verifies the active
   Homestead entitlement and atomically consumes one of 100 daily drafts.
4. Netlify AI Gateway calls `gpt-5.6-luna` with storage disabled and a strict
   JSON Schema response format.
5. The server validates all returned IDs and Yield eligibility against the
   bounded request context before returning the draft.
6. The browser validates the draft again, opens the existing form, and labels
   it **Cyril’s draft — review before recording**.

Netlify also limits the function to 10 requests per minute per domain and IP.
The database quota is shared by the Homestead across devices.

## Supported drafts

- Task
- Yield
- Ledger entry
- Journal note
- Record event
- Calendar event

Attachments, receipt reading, Ask the Farm Book, autonomous actions, and direct
database writes are outside this version.

## Runtime configuration

Netlify AI Gateway supplies `OPENAI_API_KEY` and `OPENAI_BASE_URL`. Existing
Netlify environment variables supply `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`. No provider secret is exposed to the browser.

References:

- https://docs.netlify.com/build/ai-gateway/overview/
- https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
