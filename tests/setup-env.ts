// Every deployment must configure OWNER_EMAIL before an empty database can
// seed its first admin; tests that boot a fresh in-memory database are
// deployments too. An invented address - never a real member.
process.env.OWNER_EMAIL ||= "owner@example.com";
