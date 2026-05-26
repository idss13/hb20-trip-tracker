import { Pool } from 'pg'

// pg trunca o username no ponto quando recebe uma connection string,
// então parseamos com URL nativo e passamos os campos individualmente.
function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host:     u.hostname,
    port:     parseInt(u.port, 10) || 5432,
    database: u.pathname.replace(/^\//, ''),
    user:     decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  }
}

const pool = new Pool({
  ...parseDbUrl(process.env.DATABASE_URL!),
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export default pool
