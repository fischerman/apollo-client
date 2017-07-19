import { DocumentNode } from 'graphql';

export type CacheWrite = {
  dataId: string;
  result: any;
  document: DocumentNode;
  variables?: Object;
};

export interface Cache {
  reset(): Promise<void>;

  diffQuery(query: {
    document: DocumentNode;
    variables: any;
    returnPartialData?: boolean;
    previousResult?: any;
  }): any;

  diffQueryOptimistic(query: {
    document: DocumentNode;
    variables: any;
    returnPartialData?: boolean;
    previousResult?: any;
  }): any;

  readQuery(query: {
    document: DocumentNode;
    variables: any;
    rootId?: string;
    previousResult?: any;
    nullIfIdNotFound?: boolean;
  }): any;

  readQueryOptimistic(query: {
    document: DocumentNode;
    variables: any;
    rootId?: string;
    previousResult?: any;
    nullIfIdNotFound?: boolean;
  }): any;

  writeResult(write: CacheWrite): void;

  removeOptimistic(id: string): void;

  performTransaction(transaction: (c: Cache) => void): void;
  performOptimisticTransaction(
    transaction: (c: Cache) => void,
    id: string,
  ): void;
}
