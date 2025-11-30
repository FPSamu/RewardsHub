#!/usr/bin/env node

/**
 * Pre-deployment verification script
 * Run this before deploying to catch common issues
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Running pre-deployment checks...\n');

let hasErrors = false;
let hasWarnings = false;

// Check 1: package.json exists and has required fields
console.log('✓ Checking package.json...');
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (!packageJson.engines) {
        console.log('  ⚠️  Warning: No engines field specified');
        hasWarnings = true;
    }
    
    if (!packageJson.scripts.build) {
        console.log('  ❌ Error: No build script found');
        hasErrors = true;
    }
    
    if (!packageJson.scripts.start) {
        console.log('  ❌ Error: No start script found');
        hasErrors = true;
    }
    
    console.log('  ✅ package.json looks good\n');
} catch (error) {
    console.log('  ❌ Error reading package.json:', error.message);
    hasErrors = true;
}

// Check 2: .env.example exists
console.log('✓ Checking .env.example...');
if (fs.existsSync('.env.example')) {
    console.log('  ✅ .env.example exists\n');
} else {
    console.log('  ⚠️  Warning: .env.example not found');
    console.log('     Create one to document required environment variables\n');
    hasWarnings = true;
}

// Check 3: TypeScript configuration
console.log('✓ Checking tsconfig.json...');
try {
    const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
    
    if (!tsconfig.compilerOptions.outDir) {
        console.log('  ❌ Error: No outDir specified in tsconfig.json');
        hasErrors = true;
    }
    
    console.log('  ✅ tsconfig.json looks good\n');
} catch (error) {
    console.log('  ❌ Error reading tsconfig.json:', error.message);
    hasErrors = true;
}

// Check 4: Source files exist
console.log('✓ Checking source files...');
const requiredFiles = [
    'src/index.ts',
    'src/app.ts',
];

requiredFiles.forEach(file => {
    if (!fs.existsSync(file)) {
        console.log(`  ❌ Error: Required file missing: ${file}`);
        hasErrors = true;
    }
});

if (!hasErrors) {
    console.log('  ✅ All required source files present\n');
}

// Check 5: Environment variables documentation
console.log('✓ Checking environment variables...');
const requiredEnvVars = [
    'PORT',
    'NODE_ENV',
    'MONGO_URI',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
];

if (fs.existsSync('.env.example')) {
    const envExample = fs.readFileSync('.env.example', 'utf8');
    const missingVars = requiredEnvVars.filter(v => !envExample.includes(v));
    
    if (missingVars.length > 0) {
        console.log('  ⚠️  Warning: Missing variables in .env.example:', missingVars.join(', '));
        hasWarnings = true;
    } else {
        console.log('  ✅ All required environment variables documented\n');
    }
}

// Check 6: Git repository
console.log('✓ Checking git repository...');
if (fs.existsSync('.git')) {
    console.log('  ✅ Git repository initialized\n');
} else {
    console.log('  ⚠️  Warning: Not a git repository');
    console.log('     Initialize with: git init\n');
    hasWarnings = true;
}

// Check 7: .gitignore
console.log('✓ Checking .gitignore...');
if (fs.existsSync('.gitignore')) {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    const requiredIgnores = ['node_modules', '.env', 'dist'];
    const missingIgnores = requiredIgnores.filter(i => !gitignore.includes(i));
    
    if (missingIgnores.length > 0) {
        console.log('  ⚠️  Warning: Missing entries in .gitignore:', missingIgnores.join(', '));
        hasWarnings = true;
    } else {
        console.log('  ✅ .gitignore looks good\n');
    }
} else {
    console.log('  ❌ Error: .gitignore not found');
    hasErrors = true;
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 Pre-deployment Check Summary');
console.log('='.repeat(50));

if (hasErrors) {
    console.log('\n❌ FAILED: Please fix the errors above before deploying\n');
    process.exit(1);
} else if (hasWarnings) {
    console.log('\n⚠️  PASSED WITH WARNINGS: Review warnings above\n');
    console.log('You can proceed with deployment, but consider addressing the warnings.\n');
    process.exit(0);
} else {
    console.log('\n✅ ALL CHECKS PASSED!\n');
    console.log('Your project is ready for deployment to Render.com\n');
    console.log('Next steps:');
    console.log('1. Commit your changes: git add . && git commit -m "Prepare for deployment"');
    console.log('2. Push to GitHub: git push origin main');
    console.log('3. Follow the deployment guide in DEPLOYMENT.md\n');
    process.exit(0);
}
