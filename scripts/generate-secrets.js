#!/usr/bin/env node

/**
 * Generate secure random secrets for JWT tokens
 * Run this script to generate JWT_SECRET and JWT_REFRESH_SECRET
 */

const crypto = require('crypto');

console.log('\n🔐 JWT Secret Generator\n');
console.log('=' .repeat(60));
console.log('\nGenerating secure random secrets for your JWT tokens...\n');

// Generate JWT_SECRET
const jwtSecret = crypto.randomBytes(64).toString('hex');
console.log('JWT_SECRET:');
console.log(jwtSecret);
console.log('');

// Generate JWT_REFRESH_SECRET
const jwtRefreshSecret = crypto.randomBytes(64).toString('hex');
console.log('JWT_REFRESH_SECRET:');
console.log(jwtRefreshSecret);
console.log('');

console.log('=' .repeat(60));
console.log('\n📋 Copy these values to your .env file or Render dashboard\n');
console.log('⚠️  IMPORTANT: Keep these secrets safe and never commit them to git!\n');
console.log('💡 TIP: Use different secrets for development and production\n');
