@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
REM ============================================================
REM fix-pg0-junction.cmd - v3 PARAMETERIZED (+ --rehearse)
REM Purpose: pg0 (embedded postgres used by hindsight service,
REM   running as LocalSystem) resolves its data dir via Windows
REM   Known-Folders API and IGNORES USERPROFILE/HOME env - so it
REM   writes to C:\Windows\System32\config\systemprofile\.pg0.
REM   Fix: junction that path back to the user's ~/.pg0.
REM v3 (2026-09-06): parameterized (no hardcoded user paths) +
REM   --rehearse read-only preview. ASCII-only by design.
REM v2 lessons kept (from the 2026-09-03 original):
REM   - kill lingering postgres.exe/pg0.exe BEFORE ren (open
REM     handles -> Access denied)
REM   - takeown + icacls to break SYSTEM ownership ACL if needed
REM   - every step gated on errorlevel (no unconditional echo)
REM Run ONCE in an ELEVATED terminal (rehearse needs no
REM   elevation). Idempotent.
REM USAGE: fix-pg0-junction.cmd [--rehearse] [paramsfile]
REM ============================================================

set "REHEARSE=0"
set "PARAMFILE=%~dp0hindsight-params.cmd"
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--rehearse" (set "REHEARSE=1") else (set "PARAMFILE=%~1")
shift
goto parse
:parsed

set "HSDIR=%USERPROFILE%\.hindsight"
set "NSSM=%HSDIR%\bin\nssm.exe"
if exist "!PARAMFILE!" (call "!PARAMFILE!")
set "SPG0=C:\Windows\System32\config\systemprofile\.pg0"
set "UPG0=%USERPROFILE%\.pg0"
set "BAKNAME=.pg0.bak-old"

if "!REHEARSE!"=="1" goto rehearse

net session >nul 2>&1
if errorlevel 1 (echo [FAIL] Run as Administrator ^(or use --rehearse^). & pause & exit /b 1)
if not exist "!NSSM!" (echo [FAIL] nssm.exe missing: !NSSM! & pause & exit /b 1)

REM 1) guard: user data must exist
if not exist "!UPG0!\instances\hindsight" (echo [FAIL] user data missing ^(!UPG0!\instances\hindsight^) - service never ran as user? abort. & pause & exit /b 1)
echo [1/6] User data confirmed: !UPG0!

REM 2) stop service, then kill lingering pg processes (NAME WHITELIST ONLY)
"!NSSM!" stop hindsight >nul 2>&1
timeout /t 3 /nobreak >nul
tasklist /fi "imagename eq postgres.exe" 2>nul | find /i "postgres.exe" >nul && (taskkill /f /im postgres.exe >nul 2>&1 & echo    killed lingering postgres.exe)
tasklist /fi "imagename eq pg0.exe" 2>nul | find /i "pg0.exe" >nul && (taskkill /f /im pg0.exe >nul 2>&1 & echo    killed lingering pg0.exe)
timeout /t 2 /nobreak >nul
echo [2/6] Service stopped, lingering PG processes cleared ^(whitelist only^).

REM 3) remove stale lock from dirty shutdown
if exist "!UPG0!\instances\hindsight\postmaster.pid" (del /f /q "!UPG0!\instances\hindsight\postmaster.pid" && echo    stale postmaster.pid removed)

REM 4) move existing systemprofile DB aside (gated; take ownership if denied)
if exist "!SPG0!" (
  dir /al "!SPG0!" >nul 2>&1
  if not errorlevel 1 (
    echo    !SPG0! is already a junction - nothing to move.
  ) else (
    ren "!SPG0!" "!BAKNAME!" 2>nul
    if exist "!SPG0!" (
      echo    ren denied - taking ownership...
      takeown /f "!SPG0!" /r /d y >nul 2>&1
      icacls "!SPG0!" /grant *S-1-5-32-544:F /t >nul 2>&1
      ren "!SPG0!" "!BAKNAME!"
    )
    if exist "!SPG0!" (echo [FAIL] cannot move !SPG0! aside even after takeown - abort. & pause & exit /b 1)
    echo    systemprofile DB moved aside: !BAKNAME!
  )
)
echo [3/6] systemprofile path is free.

REM 5) create junction (gated)
if not exist "!SPG0!" (
  mklink /J "!SPG0!" "!UPG0!" >nul
  if not exist "!SPG0!\instances\hindsight" (echo [FAIL] junction not resolving - abort. & pause & exit /b 1)
  echo    junction created: !SPG0!  -^>  !UPG0!
)
echo [4/6] Junction verified.

REM 6) start service (gated)
"!NSSM!" start hindsight
timeout /t 5 /nobreak >nul
sc query hindsight | findstr /i "STATE"
if not exist "!SPG0!\instances\hindsight" (echo [FAIL] post-start sanity failed. & pause & exit /b 1)
echo [5/6] Service started, data path still resolving.
echo [6/6] DONE. After ~90s verify: curl -s http://localhost:8888/v1/default/banks
pause
exit /b 0

:rehearse
echo ===== REHEARSE read-only preview (changes nothing) =====
echo NSSM        = !NSSM!
echo SPG0        = !SPG0!   ^(fixed system path^)
echo UPG0        = !UPG0!
echo BAKNAME     = !BAKNAME!
if exist "!UPG0!\instances\hindsight" (echo user data   : OK) else (echo user data   : MISSING ^(!UPG0!\instances\hindsight^) - real run will abort here)
if exist "!NSSM!" (echo nssm.exe     : OK) else (echo nssm.exe     : MISSING)
echo.
echo Real run would: 1^) stop hindsight + kill lingering postgres/pg0 ^(whitelist^)  2^) del stale postmaster.pid  3^) rename !SPG0! aside ^(takeown if denied^)  4^) mklink /J to user dir + verify  5^) start service + sanity check
echo To run for real: elevated terminal, WITHOUT --rehearse.
exit /b 0
