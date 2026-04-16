# Skills Manager for VS Code

A Visual Studio Code extension that provides a graphical interface for managing agent skills using the [Vercel Skills CLI](https://github.com/vercel-labs/skills).

## Features

### 🎯 **Visual Skills Management**
- **Tree view** of all installed skills organized by scope and agent
- **Interactive explorer** with searchable skill repository
- **One-click install/update/remove** operations
- **Multi-repository support** for your custom skills

### 📚 **Repository Management**
- **Configure multiple repositories** (GitHub, GitLab, local paths)
- **Support for private repositories** with authentication
- **Real-time synchronization** and caching
- **Repository validation** and error handling

### ⚙️ **Flexible Configuration**
- **Global vs Project scope** installation options
- **Target specific agents** (GitHub Copilot, Claude Code, Cursor, etc.)
- **Auto-update preferences** and CLI management
- **Import/export** repository configurations

## Installation

### Prerequisites

First, install the Skills CLI globally:
```bash
npm install -g skills
```

### Extension Installation
1. Install from the VS Code Marketplace (coming soon)
2. OR install from VSIX:
   ```bash
   code --install-extension skills-manager-1.0.0.vsix
   ```

## Quick Start

1. **First Setup**: Ensure the Skills CLI is installed (see prerequisites above)
2. **Add Repository**: Click the "+" button in the Skills Manager sidebar
3. **Browse Skills**: Use the Skills Explorer to discover available skills
4. **Install Skills**: Click "Install" on any skill card or use Ctrl+Shift+P → "Skills: Install Skills..."

## Usage

### Adding a Repository

1. Open the Skills Manager panel in the sidebar (📦 icon)
2. Click "+" next to "Repositories"
3. Choose repository type:
   - **GitHub**: `username/repository` or full URL
   - **GitLab**: Full GitLab URL
   - **Local**: Path to local skills folder

### Installing Skills

**Method 1: Skills Explorer**
1. Click "Show Skills Explorer" in the tree view
2. Browse or search for skills
3. Click "Install" on desired skills

**Method 2: Quick Install**
1. Press `Ctrl+Shift+P` (Cmd+Shift+P on Mac)
2. Run "Skills: Install Skills..."
3. Select from available skills

**Method 3: Tree View**
1. Right-click any skill in the tree
2. Choose "Install Skill"

### Managing Installed Skills

- **Update**: Right-click → "Update Skill" or use "Update All Skills"
- **Remove**: Right-click → "Uninstall Skill"
- **View Details**: Click any skill to see details

## Configuration

### Repository Settings

```json
{
  "skills.repositories": [
    {
      "id": "my-skills",
      "name": "My Custom Skills",
      "url": "myusername/my-skills-repo", 
      "type": "github"
    }
  ]
}
```

### Default Settings

```json
{
  "skills.defaultScope": "project",        // "global" | "project"
  "skills.autoUpdate": false,              // Auto-update skills
  "skills.targetAgents": [                 // Default agents
    "github-copilot",
    "claude-code", 
    "cursor"
  ],
  "skills.autoInstallCli": true            // Auto-install Skills CLI
}
```

## Supported Agents

The extension works with any agent supported by the Skills CLI:

- GitHub Copilot
- Claude Code  
- Cursor
- Cline/Windsurf
- Continue
- CodeBuddy
- OpenCode
- And 40+ more...

## Commands

| Command | Description |
|---------|-------------|
| `Skills: Show Skills Explorer` | Open the main skills browser |
| `Skills: Install Skills...` | Interactive skill installation |
| `Skills: Update All Skills` | Update all installed skills |
| `Skills: Refresh` | Refresh skills and repository data |

## Requirements

- **VS Code 1.74.0** or higher
- **Node.js 16+** and **npm** 
- **Git** (for remote repositories)

The extension will automatically install the Skills CLI if needed.

## Repository Structure

When creating your own skills repository, use this structure:

```
my-skills-repo/
├── skills/
│   ├── my-skill-1/
│   │   └── SKILL.md
│   └── my-skill-2/
│       └── SKILL.md
└── README.md
```

Each `SKILL.md` needs frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---

# My Skill

Instructions for the agent...
```

## Troubleshooting

### Skills CLI Not Found
- Enable auto-install: `"skills.autoInstallCli": true`
- Manual install: `npm install -g @vercel/skills`

### Repository Not Loading
- Check URL format and network connection
- Verify repository contains valid `SKILL.md` files
- Check VS Code Output → "Skills Manager" for errors

### Skills Not Installing
- Ensure target agents are installed
- Check skill name doesn't conflict
- Verify repository permissions for private repos

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Changelog

### 1.0.0
- ✨ Initial release
- 🎯 Visual skills management
- 📚 Multi-repository support
- ⚙️ Flexible configuration
- 🔍 Skills explorer with search

---

**Made with ❤️ for the VS Code community**