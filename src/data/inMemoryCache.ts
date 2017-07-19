import { Cache, CacheWrite } from './cache';

import { DocumentNode } from 'graphql';

import { NormalizedCache } from './storeUtils';

import { ApolloReducerConfig } from '../store';

import { writeResultToStore } from './writeToStore';

import {
  readQueryFromStore,
  diffQueryAgainstStore,
  DiffResult,
} from './readFromStore';

import { cloneDeep } from '../util/cloneDeep';

export type OptimisticStoreItem = {
  id: string;
  data: NormalizedCache;
  transaction: (c: Cache) => void;
};

export class InMemoryCache implements Cache {
  private data: NormalizedCache;
  private config: ApolloReducerConfig;
  private nextOptimisticId = 0;
  private optimistic: OptimisticStoreItem[] = [];

  constructor(config: ApolloReducerConfig, initialStore: NormalizedCache = {}) {
    this.config = config;
    this.data = initialStore;
  }

  public getData(): NormalizedCache {
    return this.data;
  }

  public getOptimisticData(): NormalizedCache {
    if (this.optimistic.length === 0) {
      return this.data;
    }

    const patches = this.optimistic.map(opt => opt.data);
    return Object.assign({}, this.data, ...patches) as NormalizedCache;
  }

  public getOptimisticQueue(): OptimisticStoreItem[] {
    return this.optimistic;
  }

  public setData(data: NormalizedCache): void {
    this.data = data;
  }

  public writeResult(write: CacheWrite): void {
    writeResultToStore({
      ...write,
      store: this.data,
      dataIdFromObject: this.config.dataIdFromObject,
      fragmentMatcherFunction: this.config.fragmentMatcher,
    });
  }

  public reset(): void {
    this.data = {};
  }

  public applyTransformer(
    transform: (i: NormalizedCache) => NormalizedCache,
  ): void {
    this.data = transform(this.data);
  }

  public diffQuery(
    query: DocumentNode,
    variables: any,
    returnPartialData: boolean,
  ): DiffResult {
    return diffQueryAgainstStore({
      store: this.data,
      query,
      variables,
      returnPartialData,
      fragmentMatcherFunction: this.config.fragmentMatcher,
      config: this.config,
    });
  }

  public readQuery(rootId: string, query: DocumentNode, variables: any): any {
    return readQueryFromStore({
      store: this.data,
      query,
      rootId,
      fragmentMatcherFunction: this.config.fragmentMatcher,
      config: this.config,
    });
  }

  public removeOptimistic(id: string) {
    // Throw away optimistic changes of that particular mutation
    const toPerform = this.optimistic.filter(item => item.id !== id);

    this.optimistic = [];

    // Re-run all of our optimistic data actions on top of one another.
    toPerform.forEach(change => {
      this.performOptimisticTransaction(change.transaction, change.id);
    });
  }

  public performTransaction(transaction: (c: Cache) => void) {
    // todo: does this need to be different, or is this okay for an in-memory cache?
    transaction(this);
  }

  public performOptimisticTransaction(
    transaction: (c: Cache) => void,
    id: string,
  ) {
    const before = this.getOptimisticData();

    const orig = this.data;
    this.data = { ...before };
    transaction(this);
    const after = this.data;
    this.data = orig;

    const patch: any = {};

    Object.keys(after).forEach(key => {
      if (after[key] !== before[key]) {
        patch[key] = after[key];
      }
    });

    this.optimistic.push({
      id,
      transaction,
      data: patch,
    });
  }
}
