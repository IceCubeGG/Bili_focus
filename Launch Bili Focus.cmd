@echo off
setlocal
pushd "%~dp0"
set "BILI_COMPAT_ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%BILI_COMPAT_ELECTRON%" set "BILI_COMPAT_ELECTRON=%~dp0..\..\node_modules\electron\dist\electron.exe"
if not exist "%BILI_COMPAT_ELECTRON%" (
  echo Run npm ci in this compatibility folder first.
  pause
  popd
  exit /b 1
)
if not exist "dist-electron\main.cjs" (
  call npm run build
  if errorlevel 1 (
    pause
    popd
    exit /b 1
  )
)
"%BILI_COMPAT_ELECTRON%" .
popd
