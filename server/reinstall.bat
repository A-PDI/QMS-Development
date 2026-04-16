@echo off
echo Removing old node_modules...
rmdir /s /q node_modules 2>nul
echo Installing dependencies (no native compilation required)...
npm install
echo.
echo Seeding database...
npm run seed
echo.
echo Done! Run "npm run dev" to start the server.
pause
