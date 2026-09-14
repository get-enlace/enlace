# @get-enlace/ui

The canvas UI for [Enlace](https://github.com/get-enlace/enlace) — a visual, chained-execution
canvas for any OpenAPI-documented API. This package is the operations list, the drag-and-drop
canvas, the node inspector, and the debug pane, built once and shipped as a static bundle.
Chain execution lives in the private workspace package
[`@get-enlace/core`](https://github.com/get-enlace/enlace/tree/main/packages/core)
(bundled into this package's browser build; not a separate npm publish).

## You probably don't want to install this directly

`@get-enlace/ui` is consumed by a framework adapter, which serves this package's built bundle
alongside your API's OpenAPI document — that's almost always what you actually want to install:

- Node/Express — [`@get-enlace/express`](https://www.npmjs.com/package/@get-enlace/express)
- Node/NestJS — [`@get-enlace/nest`](https://www.npmjs.com/package/@get-enlace/nest)
- ASP.NET Core — [`Enlace.AspNetCore`](https://www.nuget.org/packages/Enlace.AspNetCore) (NuGet)

This package exists as a standalone npm dependency so those adapters — and any future ones — can
each pull in the same UI bundle via their own ecosystem's normal install step, without duplicating
or embedding it themselves.

## Learn more

See the [`enlace` repo](https://github.com/get-enlace/enlace) for the full picture: how
Enlace works, its architecture, and the roadmap.
