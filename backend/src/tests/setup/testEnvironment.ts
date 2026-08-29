process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "zabota-local-test-secret-not-for-production";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}
