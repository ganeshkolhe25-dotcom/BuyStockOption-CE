@echo off
setlocal enabledelayedexpansion

set GCLOUD="C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
set PROJECT=project-2f647b6c-d2ba-4001-970
set ZONE=asia-south1-b
set VM=shoonya-trader
set REGION=asia-south1
set FRONTEND_SERVICE=shoonya-frontend
set VERSION=1.0.0

echo.
echo ============================================================
echo  BuyStockOption_CE  v%VERSION%  —  Full Deploy
echo  Backend  : GCP VM  (%VM%)
echo  Frontend : GCP Cloud Run (%FRONTEND_SERVICE%)
echo ============================================================
echo.

REM ─── BACKEND: pack & ship ────────────────────────────────────
echo === [1/6] Packing backend (excluding node_modules + dist) ===
cd /d C:\Ganesh\AntiGravity_APPs\BuyStockOption_CE
tar -czf shoonya-backend.tar.gz ^
    --exclude="backend/node_modules" ^
    --exclude="backend/dist" ^
    --exclude="backend/.env" ^
    backend
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] tar failed && exit /b 1 )
echo Backend packed OK

echo === [2/6] Uploading backend tar + env to VM ===
%GCLOUD% compute scp shoonya-backend.tar.gz %VM%:/home/maddy/shoonya-backend.tar.gz --zone %ZONE% --project %PROJECT%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] SCP tar failed && exit /b 1 )

%GCLOUD% compute scp vm-app-new.env %VM%:/home/maddy/vm-app.env --zone %ZONE% --project %PROJECT%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] SCP env failed && exit /b 1 )
echo Files uploaded OK

echo === [3/6] Rebuilding backend Docker container on VM ===
%GCLOUD% compute ssh %VM% --zone %ZONE% --project %PROJECT% --command "sudo bash /home/maddy/vm-setup.sh"
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] VM setup failed && exit /b 1 )
echo Backend container running OK

REM ─── FRONTEND: build image → GCR → Cloud Run ─────────────────
echo === [4/6] Authenticating Docker with GCR ===
%GCLOUD% auth configure-docker --project %PROJECT% --quiet
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Docker auth failed && exit /b 1 )

echo === [5/6] Building and pushing frontend Docker image ===
cd /d C:\Ganesh\AntiGravity_APPs\BuyStockOption_CE\frontend
docker build -t gcr.io/%PROJECT%/%FRONTEND_SERVICE%:v%VERSION% -t gcr.io/%PROJECT%/%FRONTEND_SERVICE%:latest .
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Docker build failed && exit /b 1 )

docker push gcr.io/%PROJECT%/%FRONTEND_SERVICE%:v%VERSION%
docker push gcr.io/%PROJECT%/%FRONTEND_SERVICE%:latest
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Docker push failed && exit /b 1 )
echo Frontend image pushed OK

echo === [6/6] Deploying frontend to Cloud Run ===
%GCLOUD% run deploy %FRONTEND_SERVICE% ^
    --image gcr.io/%PROJECT%/%FRONTEND_SERVICE%:v%VERSION% ^
    --platform managed ^
    --region %REGION% ^
    --allow-unauthenticated ^
    --port 8080 ^
    --memory 512Mi ^
    --cpu 1 ^
    --min-instances 0 ^
    --max-instances 3 ^
    --project %PROJECT%
if %ERRORLEVEL% NEQ 0 ( echo [ERROR] Cloud Run deploy failed && exit /b 1 )

echo.
echo ============================================================
echo  DEPLOY COMPLETE  v%VERSION%
echo  Backend  : https://35-200-239-116.sslip.io
echo  Frontend : check Cloud Run URL above
echo ============================================================
endlocal
