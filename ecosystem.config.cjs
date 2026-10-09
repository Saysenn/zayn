/**
 * ***************************************************
 * * RUNNING THE CRM AND WHATBOT FOR REAL: pm2, not `--watch`
 * ***************************************************
 * 2026-10-09. `npm run dev` / `dev:worker` use `node --watch`, which is for
 * editing code: it restarts on every saved file, and on a CRASH it does
 * NOT restart at all ("Waiting for file changes before restarting"), so a
 * crash at 3am leaves the bot down until somebody looks.
 *
 * pm2 is the opposite: never restarts on a file save, always restarts on a
 * crash (with a growing pause, so a crash loop does not hammer WhatsApp or
 * Redis), keeps logs, and survives closing the terminal.
 *
 *   npm i -g pm2                         once
 *   pm2 start ecosystem.config.cjs       from the repo root
 *   pm2 logs whatbot-worker              what the bot is doing
 *   pm2 restart whatbot-worker           after pulling new code
 *   pm2 stop all
 *
 * Stop the `npm run dev` / `dev:worker` terminals first: two workers would
 * fight over the same WhatsApp sessions.
 */
const restart = {
  autorestart: true,
  // A crash loop backs off (0.1s, then doubling up to 15s) instead of
  // reconnecting WhatsApp a hundred times a minute.
  exp_backoff_restart_delay: 100,
  max_restarts: 50,
  // The worker closes its sockets and queues on SIGTERM (worker.js), with
  // its own 10s limit; give it that before a hard kill.
  kill_timeout: 12000,
  time: true,
};

module.exports = {
  apps: [
    {
      name: 'crm-api',
      cwd: './crm/api',
      script: 'server.js',
      // NODE_ENV left as it is: production switches cookies and CORS to the
      // deployed settings, which would refuse a login over plain http here.
      max_memory_restart: '800M',
      ...restart,
    },
    {
      name: 'whatbot-worker',
      cwd: './whatbot',
      script: 'src/worker.js',
      // Holds the WhatsApp sockets: ONE instance only, ever.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      ...restart,
    },
    {
      name: 'whatbot-server',
      cwd: './whatbot',
      script: 'src/server.js',
      max_memory_restart: '300M',
      ...restart,
    },
  ],
};
