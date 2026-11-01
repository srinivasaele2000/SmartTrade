export const pages = [
  { id: 'overview', label: 'Overview', title: 'SmartTrade overview', description: 'Local service status and available administration workflows.' },
  { id: 'verification', label: 'Verification', title: 'Company verification', description: 'Review company registrations and their private verification documents.' },
  { id: 'review-requests', label: 'Review requests', title: 'Company review requests', description: 'Handle restricted review requests without changing company or account access.' },
  { id: 'catalogue', label: 'Catalogue', title: 'Catalogue moderation', description: 'Inspect company-owned products and record authorized moderation decisions.' },
  { id: 'dealers', label: 'Dealer network', title: 'Dealer network', description: 'Review businesses, branches, and branch-specific inventory.' },
  { id: 'audit', label: 'Audit history', title: 'Audit history', description: 'Audit history viewing is not implemented in this release slice.' },
] as const;
export type PageId = typeof pages[number]['id'];
export function pageFromHash(hash: string): PageId {
  return pages.find(page => `#${page.id}` === hash)?.id ?? 'overview';
}
