@echo off
rem Copy this file to vortex.config.cmd and edit it. start-vortex.cmd reads it on every start.
rem --out : your MobileWright project's tests folder (saved test cases go there)
rem --pkg : the app under test
rem --port: the local port of the recorder page (default 4700)
set VORTEX_ARGS=--out "C:\Projects\my-mobilewright-project\tests" --pkg com.yourname.tradehub
rem Select a phone with --device YOUR_ADB_SERIAL in VORTEX_ARGS when several are connected.
