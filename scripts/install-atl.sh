#!/bin/sh
# ATL team installer — puts the `atl` CLI in ~/.atl
# Options: --no-path (do not touch PATH), ATL_INSTALL_DIR=<dir> (custom location)
exec node "$(dirname "$0")/install.mjs" "$@"
