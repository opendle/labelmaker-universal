# iPhone Duo readiness

Assessment date: September 10, 2026.

## Published requirements

Apple announced iPhone Duo on September 9, 2026. It has a 5.4-inch outer
display, a 7.6-inch inner display, and iOS 27. It supports folding and Split
View. Apple lists availability from October 23, 2026.

Apple's developer guidance requires flexible layouts across window sizes.
The inner display has regular size classes in both dimensions and does not
honor supported interface orientations. Safe areas can differ on opposite
edges. Apps must use the current scene's geometry, rather than assume one
main screen.

Apple states that existing apps run without recompilation. Builds with the
iOS 27 SDK use more of the inner display; builds with the iOS 27.1 SDK can
reach the screen edge. Xcode 27.1 Device Hub provides the Duo simulator.
The iOS 27.1 reserved-region APIs report active fold divisions and camera
occlusions. Custom controls and dialogs need checks against those regions.

## Current application

- The native target already supports iPhone and iPad, with iOS 17 as the
  deployment minimum. `UIRequiresFullScreen` is false.
- The editor uses the current web window dimensions and resize events.
  CSS portrait queries describe the viewport shape, not device orientation.
- The shared CSS reads each safe-area edge separately. The standard mobile
  toolbar and inspector now also allow for side insets. Native Duo tests must
  still confirm that all controls stay inside the reported safe area.
- A large height-only resize now updates the mobile layout when no field has
  focus and the software keyboard was not open. Desktop resizing also works
  while a field has focus.
- Unit tests cover height-only changes and preserve the existing keyboard
  tests. The responsive browser check changes window sizes without reloading,
  checks the layout and plate strip, and verifies that text edits and undo/redo
  survive. The extra sizes are synthetic test inputs, not Duo specifications.
- `npm run check` passed with 577 tests passed and one skipped. React Doctor
  reported 100 with zero diagnostics. `npm run responsive:screenshots` passed
  in WebKit and Chromium, including the window transitions. Current phone and
  tablet screenshots were inspected.
- The application uses CoreBluetooth for printer transport. The announcement
  does not establish a need to change MakeID protocol packets.

## Open validation and implementation

The application is not yet verified as fully ready for iPhone Duo. Linux
browser checks do not run the native shell or prove physical printer access.

1. On a Mac, build with Xcode 27.1 and the iOS 27.1 SDK. Keep the iOS 17
   deployment minimum. Confirm the SDK used by the archive; the existing
   `SDKROOT = iphoneos` setting selects the installed SDK.
2. Run the native tests and Device Hub checks with Duo open, closed, rotated,
   and partially folded. Check Split View and window resizing with and without
   the software keyboard. Confirm that workspace edits, selection, undo,
   dialogs, document pickers, and print state survive display transitions.
   The current mobile keyboard detection can mistake a height-only resize for
   a software keyboard when a field has focus from a hardware keyboard. It can
   then keep the old layout and hide the plate strip. Connect native keyboard
   geometry to the shared layout logic and verify this case on each mobile
   platform; the iOS host does not yet provide that signal.
3. Integrate the active native reserved regions with the custom web editor.
   It currently has no fold-division or camera-occlusion layout support.
   Keep controls and dialogs out of active regions, and keep the label canvas
   usable. Use the SDK's actual region geometry; do not infer hinge locations
   or device pixel sizes from the display diagonal.
4. Check asymmetric safe areas on both displays, including toolbar actions,
   properties, drawing controls, menus, and dialogs. Browser safe-area values
   alone do not prove native reserved-region support.
5. On a physical Duo, complete Open, Save, recovery after backgrounding, image
   import, printer discovery, and MakeID E1 printing. Check display transitions
   during a print job. Record the OS, app build, printer, and results before
   making a device support claim.

## Sources

- [Apple announcement, September 9, 2026](https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/)
- [Prepare your app for iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111461/),
  especially 0:30, 1:17, 2:46, 3:57, 6:06, and 8:08.
- [Strike a pose with adaptive layouts on iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111463/),
  especially 1:29, 6:39, 7:50, and 16:34.
