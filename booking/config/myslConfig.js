import fastify from "fastify";
import mysql from "@fastify/mysql";

const myslConfig = fastify({
  logger: true,
});

myslConfig.register(mysql, {
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

export default myslConfig;
