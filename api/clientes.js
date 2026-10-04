import { neon } from '@neondatabase/serverless';
 
const sql = neon(process.env.DATABASE_URL);
 
export default async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const rows = await sql`SELECT data FROM app_data WHERE id = 'servicios'`;
      const servicios = rows[0]?.data ?? [];
      return response.status(200).json(servicios);
    }
 
    if (request.method === 'POST') {
      const servicios = request.body;
      if (!Array.isArray(servicios)) {
        return response.status(400).json({ error: 'Se esperaba un arreglo de servicios.' });
      }
      await sql`
        INSERT INTO app_data (id, data, updated_at)
        VALUES ('servicios', ${JSON.stringify(servicios)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `;
      return response.status(200).json({ ok: true });
    }
 
    response.setHeader('Allow', ['GET', 'POST']);
    return response.status(405).json({ error: `Método ${request.method} no permitido` });
  } catch (error) {
    console.error('Error en /api/servicios:', error);
    return response.status(500).json({ error: 'Error del servidor al acceder a la base de datos.' });
  }
}
