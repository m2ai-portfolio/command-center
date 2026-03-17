module.exports = {
  apps: [
    {
      name: 'command-center',
      script: 'dist/server/server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        COMMAND_CENTER_PORT: '3142',
      },
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'agent-research',
      script: 'node_modules/.bin/tsx',
      args: 'agents/research/index.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        RESEARCH_AGENT_PORT: '3143',
      },
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
