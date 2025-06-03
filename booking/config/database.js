import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

export const pool = mysql.createPool(dbConfig);

// Função para testar conexão
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("✅ Conexão com MySQL estabelecida com sucesso!");
    connection.release();
    return true;
  } catch (error) {
    console.error("❌ Erro ao conectar com MySQL:", error.message);
    return false;
  }
}
