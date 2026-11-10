# Chore Window push reminders

This feature is opt-in **on each device** under Settings → Chore Windows. It requires a connected Premium Homestead, a supported browser, and notification permission. iPhone/iPad users must open the installed Home Screen web app. A local `file://` copy cannot receive Web Push.

At the end of an enabled Chore Window, a Netlify scheduled function checks cloud-synced Tasks using the same recurring projection as the Calendar. It sends at most one reminder per window/date/device when work remains. The schedule runs every five minutes in the Homestead's timezone, with a 30-minute catch-up window. It does not send task titles to the phone's lock screen. The device's “Send a test reminder” button checks browser permission and display; it does **not** test the scheduled cloud sender.

## One-time operator setup

The database migration `20261110022317_chore_window_push_reminders.sql` has been applied to the Supabase project. The function remains inactive until all three Netlify Function environment variables below are configured **and the site is rebuilt**. Never commit these values or put them in a client-side build variable.

1. Generate one VAPID key pair and a separate 256-bit sender token. From the repository, run this locally and store the results in a password manager:

   ```powershell
   node -e "const c=require('node:crypto');const w=require('web-push');const k=w.generateVAPIDKeys();const token=c.randomBytes(32).toString('hex');console.log(JSON.stringify({VAPID_PUBLIC_KEY:k.publicKey,VAPID_PRIVATE_KEY:k.privateKey,CHORE_PUSH_SENDER_TOKEN:token,token_hash:c.createHash('sha256').update(token).digest('hex')},null,2))"
   ```

2. In Netlify site `regula-rustica`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `CHORE_PUSH_SENDER_TOKEN` for **Functions**, in the production context (and Deploy Previews if preview enrollment is desired). Mark the latter two secret. The existing `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must remain available to Functions.
3. In the Supabase SQL editor, insert **only the hash** from step 1:

   ```sql
   insert into private.chore_push_sender_auth (singleton, token_hash)
   values (true, '<token_hash>')
   on conflict (singleton) do update set token_hash = excluded.token_hash;
   ```

4. Rebuild/redeploy. In the deployed app, enable reminders from a signed-in Premium device and use “Send a test reminder.” Then leave one Chore Window task open and verify a real reminder shortly after its end time with the app closed. A Deploy Preview can test enrollment and the local test reminder, but Netlify scheduled functions run only on the published deploy.

If the sender token is rotated, change both the Netlify secret and private hash; the VAPID key pair should remain stable so existing device subscriptions continue to work. If VAPID keys are rotated, devices must re-enable reminders.
