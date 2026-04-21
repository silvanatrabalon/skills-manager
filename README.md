# Skills Manager Extension

A VS Code and Cursor extension that provides a graphical interface for managing agent skills. Built on top of the [Skills CLI](https://github.com/vercel-labs/skills) created by Vercel.

## Features

### 🎯 **Visual Skills Management**
- **Tree view** of all installed skills organized by scope (Global / Project)
- **One-click install/update/remove** with inline buttons
- **Automatic update detection** — checks for skill updates every 2 hours via GitHub API
- **Update indicator** on skills that have newer versions available

### 📚 **Repository Management**
- **Subscribe to multiple repositories** (GitHub, GitLab, local paths)
- **Browse available skills** from your subscribed repositories
- **Skill details panel** with full description in a formatted webview

### ⚙️ **Flexible Installation**
- **Choose scope**: Project only, Global, or Both
- **Choose target agents**: Cursor, GitHub Copilot, Claude Code, OpenCode, and more
- **Scope-aware updates**: update a skill in one scope without affecting the other

## GitHub Authentication (for update checking)

The extension checks for skill updates using the GitHub API. To enable this, configure your GitHub token from the **Configuration** section in the extension sidebar:

1. Open the Skills Manager panel
2. Click **"Configure GitHub Token"** under Configuration
3. Paste your [GitHub Personal Access Token](https://github.com/settings/tokens)

Without a token, you can still install and manage skills but update checking will be limited to 60 requests/hour for public repos and won't work for private repos.

## Installation
[Extension](https://marketplace.visualstudio.com/items?itemName=SilvanaTrabalon.skills-manager)
- Show Panel: `Cmd+Shift+P` → `Skills: Show Skills Explorer`

## Quick Start

1. **Add a Repository**: Click the "+" button in the Repositories section of the sidebar
3. **Browse Skills**: Expand "Available Skills" to see skills from your subscribed repos
4. **Install a Skill**: Click the install button on any available skill, choose scope and agents
5. **Check for Updates**: Use the refresh button or wait for automatic checks every 2 hours

## Usage

### Adding a Repository

1. Open the Skills Manager panel in the sidebar
2. Click "+" next to "Repositories"
3. Choose repository type (GitHub, GitLab, or Local)
4. Enter a name for the repository (e.g., "My Skills", "Company Skills")
5. Enter the repository URL or select a local folder

### Installing Skills

1. Expand "Available Skills" in the tree view
2. Click the install button (⬇) on any skill
3. Choose installation scope: Project only, Global, or Both
4. Select target agents (Cursor, GitHub Copilot, Claude Code, etc.)

### Updating Skills

- Skills with available updates show an update indicator (⬆) in the tree view
- Click the update button to update a specific skill
- Use `Cmd+Shift+P` → `Skills: Check for Updates` to force a check

### Removing Skills

- Click the uninstall button (🗑) on any installed skill
- Confirm the removal

## Supported Agents

The extension works with any agent supported by the Skills CLI:

- Cursor
- GitHub Copilot
- Claude Code
- OpenCode
- Antigravity
- Codex
- And 40+ more...

## Skill Discovery

The extension uses the Skills CLI for discovering skills in repositories. The CLI searches for folders containing a `SKILL.md` file across [many locations](https://github.com/vercel-labs/skills#skill-discovery) including `skills/`, agent-specific directories (`.cursor/skills/`, `.claude/skills/`, etc.), and the repository root itself.

## Lock Files

The extension uses lock files to track installed skills and detect updates:

- **Project lock** (`skills-lock.json` in your project root) — tracks skills installed with project scope. This file should be committed to your repo so all team members share the same skills.
- **Global lock** (`~/.agents/.skill-lock.json`) — tracks skills installed globally, managed by the Skills CLI.

After each install or update, the extension enriches these lock files with a `skillFolderHash` (the GitHub Tree SHA of the skill folder) which is used to detect when a newer version is available remotely.

