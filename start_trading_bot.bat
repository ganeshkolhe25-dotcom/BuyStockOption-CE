@echo off
echo ====================================================
echo      GANN-9 AUTONOMOUS TRADING BOT INITIALIZATION
echo ====================================================
echo.

echo [1/2] Starting NestJS Backend Engine (Port 3001) ...
cd backend
start "Backend Trading Engine" cmd /k "npm run start"

cd ..

echo [2/2] Starting NextJS Frontend Dashboard (Port 3000) ...
cd frontend
start "Frontend Dashboard" cmd /k "npm run dev"

echo.
echo ====================================================
echo SUCCESS: Both engines are booting up in separate windows!
echo DO NOT CLOSE the two black terminal windows that just opened.
echo You can minimize them.
echo.
echo Dashboard will be live at: http://localhost:3000
echo ====================================================
pause
