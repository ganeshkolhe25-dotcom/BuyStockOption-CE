@echo off
echo =======================================================
echo     FRONTEND GCP DEPLOYMENT SCRIPT
echo =======================================================

echo.
echo [1/2] Fetching your GCP Project ID...
FOR /F "tokens=*" %%g IN ('gcloud config get-value project') do (SET PROJECT_ID=%%g)
echo Found Project ID: %PROJECT_ID%
echo.

echo [2/2] Packing and Deploying Frontend directly to Cloud Run...
call gcloud run deploy stock-bot-frontend --source . --platform managed --region us-central1 --allow-unauthenticated

echo.
echo =======================================================
echo ✅ FRONTEND DEPLOYMENT COMPLETE!
echo =======================================================
pause
