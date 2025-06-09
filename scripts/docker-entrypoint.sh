#!/bin/sh
set -e

echo "🚀 Starting tBTC Relayer container..."
echo "📊 Node version: $(node --version)"
echo "📦 NPM version: $(npm --version)"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

echo "🗄️  Database URL configured (first 20 chars): ${DATABASE_URL:0:20}..."

# Check database connectivity
echo "🔍 Checking database connectivity..."
if ! npx prisma db pull --force --print 2>/dev/null; then
    echo "❌ ERROR: Cannot connect to database"
    echo "🔧 Troubleshooting tips:"
    echo "   - Check if DATABASE_URL is correct"
    echo "   - Verify database server is running"
    echo "   - Check network connectivity"
    exit 1
fi

echo "✅ Database connection successful"

# Check migration status
echo "📋 Checking migration status..."
npx prisma migrate status || {
    echo "⚠️  Migration status check failed, but continuing..."
}

# Run database migrations
echo "🔄 Running database migrations..."
if npx prisma migrate deploy; then
    echo "✅ Database migrations completed successfully"
else
    echo "❌ ERROR: Database migrations failed"
    echo "🔧 Troubleshooting tips:"
    echo "   - Check if migration files exist in /usr/app/prisma/migrations/"
    echo "   - Verify database permissions"
    echo "   - Check migration file integrity"
    ls -la /usr/app/prisma/migrations/ || echo "❌ Migration directory not found"
    exit 1
fi

# Verify tables exist
echo "🔍 Verifying database tables..."
if npx prisma db pull --force --print | grep -q "model"; then
    echo "✅ Database tables verified"
else
    echo "⚠️  Warning: Could not verify database tables"
fi

echo "🎯 Starting application..."
# Start the app (forward all arguments)
exec "$@"