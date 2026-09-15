module.exports = {
  apps: [{
    name: 'crypto-square-agent',
    cwd: __dirname + '/app',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    kill_timeout: 35000,
    env: { NODE_ENV: 'production' },
  }],
};
