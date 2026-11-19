# Install Caronte from inside Claude Code

Open Claude Code in the Git worktree where you want to use Caronte. Paste the prompt below. The install is scoped to that worktree, and the current session may need restarting to load the project instructions and profiles.

Destination permissions and any prompts from Claude Code or the operating system still apply.

## Copy this prompt

> Install **Caronte** from `https://github.com/manuel-albanesee/Caronte.git` for this Git worktree. I authorize downloading this repository into a temporary directory and running its installer, including the full ECC and Headroom checkouts, the Headroom proxy CLI, and RTK if missing.
>
> 1. Get the target worktree root with `git rev-parse --show-toplevel`. Check Git, Node.js 22+, Python 3.11+, and Claude Code 2.1.327+. If a prerequisite fails, identify it before making changes.
> 2. Clone the URL above into a fresh temporary directory outside the target worktree. Verify the origin and record the exact commit with `git rev-parse HEAD`. Read the repository's `README.md`, `LICENSE`, `install.cjs`, and `rtk-setup.cjs`.
> 3. With absolute, quoted paths, run `node "<clone>/install.cjs" "<worktree-root>" --dry-run`. Review `changed`, `ecc`, `headroom`, `rtk`, and `checkEnvironmentOverrides`. Resolve simple conflicts by preserving the project's custom instructions and hooks. If you cannot preserve them, show the conflicting file and stop before installation. Do not edit global settings or override managed policies.
> 4. Run `node "<clone>/install.cjs" "<worktree-root>"` and inspect the JSON and exit code. Run the same command with `--verify`. If RTK needs a refreshed PATH, report what was installed and restart the terminal before repeating verification. If the package manager fails, distinguish core installation from RTK setup and report the actionable error.
> 5. After the core kit is installed, add the attribution from the README to this project's README, credits, or equivalent documentation. Reuse any existing credit. Read back the managed `CLAUDE.md` block and project hook registration. Report the source commit, project path, verification status, RTK status, and any backup path. Ask me to start a fresh Claude Code session using my usual launch command. In that session, confirm the profiles with `/agents` and the hooks with `/hooks`. Distinguish disk verification from checks actually observed in Claude Code. Tell me that local telemetry turns on by default at the first startup or resume with Caronte. Show `/caronte-telemetry-off` to stop it for this worktree and `/caronte-telemetry-on` to turn it back on. Preserve any existing preference.

Terminal installation and technical details are in the [README](README.md).
