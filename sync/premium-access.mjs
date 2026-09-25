export function premiumSyncAvailable(context, now = Date.now()) {
  const premium = context?.premium;
  if (!context?.session?.access_token || !context?.homesteadId || premium?.status !== 'active'
    || !premium.feature_keys?.includes('cloud_sync')) return false;
  if (!premium.ends_at) return true;
  const end = Date.parse(premium.ends_at);
  return Number.isFinite(end) && end > now;
}
