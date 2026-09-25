export function premiumCloudEntitled(premium, now = Date.now()) {
  if (premium?.status !== 'active' || premium.plan_key !== 'premium') return false;
  if (!premium.ends_at) return true;
  const end = Date.parse(premium.ends_at);
  return Number.isFinite(end) && end > now;
}

export function premiumSyncAvailable(context, now = Date.now()) {
  return Boolean(context?.session?.access_token && context?.homesteadId
    && premiumCloudEntitled(context.premium, now));
}
