@echo off
rem Runs the contract tests from this folder, no matter where you start it.
rem Double-click it, or run it from PowerShell / Command Prompt.
cd /d "%~dp0"

set "PY=%USERPROFILE%\.tideline-venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Test tools not found at %PY%
  echo See "Running the tests" in README.md to set them up.
  pause
  exit /b 1
)

"%PY%" -m pytest -v %*
if "%~1"=="" pause
