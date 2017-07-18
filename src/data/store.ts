import {
  ApolloAction,
  isQueryResultAction,
  isMutationResultAction,
  isUpdateQueryResultAction,
  isStoreResetAction,
  isSubscriptionResultAction,
  isWriteAction,
  QueryWithUpdater,
  DataWrite,
} from '../actions';

import { writeResultToStore } from './writeToStore';

import { TransactionDataProxy, DataProxy } from '../data/proxy';

import { QueryStore } from '../queries/store';

import { getOperationName } from '../queries/getFromAST';

import { MutationStore } from '../mutations/store';

import { ApolloReducerConfig, ApolloReducer } from '../store';

import { graphQLResultHasError, NormalizedCache } from './storeUtils';

import { replaceQueryResults } from './replaceQueryResults';

import { diffQueryAgainstStore, DiffResult } from './readFromStore';

import { tryFunctionOrLogError } from '../util/errorHandling';

import { ExecutionResult, DocumentNode } from 'graphql';

import { assign } from '../util/assign';

import { cloneDeep } from '../util/cloneDeep';

export type OptimisticStoreItem = {
  mutationId: string;
  data: NormalizedCache;
  changeFn: () => void;
};

export type CacheWrite = {
  dataId: string;
  result: any;
  document: DocumentNode;
  variables?: Object;
}

export interface Cache {
  // TODO[shadaj]: modify typing to handle non-normalized cache
  getData(): NormalizedCache
  writeResult(write: CacheWrite): void
  setData(data: NormalizedCache): void
  reset(): void
  applyTransformer(transform: (i: NormalizedCache) => NormalizedCache): void
  diffQuery(query: DocumentNode, variables: any, returnPartialData: boolean): any
}

class InMemoryCache implements Cache {
  private data: NormalizedCache;
  private config: ApolloReducerConfig;

  constructor(config: ApolloReducerConfig, initialStore: NormalizedCache = {}) {
    this.config = config;
    this.data = initialStore;
  }

  public getData(): NormalizedCache {
    return this.data;
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
    this.data = {}
  }

  public applyTransformer(transform: (i: NormalizedCache) => NormalizedCache): void {
    this.data = transform(this.data);
  }

  public diffQuery(query: DocumentNode, variables: any, returnPartialData: boolean): DiffResult {
    return diffQueryAgainstStore({
      store: this.data,
      query,
      variables,
      returnPartialData,
      fragmentMatcherFunction: this.config.fragmentMatcher,
      config: this.config,
    })
  }
}

export class DataStore {
  private cache: Cache;
  private optimistic: OptimisticStoreItem[] = [];
  private config: ApolloReducerConfig;

  constructor(config: ApolloReducerConfig, initialStore: NormalizedCache = {}) {
    this.config = config;
    this.cache = new InMemoryCache(config, initialStore);
  }

  public getStore(): NormalizedCache {
    return this.cache.getData();
  }

  public getOptimisticQueue(): OptimisticStoreItem[] {
    return this.optimistic;
  }

  public getDataWithOptimisticResults(): NormalizedCache {
    if (this.optimistic.length === 0) {
      return this.cache.getData();
    }

    const patches = this.optimistic.map(opt => opt.data);
    return assign({}, this.cache.getData(), ...patches) as NormalizedCache;
  }

  public markQueryResult(
    queryId: string,
    requestId: number,
    result: ExecutionResult,
    document: DocumentNode,
    variables: any,
    extraReducers: ApolloReducer[],
    fetchMoreForQueryId: string | undefined,
  ) {
    // XXX handle partial result due to errors
    if (!fetchMoreForQueryId && !graphQLResultHasError(result)) {
      // TODO REFACTOR: is writeResultToStore a good name for something that doesn't actually
      // write to "the" store?
      this.cache.writeResult({
        result: result.data,
        dataId: 'ROOT_QUERY', // TODO: is this correct? what am I doing here? What is dataId for??
        document: document,
        variables: variables,
      });

      if (extraReducers) {
        extraReducers.forEach(reducer => {
          this.cache.applyTransformer((i) => {
            return reducer(i, {
              type: 'APOLLO_QUERY_RESULT',
              result,
              document,
              operationName: getOperationName(document),
              variables,
              queryId,
              requestId,
            });
          });
        });
      }
    }
  }

  public markSubscriptionResult(
    subscriptionId: number,
    result: ExecutionResult,
    document: DocumentNode,
    variables: any,
    extraReducers: ApolloReducer[],
  ) {
    // the subscription interface should handle not sending us results we no longer subscribe to.
    // XXX I don't think we ever send in an object with errors, but we might in the future...
    if (!graphQLResultHasError(result)) {
      // TODO REFACTOR: is writeResultToStore a good name for something that doesn't actually
      // write to "the" store?
      this.cache.writeResult({
        result: result.data,
        dataId: 'ROOT_SUBSCRIPTION',
        document: document,
        variables: variables,
      });

      if (extraReducers) {
        extraReducers.forEach(reducer => {
          this.cache.applyTransformer((i) => {
            return reducer(i, {
              type: 'APOLLO_SUBSCRIPTION_RESULT',
              result,
              document,
              operationName: getOperationName(document),
              variables,
              subscriptionId,
            });
          });
        });
      }
    }
  }

  public markMutationInit(mutation: {
    mutationId: string;
    document: DocumentNode;
    variables: any;
    updateQueries: { [queryId: string]: QueryWithUpdater };
    update: ((proxy: DataProxy, mutationResult: Object) => void) | undefined;
    optimisticResponse: Object | Function | undefined;
    extraReducers: ApolloReducer[];
  }) {
    if (mutation.optimisticResponse) {
      let optimistic: Object;
      if (typeof mutation.optimisticResponse === 'function') {
        optimistic = mutation.optimisticResponse(mutation.variables);
      } else {
        optimistic = mutation.optimisticResponse;
      }

      const optimisticData = this.getDataWithOptimisticResults();

      const changeFn = () => {
        this.markMutationResult({
          mutationId: mutation.mutationId,
          result: { data: optimistic },
          document: mutation.document,
          variables: mutation.variables,
          updateQueries: mutation.updateQueries,
          update: mutation.update,
          extraReducers: mutation.extraReducers,
        });
      };

      const patch = this.collectPatch(optimisticData, changeFn);

      const optimisticState = {
        data: patch,
        mutationId: mutation.mutationId,
        changeFn,
      };

      this.optimistic.push(optimisticState);
    }
  }

  public markMutationResult(mutation: {
    mutationId: string;
    result: ExecutionResult;
    document: DocumentNode;
    variables: any;
    updateQueries: { [queryId: string]: QueryWithUpdater };
    update: ((proxy: DataProxy, mutationResult: Object) => void) | undefined;
    extraReducers: ApolloReducer[];
  }) {
    // Incorporate the result from this mutation into the store
    if (!mutation.result.errors) {
      const cacheWrites: CacheWrite[] = [];
      cacheWrites.push({
        result: mutation.result.data,
        dataId: 'ROOT_MUTATION',
        document: mutation.document,
        variables: mutation.variables,
      });

      if (mutation.updateQueries) {
        Object.keys(mutation.updateQueries)
          .filter(id => mutation.updateQueries[id])
          .forEach(queryId => {
            const { query, reducer } = mutation.updateQueries[queryId];
            // Read the current query result from the store.
            const {
              result: currentQueryResult,
              isMissing,
            } = this.cache.diffQuery(query.document, query.variables, true);

            if (isMissing) {
              return;
            }

            // Run our reducer using the current query result and the mutation result.
            const nextQueryResult = tryFunctionOrLogError(() =>
              reducer(currentQueryResult, {
                mutationResult: mutation.result,
                queryName: getOperationName(query.document),
                queryVariables: query.variables,
              }),
            );

            // Write the modified result back into the store if we got a new result.
            if (nextQueryResult) {
              cacheWrites.push({
                result: nextQueryResult,
                dataId: 'ROOT_QUERY',
                document: query.document,
                variables: query.variables,
              });
            }
          });
      }

      cacheWrites.forEach(write => {
        this.cache.writeResult(write);
      });

      // If the mutation has some writes associated with it then we need to
      // apply those writes to the store by running this reducer again with a
      // write action.
      const update = mutation.update;
      if (update) {
        const proxy = new TransactionDataProxy(this.cache.getData(), this.config);

        tryFunctionOrLogError(() => update(proxy, mutation.result));
        const writes = proxy.finish();
        this.executeWrites(writes);
      }

      if (mutation.extraReducers) {
        mutation.extraReducers.forEach(reducer => {
          this.cache.applyTransformer((i) => {
            return reducer(i, {
              type: 'APOLLO_MUTATION_RESULT',
              mutationId: mutation.mutationId,
              result: mutation.result,
              document: mutation.document,
              operationName: getOperationName(mutation.document),
              variables: mutation.variables,
              mutation: mutation.mutationId,
            });
          });
        });
      }
    }
  }

  public markMutationComplete(mutationId: string) {
    // Throw away optimistic changes of that particular mutation
    this.optimistic = this.optimistic.filter(
      item => item.mutationId !== mutationId,
    );

    // Re-run all of our optimistic data actions on top of one another.
    this.optimistic.forEach(change => {
      change.data = this.collectPatch(this.cache.getData(), change.changeFn);
    });
  }

  public markUpdateQueryResult(
    document: DocumentNode,
    variables: any,
    newResult: any,
  ) {
    replaceQueryResults(
      this.cache.getData(),
      { document, variables, newResult },
      this.config,
    );
  }

  public reset() {
    this.cache.reset();
  }

  public executeWrites(writes: DataWrite[]) {
    writes.forEach(write => {
      writeResultToStore({
        result: write.result,
        dataId: write.rootId,
        document: write.document,
        variables: write.variables,
        store: this.cache.getData(),
        dataIdFromObject: this.config.dataIdFromObject,
        fragmentMatcherFunction: this.config.fragmentMatcher,
      });
    });
  }

  private collectPatch(before: NormalizedCache, fn: () => void): any {
    const orig = this.cache.getData();
    this.cache.setData(cloneDeep(before));
    fn();
    const after = this.cache.getData();
    this.cache.setData(orig);

    const patch: any = {};

    Object.keys(after).forEach(key => {
      if (after[key] !== before[key]) {
        patch[key] = after[key];
      }
    });

    return patch;
  }
}
