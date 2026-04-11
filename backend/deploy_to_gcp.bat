@echo off
echo =======================================================
echo     SHOONYA BACKEND GCP DEPLOYMENT SCRIPT
echo =======================================================

echo.
echo [1/3] Fetching your GCP Project ID...
FOR /F "tokens=*" %%g IN ('gcloud config get-value project') do (SET PROJECT_ID=%%g)
echo Found Project ID: %PROJECT_ID%
echo.

echo [2/2] Packing and Deploying directly to Cloud Run using Native Buildpacks...
call gcloud run deploy shoonya-backend --source . --platform managed --region asia-south1 --allow-unauthenticated

echo.
echo =======================================================
echo ✅ NATIVE DEPLOYMENT COMPLETE! YOUR BOT IS NOW LIVE!
echo =======================================================
pause
