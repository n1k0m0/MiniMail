const profileId = process.env.MAIL_VPN_PROFILE_ID || "";
const profileLabel = process.env.MAIL_VPN_PROFILE_LABEL || profileId;
const proxyUrl = process.env.MAIL_VPN_PROXY_URL || "";

export function vpnProfiles() {
  return profileId && proxyUrl ? [{ id: profileId, label: profileLabel }] : [];
}

export function vpnProxy(account) {
  if (!account.vpn_profile) return undefined;
  if (account.vpn_profile !== profileId || !proxyUrl)
    throw new Error("Das VPN-Profil ist auf diesem Server nicht verfügbar.");
  return proxyUrl;
}
