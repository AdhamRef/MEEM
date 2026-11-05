/** A dedicated port, so browser tests can never touch a development database. */
export const E2E_DATABASE_PORT = 27118;
export const E2E_DATABASE_READY_PORT = 27119;
export const E2E_DATABASE_URL = `mongodb://127.0.0.1:${E2E_DATABASE_PORT}/muslim_e2e?replicaSet=rs0&directConnection=true`;
