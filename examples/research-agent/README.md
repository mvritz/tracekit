# Offline research agent

From the repository root, run `pnpm install --frozen-lockfile` and `pnpm dev`. In another terminal run `pnpm demo:record`, `pnpm demo:failure`, and `pnpm demo:replay`. No model account, API key, or external service is used.

Three fixed documents feed a local summary stub. A citation validator intentionally fails for `demo:failure`. Each trace has eight spans. Demo fixtures are explicitly opted-in synthetic data stored in ignored `.tracekit/` with private permissions. The replay command uses the same workflow with live tools disabled and asserts zero live handler calls. `pnpm demo:replay .tracekit/failure-fixture.json` reproduces the validation failure.

Set `DEMO_FAIL=1` with `demo:record` to generate a failure fixture too. These scripts overwrite only their synthetic fixture files. For real data, use the SDK's exclusive `saveReplayFixture` API and review sanitization before sharing.
