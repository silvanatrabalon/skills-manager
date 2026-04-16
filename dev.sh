#!/bin/bash

# Development script for Skills Manager VS Code Extension
# This script helps with common development tasks

set -e

echo "🚀 Skills Manager Development Helper"
echo "================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    echo "📋 Checking prerequisites..."
    
    if ! command_exists node; then
        echo "❌ Node.js is required but not installed"
        exit 1
    fi
    
    if ! command_exists npm; then
        echo "❌ npm is required but not installed"
        exit 1
    fi
    
    if ! command_exists code; then
        echo "❌ VS Code CLI is required but not installed"
        echo "   Install VS Code and add 'code' command to PATH"
        exit 1
    fi
    
    echo "✅ All prerequisites met"
}

# Install dependencies
install_dependencies() {
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
}

# Compile the extension
compile() {
    echo "🔨 Compiling extension..."
    npm run compile
    echo "✅ Compilation completed"
}

# Run linting
lint() {
    echo "🔍 Running ESLint..."
    npm run lint
    echo "✅ Linting completed"
}

# Start development mode with watch
dev() {
    echo "👀 Starting development mode with file watching..."
    npm run watch &
    WATCH_PID=$!
    
    echo "📝 Watch mode started (PID: $WATCH_PID)"
    echo "   Press F5 in VS Code to launch Extension Development Host"
    echo "   Press Ctrl+C to stop watching"
    
    trap "kill $WATCH_PID 2>/dev/null || true" EXIT
    wait $WATCH_PID
}

# Package the extension
package() {
    echo "📦 Packaging extension..."
    
    if ! command_exists vsce; then
        echo "📥 Installing vsce globally..."
        npm install -g vsce
    fi
    
    vsce package
    echo "✅ Extension packaged successfully"
}

# Run tests (placeholder for future implementation)
test() {
    echo "🧪 Running tests..."
    echo "ℹ️  Test suite will be implemented in a future version"
}

# Clean build artifacts
clean() {
    echo "🧹 Cleaning build artifacts..."
    rm -rf out/
    rm -rf *.vsix
    echo "✅ Clean completed"
}

# Show extension info
info() {
    echo "ℹ️  Extension Information"
    echo "========================"
    echo "Name: Skills Manager"
    echo "Version: $(node -p "require('./package.json').version")"
    echo "Description: $(node -p "require('./package.json').description")"
    echo "Main: $(node -p "require('./package.json').main")"
    echo ""
    echo "📁 Project Structure:"
    echo "├── src/           (TypeScript source code)"
    echo "├── out/           (Compiled JavaScript - generated)"
    echo "├── package.json   (Extension manifest)"
    echo "├── README.md      (Documentation)"
    echo "└── CHANGELOG.md   (Version history)"
}

# Show help
help() {
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  check      Check prerequisites"
    echo "  install    Install npm dependencies"
    echo "  compile    Compile TypeScript to JavaScript"
    echo "  lint       Run ESLint code analysis"
    echo "  dev        Start development mode with file watching"
    echo "  package    Package extension as .vsix file"
    echo "  test       Run extension tests"
    echo "  clean      Clean build artifacts"
    echo "  info       Show extension information"
    echo "  help       Show this help message"
    echo ""
    echo "Development workflow:"
    echo "1. $0 check      (verify prerequisites)"
    echo "2. $0 install    (install dependencies)"
    echo "3. $0 compile    (build extension)"
    echo "4. $0 dev        (start development mode)"
    echo "5. Open VS Code and press F5 to test"
}

# Main script logic
case "$1" in
    check)
        check_prerequisites
        ;;
    install)
        check_prerequisites
        install_dependencies
        ;;
    compile)
        compile
        ;;
    lint)
        lint
        ;;
    dev)
        check_prerequisites
        compile
        dev
        ;;
    package)
        check_prerequisites
        compile
        lint
        package
        ;;
    test)
        test
        ;;
    clean)
        clean
        ;;
    info)
        info
        ;;
    help|--help|-h)
        help
        ;;
    "")
        echo "❌ No command provided"
        help
        exit 1
        ;;
    *)
        echo "❌ Unknown command: $1"
        help
        exit 1
        ;;
esac

echo ""
echo "🎉 Task completed successfully!"