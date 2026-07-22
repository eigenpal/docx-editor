/** @spike-features insert-delete-split-join-operations, origin-metadata, awareness-metadata */
declare const DocOpBrand: unique symbol;
declare const ModelChangeBrand: unique symbol;
declare const ReplicationUpdateBrand: unique symbol;
declare const SnapshotBrand: unique symbol;

export type BrandedDocOp = { readonly [DocOpBrand]: true };
export type BrandedModelChange = { readonly [ModelChangeBrand]: true };
export type BrandedReplicationUpdate = { readonly [ReplicationUpdateBrand]: true };
export type BrandedSnapshot = { readonly [SnapshotBrand]: true };
