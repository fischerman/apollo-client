import { DocumentNode } from 'graphql';

import { NormalizedCache } from './storeUtils';

export type CacheWrite = {
  dataId: string;
  result: any;
  document: DocumentNode;
  variables?: Object;
};

export interface Cache {
  // TODO[shadaj]: modify typing to handle non-normalized cache
  getData(): NormalizedCache;
  getOptimisticData(): NormalizedCache;
  writeResult(write: CacheWrite): void;
  setData(data: NormalizedCache): void;
  reset(): void;
  applyTransformer(transform: (i: NormalizedCache) => NormalizedCache): void;
  diffQuery(
    query: DocumentNode,
    variables: any,
    returnPartialData: boolean,
  ): any;
  readQuery(rootId: string, query: DocumentNode, variables: any): any;

  removeOptimistic(id: string): void;

  performTransaction(transaction: (c: Cache) => void): void;
  performOptimisticTransaction(
    transaction: (c: Cache) => void,
    id: string,
  ): void;
}
