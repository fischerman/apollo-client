import * as chai from 'chai';
import ApolloClient from "../src/ApolloClient";
import gql from "graphql-tag";
import {MockNetworkInterface} from "./mocks/mockNetworkInterface";
import {observableToPromiseAndSubscription} from "./util/observableToPromise";
import {ApolloError} from "../src/errors/ApolloError";
const { assert } = chai;

describe('network error on polling', () => {
    const query = gql`
        query thing {
          value
        }
    `;
    const result = {
        data: {
            value: 1
        },
    };
    it('will catch a network error on a poll', () => {

        const networkInterface = new UnreliableNetworkInterface([
            {request: {query}, result},
            {request: {query}, result}
        ]);
        const client = new ApolloClient({
            networkInterface
        });
        const observable = client.watchQuery({
            query: query,
            pollInterval: 1000
        });

        const { promise, subscription } = observableToPromiseAndSubscription(
            {
                observable,
                wait: 10,
                errorCallbacks: [
                    (err: ApolloError) => {
                        assert(err.networkError instanceof Error)
                    }
                ]
            },
            ({data}) => { assert(data.value === 1) }
        );

        return promise;

    })
});

// always returns network error after the first query
class UnreliableNetworkInterface extends MockNetworkInterface {
    private count = 0;
    public query(request: Request) {
        if(this.count > 0) {
            throw new SimulatedNetworkError("Network error")
        }
        this.count++;
        return super.query(request)
    }
}

class SimulatedNetworkError extends Error {}
