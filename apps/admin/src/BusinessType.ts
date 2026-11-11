export const businessTypes = {
  ELECTRICAL: 'Electrical', PLUMBING: 'Plumbing', PAINTS: 'Paints',
  HARDWARE: 'Hardware', NETWORKING: 'Networking', OTHER: 'Other',
} as const;

export type BusinessType = keyof typeof businessTypes;

export const catalogueBusinessTypes = {...businessTypes, CONSTRUCTION_STEEL: 'Construction & Steel'} as const;
export type CatalogueBusinessType = keyof typeof catalogueBusinessTypes;

export const SUB_BUSINESS_TAXONOMY: Record<string, {key: string; label: string}[]> = {
  ELECTRICAL: [
    {key: 'WIRES_CABLES', label: 'Wires & Cables'},
    {key: 'SWITCHES_SOCKETS', label: 'Modular Switches & Sockets'},
    {key: 'MCB_DISTRIBUTION', label: 'MCBs, RCCBs & Distribution Boards'},
    {key: 'LIGHTING', label: 'Commercial & Home Lighting'},
    {key: 'CONDUITS_PIPES', label: 'Conduits & Installation Accessories'},
    {key: 'FANS_APPLIANCES', label: 'Fans & Industrial Appliances'},
    {key: 'OTHER', label: 'Other Electrical'},
  ],
  PLUMBING: [
    {key: 'PIPES_FITTINGS', label: 'CPVC / UPVC Pipes & Fittings'},
    {key: 'SANITARYWARE', label: 'Sanitaryware & Closets'},
    {key: 'FAUCETS_SHOWERS', label: 'Bathroom Faucets & Showers'},
    {key: 'WATER_TANKS', label: 'Water Storage Tanks'},
    {key: 'DRAINAGE', label: 'Drainage & Sewerage Systems'},
    {key: 'OTHER', label: 'Other Plumbing'},
  ],
  PAINTS: [
    {key: 'INTERIOR_EMULSION', label: 'Interior Emulsions & Primers'},
    {key: 'EXTERIOR_COATINGS', label: 'Exterior Weatherproof Coatings'},
    {key: 'ENAMEL_WOOD', label: 'Enamel & Wood Finishes'},
    {key: 'WALL_PUTTY', label: 'Putty & Wall Care'},
    {key: 'WATERPROOFING', label: 'Waterproofing Chemicals'},
    {key: 'OTHER', label: 'Other Paints'},
  ],
  HARDWARE: [
    {key: 'DOOR_WINDOW_FITTINGS', label: 'Door & Window Locks / Handles'},
    {key: 'HINGES_TOWER_BOLTS', label: 'Hinges & Tower Bolts'},
    {key: 'FASTENERS_SCREWS', label: 'Screws, Fasteners & Anchors'},
    {key: 'HAND_POWER_TOOLS', label: 'Hand & Power Tools'},
    {key: 'OTHER', label: 'Other Hardware'},
  ],
  NETWORKING: [
    {key: 'LAN_ETHERNET_CABLES', label: 'LAN & Ethernet Cables'},
    {key: 'SERVER_RACKS', label: 'Server & Patch Racks'},
    {key: 'SWITCHES_ROUTERS', label: 'Network Switches & Routers'},
    {key: 'PATCH_PANELS', label: 'Patch Panels & Faceplates'},
    {key: 'OTHER', label: 'Other Networking'},
  ],
  CONSTRUCTION_STEEL: [
    {key: 'CEMENT_GRADES', label: 'OPC / PPC Cement'},
    {key: 'TMT_REBARS', label: 'TMT Rebars & Structural Steel'},
    {key: 'CONSTRUCTION_CHEMICALS', label: 'Construction Chemicals'},
    {key: 'OTHER', label: 'Other Construction'},
  ],
};
