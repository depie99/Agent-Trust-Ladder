@echo off
REM ATL team installer — puts the `atl` CLI in %USERPROFILE%\.atl
REM Options: --no-path (do not touch PATH), ATL_HOME=<dir> (custom location)
node "%~dp0install.mjs" %*
