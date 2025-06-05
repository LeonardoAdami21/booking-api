import fastify from "fastify";
import { reservationSchema } from "../../schema/reservation.js";
import { v4 as uuidv4 } from "uuid";
import { loadErrorMessages } from "../../index.js";

// Função para criar nova reservas
export default async function reservationRoutes(fastify, options) {
  fastify.post(
    "/reservation",
    {
      schema: {
        body: reservationSchema,
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "integer" },
              type: { type: "string" },
              business: { type: "string" },
              hash: { type: "string" },
              version: { type: "integer" },
              reservation: { type: "object" },
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Conecta ao banco de dados
      const connection = await fastify.mysql.getConnection();
      const messages = await loadErrorMessages("pt-BR");
      try {
        // Inicia a transação
        await connection.beginTransaction();

        const { business, reservation } = request.body;

        // Valida a reserva antes de qualquer operação
        const validateError = validateReservation(reservation);
        if (validateError) {
          await connection.rollback();
          return reply.status(400).send({
            id: null,
            type: "reservation",
            business: business || null,
            hash: null,
            version: null,
            reservation: null,
            error: "E114",
            message: messages["E114"],
          });
        }

        // Verifica se já existe uma reserva com o mesmo identifier
        const duplicateCheck = await checkDuplicateReservation(
          connection,
          reservation.identifier,
          business,
        );
        if (duplicateCheck) {
          await connection.rollback();
          return reply.status(409).send({
            id: duplicateCheck.IDMO, // Retorna o ID da reserva existente
            type: "reservation",
            business: business,
            hash: duplicateCheck.Hash || null, // Retorna o hash existente
            version: duplicateCheck.Version || null, // Retorna a versão existente
            reservation: null,
            error: "E115",
            message: messages["E115"],
          });
        }

        const hash = generateHash();

        // Prepara os dados da reserva
        const reservationData = prepareReservationData(
          business,
          reservation,
          hash,
        );

        // Insere a reserva (apenas uma vez)
        const [result] = await connection.query(
          getInsertQuery(),
          reservationData,
        );

        // Verifica se a inserção foi bem-sucedida
        if (!result.insertId) {
          return reply.status(500).send({
            id: null,
            type: "reservation",
            business: business,
            hash: null,
            version: null,
            reservation: null,
            error: "E116",
            message: messages["E116"],
          });
        }

        // Resgata os dados completos da reserva inserida
        const insertedReservation = await getInsertedReservation(
          connection,
          result.insertId,
        );

        if (!insertedReservation) {
          await connection.rollback();
          return reply.status(500).send({
            id: null,
            type: "reservation",
            business: business,
            hash: null,
            version: null,
            reservation: null,
            error: "E116",
            message: messages["E116"],
          });
        }

        await connection.commit();

        // Prepara o objeto de resposta final
        const responseData = {
          id: insertedReservation.IDMO, // USA O IDMO DA TABELA, NÃO O result.insertId
          type: "reservation",
          business: business,
          hash: hash,
          version: 1,
          reservation,
          error: "S121",
          message: messages["S121"],
        };

        // Aqui você pode salvar no bucket usando o responseData
        // await saveToBucket(responseData);

        return reply.status(201).send({
          ...responseData,
        });
      } catch (error) {
        await connection.rollback();
        fastify.log.error("Erro ao criar reserva:", error);

        return reply.status(500).send({
          id: null,
          type: "reservation",
          business: request.body?.business || null,
          hash: null,
          version: null,
          reservation: null,
          error: "E107",
          message: messages["E107"],
        });
      } finally {
        connection.release();
      }
    },
  );
}

// Função corrigida para verificar duplicatas - retorna dados completos se encontrado
async function checkDuplicateReservation(connection, identifier, business) {
  try {
    const [existing] = await connection.query(
      "SELECT IDMO, Hash, Version FROM `ORDER` WHERE Identifier = ? AND Business = ? LIMIT 1",
      [identifier, business],
    );
    return existing.length > 0 ? existing[0] : null;
  } catch (error) {
    return reply.status(500).send({
      id: null,
      type: "reservation",
      business: business,
      hash: null,
      version: null,
      reservation: null,
      error: "E117",
      message: messages["E117"],
    });
  }
}

// Função para resgatar o IDMO após inserção
async function getInsertedReservation(connection, insertId) {
  try {
    const [result] = await connection.query(
      "SELECT IDMO, Business, Identifier, Hash, Version, Created FROM `ORDER` WHERE IDMO = ? LIMIT 1",
      [insertId],
    );
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    return reply.status(500).send({
      id: null,
      type: "reservation",
      business: null,
      hash: null,
      version: null,
      reservation: null,
      error: "E118",
      message: messages["E118"],
    });
  }
}

function validateReservation(reservation) {
  // Validação básica de campos obrigatórios
  if (!reservation.identifier) {
    return reply.status(400).send({
      error: "E112",
      message: messages["E112"],
    });
  }

  if (
    !reservation.period ||
    !reservation.period.start ||
    !reservation.period.end
  ) {
    return reply.status(400).send({
      error: "E113",
      message: messages["E113"],
    });
  }

  const startDate = new Date(reservation.period.start);
  const endDate = new Date(reservation.period.end);
  const today = new Date();

  // Remove horas para comparação apenas de datas
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  if (startDate < today) {
    return reply.status(400).send({
      error: "E110",
      message: messages["E110"],
    });
  }

  if (endDate <= startDate) {
    return reply.status(400).send({
      error: "E111",
      message: messages["E111"],
    });
  }

  return null;
}

// Função para preparar os dados da reserva
function prepareReservationData(business, reservation, hash) {
  const version = 1;
  const now = new Date();

  return [
    now, // Created
    now, // Imported
    reservation.expiresAt ? new Date(reservation.expiresAt) : null, // Expiration
    reservation.confirmation ? new Date(reservation.confirmation) : null, // Confirmation
    business, // Business
    version, // Version
    reservation.identifier, // Identifier
    hash, // Hash
    reservation.language || "pt-br", // Language
    reservation.status || "pending", // Status
    reservation.type || "standard", // Type
    new Date(reservation.period.start), // StartDate
    new Date(reservation.period.end), // EndDate
    reservation.channel?.name || "unknown", // Channel
    reservation.locator || null, // Locator

    // Company data
    reservation.company?.id || null,
    reservation.company?.name || "",

    // Client data
    reservation.client?.id || null,
    reservation.client?.name || "",

    // Agent data
    reservation.agent?.id || null,
    reservation.agent ? getFullName(reservation.agent) : "",

    // Manager data
    reservation.manager?.id || null,
    reservation.manager ? getFullName(reservation.manager) : "",

    // Attendant data
    reservation.attendant?.id || null,
    reservation.attendant ? getFullName(reservation.attendant) : null,

    // User data
    reservation.user?.id || null,
    reservation.user ? getFullName(reservation.user) : "",

    // Customer data
    reservation.customer?.id || null,
    reservation.customer ? getFullName(reservation.customer) : "",

    // Financial
    reservation.total?.service?.price || 0.0,
    reservation.total?.service?.discount || 0.0,
    reservation.total?.service?.tax || 0.0,
    reservation.total?.service?.markup || 0.0,
    reservation.total?.service?.commission || 0.0,
    reservation.total?.service?.price || 0.0, // Cost
    0.0, // Rav
    reservation.total?.total || 0.0, // Total

    // Extra info
    reservation.information || "",
    "", // Notes
  ];
}

// Função para obter o nome completo
function getFullName(person) {
  if (!person) return "";
  const firstName = person.firstName || "";
  const lastName = person.lastName || "";
  return `${firstName} ${lastName}`.trim();
}

// Função para gerar um hash único
function generateHash() {
  return uuidv4().replace(/-/g, "");
}

// Query de inserção corrigida
function getInsertQuery() {
  return `INSERT INTO \`ORDER\` (
    Created, Imported, Expiration, Confirmation,
    Business, Version, Identifier, Hash, Language,
    Status, Type, StartDate, EndDate, Channel,
    Locator, IDCompany, Company, IDClient, Client,
    IDAgent, Agent, IDManager, Manager, IDAttendant, Attendant,
    IDUser, User, IDCustomer, Customer,
    Price, Discount, Taxes, Markup, Commission,
    Cost, Rav, Total, Information, Notes
  ) VALUES (?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?)`;
}
