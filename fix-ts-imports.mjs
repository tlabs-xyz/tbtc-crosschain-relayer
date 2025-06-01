import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';

const projectRoot = process.cwd();
const SOURCE_PATTERNS = [
  '**/*.ts',
  // If you have .tsx files that need this treatment, add '**/*.tsx'
];
const IGNORE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '**/*.d.ts', // Definitely ignore declaration files
  // Add any other specific files/directories you want to ignore
  'target/**',
  'prisma/migrations/**',
];

// Regex to find import/export 'from' statements.
// It captures:
// 1. The full import/export prefix up to the opening quote (e.g., "import foo from '")
// 2. The path itself (e.g., "./utils/Logger" or "@/utils/Logger")
// 3. The closing quote and semicolon (e.g., "';")
// It specifically targets paths starting with './', '../', or '@/'
// and ensures they don't already end with a common file extension.
const importExportRegex =
  /(import\s+(?:type\s+)?(?:[^'"]*\s+from\s+)?['"]|export\s+(?:type\s+)?(?:{[^}]*}|\*)\s+from\s+['"])((?:\.\/|\.\.\/|@\/)[^'"?#]*?)(?<!\.(?:js|mjs|cjs|json|ts|tsx|node|wasm|css|scss|less|html|svg|png|jpg|jpeg|gif|webp))(['"];?)/g;

async function processFile(filePath) {
  const absoluteFilePath = path.resolve(projectRoot, filePath);
  let content = await fs.readFile(absoluteFilePath, 'utf-8');
  let originalContent = content;

  content = content.replace(importExportRegex, (match, prefix, importPath, suffix) => {
    // Don't modify if it's a type-only import/export that TypeScript might strip anyway,
    // UNLESS it's clear it's a module path that needs runtime resolution.
    // For simplicity now, we treat all matching non-extended paths.
    // A more complex regex could try to differentiate type-only imports.
    // However, `moduleResolution: "bundler"` generally means TS expects you to get this right.

    // If the path is an alias like @/utils/Logger, it's fine.
    // The key is that it becomes utils/Logger.js in the end.
    const newImportPath = importPath + '.js';
    console.log(`  [${filePath}] Fixing: ${importPath}  ==>  ${newImportPath}`);
    return `${prefix}${newImportPath}${suffix}`;
  });

  if (content !== originalContent) {
    await fs.writeFile(absoluteFilePath, content, 'utf-8');
    console.log(`Updated imports in: ${filePath}`);
    return true;
  }
  return false;
}

async function main() {
  console.log('Starting TypeScript import path correction script...');
  console.log(`Project Root: ${projectRoot}`);

  const files = await fg(SOURCE_PATTERNS, {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    absolute: false, // Work with relative paths for logging
    dot: true, // Include files starting with a dot if they match patterns
  });

  if (files.length === 0) {
    console.log(
      'No TypeScript files found matching the criteria. Ensure SOURCE_PATTERNS and IGNORE_PATTERNS are correct.',
    );
    return;
  }

  console.log(`Found ${files.length} TypeScript files to process:`);
  // files.forEach(f => console.log(` - ${f}`)); // Uncomment for verbose listing

  let filesChangedCount = 0;
  for (const file of files) {
    try {
      if (await processFile(file)) {
        filesChangedCount++;
      }
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
    }
  }

  console.log(`\nScript finished. ${filesChangedCount} file(s) were updated.`);
  if (filesChangedCount > 0) {
    console.log('\nIMPORTANT NEXT STEPS:');
    console.log("1. Review the changes carefully (e.g., using 'git diff').");
    console.log(
      "2. Run your linter to catch any nuanced issues and reformat (e.g., 'yarn lint --fix').",
    );
    console.log("3. Run your build process (e.g., 'yarn build' or 'tsc').");
    console.log('4. Test your application thoroughly.');
  } else {
    console.log(
      "No files seemed to require changes based on the script's logic. If you still have issues, the problem might be elsewhere or require a more specific regex.",
    );
  }
}

main().catch((error) => {
  console.error('Script failed with an unhandled error:', error);
  process.exit(1);
});
