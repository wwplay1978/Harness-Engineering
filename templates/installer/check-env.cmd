@echo off
REM check-env.cmd - zero-dependency bootstrap (phase 1 step 1).
REM ASCII-only by design: cmd.exe parses batch in ANSI codepage, UTF-8
REM   Chinese comments break it (proof 2026-09-06).
REM USAGE: check-env.cmd [--vault path] [--project path]
REM Design: docs/16-host-agnostic-installer.md (harness spec repo)
where node >nul 2>&1
if errorlevel 1 (
  echo [MISS] node not installed - it is the runtime for the three
  echo        formal hooks and all installer scripts below.
  echo        Install Node.js ^>=20 first ^(https://nodejs.org or
  echo        "winget install OpenJS.NodeJS.LTS"^), then reopen the
  echo        terminal and run this script again.
  exit /b 1
)
node "%~dp0check-env.mjs" %*

