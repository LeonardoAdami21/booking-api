import { loadErrorMessages } from "../../index.js";
import GCSClient from "../google/index.js";
import {
  getInsertedReservation,
  getInsertQuery,
  prepareReservationData,
  validateReservation,
} from "./helper.js";
import {
  createAllServicesFromBooking,
  getServiceCount
} from "./services.js";

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
          type: "create",
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
          type: "create",
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
          services: [],
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
        insertedReservation,
        validateReservationData.serviceType,
      );

      // Processar resultados
      const createdServices = allServicesResult.createdServices.map(
        (service) => ({
          id: service.serviceId,
          identifier: service.service.Identifier,
          type: service.serviceType,
          service: service.service,
          paxData: service.paxData,
          index: service.index,
          originalIndex: service.originalIndex,
          transfer: service.transfer,
          status: "S122",
          message: messages["S122"] || "Serviço criado com sucesso",
        }),
      );

      const failedServices = allServicesResult.errors.map((error) => ({
        type: error.serviceType,
        index: error.index,
        error: error.error?.error || "E107",
        message: error.error?.message || messages["E107"],
      }));

      // Backup dos dados
      const backupData = {
        timestamp: new Date().toISOString(),
        channel,
        create,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        processedServices: {
          total: totalServices,
          created: createdServices.length,
          failed: failedServices.length,
        },
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
        return {
          type: "create",
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
        version: 1,
        reservation: {
          id: insertedReservation.IDMO,
          identifier: insertedReservation.Identifier,
          status: insertedReservation.Status,
        },
        services: {
          total: totalServices,
          created: createdServices.length,
          failed: failedServices.length,
          details: {
            created: createdServices,
            failed: failedServices,
          },
        },
        create,
        message: messages["S121"] || "Reserva criada com sucesso",
      };

      if (failedServices.length > 0) {
        return {
          type: "create",
          channel,
          create: null,
          error: "E107",
          message: messages["E107"],
        };
      }

      return response;
    } catch (error) {
      await connection.rollback();
      return {
        type: "create",
        channel: request.body?.channel,
        create: null,
        error: "E107",
        message: messages["E107"] || "Erro interno do servidor",
      };
    } finally {
      connection.release();
    }
  });
}
