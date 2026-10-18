# Lightning app identity

The user-approved reference is preserved in `assets/branding/approved-lightning-reference.png`. The native geometry in `scripts/icon-artwork.cjs` reproduces the two blue lightning shapes and their long opposing extensions, on a white tile with a faint diagonal grid. Annotation marks and screenshot margins are not included in the installed icon.

Run `npm run icons:export` to regenerate the shared SVG/PNG, multi-resolution Windows ICO, and Android density/vector assets. The exporter uses a hidden isolated local Electron renderer, with external network requests blocked. It does not access accounts or devices.

Android uses separate background/foreground adaptive layers, a monochrome layer for themed icons, and legacy square/round icons. Foreground geometry stays within the central 66dp safe zone of a 108dp layer, including under circular masks. Android launchers control the final mask and may cache an old icon temporarily. See [Android adaptive icon guidance](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).

Windows packages embed the ICO in the executable and ship the PNG for the window/taskbar. The shared UI imports the same PNG; the web build uses the SVG favicon. Version 0.4.2 retains the existing app ID and Android signing identity so updating does not intentionally reset user data.
