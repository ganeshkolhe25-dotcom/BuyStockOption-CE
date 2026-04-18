@echo off
setlocal

set GCLOUD="C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
set PROJECT=project-2f647b6c-d2ba-4001-970
set ZONE=asia-south1-b
set VM=shoonya-trader
set GC=%GCLOUD% compute --project %PROJECT%

echo ======================================================
echo   Gargee Algo - Website + Frontend Deploy
echo ======================================================

REM ── Step 1: Upload marketing website ──────────────────
echo.
echo === [1/5] Uploading marketing website ===
%GC% scp website/index.html %VM%:/home/maddy/index.html --zone %ZONE%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] SCP index.html failed && exit /b 1 )

%GC% ssh %VM% --zone %ZONE% --command "sudo mkdir -p /var/www/gargeealgo && sudo cp /home/maddy/index.html /var/www/gargeealgo/index.html && sudo chown -R www-data:www-data /var/www/gargeealgo"
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Copy to www root failed && exit /b 1 )
echo Marketing site uploaded OK

REM ── Step 2: Nginx + SSL setup ─────────────────────────
echo.
echo === [2/5] Setting up Nginx + SSL ===
%GC% scp vm-nginx-domain-setup.sh %VM%:/home/maddy/vm-nginx-domain-setup.sh --zone %ZONE%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] SCP nginx script failed && exit /b 1 )

%GC% ssh %VM% --zone %ZONE% --command "chmod +x /home/maddy/vm-nginx-domain-setup.sh && sudo /home/maddy/vm-nginx-domain-setup.sh"
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Nginx setup failed && exit /b 1 )
echo Nginx + SSL configured OK

REM ── Step 3: Pack and upload frontend ──────────────────
echo.
echo === [3/5] Packing frontend source ===
if exist "%TEMP%\fe-website-deploy.tar.gz" del /f "%TEMP%\fe-website-deploy.tar.gz"

tar --exclude="frontend/node_modules" ^
    --exclude="frontend/.next" ^
    --exclude="frontend/.git" ^
    -czf "%TEMP%\fe-website-deploy.tar.gz" frontend/
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] tar failed && exit /b 1 )
echo Packed OK

%GC% scp "%TEMP%\fe-website-deploy.tar.gz" %VM%:/home/maddy/fe-website-deploy.tar.gz --zone %ZONE%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] SCP frontend tar failed && exit /b 1 )
echo Frontend source uploaded OK

REM ── Step 4: Build frontend on VM ──────────────────────
echo.
echo === [4/5] Building frontend image on VM (takes ~5 min) ===
%GC% scp vm-frontend-setup.sh %VM%:/home/maddy/vm-frontend-setup.sh --zone %ZONE%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] SCP frontend setup script failed && exit /b 1 )

%GC% ssh %VM% --zone %ZONE% --command "chmod +x /home/maddy/vm-frontend-setup.sh && bash /home/maddy/vm-frontend-setup.sh"
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Frontend build/start failed && exit /b 1 )
echo Frontend container running OK

REM ── Step 5: Reload Nginx ──────────────────────────────
echo.
echo === [5/5] Reloading Nginx ===
%GC% ssh %VM% --zone %ZONE% --command "sudo nginx -t && sudo systemctl reload nginx"
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Nginx reload failed && exit /b 1 )

echo.
echo ======================================================
echo   DEPLOY COMPLETE
echo   https://gargeealgo.co.in           - marketing site
echo   https://gargeealgo.co.in/terminal  - trading app
echo   https://gargeealgo.co.in/api/      - backend API
echo ======================================================
echo.
echo ACTION: Set DNS A records to 35.200.239.116
echo   gargeealgo.co.in     -> 35.200.239.116
echo   www.gargeealgo.co.in -> 35.200.239.116
echo.
endlocal
