# 0.6.0 UI rebuild: per-PR plans and agent rules

The master plan is `docs/superpowers/plans/2026-10-18-ui-architecture.md`. Each PR in the stack has its own plan here (`pr-NN-*.md`). Workflow per PR:
1. Claude writes the PR plan.
2. Composer 2.5 implements it.
3. Grok 4.7 does QA.
4. Composer 2.5 fixes anything QA finds.
5. Claude audits and does all visual checks, then pushes and opens the stacked PR.

## Rules for every delegated agent (Composer, Grok)

1. **Never open a browser or look at the UI.** That means:
   - no Playwright, Puppeteer, or headless Chrome
   - no `npm run dev` / `vite` / `vite preview` to view pages
   - no T3 preview or browser tools
   - no screenshots
   - **never launch the Tauri app window** (`tauri dev`, running the built app)
   
   Claude is the only one who looks at the UI. If a step needs a visual check, write "needs visual check: <what>" in your report and move on.
2. **Work only in the worktree you are given:** `/home/flow/Projects/personal/Arbor/.worktrees/ui-stack`. Stay on the branch that is checked out there. Don't switch branches, rebase, or touch other worktrees or the main checkout.
3. **Never push, open PRs, merge, or tag.** Commit locally only. End every commit message with your co-author line (`Co-Authored-By: Composer 2.5 <noreply@cursor.com>` or `Co-Authored-By: Grok 4.7 <noreply@x.ai>`).
4. **Don't invoke Claude through Arbor**, and don't run live provider jobs. Tests use fakes and `mockIPC`.
5. **Allowed commands:** `npm install`/`npm ci`, `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`, `npx vitest run`, `cargo test` / `cargo check` in `desktop/src-tauri`, and the shadcn CLI. Long-running watchers aren't allowed (no `--watch`, no dev servers).
6. **Follow the master plan §12 brief:**
   - no raw colors, px values, or arbitrary Tailwind values outside `src/index.css`
   - `Button` for every clickable element
   - lucide icons only
   - no `invoke` inside components
   - reuse `src/domain/*`
   - no manual `useMemo` / `useCallback` / `memo` (the React Compiler handles memoization)
7. **When you finish, report:**
   - what you changed (files)
   - the commands you ran and their results (pass/fail counts)
   - anything you skipped or couldn't verify
   - any "needs visual check" items

   Don't claim something passes without running it.
