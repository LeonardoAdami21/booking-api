import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import { loadErrorMessages } from "../index.js";
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
    const messages = await loadErrorMessages("pt-BR");
    return reply.status(200).send({
      error: "S120",
      message: messages["S120"],
      connection
    });
  } catch (error) {
    const messages = await loadErrorMessages("pt-BR");
    return reply.status(500).send({
      error: "E119",
      message: messages["E119"],
    });
  }
}
