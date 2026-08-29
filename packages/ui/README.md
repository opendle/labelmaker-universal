# Shared desktop UI

This package contains the React application, editor state, and desktop view
components. It receives a `LabelmakerHost` interface from the application shell.
It does not import Electron, Node file APIs, Bluetooth libraries, or concrete
adapters.

The current mock supports printer selection and discovery, multiple plates,
editable and movable text, plate settings, save state, and print feedback.
Printer actions always go through the injected host interface.
