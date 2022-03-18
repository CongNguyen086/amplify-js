# AWS Amplify DataStore Docs

[Amplify DataStore](https://docs.amplify.aws/lib/datastore/getting-started/q/platform/js/) provides a programming model for leveraging shared and distributed data without writing additional code for offline and online scenarios, which makes working with distributed, cross-user data just as simple as working with local-only data.

| package                | version                                                         |
| ---------------------- | --------------------------------------------------------------- |
| @aws-amplify/datastore | ![npm](https://img.shields.io/npm/v/@aws-amplify/datastore.svg) |

## Getting Started

Before you start reading through these docs, take a moment to understand [how DataStore works at a high level](https://docs.amplify.aws/lib/datastore/how-it-works/q/platform/js/). Additionally, we recommend first reading through [docs.amplify.aws](https://docs.amplify.aws/lib/datastore/getting-started/q/platform/js/). The purpose of these docs is to dive deep into the codebase itself and understand the inner workings of DataStore for the purpose of contributing. Understanding these docs is **not** necessary for using DataStore. Lastly, before reading, take a look at [the diagrams below](#diagrams).

## Docs

- [Conflict Resolution](docs/conflict-resolution.md)
- [Contributing](docs/contributing.md)
- [DataStore Lifecycle Events ("Start", "Stop", "Clear")](docs/datastore-lifecycle-events.md)
  - This explains how DataStore fundementally works, and is a great place to start.
- [Getting Started](docs/getting-started.md) (Running against sample app, etc.)
- [Local Databases](docs/local-databases.md)
- [Namespaces](docs/namespaces.md)
- [How DataStore uses Observables](docs/observables.md)
- [Schema Changes](docs/schema-changes.md)
- [Storage](docs/storage.md)
- [Sync Engine](docs/sync-engine.md)
- [How DataStore uses PubSub](docs/pubsub.md)

## Other Resources:

- [High-level overview of how DataStore works](https://docs.amplify.aws/lib/datastore/how-it-works/q/platform/js/)
- [DataStore Docs](https://docs.amplify.aws/lib/datastore/getting-started/q/platform/js/)
- [re:Invent talk](https://www.youtube.com/watch?v=KcYl6_We0EU)

# Diagrams

_Note: relationships with dotted lines are explained more in a separate diagram._

## How API and Storage Engine Interact

```mermaid
flowchart TD
  %% API and Storage
  api[[DS API]]-- observe -->storage{Storage Engine}
  storage-- next -->adapter[[Adapter]]
  adapter-->db[[Local DB]]
  db-->api
  sync[[Sync Engine*]]-.-storage
  sync-.-appSync[(AppSync)]
```

# How the Sync Engine observes changes in Storage and AppSync

_Note: All green nodes belong to the Sync Engine._

\* Merger first checks outbox

\*\* Outbox sends outgoing messages to AppSync

TODO: If it doesn't make the diagram to convoluted, map how sub and sync records are persisted to storage

```mermaid
flowchart TD

  sync{Sync Engine}-- observe -->reach[Core reachability]

  reach--next-->mp[Mutation Processor]
  reach--next-->sp[Subscription Processor]
  reach--next-->syp[Sync Processor]

  %% mp-->mergef[merger]-->storage{Storage Engine}
  api[DS API]-.->storage
  mp-- observe -->storage{Storage Engine}
  storage-- next -->merger[merger*]-- next -->storage


  sp-- observes -->appsync[(AppSync)]
  appsync-- next -->sp

  syp---appsync

  mp-->outbox[outbox**]

  %% styling
  classDef syncEngineClass fill:#8FB,stroke:#333,stroke-width:4px;
  class sync,mp,sp,syp,merger,outbox syncEngineClass;
```
