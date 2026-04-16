# Changelog

All notable changes to the "Skills Manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-16

### ✨ Initial Release

#### Added
- **Visual Skills Management**
  - Tree view of installed skills organized by scope and agent
  - Interactive Skills Explorer with rich webview interface
  - One-click install/update/remove operations
  - Search and filter functionality

- **Multi-Repository Support**
  - Configure multiple skills repositories (GitHub, GitLab, local)
  - Repository validation and error handling
  - Real-time synchronization with caching
  - Support for private repositories

- **Flexible Configuration**
  - Global vs Project scope installation options
  - Target specific agents (GitHub Copilot, Claude Code, Cursor, etc.)
  - Customizable auto-update preferences
  - Automatic Skills CLI detection and installation

- **User Experience**
  - Intuitive sidebar panel with skills tree view
  - Rich webview for skill exploration and management
  - Progress indicators for long-running operations
  - Comprehensive error handling with user feedback

### 🏗️ Technical Implementation

#### Core Services
- **SkillsService**: High-level business logic for skill management
- **ConfigService**: Repository and settings management
- **SkillsCliService**: Wrapper for Vercel's skills CLI
- **SkillsTreeProvider**: VS Code tree view provider for sidebar
- **RepositoryProvider**: Repository management in sidebar

#### User Interface
- **Skills Explorer Webview**: Main interface for skill discovery and management
- **Command Handlers**: Integration with VS Code command palette
- **Context Menus**: Right-click actions for quick operations
- **Status Indicators**: Visual feedback for skill status

#### Developer Features
- TypeScript codebase with strict typing
- ESBuild-based compilation for fast builds
- ESLint configuration for code quality
- Comprehensive error handling and logging
- Extensible architecture for future enhancements

### 🔧 Commands Added

| Command | Description |
|---------|-------------|
| `Skills: Show Skills Explorer` | Open the main skills browser interface |
| `Skills: Install Skills...` | Interactive skill installation wizard |
| `Skills: Update All Skills` | Batch update all installed skills |
| `Skills: Refresh` | Refresh skills and repository data |
| `Skills: Add Repository` | Add a new skills repository |
| `Skills: Remove Repository` | Remove a configured repository |

### 🎯 Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `skills.repositories` | List of configured skills repositories | `[]` |
| `skills.defaultScope` | Default installation scope | `"project"` |
| `skills.autoUpdate` | Automatically update skills | `false` |
| `skills.targetAgents` | Default target agents for installations | `["github-copilot", "claude-code", "cursor"]` |
| `skills.autoInstallCli` | Automatically install Skills CLI if not found | `true` |

### 📋 Requirements
- VS Code 1.74.0 or higher
- Node.js 16+ and npm
- Git (for remote repositories)

### 🚀 Getting Started

1. Install the extension
2. Configure your first skills repository when prompted
3. Browse available skills in the Skills Explorer
4. Install skills with one click
5. Manage installed skills from the sidebar tree view

---

### 🤝 Contributing

We welcome contributions! Please see our development setup in the README for details on:
- Building the extension locally
- Running tests and linting
- Submitting pull requests

### 📄 License

MIT License - see LICENSE file for details.

---

*For more information, see the [README.md](README.md) file.*