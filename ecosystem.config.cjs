// PM2 process manager configuration for Windows Server deployment.
// Usage:
//   npm install -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 save                          ← persist across reboots
//   pm2 startup                       ← generate Windows startup script
//
// Common commands:
//   pm2 status                        ← view running processes
//   pm2 logs pdi-inspection           ← tail logs
//   pm2 restart pdi-inspection        ← restart after .env change
//   pm2 reload pdi-inspection         ← zero-downtime reload

module.exports = {
  apps: [
    {
      name: 'pdi-inspection',
      script: 'index.js',
      cwd: './server',

      // Node.js 22 requires this flag for the built-in SQLite module
      node_args: '--experimental-sqlite',

      // Number of instances — keep at 1 for SQLite (file-based DB can't be
      // safely shared across multiple processes without a connection manager).
      instances: 1,
      exec_mode: 'fork',

      // Restart behaviour
      autorestart: true,
      watch: false,           // Set to true only during active development
      max_memory_restart: '500M',

      // Environment — production values.
      // Sensitive values (JWT_SECRET, etc.) should be set in the server/.env
      // file on the Windows Server rather than committed here.
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },

      // Log file paths (Windows-friendly relative paths)
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
