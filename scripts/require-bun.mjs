// Run with Node too, so other package managers fail with a useful message.
const userAgent = process.env.npm_config_user_agent ?? '';
if (!userAgent.startsWith('bun/1.3.13 ') && userAgent !== 'bun/1.3.13') {
  console.error('TraceKit requires Bun 1.3.13. Run: bun install --frozen-lockfile');
  process.exit(1);
}
