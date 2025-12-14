#!/bin/bash

# Verification script - Run this to ensure everything is ready
# Usage: bash verify.sh

set -e

echo "🔍 OpenCode ELF - Pre-Flight Verification"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must be run from project root"
    exit 1
fi

# Check Node.js version
echo "1️⃣  Checking Node.js version..."
NODE_VERSION=$(node -v)
echo "   Node.js: $NODE_VERSION"

# Check if dependencies are installed
echo ""
echo "2️⃣  Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "   ⚠️  Dependencies not installed. Running npm install..."
    npm install
else
    echo "   ✅ Dependencies installed"
fi

# Check if TypeScript compiles
echo ""
echo "3️⃣  Building TypeScript..."
if npm run build > /dev/null 2>&1; then
    echo "   ✅ TypeScript compiled successfully"
else
    echo "   ❌ TypeScript compilation failed"
    exit 1
fi

# Check if dist folder exists
echo ""
echo "4️⃣  Checking build output..."
if [ -d "dist" ] && [ -f "dist/index.js" ]; then
    echo "   ✅ Build output exists"
    FILE_COUNT=$(find dist -type f | wc -l | xargs)
    echo "   Files: $FILE_COUNT"
else
    echo "   ❌ Build output missing"
    exit 1
fi

# Check CLI scripts
echo ""
echo "5️⃣  Verifying CLI scripts..."
SCRIPTS=("manage-rules.js" "seed-rules.js" "manage-heuristics.js" "seed-heuristics.js" "view-learnings.js")
for script in "${SCRIPTS[@]}"; do
    if [ -f "scripts/$script" ]; then
        echo "   ✅ $script"
    else
        echo "   ❌ Missing: $script"
        exit 1
    fi
done

# Check documentation
echo ""
echo "6️⃣  Verifying documentation..."
DOCS=("README.md" "QUICKSTART.md" "TESTING.md" "GIT_SETUP.md" "PROJECT_SUMMARY.md")
for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        echo "   ✅ $doc"
    else
        echo "   ❌ Missing: $doc"
        exit 1
    fi
done

# Check git status
echo ""
echo "7️⃣  Checking Git repository..."
if [ -d ".git" ]; then
    echo "   ✅ Git initialized"
    BRANCH=$(git branch --show-current)
    echo "   Branch: $BRANCH"
else
    echo "   ❌ Git not initialized"
    exit 1
fi

# Test database initialization (light test)
echo ""
echo "8️⃣  Testing database initialization..."
if npm run rules:list > /dev/null 2>&1; then
    echo "   ✅ Database can be initialized"
else
    echo "   ❌ Database initialization failed"
    exit 1
fi

# Summary
echo ""
echo "=========================================="
echo "✅ All Pre-Flight Checks Passed!"
echo ""
echo "📋 Next Steps:"
echo "   1. Run: npm run test:simulate"
echo "   2. Seed data: npm run rules:seed && npm run heuristics:seed"
echo "   3. Push to GitHub (see GIT_SETUP.md)"
echo "   4. Install in OpenCode (see QUICKSTART.md)"
echo ""
echo "🚀 Ready for deployment!"
