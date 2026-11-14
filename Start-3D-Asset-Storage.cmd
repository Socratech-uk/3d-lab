@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto python
py -3 tools\asset_storage.py %*
goto done
:python
where python >nul 2>nul
if errorlevel 1 goto missing
python tools\asset_storage.py %*
goto done
:missing
echo Python 3 is required. Use the same Python installation as Foundry.
echo No assets have been changed.
:done
pause
