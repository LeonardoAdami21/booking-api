import { loadErrorMessages } from "../../index.js";
import GCSClient from "../google/index.js";
import {
  getInsertedReservation,
  getInsertQuery,
  prepareReservationData,
  validateReservation,
} from "./helper.js";
import { createAllServicesFromBooking, getServiceCount } from "./services.js";

const gcs = new GCSClient();

// Função para criar e gerenciar reservas
export default async function reservationRoutes(fastify, options) {
  // POST - Criar nova reserva
  fastify.post("/reservation", async (request, reply) => {
    const connection = await fastify.mysql.getConnection();
    const messages = await loadErrorMessages("pt-BR");

    try {
      await connection.beginTransaction();

      const { channel, create } = request.body;

      // Verificar se há serviços na reserva
      const totalServices = getServiceCount(create);
      if (totalServices === 0) {
        await connection.rollback();
        return {
          channel,
          create: null,
          error: "E124",
          message: "Nenhum serviço encontrado na reserva",
        };
      }

      // Valida a reserva antes de qualquer operação
      const validateReservationData = await validateReservation(create);
      if (validateReservationData.error) {
        await connection.rollback();
        return {
          channel,
          create: null,
          error: "E112",
          message: messages["E112"],
        };
      }

      // Preparar dados da reserva
      const reservationData = prepareReservationData(channel, create);

      // Inserir reserva
      const { query, values } = getInsertQuery(reservationData);
      const [result] = await connection.query(query, values);

      if (!result.insertId) {
        await connection.rollback();
        return {
          type: "reservation",
          channel,
          create: null,
          error: "E116",
          message: messages["E116"],
        };
      }

      // Buscar reserva inserida
      const insertedReservation = await getInsertedReservation(
        connection,
        result.insertId,
      );

      if (!insertedReservation) {
        await connection.rollback();
        return {
          type: "reservation",
          channel,
          create: null,
          error: "E116",
          message: messages["E116"],
        };
      }

      // Criar serviços da reserva
      const allServicesResult = await createAllServicesFromBooking(
        connection,
        channel,
        create,
        create.pax,
        insertedReservation
      );

      // Verificar se allServicesResult tem a estrutura esperada
      if (!allServicesResult.success) {
        await connection.rollback();
        return {
          channel,
          create: null,
          error: "E107",
          message: messages["E107"],
        };
      }

      const createdServices = allServicesResult.success;
      const failedServices = allServicesResult.error;

      // Backup dos dados
      const backupData = {
        timestamp: new Date().toISOString(),
        channel,
        create,
        ip: request.ip,
        processedServices: {
          total: totalServices,
          created: createdServices,
          failed: failedServices,
        },
        userAgent: request.headers["user-agent"],
      };

      const version = 1; // Defina a versão apropriada
      const backupFileName = `${version}`;

      try {
        await gcs.saveJSON(
          backupData,
          backupFileName,
          `${channel}/order/${insertedReservation.IDMO}`,
        );
      } catch (backupError) {
        console.error("Erro no backup:", backupError);
        await connection.rollback();
        return {
          channel,
          create: null,
          error: "E117",
          message: messages["E117"],
        };
      }

      // Finaliza a transação
      await connection.commit();

      // Resposta de sucesso
      const response = {
        type: "create",
        backup: backupFileName,
        channel,
        reservation: {
          id: insertedReservation.IDMO,
        },
        services: {
          total: totalServices,
          created: createdServices.length,
          details: {
            created: createdServices,
            failed: [],
          },
        },
        create,
        message: messages["S121"],
      };
      return response;
    } catch (error) {
      await connection.rollback();
      return {
        channel: request.body?.channel,
        create: null,
        error: "E107",
        message: messages["E107"],
      };
    } finally {
      connection.release();
    }
  });
}
