export type Id = string;
export type Quantity = { value: number; unit: string } | null;
export type StorePolicy =
  | { mode: 'any'; storeIds: [] }
  | { mode: 'preferred' | 'required'; storeIds: [Id, ...Id[]] };
export type Source = { type: 'manual' | 'chatgpt' | 'recipe'; ref?: string; externalRef?: string };

export interface ItemFields {
  name: string;
  quantity: Quantity;
  note: string;
  optional: boolean;
  storePolicy: StorePolicy;
}

export interface Revision {
  id: Id;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface Store extends Revision {
  name: string;
  aliases: string[];
  archivedAt: string | null;
}

export interface Product extends Revision {
  name: string;
  aliases: string[];
  category?: string;
  deletedAt?: string;
}

type NeedState =
  | { state: 'pending'; tripId: null; purchasedAt: null }
  | { state: 'planned'; tripId: Id; purchasedAt: null }
  | { state: 'purchased'; tripId: Id; purchasedAt: string }
  | { state: 'cancelled'; tripId: null; purchasedAt: null };

export type Need = Revision & ItemFields & NeedState & {
  productId: Id | null;
  source: Source;
  deletedAt?: string;
};

export type Trip = Revision & { storeId: Id } & (
  | { status: 'active'; closedAt: null }
  | { status: 'closed'; closedAt: string }
);

export interface ImportBatch extends Revision {
  fingerprint: string;
  itemCount: number;
  addedCount: number;
  mergedCount: number;
  skippedCount: number;
}

export interface ShoppingImportV1 {
  format: 'shopping-import';
  version: 1;
  items: Array<ItemFields & { source?: Source; externalRef?: string }>;
}

export interface ShoppingBackupV1 {
  format: 'shopping-backup';
  schemaVersion: 1;
  datasetId: Id;
  exportedAt: string;
  stores: Store[];
  products: Product[];
  needs: Need[];
  trips: Trip[];
  importBatches: ImportBatch[];
}
