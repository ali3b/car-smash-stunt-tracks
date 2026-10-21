import { defineConfig, configDefaults } from 'vitest/config';

// Agent worktrees under .claude/worktrees hold other branches' tests; never run them from this checkout.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
