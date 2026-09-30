// Red de seguridad: ningun test debe tocar la base real. Prisma no sobreescribe variables
// ya definidas con las del .env, asi que esto gana. Los tests de integracion usan SQLite (TEST_DATABASE_URL).
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/blocked_in_tests?connect_timeout=1';
