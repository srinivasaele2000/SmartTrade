export const pages = [
  { id: 'overview', label: 'Overview', title: 'SmartTrade overview', description: 'Local service status and available administration workflows.' },
  { id: 'verification', label: 'Verification', title: 'Company verification', description: 'Review company registrations and their private verification documents.' },
  { id: 'review-requests', label: 'Review requests', title: 'Company review requests', description: 'Handle restricted review requests without changing company or account access.' },
  { id: 'catalogue', label: 'Catalogue', title: 'Catalogue moderation', description: 'Inspect company-owned products and record authorized moderation decisions.' },
  { id: 'catalogues', label: 'Catalogue vault', title: 'Catalogue vault', description: 'Upload and manage brand catalogues by business type.' },
  { id: 'dealers', label: 'Dealer network', title: 'Dealer network', description: 'Review businesses, branches, and branch-specific inventory.' },
  { id: 'dealer-directory', label: 'Dealer directory', title: 'Dealer directory', description: 'View dealer registration details and consented worker contacts.' },
  { id: 'enquiries', label: 'Enquiries', title: 'Enquiries and quotations', description: 'Inspect buyer enquiries and item-wise dealer quotation revisions.' },
  { id: 'orders', label: 'Orders', title: 'Orders and invoices', description: 'Inspect order state, immutable item snapshots, and issued invoices.' },
  { id: 'audit', label: 'Audit history', title: 'Audit history', description: 'Inspect available catalogue, authorization and listing audit histories.' },
] as const;
export type PageId = typeof pages[number]['id'];
export function pageFromHash(hash: string, pathname = '/'): PageId {
  if (!hash && pathname.replace(/\/$/, '') === '/catalogues') return 'catalogues';
  if (!hash && pathname.replace(/\/$/, '') === '/dealers') return 'dealer-directory';
  return pages.find(page => `#${page.id}` === hash)?.id ?? 'overview';
}
