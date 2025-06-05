import { reservationSchema } from "../../schema/reservation.js";
import { v4 as uuidv4 } from "uuid";

// Função para criar nova reserva
export default async function reservationRoutes(fastify, options) {
  fastify.post(
    "/reservations",
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
      const connection = await fastify.mysql.getConnection();

      try {
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
            error: validateError.code,
            message: validateError.message,
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
            id: null,
            type: "reservation",
            business: business,
            hash: null,
            version: null,
            reservation: null,
            error: "E003",
            message: "Reserva já existe com este identificador",
          });
        }

        const hash = generateHash();
        const uniqueIdIndex = await generateUniqueIdIndex(
          connection,
          reservation.id,
        );

        // Prepara os dados da reserva
        const reservationData = prepareReservationData(
          business,
          reservation,
          hash,
          uniqueIdIndex,
        );

        // Insere a reserva (apenas uma vez)
        const [result] = await connection.query(
          getInsertQuery(),
          reservationData,
        );

        // Verifica se a inserção foi bem-sucedida
        if (!result.insertId) {
          throw new Error("Falha na inserção da reserva");
        }

        await connection.commit();

        return reply.status(201).send({
          id: result.insertId,
          type: "reservation",
          business: business,
          hash: hash,
          version: 1,
          reservation,
          error: "E000",
          message: "Reserva criada com sucesso",
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
          error: "E999",
          message: "Erro interno do servidor",
        });
      } finally {
        connection.release();
      }
    },
  );
}

// Função para verificar duplicatas
async function checkDuplicateReservation(connection, identifier, business) {
  try {
    const [existing] = await connection.query(
      "SELECT IDMO FROM `ORDER` WHERE Identifier = ? AND Business = ? LIMIT 1",
      [identifier, business],
    );
    return existing.length > 0;
  } catch (error) {
    fastify.log.error("Erro ao verificar duplicata:", error);
    return false;
  }
}

function validateReservation(reservation) {
  // Validação básica de campos obrigatórios
  if (!reservation.identifier) {
    return {
      code: "E004",
      message: "Identificador da reserva é obrigatório",
    };
  }

  if (
    !reservation.period ||
    !reservation.period.start ||
    !reservation.period.end
  ) {
    return {
      code: "E005",
      message: "Período da reserva é obrigatório",
    };
  }

  const startDate = new Date(reservation.period.start);
  const endDate = new Date(reservation.period.end);
  const today = new Date();

  // Remove horas para comparação apenas de datas
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  if (startDate < today) {
    return {
      code: "E001",
      message: "Data de início não pode ser no passado",
    };
  }

  if (endDate <= startDate) {
    return {
      code: "E002",
      message: "Data de fim deve ser posterior à data de início",
    };
  }

  return null;
}

// Função para preparar os dados da reserva
function prepareReservationData(business, reservation, hash, uniqueIdIndex) {
  const version = 1;
  const now = new Date();

  return [
    now, // Created
    now, // Imported
    reservation.expiresAt ? new Date(reservation.expiresAt) : null, // Expiration
    reservation.confirmation ? new Date(reservation.confirmation) : null, // Confirmation
    business, // Business
    uniqueIdIndex, // IDIndex
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

    // Attendant data (optional)
    reservation.attendant?.id || null,
    reservation.attendant ? getFullName(reservation.attendant) : null,

    // User data
    reservation.user?.id || null,
    reservation.user ? getFullName(reservation.user) : "",

    // Customer data
    reservation.customer?.id || null,
    reservation.customer ? getFullName(reservation.customer) : "",

    // Financial data
    reservation.total?.service?.price || 0.0, // Price
    reservation.total?.service?.discount || 0.0, // Discount
    reservation.total?.service?.tax || 0.0, // Taxes
    reservation.total?.service?.markup || 0.0, // Markup
    reservation.total?.service?.commission || 0.0, // Commission
    reservation.total?.service?.price || 0.0, // Cost
    0.0, // Rav
    reservation.total?.total || 0.0, // Total

    // Additional info
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

// Função melhorada para gerar IDIndex único
async function generateUniqueIdIndex(connection, preferredId) {
  // Se um ID preferido foi fornecido, tenta usá-lo primeiro
  if (preferredId) {
    const isAvailable = await checkIdIndexAvailability(connection, preferredId);
    if (isAvailable) {
      return preferredId;
    }
  }

  // Gera um novo ID único
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const newId = generateRandomId();
    const isAvailable = await checkIdIndexAvailability(connection, newId);

    if (isAvailable) {
      return newId;
    }

    attempts++;
  }

  // Fallback: usar timestamp com um sufixo aleatório
  return Date.now() + Math.floor(Math.random() * 1000);
}

// Função auxiliar para verificar disponibilidade do IDIndex
async function checkIdIndexAvailability(connection, idIndex) {
  try {
    const [existing] = await connection.query(
      "SELECT IDIndex FROM `ORDER` WHERE IDIndex = ? LIMIT 1",
      [idIndex],
    );
    return existing.length === 0;
  } catch (error) {
    return false;
  }
}

// Função para gerar ID aleatório
function generateRandomId() {
  return Math.floor(Math.random() * 900000) + 100000; // 6 dígitos
}

// Query de inserção corrigida
function getInsertQuery() {
  return `INSERT INTO \`ORDER\` (
    Created, Imported, Expiration, Confirmation,
    Business, IDIndex, Version, Identifier, Hash, Language,
    Status, Type, StartDate, EndDate, Channel,
    Locator, IDCompany, Company, IDClient, Client,
    IDAgent, Agent, IDManager, Manager, IDAttendant, Attendant,
    IDUser, User, IDCustomer, Customer,
    Price, Discount, Taxes, Markup, Commission,
    Cost, Rav, Total, Information, Notes
  ) VALUES (?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?)`;
}
