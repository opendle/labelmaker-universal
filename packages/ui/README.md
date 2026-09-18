# Shared editor UI

This package contains the React application, editor state, and desktop and
mobile view components. It receives a `LabelmakerHost` interface from the application shell.
It does not import Electron, Node file APIs, Bluetooth libraries, or concrete
adapters.

The editor supports ordered plates, text, images, drawings, shapes, and codes.
It uses the same document model and printer controls in desktop and mobile
layouts. Printer actions always go through the injected host interface.
