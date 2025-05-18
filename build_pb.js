import "dotenv/config";
import PocketBase from "pocketbase";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POCKETBASE_URL = process.env.POCKETBASE_URL;
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;
const SCHEMA_FILE = "pb_schema.json";

const REQUIRED_ENV_VARS = ["POCKETBASE_URL", "POCKETBASE_ADMIN_EMAIL", "POCKETBASE_ADMIN_PASSWORD"];

const IMPORT_ORDER = ["app_settings", "projects", "headers", "footers", "templates", "audit_logs", "entries_main", "entries_archived", "entries_previews", "feedback_votes"];

function validateEnv() {
  console.log("Validating environment variables...");
  let missing = false;
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      console.error(`❌ FATAL ERROR: Environment variable ${envVar} is not set.`);
      missing = true;
    }
  }
  if (missing) {
    console.error("👉 Please ensure all required variables are set in your .env file.");
    process.exit(1);
  }
  console.log("✅ Environment variables validated.");
}

async function authenticateAdmin(pb) {
  console.log(`Attempting to authenticate admin (${ADMIN_EMAIL}) via _superusers at ${POCKETBASE_URL}...`);
  try {
    await pb.collection("_superusers").authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!pb.authStore.isValid || pb.authStore.model?.collectionName !== "_superusers") {
      throw new Error("Admin authentication reported success, but the SDK state is not valid or not a superuser model.");
    }
    console.log("✅ Admin authenticated successfully and SDK state verified.");
  } catch (error) {
    console.error("❌ FATAL ERROR: PocketBase Admin authentication failed.");
    console.error(" - Ensure PocketBase is running at the specified URL.");
    console.error(" - Verify the admin email and password in your .env file (must be a Superuser account).");
    console.error(" - PocketBase Error:", error?.message || error);
    if (error?.data) console.error(" - Details:", error.data);
    process.exit(1);
  }
}

function loadSchemaFromFile() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const schemaPath = path.join(__dirname, SCHEMA_FILE);

  console.log(`\nLoading schema from ${SCHEMA_FILE}...`);
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ FATAL ERROR: Schema file not found at ${schemaPath}`);
    process.exit(1);
  }
  try {
    const fileContent = fs.readFileSync(schemaPath, "utf8");
    const schemaData = JSON.parse(fileContent);
    if (!Array.isArray(schemaData)) {
      console.error(`❌ FATAL ERROR: Schema file ${SCHEMA_FILE} does not contain a valid JSON array.`);
      process.exit(1);
    }
    console.log(`✅ Successfully loaded ${schemaData.length} collection definitions from file.`);
    return schemaData;
  } catch (error) {
    console.error(`❌ FATAL ERROR: Failed to read or parse schema file ${SCHEMA_FILE}:`, error);
    process.exit(1);
  }
}

async function buildSchema() {
  validateEnv();
  const allCollectionsToImport = loadSchemaFromFile();
  const importDataMap = new Map(allCollectionsToImport.map((c) => [c.name, c]));

  const pb = new PocketBase(POCKETBASE_URL);
  await authenticateAdmin(pb);

  console.log("\nFetching existing collections...");
  let existingCollections = [];
  try {
    existingCollections = await pb.collections.getFullList({
      fields: "id,name,type",
    });
  } catch (error) {
    console.error("❌ ERROR: Could not fetch existing collections.", error);
    if (error?.status === 401 || error?.status === 403) {
      console.error(" Received Unauthorized/Forbidden when fetching collections. Check PocketBase API rules for listing collections or admin permissions.");
    }
    process.exit(1);
  }
  const existingCollectionMap = new Map(existingCollections.map((c) => [c.name, c.id]));
  console.log(`Found ${existingCollections.length} existing collections.`);

  console.log("\n--- Importing Collections (in specified order) ---");
  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let notFoundInSchemaFile = 0;
  let notInImportOrder = 0;

  const processedCollections = new Set();

  for (const name of IMPORT_ORDER) {
    processedCollections.add(name);
    const collectionData = importDataMap.get(name);

    if (!collectionData) {
      console.warn(` ⚠️ Collection '${name}' defined in IMPORT_ORDER but not found in ${SCHEMA_FILE}. Skipping.`);
      notFoundInSchemaFile++;
      continue;
    }

    if (name === "users" || collectionData.type === "auth") {
      console.log(` Skipping import for '${name}' (Auth collection).`);
      skippedCount++;
      continue;
    }

    if (existingCollectionMap.has(name)) {
      console.log(` Collection '${name}' already exists. Skipping creation.`);
      skippedCount++;
      continue;
    }

    console.log(` Attempting to import collection: ${name}...`);
    try {
      await pb.collections.import([collectionData], false);
      console.log(` ✅ Successfully imported collection: ${name}`);
      createdCount++;
      const newCollection = await pb.collections.getOne(name);
      existingCollectionMap.set(name, newCollection.id);
    } catch (error) {
      const responseData = error?.response || {};
      console.error(` ❌ ERROR importing collection ${name}:`, responseData);
      errorCount++;
      if (responseData?.data) {
        const errors = responseData.data;
        for (const key in errors) {
          if (key === "collections" && typeof errors[key] === "object" && errors[key] !== null) {
            console.error(` - collections: ${errors[key]?.message || JSON.stringify(errors[key])}`);
            const collectionErrorData = errors[key]?.data;
            if (typeof collectionErrorData === "object" && collectionErrorData !== null) {
              const fieldErrors = collectionErrorData.fields;
              if (typeof fieldErrors === "object" && fieldErrors !== null) {
                for (const fieldIndex in fieldErrors) {
                  const fieldErrorDetails = fieldErrors[fieldIndex];
                  console.error(` - Field Index ${fieldIndex}: ${fieldErrorDetails?.message || JSON.stringify(fieldErrorDetails)}`);
                  if (collectionData?.fields?.[fieldIndex]?.name) {
                    console.error(` (Likely field: ${collectionData.fields[fieldIndex].name})`);
                  }
                }
              }
            }
          } else {
            console.error(` - ${key}: ${errors[key]?.message || JSON.stringify(errors[key])}`);
          }
        }
      } else if (error instanceof Error) {
        console.error(` - Error Message: ${error.message}`);
      }
    }
  }
  for (const collectionData of allCollectionsToImport) {
    if (!processedCollections.has(collectionData.name) && collectionData.name !== "users" && collectionData.type !== "auth") {
      console.warn(` ⚠️ Collection '${collectionData.name}' found in ${SCHEMA_FILE} but not listed in IMPORT_ORDER. It was not imported.`);
      notInImportOrder++;
    }
  }

  console.log("\n--- Import Summary ---");
  console.log(` Collections Imported: ${createdCount}`);
  console.log(` Collections Skipped (Already Existed or Auth): ${skippedCount}`);
  console.log(` Collections Not Found in Schema (but in Order): ${notFoundInSchemaFile}`);
  console.log(` Collections Not in Import Order (but in Schema): ${notInImportOrder}`);
  console.log(` Errors Encountered: ${errorCount}`);

  if (errorCount > 0) {
    console.warn("\n⚠️ Some collections failed to import. Please check the errors above.");
  }

  if (notFoundInSchemaFile > 0 || notInImportOrder > 0) {
    console.warn(`\n⚠️ Mismatch between collections in ${SCHEMA_FILE} and the IMPORT_ORDER list in the script. Ensure the list is complete and correct for the intended schema.`);
  }

  console.log("\n🚀 PocketBase schema import process finished.");
}

buildSchema().catch((error) => {
  console.error("\n💥 An unexpected error occurred during the build process:", error);
  process.exit(1);
});
