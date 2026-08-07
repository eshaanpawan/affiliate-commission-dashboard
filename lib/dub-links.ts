// Client-safe helpers for deep links into the Dub dashboard.

const DUB_WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DUB_WORKSPACE_SLUG ?? 'runable';

/** Dub message center thread for a partner (partner ids look like pn_...). */
export function dubMessageUrl(partnerId: string): string {
  return `https://app.dub.co/${DUB_WORKSPACE_SLUG}/program/messages/${partnerId}`;
}

export function isDubPartner(source: string | undefined, id: string): boolean {
  return source === 'dub' || id.startsWith('pn_');
}
