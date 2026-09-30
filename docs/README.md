# StreamShell documentation

This directory describes the current implementation and the development setup.
Start with the architecture overview, then use the focused documents for runtime
flows, settings, installation, and implementation history.

## Guides

| Document | Purpose |
|---|---|
| [Installation and development](./03-installation-guide.md) | Prerequisites, Twitch API credentials, local setup, GNOME/Wayland caveats, and user settings |
| [Research and resources](./01-research-and-resources.md) | Protocols, external APIs, image formats, and primary references |
| [Development log](./02-development-log.md) | Implemented capabilities, key design decisions, and known operational limits |

## Architecture

| Document | UML view | Critical concern |
|---|---|---|
| [Components](./architecture/01-components.md) | Component | Process boundaries and responsibility ownership |
| [Message sequence](./architecture/02-sequence-flow.md) | Sequence | Ordered Twitch message processing through D-Bus and GNOME rendering |
| [Class and data structure](./architecture/03-class-structure.md) | Class | Runtime objects, module services, and message payload types |
| [Runtime pipelines and states](./architecture/04-runtime-pipelines-and-states.md) | Activity and state machine | Connection, emote lookup, overlay lifecycle, and animation pause/resume |
| [Deployment and use cases](./architecture/05-deployment-and-use-cases.md) | Deployment and use case | Linux process placement, Wayland constraints, and user-visible settings |

### UML diagram selection

The common UML 2.x diagram set contains 14 types. This documentation selects
the views that illuminate the app's current risk and integration boundaries:
component, deployment, class, sequence, activity, state-machine, and use-case.
The omitted types are package, object, composite-structure, profile,
communication, interaction-overview, and timing. Package-level responsibilities
are covered by the component view; the other omitted types would repeat these
flows or describe detail that is not modeled as a separate runtime concern.

Diagrams describe the implementation at the time of writing; they are not a
separate contract. Update the relevant view when changing a process boundary,
IPC payload, persistent setting, or lifecycle transition.

Sequence, class, and state-machine diagrams use Mermaid. Component, activity,
deployment, and use-case diagrams are PlantUML source blocks and require a
PlantUML-capable viewer or extension to render.
