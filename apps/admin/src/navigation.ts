export const pages = [
  { id: 'overview', label: 'Overview', title: 'SmartTrade overview', description: 'See what needs your attention and open the tools you use most.' },
  { id: 'verification', label: 'Account verification', title: 'Account verification', description: 'Review company applications and check their documents.' },
  { id: 'review-requests', label: 'Approval requests', title: 'Approval requests', description: 'Review requests from companies that were rejected or suspended.' },
  { id: 'catalogue', label: 'Catalogue items', title: 'Catalogue items', description: 'Add, edit, and manage products shown in the mobile catalogue.' },
  { id: 'catalogues', label: 'Catalogue vault', title: 'Catalogue vault', description: 'Upload, organise, and review brand catalogue files.' },
  { id: 'dealers', label: 'Dealer network', title: 'Dealer network', description: 'Review dealer businesses, branches, and stock listings.' },
  { id: 'dealer-directory', label: 'Dealer directory', title: 'Dealer directory', description: 'Find registered dealers and view the worker contacts they’ve shared with permission.' },
  { id: 'messages', label: 'Messages', title: 'Messages', description: 'Read and reply to dealer support conversations.' },
  { id: 'banners', label: 'Promotional banners', title: 'Promotional banners', description: 'Choose which promotions dealers see, when they appear, and where they lead.' },
  { id: 'enquiries', label: 'Customer enquiries', title: 'Customer enquiries', description: 'Follow customer enquiries and the quotes dealers send.' },
  { id: 'orders', label: 'Orders', title: 'Orders', description: 'Check order progress, agreed prices, and issued invoices.' },
  { id: 'audit', label: 'Activity log', title: 'Activity log', description: 'See changes to the catalogue, dealer permissions, and listings.' },
] as const;
export type PageId = typeof pages[number]['id'];
export function pageFromHash(hash: string, pathname = '/'): PageId {
  if (!hash && pathname.replace(/\/$/, '') === '/catalogues') return 'catalogues';
  if (!hash && pathname.replace(/\/$/, '') === '/dealers') return 'dealer-directory';
  return pages.find(page => `#${page.id}` === hash)?.id ?? 'overview';
}
